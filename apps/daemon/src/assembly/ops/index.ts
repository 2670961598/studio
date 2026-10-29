/**
 * assembly/ops —— PORT-OPS 生产落口子域（OPS 补形 A）
 *
 * 依据：docs/v2/14 §1.8（PORT-OPS 请求形状/落口）、§1.6（PORT-HIST 唯一记录写口）；
 * docs/v2/11 §〇/§0.4/§六（信封/幂等/REC-WORK-18）；docs/49「OPS 补形 A」。
 *
 * 件面：`assemble.ts`（装配：createOpsLanding＋createHistFace(ledger.db).append 注入）、
 * `envelope.ts`（OpsStopRecord → REC-WORK-18 记录信封纯映射）。子域目录（assembly/ops/）
 * 按域平面纪律新增，不占 assembly/ 直属散件基线。
 */
export {
  assembleOps,
  type AssembleOpsDeps,
  type OpsAssembly,
} from './assemble.ts'
export {
  OPS_EFFECT_ON_ORIGINAL_TEXT,
  OPS_RECORD_SCHEMA_REF,
  OPS_RECORD_SPEC_VERSION,
  OPS_RECORD_WRITTEN_BY,
  opsStopEnvelope,
  type OpsEmergencyStopPayload,
  type OpsStopEnvelope,
} from './envelope.ts'
export { wireServeOps, type ServeOpsFace, type WireServeOpsArgs } from './serve-face.ts'
