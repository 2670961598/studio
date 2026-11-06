/**
 * engine/records/wire —— 记录族生产写面（主循环相位 → PORT-HIST）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者；本件是映射表的写侧执行体）；
 *   - docs/17-§6（收割四要件；记录落库是相位结果留痕，不参与判据）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口：`createHistFace(...).append`）；
 *   - docs/v2/11 §〇.4-1（身份一经分配不复用）／§0.4-4（同单重放返回既有结果、零第二副作用）／
 *     §0.4-5（幂等五元组）／§0.7（证明边界随记录走）／§2.2（AUTH-01 根授予三闸）／§3.1（LIFE-01 五条件）；
 *   - docs/v2/02 §二/§六（任命五条件、出工段）；docs/v2/15 §七（独立性：自填即拒）。
 *
 * 纪律（与 mainloop 事件的位别）：
 *   - 记录是事实源，`events` 保留为可重建投影（docs/17-§2；本件**不改**事件写面语义）；
 *   - 记录写入失败/拒写**不得打断拍**：结果三态回报调用方（ok/deduped/refused/failed），
 *     错误进 log＋计数器，事件面照旧（fail-safe，记录面欠账可对账发现）；
 *   - 同 recordId 幂等：先读既有行（`hist.get`），命中即 deduped，不再 append（同 id 异内容由
 *     store 拒收——记录身份不复用的机械保证）；
 *   - **契约族判定不只在形状闸**：AUTH-01/LIFE-01/EVD-01 落库前再过 contract 的 `validateAuthGrant` /
 *     `validateAppointment` / `validateHarvestBatch`（族不变量：根授予三闸、任命五条件、收割三不变量），
 *     判定输入（权源解析/位置职级）由名册派生，不由调用方给；
 *   - **对账读者**（#559 验收项）：本件暴露 `reconcile()` 读面消费者，生产对账循环
 *     （`hooks.recordReconcileTick` ← 相位 7 落账）按拍节流调用 `reconcileProjection`，
 *     欠账不吞、只留痕（不新增事件名——事件枚举冻结）。
 *   - **迁移复合路径整条写/整条不写**（studio-dev-592，docs/17-§2「状态桥接」段）：先全量成
 *     信封（形状闸）再逐条落库；任一条形状不合格＝零落库，不留「半条迁移」。
 */
import type { EventRecord, ReadContext } from '@studio-next/contract'
import type { HistFace, HistRecordRef } from '@studio-next/store'
import { buildEnvelope } from './envelope.ts'
import {
  harvestBatchDraft,
  workIntakeDraft,
  workTransitionDrafts,
  type DraftOutcome,
  type TransitionDraftsOutcome,
} from './drafts.ts'
import { createChainWriter } from './work-chain-wire.ts'
import { exceptionDraft, reviewDraft, settlementDraft } from './close-drafts.ts'
import {
  accountabilityDraft,
  changeSegmentDraft,
  memoryDisposalDraft,
  remedyDraft,
  valueEvaluationDraft,
} from './governance-drafts.ts'
import { coveringGrantOf, type RootGrantFact } from './authority.ts'
import { appointmentRecordId, workSegmentDraft, workSegmentRecordId } from './life.ts'
import { resolveAuthorityRef, runRosterLoad } from './lifecycle.ts'
import { personOf, positionRefIdOf, type RosterPort } from './roster.ts'
import { reconcileProjection, type ProjectionReconciliation } from './projection.ts'
import {
  RECORD_WRITTEN_BY,
  type RecordAccountabilityArgs,
  type RecordAuthorityArgs,
  type RecordChangeSegmentArgs,
  type RecordDraft,
  type RecordDraftGate,
  type RecordExceptionArgs,
  type RecordHarvestArgs,
  type RecordIntakeArgs,
  type RecordMemoryDisposalArgs,
  type RecordRefusalCode,
  type RecordRemedyArgs,
  type RecordAcceptanceChainArgs,
  type RecordHarvestChainArgs,
  type RecordReviewArgs,
  type RecordRosterLoadArgs,
  type RecordStartChainArgs,
  type RecordSegmentArgs,
  type RecordSettlementArgs,
  type RecordTransitionArgs,
  type RecordValueEvaluationArgs,
  type RecordWirePort,
  type RecordWriteResult,
} from './types.ts'

