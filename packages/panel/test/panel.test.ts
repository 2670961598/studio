/**
 * :8787 监控面端面测试（v0.3）：app.request() 进程内驱动（零端口零文件依赖——ledger 工厂注入
 * 共享 tmp 库句柄），覆盖各端面形状断言 / 查询参数过滤 / SSE 送达与断线续传。
 * 依据：docs/16-§四 v0.3 验收口径「信息覆盖：jobs/runs/workers/事件流齐备」、docs/17-§8。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import { createPanelApp } from '../src/index.ts'
import { T0, makeEvent, makeJob, makeRun, makeSession, makeUlid } from './corpus.ts'

let root = ''
let ledger: Ledger

/** 语料事件 id 按入账序（断言用） */
let seededEventIds: string[] = []

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-panel-'))
  ledger = openLedger(path.join(root, 'panel.db'))

  // jobs：1 个 due（next_run_at=T0 早于现实时钟）+ 2 个未来（相对 Date.now()——panel 判 due 用真实时钟）
  ledger.upsertJob(makeJob({ job_id: 'job-a', next_run_at: T0 }))
  ledger.upsertJob(makeJob({ job_id: 'job-b', next_run_at: Date.now() + 7 * 86_400_000 }))
  ledger.upsertJob(makeJob({ job_id: 'job-c', next_run_at: Date.now() + 30 * 86_400_000, status: 'paused' }))

  // runs：2 完结（done/failed）+ 2 在途（P1/P2 各一，executor 不同）
  ledger.insertWorkRecord(makeRun({ id: 'r1', issue: 'DEMO-1', person_id: 'P1', started_at: T0 + 100, ended_at: T0 + 500, status: 'done' }))
  ledger.insertWorkRecord(makeRun({ id: 'r2', issue: 'DEMO-2', person_id: 'P1', executor: 'claude', started_at: T0 + 600, ended_at: T0 + 900, status: 'failed', attempt: 2 }))
  ledger.insertWorkRecord(makeRun({ id: 'r3', issue: 'DEMO-3', person_id: 'P1', started_at: T0 + 1000 }))
  ledger.insertWorkRecord(makeRun({ id: 'r4', issue: 'DEMO-4', person_id: 'P2', executor: 'kimi', started_at: T0 + 1100 }))

  // sessions：P1 在途（与 r3 同单）；P3 已完
  ledger.insertSession(makeSession({ session_id: 's1', issue: 'DEMO-3', person_id: 'P1', started_at: T0 + 1000 }))
  ledger.insertSession(makeSession({ session_id: 's2', issue: 'DEMO-5', person_id: 'P3', started_at: T0 + 200, ended_at: T0 + 800, turns: 12 }))

  // events：跨两公司、多事件类（含 GW_ 前缀族），ts 严格升序
  const seeds = [
    makeEvent({ event: 'DISPATCH', issue: 'DEMO-1' }),
    makeEvent({ event: 'GW_COMMENT', issue: 'DEMO-1', note: '网关动作' }),
    makeEvent({ event: 'HEARTBEAT', company: 'poly', issue: 'POLY-1', tokens: { input: 0 } }),
    makeEvent({ event: 'GATE_PASS', issue: 'DEMO-2' }),
    makeEvent({ event: 'DISPATCH', company: 'poly', issue: 'POLY-2' }),
  ]
  seededEventIds = seeds.map((e) => e.id as string)
  for (const e of seeds) ledger.appendEvent(e)
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

/** 被测 app：工厂注入共享句柄（懒调恰一次）；pageSize=2 让 limit 缺省路径可断言；SSE 轮询 30ms */
const app = createPanelApp({ openLedger: () => ledger, pageSize: 2, streamIntervalMs: 30 })

describe('GET /api/health', () => {
  it('ok=true 且 schema_version 与库一致', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; schema_version: number }
    expect(body.ok).toBe(true)
    expect(body.schema_version).toBe(ledger.version())
  })
})

