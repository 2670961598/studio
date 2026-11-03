# PB-4 派生与审批 · 真机探针报告（PRB-10/11/12/15/16）

> **头注**
> - 日期：2026-11-03（探针采集窗口 `2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z` UTC；本报告落盘 2026-11-03）
> - git HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`（分支 `dev`）
> - 工具链/宿主：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜DSH **0.2.1-rc.5**（仓内 `LOCKED_VERSION=0.2.0-rc.2`）｜macOS **26.3** (25D125) arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；本单 studio-dev-546 / ENG-2）
> - 署名（框架注入）：[StudioNext 开发公司·departments/研发部·程序二·1]
> - 性质：**只读探针**；不启 daemon、不改生产码、不写宿主 profile、不发网络、不 git commit；仓库在本工位为只读，产物以 patch 交付
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §5.1/§5.3（PRB-10/11/12/15/16 唯一主表）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-4 批次：入口＝MIG-06 运行时装配；PRB-15 过前不得宣称「换宿主不换任职」）、`docs/17-整体技术设计.md` §2（主循环七相位）与 §6（收割四要件）
> - 口径：状态三值（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；未执行行不填「预期通过」；每行正向＋负向同验；原始日志逐字留存（仅脱敏本机绝对路径 → `<repo>`/`<home>`/`<tmp>`）

---

## 一、批次入口判定（先判门，再谈行）

| 入口要件 | 规范原文 | 实测 | 判定 |
|---|---|---|---|
| MIG-06 运行时装配 | v2/17 §五 PB-4 入口「**MIG-06** 运行时装配（engine 拆分/装配序）」 | `apps/daemon/src/engine/engine.ts`（主循环/崩溃注入点）、`apps/daemon/src/assembly/serve/run.ts`（组合根）、`engine/merge/merge-run.ts`（合并跑续跑）均在；**只证文件面，未证 MIG-06 出口**（`log-03`/`log-04`） | **部分满足（文件面）** |
| 子 agent 衰减运行期 | v2/12 §5.3 PRB-10 | 只有 `packages/adapters/src/bindcard/dsh-card.ts:75,80,227` 的**声明/载体注记**；`dsh --help` 无 subagent/tool-filter/max-depth 旗标（grep exit 1） | **不满足** |
| 审批运行期 | v2/12 §5.3 PRB-11 | `grep "PORT-APPROVAL\|approvalPort\|requestApproval\|approvalTimeout"` **零命中**；`approval` 只出现在流程状态词、bindcard 注记、contract 类型 | **不满足** |
| 崩溃未知不重试运行期 | v2/12 §5.3 PRB-12 | `sideEffectPossible/retryable/reconcile` 只在 core 纯函数失败面；`crashHook` 九点是**主循环/记录面崩溃注入**，不是「工具执行中 kill → 结果不明 + 不重试」 | **不满足** |
| HCL-3 段间替换 | v2/07 §六 HCL-3；v2/12 §5.3 PRB-15 | `HCL-3/handover/switchHost` 命中 contract 记录、测试夹具、merge 续跑；无换宿主交接/旧段围栏运行期 | **不满足** |
| PTC 可达面 | v2/12 §5.3 PRB-16；§1.4 | 只有 `dsh-card.ts:213-217` 声明与 `compile-projection.ts` 注记；`dsh --help` 无 presentation/ptc 旗标；`dsh-agent-tool-presentation` 只命中卡片 | **不满足** |

**结论**：PB-4 **批次入口只有 MIG-06 文件面满足，五项机制运行期均未建/未接线**。按 v2/17 §五与 v2/12 §5.1，本报告：

1. **不宣布 PB-4 通过**；
2. **不宣布子 agent 衰减、审批 fail-closed、崩溃未知不重试、换宿主保任职、PTC 边界任一成立**；
3. **PRB-15 未过 → 不得宣称「换宿主不换任职」已证**（v2/17 §五阻断关系）。

---

## 二、逐行判定（状态总表）

- 环境指纹：`sha256:daccda4e3385594c6a07b3c63fd79aa13f40f9c3100bbf83d4605fef43ad545a`
- 采集时间戳：`2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z`（UTC）
- HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`

| ID | 本行状态 | 方向 | 证据（原始日志） |
|---|---|---|---|
| PRB-10 | **not-executed** | 仅取到声明面 | `log-01-prb-10-subagent-decay.txt` |
| PRB-11 | **not-executed** | 仅取到流程/契约面 | `log-02-prb-11-approval.txt` |
| PRB-12 | **not-executed** | 仅取到字段/崩溃注入面 | `log-03-prb-12-crash-unknown.txt` |
| PRB-15 | **not-executed** | 仅取到契约/续跑面 | `log-04-prb-15-host-switch.txt` |
| PRB-16 | **not-executed** | 仅取到声明/配置面 | `log-05-prb-16-ptc.txt` |

