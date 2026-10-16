/**
 * Notification → Matrix 消息文本格式化器（纯函数，零 IO）
 *
 * 协议依据：docs/25-§4.2（Notifier 端口）、docs/21（Matrix 频道作为通知出口）。
 *
 * 输出形状（markdown 约定，Synapse 客户端普遍渲染）：
 *   [kind] **title**
 *   body
 *   - [label](url)      ← links 逐条一行，无则省略
 */
import type { Notification } from '@studio-next/contract'

/** 格式化一条通知为 Matrix 消息文本（msgtype=m.text 的 body） */
export function formatNotification(n: Notification): string {
  const lines: string[] = []
  const kind = n.kind.trim()
  const title = n.title.trim()
  const head = `${kind !== '' ? `[${kind}] ` : ''}${title !== '' ? `**${title}**` : ''}`.trim()
  if (head !== '') lines.push(head)
  const body = n.body.replace(/\s+$/, '')
  if (body !== '') lines.push(body)
  for (const link of n.links ?? []) {
    const url = link.url.trim()
    if (url === '') continue
    const label = link.label.trim()
    lines.push(`- [${label !== '' ? label : url}](${url})`)
  }
  return lines.join('\n')
}
