# PB-3 HCL 锚批 · 探针收口登记（PRB-17/18/19/20/21）

> **头注**
> - 日期：2026-10-29（探针采集 2026-10-29T06:59Z–07:04Z UTC / 14:59–15:04 CST）
> - git HEAD：`af0621643b39fc72ad990243df36232170d77891`（分支 `dev`；采集期间 HEAD 由 `9a43b7b` 前移到 `af06216`，本报告全部日志的 `HEAD=` 行以各日志头注为准）
> - 工具链/宿主：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜dsh **0.2.0-rc.2**｜macOS **26.3** arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；MIG-08 / IMPL-08-05）
> - 性质：**只读探针＋仓外临时目录夹具**；不改生产码、不改旧测试、不写公司目录/宿主 profile、不启真实模型会话、不发出站请求、不 git commit
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §5.1/§5.3（PRB-17/18/19/20/21 **唯一主表**）、`docs/v2/07-技术抽象-执行能力与工作运行.md` §六（HCL-0A/HCL-1/HCL-2/HCL-4 闭合判据）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-3 批次与阻断）、`docs/plan/05-实现单拆分清单.md` IMPL-08-05
> - 口径：状态三值（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；未执行行不填「预期通过」；每行正向＋负向同验；原始日志逐字留存（仅脱敏本机绝对路径 → `<repo>`/`<tmp>`）

---

## 一、批次入口判定（先判门，再谈行）

| 入口要件 | 规范原文 | 实测 | 判定 |
|---|---|---|---|
| MIG-05 能力包装载面 | v2/17 §五 PB-3 入口「**MIG-05** 能力包装载面」 | `packages/company/src/assets/{defpkg,import,loader,registry}.ts` 在位；`git show --stat e95bdfc`＝「MIG-05 公司包与资产部 7 单」 | **满足** |
| PB-2（PRB-08 前置） | v2/17 §五 PB-3 入口「＋**PB-2**（PRB-08 前置）」；§5.3「PRB-08 是 PB-3 HCL-2 锚的前置」 | `docs/probe/pb-2/` 不存在；`git log --all -- docs/probe/pb-2` 空；v2/12 §5.3 PRB-07/08/09 均为「未执行」；`compile-projection.ts:30` 自记「SEC-SIG-04 通道未建，PRB-08 未执行」 | **不满足** |

**结论**：PB-3 **批次入口未满足**（MIG-05 在、PB-2/PRB-08 缺）。按 v2/17 §五「某批无结论即停后续依赖批」与「未闭合不得宣称任何替换级闭合」，本报告**不宣布 PB-3 通过、不宣布任何 HCL 级闭合、不宣布任何替换级闭合**。

本报告仍登记两类内容（不构成批次通过）：

1. **可独立执行的落位腿**：PRB-17 的判据不依赖 PRB-08（HCL-0A 明确「判据不含来源核验」），故用 MIG-05 的库级导入面执行并给出负向结论；
2. **不可执行的阻断行**：PRB-19/20 被 PB-2/PRB-08 阻断；PRB-18 需真实控制进程、PRB-21 需宿主侧替换面，均按 `not-executed` 登记缺什么。

> **HCL-2 双差分铁律**：PRB-19（权限差分）与 PRB-20（秘密类别/逻辑引用差分）在本报告**各自独立成行**，不合并、不互相代证、不由 PRB-17/18 或 PB-5 的 PRB-23/14 代证（v2/12 §5.1；v2/17 §五）。

---

## 二、逐行判定表