describe('GET /api/jobs', () => {
  it('listJobs 投影：总数/due 数/逐条 due 标记（判据同 dueJobs：next_run_at<=now）', async () => {
    const res = await app.request('/api/jobs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: number; due: number; jobs: Array<{ job_id: string; due: boolean; cron: string }> }
    expect(body.total).toBe(3)
    expect(body.due).toBe(1)
    expect(body.jobs.map((j) => [j.job_id, j.due])).toEqual([
      ['job-a', true],
      ['job-b', false],
      ['job-c', false],
    ])
    expect(body.jobs[0]?.cron).toBe('*/5 * * * *')
  })
})

describe('GET /api/runs', () => {
  it('在途优先（组内 started_at 降序）；缺省 limit=pageSize', async () => {
    const res = await app.request('/api/runs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: number; inFlight: number; runs: Array<{ id: string; ended_at?: number }> }
    expect(body.total).toBe(4)
    expect(body.inFlight).toBe(2)
    expect(body.runs.map((r) => r.id)).toEqual(['r4', 'r3'])
    expect(body.runs.every((r) => r.ended_at === undefined)).toBe(true)
  })

  it('?limit=1 只取首条；?limit=abc 落回缺省；limit 上限 200 夹取', async () => {
    const one = (await (await app.request('/api/runs?limit=1')).json()) as { runs: Array<{ id: string }> }
    expect(one.runs.map((r) => r.id)).toEqual(['r4'])
    const fallback = (await (await app.request('/api/runs?limit=abc')).json()) as { runs: unknown[] }
    expect(fallback.runs.length).toBe(2)
    const big = (await (await app.request('/api/runs?limit=99999')).json()) as { runs: unknown[] }
    expect(big.runs.length).toBe(4) // 夹到 200 后仍只有 4 条语料
  })
})

describe('GET /api/workers（v0 聚合口径）', () => {
  it('未 ended 的 runs×sessions 按 person_id 聚合；basis/note 声明口径；完结行不计入', async () => {
    const res = await app.request('/api/workers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      basis: string
      note: string
      active: Array<{ person_id: string; activeRuns: number; activeSessions: number; executors: string[]; issues: string[]; sinceMs: number }>
    }
    expect(body.basis).toBe('ledger-v0')
    expect(body.note).toContain('daemon')
    expect(body.active.length).toBe(2) // P1、P2；P3 的 session 已 ended 不在册
    const p1 = body.active.find((w) => w.person_id === 'P1')
    const p2 = body.active.find((w) => w.person_id === 'P2')
    expect(p1).toMatchObject({ activeRuns: 1, activeSessions: 1, executors: ['dsh'], issues: ['DEMO-3'], sinceMs: T0 + 1000 })
    expect(p2).toMatchObject({ activeRuns: 1, activeSessions: 0, executors: ['kimi'], issues: ['DEMO-4'], sinceMs: T0 + 1100 })
  })
})

describe('GET /api/events（queryEvents 包装）', () => {
  it('全量：恒升序（store 冻结语义）', async () => {
    const body = (await (await app.request('/api/events')).json()) as { count: number; events: Array<{ id: string; ts: number }> }
    expect(body.count).toBe(5)
    expect(body.events.map((e) => e.id)).toEqual(seededEventIds)
  })

  it('?company= 与 ?issue= 过滤、?limit= 升序截尾（取最早 N）', async () => {
    const poly = (await (await app.request('/api/events?company=poly')).json()) as { events: Array<{ issue: string }> }
    expect(poly.events.map((e) => e.issue)).toEqual(['POLY-1', 'POLY-2'])
    const demo1 = (await (await app.request('/api/events?issue=DEMO-1')).json()) as { count: number }
    expect(demo1.count).toBe(2)
    const lim = (await (await app.request('/api/events?company=demo&limit=1')).json()) as { events: Array<{ id: string }> }
    expect(lim.events.map((e) => e.id)).toEqual([seededEventIds[0]])
  })
})

describe('GET /api/snapshot（buildDashboardSnapshot 一次收集）', () => {
  it('jobs/runs/workers/事件分布四区块齐备', async () => {
    const res = await app.request('/api/snapshot')
    expect(res.status).toBe(200)
    const s = (await res.json()) as {
      generatedAt: number
      schemaVersion: number
      jobs: { total: number; due: number }
      runs: { total: number; inFlight: number; recent: unknown[] }
      workers: { basis: string; active: unknown[] }
      events: { total: number; byEvent: Array<{ event: string; count: number }> }
    }
    expect(s.jobs).toEqual({ total: 3, due: 1 })
    expect(s.runs.total).toBe(4)
    expect(s.runs.inFlight).toBe(2)
    expect(s.runs.recent.length).toBe(2) // recentRuns 缺省随 pageSize=2
    expect(s.workers.basis).toBe('ledger-v0')
    expect(s.workers.active.length).toBe(2)
    expect(s.events.total).toBe(5)
    expect(s.events.byEvent).toEqual([
      { event: 'DISPATCH', count: 2 },
      { event: 'GATE_PASS', count: 1 },
      { event: 'GW_COMMENT', count: 1 },
      { event: 'HEARTBEAT', count: 1 },
    ])
    expect(s.schemaVersion).toBe(ledger.version())
    expect(s.generatedAt).toBeGreaterThan(0)
  })
})

describe('GET /（Vue 页壳——换装刀一）与 GET /legacy（旧版单页）', () => {
  it('/：importmap 页壳 + #app 挂载点 + /ui/main.js 入口 + 兜底指向 /legacy', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Studio Next')
    for (const marker of ['<script type="importmap">', '/vendor/vue.esm-browser.prod.js', '/vendor/naive-ui.prod.mjs', '/vendor/echarts.esm.min.js', '<div id="app">', '/ui/main.js', '/legacy']) {
      expect(html).toContain(marker)
    }
  })

  it('/legacy：旧版内联单页保留（四区块 + snapshot 轮询 + EventSource 接 SSE——回滚兜底）', async () => {
    const res = await app.request('/legacy')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Studio Next')
    for (const marker of ['/api/snapshot', '/api/jobs', 'EventSource', '/api/events/stream']) {
      expect(html).toContain(marker)
    }
  })
})

// —— SSE（app.request 进程内消费流；断言后 cancel 模拟客户端断开） ——

/** 逐块读 SSE 直到谓词命中（超时抛错）；调用方负责 body.cancel() */
async function readSseUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (accumulated: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const next = Date.now()
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`SSE 读取超时（已收 ${acc.length} 字节）`)), Math.max(1, deadline - next))
          timer.unref()
        }),
      ])
      if (chunk.done) break
      acc += decoder.decode(chunk.value, { stream: true })
      if (predicate(acc)) return acc
    }
    throw new Error(`SSE 谓词未命中；已收内容：${acc}`)
  } finally {
    reader.releaseLock()
  }
}

