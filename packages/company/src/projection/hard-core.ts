/**
 * 组织纯投影 · 部门硬核面（NEG-ORG-05；MIG-05 补强）
 *
 * 依据：docs/v2/03 §6.3（部门硬核由**部长上一层**批准与保管；部长与部门自身只能改部门软外围，
 * 部门自改硬核=无效，判负）、§2.3 表 A′ 行 8（部门硬核归属＝部长上一层；未设部门归最高宰相）、
 * §3.1（合法性源自授权链：外部老板设立行为＋root_delegation→最高宰相→逐层批准）、
 * docs/v2/17 §4.1 NEG-ORG-05。
 *
 * 本件只做两件事（纯函数、零 IO）：
 *   1. 授权引用解析：`external-boss:`/`supreme-minister:`/`unit-head:`＋具名记录引用＝有效；
 *      空/未具名/部门自身/未知前缀＝无效（不猜、不默认放行）；
 *   2. 硬核变更校验：`validateDepartmentHardCoreChange(before, after)` —— 部门自行改硬核
 *      （无外部/最高宰相/上一层授权引用）→ 拒；授权引用具名→允许；内容未变→允许（不改写）。
 *
 * 边界：本件不读记录、不验签（记录/验签面归 v2/11/v2/15）；只判**投影输入声明**是否给出了
 * 可解析的具名授权引用——具名引用是否真实存在由记录面复核，投影不冒充已核验。
 */
import { ISSUE_CODES, projectionIssue } from './issues.ts'
import type { ParsedDepartment, ProjectedDepartmentNode, ProjectionIssue } from './types.ts'

/** 硬核授权者族（闭式；上一层＝一级单元首长，未设/缺位时收口到最高宰相——v2/03 §6.3）。 */
export const HARD_CORE_AUTHORIZERS = ['external-boss', 'supreme-minister', 'unit-head'] as const
export type HardCoreAuthorizer = (typeof HARD_CORE_AUTHORIZERS)[number]

/** 授权引用解析结论（named=具名可用；其余一律无效）。 */
export type HardCoreAuthorizationReason = 'named' | 'missing' | 'unnamed' | 'self' | 'unknown-authorizer'

/** 硬核授权引用解析结果（不验真伪：只判引用是否具名、是否来自部门之外）。 */
export interface HardCoreAuthorization {
  authorized: boolean
  authorizer: HardCoreAuthorizer | null
  /** 冒号后的记录引用（具名部分）；无效=null。 */
  recordRef: string | null
  reason: HardCoreAuthorizationReason
}

/**
 * 解析部门硬核授权引用（闭式文法 `authorizer:record`）。
 *   - 非字符串/空串 → missing（无授权引用）
 *   - 无冒号或冒号后为空/含空白 → unnamed（未具名）
 *   - 前缀=department → self（部门自授，判负）
 *   - 前缀不在授权者族 → unknown-authorizer
 *   - 其余 → named（具名授权引用；真伪归记录面复核）
 */
export function parseHardCoreAuthorization(ref: unknown): HardCoreAuthorization {
  if (typeof ref !== 'string') return unauthorized('missing')
  const trimmed = ref.trim()
  if (trimmed === '') return unauthorized('missing')
  const separator = trimmed.indexOf(':')
  if (separator < 0) return unauthorized('unnamed')
  const prefix = trimmed.slice(0, separator)
  const recordRef = trimmed.slice(separator + 1).trim()
  if (recordRef === '' || /\s/.test(recordRef)) return unauthorized('unnamed')
  if (prefix === 'department') return unauthorized('self')
  if (!(HARD_CORE_AUTHORIZERS as readonly string[]).includes(prefix)) return unauthorized('unknown-authorizer')
  return { authorized: true, authorizer: prefix as HardCoreAuthorizer, recordRef, reason: 'named' }
}

function unauthorized(reason: HardCoreAuthorizationReason): HardCoreAuthorization {
  return { authorized: false, authorizer: null, recordRef: null, reason }
}

/** 硬核变更判负理由（与投影 issue 面分开：本面给纯函数结论，不构造 issue）。 */
export type HardCoreChangeVerdict =
  | 'unchanged'
  | 'authorized'
  | 'missing-authorization'
  | 'self-authorization'
  | 'invalid-authorization'

/** 硬核变更校验结果（确定性；输入零改写）。 */
export interface DepartmentHardCoreChangeValidation {
  allowed: boolean
  verdict: HardCoreChangeVerdict
  /** 发生变化的硬核字段（码点序固定：hardCore→hardCoreRef）。 */
  changedFields: readonly ('hardCore' | 'hardCoreRef')[]
  authorizer: HardCoreAuthorizer | null
  /** after 的授权引用（规范化后；null=无）。 */
  authorizationRef: string | null
  /** 依据引用（唯一主表；不复制正文）。 */
  basisRef: 'v2/03 §6.3'
}