| ID | HCL 锚 | 主表现状 | **本行状态** | 正向结果 | 负向结果 | 证据（日志） |
|---|---|---|---|---|---|---|
| PRB-17 | HCL-0A | 未执行 | **executed（负向）** | **未取到**：落位报告与安装日志均无「宿主未承认」明记 | **已取到**：缺该标记 → 按主表负向列「不得称 HCL-0A」 | `log-02-prb-17-install-landing.txt` |
| PRB-18 | HCL-1 | 未执行 | **not-executed** | 组件级侦察**观察到**控制面回执＋指纹（不构成真实控制进程证据） | 未据此称插件已换/资格已变（正确）；真实控制进程未跑 | `log-03-prb-18-hot-reload.txt` |
| PRB-19 | HCL-2 | 未执行 | **not-executed** | **未取到**：PB-2/PRB-08 前置缺、无激活批准、无运行期差分件；PRM 段引用可列出但非本行证据 | **未取到**：「由其他探针代证＝无效」的独立差分链未建立 | `log-04-prb-19-20-diff-recon.txt` |
| PRB-20 | HCL-2 | 未执行 | **not-executed** | **未取到**：秘密类别/逻辑引用差分＋**部署供给确认**均缺；PRB-07 也未执行 | **未取到**：不得以「秘密未进上下文」代证差分（本报告未代证） | `log-04-prb-19-20-diff-recon.txt` |
| PRB-21 | HCL-4 | 未执行 | **not-executed** | **未取到**：无宿主侧替换插件面、无替换前后行为探测 | **未取到**：无回滚路径演练 → 按主表负向列「不得称 HCL-4」 | `log-05-prb-21-host-replace.txt` |

**统计（5 行）**：`executed` **1**（PRB-17，负向）｜`not-executed` **4**（PRB-18/19/20/21）｜`not-applicable` **0**。

> 说明：PRB-18 的 `not-executed` 是**严格按主表形态**判的：主表要求「改配置声明**不重启控制进程**」，本报告只跑了 `createHotReload` 控制面组件（同一 `check()` 逻辑、仓内真实 `control/reload.*` 文件通道），**没有起真实 daemon 进程**，故组件级观察只作「可探性侦察」，不升为本行证据（v2/12 §0.5-3/§0.5-4 同精神）。

---

## 三、逐行详录

### PRB-17 · HCL-0A 落位闭合（本批唯一 executed）

- **主表行（v2/12 §5.3）**：目的＝HCL-0A 落位闭合；形态＝安装能力包→查落位记录与安装日志；正向＝记录含「宿主未承认」明记；负向＝缺该标记即不得称 HCL-0A；锚＝HCL-0A。
- **本行状态：`executed`（负向）**。命令与逐字输出见 `log-02-prb-17-install-landing.txt`；以下为摘录（`<tmp>` 为仓外临时根，`EXIT` 行保留）：

```text
$ REPO_ROOT=<repo> mise exec -- node <tmp>/sn-probe/pb3-prb17.mjs
== importDefinitionPackage ==
artifactId=company.pb3-probe version=1.0.0 specVersion=2.0.0
parts=[{"partId":"definition.main","partType":"definition"}] files=[".studio-next.yaml","org-config.yaml","package.yaml"]
installAuthorization=required staged=false
scanNote="本扫描只声明「文本面未发现疑似秘密/本机路径」，不证明绝无秘密（v2/15 §四）"
report marker(宿主未承认/未加载) = false
target entries = [".studio-next.yaml","org-config.yaml","package.yaml"]
target install-log.jsonl exists = false
target registry.json exists = false
target file marker scan = [".studio-next.yaml:false","org-config.yaml:false","package.yaml:false"]
== installCompanyPlugins ==
confirmed=true items=["dsh-pb3-probe:install"]
log exists = true
install-log line count = 1
install-log marker(宿主未承认/未加载) = false
install-log first line = {"at":"2026-10-29T00:00:00.000Z","company":"company","summary":"install:1","confirmed":true,"items":[{"name":"dsh-pb3-probe","action":"install","required":["1.0.0"],"origin":"package"}]}
EXIT=0
```

- **做了什么**：
  1. 用 MIG-05 的 `importDefinitionPackage` 把最小 PKG-DEF（definition 部，`package.yaml`＋`org-config.yaml`＋`.studio-next.yaml`）从临时源目录导入临时目标目录；落位成功，报告字段 `staged=false`、`installAuthorization='required'`。
  2. 检查落位报告、目标目录全部文本文件、目标目录是否有 `install-log.jsonl`/`registry.json`：**均无「宿主未承认/未加载」标记，也没有能力包安装日志**（导入面结构上只返回报告，不写安装日志）。
  3. 另跑插件安装面 `installCompanyPlugins`（`dependencies.yaml`→隔离插件根），确认 `install-log.jsonl` 确实产生一行；该行只有 `at/company/summary/confirmed/items`，**没有宿主承认/未承认字段**。
