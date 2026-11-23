/**
 * portal/sessions —— 工位会话档案索引与详情（只读；§九.1 v2 第一刀）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §九.1（数据源＝<companyDir>/../.AIWS
 * 工位树）＋§三（只读纪律/安全）。
 *
 * 端面（server.ts 挂路由；本件零 HTTP）：
 *   - 索引：扫描 `.AIWS/departments/<dept>/<PersonId>/tickets/<ticket>/att<N>/`，
 *     每行＝{ticket,person,dept,attempt,sessionId,sessionCount,startedAt,updatedAt,
 *     sizeBytes,hasBrief,hasReport,hasSummary}；updatedAt 倒序；TTL 5s；扫描上限
 *     3000 个 att 目录（防爆；越界 capped=true 如实上报）。
 *   - 详情：定位 att 目录 → files 元信息（brief/REPORT/summary/deliverables 树）＋
 *     会话文件清单＋轨迹归一化（sessions-transcript；单槽 TTL 缓存）。
 *   - 文件预览：att 目录内白名单后缀（.md/.txt/.json/.log）、≤200KB、路径归一化后
 *     必须以 att 目录为前缀（穿越=400；非白名单=415）。
 * 安全：单号/尝试/岗位/会话 id 严格正则；attDir 由索引行反推并前缀复核；全程零写。
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { normalizeTranscript, zstdDecompress, type DecompressFn, type SessionEventView, type SessionUsage } from './sessions-transcript.ts'

export type { DecompressFn } from './sessions-transcript.ts'

/** 索引 TTL（§九.1：5s——单树全扫描秒级，人看页面可接受） */
const INDEX_TTL_MS = 5_000
/** 扫描上限（§九.1：3000 att 目录） */
const MAX_ATTEMPT_DIRS = 3_000
/** 轨迹缓存（单槽：file+mtime+size 键，TTL 10s——详情页翻标签不重复解压） */
const TRANSCRIPT_TTL_MS = 10_000
/** 文件预览上限与白名单（§九.1：200KB；.md/.txt/.json/.log） */
const FILE_PREVIEW_MAX_BYTES = 200 * 1024
const FILE_ALLOWED_EXTS = new Set(['.md', '.txt', '.json', '.log'])
/** 交付物树扫描上限（条目/深度——防深树拖页） */
const DELIVERABLES_MAX_ENTRIES = 500
const DELIVERABLES_MAX_DEPTH = 6

/** 单号/岗位 id 合法形（与平台单号同族；§九.1 路径严格校验） */
export const SESSIONS_TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export const SESSIONS_PERSON_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ATTEMPT_RE = /^att(\d{1,4})$/
const SESSION_ID_RE = /^session-[0-9a-zA-Z-]{8,80}$/
/** 会话轨迹落位（工位 HOME 名 → 其下 sessions 根；probe 为探针 home） */
const SESSION_HOMES = ['.dsh-home', '.dsh-probe-home'] as const
const SESSION_FILE = 'session.v4.jsonl.zstd'

export interface SessionIndexRow {
  readonly ticket: string
  readonly person: string
  /** 部门名（.AIWS 目录名，与 org-config 部门名同源） */
  readonly dept: string
  readonly attempt: number
  /** 主会话 id（最新轨迹；无会话=''） */
  readonly sessionId: string
  readonly sessionCount: number
  readonly startedAtMs: number | null
  readonly updatedAtMs: number
  /** 轨迹压缩件合计字节（无会话=0） */
  readonly sizeBytes: number
  readonly hasBrief: boolean
  readonly hasReport: boolean
  readonly hasSummary: boolean
}

export interface SessionListQuery {
  readonly person?: string
  readonly ticket?: string
  readonly q?: string
  readonly limit: number
  readonly offset: number
}

export interface SessionListResult {
  readonly available: boolean
  readonly total: number
  readonly scanned: number
  readonly capped: boolean
  readonly items: readonly SessionIndexRow[]
}

export interface AttemptDeliverable {
  readonly relPath: string
  readonly sizeBytes: number
}

export interface AttemptSessionFile {
  readonly id: string
  readonly sizeBytes: number
  readonly mtimeMs: number
}

export interface AttemptFilesMeta {
  readonly brief: boolean
  readonly report: boolean
  readonly summary: boolean
  readonly deliverables: readonly AttemptDeliverable[]
}

export interface SessionTranscriptMeta {
  readonly available: boolean
  readonly code?: string
  readonly message?: string
  readonly sourceTruncated?: boolean
}