describe('GET /api/events/stream（SSE）', () => {
  it('连接即 ready；新事件入账后送达（id/事件名/载荷）；cancel 干净断开', async () => {
    const res = await app.request('/api/events/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = res.body
    expect(body).not.toBeNull()
    if (body === null) return

    // 连接后注入一条新事件（远未来 ts 保证排在游标之后）
    const newId = makeUlid(T0 + 9_000_000)
    const timer = setTimeout(() => {
      ledger.appendEvent(makeEvent({ id: newId, ts: T0 + 9_000_000, event: 'HEARTBEAT', company: 'poly', issue: 'POLY-9', tokens: { input: 0 } }))
    }, 60)

    const acc = await readSseUntil(body, (t) => t.includes(newId))
    clearTimeout(timer)
    // ready 帧 + ledger 帧齐备，载荷可反解
    expect(acc).toContain('event: ready')
    expect(acc).toContain('event: ledger')
    const dataLine = acc.split('\n').find((l) => l.startsWith('data: ') && l.includes(newId))
    expect(dataLine).toBeDefined()
    const payload = JSON.parse((dataLine as string).slice('data: '.length)) as { id: string; event: string; issue: string }
    expect(payload).toMatchObject({ id: newId, event: 'HEARTBEAT', issue: 'POLY-9' })
    expect(acc).toContain(`id: ${newId}`)

    // 客户端断开：cancel 触发 hono 响应体取消 → onAbort 旗标 → 轮询循环净停
    await expect(body.cancel()).resolves.toBeUndefined()
  }, 5000)

  it('Last-Event-ID 断线续传：从该事件起只发新事件，不重放历史', async () => {
    const lastSeededId = seededEventIds[seededEventIds.length - 1] as string
    const res = await app.request('/api/events/stream', { headers: { 'Last-Event-ID': lastSeededId } })
    const body = res.body
    expect(body).not.toBeNull()
    if (body === null) return

    const newId = makeUlid(T0 + 9_100_000)
    const timer = setTimeout(() => {
      ledger.appendEvent(makeEvent({ id: newId, ts: T0 + 9_100_000, event: 'CLOSE', company: 'demo', issue: 'DEMO-1' }))
    }, 60)

    const acc = await readSseUntil(body, (t) => t.includes(newId))
    clearTimeout(timer)
    // ready 帧游标=Last-Event-ID；历史五条不被重放（ledger 帧只含新事件）
    expect(acc).toContain(`id: ${lastSeededId}`)
    expect(acc).not.toContain(`id: ${seededEventIds[0] as string}`)
    expect(acc).not.toContain(`id: ${seededEventIds[2] as string}`)
    await expect(body.cancel()).resolves.toBeUndefined()
  }, 5000)
})
