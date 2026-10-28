# 旧测试台账（old-tests-ledger）· MIG-02

> 版本：**v1**｜2026-10-28｜编写：MIG-02 施工代理（DeepSeek-V41-Flash）｜性质：**旧套件观察位登记件**——旧测试**不是施工门**（plan/04 §1.8、docs/49 裁决 3「V2 重构自写新测试、旧测试不作施工门」），本台账只保证「逐文件有归属」，不赋予旧套件绿/红任何放行效力。
> 依据：plan/04 §1.8.3（台账八列格式）/§1.8.4（机械校验五条）/§1.8.6（V2 后存废门）/§1.9（新旧分界）；plan/03 §三（MIG-02 范围与出口）；plan/05 IMPL-02-02；docs/86 B5（37 红事实）；docs/88 §四.2；docs/90 §三 R5（37/20 数值口径）；docs/49 2026-10-28 开工令 §3/§8。
> 机械校验：`mise exec -- node scripts/verify/old-test-ledger.mjs`（本台账即受检物：缺行/多行/空理由/无归属/无声删除一律 exit 1）。
> 只追加/更正，不删行（plan/04 §1.8.4）；文件真要删，先把处置改「退役」并记删除单/替代覆盖/理由，行保留。

---

## 〇、数据源与口径（必读）

| 项 | 值 | 说明 |
|---|---|---|
| 数据源 | `/tmp/studio-next-vitest.json` | 2026-10-28 **16:28** 全量 vitest JSON 报告（`vitest run --reporter=json`） |
| vitest 文件数 | **210 files** | `.test.ts` **209** ＋ 口径差 **1**（`scripts/guards/boundaries.test.mjs`，见 §三） |
| 用例数 | **2976 tests** | `.test.ts` 内 2954 ＋ 边界自检件 22 |
| 失败用例 | **20 failed** | 逐条见 §四（19 timeout ＋ 1 断言） |
| 失败文件 | **13 failed files** | 逐文件见 §四 |
| 旧套件退出码 | **exit 1** | 旧套件非门：红不阻塞 V2 波门（plan/04 §1.8.5） |
| 施工门 | **不是** | V2 门＝`verify:v2`（guard＋typecheck＋typecheck:v2＋test:v2＋台账校验） |

**「审计基线 37 / 实测 20」说明（R5 口径）**：docs/86 B5 与 plan/04 §1.8.2 记的旧测试债是 **审计基线 37 failed**（另记 13 failed files / 2976 tests）；本台账实测（2026-10-28 16:28）为 **20 failed / 13 failed files / 210 files / 2976 tests**。两者只在 **failed 用例数** 上差（37→20），文件总数与失败文件数完全一致——差异属 **timeout/flaky 家族**的时序波动（docs/90 §三 R5 已登记为「证据数值口径」项，不是文本冲突）。**本台账一律按实测 20 登记**：不把 37 写成实测值，也不把 20 说成 37；37 只作为审计基线保留在对照位，两条都不删。

**失败类判定口径**：JSON 报告里 19 条 failed 的 `failureMessages` 被收敛为 `Error: STACK_TRACE_ERROR`（stackTrace 省略），故按**可复核的物理证据**判定——每条失败用例的实测耗时均 > 5000ms 默认超时（5077–12440ms），与 docs/86 B5 记载的「5s timeout 家族（CLI spawn / fs.watch）」同族，判 **timeout**；`packages/adapters/test/claude.test.ts` 的失败是 `AssertionError: expected 8 to be greater than or equal to 250`（耗时 126ms），判 **断言**。**不臆造错误文本**：来源为 JSON 的 duration ＋ failureMessages 摘要。

---

## 一、处置 / 责任波 / 理由三列的口径