export interface SessionDetailView {
  readonly ticket: string
  readonly person: string
  readonly dept: string
  readonly attempt: number
  readonly updatedAtMs: number
  readonly files: AttemptFilesMeta
  readonly sessions: readonly AttemptSessionFile[]
  readonly sessionId: string | null
  readonly events: readonly SessionEventView[]
  readonly usage: SessionUsage | null
  readonly transcript: SessionTranscriptMeta
}

export type SessionDetailResult =
  | { readonly ok: true; readonly view: SessionDetailView }
  | { readonly ok: false; readonly status: 400 | 404; readonly code: string; readonly message: string }

export type AttemptFileResult =
  | { readonly ok: true; readonly file: { readonly relPath: string; readonly sizeBytes: number }; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false; readonly status: 400 | 404 | 415; readonly code: string; readonly message: string }

export interface SessionArchive {
  readonly list: (query: SessionListQuery) => SessionListResult
  readonly forTicket: (ticket: string) => readonly SessionIndexRow[]
  readonly ticketsWithSessions: () => ReadonlySet<string>
  readonly recent: (limit: number) => readonly SessionIndexRow[]
  readonly detail: (ticket: string, attempt: string, opts?: { person?: string; sessionId?: string }) => Promise<SessionDetailResult>
  readonly fileView: (ticket: string, attempt: string, rel: string) => AttemptFileResult
  readonly persons: () => readonly string[]
  readonly available: () => boolean
  /** summary.conclusion 一句（列表页「摘要」列；无/坏 JSON=null） */
  readonly conclusionOf: (row: SessionIndexRow) => string | null
}

interface ScanState {
  readonly rows: readonly SessionIndexRow[]
  readonly persons: readonly string[]
  readonly scanned: number
  readonly capped: boolean
  readonly available: boolean
  readonly at: number
}

const isFileQuiet = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const isDirQuiet = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const listDirQuiet = (p: string): readonly Dirent[] => {
  try {
    return readdirSync(p, { withFileTypes: true })
  } catch {
    return []
  }
}