/** 装配入参（一 serve 进程一实例；company 固定——records 一进程一公司口径） */
export interface RecordWireDeps {
  readonly hist: HistFace
  readonly company: string
  /** 名册端口（只读；装配面从 ledger 派生。缺省＝名册不可得 → 派生类写面一律拒写） */
  readonly roster?: RosterPort
  /** 根授予外部事实（#530 生产者注入；缺省＝无外部事实 → AUTH-01 拒写，见 authority.ts 纪律） */
  readonly rootGrant?: RootGrantFact
  /** 事件读面（对账读者；since＝events.ts 下界 epoch ms。缺省＝事件面不可读 → 对账只跑记录侧） */
  readonly readEvents?: (since: number) => readonly EventRecord[]
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/** 记录写面（RecordWirePort 实现；计数器为本拍/累计观测面，不落库） */
export interface RecordWire extends RecordWirePort {
  /** 记录写入路径名（producer.writtenBy；审计锚） */
  readonly writtenBy: string
}

/** 结果折叠（draft 拒写 → refused；形状/族不变量拒收 → failed；store 冲突 → failed 不重试） */
function failureOf(recordType: string, code: RecordRefusalCode, reason: string): RecordWriteResult {
  return { ok: false, recordType, code, reason }
}

/** 前件引用解析约定：刀C/授权行使面生产件按此 id 约定落库（异约定走 deps 注入换 id） */
export function planLockRecordId(company: string, ticket: string, attempt: number): string {
  return `rec-work-05:${company}:${ticket}:${attempt}`
}

/** 授权行使（REC-AUTH-02）记录 id 约定 */
export function authorizationRecordId(company: string, ticket: string, attempt: number): string {
  return `rec-auth-02:${company}:${ticket}:${attempt}`
}

/** 资格（REC-CAP-02）记录 id 约定（六面交集的资格面） */
export function qualificationRecordId(company: string, personId: string): string {
  return `rec-cap-02:${company}:${personId}`
}

/** 引用形版本（§十五-4：初始类型版本一律 1.0.0） */
const REF_VERSION = '1.0.0'

/**
 * 建记录写面。`hist` 必须已迁移到 v14/v15（`openLedger` 完成）——本件不自开库、不建表。
 */
export function createRecordWire(deps: RecordWireDeps): RecordWire {
  const { hist, company } = deps
  /**
   * hist 读面闸（v2/14 §0.2-1：读方法必带 ReadContext，缺省/越权＝拒）：
   * 本写面的前件校验/幂等命中/对账读都是**程序读**，公司维＝装配公司（两槽同填——V2 公司身份
   * 表落位前 companyId 与 slug 同值）；内部读不享「无上下文」旁路。
   */
  const readContext: ReadContext = {
    readScope: {
      company: { companyId: company, slug: company },
      fields: ['records.record.payload'],
      purpose: 'records 写面前件/幂等/对账读（engine/records/wire）',
    },
    caller: { callerId: RECORD_WRITTEN_BY, kind: 'program', programRef: RECORD_WRITTEN_BY },
  }
  const counters = {
    intake: 0,
    transition: 0,
    deduped: 0,
    refused: 0,
    failed: 0,
    settlement: 0,
    exception: 0,
    accountability: 0,
    remedy: 0,
    change: 0,
    review: 0,
    memory: 0,
    value: 0,
    lifecycle: 0,
    segment: 0,
    authority: 0,
    reconcile: 0,
  }

  const refuse = (outcome: Extract<DraftOutcome | TransitionDraftsOutcome, { ok: false }>): RecordWriteResult => {
    counters.refused += 1
    deps.log?.(`[records] 拒写 ${outcome.recordType}：${outcome.reason}`)
    return failureOf(outcome.recordType, outcome.code, outcome.reason)
  }

  /**
   * 跨记录前置闸（刀D）：被引记录必须已在库且类型一致；链前段等附加核验由 `match` 承载。
   * 缺件/异类型一律 `record-prereq-missing`——不把「将来会落」当作已落（fail-closed）。
   */
  const checkRequires = (recordType: string, requirements: NonNullable<Extract<DraftOutcome, { ok: true }>['gate']>['requires']): RecordWriteResult | undefined => {
    for (const requirement of requirements ?? []) {
      const existing = hist.get(requirement.ref.refId, readContext)
      if (existing === undefined) {
        return refuse({
          ok: false,
          recordType,
          code: 'record-prereq-missing',
          reason: `${requirement.role} 引用 ${requirement.ref.refId} 未落库（前置记录缺失——不臆造）`,
        })
      }
      if (existing.recordType !== requirement.recordType) {
        return refuse({
          ok: false,
          recordType,
          code: 'record-prereq-missing',
          reason: `${requirement.role} 引用实际类型=${existing.recordType}，期望 ${requirement.recordType}（跨记录引用须机械判族）`,
        })
      }
      const mismatch = requirement.match?.(existing)
      if (mismatch !== undefined) {
        return refuse({ ok: false, recordType, code: 'record-prereq-missing', reason: `${requirement.role}：${mismatch}` })
      }
    }
    return undefined
  }

  /** 单条写前全量闸：被引前置在库 → 形状闸 → 族内不变量；返回信封或拒（一律不落库） */
  const prepare = (
    draft: RecordDraft,
    gate?: RecordDraftGate,
  ): { readonly ok: true; readonly envelope: unknown } | { readonly ok: false; readonly result: RecordWriteResult } => {
    const missing = checkRequires(draft.recordType, gate?.requires)
    if (missing !== undefined) return { ok: false, result: missing }
    const built = buildEnvelope(draft, { company })
    if (!built.ok) {
      counters.failed += 1
      deps.log?.(`[records] 形状拒收 ${draft.recordType}（recordId=${draft.recordId}）：${built.reason}`)
      return { ok: false, result: failureOf(draft.recordType, built.code, built.reason) }
    }
    // 族内不变量（契约判定件；本件不复制判据）——不过即拒写，不落坏行
    const invariants = gate?.validate?.(built.envelope)
    if (invariants !== undefined && !invariants.ok) {
      return {
        ok: false,
        result: refuse({
          ok: false,
          recordType: draft.recordType,
          code: 'record-prereq-missing',
          reason: `族内不变量不成立：${invariants.issues.map((issue) => `${issue.path}=${issue.message}`).join('; ')}`,
        }),
      }
    }
    return { ok: true, envelope: built.envelope }
  }

  const write = (
    outcome: DraftOutcome,
    _subjectId?: string,
    familyCheck?: (envelope: unknown) => string[],
  ): RecordWriteResult => {
    if (!outcome.ok) return refuse(outcome)
    const prepared = prepare(outcome.draft, outcome.gate)
    if (!prepared.ok) return prepared.result
    if (familyCheck !== undefined) {
      const issues = familyCheck(prepared.envelope)
      if (issues.length > 0) {
        return refuse({
          ok: false,
          recordType: outcome.draft.recordType,
          code: 'record-prereq-missing',
          reason: `族内不变量不成立：${issues.join('; ')}`,
        })
      }
    }
    return appendBuilt(outcome.draft, prepared.envelope)
  }

  /** 已成信封的单条落库（幂等先读；append 异常＝failed 不重试） */
  const appendBuilt = (draft: RecordDraft, envelope: unknown): RecordWriteResult => {
    // 幂等（§0.4-4）：同 recordId 命中既有行＝重放，不产生第二次副作用
    const existing = hist.get(draft.recordId, readContext)
    if (existing !== undefined) {
      counters.deduped += 1
      const ref: HistRecordRef = { recordId: draft.recordId, recordType: draft.recordType, appended: false }
      return { ok: true, recordId: draft.recordId, recordType: draft.recordType, deduped: true, ref }
    }
    try {
      const guarded = deps.guardRecord !== undefined ? deps.guardRecord(envelope) : envelope
      const ref = hist.append(guarded)
      return {
        ok: true,
        recordId: ref.recordId,
        recordType: ref.recordType,
        deduped: ref.appended === false,
        ref,
      }
    } catch (err) {
      counters.failed += 1
      const message = err instanceof Error ? err.message : String(err)
      deps.log?.(`[records] 落库失败 ${draft.recordType}（recordId=${draft.recordId}）：${message}`)
      return failureOf(draft.recordType, 'record-write-failed', `记录未落库（PORT-HIST append 异常）：${message}`)
    }
  }

  // 刀C 链编排（work-chain-wire.ts；同一 write/refuse/计数器注入——不是第二写面）
  const chainWriter = createChainWriter({ company, hist, counters, write, refuse, ...(deps.log !== undefined ? { log: deps.log } : {}) })

  /** 前件记录引用解析（只认**已落库**记录；未落＝undefined → 调用方拒写，不引用未来记录） */
  const refOf = (recordId: string): { refType: string; refId: string; refVersion: string } | undefined => {
    const row = hist.get(recordId, readContext)
    if (row === undefined) return undefined
    return { refType: row.recordType, refId: row.recordId, refVersion: REF_VERSION }
  }

  /** 工号 → 覆盖授予引用（迁移缝权源闸；无覆盖／授予未落库＝undefined → drafts 拒写并点名） */
  const authorityRefOf = (actorId: string): { refType: string; refId: string; refVersion: string } | undefined => {
    const roster = deps.roster?.roster()
    if (roster === undefined) return undefined
    const person = personOf(roster, actorId)
    if (person === undefined) return undefined
    // 动作范围＝本部门（成员/主管的转授边均含 `dept:<path>`；跨部门写入在 forbidden 内）
    const ref = resolveAuthorityRef({
      roster: () => deps.roster?.roster(),
      company,
      personId: actorId,
      actionScope: `dept:${person.dept}`,
      refOf,
      covering: coveringGrantOf,
    })
    // 只认已落库授予：未落库＝无源（不引用未来记录——先跑相位 0 名册装载）
    return ref !== undefined && refOf(ref.refId) !== undefined ? ref : undefined
  }

  /** 相位 0 名册装载（编排体=lifecycle.runRosterLoad；本件只持计数器与三态回报） */
  const rosterLoad = (args: RecordRosterLoadArgs): RecordWriteResult[] => {
    counters.lifecycle += 1
    return runRosterLoad(
      {
        company,
        roster: () => deps.roster?.roster(),
        rootGrant: deps.rootGrant,
        write,
        refOf,
        onRefused: () => {
          counters.refused += 1
        },
        ...(deps.log !== undefined ? { log: deps.log } : {}),
      },
      args,
    )
  }

  /** 迁移边序列：先全量成信封（形状闸）→ 再逐条落库；任一条失败即返回（不补造后续） */
  const writePath = (outcome: TransitionDraftsOutcome): RecordWriteResult => {
    if (!outcome.ok) return refuse(outcome)
    const built: { draft: RecordDraft; envelope: unknown }[] = []
    for (const draft of outcome.drafts) {
      const prepared = prepare(draft)
      if (!prepared.ok) return prepared.result
      built.push({ draft, envelope: prepared.envelope })
    }
    let last: RecordWriteResult | undefined
    for (const item of built) {
      last = appendBuilt(item.draft, item.envelope)
      if (!last.ok) return last
    }
    return last ?? failureOf('REC-WORK-06', 'record-write-failed', '迁移路径为空（边序列解析不应产出空路径）')
  }

  return {
    writtenBy: RECORD_WRITTEN_BY,
    counters,
    /** 相位 1 采集尾：平台意图 → REC-WORK-01（请求型；无决定面） */
    intake(args: RecordIntakeArgs): RecordWriteResult {
      counters.intake += 1
      return write(workIntakeDraft({ ...args, company }))
    },
    /** 相位 3/4/6 迁移执行缝：REC-WORK-06（决定型；边序列/逐边前置/规则依据/权源/决定面五闸） */
    transition(args: RecordTransitionArgs): RecordWriteResult {
      counters.transition += 1
      const authorityRef = authorityRefOf(args.actor)
      return writePath(
        workTransitionDrafts({
          ticket: args.ticket,
          attempt: args.attempt,
          fromPlatformState: args.fromState,
          toPlatformState: args.toState,
          at: args.at,
          actor: args.actor,
          company,
          ...(args.evidenceRefs !== undefined ? { evidenceRefs: args.evidenceRefs } : {}),
          ...(args.ruleBasisRef !== undefined ? { ruleBasisRef: args.ruleBasisRef } : {}),
          ...(authorityRef !== undefined ? { authorityRef } : {}),
          ...(args.decision !== undefined ? { decision: args.decision } : {}),
        }),
      )
    },
    /** 相位 4 收割尾：REC-EVD-01（事件型；segment_ref 只认已落库 LIFE-04） */
    harvest(args: RecordHarvestArgs): RecordWriteResult {
      const segment = refOf(workSegmentRecordId(company, args.ticket, args.attempt))
      return write(
        harvestBatchDraft({
          ticket: args.ticket,
          attempt: args.attempt,
          at: args.at,
          actor: args.actor,
          company,
          terminal: args.terminal,
          gaps: args.gaps,
          usage: args.usage,
          cost: args.cost,
          ...(segment !== undefined ? { segmentRef: segment } : {}),
        }),
      )
    },
    rosterLoad,
    /** 相位 4：出工段（前件＝生效 LIFE-01／REC-WORK-05／REC-AUTH-02／REC-CAP-02；缺一即拒） */
    workSegment(args: RecordSegmentArgs): RecordWriteResult {
      counters.segment += 1
      const roster = deps.roster?.roster()
      if (roster === undefined) {
        counters.refused += 1
        const reason = '名册端口未注入（records.roster 缺省）——出工段无可派生事实源'
        deps.log?.(`[records] 拒写 REC-LIFE-04：${reason}`)
        return failureOf('REC-LIFE-04', 'record-prereq-missing', reason)
      }
      const person = personOf(roster, args.personId)
      const appointment = person !== undefined ? hist.get(appointmentRecordId(company, person.id, positionRefIdOf(person)), readContext) : undefined
      // 只认**生效**任命（拟任面 pending 不得作为出工前件——§3.1/§十五-2）
      const appointmentRef =
        appointment !== undefined && appointment.effectiveState === 'effective'
          ? { refType: appointment.recordType, refId: appointment.recordId, refVersion: REF_VERSION }
          : undefined
      const planRef = refOf(planLockRecordId(company, args.ticket, args.attempt))
      const authorizationRef = refOf(authorizationRecordId(company, args.ticket, args.attempt))
      const qualificationRef = person !== undefined ? refOf(qualificationRecordId(company, person.id)) : undefined
      return write(
        workSegmentDraft({
          roster,
          company,
          at: args.at,
          ticket: args.ticket,
          attempt: args.attempt,
          personId: args.personId,
          ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
          ...(args.briefRef !== undefined ? { briefRef: args.briefRef } : {}),
          prereqs: {
            ...(appointmentRef !== undefined ? { appointmentRef } : {}),
            ...(planRef !== undefined ? { planRef } : {}),
            ...(authorizationRef !== undefined ? { authorizationRef } : {}),
            ...(qualificationRef !== undefined ? { qualificationRef } : {}),
          },
        }),
      )
    },
    /** 权源面：覆盖授予引用（决定型记录 authority_ref 来源） */
    authorityRefFor(args: RecordAuthorityArgs): RecordWriteResult {
      counters.authority += 1
      const roster = deps.roster?.roster()
      if (roster === undefined) {
        counters.refused += 1
        return failureOf('REC-AUTH-01', 'record-prereq-missing', '名册端口未注入——权源链不可解析')
      }
      const ref = resolveAuthorityRef({
        roster: () => deps.roster?.roster(),
        company,
        personId: args.personId,
        actionScope: args.actionScope,
        refOf,
        covering: coveringGrantOf,
      })
      if (ref === undefined) {
        counters.refused += 1
        const reason = `${args.personId} 在动作范围 ${args.actionScope} 上无覆盖授予（REC-AUTH-01 链未覆盖）——决定型记录不得无源落库`
        deps.log?.(`[records] 拒写 权源解析：${reason}`)
        return failureOf('REC-AUTH-01', 'record-prereq-missing', reason)
      }
      if (hist.get(ref.refId, readContext) === undefined) {
        counters.refused += 1
        return failureOf('REC-AUTH-01', 'record-prereq-missing', `覆盖授予 ${ref.refId} 尚未落库——不引用未来记录（先跑名册装载相位）`)
      }
      return { ok: true, recordId: ref.refId, recordType: ref.refType, deduped: true, ref: { recordId: ref.refId, recordType: ref.refType, appended: false } }
    },
    /** 相位 5 合并 / 相位 6 回收：REC-WORK-12（决定型；MEM-03＋EVD-04＋独立核验） */
    /** 相位 3：开工链（WORK-02→07→03→05→04＋M-05；编排体=work-chain-wire.ts） */
    startChain(args: RecordStartChainArgs): readonly RecordWriteResult[] {
      return chainWriter.startChain(args)
    },
    /** 相位 4 收割：EVD-03→WORK-08＋M-10（编排体=work-chain-wire.ts） */
    harvestChain(args: RecordHarvestChainArgs): readonly RecordWriteResult[] {
      return chainWriter.harvestChain(args)
    },
    /** 相位 4 收尾：WORK-09＋M-17（编排体=work-chain-wire.ts） */
    acceptanceChain(args: RecordAcceptanceChainArgs): readonly RecordWriteResult[] {
      return chainWriter.acceptanceChain(args)
    },
    settlement(args: RecordSettlementArgs): RecordWriteResult {
      counters.settlement += 1
      return write(settlementDraft({ ...args, company }))
    },
    /** 相位 6 回收 / 断路：REC-WORK-17（具名接收＋升级链） */
    exception(args: RecordExceptionArgs): RecordWriteResult {
      counters.exception += 1
      return write(exceptionDraft({ ...args, company }))
    },
    /** 相位 6 回收 / 断路：REC-ACC-01（任职引用＋独立裁判） */
    accountability(args: RecordAccountabilityArgs): RecordWriteResult {
      counters.accountability += 1
      return write(accountabilityDraft({ ...args, company }))
    },
    /** 问责出口：REC-ACC-02（决定面＋proof_boundary＋执行证据链） */
    remedy(args: RecordRemedyArgs): RecordWriteResult {
      counters.remedy += 1
      return write(remedyDraft({ ...args, company }))
    },
    /** 配置热更 / 变更决定位：REC-CHG-01（不可跳段＋三门不合并） */
    changeSegment(args: RecordChangeSegmentArgs): RecordWriteResult {
      counters.change += 1
      return write(changeSegmentDraft({ ...args, company }))
    },
    /** 终局后 / 周期复盘：REC-REV-01（EVD-04＋WORK-09＋复盘位置独立） */
    review(args: RecordReviewArgs): RecordWriteResult {
      counters.review += 1
      return write(reviewDraft({ ...args, company }))
    },
    /** 结清 / 复盘前置：REC-MEM-03（处置授权独立＋三路分流凭证） */
    memoryDisposal(args: RecordMemoryDisposalArgs): RecordWriteResult {
      counters.memory += 1
      return write(memoryDisposalDraft({ ...args, company }))
    },
    /** 结清 / 复盘前置：REC-EVD-04（四本账＋判断者独立） */
    valueEvaluation(args: RecordValueEvaluationArgs): RecordWriteResult {
      counters.value += 1
      return write(valueEvaluationDraft({ ...args, company }))
    },
    /**
     * 对账读者（#559 验收项）：records（事实源）× events（可重建投影）双向覆盖。
     * `since` 为增量窗口下界（epoch ms；缺省 0＝全量）——窗口内差异不吞；只读、不写、不补造。
     */
    reconcile(since = 0): ProjectionReconciliation {
      counters.reconcile += 1
      const roster = deps.roster?.roster()
      const records = hist.query({ company, ...(since > 0 ? { since } : {}) }, readContext)
      // REC-WORK-01 是每单恰好一条 intake（produced_at 远早于重派 DISPATCH 时可滑出增量窗口）：
      // 对账改全量读该类型（仅 REC-WORK-01，行数≈单数、成本可忽略），其余类型保持窗口口径。
      // 这样窗口边界不再误报 missing；真缺失（全量也没有）仍报。REC-WORK-06 仍走窗口——
      // 同类「记录老、相位锚新」风险登记在案（当前 0 行，未开面）。
      const allTimeIntakes = hist.query({ company, type: 'REC-WORK-01' }, readContext)
      const events = deps.readEvents !== undefined ? deps.readEvents(since) : []
      const rosterSubjects = roster !== undefined ? new Set(roster.people.map((person) => person.id)) : undefined
      const reconciled = reconcileProjection(records, events, {
        ...(rosterSubjects !== undefined ? { rosterSubjects } : {}),
        allTimeIntakes,
      })
      if (!reconciled.settled) {
        deps.log?.(
          `[records] 对账差异 ${reconciled.differences.length} 条（checked=${reconciled.checked}）：` +
            reconciled.differences.slice(0, 5).map((diff) => `${diff.kind}:${diff.recordType}:${diff.subjectId}`).join(' | '),
        )
      }
      return reconciled
    },
  }
}
