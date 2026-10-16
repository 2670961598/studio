/**
 * fake CLI harness —— 可配置假 CLI（供未来适配器 spawn 测试使用）
 *
 * 依据 docs/18-§1.3 独立测试套件：shell 脚本模拟各家 CLI 的 stdout/退出行为、覆盖已知坑场景。
 * 本实现用 Node 脚本替代 shell（避免 shebang / bash 版本依赖），约定用
 * `node fake-cli.mjs` 直接拉起。各家的真实流形态由 golden fixtures 提供（../fixtures/）。
 *
 * 环境变量旋钮（详见 README.md）：
 *   FAKE_FIXTURE    golden fixture 文件路径：内容逐行写到 stdout（缺省则无输出）
 *   FAKE_EXIT       退出码（缺省 0）
 *   FAKE_HANG       =1：输出完毕后挂起不退出，直到被 SIGTERM/SIGKILL——测 kill 路径
 *   FAKE_DELAY_MS   逐行输出间隔毫秒（缺省 0：一次性整块输出）——测增量流消费
 *
 * 注：未注册任何信号处理器——SIGTERM 走 Node 默认终止行为；
 * 「dsh 被 kill 后退出码=0」的坑位模拟属于 dsh 适配器 kill 测试的旋钮，届时再加。
 */
import { readFileSync, writeSync } from 'node:fs'

const env = process.env

const fixturePath = env.FAKE_FIXTURE ?? ''
const parsedExit = Number.parseInt(env.FAKE_EXIT ?? '0', 10)
const exitCode = Number.isNaN(parsedExit) ? 0 : parsedExit
const hang = env.FAKE_HANG === '1'
const parsedDelay = Number.parseInt(env.FAKE_DELAY_MS ?? '0', 10)
const delayMs = Number.isNaN(parsedDelay) || parsedDelay < 0 ? 0 : parsedDelay

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

async function main() {
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
  process.exit(exitCode)
}

main().catch((err) => {
  process.stderr.write(`fake-cli: ${String(err)}\n`)
  process.exit(1)
})
