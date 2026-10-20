# 21A · Synapse 部署手册（部署侦察与设计稿——**未部署**）

> 2026-10-16 ｜ IM 泳道工兵侦察产出。依据：`docs/21-协作通讯-Matrix.md`（§二 频道结构、§四 唤起集成、
> §五 本机部署定调）、`docs/25-端口与协议.md`（§3.4 invoke / §4.2 notifier）、`docs/22-唤起源与解耦.md`、
> `docs/04-§四`（账号=等级锚点）、`packages/matrix` v0.1 现状。
>
> **性质与纪律**：本文件是部署前的侦察与设计，**未安装任何软件、未起任何容器、未碰任何网络端口**。
> 仓内旧系统（`<旧根>`——沿 26 号文档记法，绝对路径见本地探针档案）与旧 YouTrack 一概未动——§〇 的旧容器信息为只读观察所得，
> 凭证值一律脱敏不入库（纪律六：密钥永不入库）。不确定处标「待验证」。

---

## 〇、现状发现（先读——影响全篇结论）

### 0.1 本机已有一个运行中的 Synapse（旧系统）

只读侦察（`docker ps` / `docker inspect` / `homeserver.yaml` 只读查看）发现：

| 项 | 观察结果 |
|---|---|
| 容器名 / 镜像 | `matrix-synapse` / `ghcr.io/element-hq/synapse:latest` |
| 端口 | `127.0.0.1:8008->8008`（21-§五 拟定的端口**已被占用**） |
| 数据目录 | `<外置盘>/matrix/synapse-data`（挂载到容器 `/data`；`<外置盘>`＝外置数据盘挂载点，由部署环境自定，下同）——与 21-§五「数据在外置盘」定调一致 |
| server_name | `localhost`——与 21-§五「@<工号>:localhost」约定一致 |
| 数据库 | **SQLite**（`/data/homeserver.db`，含 WAL 文件） |
| 注册 | `enable_registration: false` + 已配 `registration_shared_secret`（值已脱敏） |
| 联邦 | 监听资源含 `federation`，`trusted_key_servers` 含 matrix.org；但宿主侧未发布 8448 端口（纯 127.0.0.1:8008） |
| 重启策略 | `unless-stopped`；无 compose 项目标签（疑为 `docker run` 直起） |

**推论**：21-§五 所述「Synapse 绑 127.0.0.1:8008」在旧系统上已存在。新框架面临两个选项（详见 §二）：
**A. 复用旧实例**（零部署，但新框架 IM 与旧系统共用一个事实源，违反隔离直觉）；
**B. 新框架独享新实例换端口**（推荐起点，隔离干净，见 §2.1）。

### 0.2 本机端口占用扫描（2026-10-16 只读快照）

| 端口 | 占用者 | 与本手册关系 |
|---|---|---|
| 8080 | youtrack 容器（旧） | 避开（21-§五 之外的对齐项） |
| 8008 | **旧 matrix-synapse 容器** | 新实例**不可用**，见 §2.1 |
| 4399-4400 等 | 游戏（旧） | 避开 |
| 8787 | 新框架监控面板 | 避开（8788/8789 当前空闲，预留 api/公司概览） |
| 5432 | 本机原生 postgres 进程（127.0.0.1+[::1]） | §5.3 存储选型的现成选项 |
| **8448** | **空闲** | 纯内网方案不监听联邦端口，保持空闲 |
| **18008 / 8009** | 空闲 | 新实例候选端口 |

---

## 一、部署形态选型对比（只调研，未安装）

