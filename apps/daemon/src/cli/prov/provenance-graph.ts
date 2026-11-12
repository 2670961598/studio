/**
 * provenance-graph —— Airlock provenance 只读派生图（phase1：trace + impact ≤2 跳）
 *
 * 纪律：不新增存储/表/事件词；图=内存派生邻接表（每次命令从只读表重建）。事件本身默认
 * **不作节点**（只作边证据：sourceEventId/time/confidence）；note 仅按白名单 token 解析
 * （src/category/model/job/report/summary/sha/branch/target/person/executor/alert/event/commit），
 * 不保留/不输出原文、绝对路径、凭据；artifact 只留 basename+hash 前缀；commit sha 只留 12 位。
 */
import type { ProvData } from './prov-data.ts'

export type ProvNodeKind = 'ticket' | 'person' | 'dept' | 'executor' | 'attempt' | 'session' | 'artifact' | 'commit' | 'alert' | 'audit' | 'model' | 'price'
export type ProvConfidence = 'direct' | 'inferred' | 'gap'

export interface ProvNode {
  readonly id: string
  readonly kind: ProvNodeKind
  readonly label: string
  readonly attrs: Readonly<Record<string, string | number | null>>
}
export interface ProvEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly sourceEventId: string | null
  readonly time: number
  readonly confidence: ProvConfidence
}
export interface ProvGraph {
  readonly nodes: ProvNode[]
  readonly edges: ProvEdge[]
}

/** 白名单 note token（顺序无关；只取这些键，绝不保留 note 原文） */
const NOTE_TOKEN = /(?:^|[;；\s])(src|category|model|job|report|summary|sha|branch|target|person|executor|alert|event|commit)=([^;；\s]+)/g

/** token 白名单解析（值经脱敏；未知键忽略） */
export function noteTokens(note: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (note === null) return out
  for (const match of note.matchAll(NOTE_TOKEN)) {
    const key = match[1]
    const value = match[2]
    if (key === undefined || value === undefined) continue
    out[key] = sanitizeLabel(value)
  }
  return out
}

/** 标签脱敏：去绝对路径取 basename、去凭据样式、截 80；不输出路径分隔符 */
export function sanitizeLabel(value: string): string {
  let text = value.trim()
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  if (slash >= 0) text = text.slice(slash + 1)
  text = text.replace(/(?:sk|pk|token|key|password|secret)[-_:=][A-Za-z0-9_-]{8,}/gi, '<redacted>')
  text = text.replace(/[A-Za-z0-9+/=_-]{40,}/g, '<redacted>')
  return text.slice(0, 80)
}

function nid(kind: ProvNodeKind, key: string): string {
  return `${kind}:${key}`
}
function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 120)
}

