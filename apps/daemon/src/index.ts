#!/usr/bin/env node
/**
 * Studio Next · daemon —— 唯一常驻进程的**真实入口**（serve 装配入口）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-06-09「退役收尾」（LANE-M）：plan/01 §五 退役件之
 *     `apps/daemon/src/index.ts` 骨架横幅（「打印横幅后退出」的假常驻）在此退役；
 *   - docs/16-§四（v0.5 serve 主循环入口）、docs/17-§2（主循环七相位）、
 *     docs/18-§三（调度）；plan/05 §二 3.2 退役件表行「apps/daemon/src/index.ts、
 *     cli/external.ts → serve 装配入口；根 package.json daemon 脚本同步改」。
 *
 * 语义（退役后）：
 *   - `node apps/daemon/src/index.ts --config <daemon.yaml>`＝真跑 serve 主循环
 *     （装配＝assembly/serve/run.runServe，与 `studio-next serve --config …` 同一实现）；
 *     退出码与 CLI 面一致：0 优雅停 / 1 配置或装配失败 / 2 tick 中断；
 *   - **版本 fail-fast（NEG-ENG-04；docs/v2/13 §八-2/§八-3）**：装配之前先验
 *     `process.versions.node` 主版本 ≥ MIN_NODE_MAJOR（与 `.mise.toml` node=24.21.0、
 *     根 package.json engines.node=">=24" 对齐——TOOL-05：engines 只是声明性提示，
 *     真闸是启动 fail-fast）。低于/不可解析＝明确错误（CONFIG_INVALID/daemon/node-version）
 *     + exit 1，绝不进装配（不读配置、不开端口、不碰公司目录）；
 *   - 无 `--config`（或出现未知参数）＝打印入口 usage → exit 1，**绝不假装常驻**；
 *   - `-h/--help/help`＝打印入口 usage → exit 0。
 *
 * 分层纪律（为何此处不复用 cli/serve.ts 的 cmdServe）：本文件是宪法纵轴 root 层
 * 纯入口（D2），唯一冻结出边是 root → assembly（scripts/guards/boundary-rules.mjs
 * allowedVerticalEdges）；root → cli 未冻结（BC-V1）。故入口直接调 assembly 面，
 * 参数全文与单命令帮助面仍以 cli 侧为单一源（`studio-next serve --help`）。
 *
 * 根 package.json `daemon` 脚本即指本入口：`node apps/daemon/src/index.ts`
 * （跑法：`bun run daemon -- --config var/daemon.yaml`）。
 */
import path from 'node:path'
import { runServe } from './assembly/serve.ts'

/**
 * 最低 Node 主版本（v2/13 §八-3；与 `.mise.toml` node=24.21.0／根 engines.node=">=24"
 * 对齐）。只按**主版本**判：同主版本的次版本安全补丁不构成启动闸。
 */
export const MIN_NODE_MAJOR = 24

/** 版本串 → 主版本（`MAJOR.MINOR.PATCH[-预发布]`；不可解析=undefined——不猜、不放行） */
export function nodeMajorOf(version: string): number | undefined {
  const matched = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (matched === null) return undefined
  const majorText = matched[1]
  if (majorText === undefined) return undefined
  const major = Number(majorText)
  return Number.isSafeInteger(major) ? major : undefined
}

/** 版本拒绝错误（root 层零新依赖：分类字段沿 CONFIG_INVALID 族形状，错误通道归调用点） */
interface NodeVersionRefusal extends Error {
  category: 'CONFIG_INVALID'
  subcause: 'daemon/node-version'
  detail: string
}

function nodeVersionRefusal(detail: string): NodeVersionRefusal {
  const err = new Error(`CONFIG_INVALID/daemon/node-version：${detail}`) as NodeVersionRefusal
  err.category = 'CONFIG_INVALID'
  err.subcause = 'daemon/node-version'
  err.detail = detail
  return err
}

