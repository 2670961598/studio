/**
 * 频道供给装配件（130-P3 频道供给扩展；130 提案 §6.7.3-③，DEV-20 §5.4）——serve.ts
 * 拆出（20-§十五.三.3 尺寸门「先拆再增」，同 serveconfig/coerce.ts 先例）：
 * matrixChannels 交叉校验 / 供给面装配 / 启动期+热重载公司地图 ensure 的执行体。
 * daemon 只收结构同形接口（engine/rooms/room-duty.ts）——零 @studio-next/matrix
 * import（25-§一.2），Matrix 网络面由 apps/boot 组合根注入。
 */

// 类型环破口（IMPL-06-05）：ServeConfig 归位 assembly/serve/config.ts——本件不再经
// serve.ts 门面取型（channels→serve→config→channels 的形状环在类型面闭合；值边不变）
import type { ServeConfig } from '../serve/config.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext, RoomFaceSnapshotInput } from '../../engine/rooms/room-duty.ts'

/**
 * 频道供给交叉校验（130-P3，130 提案 §6.7.3-③；fail-fast 同 matrix 先例）：
 * matrixChannels 开=装配面必齐（homeserver/bot 与 matrix 源共用键组——只开供给
 * 不开唤醒源是合法形态：矩阵频道先建、mention 源后开灰度）。
 */
export function crossValidateMatrixChannels(cfg: ServeConfig): void {
  if (!cfg.matrixChannels) return
  const missing = [
    ...(cfg.matrixHomeserverUrl === undefined ? ['matrixHomeserverUrl'] : []),
    ...(cfg.matrixUserId === undefined ? ['matrixUserId'] : []),
    ...(cfg.matrixDeptMap === undefined ? ['matrixDeptMap'] : []),
  ]
  if (missing.length > 0) {
    throw new Error(
      `daemon.yaml：matrixChannels: true 缺必配键：${missing.join('、')}（130-P3；密码经 env MATRIX_BOT_PASSWORD 供给，不入 yaml）`,
    )
  }
}

/**
 * 供给面装配（130-P3 ③工序）：注入工厂持有 Matrix 网络面（boot 组合根），daemon 只收
 * 结构同形接口——注入位 1/EngineDeps.rooms（派发/CLOSE 相位生命周期钩）；注入位 2/
 * 启动期+热重载公司地图 ensure（startChannelSupply/reEnsureChannels）。
 * matrixChannels 开而工厂缺席=CONFIG_INVALID（不强依赖 matrix 包，25-§一.2）。
 * ctx.snapshot 活取（L1 热重载整组换后，下拍供给/派发钩即新鲜组织面——docs/38-§2）。
 */
export function wireRoomFace(
  factory: ((ctx: MatrixRoomFaceContext) => MatrixRoomFace) | undefined,
  snapshot: () => RoomFaceSnapshotInput,
): MatrixRoomFace {
  if (factory === undefined) {
    throw new Error(
      'CONFIG_INVALID：matrixChannels: true 需注入频道供给面工厂（runServe/buildServeRuntime opts.matrixRoomFace）——' +
        'daemon 不强依赖 @studio-next/matrix（25-§一.2）；装配单元 apps/boot 组合根注入 ' +
        'createMatrixProvisionFace 产物（boot 读 daemon.yaml matrixHomeserverUrl/matrixUserId/' +
        'matrixDeptMap/matrixProducerMxid + env MATRIX_BOT_PASSWORD → login → 供给面 → runServe opts）',
    )
  }
  return factory({ snapshot })
}

/**
 * 公司频道地图启动供给（130-P3 §6.7.3-③；DEV-20 §5.4 ensure 幂等）：八类地图逐房
 * ensure（resolve→join→补邀→PL 全量覆盖→空间挂子）。fire-and-forget：供给是沟通面
 * 非执行前置，失败不阻主循环启动（网络抖动下拍热重载/重派自愈——ensure 可重入）；
 * 报告面逐条落日志（problems=配置软失败、failures=网络/权限失败）。
 */
export function startChannelSupply(face: MatrixRoomFace, log: (line: string) => void): void {
  void face
    .ensureCompanyChannels()
    .then((report) => {
      log(
        `[serve] matrix 频道供给（130-P3 八类地图）：确保 ${report.ensured} 房（新建 ${report.created}）` +
          `${report.problems.length > 0 ? `；软问题 ${report.problems.length}` : ''}${report.failures.length > 0 ? `；失败 ${report.failures.length}` : ''}——幂等 ensure，重跑收敛（S8）`,
      )
      for (const p of report.problems) log(`[serve] matrix 频道供给软问题：${p}`)
      for (const f of report.failures) log(`[serve] matrix 频道供给失败（不阻主循环）：${f}`)
    })
    .catch((err: unknown) => {
      log(`[serve] matrix 频道供给异常（不阻主循环；下拍热重载/重派自愈）：${err instanceof Error ? err.message : String(err)}`)
    })
}

/**
 * 频道地图重供给（130-P3 §6.7.3-③，热重载 apply 段）：apply 段同步推进、供给异步收敛
 * ——ensureCompanyChannels 经 ctx.snapshot 活取（此刻已=next），幂等只补差集（新增组群/
 * 部门→新房；缩编→既有房保留不拆，DEV-20 §5.4 已存在不是错误）。不入 apply 事务面：
 * 供给失败不回滚配置（沟通面可下拍重试自愈）。静默面：全量收敛（零新建/零问题）不打日志。
 */
export function reEnsureChannels(face: MatrixRoomFace, log: (line: string) => void): void {
  void face
    .ensureCompanyChannels()
    .then((report) => {
      if (report.created > 0 || report.problems.length > 0 || report.failures.length > 0) {
        log(`[serve] matrix 频道重供给（reload）：新建 ${report.created}、软问题 ${report.problems.length}、失败 ${report.failures.length}`)
        for (const f of report.failures) log(`[serve] matrix 频道重供给失败（不阻 reload）：${f}`)
      }
    })
    .catch((err: unknown) => {
      log(`[serve] matrix 频道重供给异常（不阻 reload）：${err instanceof Error ? err.message : String(err)}`)
    })
}
