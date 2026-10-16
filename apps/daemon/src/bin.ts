#!/usr/bin/env node
/**
 * studio-next CLI（v0.1-M3；落点按 docs/25-§七 P1 拟批默认：daemon 包出 bin，不新增 apps/cli）
 *
 * 子命令：
 *   init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
 *       从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
 *   validate <目录>
 *       目录结构校验：不合法逐条打印「文件:行 [规则] 修法」到 stderr，exit 1（04-§九）
 *   ledger drill <库路径>
 *       删库重建演习（F2-12 可操作化）：自建语料写入 → dump → 删库三件套 → 原路径重建 →
 *       比对报告；结论行「演习 PASS/FAIL」，exit 0/1（库路径必须不存在——防误删真实台账）
 *   ledger dump <库路径> <输出.jsonl>
 *       events 全量导出 JSONL（F2-11 库→JSONL 单向派生）
 *   ledger rebuild <源.jsonl> <目标库>
 *       JSONL → 新库重放（单事务原子，坏行中止指明行号；F2-12）
 *   panel --db <库路径> [--port 8787]
 *       :8787 只读监控面（v0.3）：jobs/runs/workers/事件流（SSE），全部读 SQLite 零写；
 *       库不存在即拒启（panel 不代建库）；SIGINT/SIGTERM 优雅关闭
 *   serve --config <daemon.yaml>
 *       常驻主循环（v0.5）：七相位引擎 + 心跳日志；SIGINT/SIGTERM 优雅停（等当前拍收口→
 *       在途 drain→关台账）。配置最小面 {db, platform: localfile|fake, company, rootDir,
 *       tickMs, …}（扁平 YAML 子集，见 src/serve.ts 头注）；demo 模式=fake 全家桶零外部依赖
 *   （v0 诚实边界：真 dsh / 真 YouTrack / 网关 wkey / 审批流 / localfile 平台均未接线——
 *     逐项清单见 src/serve.ts 与 src/engine.ts 头注）
 *
 * argv 解析零依赖手写（单命令薄壳不值得引库；16-§二 选型纪律：引新依赖须登记选型表）。
 * 退出码：0 成功｜1 用法错误 / 校验不通过 / init 失败 / 演习 FAIL / panel 失败 / serve 配置错｜
 * 2 serve 运行中出错（tick 异常）。
 * 用 process.exitCode 而非 process.exit 收尾：让管道下的 stdout/stderr 先冲刷再自然退出。
 */
import path from 'node:path'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { InitOptions } from '@studio-next/company'
import { servePanel } from '@studio-next/panel'
import { openLedger, rebuild, renderDrillReport, runLedgerDrill } from '@studio-next/store'
import { runServe } from './serve.ts'

const USAGE = `studio-next —— Studio Next 框架 CLI（v0.1）

用法：
  studio-next init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
      从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
  studio-next validate <目录>
      校验公司目录结构：不合法逐条打印「文件:行 [规则] 修法」到 stderr 并 exit 1
  studio-next ledger drill <库路径>
      删库重建演习（F2-12）：语料写入 → dump → 删库三件套 → 原路径重建 → 比对报告，
      结论「演习 PASS/FAIL」exit 0/1；库路径必须不存在（防误删真实台账）；报告走 stdout 可重定向留证
  studio-next ledger dump <库路径> <输出.jsonl>
      events 全量导出 JSONL（F2-11 单向派生）
  studio-next ledger rebuild <源.jsonl> <目标库>
      JSONL → 新库重放（单事务原子；F2-12）
  studio-next panel --db <库路径> [--port 8787]
      :8787 只读监控面（v0.3，docs/16-§四）：jobs/runs/workers/事件流（SSE），
      全部读 SQLite 零写；库不存在即拒启；Ctrl-C 优雅关闭
  studio-next serve --config <daemon.yaml>
      常驻主循环（v0.5，docs/16-§四）：七相位引擎 + 心跳日志 + SIGINT/SIGTERM 优雅停。
      配置最小面（扁平 YAML 子集）：db / platform(fake|localfile) / company / rootDir / tickMs /
      maxActionsPerTick / maxInflight / stallAfterMs / laneTtlMs / breakerThreshold / autoApprove /
      companyDir / jobs / jobPollMs；jobs: true 起定时岗调度器（v0.4：cron 到点→schedule 意图→
      主循环，结果落台账）；demo 模式=fake 全家桶零外部依赖（真 dsh/YouTrack/网关未接线，
      见 src/serve.ts 头注）

默认值：--dir 缺省 ./<slug>；--name 缺省 <slug>；--port 缺省 8787（panel）
文档：docs/04-公司目录与等级体系.md §二/§九；docs/16-技术实现与里程碑.md §四；docs/02-需求-框架面.md F2-11/F2-12；docs/17-整体技术设计.md §8`

interface Argv {
  positionals: string[]
  flags: Record<string, string>
}

/** 零依赖 argv 解析：--key value 成对消费；未知旗标 / 缺值即用法错误 */
function parseArgv(argv: string[], valueFlags: ReadonlySet<string>): Argv | { error: string } {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (!valueFlags.has(key)) return { error: `未知参数：${arg}` }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} 缺少取值` }
      flags[key] = value
      i += 1
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function cmdInit(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['name', 'dir', 'template']))
  if ('error' in parsed) {
    console.error(`init：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const slug = parsed.positionals[0]
  if (slug === undefined) {
    console.error('init：缺少 <slug>（例：studio-next init demo-corp）')
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 1) {
    console.error(`init：多余的位置参数：${parsed.positionals.slice(1).join(' ')}`)
    console.error(USAGE)
    return 1
  }

  const options: InitOptions = { slug, targetDir: parsed.flags.dir ?? path.resolve(slug) }
  if (parsed.flags.name !== undefined) options.name = parsed.flags.name
  if (parsed.flags.template !== undefined) options.templateDir = parsed.flags.template

  try {
    const result = await initCompany(options)
    console.log(`已生成公司目录：${result.dir}`)
    console.log(`git 首次提交：${result.gitCommit}`)
    console.log(`目录自检：通过（slug=${slug}；结构契约 docs/04-§二）`)
    return 0
  } catch (err) {
    // initCompany 的失败即 ClassifiedError(CONFIG_INVALID)（宁失败不半成品，已撤除产物）
    console.error(`init 失败：${errText(err)}`)
    return 1
  }
}

