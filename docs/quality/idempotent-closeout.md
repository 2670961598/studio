# 幂等收口与已有证据原位复验（task-158 / FIX-04；Kimi 总审 P0-04）

> 状态：**最小可验收切片**（制作人已批）。不改契约冻结面/事件词表（无新事件名，复用
> `GATE_FAIL`/`STALL`/`ESCALATE` note + 锚）、不改 `models.yaml`/`daemon.yaml`/契约用例、
> **不动 `engine/gate.ts` 四要件判定**。属「幂等键=bug 修复常规通道」；「原位复验＋补终态」
> 与「Archived 归档终态」为新增状态路径，制作人已批 → 以本页为设计凭据。
> 前置阅读：`docs/17-§2`（七相位）/`§6` 末（收割四要件）、`docs/22-§三.2`（回滚位别）、
> `docs/v2/11 §六 REC-EVD-01`、`docs/52-§十`（哨）、`reviews/2026-11-28/00-overall-review.md §2.1 P0-04`、
> `docs/sentinel-logs/全面Review拆分-2026-11-28.md §2.1 FIX-04`。

## 0. 病根（证据：`studio-dev` 台账 LOCAL-437/442/434/359）

- **双「新单」**：attempt 回退有五个独立写者且互不知情——收割失败面 `failHarvest`、STALL 咬合
  A 面（kill）/B 面（WORKER_DEAD）、boot/周期孤儿扫描、stale-epoch 兜底。全部凭**拍首/扫描快照**
  的「已派发」直写迁移；启动扫描（fire-and-forget）与拍内 B 面并发，各自读到已派发 → 同
  attempt 写两次新单 + 两次断路连击（LOCAL-437/442：`03:52:03.719Z/.806Z`）。
- **有证据却重跑**：401/429 类错误使 `turn_end.completed=false`，但 worker 已落 REPORT（size
  =10847）且真验收闸门 exit=0；四要件缺【终态】→ GATE_FAIL 回新单重派——模型重跑既救不了
  供给错（auth/quota 重跑必再红），又烧一次预算与断路连击。
- **Archived 当未知态**：平台侧归档态不在任何流声明集 → 单级哨逐单 UNKNOWN_STATE
  （LOCAL-359 ×7）、`acceptRevivals` 把 closed 单离开终态误判复活。

## 1. 幂等收口键（`engine/recovery/closeout.ts`）

**键 = `ticket@attempt`**，attempt 取「正在被收口的那次派发」的在册誓号：在途条目 `entry.attempt`
→（无条目时）该单最新工时行 attempt → 0（无账可依退化成单键，仍单键幂等）。事件列里各写者
既有的 attempt 标注口径**不变**（孤儿扫描 `attemptFor` = 下一誓号，属既有审计口径）。

| 层 | 机制 | 治什么 |
| --- | --- | --- |
| **L1 认领表** | `rt.attemptCloseouts`（每单至多一条在册项，同步 `Map` 读写——JS 单线程下认领零 await 即原子）。`claim(ticket, attempt, source)` → `claimed` / `duplicate`（同 attempt 已认领）/ `stale`（旧 attempt 迟到）；新 attempt 覆盖旧项。**胜出后在册保留**（同键此后恒 `duplicate`，直到更高 attempt 顶替；新派发成功时经 `yieldAttemptCloseout` 让位同号/降号旧认领，防止崩溃窗誓号复用卡死）；平台现读或簿记抛错、写失败、平台态已变即**释放**，下次触发可再认领。认领时机：各写者在其首个 await 之前、且在「本可无罪返回」的分叉（stale-epoch 拒收、租约续期返回、快照态非已派发）及无保护同步台账读（`boot-orphan` / `stale-epoch` 的 `attemptFor`）**之后**认领——覆盖 orphan/stale-epoch 面在内均不悬挂认领 | 进程内并发：拍内写者 ∥ 启动/周期扫描 ∥ stale 兜底 |
| **L2 现读复核** | 认领后、落迁移前再读平台：状态已非「已派发」→ `state-changed` 跳过（不迁移/不落事件/不连击）。覆盖 `boot-orphan` / `stale-epoch`（现读平台）与 `stall-worker-dead`（函数首现读、零 await 同口径复核，等级已登记流时生效）；`harvest-fail` 与 `stall-kill` 无 L2 门（持有在途条目，仅靠 L1 认领表） | 跨重启（认领表为空而平台已回退）、外部改态 |

