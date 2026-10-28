# PB-1 现状宿主差分 · 探针报告

> **头注**
> - 日期：2026-10-28（探针采集 2026-10-28T07:57Z UTC / 15:57 CST；本报告落盘 2026-10-28T08:00Z）
> - git HEAD：`32aaf2a75e3978c00fd16f13948b16dcc7de8860`（分支 `dev`）
> - 工具链/宿主：bun **1.4.3** / node **v24.21.0**（`mise exec --`）｜DSH **0.2.0-rc.2**（`dsh --version`）｜macOS **26.3** arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；IMPL-01-02 / LANE-T）
> - 性质：**只读探针，不改生产码、不写宿主 profile、不启真实模型会话、不发出站请求、不 git commit**
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §五（PRB-01..26 **唯一主表**；本批只读 PRB-01/02/03/04/05/06/22 行）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-1 批次：入口＝无前置、出口＝每行 executed/not-executed/not-applicable 判定）、`docs/plan/05-实现单拆分清单.md` IMPL-01-02
> - 口径：状态三值唯一主表 v2/12 §5.1（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；探针通过只升到「该版本该形态观察一次」，不升为能力证明（v2/12 §0.5-3）；交付方自报仅线索，须原始日志（CAP-02）。

---

## 一、批次判定口径与统计

### 1.1 口径

1. **状态只取三值**，且以 v2/12 §五 的该行原文为唯一探针定义（本报告不重定义、不加探针、不合并探针）。
2. **未跑不得写成通过**：`not-executed` 行只登记「缺什么」，不填「预期通过」（v2/12 §0.4 明确：未执行写「预期通过」＝违规）。
3. **`not-applicable` 只用于探针在本形态上结构不适用**；本批**一行都没有**用 `not-applicable` 顶替 `not-executed`——七行在本宿主形态上均适用，只是前置未满足（§四）。故 `not-applicable = 0` 是判定结果，不是遗漏。
4. **正负同验**（§5.1）：未执行行不得只声称正向；本报告对每行都写明主表要求的正/负两面为何都未取到。
5. 全部日志落在 `docs/probe/pb-1/`（§七清单）；日志为**原始命令＋原始输出＋EXIT**，仅做了一处脱敏（本机用户名/家目录 → `<user>`/`<home>`，逐行保留其余字节）。

### 1.2 状态统计（本批 7 行）

| 状态 | 行数 | 行 |
|---|---|---|
| `executed` | **1** | PRB-05 |
| `not-executed` | **6** | PRB-01、PRB-02、PRB-03、PRB-04、PRB-06、PRB-22 |
| `not-applicable` | **0** | — |

> 与 v2/17 §一 V6 行「1/26 executed（PRB-05）」对账：本批**不新增 executed 计数**（仍 1/26），但把 PRB-05 的「既有负向证据」升级为**本日同机构造复验**（§三-PRB-05）。本批**不产出任何 PASS、不产出能力结论**。

### 1.3 环境实值摘要（逐字原始输出见 `log-00-environment.txt`）

```text
HEAD=32aaf2a75e3978c00fd16f13948b16dcc7de8860（dev）
bun 1.4.3 / node v24.21.0 / mise 2026.10.11
Darwin 25.3.0 arm64 / macOS 26.3
dsh 0.2.0-rc.2（＝仓内 LOCKED_VERSION，packages/adapters/src/dsh.ts:110）
DSH_HOME=<home>/.dsh；profiles: headless, web（只列名，未读任何凭据文件）
```

---

## 二、逐行判定表（先给结论，详录见 §三）

