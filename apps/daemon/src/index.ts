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
import { runServe } from './assembly/serve.ts'

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

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(`daemon：未预期错误：${errText(err)}`)
    process.exitCode = 1
  },
)
