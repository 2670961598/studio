/**
 * harvest-recon-index —— 落位对账步的事件派生索引（studio-dev-812 后续单：增量扫描）
 *
 * 背景：`runHarvestRecon` 原先每 `harvestReconEveryTicks`=30 拍做 `ledger.queryEvents()`
 * 全表同步扫描（events≈23.3 万行，单次 1.3–2.3s），是该拍 5s 尖峰主因（watchdog 误判）。
 * 本件把「事件派生索引」（PATROL 首锚 / GATE_PASS / recon-key 去重集）改为**增量**：
 *   - daemon_kv 持久化 chain-seq 游标 `harvest.recon.cursor.chainSeq`；
 *   - 进程内缓存索引（keyed by ledger）；缓存命中且 kv 游标一致 → 只 `queryEventsAfterChainSeq`
 *     扫新增事件；
 *   - 游标缺失/非整数/超前 tip/seq 空洞/ts 乱序（新事件 ts ≤ 上次最大 ts）→ **全量重建**
 *     并修复游标（fail-safe；不得漏事件）；全量仍失败则抛出由调用面 onProblem 明报（不吞）。
 * 语义等价：索引只按 (ts,id) 升序「首条 PATROL / 首条 GATE_PASS」与 recon-key 集合派生；
 * 增量仅在新增事件 ts 严格大于既有最大 ts 时接受——插入顺序与全量扫描等价。
 *
 * 边界：不改 events/schema/链；不新增 store API（复用 785 的 queryEventsAfterChainSeq/
 * eventsChainTipSeq）；kv 只存游标；缓存提交只在对账主体成功完成后发生（失败 invalidate，
 * 下轮重扫，不漏事件）。
 */
