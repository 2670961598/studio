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

## 七、补记：适配器首刀冒烟实证（2026-10-18晚，platform 泳道）

FlowPlatform-Taiga 适配器首刀（`packages/taiga`，feature/platform-taiga 分支）对运行中
试点栈做只读+写面冒烟（`test/smoke/taiga-smoke.ts`，写面 WRITE_SMOKE=1 闸门），全绿。
对 §四待核项与 docs/30 API 假设的三处**实测修正**：

| # | 事项 | 实测结论（修正前假设 → 实证） |
|---|---|---|
| 1 | `x-pagination-count` 语义（§四待核） | **已核**：`x-pagination-count`=总条数，另有 `x-paginated`/`x-paginated-by`/`x-pagination-current`/`X-Pagination-Next`；翻页用 `?page=&page_size=` 可靠 |
| 2 | 自定义属性值写端点 | **官方文档形状作废**：`POST …/custom-attributes-values/{id}` **405**；正解=先 `GET` 值对象（自动存在，含**自身独立 version**）再 `PATCH {attributes_values, version}`；值对象 version 与单实体 version 互不相干 |
| 3 | 自定义属性值读回 | **实体序列化器不回显**：by_ref/单条/列表的 `custom_attributes_values` 一律 null（即使值已写入）；读写都必须走专用值端点 |

另两处读面口径随冒烟固化：建单事件确证不进 history（轮询面 created 缺席=常态）；
评论条目 author=JWT 操作者平台账号（admin/worker-*），非工号——端口缺口已随首刀记录
（guards 无读位 / actor 语义跨实现不一致，见 `packages/taiga/src/index.ts` 头注）。
冒烟副作用：probe-co 新增 #6/#7/#8 三张冒烟单（标题自带「可删」标记，供制作人查验后清理）。

## 八、补记：onboard 写面三件 + links 真机补测（2026-10-19，platform 泳道）

onboard 刀（feature/platform-taiga-onboard）对 §四待核项与写面三件的实测答卷。
原始证据：见本地探针档案（`probe-evidence/taiga-links/`——manifest P00-P84 + 冒烟日志）。

**links 关联模型五结论**（§四「issue↔US 横向关联是否存在」的最终答案）：

| # | 结论 | 要点 |
|---|---|---|
| 1 | ref 是**项目级全局序列** | US/issue/epic/task 连号（9→10→11→12→13-15）；TicketId 跨实体不撞号，但 issues 面按单实体集合寻址 |
| 2 | epic↔US **API 不可挂接** | relateduserstories 系端点全 404；PATCH US {epics} 字段被静默忽略 |
| 3 | US→task 派生链**全通** | POST /tasks {user_story} + GET /tasks?user_story= 过滤——唯一 API 可写从属链 |
| 4 | issue 生成链**只读不写** | generated_from_* 在 POST/PATCH 均被静默丢弃、过滤参数不生效；UI 专属动作 |
| 5 | 横向关联（relates/depends）**无模型** | relations 端点 404；未知 PATCH 字段被忽略 |

适配器落面（`packages/taiga/src/links.ts`）：children(userstory)=派生 task 链读、
children(issue)=生成链客户端过滤（恒空）；link() 三型显式 `links-unsupported` 报错
（含 issues.create/setField 的 parent 维）——真实可支持的才落，不支持面不装懂。

**onboard 写面三件端点形状修正/确认**：

| 面 | 实测形状 |
|---|---|
| fields.provision | 状态/属性 POST {project, name[, type]} 201；**重名 400**（Duplicated name / Already exists one with the same name）→ 幂等必须 GET-first；type 参数生效（number 建档成功） |
| kb.upsert | PATCH /wiki/{id} **必须带页自身 version**（缺/错均 400）；POST 重复 slug 400 __all__ → 先探测后建；**wiki slug 不允许斜杠和点**（Django SlugField）——首刀「slug 允许斜杠」假设作废，落地为 path 折平映射（'/'、'.'→'-'，尾缀 .md 先剥） |
| guards | PATCH /roles/{id} {permissions} 200 整角色回显，**无 version**；install=modify_{entity} 收窄（只收窄不放宽、diff 写、幂等零 PATCH）；uninstall=拆闸全员放开（非恢复出厂，语义已在 guards.ts 头注明示） |

**onboard 两跑幂等冒烟**（WRITE_SMOKE=1，test/smoke/taiga-onboard-smoke.ts）：
第一跑 5 写（1 wiki + 4 roles 收窄）→ 第二跑 **0 写**、两跑指纹一致 → 全绿。
单测面：FakeTaiga 按真机响应形状扩写面桩，包内 8 套 77 用例全绿。

## 九、补记：出厂态根治 S0 真机源码复核（2026-10-20，DEV-49 / docs/52-§十）

docs/52-§十 A1/A3 两处「形状待 S0 真机复核」的答卷。取证方式：**只读**检视
localhost:9000 实例背后的 taiga-back 容器内 Django 源码（读 `taiga/projects/
{models,serializers,api,validators}.py` 与 `taiga/projects/mixins/on_destroy.py`）
——零写操作、零凭据（API 匿名面 401，源码即形状真源）。

**A1 形状确认：项目默认态可 PATCH**（docs/52-§十 A1 的端点形状）：

| 面 | 源码证据 |
|---|---|
| 读位 | `ProjectSerializer` 暴露 `default_epic_status`/`default_us_status`/`default_task_status`/`default_issue_status`，值=状态内部 id（`Field(attr="default_us_status_id")`）——`GET /projects/by_slug` 即回显四字段 |
| 写位 | `ProjectValidator`= ModelValidator(model=Project)，read_only 仅 created_date/modified_date/slug/blocked_code/owner——四默认态字段可写，`PATCH /api/v1/projects/{id}` 生效（taiga-front ADMIN>Default Values 同路） |

**A3 形状定版：DELETE 出厂态必须带 `?moveTo=<状态id>`，引用**不阻塞**而是自动迁移**
（docs/52-§十 A3「前置条件待 S0：无引用才可删」的答案=**无此前置条件**）：

`MoveOnDestroyMixin.destroy` 逐实体挂接（api.py UserStoryStatusViewSet 等，
`move_on_destroy_related_field="status"`）：

1. `moveTo` 查询参数**必填**——缺失即 400（`Query param 'moveTo' is required`）；
2. 引用单据**先行迁移**：被删状态上的单全部改挂 moveTo 目标（不是拒删、
   不是级联删）；
3. 项目默认值联动：被删状态若正是 `default_us_status` 等 → 默认值**改指 moveTo**；
4. 全程事务包裹——删除失败（非 204）则迁移与默认值改指**原样回滚**。

对 DEV-49 的含义：A2 归化在前、A3 删除在后时，`moveTo=收件态` 恰与 A2 目标同值
——扫描与删除之间的竞态新建单（仍落旧默认态）被 moveTo 兜底迁进声明集，语义
与 A2 完全同构（「任何路径建单都落公司声明集内」）。快照先行（roles 快照同款
先例）仍保留：删除不可逆，入档后行。