- **正/负同验**：
  - **正向（记录含「宿主未承认」明记）＝未取到**：两个候选安装/落位日志面都没有该标记。
  - **负向（缺该标记即不得称 HCL-0A）＝已取到**：`grep -rn "宿主未承认" packages apps --include=*.ts` 零命中；落位报告与安装日志均无该词。
- **结论**：**HCL-0A 不能宣称闭合**。当前能力包导入只到「文件落位＋导入报告」，既没有把「宿主未加载/未承认」写进落位记录，也没有能力包级安装日志；插件安装日志是相邻面且同样不含该标记。按 v2/07 §六 HCL-0A 判据（落位记录＋安装日志＋明记「宿主未承认」），三项缺两项（标记、能力包安装日志）。
- **边界/缺口**：
  1. 本行是**库级导入面**执行；`grep -rn "importDefinitionPackage" packages apps --include=*.ts` 显示仓内除定义/测试外**无生产调用方**（无 CLI/daemon 安装命令），故「安装动作」尚未成为可运营命令面；
  2. 该负向只说明**当前没有 HCL-0A 所需的记录标记**，不说明宿主已加载/已承认（HCL-0A 明确不含宿主加载；宿主承认属 HCL-0B/PRB-01）；
  3. 不代证 HCL-0B（PRB-01 未执行）、不代证 HCL-1/2/4。

### PRB-18 · HCL-1 声明可见＋指纹（组件级侦察，**not-executed**）

- **主表行（v2/12 §5.3）**：目的＝HCL-1 声明可见＋指纹；形态＝改配置声明不重启控制进程；正向＝声明控制面可见＋指纹可核；负向＝据此称插件已换/资格已变＝判负；锚＝HCL-1。
- **本行状态：`not-executed`**（严格按主表形态：没有起真实控制进程，故不把组件级观察升级为本行证据）。
- **已做（组件级可探性侦察，不构成本行证据）**——`log-03-prb-18-hot-reload.txt` 摘录：

```text
$ REPO_ROOT=<repo> mise exec -- node <tmp>/sn-probe/pb3-prb18.mjs
baseline fingerprint = sha256:5865632b2d43...（10 文件）
check#1 kind=reloaded fingerprint=sha256:333d32d38242... changes="~charter.md"
result#1 = {"id":"prb18-req-1","ok":true,"applied":true,"detail":"指纹→sha256:333d32d38242…；jobs +0/-0；people=2"}
check#2 kind=reloaded fingerprint=sha256:8e86d201c496... changes="~prompts/company.md"
result#2 = {"id":"prb18-req-2","ok":true,"applied":true,"detail":"指纹→sha256:8e86d201c496…；jobs +0/-0；people=2"}
check#3 kind=null
stats checks=3 reloads=2 manualRequests=2 lastFingerprint=sha256:8e86d201c496...
apply calls=2 snapshots=[{"slug":"example-corp","level":2,"people":2,"departments":1},...]
fp1!=fp2 = true
ledger events=2 eventIds=["01M62F9N01W3M85H543EY809N9","01M62F9N02G6KJGSME2A9V4H9H"]
event SCHEMA_EVOLVE: RELOAD;trigger=manual;company=example-corp;变更=[~charter.md];指纹=sha256:5865632b2d43→sha256:333d32d38242;...;零进程重启（docs/38-§2 L1）
event SCHEMA_EVOLVE: RELOAD;trigger=manual;company=example-corp;变更=[~prompts/company.md];指纹=sha256:333d32d38242→sha256:8e86d201c496;...;零进程重启（docs/38-§2 L1）
loadCompanyDirectory after reload: ok=true
EXIT=0
```