| ID | 目的（v2/12 §五 原文摘要） | 主表现状 | **本行状态** | 证据（日志） | 未执行缺什么 / 已取到什么 |
|---|---|---|---|---|---|
| PRB-01 | DSH 插件被加载并承认（`--patch` 挂最小插件，`agent/created` 打点） | 未执行 | **not-executed** | `log-01-prb-01-host-surface.txt` | 缺：最小打点插件（现成冒烟判据形态不同）＋真实宿主会话（模型调用/出站）＋`agent/created` 采集通道；已取到：宿主 0.2.0-rc.2 与 `--patch` 启动面存在（静态） |
| PRB-02 | 工具隐藏对模型强（白名单只留一个工具，提示词要求调另一个） | 未执行 | **not-executed** | `log-02-prb-04-host-sandbox-config.txt`（配置面侦察） | 缺：工具白名单插件＋真实模型会话＋「直接 shell 调同名二进制」负向对照；无任何行为观测 |
| PRB-03 | 逐调用判定生效且可记（guard 拒某工具，拒绝事件含四态依据） | 未执行 | **not-executed** | `log-02-prb-04-host-sandbox-config.txt`（配置面侦察） | 缺：guard 插件实现＋拒绝事件采集面＋「同进程改插件应成功」负向对照；无任何行为观测 |
| PRB-04 | 写域 fail-closed（workspace-write＋域外写） | 未执行 | **not-executed** | `log-02-prb-04-host-sandbox-config.txt` | 缺：可弃 workspaceRoot＋真实会话＋域外写/符号链接逃逸写测（**写操作**）；已取到：`sandbox-policy` 配置面与缺省 `workspace-write` 回显（**配置回显≠行为证据**） |
| PRB-05 | 读域是否可收口（本 OS `sandbox-exec` 读域规则） | **executed**（既有负向） | **executed（负向）** | `log-03-prb-05-read-domain-sandbox-exec.txt`、`log-04-prb-05-repo-negative-evidence.txt` | 已取到：对照组 exit 0；三种读 deny 构造 **exit 134＝SIGABRT**；仓内既有负向证据原文（`seatbelt.ts` 头注、docs/78 §7.3） |
| PRB-06 | 网络出站未控（请求外部域名） | 未执行 | **not-executed** | `log-05-prb-06-egress-posture.txt`（仅静态面） | 缺：EX-3 执行位置＋受控/未受控对照基线＋**出站授权**；本单明确不发出站请求（§三-PRB-06 拒绝理由） |
| PRB-22 | overlay 可写性（以 worker 身份写 `<rootDir>/tmp/`） | 未执行 | **not-executed** | `log-06-prb-22-overlay-target.txt` | 缺：已 provision 的 `<rootDir>/tmp/`（本仓 `var`/`tmp`/`.AIWS` 均不存在）＋独立 worker 身份＋写操作授权；已取到：落点与权限位 0700/0600 的代码事实（静态） |

---

## 三、逐行详录

### PRB-01 · DSH 插件被加载并承认

- **主表行（v2/12 §5.3）**：目的＝DSH 插件被加载并承认；形态＝`--patch` 挂最小插件，`agent/created` 打点；正向＝打点出现＋宿主日志有加载；负向＝不挂 patch 时打点不出现；锚＝HCL-0B 宿主侧子集（不含来源核验/激活批准）；主表状态＝未执行。
- **本行状态：`not-executed`**（主表状态不变）。
- **已做（可探性侦察，静态，不构成本行证据）**——`log-01-prb-01-host-surface.txt`（摘录，EXIT 行略；逐字见日志）：

```text
$ dsh --version
0.2.0-rc.2
$ grep -n 'LOCKED_VERSION' packages/adapters/src/dsh.ts
110:const LOCKED_VERSION = '0.2.0-rc.2'
```

  - `dsh --help` 显示启动面 `--patch <path>`（overlay 层）存在；`DSH_DEFAULT_CMD = ['dsh','--profile','headless','--json']`（`dsh.ts:107`）。
  - 本机 `~/.dsh/profiles` 有 `headless`、`web` 两个 profile（只列名，未读凭据文件）。
  - 仓内有插件载体与真机冒烟：`packages/dsh-bridge/test/smoke/bridge-smoke.ts`（临时 web 实例＋`--patch`＋RPC 建会话）。

- **拒绝理由 / 缺什么**：
  1. **形态不匹配**：现成冒烟的判据是「模型答复遵守注入指令（终答含标记串）」，**不是** PRB-01 要求的 `agent/created` 打点＋宿主加载日志；跑它也**不能**填 PRB-01，需先做最小打点插件（新增代码，非本单领土）。
  2. **需要真实宿主会话**：启动 dsh 会拉模型、出站、写 `~/.dsh/sessions` 与 `/tmp`，并占端口（冒烟用 13899）；本单性质只读、领土仅 `docs/probe/pb-1/`。
  3. **采集通道**：`agent/created` 属宿主事件，本单未建独立采集者（CAP-02 要求非自报通道）。
- **结论**：取不到正/负任一面，**不得记为通过**；HCL-0B 宿主侧子集**仍未证**。

### PRB-02 · 工具隐藏对模型强