/** 由只读表派生图（纯函数，无 IO） */
export function buildProvenanceGraph(data: ProvData): ProvGraph {
  const nodes = new Map<string, ProvNode>()
  const edges: ProvEdge[] = []
  const edgeSeen = new Set<string>()
  const addNode = (kind: ProvNodeKind, key: string, label: string, attrs: Record<string, string | number | null> = {}): string => {
    const id = nid(kind, safeKey(key))
    if (!nodes.has(id)) nodes.set(id, { id, kind, label: sanitizeLabel(label), attrs })
    return id
  }
  const addEdge = (from: string, to: string, kind: string, time: number, sourceEventId: string | null, confidence: ProvConfidence = 'direct'): void => {
    if (from === to) return
    const key = `${from}|${to}|${kind}|${sourceEventId ?? ''}`
    if (edgeSeen.has(key)) return
    edgeSeen.add(key)
    edges.push({ from, to, kind, sourceEventId, time, confidence })
  }
  const ATTEMPT_EVENTS = new Set(['DISPATCH', 'GATE_PASS', 'GATE_FAIL', 'STALL', 'RESUME', 'QA_PASS', 'QA_BACK'])
  const ALERT_EVENTS = new Set(['GATE_FAIL', 'ESCALATE', 'DAILY_ALARM', 'COST_RECON_ESCALATE'])
  const AUDIT_EVENTS = new Set(['QA_BACK', 'ORG_UPGRADE', 'COMPANY_COMMIT', 'SCHEMA_EVOLVE', 'HR_GATE'])
  for (const ev of data.events) {
    if (ev.issue === '-' || ev.issue === '') continue
    const ticket = addNode('ticket', ev.issue, ev.issue)
    const tokens = noteTokens(ev.note)
    if (ev.dept !== '') addEdge(ticket, addNode('dept', ev.dept, ev.dept, { level: null }), 'in-dept', ev.ts, ev.id)
    if (ev.actor !== '' && ev.actor !== 'daemon') addEdge(ticket, addNode('person', ev.actor, ev.actor), 'acted-by', ev.ts, ev.id)
    if (ATTEMPT_EVENTS.has(ev.event) && ev.attempt > 0) addEdge(ticket, addNode('attempt', `${ev.issue}#${String(ev.attempt)}`, `attempt ${String(ev.attempt)}`, { ticket: ev.issue, attempt: ev.attempt }), 'attempt', ev.ts, ev.id)
    if (tokens['executor'] !== undefined) addEdge(ticket, addNode('executor', tokens['executor'], tokens['executor']), 'executed-by', ev.ts, ev.id)
    if (ev.event === 'DISPATCH') {
      addEdge(ticket, addNode('person', ev.actor, ev.actor), 'dispatched-to', ev.ts, ev.id)
    } else if (ev.event === 'MERGE') {
      const commitKey = tokens['sha'] ?? tokens['commit'] ?? tokens['branch'] ?? `${ev.issue}@${String(ev.ts)}`
      const commit = addNode('commit', commitKey, commitKey, { sha: tokens['sha'] ?? null, branch: tokens['branch'] ?? tokens['target'] ?? null })
      addEdge(ticket, commit, 'merged-to', ev.ts, ev.id)
    } else if (ev.event === 'CLOSE') {
      addEdge(ticket, addNode('dept', ev.dept === '' ? 'unknown' : ev.dept, ev.dept === '' ? 'unknown' : ev.dept), 'closed-in-dept', ev.ts, ev.id)
    } else if (ALERT_EVENTS.has(ev.event)) {
      const alert = addNode('alert', ev.id, `${ev.event}${tokens['src'] !== undefined ? ` src=${tokens['src']}` : ''}`, {
        event: ev.event,
        src: tokens['src'] ?? null,
        category: tokens['category'] ?? null,
        severity: ev.event === 'COST_RECON_ESCALATE' ? 'escalate' : 'warn',
      })
      addEdge(alert, ticket, 'affects-ticket', ev.ts, ev.id)
      if (ev.actor !== '' && ev.actor !== 'daemon') addEdge(alert, addNode('person', ev.actor, ev.actor), 'affects-person', ev.ts, ev.id)
      if (ev.dept !== '') addEdge(alert, addNode('dept', ev.dept, ev.dept), 'affects-dept', ev.ts, ev.id)
    } else if (AUDIT_EVENTS.has(ev.event) || ev.event.startsWith('HARVEST_') || ev.event.startsWith('REPORT_') || ev.event === 'JOB_STALE' || ev.event === 'LATE_FIRST_RUN' || ev.event === 'SENTINEL_MISSING') {
      const audit = addNode('audit', ev.id, `${ev.event}${tokens['src'] !== undefined ? ` src=${tokens['src']}` : ''}`, { event: ev.event, src: tokens['src'] ?? null })
      addEdge(audit, ticket, 'audits-ticket', ev.ts, ev.id)
      if (ev.actor !== '' && ev.actor !== 'daemon') addEdge(audit, addNode('person', ev.actor, ev.actor), 'audits-person', ev.ts, ev.id)
    }
    const artifactRefs = [tokens['report'], tokens['summary']].filter((v): v is string => v !== undefined)
    for (const ref of artifactRefs) {
      const artifact = addNode('artifact', ref, ref, { ref: sanitizeLabel(ref), hash: ev.payloadHash === null ? null : ev.payloadHash.slice(0, 12) })
      addEdge(ticket, artifact, ev.event === 'GATE_PASS' ? 'reported' : 'artifact-ref', ev.ts, ev.id)
    }
    if (ev.event === 'REPORT_MISSING' || ev.event === 'HARVEST_INCOMPLETE' || ev.event === 'HARVEST_INVALID') {
      const gapKey = tokens['report'] ?? tokens['target'] ?? `gap@${ev.id}`
      addEdge(ticket, addNode('artifact', gapKey, `missing:${gapKey}`, { ref: sanitizeLabel(gapKey), state: 'missing' }), 'artifact-gap', ev.ts, ev.id, 'gap')
    }
  }
  for (const m of data.mirror) {
    const ticket = addNode('ticket', m.issue, m.issue, { state: m.state, type: m.type, level: m.level, lane: m.lane })
    if (m.dept !== '') addEdge(ticket, addNode('dept', m.dept, m.dept, { level: m.level }), 'owned-by', 0, null, 'inferred')
  }
  for (const w of data.work) {
    const ticket = addNode('ticket', w.issue, w.issue)
    const person = addNode('person', w.personId, w.personId)
    addEdge(ticket, person, 'worked-by', w.startedAt, null, 'direct')
    addEdge(ticket, addNode('executor', w.executor, w.executor), 'executed-by', w.startedAt, null, 'direct')
    const attempt = addNode('attempt', `${w.issue}#${String(w.attempt)}`, `attempt ${String(w.attempt)}`, { ticket: w.issue, attempt: w.attempt })
    addEdge(ticket, attempt, 'attempt', w.startedAt, null, 'direct')
    if (w.sessionId !== null) {
      const session = addNode('session', w.sessionId, w.sessionId, { startedAt: w.startedAt, endedAt: w.endedAt })
      addEdge(attempt, session, 'session', w.startedAt, null, 'direct')
      addEdge(session, person, 'owned-by', w.startedAt, null, 'direct')
    }
    if (w.model !== null) {
      const model = addNode('model', w.model, w.model)
      addEdge(ticket, model, 'ran-on-model', w.startedAt, null, 'inferred')
    }
    for (const ref of [w.reportRef, w.summaryRef]) {
      if (ref === null) continue
      addEdge(ticket, addNode('artifact', ref, ref, { ref: sanitizeLabel(ref), hash: null }), 'produced-artifact', w.endedAt ?? w.startedAt, null, 'direct')
    }
  }
  for (const s of data.sessions) {
    const session = addNode('session', s.sessionId, s.sessionId, { startedAt: s.startedAt, endedAt: s.endedAt, turns: s.turns })
    addEdge(session, addNode('ticket', s.issue, s.issue), 'served-ticket', s.startedAt, null, 'direct')
    addEdge(session, addNode('person', s.personId, s.personId), 'owned-by', s.startedAt, null, 'direct')
  }
  for (const p of data.prices) {
    const modelKey = `${p.provider}/${p.model}`
    const model = addNode('model', modelKey, modelKey)
    const price = addNode('price', `${modelKey}@${p.priceDate}:${p.slot}`, `price ${p.priceDate}`, { provider: p.provider, model: p.model, date: p.priceDate, slot: p.slot, inputPerM: p.inputPerM, outputPerM: p.outputPerM })
    addEdge(model, price, 'priced-by', 0, null, 'inferred')
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind) || (a.sourceEventId ?? '').localeCompare(b.sourceEventId ?? '')),
  }
}