/**
 * 入口版本 fail-fast（NEG-ENG-04；docs/v2/13 §八-2「进程入口读 process.versions.node
 * 与期望比对，不满足拒绝启动」/§八-3）：主版本 < MIN_NODE_MAJOR 或不可解析 → 抛
 * NodeVersionRefusal；通过则返回主版本号。纯函数（版本串入参，不读 process）——
 * 旧版本/坏串/新版本三态可直接单测，无需改运行时。
 */
export function assertNodeVersion(version: string): number {
  const major = nodeMajorOf(version)
  if (major === undefined) {
    throw nodeVersionRefusal(
      `无法解析 Node 版本 "${version}"（期望 MAJOR.MINOR.PATCH，如 ${MIN_NODE_MAJOR}.21.0；engines.node >=${MIN_NODE_MAJOR}）——拒绝启动`,
    )
  }
  if (major < MIN_NODE_MAJOR) {
    throw nodeVersionRefusal(
      `Node 版本 ${version} 主版本 ${major} < 最低要求 ${MIN_NODE_MAJOR}（.mise.toml node=24.21.0；engines.node >=${MIN_NODE_MAJOR}）——拒绝启动；请用 mise exec -- node 启动`,
    )
  }
  return major
}

const USAGE = `用法：
  node apps/daemon/src/index.ts --config <daemon.yaml>
  （等价 CLI 面：studio-next serve --config <daemon.yaml>；全文：studio-next serve --help）

无 --config 时本入口只打印本段用法并 exit 1（不启动主循环——不假装常驻）。`

/** 错误面文本（root 层不引 cli 小件；只取 message，分类由调用点保留） */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 用法错误面：错误行→stderr、入口 usage→stdout、exit 1（与 CLI 面用法错同退码） */
function usageFail(message: string): number {
  console.error(`daemon：${message}`)
  console.log(USAGE)
  return 1
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.some((arg) => arg === '-h' || arg === '--help' || arg === 'help')) {
    console.log(USAGE)
    return 0
  }

  // 只收 --config <path> / --config=<path> 两式（与 CLI 旗标同义规则一致）；
  // 其余参数=用法错（不静默吞，避免「以为配了」的假常驻）
  let configPath: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--config') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return usageFail('--config 缺值')
      configPath = value
      i += 1
      continue
    }
    if (arg !== undefined && arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length)
      if (value === '') return usageFail('--config 缺值')
      configPath = value
      continue
    }
    return usageFail(`未知参数：${String(arg)}`)
  }
  if (configPath === undefined) return usageFail('缺少 --config <daemon.yaml>')

  try {
    const result = await runServe(configPath)
    if (result.stopReason === 'error') {
      console.error(`daemon：运行中断（tick 异常）：${result.lastError ?? '未知'}`)
      return 2
    }
    console.log(`daemon：已停机（共 ${result.ticks} 拍）`)
    return 0
  } catch (err) {
    // 配置解析/平台接线/公司目录装载失败：CONFIG_INVALID 形状，如实分类上报
    console.error(`daemon 启动失败：${errText(err)}`)
    return 1
  }
}

/**
 * 入口判定（只在进程入口跑主循环，被 import 时零副作用——纯函数可直接单测）：
 * 以 `import.meta.main`（Node ≥24.2 提供）为准；更早的 24.x 无此键时回退
 * `process.argv[1]` 实路径比较（`import.meta.filename` 为 realpath，`path.resolve`
 * 消化相对路径；非 file: 模块无 filename，比较必然为 false——不会误启动）。
 */
function isProcessEntry(): boolean {
  const main = (import.meta as ImportMeta & { readonly main?: boolean }).main
  if (main !== undefined) return main
  const entry = process.argv[1]
  return entry !== undefined && path.resolve(entry) === import.meta.filename
}

/** 入口主序：版本 fail-fast → main（版本不满足只做「明确错误 + exit 非零」，不进装配） */
function runEntry(): void {
  try {
    assertNodeVersion(process.versions.node)
  } catch (err) {
    console.error(`daemon：拒绝启动——${errText(err)}`)
    process.exitCode = 1
    return
  }
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      console.error(`daemon：未预期错误：${errText(err)}`)
      process.exitCode = 1
    },
  )
}

if (isProcessEntry()) runEntry()