- **主表行**：白名单只留一个工具、提示词要求调另一个；正向＝未列工具不可见/调用失败；负向＝直接 shell 调同名二进制仍可用（证非 OS 边界）；主表状态＝未执行。
- **本行状态：`not-executed`**。
- **已做（配置面侦察，静态，不构成本行证据）**：`log-02-prb-04-host-sandbox-config.txt` 记录 `dsh --profile headless --dump-config-schema` 中 `sandbox`/`bash-sandbox`/`fs-sandbox` 等条目存在——只证明**配置面存在**，v2/12 §0.5-4 明示「配置回显不是运行行为证据」。
- **拒绝理由 / 缺什么**：缺「工具白名单插件」落地（宿主侧工具注册面改造，属后续波次）；缺真实模型会话（否则「对模型强」无从观测）；缺**负向面**所需的外部 shell 对照（需在同一会话内 `bash` 调同名二进制）。三项都不在本单只读领土。
- **结论**：正向与负向**同为未取**；不得以「宿主有 sandbox 配置」充当工具隐藏生效。

### PRB-03 · 逐调用判定生效且可记

- **主表行**：guard 拒某工具；正向＝拒绝事件含四态依据；负向＝同进程改插件应成功（证进程内不设防）；主表状态＝未执行。
- **本行状态：`not-executed`**。
- **已做**：同 PRB-02 的配置面侦察（`log-02`），仅静态。
- **拒绝理由 / 缺什么**：缺 guard 插件实现与「拒绝事件四态依据」的事件形状（v2/03 四态）；缺拒绝事件的独立采集面；缺**负向面**的「同进程改插件」注入实验。全部需要真实宿主会话＋可写插件树，本单只读。
- **结论**：未取任何一面；「逐调用判定可记」仍未证。

### PRB-04 · 写域 fail-closed

- **主表行**：workspace-write＋域外写；正向＝域外被拒；负向＝域内成功＋符号链接逃逸＋DSH 自带沙箱缺省实际拦截（§3.3）；锚＝沙箱段生效；主表状态＝未执行。
- **本行状态：`not-executed`**。
- **已做（配置回显，静态；按 §0.5-4 明确标「非行为证据」）**——`log-02-prb-04-host-sandbox-config.txt`（摘录，EXIT 行略；逐字见日志）：

```text
$ dsh --profile headless --dump-config 2>/dev/null | grep -in 'sandbox-policy' -A4 | head -12
173:- id: sandbox-policy
174:  name: '@deepseek-ai/dsh-sandbox-policy'
175-  config:
176-    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
177-    workspaceRoot: !!js process.cwd()
```

  - 即：缺省模式 `workspace-write`、`workspaceRoot` 取 dsh 进程 cwd；三档映射 read-only/workspace-write/danger-full-access 在配置面可解析。**这只说明「配置面存在」，不说明「拦截实际生效」**——正是 PRB-04 要测的差。
- **拒绝理由 / 缺什么**：
  1. **需要写操作实验**：域外写、域内写、符号链接逃逸三种写测都要落盘（本单只读领土，且需可弃根目录）。
  2. **需要真实会话**：host 侧 sandbox 拦截只在 dsh 进程内可见；从当前 shell 写文件不构成 DSH 沙箱证据。
  3. **机制不可混用**：仓内 `packages/adapters/src/seatbelt.ts` 是**适配器侧 seatbelt 原型**（另一机制，仅 judge 面接线，`engine/judge/invoke.ts:174`；派发工厂 `agentconfig.ts:233-237` 不传 seatbelt），**不得用它代证 PRB-04 的 DSH 自带沙箱面**（v2/12 §5.1「不得由其他探针代证」同精神）。
- **结论**：`sandbox-policy` 缺省 `workspace-write` 的**实际拦截仍未探**（与主表 §3.3、§五 未证清单一致）。

### PRB-05 · 读域是否可收口（**本批唯一 executed**）

- **主表行**：形态＝本 OS `sandbox-exec` 读域规则；正向＝**（期望不存在）**；负向＝**既有负向：apply 时 SIGABRT，三种写法均败，strictRead 已删**；锚＝不可表达登记；主表状态＝**executed**（既有负向证据）。
- **本行状态：`executed`（负向结论）**。证据两条链：

**链 1 · 本日同机构造复验**（`log-03-prb-05-read-domain-sandbox-exec.txt`；macOS 26.3 arm64）：

