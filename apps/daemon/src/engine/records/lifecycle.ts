/**
 * engine/records/lifecycle —— 相位 0 名册装载与决定型权源解析（派生编排件）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位 0 启动装载＝名册→LIFE-05→AUTH-01→LIFE-01；
 *     相位 3/4/6 迁移缝＝决定型权源解析）；
 *   - docs/v2/11 §3.1（REC-LIFE-01 五条件/幂等四元组）、§2.2（REC-AUTH-01 根授予三闸/转授边/
 *     不可为边界）、§0.4-4（重放零第二副作用）、§十五-2（跨记录不变量）；docs/v2/15 §七（独立性）。
 *
 * 纪律（自填即拒的机制面）：
 *   - 入参只有「时刻/工号」；任职与授权事实一律由 `roster.ts`/`authority.ts`/`life.ts` 派生；
 *   - 前件只认**已落库**记录（`refOf` 注入；命中才引用）——不引用未来记录、不跨步补造；
 *   - 缺名册/顶位不可裁决＝拒写（逐项点名），不猜、不冒充；
 *   - 抽取动机（20-§十五.三「先拆再增」）：wire.ts 只留写口与三态折叠，派生编排收在本件。
 */
import {
  coveringGrantOf,
  delegationDraft,
  delegationRecordId,
  grantRef,
  leaderGrantRecordId,
  rootGrantDraft,
  rootGrantRecordId,
  type AuthorityChain,
  type RootGrantFact,
} from './authority.ts'
import type { DraftOutcome, DraftRecordRef } from './drafts.ts'
import { appointmentDraft, conflictRegistryDraft, conflictRegistryRecordId } from './life.ts'
import { deptOf, isOnDuty, personOf, topPersonOf, type CompanyRoster } from './roster.ts'
import type { RecordRosterLoadArgs, RecordWriteResult } from './types.ts'

/** 相位 0 名册装载依赖（写口/引用解析注入＝wire 的唯一 append 路径；本件不直接写库） */
export interface RosterLoadDeps {
  readonly company: string
  /** 读时取名册（热更新下一拍生效；缺省＝名册不可得 → 派生化写面全拒） */
  readonly roster: () => CompanyRoster | undefined
  readonly rootGrant: RootGrantFact | undefined
  readonly write: (outcome: DraftOutcome) => RecordWriteResult
  readonly refOf: (recordId: string) => DraftRecordRef | undefined
  /** 合成拒写计数（无名册/顶位不可裁决——不经 write 的拒写也要计入观测面） */
  readonly onRefused: () => void
  readonly log?: (line: string) => void
}

/** 授权链派生（每次解析取一份；逐边记录 id 与 authority.ts 同源） */
function authorityChainOf(company: string, roster: CompanyRoster, topId: string): AuthorityChain {
  const delegations: {
    recordId: string
    grantorId: string
    granteeId: string
    included: readonly string[]
  }[] = []
  for (const dept of roster.departments) {
    const included = [
      `dept:${dept.path}`,
      ...dept.lanes.map((lane) => `lane:${lane}`),
      ...dept.functions.map((fn) => `function:${fn}`),
    ]
    // 成员边：部门主管 → 在岗成员（主管本人的授予＝上级对他的转授，见下）
    for (const person of roster.people.filter((row) => row.dept === dept.path && row.id !== dept.leader)) {
      delegations.push({
        recordId: delegationRecordId(company, dept.leader, person.id, dept.path),
        grantorId: dept.leader,
        granteeId: person.id,
        included,
      })
    }
    // 主管边：顶位 → 部门主管（顶位本人除外——其权源＝根授予）
    if (dept.leader !== topId) {
      delegations.push({
        recordId: delegationRecordId(company, topId, dept.leader, dept.path),
        grantorId: topId,
        granteeId: dept.leader,
        included: [...included, `dept-head:${dept.path}`],
      })
    }
  }
  return { root: { recordId: rootGrantRecordId(company, topId), topId }, delegations }
}

/**
 * 相位 0 名册装载（启动装载／人事变更）：LIFE-05 → AUTH-01（root→delegation）→ LIFE-01。
 * 每步只按**已落库**前件推进：前件缺则该条拒写（不跨步补造、不引用未来记录）。
 */
