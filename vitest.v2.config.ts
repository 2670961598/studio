/**
 * vitest.v2.config.ts —— V2 新套件专用 vitest 配置（MIG-02 / IMPL-02-01）
 *
 * 依据：plan/04 §1.9.2（路径与配置口径）／§1.9.4（「V2 新套件绿」九条阈值）、
 *       plan/03 §三（MIG-02 出口门禁）、docs/v2/17 §一（V0-V6 分层）、
 *       docs/49 2026-10-28 开工令 §3（写面施工授权）、docs/90 §三 R5（37/20 数值口径）。
 *
 * 三条铁律（`scripts/verify/v2-suite-manifest.mjs` 机械背书，本文件即受检物）：
 *   1. `include` **只含 `test/v2`**——旧测试（V2 开工 tag 之前已有）一律不进 V2 门：
 *      旧测试的绿/红都不属 V2 任何一层（v2/17 §1.3「不能互替的绿色」），
 *      混入即把旧债算成新证据，也违反 plan/04 §1.8「旧测试不作施工门」。
 *   2. `retry: 0`——不许靠重跑刷绿（plan/04 §1.9.4 第 3 条）。旧套件的 timeout/flaky
 *      家族（docs/86 B5；2026-10-28 16:28 实测 20 failed/13 failed files）**不得**以
 *      重试掩盖，V2 新套件同此纪律：一次红即红。
 *   3. 命令面禁 `--passWithNoTests`（根 `package.json` 的 `test:v2` 冻结）：
 *      空套=红，不是「无失败」（plan/04 §1.9.4 第 2 条）。
 *
 * 边界：本配置不引旧套件的 setupFiles/全局夹具，V2 各包需要 setup 时另立实现单
 * （本波只交付脚手架＋冒烟；V2 业务 case 扩充归 MIG-03 起的各波）。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // V2 新测试唯一入口（plan/04 §1.9.2）：packages/<p>/test/v2/**、apps/<a>/test/v2/**
    include: ['apps/*/test/v2/**/*.test.ts', 'packages/*/test/v2/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // 禁重试：一次红即红（plan/04 §1.9.4 第 3 条）
    retry: 0,
    // V2 腿含真进程 spawn / e2e / crash（SIGKILL 生命周期），5s 默认不够（旧套件 20 红
    // 中 19 条即 5s timeout 族，见 docs/baselines/old-tests-ledger.md §四）。
    // 60s 是**上限**不是预算：超时仍然红，不得以调大超时把红刷绿。
    testTimeout: 60_000,
  },
})
