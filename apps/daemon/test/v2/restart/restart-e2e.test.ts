/**
 * restart-e2e —— 受权重启在途 E2E（studio-dev-504 冻结验收口径 2）
 *
 * 场景：隔离实例（localfile 平台 + 慢执行体，睡眠 4s 后自然完成）→ 在途 running=1 →
 *   写 control/restart.request.json → daemon A 优雅重启（exit 0）→ 在途单 work_record=done
 *   （非 interrupted）→ 检查点/last-exit 可核验 → daemon B 启动自检四口径全过。
 *
 * 隔离纪律：临时根（os.tmpdir）＋独立 ledger/platform/AIWS；launcher 注入 apiStart=false
 * （HTTP 面板与重启链无关，避免测试环境端口占用）；不碰生产 daemon/台账。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createLocalPlatform } from '@studio-next/localplatform'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { writeJsonAtomic } from '../../../src/control/channel/file-io.ts'
import { controlFileOf } from '../../../src/control/channel/paths.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../../..')
const NODE = process.execPath
const roots: string[] = []
const children: ChildProcess[] = []

afterAll(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function query<T>(dbPath: string, sql: string): T[] {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

async function waitFor(fn: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`等待超时：${what}`)
}

describe('受权重启 E2E（隔离实例：在途不打断 + 四口径自检）', () => {
  it('在途 worker 自然完成 → work_record done（非 interrupted）→ exit 0 → 检查点/last-exit → 自检 pass', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-next-restart-e2e-'))
    roots.push(root)
    const platformDir = path.join(root, 'platform')
    const varDir = path.join(root, 'var')
    const aiws = path.join(root, 'aiws')
    mkdirSync(varDir, { recursive: true })
    mkdirSync(aiws, { recursive: true })

    const worker = path.join(root, 'slow-claude.mjs')
    writeFileSync(
      worker,
      `#!/usr/bin/env node\nimport { mkdirSync, writeFileSync } from 'node:fs'\nif (process.argv.includes('--version')) { console.log('2.1.300 (Claude Code)'); process.exit(0) }\nmkdirSync('deliverables', { recursive: true })\nwriteFileSync('REPORT.md', '# slow worker REPORT\\n')\nwriteFileSync('summary.json', '{"summary":"slow worker"}\\n')\nsetTimeout(() => { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 10, output_tokens: 5 } })) }, 4000)\n`,
      'utf8',
    )
    chmodSync(worker, 0o755)
    writeFileSync(path.join(root, 'agent.yaml'), ['executors:', '  claude:', '    default: true', `    cmd: ['${worker}']`].join('\n') + '\n', 'utf8')
    cpSync(path.join(REPO_ROOT, 'packages/core/models.example.yaml'), path.join(root, 'models.yaml'))

    const platform = createLocalPlatform(platformDir)
    const issue = await platform.issues.create({
      title: 's504 在途长跑单',
      type: 'task',
      level: 0,
      dept: 'departments/工程部',
      assignee: 'AGENT-1',
      initialState: '新单',
    })
    await platform.issues.setField(issue.id, 'lane', 'core')

    const now = Date.now()
    const authRef = 'sha256:s504-v2-e2e'
    const auth = {
      ref: authRef,
      approver: 'AGENT-1',
      approverRole: '工程部长',
      issuedAt: now - 60_000,
      expiresAt: now + 24 * 3600_000,
      scope: 'daemon-restart',
      text: '制作人 2026-11-03 令：s504 在途 E2E',
    }
    const configPath = path.join(root, 'daemon.yaml')
    writeFileSync(
      configPath,
      [
        `db: ${path.join(varDir, 'ledger.sqlite')}`,
        'platform: localfile',
        `platformDir: ${platformDir}`,
        'company: demo',
        `rootDir: ${varDir}`,
        `aiwsRoot: ${aiws}`,
        'tickMs: 200',
        'autoApprove: true',
        `agentYaml: ${path.join(root, 'agent.yaml')}`,
        `models: ${path.join(root, 'models.yaml')}`,
        'acceptance: "test -s REPORT.md && test -s summary.json"',
        'restartEnabled: true',
        `restartAuthorizations: '${JSON.stringify([auth])}'`,
        'restartDrainTimeoutMs: 20000',
        'restartSelfcheckTicks: 3',
        'restartSelfcheckTimeoutMs: 15000',
        'restartVersionAlignPolicy: off',
        'apiPort: 0',
      ].join('\n') + '\n',
      'utf8',
    )

    const launcher = path.join(root, 'launch.ts')
    writeFileSync(
      launcher,
      `import { runServe } from '${path.join(REPO_ROOT, 'apps/daemon/src/assembly/serve/run.ts')}'\n` +
        `const result = await runServe(process.argv[2] as string, { apiStart: false })\n` +
        `process.exitCode = result.stopReason === 'error' ? 2 : result.stopReason === 'restart-failed' ? 1 : 0\n`,
      'utf8',
    )
    const env = { ...process.env, STUDIO_GATEWAY_SECRET: 's504-v2-e2e-secret-material-0123456789' }
    const dbPath = path.join(varDir, 'ledger.sqlite')

    const start = (): { child: ChildProcess; out: string[]; exited: Promise<{ code: number | null; signal: string | null }> } => {
      const child = spawn(NODE, [launcher, configPath], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      const out: string[] = []
      child.stdout?.on('data', (d: Buffer) => out.push(d.toString()))
      child.stderr?.on('data', (d: Buffer) => out.push(d.toString()))
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
      return { child, out, exited }
    }

    const A = start()
    await waitFor(() => {
      try {
        const dispatched = query<{ n: number }>(dbPath, "SELECT count(*) AS n FROM events WHERE event='DISPATCH'")[0]?.n ?? 0
        const running = query<{ n: number }>(dbPath, "SELECT count(*) AS n FROM work_records WHERE status='running'")[0]?.n ?? 0
        return dispatched >= 1 && running === 1
      } catch {
        return false
      }
    }, 'A 派发且在途 running=1')
    // 模拟 CLI 写请求（生产写面=通用控制面通道 protocol.ts；本测试只走同一原子写原语）
    const requestId = makeUlid(Date.now())
    writeJsonAtomic(
      controlFileOf(varDir, 'restart.request.json'),
      {
        id: requestId,
        requestedAt: Date.now(),
        reason: '制作人令：s504 在途 E2E',
        authorizationRef: authRef,
        actor: { personId: 'AGENT-1', role: '工程部长', level: 2 },
        drainTimeoutMs: 20_000,
      },
      { mode: 0o600, tmpSuffix: requestId },
    )
    const exitA = await A.exited
    expect(exitA.code, A.out.join('')).toBe(0)

    const records = query<{ issue: string; status: string }>(dbPath, 'SELECT issue, status FROM work_records')
    expect(records).toEqual([{ issue: 'LOCAL-1', status: 'done' }])
    expect(query<{ n: number }>(dbPath, "SELECT count(*) AS n FROM work_records WHERE status='interrupted'")[0]?.n).toBe(0)

    const lastExit = JSON.parse(readFileSync(path.join(varDir, 'restart', 'last-exit.json'), 'utf8')) as {
      authorized: boolean
      exitClass: string
      checkpoint: { path: string }
    }
    expect(lastExit.authorized).toBe(true)
    expect(lastExit.exitClass).toBe('restart')
    const checkpoint = JSON.parse(readFileSync(lastExit.checkpoint.path, 'utf8')) as {
      inflightBefore: number
      interrupted: unknown[]
    }
    expect(checkpoint.inflightBefore).toBe(1)
    expect(checkpoint.interrupted).toEqual([])
    const events = query<{ note: string }>(dbPath, "SELECT note FROM events WHERE note LIKE 'SCHEMA_EVOLVE;RESTART;%'")
    expect(events.some((e) => e.note.includes('phase=started'))).toBe(true)
    expect(events.some((e) => e.note.includes('phase=done'))).toBe(true)

    // —— daemon B：同配置拉起，自检三拍内 pass ——
    const B = start()
    await waitFor(() => existsSync(path.join(varDir, 'restart')) && readdirSync(path.join(varDir, 'restart')).some((f) => f.startsWith('selfcheck-') && f.endsWith('.json')), '自检报告落盘')
    const file = readdirSync(path.join(varDir, 'restart')).find((f) => f.startsWith('selfcheck-') && f.endsWith('.json'))
    expect(file).toBeDefined()
    const report = JSON.parse(readFileSync(path.join(varDir, 'restart', file!), 'utf8')) as {
      result: string
      checks: Record<string, { pass: boolean }>
    }
    expect(report.result, JSON.stringify(report)).toBe('pass')
    expect(Object.values(report.checks).every((c) => c.pass)).toBe(true)
    B.child.kill('SIGTERM')
    const exitB = await B.exited
    expect(exitB.code).toBe(0)
  }, 90_000)
})
