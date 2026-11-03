/**
 * 制作人-岗位持久对话 · 出站中继（收割完成 → 会话回写 → notify 房间定向发送）
 *
 * 协议依据：docs/21-§七.4（员工回复发回房间；失败只发一次回执；发送失败积压重试）、
 * docs/v2/14-§1.9（出站复用 notify 的房间定向扩展 `targets.room`；REPORT 正文=回复原文）、
 * docs/17-§6 会话位别注记（四要件不齐不发正文；会话不参与四要件判定）。
 *
 * 接线：`EngineDeps.onWorkComplete` 同步转 `onWorkComplete(signal)`（只入内存队列，零 IO）；
 * runServe 在**拍边界**（notify 中继之后）调 `relay()`：处理本轮信号 + 重试出站队列。
 * 失败面：Matrix 不可达只积压不丢（`reply` 队列 + `delivered` 回执），日志留痕、不阻主循环。
 */
import { readFileSync } from 'node:fs'
import type { Notification } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { NotifyBroadcastFace, NotifySendReport } from '../notify/broadcast.ts'
import type { RelayWorkSignal } from '../intents/relay-resume-sources.ts'
import type { ConversationStore } from './store.ts'

export interface ConversationReplyConfig {
  /** 公司 slug（署名/展示面） */
  company: string
  /** 回复正文上限（缺省 12000 字；超出截断并标注） */
  replyMaxChars: number
}

export interface ConversationRelayDeps {
  store: ConversationStore
  ledger: Ledger
  /** notify 广播面（boot 注入、出站闸已包好；只用 `targets.room` 定向） */
  notify: NotifyBroadcastFace
  config: ConversationReplyConfig
  /** 岗位署名（人面四段式；缺省=工号） */
  signatureOf?: (person: string) => string
  readFile?: (path: string) => string
  log?: (line: string) => void
}

export interface ConversationRelayStats {
  /** 已处理收割信号数 */
  signals: number
  /** 成功投递回房间的条数 */
  sent: number
  /** 投递失败（仍积压）次数 */
  failed: number
}

export interface ConversationRelay {
  /** 收割完成钩（同步、零 IO——引擎拍内调用；异常不外抛） */
  onWorkComplete(signal: RelayWorkSignal): void
  /** 拍边界执行：处理信号 + 出站队列重试（恒不抛；失败入日志/计数） */
  relay(): Promise<void>
  readonly stats: ConversationRelayStats
}

/** REPORT 清洗：去 front-matter、去首个一级标题、折叠首尾空白（回复=正文） */
export function extractConversationReply(raw: string, maxChars: number): string {
  let text = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  text = text.replace(/^\uFEFF/, '')
  text = text.replace(/^#\s+[^\n]*\n+/, '')
  text = text.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n…（回复超长已截断：原文 ${text.length} 字）`
}

/**
 * 出站中继工厂：store 是唯一会话事实源；ledger 只读（work_records.report_ref）。
 * 所有发送经 notify 面 `targets.room`（docs/v2/14-§1.9 唯一增量）。
 */
export function createConversationRelay(deps: ConversationRelayDeps): ConversationRelay {
  const log = deps.log ?? ((): void => {})
  const readFile = deps.readFile ?? ((file: string): string => readFileSync(file, 'utf8'))
  const signatureOf = deps.signatureOf ?? ((person: string): string => person)
  const pending: RelayWorkSignal[] = []
  const processing = new Set<string>()
  const stats: ConversationRelayStats = { signals: 0, sent: 0, failed: 0 }

  const workRecordReply = (signal: RelayWorkSignal): string | undefined => {
    const records = deps.ledger.listWorkRecords({ issue: signal.ticket })
    const exact = records.find((record) => record.attempt === signal.attempt)
    const chosen = exact ?? records[records.length - 1]
    const file = chosen?.report_ref
    if (file === undefined || file === '') return undefined
    try {
      return extractConversationReply(readFile(file), deps.config.replyMaxChars)
    } catch (err) {
      log(`[conversation] 回复文件不可读（${file}）：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  const handleSignal = (signal: RelayWorkSignal): void => {
    const turn = deps.store.turnOf(signal.ticket)
    if (turn === undefined) return // 非会话轮次：零行为
    const key = `${signal.ticket}#${signal.attempt}`
    if (processing.has(key)) return
    processing.add(key)
    stats.signals += 1
    if (signal.outcome === 'completed') {
      if (turn.done) return
      const reply = workRecordReply(signal)
      const body =
        reply === undefined || reply === ''
          ? `（本轮已通过收割但回复正文为空/不可读：${signal.ticket}#att${signal.attempt}；会话未改动，可重试或 /clear 重开）`
          : reply
      deps.store.appendMessage({ person: turn.person, room: turn.room, role: 'person', text: body })
      deps.store.enqueueReply({ person: turn.person, room: turn.room, text: body, kind: 'reply', forIssue: signal.ticket })
      deps.store.markTurnDone(signal.ticket)
      return
    }
    // failed：同轮同 attempt 只发一次失败回执（不含正文；不落 person 角色，避免污染上下文）
    if (deps.store.failureNoticeSent(signal.ticket, signal.attempt)) return
    const text = `（本轮未产生回复：${signal.ticket}#att${signal.attempt} 未过收割四要件；可稍后重试，或 /clear 重开上下文）`
    deps.store.appendMessage({ person: turn.person, room: turn.room, role: 'system', text })
    deps.store.enqueueReply({ person: turn.person, room: turn.room, text, kind: 'notice', forIssue: signal.ticket })
    deps.store.recordFailureNotice(turn.person, signal.ticket, signal.attempt)
  }

  return {
    stats,
    onWorkComplete(signal: RelayWorkSignal): void {
      if (pending.length >= 50) {
        // 有界：极端洪峰下丢最旧信号（轮次仍在 store 里，turn.done=false 时可经重派再收）
        pending.shift()
        log('[conversation] 收割信号队列已满 50，丢最旧一条（会话轮次不丢，等待下次完成信号）')
      }
      pending.push(signal)
    },
    async relay(): Promise<void> {
      // ① 本拍收割信号（有界 10/拍）
      const batch = pending.splice(0, 10)
      for (const signal of batch) {
        try {
          handleSignal(signal)
        } catch (err) {
          log(`[conversation] 轮次回写异常（${signal.ticket}#att${signal.attempt}）：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // ② 出站队列（有界 5/拍；失败留队下拍重试）
      const replies = deps.store.pendingReplies(5)
      for (const reply of replies) {
        const message: Notification = {
          kind: '对话',
          title: '',
          body: reply.text,
          from: signatureOf(reply.person),
        }
        let report: NotifySendReport
        try {
          report = await deps.notify.send(message, { room: reply.room })
        } catch (err) {
          // notify 面契约是不抛；防御性兜底：异常也只计失败，不炸拍
          stats.failed += 1
          log(`[conversation] 回信发送异常（room=${reply.room}）：${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        if (report.sent.includes('room')) {
          deps.store.markDelivered(reply.id)
          stats.sent += 1
        } else {
          stats.failed += 1
          log(
            `[conversation] 回信暂未送达（room=${reply.room}）：${report.failed.map((f) => `${f.target}:${f.reason}`).join('；') || '未知原因'}——积压重试`,
          )
        }
      }
    },
  }
}
