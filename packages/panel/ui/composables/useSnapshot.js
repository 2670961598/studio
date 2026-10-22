/**
 * useSnapshot —— 读面轮询（DEV-1 方案 §5：读面并行单刷——/api/snapshot、/api/jobs、
 * /api/breakers、/api/costs、/api/inbox（129-§6.2 R5 收件箱卡）、/api/judge
 * （160 §6.5 单D 判断调用卡）；轮询间隔 3s 对齐旧页 fetch 节奏）。
 *
 * 全部 GET 只读；单点失败置 error 由页头横幅呈现，不炸整个面板（其余读面照常展示）。
 */
import { onMounted, onUnmounted, reactive } from 'vue'

/** 轮询间隔（ms）——对齐旧页 3s；实时事件走 SSE（useLedgerStream），不经此轮询 */
export const SNAPSHOT_INTERVAL_MS = 3000

async function getJson(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} → HTTP ${String(res.status)}`)
  return res.json()
}

export function useSnapshot(intervalMs = SNAPSHOT_INTERVAL_MS) {
  const state = reactive({
    snapshot: null,
    jobs: null,
    breakers: null,
    costs: null,
    inbox: null,
    judge: null,
    error: '',
    stamp: 0,
  })

  let timer = null

  async function refresh() {
    try {
      const [snapshot, jobs, breakers, costs, inbox, judge] = await Promise.all([
        getJson('/api/snapshot'),
        getJson('/api/jobs'),
        getJson('/api/breakers'),
        getJson('/api/costs'),
        getJson('/api/inbox'),
        getJson('/api/judge'),
      ])
      state.snapshot = snapshot
      state.jobs = jobs
      state.breakers = breakers
      state.costs = costs
      state.inbox = inbox
      state.judge = judge
      state.error = ''
      state.stamp = Date.now()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
    }
  }

  onMounted(() => {
    void refresh()
    timer = setInterval(() => {
      void refresh()
    }, intervalMs)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { state, refresh }
}
