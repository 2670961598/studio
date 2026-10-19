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
 *   FAKE_REQUIRE_TASK   =1：无任务位置参数（argv 无 `--` 或其后为空）→ stdout 写一条顶层
 *                       error 事件 `{"type":"error","message":"a task is required"}` 并以
 *                       1 退出——模拟 dsh 真机 usage-error 面（docs/31-§0 发现 2：任务=
 *                       单个位置参数，缺任务必败；B7-headless-startup.js:76-80）——测适配器
 *                       launch 的任务串注入（`--` 分隔符 + briefPath 全文）
 *   FAKE_ECHO_ARGS      =1：stdout 首行回显本进程收到的 argv（`fake-cli argv: ...`），
 *                       测适配器 launch 的参数注入（预算帽 / 续跑 / 通道旗标）
 *   FAKE_ECHO_ENV       逗号分隔 env 变量名：每名一行回显该变量值（`fake-cli env: NAME=值`，
 *                       未设置时 `<unset>`)——测适配器 launch 的 env 注入（TaskBrief.credentials
 *                       v1.4 透传断言；只回显点名变量，不倾倒整份 env）
 *   FAKE_WIRE_DIR       设置后：正常退出前把 wire 内容写到 <dir>/wire.jsonl（目录递归建）
 *                       ——模拟 kimi「会话目录里落 session wire.jsonl」（docs/17-§6 已知坑：
 *                       usage 在 wire 不在 stdout）；仅在正常退出路径写（见边界语义）
 *   FAKE_WIRE_FIXTURE   wire 内容来源（golden fixture 全文）；未设时写空文件
 *   FAKE_GRANDCHILD_PID_FILE 设置后：spawn 一个长眠孙进程（node -e，普通 spawn 不建新组
 *                       ——继承本进程进程组），孙先把自己的 pid 写入该文件（就绪信号），
 *                       再长眠不退——测 execa 10 killDescendants 的整树杀（docs/27-§4.3 案 A）
 *   FAKE_GRANDCHILD_IGNORE_TERM =1：孙进程注册吞 SIGTERM 的空处理器（软杀无效，只可硬杀）
 *                       ——测「宽限后 SIGKILL 整树扫尾」的升级链
 *   FAKE_ECHO_ENV_KEYS =1：stdout 一行回显本进程可见的全部 env **键名**（逗号分隔，不含
 *                       值——env 探测负样本的断言面：键名集合即子进程可见面全貌；只打名
 *                       不打值，测试输出永不泄漏宿主 env 值）
 *
 * DSH_FAKE_* 别名（docs/43-附录A-1 起）：dsh 适配器 spawn env 收口为封闭允许集
 * （PATH、HOME、LANG、LC_ 前缀、TZ、TMPDIR、DSH_ 前缀）后，FAKE_ 旋钮不再随宿主 env
 * 透传到 dsh 位子进程。fake CLI 扮演的是 dsh 本尊，测试旋钮迁入 executor 自有命名空间：
 * `DSH_FAKE_<KNOB>` 在本文件入口折算回 `FAKE_<KNOB>`（已显式设置的 FAKE_ 不覆盖）。
 * kimi/claude/codex 适配器仍全量透传 env，继续用原名 FAKE_，互不影响。
 *
 * 注：除 FAKE_SIGTERM_EXIT（本进程）与 FAKE_GRANDCHILD_IGNORE_TERM（孙进程）外不注册任何
 * 信号处理器——SIGTERM 走 Node 默认终止行为。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// DSH_FAKE_<KNOB> → FAKE_<KNOB> 折算（见上方头注；只折算尚未显式设置的键）
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('DSH_FAKE_') && process.env[key.slice(4)] === undefined) {
    process.env[key.slice(4)] = value
  }
}

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
const requireTask = env.FAKE_REQUIRE_TASK === '1'
const echoArgs = env.FAKE_ECHO_ARGS === '1'
const echoEnvNames = (env.FAKE_ECHO_ENV ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')
const wireDir = env.FAKE_WIRE_DIR ?? ''
const wireFixture = env.FAKE_WIRE_FIXTURE ?? ''
const grandchildPidFile = env.FAKE_GRANDCHILD_PID_FILE ?? ''
const grandchildIgnoreTerm = env.FAKE_GRANDCHILD_IGNORE_TERM === '1'

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
  if (requireTask) {
    // dsh 真机 usage-error 面（docs/31-§0 发现 2：任务=单个位置参数，缺任务必败——
    // B7-headless-startup.js:76-80）：顶层 error 事件 + exit 1，stdout 仍是结构化 NDJSON。
    // 任务取 `--` 分隔符之后的位置参数（与 dsh 适配器 launch 的注入约定一致）
    const argv = process.argv.slice(2)
    const sep = argv.indexOf('--')
    const task = sep >= 0 ? argv.slice(sep + 1).join(' ') : ''
    if (task === '') {
      writeOut('{"type":"error","message":"a task is required"}\n')
      process.exit(1)
    }
  }
  if (grandchildPidFile !== '') {
    // 孙进程旋钮（execa 10 killDescendants 测试面，docs/27-§4.3 案 A）：普通 spawn 不建新
    // 组——孙继承本进程的进程组，整组杀（killDescendants Unix 落法）必须覆盖到它。
    // 孙先把自己的 pid 落盘（就绪信号），再长眠不退；父进程不等待不收割（unref）。
    // FAKE_GRANDCHILD_IGNORE_TERM=1 时孙注册吞 SIGTERM 空处理器——软杀无效，只可硬杀，
    // 专测「宽限后 SIGKILL 整树扫尾」。
    const grandchild = spawn(
      process.execPath,
      [
        '-e',
        `${grandchildIgnoreTerm ? 'process.on("SIGTERM", () => {}); ' : ''}` +
          'require("node:fs").writeFileSync(process.env.FAKE_GRANDCHILD_PID_FILE, String(process.pid)); ' +
          'setInterval(() => {}, 1 << 30)',
      ],
      {
        stdio: 'ignore',
        env: {
          ...env,
          FAKE_GRANDCHILD_PID_FILE: grandchildPidFile,
          FAKE_GRANDCHILD_IGNORE_TERM: grandchildIgnoreTerm ? '1' : '',
        },
      },
    )
    grandchild.unref()
  }
  if (echoArgs) {
    // FAKE_ECHO_ARGS=1：首行回显收到的 argv（非 JSON 行，归一化后以 log 原文透传——断言用）
    writeOut(`fake-cli argv: ${process.argv.slice(2).join(' ')}\n`)
  }
  if (echoEnvNames.length > 0) {
    // FAKE_ECHO_ENV：逐名回显点名变量（缺='<unset>'；非 JSON 行归一为 log——credentials
    // 透传断言用。只回显点名变量，不倾倒整份 env）
    for (const name of echoEnvNames) {
      writeOut(`fake-cli env: ${name}=${env[name] ?? '<unset>'}\n`)
    }
  }
  if (env.FAKE_ECHO_ENV_KEYS === '1') {
    // 键名全貌回显（只打名不打值——见头注；env 白名单断言的探测面）
    writeOut(`fake-cli env-keys: ${Object.keys(env).sort().join(',')}\n`)
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