export interface ProvTrace {
  readonly schema: 'prov-trace/v1'
  readonly root: string | null
  readonly ticket: string
  readonly depth: number
  readonly nodes: readonly ProvNode[]
  readonly edges: readonly ProvEdge[]
  readonly gaps: readonly string[]
  readonly nodeCounts: Readonly<Record<ProvNodeKind, number>>
  readonly reason?: string
}
function countsOf(nodes: readonly ProvNode[]): Record<ProvNodeKind, number> {
  const counts: Record<ProvNodeKind, number> = { ticket: 0, person: 0, dept: 0, executor: 0, attempt: 0, session: 0, artifact: 0, commit: 0, alert: 0, audit: 0, model: 0, price: 0 }
  for (const n of nodes) counts[n.kind] += 1
  return counts
}
function neighbors(graph: ProvGraph, id: string, directed: boolean): Array<{ edge: ProvEdge; next: string }> {
  const out: Array<{ edge: ProvEdge; next: string }> = []
  for (const e of graph.edges) {
    if (e.from === id) out.push({ edge: e, next: e.to })
    else if (!directed && e.to === id) out.push({ edge: e, next: e.from })
  }
  return out
}
function bfs(graph: ProvGraph, root: string, maxDepth: number): { nodes: ProvNode[]; edges: ProvEdge[]; gaps: string[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const visited = new Map<string, number>([[root, 0]])
  const chosenEdges: ProvEdge[] = []
  const queue = [root]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    const depth = visited.get(cur) ?? 0
    if (depth >= maxDepth) continue
    for (const { edge, next } of neighbors(graph, cur, false)) {
      if (!chosenEdges.includes(edge)) chosenEdges.push(edge)
      if (!visited.has(next)) {
        visited.set(next, depth + 1)
        queue.push(next)
      }
    }
  }
  const nodes = [...visited.keys()].map((id) => byId.get(id)).filter((n): n is ProvNode => n !== undefined)
  return { nodes, edges: chosenEdges, gaps: chosenEdges.filter((e) => e.confidence === 'gap').map((e) => `${e.from}→${e.to}`) }
}

