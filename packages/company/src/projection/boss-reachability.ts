/**
 * 组织纯投影 · 老板可达性面（NEG-ORG-08；MIG-05 补强）
 *
 * 依据：docs/v2/03 §3.5（外部老板不可达且无有效代行授权时**内核冻结·运行延续**：仅四类硬核
 * 动作依赖外部老板在场——最高宰相任免/撤回、root 密钥轮换/撤回、外部独立审计、清算与公司
 * 身份处置；冻结须登记与复审，不得无限期；代行人**不得是最高宰相**，也不得是本次被处置
 * 对象；继承/代行程序为目标未证，GAP-V2-07）、§八（强制失败出口）、docs/v2/17 §4.1
 * NEG-ORG-07/NEG-ORG-08。
 *
 * 本件职责（纯函数、零 IO）：
 *   - 输入边界收口：`bossReachability.state` 闭式二值＋`actingRef`＋`hardCorePending`；
 *   - 不可达且**无有效代行却仍推进硬核事项** → blocking（硬核事项停摆待老板＋保全）；
 *   - 代行者＝最高宰相 → blocking（它就是内部老板，不是代行人）；内部岗位/未具名＝无效代行；
 *   - 不可达且无有效代行 → 内核冻结·运行延续（合法态，须登记复审；不悬置、不停摆）。
 *
 * 与 bossAbsence（常量策略投影）叠合：常量面给「冻结·运行延续／悬置禁止」规则，本面给本输入
 * 可达态与处置结论；缺省（未声明）＝未声明，不猜可达、不阻断（旧输入兼容）。
 */
import { ISSUE_CODES, projectionIssue } from './issues.ts'
import { BOSS_REACHABILITY_STATES } from './types.ts'
import type { BossReachabilityProjection, BossReachabilityState, OrganizationProjectionInput, ProjectionIssue } from './types.ts'

/** 有效代行的唯一形态前缀（外部老板书面授权的外部代行；具名记录引用）。 */
export const EXTERNAL_PROXY_PREFIX = 'external-proxy:'

/** 最高宰相引用（内部老板，不得代行——v2/03 §3.5/表 A′）。 */
export const SUPREME_MINISTER_REF = 'supreme-minister'

/** 代行引用解析结论。 */
export type ActingRefReason = 'named-external-proxy' | 'forbidden-supreme-minister' | 'not-external-proxy' | 'missing'

/** 代行引用解析结果。 */
export interface ActingRefResolution {
  valid: boolean
  reason: ActingRefReason
}

/**
 * 解析代行引用：仅 `external-proxy:<具名记录>` 有效；最高宰相（含其记录前缀）＝禁止；
 * 空/内部岗位/裸工号/未具名＝无效（不猜「有代行」）。
 */
export function resolveActingRef(ref: string | null): ActingRefResolution {
  if (ref === null) return { valid: false, reason: 'missing' }
  if (ref === SUPREME_MINISTER_REF || ref.startsWith(`${SUPREME_MINISTER_REF}:`)) {
    return { valid: false, reason: 'forbidden-supreme-minister' }
  }
  if (!ref.startsWith(EXTERNAL_PROXY_PREFIX)) return { valid: false, reason: 'not-external-proxy' }
  const recordRef = ref.slice(EXTERNAL_PROXY_PREFIX.length).trim()
  if (recordRef === '' || /\s/.test(recordRef)) return { valid: false, reason: 'not-external-proxy' }
  return { valid: true, reason: 'named-external-proxy' }
}

const DEPENDENT_HARD_CORE_REF = 'v2/03 §3.5'

