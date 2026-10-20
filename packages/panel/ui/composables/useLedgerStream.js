/**
 * useLedgerStream —— SSE 实时事件流状态机（DEV-1 方案 §6）。
 *
 * 数据面（与旧页同契约，服务端零改动——docs/37-§8）：
 *   - EventSource('/api/events/stream')：ready 帧（游标通告）+ ledger 帧（id=事件 ULID，
 *     data=事件 JSON，Last-Event-ID 断线续传浏览器自动带）；
 *   - 首屏 backlog：GET /api/events?order=desc&limit=50（倒序最近 50 条）；
 *   - 合流：mergeFeed 去重排序截断（lib/feed.js——单测钉死）。
 *
 * 状态机：connecting → open（ready/onopen）⇄ reconnecting（onerror——浏览器自动重连，
 * 本件不引指数退避：EventSource retry 由服务端 ready 帧 5000ms 建议）；
 * unsupported：环境无 EventSource（事件流卡降级为 backlog 快照 + 状态提示）。
 */
import { onUnmounted, ref } from 'vue'
import { mergeFeed } from '../lib/feed.js'

/** SSE 事件帧上限（环形窗口，对齐 backlog 50 条） */
export const FEED_LIMIT = 50

export function useLedgerStream() {
  const feed = ref([])
  const status = ref('connecting')
  let source = null
  let closed = false

  const push = (events) => {
    feed.value = mergeFeed(feed.value, events, FEED_LIMIT)
  }

  if (typeof EventSource === 'undefined') {
    status.value = 'unsupported'
  } else {
    source = new EventSource('/api/events/stream')
    source.addEventListener('ready', () => {
      // 服务端游标通告：连接建立（浏览器自持 lastEventId 断线续传，客户端无需记游标）
      status.value = 'open'
    })
    source.onopen = () => {
      status.value = 'open'
    }
    source.onerror = () => {
      // EventSource 错误即进入重连节奏（浏览器自管）：状态如实亮「重连中」
      status.value = 'reconnecting'
    }
    source.addEventListener('ledger', (e) => {
      try {
        push([JSON.parse(e.data)])
      } catch {
        /* 坏帧丢弃：合流面 mergeFeed 对坏行免疫，这里不炸流 */
      }
    })
  }

  // backlog：首屏即有内容（SSE 首帧要等服务端轮询间隔）；失败静默——SSE 仍会补
  fetch(`/api/events?order=desc&limit=${String(FEED_LIMIT)}`)
    .then((r) => (r.ok ? r.json() : { events: [] }))
    .then((body) => {
      if (!closed) push(Array.isArray(body.events) ? body.events : [])
    })
    .catch(() => {})

  onUnmounted(() => {
    closed = true
    if (source) source.close()
  })

  return { feed, status }
}
