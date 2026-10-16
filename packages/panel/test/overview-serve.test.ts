/**
 * serveOverview 真端口冒烟（2 例）：随机端口起真 node:http 监听 → fetch 公司清单页 → 优雅关闭。
 * 只验「监听壳」的接线（listenHono 共用件 + ledger 生命周期），端面形状归 overview.test.ts
 * （进程内零端口）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { openLedger } from '@studio-next/store'
import { serveOverview } from '../src/overview/index.ts'
import type { OverviewCompanySource } from '../src/overview/index.ts'
import { makeEvent } from './corpus.ts'

let root = ''
let dbPath = ''
let templateFiles: Record<string, string>
let templateCompany: OverviewCompanySource

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-overview-serve-'))
  dbPath = path.join(root, 'serve.db')
  const ledger = openLedger(dbPath)
  ledger.appendEvent(makeEvent({ event: 'HEARTBEAT', tokens: { input: 0 } }))
  ledger.close() // 写手关掉再起 overview：WAL 读并发由 overview 自己的句柄走

  templateFiles = await readDirectoryFiles(fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url)))
  const mounted = loadCompanyDirectory(templateFiles)
  if (!mounted.ok) throw new Error(`模板目录装载失败（测试前置）：${JSON.stringify(mounted.issues)}`)
  templateCompany = {
    slug: mounted.snapshot.slug,
    snapshotProvider: () => mounted.snapshot,
    readPersonFile: (personId) => templateFiles[`departments/工程部/people/${personId}.md`],
  }
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('serveOverview（真监听壳冒烟）', () => {
  it('随机端口监听 → GET / 公司清单 200 → GET /<slug>/progress（有台账）200 → close() 干净关闭', async () => {
    const handle = await serveOverview(0, [templateCompany], { ledgerPath: dbPath })
    expect(handle.port).toBeGreaterThan(0)
    try {
      const list = await fetch(`http://${handle.hostname}:${String(handle.port)}/`)
      expect(list.status).toBe(200)
      expect(await list.text()).toContain('公司清单')

      const progress = await fetch(`http://${handle.hostname}:${String(handle.port)}/${templateCompany.slug}/progress`)
      expect(progress.status).toBe(200)
      expect(await progress.text()).toContain('ticket-mirror') // ledger 注入成功（非降级面）
    } finally {
      await handle.close()
    }
    // 关闭后再请求即拒绝（句柄真关了，不留僵尸监听）
    await expect(fetch(`http://${handle.hostname}:${String(handle.port)}/`)).rejects.toThrow()
  }, 5000)

  it('ledgerPath 不存在即拒启（overview 只读不代建库）', async () => {
    await expect(serveOverview(0, [templateCompany], { ledgerPath: path.join(root, 'not-exist.db') })).rejects.toThrow(
      /CONFIG_INVALID\/overview\/db-not-found/,
    )
  })
})
