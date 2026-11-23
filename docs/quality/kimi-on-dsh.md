# Kimi 3.1 Pro 上 DSH（provider `kimi-coding`）——设计与启用步骤

状态：设计单＋实现说明（2026-11-23）。代码面（刷新器/注入面/白名单/测试）随本单落地；
**启用面（models.yaml / daemon.yaml / agent.yaml）只写 apply 步骤，不改生产配置**。
关联单：`docs/quality/model-routing.md`（多源路由）、`docs/quality/tier-executors.md`（task-100
档位执行器映射与 0 边际成本口径）、`docs/quality/provider-key-policy.md`（§5 封闭枚举/§6 seed
白名单）、docs/25-§二（TaskBrief v1.4 credentials 冻结语义）、docs/31-§3.5（dsh 凭据优先级）。

## 0. 结论

- high 档模型供给从「Kimi CLI executor（独立进程、自带 OAuth）」迁到「DSH executor + pi-ai
  `kimi-coding` provider（`api.kimi.com/coding`，模型 `k3.1-pro` / `k3.1-pro-highspeed`）」。
- 凭据不复用 Kimi CLI 的 OAuth 会话管理，改为：**刷新器**（`scripts/ops/kimi-token-refresh.mjs`，
  直连 `auth.kimi.com` token 端点）把 access token 原子写进
  `~/Library/Application Support/StudioNext/secrets/kimi-access-token`（0600，内容仅 token）；
  **daemon 在 dispatch 前**读该文件、经 TaskBrief.credentials（v1.4 env 通道）注入
  `KIMI_API_KEY`；dsh worker 进程 env 里的 `KIMI_API_KEY` 被 pi-ai `apiKeyEnv` 拾取（进程 env
  为 dsh 凭据最高优先级，docs/31-§3.5），不落 `.env`、不进隔离 home 快照。
- 刷新器**轮换回写**：pi-ai 刷新响应必含新 refresh_token（服务器侧轮换），刷新器原子回写
  `~/.kimi-code/credentials/kimi-code.json`（保序其余字段），否则下次刷新和 Kimi CLI 双断。

## 1. 事实与依据（制作人 PoC 已验证项标 ✔）

| # | 事实 | 来源 |
|---|---|---|
| 1 | ✔ DSH 捆绑的 pi-ai 有 `kimi-coding` provider（OAuth 订阅制 + apiKey 两种 auth），base `https://api.kimi.com/coding/v1`，模型 `k3.1-pro`、`k3.1-pro-highspeed` | pi-ai `providers/kimi-coding.js`（`apiKey: envApiKeyAuth("Kimi API key", ["KIMI_API_KEY"])`） |
| 2 | ✔ 宿主 `~/.dsh/profiles/headless/cordis.patch.yml` 已配 `llm-pi-ai.config.providers.kimi-coding.apiKeyEnv: KIMI_API_KEY`；`KIMI_API_KEY=<access_token>` 时 PoC `dsh --profile headless --patch <overlay(provider kimi-coding/model k3.1-pro)> --json -- "只回复两个字：可用"` exit 0 且输出「可用」 | 制作人 PoC（HEAD 提交记录） |
| 3 | OAuth：token 端点 `POST <oauthHost>/api/oauth/token`，form 表单 `client_id` + `grant_type=refresh_token` + `refresh_token`；响应 JSON 须含 `access_token`/`refresh_token`/`expires_in`（秒）；`expires_in=900`（**15 分钟**）；`KIMI_CODE_OAUTH_HOST`/`KIMI_OAUTH_HOST` 可覆盖 host（缺省 `https://auth.kimi.com`） | pi-ai `auth/oauth/kimi-coding.js` |
| 4 | 凭据库存于 `~/.kimi-code/credentials/kimi-code.json`（0600；字段 `access_token`/`refresh_token`/`expires_at`（epoch 秒）/`scope`/`token_type`/`expires_in`） | 实测形状（只验键与类型，未读值） |
| 5 | dsh 的 `apiKeyEnv` 供给路径**无动态刷新**（「Catalog-owned dynamic refresh is dropped」）——env 值在 worker 进程生命周期内静态使用 | dsh `dsh-llm-pi-ai` 源码注释 |
| 6 | 路由机制：models.yaml `tiers.<t>.sources[]`（id/provider/model/priority/price/cooldown）→ `selectRouted` → `provisionSourceOverlay`（`dsh-tier-<tier>--<id>.yml`：agent-default-model 补丁）→ launch；同 dispatch 一次换源 | `apps/daemon/src/engine/routing/`（task-56/135） |
| 7 | 档位执行器映射现值 `{"high":"kimi","mid":"dsh","low":"dsh"}`（生产 daemon.yaml）；多执行器注册名含 `dsh`/`dsh-mid`/`dsh-high`/`dsh-low`（workbench-dev） | 生产配置（本单不改） |