export function runRosterLoad(deps: RosterLoadDeps, args: RecordRosterLoadArgs): RecordWriteResult[] {
  const results: RecordWriteResult[] = []
  const roster = deps.roster()
  if (roster === undefined) {
    deps.onRefused()
    const reason = '名册端口未注入（records.roster 缺省）——任职/授权链无可派生事实源'
    deps.log?.(`[records] 拒写 名册装载：${reason}`)
    return [{ ok: false, recordType: 'REC-LIFE-05', code: 'record-prereq-missing', reason }]
  }
  const top = topPersonOf(roster)
  // ① LIFE-05 累计禁配申报（LIFE-01/AUTH-01 的 conflict_check_ref 前件；先于两者落）
  for (const person of roster.people) {
    if (!isOnDuty(person)) continue
    results.push(deps.write(conflictRegistryDraft({ roster, company: deps.company, at: args.at, personId: person.id })))
  }
  if (top === undefined) {
    // 顶位不可裁决＝授权链根不可定：如实拒写（不猜谁是最高宰相），AUTH-01/LIFE-01 全族零写
    deps.onRefused()
    const reason = '名册无法裁决顶位（根部门主管等级并列且职能同含「管理」）——授权链根不可定，AUTH-01/LIFE-01 不猜'
    deps.log?.(`[records] 拒写 REC-AUTH-01：${reason}`)
    results.push({ ok: false, recordType: 'REC-AUTH-01', code: 'record-prereq-missing', reason })
    return results
  }
  const conflictRefOf = (personId: string): DraftRecordRef | undefined => {
    const person = personOf(roster, personId)
    if (person === undefined) return undefined
    return deps.refOf(conflictRegistryRecordId(deps.company, personId, person.dept))
  }
  // ② AUTH-01：根授予（外部事实缺即拒）→ 转授边
  const rootOutcome = rootGrantDraft({ roster, company: deps.company, at: args.at, fact: deps.rootGrant, conflictCheckRef: conflictRefOf(top.id) })
  results.push(deps.write(rootOutcome))
  const rootRef = deps.refOf(rootGrantRecordId(deps.company, top.id))
  if (rootRef !== undefined && deps.rootGrant === undefined) {
    // 根授予已在库但本次无外部事实（如重启未注入 recordsRootGrant）：转授边**不派生**——
    // 父授予期限只能取外部授予事实，不在本件造期限（不猜、不拿缺省值冒充）。
    deps.log?.('[records] 根授予已落库但本次无外部事实注入——REC-AUTH-01 转授边不派生（不自行造 parent term）')
  }
  if (rootRef !== undefined && deps.rootGrant !== undefined) {
    // 父授予期限一律取外部授予事实（root 期限）——不自行造期限
    const parentTerm = deps.rootGrant.term
    for (const dept of roster.departments) {
      if (dept.leader !== top.id) {
        results.push(
          deps.write(
            delegationDraft({
              roster,
              company: deps.company,
              at: args.at,
              grantorId: top.id,
              granteeId: dept.leader,
              dept,
              parentGrantRef: grantRef(leaderGrantRecordId(deps.company, top.id, top.id, dept.path)),
              parentTerm,
              grantorConflictCheckRef: conflictRefOf(top.id),
              granteeConflictCheckRef: conflictRefOf(dept.leader),
            }),
          ),
        )
      }
      for (const person of roster.people.filter((row) => row.dept === dept.path && row.id !== dept.leader)) {
        results.push(
          deps.write(
            delegationDraft({
              roster,
              company: deps.company,
              at: args.at,
              grantorId: dept.leader,
              granteeId: person.id,
              dept,
              parentGrantRef: grantRef(leaderGrantRecordId(deps.company, top.id, dept.leader, dept.path)),
              parentTerm,
              grantorConflictCheckRef: conflictRefOf(dept.leader),
              granteeConflictCheckRef: conflictRefOf(person.id),
            }),
          ),
        )
      }
    }
  }
  // ③ LIFE-01 任命（拟任面；权源链引用取已落 AUTH-01）
  for (const person of roster.people) {
    if (!isOnDuty(person)) continue
    const dept = deptOf(roster, person.dept)
    if (dept === undefined) continue
    const appointingRef = deps.refOf(leaderGrantRecordId(deps.company, top.id, dept.leader, dept.path))
    const rootRefForG9 = deps.refOf(rootGrantRecordId(deps.company, top.id))
    const conflictRef = conflictRefOf(person.id)
    results.push(
      deps.write(
        appointmentDraft({
          roster,
          company: deps.company,
          at: args.at,
          personId: person.id,
          ...(appointingRef !== undefined ? { appointingAuthorityRef: appointingRef, nominationRef: appointingRef, decisionBasisRef: appointingRef } : {}),
          ...(rootRefForG9 !== undefined ? { rootDelegationRef: rootRefForG9 } : {}),
          ...(conflictRef !== undefined ? { conflictCheckRef: conflictRef } : {}),
        }),
      ),
    )
  }
  return results
}

/** 权源解析依赖（授予链由名册派生；覆盖判定本体注入＝authority.coveringGrantOf 单源） */
export interface AuthorityRefDeps {
  readonly roster: () => CompanyRoster | undefined
  readonly company: string
  readonly personId: string
  readonly actionScope: string
  readonly refOf: (recordId: string) => DraftRecordRef | undefined
  readonly covering: (chain: AuthorityChain, personId: string, actionScope: string) => DraftRecordRef | undefined
}

/**
 * 决定型记录权源解析：该工号在给定动作范围上的覆盖授予引用。
 * 返回的引用**不一定已落库**——调用方须再以 `refOf` 核验（未落库＝不引用未来记录）。
 */
export function resolveAuthorityRef(deps: AuthorityRefDeps): DraftRecordRef | undefined {
  const roster = deps.roster()
  if (roster === undefined) return undefined
  const top = topPersonOf(roster)
  if (top === undefined) return undefined
  const chain = authorityChainOf(deps.company, roster, top.id)
  return deps.covering(chain, deps.personId, deps.actionScope)
}

/** 覆盖判定本体再出口（wire 注入用；避免 wire 直接依赖 coveringGrantOf 的实现细节） */
export { coveringGrantOf }