**单一收口出口**：五写者一律 `认领 → [L2 现读复核（boot-orphan / stale-epoch / stall-worker-dead；harvest-fail 与 stall-kill 无 L2 门，仅靠 L1 认领表）] → write（迁移+事件，note 落 closeout 锚
`;closeout=<ticket@attempt>;source=<source>`）→ 仅胜出者断路连击`。锚位：`closeoutAnchored`——落在
task-157 冻结的 errorKind 尾段（`…;errorKind=…;retryable=…`，GATE_FAIL/ESCALATE 尾锚逐字受测）
**之前**，无该尾段（STALL/扫描事件）则直接追加；既有 note 尾契约零改写。重复/过期触发：**不迁移、
不落收口事件、不重复连击**；各自簿记 teardown（工时行收口/会话归档/lane 释放）沿既有顺序照做（注：
`endWorkRecord` 是一次性写面，已 ended 行会抛 `store/work-record:already-ended` 并非幂等；`boot-orphan` /
`stale-epoch` 不写工时行、`stall-worker-dead` 先滤 `status='running'`，`stall-kill` / `harvest-fail`
对本单在途工时行沿既有 teardown 顺序收口，非本轮回归），
并明报：STALL 动作结果 `ok:true, skipped:true` + detail（`收口重复：<键> 已由 <source> 认领——幂等
不重复回退/不重复连击` / `收口过期：…` / `收口跳过：… 平台态已非已派发`；不计 mutation、不进
errors、不触发 quota 探针结算）；孤儿扫描 `OrphanRecoveryResult.duplicates` 计数（原快照过期被
误计 `failed` 的口径一并纠正）；收割失败面入拍 `errors`（「收口重复……幂等跳过」，沿既有孤儿兜底
跳过同款通道）。`source` ∈ `harvest-fail | stall-kill | stall-worker-dead | boot-orphan | stale-epoch`。

B 面附加硬门：**只回退仍=已派发的单**——同拍收割成功（证据就绪）后被看门狗回滚的破坏面一并堵死。

## 2. 已有证据原位复验（`engine/harvest/reverify.ts`）

**资格（不看错误类别，只看证据；比常规路径更严）**：`terminalObserved ∧ 输出非空 ∧ REPORT 落盘
∧ 首闸 exit=0 ∧ 仅缺终态` ∧ 引擎注入了**真验收闸** `reverifyGate`（serve 仅在真验收闸在场时
注入，且**复用同一 `createAcceptanceGateRunner` 实例**独立复跑——同验收口径、同超时，
`acceptanceTimeoutMs` 单值双消费口径不增源）。v0 占位闸门（exit0=模拟）**无补终态资格**——fail-closed，
故既有 fake 栈失败语义零变化。`terminalObserved=false`（未采集≠完成）不具资格。

**程序（零模型调用）**：复验前先 stat REPORT 确认 `size>0` → `reverifyGate` **独立复跑**一次真验收命令，须
`exit=0 ∧ reportExists`（复验后只核查 `reportExists`，不复查 `size`）→ 判过。判过＝补终态 `completed`（**来源=证据复验**）走既有成功链
（迁移证据就绪/预算冲销/断路复位/会话归档）；判不过＝GATE_FAIL 照旧，detail 尾附
`；补终态复验不过（…）`。