import type { EventRecord, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'

/** 扫描游标 kv 键（daemon_kv；值=已消费的 events_chain.seq） */
export const HARVEST_RECON_CURSOR_KEY = 'harvest.recon.cursor.chainSeq'

/** PATROL 锚（首条口径与 accountJobOutput 同） */
export interface ReconAnchor {
  jobId: string
  company: string
  note: string | undefined
}

/** GATE_PASS 收割成功事实（首条口径） */
export interface ReconGatePass {
  ts: number
  note: string | undefined
  attempt: number
}

/** 事件派生索引（对账循环的只读输入） */
export interface ReconIndex {
  readonly anchorOf: Map<TicketId, ReconAnchor>
  readonly gatePass: Map<TicketId, ReconGatePass>
  readonly reported: Set<string>
  /** 已消费到的 chain seq */
  readonly cursor: number
  /** 已消费事件的最大 ts（增量乱序闸） */
  readonly lastTs: number
}

export interface ReconIndexOutcome {
  readonly state: ReconIndex
  readonly mode: 'full' | 'delta'
  /** 本次增量扫描的新事件数（full=全量行数） */
  readonly newEvents: number
}

const indexCache = new WeakMap<Ledger, ReconIndex>()

/** 事件 → 索引（纯；PATROL/GATE_PASS 保持首条，recon-key 派生去重集） */
function applyEvent(state: { anchorOf: Map<TicketId, ReconAnchor>; gatePass: Map<TicketId, ReconGatePass>; reported: Set<string> }, e: EventRecord): void {
  if (e.event === 'PATROL') {
    const m = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
    if (m !== null && !state.anchorOf.has(e.issue)) {
      state.anchorOf.set(e.issue, { jobId: m[1] as string, company: e.company, note: e.note })
    }
    return
  }
  if (e.event === 'GATE_PASS') {
    if (!state.gatePass.has(e.issue)) state.gatePass.set(e.issue, { ts: e.ts, note: e.note, attempt: e.attempt })
    return
  }
  if (e.event === 'REPORT_MISSING' || e.event === 'SENTINEL_MISSING' || e.event === 'HARVEST_INVALID') {
    const key = /(?:^|[;；])recon-key=([^;；]+)/.exec(e.note ?? '')?.[1]
    if (key !== undefined) state.reported.add(key)
  }
}

function cloneState(state: ReconIndex): { anchorOf: Map<TicketId, ReconAnchor>; gatePass: Map<TicketId, ReconGatePass>; reported: Set<string> } {
  return { anchorOf: new Map(state.anchorOf), gatePass: new Map(state.gatePass), reported: new Set(state.reported) }
}

function fullRebuild(ledger: Ledger): ReconIndexOutcome {
  const working = { anchorOf: new Map<TicketId, ReconAnchor>(), gatePass: new Map<TicketId, ReconGatePass>(), reported: new Set<string>() }
  const events = ledger.queryEvents()
  let lastTs = 0
  for (const e of events) {
    applyEvent(working, e)
    if (e.ts > lastTs) lastTs = e.ts
  }
  const cursor = ledger.eventsChainTipSeq()
  return { state: { ...working, cursor, lastTs }, mode: 'full', newEvents: events.length }
}

/**
 * 取事件派生索引：缓存+kv 游标一致且新增事件连续/ts 单调 → 增量；否则全量重建。
 * 抛错=索引不可用（调用面 onProblem 明报；本件不更新缓存/kv → 下轮重试，不漏事件）。
 */
export function reconIndexOf(ledger: Ledger): ReconIndexOutcome {
  const cached = indexCache.get(ledger)
  const rawCursor = ledger.kvGet(HARVEST_RECON_CURSOR_KEY)
  const kvCursor = rawCursor === null || rawCursor === '' ? undefined : Number(rawCursor)
  const validKv = kvCursor !== undefined && Number.isSafeInteger(kvCursor) && kvCursor >= 0 ? kvCursor : undefined
  if (cached !== undefined && validKv !== undefined && validKv === cached.cursor) {
    const tip = ledger.eventsChainTipSeq()
    if (cached.cursor <= tip) {
      const rows = ledger.queryEventsAfterChainSeq(cached.cursor)
      let expected = cached.cursor + 1
      let contiguous = true
      for (const row of rows) {
        if (row.seq !== expected) {
          contiguous = false
          break
        }
        expected += 1
      }
      // 零新增事件：直接复用（零扫描 full）；tip 未前进则游标不动。
      if (rows.length === 0 && contiguous && cached.cursor === tip) {
        return { state: cached, mode: 'delta', newEvents: 0 }
      }
      // F1 返工（studio-dev-812 后续单）：full 的索引构建顺序是 `(ts,id)` 升序
      // （queryEvents 的 ORDER BY ts,id）；delta 按链序 append 会破坏「首条 PATROL/
      // GATE_PASS」锚（批内 ts 回填乱序 / 同 ts 两条 id 与链序相反）。修法：
      //   ① 批内所有事件 ts 必须 > cached.lastTs（批前缓存已覆盖全部 ts≤lastTs 事件，
      //      否则全量回退，避免旧 ts interleave）；
      //   ② 通过后按**完全相同的 (ts,id)** 升序排序再 apply——与 full 的逐事件顺序一致，
      //      逐字段等价；cursor 取最大 chain seq（排序后末条 seq 未必最大）。
      const batchAfterCache = rows.length > 0 && rows.every((row) => row.event.ts > cached.lastTs)
      if (contiguous && batchAfterCache) {
        const sorted = [...rows].sort((a, b) => {
          if (a.event.ts !== b.event.ts) return a.event.ts - b.event.ts
          return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
        })
        const working = cloneState(cached)
        let lastTs = cached.lastTs
        for (const row of sorted) {
          applyEvent(working, row.event)
          if (row.event.ts > lastTs) lastTs = row.event.ts
        }
        let cursor = cached.cursor
        for (const row of rows) if (row.seq > cursor) cursor = row.seq
        return { state: { ...working, cursor, lastTs }, mode: 'delta', newEvents: rows.length }
      }
    }
  }
  return fullRebuild(ledger)
}

/** 提交索引（对账主体成功完成后调用）：写 kv 游标 + 进程内缓存；失败抛出由调用面明报 */
export function commitReconIndex(ledger: Ledger, outcome: ReconIndexOutcome): void {
  if (outcome.mode === 'full' || outcome.newEvents > 0) {
    ledger.kvSet(HARVEST_RECON_CURSOR_KEY, String(outcome.state.cursor))
    indexCache.set(ledger, outcome.state)
    return
  }
  // 零新增：只确保缓存就位（kv 已一致，不重复写）
  indexCache.set(ledger, outcome.state)
}

/** 失败回滚：丢弃缓存（kv 未提交→下轮全量重扫）；调用面 catch 用 */
export function invalidateReconIndex(ledger: Ledger): void {
  indexCache.delete(ledger)
}
