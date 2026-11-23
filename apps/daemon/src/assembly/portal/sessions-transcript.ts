/**
 * portal/sessions-transcript —— 工位会话轨迹解压与归一化（只读）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §九.1（v2 第一刀：会话档案）。
 * 数据源：`.AIWS/.../att<N>/.dsh-home/sessions/<ws-key>/<session-…>/session.v4.jsonl.zstd`
 * ——zstd 压缩 JSONL（v4 轨迹：session 头 / permission·sandbox·approval 配置 /
 * agent/inbox/spliced 任务书注入 / user·assistant 消息 / tool call·result /
 * compaction / turn·step 生命周期）。
 *
 * 安全与性能边界（§九.1）：
 *   - zstd 走系统 CLI（spawn 直调，**零 shell 拼接**；候选绝对位＋PATH 扫描定位）；
 *     超时 5s SIGKILL；输出上限 8MiB（超限截断续用，标记 truncated）。
 *   - 不可用/超时/失败 → 结构化降级（zstd-unavailable/timeout/failed），页面明报不 500。
 *   - 单条文本截断 4000 字符、参数摘要 300、明细 200——页面不因长事件爆炸。
 *   - 归一化只读不改盘；usage 汇总（回合/工具/错误/时长/模型）供详情页头部。
 * 测试注入：decompress 为可注入函数（vitest 用 fake，不真起 zstd）。
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { maskHostPaths } from '@studio-next/panel/chat'

/** zstd 执行参数（§九.1：超时 5s、输出 ≤8MiB） */
const ZSTD_TIMEOUT_MS = 5_000
const ZSTD_MAX_BYTES = 8 * 1024 * 1024
/** zstd CLI 候选绝对位（生产实测 /opt/homebrew/bin/zstd v1.5.7；PATH 兜底） */
const ZSTD_CANDIDATES = ['/opt/homebrew/bin/zstd', '/usr/local/bin/zstd', '/opt/local/bin/zstd', '/usr/bin/zstd'] as const

export interface DecompressOk {
  readonly ok: true
  readonly text: string
  /** 源超 8MiB 被截断（已产出部分仍可解析） */
  readonly truncated: boolean
}
export interface DecompressErr {
  readonly ok: false
  readonly code: 'zstd-unavailable' | 'zstd-timeout' | 'zstd-failed'
  readonly message: string
}
export type DecompressResult = DecompressOk | DecompressErr
export type DecompressFn = (file: string) => Promise<DecompressResult>

let zstdCache: string | null | undefined

/** 定位 zstd CLI（绝对候选位 → PATH 逐段；缓存结果；找不到=null） */
export function locateZstd(): string | null {
  if (zstdCache !== undefined) return zstdCache
  for (const c of ZSTD_CANDIDATES) {
    try {
      if (statSync(c).isFile()) {
        zstdCache = c
        return c
      }
    } catch {
      // 候选位不存在：继续
    }
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue
    const p = path.join(dir, 'zstd')
    try {
      if (statSync(p).isFile()) {
        zstdCache = p
        return p
      }
    } catch {
      // 继续扫 PATH
    }
  }
  zstdCache = null
  return null
}

/** 生产解压面：spawn zstd -dc <file>（无 shell；超时 SIGKILL；8MiB 截断） */
export const zstdDecompress: DecompressFn = (file) =>
  new Promise<DecompressResult>((resolve) => {
    const bin = locateZstd()
    if (bin === null) {
      resolve({ ok: false, code: 'zstd-unavailable', message: '会话压缩工具不可用：未找到 zstd CLI（候选 /opt/homebrew/bin/zstd 或 PATH 内 zstd）' })
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, ['-dc', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, code: 'zstd-failed', message: `zstd 启动失败：${err instanceof Error ? err.message : String(err)}` })
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false
    let stderr = ''
    let settled = false
    const finish = (r: DecompressResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 已退：忽略
      }
      finish({ ok: false, code: 'zstd-timeout', message: `zstd 解压超时（>${String(ZSTD_TIMEOUT_MS)}ms）` })
    }, ZSTD_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return
      total += chunk.length
      if (total > ZSTD_MAX_BYTES) {
        truncated = true
        chunks.push(chunk.subarray(0, Math.max(0, ZSTD_MAX_BYTES - (total - chunk.length))))
        try {
          child.kill('SIGKILL')
        } catch {
          // 忽略：等待 exit 收尾
        }
        return
      }
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 500) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => finish({ ok: false, code: 'zstd-failed', message: `zstd 执行失败：${err.message}` }))
    child.on('close', (code) => {
      if (code !== 0 && !truncated) {
        finish({ ok: false, code: 'zstd-failed', message: `zstd 退出码 ${String(code)}${stderr === '' ? '' : `：${stderr.trim()}`}` })
        return
      }
      finish({ ok: true, text: Buffer.concat(chunks).toString('utf8'), truncated })
    })
  })