/** 单票全链路 trace（无向 BFS；事件不作节点；缺图=空形状 exit0） */
export function traceTicket(graph: ProvGraph, ticket: string, maxDepth = 8): ProvTrace {
  const root = nid('ticket', safeKey(ticket))
  if (!graph.nodes.some((n) => n.id === root)) {
    return { schema: 'prov-trace/v1', root: null, ticket, depth: 0, nodes: [], edges: [], gaps: [], nodeCounts: countsOf([]), reason: 'ticket-not-in-derived-graph' }
  }
  const { nodes, edges, gaps } = bfs(graph, root, maxDepth)
  return { schema: 'prov-trace/v1', root, ticket, depth: maxDepth, nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges, gaps, nodeCounts: countsOf(nodes) }
}

export interface ProvImpact {
  readonly schema: 'prov-impact/v1'
  readonly from: string
  readonly source: ProvNode | null
  readonly depth: number
  readonly window: { readonly since: number | null; readonly until: number | null }
  readonly affected: {
    readonly tickets: readonly string[]
    readonly persons: readonly string[]
    readonly depts: readonly string[]
    readonly artifacts: readonly string[]
    readonly sessions: readonly string[]
    readonly commits: readonly string[]
    readonly alerts: readonly string[]
  }
  readonly confidence: { readonly direct: number; readonly inferred: number; readonly gap: number }
  readonly gaps: readonly string[]
  readonly nodes: readonly ProvNode[]
  readonly edges: readonly ProvEdge[]
  readonly reason?: string
}

/** 解析 --from：优先精确节点 id（ticket:/alert:），裸值按 ticket 或 alert 事件 id 回退 */
export function resolveFrom(graph: ProvGraph, from: string): ProvNode | undefined {
  const exact = graph.nodes.find((n) => n.id === from)
  if (exact !== undefined) return exact
  const ticket = graph.nodes.find((n) => n.id === nid('ticket', safeKey(from)))
  if (ticket !== undefined) return ticket
  const alert = graph.nodes.find((n) => n.kind === 'alert' && (n.id === nid('alert', safeKey(from)) || n.attrs['event'] === from))
  if (alert !== undefined) return alert
  return undefined
}

/** 影响面（无向 BFS ≤maxDepth；direct=1 跳 / inferred=2 跳；缺口边单列；只观察不动作） */
export function impactOf(graph: ProvGraph, from: string, maxDepth = 2): ProvImpact {
  const source = resolveFrom(graph, from)
  if (source === undefined) {
    return {
      schema: 'prov-impact/v1',
      from,
      source: null,
      depth: 0,
      window: { since: null, until: null },
      affected: { tickets: [], persons: [], depts: [], artifacts: [], sessions: [], commits: [], alerts: [] },
      confidence: { direct: 0, inferred: 0, gap: 0 },
      gaps: [],
      nodes: [],
      edges: [],
      reason: 'unknown-from',
    }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const visited = new Map<string, number>([[source.id, 0]])
  const chosen = new Map<string, ProvEdge>()
  const queue = [source.id]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    const depth = visited.get(cur) ?? 0
    if (depth >= maxDepth) continue
    for (const { edge, next } of neighbors(graph, cur, false)) {
      chosen.set(`${edge.from}|${edge.to}|${edge.kind}|${edge.sourceEventId ?? ''}`, edge)
      if (!visited.has(next)) {
        visited.set(next, depth + 1)
        queue.push(next)
      }
    }
  }
  const nodes = [...visited.keys()].map((id) => byId.get(id)).filter((n): n is ProvNode => n !== undefined)
  const edges = [...chosen.values()]
  const byKind = (kind: ProvNodeKind): string[] => nodes.filter((n) => n.kind === kind).map((n) => n.label).sort()
  const directIds = new Set([...visited.entries()].filter(([, d]) => d === 1).map(([id]) => id))
  const directEdges = edges.filter((e) => directIds.has(e.from === source.id ? e.to : e.from))
  const inferredEdges = edges.filter((e) => !directEdges.includes(e))
  const times = edges.map((e) => e.time).filter((t) => t > 0)
  return {
    schema: 'prov-impact/v1',
    from,
    source,
    depth: maxDepth,
    window: { since: times.length > 0 ? Math.min(...times) : null, until: times.length > 0 ? Math.max(...times) : null },
    affected: {
      tickets: byKind('ticket'),
      persons: byKind('person'),
      depts: byKind('dept'),
      artifacts: byKind('artifact'),
      sessions: byKind('session'),
      commits: byKind('commit'),
      alerts: byKind('alert'),
    },
    confidence: {
      direct: directEdges.length,
      inferred: inferredEdges.filter((e) => e.confidence !== 'gap').length,
      gap: edges.filter((e) => e.confidence === 'gap').length,
    },
    gaps: edges.filter((e) => e.confidence === 'gap').map((e) => `${e.from}→${e.to}`),
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges,
  }
}
