# docs/probe · 探针产物索引（PB 批次 × PRB 编号）

> 性质：探针产物**索引与编号统一登记**（不是探针主表、不产出 PASS）。
> 编号唯一源：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §五（PRB-01..26）与 §5.2（v1→v2 映射）。
> 批次唯一源：`docs/v2/17-验证矩阵与追溯.md` §五（PB-1..PB-6、入口/出口/阻断）。
> 状态三值：`executed`｜`not-executed`｜`not-applicable`（v2/12 §5.1）；**负向结论也用 executed**；未执行行只登记「缺什么」，不填「预期通过」。
> 机械校验：`node scripts/verify/probe-ledger.mjs --root <repo>`（编号覆盖、批次归属、PB-2/4/6 台账/证据/指纹、报告状态一致性、旧号残留）。

---

## 一、批次总表（PB → PRB → 产物）

| 批次 | 名称 | PRB（v2/17 §五） | 产物目录 | 状态统计（本索引登记） | 结论（不代读报告） |
|---|---|---|---|---|---|
| PB-1 | 现状宿主差分 | PRB-01/02/03/04/05/06/22 | `docs/probe/pb-1/` | executed 1（PRB-05 负向）｜not-executed 6 | 不通过；不产出能力结论 |
| PB-2 | 投影与秘密 | PRB-07/08/09 | `docs/probe/pb-2/` | executed 1（PRB-07 负向发现）｜not-executed 2 | 不通过；PRB-08 仍是 PB-3 前置阻断 |
| PB-3 | HCL 锚批 | PRB-17/18/19/20/21 | `docs/probe/pb-3/` | executed 1（PRB-17 负向）｜not-executed 4 | 不通过；HCL 级不闭合 |
| PB-4 | 派生与审批 | PRB-10/11/12/15/16 | `docs/probe/pb-4/` | executed 0｜not-executed 5 | 不通过；五项机制运行期未建 |
| PB-5 | 平台与台账 | PRB-13/14/23 | `docs/probe/pb-5/` | executed 1（PRB-14 负向）｜not-executed 2 | 不通过；平台读侧/台账单写不宣称 |
| PB-6 | 备选 CLI | PRB-24/25/26 | `docs/probe/pb-6/` | executed 0｜not-executed 3（PRB-25 形态腿负向发现） | 不通过；三 CLI 形态判定只取到 codex |

**合计（26 行）**：`executed` **4**（PRB-05/07/14/17，均按主表负向列登记）｜`not-executed` **22**｜`not-applicable` **0**。

> 本索引不把 `not-executed` 读成「预期通过」；也不把 `executed（负向）` 读成能力成立（v2/12 §0.5-3）。
> PB-2/4/6 为本次 studio-dev-546 新增产物；PB-1/3/5 为既有产物（本单只读引用，不改写其历史结论）。
> PB-3 报告落盘时记「PRB-07 也未执行」；本次 PB-2 已把 PRB-07 推进到 `executed（负向发现）`，但 PRB-20 仍缺「秘密类别/逻辑引用差分＋部署供给确认」，不得以 PRB-07 代证（v2/12 §5.1 铁律）。

---

## 二、PRB 逐行索引（26 条）

