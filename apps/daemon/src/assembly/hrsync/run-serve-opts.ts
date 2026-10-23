/**
 * run-serve-opts —— runServe 公共注入面类型（studio-dev-217 拆出）。
 *
 * 为什么拆（BC-S2，docs/20-§十五.三.3）：assembly/serve.ts 尺寸冻结基线只减不增——
 * hrMatrixFace 注入键（DEV-48 docs/52-§七，boot 接线 studio-dev-217）入公共面时
 * 按「先拆再增功能」把内联 opts 类型拆独立文件，serve.ts 净减。
 *
 * 注入纪律（同 matrixSource 先例）：daemon 不 import @studio-next/matrix——装配单元
 * apps/boot 构造产物（结构同形），daemon 只收工厂；开而未注入=CONFIG_INVALID 拒启动
 * （hr 面收口 assembly/hrsync/assemble.ts；源/面收口 buildServeRuntime）。
 */
import type { InvokeSource } from '@studio-next/contract'
import type { MatrixHrFace } from '../../engine/hrsync/hrsync.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../engine/rooms/room-duty.ts'

/** runServe(configPath, opts) 的公共注入面（组合根 apps/boot 为唯一合法调用方） */
export interface RunServeOpts {
  /**
   * matrix 源工厂（105-刀A A-3）：matrix: true 时注入（装配单元 apps/boot 构造
   * createMentionSource 产物——daemon 不强依赖 @studio-next/matrix）；缺省不注入
   * （matrix: true 且未注入=CONFIG_INVALID 拒启动）。
   */
  matrixSource?: () => InvokeSource
  /**
   * matrix 频道供给面工厂（130-P3 §6.7.3）：matrixChannels: true 时注入（apps/boot
   * 构造 createMatrixProvisionFace 产物）；缺省不注入（开而未注入=CONFIG_INVALID）。
   */
  matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
  /**
   * matrix 人事执行面工厂（DEV-48 docs/52-§七；studio-dev-217 boot 接线）：
   * hrSync+hrMatrix: true 时注入（apps/boot 构造 createMatrixHrFace 产物）；
   * 缺省不注入（开而未注入=CONFIG_INVALID——assembly/hrsync/assemble.ts 收口）。
   */
  hrMatrixFace?: () => MatrixHrFace
}