**统计（5 行）**：`executed` **0**｜`not-executed` **5**（PRB-10/11/12/15/16）｜`not-applicable` **0**。

> 与 v2/12 §5.3 主表现状对账：主表五行均记「未执行」；本批维持 `not-executed`，不把声明/静态侦察升为整行证据（v2/12 §0.5-3）。主表状态回写属文档面，按「不改契约面」边界不在本单自行改写。

---

## 三、逐行详录

### PRB-10 · 子 agent 衰减（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝父 2 工具子给 3；正向＝拒 spawn 或裁到 2；负向＝子越界工具被拒；锚＝派生树规则 3。
- **本行状态：`not-executed`**。无真实宿主插件/会话，无法起父子 agent 做工具集对照。
- **已做（静态面，不构成本行证据）**——`log-01-prb-10-subagent-decay.txt`：
  - `grep -rn "subagent\|attenuat"` 只命中 `packages/adapters/src/bindcard/dsh-card.ts:75`（`faceId: 'in-process-subagent-decay'`）、`:80`（`note: 'dsh-subagent preset+toolFilter+maxDepth...'`）、`:227`（载体声明）与 `dsh.ts:426` 注释（subagent/fork 会话不可 adopt）；
  - `dsh --help` 原文无 subagent/tool-filter/max-depth 旗标；`dsh --help | grep -in "subagent\|tool-filter\|max-depth"` **EXIT=1**。
- **缺什么 / target**：DSH 最小插件（preset/toolFilter/maxDepth 载体）＋真实宿主会话＋父 2 工具/子 3 工具的 spawn 对照＋子越界工具拒绝观测；结论只入 BIND-CLI-* 卡，不升为能力证明。

### PRB-11 · 审批 fail-closed（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝ask 且无人应答；正向＝超时拒绝；负向＝有人应答通过且应答者身份可核；锚＝审批段。
- **本行状态：`not-executed`**。无审批端口/运行期审批流，无法造「ask 无人应答→超时拒绝」。
- **已做（静态面，不构成本行证据）**——`log-02-prb-11-approval.txt`：
  - `grep -rn "approval" packages/adapters/src/bindcard packages/core/src apps/daemon/src/engine` 命中：流程状态词（`core/flows.ts` 待批/approval 锚）、`decide.ts` 的 `submit_approval` 动作、`work/transition.ts` 的 approvals 计数、`dsh-card.ts:221` 的 `dsh-user-approval（ask/never，fail-closed）` 声明；
  - `grep -rn "PORT-APPROVAL\|approvalPort\|requestApproval\|approval-timeout\|approvalTimeout"` **零命中（EXIT=1）**；
  - `grep -rn "approval" packages/contract/src/ports` 只命中类型/注释（`approvalRef`/`ApprovalStamp`/`approval` 段名），**无运行期实现**。
- **缺什么 / target**：审批端口实现＋ask 超时拒绝路径＋应答者身份可核证据＋无人应答的负向对照；审批流未接（v2/12 未证清单）。

### PRB-12 · 崩溃后未知不重试（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝工具执行中 kill；正向＝结果标「不明」＋不重试；负向＝对账后方可结清；锚＝EXEC-03/05。
- **本行状态：`not-executed`**。无工具执行运行期，无法在「工具执行中」kill 并观察结果未知/不重试。
- **已做（静态面，不构成本行证据）**——`log-03-prb-12-crash-unknown.txt`：
  - `sideEffectPossible/retryable/reconcile` 只命中 core 纯函数失败面（`prm/spec.ts:55-57`、`capability-gap.ts:232-234`）与 `costclose.reconcileDate`；**没有工具结果「不明」运行期写口**；
  - `crashHook` 九点（`engine/crash-points.ts`）是**主循环/记录面崩溃注入测试缝**（dispatch-reserved/launched、harvest-verdict、heartbeat-write、shutdown-drain、records-commit、backup-snapshot、projection-rebuild、exclusion-report），不是「工具执行中 kill」；
  - `reconcileProjection` 是记录面↔事件面对账，不是工具副作用对账，不得代证。
- **缺什么 / target**：工具执行运行期＋kill 注入＋结果 `unknown` 记录（owner＋复查期）＋不自动重试＋对账后结清；EXEC-03/05 判定件层。