| PRB | 批次 | 目的（主表摘要） | 本仓状态 | 产物 |
|---|---|---|---|---|
| PRB-01 | PB-1 | DSH 插件被加载并承认 | not-executed | `pb-1/report.md` |
| PRB-02 | PB-1 | 工具隐藏对模型强 | not-executed | `pb-1/report.md` |
| PRB-03 | PB-1 | 逐调用判定生效且可记 | not-executed | `pb-1/report.md` |
| PRB-04 | PB-1 | 写域 fail-closed | not-executed | `pb-1/report.md` |
| PRB-05 | PB-1 | 读域是否可收口 | executed（负向） | `pb-1/report.md` |
| PRB-06 | PB-1 | 网络出站未控 | not-executed | `pb-1/report.md` |
| PRB-07 | PB-2 | 秘密不进上下文 | executed（负向发现） | `pb-2/report.md`、`pb-2/log-01-*` |
| PRB-08 | PB-2 | 投影摘要/签名校验 fail-closed | not-executed | `pb-2/report.md`、`pb-2/log-02-*` |
| PRB-09 | PB-2 | 投影与运行时比对 | not-executed | `pb-2/report.md`、`pb-2/log-03-*` |
| PRB-10 | PB-4 | 子 agent 衰减 | not-executed | `pb-4/report.md`、`pb-4/log-01-*` |
| PRB-11 | PB-4 | 审批 fail-closed | not-executed | `pb-4/report.md`、`pb-4/log-02-*` |
| PRB-12 | PB-4 | 崩溃后未知不重试 | not-executed | `pb-4/report.md`、`pb-4/log-03-*` |
| PRB-13 | PB-5 | 平台写回执与未知（写侧） | not-executed | `pb-5/report.md` |
| PRB-14 | PB-5 | 跨进程单写 | executed（负向） | `pb-5/report.md` |
| PRB-15 | PB-4 | 换宿主保任职 | not-executed | `pb-4/report.md`、`pb-4/log-04-*` |
| PRB-16 | PB-4 | 工具呈现三档与 PTC 可达面 | not-executed | `pb-4/report.md`、`pb-4/log-05-*` |
| PRB-17 | PB-3 | HCL-0A 落位闭合 | executed（负向） | `pb-3/report.md` |
| PRB-18 | PB-3 | HCL-1 声明可见＋指纹 | not-executed | `pb-3/report.md` |
| PRB-19 | PB-3 | HCL-2 权限差分单列 | not-executed | `pb-3/report.md` |
| PRB-20 | PB-3 | HCL-2 秘密差分单列 | not-executed | `pb-3/report.md` |
| PRB-21 | PB-3 | HCL-4 宿主内原子替换 | not-executed | `pb-3/report.md` |
| PRB-22 | PB-1 | overlay 可写性 | not-executed | `pb-1/report.md` |
| PRB-23 | PB-5 | 平台读侧未映射状态（原 P-82-01） | not-executed | `pb-5/report.md` |
| PRB-24 | PB-6 | Claude 拟稿点 | not-executed | `pb-6/report.md`、`pb-6/log-01-*` |
| PRB-25 | PB-6 | Codex 拟稿点 | not-executed（形态腿负向发现） | `pb-6/report.md`、`pb-6/log-02-*` |
| PRB-26 | PB-6 | Kimi 拟稿点 | not-executed | `pb-6/report.md`、`pb-6/log-03-*` |

---

## 三、v1→v2 旧号映射（v2/12 §5.2；只作映射，不作主键）

| 旧号 | 新号 | 说明 |
|---|---|---|
| `P-78-01`…`P-78-16` | `PRB-01`…`PRB-16` | 一一对应、同序、同状态 |
| `P-82-01` | `PRB-23` | 平台读侧未映射状态（v1·P-82-01 的 V2 化收口） |
| （新增） | `PRB-17`…`PRB-22` | HCL 锚六行＋overlay（v2/12 §5.3） |
| （新增） | `PRB-24`…`PRB-26` | 备选 CLI 最小探针集（claude/codex/kimi） |

**编号纪律**：`docs/probe/pb-2|pb-4|pb-6/` 内只允许 `PRB-` 主键；旧号只允许出现在本索引的映射表。`scripts/verify/probe-ledger.mjs` 对 PB-2/4/6 产物做旧号残留检查（`P-78-*`/`P-82-*` 命中即红）。

**不并入 PRB 的另一套编号**：`docs/27-探针与真机核实清单.md` §三的 `P-01`…`P-08` 是 **v0.6 适配器探针集**（同一探针单派四家、ProbeRecord 格式），与 v2/12 的 `PRB-` 是两套体系；本索引不把它们映射进 PRB，避免撞号。二者关系：`PRB-` 管宿主承载面真机核实，`P-0x` 管适配器口径/四家矩阵；不得互相代证。

---

## 四、证据格式（PB-2/4/6 机械面）

每个批次目录固定三件：

1. `report.md`：批次入口判定、逐行状态总表、逐行详录、证据索引、结论与不宣布项；头部含 `环境指纹`、`采集时间戳`、`HEAD`。
2. `probe-status.json`：机器可读台账（batch/rows/status/evidence/commands/conclusion|missing/environment.fingerprint）。
3. `log-00-environment.txt` + `log-0N-*.txt`：环境指纹与每行原始命令/原始输出/`EXIT`；头部含 `DATE`/`FINGERPRINT`。

**指纹可复算**：`log-00-environment.txt` 去掉 `FINGERPRINT=` 行后做 sha256，须等于该行值；各探针日志的 `FINGERPRINT=` 须与环境日志一致。

**证据纪律**：探针秘密值/凭据值不入日志；采集器对子进程原始输出做独立泄漏扫描（命中即标 `LEAK_SCAN=FOUND` 并脱敏，同时该行不得记 executed）。