- **处置**：本波**全部「保留观察」**——MIG-02 不修旧测试、不改写、不删除（plan/03 §三「不碰生产码、不修改旧测试文件」）；四选一取值域＝保留观察 / 重写 / 退役 / 真缺陷（plan/04 §1.8.3），后三种须立单或在 V2 后存废门裁，本波一条不填。
- **责任波**：全部 **「V2 后存废门」**——旧测试存废由制作人/DSF 在 V2 完成后判（覆盖/维护成本/行为是否仍成立三判据，plan/04 §1.8.6），施工方不自判。
- **理由**：每行必须写明「观察位、非门」——旧套件的绿/红都不属 V2 任何一层（v2/17 §1.3），不得被引用为能力证据或放行依据。
- **状态列**：绿/红取自 2026-10-28 16:28 实测；红行必须能在 §四找到**逐条**红用例归属（本台账 13 红文件 / 20 红用例，数字与 §〇 一致）。
- **无「未跑」行**：本次全量跑覆盖 209/209，故无 `n/a` 用例数行；后续若只跑触及面子集，新增行须写 `n/a` ＋原因（本波未产生此类行）。

---

## 二、逐文件台账（209 行 = `.test.ts` 全量）

生成口径同 plan/04 §1.8.3-补：`find apps/daemon/test packages/*/test apps/*/src packages/*/src -name '*.test.ts' | sort`（剔除 `test/v2/**` 后 209 件）；JSON 逐文件断言数与 `find` 清单**逐项相等**（209↔209，0 缺 0 多）。

