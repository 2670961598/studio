/**
 * writer-lease —— 台账跨进程写围栏测试（PB-5 / PRB-14 正面；docs/v2/17 §五）
 *
 * 依据：
 *   - docs/v2/17 §五 PB-5：入口 MIG-04（D12 围栏/只读打开）；PRB-14 未过不得宣称台账单写；
 *   - docs/probe/pb-5/report.md PRB-14（负向）：两进程各自 openLedger、无框架围栏、
 *     query_only=0；本测试正面复测「第二写者被框架围栏拒」；
 *   - docs/80 §8.2〔结论〕1：迁移/写只在 daemon 独占窗口、且持有写者围栏/单实例锁。
 *
 * 测试只对文档冻结口径负责（真 SQLite 文件 + 真子进程，不 mock 引擎）：
 *   1. 锁文件 O_EXCL 排他创建、0600、内容 {pid,owner,at}；release 只删自己的锁；
 *   2. 同进程第二写者被拒（STALL/writer-lease-held，含持有者 pid/owner，不覆盖）；
 *   3. 死 pid 锁可恢复（清理一次后接管）；
 *   4. 锁内容不可解析 fail-closed（不覆盖）；release 不删他人锁；
 *   5. openLedgerWriter 写/读正常；close 先关库再释放；打开失败释放 lease；
 *   6. 两真实子进程：A 持锁 → B 被拒 → A 关闭 → B 可取并读写。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acquireWriterLease,
  LATEST_VERSION,
  openLedgerWriter,
  writerLeasePath,
} from '../../src/index.ts'
import { eventRecord, T0, ulid } from './fixtures.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 仓根：packages/store/test/v2 → 四层上 */
const REPO_ROOT = path.resolve(TEST_DIR, '../../../..')
const STORE_INDEX_URL = pathToFileURL(path.join(REPO_ROOT, 'packages/store/src/index.ts')).href

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-writer-lease-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 临时根下的库路径（真文件，不用 :memory:） */
function dbPath(name: string): string {
  return path.join(root, name)
}

/** ClassifiedError 形状的捕获（测试判类；不让异常逃出断言） */
interface ClassifiedThrown extends Error {
  category?: string
  subcause?: string
  detail?: string
}

function catchThrown(fn: () => unknown): ClassifiedThrown {
  try {
    fn()
  } catch (err) {
    return err as ClassifiedThrown
  }
  throw new Error('期望抛错，但调用正常返回')
}

/** 读锁文件内容（测试探针） */
interface LeaseFileContent {
  pid: number
  owner: string
  at: number
}

function readLease(lockPath: string): LeaseFileContent {
  return JSON.parse(readFileSync(lockPath, 'utf8')) as LeaseFileContent
}

/** 子进程运行参数：node 走 --input-type=module；bun -e 自带 TS/ESM（沿 readonly-open 先例） */
function runtimeArgs(script: string): string[] {
  return 'bun' in process.versions ? ['-e', script] : ['--no-warnings', '--input-type=module', '-e', script]
}

/** 真子进程句柄：按行读 stdout、写 stdin、等退出（超时带 stderr） */
interface ChildHarness {
  nextLine(timeoutMs?: number): Promise<string>
  send(line: string): void
  waitExit(): Promise<number | null>
  stderr(): string
  kill(): void
}

interface LineWaiter {
  resolve: (line: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function startChild(script: string): ChildHarness {
  const child = spawn(process.execPath, runtimeArgs(script), { cwd: REPO_ROOT, env: process.env })
  const stdin = child.stdin
  const stdout = child.stdout
  if (stdin === null || stdout === null) throw new Error('子进程 stdio 未按 pipe 建立')

  const queue: string[] = []
  const waiters: LineWaiter[] = []
  let stderrText = ''
  let buffer = ''
  let exited: Promise<number | null> | undefined

  stdout.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const waiter = waiters.shift()
      if (waiter !== undefined) {
        clearTimeout(waiter.timer)
        waiter.resolve(line)
      } else {
        queue.push(line)
      }
      index = buffer.indexOf('\n')
    }
  })
  const stderrStream = child.stderr
  if (stderrStream !== null) {
    stderrStream.setEncoding('utf8')
    stderrStream.on('data', (chunk: string) => {
      stderrText += chunk
    })
  }

  const exitedOnce = (): Promise<number | null> => {
    if (exited === undefined) {
      exited = new Promise<number | null>((resolveExit) => {
        child.on('exit', (code) => resolveExit(code))
      })
    }
    return exited
  }

  return {
    nextLine(timeoutMs = 15_000): Promise<string> {
      const ready = queue.shift()
      if (ready !== undefined) return Promise.resolve(ready)
      return new Promise<string>((resolveLine, rejectLine) => {
        let waiter: LineWaiter
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          rejectLine(new Error(`子进程输出超时（stderr=${stderrText}）`))
        }, timeoutMs)
        waiter = { resolve: resolveLine, reject: rejectLine, timer }
        waiters.push(waiter)
      })
    },
    send(line: string): void {
      stdin.write(`${line}\n`)
    },
    waitExit: exitedOnce,
    stderr: (): string => stderrText,
    kill(): void {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
  }
}