| 形态 | 资源占用（本机 Mac mini 场景） | 维护面 | CS API 兼容度 | 注册流复杂度 | 2026 维护状态 | 结论 |
|---|---|---|---|---|---|---|
| **Synapse · docker 单容器** | idle 约 200-500MB（小实例实测口径），SQLite 下单容器即可 | 镜像升级=换 tag；配置一个 yaml；官方多架构镜像含 linux/arm64（Apple Silicon 原生，无模拟） | 参考实现，最全（login/sync/sendMessage/register/createRoom/invite/join/space/retention 全覆盖） | **shared-secret registration**：`/_synapse/admin/v1/register`（GET 拿 nonce → HMAC-SHA1 → POST），非交互、可全自动批量开户 | 活跃（element-hq/synapse，PyPI 2026-10-14 仍有发版，v1.157.x 系） | **推荐**（21-§五 原定调） |
| Synapse · 系统包/原生（pip venv） | 与上同量级 | 无 homebrew formula；官方文档虽保留 macOS pip 路径但**推荐 docker/deb 而非原生**；Python 依赖+venv 自管，升级手工 | 同上 | 同上 | 同上 | 不推荐（维护面大） |
| Conduit（timokoesters/conduit） | 轻（Rust） | 上游多年低活跃 | beta，特性不全 | 同 conduwuit 族 | **基本停滞** | 排除 |
| Conduwuit | 最轻 | — | 高 | — | **2025-05-30 已归档弃维** | 排除 |
| **Continuwuity**（conduwuit 社区续作） | 最轻（Rust + RocksDB，社区实测远低于 Synapse 同规模；有「Synapse 9 人吃 4GB」的反面对照） | 单二进制/TOML 配置；镜像在 GHCR/Docker Hub 有镜像 | 高（Element 等标准客户端可用；conduwuit 的一比一续作） | `registration_token`（用户侧交互流，需客户端完成）或首启一次性 token；**非交互开户走 `--execute "users register …"` CLI**（docker exec）；无 Synapse 式 HTTP 注册 admin API | 活跃（社区驱动，2026-09 文档仍在更新） | **备胎**：资源紧张时启用；对 `client.ts` 三端点无差别兼容 |

**依据来源**（2026-10-16 检索）：

- Synapse 维护状态与镜像：<https://github.com/element-hq/synapse>、<https://pypi.org/project/matrix-synapse/>、<https://hub.docker.com/r/matrixdotorg/synapse>（多架构含 arm64）、<https://element-hq.github.io/synapse/latest/setup/installation.html>（原生安装含 macOS 前置，但官方推荐 docker）
- SQLite 支持口径：<https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html>（默认 SQLite、「不推荐生产使用」长期警告，未见移除时间表）与 <https://element-hq.github.io/synapse/latest/upgrade.html>
- shared-secret 注册协议：<https://matrix-org.github.io/synapse/v1.66/admin_api/register_api.html>（GET nonce → mac=HMAC-SHA1(secret, nonce\0user\0password\0(not)\ admin\0(0|1)) → POST；实现时以官方文档字节口径为准）
- 资源量级对照：Synapse 小实例 200-500MB idle / 大房间易爆内存（r/selfhosted 实测、GitHub issue #7339、单板机官方指南 <https://matrix-org.github.io/synapse/latest/other/running_synapse_on_single_board_computers.html>）；Continuwuity 轻量对照 <https://blog.elest.io/self-host-continuwuity-a-lightweight-matrix-homeserver>
- conduwuit 归档与续作：<https://www.reddit.com/r/selfhosted/comments/1jxc1rb/conduwuit_is_archived>、<https://edu4rdshl.dev/posts/about-to-leave-matrix-oh-wait-there-s-conduwuit>、<https://github.com/continuwuity/continuwuity>
- Continuwuity 部署/配置/管理：<https://continuwuity.org/deploying/docker>、<https://continuwuity.org/reference/config>（`allow_registration`/`registration_token`/`allow_federation`/RocksDB）、<https://continuwuity.org/reference/admin/users>（`users register` CLI 非交互）

**一句话结论**：默认 **Synapse docker 单容器**（21-§五 原定调成立：注册流可全自动、CS API 最全、
活跃维护、arm64 原生）；Continuwuity 留作资源不够时的轻量备胎，conduit/conduwuit 已死不入册。

---

## 二、目标拓扑草案

### 2.1 端口与实例归属（决策点 D1）

| 方案 | 描述 | 代价 | 建议 |
|---|---|---|---|
| **A. 复用旧实例（8008）** | 新框架网关 bot 直连既有 `matrix-synapse` | 零部署；但新旧共用一个事实源，账号/频道混杂，旧系统纪律上「一概不碰」被侵蚀 | 谨慎——仅制作人明示接受共用时选 |
| **B. 新实例独享（推荐）** | 新容器绑 **127.0.0.1:18008**（备选 8009），数据目录 `<外置盘>/matrix/sn/`（与旧 `synapse-data` 并列隔离）；**不监听 8448**（纯内网无联邦，§5.2） | 一次部署成本 + 一份常驻内存 | **推荐** |

