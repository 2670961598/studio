// margin-rules.mjs —— 零余量拆件 + 契约面余量告警的观测名单（纯数据；docs/91）
//
// 依据：docs/17-§2（主循环七相位——观测面不增删相位）、docs/17-§6（收割四要件——观测面
//   零判据变更）、docs/20-§十五.三（600 行阈 / lineBaseline ratchet）、docs/91（本单纪律）。
//
// 边界：本文件**不复制**任何阈值/基线——上限与基线运行时从 boundary-rules.mjs 读取，
//   避免双源漂移；判据类资产（阈值/基线/边表）仍以 boundary-rules.mjs 为唯一冻结源。

/** 软余量：拆后文件距上限不足此值即 WARN（任务书 §4-③：余量 ≥50 行）。 */
export const softMargin = 50

/** 契约冻结面：只观测、不拆不改；低余量只告警（修法=批示流，不得自动化改冻结面）。 */
export const frozenContractFaces = [
  'packages/contract/src/records/emp-neg.ts',
  'packages/contract/src/records/life.ts',
  'packages/contract/src/records/auth.ts',
]

/** 观测名单：零/低余量高危及本轮拆件件（含契约冻结面）。 */
export const watchFiles = [
  'apps/daemon/src/assembly/serve/run.ts',
  'apps/daemon/src/assembly/serve/runtime.ts',
  'apps/daemon/src/assembly/serve/config.ts',
  'apps/daemon/src/engine/engine.ts',
  'apps/daemon/src/control/hot-reload.ts',
  'packages/store/src/ledger.ts',
  'packages/adapters/src/dsh.ts',
  'packages/company/src/repo-validate.ts',
  'packages/company/src/dependencies.ts',
  'packages/panel/src/views.ts',
  ...frozenContractFaces,
]