/**
 * 持锁子进程：openLedgerWriter → 打印 ready(pid/owner) → 等 stdin "close" → close → 打印
 * closed 退出；25s 兜底自杀（测试失败也不留孤儿）。
 */
function holdScript(db: string, owner: string): string {
  return `
(async () => {
  const { openLedgerWriter } = await import(${JSON.stringify(STORE_INDEX_URL)})
  const ledger = openLedgerWriter(${JSON.stringify(db)}, ${JSON.stringify(owner)})
  console.log(JSON.stringify({ ready: true, pid: process.pid, owner: ${JSON.stringify(owner)} }))
  const holdTimer = setTimeout(() => {
    console.error('child hold timeout')
    process.exit(4)
  }, 25000)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    if (String(chunk).includes('close')) {
      clearTimeout(holdTimer)
      ledger.close()
      console.log(JSON.stringify({ closed: true }))
      process.exit(0)
    }
  })
  setInterval(() => {}, 1000)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
`
}

/** 竞争者子进程：尝试 openLedgerWriter，成功则 kv 写读验证；失败打印分类 JSON（不退出非零） */
function attemptScript(db: string, owner: string): string {
  return `
(async () => {
  const { openLedgerWriter } = await import(${JSON.stringify(STORE_INDEX_URL)})
  try {
    const ledger = openLedgerWriter(${JSON.stringify(db)}, ${JSON.stringify(owner)})
    ledger.kvSet('writer-lease.probe', ${JSON.stringify(owner)})
    const value = ledger.kvGet('writer-lease.probe')
    ledger.close()
    console.log(JSON.stringify({ ok: true, value }))
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      category: err && err.category,
      subcause: err && err.subcause,
      detail: err && err.detail,
      message: err instanceof Error ? err.message : String(err),
    }))
  }
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
`
}