### PRB-15 · 换宿主保任职（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝同一任职换 CLI 出工；正向＝任职/责任链不断、新段；负向＝旧段围栏写入生效；锚＝HCL-3 段间替换。
- **本行状态：`not-executed`**。无 HCL-3 换宿主运行期，无法做「同一任职换 CLI」与旧段围栏写入。
- **已做（静态面，不构成本行证据）**——`log-04-prb-15-host-switch.txt`：
  - `grep -rn "HCL-3\|handover\|switchHost\|host-switch"` 命中 contract 记录（REC-LIFE/REC-WORK 交接字段）、测试夹具、`studio-tools` 的 `work.handoverSubmit` 工具名；**无换宿主交接/旧段围栏运行期实现**；
  - `grep -rn "HCL-3" docs/v2` 只命中规范定义（07 §六/HCL-3 判据、12 §5.3 PRB-15 行、17 §五锚）；
  - `resumeWithSession/session_resume` 命中 merge 续跑与 relay-resume（**同宿主原会话续跑**），不是「换宿主保任职」，不得代证。
- **缺什么 / target**：HCL-3 段间替换运行期（旧段安全结束/暂停→交接包→新段锁新计划→旧段围栏→迟到副作用对账）＋同一任职换 CLI 的真实出工证据；**PRB-15 过前不得宣称「换宿主不换任职」已证**。

### PRB-16 · 工具呈现三档与 PTC 可达面（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝native/ptc/both 起同 profile，尝试越界工具/直读文件/联网/起子进程；正向＝native 与白名单一致、ptc 下可达集外不可达；负向＝代码绕过工具面直碰文件/网络/进程须测、both 下两档策略互覆；锚＝PTC 边界（§1.4）。
- **本行状态：`not-executed`**。无 native/ptc/both 三档运行期与真实会话，无法做越界可达面探测。
- **已做（静态面，不构成本行证据）**——`log-05-prb-16-ptc.txt`：
  - `grep -rn "PTC\|ptc\|tool-presentation"` 只命中 `compile-projection.ts:36,131,135` 的「PTC 默认 forbidden」注记、`dsh-card.ts:213-217` 的载体声明（`dsh-agent-tool-presentation（native/ptc/both）`，note 明写「默认档 native（＝ptc 禁用）；启用须单列可达工具子集与 OS 级边界取证（PRB-16）」）与 bindcard 测试断言（`PTC 未证`）；
  - `dsh --help` 只有 `--profile`，**无 presentation/ptc 旗标**；
  - `grep -rn "dsh-agent-tool-presentation"` 只命中卡片字符串，**无 profile/插件实现**。
- **缺什么 / target**：三档 profile 的真实启动＋越界工具/直读文件/联网/起子进程的负向探测＋both 档策略互覆观测；PTC 可达面未证前一律按不支持（v2/12 §1.4）。

---

## 四、证据索引

| 文件 | 内容 | 支撑行 |
|---|---|---|
| `log-00-environment.txt` | DATE/HEAD/HOST/NODE/BUN/DSH/CODEX/CLAUDE/KIMI、仓库只读、git 不可用、8791/8788/8789 健康码、环境指纹 | 全批环境 |
| `log-01-prb-10-subagent-decay.txt` | subagent/attenuation 静态命中、`dsh --help` 原文、subagent 旗标 grep | PRB-10 |
| `log-02-prb-11-approval.txt` | approval 流程/卡片/契约命中、审批端口零命中 | PRB-11 |
| `log-03-prb-12-crash-unknown.txt` | 失败面字段命中、crashHook 九点、记录面对账区分 | PRB-12 |
| `log-04-prb-15-host-switch.txt` | HCL-3/handover 命中、规范定义、merge 续跑区分 | PRB-15 |
| `log-05-prb-16-ptc.txt` | PTC/工具呈现声明、`dsh --help` profile 面、载体零实现 | PRB-16 |

**复现命令**（仓根；本工位仓库只读，采集器输出目录用 `--out` 指到可写交付区）：

```bash
mise exec -- bun scripts/probe/run-pb246.mjs --repo <repo> --out <docs/probe> --batch 4
node scripts/verify/probe-ledger.mjs --root <repo>
```

---

## 五、结论与不宣布项

1. **PB-4 不通过**：MIG-06 只有文件面，五项机制均无运行期实现/接线。
2. **PRB-10 未执行**：只有 dsh-card 声明；无父子 agent 工具集对照。
3. **PRB-11 未执行**：审批端口零实现；无 ask 超时拒绝与应答者身份核验。
4. **PRB-12 未执行**：crashHook 是主循环/记录面注入缝，不是工具执行中 kill；无「结果不明＋不重试」运行期写口。
5. **PRB-15 未执行**：HCL-3 换宿主交接/旧段围栏未建；merge/relay 续跑不得代证；**不得宣称「换宿主不换任职」已证**。
6. **PRB-16 未执行**：PTC 三档未建；卡片声明与投影注记不得代证可达面。
7. 本报告不产出 PASS、不产出能力结论；探针通过只升到「该版本该形态观察一次」（v2/12 §0.5-3）。
