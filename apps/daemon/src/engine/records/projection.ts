/**
 * engine/records/projection —— 记录面 ↔ 事件面（可重建投影）对账件
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（记录＝事实源；`events` 保留为可重建投影）；
 *   - docs/v2/11 §0.4-4（重放不得产生第二副作用）／§十四（状态迁移边）／§十五-2（跨记录引用）；
 *   - docs/v2/14 §1.6（PORT-HIST 读面 query/get：本件只读，不写）。
 *
 * 口径（对账只判「投影是否一致」，不判业务价值）：
 *   - 每个被派发的单（events 有 DISPATCH）必须有恰好一条 REC-WORK-01 意图信封——记录面不得漏；
 *   - 每条 REC-WORK-01 的 subject 必须在 events 里出现过（不得凭空造单）——记录面不得多；
 *   - REC-WORK-06 迁移记录（若落）须能在 events 找到同单同 attempt 的相位事件锚
 *     （DISPATCH/GATE_PASS/GATE_FAIL/QA_PASS/QA_BACK/CLOSE/STALL/RESUME）——迁移不留无锚记录。
 *   差异非空即 exposed（不压成「已对平」——v2/11 §十四 口径）。
 */
import type { EventRecord } from '@studio-next/contract'
import type { HistRecord } from '@studio-next/store'

/** 记录面单条（对账面最小投影） */
export interface RecordProjectionRow {
  readonly recordId: string
  readonly recordType: string
  readonly subjectId: string
  readonly producedAt: string
}

/** 对账差异（kind 取 ENU-68 四类中本件可判：missing/duplicate/undeterminable） */
export interface ProjectionDifference {
  readonly kind: 'missing' | 'duplicate' | 'undeterminable'
  readonly recordType: string
  readonly subjectId: string
  readonly detail: string
}

/** 对账结论（settled=false 即不得结清——差异不得吞） */
export interface ProjectionReconciliation {
  readonly checked: number
  readonly differences: readonly ProjectionDifference[]
  readonly settled: boolean
}

/** 记录信封 → 对账行（subjectId 从幂等键取；缺幂等键＝不可判定行，如实登记） */
export function rowOf(record: HistRecord): RecordProjectionRow | undefined {
  const subjectId = record.idempotencyKey?.subjectId
  if (subjectId === undefined) return undefined
  return { recordId: record.recordId, recordType: record.recordType, subjectId, producedAt: record.producedAt }
}

/**
 * 已接生产写面的记录类（刀A：WORK-01/06＋EVD-01 观察面；刀B：LIFE-05/01/04、AUTH-01；
 * 刀C：开工/完成/验收链八族（WORK-02/03/04/05/07/08/09＋EVD-03）；其余族按 drafts.BLOCKED 面关）。
 */
export const RECORDED_TYPES = [
  'REC-WORK-01',
  'REC-WORK-06',
  'REC-EVD-01',
  'REC-LIFE-05',
  'REC-LIFE-01',
  'REC-LIFE-04',
  'REC-AUTH-01',
  'REC-WORK-02',
  'REC-WORK-03',
  'REC-WORK-04',
  'REC-WORK-05',
  'REC-WORK-07',
  'REC-WORK-08',
  'REC-WORK-09',
  'REC-EVD-03',
] as const

/** 名册派生族（锚是公司目录镜像而非事件流：须有幂等键 subjectId，且 subject 须在名册内） */
export const ROSTER_ANCHORED_TYPES = ['REC-LIFE-05', 'REC-LIFE-01', 'REC-AUTH-01'] as const

/** events → 被派发单集（DISPATCH 为派发相位唯一锚；事件词表冻结不改） */
export function dispatchedTicketsOf(events: readonly EventRecord[]): Set<string> {
  return new Set(events.filter((event) => event.event === 'DISPATCH').map((event) => event.issue))
}

