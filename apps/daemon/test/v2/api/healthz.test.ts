/**
 * /healthz liveness 探针单测（studio-dev-697；docs/17-§2，docs/90-§三）
 *
 * 覆盖：tick 前进/停走、链摘要无效/过期、启动未跑拍；HTTP 层路由（监听壳直接应答、
 * 不落到 Hono app；503 语义；HEAD 无体）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiApp } from '@studio-next/api'
import { buildHealthz, maxTickAgeMsOf, type HealthzReport } from '../../../src/assembly/api/healthz.ts'
import { startApiServer } from '../../../src/assembly/api/live.ts'

const NOW = 1_790_000_000_000
const TICK_MS = 30_000

function baseInput(overrides: Partial<Parameters<typeof buildHealthz>[0]> = {}): Parameters<typeof buildHealthz>[0] {
  return {
    pid: 4242,
    startedAt: NOW - 10 * 60_000,
    now: NOW,
    tick: { seq: 77, count: 77, lastAt: NOW - 1_000, tickMs: TICK_MS },
    chain: { ok: true, events: 166_146, tipPrefix: 'deadbeefcafe', checkedAt: NOW - 5_000 },
    ...overrides,
  }
}

describe('buildHealthz（纯函数）', () => {
  it('tick 前进＋链正常 → 200/ok=true', () => {
    const report = buildHealthz(baseInput())
    expect(report.status).toBe(200)
    expect(report.body.ok).toBe(true)
    expect(report.body.reasons).toEqual([])
    expect(report.body.tick).toMatchObject({ seq: 77, count: 77, advancing: true, maxAgeMs: maxTickAgeMsOf(TICK_MS) })
    expect(report.body.chain).toMatchObject({ ok: true, events: 166_146, fresh: true })
  })

  it('tick 停走 → 503 + tick-stalled（不谎报）', () => {
    const report = buildHealthz(baseInput({ tick: { seq: 77, count: 77, lastAt: NOW - 5 * 60_000, tickMs: TICK_MS } }))
    expect(report.status).toBe(503)
    expect(report.body.ok).toBe(false)
    expect(report.body.reasons).toContain('tick-stalled')
    expect(report.body.tick.advancing).toBe(false)
  })

  it('尚未跑过一拍 → 503 + tick-never-ran', () => {
    const report = buildHealthz(baseInput({ tick: { seq: 0, count: 0, lastAt: null, tickMs: TICK_MS } }))
    expect(report.status).toBe(503)
    expect(report.body.reasons).toContain('tick-never-ran')
    expect(report.body.tick.ageMs).toBeNull()
  })

  it('链无效/链摘要过期 → 503', () => {
    const invalid = buildHealthz(baseInput({ chain: { ok: false, checkedAt: NOW - 1_000, error: '链断' } }))
    expect(invalid.status).toBe(503)
    expect(invalid.body.reasons).toContain('chain-invalid')
    expect(invalid.body.chain.error).toBe('链断')
    const stale = buildHealthz(
      baseInput({ chain: { ok: true, events: 1, tipPrefix: 'x', checkedAt: NOW - 11 * 60_000 } }),
    )
    expect(stale.status).toBe(503)
    expect(stale.body.reasons).toContain('chain-stale')
    expect(stale.body.chain.fresh).toBe(false)
  })
})

describe('监听壳 /healthz 路由（studio-dev-697）', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('监听壳直接应答 200/503（不落 Hono app）；HEAD 无体；其他路径仍归 app', async () => {
    // 最小 fake app（ApiApp 只需 fetch(request)；不引 Hono——本测只验监听壳路由分流）
    const app = {
      fetch: async (request: Request): Promise<Response> =>
        new URL(request.url).pathname === '/v1/company'
          ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ error: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    }
    let healthy = true
    const handle = await startApiServer(app as unknown as ApiApp, {
      port: 0,
      healthz: (): HealthzReport =>
        healthy
          ? buildHealthz(baseInput())
          : buildHealthz(baseInput({ tick: { seq: 0, count: 0, lastAt: null, tickMs: TICK_MS } })),
    })
    close = handle.close
    const ok = await fetch(`${handle.url}/healthz`)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; pid: number; tick: { advancing: boolean } }
    expect(body.ok).toBe(true)
    expect(body.pid).toBe(4242)
    expect(body.tick.advancing).toBe(true)

    healthy = false
    const bad = await fetch(`${handle.url}/healthz`)
    expect(bad.status).toBe(503)
    expect(((await bad.json()) as { reasons: string[] }).reasons).toContain('tick-never-ran')

    const head = await fetch(`${handle.url}/healthz`, { method: 'HEAD' })
    expect(head.status).toBe(503)

    // 非 /healthz 路径照旧交 Hono app（未新增契约端点）
    const company = await fetch(`${handle.url}/v1/company`)
    expect(company.status).toBe(200)
    expect(((await company.json()) as { ok: boolean }).ok).toBe(true)
  })
})
