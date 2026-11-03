/**
 * engine/records/work-chain-wire —— 开工/完成/验收链写面编排（刀C；从 wire.ts 拆出守 600 行阈）
 *
 * 依据：docs/17-§2（相位×记录类型×写入者映射表）；docs/17-§6（收割四要件判据零变更——记录是
 * 留痕不是判据）；docs/v2/11 §5.1/§5.2/§六/§〇.3-2/§十四 §14.1（M-05/M-10/M-17 前置记录列）、
 * §十五-2（引用完整性：只引已落库记录）。
 *
 * 拆件纪律（20-§十五.三「先拆再增」）：本件只是把 wire.ts 内的链编排逐字搬出；写口/拒写/计数
 * 仍由 wire.ts 注入（同一 `hist.append`、同一三态、同一计数），**不是第二写面**。
 */
import type { HistFace } from '@studio-next/store'
import {
  HIGH_SIDE_EFFECT_LEVELS,
  validateCompletionRecord,
  validateEffectLevel,
  validateEvidencePackage,
  validateIntakeDecision,
  validatePlanLock,
  validateStartDecision,
  validateWorkAcceptance,
  validateWorkContract,
  type RecordValidationOutcome,
} from '@studio-next/contract/records'
import type { ReadContext } from '@studio-next/contract'
import { workTransitionDrafts, type DraftOutcome } from './drafts.ts'
import {
  chainRecordId,
  chainRef,
  completionRecordDraft,
  decisionFaceOf,
  effectLevelDraft,
  evidencePackageDraft,
  intakeDecisionDraft,
  planLockDraft,
  startDecisionDraft,
  workAcceptanceDraft,
  workContractDraft,
} from './work-chain.ts'
import type {
  RecordAcceptanceChainArgs,
  RecordHarvestChainArgs,
  RecordStartChainArgs,
  RecordWirePort,
  RecordWriteResult,
} from './types.ts'

/** 链编排入参（写口/拒写/计数由 wire.ts 注入——同一写面，不复制） */
export interface ChainWriterDeps {
  readonly company: string
  readonly hist: HistFace
  readonly counters: RecordWirePort['counters']
  readonly write: (outcome: DraftOutcome, subjectId?: string, familyCheck?: (envelope: unknown) => string[]) => RecordWriteResult
  readonly refuse: (outcome: Extract<DraftOutcome, { ok: false }>) => RecordWriteResult
  readonly log?: (line: string) => void
}

/** 链写面（三相位；逐族三态回报，失败不打断拍） */
export interface ChainWriter {
  startChain(args: RecordStartChainArgs): readonly RecordWriteResult[]
  harvestChain(args: RecordHarvestChainArgs): readonly RecordWriteResult[]
  acceptanceChain(args: RecordAcceptanceChainArgs): readonly RecordWriteResult[]
}