## 2. 供给面：provider / model / 价目

models.yaml high 档新增 source（**apply 步骤，见 §6；生产文件本单不动**）：

```yaml
tiers:
  high:
    sources:
      - id: kimi-pro                # 本单新增：Kimi 订阅制（kimi-coding provider）
        provider: kimi-coding
        model: k3.1-pro
        priority: 5                 # 优于 glm-main(10)/go-dsflash(20)——high 档首选
        price: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheCreationPerM: 0 }
        cooldown: { baseMs: 60000 }
```

价目口径（同 tier-executors.md task-100 的 Zcode 订阅制先例）：Kimi For Coding 为订阅制，
**边际成本记 0、unpriced/unbilled**——台账照常记 usage tokens，cost.usd=0；不改契约/事件词。
备注写在 models.yaml 注释行：`# Kimi 订阅制边际成本 0——unpriced/unbilled（tier-executors task-100 口径）`。

失败兜底：kimi-pro 异常（AUTH/429/5xx/网络）→ 路由冷却 60s + 同 dispatch 换源 →
glm-main（priority 10）继续承载 high 档——两源交叉结构与现行 high 档语义一致（model-routing.md §3/§4）。

## 3. 凭据链与刷新器（`<repo>/scripts/ops/kimi-token-refresh.mjs`）

链路：`kimi-code.json(refresh_token)` → 刷新器（直连 OAuth，**不经 kimi CLI**）→
`secrets/kimi-access-token`（0600，内容仅 token 单行）＋回写 `kimi-code.json`（轮换）。

CLI 契约（测试冻结面，`scripts/test/kimi-token-refresh.test.mjs`）：

- `--once`：刷新一次并落盘；缺省无参=usage 说明并退出码 2（用法错）。
- `--dry-run`：**预检**（零副作用）——校验参数与凭据库（可读/含 refresh_token），**不发请求、
  不写文件**。刻意不打网：每次刷新请求都会在服务器侧轮换 refresh_token，丢弃响应=存档
  refresh_token 作废（kimi CLI 与刷新器双断）。真机验证直接跑 `--once`（原子且失败不动盘）。
- 路径/端点覆盖：`--credentials <file>` / `--out <file>` / `--oauth-host <url>`；env
  `KIMI_CREDENTIALS_FILE` / `STUDIO_KIMI_TOKEN_FILE` / `KIMI_CODE_OAUTH_HOST`（次序：
  旗标 > env > 缺省）。测试旋钮 env：`KIMI_REFRESH_BACKOFF_BASE_MS`、`KIMI_REFRESH_MAX_ATTEMPTS`。
- 退出码：0=成功；1=失败（凭据死/坏响应/网络不可达——重试 3 次退避 1s/2s/4s 后仍败）；
  2=用法错。
- **不打印 token**：stdout/stderr 只出现路径、状态码、`expires_in`、错误分类；
  `invalid_grant`/401/403 → 明报「refresh token 已失效——需人工 `kimi login` 重登」，不重试。
