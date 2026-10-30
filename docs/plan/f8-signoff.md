# F8 签认记录（制作人）

> 日期：2026-10-29｜性质：制作人对 F8 的签认记录；不是 DSF 复查列的代填，不是 V2 版本轴的自动 final 声明。

## 一、签认依据

制作人于 2026-10-29 在会话中确认 **F8 签认**。施工侧呈报件与证据：

- [f8-package.md](f8-package.md)（F8/P0/DSF 完整验收包，v1）
- `verify:v2` **104 files / 1561 tests**，连续 3 次 exit 0（114s/168s/100s）
- NEG **119/119 executed-pass**（含 CJS 拒绝面、RING 场景、OPS 补形）
- OPS 补形 A：REC-WORK-18 全字段经 PORT-HIST
- API 第 5 出口：runServe 装配 createApiApp/readers/auth/node:http
- D12 只读打开＋WriterLease；PRB-14 正面可复测
- `verify:docs` 6/6；`guard` 0 违例；`scan-repo-secrets` 新 0

## 二、签认范围与保留项

| 项 | 状态 |
|---|---|
| F8 制作人签认 | **已确认（2026-10-29）** |
| DSF 复查核验列（v2/17 §六.2） | **仍空待填**；本记录不代填 |
| P0 清零 | 施工列 closed 18/partial 7/open 2；未宣布清零 |
| PB-3 | 未通过（缺 PB-2/PRB-08） |
| PB-5 | 未通过（PRB-23/PRB-13 not-executed；WriterLease 仅 runServe） |
| 旧测试存废 | 未裁 |
| V2 版本轴 | 不因本记录自动改 `final`；v2/17 §六.1 仍要求 DSF 复查列填满 |

## 三、效力

- 本记录只证明「制作人确认 F8 签认」这一事实，不冒充 DSF 独立复查，不宣布 P0 清零，不把 V2 标为定稿。
- 若制作人同时明示指定 DSF 侧或本人代行 DSF 核验列，需在 v2/17 §六.2 逐行填写并另行登记；在此之前 F8 记录保持「制作人签认，DSF 列待填」。