describe('acquireWriterLease（跨进程写围栏）', () => {
  it('O_EXCL 锁文件 0600、内容 pid/owner/at；release 只删自己的锁且幂等', () => {
    const db = dbPath('basic.db')
    const lockPath = writerLeasePath(db)
    expect(lockPath).toBe(`${path.resolve(db)}.writer.lock`)

    const lease = acquireWriterLease(db, 'basic-owner')
    try {
      expect(lease.dbPath).toBe(path.resolve(db))
      expect(lease.lockPath).toBe(lockPath)
      expect(lease.pid).toBe(process.pid)
      expect(lease.owner).toBe('basic-owner')
      expect(existsSync(lockPath)).toBe(true)
      expect(existsSync(db)).toBe(false) // 取租约不建库（openLedger 的职责）
      const raw = readFileSync(lockPath, 'utf8')
      expect(raw.endsWith('\n')).toBe(true)
      expect(JSON.parse(raw)).toEqual({ pid: process.pid, owner: 'basic-owner', at: lease.acquiredAt })
      // 0o600：组/其他位必须为空（umask 只会再收紧）
      expect(statSync(lockPath).mode & 0o077).toBe(0)
    } finally {
      expect(lease.release()).toBe(true)
    }
    expect(existsSync(lockPath)).toBe(false)
    expect(lease.release()).toBe(false) // 同一 handle 幂等
  })

  it('同进程第二写者被拒：STALL/writer-lease-held 含持有者 pid/owner，锁文件不被覆盖', () => {
    const db = dbPath('same-process.db')
    const lockPath = writerLeasePath(db)
    const first = acquireWriterLease(db, 'first-writer')
    const firstRaw = readFileSync(lockPath, 'utf8')
    try {
      const err = catchThrown(() => acquireWriterLease(db, 'second-writer'))
      expect(err).toMatchObject({ category: 'STALL', subcause: 'writer-lease-held' })
      expect(err.detail).toContain(`pid=${process.pid}`)
      expect(err.detail).toContain('owner=first-writer')
      // 不覆盖：持锁文件逐字不变
      expect(readFileSync(lockPath, 'utf8')).toBe(firstRaw)
    } finally {
      expect(first.release()).toBe(true)
    }
    // 第一写者释放后第二写者可取（同进程可再次持锁）
    const second = acquireWriterLease(db, 'second-writer')
    try {
      expect(readLease(lockPath)).toMatchObject({ pid: process.pid, owner: 'second-writer' })
    } finally {
      expect(second.release()).toBe(true)
    }
  })

  it('死 pid 锁可恢复：清理一次后接管，锁内容换成本次写入', () => {
    const db = dbPath('dead-pid.db')
    const lockPath = writerLeasePath(db)
    // 真死进程：spawnSync 退出的子进程 pid（OS 未复用前 process.kill(pid,0)=ESRCH）
    const dead = spawnSync(process.execPath, runtimeArgs('process.exit(0)'), { encoding: 'utf8' })
    expect(dead.status).toBe(0)
    const deadPid = dead.pid
    if (typeof deadPid !== 'number') throw new Error('spawnSync 未返回子进程 pid')
    const stale = { pid: deadPid, owner: 'dead-writer', at: Date.now() - 60_000 }
    writeFileSync(lockPath, `${JSON.stringify(stale)}\n`, { mode: 0o600 })

    const lease = acquireWriterLease(db, 'new-writer')
    try {
      expect(lease.pid).toBe(process.pid)
      expect(readLease(lockPath)).toEqual({ pid: process.pid, owner: 'new-writer', at: lease.acquiredAt })
    } finally {
      expect(lease.release()).toBe(true)
    }
  })

  it('锁内容不可解析：STALL/writer-lease-unreadable，fail-closed 不覆盖', () => {
    const db = dbPath('unreadable.db')
    const lockPath = writerLeasePath(db)
    const malformed = '{"pid":not-json\n'
    writeFileSync(lockPath, malformed, 'utf8')
    const err = catchThrown(() => acquireWriterLease(db, 'any-writer'))
    expect(err).toMatchObject({ category: 'STALL', subcause: 'writer-lease-unreadable' })
    expect(readFileSync(lockPath, 'utf8')).toBe(malformed)
    unlinkSync(lockPath)
  })

  it('release 内容校验：他人锁不删（返回 false、文件逐字保留）', () => {
    const db = dbPath('foreign-lock.db')
    const lockPath = writerLeasePath(db)
    const lease = acquireWriterLease(db, 'owner-a')
    const foreign = `${JSON.stringify({ pid: process.pid, owner: 'owner-b', at: lease.acquiredAt + 1 })}\n`
    writeFileSync(lockPath, foreign, 'utf8')
    try {
      expect(lease.release()).toBe(false)
      expect(readFileSync(lockPath, 'utf8')).toBe(foreign)
      expect(lease.release()).toBe(false)
    } finally {
      unlinkSync(lockPath)
    }
  })

  it('入参/路径分类：空 owner、空 dbPath、父目录不存在 = CONFIG_INVALID', () => {
    const db = dbPath('invalid.db')
    expect(() => acquireWriterLease(db, '')).toThrow(/writer-lease-owner-invalid/)
    expect(() => acquireWriterLease('', 'owner')).toThrow(/writer-lease-path-invalid/)
    expect(() => writerLeasePath('   ')).toThrow(/writer-lease-path-invalid/)
    const missing = path.join(root, 'missing-parent', 'ledger.db')
    const err = catchThrown(() => acquireWriterLease(missing, 'owner'))
    expect(err).toMatchObject({ category: 'CONFIG_INVALID', subcause: 'writer-lease-path-invalid' })
    expect(existsSync(writerLeasePath(missing))).toBe(false)
  })
})