/** 建链写面（每个 wire 实例一个；不共享事务/不另开库） */
export function createChainWriter(deps: ChainWriterDeps): ChainWriter {
  const { company, hist, counters } = deps
  /**
   * hist 读面闸（v2/14 §0.2-1：读方法必带 ReadContext，缺省/越权＝拒）：
   * 前件记录引用完整性读取是**程序读**，公司维＝装配公司（两槽同填——V2 公司身份表落位前
   * companyId 与 slug 同值）；内部读不享「无上下文」旁路。
   */
  const readContext: ReadContext = {
    readScope: {
      company: { companyId: company, slug: company },
      fields: ['records.record.payload'],
      purpose: 'work-chain-wire 前件记录引用完整性读',
    },
    caller: {
      callerId: 'daemon:engine/records/work-chain-wire',
      kind: 'program',
      programRef: 'daemon:engine/records/work-chain-wire',
    },
  }

  /** contract 判定结论 → 字段级 issue 串（写面统一口径） */
  const issuesOf = (outcome: RecordValidationOutcome): string[] =>
    outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}=${issue.message}`)

  /** payload 内 RecordRef 逐条验「已落库」（本链已产出者豁免；引用未来记录＝拒写——§十五-2） */
  const missingRefsOf = (payload: unknown, produced: ReadonlySet<string>): string[] => {
    const missing = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item)
        return
      }
      if (typeof value !== 'object' || value === null) return
      const bag = value as Record<string, unknown>
      const refType = bag['refType']
      const refId = bag['refId']
      const refVersion = bag['refVersion']
      if (typeof refType === 'string' && refType.startsWith('REC-') && typeof refId === 'string' && typeof refVersion === 'string') {
        if (!produced.has(refId) && hist.get(refId, readContext) === undefined) missing.add(`${refType}:${refId}`)
        return
      }
      for (const item of Object.values(bag)) walk(item)
    }
    walk(payload)
    return [...missing]
  }

  /** 链步：先验前件已落库，再过 contract 族不变量，最后 append；失败不抛、不打断拍 */
  const chainStep = (
    results: RecordWriteResult[],
    produced: Set<string>,
    outcome: DraftOutcome,
    familyCheck?: (envelope: unknown) => string[],
  ): RecordWriteResult => {
    if (!outcome.ok) {
      const result = deps.refuse(outcome)
      results.push(result)
      return result
    }
    const missing = missingRefsOf(outcome.draft.payload, produced)
    if (missing.length > 0) {
      counters.refused += 1
      const reason = `前件记录未落：${missing.join('、')}（不引用未来记录——§0.4-2/§十五-2；先跑对应相位/刀）`
      deps.log?.(`[records] 拒写 ${outcome.draft.recordType}：${reason}`)
      const result = { ok: false, recordType: outcome.draft.recordType, code: 'record-prereq-missing', reason } as const
      results.push(result)
      return result
    }
    const result = deps.write(outcome, undefined, familyCheck)
    if (result.ok) produced.add(result.recordId)
    results.push(result)
    return result
  }

  /** 迁移边序列（#629：复合路径逐边各一条；整条路径先全量成信封，失败即整条不写） */
  const chainPath = (
    results: RecordWriteResult[],
    produced: Set<string>,
    args: Parameters<typeof workTransitionDrafts>[0],
  ): RecordWriteResult => {
    const outcome = workTransitionDrafts(args)
    if (!outcome.ok) {
      const result = deps.refuse(outcome)
      results.push(result)
      return result
    }
    let last: RecordWriteResult | undefined
    for (const draft of outcome.drafts) {
      const result = deps.write({ ok: true, draft })
      if (result.ok) produced.add(result.recordId)
      results.push(result)
      last = result
      if (!result.ok) return result
    }
    return last ?? {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-write-failed',
      reason: '迁移路径为空（边序列解析不应产出空路径）',
    }
  }

  /** 事实口缺省：逐族拒写并点名（不静默、不猜事实） */
  const factsMissing = (recordTypes: readonly string[], reason: string): RecordWriteResult[] => {
    counters.refused += recordTypes.length
    deps.log?.(`[records] 拒写 ${recordTypes.join('/')}：${reason}`)
    return recordTypes.map((recordType) => ({ ok: false, recordType, code: 'record-prereq-missing', reason }) as const)
  }

  return {
    /**
     * 相位 3：开工链（WORK-02→07→03→05→04）＋ M-05 迁移。
     * 顺序依据：WORK-03 的 risk_classification_ref 必引 WORK-07（§5.1）→ 效果级先于合同；
     * 计划锁在五门之前（§5.2）→ WORK-05 先于 WORK-04；M-05 边前置＝WORK-04＋WORK-05（§14.1）。
     */
    startChain(args: RecordStartChainArgs): readonly RecordWriteResult[] {
      const facts = args.facts
      if (facts === undefined) {
        return factsMissing(
          ['REC-WORK-02', 'REC-WORK-07', 'REC-WORK-03', 'REC-WORK-05', 'REC-WORK-04'],
          '决定点事实未注入（v0 决定点未产出 V2 决定事实；刀B 权源/任职前件亦未落）——开工链 fail-closed，不臆造记录',
        )
      }
      const results: RecordWriteResult[] = []
      const produced = new Set<string>()
      const base = { company, ticket: args.ticket, attempt: args.attempt, at: args.at }
      chainStep(results, produced, intakeDecisionDraft({ ...base, payload: facts.intake }), (env) =>
        issuesOf(validateIntakeDecision(env, { contractEstablished: true, claimsWorkTransition: false })),
      )
      chainStep(results, produced, effectLevelDraft({ ...base, payload: facts.effect }), (env) =>
        issuesOf(validateEffectLevel(env, { doubtful: facts.workType === 'unclassified' })),
      )
      chainStep(results, produced, workContractDraft({ ...base, decidedBy: facts.transition.decidedBy, payload: facts.contract }), (env) =>
        issuesOf(validateWorkContract(env, { workType: facts.workType })),
      )
      chainStep(results, produced, planLockDraft({ ...base, decidedBy: facts.transition.decidedBy, payload: facts.plan }), (env) =>
        issuesOf(validatePlanLock(env)),
      )
      chainStep(results, produced, startDecisionDraft({ ...base, payload: facts.start }), (env) =>
        issuesOf(validateStartDecision(env, { workType: facts.workType, planLockBeforeGates: true })),
      )
      const startRef = chainRef('REC-WORK-04', chainRecordId(company, args.ticket, args.attempt, 'REC-WORK-04'))
      const planRef = chainRef('REC-WORK-05', chainRecordId(company, args.ticket, args.attempt, 'REC-WORK-05'))
      if (results.some((result) => !result.ok)) return results
      chainPath(
        results,
        produced,
        {
          ticket: args.ticket,
          attempt: args.attempt,
          fromPlatformState: args.fromState ?? '待批',
          toPlatformState: args.toState ?? '已派发',
          at: args.at,
          actor: args.actor,
          company,
          evidenceRefs: [startRef, planRef],
          ruleBasisRef: startRef,
          authorityRef: facts.transition.authorityRef,
          decision: decisionFaceOf(facts.transition, args.at),
        },
      )
      return results
    },
    /** 相位 4 收割：EVD-03→WORK-08＋M-10 迁移（M-10 前置＝WORK-08＋EVD-03——§14.1） */
    harvestChain(args: RecordHarvestChainArgs): readonly RecordWriteResult[] {
      const facts = args.facts
      if (facts === undefined) {
        return factsMissing(
          ['REC-EVD-03', 'REC-WORK-08'],
          '收割决定点事实未注入（证据包/完成判据无决定面事实）——收割链 fail-closed，不臆造记录',
        )
      }
      const results: RecordWriteResult[] = []
      const produced = new Set<string>()
      const base = { company, ticket: args.ticket, attempt: args.attempt, at: args.at }
      const highSide = HIGH_SIDE_EFFECT_LEVELS.includes(facts.effectLevel)
      chainStep(results, produced, evidencePackageDraft({ ...base, actor: args.actor, payload: facts.evidencePackage }), (env) =>
        issuesOf(validateEvidencePackage(env, { forEx2Acceptance: highSide })),
      )
      chainStep(results, produced, completionRecordDraft({ ...base, actor: args.actor, payload: facts.completion }), (env) =>
        issuesOf(
          validateCompletionRecord(env, {
            effectLevel: facts.effectLevel,
            collectorIsDeliverer: facts.completion.collector_identity.collector === args.actor,
          }),
        ),
      )
      const evidenceRef = chainRef('REC-EVD-03', chainRecordId(company, args.ticket, args.attempt, 'REC-EVD-03'))
      const completionRef = chainRef('REC-WORK-08', chainRecordId(company, args.ticket, args.attempt, 'REC-WORK-08'))
      if (results.some((result) => !result.ok)) return results
      chainPath(
        results,
        produced,
        {
          ticket: args.ticket,
          attempt: args.attempt,
          fromPlatformState: args.fromState ?? '已派发',
          toPlatformState: args.toState ?? '证据就绪',
          at: args.at,
          actor: args.actor,
          company,
          evidenceRefs: [completionRef, evidenceRef],
          ruleBasisRef: completionRef,
          authorityRef: facts.transition.authorityRef,
          decision: decisionFaceOf(facts.transition, args.at),
        },
      )
      return results
    },
    /** 相位 4 收尾·验收：WORK-09＋M-17 迁移（M-17 前置＝WORK-09——§14.1） */
    acceptanceChain(args: RecordAcceptanceChainArgs): readonly RecordWriteResult[] {
      const facts = args.facts
      if (facts === undefined) {
        return factsMissing(['REC-WORK-09'], '验收决定点事实未注入（判者/独立性/证据包引用不可得）——验收链 fail-closed，不臆造记录')
      }
      const results: RecordWriteResult[] = []
      const produced = new Set<string>()
      const base = { company, ticket: args.ticket, attempt: args.attempt, at: args.at }
      chainStep(results, produced, workAcceptanceDraft({ ...base, payload: facts.acceptance }), (env) =>
        issuesOf(
          validateWorkAcceptance(env, {
            judgedByDeliverer: facts.acceptance.judged_by === args.actor,
            selfCheckOnly: false,
            effectLevel: facts.effectLevel,
          }),
        ),
      )
      const acceptanceRef = chainRef('REC-WORK-09', chainRecordId(company, args.ticket, args.attempt, 'REC-WORK-09'))
      if (results.some((result) => !result.ok)) return results
      chainPath(
        results,
        produced,
        {
          ticket: args.ticket,
          attempt: args.attempt,
          fromPlatformState: args.fromState ?? '证据就绪',
          toPlatformState: args.toState ?? '复验通过',
          at: args.at,
          actor: args.actor,
          company,
          evidenceRefs: [acceptanceRef],
          ruleBasisRef: acceptanceRef,
          authorityRef: facts.transition.authorityRef,
          decision: decisionFaceOf(facts.transition, args.at),
        },
      )
      return results
    },
  }
}
