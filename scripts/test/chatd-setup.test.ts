/**
 * chatd-setup.test —— task M4.5 chatd 生产 sidecar 运维件测试
 *（node:test；全部沙箱在 mkdtemp——零生产写入、零 host 路径断言、token 值永不比对打印）
 *
 * 覆盖（docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M5 前置运维面；
 *       runbook 聊天自研切换-2026-11-19.md §十一–§十四）：
 *   A) dry-run 零副作用：exit 0、不建 var/LaunchAgents、打印计划与 launchctl 命令、无 token
 *   B) apply 需显式确认：--apply 无 --i-understand → exit 2 且零副作用（remove 同判例）
 *   C) apply 落盘：var 0700、token 0600（64-hex）、plist 0600 且键值/env/KeepAlive 齐全，
 *      ProgramArguments=node main.ts；输出明示「不执行 launchctl」
 *   D) token 不覆盖：二次 apply token 逐字节不变；输出「已存在，不覆盖」
 *   E) remove：删 plist、token/var 保留、打印 bootout；remove 无确认 → exit 2
 *   F) 纯函数面：buildPlan 约定路径/label；renderPlist 占位符全替换（残留即抛）
 *   G) chatd TOKEN_FILE 供给（config M4.5 增量）：值 env 优先 / 文件读取修剪 /
 *      相对路径拒 / 文件缺失拒 / 空文件拒 / 占位符 token 拒
 *   H) health mock：NDJSON 假服务端 ok→exit 0；错 token→exit 1；socket 缺失→exit 1；
 *      应答挂起→超时 exit 1（--json 单行可解析）
 *   I) health 真实 chatd：spawn --memory + TOKEN_FILE env → health --token-file exit 0
 *      （M4.5 安装面 env 闭环：plist 四 env 之 TOKEN_FILE 实证可用）
 *   J) platform-backup.sh：bash -n 语法等价检查（无 shellcheck 环境的机械兜底）；
 *      --dry-run --chatd-db 计划行（缺失库标注 SKIP）；fake-docker 真跑（docker CLI shim
 *      仅喂 Taiga/Matrix 四调用形状）：chatd .backup→integrity→gzip 600→manifest→
 *      保留策略删过期 chatd-*；恢复副本可读出数据；缺库 SKIP 不报错。
 *      sqlite3 CLI 不在时 J 真跑分支 skip（dry-run/语法分支仍跑）。
 *   K) platform-backup.sh 无 Docker 环境（M5-2 第一刀，docs/plan/08 §一.1.B#7）：
 *      docker CLI 缺失（剥光 PATH）→ Taiga/Matrix/Matrix-config 段 SKIP
 *      （stdout/backup.log 明报 reason=docker-unavailable；SUMMARY docker.skipped）＋
 *      chatd 照常 backed＋manifest＋exit 0；docker info 失败（shim exit 1）→ 同上；
 *      --skip-docker 显式（docker 可用也跳过，reason=skip-docker-flag）；dry-run 明示
 *      docker=SKIP 计划行；docker 可用＋未显式跳过 → 原行为（J 面加强：三段产物齐）。
 *   L) platform-backup.sh core 事实源（M5-2 第二刀，docs/quality/backup-restore.md §7.3）：
 *      --core-company/env 合并去重 → 三面产物（core-platform tgz 相对结构/core-ledger
 *      .backup+integrity+gzip/core-company git tgz；全 600）＋manifest＋7 天保留策略删过期
 *      core-*；缺目录/缺文件=SKIP 不报错（SUMMARY core.backed/skipped）；相对路径拒；
 *      同一 run 同 slug 冲突（两个同名公司目录）exit 2；dry-run 计划行＋缺失标注。
 *
 * 运行：node --experimental-strip-types --test scripts/test/chatd-setup.test.ts
 */
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildPlan, CONVENTIONS, parseArgs, renderPlist, SetupUsageError } from '../ops/chatd-setup.mjs'
import { loadConfig, ChatdConfigError, ENV_KEYS } from '../../apps/workbench-chatd/src/config.ts'

const HERE = import.meta.dirname
const REPO = path.join(HERE, '..', '..')
const SETUP = path.join(HERE, '..', 'ops', 'chatd-setup.mjs')
const HEALTH = path.join(HERE, '..', 'ops', 'chatd-health.mjs')
const BACKUP = path.join(HERE, '..', 'ops', 'platform-backup.sh')
const CHATD_MAIN = path.join(REPO, 'apps', 'workbench-chatd', 'src', 'main.ts')

const workdirs: string[] = []
test.after(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  workdirs.push(dir)
  return dir
}

