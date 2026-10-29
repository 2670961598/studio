/**
 * control/ops —— PORT-OPS 控制面记录/证据面子域（OPS 补形 A 拆件）
 *
 * 依据：docs/v2/14 §1.8（PORT-OPS 请求形状/落口）、docs/v2/11 §六 REC-WORK-18、
 * docs/v2/15 §一/§二（SEC-FC-06/SEC-SIG-01）、docs/49「OPS 补形 A」。
 *
 * 件面：`landing.ts`（createOpsLanding：三闸＋REC-WORK-18 记录草案＋写口注入）。
 * 拆件纪律：control/ 域平面直属散件基线不动（记录面归 ops/ 子域）；stop-channel 只留
 * 停机文件协议并在文末再出口本子域公共名（既有导入路径不破）。
 */
export {
  classifyOpsWriteError,
  createOpsLanding,
  opsWriteError,
  type OpsLanding,
  type OpsLandingDeps,
  type OpsStopRecord,
  type OpsWriteError,
  type OpsWriteFailureClass,
} from './landing.ts'
