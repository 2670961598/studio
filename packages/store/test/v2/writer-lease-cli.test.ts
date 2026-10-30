/**
 * writer-lease × CLI/重建写面覆盖测试（PB-5 附录 B / PRB-14 写侧围栏覆盖扩展）
 *
 * 依据：
 *   - docs/probe/pb-5/report.md 附录 B（B.6 覆盖清单：runServe＋CLI/rebuild/drill 写点）；
 *   - docs/v2/17 §五 PB-5：PRB-14 未过不得宣称台账单写；
 *   - packages/store/src/writer-lease.ts 头注：围栏只约束 `openLedgerWriter` 调用者。
 *
 * 断言口径（真子进程，不 mock 引擎/不做进程内冒名）：
 *   1. 写命令遇另一活写者持锁 → 退出非零 + `STALL/writer-lease-held`（detail 含持有者 pid/owner）；
 *   2. 持锁者关闭（先关库后释放）→ 同一写命令可执行，且锁文件不残留；
 *   3. 读命令（jobs list / gray 缺省查窗）**不纳围栏**——持锁期间照常可读（登记缺口）；
 *   4. 重建/演习（ledger rebuild / ledger drill）写面同拒，且失败路径不残留自己的锁。
 *
 * 落点说明：本测试在 `packages/store/test/v2`（V2 唯一允许新增的测试面）以**路径字符串**
 * 调起 daemon CLI（`apps/daemon/src/cli/main.ts`），不经任何 import——分层门禁无新增边。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, writerLeasePath } from '../../src/index.ts'
import { eventRecord, T0, ulid } from './fixtures.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 仓根：packages/store/test/v2 → 四层上 */
const REPO_ROOT = path.resolve(TEST_DIR, '../../../..')
const STORE_INDEX_URL = pathToFileURL(path.join(REPO_ROOT, 'packages/store/src/index.ts')).href
/** daemon CLI 入口（Node 24 type-stripping 直跑；路径字符串，不构成模块依赖） */
const CLI_BIN = path.join(REPO_ROOT, 'apps/daemon/src/cli/main.ts')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-lease-cli-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 真 CLI 子进程（stdio 全收；60s 上限——超时即红，不以超时刷绿） */
function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** 子进程运行参数：node 走 --input-type=module；bun -e 自带 TS/ESM（沿 writer-lease.test.ts 先例） */
function runtimeArgs(script: string): string[] {
  return 'bun' in process.versions ? ['-e', script] : ['--no-warnings', '--input-type=module', '-e', script]
}

/**
 * 持锁子进程脚本：mode=writer 走 `openLedgerWriter`（真写者：库在握）；mode=lease 只取
 * `acquireWriterLease`（目标库**必须不被创建**——drill 防呆/rebuild 拒建断言用）。
 * 打印 ready → 等 stdin "close" → 先关库/释放锁再打印 closed 退出；25s 兜底自杀。
 */
