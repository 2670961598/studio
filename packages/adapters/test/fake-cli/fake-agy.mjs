#!/usr/bin/env node
/**
 * fake-agy —— Antigravity CLI（agy）的假 CLI 夹具（task-140；docs/18-§1.3 独立测试套件）
 *
 * 与 fake-cli.mjs（dsh/claude/codex/kimi 流式家族共用）不同：agy 的 stdout 是**单对象
 * JSON 终稿**且 env 旋钮进不了 agy 白名单（FAKE_* 非 AGY_ENV_KEYS 成员）——本夹具改用
 * **场景文件驱动**：launch cwd（=task.workspace）下的 `agy-fake-scenario.json` 即剧本，
 * 测试落盘什么 stdout/退出码/挂起行为，子进程照演什么。零 env 依赖 ⇒ 白名单测试不受污染。
 *
 * 场景文件字段（全可选；文件缺席=缺省成功面）：
 *   { "version": "1.5.18",     // --version 输出（detect 面三态：地板达标/低于/解析失败）
 *     "stdout":  "<stdout 全文>",  // 非 --version 时原样写出（agy 单对象 JSON 终稿由测试侧拼）
 *     "stderr":  "<stderr 文本>",
 *     "exit":    0,             // 退出码
 *     "hang":    true,          // 写完 stdout 后挂起直到被杀（watchdog/kill 升级链测试）
 *     "ignoreTerm": true }      // 吞 SIGTERM（软杀无效只可硬杀——宽限后 SIGKILL 面测试）
 *
 * 启动即落盘 `agy-fake-report.json`（同目录）——测试的 argv/env 断言面：
 *   { pid, argv: [收到的 agy 参数（不含 node/脚本名）], cwd,
 *     envKeys: [本进程可见 env 键名排序（无值——白名单负断言面）],
 *     proxyEnv: { 点名代理键的值（缺=null）——代理放行正断言面 } }
 *
 * 用法（vitest 侧）：构造 AgyAdapter([process.execPath, '<本文件路径>'], opts)，场景/
 * 报告文件都落在 mkdtempSync 临时 workspace——launch cwd 即 task.workspace，天然隔离。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const scenario = readScenario(scenarioPath(argv))
// 报告只写 launch 面（--version/detect 继承测试进程 cwd——repo 目录不许落盘测试产物）
if (!argv.includes('--version')) {
  writeReport(join(process.cwd(), 'agy-fake-report.json'), argv)
}

if (argv.includes('--version')) {
  process.stdout.write(String(scenario.version ?? '1.5.18'))
  process.exit(0)
}

if (typeof scenario.stderr === 'string' && scenario.stderr !== '') {
  process.stderr.write(scenario.stderr)
}
if (scenario.ignoreTerm === true) {
  // 吞 SIGTERM：软杀无效，只可硬杀（kill 宽限升级链测试面）
  process.on('SIGTERM', () => undefined)
}
// stdout 写完（回调到点）再定去向：挂起不退 / 按场景退出码退——先 exit 会截断管道写（已知坑）
if (typeof scenario.stdout === 'string' && scenario.stdout !== '') {
  process.stdout.write(scenario.stdout, settle)
} else {
  settle()
}

function settle() {
  if (scenario.hang === true) {
    setInterval(() => undefined, 60_000) // 挂起不退：等被杀（watchdog / kill() 整组回收测试面）
    return
  }
  process.exit(typeof scenario.exit === 'number' ? scenario.exit : 0)
}

// ---------------------------------------------------------------------------

/** 场景文件定位：argv 旗标 `--fake-agy-scenario <path>` 优先（detect 面用——detect 不设
 * cwd，继承测试进程 cwd，落不进临时 workspace），否则 launch cwd（=task.workspace）下
 * 的 `agy-fake-scenario.json`（launch 面用——cwd 即场景位，零 env 依赖）。 */
function scenarioPath(argv) {
  const i = argv.indexOf('--fake-agy-scenario')
  if (i !== -1 && i + 1 < argv.length && argv[i + 1] !== '--version') return argv[i + 1]
  return join(process.cwd(), 'agy-fake-scenario.json')
}

function readScenario(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {} // 场景文件缺席/坏 JSON=缺省成功面（测试侧负责落盘正确场景）
  }
}

function writeReport(path, argv) {
  const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']
  const proxyEnv = {}
  for (const key of PROXY_KEYS) proxyEnv[key] = process.env[key] ?? null
  try {
    writeFileSync(path, `${JSON.stringify({ pid: process.pid, argv, cwd: process.cwd(), envKeys: Object.keys(process.env).sort(), proxyEnv }, null, 2)}\n`)
  } catch {
    // 报告是断言面非主面：写不进不掩盖 stdout/exit 行为
  }
}