// ─────────────────────────────────────────────────────────────────────────────
// 轨迹归一化（session.v4.jsonl → 渲染/JSON 两用事件视图）
// ─────────────────────────────────────────────────────────────────────────────

/** 归一化事件类型（渲染面分色依据：user/assistant/tool/error 各一档） */
export type SessionEventKind =
  | 'session'
  | 'config'
  | 'brief'
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'interrupt'
  | 'compaction'
  | 'turn'
  | 'info'

export interface SessionEventView {
  readonly seq: number
  /** epoch ms（事件自身 time；头事件用 createdAt） */
  readonly time: number
  readonly kind: SessionEventKind
  readonly title: string
  readonly detail: string
  /** 正文（已按 4000 字符截断；无正文=null） */
  readonly text: string | null
  readonly truncated: boolean
  readonly isError: boolean
}

export interface SessionUsage {
  readonly lines: number
  readonly parseErrors: number
  readonly kept: number
  readonly skipped: number
  readonly turns: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly toolResults: number
  readonly errors: number
  readonly startedAtMs: number | null
  readonly lastAtMs: number | null
  readonly durationMs: number | null
  readonly provider: string | null
  readonly model: string | null
  readonly sourceTruncated: boolean
}

export interface TranscriptResult {
  readonly events: readonly SessionEventView[]
  readonly usage: SessionUsage
}

/** 截断阈值（§九.1：单条文本 4000；参数摘要 300；明细 200） */
const TEXT_CLIP = 4_000
const ARGS_CLIP = 300
const DETAIL_CLIP = 200

function clipMarked(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: [...text].slice(0, max).join(''), truncated: true }
}

const clipPlain = (text: string, max: number): string => clipMarked(text, max).text

/** content[] 里同 type 文本拼接（text/thinking 族；工具调用项另行） */
function contentTexts(content: unknown): { readonly text: string; readonly reasoning: string } {
  if (!Array.isArray(content)) return { text: '', reasoning: '' }
  const text: string[] = []
  const reasoning: string[] = []
  for (const item of content) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const body = typeof rec['text'] === 'string' ? rec['text'] : ''
    if (body === '') continue
    if (rec['type'] === 'reasoning' || rec['type'] === 'thinking') reasoning.push(body)
    else if (rec['type'] === 'text') text.push(body)
  }
  return { text: text.join('\n'), reasoning: reasoning.join('\n') }
}

/** 工具调用参数摘要：优先 description/command/file_path/pattern 等语义键 */
function argsSummary(raw: unknown): string {
  let parsed: unknown = raw
  if (typeof raw === 'string' && raw !== '') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return clipPlain(raw, ARGS_CLIP)
    }
  }
  if (parsed === null || typeof parsed !== 'object') return clipPlain(String(raw), ARGS_CLIP)
  const rec = parsed as Record<string, unknown>
  const keys = ['description', 'command', 'file_path', 'pattern', 'path', 'query', 'url']
  const parts: string[] = []
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v !== '') parts.push(clipPlain(v, 120))
    if (parts.length >= 2) break
  }
  if (parts.length === 0) {
    try {
      return clipPlain(JSON.stringify(parsed) ?? '', ARGS_CLIP)
    } catch {
      return ''
    }
  }
  return parts.join(' · ')
}

/** JSON 值单行化（config 类事件明细） */
function jsonDetail(value: unknown): string {
  try {
    return clipPlain(JSON.stringify(value) ?? 'null', DETAIL_CLIP)
  } catch {
    return clipPlain(String(value), DETAIL_CLIP)
  }
}

