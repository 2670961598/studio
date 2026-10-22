/**
 * mountHotCompanySource 单测（DEV-12 刀二：公司目录热重载的 IO 层）。
 * 依据：docs/04-§七（公司 git 目录=组织事实源）、docs/17-§3、docs/20（保旧图/不臆造/
 * 失败如实分类）——真 fs.watch（temp 目录真写真触发），不用假定时器：watch 事件链
 * （内核 → node → 回调）正是本件被测面，mock 掉等于没测。
 *
 * 面板：
 *   - 契约：initial 必填（运行时兜底抛）、snapshotInfo 标注（at/version/watching/lastError）；
 *   - 换图：目录写 → 防抖 → reload → version+1（含 async reload 与 getter 活引用——不 spread）；
 *   - 保旧图：reload 抛错/拒绝 → 旧快照继续服务、lastError 如实记录、version 不动；恢复即清错；
 *   - 防抖窗：窗口内二次事件重置定时器（合并为一次重载）；
 *   - 收尾/降级：close 后不再热更（快照仍可读）；watchEnabled:false 不监听；
 *   - 集成：热源进 createOverviewApp → /api/overview/* 的 snapshotMeta 随换图版本活变。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 }) // E-4 前例：fs.watch 时序用例在全量并行负载下超缺省 5s——只动预算不动断言（2026-10-22 宰相亲批）
import type { CompanySnapshot } from '@studio-next/contract'
import { createOverviewApp, mountHotCompanySource } from '../src/overview/index.ts'
import type { OverviewCompanySource } from '../src/overview/index.ts'

let root = ''
let companyDir = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-hot-'))
  companyDir = path.join(root, 'corp-hot')
  await mkdir(companyDir, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 轮询等待条件成立（watch 事件+防抖都是异步——测试侧不 sleep 死等；条件可 async） */
async function until(cond: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`条件超时（${String(ms)}ms）`)
}

const snap = (name: string): CompanySnapshot => ({
  slug: 'corp-hot',
  name,
  level: 1,
  charter: 'charter.md',
  platform: { platform: 'youtrack' },
  departments: [],
  people: [],
  jobs: [],
})

const src = (name: string, extra: Partial<OverviewCompanySource> = {}): OverviewCompanySource => ({
  slug: 'corp-hot',
  snapshotProvider: () => snap(name),
  ...extra,
})

/** 触发一次目录事件（写不同文件名——macOS fs.watch rename 事件可靠） */
const touch = (n: number): Promise<void> => writeFile(path.join(companyDir, `touch-${String(n)}.md`), `# v${String(n)}\n`, 'utf8')

// ————————————————————————— 契约面 —————————————————————————

describe('mountHotCompanySource 契约', () => {
  it('initial 必填：缺初装即抛（启动错误不走保旧图路径）', () => {
    expect(() => mountHotCompanySource({ directory: root } as never)).toThrow(/initial 必填/)
  })

  it('初装即 version=1：snapshotInfo/handle.info 同源（at/atIso 语义在 JSON 层；此处 at/version/watching/lastError）', () => {
    const hot = mountHotCompanySource({ directory: root, initial: src('甲'), reload: () => src('乙'), watchEnabled: false })
    try {
      expect(hot.info()).toEqual({ at: expect.any(Number), version: 1, watching: false, lastError: null })
      expect(hot.source.snapshotInfo()).toEqual(hot.info())
      expect(hot.source.slug).toBe('corp-hot')
    } finally {
      hot.close()
    }
  })
})

// ————————————————————————— 换图与保旧图（真 fs.watch） —————————————————————————

