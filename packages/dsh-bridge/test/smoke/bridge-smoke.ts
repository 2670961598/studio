/**
 * studio-next-bridge 真机冒烟脚本（套外手动跑，不进 vitest、不进门禁 include——tsconfig 只含 src/test）。
 *
 * 用法（真机：dsh 0.2.1-rc.5 + deepseek 凭据已就位于 ~/.dsh/.env 的 DEEPSEEK_API_KEY——
 * .env 是实例启动时加载，本脚本零接触凭据值）：
 *   node packages/dsh-bridge/test/smoke/bridge-smoke.ts
 * 可覆盖：DSH_BIN（缺省 /opt/homebrew/bin/dsh）
 *
 * 判据（制作人 2026-10-19 批准三件套之一的端到端验收）：临时 web 实例
 * （--profile web --port 13899 --no-open）+ --patch overlay 挂本插件 + 注入指令文件
 * （标记串只存在于注入文件、不存在于任务文本与 RPC 字段——判据独立性）→ 模型答复遵循
 * 注入指令（会话日志终答含标记串）=「AGENTS.md 注入走 dsh 插件」通道端到端实证。
 *
 * RPC 形态（docs/34-§3.3 真机实录）：GET /?token= 换 cookie（303 + Set-Cookie）→
 * POST /api/<service>/<method>，信封 {type:'client-request',rpcId,method,payload:{args:{request:{…}}}}；
 * 会话面 session/create（cwd+sessionId）/ session/prompt（mode:queue）/ 读回走
 * session/projections（拿 asOfSeq 快照游标）+ session/page（address{kind:'session'}，
 * throughSeq=字面日志切点——-1 是空页不是「最新」，装机源码 paginate 核实）。
 *
 * 副作用纪律：13800 常驻宿主不碰；docker 三栈不碰；临时 web 进程 SIGTERM→SIGKILL 杀净；
 * 临时目录删除；~/.dsh/sessions 下本冒烟 cwd 的会话目录 best-effort 清理（只删名字含
 * dsh-bridge-smoke 者）；凭据零落盘零打印（诊断只回传 dsh 自身输出，dsh 不打印密钥值）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const DSH_BIN = process.env['DSH_BIN'] ?? '/opt/homebrew/bin/dsh'
const PORT = 13_899
const BASE = `http://127.0.0.1:${String(PORT)}`
const SESSION_ID = 'studio-bridge-smoke'
const OVERLAY = join(dirname(fileURLToPath(import.meta.url)), 'cordis.overlay.yml')
const DSH_ENV_FILE = join(homedir(), '.dsh', '.env')

function ok(label: string, detail: string): void {
  console.log(`[OK] ${label} —— ${detail}`)
}

function fail(label: string, detail: string): never {
  throw new Error(`[${label}] ${detail}`)
}

let rpcSeq = 0
async function rpc<T>(cookie: string, method: string, request: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `smoke-${String(++rpcSeq)}`,
      method,
      payload: { args: { request } },
    }),
  })
  if (!res.ok) fail(method, `HTTP ${String(res.status)}`)
  const body = (await res.json()) as {
    type?: string
    result?: { ok?: boolean; value?: T }
  }
  if (body.type === 'server-response' && body.result?.ok === true) return body.result.value as T
  fail(method, `result=${JSON.stringify(body.result).slice(0, 400)}`)
}

/** 软杀→宽限→硬杀，保证返回时进程已退（对已退进程为 no-op） */
async function stopProc(proc: ChildProcess, exited: () => boolean, graceMs: number): Promise<void> {
  if (exited()) return
  const died = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  proc.kill('SIGTERM')
  const escalade = setTimeout(() => proc.kill('SIGKILL'), graceMs)
  await Promise.race([died, new Promise((r) => setTimeout(r, graceMs + 2_000))])
  clearTimeout(escalade)
  if (!exited()) proc.kill('SIGKILL')
}