interface EventDraft {
  readonly seq: number
  readonly time: number
  readonly kind: SessionEventKind
  readonly title: string
  readonly detail: string
  readonly text: string | null
  readonly truncated: boolean
  readonly isError: boolean
}

/**
 * session.v4.jsonl 全文 → 事件视图＋usage 汇总。
 * 取舍（可读性优先，数据不失真——原文在盘上）：
 *   - step/job 族不逐条出（usage 计 skipped）；assistant 消息内的 tool-call 项由
 *     独立 tool/call 事件出（避免双计）；system 全文不出（只出规模明细）。
 */
export function normalizeTranscript(raw: string, sourceTruncated = false): TranscriptResult {
  const drafts: EventDraft[] = []
  let parseErrors = 0
  let skipped = 0
  let turns = 0
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let toolResults = 0
  let errors = 0
  let startedAtMs: number | null = null
  let lastAtMs: number | null = null
  let provider: string | null = null
  let model: string | null = null
  const lines = raw.split('\n')
  for (const line of lines) {
    if (line.trim() === '') continue
    let ev: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object') throw new Error('not-object')
      ev = parsed as Record<string, unknown>
    } catch {
      parseErrors += 1
      continue
    }
    const type = typeof ev['type'] === 'string' ? ev['type'] : ''
    const seq = typeof ev['seq'] === 'number' ? ev['seq'] : drafts.length
    const time = typeof ev['time'] === 'number' ? ev['time'] : Number.NaN
    const data = (ev['data'] ?? {}) as Record<string, unknown>
    if (Number.isFinite(time)) lastAtMs = lastAtMs === null ? time : Math.max(lastAtMs, time)
    switch (type) {
      case 'session': {
        startedAtMs = typeof data['createdAt'] === 'number' ? data['createdAt'] : Number.isFinite(time) ? time : null
        drafts.push({ seq, time: startedAtMs ?? 0, kind: 'session', title: '会话开启', detail: `v${String(data['version'] ?? '?')} · ${typeof data['id'] === 'string' ? data['id'] : '?'}`, text: null, truncated: false, isError: false })
        break
      }
      case 'permission/preset':
      case 'sandbox/mode':
      case 'approval/policy': {
        drafts.push({ seq, time, kind: 'config', title: type, detail: jsonDetail(data), text: null, truncated: false, isError: false })
        break
      }
      case 'request/header': {
        const header = (data['header'] ?? {}) as Record<string, unknown>
        const config = (header['config'] ?? {}) as Record<string, unknown>
        provider = typeof config['provider'] === 'string' ? config['provider'] : provider
        model = typeof config['model'] === 'string' ? config['model'] : model
        const tools = Array.isArray(header['tools']) ? header['tools'].length : 0
        drafts.push({ seq, time, kind: 'info', title: '请求头', detail: `${provider ?? '?'} / ${model ?? '?'} · ${String(tools)} 工具`, text: null, truncated: false, isError: false })
        break
      }
      case 'agent/inbox/spliced': {
        const inserted = Array.isArray(data['inserted']) ? data['inserted'] : []
        const texts = inserted.map((m) => contentTexts((m as Record<string, unknown>)['content']).text).filter((t) => t !== '')
        const joined = texts.join('\n\n')
        const clipped = clipMarked(joined, TEXT_CLIP)
        drafts.push({ seq, time, kind: 'brief', title: `任务书注入（${String(inserted.length)} 段）`, detail: '', text: clipped.text === '' ? null : clipped.text, truncated: clipped.truncated, isError: false })
        break
      }
      case 'user/message': {
        const clipped = clipMarked(contentTexts(data['content']).text, TEXT_CLIP)
        userMessages += 1
        drafts.push({ seq, time, kind: 'user', title: '用户', detail: '', text: clipped.text === '' ? null : clipped.text, truncated: clipped.truncated, isError: false })
        break
      }
      case 'system/message': {
        const full = contentTexts(data['message'] !== null && typeof data['message'] === 'object' ? (data['message'] as Record<string, unknown>)['content'] : undefined).text
        drafts.push({ seq, time, kind: 'info', title: '系统提示注入', detail: `${String([...full].length)} 字符（原文在盘，不逐条展开）`, text: null, truncated: false, isError: false })
        break
      }
      case 'assistant/message': {
        const message = (data['message'] ?? {}) as Record<string, unknown>
        const parts = contentTexts(message['content'])
        assistantMessages += 1
        if (parts.text !== '') {
          const clipped = clipMarked(parts.text, TEXT_CLIP)
          drafts.push({ seq, time, kind: 'assistant', title: '助理', detail: '', text: clipped.text, truncated: clipped.truncated, isError: false })
        }
        if (parts.reasoning !== '') {
          const clipped = clipMarked(parts.reasoning, TEXT_CLIP)
          drafts.push({ seq, time, kind: 'reasoning', title: '推理', detail: '', text: clipped.text, truncated: clipped.truncated, isError: false })
        }
        break
      }
      case 'tool/call': {
        toolCalls += 1
        const name = typeof data['name'] === 'string' ? data['name'] : 'tool'
        drafts.push({ seq, time, kind: 'tool_call', title: name, detail: argsSummary(data['arguments']), text: null, truncated: false, isError: false })
        break
      }
      case 'tool/result': {
        toolResults += 1
        const isError = data['isError'] === true
        if (isError) errors += 1
        const message = (data['message'] ?? {}) as Record<string, unknown>
        const clipped = clipMarked(contentTexts(message['content']).text, TEXT_CLIP)
        drafts.push({
          seq,
          time,
          kind: isError ? 'error' : 'tool_result',
          title: isError ? '工具出错' : '工具结果',
          detail: '',
          text: clipped.text === '' ? null : clipped.text,
          truncated: clipped.truncated,
          isError,
        })
        break
      }
      case 'compaction/summary': {
        const clipped = clipMarked(contentTexts(data['summary']).text, TEXT_CLIP)
        drafts.push({ seq, time, kind: 'compaction', title: '压缩摘要', detail: '', text: clipped.text === '' ? null : clipped.text, truncated: clipped.truncated, isError: false })
        break
      }
      case 'compaction/start':
      case 'compaction/end':
      case 'compaction/prune': {
        drafts.push({ seq, time, kind: 'info', title: type, detail: jsonDetail(data), text: null, truncated: false, isError: false })
        break
      }
      case 'turn/start': {
        turns += 1
        drafts.push({ seq, time, kind: 'turn', title: `回合 ${String(data['turn'] ?? '?')} 开始`, detail: '', text: null, truncated: false, isError: false })
        break
      }
      case 'turn/end': {
        const reason = (data['reason'] ?? {}) as Record<string, unknown>
        const kind = reason['kind'] === 'error' ? 'error' : reason['kind'] === 'interrupted' ? 'interrupt' : 'turn'
        if (kind === 'error') errors += 1
        const label = typeof reason['kind'] === 'string' ? reason['kind'] : '?'
        drafts.push({
          seq,
          time,
          kind,
          title: kind === 'turn' ? `回合 ${String(data['turn'] ?? '?')} 结束` : `回合异常结束（${label}）`,
          detail: kind === 'turn' ? '' : jsonDetail(reason),
          text: null,
          truncated: false,
          isError: kind === 'error',
        })
        break
      }
      default: {
        // step/job/session-title/request-context 等噪声：不逐条出（usage 计 skipped）
        skipped += 1
      }
    }
  }
  const usage: SessionUsage = {
    lines: lines.filter((l) => l.trim() !== '').length,
    parseErrors,
    kept: drafts.length,
    skipped,
    turns,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    errors,
    startedAtMs,
    lastAtMs,
    durationMs: startedAtMs !== null && lastAtMs !== null ? Math.max(0, lastAtMs - startedAtMs) : null,
    provider,
    model,
    sourceTruncated,
  }
  // 显示层脱敏（chat/mask 同源单一正则）：主机绝对路径→<path>——归一化即罩，
  // 页面（再罩幂等）与 /api/sessions 详情回包都不带主机路径（§九.1 安全）。
  const events = drafts.map((e) => ({
    ...e,
    title: maskHostPaths(e.title),
    detail: maskHostPaths(e.detail),
    text: e.text === null ? null : maskHostPaths(e.text),
  }))
  return { events, usage }
}
