/**
 * args.mjs —— 模型评测 runner 的参数解析（纯函数；run.mjs 的 CLI 面）
 *
 * 依据：docs/quality/model-eval.md §6（运行命令）；制作人 2026-11-23 令「设定我们自己的
 * 模型能力评判」。约定：
 *   - 用法错（缺参/坏值/未知旗标）抛 UsageError，由 run.mjs 统一 exit 2（不打印栈）；
 *   - `--judge none` 关闭 LLM judge；`--skip-unavailable` 缺省 true（`--no-skip-unavailable` 关）；
 *   - 缺省输出目录 /tmp/model-eval/<ts>（临时区，永不落公司目录/仓内）。
 */
import { join } from 'node:path'
import { parseModelRef } from './overlay.mjs'

/** 缺省被测矩阵（按序；docs/quality/model-eval.md §4 模型矩阵）。 */
export const DEFAULT_MODELS = Object.freeze([
  'glm/GLM-5.4',
  'glm/GLM-5.3-Flash',
  'glm/GLM-5.3',
  'kimi-coding/k3.1-pro',
  'opencode-go/deepseek-v4.1-flash',
])

/** 缺省裁判（固定、不随被测模型变化；docs/quality/model-eval.md §3）。 */
export const DEFAULT_JUDGE = 'glm/GLM-5.4'

export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_PROBE_TIMEOUT_MS = 90_000

export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

export const USAGE = `用法：node scripts/ops/model-eval/run.mjs [选项]

  --models <a/b,c/d,...>      被测模型（provider/model；逗号分隔；缺省全矩阵按序）
  --tasks <t01,t02,...>       任务 id 或目录名（缺省全部）
  --reps <n>                  每 (模型,任务) 重复次数（缺省 1）
  --out <dir>                 输出目录（缺省 /tmp/model-eval/<时间戳>）
  --timeout-ms <n>            单次任务调用超时（缺省 300000）
  --probe-timeout-ms <n>      可用性预探超时（缺省 90000）
  --judge <provider/model>|none  LLM 裁判（缺省 glm/GLM-5.4；none=关闭）
  --skip-unavailable | --no-skip-unavailable   预探失败是否跳过该模型（缺省跳过）
  --dsh <path>                dsh 可执行文件路径（缺省自动探测）
  --prices <json>             可选价目表（USD/百万 tokens），用于估算成本
  -q, --quiet                 只打印最终报告路径
  -h, --help                  本说明

退出码：0=报告已写出（模型不可用不算失败）；2=用法错；1=内部错；3=评测台自身不可用
（如 dsh 无法启动），此时 report.json 仍写出。`

function splitList(raw, flag) {
  const out = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (out.length === 0) throw new UsageError(`${flag} 不能为空`)
  return out
}

function parseIntValue(raw, flag, min) {
  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) throw new UsageError(`${flag} 须为正整数：${raw}`)
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n < min) throw new UsageError(`${flag} 须 ≥ ${min}：${raw}`)
  return n
}

/** 本地时间戳目录名（YYYYMMDD-HHMMSS）；`now` 可注入（测试）。 */
export function timestamp(now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/**
 * 解析 argv。返回配置对象：modelRefs 为已校验的 {id,provider,model,slug}，judgeRef 同形
 * （judge 关闭时为 null）。不碰文件系统、不 spawn。
 */
export function parseArgs(argv, { now = () => new Date() } = {}) {
  const o = {
    models: [...DEFAULT_MODELS],
    tasks: null,
    reps: 1,
    out: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    judge: DEFAULT_JUDGE,
    skipUnavailable: true,
    dsh: null,
    prices: null,
    quiet: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = (flag) => {
      const v = argv[i + 1]
      if (v === undefined || v.trim() === '') throw new UsageError(`${flag} 缺参数值`)
      i += 1
      return v
    }
    switch (a) {
      case '--models':
        o.models = splitList(next(a), a)
        break
      case '--tasks':
        o.tasks = splitList(next(a), a)
        break
      case '--reps':
        o.reps = parseIntValue(next(a), a, 1)
        break
      case '--out':
        o.out = String(next(a)).trim()
        break
      case '--timeout-ms':
        o.timeoutMs = parseIntValue(next(a), a, 1)
        break
      case '--probe-timeout-ms':
        o.probeTimeoutMs = parseIntValue(next(a), a, 1)
        break
      case '--judge':
        o.judge = String(next(a)).trim()
        break
      case '--skip-unavailable':
        o.skipUnavailable = true
        break
      case '--no-skip-unavailable':
        o.skipUnavailable = false
        break
      case '--dsh':
        o.dsh = String(next(a)).trim()
        break
      case '--prices':
        o.prices = String(next(a)).trim()
        break
      case '-q':
      case '--quiet':
        o.quiet = true
        break
      case '-h':
      case '--help':
        o.help = true
        break
      default:
        throw new UsageError(`未知参数 ${a}（--help 查看用法）`)
    }
  }
  if (o.help) return o

  if (o.models.length === 0) throw new UsageError('--models 不能为空')
  o.modelRefs = o.models.map((ref) => parseModelRef(ref))
  const judge = o.judge.toLowerCase()
  if (judge === 'none' || judge === 'off' || judge === 'no') {
    o.judge = null
    o.judgeRef = null
  } else {
    o.judgeRef = parseModelRef(o.judge)
    o.judge = o.judgeRef.id
  }
  if (o.tasks !== null) o.tasks = o.tasks.map((t) => t.toLowerCase())
  if (o.out === null) o.out = join('/tmp', 'model-eval', timestamp(now()))
  return o
}
