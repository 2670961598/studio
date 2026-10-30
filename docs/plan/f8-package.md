# F8 / P0 / DSF 完整验收包（施工侧呈报件，v1）

> 日期：2026-10-29｜编制：施工侧（宰相代理）｜性质：**验收包，不是 F8 签认、不是 P0 清零宣布、不是 V2 定稿**
> 依据：docs/v2/17 §六/§七、docs/plan/mig08-closeout.md、docs/49（制作人 2026-10-28 开工令与三项决定 A）
> 边界：本件不代填 v2/17 §六.2「DSF 复查核验」列；不把 119 IDs accounted 写成 119 executed；不把外部签认写成已完成。

## 一、制作人决定（2026-10-29）

| 项 | 决定 |
|---|---|
| 决定一 OPS | **A：按 v2/14 提案补形**，补齐 REC-WORK-18 字段并接 PORT-HIST |
| 决定二 NEG | **A：冲 119**（决定时点 112 executed/7 not；终态见 §四：119 IDs accounted，判定件层 executed-pass，V4/V5/V6 全链未证） |
| 决定三 F8/P0 | **A：走完整验收**（本包即施工侧呈报；F8 仍由外部/DSF 签认） |

## 二、施工侧证据（可复算）

| 门 | 命令 | 结果 |
|---|---|---|
| 全 V2 | `mise exec -- bun run verify:v2` | **105 files / 1567 tests**；@ tag `v2-dsf-review-02`（9b8651d）连续 3 次 exit 0（119s/139s/121s） |
| 文档 | `mise exec -- bun run verify:docs` | PASS 6/6，真悬空 0 |
| 边界 | `mise exec -- bun run guard:boundaries` | PASS，929 文件扫描，0 违例（2026-10-30 实测） |
| 秘密扫描 | `mise exec -- node scripts/scan-repo-secrets.mjs` | exit 0，新命中 0；存量基线 20 显式登记 |
| 包级源码类型 | 7 包 `bun run typecheck` | 7/7 exit 0（源码-only，docs/49 裁） |
| F5 端口映射 | `mise exec -- node scripts/verify/port-map-rescan.mjs` | PASS 6/6（13 PORT ↔ 20 文件） |
| crash | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash` | 2 files / 16 tests（CRASH_POINTS=9） |
| API 第 5 出口 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/api` | 2 files / 22 tests（真 HTTP/readers/auth/停机） |
| OPS 补形 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/ops apps/daemon/test/v2/control` | 4 files / 31 tests（REC-WORK-18 落库/幂等） |

## 三、P0 清零判定表（施工列）

| 状态 | 数量 | 说明 |
|---|---|---|
| closed | 19 | 施工侧关闭条件满足，证据在 mig08-closeout §三（K4/K7/P0-6 已按现树重判） |
| partial | 8 | 部分腿关闭、残余明确登记（P0-1 分域权威表未落、P0-9 FC-05 仅构造期） |
| open | 0 | K4/K7 已由 NEG-WRK-07/14 证据关闭 |
| 合计 | 27 | **DSF 核验列 2026-10-30 已填（v2/17 §六.2，DSF-REVIEW-02）**；宣布权归制作人 |

## 四、NEG 状态（冻结命令）

- **119/119 IDs accounted**；判定件层 executed-pass；**V4/V5/V6 全链覆盖未证**（DSF B3）。NEG-ENG-01 已由 CJS 拒绝面通过；not-executed 0。
- **NEG-ENG-01 已收口**：15 包 `exports.require` → `ERR_ESM_ONLY`；ESM import 正例；CJS 包名 require 全拒。
- 证据：`docs/probe/neg-ring-eng/report.md`；**不得读作 119 executed**。
- 已执行新增：EMP-02/04/06/07/08/09（contract 纯判定）、RING-01..05（场景/决策）、ORG-02/05/08（投影）、ENG-02/04/05（YAML 上限/版本 fail-fast/证据通道）、WRK/EVD/RUN（16 tests）。

## 五、GAP-V2-01..18

- closed 5（08/09/12/15/16）｜open 4（01/05/13/18）｜target-not-proven 9（02/03/04/06/07/10/11/14/17）。
- 重点未闭：GAP-V2-01 cost_daily 对账规则未裁；GAP-V2-05 I-17 哈希链未建；GAP-V2-13 ENU-88 仍待定稿；GAP-V2-18 模板生成器仍 v1（再生成会覆盖 v2 模板）。
- 明细与证据：`docs/plan/mig08-closeout.md` §二。

## 六、PB-3 / PB-5（探针未过）

| 批 | 状态 | 原因 |
|---|---|---|
| PB-3 | **未通过** | 入口缺 PB-2/PRB-08；PRB-17 负向；PRB-18/19/20/21 not-executed |
| PB-5 | **未通过** | D12 只读打开＋WriterLease 已落到 runServe/CLI 写命令/rebuild/drill；PRB-14 正面可复测；**PRB-23/PRB-13 仍 not-executed** → 平台读侧契约不成立 |

证据：`docs/probe/pb-3/report.md`、`docs/probe/pb-5/report.md`。

## 七、F8 状态（诚实）

v2/17 §七：F2/F3/F6 通过；F1/F4/F5/F7 条件通过；**F8 已于 2026-10-30 由 DSF 侧复查通过**（DSF-REVIEW-02，§六.2 核验列 27/27 全「过」）。本包交施工侧证据与未决项；V2 定稿标记仍待制作人明示。

## 八、旧测试存废（评审入口）

- 台账：209 个旧 `.test.ts`（＋1 边界脚本）；13 红文件/20 红用例（审计基线 37）；补充登记 §八/§九/§十。
- 退役/重写待裁：panel external 2 件（已退役，替代 API）、help-face 1 条（需删 external 期望）、gen-template 7 条（GAP-V2-18）、引擎 split/hot-reload 模板夹具红、cli timeout 族。
- 判据：plan/04 §1.8.6；判定权归制作人/DSF，施工侧不自判。

## 九、F8 前必须由外部/制作人确认的事项

1. ~~NEG-ENG-01 failed~~ 已由 CJS 拒绝面收口，119/119 passed；F8 不再以此项阻断。
2. **PB-3/PB-5 未过** 是否阻断 F8，还是接受为“目标（未证）”并登记。
3. **GAP-V2-01/05/13/18** 是否允许以 open 状态进入 V2 定稿。
4. ~~P0 partial 8/open 0 的 DSF 核验列逐项结论~~ **已于 2026-10-30 由 DSF 侧填列（27/27 全「过」，见 v2/17 §六.2）**。
5. **旧测试存废**逐项裁决。
6. F8 签认人/日期/适用范围。

## 十、签署（施工侧 + 待外部）

| 角色 | 结论 | 签名/日期 |
|---|---|---|
| 施工侧（宰相代理） | 证据已落盘、可复算；**不建议在 §九 未决前宣布定稿** | 2026-10-29 |
| 制作人 | **确认 F8 签认（2026-10-29）**；保留 P0/PB/旧测试为待裁 | 2026-10-29 |
| DSF/独立验收 | 已填（DSF-REVIEW-02，2026-10-30；见 v2/17 §六.2 与 [f8-dsf-review.md](f8-dsf-review.md)） | 2026-10-30 |
| F8 | **制作人已签认（2026-10-29）**；DSF 复查列仍空（见 f8-signoff.md） | 制作人 2026-10-29 |


## 四之二、NEG 层级声明（DSF B3 整改）

- 119/119 是 **ID accounted**；不是「119 条都按声明验证级通过」。
- 判定件层 executed-pass 成立；但 20 行声明含 V4/V5/V6：
  - 8 行声明 V5（崩溃注入），crash 套件 2 files/16 tests/9 kill 点，不能覆盖 8 行全链；
  - 6 个 ID 为前腿（NEG-RUN-01/SEC-08/MON-01/MON-03/REC-05/MIG-02）；
  - RING-01/02/04 的判定件未接 V6 全链编排器/执行面。
- 因此 F8 只能把 NEG 作为「ID 对账 + 判定件层证据」，不得写成行为面全覆盖。