describe('openLedgerWriter（lease → openLedger；close 先关库再释放）', () => {
  it('写/读正常；close 后锁释放、库可重开读回事件', () => {
    const db = dbPath('writer-ledger.db')
    const lockPath = writerLeasePath(db)
    const id = ulid(T0, 1)
    const ledger = openLedgerWriter(db)
    try {
      expect(existsSync(lockPath)).toBe(true)
      expect(ledger.version()).toBe(LATEST_VERSION)
      expect(readLease(lockPath)).toMatchObject({ pid: process.pid, owner: `writer:${process.pid}` })
      expect(ledger.appendEvent(eventRecord({ id, issue: 'STUDIO-LEASE-1' })).appended).toBe(true)
      expect(ledger.queryEvents().map((record) => record.id)).toEqual([id])
    } finally {
      ledger.close()
    }
    expect(existsSync(lockPath)).toBe(false)
    expect(() => ledger.version()).toThrow() // db 已先关

    const again = openLedgerWriter(db)
    try {
      expect(again.queryEvents().map((record) => record.id)).toEqual([id])
    } finally {
      again.close()
    }
    expect(existsSync(lockPath)).toBe(false)
  })

  it('打开失败释放 lease：分类 STALL/db-open-failed，锁文件不残留', async () => {
    const dirAsDb = path.join(root, 'directory-as-db')
    await mkdir(dirAsDb, { recursive: true })
    const lockPath = writerLeasePath(dirAsDb)
    const err = catchThrown(() => openLedgerWriter(dirAsDb, 'open-failure'))
    expect(err).toMatchObject({ category: 'STALL', subcause: 'db-open-failed' })
    expect(existsSync(lockPath)).toBe(false)
    // 失败没有把锁留成死锁：随后仍可正常取锁
    const lease = acquireWriterLease(dirAsDb, 'after-open-failure')
    expect(lease.release()).toBe(true)
  })

  it('两真实子进程：A 持锁 → B 被 STALL/writer-lease-held 拒 → A 关闭后 B 可取并读写', async () => {
    const db = dbPath('two-process.db')
    const lockPath = writerLeasePath(db)
    const a = startChild(holdScript(db, 'child-A'))
    let b: ChildHarness | undefined
    let c: ChildHarness | undefined
    try {
      const ready = JSON.parse(await a.nextLine()) as { ready?: boolean; pid?: number; owner?: string }
      expect(ready).toMatchObject({ ready: true, owner: 'child-A' })
      const holderPid = ready.pid
      if (typeof holderPid !== 'number') throw new Error('子进程 A 未上报 pid')
      expect(readLease(lockPath)).toMatchObject({ pid: holderPid, owner: 'child-A' })

      // 第二写者（真独立进程）：被框架围栏拒绝，不是 SQLite 引擎串行化
      b = startChild(attemptScript(db, 'child-B'))
      const rejected = JSON.parse(await b.nextLine()) as {
        ok?: boolean
        category?: string
        subcause?: string
        detail?: string
      }
      expect(rejected.ok).toBe(false)
      expect(rejected.category).toBe('STALL')
      expect(rejected.subcause).toBe('writer-lease-held')
      expect(rejected.detail).toContain(`pid=${holderPid}`)
      expect(rejected.detail).toContain('owner=child-A')
      expect(await b.waitExit()).toBe(0)
      // B 被拒后 A 仍持锁（围栏拒绝不破坏持有者）
      expect(readLease(lockPath)).toMatchObject({ pid: holderPid, owner: 'child-A' })

      // A 关闭（先关库再释放锁）→ 锁文件消失
      a.send('close')
      expect(JSON.parse(await a.nextLine())).toMatchObject({ closed: true })
      expect(await a.waitExit()).toBe(0)
      expect(existsSync(lockPath)).toBe(false)

      // 第一关闭后第二可取，且写/读正常
      c = startChild(attemptScript(db, 'child-C'))
      const accepted = JSON.parse(await c.nextLine()) as { ok?: boolean; value?: string }
      expect(accepted).toEqual({ ok: true, value: 'child-C' })
      expect(await c.waitExit()).toBe(0)
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      a.kill()
      b?.kill()
      c?.kill()
    }
  })
})