async function main(): Promise<void> {
  // —— 前置自查（凭据只验存在性，不读值不打印值——凭据零落盘纪律）——
  if (!existsSync(DSH_BIN)) fail('preflight', `dsh 不在 ${DSH_BIN}（可用 DSH_BIN 覆盖）`)
  if (!existsSync(OVERLAY)) fail('preflight', `overlay 缺失：${OVERLAY}`)
  const envText = existsSync(DSH_ENV_FILE) ? readFileSync(DSH_ENV_FILE, 'utf8') : ''
  if (!/^\s*DEEPSEEK_API_KEY=\S/m.test(envText)) {
    fail('preflight', `${DSH_ENV_FILE} 无 DEEPSEEK_API_KEY 条目（真机冒烟需 deepseek 凭据）`)
  }
  ok('preflight', `dsh=${DSH_BIN}；overlay 与凭据在位（值不读）`)

  // —— 注入指令文件（标记串只在此处——判据独立性）——
  const marker = `STUDIO-NEXT-BRIDGE-SMOKE-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-bridge-smoke-'))
  const instructionsPath = join(tmp, 'instructions.md')
  const cwd = join(tmp, 'workspace')
  writeFileSync(
    instructionsPath,
    `# Studio Next 注入测试（生成物勿手改）\n\n你是 Studio Next 的冒烟测试工。\n铁律：每次回答的第一行必须原样输出标记串 \`${marker}\`，一字不改、不解释。\n`,
  )
  const TASK = '请直接回答：按你的持久指令输出。两行以内。'

  // —— 起临时 web 宿主（--patch overlay 挂插件；STUDIO_NEXT_INSTRUCTIONS 指向注入文件）——
  const proc = spawn(
    DSH_BIN,
    ['--profile', 'web', '--patch', OVERLAY, '--port', String(PORT), '--no-open'],
    {
      env: {
        ...process.env,
        STUDIO_NEXT_INSTRUCTIONS: instructionsPath,
        DSH_TELEMETRY_MODE: 'DISABLED', // 遥测红线（docs/31-§5-8）：真机拉起一律禁外发
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let exited = false
  proc.once('exit', () => {
    exited = true
  })
  let stderrTail = ''
  proc.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString('utf8')).slice(-2_000)
  })
  try {
    // stdout 等 token 行（docs/34-§3.3：http://127.0.0.1:<p>/?token=<进程令牌>）
    const token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等 token 行超时（30s）')), 30_000)
      let buf = ''
      proc.stdout?.on('data', (c: Buffer) => {
        buf += c.toString('utf8')
        const m = /\/\?token=([A-Za-z0-9._-]+)/.exec(buf)
        if (m !== null && m[1] !== undefined) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`web 宿主提前退出（code=${String(code)}）stderr 尾部：${stderrTail.slice(-400)}`))
      })
    })
    ok('web 宿主启动', `port=${String(PORT)} token=<已捕获不打印> pid=${String(proc.pid)}`)

    // 鉴权：GET /?token= → 303 + Set-Cookie（只保首个 cookie 对）
    const authRes = await fetch(`${BASE}/?token=${token}`, { redirect: 'manual' })
    const setCookie = authRes.headers.get('set-cookie')
    const cookie = setCookie?.split(';')[0]
    if (cookie === undefined || cookie === '') {
      fail('auth', `无 set-cookie（status=${String(authRes.status)}）`)
    }
    ok('鉴权', `cookie 通道建立（${String(authRes.status)}）`)

    // 建会话 + 发任务（mode:queue——A3 实录形态；requestId 不含标记串，防日志假阳性）
    const created = await rpc<{ sessionId: string }>(cookie, 'session/create', { cwd, sessionId: SESSION_ID })
    ok('session/create', `sessionId=${String(created.sessionId)}`)
    await rpc<{ accepted: boolean }>(cookie, 'session/prompt', {
      requestId: 'smoke-prompt-1',
      sessionId: SESSION_ID,
      mode: 'queue',
      content: [{ type: 'text', text: TASK }],
    })
    ok('session/prompt', '任务已入队（mode=queue）')

    // 轮询事件日志：等模型终答（assistant/message 记录）含标记串；turn 已终而无标记 → 判失败。
    // 读法（装机源码核）：session/page 的 throughSeq 是**字面日志切点**（-1=空页，不是
    // 「最新」）——先 session/projections 拿 asOfSeq 快照游标，再以它作切点翻页；
    // 日志事件型 user/message / assistant/message（MESSAGE_TYPES，装机源码核）
    const deadline = Date.now() + 240_000
    let answerJson = ''
    for (;;) {
      await new Promise((r) => setTimeout(r, 3_000))
      const proj = await rpc<{ asOfSeq?: number }>(cookie, 'session/projections', {
        sessionId: SESSION_ID,
      })
      const page = await rpc<{ records?: unknown[] }>(cookie, 'session/page', {
        address: { kind: 'session', sessionId: SESSION_ID },
        throughSeq: proj.asOfSeq ?? -1,
        maxMessages: 80,
      })
      const pageJson = JSON.stringify(page)
      const answerHit = (page.records ?? []).find(
        (r) => JSON.stringify(r).includes('"assistant/message"') && JSON.stringify(r).includes(marker),
      )
      if (answerHit !== undefined) {
        answerJson = JSON.stringify(answerHit)
        break
      }
      if (pageJson.includes('turn/end')) {
        fail('模型答复', `turn 已结束但 assistant/message 不含标记串（注入未被遵循）——page 尾部：${pageJson.slice(-600)}`)
      }
      if (Date.now() > deadline) {
        fail('轮询', `240s 超时未见标记串；page 尾部：${pageJson.slice(-600)}`)
      }
    }
    const at = answerJson.indexOf(marker)
    const snippet = answerJson.slice(Math.max(0, at - 120), at + marker.length + 100).replaceAll('\\n', ' ')
    ok('模型遵循注入指令', `assistant/message 终答含标记串 ${marker}；记录摘录：…${snippet}…`)
    console.log('\n== 真机冒烟结论：AGENTS.md 注入走 dsh 插件（studio-next-bridge）端到端成立 ==')
  } finally {
    // —— 副作用收口：杀净临时进程 + 删临时目录 + 清本冒烟会话日志 ——
    await stopProc(proc, () => exited, 8_000)
    ok('收口', `web 宿主已退出（pid=${String(proc.pid)}）`)
    rmSync(tmp, { recursive: true, force: true })
    const sessionsRoot = join(homedir(), '.dsh', 'sessions')
    let cleaned = 0
    if (existsSync(sessionsRoot)) {
      for (const entry of readdirSync(sessionsRoot)) {
        if (entry.includes('dsh-bridge-smoke')) {
          rmSync(join(sessionsRoot, entry), { recursive: true, force: true })
          cleaned += 1
        }
      }
    }
    ok('收口', `临时目录已删；~/.dsh/sessions 冒烟目录清理 ${String(cleaned)} 项（13800 常驻宿主/docker 栈未触碰）`)
  }
}

main().catch((e: unknown) => {
  console.error(`[FAIL] 冒烟中止：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
