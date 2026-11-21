# 单子验收口径（task-39；提案 task-38 已批）

> 分层：**测试层**=`verify:v2`（代码/契约回归）；**验收层**=功能是否达到任务书意图。本面叠加、
> 不替换四要件/QA/verify；不改契约冻结面、不新增事件词/schema。

## 1. 验收标准 `acceptance_criteria`（每单强制）

在 issue.description 内写以下固定标记块（二选一）：

```md
<!-- acceptance: {"criteria":[{"id":"A1","check":"可测判据","evidence":"证据方式"}],"risk_level":"low","verification_mode":"code"} -->
```

或 fenced：

```md
```acceptance
{"criteria":[{"id":"A1","check":"…","evidence":"…"}],"risk_level":"low"}
```
```

- `criteria[]` 至少 1 条，`check`（可测判据）与 `evidence`（证据方式）必填；缺/坏 JSON=不通过。
- `risk_level=low|medium|high` 决定分级签收：low=`lead-verifier`、medium=`eng0`、high=`producer`。
- `verification_mode=code|report|proposal`；报告/巡检/策划/提案类沿用四要件+QA，不要求功能字段。
- 新单缺失：enforce 模式**拒派/退回**并 ESCALATE 留痕；observe 模式告警放行（先观察）。
- 存量单：`ticket_mirror.created < acceptance.enforce_since` 判 legacy，**不阻塞**、只告警；
  `enforce_since` 首次启动写入 daemon_kv `acceptance.enforce_since`（可 daemon.yaml 覆盖）。

## 2. 派发入口（engine/acceptance/index.ts）

`executeDispatch` 在取到 fresh issue 后调用 `evaluateDispatchAcceptance`：
功能类（非 report/patrol/proposal/pricing 等）× enforce：缺/坏标准 → `DISPATCH_FAIL`（拒派，不占资源）；
类型判定优先按 **scheduler 物化来源** 归一：由 PATROL note `job=` 查 jobs 表 `payload.type`（report/patrol/audit 等），
平台 `issue.type` 落成 `task` 也不误判功能类（task-50 #1488 缺陷）；
legacy/observe → ESCALATE 告警一次（进程内 warned 去重）后放行；off=零行为。

## 3. CLOSE 前验收闸

功能类在相位 6 回收（CLOSE 前）检查最新验收结论（类型同派发闸按 job payload.type 归一）（事件 `APPROVE` note `ACCEPTANCE;status=…`）：
`pass|waived` 放行；`return|need-evidence/缺失` → enforce 下 **HOLD**（不释放泳道/不吊销/不 CLOSE，
下一拍继续评估并 ESCALATE），observe/legacy 告警放行。报告类不适用（四要件+QA 原样）。

## 4. 记录验收结论（复用既有事件词）

```sh
studio-next acceptance record --db <ledger.sqlite> --company <slug> --ticket <单号> \
  --status pass|return|need-evidence|waived --by <验收方> --evidence <证据说明/路径> \
  [--signoff lead-verifier|eng0|producer]
```

- 写一条既有 `APPROVE` 事件（note `ACCEPTANCE;status=…;by=…;evidence=…;signoff=…`），不新增事件词；
  验收方/证据必填（不伪造），不做审批/改单动作；最新一条生效。
- 分级签收：低风险 Lead+verifier；中风险 ENG-0；高风险/契约面/对外=制作人（命令记录 signoff，
  审批流程另行人工执行）。
- 缺失验收标准/结论的单不会被本命令补齐，只记录已有结论。

## 5. 配置/回退

- daemon.yaml：`acceptanceEnforce: off|observe|enforce`（缺省 **off**（兼容存量/既有测试；启用时先 `observe` 观察、稳定后 `enforce`——提案 §7））；
  `acceptanceEnforceSince: <epochMs>` 可显式设定存量线（缺省首次启动时间，daemon_kv 持久化）。
- 回退：`acceptanceEnforce: off` → 派发/CLOSE 零行为（回到现状四要件+QA）；enforce 误伤→先切 observe；
  无需 schema 迁移（只用 daemon_kv/事件/issue.description）。
- 不作：不新增审批层/事件词/表/契约；不要求报告类代码测试；不自动改单/关单；不伪造验收方/证据。

## 6. 本地真机 E2E（CLOSE 全链）

`bash scripts/qa/acceptance-e2e.sh`（需 node 24+bun；临时目录/随机端口，不碰生产）：
本地真实 daemon（localfile + `acceptanceEnforce: enforce`）→ 建「已交付」功能单（description 含
`<!-- acceptance: {...} -->`）→ 缺验收结论 **ACCEPTANCE_HOLD（不 CLOSE）** → `acceptance record --status pass`
→ 下一拍 **CLOSE 放行**。证据落在脚本输出的临时目录（daemon.log/ledger.sqlite/platform）。
localfile `IssueRecord` 自 task-43 F2 起回传 description（测试设施补齐，不改 contract）。

## 7. 验证清单

缺标准新单被拒派且 ESCALATE；legacy 不阻塞；观察模式只告警；功能类缺结论 HOLD、补 pass 后 CLOSE；
报告类原路径不回归；`verify:v2` 全绿；DB 无 schema 变更；验收记录可在台账查询。

---

## 十二、answer-blind DoD 检查项（2026-11-22 增补；前沿 GAMPO 结论落地）

> 依据：arXiv 2609.05531（When Agent Governance Helps）——"answer-blind、逐任务的 definition-of-done 只依据案例自身政策/公开标准，不看隐藏答案"；本仓验收四要件/独立 verifier 已覆盖主体，本项为**质量加固检查单**（不改变现状行为，先执行审计）。

**检查项（验收人/自动审计执行）**
1. `acceptance_criteria` 不含隐藏答案/期望结论/具体产出值（如"报告应写 X"）；只含可测判据（字段齐、命令 exit 0、证据非空、标准可引用）。
2. 验收人**独立**于施工者（verifier 不复用施工会话/上下文）；外部可见证据优先于施工者自述。
3. DoD 与单据类型匹配（task/patrol/report 各自判据），禁止"一刀切模板"覆盖所有类型。
4. 不通过时输出可归因结论（缺哪条判据/证据），禁止"感觉不行"。
5. 红队样本（每单随机抽 0-2 条注入验收审计）：
   - 缺失证据但产出文本漂亮 → 应判退回；
   - 证据与 DoD 不匹配（如要求 REPORT 却给日志）→ 退回；
   - 验收标准含具体答案（"应输出 42"）→ 判 DoD 违规，要求改写；
   - 依赖施工者自述（无外部证据）→ 退回补证；
   - 多单共用同一证据 → 退回。

**落地节奏**：先按本检查单人工执行 10 单统计命中率；稳定后接入验收审计自动检查（另立单）。
