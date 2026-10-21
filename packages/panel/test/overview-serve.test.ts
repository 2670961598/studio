/**
 * serveOverview 真端口冒烟（DEV-12 刀二后 3 例）：随机端口起真 node:http 监听 → fetch → 优雅关闭。
 * 只验「监听壳」的接线（listenHono 共用件 + ledger 生命周期）；端面形状归 overview.test.ts。
 *
 * 刀二迁移：/ 规范路径=换装壳（SPA 入口模块），v0.7 SSR 读面迁 /legacy（ticket-mirror 断言
 * 随之迁移）；新增 JSON 读面/静态入口模块真端口可达 + 热重载端到端（真 fs.watch：改
 * org-config.yaml 的 name 单行 → snapshotMeta.version+1 且 name 换新；目录改坏 → 保旧图）。
 * daemon（bin.ts cmdOverview）的装载链在测试内等价复刻：readDirectoryFiles →
 * loadCompanyDirectory → 源工厂——被测的是 serveOverview + mountHotCompanySource 的组合，
 * 不是 bin.ts 本身（CLI 面归 daemon 侧测试）。
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { mountHotCompanySource, serveOverview } from '../src/overview/index.ts'
import type { OverviewCompanySource } from '../src/overview/index.ts'
import { makeEvent } from './corpus.ts'

const templateDir = fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))
const PERSON_FILE_RE = /(?:^|\/)departments\/[^/]+\/people\/([^/]+)\.md$/

let root = ''
let dbPath = ''
let templateCompany: OverviewCompanySource

/** 轮询等待条件（热重载=watch+防抖+重装载，全异步） */
async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`条件超时（${String(ms)}ms）`)
}