describe('目录监听热重载（真 fs.watch + 防抖）', () => {
  it('目录写 → 防抖后 reload → 换图 version+1、lastError 清空；可选字段 getter 活引用（不 spread 冻结）', async () => {
    let gen = 0
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲', { mission: '使命一', readPersonFile: () => '甲的档案' }),
      reload: async () => {
        gen += 1
        return src(gen === 1 ? '乙' : '丙', { mission: `使命${gen === 1 ? '二' : '三'}`, readPersonFile: () => `第${String(gen)}代的档案` })
      },
    })
    try {
      expect(hot.info().watching).toBe(true)
      expect(hot.source.mission).toBe('使命一')
      expect(hot.source.readPersonFile?.('PB-1')).toBe('甲的档案')
      await touch(1)
      await until(() => hot.info().version === 2)
      expect(hot.source.snapshotProvider().name).toBe('乙')
      expect(hot.info().lastError).toBeNull()
      // 活引用：同一路由对象上取到新一代的 mission/档案（spread 冻结会留旧值——此断言钉死）
      expect(hot.source.mission).toBe('使命二')
      expect(hot.source.readPersonFile?.('PB-1')).toBe('第1代的档案')
    } finally {
      hot.close()
    }
  })

  it('reload 抛错 → 保旧图：version 不动、快照仍服务最后一次有效值、lastError 如实记录；非 Error 拒绝值字符串化', async () => {
    let fail = false
    let gen = 0
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲'),
      reload: () => {
        gen += 1
        if (fail) throw new Error('目录校验不过：departments/工程部 缺 leader')
        return src(`第${String(gen)}代`)
      },
    })
    try {
      await touch(2)
      await until(() => hot.info().version === 2)
      const atV2 = hot.info().at
      fail = true
      await touch(3)
      await until(() => hot.info().lastError !== null)
      expect(hot.info().lastError).toContain('校验不过')
      expect(hot.info().version).toBe(2)
      expect(hot.info().at).toBe(atV2)
      expect(hot.source.snapshotProvider().name).toBe('第1代') // 保旧图
      // 恢复：目录修好后 lastError 清空、version+1
      fail = false
      await touch(4)
      await until(() => hot.info().version === 3)
      expect(hot.info().lastError).toBeNull()
      expect(hot.source.snapshotProvider().name).toBe('第3代')
    } finally {
      hot.close()
    }
    // 非 Error 拒绝：字符串错误如实字符串化（不臆造 Error 名）
    const hot2 = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲'),
      reload: () => Promise.reject('ledger 文件被锁'),
    })
    try {
      await touch(5)
      await until(() => hot2.info().lastError !== null)
      expect(hot2.info().lastError).toBe('ledger 文件被锁')
      expect(hot2.source.snapshotProvider().name).toBe('甲')
    } finally {
      hot2.close()
    }
  })

  it('防抖窗内二次事件重置定时器（两次写合并为一次 reload）', async () => {
    let calls = 0
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲'),
      reload: () => {
        calls += 1
        return src(`第${String(calls)}代`)
      },
      debounceMs: 400,
    })
    try {
      await touch(6)
      await new Promise((r) => setTimeout(r, 200)) // 窗内（<400ms）
      await touch(7)
      // 首事件定时器已被二次事件重置：若未重置，400ms 处必已重载——460ms 仍为 0 即重置成立
      await new Promise((r) => setTimeout(r, 260))
      expect(calls).toBe(0)
      expect(hot.info().version).toBe(1)
      await until(() => calls === 1) // 重置后的定时器（≈600ms）到期——合并成恰好一次
      expect(hot.info().version).toBe(2)
      await new Promise((r) => setTimeout(r, 500)) // 窗外再无事件
      expect(calls).toBe(1)
    } finally {
      hot.close()
    }
  })

  it('close 后不再热更（快照仍可读——进程收尾语义）', async () => {
    let calls = 0
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲'),
      reload: () => {
        calls += 1
        return src('乙')
      },
      debounceMs: 100,
    })
    await touch(8)
    await until(() => calls === 1)
    hot.close()
    expect(hot.info().watching).toBe(false)
    await touch(9)
    await new Promise((r) => setTimeout(r, 400))
    expect(calls).toBe(1)
    expect(hot.source.snapshotProvider().name).toBe('乙') // 收尾后仍服务最后有效快照
  })
})

// ————————————————————————— 集成：热源 → createOverviewApp → JSON snapshotMeta 活变 —————————————————————————

describe('热源接入端面（app.request 集成）', () => {
  it('目录写 → JSON 读面的 snapshotMeta.version 跟着 +1（server 活转发，不缓存装载时的旧 meta）', async () => {
    let gen = 0
    const hot = mountHotCompanySource({
      directory: companyDir,
      initial: src('甲'),
      reload: () => {
        gen += 1
        return src(`第${String(gen)}代`)
      },
    })
    try {
      const app = createOverviewApp({ companies: [hot.source] })
      const metaOf = async (): Promise<{ version: number; watching: boolean; lastError: string | null }> => {
        const body = (await (await app.request('/api/overview/companies')).json()) as {
          companies: Array<{ snapshotMeta?: { version: number; watching: boolean; lastError: string | null } }>
        }
        const meta = body.companies[0]?.snapshotMeta
        expect(meta).toBeDefined()
        return meta as { version: number; watching: boolean; lastError: string | null }
      }
      expect((await metaOf()).version).toBe(1)
      await touch(10)
      await until(async () => (await metaOf()).version === 2) // JSON 读面轮询到 version=2
      const after = await metaOf()
      expect(after.version).toBe(2)
      expect(after.watching).toBe(true)
      const snapBody = (await (await app.request('/api/overview/corp-hot/snapshot')).json()) as { name: string }
      expect(snapBody.name).toBe('第1代')
    } finally {
      hot.close()
    }
  })
})
