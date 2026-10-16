/**
 * servePanel 真端口冒烟（1 例）：随机端口起真 node:http 监听 → fetch /api/health → 优雅关闭。
 * 只验「监听壳」的接线（适配器/生命周期），端面形状归 panel.test.ts（进程内零端口）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { servePanel } from '../src/index.ts'
import { T0, makeEvent } from './corpus.ts'

let root = ''
let dbPath = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-panel-serve-'))
  dbPath = path.join(root, 'serve.db')
  const ledger = openLedger(dbPath)
  ledger.appendEvent(makeEvent({ event: 'HEARTBEAT', tokens: { input: 0 } }))
  ledger.close() // 写手关掉再起 panel：WAL 读并发由 panel 自己的句柄走
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('servePanel（真监听壳冒烟）', () => {
  it('随机端口监听 → GET /api/health 200/ok → close() 干净关闭', async () => {
    const handle = await servePanel(0, dbPath)
    expect(handle.port).toBeGreaterThan(0)
    try {
      const res = await fetch(`http://${handle.hostname}:${String(handle.port)}/api/health`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; schema_version: number }
      expect(body.ok).toBe(true)
      expect(body.schema_version).toBeGreaterThan(0)
    } finally {
      await handle.close()
    }
    // 关闭后再请求即拒绝（句柄真关了，不留僵尸监听）
    await expect(fetch(`http://${handle.hostname}:${String(handle.port)}/api/health`)).rejects.toThrow()
  }, 5000)

  it('库不存在即拒启（panel 只读不代建库）', async () => {
    await expect(servePanel(0, path.join(root, 'not-exist.db'))).rejects.toThrow(/CONFIG_INVALID\/panel\/db-not-found/)
  })
})