- **观察到的组件行为（仅供排期，不构成本行证据）**：
  1. 复制 `templates/company-2-level` 到仓外临时目录，起仓内真实 `createHotReload`（`apps/daemon/src/control/hot-reload.ts`），`watch:false`、`anchorAbsence` 显式声明无锚（避免信任锚面干扰）；
  2. 两次改公司目录声明（`charter.md`、`prompts/company.md` 各追加一行），经真实控制面文件通道 `control/reload.request.json` 触发 `check()`；同一进程（未重启）两次 `reloaded`；
  3. 回执 `control/reload.result.json` 两次均 `ok:true,applied:true`；总指纹按内容变化；台账落两条 `SCHEMA_EVOLVE`（note 前缀 `RELOAD;...零进程重启`）；
  4. `apps/daemon/src/assembly/serve/runtime.ts:479` 真实装配 `createHotReload`，`run.ts:193` 在主循环每拍调 `hotReload.check()`——控制面组件确实接在 serve 上。
- **为什么仍记 `not-executed`**：
  1. 主表要求「**控制进程**不重启」；本报告在探针进程内直接调 `check()`，没有起 `runServe` 真实 daemon，也没有经 `studio-next reload` CLI 对活进程发请求；这是**组件级**观察，不是进程级；
  2. 主表 HCL-1 是「配置可观察」；组件级只证公司目录声明可热重载，**未证能力/插件/资格声明**的可见性（`syncCompanyPlugins`/`pluginSetFingerprint` 在 `apps/` 无调用方，`grep` 零命中）；
  3. 批次入口未满足（§一），本行即使组件级正向也不得升为 HCL-1 闭合。
- **负向面**：本报告**没有**据此称「插件已换/资格已变」；`SCHEMA_EVOLVE` note 明确是公司目录 `RELOAD`，`apply` 快照只有公司/部门/人员，无插件/能力字段。该负向纪律成立，但不补正向的进程级缺口。
- **缺什么 / target**：真实 `runServe` 控制进程＋`studio-next reload` 请求/回执＋指纹核对；能力/插件声明变更面（若 HCL-1 要覆盖该面）；PB-3 入口补齐（PB-2/PRB-08）。

### PRB-19 · HCL-2 权限差分单列（**not-executed**）

- **主表行（v2/12 §5.3）**：目的＝HCL-2 权限差分单列；形态＝新旧计划/版本逐项比对；正向＝工具与动作范围差分逐项列出；负向＝由其他探针代证＝无效；锚＝HCL-2 闭合（必列）。
- **本行状态：`not-executed`**。
- **已做（侦察，不构成本行证据）**——`log-04-prb-19-20-diff-recon.txt`：
  - 用 `compileProjection` 生成新旧两份 PRM（旧：`grant-a/grant-b`、`cap-a`、`sandbox-root-old`；新：`grant-a/grant-c`、`cap-a/cap-b`、`sandbox-root-new`），机械列出 `tools`/`authority`/`sandbox`/`plan` 段引用差：`tools added=["cap-b"]`、`authority added=["grant-c"] removed=["grant-b"]`、`sandbox added=["sandbox-root-new"] removed=["sandbox-root-old"]`；两份 digest 不同。
  - 但这只是**PRM 段引用**，不是 HCL-2 所要求的「工具与动作范围差分」：段引用是能力引用，不是逐工具/逐动作授权面；且没有激活批准、没有独立验证、没有部署供给确认。
  - `grep -rn "permission_diff\|secret_class_diff" packages apps --include=*.ts | grep -v test` 只命中 `packages/contract/src/records/cap.ts` 的记录字段与校验：**运行期没有差分生成器**。
- **原始输出摘录**（逐字见 `log-04-prb-19-20-diff-recon.txt`）：