```text
$ sandbox-exec -p '(version 1)(allow default)' /bin/echo ok
ok
EXIT=0

$ sandbox-exec -p '(version 1)(allow default)(deny file-read* (subpath "/"))' /bin/echo ok
EXIT=134

$ sandbox-exec -p '(version 1)(allow default)(deny file-read*)(allow file-read-data (literal "/bin/echo"))' /bin/echo ok
EXIT=134

$ sandbox-exec -p '(version 1)(allow default)(deny file-read*)' /bin/echo ok
EXIT=134
```

  - `EXIT=134 = 128+6`＝**SIGABRT**（apply 面崩溃，不是子命令输出失败）。
  - **对照组的判据价值**：`(allow default)` 构造在同一 shell 下 exit 0、正常 `echo`，证明当前进程**未被嵌套沙箱**（若已嵌套，apply 应 EPERM/exit 71）——因此上面三次 134 是**apply 面真实崩溃**，不是「会话内只能验编译面」的遮蔽（`seatbelt.ts` 头注红线段对此有专门警告）。
  - 覆盖面诚实标注：本日复验的是「根过滤读 deny」「无过滤读 deny＋字面例外」「裸读 deny」三种构造；原文记录的 att1/att2 逐字构造**未逐字节重放**，但三者同属「读收口构造类」且结论同型（SIGABRT）。

**链 2 · 仓内既有负向证据原文摘录**（`log-04-prb-05-repo-negative-evidence.txt`；`…` 为省略）：

```text
$ grep -n 'SIGABRT\|strictRead\|读收口' packages/adapters/src/seatbelt.ts
15: * attempt3 处置（…取 (a)「删 strictRead 形态」——宰相最推荐项）：
19: *       字面例外 → strictRead 形态 apply 时 **SIGABRT**（status=null+signal=SIGABRT）；
21: *       (subpath "/"))` + 读面全 `file-read*` op 通配零混编 → **仍 SIGABRT**——
27: *     **读收口在 sandbox-exec 面上不可表达**，留待 Apple 支持或换机制（远期归
```

  - `docs/78-技术细节-宿主平台与工作区绑定.md:930`：「加读域规则后 apply 时 `SIGABRT`（status=null, signal=SIGABRT），**三种写法均失败**，最终**删除 `strictRead`**，读域放宽」；`:938` 另记「网络隔离不能靠 seatbelt host 白名单做通用出站控制」。
  - 代码事实：`seatbelt.ts` 现行生成器只出写域/网域两个 fail-closed 面，读域宽放（同文件 `:29-32`）。

- **结论（只到「该形态观察一次」）**：本机 macOS 26.3 arm64 上，`sandbox-exec` 的**读域收口构造类不可表达**（apply 面 SIGABRT），与主表负向列一致；「读域可收口」**不成立**。
- **边界（不得越读）**：
  1. 不推及 DSH 自带 `sandbox-policy` 的读面（那是另一机制、另一探针面，未测）；
  2. 不推及其他 OS/其他 `sandbox-exec` 版本；
  3. 负向结论**不得**被读成「信息边界已成立」——恰好相反：读域不可收口＝**读隔离在 OS 层不可保证**（BIND-LOSS-13 blocking 口径）；
  4. 本行 `executed` **不等于** PRB-04（写域）已证，写/读两面不可互推。

### PRB-06 · 网络出站未控

- **主表行**：形态＝请求外部域名；正向＝**—（无正向）**；负向＝现无隔离→成功（证未控制）；锚＝EX-3 执行位置；主表状态＝未执行。
- **本行状态：`not-executed`**。
- **已做（静态侦察，明确不构成本行证据）**——`log-05-prb-06-egress-posture.txt`：`seatbelt.ts:58-70` 记「网域 host 字面量仅接受 `*`/`localhost`；IP/域名一律编译错；模型 API 等远程出口按域名收口**不可表达**，方案＝daemon 侧本地代理（目标）」；`grep -rni 'proxy' apps/daemon/src packages/adapters/src` 仅命中注释，**未发现代理实现**。
- **拒绝理由（本单主动不执行，不是做不到）**：
  1. **出站属外部面**：探针形态要求「请求外部域名」，是出站行为；本单领土/性质为「本机只读」。
  2. **观测不可归因**：单次成功无法区分「宿主无网络隔离」与「本会话策略放行」；本会话运行策略为 `danger-full-access`（harness 明示），混淆变量不可控——这种观测**不足以**作 PRB-06 证据。
  3. **缺对照基线**：PRB-06 的正向列本为空，判据全压在负向「成功＝未控制」；没有「已隔离」对照组时，一次成功只说明「这一次能出去」。
- **缺什么（可补强清单）**：EX-3 执行位置（真实派工执行体）＋一次受控/未受控对照（同版本同形态、仅策略不同）＋出站授权与可接受的落点（中性域名）。**本轮零出站请求**（无 curl/无 DNS 探测/无模型调用）。

### PRB-22 · overlay 可写性

- **主表行**：形态＝以 worker 身份写 `<rootDir>/tmp/`；正向＝被拒/不可写；负向＝**可写＝负向发现**（自改上下文面缺口）；锚＝§3.2 不可写面（治 V8-P1-4 三卷悬空）；主表状态＝未执行。
- **本行状态：`not-executed`**。
- **已做（落点与权限位的代码事实，静态；不构成本行证据）**——`log-06-prb-22-overlay-target.txt`（摘录，`...` 为省略）：

```text
$ grep -n "rootDir: './var'" apps/daemon/src/assembly/serve.ts
375:  rootDir: './var',