- 原子写（两处）：tmp（同目录、0600）→ rename；token 文件内容 `<access_token>\n`；
  credentials 回写合并字段（`access_token`/`refresh_token`/`expires_at`=now+expires_in（epoch 秒，与
  kimi CLI 现形状一致）/`expires_in`），其余字段（scope/token_type）原样保留。
- 刷新失败时两个文件**都不动**（旧值保命）。

运维位：人工 `node scripts/ops/kimi-token-refresh.mjs --once`，或 daemon dispatch 按需刷新（§4）。
**二选一即可，不要另叠加外部定时刷新**（refresh_token 轮换下并发刷新自找竞态，见 §9-2）。

## 4. daemon 注入面（代码已落地）

落点：`apps/daemon/src/engine/dispatch/kimi-token.ts` ＋ `execute.ts` 装配位 ＋ serve 注入面
`apps/daemon/src/assembly/serve/kimi-token/kimi-token-face.ts`（EngineDeps.kimiToken，缺省=纯读模式；
serve/ 直属文件已满阈 25，新面按 §十五.三.1 切子域 `serve/kimi-token/`——同 root-delegation 先例）。
施工顺带零行为拆件：runtime.ts 的 notify 装配段（600 满行无余量）迁出
`apps/daemon/src/assembly/serve/notify/notify-face.ts`（20-§十五.三「先拆再增」，原段零漂移）。

- **触发条件**：本次 dispatch 选中源 `provider === 'kimi-coding'` 且执行器注册名 `dsh` 或
  `dsh-*`（tierExecutors high→dsh 后成立；现行 high=kimi 时零行为）。
- **读取**：dispatch 前**现读** token 文件（每次 launch 前最新，不缓存跨拍）；缺省路径
  `~/Library/Application Support/StudioNext/secrets/kimi-access-token`，env
  `STUDIO_KIMI_TOKEN_FILE` 覆盖（serve 面与刷新器同名 env，保证同一路径源）。
- **按需刷新**（serve 注入面）：文件缺失或 mtime 龄 > 240s（`KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT`
  ——保证 launch 时 token 余量 ≥11 分钟）→ spawn
  `node <repo>/scripts/ops/kimi-token-refresh.mjs --once`（40s 超时、进程内串行化防自竞态）→
  重读文件。刷新失败=回退现有（可能陈旧的）文件值；文件始终缺失=**不注入**（fail-safe，
  不抛、不阻派发——worker 以 AUTH 失败收场→路由按 auth 类冷却换源 glm-main）。
- **注入通道**：TaskBrief.credentials（v1.4：短命、按单、env 透传、值红名单——任何
  note/日志/台账永不含凭据值，同 STUDIO_TOOLS_WKEY 纪律）。execute.ts 的 launchBrief 组装改为
  `credentials = { ...wkeyCredentials?, ...kimiCredentials? }`；failover 换源后**重建** brief
  （新源非 kimi-coding 即不再注入）。
- **不改的面**：judge 微调用面冻结零凭据（judge=low 档 glm，本单不触碰）；dsh 隔离 home
  seed 白名单已含 KIMI_API_KEY（provider-key-policy §6，陈旧值会被本注入的进程 env 覆盖——
  env 优先级最高，docs/31-§3.5）。

## 5. adapter 白名单改动（`packages/adapters/src/dsh/basics.ts`）

- `ENV_KEY_ALLOWLIST`（worker env 收口，deny-by-default）**只加键名** `KIMI_API_KEY`
  （与 GLM_ZCODE_KEY/OPENCODE_GO_API_KEY 同类——供应商订阅凭据，经注入通道进 env 后须放行）。
- `CREDENTIAL_KEY_ENUM`（TaskBrief.credentials 封闭枚举）加 `KIMI_API_KEY`——枚举仍封闭，
  `DEEPSEEK_*`（官方供应商键）照旧拒收，未知键照旧 `CONFIG_INVALID/dsh/credential-key-rejected`。

## 6. 启用步骤（apply——生产文件本单不动；照抄执行）

前置（一次性，已完成 ✔）：宿主 `~/.dsh/profiles/headless/cordis.patch.yml` 已有
`kimi-coding.apiKeyEnv: KIMI_API_KEY`（事实 #2；worker 隔离 home seed 复制 profiles/headless，自动带上）。