/** daemon cmdOverview 的源工厂（等价复刻：档案映射按 文件名=工号） */
function makeSource(loaded: Record<string, string>, snapshot: CompanySnapshot): OverviewCompanySource {
  const personFiles = new Map<string, string>()
  for (const [p, content] of Object.entries(loaded)) {
    const m = PERSON_FILE_RE.exec(p)
    if (m !== null && m[1] !== undefined) personFiles.set(m[1], content)
  }
  return {
    slug: snapshot.slug,
    snapshotProvider: () => snapshot,
    readPersonFile: (personId) => personFiles.get(personId),
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-overview-serve-'))
  dbPath = path.join(root, 'serve.db')
  const ledger = openLedger(dbPath)
  ledger.appendEvent(makeEvent({ event: 'HEARTBEAT', tokens: { input: 0 } }))
  ledger.close() // 写手关掉再起 overview：WAL 读并发由 overview 自己的句柄走

  const templateFiles = await readDirectoryFiles(templateDir)
  const mounted = loadCompanyDirectory(templateFiles)
  if (!mounted.ok) throw new Error(`模板目录装载失败（测试前置）：${JSON.stringify(mounted.issues)}`)
  templateCompany = makeSource(templateFiles, mounted.snapshot)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('serveOverview（真监听壳冒烟）', () => {
  it('随机端口监听：/ 换装壳 + /legacy 旧面 + JSON 读面 + 静态入口模块 → close() 干净关闭', async () => {
    const handle = await serveOverview(0, [templateCompany], { ledgerPath: dbPath })
    expect(handle.port).toBeGreaterThan(0)
    const base = `http://${handle.hostname}:${String(handle.port)}`
    try {
      // 规范路径=换装壳（SPA 入口 + importmap）
      const shell = await fetch(`${base}/`)
      expect(shell.status).toBe(200)
      expect(await shell.text()).toContain('/ui/overview/main.js')
      // 旧版读面在 /legacy（v0.7 SSR 迁移面）
      const list = await fetch(`${base}/legacy`)
      expect(list.status).toBe(200)
      expect(await list.text()).toContain('公司清单')
      const progress = await fetch(`${base}/legacy/${templateCompany.slug}/progress`)
      expect(progress.status).toBe(200)
      expect(await progress.text()).toContain('ticket-mirror') // ledger 注入成功（非降级面）
      // JSON 读面（换装页数据源）
      const api = await fetch(`${base}/api/overview/companies`)
      expect(api.status).toBe(200)
      expect(((await api.json()) as { basis: string }).basis).toBe('company-directory')
      // 静态入口模块真端口可达
      const entry = await fetch(`${base}/ui/overview/main.js`)
      expect(entry.status).toBe(200)
      expect(entry.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    } finally {
      await handle.close()
    }
    // 关闭后再请求即拒绝（句柄真关了，不留僵尸监听）
    await expect(fetch(`${base}/`)).rejects.toThrow()
  }, 5000)

  it('ledgerPath 不存在即拒启（overview 只读不代建库）', async () => {
    await expect(serveOverview(0, [templateCompany], { ledgerPath: path.join(root, 'not-exist.db') })).rejects.toThrow(
      /CONFIG_INVALID\/overview\/db-not-found/,
    )
  })

  it('热重载端到端（真 fs.watch + 真装载链）：改 org-config name 单行 → JSON version+1 换名；目录改坏 → 保旧图亮 lastError', async () => {
    const companyDir = path.join(root, 'hot-corp')
    await cp(templateDir, companyDir, { recursive: true })
    const initialFiles = await readDirectoryFiles(companyDir)
    const initialMount = loadCompanyDirectory(initialFiles)
    if (!initialMount.ok) throw new Error(`热源初装失败（测试前置）：${JSON.stringify(initialMount.issues)}`)
    const slug = initialMount.snapshot.slug
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: makeSource(initialFiles, initialMount.snapshot),
      reload: async () => {
        const fresh = await readDirectoryFiles(companyDir)
        const remounted = loadCompanyDirectory(fresh)
        if (!remounted.ok) {
          throw new Error(`公司目录校验不通过（保旧图）：${remounted.issues.map((i) => `${i.file}:${i.line} [${i.rule}]`).join('；')}`)
        }
        return makeSource(fresh, remounted.snapshot)
      },
    })
    const handle = await serveOverview(0, [hot.source], { ledgerPath: dbPath })
    const base = `http://${handle.hostname}:${String(handle.port)}`
    const orgConfigPath = path.join(companyDir, 'org-config.yaml')
    type SnapshotBody = { name: string; snapshotMeta?: { version: number; lastError: string | null } }
    const snapshotOf = async (): Promise<SnapshotBody> => (await (await fetch(`${base}/api/overview/${slug}/snapshot`)).json()) as SnapshotBody
    try {
      const before = await snapshotOf()
      expect(before.name).toBe('示例公司')
      expect(before.snapshotMeta?.version).toBe(1)
      // 改单行（name）→ watch → 防抖 → 真装载链重跑 → JSON 可见
      const orgSrc = await readFile(orgConfigPath, 'utf8')
      await writeFile(orgConfigPath, orgSrc.replace('name: 示例公司', 'name: 热重载演示公司'), 'utf8')
      await until(async () => (await snapshotOf()).snapshotMeta?.version === 2)
      const after = await snapshotOf()
      expect(after.name).toBe('热重载演示公司')
      expect(after.snapshotMeta?.lastError).toBeNull()
      // 目录改坏（org-config.yaml 整文件拿走=结构缺失）→ 保旧图 + lastError 亮出
      await rm(orgConfigPath)
      await until(async () => (await snapshotOf()).snapshotMeta?.lastError !== null)
      const broken = await snapshotOf()
      expect(broken.name).toBe('热重载演示公司') // 旧图继续服务
      expect(broken.snapshotMeta?.version).toBe(2) // 版本不动（无成功装载）
      expect(broken.snapshotMeta?.lastError).toContain('校验不通过')
    } finally {
      await handle.close()
      hot.close()
    }
  }, 12000)
})
