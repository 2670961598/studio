# F8 / P0 / DSF 完整验收包（施工侧呈报件，v1）

> 日期：2026-10-29｜编制：施工侧（宰相代理）｜性质：**验收包，不是 F8 签认、不是 P0 清零宣布、不是 V2 定稿**
> 依据：docs/v2/17 §六/§七、docs/plan/mig08-closeout.md、docs/49（制作人 2026-10-28 开工令与三项决定 A）
> 边界：本件不代填 v2/17 §六.2「DSF 复查核验」列；不把 119 IDs accounted 写成 119 executed；不把外部签认写成已完成。

## 一、制作人决定（2026-10-29）

| 项 | 决定 |
|---|---|
| 决定一 OPS | **A：按 v2/14 提案补形**，补齐 REC-WORK-18 字段并接 PORT-HIST |
| 决定二 NEG | **A：冲 119**（已实现 112 条 executed；7 条 not-executed，见 §四） |
| 决定三 F8/P0 | **A：走完整验收**（本包即施工侧呈报；F8 仍由外部/DSF 签认） |

## 二、施工侧证据（可复算）

| 门 | 命令 | 结果 |
|---|---|---|
| 全 V2 | `mise exec -- bun run verify:v2` | **96 files / 1427 tests**；连续 3 次 exit 0（78s/78s/78s） |
| 文档 | `mise exec -- bun run verify:docs` | PASS 6/6，真悬空 0 |
| 边界 | `mise exec -- bun run guard:boundaries` | PASS，900 文件扫描，0 违例 |
| 秘密扫描 | `mise exec -- node scripts/scan-repo-secrets.mjs` | exit 0，新命中 0；存量基线 20 显式登记 |
| 包级源码类型 | 7 包 `bun run typecheck` | 7/7 exit 0（源码-only，docs/49 裁） |
| F5 端口映射 | `mise exec -- node scripts/verify/port-map-rescan.mjs` | PASS 6/6（13 PORT ↔ 20 文件） |
| crash | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/crash` | 2 files / 16 tests（CRASH_POINTS=9） |
| API 第 5 出口 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/api` | 2 files / 22 tests（真 HTTP/readers/auth/停机） |
| OPS 补形 | `mise exec -- bun run test:v2 -- apps/daemon/test/v2/ops apps/daemon/test/v2/control` | 4 files / 31 tests（REC-WORK-18 落库/幂等） |

## 三、P0 清零判定表（施工列）

| 状态 | 数量 | 说明 |
|---|---|---|
| closed | 18 | 施工侧关闭条件满足，证据在 mig08-closeout §三 |
| partial | 7 | 部分腿关闭、残余明确登记 |
| open | 2 | GLM K4（维持性验收）/K7（迟到副作用观察） |
| 合计 | 27 | **DSF 核验列全部留空**；宣布权归制作人/DSF |

## 四、NEG 状态（冻结命令）

- **119/119 IDs accounted**；**executed 112 / not-executed 7 / not-applicable 0**。
- not-executed：RING-01（价值环六要素 harness 未建）、RING-03（缺能力五出口未建）、RING-04（V6·SCEN 组织环未建）、ENG-01（dist/CJS 切换 spike 未立）、ENG-02（YAML bomb 上限未落）、ENG-04（入口 Node 版本 fail-fast 未落）、ENG-05（证据通道受理件未落）。
- 证据：`docs/probe/neg-ring-eng/report.md`；**不得读作 119 executed**。
- 已执行新增：EMP-02/04/06/07/08/09（contract 纯判定，38 tests）、RING-02/05（场景，8 tests）、ORG-02/05/08（投影，22 tests）、WRK/EVD/RUN（16 tests）。

## 五、GAP-V2-01..18

- closed 5（08/09/12/15/16）｜open 4（01/05/13/18）｜target-not-proven 9（02/03/04/06/07/10/11/14/17）。
- 重点未闭：GAP-V2-01 cost_daily 对账规则未裁；GAP-V2-05 I-17 哈希链未建；GAP-V2-13 ENU-88 仍待定稿；GAP-V2-18 模板生成器仍 v1（再生成会覆盖 v2 模板）。
- 明细与证据：`docs/plan/mig08-closeout.md` §二。

## 六、PB-3 / PB-5（探针未过）

| 批 | 状态 | 原因 |
|---|---|---|
| PB-3 | **未通过** | 入口缺 PB-2/PRB-08；PRB-17 负向；PRB-18/19/20/21 not-executed |
| PB-5 | **未通过** | 入口曾缺 D12（现 `openLedgerReadonly` 已落）；PRB-14 正面（第二写者被围栏拒）仍不成立；PRB-23 not-executed → 平台读侧契约不成立 |

证据：`docs/probe/pb-3/report.md`、`docs/probe/pb-5/report.md`。

## 七、F8 状态（诚实）

v2/17 §七：F2/F3/F6 通过；F1/F4/F5/F7 条件通过；**F8 未过**。F8 是外部/独立签认，施工侧不能自签。本包只交施工侧证据与未决项。

## 八、旧测试存废（评审入口）

- 台账：209 个旧 `.test.ts`（＋1 边界脚本）；13 红文件/20 红用例（审计基线 37）；补充登记 §八/§九/§十。
- 退役/重写待裁：panel external 2 件（已退役，替代 API）、help-face 1 条（需删 external 期望）、gen-template 7 条（GAP-V2-18）、引擎 split/hot-reload 模板夹具红、cli timeout 族。
- 判据：plan/04 §1.8.6；判定权归制作人/DSF，施工侧不自判。

## 九、F8 前必须由外部/制作人确认的事项

1. **7 条 NEG not-executed** 是否接受为 target/后续波，还是要求建机制/场景后再签。
2. **PB-3/PB-5 未过** 是否阻断 F8，还是接受为“目标（未证）”并登记。
3. **GAP-V2-01/05/13/18** 是否允许以 open 状态进入 V2 定稿。
4. **P0 partial 7/open 2** 的 DSF 核验列逐项结论。
5. **旧测试存废**逐项裁决。
6. F8 签认人/日期/适用范围。

## 十、签署（施工侧 + 待外部）

| 角色 | 结论 | 签名/日期 |
|---|---|---|
| 施工侧（宰相代理） | 证据已落盘、可复算；**不建议在 §九 未决前宣布定稿** | 2026-10-29 |
| 制作人 | 待填 | |
| DSF/独立验收 | 待填（v2/17 §六.2 核验列逐行） | |
| F8 | **未签认** | |