interface RunResult { status: number; stdout: string; stderr: string }
function runCli(cli: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      const status = err !== null && typeof err.code === 'number' ? err.code : err === null ? 0 : 1
      resolve({ status, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}
function runSh(script: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): RunResult {
  try {
    const stdout = execFileSync('/bin/bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}
const mode = (p: string): number => statSync(p).mode & 0o777

/** 沙箱环境：公司目录 + 隔离 HOME（LaunchAgents/Logs 全落 mkdtemp） */
function sandbox(company = 'acme'): { root: string; companyDir: string; home: string } {
  const root = tempDir('m45-setup-')
  const companyDir = path.join(root, company)
  const home = path.join(root, 'home')
  mkdirSync(companyDir, { recursive: true })
  return { root, companyDir, home }
}

/* ------------------------------------------------------------------ */
/* A/B/C/D/E 安装器 CLI                                                */
/* ------------------------------------------------------------------ */

test('A) dry-run 零副作用：打印计划/launchctl 命令，不落任何文件', async () => {
  const { companyDir, home, root } = sandbox()
  const r = await runCli(SETUP, ['--company-dir', companyDir, '--home', home])
  assert.equal(r.status, 0, `dry-run 应 exit 0：${r.stderr}`)
  assert.match(r.stdout, /dry-run（零副作用）/)
  assert.match(r.stdout, new RegExp(`${CONVENTIONS.labelPrefix}\\.acme\\.plist`))
  assert.match(r.stdout, /launchctl bootstrap gui\/\$\(id -u\)/)
  assert.match(r.stdout, /本脚本不执行 launchctl/)
  assert.match(r.stdout, /chatd-health\.mjs --socket/)
  // 零副作用：var/launchagents/log 全不存在
  assert.ok(!existsSync(path.join(companyDir, 'var')), 'dry-run 不得创建 var/')
  assert.ok(!existsSync(path.join(home, 'Library')), 'dry-run 不得创建 HOME/Library')
  assert.equal(existsSync(root), true)
})

test('B) apply/remove 无 --i-understand → exit 2 零副作用', async () => {
  const { companyDir, home } = sandbox()
  for (const modeFlag of ['--apply', '--remove']) {
    const r = await runCli(SETUP, ['--company-dir', companyDir, '--home', home, modeFlag])
    assert.equal(r.status, 2, `${modeFlag} 无确认应 exit 2`)
    assert.match(r.stderr, /--i-understand/)
    assert.ok(!existsSync(path.join(companyDir, 'var')), `${modeFlag} 无确认不得有副作用`)
    assert.ok(!existsSync(path.join(home, 'Library')), `${modeFlag} 无确认不得碰 HOME`)
  }
})

test('C) apply：var 0700 / token 0600 64-hex / plist 0600 键值齐全', async () => {
  const { companyDir, home } = sandbox()
  const r = await runCli(SETUP, ['--company-dir', companyDir, '--home', home, '--apply', '--i-understand'])
  assert.equal(r.status, 0, `apply 应 exit 0：${r.stderr}\n${r.stdout.slice(-500)}`)
  assert.match(r.stdout, /未 load、未启动/)

  const varDir = path.join(companyDir, 'var', 'workbench')
  assert.equal(mode(varDir), 0o700, 'var/workbench 应 0700')
  const tokenFile = path.join(varDir, CONVENTIONS.tokenFile)
  assert.equal(mode(tokenFile), 0o600, 'token 应 0600')
  assert.match(readFileSync(tokenFile, 'utf8').trim(), /^[0-9a-f]{64}$/, 'token=64 hex')
  assert.ok(!existsSync(path.join(varDir, CONVENTIONS.dbFile)), '本脚本不得创建 chat.db（chatd 首启自建）')
  assert.ok(!existsSync(path.join(varDir, CONVENTIONS.socketFile)), '本脚本不得创建 socket')

  const plistPath = path.join(home, 'Library', 'LaunchAgents', 'io.studionext.chatd.acme.plist')
  assert.equal(mode(plistPath), 0o600, 'plist 应 0600')
  const plist = readFileSync(plistPath, 'utf8')
  assert.match(plist, new RegExp(`<string>${CONVENTIONS.labelPrefix}\\.acme</string>`))
  assert.match(plist, /<string>--experimental-strip-types<\/string>/)
  assert.match(plist, new RegExp(`<string>${CHATD_MAIN.replace(/\//g, '\\/')}<\/string>`), 'ProgramArguments 指向 chatd main.ts')
  for (const [key, value] of [
    ['WORKBENCH_CHATD_SOCKET', path.join(varDir, 'chat.sock')],
    ['WORKBENCH_CHATD_DB', path.join(varDir, 'chat.db')],
    ['WORKBENCH_CHATD_TOKEN_FILE', tokenFile],
    ['WORKBENCH_CHATD_LOG', 'info'],
  ] as const) {
    assert.match(plist, new RegExp(`<key>${key}<\\/key>\\s*<string>${value.replace(/\//g, '\\/')}<\\/string>`), `env ${key} 应带约定值`)
  }
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/)
  assert.ok(!/__([A-Z_]+)__/.test(plist), 'plist 不得残留占位符')
  assert.ok(!readFileSync(tokenFile, 'utf8').includes('\n\n'), 'token 文件单值')
})

test('D) token 不覆盖：二次 apply 逐字节不变并明示', async () => {
  const { companyDir, home } = sandbox()
  const args = ['--company-dir', companyDir, '--home', home, '--apply', '--i-understand']
  assert.equal((await runCli(SETUP, args)).status, 0)
  const tokenFile = path.join(companyDir, 'var', 'workbench', CONVENTIONS.tokenFile)
  const first = readFileSync(tokenFile, 'utf8')
  const r = await runCli(SETUP, args)
  assert.equal(r.status, 0)
  assert.equal(readFileSync(tokenFile, 'utf8'), first, '二次 apply 不得覆盖 token')
  assert.match(r.stdout, /已存在，不覆盖/)
})

test('E) remove：删 plist/保留数据/打印 bootout；权限漂移修正为 0600', async () => {
  const { companyDir, home } = sandbox()
  const args = ['--company-dir', companyDir, '--home', home, '--apply', '--i-understand']
  await runCli(SETUP, args)
  const varDir = path.join(companyDir, 'var', 'workbench')
  const tokenFile = path.join(varDir, CONVENTIONS.tokenFile)
  const dbFile = path.join(varDir, 'chat.db')
  writeFileSync(dbFile, 'fake-sqlite-bytes') // 模拟 chatd 已初始化
  chmodSync(tokenFile, 0o644) // 模拟历史权限漂移
  const fix = await runCli(SETUP, args)
  assert.match(fix.stdout, /权限已修正为 0600/)
  assert.equal(mode(tokenFile), 0o600)

  const r = await runCli(SETUP, ['--company-dir', companyDir, '--home', home, '--remove', '--i-understand'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /launchctl bootout gui\/\$\(id -u\)/)
  assert.ok(!existsSync(path.join(home, 'Library', 'LaunchAgents', 'io.studionext.chatd.acme.plist')), 'remove 应删 plist')
  assert.ok(existsSync(tokenFile) && existsSync(dbFile) && existsSync(varDir), 'remove 必须保留 token/db/var（卸载不销毁证据）')
})

test('F) 纯函数：parseArgs/buildPlan/renderPlist 约定与防呆', () => {
  assert.throws(() => parseArgs([]), SetupUsageError)
  assert.throws(() => parseArgs(['--company-dir', 'relative/x']), SetupUsageError)
  // home is assembled at runtime from os.tmpdir()（不落主机路径字面量）；buildPlan 只做纯路径推导
  const home = path.join(tempDir('m45-plan-'), 'home')
  const plan = buildPlan({ companyDir: '/Companies/AcmeCorp', repo: '/deploy/tree', nodeBin: '/usr/bin/node', home })
  assert.equal(plan.slug, 'acmecorp', 'slug 兜底=公司目录名（小写化）')
  assert.equal(plan.label, 'io.studionext.chatd.acmecorp')
  assert.deepEqual(
    [plan.varDir, plan.dbPath, plan.socketPath, plan.tokenFile, plan.plistPath, plan.logOut],
    [
      '/Companies/AcmeCorp/var/workbench',
      '/Companies/AcmeCorp/var/workbench/chat.db',
      '/Companies/AcmeCorp/var/workbench/chat.sock',
      '/Companies/AcmeCorp/var/workbench/chatd.token',
      path.join(home, 'Library', 'LaunchAgents', 'io.studionext.chatd.acmecorp.plist'),
      path.join(home, 'Library', 'Logs', 'studio-next', 'acmecorp', 'chatd.out.log'),
    ],
  )
  // 显式 slug 覆盖 + 空 launchAgents/logDir 不得落到 cwd（空串≠未设）
  const plan2 = buildPlan({ companyDir: '/c/x', company: 'X-Corp', repo: '/r', nodeBin: '/n', home: '/h', launchAgents: '', logDir: '' })
  assert.equal(plan2.label, 'io.studionext.chatd.x-corp')
  assert.equal(plan2.plistPath, '/h/Library/LaunchAgents/io.studionext.chatd.x-corp.plist')
  assert.equal(plan2.logOut, '/h/Library/Logs/studio-next/x-corp/chatd.out.log')
  assert.throws(() => buildPlan({ companyDir: '/c/非法 名', repo: '/r', nodeBin: '/n', home: '/h' }), SetupUsageError, 'slug 非法须显式 --company')
  const plist = renderPlist(plan)
  assert.ok(!/__([A-Z_]+)__/.test(plist), 'renderPlist 不得残留占位符')
  assert.match(plist, /<string>\/deploy\/tree\/apps\/workbench-chatd\/src\/main\.ts<\/string>/)
})

/* ------------------------------------------------------------------ */
/* G) chatd config TOKEN_FILE 供给（M4.5 增量）                         */
/* ------------------------------------------------------------------ */

test('G) loadConfig TOKEN_FILE：值 env 优先/文件修剪/三项 fail-closed', () => {
  const root = tempDir('m45-tokf-')
  const tokenFile = path.join(root, 'chatd.token')
  writeFileSync(tokenFile, '  toks-from-file-64-hex-0000000000000000000000000000000000  \n')
  const base = { WORKBENCH_CHATD_SOCKET: '/tmp/s.sock', WORKBENCH_CHATD_DB: '/tmp/s.db' }
  // 文件供给：内容修剪；sqlite 模式
  const cfg = loadConfig({ ...base, [ENV_KEYS.tokenFile]: tokenFile })
  assert.equal(cfg.token, 'toks-from-file-64-hex-0000000000000000000000000000000000')
  assert.equal(cfg.storeMode, 'sqlite')
  // 值 env 优先
  const cfg2 = loadConfig({ ...base, [ENV_KEYS.tokenFile]: tokenFile, [ENV_KEYS.token]: 'env-wins' })
  assert.equal(cfg2.token, 'env-wins')
  // 相对路径拒
  assert.throws(() => loadConfig({ ...base, [ENV_KEYS.tokenFile]: 'rel/token' }), ChatdConfigError)
  // 文件缺失拒
  assert.throws(() => loadConfig({ ...base, [ENV_KEYS.tokenFile]: path.join(root, 'nope') }), ChatdConfigError)
  // 空文件拒
  const empty = path.join(root, 'empty.token')
  writeFileSync(empty, '   \n')
  assert.throws(() => loadConfig({ ...base, [ENV_KEYS.tokenFile]: empty }), ChatdConfigError)
  // 占位符值拒（模板未替换防呆延伸到文件面）
  const ph = path.join(root, 'ph.token')
  writeFileSync(ph, '__WORKBENCH_CHATD_TOKEN__')
  assert.throws(() => loadConfig({ ...base, [ENV_KEYS.tokenFile]: ph }), ChatdConfigError)
})

/* ------------------------------------------------------------------ */
/* H) health：mock NDJSON 服务端四路径                                  */
/* ------------------------------------------------------------------ */

interface MockServer { socketPath: string; token: string; close(): Promise<void>; behavior: 'ok' | 'bad-token' | 'silent' }

function startMock(behavior: MockServer['behavior']): Promise<MockServer> {
  const root = tempDir('m45-health-')
  const socketPath = path.join(root, 'chat.sock')
  const token = `mock-${randomBytes(8).toString('hex')}` // 运行时随机（值形不落字面量；仅 H 用例内比对）
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      socket.on('data', (chunk) => {
        if (behavior === 'silent') return // 收帧不答（超时路径）
        for (const raw of chunk.toString('utf8').split('\n')) {
          if (raw.trim() === '') continue
          const req = JSON.parse(raw) as { id: string; method: string; params: { token?: string } }
          if (behavior === 'bad-token' || req.params.token !== token) {
            socket.write(`${JSON.stringify({ id: req.id, ok: false, error: { code: 'WB_INVALID_ARGUMENT', message: 'unauthenticated: token invalid', retryable: false } })}\n`)
            continue
          }
          const result = req.method === 'health'
            ? { ok: true, protocol: 'workbench-transport/v1', server: 'workbench-chatd/0.1.0+mock', startedAt: 1 }
            : [{ roomId: 'r1', kind: 'broadcast', name: 'general', memberIds: ['a'], headRoomSeq: 0 }]
          socket.write(`${JSON.stringify({ id: req.id, ok: true, result })}\n`)
        }
      })
    })
    server.listen(socketPath, () => resolve({ socketPath, token, behavior, close: () => new Promise<void>((res) => server.close(() => res())) }))
  })
}

test('H) health：ok→0 / 错 token→1 / socket 缺失→1 / 挂起→超时 1 / json 可解析', async () => {
  const mock = await startMock('ok')
  try {
    const ok = await runCli(HEALTH, ['--socket', mock.socketPath, '--token', mock.token])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /HEALTHY/)
    const js = await runCli(HEALTH, ['--socket', mock.socketPath, '--token', mock.token, '--json'])
    assert.equal(js.status, 0)
    const parsed = JSON.parse(js.stdout.trim().split('\n').pop() as string) as Record<string, unknown>
    assert.equal(parsed['ok'], true)
    assert.equal(parsed['rooms'], 1)
    assert.equal(parsed['protocol'], 'workbench-transport/v1')

    const bad = await runCli(HEALTH, ['--socket', mock.socketPath, '--token', 'wrong'])
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /UNHEALTHY/)

    const noSock = await runCli(HEALTH, ['--socket', path.join(path.dirname(mock.socketPath), 'nope.sock'), '--token', mock.token])
    assert.equal(noSock.status, 1)
    assert.match(noSock.stdout, /socket 文件不存在|ENOENT/)
    assert.equal((await runCli(HEALTH, ['--socket', mock.socketPath])).status, 2, '缺 token 面应 exit 2')
    assert.equal((await runCli(HEALTH, ['--company-dir', '/x', '--socket', '/y'])).status, 2, '互斥参数 exit 2')
  } finally {
    await mock.close()
  }
  const silent = await startMock('silent')
  try {
    const t0 = Date.now()
    const r = await runCli(HEALTH, ['--socket', silent.socketPath, '--token', silent.token, '--timeout-ms', '600'])
    const elapsed = Date.now() - t0
    assert.equal(r.status, 1, '挂起服务端应超时 exit 1')
    assert.match(r.stdout, /超时/)
    assert.ok(elapsed < 2500, `超时应受预算约束（实测 ${String(elapsed)}ms）`)
  } finally {
    await silent.close()
  }
})

