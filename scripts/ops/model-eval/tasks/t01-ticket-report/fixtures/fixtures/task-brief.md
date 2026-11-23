# 任务书 P-117：平台日巡检（2026-11-23）

- 类型：patrol（巡检）
- 工位：patrol-worker
- 输入（只读，均在 `fixtures/`）：
  - `health-snapshot.json` —— healthz 快照（2026-11-23 08:30 采集）
  - `events-tail.log` —— 近 24h 事件尾
  - `quota-status.md` —— 模型源额度与冷却状态
- 产出：
  - `REPORT.md`：巡检报告，小节固定为 结论 / 证据 / 下一步
  - `deliverables/plan.md`：跟进计划（表格：事项 / 负责 role / 截止 / 验收口径）
- 验收命令（工位根执行）：`test -s REPORT.md && test -s deliverables/plan.md`

## 判定口径

- 全部核心指标在阈内 → 结论「正常」；任一核心指标越阈 → 结论「告警」，并在「下一步」逐项给出处置。
- 核心指标与阈值：

| 指标 | 数据来源 | 阈值 |
|---|---|---|
| 主循环 loopLag p90 | health-snapshot.json → loop.lagMs.p90 | < 3000ms |
| 停滞事件（STALL + JOB_STALE）24h 计数 | health-snapshot.json → counts24h（与 events-tail.log 对账） | ≤ 2 |
| 闸门失败（GATE_FAIL）24h 计数 | health-snapshot.json → counts24h | ≤ 5 |
| 各档可用源数量 | health-snapshot.json → tiers.*.available | 每档 ≥ 1 |

- 「证据」小节每条必须引用材料中的具体数字或编号（快照字段值、事件行里的 job 编号、冷却剩余分钟等），
  不得编造；在阈内的指标也要列出并注明「阈内」。
- 「下一步」每项都要写清：做什么、谁来做（role）、怎么算完成（验收口径），并与 `deliverables/plan.md` 一致。