/**
 * 部门硬核变更校验（NEG-ORG-05 的真实判定函数）。
 *
 * 语义（v2/03 §6.3）：
 *   - 硬核内容/授权引用未变 → allowed（nothing to authorize）；
 *   - 变了且 after 有**具名上位授权引用**（external-boss/supreme-minister/unit-head）→ allowed；
 *   - 变了但无授权引用 / 未具名 / 自指 / 未知授权者 → 拒（部门自改硬核=无效）。
 *
 * 纯函数：不读文件、不取时钟、不写输入；同一对输入同输出。
 */
export function validateDepartmentHardCoreChange(
  before: ParsedDepartment,
  after: ParsedDepartment,
): DepartmentHardCoreChangeValidation {
  const changedFields: ('hardCore' | 'hardCoreRef')[] = []
  if (!sameHardCore(before.hardCore, after.hardCore)) changedFields.push('hardCore')
  const beforeRef = normalizeHardCoreRef(before.hardCoreRef)
  const afterRef = normalizeHardCoreRef(after.hardCoreRef)
  if (beforeRef !== afterRef) changedFields.push('hardCoreRef')

  if (changedFields.length === 0) {
    return {
      allowed: true,
      verdict: 'unchanged',
      changedFields,
      authorizer: null,
      authorizationRef: afterRef,
      basisRef: 'v2/03 §6.3',
    }
  }

  const authorization = parseHardCoreAuthorization(after.hardCoreRef)
  if (authorization.authorized) {
    const authorizer = authorization.authorizer
    const recordRef = authorization.recordRef
    return {
      allowed: true,
      verdict: 'authorized',
      changedFields,
      authorizer,
      authorizationRef: authorizer !== null && recordRef !== null ? `${authorizer}:${recordRef}` : afterRef,
      basisRef: 'v2/03 §6.3',
    }
  }

  return {
    allowed: false,
    verdict:
      authorization.reason === 'self'
        ? 'self-authorization'
        : authorization.reason === 'missing'
          ? 'missing-authorization'
          : 'invalid-authorization',
    changedFields,
    authorizer: null,
    authorizationRef: afterRef,
    basisRef: 'v2/03 §6.3',
  }
}

/**
 * 投影输入面：部门**声明**了硬核时，其授权引用必须具名且来自部门之外。
 * 缺省（未声明 hardCore）＝不发明、不阻断（旧输入兼容）；声明了硬核却无有效授权引用＝部门
 * 自改硬核，投影阻断（NEG-ORG-05）。
 */
export function validateDeclaredHardCores(
  nodes: readonly ProjectedDepartmentNode[],
  issues: ProjectionIssue[],
): void {
  for (const node of nodes) {
    if (node.hardCore.length === 0) continue
    const authorization = parseHardCoreAuthorization(node.hardCoreRef)
    if (authorization.authorized) continue
    const code =
      authorization.reason === 'self'
        ? ISSUE_CODES.departmentHardCoreSelfAuthorized
        : ISSUE_CODES.departmentHardCoreUnauthorized
    issues.push(
      projectionIssue(
        'structure',
        code,
        node.path,
        `部门 ${node.path} 声明硬核（${node.hardCore.join('/')}）但授权引用${
          authorization.reason === 'missing'
            ? '缺省/为空（无外部/最高宰相授权引用）'
            : authorization.reason === 'unnamed'
              ? '未具名（缺记录引用）'
              : authorization.reason === 'self'
                ? '指向部门自身（自授）'
                : '前缀不在外部老板/最高宰相/一级单元首长之列'
        }——部门自改硬核=无效＋判负（v2/03 §6.3；NEG-ORG-05）`,
      ),
    )
  }
}

/** 硬核内容按集合比较（顺序/重复不构成变更；空白项视同未声明）。 */
function sameHardCore(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = canonicalHardCore(left)
  const b = canonicalHardCore(right)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function canonicalHardCore(items: readonly string[] | undefined): readonly string[] {
  const unique = new Set<string>()
  for (const item of items ?? []) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed !== '') unique.add(trimmed)
  }
  return [...unique].sort()
}

function normalizeHardCoreRef(ref: string | null | undefined): string | null {
  if (typeof ref !== 'string') return null
  const trimmed = ref.trim()
  return trimmed === '' ? null : trimmed
}