function holderScript(db: string, owner: string, mode: 'writer' | 'lease'): string {
  const open =
    mode === 'writer'
      ? `const ledger = store.openLedgerWriter(${JSON.stringify(db)}, ${JSON.stringify(owner)})`
      : `const lease = store.acquireWriterLease(${JSON.stringify(db)}, ${JSON.stringify(owner)})`
  const close = mode === 'writer' ? 'ledger.close()' : 'lease.release()'
  return `
(async () => {
  const store = await import(${JSON.stringify(STORE_INDEX_URL)})
  ${open}
  console.log(JSON.stringify({ ready: true, pid: process.pid, owner: ${JSON.stringify(owner)} }))
  const holdTimer = setTimeout(() => {
    console.error('holder timeout')
    process.exit(4)
  }, 25000)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    if (String(chunk).includes('close')) {
      clearTimeout(holdTimer)
      ${close}
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

interface Holder {
  child: ChildProcess
  /** 第一行 ready 的 JSON（pid/owner） */
  ready: Promise<{ pid: number; owner: string }>
  /** 子进程退出码（close 后 = 0） */
  exit: Promise<number | null>
  stderr(): string
  kill(): void
}

/** 起持锁子进程：锁就绪（ready 行）后才返回，避免测试与子进程抢跑 */
function startHolder(db: string, owner: string, mode: 'writer' | 'lease'): Holder {
  const child = spawn(process.execPath, runtimeArgs(holderScript(db, owner, mode)), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderrText = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrText += chunk
  })
  const exit = new Promise<number | null>((resolveExit) => {
    child.on('exit', (code) => resolveExit(code))
  })
  const ready = new Promise<{ pid: number; owner: string }>((resolveReady, rejectReady) => {
    let buffer = ''
    const timer = setTimeout(() => {
      rejectReady(new Error(`持锁子进程就绪超时（stderr=${stderrText}）`))
    }, 20_000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      clearTimeout(timer)
      const line = buffer.slice(0, index)
      try {
        resolveReady(JSON.parse(line) as { pid: number; owner: string })
      } catch {
        rejectReady(new Error(`持锁子进程就绪行不可解析：${line}（stderr=${stderrText}）`))
      }
    })
  })
  return {
    child,
    ready,
    exit,
    stderr: (): string => stderrText,
    kill: (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
  }
}

/** 让持锁子进程关闭（先关库/释放锁再退出）；非 0 退出=测试夹具故障，如实红 */
async function closeHolder(holder: Holder): Promise<void> {
  holder.child.stdin?.write('close\n')
  const code = await Promise.race([
    holder.exit,
    new Promise<number | null>((resolveTimeout) => {
      setTimeout(() => resolveTimeout(null), 10_000)
    }),
  ])
  holder.kill()
  if (code !== 0) {
    throw new Error(`持锁子进程未正常关闭（code=${String(code)} stderr=${holder.stderr()}`)
  }
}

/**
 * 持锁时段：起 holder → 跑 fn（断言在持锁期）→ 正常关闭释放；fn 抛错则 SIGKILL 兜底
 * （不留孤儿；死 pid 锁的回收语义另由 writer-lease.test.ts 覆盖）。
 */
async function withHolder(
  db: string,
  owner: string,
  mode: 'writer' | 'lease',
  fn: (holder: { pid: number; owner: string }) => void,
): Promise<void> {
  const holder = startHolder(db, owner, mode)
  const info = await holder.ready
  let released = false
  try {
    fn(info)
    await closeHolder(holder)
    released = true
  } finally {
    if (!released) holder.kill()
  }
}

/** 夹具底座：库 + 一岗 + 一灰度窗（写命令的既有事实面；锁不预设） */
function makeBaseDb(name: string): string {
  const db = path.join(root, name)
  const ledger = openLedger(db)
  ledger.upsertJob({
    job_id: 'job-1',
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload: { type: 'report' },
    next_run_at: 1_000,
  })
  ledger.kvSet(
    'gray:CAND-1',
    JSON.stringify({
      candidateId: 'CAND-1',
      assetPath: 'docs/x.md',
      company: 'demo',
      openedAt: Date.now() - 1_000,
      windowMs: 86_400_000,
      maxIncidents: 3,
      status: 'open',
      closedAt: null,
      reason: null,
    }),
  )
  ledger.close()
  return db
}

/** 写事件语料库 → dumpEvents 出 JSONL（ledger rebuild 的真输入） */
function makeEventsJsonl(name: string): string {
  const src = openLedger(path.join(root, `${name}-src.sqlite`))
  for (let i = 0; i < 3; i += 1) src.appendEvent(eventRecord({ id: ulid(T0, i + 1) }))
  const jsonl = path.join(root, `${name}.jsonl`)
  src.dumpEvents(jsonl)
  src.close()
  return jsonl
}

/** 期望的拒收面：非零退出 + STALL/writer-lease-held + 持有者身份（pid/owner） */
function expectHeldRefusal(
  res: { status: number | null; stdout: string; stderr: string },
  prefix: string,
  holder: { pid: number; owner: string },
): void {
  expect(res.status, `stdout=${res.stdout} stderr=${res.stderr}`).toBe(1)
  expect(res.stderr).toContain(`${prefix} 失败`)
  expect(res.stderr).toContain('STALL/writer-lease-held')
  expect(res.stderr).toContain(`pid=${holder.pid}`)
  expect(res.stderr).toContain(`owner=${holder.owner}`)
}

describe('写命令持锁拒（PB-5 围栏覆盖：CLI 写面）', () => {
  it('jobs catchup：daemon 持锁 → STALL/writer-lease-held；jobs list 只读不纳围栏；释放后可执行', async () => {
    const db = makeBaseDb('jobs.sqlite')
    await withHolder(db, 'daemon:serve', 'writer', (holder) => {
      expectHeldRefusal(runCli(['jobs', 'catchup', '--db', db, '--job', 'job-1']), 'jobs catchup', holder)
      // 读命令不纳围栏：持锁期间 jobs list 照常 exit 0（登记缺口，不改读语义）
      const listed = runCli(['jobs', 'list', '--db', db])
      expect(listed.status).toBe(0)
      expect(listed.stdout).toContain('调度岗 1 个')
    })
    expect(existsSync(writerLeasePath(db))).toBe(false) // 先关库后释放，锁不残留

    const before = Date.now()
    const ok = runCli(['jobs', 'catchup', '--db', db, '--job', 'job-1'])
    expect(ok.status, `stderr=${ok.stderr}`).toBe(0)
    expect(ok.stdout).toContain('已补跑排程：job-1')
    const check = openLedger(db)
    const job = check.getJob('job-1')
    check.close()
    expect(job?.next_run_at).toBeGreaterThanOrEqual(before) // 槽确实挪到当下
    expect(existsSync(writerLeasePath(db))).toBe(false)
  })

  it('ledger rebuild：目标库被持锁 → 拒且不建库；释放后重建成功；坏行失败路径不残留锁', async () => {
    const jsonl = makeEventsJsonl('rebuild')
    const target = path.join(root, 'rebuild-target.sqlite')
    // lease 模式：目标库不存在（rebuild 取锁失败先于建库的断言基准）
    await withHolder(target, 'daemon:serve', 'lease', (holder) => {
      expectHeldRefusal(runCli(['ledger', 'rebuild', jsonl, target]), 'ledger rebuild', holder)
      expect(existsSync(target)).toBe(false)
    })
    expect(existsSync(writerLeasePath(target))).toBe(false)

    const ok = runCli(['ledger', 'rebuild', jsonl, target])
    expect(ok.status, `stderr=${ok.stderr}`).toBe(0)
    expect(ok.stdout).toContain('已重建：events=3')
    expect(existsSync(writerLeasePath(target))).toBe(false)
    const rebuilt = openLedger(target)
    expect(rebuilt.queryEvents().length).toBe(3)
    rebuilt.close()

    // 失败路径（坏 JSONL）同样经 close 释放租约——不把锁留给下一个写者
    const badJsonl = path.join(root, 'rebuild-bad.jsonl')
    await writeFile(badJsonl, '<<<不是JSON>>>\n', 'utf8')
    const bad = runCli(['ledger', 'rebuild', badJsonl, target])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('ledger rebuild 失败')
    expect(bad.stderr).toContain('第 1 行')
    expect(existsSync(writerLeasePath(target))).toBe(false)
  })

  it('ledger drill：演习库路径被活写者占锁 → 拒且不建库；释放后演习 PASS', async () => {
    const drillPath = path.join(root, 'drill.sqlite')
    await withHolder(drillPath, 'daemon:serve', 'lease', (holder) => {
      expectHeldRefusal(runCli(['ledger', 'drill', drillPath]), 'ledger drill', holder)
      expect(existsSync(drillPath)).toBe(false) // 拒在防呆/建库之前
    })
    expect(existsSync(writerLeasePath(drillPath))).toBe(false)

    const ok = runCli(['ledger', 'drill', drillPath])
    expect(ok.status, `stderr=${ok.stderr}`).toBe(0)
    expect(ok.stdout).toContain('演习 PASS')
    expect(existsSync(writerLeasePath(drillPath))).toBe(false) // drill 写→rebuild 写→读验收，锁全释放
  })

  it('gray：--check/--close（写面）持锁拒；缺省查窗（只读）不纳围栏；释放后关窗成功', async () => {
    const db = makeBaseDb('gray.sqlite')
    await withHolder(db, 'daemon:serve', 'writer', (holder) => {
      expectHeldRefusal(runCli(['gray', '--db', db, '--candidate', 'CAND-1', '--close']), 'gray', holder)
      expectHeldRefusal(runCli(['gray', '--db', db, '--candidate', 'CAND-1', '--check']), 'gray', holder)
      // 缺省=查窗（只读面）：持锁期间照常可读（登记缺口：读命令未纳围栏）
      const read = runCli(['gray', '--db', db, '--candidate', 'CAND-1'])
      expect(read.status).toBe(0)
      expect(read.stdout).toContain('观察窗状态：open（守夜中）')
    })
    expect(existsSync(writerLeasePath(db))).toBe(false)

    const closed = runCli(['gray', '--db', db, '--candidate', 'CAND-1', '--close'])
    expect(closed.status, `stderr=${closed.stderr}`).toBe(0)
    expect(closed.stdout).toContain('灰度观察窗已手动关窗')
    const check = openLedger(db)
    const raw = check.kvGet('gray:CAND-1')
    check.close()
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ status: 'closed' })
    expect(existsSync(writerLeasePath(db))).toBe(false)
  })

  it('cutover / sandbox / postmortem：写命令打开即纳围栏（持锁拒，库面零写入）', async () => {
    const db = makeBaseDb('evolve.sqlite')
    const inputPath = path.join(root, 'postmortem.json')
    await writeFile(
      inputPath,
      JSON.stringify({
        issue: 'STUDIO-1',
        summary: '摘要',
        incidentAt: 1,
        detectedAt: 2,
        containment: '隔离',
        conclusion: '结论',
        timeline: [],
        rootCauses: [{ kind: 'process-gap', summary: '流程缺口' }],
        preventions: [{ summary: '补规程', outlet: 'protocol' }],
      }),
      'utf8',
    )
    await withHolder(db, 'daemon:serve', 'writer', (holder) => {
      expectHeldRefusal(
        runCli([
          'cutover',
          '--db',
          db,
          '--candidate',
          'CAND-1',
          '--file',
          path.join(root, 'new.md'),
          '--company',
          'demo',
          '--root',
          root,
        ]),
        'cutover',
        holder,
      )
      expectHeldRefusal(runCli(['sandbox', '--db', db, '--candidate', 'CAND-1', '--root', root]), 'sandbox', holder)
      expectHeldRefusal(runCli(['postmortem', '--db', db, '--company', 'demo', '--input', inputPath]), 'postmortem', holder)
    })
    // 库面零写入：三条写命令都在打开阶段被拒（事件/候选/状态全未动）
    const check = openLedger(db)
    expect(check.queryEvents().length).toBe(0)
    expect(check.getCandidate('CAND-1')).toBeUndefined()
    check.close()
  })

  it('company create：--dry-run 不取写者租约（持锁仍 exit 0 零落盘）；真跑播种持锁拒；释放后播种成功', async () => {
    const db = path.join(root, 'company', 'var', 'ledger.sqlite')
    await mkdir(path.dirname(db), { recursive: true })
    // lease 模式：库在持锁期间必须不被创建（dry-run 零落盘 + 播种拒建库）
    await withHolder(db, 'daemon:serve', 'lease', (holder) => {
      const dry = runCli([
        'company',
        'create',
        'demo-corp',
        '--work-root',
        path.join(root, 'company', 'w-dry'),
        '--db',
        db,
        '--dry-run',
      ])
      expect(dry.status, `stderr=${dry.stderr}`).toBe(0)
      expect(dry.stdout).toContain('dry-run：零落盘')
      expect(existsSync(db)).toBe(false)

      const held = runCli(['company', 'create', 'demo-corp', '--work-root', path.join(root, 'company', 'w-held'), '--db', db])
      expectHeldRefusal(held, 'company create', holder)
      expect(existsSync(db)).toBe(false) // 播种取锁失败先于建库：不留半成品库
    })
    expect(existsSync(writerLeasePath(db))).toBe(false)

    const ok = runCli(['company', 'create', 'demo-corp', '--work-root', path.join(root, 'company', 'w-ok'), '--db', db])
    expect(ok.status, `stderr=${ok.stderr}`).toBe(0)
    expect(ok.stdout).toContain('[jobs] provisioned')
    expect(existsSync(db)).toBe(true)
    const check = openLedger(db)
    expect(check.listJobs().length).toBeGreaterThan(0) // 播种真落库
    check.close()
    expect(existsSync(writerLeasePath(db))).toBe(false)
  })
})