1. 刷新器预检：`node <repo>/scripts/ops/kimi-token-refresh.mjs --once --dry-run`（零副作用：
   不发请求不写文件）；随后真刷 `node <repo>/scripts/ops/kimi-token-refresh.mjs --once`
   （原子落盘，失败两文件都不动——直接试网即真验证）
   → 期望 `ok`（刷新链路可用）；再 `--once` 真刷 → `ls -l ~/Library/Application\ Support/StudioNext/secrets/`
   （存在 kimi-access-token、0600）。
2. 最小真机探针（不派工）：
   `KIMI_API_KEY=$(cat ~/Library/Application\ Support/StudioNext/secrets/kimi-access-token) dsh --profile headless --patch <overlay：provider kimi-coding/model k3.1-pro> --json -- "只回复两个字：可用"`
   → 期望 exit 0 且输出「可用」。
3. 备份：`cp ~/.config/studio-next/models.yaml ~/.config/studio-next/models.yaml.bak-kimi-$(date +%Y%m%d-%H%M%S)`；
   `cp <companiesRoot>/<company>/daemon.yaml <companiesRoot>/<company>/daemon.yaml.bak-kimi-$(date +%Y%m%d-%H%M%S)`。
4. models.yaml：high 档 `sources:` 列表头部插入 §2 的 `kimi-pro` 条目（含 0 价注释行）。
5. daemon.yaml：`tierExecutors: '{"high":"dsh","mid":"dsh","low":"dsh"}'`（high: kimi→dsh）。
6. 重启 daemon（launchd 标签 `io.studionext.daemon`）：`launchctl kickstart -k gui/$(id -u)/io.studionext.daemon`。
7. 验证（真实单据，证据断言）：
   - 触发一张 high 档真单（verifier 类工位）；
   - 台账/面板查：DISPATCH note 含 `routing=kimi-pro`、`routing-price=in$0/out$0`；
     `work_records.model` = `kimi-coding/k3.1-pro`；cost.usd=0；
   - `grep -c KIMI_API_KEY <companiesRoot>/<company>/logs/daemon.log*` → 0（键名都不该出现）。
8. **回退**（任一步异常即回）：
   `cp <backup>/models.yaml.bak-kimi-* ~/.config/studio-next/models.yaml`；
   `cp <backup>/daemon.yaml.bak-kimi-* <companiesRoot>/<company>/daemon.yaml`；kickstart 同 6。
   （token 文件与刷新器无需回退——high=kimi 时注入面零触发；kimi CLI 自管 OAuth 随时可回。）

## 7. Kimi CLI executor 退役计划（分阶段，代码不删）

前提：§6 启用后 high 档已走 DSH+kimi-coding，Kimi CLI executor（`packages/adapters/src/kimi.ts`）
不再是唯一 Kimi 供给面。

| 阶段 | 动作 | 验收 | 回滚 |
|---|---|---|---|
| 1 观察期（≥1 周） | 不动注册。监控 high 档成功率、AUTH/429 频次（台账 routing note + MODEL_ROUTING_FAILOVER 事件） | kimi-pro 源无持续失败；换源兜底未常态化触发 | §6-8 |
| 2 标记弃用（最小面） | `packages/adapters/src/kimi.ts` 头注加「DEPRECATED：Kimi 供给迁 DSH kimi-coding（docs/quality/kimi-on-dsh.md §7）；保留注册不删代码」；注册行为零变 | typecheck/v2 绿 | 删头注行 |
| 3 撤默认位 | `<companiesRoot>/workbench-dev/agent.yaml`：`kimi.default: true → false`、`dsh.default: true`（该目录 kimi 是默认执行器）；`<companiesRoot>/studio-dev/agent.yaml`：kimi 条目随 §6 已不被 tierExecutors 引用，可整条删除（保留亦可） | workbench-dev 新单 work_records 显示 executor=dsh；Kimi CLI 30 天零派发（台账 EXECUTOR 事件统计） | 恢复 agent.yaml 备份（kimi CLI 自管凭据，即回即用） |
| 4 收尾 | 文档把 provider-key-policy.md 角色矩阵里「high=KimiCode」表述改为「high=kimi-coding via DSH」（批示流） | 文档门禁绿 | — |