```text
$ REPO_ROOT=<repo> mise exec -- node <tmp>/sn-probe/pb3-prb19-20.mjs
diff tools: added=["cap-b"] removed=[]
diff authority: added=["grant-c"] removed=["grant-b"]
diff sandbox: added=["platform_token","sandbox-root-new"] removed=["sandbox-root-old"]
diff plan: added=["cap-b","plan-new"] removed=["plan-old"]
digest old=sha256:7c7ed152bd83045d5697fd395671c1685603e1d9c68acbdb29d0a33483e16438
digest new=sha256:503827e13d218bb97bb1d5296bb30181249ed3071b68a8e8f0be05f9b2e7bd99
static: permission_diff/secret_diff = contract record fields only（REC-CAP-ACTIVATE）; 运行期 diff 生成器未检索到
static: deployment supply confirmation = 无供给确认载体（探针不代证）
EXIT=0
```
- **为什么 `not-executed`**：
  1. PB-2/PRB-08 前置未执行（§一）；HCL-2 锚要求 PRB-08；
  2. 无 `REC-CAP-ACTIVATE` 激活批准记录（无旧/新版本、无独立验证、无批准位置）；
  3. 无「新旧计划/版本逐项比对」的运行期实现；本次侦察是探针侧手工比对 PRM 段，不是产品差分面；
  4. 批次入口未满足，且 v2/17 明写「未闭合不得宣称任何替换级闭合」。
- **缺什么 / target**：PB-2（PRB-08 篡改一字节拒载＋不 spawn）→ 旧/新能力计划锁 → `REC-CAP-ACTIVATE` 激活批准（含双差分字段）→ 逐工具/逐动作权限差分（含新增/扩大权限的显式处理）→ 在途钉旧版/新出工可用证据。
- **不代证声明**：本行不被 PRB-20、PRB-17、PRB-18、PRB-23/14 代证；PRB-19 自身未 executed。

### PRB-20 · HCL-2 秘密差分单列（**not-executed**）

- **主表行（v2/12 §5.3）**：目的＝HCL-2 秘密差分单列；形态＝新旧计划/版本比对；正向＝秘密类别＋逻辑引用差分逐项列＋部署供给确认；负向＝「秘密未进上下文」（PRB-07）不得代证差分；锚＝HCL-2 闭合（必列）。
- **本行状态：`not-executed`**（与 PRB-19 **独立**，不合并）。
- **已做（侦察，不构成本行证据）**：
  - 同一 PRM 侦察中，新输入的 `secretTypes` 从 `['per_task_shortlived']` 变为 `['per_task_shortlived','platform_token']`，`sandbox` 段引用相应变为 `['per_task_shortlived','platform_token','sandbox-root-new']`；这只说明生成器把秘密类别带进段引用，**不构成秘密类别/逻辑引用差分**（没有 `secret_class_diff` 形状，没有逻辑引用表，没有部署供给确认）。
  - `grep -rn "permission_diff\|secret_class_diff" packages apps --include=*.ts | grep -v test`：`secret_class_diff` 只出现在 `packages/contract/src/records/cap.ts` 的字段/校验，运行期无生成器。
  - PRB-07（秘密不进上下文）**未执行**；即使执行，按主表也不能代证本行。
- **原始输出摘录**（逐字见 `log-04-prb-19-20-diff-recon.txt`）：

```text
$ REPO_ROOT=<repo> mise exec -- node <tmp>/sn-probe/pb3-prb19-20.mjs
== segment sandbox ==
old: {"enabled":true,"sourceRefs":["per_task_shortlived","sandbox-root-old"],"note":"mode:workspace-write;network:external-only"}
new: {"enabled":true,"sourceRefs":["per_task_shortlived","platform_token","sandbox-root-new"],"note":"mode:workspace-write;network:external-only"}
diff sandbox: added=["platform_token","sandbox-root-new"] removed=["sandbox-root-old"]
static: permission_diff/secret_diff = contract record fields only（REC-CAP-ACTIVATE）; 运行期 diff 生成器未检索到
static: deployment supply confirmation = 无供给确认载体（探针不代证）
EXIT=0
```
- **为什么 `not-executed`**：
  1. PB-2/PRB-08 前置未执行；
  2. 秘密 catalog / 部署供给确认未建（`PRB-07` 也未执行；无部署侧供给证据）；
  3. 无新旧版本的秘密类别＋逻辑引用逐项差分；
  4. 不得以 PRB-07 或 PRB-19 代证。
