/**
 * PORT-WS 工作空间 —— 六区定位、containment、realpath、受限读写、产物暂存
 * （docs/v2/05 §四；签名 docs/v2/14 §1.5；六区语义锚 docs/v2/12 §三）
 *
 * 必须拒绝：cwd 当隔离（`ContainmentReport.cwdProvesIsolation:false` 为类型级
 *   常假标记）；绝对路径入公共类型（`ZonePath.absolutePath` 恒不存在）；
 *   默认读取宿主全部秘密（`secret_proxy` 只走逻辑引用，`read` 不覆盖该区——
 *   秘密供给归 PORT-TRUST）；产物在暂存区直接当定稿（`StagedRef.finalizedBy`
 *   恒不存在，定稿走 PORT-EVD）。
 * 零实现、零 IO；工作空间实现与 seatbelt 接线归 engine/workspace。
 */
import type { CallContext, PortResult, ReadContext } from './def.ts'

/** 端口名常量 */
export const PORT_WS = 'PORT-WS' as const

/** 工作区六区（值集唯一主表 v2/09 ENU-114） */
export type WorkspaceZone =
  | 'readonly_input'
  | 'mutable_workspace'
  | 'artifact_staging'
  | 'handover_zone'
  | 'temp_cache'
  | 'secret_proxy'

/** 相对路径：绝对路径不入公共类型；`.`/`..` 逃逸由 containment 判，不由 cwd 判 */
export type RelPath = string

/** 区＋相对路径。`absolutePath` 恒不存在：公共类型层不承载宿主绝对路径 */
export interface ZonePath {
  readonly zone: WorkspaceZone
  readonly path: RelPath
  readonly absolutePath?: undefined
}

/** 产物暂存目标只允许两区（暂存/交接），不得写只读输入或秘密代理面 */
export type ArtifactZone = Extract<WorkspaceZone, 'artifact_staging' | 'handover_zone'>

/**
 * containment 核验报告：`contained:false` 时列出越界原因；
 * `cwdProvesIsolation:false` 表明「当前目录」不是隔离边界（v2/05 §四必须拒绝）。
 */
export interface ContainmentReport {
  readonly target: RelPath
  readonly contained: boolean
  readonly resolved: RelPath
  readonly violations: readonly string[]
  readonly cwdProvesIsolation: false
}

/** 受限读写回执：读也回字节数与摘要，供证据面逐字核对 */
export interface IOReceipt {
  readonly zone: WorkspaceZone
  readonly path: RelPath
  readonly bytes: number
  readonly digest?: string
  readonly completed: true
}

/** 产物暂存草案：来源路径＋目标区＋媒体类型＋摘要；暂存不是定稿 */
export interface ArtifactDraft {
  readonly workRef: string
  readonly sourcePath: RelPath
  readonly targetZone: ArtifactZone
  readonly mediaType: string
  readonly digest: string
  readonly producedBy: string
}

/** 暂存引用：`finalizedBy` 恒不存在——定稿走 PORT-EVD（证据包） */
export interface StagedRef {
  readonly stagedId: string
  readonly location: ZonePath
  readonly digest: string
  readonly finalizedBy?: undefined
}

/** 端口接口：resolve/containment/realpath/read/write/stage */
export interface WorkspacePort {
  resolve(zone: WorkspaceZone, rc: ReadContext): PortResult<ZonePath>
  containment(target: RelPath, rc: ReadContext): PortResult<ContainmentReport>
  realpath(p: RelPath, rc: ReadContext): PortResult<RelPath>
  /** 受读取范围约束；`secret_proxy` 区的值不由此读口提供（归 PORT-TRUST） */
  read(p: RelPath, rc: ReadContext): PortResult<IOReceipt>
  /** 受写域约束；body 为字节/文本，不承载秘密值 */
  write(p: RelPath, body: string | Uint8Array, ctx: CallContext): PortResult<IOReceipt>
  stageArtifact(d: ArtifactDraft, ctx: CallContext): PortResult<StagedRef>
}