端口避让核对：18008/8009 均空闲；避开 8080（旧 YouTrack）、4399 系（游戏）、8787-8789（新框架面板/api/公司概览）、8008（旧 synapse）、5432（本机 postgres）。8448 保持不监听。

### 2.2 单用户目录模式（账号=等级锚点）

- **单一 homeserver、单租户**：所有用户注册在同一 `server_name: localhost` 下；不开 guest、不开自助注册
  （`enable_registration: false`），**唯一开户入口 = shared-secret 注册 API（仅框架持有）**——与 21-§五
  「注册用 shared secret（仅框架持有）」一致。
- **账号=等级锚点映射**（21-§五「每 agent 工号一个 Matrix 账号」+ 04-§四 Hub 实测的锚点集）：
  - Matrix localpart = **工号小写化**：`AGENT-3` → `agent-3`、`PRIME-0` → `prime-0`、制作人 `opengames` 原样。
    依据：Matrix 规范 MXID localpart 仅允许 `a-z 0-9 . _ = - / +`（大写不在语法内，Synapse 注册会拒）——**大写工号与
    小写 localpart 的映射规则需网关统一**（@唤醒解析仍按大写工号词 `@AGENT-3`，`displayname` 设工号原文，
    见 §3.2 与 §5.9）。
  - 等级锚点即账号集合：`opengames`（制作人，最高级锚）+ `agent-1..9`（等级锚，04-§四）+ 各公司实际工号账号；
    账号目录与公司目录 `departments/<部门>/people/<工号>.md` 一一对应，**Matrix 不新增组织语义**（组织事实源仍是公司 git 目录）。（勘误 2026-10-17：实形为 departments/<部门>/people/<工号>.md——04-§二）
  - **网关 bot 一个管理账号**（如 `studio-gateway`，shared-secret 流注册时 `admin: true`），代发消息与署名
    按 21-§三。

### 2.3 注册流选型：shared-secret registration vs registration token

| 项 | shared-secret registration（Synapse） | registration token |
|---|---|---|
| 形态 | homeserver.yaml 配 **`registration_shared_secret`**；HTTP `/_synapse/admin/v1/register`：GET 拿一次性 nonce → 本地算 HMAC-SHA1 → POST（username/password/admin/mac） | Continuwuity 的 `registration_token`（静态 token）/`registration_token_file`；或 Synapse 侧无此默认形态 |
| 交互性 | **非交互、可全自动**（脚本/网关直接开户） | 用户侧流程：需客户端在 `/register` 里带 token 走交互流 |
| 适配 | 契合「agent 账号随公司目录批量开户」的框架场景 | 契合「人自服务注册」，与本仓场景不合 |
| 备注 | 任务书原文「registration_shared_token」在 Synapse 无此配置键——**实际键名是 `registration_shared_secret`**；token 形态是 Continuwuity 的配置（已按实际键名落文档） | — |

**结论**：Synapse + `registration_shared_secret`（HTTP 自动开户）为主；token 流不采用。

### 2.4 公司空间/频道结构落法（对齐 21-§二）

- 每公司一个 **space**（`POST /createRoom` 携带 `type: "m.space"`、`visibility: "private"`，
  子频道以 `m.space.child` state 挂接）：
  ```
  space: <公司名>（private）
  ├── #<slug>-hall      显示名「<公司slug>-大厅」  ← 广播/通知（21-§二）
  ├── #<slug>-alert     显示名「<公司slug>-告警」  ← critical 通道（21-§四/19-§六）
  ├── #<slug>-<部门slug> 显示名「<公司slug>-<部门>」← 每部门一个
  └── #<slug>-<单号>     临时频道，关单即归档      ← 房间保留只读
  ```
- **别名（alias）落法**：Matrix 规范房间别名 localpart 同样仅允许 `a-z 0-9 . _ = - / +`——
  **`#<slug>-大厅` 这类 CJK 别名预计被 Synapse 拒绝（待验证）**；落法为 **alias 用 ASCII（`-hall/-alert/-<部门slug>`）、
  显示名（room name）承载中文原文**。channel 语义按 25-§3.4 v1.3 裁决为不透明标识（alias/id 皆可，注册时声明）。
