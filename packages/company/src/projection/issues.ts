/**
 * 组织纯投影 · 问题面（MIG-05 / IMPL-05-03）
 *
 * 纪律：投影问题只描述**输入形状/权威/结构**层面的可判事实，不写业务裁决；blocking=true
 * 表示「不得据此产出可信投影」（fail-closed：宁 blocked 不猜）。issue 的 code 是投影面
 * 自有的稳定标识（不冒充 v2/17 的 NEG-/SEC- 编号；NEG 映射见各测试 describe/it 名）。
 */
import type { ProjectionIssue } from './types.ts'

/** 投影问题码（稳定标识；测试经本表引用，不散写字面量）。 */
export const ISSUE_CODES = {
  // —— 权威面（O3-01）——
  authorityConflict: 'projection/authority-conflict',
  duplicateDeclaration: 'projection/duplicate-declaration',
  declarationShape: 'projection/declaration-shape',
  legacyFaceDrift: 'projection/legacy-face-drift',
  // —— 树面 ——
  danglingParent: 'projection/dangling-parent',
  parentCycle: 'projection/parent-cycle',
  // —— 结构面：一级单元（GAP-V2-17）——
  emptyUnits: 'projection/empty-units',
  unitDomainMissing: 'projection/unit-domain-missing',
  unitDomainOverlap: 'projection/unit-domain-overlap',
  unitHeadUnresolved: 'projection/unit-head-unresolved',
  unitHeadStateConflict: 'projection/unit-head-state-conflict',
  unitHeadVacancyWithoutReview: 'projection/unit-head-vacancy-without-review',
  // —— 结构面：空编（记录事实；空编静默=违规）——
  vacancyKindUnknown: 'projection/vacancy-kind-unknown',
  vacancyWithoutReview: 'projection/vacancy-without-review',
  vacantDerivedWithoutReview: 'projection/vacant-derived-without-review',
  // —— 结构面：legacy 部门首长 ——
  legacyLeaderMissing: 'projection/legacy-leader-missing',
  danglingLeader: 'projection/dangling-leader',
  // —— 结构面：CL 判据输入（NEG-ORG-06）——
  levelClaimUnverified: 'projection/level-claim-unverified',
} as const

export type ProjectionIssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES]

/** 问题构造（唯一写法；blocking 缺省 true——失败面默认拒绝放行）。 */
export function projectionIssue(
  area: ProjectionIssue['area'],
  code: ProjectionIssueCode,
  ref: string,
  detail: string,
  blocking = true,
): ProjectionIssue {
  return { code, area, ref, detail, blocking }
}

/**
 * 问题面收口：去重（同 code+ref 只留首条）＋确定性排序（ref 码点序 → code 码点序 → detail）。
 * 纯函数；排序不用 localeCompare（避免运行环境 locale 漂移）。
 */
export function sortProjectionIssues(issues: readonly ProjectionIssue[]): readonly ProjectionIssue[] {
  const seen = new Set<string>()
  const unique: ProjectionIssue[] = []
  for (const item of issues) {
    const key = `${item.code}\u0000${item.ref}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique.sort((a, b) => compareText(a.ref, b.ref) || compareText(a.code, b.code) || compareText(a.detail, b.detail))
}

/** 码点序比较（确定性，不依赖 locale）。 */
export function compareText(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
