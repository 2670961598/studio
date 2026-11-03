/**
 * company-write · 运行期写面接线（studio-dev-541；daemon＝公司目录唯一写入者）
 *
 * rework studio-dev-618：按当前 HEAD 重出（#556 拆件与 #605 落仓后域平面调整）——
 * 相位体与写面协议同 #541，落位改为 engine/company-write/（company-commit 的 import
 * 面封闭约束见文末「落位」段），接线点随 #556 拆分后的 runtime/tick 宿主重新落位。
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（主循环七相位）：挂单队列消化＝**相位 7「落账/心跳」尾**的步骤，与
 *     hrSync/todo_queue/pricing 同款相位尾缝——**不增删相位**；失败进 tick errors 不炸拍。
 *   - docs/17-§6（证据契约）：四要件同构口径＝「终态证据 + 回读校验 + 落盘 + 闸门」；
 *     本模块把「提交成功」与「已生效」**分列**（已提交≠已生效），不伪造不以单测自证。
 *   - docs/v2/05-§三 DOM-01（公司 git 目录唯一写入者＝daemon 挂单 commit；变更历史靠
 *     DOM-03 事件）；docs/v2/06-§五.1（配置只表拟任，已提交≠已生效）；
 *   - docs/v2/11-§〇.4（同单号同内容重放零第二副作用）；docs/v2/15（fail-closed）；
 *   - docs/38-§2（L1 热重载：提交成立后重装载→engine.applyCompanyUpdate 整组换）。
 *
 * 写面协议（fail-closed 五段；任一段失败都不宣称成功）：
 *   ① 前置唯一写入者审计：脏树/旁路 commit/无基线＝**拒写**——不把外部直写洗白成 daemon
 *      提交（「唯一写入者」是机制不是自律；机制检测件＝bypass.ts）；
 *   ② 挂单：applyOrgChangeOrder（写前快照→写→校验→失败回滚→零残留断言全在模块内）；
 *   ③ 提交后复核：再审计一次；不一致＝ESCALATE 交对账（不回滚已成立的 commit——改写历史
 *      比半改态更糟）；
 *   ④ 生效段：重装载公司目录→engine.applyCompanyUpdate（注入闭包）；生效失败＝
 *      「已提交未生效」如实分列（applied=false），**不回滚已成立 commit**；
 *   ⑤ 留痕：成功/重放/无变化落 ORG_UPGRADE（既有事件名，零契约变更）；拒写/失败/不生效
 *      落 ESCALATE。note 以 `COMPANY_COMMIT;` 前缀携带单号/commit/摘要供对账。
 *
 * 边界：本模块只经引擎编排写公司目录，不直接碰 git 内部文件、不写其它事实源（e2e 静态
 * import 扫描背书）；队列是进程内簿（跨进程互斥未证——见 bypass.ts 头注「诚实边界」）。
 *
 * 落位（20-§十五.四 域平面／import 面封闭）：本件是**运行期接线**（依赖 store 事件面与
 * 引擎宿主），不属 `engine/company-commit/` 的纯写面——后者的 e2e 静态边界断言禁止
 * `@studio-next/store` 等 import（company-commit.e2e.test.ts「源件 import 面封闭」）。
 * 故本件独立成 `engine/company-write/` 子域（新特性开子目录，不向域平面加散件），
 * company-commit 模块的写面本体与既有边界零改动。
 */
