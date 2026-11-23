# B · 事件台账摘要（11-17 ～ 11-23）

| 事件 | 本周 | 环比 |
|---|---|---|
| GATE_FAIL | 23 | +9 |
| STALL | 9 | +3 |
| ESCALATE | 14 | +5 |
| REPORT_MISSING | 0 | -11 |

- GATE_FAIL 23 起里 verify:v2 占 15 起，集中在 D-115、D-121、D-124 三张单（同一单重复失败）。
- STALL 9 起中 7 起落在 S2 泳道；worker-mara 名下 5 起。
- 主循环 loopLag p90 本周均值 1870ms，11-22 晚间峰值 4120ms（持续约 40 分钟）。
- 日闭连续 7 天按时完成，无 REPORT 缺失。