- **缺什么 / target**：秘密 catalog（类别＋逻辑引用，永不回值）→ 新旧计划/版本的 `secret_class_diff`（类别/逻辑引用新增、扩大、移除）→ 部署供给确认（供给位置/授权）→ 与 PRB-19 同批的 `REC-CAP-ACTIVATE` 激活批准。
- **不代证声明**：PRB-20 独立成行；本行不因 PRB-19 侦察、PRB-17 落位、PRB-23 读侧或 PRB-14 单写而成立。

### PRB-21 · HCL-4 宿主内原子替换（**not-executed**）

- **主表行（v2/12 §5.3）**：目的＝HCL-4 宿主内原子替换；形态＝宿主侧替换插件；正向＝替换前后语义与行为探测一致＋回滚路径演练通过；负向＝无回滚演练即不得称 HCL-4；锚＝HCL-4。
- **本行状态：`not-executed`**。
- **已做（静态面登记，不构成本行证据）**——`log-05-prb-21-host-replace.txt`：
  - `dsh --help` 只有 `--patch <path>` overlay、`dsh plugin --profile <p> add <package>` 安装面；没有「替换插件/热插拔/回滚」旗标或子命令；
  - `grep -rni "plugin.*replace\|replace.*plugin\|热插拔" packages/dsh-bridge/src packages/adapters/src apps/daemon/src --include=*.ts` 零命中；`grep -rni "rollback" packages/dsh-bridge/src packages/adapters/src` 零命中；
  - 仓内有 `--patch` overlay 与 `dsh plugin add` 的承载，但没有宿主侧原子替换实现，也没有替换前后语义/行为探测或回滚演练。
- **原始输出摘录**（逐字见 `log-05-prb-21-host-replace.txt`）：

```text
$ dsh --help
  --patch <path>                 extra patch-list overlay applied after the
                                 profile layer (repeatable)
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
EXIT=0
$ grep -rni "plugin.*replace\|replace.*plugin\|热插拔" packages/dsh-bridge/src packages/adapters/src apps/daemon/src --include=*.ts
EXIT=0
$ grep -rni "rollback" packages/dsh-bridge/src packages/adapters/src --include=*.ts
EXIT=0
```
- **为什么 `not-executed`**：没有宿主侧替换面，无法执行「替换前后行为探测一致＋回滚演练」；本行不是「跑失败」，是**缺被测面**。
- **缺什么 / target**：宿主侧插件替换 API/命令（原子替换语义）→ 替换前后逐项语义/行为探测（同一 profile/同一工具面）→ 回滚路径与演练记录（含失败回滚）→ HCL-4 判据全链。

---

## 四、未执行原因汇总（按缺失类别）

| 缺失类别 | 影响行 | 具体缺什么 |
|---|---|---|
| PB-2／PRB-08 前置 | PRB-19、PRB-20 | `docs/probe/pb-2/` 不存在；PRB-08「投影摘要/签名校验 fail-closed」未执行；HCL-2 锚要求 PRB-08 |
| 激活批准/新旧版本 | PRB-19、PRB-20 | 无 `REC-CAP-ACTIVATE`（无旧/新计划锁、无独立验证、无批准位置）；无部署供给确认 |
| 差分运行期面 | PRB-19、PRB-20 | 只有 `REC-CAP-ACTIVATE` 记录字段；无逐工具/逐动作权限差分、无 `secret_class_diff` 生成器 |
| 真实控制进程 | PRB-18 | 只有组件级 `createHotReload.check()`；无真实 `runServe` 进程＋`studio-next reload` 请求/回执；`syncCompanyPlugins` 未接 `apps/` |
| 宿主替换与回滚面 | PRB-21 | `dsh` 只有 `--patch` overlay/`plugin add`；无宿主侧替换/回滚演练 |
| 生产安装命令面 | PRB-17 | `importDefinitionPackage` 无生产调用方（库级面）；无能力包安装日志与「宿主未承认」标记 |

**探针脚本构造失败登记（非产品结论，失败也登记）**：PRB-18 首次运行 exit=1，错误 `CONFIG_INVALID/evt/invalid:id`——探针 `makeId` 用了非 ULID 字符串；改用 `makeUlid` 后重跑 exit=0（`log-03`）。该失败是**探针夹具构造失败**，不是产品探针结果，未计入本行结论。

