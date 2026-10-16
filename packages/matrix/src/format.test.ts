/**
 * format.ts 单测：Notification → Matrix 文本（kind 前缀 / 标题加粗 / 链接 markdown）
 */
import { describe, expect, it } from 'vitest'
import { formatNotification } from './format.ts'
import type { Notification } from '@studio-next/contract'

describe('formatNotification', () => {
  it('全字段：kind 前缀 + 加粗标题 + 正文 + 链接 markdown', () => {
    const n: Notification = {
      kind: 'alert',
      title: '预算超限',
      body: 'WORKER-3 已用 $12.50，超过单据帽',
      links: [{ label: '单据', url: 'https://yt.local/issue/STUDIO-100' }],
    }
    expect(formatNotification(n)).toBe(
      [
        '[alert] **预算超限**',
        'WORKER-3 已用 $12.50，超过单据帽',
        '- [单据](https://yt.local/issue/STUDIO-100)',
      ].join('\n'),
    )
  })

  it('无 links：不追加链接行', () => {
    const n: Notification = { kind: 'info', title: '日报', body: '今日合并 3 单' }
    expect(formatNotification(n)).toBe('[info] **日报**\n今日合并 3 单')
  })

  it('多链接逐行保序；空 url 的链接跳过', () => {
    const n: Notification = {
      kind: 'info',
      title: 'T',
      body: 'B',
      links: [
        { label: 'A', url: 'https://a' },
        { label: 'B', url: 'https://b' },
        { label: '坏链', url: '  ' },
      ],
    }
    expect(formatNotification(n)).toBe('[info] **T**\nB\n- [A](https://a)\n- [B](https://b)')
  })

  it('body 尾部空白裁掉；空 body 不留空行', () => {
    expect(formatNotification({ kind: 'k', title: 'T', body: '正文  \n' })).toBe('[k] **T**\n正文')
    expect(formatNotification({ kind: 'k', title: 'T', body: '' })).toBe('[k] **T**')
  })

  it('空 title 只剩 kind 前缀；全空得空串（不产垃圾行）', () => {
    expect(formatNotification({ kind: 'k', title: '', body: '只有正文' })).toBe('[k]\n只有正文')
    expect(formatNotification({ kind: '', title: '', body: '' })).toBe('')
  })
})
