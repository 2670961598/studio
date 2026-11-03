/**
 * engine/conversation/panel-relay —— 面板→Matrix 出站中继（studio-dev-654a 的 B 路）
 *
 * 依据：docs/21-§七.4（面板消息经 notify `targets.room` 发回绑定 DM 房；同一 seq 只发一次；
 * 失败积压重试不丢；重启游标恢复不重发；只处理 panel 源→防回环）／docs/v2/14-§8.1（失败面）。
 *
 * 反屎山声明：
 *   - **不重复实现存储**：只读 engine/conversation/store.ts 的同一 JSONL（visibleRecords）；
 *   - **无特判硬编码**：是否中继由显式 `source='panel'` 字段判定，不按 eventId/文本猜来源；
 *   - **无绕道吞错**：notify 失败只计数+日志并保留游标（下一拍重试），不丢消息、不假装成功。
 *
 * 与既有 reply 中继（员工回复）的关系：两路独立（不同数据面、不同游标），互不重叠；本路只发
 * panel 源的消息，Matrix 入站/员工回复绝不进本路（防回环）。
 */
import type { Notification } from '@studio-next/contract'
import type { NotifyBroadcastFace } from '../notify/broadcast.ts'
import { panelSourceOf, panelVisibleRows } from './panel-map.ts'
import { loadRelayState, relayedSeqOf, saveRelayState, withRelayedSeq, type RelayState } from './relay-state.ts'
import type { ConversationStore } from './store.ts'

export interface PanelRelayDeps {
  readonly store: ConversationStore
  readonly notify: NotifyBroadcastFace
  /** 运行期游标文件（`<companyDir>/var/conversations/.relay-state.json`） */
  readonly statePath: string
  /** 中继消息署名（bot 代发：公司·制作人） */
  readonly senderSignature: string
  readonly log?: (line: string) => void
}

export interface PanelRelayStats {
  /** 成功中继回 Matrix 的条数 */
  readonly sent: number
  /** 发送失败（保留游标，下一拍重试）次数 */
  readonly failed: number
}

export interface PanelRelay {
  /** 拍边界执行：把未中继的 panel 源消息发回各自绑定房（恒不抛） */
  relay(): Promise<void>
  readonly stats: PanelRelayStats
}

export function createPanelRelay(deps: PanelRelayDeps): PanelRelay {
  const log = deps.log ?? ((): void => {})
  let state: RelayState = loadRelayState(deps.statePath, log)
  const stats = { sent: 0, failed: 0 }

  return {
    stats,
    async relay(): Promise<void> {
      for (const person of deps.store.personIds()) {
        let cursor = relayedSeqOf(state, person)
        const rows = panelVisibleRows(deps.store.visibleRecords(person))
        for (const { seq, row } of rows) {
          if (seq <= cursor) continue
          // 只中继 panel 源消息；其他行（matrix 入站/员工回复/clear）只推进内存游标，不发送
          const isPanelProducerMessage = row.kind === 'msg' && row.role === 'producer' && panelSourceOf(row) === 'panel'
          if (!isPanelProducerMessage) {
            cursor = seq
            continue
          }
          const message: Notification = {
            kind: '对话',
            title: '',
            body: row.text,
            from: deps.senderSignature,
          }
          try {
            const report = await deps.notify.send(message, { room: row.room })
            if (report.sent.includes('room')) {
              cursor = seq
              state = withRelayedSeq(state, person, seq)
              saveRelayState(deps.statePath, state)
              stats.sent += 1
              continue
            }
            stats.failed += 1
            log(
              `[conversation] 面板消息暂未送达（person=${person} seq=${String(seq)} room=${row.room}）：` +
                `${report.failed.map((f) => `${f.target}:${f.reason}`).join('；') || '未知原因'}——保留游标，下一拍重试`,
            )
            break // 本工号后续消息等本拍成功后再发（保序；不跳号）
          } catch (err) {
            // notify 面契约不抛；防御性兜底：只计失败，不炸拍
            stats.failed += 1
            log(`[conversation] 面板消息中继异常（person=${person} seq=${String(seq)}）：${err instanceof Error ? err.message : String(err)}`)
            break
          }
        }
      }
    },
  }
}