async function cmdValidate(argv: string[]): Promise<number> {
  const dir = argv[0]
  if (argv.length !== 1 || dir === undefined) {
    console.error('validate：需要恰好一个参数（公司目录路径）')
    console.error(USAGE)
    return 1
  }
  let files: Record<string, string>
  try {
    files = await readDirectoryFiles(path.resolve(dir))
  } catch (err) {
    console.error(`validate：读取目录失败：${errText(err)}`)
    return 1
  }
  const mounted = loadCompanyDirectory(files)
  if (mounted.ok) {
    const s = mounted.snapshot
    console.log(`合法：${s.slug}（${s.level} 级公司 · ${s.departments.length} 部门 · ${s.people.length} 人 · 平台 ${s.platform.platform}）`)
    return 0
  }
  for (const issue of mounted.issues) {
    console.error(`${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
  }
  console.error(`校验不通过：${mounted.issues.length} 个问题（docs/04-§九：结构不合法拒绝挂载，修法见上）`)
  return 1
}

/** ledger 子命令组：薄壳转调 store（drill/dump/rebuild 全部语义在 @studio-next/store） */
async function cmdLedger(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'drill': {
      const dbPath = rest[0]
      if (rest.length !== 1 || dbPath === undefined) {
        console.error('ledger drill：需要恰好一个参数（演习库路径；必须不存在——防误删真实台账）')
        console.error(USAGE)
        return 1
      }
      try {
        const report = await runLedgerDrill(path.resolve(dbPath))
        for (const line of renderDrillReport(report)) console.log(line)
        return report.pass ? 0 : 1
      } catch (err) {
        // ClassifiedError(CONFIG_INVALID)（路径已存在等防呆）与重建失败，如实分类上报
        console.error(`ledger drill 失败：${errText(err)}`)
        return 1
      }
    }
    case 'dump': {
      const [dbPath, outPath] = rest
      if (rest.length !== 2 || dbPath === undefined || outPath === undefined) {
        console.error('ledger dump：需要恰好两个参数（库路径、输出.jsonl）')
        console.error(USAGE)
        return 1
      }
      try {
        const ledger = openLedger(path.resolve(dbPath))
        try {
          const { lines } = ledger.dumpEvents(outPath)
          console.log(`已导出 ${lines} 行 → ${outPath}`)
        } finally {
          ledger.close()
        }
        return 0
      } catch (err) {
        console.error(`ledger dump 失败：${errText(err)}`)
        return 1
      }
    }
    case 'rebuild': {
      const [source, target] = rest
      if (rest.length !== 2 || source === undefined || target === undefined) {
        console.error('ledger rebuild：需要恰好两个参数（源.jsonl、目标库路径）')
        console.error(USAGE)
        return 1
      }
      try {
        const result = rebuild(path.resolve(source), path.resolve(target))
        console.log(`已重建：events=${result.events} / schema v${result.version} → ${target}`)
        return 0
      } catch (err) {
        console.error(`ledger rebuild 失败：${errText(err)}`)
        return 1
      }
    }
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    default:
      console.error(`未知 ledger 子命令：${sub}`)
      console.error(USAGE)
      return 1
  }
}

/** panel 子命令：薄壳转 servePanel（语义全在 @studio-next/panel；默认只绑本机） */
async function cmdPanel(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'port']))
  if ('error' in parsed) {
    console.error(`panel：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`panel：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('panel：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  let port = 8787
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`panel：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  let handle
  try {
    handle = await servePanel(port, path.resolve(dbPath))
  } catch (err) {
    // 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`panel 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[panel] :8787 监控面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[panel] 台账：${path.resolve(dbPath)}（零写；端面 /api/health|jobs|runs|workers|events|events/stream|snapshot）`)
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[panel] 已优雅关闭')
  return 0
}

/** serve 子命令：薄壳转 runServe（配置装载/循环/优雅停语义全在 src/serve.ts） */
async function cmdServe(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['config']))
  if ('error' in parsed) {
    console.error(`serve：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`serve：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const configPath = parsed.flags.config
  if (configPath === undefined) {
    console.error('serve：缺少 --config <daemon.yaml>')
    console.error(USAGE)
    return 1
  }
  try {
    const result = await runServe(configPath)
    if (result.stopReason === 'error') {
      console.error(`serve：运行中断（tick 异常）：${result.lastError ?? '未知'}`)
      return 2
    }
    console.log(`serve：已停机（共 ${result.ticks} 拍）`)
    return 0
  } catch (err) {
    // 配置/平台接线/公司目录装载失败：CONFIG_INVALID 形状，如实分类上报
    console.error(`serve 启动失败：${errText(err)}`)
    return 1
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'init':
      return cmdInit(rest)
    case 'validate':
      return cmdValidate(rest)
    case 'ledger':
      return cmdLedger(rest)
    case 'panel':
      return cmdPanel(rest)
    case 'serve':
      return cmdServe(rest)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    default:
      console.error(`未知子命令：${command}`)
      console.error(USAGE)
      return 1
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(`studio-next：未预期错误：${errText(err)}`)
    process.exitCode = 1
  },
)