const mtimeOf = (p: string): number => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** att 目录内会话轨迹文件清单（.dsh-home 优先；同 id 取最新） */
function scanSessionFiles(attDir: string): readonly AttemptSessionFile[] {
  const byId = new Map<string, AttemptSessionFile>()
  for (const home of SESSION_HOMES) {
    const sessionsRoot = path.join(attDir, home, 'sessions')
    for (const ws of listDirQuiet(sessionsRoot)) {
      if (!ws.isDirectory()) continue
      for (const sid of listDirQuiet(path.join(sessionsRoot, ws.name))) {
        if (!sid.isDirectory() || !SESSION_ID_RE.test(sid.name)) continue
        const file = path.join(sessionsRoot, ws.name, sid.name, SESSION_FILE)
        try {
          const st = statSync(file)
          if (!st.isFile()) continue
          const prev = byId.get(sid.name)
          if (prev !== undefined && prev.mtimeMs >= st.mtimeMs) continue
          byId.set(sid.name, { id: sid.name, sizeBytes: st.size, mtimeMs: st.mtimeMs })
        } catch {
          // 竞态消失：跳过
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** att 行装配（不抛错：坏目录出零值行，如实呈现） */
function buildRow(dept: string, person: string, ticket: string, attDir: string, attemptNum: number): SessionIndexRow {
  const sessions = scanSessionFiles(attDir)
  const artifacts = [path.join(attDir, 'brief.md'), path.join(attDir, 'REPORT.md'), path.join(attDir, 'summary.json')]
  let updatedAt = sessions.reduce((m, s) => Math.max(m, s.mtimeMs), 0)
  for (const a of artifacts) updatedAt = Math.max(updatedAt, mtimeOf(a))
  // 起点取最早轨迹文件的 birthtime（macOS 提供；不可得=null——详情页以轨迹头 createdAt 为准）
  let startedAt: number | null = null
  for (const s of sessions) {
    const f = findSessionFile(attDir, s.id)
    if (f === null) continue
    try {
      const st = statSync(f)
      const b = Number.isFinite(st.birthtimeMs) ? st.birthtimeMs : st.mtimeMs
      startedAt = startedAt === null ? b : Math.min(startedAt, b)
    } catch {
      // 忽略
    }
  }
  return {
    ticket,
    person,
    dept,
    attempt: attemptNum,
    sessionId: sessions.length > 0 ? (sessions[0] as AttemptSessionFile).id : '',
    sessionCount: sessions.length,
    startedAtMs: startedAt,
    updatedAtMs: updatedAt,
    sizeBytes: sessions.reduce((sum, s) => sum + s.sizeBytes, 0),
    hasBrief: isFileQuiet(artifacts[0] as string),
    hasReport: isFileQuiet(artifacts[1] as string),
    hasSummary: isFileQuiet(artifacts[2] as string),
  }
}

/** 会话文件绝对位（按 id 反查；找不到=null） */
function findSessionFile(attDir: string, sessionId: string): string | null {
  for (const home of SESSION_HOMES) {
    const sessionsRoot = path.join(attDir, home, 'sessions')
    for (const ws of listDirQuiet(sessionsRoot)) {
      if (!ws.isDirectory()) continue
      const file = path.join(sessionsRoot, ws.name, sessionId, SESSION_FILE)
      if (isFileQuiet(file)) return file
    }
  }
  return null
}

/** deliverables/ 树（相对路径＋字节；隐藏目录不入） */
function walkDeliverables(attDir: string): readonly AttemptDeliverable[] {
  const out: AttemptDeliverable[] = []
  const root = path.join(attDir, 'deliverables')
  const walk = (dir: string, rel: string, depth: number): void => {
    if (out.length >= DELIVERABLES_MAX_ENTRIES || depth > DELIVERABLES_MAX_DEPTH) return
    for (const e of listDirQuiet(dir)) {
      if (out.length >= DELIVERABLES_MAX_ENTRIES) return
      if (e.name.startsWith('.')) continue
      const child = path.join(dir, e.name)
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        walk(child, childRel, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      try {
        out.push({ relPath: childRel, sizeBytes: statSync(child).size })
      } catch {
        // 竞态消失：跳过
      }
    }
  }
  if (isDirQuiet(root)) walk(root, 'deliverables', 0)
  return out
}

export interface SessionArchiveOptions {
  /** 工位树根（=<companyDir>/../.AIWS） */
  readonly aiwsRoot: string
  /** 解压函数（缺省 zstd CLI；测试注入 fake——不真起进程） */
  readonly decompress?: DecompressFn
}

/** 会话档案面工厂（只读；TTL 缓存进程内私有） */
export function createSessionArchive(opts: SessionArchiveOptions): SessionArchive {
  const aiwsRoot = path.resolve(opts.aiwsRoot)
  const decompress = opts.decompress ?? zstdDecompress
  let cache: ScanState | null = null
  let transcriptCache: { key: string; at: number; result: { events: readonly SessionEventView[]; usage: SessionUsage } } | null = null

  const scanNow = (): ScanState => {
    const depsRoot = path.join(aiwsRoot, 'departments')
    if (!isDirQuiet(depsRoot)) return { rows: [], persons: [], scanned: 0, capped: false, available: false, at: Date.now() }
    const rows: SessionIndexRow[] = []
    const persons: string[] = []
    let scanned = 0
    let capped = false
    for (const dept of listDirQuiet(depsRoot)) {
      if (!dept.isDirectory()) continue
      const personRoot = path.join(depsRoot, dept.name)
      for (const person of listDirQuiet(personRoot)) {
        if (!person.isDirectory() || !SESSIONS_PERSON_RE.test(person.name)) continue
        persons.push(person.name)
        const ticketsRoot = path.join(personRoot, person.name, 'tickets')
        for (const t of listDirQuiet(ticketsRoot)) {
          if (!t.isDirectory() || !SESSIONS_TICKET_RE.test(t.name)) continue
          for (const att of listDirQuiet(path.join(ticketsRoot, t.name))) {
            const m = ATTEMPT_RE.exec(att.name)
            if (m === null || !att.isDirectory()) continue
            if (scanned >= MAX_ATTEMPT_DIRS) {
              capped = true
              break
            }
            scanned += 1
            rows.push(buildRow(dept.name, person.name, t.name, path.join(ticketsRoot, t.name, att.name), Number.parseInt(m[1] ?? '0', 10)))
          }
          if (capped) break
        }
        if (capped) break
      }
      if (capped) break
    }
    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    return { rows, persons, scanned, capped, available: true, at: Date.now() }
  }

  const scan = (): ScanState => {
    if (cache !== null && Date.now() - cache.at < INDEX_TTL_MS) return cache
    const state = scanNow()
    cache = state
    return state
  }

  /** att 目录定位（严格校验：形状→索引定位→归一化前缀复核） */
  const attemptDir = (ticket: string, attempt: string, person?: string): { ok: true; dir: string; row: SessionIndexRow } | { ok: false; status: 400 | 404; code: string; message: string } => {
    if (!SESSIONS_TICKET_RE.test(ticket)) return { ok: false, status: 400, code: 'bad-ticket-id', message: `单号 ${ticket} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）` }
    const m = ATTEMPT_RE.exec(attempt)
    if (m === null) return { ok: false, status: 400, code: 'bad-attempt', message: `尝试 ${attempt} 不是 att<N> 形（att1/att2/…）` }
    const state = scan()
    if (!state.available) return { ok: false, status: 404, code: 'sessions-not-mounted', message: '未发现工位档案树 .AIWS（<companyDir>/../.AIWS）——门户只读，不代建' }
    const attemptNum = Number.parseInt(m[1] ?? '0', 10)
    const matches = state.rows.filter((r) => r.ticket === ticket && r.attempt === attemptNum && (person === undefined || r.person === person))
    if (matches.length === 0) return { ok: false, status: 404, code: 'attempt-not-found', message: `工位树未发现 ${ticket}/${attempt}${person === undefined ? '' : `（岗位 ${person}）`}` }
    const row = matches[0] as SessionIndexRow
    const resolved = path.resolve(path.join(aiwsRoot, 'departments', row.dept, row.person, 'tickets', ticket, attempt))
    if (resolved !== path.join(path.resolve(path.join(aiwsRoot, 'departments', row.dept, row.person, 'tickets', ticket)), attempt)) {
      return { ok: false, status: 400, code: 'path-outside-attempt', message: '尝试目录归一化后越界（拒绝）' }
    }
    return { ok: true, dir: resolved, row }
  }

  const result: SessionArchive = {
    list(query) {
      const state = scan()
      const rows = state.rows.filter((r) => {
        if (query.person !== undefined && r.person !== query.person) return false
        if (query.ticket !== undefined && query.ticket !== '' && r.ticket !== query.ticket) return false
        if (query.q !== undefined && query.q !== '') {
          const needle = query.q.toLowerCase()
          if (!r.ticket.toLowerCase().includes(needle) && !r.person.toLowerCase().includes(needle) && !r.dept.toLowerCase().includes(needle)) return false
        }
        return true
      })
      return { available: state.available, total: rows.length, scanned: state.scanned, capped: state.capped, items: rows.slice(query.offset, query.offset + query.limit) }
    },
    forTicket(ticket) {
      const rows = scan().rows.filter((r) => r.ticket === ticket)
      return [...rows].sort((a, b) => a.attempt - b.attempt || a.person.localeCompare(b.person))
    },
    ticketsWithSessions() {
      const set = new Set<string>()
      for (const r of scan().rows) if (r.sessionCount > 0) set.add(r.ticket)
      return set
    },
    recent(limit) {
      return scan().rows.slice(0, limit)
    },
    async detail(ticket, attempt, dOpts) {
      const person = dOpts?.person
      if (person !== undefined && !SESSIONS_PERSON_RE.test(person)) return { ok: false, status: 400, code: 'bad-person', message: `岗位 ${person} 不是工号形 id` }
      if (dOpts !== undefined && dOpts.sessionId !== undefined && dOpts.sessionId !== '' && !SESSION_ID_RE.test(dOpts.sessionId)) {
        return { ok: false, status: 400, code: 'bad-session-id', message: `会话 id ${dOpts.sessionId} 形非法（session-<uuid>）` }
      }
      const loc = attemptDir(ticket, attempt, person)
      if (!loc.ok) return loc
      const { dir, row } = loc
      const sessions = scanSessionFiles(dir)
      const files: AttemptFilesMeta = { brief: row.hasBrief, report: row.hasReport, summary: row.hasSummary, deliverables: walkDeliverables(dir) }
      const wantId = dOpts?.sessionId
      const target = wantId !== undefined && wantId !== '' ? sessions.find((s) => s.id === wantId) : sessions[0]
      if (wantId !== undefined && wantId !== '' && target === undefined) {
        return { ok: false, status: 404, code: 'session-not-found', message: `会话 ${wantId} 不在 ${ticket}/${attempt} 的轨迹清单内` }
      }
      const base = { ticket, person: row.person, dept: row.dept, attempt: row.attempt, updatedAtMs: row.updatedAtMs, files, sessions, sessionId: target !== undefined ? target.id : null }
      if (target === undefined) {
        return { ok: true, view: { ...base, events: [], usage: null, transcript: { available: false, code: 'no-session', message: '该尝试未发现会话轨迹（无 .dsh-home/sessions 落盘）' } } }
      }
      const file = findSessionFile(dir, target.id)
      if (file === null) {
        return { ok: true, view: { ...base, events: [], usage: null, transcript: { available: false, code: 'session-file-missing', message: '会话轨迹文件不可读（可能已被清理）' } } }
      }
      let key = ''
      try {
        const st = statSync(file)
        key = `${file}:${String(st.mtimeMs)}:${String(st.size)}`
        if (transcriptCache !== null && transcriptCache.key === key && Date.now() - transcriptCache.at < TRANSCRIPT_TTL_MS) {
          return { ok: true, view: { ...base, events: transcriptCache.result.events, usage: transcriptCache.result.usage, transcript: { available: true } } }
        }
      } catch {
        return { ok: true, view: { ...base, events: [], usage: null, transcript: { available: false, code: 'session-file-missing', message: '会话轨迹文件不可读（可能已被清理）' } } }
      }
      const r = await decompress(file)
      if (!r.ok) return { ok: true, view: { ...base, events: [], usage: null, transcript: { available: false, code: r.code, message: r.message } } }
      const { events, usage } = normalizeTranscript(r.text, r.truncated)
      transcriptCache = { key, at: Date.now(), result: { events, usage } }
      return { ok: true, view: { ...base, events, usage, transcript: { available: true, ...(r.truncated ? { sourceTruncated: true } : {}) } } }
    },
    fileView(ticket, attempt, rel) {
      const loc = attemptDir(ticket, attempt)
      if (!loc.ok) return loc
      const { dir } = loc
      if (rel === '') return { ok: false, status: 400, code: 'bad-path', message: '缺少 path 参数（att 目录内相对路径）' }
      if (rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) {
        return { ok: false, status: 400, code: 'bad-path', message: '路径非法：仅接受 att 目录内的相对路径（禁绝对路径/反斜杠）' }
      }
      const segments = rel.split('/')
      if (segments.some((s) => s === '' || s === '.' || s === '..')) {
        return { ok: false, status: 400, code: 'bad-path', message: '路径非法：含空段或 ./.. 段（拒绝穿越）' }
      }
      const abs = path.resolve(dir, rel)
      if (abs !== dir && !abs.startsWith(`${dir}${path.sep}`)) {
        return { ok: false, status: 400, code: 'path-outside-attempt', message: '路径归一化后逃出 att 目录（拒绝）' }
      }
      let st
      try {
        st = statSync(abs)
      } catch {
        return { ok: false, status: 404, code: 'attempt-file-not-found', message: `文件不存在：${rel}` }
      }
      if (!st.isFile()) return { ok: false, status: 404, code: 'attempt-file-not-found', message: `不是普通文件：${rel}` }
      const ext = path.extname(rel).toLowerCase()
      if (!FILE_ALLOWED_EXTS.has(ext)) {
        return { ok: false, status: 415, code: 'unsupported-file-type', message: `不支持预览的后缀 ${ext === '' ? '（无后缀）' : ext}（白名单：.md/.txt/.json/.log）` }
      }
      const truncated = st.size > FILE_PREVIEW_MAX_BYTES
      let text: string
      if (truncated) {
        const buf = Buffer.alloc(FILE_PREVIEW_MAX_BYTES)
        const fd = openSync(abs, 'r')
        try {
          const n = readSync(fd, buf, 0, FILE_PREVIEW_MAX_BYTES, 0)
          text = buf.subarray(0, n).toString('utf8')
        } finally {
          closeSync(fd)
        }
      } else {
        text = readFileSync(abs, 'utf8')
      }
      return { ok: true, file: { relPath: rel, sizeBytes: st.size }, text, truncated }
    },
    persons() {
      return scan().persons
    },
    available() {
      return scan().available
    },
    conclusionOf(row) {
      const file = path.join(aiwsRoot, 'departments', row.dept, row.person, 'tickets', row.ticket, `att${String(row.attempt)}`, 'summary.json')
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (parsed === null || typeof parsed !== 'object') return null
        const c = (parsed as Record<string, unknown>)['conclusion']
        return typeof c === 'string' && c !== '' ? c : null
      } catch {
        return null
      }
    },
  }
  return result
}
