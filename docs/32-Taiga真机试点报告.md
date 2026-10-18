# 32 · Taiga 真机试点报告（docs/30 §7 待实测清单的答卷）

> 探针单产出（与 docs/31 dsh 探针同法）：**实测前不写结论、实测后修正文档**。
> 环境：本机 Docker Desktop（arm64）+ taiga-docker 官方 compose，端口 9000（避开 8080/8008/8787-8789/4399）。
> 试点时间：2026-10-18；原始证据：`/tmp/taiga-probe/`（走查脚本/角色权限快照/102 条 webhook 捕获/history diff/webhooklogs）；
> 凭据：`/tmp/taiga-docker/.admin-credentials`（0600，永不入仓）。
> 试点栈当前**保持运行**（九容器，`http://localhost:9000`）供制作人查验与后续适配器开发对靶。

## 一、部署面结论

1. **Docker pull 全面挂起的根因 = Docker Desktop 死代理**：daemon 配置 `http.docker.internal:3128`，宿主机无任何进程监听 3128，macOS 系统代理全关——所有 `docker pull`（含 Hub/任何加速源）在 manifest 阶段网络级停滞；而 shell 侧直连完全正常（curl 取 manifest 1.5-1.9s）。
   **绕行方案（已沉淀为 `/tmp/taiga-images/download.sh`）**：curl 直取镜像源（docker.1panel.live）manifest+blobs → 本地组装 docker-archive → `docker load` → retag 回原名。7/7 镜像 5 分钟完成，含逐 blob 大小校验。
   **给制作人的一行修复**（不动我没动，等你拍板）：Docker Desktop → Settings → Resources → Proxies，把死代理配置删掉，此后正常 `docker pull` 即可。
2. **镜像架构（§7-2 答案）**：`taigaio/{taiga-back,taiga-front,taiga-events,taiga-protected}:latest` 为 **linux/amd64 单架构**（无 arm64 manifest，无需再 inspect）；`postgres:12.3` / `rabbitmq:3.8-management-alpine` / `nginx:1.19-alpine` 有 arm64 原生。**Rosetta 转译实测可跑**：amd64 四件套在 arm64 Mac 上 gunicorn 三 worker 正常起、API 全通——**无需按 ARM 指南源码构建**，C4 在 Mac mini 落地可行。
3. **两个必须显式注入的环境变量**（`docker/config.py` 环境面，默认值都不适合我们）：
   - `PUBLIC_REGISTER_ENABLED=False`（关公共注册，账号只经 onboard 建）
   - `WEBHOOKS_ALLOW_PRIVATE_ADDRESS=True`（见 §三-⑦：SSRF 私网闸默认拦 LAN 回环——公网 SaaS 的合理默认，私网闭环部署的致命默认）
4. 运维小坑：taiga-back 重建换 IP 后网关 nginx 缓存旧 DNS → 502，需同步 `docker restart taiga-gateway`（写入将来部署脚本）。

## 二、onboard 九步走查（docs/30 §6 的实测修正）

| 步 | 结果 | 备注 |
|---|---|---|
| ① auth 换 token | ✅ JWT | |
| ② project-templates | ✅ 201 (81ms) | |
| ③ projects 建公司 | ✅ 201 (202ms) | probe-co |
| ④ 用户建号 | ⚠️ **路径修正** | `POST /users` **405 不存在**（证伪 §6 ④ 原假设）。正解：admin 建 membership（邀请 token **不在任何 API 响应里**，落 console 邮件日志 `docker logs`）→ `POST /auth/register {type:private, token, accepted_terms:true}` → **201 建号+绑成员一次完成**（worker-p2 实证，成员表=[admin, worker-p2]）。关注册态下匿名 public/private 均被拒 ✓ |
| ⑤ roles | ✅ 全量可读 | 6 角色带 permissions 数组（成员类 33 枚/stakeholder 19 枚），快照在 `/tmp/taiga-probe/roles-probe-co.json`——§7-4 的枚举素材齐 |
| ⑥ custom-attributes | ✅ 201×3 | userstory/task/issue 三实体「工号」字段均建 |
| ⑦ webhooks + test | ✅（改配置后） | 见 §三 |
| ⑧ wiki 根页 | ✅ 201 | |
| ⑨ 流转+收割 | ✅ | 见 §四 |

## 三、webhook 活动流（FlowPlatform activity 能力的主通道）

- **SSRF 私网闸**：默认 `WEBHOOKS_ALLOW_PRIVATE_ADDRESS=False` → 投递私网地址被拦（webhooklog 直证：`error-in-request: Private IP Address not allowed`）。开 True 后回环全通。
- **鉴权 = HMAC-SHA1 签名**：每投递带 `X-TAIGA-WEBHOOK-SIGNATURE`（= HMAC-SHA1(key, body)）与 `X-Hub-Signature: sha1=…`——**与框架网关 wkey 同构**，适配器直接复用验签思路，优于裸密钥头。
- **异步投递实证**：celery（taiga-async）链路真实工作——100 条种子单 create 全部送达（监听器共捕获 102 事件，含 test 与变更），投递结果可从 `GET /webhooklogs` 审计（含 request/response 头与耗时，且自动只留最近 10 条/钩）。

## 四、性能与 history（§7-3 的 lite 答案）

- Rosetta 转译下：写 ~60-85ms/单（100 单连发 6s）；列表读 ~10ms（page_size 30 与 100 相当）；history GET ~9ms。**单机、AI 访问频率（非真人并发）量级完全够用**。
- **history 变更 diff 结构化在录**：US status 流转（含 assigned_users/is_closed/finish_date/kanban_order）逐字段 diff + actor + 时间戳全在 `GET /history/userstory/{id}`——**FlowPlatform activity 能力的轮询兜底通道成立**（webhook 主 + history 兜底，与 docs/23 游标语义对齐的素材已备）。
- 待适配器期核定：`x-pagination-count: 0` 语义与翻页口径；「每公司数百单」全量重放代价（本次仅 100 单 lite）；**issue↔US 横向关联是否存在**（§7-3 原问，未测——links 能力定版前必须补）。

## 五、对决策的影响（不改推荐，改走法）

1. **推荐维持 Taiga**（docs/30 §5）：七能力全部有真实 API 落点，onboard 全链 API 可达（唯一非 API 缝 = 邀请 token 从容器日志取；若坚持纯 API，可退「临时开窗注册」或预建账号池——docs/30 §7-1 预案二）。
2. FlowPlatform-Taiga 适配器切片的**任务书素材已齐**：端口七能力 → 端点映射 + 签名验签 + history 兜底 + 角色收窄闸（⑤ permissions 数组）。
3. §7 清单状态：**1-4 已答**（本报告）；5-9（Plane/Tuleap/Redmine/GitLab）非本机可测，维持档案级待办。

## 六、待制作人拍板

- Taiga 试点栈是否**保留运行**（占 ~1.5GB 内存；不保留我就 `docker compose down`，数据在卷里可 `up` 复活）。
- Docker Desktop 死代理是否由你亲手清除（我不动你的全局配置）。
- 试点通过后：发 FlowPlatform-Taiga 适配器切片（platform 泳道，契约包先行不动）。
