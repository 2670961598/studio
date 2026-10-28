/**
 * prm/spec —— PRM 生成器的共享常量与输入原语（段序/门禁段/摘要身份/受控引用/冻结）
 *
 * 依据与语义边界见 `./compile-projection.ts` 头注（本件只承载共享件，不另立语义源）。
 * 零 IO：本件不 import Node 内建模块/文件/网络；摘要经 `../jcs.ts`（其内仅有 crypto 纯哈希，沿其先例）。
 */
import type {
  FailureCategory,
  PolicyProjection,
  PortFailure,
  PortResult,
  ProjectionSegment,
  ProjectionSegmentValue,
} from '@studio-next/contract'
import { semanticDigestOfJson } from '../jcs.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、值集引用（段名唯一主表 v2/09 ENU-108；本件不造第二枚举）
// ─────────────────────────────────────────────────────────────────────────────

/** 九段规范序（ENU-108 呈现序；`unsupportedSegments[]` 恒按此序，保证可复算） */
export const PROJECTION_SEGMENTS: readonly ProjectionSegment[] = [
  'identity',
  'authority',
  'plan',
  'tools',
  'sandbox',
  'approval',
  'persona',
  'evidence',
  'validity',
]

/**
 * 策略面「门禁段」（保守口径）：`authority`/`tools` 未承载＝拒载（81-files/12 实现选择④）；
 * 强策略标签要求 `tools`＋`sandbox`＋`approval` 全承载（v2/12 §1.6 判定表）；`authority`
 * 是始终必需的策略段（78-§3.2.2）。四段任一未承载 → 启动器不得 spawn（本常量不替代
 * 启动器侧的摘要/有效期/引用校验）。
 */
export const GATING_SEGMENTS: readonly ProjectionSegment[] = ['authority', 'tools', 'sandbox', 'approval']

/** 摘要的规范化身份与算法（规则唯一源 docs/v2/10 §二；本件只引用，不另造规范） */
export const PRM_CANONICALIZATION = 'studio-next.jcs@1' as const
export const PRM_DIGEST_PREFIX = 'sha256:' as const

// ─────────────────────────────────────────────────────────────────────────────
// 二、失败面（不抛异常；无副作用/不可重试/无需对账）
// ─────────────────────────────────────────────────────────────────────────────

export function failure(category: FailureCategory, subcause: string, detail: string): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: '纯函数编译：无外部副作用，无需对账' },
    responsiblePosition: 'daemon',
  }
}

export function rejectedPrecondition(subcause: string, detail: string): PortResult<never> {
  return { kind: 'err', error: failure('rejected_precondition', subcause, detail) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、受控输入原语（PRM-G6：非法/未定版/缺字段一律拒，不补默认值）
// ─────────────────────────────────────────────────────────────────────────────

export type RawRecord = Readonly<Record<string, unknown>>

export interface InstantValue {
  readonly text: string
  readonly ms: number
}

const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const UNVERSIONED_REF_TOKENS: ReadonlySet<string> = new Set(['latest', 'current', 'head'])
export const SANDBOX_MODES: ReadonlySet<string> = new Set(['read-only', 'workspace-write'])

export function asRecord(value: unknown): RawRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as RawRecord
}

/** 受控引用：非空、无首尾空白、非「最新」类未定版引用（78-§3.2.3 规则 1） */
export function readRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.trim() !== value) return undefined
  if (UNVERSIONED_REF_TOKENS.has(value.toLowerCase())) return undefined
  return value
}

export function readRefList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs: string[] = []
  for (const item of value) {
    const ref = readRef(item)
    if (ref === undefined) return undefined
    refs.push(ref)
  }
  return refs
}

/** UTC 瞬时（显式输入；只做 Date.parse 算术比较，不读时钟） */
export function readInstant(value: unknown): InstantValue | undefined {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return undefined
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return undefined
  return { text: value, ms }
}

/** 集合语义规范化：去重 ＋ UTF-16 码元序（与 JCS 键序同序，保证同集合同摘要） */
export function normalizeRefs(refs: readonly string[]): readonly string[] {
  const unique = [...new Set(refs)]
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return unique
}

export function segmentValue(
  enabled: boolean,
  sourceRefs: readonly string[],
  note?: string,
): ProjectionSegmentValue {
  return note === undefined ? { enabled, sourceRefs } : { enabled, sourceRefs, note }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、摘要体与递归冻结（PRM-G2/G7）
// ─────────────────────────────────────────────────────────────────────────────

/** 摘要覆盖的投影体：除 `digest` 自身的全部投影内容 */
export interface ProjectionBody {
  readonly segments: Readonly<Record<ProjectionSegment, ProjectionSegmentValue>>
  readonly unsupportedSegments: readonly ProjectionSegment[]
  readonly authorityRefs: readonly string[]
  readonly validity: PolicyProjection['validity']
}

export function digestBody(body: ProjectionBody): PortResult<string> {
  const face = semanticDigestOfJson(body)
  if (!face.ok) {
    return rejectedPrecondition(
      'projection-digest-uncomputable',
      '投影体无法按 JCS 规范化（形状应为封闭可序列化值）',
    )
  }
  return { kind: 'ok', value: `${PRM_DIGEST_PREFIX}${face.value.value}` }
}

/** 输出递归冻结：调用方拿不到可变句柄（PRM-G1 单向/PRM-G5 不得只改内存） */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}