- 全公司级 `#studio-全体`：挂在框架自有 space，慎用（21-§二）。
- 「关单归档=房间只读」：Matrix 无原生只读房间，落法为调 power_levels 禁普通成员发消息（**待验证**实现细节）。
- 一频道一公司：mention 源按「频道→公司」绑定表解析（25-§3.4 v1.3 裁决 2），跨公司消息不产意图。

---

## 三、与 packages/matrix 的对接清单

`packages/matrix/src/client.ts`（v0.1）现支持：`login`（m.login.password）、`sendMessage`
（m.room.message）、`sync`（since/timeout，轮询节奏在 adapter.ts：3s 轮询+指数退避封顶 60s）。
部署后需按下表补齐（升级路径已在包 README 留痕：「client.ts 逐个补端点，纯核心不动」）：

| # | 能力 | 端点 | client 现状 | 部署后归属 |
|---|---|---|---|---|
| 1 | 密码登录 | `POST /_matrix/client/v3/login` | **已有** | — |
| 2 | 发消息 | `PUT /_matrix/client/v3/rooms/:id/send/m.room.message/:txnId` | **已有** | — |
| 3 | 增量同步 | `GET /_matrix/client/v3/sync` | **已有** | — |
| 4 | 开户（shared-secret） | `GET+POST /_synapse/admin/v1/register`（nonce+HMAC-SHA1） | **需补** | 首选做成**引导脚本**（一次性），client.ts 补可选 `register()` 亦行 |
| 5 | 建房间/建 space | `POST /_matrix/client/v3/createRoom`（含 `type: "m.space"`、`room_alias_name`、`preset`） | **需补** | 引导脚本 + client.ts `createRoom()` |
| 6 | 邀请 | `POST /_matrix/client/v3/rooms/:id/invite` | **需补** | 同上 |
| 7 | 加入 | `POST /_matrix/client/v3/rooms/:id/join`（或 `/join/:alias`） | **需补** | 同上；v0.1 `SyncResponse` 未建模 invite 状态，bot 不需消费 invite |
| 8 | alias→room_id 解析 | `GET /_matrix/client/v3/directory/room/:alias` | **需补**（README 已留痕） | client.ts；notifier 的 channel 语义升级前提 |
| 9 | space 挂接子频道 | `PUT /_matrix/client/v3/rooms/:id/state/m.space.child/:child` | **需补** | 引导脚本 |
| 10 | whoami / logout（token 治理） | `GET /account/whoami`、`POST /logout` | **需补（可选）** | daemon 凭证管理切片 |

说明：#4-#9 是**首次引导**（生成账号→建 space→建频道→邀请→join→产 bot token）的最小端点集；
运行期（Notifier send + mention 源轮询）只依赖已有的 #1-#3——即 v0.1 网络层部署后即可跑通 21-§六 验收口径 1/3
（问答留痕、critical 告警），验收口径 2（制作人一句话落单）走 mention 源亦不缺端点。

---

## 四、部署脚本草案（**不执行**，随运维切片过批后用）

### 4.1 docker-compose.yml 样例（B 方案：新实例 18008）

```yaml
# <外置盘>/matrix/sn/docker-compose.yml（草案）
services:
  synapse:
    image: ghcr.io/element-hq/synapse:v1.157.x   # 锁 tag，禁 latest（升级走批示）
    container_name: sn-synapse                   # 与旧系统 matrix-synapse 区分
    restart: unless-stopped
    ports:
      - "127.0.0.1:18008:8008"                   # 仅本机回环；8448 不发布（无联邦）
    volumes:
      - <外置盘>/matrix/sn/data:/data    # 21-§五：数据在外置盘，与旧 synapse-data 隔离
    environment:
      - SYNAPSE_SERVER_NAME=localhost
      - SYNAPSE_REPORT_STATS=no
  # 存储选 Postgres 时追加（§5.3 决策点 D2）：
  # postgres:
  #   image: postgres:16
  #   restart: unless-stopped
  #   environment: { POSTGRES_USER: synapse, POSTGRES_DB: synapse, POSTGRES_PASSWORD: "<密钥注入，不入库>" }
  #   volumes: [ "<外置盘>/matrix/sn/pg:/var/lib/postgresql/data" ]
  #   # 不发布端口：仅容器网络内可达，避开本机 :5432
```

