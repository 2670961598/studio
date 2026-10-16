/**
 * fake CLI harness —— 可配置假 CLI（供未来适配器 spawn 测试使用）
 *
 * 依据 docs/18-§1.3 独立测试套件：shell 脚本模拟各家 CLI 的 stdout/退出行为、覆盖已知坑场景。
 * 本实现用 Node 脚本替代 shell（避免 shebang / bash 版本依赖），约定用
 * `node fake-cli.mjs` 直接拉起。各家的真实流形态由 golden fixtures 提供（../fixtures/）。
 *
 * 环境变量旋钮（详见 README.md）：
 *   FAKE_FIXTURE        golden fixture 文件路径：内容逐行写到 stdout（缺省则无输出）
 *   FAKE_EXIT           退出码（缺省 0）
 *   FAKE_HANG           =1：输出完毕后挂起不退出，直到被 SIGTERM/SIGKILL——测 kill 路径
 *   FAKE_DELAY_MS       逐行输出间隔毫秒（缺省 0：一次性整块输出）——测增量流消费
 *   FAKE_SIGTERM_EXIT   设置后注册 SIGTERM 处理器：吞掉默认终止，改以该码退出
 *                       （=0 即 dsh 已知坑「被 kill 后退出码=0」；配 FAKE_HANG 使用）
 *   FAKE_VERSION        设置后：命令行含 --version 即只打印该值并以 0 退出（executor
 *                       detect 的版本门槛三态测试用）；未设置时 --version 与普通参数无异
 *   FAKE_ECHO_ARGS      =1：stdout 首行回显本进程收到的 argv（`fake-cli argv: ...`），
 *                       测适配器 launch 的参数注入（预算帽 / 续跑 / 通道旗标）
 *   FAKE_WIRE_DIR       设置后：正常退出前把 wire 内容写到 <dir>/wire.jsonl（目录递归建）
 *                       ——模拟 kimi「会话目录里落 session wire.jsonl」（docs/17-§6 已知坑：
 *                       usage 在 wire 不在 stdout）；仅在正常退出路径写（见边界语义）
 *   FAKE_WIRE_FIXTURE   wire 内容来源（golden fixture 全文）；未设时写空文件
 *
 * 注：除 FAKE_SIGTERM_EXIT 外不注册任何信号处理器——SIGTERM 走 Node 默认终止行为。
 */
import { mkdirSync, readFileSync, writeSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env

const fixturePath = env.FAKE_FIXTURE ?? ''
const parsedExit = Number.parseInt(env.FAKE_EXIT ?? '0', 10)
const exitCode = Number.isNaN(parsedExit) ? 0 : parsedExit
const hang = env.FAKE_HANG === '1'
const parsedDelay = Number.parseInt(env.FAKE_DELAY_MS ?? '0', 10)
const delayMs = Number.isNaN(parsedDelay) || parsedDelay < 0 ? 0 : parsedDelay
const sigtermExitRaw = env.FAKE_SIGTERM_EXIT ?? ''
const parsedSigtermExit = Number.parseInt(sigtermExitRaw, 10)
const sigtermExit =
  sigtermExitRaw === '' ? undefined : Number.isNaN(parsedSigtermExit) ? 0 : parsedSigtermExit
const fakeVersion = env.FAKE_VERSION ?? ''
const echoArgs = env.FAKE_ECHO_ARGS === '1'
const wireDir = env.FAKE_WIRE_DIR ?? ''
const wireFixture = env.FAKE_WIRE_FIXTURE ?? ''

if (sigtermExit !== undefined) {
  // dsh 已知坑模拟（docs/17-§6）：吞掉 SIGTERM 的默认终止，改以指定退出码退出——
  // FAKE_SIGTERM_EXIT=0 即「被 kill 后退出码=0 且 final 为空」，成功判定绝不能只看退出码
  process.on('SIGTERM', () => process.exit(sigtermExit))
}

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

function writeOut(chunk) {
  try {
    writeSync(1, chunk)
  } catch {
    // 消费端已关闭管道（EPIPE）：按被终止处理，退出码交由调用方语境判断
    process.exit(exitCode)
  }
}

if (fakeVersion !== '' && process.argv.includes('--version')) {
  // detect 专用短路：FAKE_VERSION 设置且收到 --version → 只回放版本串并以 0 退出，
  // 其余旋钮（fixture/exit/hang）一律不参与；未设 FAKE_VERSION 时走旧路径——既有行为不变
  writeOut(fakeVersion.endsWith('\n') ? fakeVersion : `${fakeVersion}\n`)
  process.exit(0)
}

async function main() {
  if (echoArgs) {
    // FAKE_ECHO_ARGS=1：首行回显收到的 argv（非 JSON 行，归一化后以 log 原文透传——断言用）
    writeOut(`fake-cli argv: ${process.argv.slice(2).join(' ')}\n`)
  }
  if (fixturePath !== '') {
    const text = readFileSync(fixturePath, 'utf8')
    if (delayMs === 0) {
      writeOut(text)
    } else {
      const parts = text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) writeOut('\n')
        if (parts[i] !== '') writeOut(parts[i])
        await sleep(delayMs)
      }
    }
  }
  if (hang) {
    // 空转定时器保活：不退出，等被杀（挂起场景没有任何退出码语义）
    setInterval(() => {}, 1 << 30)
    return
  }
  if (wireDir !== '') {
    // kimi 场景：正常退出前落一份会话 wire.jsonl（usage 在这里，不在 stdout——docs/17-§6）。
    // 仅正常退出路径写：挂起/被杀/EPIPE/FAKE_VERSION 短路均不写（会话未正常结束，wire 不落）
    mkdirSync(wireDir, { recursive: true })
    writeFileSync(
      join(wireDir, 'wire.jsonl'),
      wireFixture === '' ? '' : readFileSync(wireFixture, 'utf8'),
    )
  }
  process.exit(exitCode)
}

main().catch((err) => {
  process.stderr.write(`fake-cli: ${String(err)}\n`)
  process.exit(1)
})