import type { EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { inspectSoleWriter } from '../company-commit/bypass.ts'
import { errText, isClassified } from '../company-commit/errors.ts'
import { applyOrgChangeOrder } from '../company-commit/index.ts'
import type { CommitEvidence, SoleWriterAudit } from '../company-commit/types.ts'

// ───────────────────────── 证据形状 ─────────────────────────

/** 一次挂单的终态（rejected＝未产生 commit；committed/replayed/unchanged 同挂单三态） */
export type CompanyWriteStatus = 'committed' | 'replayed' | 'unchanged' | 'rejected'

/** 回滚面结论：none＝未写/未回滚；clean＝已回滚且零残留；incomplete＝回滚不完整须人工对账 */
export type CompanyWriteRollback = 'none' | 'clean' | 'incomplete'

/** 挂单终态证据（调用方据此断言；applied 与 status 分列＝「已提交≠已生效」） */
export interface CompanyWriteOutcome {
  readonly ok: boolean
  readonly status: CompanyWriteStatus
  readonly orderId: string
  /** 挂单 commit 哈希；rejected/unchanged 时 null */
  readonly commit: string | null
  /** 订单内容摘要（hex；unchanged 时为「将要提交」的摘要） */
  readonly digest: string | null
  readonly paths: readonly string[]
  /** 生效段：true=已重装载热替换；false=已提交未生效；null=未提交/未接生效段 */
  readonly applied: boolean | null
  readonly rollback: CompanyWriteRollback
  /** 两级分类子因（rejected 时非 null） */
  readonly subcause: string | null
  readonly detail: string
  /** 本单唯一一条留痕事件 id（成功 ORG_UPGRADE / 失败 ESCALATE） */
  readonly eventId: string
}

/** 写面端口（engine 只依赖本结构——相位 7 尾消化；实现＝createCompanyWriteFace） */
export interface CompanyWriteFace {
  submit(order: unknown): Promise<CompanyWriteOutcome>
}

/** 挂单队列端口（EngineRuntime 宿主字段；实现＝createCompanyWriteQueue） */
export interface CompanyWriteQueue {
  enqueue(order: unknown): void
  readonly pending: number
  drain(): Promise<CompanyWriteTickReport>
}

/** 相位 7 尾一拍汇报（TickReport.phases.account.companyWrite） */
export interface CompanyWriteTickReport {
  /** 本拍消化单数（≤ maxPerTick） */
  drained: number
  committed: number
  /** 生效成功单数（applied=true） */
  applied: number
  rejected: number
  /** 回滚不完整单数（>0 须人工对账） */
  rollbackIncomplete: number
  /** 本拍消化单号（观测面；不含被拒的队列外单） */
  orderIds: readonly string[]
}

// ───────────────────────── 写面实现 ─────────────────────────

/** 写面依赖（IO 面全部可注入替身：e2e/单测零 git——真实现见默认值） */
export interface CompanyWriteDeps {
  /** 公司目录绝对路径（daemon 唯一写入面） */
  companyDir: string
  /** events.company 路由键 */
  company: string
  /** events.dept 兜底（快照无部门时——serve 同源注入） */
  dept: string
  ledger: Ledger
  clock: () => number
  makeId: (ts: number) => string
  /** 生效段（提交/重放成立后：重装载公司目录→engine.applyCompanyUpdate）；缺省＝未接生效段 */
  apply?: (evidence: CommitEvidence) => Promise<void> | void
  /** 挂单实现（缺省＝applyOrgChangeOrder；测试注入替身） */
  commit?: (companyDir: string, order: unknown) => Promise<CommitEvidence>
  /** 唯一写入者审计（缺省＝inspectSoleWriter；测试注入替身） */
  audit?: (companyDir: string) => Promise<SoleWriterAudit>
  log?: (line: string) => void
}

/**
 * 创建运行期写面：**daemon 唯一写入者**的挂单入口。
 *
 * 调用时机（docs/17-§2）：引擎相位 7 尾 `companyWriteQueue.drain()` 每拍至多 1 单；
 * 亦可由控制面直接 `submit()`（同一 fail-closed 协议，无旁路）。
 */
export function createCompanyWriteFace(deps: CompanyWriteDeps): CompanyWriteFace {
  const commit = deps.commit ?? ((dir: string, order: unknown): Promise<CommitEvidence> => applyOrgChangeOrder(dir, order))
  const audit = deps.audit ?? inspectSoleWriter
  const log = deps.log ?? ((): void => undefined)

  function emit(event: 'ORG_UPGRADE' | 'ESCALATE', note: string): string {
    const ts = deps.clock()
    const record: EventRecord = {
      id: deps.makeId(ts),
      ts,
      company: deps.company,
      issue: '-',
      event,
      actor: 'daemon',
      attempt: 1,
      level: 1,
      dept: deps.dept,
      tokens: { input: 0 },
      note,
    }
    deps.ledger.appendEvent(record)
    return record.id
  }

  async function safeAudit(): Promise<SoleWriterAudit | null> {
    try {
      return await audit(deps.companyDir)
    } catch {
      return null
    }
  }

  async function submit(order: unknown): Promise<CompanyWriteOutcome> {
    const orderId = orderIdOf(order)

    // ① 前置：唯一写入者审计零发现才开写（旁路/脏树＝拒写，不洗白）
    let pre: SoleWriterAudit
    try {
      pre = await audit(deps.companyDir)
    } catch (err) {
      const eventId = emit('ESCALATE', `COMPANY_COMMIT;AUDIT_FAILED;${orderId};${errText(err)}——前置审计不可读，拒写（不把读失败当无旁路）`)
      log(`[company-commit] 拒写（${orderId}）：前置审计失败——ESCALATE ${eventId}`)
      return rejected(orderId, 'audit-failed', 'none', errText(err), eventId)
    }
    if (!pre.soleWriter) {
      const kinds = findingKinds(pre)
      const eventId = emit('ESCALATE', `COMPANY_COMMIT;BYPASS;${orderId};${kinds}——唯一写入者审计零发现不成立，拒写（fail-closed：旁路写/脏树在场不得被挂单洗白）`)
      log(`[company-commit] 拒写（${orderId}）：唯一写入者审计不通过（${kinds}）——ESCALATE ${eventId}`)
      return rejected(orderId, 'sole-writer-violation', 'none', renderFindings(pre), eventId)
    }

    // ② 挂单（写前快照/失败回滚/零残留断言在 applyOrgChangeOrder 内）
    let evidence: CommitEvidence
    try {
      evidence = await commit(deps.companyDir, order)
    } catch (err) {
      const post = await safeAudit()
      const rollback: CompanyWriteRollback = post !== null && post.soleWriter ? 'clean' : 'incomplete'
      const subcause = isClassified(err) ? err.subcause : 'apply-failed'
      const category = isClassified(err) ? err.category : 'EXTERNAL_REJECT'
      const eventId = emit('ESCALATE', `COMPANY_COMMIT;FAIL;${orderId};${category}/${subcause};rollback=${rollback};${errText(err)}${rollback === 'incomplete' ? '——回滚不完整，须人工对账工作树，不得宣称已回滚' : '——已回滚零残留，HEAD 未变'}`)
      log(`[company-commit] 挂单失败（${orderId}）：${category}/${subcause}；回滚=${rollback}——ESCALATE ${eventId}`)
      return {
        ok: false,
        status: 'rejected',
        orderId,
        commit: null,
        digest: null,
        paths: [],
        applied: null,
        rollback,
        subcause,
        detail: errText(err),
        eventId,
      }
    }

    // ③ 提交后复核：提交成立后仍须零发现（否则证据链不可信，交对账）
    const post = await safeAudit()
    if (post === null || !post.soleWriter) {
      const why = post === null ? '审计不可读' : findingKinds(post)
      const eventId = emit('ESCALATE', `COMPANY_COMMIT;POST_COMMIT_AUDIT;${orderId};commit=${short(evidence.commit)};${why}——提交已产生但提交后复核不通过，不回滚已成立 commit（改写历史），须人工对账`)
      log(`[company-commit] 提交后复核失败（${orderId}）——ESCALATE ${eventId}`)
      return {
        ok: false,
        status: 'rejected',
        orderId,
        commit: evidence.commit,
        digest: evidence.digest,
        paths: evidence.paths,
        applied: null,
        rollback: 'none',
        subcause: 'post-commit-audit',
        detail: why,
        eventId,
      }
    }

    // ④ 生效段：已提交≠已生效（失败不回滚 commit，如实分列 applied=false）
    let applied: boolean | null = null
    let applyError = ''
    if (deps.apply !== undefined) {
      try {
        await deps.apply(evidence)
        applied = true
      } catch (err) {
        applied = false
        applyError = errText(err)
      }
    }

    // ⑤ 留痕：成功面 ORG_UPGRADE（既有事件名）；生效失败追加 ESCALATE（一单两事件：提交事实 + 不生效事实）
    const head = evidence.status === 'committed' ? 'OK' : evidence.status === 'replayed' ? 'REPLAY' : 'UNCHANGED'
    const eventId = emit(
      'ORG_UPGRADE',
      `COMPANY_COMMIT;${head};${orderId};commit=${short(evidence.commit)};digest=${short(evidence.digest)};paths=${evidence.paths.length};applied=${applied === null ? 'n/a' : String(applied)}`,
    )
    if (applied === false) {
      const failEventId = emit('ESCALATE', `COMPANY_COMMIT;COMMITTED_NOT_APPLIED;${orderId};commit=${short(evidence.commit)};${applyError}——目录已提交但运行期生效失败（旧配置继续跑），须重载/重启收敛`)
      log(`[company-commit] 已提交未生效（${orderId}）：${applyError}——ESCALATE ${failEventId}`)
      return {
        ok: true,
        status: evidence.status,
        orderId,
        commit: evidence.commit,
        digest: evidence.digest,
        paths: evidence.paths,
        applied: false,
        rollback: 'none',
        subcause: 'apply-failed',
        detail: applyError,
        eventId,
      }
    }
    log(`[company-commit] 挂单成立（${evidence.status}，单号 ${orderId}，commit ${short(evidence.commit)}，apply=${applied === null ? 'n/a' : 'true'}）——ORG_UPGRADE ${eventId}`)
    return {
      ok: true,
      status: evidence.status,
      orderId,
      commit: evidence.commit,
      digest: evidence.digest,
      paths: evidence.paths,
      applied,
      rollback: 'none',
      subcause: null,
      detail: '',
      eventId,
    }
  }

  return { submit }
}

// ───────────────────────── 队列（引擎相位 7 尾） ─────────────────────────

/**
 * 挂单队列：进程内 FIFO，每拍至多 maxPerTick 单（缺省 1——与「每拍上限」纪律同款，
 * 不把一次 tick 变成批处理窗口）。失败单**不重排队**（挂单失败已回滚并 ESCALATE 留痕，
 * 盲目重试＝同因空转；重投须由调用方显式 re-ingest）。
 */
export function createCompanyWriteQueue(face: CompanyWriteFace, maxPerTick = 1): CompanyWriteQueue {
  const queue: unknown[] = []
  return {
    enqueue(order: unknown): void {
      queue.push(order)
    },
    get pending(): number {
      return queue.length
    },
    async drain(): Promise<CompanyWriteTickReport> {
      const limit = Math.max(0, Math.trunc(maxPerTick))
      const batch = queue.splice(0, limit)
      let committed = 0
      let applied = 0
      let rejectedCount = 0
      let rollbackIncomplete = 0
      const orderIds: string[] = []
      for (const order of batch) {
        const outcome = await face.submit(order)
        orderIds.push(outcome.orderId)
        if (outcome.status === 'rejected') rejectedCount += 1
        else if (outcome.status === 'committed') committed += 1
        if (outcome.applied === true) applied += 1
        if (outcome.rollback === 'incomplete') rollbackIncomplete += 1
      }
      return { drained: batch.length, committed, applied, rejected: rejectedCount, rollbackIncomplete, orderIds }
    },
  }
}

// ───────────────────────── 小件 ─────────────────────────

function rejected(orderId: string, subcause: string, rollback: CompanyWriteRollback, detail: string, eventId: string): CompanyWriteOutcome {
  return { ok: false, status: 'rejected', orderId, commit: null, digest: null, paths: [], applied: null, rollback, subcause, detail, eventId }
}

/** 单号读取（形状不合法＝'-'；订单形状判定归 order.ts，本处只做留痕） */
function orderIdOf(input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const value = (input as { orderId?: unknown }).orderId
    if (typeof value === 'string' && value.length > 0) return value
  }
  return '-'
}

function short(value: string | null): string {
  return value === null ? '-' : value.slice(0, 12)
}

function findingKinds(audit: SoleWriterAudit): string {
  const kinds = [...new Set(audit.findings.map((finding) => finding.kind))]
  return kinds.length === 0 ? 'none' : kinds.join('+')
}

function renderFindings(audit: SoleWriterAudit): string {
  if (audit.findings.length === 0) return '零发现'
  return audit.findings.map((finding) => `${finding.kind}${finding.path === null ? '' : `:${finding.path}`}${finding.commit === null ? '' : `@${finding.commit.slice(0, 12)}`}`).join('；')
}