<!-- ledger:files:start -->
| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/boot/src/boot.test.ts` | 绿 | 35/0 | — | 保留观察 | V2 后存废门 | boot 旧单测；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/inflight-takeover.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/serve-channels.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/serve-config.test.ts` | 绿 | 28/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/serve-hrmatrix.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/serve-notify.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/assembly/serve-tier.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/create-serve-face.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条真 bin 进程用例超 5s（实测 5684/9789ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/help-face.test.ts` | 绿 | 28/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/industry-templates.e2e.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/jobs-cli.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条 CLI 分诊用例超 5s（实测 5236/7568ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/next-steps.test.ts` | 红 | 6/2 | timeout | 保留观察 | V2 后存废门 | 2 条 company create 指引用例超 5s（实测 5347/5238ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/overview-reports-scan.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/structure-check.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条 company check 用例超 5s（实测 9493/7271ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/taiga-cure.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/cli/usage-contract.test.ts` | 红 | 5/2 | timeout | 保留观察 | V2 后存废门 | 2 条旗标同义用例超 5s（实测 5420/7497ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/control/hot-reload.test.ts` | 绿 | 33/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/control/stop-channel.test.ts` | 红 | 8/1 | timeout | 保留观察 | V2 后存废门 | stop 控制面真进程用例超 5s（实测 5077ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/breaker-half-open.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/budget-gate.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/cost-close/close.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/cost-guard/consume.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/cost-guard/seams.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/cost-guard/source.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/crash-injection.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/directive/acceptance.e2e.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/directive/directive.e2e.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/directive/flows.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/directive/parse-qualify.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/e2e.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/freeze-repro.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/gated-platform.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/harvest-recon.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/hrsync/hrsync.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/hrsync/people-change-source.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/hrsync/people-change.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/hrsync/taiga-face.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/instructions-channel.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/instructions-store.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/job-output.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/jobs-lifecycle.test.ts` | 绿 | 18/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/jobs/freshness.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/jobs/harvest-recon-r4.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/jobs/schedule-report-priority.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/jobs/sentinel.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/judge/judge-invoke.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/judge/sites129.test.ts` | 绿 | 26/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/merge/merge-conflict.e2e.test.ts` | 绿 | 1/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/merge/merge-lease.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/merge/merge-run.e2e.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/merge/merge-run.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/noop-observability.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/notify/relay.test.ts` | 绿 | 11/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/notify/route.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/pricing/pricing.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/read-tiers.e2e.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/read-tiers.test.ts` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/rooms/room-duty.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/scheduler.test.ts` | 绿 | 36/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/sentinel/events-index-job-anchor.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/sources.test.ts` | 绿 | 28/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/split/directive.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/split/split.e2e.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/split/suggest.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/stall-rescan-revival.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/stall-response.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/starvation-revival.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/tier/model-tier.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/todoqueue/person-gate-queue.test.ts` | 绿 | 21/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/typeflows.e2e.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/typeflows.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/typeflows/proposal-typeflow.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/unknown-state-sentinel.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/wake/mention-intents.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/wake/relay-resume-intents.test.ts` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/wake/webhook-datachange-intents.test.ts` | 绿 | 20/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/worker-key-lifecycle.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/engine/worker-key.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/cutover.test.ts` | 绿 | 21/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/evolution-e2e.test.ts` | 绿 | 20/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/evolve-guard.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/gray.test.ts` | 绿 | 27/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/postmortem.test.ts` | 绿 | 24/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/evolve/sandbox.test.ts` | 绿 | 26/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/panel-inbox-align.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `apps/daemon/test/panel-judge-align.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | daemon 旧回归面（引擎/CLI/控制/进化）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/agentconfig-judge.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/agentconfig-tier.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/agentconfig.test.ts` | 绿 | 28/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/claude.test.ts` | 红 | 26/1 | 断言 | 保留观察 | V2 后存废门 | 断言差：graceMs 后 SIGKILL 用例期望等待 ≥250ms、实测 8ms 即返回；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/codex.test.ts` | 绿 | 25/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/dsh-agents-md-channel.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/dsh-env-whitelist.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/dsh-judge.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/dsh.test.ts` | 绿 | 33/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/fake-cli.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/kimi.test.ts` | 绿 | 27/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/registry.test.ts` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/seatbelt.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/adapters/test/streams.test.ts` | 绿 | 25/0 | — | 保留观察 | V2 后存废门 | adapters 旧回归面（executor 适配器）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/aiws.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/company-validate-cli.test.ts` | 红 | 10/2 | timeout | 保留观察 | V2 后存废门 | 2 条 spawn 用例超 5s 默认超时（实测 5774/5247ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/cost-guard.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/create.test.ts` | 红 | 16/1 | timeout | 保留观察 | V2 后存废门 | spawn 用例超 5s 默认超时（实测 10477ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/dependencies.test.ts` | 绿 | 27/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/deps-cases.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/dir-cases.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/gen-template.test.ts` | 绿 | 18/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/git-import.test.ts` | 红 | 18/1 | timeout | 保留观察 | V2 后存废门 | git 导入 CLI 用例超 5s（实测 6258ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/groups.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/hooks.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/industry-templates.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/init.test.ts` | 红 | 9/2 | timeout | 保留观察 | V2 后存废门 | 2 条 init→validate 全链用例超 5s（实测 9311/7243ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/jobs-loading.test.ts` | 绿 | 32/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/multifile.test.ts` | 绿 | 32/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/namer.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/repo-validate.test.ts` | 绿 | 45/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/reports.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/security-baseline.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/state-hygiene.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/company/test/workflows.test.ts` | 绿 | 33/0 | — | 保留观察 | V2 后存废门 | company 旧回归面（公司目录/CLI）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/contract/test/contract.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | contract 旧回归面（契约 case 标尺）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/contract/test/schemas.test.ts` | 绿 | 34/0 | — | 保留观察 | V2 后存废门 | contract 旧回归面（契约 case 标尺）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/breaker.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/budget.test.ts` | 绿 | 50/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/costclose.test.ts` | 绿 | 19/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/costguard.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/decide.test.ts` | 绿 | 60/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/dispositions.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/evolution.test.ts` | 绿 | 54/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/flows.test.ts` | 绿 | 27/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/golden.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/hrsync.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/judge-gates.test.ts` | 绿 | 23/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/judge.test.ts` | 绿 | 20/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/models.test.ts` | 绿 | 40/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/pricing.test.ts` | 绿 | 26/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/queue.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/core/test/secrets.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | core 旧单测（纯逻辑，零 IO）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/dsh-bridge/test/bridge.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | dsh-bridge 旧冒烟；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/gateway/src/actions.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | gateway 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/gateway/src/gateway.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | gateway 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/gateway/src/signature.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | gateway 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/gateway/src/wkey.test.ts` | 绿 | 20/0 | — | 保留观察 | V2 后存废门 | gateway 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/localplatform/src/activity.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | localplatform 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/localplatform/src/facets.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | localplatform 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/localplatform/src/lifecycle.test.ts` | 绿 | 16/0 | — | 保留观察 | V2 后存废门 | localplatform 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/localplatform/src/plat-cases.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | localplatform 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/adapter.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/broadcast.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/format.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/hr-face.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/mentions.test.ts` | 绿 | 31/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/matrix/src/provision.test.ts` | 绿 | 25/0 | — | 保留观察 | V2 后存废门 | matrix 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/alerts-costs.test.ts` | 绿 | 18/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/external-serve.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/external.test.ts` | 绿 | 32/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/inbox.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/judge.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-json.test.ts` | 绿 | 14/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-monthly.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-reload.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-reports.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-serve.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview-ui.test.ts` | 绿 | 11/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/overview.test.ts` | 绿 | 28/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/panel.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/serve.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/shell-static.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/ui-feed.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | panel 旧回归面（含 ui 资产语法闸）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/panel/test/ui-syntax-gate.test.ts` | 红 | 0/1 | timeout | 保留观察 | V2 后存废门 | 全量 ui 资产 node --check 超 5s（实测 6070ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/prompt/test/assemble.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | prompt 旧回归面（L0-L5 组装）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/prompt/test/brief.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | prompt 旧回归面（L0-L5 组装）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/prompt/test/layers.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | prompt 旧回归面（L0-L5 组装）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/prompt/test/sanitize.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | prompt 旧回归面（L0-L5 组装）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/prompt/test/trim.test.ts` | 绿 | 12/0 | — | 保留观察 | V2 后存废门 | prompt 旧回归面（L0-L5 组装）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/drill.test.ts` | 红 | 5/1 | timeout | 保留观察 | V2 后存废门 | ledger drill 用例超 5s（实测 12440ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/ledger.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/perf.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/rebuild.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v11-usage.test.ts` | 绿 | 7/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v12-cost.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v2-tables.test.ts` | 绿 | 25/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v3-jobs.test.ts` | 绿 | 15/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v4-debts.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v5-candidates.test.ts` | 绿 | 29/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v6-reports.test.ts` | 绿 | 19/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v7-hr-sync.test.ts` | 绿 | 10/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v8-model.test.ts` | 绿 | 3/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v8-todo-queue.test.ts` | 绿 | 8/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/store/test/v9-pricing.test.ts` | 绿 | 26/0 | — | 保留观察 | V2 后存废门 | store 旧回归面（账本/迁移/重建）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/studio-tools/src/server.test.ts` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | studio-tools 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/studio-tools/src/tools.test.ts` | 绿 | 21/0 | — | 保留观察 | V2 后存废门 | studio-tools 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/activity.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/comments.test.ts` | 绿 | 4/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/context.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/factory/factory.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/fields.test.ts` | 绿 | 13/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/guards-links.test.ts` | 绿 | 9/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/issues.test.ts` | 绿 | 25/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/kb.test.ts` | 绿 | 6/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/onboard.test.ts` | 绿 | 2/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/src/transport/http.test.ts` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/taiga/test/memberships.test.ts` | 绿 | 11/0 | — | 保留观察 | V2 后存废门 | taiga 旧回归面；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/yt/src/activity.test.ts` | 绿 | 18/0 | — | 保留观察 | V2 后存废门 | yt 旧回归面（YouTrack 客户端）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/yt/src/facets.test.ts` | 绿 | 17/0 | — | 保留观察 | V2 后存废门 | yt 旧回归面（YouTrack 客户端）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/yt/src/http.test.ts` | 绿 | 18/0 | — | 保留观察 | V2 后存废门 | yt 旧回归面（YouTrack 客户端）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/yt/src/issues.test.ts` | 绿 | 21/0 | — | 保留观察 | V2 后存废门 | yt 旧回归面（YouTrack 客户端）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
| `packages/yt/src/plat-cases.test.ts` | 绿 | 5/0 | — | 保留观察 | V2 后存废门 | yt 旧回归面（YouTrack 客户端）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
<!-- ledger:files:end -->

---

## 三、口径差 1 行（vitest 第 210 件，非 `.test.ts` 命名）

vitest 的 `include` 默认还会收 `.test.mjs`——`scripts/guards/boundaries.test.mjs`（分层宪法门禁自检件，22 用例）即「210 files vs 209 `.test.ts`」的那 1 件。它**不是** `.test.ts`，不占 209 名额，但**属于旧套件**（v2-start tag 之前已有），故单列一行、同样登记处置。

<!-- ledger:delta:start -->
| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `scripts/guards/boundaries.test.mjs` | 绿 | 22/0 | — | 保留观察 | V2 后存废门 | 分层宪法门禁自检件（vitest 计入、非 .test.ts 命名）；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |
<!-- ledger:delta:end -->

---

## 四、13 个红文件行 × 20 条红用例清单

本节是 §二红行的**逐条展开**（文件｜用例名｜失败类｜处置｜责任波｜理由）。红文件行（8 列）与 §二对应行一致；红用例行（6 列）共 **20 条**，等于 §〇 的 `20 failed`，也等于 13 个文件在 §二的「败」列之和（20）。

<!-- ledger:red:start -->
### 红文件 1/13：`apps/daemon/test/cli/create-serve-face.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/cli/create-serve-face.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条真 bin 进程用例超 5s（实测 5684/9789ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/cli/create-serve-face.test.ts` | S4A：create 顺产骨架（真 bin 进程端到端） 首跑：daemon.yaml 落盘且往返解析通过；--json serveConfig.status=created | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5684ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `apps/daemon/test/cli/create-serve-face.test.ts` | S4A：create 顺产骨架（真 bin 进程端到端） 再跑=kept 不覆盖：手改一行后重跑，手改内容原样保留 + status=kept | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 9789ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条真 bin 进程用例超 5s（实测 5684/9789ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 2/13：`apps/daemon/test/cli/jobs-cli.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/cli/jobs-cli.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条 CLI 分诊用例超 5s（实测 5236/7568ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/cli/jobs-cli.test.ts` | jobs list（只读分诊面） 库不存在拒收指路（E15②同款：不代建库） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5236ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `apps/daemon/test/cli/jobs-cli.test.ts` | jobs catchup（手动补跑——只挪槽不派工） 缺 --job / 库不存在 → 用法面与拒收面 | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 7568ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条 CLI 分诊用例超 5s（实测 5236/7568ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 3/13：`apps/daemon/test/cli/next-steps.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/cli/next-steps.test.ts` | 红 | 6/2 | timeout | 保留观察 | V2 后存废门 | 2 条 company create 指引用例超 5s（实测 5347/5238ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/cli/next-steps.test.ts` | 下一步指引块（E10：成功面答「然后呢」——四命令） company create：成功尾随 serve+overview 两步（serve 路径=<workRoot>/var/daemon.yaml） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5347ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `apps/daemon/test/cli/next-steps.test.ts` | --json 机器面（E11：单行 JSON + next 数组，人机不混流） company create --json：末行可解析，含 ok/slug/serveConfig.path/next 数组 | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5238ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条 company create 指引用例超 5s（实测 5347/5238ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 4/13：`apps/daemon/test/cli/structure-check.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/cli/structure-check.test.ts` | 红 | 4/2 | timeout | 保留观察 | V2 后存废门 | 2 条 company check 用例超 5s（实测 9493/7271ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/cli/structure-check.test.ts` | company check（正位面） 合法目录：exit 0 + 同款摘要/下一步（与 validate 的 stdout 逐行全等） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 9493ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `apps/daemon/test/cli/structure-check.test.ts` | company check（正位面） 组清单含 check；typo 面 did-you-mean 候选集同步 | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 7271ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条 company check 用例超 5s（实测 9493/7271ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 5/13：`apps/daemon/test/cli/usage-contract.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/cli/usage-contract.test.ts` | 红 | 5/2 | timeout | 保留观察 | V2 后存废门 | 2 条旗标同义用例超 5s（实测 5420/7497ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/cli/usage-contract.test.ts` | S5c 版本声明被行为兑现（--version/-V） -V 短旗标同义（≡ --version） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5420ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `apps/daemon/test/cli/usage-contract.test.ts` | S5b 旗标同义被行为兑现（--flag=value ≡ --flag value） 两式同效（panel --port=8799 与 --port 8799 等价收参——以可观测差异最小面验） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 7497ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条旗标同义用例超 5s（实测 5420/7497ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 6/13：`apps/daemon/test/control/stop-channel.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `apps/daemon/test/control/stop-channel.test.ts` | 红 | 8/1 | timeout | 保留观察 | V2 后存废门 | stop 控制面真进程用例超 5s（实测 5077ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `apps/daemon/test/control/stop-channel.test.ts` | spawn 冒烟：studio-next stop（控制面优雅停，真 bin 进程端到端） serve 起真进程 → stop 写请求 → daemon 拍边界优雅停（exit 0）→ 回执落盘 → CLI exit 0 | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5077ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：stop 控制面真进程用例超 5s（实测 5077ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 7/13：`packages/adapters/test/claude.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/adapters/test/claude.test.ts` | 红 | 26/1 | 断言 | 保留观察 | V2 后存废门 | 断言差：graceMs 后 SIGKILL 用例期望等待 ≥250ms、实测 8ms 即返回；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/adapters/test/claude.test.ts` | kill 无终态面（claude：result 未到 = 无终态；17-§6 kill 行） 宽限升级：子进程无视 SIGTERM——graceMs 后 SIGKILL 强杀（不杀则 kill 永不返回） | 断言 | 保留观察 | V2 后存废门 | AssertionError：期望 ≥250ms、实测 8ms（graceMs 后 SIGKILL 未等待）；观察位，非门 |