/* ------------------------------------------------------------------ */
/* I) health × 真实 chatd（TOKEN_FILE env 闭环）                        */
/* ------------------------------------------------------------------ */

test('I) 真实 chatd --memory + TOKEN_FILE：health --token-file exit 0', async () => {
  const root = tempDir('m45-real-')
  const tokenFile = path.join(root, 'chatd.token')
  writeFileSync(tokenFile, 'real-42'.padEnd(64, '0'))
  const socketPath = path.join(root, 'chat.sock')
  const child = spawn(process.execPath, ['--experimental-strip-types', CHATD_MAIN, '--memory'], {
    env: {
      ...process.env,
      WORKBENCH_CHATD_SOCKET: socketPath,
      WORKBENCH_CHATD_TOKEN_FILE: tokenFile, // 不设 WORKBENCH_CHATD_TOKEN——实证文件供给面
      WORKBENCH_CHATD_LOG: 'info', // ready 事件在 info 级（stderr 单行 JSON，看护消费）
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (c) => { stderr += String(c) })
  try {
    let ready = false
    for (let i = 0; i < 100 && !ready; i += 1) {
      ready = stderr.includes('"event":"ready"')
      if (!ready) await new Promise((res) => setTimeout(res, 100))
    }
    assert.ok(ready, `chatd 应就绪（stderr 尾部：${stderr.slice(-300)}）`)
    const r = await runCli(HEALTH, ['--socket', socketPath, '--token-file', tokenFile])
    assert.equal(r.status, 0, `health 对真实 chatd 应 exit 0：${r.stdout}\n${stderr.slice(-300)}`)
    assert.match(r.stdout, /HEALTHY/)
  } finally {
    child.kill('SIGTERM')
    await new Promise((res) => { child.on('exit', res); setTimeout(res, 3000).unref?.() })
  }
})

/* ------------------------------------------------------------------ */
/* J) platform-backup.sh：语法 + dry-run + fake-docker 真跑             */
/* ------------------------------------------------------------------ */

function makeFakeDocker(root: string): { binDir: string; dataDir: string } {
  const binDir = path.join(root, 'shim')
  const dataDir = path.join(root, 'fakedata')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  for (const f of ['homeserver.yaml', 'localhost.signing.key', 'localhost.log.config']) writeFileSync(path.join(dataDir, f), 'fake\n')
  writeFileSync(path.join(binDir, 'docker'), `#!/bin/bash
# fake docker（测试 shim）：仅 platform-backup.sh 用到的调用形状（M5-2 起含 info 探测）
case "\${1:-}" in
  info) exit 0 ;;
  inspect) echo true ;;
  exec)
    case "\$*" in
      *pg_dumpall*) echo "-- fake taiga pg_dumpall (test)" ;;
      *"rm -f"*) exit 0 ;;
      *python3*)
        out=""; prev=""
        for a in "\$@"; do
          if [ "\$prev" = "-" ]; then out="\$a"; fi
          prev="\$a"
        done
        if [ -n "\$out" ]; then : > "\$out"; fi
        ;;
      *"tar -czf"*) tar -czf - -C "\$FAKE_DOCKER_DATA" homeserver.yaml localhost.signing.key localhost.log.config ;;
      *) echo "fake-docker: unhandled exec: \$*" >&2; exit 9 ;;
    esac ;;
  cp) cp "\${2#*:}" "\$3" ;;
  *) echo "fake-docker: unhandled: \$*" >&2; exit 9 ;;
esac
`)
  chmodSync(path.join(binDir, 'docker'), 0o755)
  return { binDir, dataDir }
}

/** bash -n 语法等价检查（环境无 shellcheck 的机械兜底）；返回 bash 退出码 */
function shSyntax(script: string): number {
  try {
    execFileSync('/bin/bash', ['-n', script], { stdio: 'pipe' })
    return 0
  } catch (err) {
    const status = (err as { status?: number }).status
    return typeof status === 'number' ? status : 1
  }
}

/** chatd 真跑面需要宿主 sqlite3 CLI；不在时 J/K 真跑分支 skip */
const sqlite3Available = (() => {
  try {
    execFileSync('/bin/bash', ['-c', 'command -v sqlite3'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('J) platform-backup：bash -n + dry-run 计划 + fake-docker 真跑（chatd .backup/SKIP/保留策略）', async (t) => {
  assert.equal(shSyntax(BACKUP), 0, 'bash -n 语法等价检查')
  const badSh = path.join(tempDir('m45-badsh-'), 'bad.sh')
  writeFileSync(badSh, 'if [ -eq 1\n') // 故意语法错——哨兵：-n 面必须真能红
  assert.notEqual(shSyntax(badSh), 0, 'bash -n 对坏脚本必须非零（检查面有效）')

  const root = tempDir('m45-bk-')
  const companyDir = path.join(root, 'acme')
  const dbPath = path.join(companyDir, 'var', 'workbench', 'chat.db')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  new DatabaseSync(dbPath).exec('CREATE TABLE t(x); INSERT INTO t VALUES (42);')
  const missing = path.join(root, 'beta', 'var', 'workbench', 'chat.db')
  const backupDir = path.join(root, 'backups')

  // dry-run：计划行 + 缺失标注；零落盘
  const dry = runSh(BACKUP, ['--dry-run', '--backup-dir', backupDir, '--chatd-db', dbPath, '--chatd-db', missing])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /chatd db=.*acme.*var\/workbench\/chat\.db slug=acme/)
  assert.match(dry.stdout, /chatd-acme-\d{8}-\d{6}\.db\.gz/)
  assert.match(dry.stdout, /缺失→SKIP/)
  assert.ok(!existsSync(backupDir), 'dry-run 不得创建备份目录')
  // 用法面：相对路径拒（exit 2）
  assert.equal(runSh(BACKUP, ['--dry-run', '--chatd-db', 'rel/chat.db']).status, 2)

  const hasSqlite3 = sqlite3Available
  if (!hasSqlite3) return t.skip('sqlite3 CLI 不在 PATH——真跑分支 skip（dry-run/语法分支已过）')

  // 真跑（fake docker 只喂 Taiga/Matrix 形状；chatd 面走真 sqlite3）
  const { binDir, dataDir } = makeFakeDocker(root)
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(path.join(backupDir, 'chatd-oldco-20260101-000000.db.gz'), 'old\n')
  writeFileSync(path.join(backupDir, '.platform-backup-manifest'), '0|chatd-oldco-20260101-000000.db.gz\n')
  const r = runSh(BACKUP, ['--backup-dir', backupDir, '--chatd-db', dbPath, '--chatd-db', dbPath, '--chatd-db', missing], {
    PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
    FAKE_DOCKER_DATA: dataDir,
  })
  assert.equal(r.status, 0, `真跑应 exit 0：${r.stderr}\n${r.stdout}`)
  const summary = JSON.parse(r.stdout.trim().split('\n').pop() as string) as {
    taiga?: { file: string; size: number; lines: number }
    matrix?: { file: string; size: number }
    matrixConfig?: { file: string; size: number }
    chatd?: { backed: number; skipped: number }
    retentionDeleted: number
  }
  // docker 可用（fake info→0）→ 原行为：Taiga/Matrix/Matrix-config 三段照产（M5-2 判例）
  assert.match(summary['taiga']?.['file'] ?? '', /^taiga-pg-\d{8}-\d{6}\.sql\.gz$/, 'docker 可用时 SUMMARY 应含 taiga 产物')
  assert.match(summary['matrixConfig']?.['file'] ?? '', /^matrix-config-\d{8}-\d{6}\.tgz$/, 'docker 可用时 SUMMARY 应含 matrix-config 产物')
  assert.ok(existsSync(path.join(backupDir, summary['taiga']?.['file'] ?? 'x')), 'taiga 产物应落盘')
  assert.deepEqual(summary['chatd'], { backed: 1, skipped: 1 }, '去重后 1 备 1 skip（重复 --chatd-db 不双备）')
  assert.ok(!existsSync(path.join(backupDir, 'chatd-oldco-20260101-000000.db.gz')), '过期 chatd-* 应被保留策略删除')
  const gz = (r.stdout.match(/chatd-acme-\d{8}-\d{6}\.db\.gz/g) as string[])[0] ?? ''
  assert.notEqual(gz, '', `应有 chatd 产物：${r.stdout}`)
  const gzPath = path.join(backupDir, gz)
  assert.equal(mode(gzPath), 0o600, 'chatd 备份应 600')
  const restored = path.join(root, 'restore.db')
  execFileSync('/bin/bash', ['-c', `gzip -dc ${JSON.stringify(gzPath)} > ${JSON.stringify(restored)} && sqlite3 ${JSON.stringify(restored)} "SELECT x FROM t;" > ${JSON.stringify(path.join(root, 'out.txt'))}`])
  assert.equal(readFileSync(path.join(root, 'out.txt'), 'utf8').trim(), '42', '恢复副本可读出原数据（在线 .backup 语义有效）')
  const manifest = readFileSync(path.join(backupDir, '.platform-backup-manifest'), 'utf8')
  assert.match(manifest, new RegExp(`\\|${gz}`), 'manifest 应记 chatd 产物（同保留策略面）')
})

/* ------------------------------------------------------------------ */
/* K) platform-backup.sh：无 Docker 环境（M5-2 第一刀）                 */
/* ------------------------------------------------------------------ */

interface BackupSummary {
  ok?: boolean
  docker?: { skipped?: boolean; reason?: string; sections?: string[] }
  chatd?: { backed?: number; skipped?: number }
  core?: { backed?: number; skipped?: number }
  retentionDeleted?: number
}

/** 取脚本 stdout 末行 SUMMARY JSON */
const lastSummary = (stdout: string): BackupSummary =>
  JSON.parse(stdout.trim().split('\n').pop() as string) as BackupSummary

test('K) platform-backup 无 Docker：CLI 缺失/info 失败 → SKIP+chatd 照常；--skip-docker 显式；dry-run 计划', async (t) => {
  if (!sqlite3Available) return t.skip('sqlite3 CLI 不在 PATH——真跑分支 skip')

  const root = tempDir('m52-bk-')
  const dbPath = path.join(root, 'acme', 'var', 'workbench', 'chat.db')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  new DatabaseSync(dbPath).exec('CREATE TABLE t(x); INSERT INTO t VALUES (7);')

  // 剥光 PATH（无 docker；date/gzip/sqlite3/stat/tar 均 /usr/bin:/bin 可用——macOS/Linux 皆然）
  const STRIPPED = '/usr/bin:/bin'
  const dockerLeaked = (() => {
    try {
      execFileSync('/bin/bash', ['-c', 'command -v docker'], { stdio: 'ignore', env: { PATH: STRIPPED } })
      return true
    } catch {
      return false
    }
  })()

  // —— K0 dry-run（docker 缺失）：计划行明示 docker=SKIP；零落盘 ——
  const bk0 = path.join(root, 'bk-dry')
  const dry = runSh(BACKUP, ['--dry-run', '--backup-dir', bk0, '--chatd-db', dbPath], { PATH: STRIPPED })
  assert.equal(dry.status, 0, dry.stderr)
  if (!dockerLeaked) {
    assert.match(dry.stdout, /docker=SKIP reason=docker-unavailable/, 'dry-run 应明示 docker=SKIP（自动探测）')
    assert.ok(!dry.stdout.includes('docker exec'), '不可用时 dry-run 不得再列 docker exec 命令')
  }
  assert.ok(!existsSync(bk0), 'dry-run 不得创建备份目录')

  // —— K1 真跑：docker CLI 缺失 → 三段 SKIP（reason=docker-unavailable）＋chatd backed＋exit 0 ——
  if (dockerLeaked) {
    t.diagnostic('docker 在 /usr/bin:/bin 可见——K1（CLI 缺失面）本机无法隔离；K2（info 失败面）覆盖同一探测分支')
  } else {
    const bk1 = path.join(root, 'bk-nocli')
    const r1 = runSh(BACKUP, ['--backup-dir', bk1, '--chatd-db', dbPath], { PATH: STRIPPED })
    assert.equal(r1.status, 0, `docker CLI 缺失应 exit 0（不算失败）：${r1.stderr}\n${r1.stdout}`)
    for (const sec of ['taiga', 'matrix', 'matrix-config']) {
      assert.match(r1.stdout, new RegExp(`SKIP ${sec} reason=docker-unavailable`), `${sec} 段应明报 SKIP`)
    }
    const s1 = lastSummary(r1.stdout)
    assert.equal(s1['ok'], true)
    assert.deepEqual(s1['docker'], { skipped: true, reason: 'docker-unavailable', sections: ['taiga', 'matrix', 'matrix-config'] }, 'SUMMARY 应记 docker skipped（M5-2 口径）')
    assert.deepEqual(s1['chatd'], { backed: 1, skipped: 0 }, 'chatd 段照常备份')
    const files1 = readdirSync(bk1)
    assert.ok(files1.some((f) => /^chatd-acme-\d{8}-\d{6}\.db\.gz$/.test(f)), `应有 chatd 产物：${files1.join(',')}`)
    assert.ok(!files1.some((f) => f.startsWith('taiga-pg-') || f.startsWith('matrix-')), '不得产 Taiga/Matrix 文件')
    assert.match(readFileSync(path.join(bk1, 'backup.log'), 'utf8'), /SKIP taiga reason=docker-unavailable/, 'backup.log 应明报 reason')
    assert.match(readFileSync(path.join(bk1, '.platform-backup-manifest'), 'utf8'), /chatd-acme-\d{8}-\d{6}\.db\.gz/, 'manifest 应记 chatd 产物（保留策略面照旧）')
  }

  // —— K2 真跑：docker CLI 在但 docker info 失败 → 同一 SKIP 语义 ——
  const failDir = path.join(root, 'shim-info-fail')
  mkdirSync(failDir, { recursive: true })
  writeFileSync(path.join(failDir, 'docker'), '#!/bin/bash\ncase "${1:-}" in info) exit 1 ;; *) echo "unexpected-docker-call: $*" >&2; exit 9 ;; esac\n')
  chmodSync(path.join(failDir, 'docker'), 0o755)
  const bk2 = path.join(root, 'bk-infofail')
  const r2 = runSh(BACKUP, ['--backup-dir', bk2, '--chatd-db', dbPath], { PATH: `${failDir}:${STRIPPED}` })
  assert.equal(r2.status, 0, `docker info 失败应 exit 0：${r2.stderr}\n${r2.stdout}`)
  assert.ok(!r2.stderr.includes('unexpected-docker-call'), '不可用后不得再调用 docker（exec/inspect 均不该发生）')
  const s2 = lastSummary(r2.stdout)
  assert.deepEqual(s2['docker'], { skipped: true, reason: 'docker-unavailable', sections: ['taiga', 'matrix', 'matrix-config'] })
  assert.deepEqual(s2['chatd'], { backed: 1, skipped: 0 })
  assert.ok(readdirSync(bk2).some((f) => /^chatd-acme-\d{8}-\d{6}\.db\.gz$/.test(f)), 'chatd 照常落产物')

  // —— K3 真跑：--skip-docker 显式（docker 可用也跳过；不触发 docker 调用） ——
  const { binDir } = makeFakeDocker(root)
  const bk3 = path.join(root, 'bk-flag')
  const r3 = runSh(BACKUP, ['--skip-docker', '--backup-dir', bk3, '--chatd-db', dbPath], {
    PATH: `${binDir}:${STRIPPED}`,
    FAKE_DOCKER_DATA: path.join(root, 'fakedata'),
  })
  assert.equal(r3.status, 0, `--skip-docker 应 exit 0：${r3.stderr}\n${r3.stdout}`)
  for (const sec of ['taiga', 'matrix', 'matrix-config']) {
    assert.match(r3.stdout, new RegExp(`SKIP ${sec} reason=skip-docker-flag`), `显式跳过应明报 ${sec} SKIP`)
  }
  const s3 = lastSummary(r3.stdout)
  assert.equal(s3['docker']?.['reason'], 'skip-docker-flag', '显式标志的 reason 应区分于自动探测')
  assert.deepEqual(s3['chatd'], { backed: 1, skipped: 0 })
  const files3 = readdirSync(bk3)
  assert.ok(!files3.some((f) => f.startsWith('taiga-pg-') || f.startsWith('matrix-')), '显式跳过不得产 Docker 面产物')

  // —— K4 dry-run --skip-docker（docker 可用）：计划行 reason=skip-docker-flag ——
  const dryFlag = runSh(BACKUP, ['--dry-run', '--skip-docker', '--backup-dir', path.join(root, 'bk-dry2'), '--chatd-db', dbPath], {
    PATH: `${binDir}:${STRIPPED}`,
    FAKE_DOCKER_DATA: path.join(root, 'fakedata'),
  })
  assert.equal(dryFlag.status, 0, dryFlag.stderr)
  assert.match(dryFlag.stdout, /docker=SKIP reason=skip-docker-flag/)

  // —— K5 dry-run 默认（docker 可用）：计划行保持原版 docker exec 面 ——
  const dryRun = runSh(BACKUP, ['--dry-run', '--backup-dir', path.join(root, 'bk-dry3'), '--chatd-db', dbPath], {
    PATH: `${binDir}:${STRIPPED}`,
    FAKE_DOCKER_DATA: path.join(root, 'fakedata'),
  })
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.match(dryRun.stdout, /docker exec taiga-docker-taiga-db-1 pg_dumpall/, 'docker 可用时 dry-run 应列原版命令')
  assert.ok(!dryRun.stdout.includes('docker=SKIP'), '可用时 dry-run 不得出现 SKIP 行')
})

/* ------------------------------------------------------------------ */
/* L) platform-backup.sh：core 事实源（M5-2 第二刀）                    */
/* ------------------------------------------------------------------ */

test('L) platform-backup core：dry-run 计划/路径校验/同 slug 冲突/env 合并去重/三面产物/manifest/retention/skip', async (t) => {
  if (!sqlite3Available) return t.skip('sqlite3 CLI 不在 PATH——真跑分支 skip')

  const root = tempDir('m52-core-')
  // 公司 acme：三面齐备（platform jsonl 树 / 台账 / 公司 git 目录）
  const acme = path.join(root, 'acme')
  mkdirSync(path.join(acme, 'platform', 'rooms'), { recursive: true })
  writeFileSync(path.join(acme, 'platform', 'events.jsonl'), '{"seq":1}\n')
  writeFileSync(path.join(acme, 'platform', 'rooms', 'r1.jsonl'), '{"seq":2}\n')
  new DatabaseSync(path.join(acme, 'ledger.sqlite')).exec('CREATE TABLE ledger_t(x); INSERT INTO ledger_t VALUES (99);')
  mkdirSync(path.join(acme, 'company', '.git', 'refs'), { recursive: true })
  writeFileSync(path.join(acme, 'company', '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(path.join(acme, 'company', 'AGENTS.md'), '# acme\n')
  // 公司 beta：仅台账（platform/company 缺 → 两面 SKIP）
  const beta = path.join(root, 'beta')
  mkdirSync(beta, { recursive: true })
  new DatabaseSync(path.join(beta, 'ledger.sqlite')).exec('CREATE TABLE b(x); INSERT INTO b VALUES (1);')

  // —— L0 dry-run：core 计划行＋缺失标注；零落盘 ——
  const bkDry = path.join(root, 'bk-dry')
  const dry = runSh(BACKUP, ['--dry-run', '--skip-docker', '--backup-dir', bkDry, '--core-company', acme, '--core-company', beta])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /core company=\S*\/acme slug=acme/, 'dry-run 应列 core 公司计划行')
  assert.match(dry.stdout, /core-platform-acme-\d{8}-\d{6}\.tgz/)
  assert.match(dry.stdout, /core-ledger-acme-\d{8}-\d{6}\.db\.gz/)
  assert.match(dry.stdout, /core-company-acme-\d{8}-\d{6}\.tgz/)
  assert.match(dry.stdout, /core-ledger-beta-\d{8}-\d{6}\.db\.gz/)
  assert.ok((dry.stdout.match(/缺失→SKIP/g) ?? []).length >= 2, `beta 的 platform/company 两面应标注缺失→SKIP：${dry.stdout}`)
  assert.ok(!existsSync(bkDry), 'dry-run 不得创建备份目录')

  // —— L1 用法面：相对路径拒 / 空值拒（exit 2） ——
  assert.equal(runSh(BACKUP, ['--dry-run', '--core-company', 'rel/company']).status, 2, '--core-company 相对路径应 exit 2')
  assert.equal(runSh(BACKUP, ['--dry-run', '--core-company', '']).status, 2, '--core-company 空值应 exit 2')

  // —— L2 同 slug 冲突：两个不同目录同名 → exit 2 且零落盘（绝不静默覆盖） ——
  const dup1 = path.join(root, 'dup1', 'acme')
  const dup2 = path.join(root, 'dup2', 'acme')
  mkdirSync(dup1, { recursive: true })
  mkdirSync(dup2, { recursive: true })
  const bkDup = path.join(root, 'bk-dup')
  const confl = runSh(BACKUP, ['--dry-run', '--backup-dir', bkDup, '--core-company', dup1, '--core-company', dup2])
  assert.equal(confl.status, 2, '同 slug 冲突应 exit 2')
  assert.match(confl.stderr, /同 slug 冲突/)
  assert.ok(!existsSync(bkDup), '冲突退出不得创建备份目录')

  // —— L3 真跑：--skip-docker ＋ env/flag 合并去重（acme 双份喂入）→ 三面产物＋manifest＋retention ——
  const backupDir = path.join(root, 'bk-core')
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(path.join(backupDir, 'core-platform-oldco-20260101-000000.tgz'), 'old\n')
  writeFileSync(path.join(backupDir, '.platform-backup-manifest'), '0|core-platform-oldco-20260101-000000.tgz\n')
  const r = runSh(BACKUP, ['--skip-docker', '--backup-dir', backupDir, '--core-company', beta, '--core-company', acme], {
    PLATFORM_BACKUP_CORE_COMPANIES: acme, // 与 flag 重复 → 去重后仍只备一次
  })
  assert.equal(r.status, 0, `core 真跑应 exit 0：${r.stderr}\n${r.stdout}`)
  const s = lastSummary(r.stdout)
  assert.equal(s['ok'], true)
  assert.deepEqual(s['docker'], { skipped: true, reason: 'skip-docker-flag', sections: ['taiga', 'matrix', 'matrix-config'] })
  assert.deepEqual(s['core'], { backed: 4, skipped: 2 }, 'acme 三面＋beta 一面 backed；beta platform/company SKIP')
  assert.deepEqual(s['chatd'], { backed: 0, skipped: 0 }, '未给 chatd 面时计数为零')
  for (const sec of ['core-platform', 'core-company']) {
    assert.match(r.stdout, new RegExp(`SKIP ${sec} .*beta.*（缺失）`), `${sec} 缺失应明报 SKIP（beta）`)
  }
  assert.match(r.stdout, /OK core-ledger slug=beta/, 'beta 的 ledger 存在应照常备份')

  const files = readdirSync(backupDir)
  const pick = (prefix: string): string => files.find((f) => f.startsWith(prefix)) ?? ''
  const platTgz = pick('core-platform-acme-')
  const ledGz = pick('core-ledger-acme-')
  const comTgz = pick('core-company-acme-')
  const betaGz = pick('core-ledger-beta-')
  for (const [name, f] of [['platform', platTgz], ['ledger', ledGz], ['company', comTgz], ['beta-ledger', betaGz]] as const) {
    assert.match(f, new RegExp(`^core-.*-\\d{8}-\\d{6}\\.(tgz|db\\.gz)$`), `应有 ${name} 产物：${files.join(',')}`)
    assert.equal(mode(path.join(backupDir, f)), 0o600, `${name} 产物应 600`)
  }

  const manifest = readFileSync(path.join(backupDir, '.platform-backup-manifest'), 'utf8')
  for (const f of [platTgz, ledGz, comTgz, betaGz]) assert.match(manifest, new RegExp(`\\|${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `manifest 应记 ${f}`)
  assert.ok(!existsSync(path.join(backupDir, 'core-platform-oldco-20260101-000000.tgz')), '过期 core-* 应被保留策略删除')
  assert.ok(!manifest.includes('oldco'), '删除后 manifest 不写回该条')

  // —— L4 恢复语义：platform tgz 保留相对结构；ledger 副本可读出数据；company tgz 含 git 目录 ——
  const platList = execFileSync('/bin/bash', ['-c', `tar -tzf ${JSON.stringify(path.join(backupDir, platTgz))}`], { encoding: 'utf8' })
  assert.match(platList, /^platform\//, 'platform tgz 应以 platform/ 开头（保留相对结构）')
  assert.match(platList, /platform\/events\.jsonl/)
  assert.match(platList, /platform\/rooms\/r1\.jsonl/)
  const restored = path.join(root, 'ledger-restore.db')
  const ledOut = path.join(root, 'led.txt')
  execFileSync('/bin/bash', ['-c', `gzip -dc ${JSON.stringify(path.join(backupDir, ledGz))} > ${JSON.stringify(restored)} && sqlite3 ${JSON.stringify(restored)} "SELECT x FROM ledger_t;" > ${JSON.stringify(ledOut)}`])
  assert.equal(readFileSync(ledOut, 'utf8').trim(), '99', 'ledger 备份副本可读出原数据（在线 .backup 语义有效）')
  const comList = execFileSync('/bin/bash', ['-c', `tar -tzf ${JSON.stringify(path.join(backupDir, comTgz))}`], { encoding: 'utf8' })
  assert.match(comList, /^company\//, 'company tgz 应以 company/ 开头')
  assert.match(comList, /company\/\.git\/HEAD/, 'company tgz 应含 git 目录')
  assert.match(comList, /company\/AGENTS\.md/)
})