/** events → 相位锚集（单号→attempt 集；迁移记录须有锚） */
export function phaseAnchorsOf(events: readonly EventRecord[]): Map<string, Set<number>> {
  const anchors = new Map<string, Set<number>>()
  for (const event of events) {
    const attempts = anchors.get(event.issue) ?? new Set<number>()
    attempts.add(event.attempt ?? 0)
    anchors.set(event.issue, attempts)
  }
  return anchors
}

/**
 * 对账：records × events 双向覆盖。
 *   ① 派发过却没有 REC-WORK-01＝missing（记录面漏账）；
 *   ② REC-WORK-01 重复（同单多行）＝duplicate（身份复用/幂等失效）；
 *   ③ 有记录但事件面完全无该单＝undeterminable（不得凭空单据）。
 */
export function reconcileProjection(
  records: readonly HistRecord[],
  events: readonly EventRecord[],
  options: { readonly rosterSubjects?: ReadonlySet<string> } = {},
): ProjectionReconciliation {
  const differences: ProjectionDifference[] = []
  // 名册派生族对账（刀B）：①缺幂等键 subjectId＝不可判定坏行 ②subject 不在名册＝凭空主体
  for (const record of records.filter((row) => (ROSTER_ANCHORED_TYPES as readonly string[]).includes(row.recordType))) {
    const subject = record.idempotencyKey?.subjectId
    if (subject === undefined) {
      differences.push({
        kind: 'undeterminable',
        recordType: record.recordType,
        subjectId: record.recordId,
        detail: `${record.recordType} 缺幂等键 subjectId（名册派生族不可判——记录面坏行）`,
      })
      continue
    }
    if (options.rosterSubjects !== undefined && !options.rosterSubjects.has(subject)) {
      differences.push({
        kind: 'undeterminable',
        recordType: record.recordType,
        subjectId: subject,
        detail: `${record.recordType} 的 subject 不在公司目录名册（凭空主体：任职/授权记录不得脱离名册）`,
      })
    }
  }
  const intakes = records.filter((record) => record.recordType === 'REC-WORK-01')
  const bySubject = new Map<string, string[]>()
  for (const record of intakes) {
    const subject = record.idempotencyKey?.subjectId
    if (subject === undefined) {
      differences.push({
        kind: 'undeterminable',
        recordType: record.recordType,
        subjectId: record.recordId,
        detail: 'REC-WORK-01 缺幂等键 subjectId（不可判——记录面坏行）',
      })
      continue
    }
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), record.recordId])
  }
  const dispatched = dispatchedTicketsOf(events)
  const issueSet = new Set(events.map((event) => event.issue))
  for (const ticket of dispatched) {
    if (!bySubject.has(ticket)) {
      differences.push({
        kind: 'missing',
        recordType: 'REC-WORK-01',
        subjectId: ticket,
        detail: '已派发单无 REC-WORK-01 意图信封（记录面漏账；相位 1 采集尾写面未覆盖）',
      })
    }
  }
  for (const [subject, ids] of bySubject) {
    if (ids.length > 1) {
      differences.push({
        kind: 'duplicate',
        recordType: 'REC-WORK-01',
        subjectId: subject,
        detail: `同单多条意图信封：${ids.join(',')}（§0.4-1 身份不复用——幂等失效）`,
      })
    }
    if (!issueSet.has(subject)) {
      differences.push({
        kind: 'undeterminable',
        recordType: 'REC-WORK-01',
        subjectId: subject,
        detail: '记录面无事件面锚（凭空单据或事件面缺账）',
      })
    }
  }
  const anchors = phaseAnchorsOf(events)
  for (const record of records.filter((row) => row.recordType === 'REC-WORK-06')) {
    const subject = record.idempotencyKey?.subjectId
    if (subject === undefined || !anchors.has(subject)) {
      differences.push({
        kind: 'missing',
        recordType: 'REC-WORK-06',
        subjectId: subject ?? record.recordId,
        detail: '迁移记录无同单相位事件锚（DISPATCH/GATE_*/QA_*/CLOSE/STALL/RESUME 之一）',
      })
    }
  }
  return { checked: records.length, differences, settled: differences.length === 0 }
}
