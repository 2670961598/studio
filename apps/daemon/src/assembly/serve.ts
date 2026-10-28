/**
 * serve —— `studio-next serve --config <daemon.yaml>` 公共装配面（薄壳：只留公共导出与转发）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-06-05「serve 拆分·config/runtime/run」（LANE-E）——原 1627 行单体
 *     拆为 assembly/serve/ 子域四件，本文件退化为稳定导入面（DISP-02「留薄 facade」）；
 *   - docs/v2/16 §三 daemon 行（①engine.ts 拆分；②serve 拆 config/runtime/run）、plan/02
 *     §五-1「唯一主写」（MIG-06 波内 serve 共享面只由本单改，G/M 落拆后产物）；
 *   - docs/20-§十五.三／.四（600 行阈；装配域平面散件数基线不动——拆件归 serve/ 子域）。
 *
 * 拆后结构（行为/错误码/事件序零漂移：逐字迁移，本文件不再持有实现）：
 *   - serve/config.ts        配置面：ServeConfig 形状/缺省、扁平 YAML 解析、交叉校验、
 *                            配置派生的启动身份 daemonIdentity；
 *   - serve/runtime.ts       运行时装配：buildServeRuntime（引擎/executor/平台/网关/人事/
 *                            频道/notify/唤起源/热重载/统一停机面）与 ServeRuntime 契约；
 *   - serve/run.ts           主循环与停机编排：runServe（启动/在途接管/拍循环/停机收口/
 *                            回执）、ServeResult、RunServeOpts；
 *   - serve/executor-face.ts executor 注册面子装配（agent.yaml/价目表/模型档/judge 两址）。
 *
 * 公共导入面冻结：CLI（cli/serve.ts、stop.ts、reload.ts、taiga-cure.ts、company.ts、
 * external.ts）、组合根 apps/boot（`@studio-next/daemon/serve`）与既有测试的导入路径/名字
 * 全部保持——本文件只做 re-export，不新增语义。
 *
 * daemon.yaml 配置面语义（键面/缺省/交叉校验失败形态）见 serve/config.ts 头注与
 * `studio-next serve --help`；各行接线边界说明随实现迁入对应件与 platform/wire.ts。
 */
export {
  DEFAULT_SERVE_CONFIG,
  GATEWAY_SECRET_ENV,
  assertPlatformBinding,
  daemonIdentity,
  parseDaemonConfig,
  resolveGatewaySecret,
  type DaemonIdentity,
  type GatewaySecretSource,
  type ServeConfig,
} from './serve/config.ts'
export { buildServeRuntime, type ServeRuntime } from './serve/runtime.ts'
export { runServe, type RunServeOpts, type ServeResult } from './serve/run.ts'

// —— 既有公共面再出口（路径/名字冻结；实现件按 20-§十五「先拆再增」早已拆出）——
export { DEMO_SNAPSHOT } from './demo/demo-snapshot.ts'
export { seedJobs, removeMissingJobs, type SeedJobsResult } from './jobs-seed/jobs-seed.ts'
export { takeOverRunningWorkRecords, type InflightTakeoverResult } from '../engine/harvest/inflight-takeover.ts'
export { renderNoopDecision, noopLinesOf } from './render/tick.ts'
export { resolveTaigaAuth, loadTaigaFieldMap, wirePlatform } from './platform/wire.ts'
// 频道供给面类型再出（130-P3）：boot 组合根从 '@studio-next/daemon/serve' 消费工厂签名
export type { MatrixRoomFace, MatrixRoomFaceContext } from '../engine/rooms/room-duty.ts'
// notify 广播面类型再出（105-刀B）：boot 组合根从 '@studio-next/daemon/serve' 消费接口签名
export type { NotifyBroadcastFace, NotifyBroadcastTargets, NotifySendReport } from '../engine/notify/broadcast.ts'
