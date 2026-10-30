# F8 · DSF-REVIEW-01 施工侧整改回复

> 日期：2026-10-30｜对象：[f8-dsf-review.md](f8-dsf-review.md)（DSF-REVIEW-01，基线 `8ca3005`）｜性质：**整改回复，不是 F8 新签认**
> 证据基线：代码/测试 `204a6c3`；本回复落盘后的整改提交见 tag `v2-dsf-review-02`（DSF 重审锚点）

## 一、B1 冻门不可复算

- 已在新基线 `204a6c3` 连续 3 次 `verify:v2` exit 0：**105 files / 1567 tests**（177s/121s/117s）。
- 失败根因处理：`verify-docs` 的 `beforeAll` 显式 `60_000` 钩子上限；`writer-lease-cli` 的 holder 子进程守护窗 120s/60s/30s；**未调 `vitest.v2.config.ts` 的 60s testTimeout**、未加 retry/describe 超时覆盖。
- 仍如实登记：11:33/11:41 在旧基线有负载面红；新基线 3 次绿是重取证，不是「旧红改判绿」。
- 待办：以 `v2-dsf-review-02` tag 重跑 3 次并记录。

## 二、B2 P0 施工列重算

已按现树重写 8 行（`mig08-closeout.md`）：
- K4 → closed（NEG-WRK-07＋冻结 `REC-WORK-ACCEPT-MAINT`）
- K7 → closed（NEG-WRK-14）
- P0-6 → closed（NEG-EVD-01/02/03/04/06）
- K6/P0-5/P0-12 → partial 修理由（EVD-02/03、RUN-03 已覆盖；外部锚/网关整树仍 target）
- P0-9 → partial（FC-05 仅构造期，PRB-04 not-executed）
- P0-10 → partial（api-response 已 wired；evidence-export 仍 gap）
- P0-1 → partial（规范面已解；分域权威表未落证）
- 新计数：**closed 19 / partial 8 / open 0**（施工侧；DSF 核验列仍空）

## 三、B3 NEG 层级

- 119 是 ID accounted，不是 119 全行为面通过。
- 判定件层 executed-pass；20 行含 V4/V5/V6，8 行 V5 未被 crash 套件全链覆盖、6 个前腿、RING-01/02/04 未接 V6 全链。
- `f8-package.md` 已加 §四之二；不再写「119/119 executed-pass」作为行为面结论。

## 四、D1–D9

| # | 状态 | 处置 |
|---|---|---|
| D1 | 已修 | f8-package §一 改「决定时点 112/7；终态见 §四」；§四改 ID accounted/判定件层 |
| D2 | 已修 | 统一 **105 files / 1567 tests @ 204a6c3**；tag 后补最终 SHA |
| D3 | 已修 | guard 改「929 文件（2026-10-30 实测）」 |
| D4 | 已修 | PB-5 改「WriterLease 覆盖 runServe＋CLI 写命令/rebuild/drill；读面/panel 未迁」 |
| D5 | 已修 | 上述 8 行 P0 重写；计数 19/8/0 |
| D6 | 部分 | 头注已加 `204a6c3`；tag `v2-dsf-review-02` 后补 tag/SHA |
| D7 | 已修 | `verify-docs.test.ts` beforeAll 60_000 |
| D8 | 已修 | holder 120s/60s/30s；未放宽 testTimeout |
| D9 | 已修 | 统一「ID accounted；层级见 §四之二」 |

## 五、请 DSF 重审

请以 tag `v2-dsf-review-02` 为唯一基线重审 B1/B2/B3 与 D1–D9；施工侧不再在重审期间改功能代码，只做整改。