> 归因注：断言差：graceMs 后 SIGKILL 用例期望等待 ≥250ms、实测 8ms 即返回；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 8/13：`packages/company/test/company-validate-cli.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/company/test/company-validate-cli.test.ts` | 红 | 10/2 | timeout | 保留观察 | V2 后存废门 | 2 条 spawn 用例超 5s 默认超时（实测 5774/5247ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/company/test/company-validate-cli.test.ts` | DEV-32 · company validate · 路径面 不合法仓：exit 1 + 逐条违规四元组（规则号/文件/位置/描述/修法——不许只说校验失败） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5774ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `packages/company/test/company-validate-cli.test.ts` | DEV-32 · company validate · --json 机器面 合法：stdout 纯 JSON（ok=true + summary 四元组 + 可初始化语义由 ok 承载） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 5247ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条 spawn 用例超 5s 默认超时（实测 5774/5247ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 9/13：`packages/company/test/create.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/company/test/create.test.ts` | 红 | 16/1 | timeout | 保留观察 | V2 后存废门 | spawn 用例超 5s 默认超时（实测 10477ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/company/test/create.test.ts` | spawn 冒烟（CLI 面：studio-next company create） 真跑 → exit 0；再跑 → exit 0（幂等）；报告/台账/provision 全落 | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 10477ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：spawn 用例超 5s 默认超时（实测 10477ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 10/13：`packages/company/test/git-import.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/company/test/git-import.test.ts` | 红 | 18/1 | timeout | 保留观察 | V2 后存废门 | git 导入 CLI 用例超 5s（实测 6258ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/company/test/git-import.test.ts` | DEV-27 · CLI 冒烟（studio-next company add <git-url>） 一条命令安装：exit 0 + 摘要输出 + 落地产物（Node 原生 type-stripping 直跑 bin.ts） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 6258ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：git 导入 CLI 用例超 5s（实测 6258ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 11/13：`packages/company/test/init.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/company/test/init.test.ts` | 红 | 9/2 | timeout | 保留观察 | V2 后存废门 | 2 条 init→validate 全链用例超 5s（实测 9311/7243ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/company/test/init.test.ts` | spawn 冒烟（拟冻结验收命令：init demo → validate demo → exit 0） init demo → validate demo 全链 exit 0（16-§四 v0.1 验收口径） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 9311ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |
| `packages/company/test/init.test.ts` | spawn 冒烟（拟冻结验收命令：init demo → validate demo → exit 0） 未知子命令 / 缺参 → exit 1 + 用法到 stderr | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 7243ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：2 条 init→validate 全链用例超 5s（实测 9311/7243ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 12/13：`packages/panel/test/ui-syntax-gate.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/panel/test/ui-syntax-gate.test.ts` | 红 | 0/1 | timeout | 保留观察 | V2 后存废门 | 全量 ui 资产 node --check 超 5s（实测 6070ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/panel/test/ui-syntax-gate.test.ts` | ui 资产语法门禁（panel/ui/** 全量 node --check——浏览器前置闸） 每件 .js/.mjs 必须语法可解析（违规即本门禁红——修文件而非改门禁） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 6070ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：全量 ui 资产 node --check 超 5s（实测 6070ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。

### 红文件 13/13：`packages/store/test/drill.test.ts`

| 路径 | 状态 | 用例数（过/败） | 失败类 | 处置 | 责任波 | 理由 | 最近复跑 |
|---|---|---|---|---|---|---|---|
| `packages/store/test/drill.test.ts` | 红 | 5/1 | timeout | 保留观察 | V2 后存废门 | ledger drill 用例超 5s（实测 12440ms）——timeout 族；观察位，非门 | 2026-10-28 16:28 全量 vitest（JSON） |

红用例清单：

| 文件 | 用例名 | 失败类 | 处置 | 责任波 | 理由 |
|---|---|---|---|---|---|
| `packages/store/test/drill.test.ts` | spawn 冒烟（拟冻结验收命令：studio-next ledger drill → exit 0 + PASS） 用法错误：未知 ledger 子命令 / 缺参 → exit 1 + stderr 错误行 + stdout 简段（studio-dev-103 S1 分面） | timeout | 保留观察 | V2 后存废门 | 超过 5s 默认超时（本用例 12440ms，JSON 报错摘要 STACK_TRACE_ERROR）；观察位，非门 |

> 归因注：ledger drill 用例超 5s（实测 12440ms）——timeout 族；观察位，非门。处置列一律「保留观察」，修旧测试不立项（plan/04 §1.8.6）。
<!-- ledger:red:end -->

### 4.1 对照证据：timeout 族的「同命令隔离复跑」自证（plan/04 §1.8.5-3）

MIG-02 触及面登记（共享文件＝根 `package.json`、`tsconfig*.json`、新增 `vitest.v2.config.ts`）按 plan/04 §1.8.5-4 用路径过滤跑了一次旧测试，共 7 件 / 142 用例，**全绿**（详见 `docs/baselines/gates.md` §六）。其中 `apps/daemon/test/cli/usage-contract.test.ts` 在 16:28 全量里是红（2 条），隔离单跑却 7/7 通过——那 2 条用例本次耗时 1153ms / 2399ms，远低于 5000ms 默认超时。

| 文件 | 全量（16:28） | 隔离单跑（16:39） | 判读 | 对台账的影响 |
|---|---|---|---|---|
| `apps/daemon/test/cli/usage-contract.test.ts` | 红 5/2（2 条 timeout） | 绿 7/0（红过的 2 条 1153/2399ms） | **时序 flaky 实证**：同一用例双态出现，且双态势差落在 5s 阈附近——属 timeout 族，不是行为缺陷 | 不改行：§二/§四按 16:28 实测登记（只追加/更正，不删行）；本表作**对照证据**留档，供 V2 后存废门判 |

> 结论：13 红文件 / 20 红用例的「失败类」判定成立（19 timeout ＋ 1 断言），且**至少有一条被隔离复跑证伪为时序**。这正是不把旧套件当门的理由——它的红既不稳定、也不指向 V2 行为（v2/17 §1.3）。

---

## 五、本波明确不做（防越界）

1. **不修旧测试**：20 条红原样留在旧套件里，不改断言、不上调 timeout、不加 retry、不 skip（plan/04 §1.8.2 三条禁令）。
2. **不删除/不改名**：209 件路径与内容零改动；删除须先走「退役」处置＋删除单（plan/04 §1.8.4）。
3. **不把旧测试改写成 V2 case**：`test:v2` 的 include 只含 `test/v2`，旧路径在形态上不可进入 V2 门（`scripts/verify/v2-suite-manifest.mjs` 机械背书）。
4. **不以旧套件绿/红作任何放行依据**：旧套件只在观察位（本件 §〇「施工门＝不是」）。

---

## 六、复算命令（只读）

```bash
# ① 209：find 清单（剔除 test/v2）
find apps/daemon/test packages/*/test apps/*/src packages/*/src -name '*.test.ts' | grep -v '/test/v2/' | sort | wc -l

# ② 210 / 2976 / 20 / 13：JSON 复算
mise exec -- node -e "const r=require('/tmp/studio-next-vitest.json');const f=r.testResults;console.log(f.length, r.numTotalTests, f.filter(x=>x.status!=='passed').length, f.reduce((s,x)=>s+x.assertionResults.filter(a=>a.status==='failed').length,0))"

# ③ 台账自检
mise exec -- node scripts/verify/old-test-ledger.mjs
```

---

*本件为旧套件观察位登记件，不是施工门、不是能力证据。V2 门见 `docs/baselines/gates.md` 与根 `package.json` 的 `verify:v2`。*

---

## 七、MIG-04 触及面复跑补充登记（2026-10-28）

> 性质：**触及面旧测试复跑登记**（plan/04 §1.8.5-4：共享契约/根配置/迁移面算触及面，跑一次并登记，红也登记、不阻塞 V2 门）。本表**不属于 §二 209 行冻结主表**（不参与 `old-test-ledger.mjs` 的 209＋口径差/13 红/20 红用例计数），只追加、不删行。
> 触发：MIG-04 v14 records/v15 events 触发器把 `LATEST_VERSION` 从 13 推到 15；下列旧测试硬编码「v13」版本号，复跑转红。
> 归属：**版本断言机械更新，不是行为回归**；修旧测试不立项（plan/04 §1.8.2），处置列「保留观察」，责任波「V2 后存废门」。

| 文件 | 复跑结果 | 红用例 | 失败类 | 原因 | 处置 | 责任波 |
|---|---|---|---|---|---|---|
| `packages/store/test/drill.test.ts` | 红 | 2/6 | 断言 | 期望 schema v13 → 现 v15 | 保留观察 | V2 后存废门 |
| `packages/store/test/ledger.test.ts` | 红 | 2/10 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/rebuild.test.ts` | 红 | 1/5 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v11-usage.test.ts` | 红 | 1/7 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v12-cost.test.ts` | 红 | 2/9 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v2-tables.test.ts` | 红 | 3/25 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v3-jobs.test.ts` | 红 | 3/15 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v4-debts.test.ts` | 红 | 3/17 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v5-candidates.test.ts` | 红 | 2/29 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v6-reports.test.ts` | 红 | 2/19 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v8-model.test.ts` | 红 | 2/3 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v8-todo-queue.test.ts` | 红 | 1/8 | 断言 | 同上 | 保留观察 | V2 后存废门 |
| `packages/store/test/v9-pricing.test.ts` | 红 | 3/26 | 断言 | 同上 | 保留观察 | V2 后存废门 |

**复跑命令**：`mise exec -- node_modules/.bin/vitest run packages/store --reporter=json --outputFile=/tmp/store-old-vitest.json`；实测 13 红文件 / 27 红用例 / 其余全绿（exit 1）。**不修、不删、不 skip**；V2 门不以此表判。