/** 输入已解析件 → 老板可达性投影（含校验 issue；失败不静默放行）。 */
export function buildBossReachability(
  input: OrganizationProjectionInput,
  issues: ProjectionIssue[],
): BossReachabilityProjection {
  const declared: unknown = input.org.bossReachability
  if (declared === undefined) {
    return {
      source: 'undeclared',
      state: null,
      actingRef: null,
      actingValid: false,
      hardCorePending: [],
      kernelState: 'active',
      reviewRequired: false,
      dependentHardCoreRef: DEPENDENT_HARD_CORE_REF,
    }
  }

  const record = typeof declared === 'object' && declared !== null ? (declared as Record<string, unknown>) : null
  const rawState = record !== null ? record.state : undefined
  const rawActingRef = record !== null ? record.actingRef : undefined
  const actingRef = typeof rawActingRef === 'string' && rawActingRef.trim() !== '' ? rawActingRef.trim() : null

  const hardCorePending: string[] = []
  const rawPending = record !== null ? record.hardCorePending : undefined
  if (rawPending !== undefined) {
    if (!Array.isArray(rawPending)) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.bossReachabilityShape,
          '(org)',
          'bossReachability.hardCorePending 不是列表——不可达期硬核事项须逐项具名，不得以可选容器代替（NEG-ORG-08）',
        ),
      )
    } else {
      for (const item of rawPending as readonly unknown[]) {
        if (typeof item !== 'string' || item.trim() === '') {
          issues.push(
            projectionIssue(
              'structure',
              ISSUE_CODES.bossReachabilityShape,
              '(org)',
              'bossReachability.hardCorePending 含非字符串/空项——硬核事项须具名，不得留空（NEG-ORG-08）',
            ),
          )
          continue
        }
        hardCorePending.push(item.trim())
      }
    }
  }

  const state =
    typeof rawState === 'string' && (BOSS_REACHABILITY_STATES as readonly string[]).includes(rawState)
      ? (rawState as BossReachabilityState)
      : null
  if (state === null) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.bossReachabilityShape,
        '(org)',
        `bossReachability.state=${String(rawState)} 不在闭式二值（${BOSS_REACHABILITY_STATES.join('/')}）——未知可达态不得默认放行（v2/03 §3.5；NEG-ORG-08）`,
      ),
    )
    return {
      source: 'declared',
      state: null,
      actingRef,
      actingValid: false,
      hardCorePending,
      kernelState: 'active',
      reviewRequired: false,
      dependentHardCoreRef: DEPENDENT_HARD_CORE_REF,
    }
  }

  if (state === 'reachable') {
    return {
      source: 'declared',
      state,
      actingRef,
      actingValid: actingRef !== null && resolveActingRef(actingRef).valid,
      hardCorePending,
      kernelState: 'active',
      reviewRequired: false,
      dependentHardCoreRef: DEPENDENT_HARD_CORE_REF,
    }
  }

  // ── 不可达：代行合法性 + 硬核在途处置（NEG-ORG-08）──
  const acting = resolveActingRef(actingRef)
  if (acting.reason === 'forbidden-supreme-minister') {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.bossProxyForbidden,
        '(org)',
        '老板不可达时代的行者＝最高宰相——它就是内部老板，不得代行（v2/03 §3.5；NEG-ORG-08）',
      ),
    )
  } else if (actingRef !== null && !acting.valid) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.bossProxyInvalid,
        '(org)',
        `老板不可达时代行引用 ${actingRef} 不是具名外部代行——代行须为外部老板书面可验证授权（${EXTERNAL_PROXY_PREFIX}<记录>），内部岗位/裸工号不得冒充（v2/03 §3.5；NEG-ORG-08）`,
      ),
    )
  }

  if (hardCorePending.length > 0 && !acting.valid) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.bossHardCoreWithoutProxy,
        '(org)',
        `老板不可达且无有效代行，仍推进硬核事项（${hardCorePending.join('/')}）——硬核事项须停摆待老板＋保全，不得以运行延续为名推进（v2/03 §3.5/§八；NEG-ORG-08）`,
      ),
    )
  }

  return {
    source: 'declared',
    state,
    actingRef,
    actingValid: acting.valid,
    hardCorePending,
    // 不可达且无有效代行＝内核冻结·运行延续（合法态；有外部代行时才由代行承接）
    kernelState: acting.valid ? 'active' : 'frozen-run-continues',
    reviewRequired: true,
    dependentHardCoreRef: DEPENDENT_HARD_CORE_REF,
  }
}