### 4.2 homeserver.yaml 最小配置注解（对齐 21-§五 各要点）

```yaml
# <外置盘>/matrix/sn/data/homeserver.yaml（草案；由 generate 生成后手改，注解=21-§五 依据）
server_name: "localhost"            # 21-§五：@<工号>:localhost
pid_file: /data/homeserver.pid
listeners:
  - port: 8008
    bind_addresses: ['0.0.0.0']     # 容器内全接口；宿主侧由 compose 收口到 127.0.0.1:18008
    tls: false
    type: http
    resources:
      - names: [client]             # 只留 client 资源——federation 资源不监听（§5.2）
database:
  name: sqlite3                     # 或 postgres（§5.3 D2）；SQLite 起步注解见风险节
  args: { database: /data/homeserver.db }
log_config: /data/localhost.log.config
media_store_path: /data/media_store

registration_shared_secret: "<openssl rand -hex 32 生成，密钥永不入库>"   # 21-§五：仅框架持有
enable_registration: false          # 自助注册关死，开户只走 shared-secret admin API
enable_registration_without_verification: false

# —— 纯内网联邦处置（§5.2，两处缺一不可；行为待验证）——
# trusted_key_servers: []           # 移除默认的 matrix.org（不做任何出站 key 查询）
# federation_domain_whitelist: {}   # 空白名单=阻断出站联邦（待验证当前版本口径）

# —— 频道历史保留 90 天（21-§五；retention 语义待验证）——
# retention:
#   enabled: true
#   default_policy: { max_lifetime: 90d }
#   purge_jobs:
#     - { longest_max_lifetime: 3d, interval: 1d }

signing_key_path: /data/localhost.signing.key
macaroon_secret_key: "<generate 产出，不入库>"
form_secret: "<generate 产出，不入库>"
```

### 4.3 首次引导步骤（顺序即脚本骨架）

1. `mkdir -p <外置盘>/matrix/sn/data && docker compose run --rm synapse generate`
   ——生成 homeserver.yaml / 签名密钥 / 日志配置；
2. 按 §4.2 注解改配置、生成并填入 `registration_shared_secret`；
3. `docker compose up -d`；
4. **开户**（shared-secret 流，示意；字节口径以官方文档为准）：
   ```sh
   nonce=$(curl -s http://127.0.0.1:18008/_synapse/admin/v1/register | jq -r .nonce)
   mac=$(printf '%s\0%s\0%s\0%s\0%s' "$nonce" "$USER" "$PASS" "$ADMINFLAG" '0' \
         | openssl dgst -sha1 -hmac "$SHARED_SECRET" | awk '{print $2}')
   curl -s -X POST http://127.0.0.1:18008/_synapse/admin/v1/register \
        -H 'Content-Type: application/json' \
        -d "{\"nonce\":\"$nonce\",\"username\":\"$USER\",\"password\":\"$PASS\",\"admin\":$ADMINBOOL,\"mac\":\"$mac\"}"
   ```
   顺序：先 `studio-gateway`（admin）→ 再各 agent 工号账号（§2.2 小写映射）；
5. **建 space 与频道**（bot 登录后按 §三 #5-#9 逐个 `createRoom`→`invite`→`join`→挂 `m.space.child`，
   alias 按 §2.4 ASCII 落法）；
6. **产 bot token**：bot `login` 得 `access_token` → 交 daemon 密钥管理（环境变量/钥匙串；
   **不落日志/台账/公司目录**，21-§五安全条款；client v0.1 凭据仅进程内存、重启重登——生产前需 daemon 侧
   持久化切片，包 README 已留痕）；
7. 验收对跑：跑 packages/matrix 既有 35 例测试 + 21-§六 三条验收口径。

---

## 五、风险与开放问题