**留痕（三处，零放宽）**：① `GATE_PASS` note：`四要件齐（completed=补终态[来源=证据复验；原自述
completed=false；error=…；复验=REPORT size=N；<复验闸 note>]/非空/REPORT/exit0）` + `errorKind` 段；
② 工时记录 `gaps=['终态 completed 缺自述——证据复验补终态（来源=证据复验）']`，`terminal` 仍记
`error`（自述不改写）；③ 批次台账记**原始四要件**（completeness=incomplete，不粉饰）。路由面按
原始 `fourOk=false` 记源失败 + `MODEL_ROUTING_FAILOVER`（供给账目如实，不因补终态掩错）。

## 3. Archived 可识别终态

core `ARCHIVED_STATE='Archived'` / `isArchivedState`（大小写不敏感）；`decide` 在幂等去重/流解析
之后、状态集成员校验与停摆判定之前返 `NOOP_ARCHIVED`（理由码为 core 内部联合，非契约；活动
intent 键已消费的单先落 `DEDUP_NOOP`——两路皆 noop 零行为）；单级哨与巡逻核漂移公式吸收 Archived（C2 声明面双向比对不动——与
127-C 白名单同口径正交）；`acceptRevivals` 对归档单不复活；镜像重决策沿用跳过。

## 4. 不做什么 / 风险

- 不绕四要件：补终态只替代「worker 自述终态」一槽，且要求验收命令**两次真跑**皆绿。
- 不做：已回退但无在途条目的单的「boot 补终态」（更大状态路径，另立单）；孤儿扫描事件 attempt
  标注口径；契约 `DecisionCode` 收录 `NOOP_ARCHIVED`。
- 残险：认领表为进程内态（跨进程靠 L2 现读复核）；`harvest-fail` 与 `stall-kill` 无 L2 现读门（窗口内外部改态属既有行为）。

## 5. 测试

- `apps/daemon/test/v2/engine/closeout-idempotency.test.ts`：T1 重放 LOCAL-437/442（A 扫描先认领
  ∥ 消亡面到达 / B 消亡面先收口 ∥ 扫描旧快照迟到 / C 现读门跨重启改态→释放可再认领）、T2 同拍
  收割失败×B 面（断路阈 2 不误熔断=连击恰一次）、T5 认领冲突纯函数（同键重复/新誓顶替/旧誓
  迟到/读写抛错释放/现读改态零写/未认领不读不写/新派发让位）、T6 重复 CLOSE·重复并发扫描·重复重派对账零副作用、
  T7 崩溃窗誓号复用（重派同号 attempt=1 让位旧认领后照常回退闭环）、T8 认领前后台账抛错（`stall-kill`
  与 `harvest-fail` 调 `endWorkRecord` 瞬时抛错→释放认领，`boot-orphan` 调 `attemptFor` 瞬时抛错→认领前失败不悬挂，下一拍/下次扫描可自愈重试）。
- `apps/daemon/test/v2/engine/terminal-backfill.test.ts`：T3 正例（`external_error`/`incomplete`
  自述 → 补终态 → CLOSE，launch 恰 1 次）＋负例（复验 exit≠0 / REPORT 缺 / 首闸 exit≠0 / 占位闸
  / 未注入复验闸 → GATE_FAIL 原样）＋纯函数（资格判定序、复验闸 fail-closed）。红证：禁用资格门
  等价于关掉补终态后正例与留痕断言 4/9 红。
- `apps/daemon/test/v2/engine/archived-terminal.test.ts`：T4 归档单零派发/零回退/零事件、巡逻零
  UNKNOWN_STATE；在途消亡后被归档亦零回退不重派。
- 夹具 `test/v2/records/fixtures/work-stack.ts` 追加面（既有用例零变化）：`restartWorkStack`
  （同平台/台账/时钟重建引擎=真重启语义）、`extra.gate`（闸门/复验闸注入）、`extra.onLaunch`。
- core `decide.test.ts` / `flows.test.ts` 补 `NOOP_ARCHIVED` / `isArchivedState`；
  `test/engine/unknown-state-sentinel.test.ts` 补 Archived 吸收正测。