---

## 五、诚实边界

1. **PB-3 未通过**：入口缺 PB-2/PRB-08；本报告不宣布 PB-3 通过，不宣布 HCL-0A/HCL-1/HCL-2/HCL-4 任一闭合，不宣布任何替换级闭合。
2. **PRB-17 只有负向**：能力包导入与插件安装日志均无「宿主未承认」明记；这只证明 HCL-0A 的**记录判据不成立**，不证明宿主已加载（HCL-0B/PRB-01 未执行）。
3. **PRB-18 的组件级观察不升级为证据**：`createHotReload` 是仓内真实控制面组件，确实接在 `runtime.ts:479`/`run.ts:193`；但没有起真实控制进程，故按 `not-executed` 登记。组件级正向不补进程级缺口。
4. **HCL-2 双差分独立**：PRB-19 与 PRB-20 分开登记，不合并、不互相代证、不由 PB-5 的 PRB-23/14 代证；两行均未执行，HCL-2 未闭合。
5. **PRB-21 是缺被测面**：不是「跑失败」；`dsh` 只有 overlay/patch 与 plugin add，不存在宿主侧原子替换/回滚面。
6. **零副作用**：未改生产码/旧测试/其它包；未写公司目录、`~/.dsh`、仓内 `var/`/`tmp/`/`.AIWS`；全部夹具落在仓外系统临时目录并已清理；未 git commit。本单新增仅 `docs/probe/pb-3/**`。
7. **不代证**：本报告结论不进入 PB-5；PRB-17/18 不代证 HCL-2/PRB-19/20；PRB-19/20 不代证 HCL-4。

---

## 六、原始日志清单（`docs/probe/pb-3/`）

| 文件 | 内容 | 对应行 |
|---|---|---|
| `log-00-environment.txt` | 日期/HEAD/分支/OS/工具链/dsh 版本/`git status` | 全批 |
| `log-01-entry-pb2.txt` | MIG-05 提交、`docs/probe` 清单、PB-2 缺失、PB-3/PB-2 规范行、PRB-08 状态 | 批次入口 |
| `log-02-prb-17-install-landing.txt` | PKG-DEF 导入报告/目标目录/标记扫描＋插件安装日志面＋生产调用方/标记 grep；附探针脚本源 | PRB-17 |
| `log-03-prb-18-hot-reload.txt` | 组件级 `createHotReload` 两次热重载、回执、指纹、台账事件、装配点 grep；附探针脚本源 | PRB-18（侦察） |
| `log-04-prb-19-20-diff-recon.txt` | 新旧 PRM 段引用/摘要/unsupportedSegments＋`permission_diff`/`secret_class_diff` 静态面；附探针脚本源 | PRB-19/20（侦察） |
| `log-05-prb-21-host-replace.txt` | `dsh --help`、宿主替换/回滚 grep、`dsh plugin add` 唯一命中 | PRB-21 |
| `log-06-git-clean.txt` | 本单落盘后的 `git status`/`git diff --stat`（仅 probe 新件；并发在途件另注） | 全批 |

> **并发在途件说明**：`log-06-git-clean.txt` 的完整 `git status` 另见 `docs/plan/mig08-closeout.md`（IMPL-08-04 并行施工的未跟踪件，非本单）；本单自身 `git status --porcelain -- docs/probe/pb-3 docs/probe/pb-5` 只显示这两个新目录，`git ls-files --others --exclude-standard docs/probe/pb-3 docs/probe/pb-5` 恰 16 件（两报告＋十四日志），`git diff --stat` 为空，`packages/apps/scripts/templates/package.json` 零改动（日志逐字保留）。
>
> 脱敏说明：日志中的仓根与本机临时路径替换为 `<repo>`/`<tmp>`；其余字节（命令、标准输出、`EXIT=`）逐字保留。日志末尾的「附：探针脚本源」为仓外临时脚本源，不是原始命令输出，已单独标注。