| # | 风险/问题 | 分析 | 处置建议 |
|---|---|---|---|
| 5.1 | 复用旧实例 vs 新实例 | §0.1：8008 已被旧 `matrix-synapse` 占用；复用=新旧共用事实源，违背「旧系统一概不碰」的隔离纪律；新实例=一份常驻内存+一次部署 | **D1 待拍板**：默认 B（新实例 18008） |
| 5.2 | federation 关闭（纯内网） | 不监听 8448 + client-only 监听资源即无入站联邦；出站侧需 `trusted_key_servers: []` + `federation_domain_whitelist: {}` 双保险——**空白名单阻断出站的口径待验证**（旧实例两项都没做，仅靠不发布 8448）。`server_name: localhost` 非全局唯一，仅在无联邦前提成立 | 按上双保险落； Continuwuity 备胎则原生 `allow_federation=false` |
| 5.3 | SQLite vs Postgres | Synapse 官方对 SQLite「不推荐生产使用」为**长期警告、无移除时间表**；本机规模（≈12 账号、部门级小房间、3s 轮询、90 天保留）远低于其痛点区（痛点=大联邦房间高并发）；本机另有原生 postgres :5432（属旧系统环境，共用有踩踏风险）与「compose 内独立 postgres 容器」两选项；SQLite→Postgres 有官方迁移脚本 | **D2 待拍板**：建议 SQLite 起步（与旧实例同路线，已在本机验证可行），量大再迁 Postgres 容器（不动 :5432） |
| 5.4 | macOS docker desktop 依赖 | docker daemon 在 macOS 上=虚拟机常驻（内存/自启）；旧实例已证明本机 docker 路径可用；colima/OrbStack 等轻替代**待验证**；另 Synapse 原生 pip 路径维护面大（§一） | 沿用既有 docker desktop；colima 预研列为可选项（D3） |
| 5.5 | 与 launchd 看护的关系 | daemon（Node）由 launchd 看护重启；synapse 容器归 docker `restart: unless-stopped`——**两套看护互不代管**；matrix 挂→告警通道同时挂（自指） | daemon 侧加 matrix 健康探针（sync 冒烟）；matrix 不可达时告警**回退面板置顶**（19-§六 通道优先级本就面板在前）；不把容器生命周期并入 daemon |
| 5.6 | token 持久化缺位 | client v0.1 凭据进程内存态、重启重登；bot 每次重启 login 亦可接受（password 也在密钥管理里），但登录失败=IM 全断 | 生产前做 daemon 密钥管理切片（README 已留痕升级路径） |
| 5.7 | E2EE | v0.1 明文房间（README 已声明依赖本机未加密部署）；内网+无联邦下可接受；建房间时**不得开加密**（`encryption: false`） | 维持明文；如需再评估 vodozemac |
| 5.8 | 90 天保留 | retention 配置+purge job 属 Synapse 可选模块，与「关单归档」并存的两套清理语义要分清（retention=时间维度、归档=单据维度）；**配置口径待验证** | 部署时实测 retention 生效行为后再冻结 |
| 5.9 | 大写工号 vs 小写 localpart | MXID 语法限小写（§2.2），`@AGENT-3` 唤醒词与 `agent-3` 账号并存：mentions.ts 解析的是**消息文本**（默认样式只认大写工号），displayname=工号原文，映射规则需网关组装侧一致 | 冻结「localpart=工号小写、displayname=工号原文、唤醒词=大写工号」三线约定 |
| 5.10 | 幂等键 | 25-§3.4 v1.3：mention 意图 dedupKey=Matrix eventId，单实例事件 id 全局唯一，天然满足 | 无动作，登记即可 |

---

## 六、待制作人拍板（汇总）

1. **D1 拓扑**：A 复用旧 8008 实例（新旧共用）还是 B 新实例 `127.0.0.1:18008`（本手册默认推荐 B）；
2. **D2 存储**：SQLite 起步（推荐）还是直接上 compose 内 Postgres 容器；
3. **D3 容器运行时**：沿用 docker desktop（推荐）还是预研 colima 轻替代；
4. **D4 备胎**：Continuwuity 是否值得在资源紧张前先做一轮兼容性预演（对 client.ts 无差别，成本=一次部署演练）；
5. **D5 bot 凭证托管位置**：daemon 环境变量 / macOS 钥匙串 / 其他（21-§五「凭证不落日志/台账」的落点）。