$ sed -n '75,112p' apps/daemon/src/engine/instructions-store.ts   # 摘录
const overlayPath = path.join(rootDir, 'tmp', 'dsh-bridge-overlay.yml')
...
mkdirSync(path.dirname(overlayPath), { recursive: true, mode: 0o700 })
writeFileSync(overlayPath, text, { encoding: 'utf8', mode: 0o600 })

$ for p in var tmp .AIWS; do …; done
ABSENT: var
ABSENT: tmp
ABSENT: .AIWS
```

  - 落点：`<rootDir>/tmp/dsh-bridge-overlay.yml`（每次 serve 启动覆盖刷新）；`<rootDir>` 缺省 `./var`；目录 0700、文件 0600。
  - 本仓**没有** `var/`、`tmp/`、`.AIWS/`：即**从未在本仓根 provision 过 overlay**——探针目标目录不存在。
- **拒绝理由 / 缺什么**：
  1. **目标不存在**：需先以 serve 形态 provision 出 `<rootDir>/tmp/`（一次真实 serve 启动＝写盘＋可能派工，非只读）。
  2. **身份不匹配**：探针要求「以 worker 身份」写；当前执行体是施工代理进程，不是被派工 worker（不同环境变量/不同 cwd/可能不同沙箱段）。同 UID 的「能不能写」问题在 0700 下退化为「是否同一用户」——**必须**在真实 worker 启动形态下测才有意义。
  3. **写操作**：探针本身是写测试（可写/不可写两面都要落盘判定），超出本单只读领土。
- **静态面推论（明确标注：不是探针证据，不得当负向发现）**：`<rootDir>/tmp` 是否落在 worker 可写范围，取决于宿主 `sandbox-policy` 的 `workspaceRoot`（缺省 `process.cwd()`，见 `log-02`）与 worker cwd 的关系，以及派发面是否真正启用 sandbox——而派发工厂 `agentconfig.ts:233-237` 目前**不传 seatbelt**（只有 judge 面 `judge/invoke.ts:174` 接），所以「overlay 对 worker 可写」在现状结构上**可能成立**，但**未经任何行为观测**。此推论**不得**写成 PRB-22 结论。

---

## 四、未执行原因汇总（按缺失类别，便于排期）

| 缺失类别 | 影响行 | 具体缺什么 |
|---|---|---|
| 真实宿主会话（模型调用/出站） | PRB-01/02/03/04 | 一次可弃的 dsh 会话（profile 已有 headless/web；缺的是**本单只读纪律的授权**与采集通道） |
| 插件与事件面（新增代码） | PRB-01/02/03 | `agent/created` 最小打点插件；工具白名单/guard 插件；拒绝事件四态形状与独立采集者 |
| 写操作与可弃根 | PRB-04/22 | 可弃 `workspaceRoot` 与 `<rootDir>/tmp/`；域内/域外/符号链接三组写测；本仓 `var`/`tmp`/`.AIWS` 均不存在 |
| 独立 worker 身份 | PRB-22（PRB-04 部分） | 真实派工 worker 形态（cwd/env/沙箱段）——同 UID 下 0700 不构成隔离 |
| 外部网络面与对照基线 | PRB-06 | EX-3 执行位置、受控/未受控两组基线、出站授权 |
| 本单领土/只读纪律 | 全部 7 行 | 以上全部动作都超出「只读、零生产码改动、只写 `docs/probe/pb-1/`」的单据边界 |

> 注：**不是**「无凭据」——本机 `~/.dsh` 有 profile 与用户级凭据文件（本单未读取、未打印、未使用）。缺的是**执行授权与隔离夹具**，以及宿主侧插件/事件面产物。

---

## 五、可补强清单（下一批开工前需要什么）

1. **最小打点插件**（PRB-01）：宿主侧 `agent/created` 打点＋「不挂 patch 时不出现」的负向；需一处可写插件源与独立事件采集（不得用模型答复自报代替）。
2. **权限插件夹具**（PRB-02/03）：工具白名单、guard 拒绝、拒绝事件四态依据；配套「同进程改插件应成功」负向注入面。
3. **隔离写测夹具**（PRB-04/22）：可弃 `workspaceRoot`、`<rootDir>` 副本、域内/域外/符号链接三组写测；worker 以真实派工形态启动（含 `DSH_PERMISSION_MODE` 两档对照）。
4. **出站对照**（PRB-06）：同版本同形态、仅策略不同的两组出站观测；落点用中性域名；授权明确后执行。
5. **批次记录纪律**：上述每行落地时，原始日志照本批格式落 `docs/probe/pb-1/`（或对应批次目录），**一行一档一状态**。

---

## 六、诚实边界

1. **本批 executed 仅 1/7（PRB-05）**：PB-1 的出口是「每行判定」，**不是**「全行通过」；不宣布 PB-1 通过、不宣布宿主差分已证。
2. **PRB-05 的结论强度**：只到「macOS 26.3 arm64、`sandbox-exec` 读收口构造类、本日观察一次 SIGABRT」；不推及 DSH 自带沙箱、不推及其他 OS、不推及写域。
3. **6 行 not-executed 的正负面都未取到**：任何「预期通过/预期不可写」的填写都是违规（v2/12 §0.4），本报告一律不填。
4. **配置回显不是行为**：PRB-02/04 中引用的 `--dump-config` 内容只用于说明**配置面存在与缺省值字样**，不作为任何行为结论（§0.5-4）。
5. **静态代码事实不是探针证据**：PRB-22 的 0700/0600、PRB-04 的 `workspaceRoot=process.cwd()`、PRB-01 的 `--patch` 启动面，均只作「可探性/缺什么」的说明。
6. **零副作用**：本批未启动 dsh 会话、未写 `~/.dsh`、未建 `<rootDir>/tmp/`、未发出**探针性**出站请求（无 curl/DNS 探测/模型调用；工具链版本检查属环境自带行为）、未改任何生产码/规则源（`log-07-git-clean.txt`：`scripts/guards/` 与 `apps packages scripts templates` 均 0 行）。
7. **不代证**：本批结论不进入 PB-2..6；PRB-05 不能代证 HCL-2 权限差分（v2/12 §5.1 铁律）。

---

## 七、原始日志清单（`docs/probe/pb-1/`）

| 文件 | 内容 | 对应行 |
|---|---|---|
| `log-00-environment.txt` | HEAD/工具链/OS/宿主版本/DSH_HOME 与 profile 名（只列名） | 全批 |
| `log-01-prb-01-host-surface.txt` | `dsh --help`、`LOCKED_VERSION`、`DSH_DEFAULT_CMD`、overlay provision 调用点、bridge 冒烟头注与前置自查 | PRB-01 |
| `log-02-prb-04-host-sandbox-config.txt` | 宿主 sandbox 配置面回显（schema 计数、`sandbox-policy` 缺省 mode/workspaceRoot、三档映射） | PRB-02/03/04（仅配置面） |
| `log-03-prb-05-read-domain-sandbox-exec.txt` | 本日 `sandbox-exec` 四构造实跑（对照组 exit 0；三种读 deny exit 134） | PRB-05 |
| `log-04-prb-05-repo-negative-evidence.txt` | `seatbelt.ts` 头注原文、docs/78 §7.3 读域不可表达表 | PRB-05 |
| `log-05-prb-06-egress-posture.txt` | 网域字面量限制、`network-outbound` 用法、`proxy` 关键词命中（仅注释） | PRB-06（仅静态） |
| `log-06-prb-22-overlay-target.txt` | overlay 落点/权限位/`rootDir` 缺省/目标目录不存在/judge 面 seatbelt 接线与派发工厂 | PRB-22（仅静态） |
| `log-07-git-clean.txt` | `scripts/guards/` 与生产面 `git status`（零改动） | 全批 |

> 脱敏说明：日志中本机用户名与家目录替换为 `<user>`/`<home>`，其余字节逐字保留（含 `EXIT=` 与空输出段）。时间戳为 2026-10-28T07:57Z（UTC）。