不删代码、不删 `~/.kimi-code` 凭据库（refresh_token 仍是刷新器的种子，见 §3）。

## 8. 测试面（全部新 V2 位，不碰旧套红基线）

- `scripts/test/kimi-token-refresh.test.mjs`（node --test＋本地假 HTTP 服务）：成功（含轮换回写、
  原子性=无 tmp 残留、0600、stdout/stderr 无 token 值）/ 过期 invalid_grant（非零退出、文件不动）/
  坏响应（非零、文件不动）/ 网络不可达 / 5xx 重试后成功 / dry-run 预检零副作用（不打网、不落盘）/
  凭据文件缺失 / 用法错。
- `packages/adapters/test/v2/dsh-kimi-credential.test.ts`：allowlist 放行 KIMI_API_KEY（仅键）；
  credentials 封闭枚举收 KIMI_API_KEY、仍拒 DEEPSEEK_*/未知键；launch 透传后子进程可见（值只经
  回显面断言，不入断言输出）；worker env 可见键 ⊆ allowlist ∪ 框架键。
- `apps/daemon/test/v2/routing/kimi-token-injection.test.ts`：kimi-coding 源+dsh 执行器 →
  launchBrief.credentials.KIMI_API_KEY=token 值（fake adapter 捕获，不入事件流）；文件缺失/坏形状
  → 不注入不抛；非 kimi-coding 源 → 不注入；陈旧文件+刷新面 → 刷新被调、取新值；全拍事件文本
  无 token 值。
- `apps/daemon/test/v2/serve/kimi-token-face.test.ts`：serve 面 spawn 刷新器（旗标/env/超时/串行化；
  假 execFile＋一组真子进程端到端）。

## 9. 风险与不做的事

1. **15 分钟硬上限（已知限制，v2 另立单）**：`apiKeyEnv` 路径无动态刷新（事实 #5）——单次 dispatch
   的 worker 进程持有的是 launch 时刻的静态 token，**跑超 token 余量的长单必然中途 401**。本单缓解：
   按需刷新保证 launch 时余量 ≥11 分钟；中途 401 → 收割失败分类 → 冷却换源 glm-main（不阻塞公司）。
   长单根本解法（待 spike，不在本单）：把 pi-ai OAuth grant（含 refresh 字段）写入 dsh 隔离凭据
   存储，走 pi-ai 自刷新路径（dsh-llm-pi-ai 支持凭据记录存储时由其自管轮换）。
2. **refresh_token 轮换竞态**：刷新器（daemon 按需/人工）与 Kimi CLI 人工使用并发刷新时，败方
   invalid_grant。缓解：原子写不损坏文件；daemon 每次重读最新文件自愈；不叠加外部定时刷新；
   败光后明报「需人工 kimi login」。退役 Kimi CLI executor（§7）后竞态面进一步收缩。
   **推论**：`--dry-run` 刻意设计为零副作用预检（不打网）——对真凭据库「试网式 dry-run」
   会消耗一次轮换而丢弃新 token，属断链操作，已从 §6 步骤中排除。
3. **订阅制配额未知**：kimi-coding 订阅有未公开速率/用量上限——429 由路由冷却+换源兜底；
   高峰期定价 0 会让预算闸对 kimi-pro 源失去成本约束（记录 usage 不记 cost），观察期关注用量。
4. **不做**：不动 judge 零凭据冻结面；不改 provider-key-policy 冻结矩阵（§7-4 走批示流）；
   不删 KimiAdapter 代码；不写 `~/.dsh/.env`/隔离 home 种子新路径（进程 env 通道已闭环）；
   不做定时刷新 launchd 项（按需刷新已内建）。
