# V2 定稿检查单（F8 已过，final 待制作人）

> 2026-10-30｜当前基线：F8 通过 tag `v2-f8-passed`（15063ad）；seatbelt 增量 tag `v2-seatbelt-delta`（待 DSF 增量复查）｜性质：**定稿前检查单，不是 final 宣告**

## 一、定稿前置

| # | 条件 | 现状 |
|---|---|---|
| 1 | DSF F8 复查通过 | **已过**：DSF-REVIEW-02，27/27 核验列；tag `v2-f8-passed` |
| 2 | seatbelt 增量 DSF 复查 | **待审**：tag `v2-seatbelt-delta`，申请件 `f8-dsf-delta-seatbelt.md` |
| 3 | 制作人明示 final | **待明示**；`v2/17` 版本轴仍 draft |
| 4 | P0 施工列/DSF 列 | DSF 27/27 已填；施工列 19/8/0（partial 不阻断 F8，但定稿说明须保留） |
| 5 | PB-3/PB-5 | 未通过；F8 已接受为未证面，定稿须保留“未通过”登记 |
| 6 | 旧测试存废 | 未裁；13 红文件/20 红用例，定稿前须给处置或“保留观察”结论 |
| 7 | V2 全门 | `verify:v2` 1581 tests 全绿；`verify:docs` 6/6 |

## 二、执行顺序（DSF delta 通过后）

1. 记录 DSF 增量结论（`docs/plan/f8-dsf-delta-seatbelt.md` 追加或新件）。
2. 制作人在 `docs/49` 明示 V2 final。
3. 只改**版本轴/状态句**：`draft`→`final`、各卷头注/卷脚、v2/17 §六.1/§七、plan/00 状态。
4. **不回改历史记录件**（mig08-closeout 历史时点、DSF 报告原文、旧 NEG 历史状态）。
5. 复跑 `verify:v2` + `verify:docs`；打 tag `v2-final`。
6. 写 final 说明：F8 通过、P0 19/8/0、PB-3/PB-5 未证、旧测试处置、seatbelt 增量边界。

## 三、不得省略的保留项

- P0 **partial 8** 不能写成“清零”；F8 的 27/27“过”是证据核验，不等于 partial 根因的生产全链闭合。
- PB-3/PB-5 **未通过**；PRB-23/PRB-13 not-executed；WriterLease 只覆盖写面。
- PRB-04 未执行：seatbelt 配置通道不证明内核实际拦截。
- NEG 119 是 ID accounted + 判定件层；V4/V5/V6 全链未证。
- 旧测试红不属 V2 门，但 final 说明须给“保留观察/退役/重写”结论。

## 四、结论

F8 已过，但 **V2 final 还差 DSF 增量复查＋制作人明示**；本检查单不代替签认。
