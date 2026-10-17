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
 *   candidates list --db <库路径>
 *       进化管线现状只读列表（v0.10，docs/16-§四/17-§3/20-§九）：candidates 全量按
 *       (created_at,id) 升序——汇总行（总数+状态分布）+ 逐行 id/状态/资产类型/blast_radius/
 *       version/谱系父/资产路径/diff 哈希；库不存在即拒（只读面不代建库，panel 同款闸）
 *   panel --db <库路径> [--port 8787]
 *       :8787 只读监控面（v0.3）：jobs/runs/workers/事件流（SSE），全部读 SQLite 零写；
 *       库不存在即拒启（panel 不代建库）；SIGINT/SIGTERM 优雅关闭
 *   overview --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8789]
 *       :8789 公司概览面（v0.7 读面）：挂载公司目录（校验不过拒绝挂载）→ /<slug>/ 概览/
 *       组织/人事/进度/财务五读面（全 GET 只读、服务端渲染零前端依赖）；--db 可选（给出则
 *       进度/财务页读台账，必须已存在——只读不代建库）；项目/报表/编辑中心归后续刀。
 *       【选型说明（拟稿）】独立子命令而非 serve --overview-port：:8787 本就是独立 panel
 *       子命令（serve 主循环不内嵌面板），:8789 同款——只读壳与 daemon 生命周期解耦，
 *       WAL 同库并存安全；待制作人批示后固化
 *   external --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8788]
 *            [--token <触发面令牌>] [--requests-per-minute N] [--lan]
 *       :8788 对外 API（v0.9 信息/触发骨架）：信息端点全 GET 全公开（D5）——/v1/company、
 *       /v1/org、/v1/people、/v1/projects、/v1/issues、/v1/finance、/v1/reports；
 *       触发端点 POST /v1/requests（X-SN-Token 必带，**只落单不派工**，幂等键防重，IP 配额
 *       429）；/v1/agent-card（名片带版本）；SSE 订阅 501 占位。越权调用全部 fail-closed
 *       （16-§四 v0.9）。--token 缺省=触发面全 401；--db 给出才装配触发面（必须已存在——
 *       不代建库）。【绑定面（D4 拟稿反转说明）】D4「默认局域网」是部署意图，安全缺省取
 *       **127.0.0.1** 只绑本机；对局域网开放须显式 --lan（绑 0.0.0.0）。
 *       【触发面平台（拟稿）】本子命令以 fake 平台过真网关闸（demo 骨架，与 serve demo 模式
 *       同款：DEV_GATEWAY_SECRET 开发密钥+警告）；真 YouTrack/localfile 接线与生产密钥归
 *       daemon 装配后续刀（写闸已在网关侧收口——panel 包不碰 gateway）
 *   serve --config <daemon.yaml>
 *       常驻主循环（v0.5）：七相位引擎 + 心跳日志；SIGINT/SIGTERM 优雅停（等当前拍收口→
 *       在途 drain→关台账）。配置最小面 {db, platform: localfile|fake, company, rootDir,
 *       tickMs, …}（扁平 YAML 子集，见 src/serve.ts 头注）；demo 模式=fake 全家桶零外部依赖
 *   （v0 诚实边界：真 dsh / 真 YouTrack / 网关 wkey / 审批流 / localfile 平台均未接线——
 *     逐项清单见 src/serve.ts 与 src/engine.ts 头注）
 *
 * argv 解析零依赖手写（单命令薄壳不值得引库；16-§二 选型纪律：引新依赖须登记选型表）。
 * 退出码：0 成功｜1 用法错误 / 校验不通过 / init 失败 / 演习 FAIL / panel 失败 / overview 失败 / external 失败 / candidates 失败 / serve 配置错｜
 * 2 serve 运行中出错（tick 异常）。
 * 用 process.exitCode 而非 process.exit 收尾：让管道下的 stdout/stderr 先冲刷再自然退出。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { InitOptions } from '@studio-next/company'
import { servePanel } from '@studio-next/panel'
import { serveOverview } from '@studio-next/panel/overview'
import type { OverviewCompanySource } from '@studio-next/panel/overview'
import { serveExternal } from '@studio-next/panel/external'
import type { ExternalCompanySource } from '@studio-next/panel/external'
import { CANDIDATE_STATUS_VALUES, openLedger, rebuild, renderDrillReport, runLedgerDrill } from '@studio-next/store'
import type { CompanySnapshot } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import type { SignatureContext } from '@studio-next/gateway'
import { DEV_GATEWAY_SECRET } from './serve.ts'
import { createFakePlatform } from './fakes.ts'
import { createGatedPlatform } from './gated-platform.ts'
import { ENGINE_CONFIG_DEFAULTS } from './engine.ts'
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
  studio-next candidates list --db <库路径>
      进化管线现状只读列表（v0.10，docs/16-§四）：汇总行（总数+状态分布）+ 候选逐行
      id/状态/资产类型/blast_radius/version/谱系父/资产路径/diff 哈希（(created_at,id) 升序）；
      库不存在即拒（只读面不代建库）
  studio-next panel --db <库路径> [--port 8787]
      :8787 只读监控面（v0.3，docs/16-§四）：jobs/runs/workers/事件流（SSE），
      全部读 SQLite 零写；库不存在即拒启；Ctrl-C 优雅关闭
  studio-next overview --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8789]
      :8789 公司概览面（v0.7 读面，docs/04-§七）：挂载公司目录（可多家，校验不过拒绝挂载）
      → /<slug>/ 概览/组织/人事/进度/财务五读面（全 GET 只读、零前端依赖）；
      --db 可选（给出则进度/财务页读台账，必须已存在——只读不代建）；Ctrl-C 优雅关闭
  studio-next external --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8788]
                      [--token <触发面令牌>] [--requests-per-minute N] [--lan]
      :8788 对外 API（v0.9 信息/触发骨架，docs/16-§四/17-§8/25-§4.2）：信息端点全 GET 全公开
      （/v1/company|org|people|projects|issues|finance|reports|agent-card）；触发端点
      POST /v1/requests（X-SN-Token 必带——只落单不派工、幂等键防重、IP 每分钟配额 429）；
      越权调用全部 fail-closed；--token 缺省=触发面全 401；--lan 才绑 0.0.0.0（缺省 127.0.0.1，
      D4 拟稿反转：局域网开放须显式旗标）；Ctrl-C 优雅关闭
  studio-next serve --config <daemon.yaml>
      常驻主循环（v0.5，docs/16-§四）：七相位引擎 + 心跳日志 + SIGINT/SIGTERM 优雅停。
      配置最小面（扁平 YAML 子集）：db / platform(fake|localfile) / company / rootDir / tickMs /
      maxActionsPerTick / maxInflight / stallAfterMs / laneTtlMs / breakerThreshold / autoApprove /
      companyDir / jobs / jobPollMs / models / budgetTicketCapUsd / budgetPersonCapUsd；
      jobs: true 起定时岗调度器（v0.4：cron 到点→schedule 意图→主循环，结果落台账）；
      models: <models.yaml> 装载价目表→派发前预算闸估算校准（态 A；缺省态 B=适配器自报），
      预算预留-结算不落即不派（20-§六.8）；demo 模式=fake 全家桶零外部依赖
      （真 dsh/YouTrack/网关未接线，见 src/serve.ts 头注）

默认值：--dir 缺省 ./<slug>；--name 缺省 <slug>；--port 缺省 8787（panel）/ 8789（overview）/ 8788（external）
文档：docs/04-公司目录与等级体系.md §二/§七/§九；docs/16-技术实现与里程碑.md §四；docs/02-需求-框架面.md F2-11/F2-12；docs/17-整体技术设计.md §8`

interface Argv {
  positionals: string[]
  flags: Record<string, string>
  /** 布尔旗标（无值，出现即 true） */
  booleans: Set<string>
  /** 可重复旗标的全部取值（按出现序；不可重复旗标不进此面） */
  multi: Record<string, string[]>
}

/**
 * 零依赖 argv 解析：--key value 成对消费（booleanFlags 中的旗标无值，出现即真）；
 * 未知旗标 / 缺值即用法错误。repeatableFlags 中的旗标可多次出现（取值收集进 multi，
 * 后值不覆盖前值）。
 */
function parseArgv(argv: string[], valueFlags: ReadonlySet<string>, repeatableFlags?: ReadonlySet<string>, booleanFlags?: ReadonlySet<string>): Argv | { error: string } {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  const booleans = new Set<string>()
  const multi: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (booleanFlags?.has(key)) {
        booleans.add(key)
        continue
      }
      if (!valueFlags.has(key)) return { error: `未知参数：${arg}` }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} 缺少取值` }
      flags[key] = value
      if (repeatableFlags?.has(key)) {
        ;(multi[key] ??= []).push(value)
      }
      i += 1
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags, booleans, multi }
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

/**
 * candidates 子命令组：进化管线现状只读面（薄壳——语义全在 @studio-next/store 读面，
 * candidatesByStatus 全状态集=全量；只列不改）。库不存在即拒：只读面不代建库（panel 同款
 * existsSync 闸——openLedger 会建库迁移，代建即副作用，违「只读」语义）。
 */
async function cmdCandidates(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub !== 'list') {
    if (sub !== undefined && sub !== '-h' && sub !== '--help' && sub !== 'help') {
      console.error(`未知 candidates 子命令：${sub}`)
    }
    console.error(USAGE)
    return sub === undefined || sub === '-h' || sub === '--help' || sub === 'help' ? 0 : 1
  }
  const parsed = parseArgv(rest, new Set(['db']))
  if ('error' in parsed) {
    console.error(`candidates list：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`candidates list：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('candidates list：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const resolved = path.resolve(dbPath)
  if (!existsSync(resolved)) {
    console.error(`candidates list：库不存在：${resolved}（只读面不代建库——先由 daemon/回填侧建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolved)
    try {
      const rows = ledger.candidatesByStatus([...CANDIDATE_STATUS_VALUES])
      const byStatus = new Map<string, number>()
      for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
      const dist = [...byStatus.entries()].map(([s, n]) => `${s}=${n}`).join(' ')
      console.log(`候选 ${rows.length} 条${dist === '' ? '（库空）' : `（${dist}）`}——库 ${resolved}（schema v${ledger.version()}，只读）`)
      for (const r of rows) {
        const hash = r.diff_hash.length > 17 ? `${r.diff_hash.slice(0, 17)}…` : r.diff_hash
        console.log(
          `${r.id}  ${r.status.padEnd(9)}  ${r.asset_type.padEnd(10)}  ${r.blast_radius.padEnd(10)}  ${r.version.padEnd(12)}  parent=${r.parent_id ?? '—（初代）'}  ${r.asset_path}  ${hash}`,
        )
      }
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 坏库/坏行（CONFIG_INVALID 形状）如实分类上报
    console.error(`candidates list 失败：${errText(err)}`)
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

/** 人事档案文件发现（与 company/multifile isPersonFile 同规则：departments 任意深度下的 people/<工号>.md） */
const PERSON_FILE_RE = /(?:^|\/)departments\/[^/]+\/people\/([^/]+)\.md$/

/**
 * org-config.yaml 单行 mission 提取（**拟稿**：契约 CompanySnapshot 无 mission 字段，本 CLI
 * 以单行 `mission: <标量>` 近似提取——见 panel/overview/server.ts 头注拟稿；块标量形态漏读
 * → undefined → 页面如实显示「未提供」）。引号壳先剥；裸标量剥「 #」行内注释。
 */
function extractMission(orgConfigSrc: string | undefined): string | undefined {
  if (orgConfigSrc === undefined) return undefined
  const m = /^[ \t]*mission:[ \t]*(\S.*)$/m.exec(orgConfigSrc)
  const raw = m?.[1]?.trim()
  if (raw === undefined || raw === '') return undefined
  let value = raw
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    value = value.slice(1, -1)
  } else {
    const hash = value.indexOf(' #')
    if (hash >= 0) value = value.slice(0, hash)
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * overview 子命令：:8789 公司概览面薄壳（语义全在 @studio-next/panel/overview）。
 * 挂载语义：逐目录 readDirectoryFiles → loadCompanyDirectory（校验不过拒绝挂载——04-§九）；
 * 快照挂载时装载并缓存（目录变更=重新挂载；热更归 daemon 后续刀）；档案正文按文件名=工号
 * 建映射（校验器保证文件名与 front-matter id 一致）。默认只绑本机。
 */
async function cmdOverview(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port']), new Set(['company']))
  if ('error' in parsed) {
    console.error(`overview：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`overview：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    console.error('overview：至少给一个 --company <公司目录>（可重复给多家）')
    console.error(USAGE)
    return 1
  }
  let port = 8789
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`overview：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }

  const companies: OverviewCompanySource[] = []
  for (const dir of companyDirs) {
    const resolved = path.resolve(dir)
    let files: Record<string, string>
    try {
      files = await readDirectoryFiles(resolved)
    } catch (err) {
      console.error(`overview：读取公司目录失败 ${resolved}：${errText(err)}`)
      return 1
    }
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      console.error(`overview：公司目录校验不通过（拒绝挂载，docs/04-§九）：${resolved}`)
      for (const issue of mounted.issues) console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
      return 1
    }
    const snapshot = mounted.snapshot
    const personFiles = new Map<string, string>()
    for (const [p, content] of Object.entries(files)) {
      const m = PERSON_FILE_RE.exec(p)
      if (m !== null && m[1] !== undefined) personFiles.set(m[1], content)
    }
    const mission = extractMission(files['org-config.yaml'])
    companies.push({
      slug: snapshot.slug,
      snapshotProvider: () => snapshot,
      ...(mission !== undefined ? { mission } : {}),
      readPersonFile: (personId) => personFiles.get(personId),
    })
  }

  let handle
  try {
    handle = await serveOverview(port, companies, parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : undefined)
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`overview 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[overview] :8789 公司概览面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[overview] 已挂载：${companies.map((c) => c.slug).join('、')}${parsed.flags.db !== undefined ? `；台账：${path.resolve(parsed.flags.db)}（零写）` : '；无台账（progress/finance 页如实显示无台账数据）'}`)
  console.log('[overview] 端面：/ 公司清单｜/<slug>/ 概览｜/<slug>/org 组织｜/<slug>/people 人事｜/<slug>/people/<工号> 档案｜/<slug>/progress 进度｜/<slug>/finance 财务')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[overview] 已优雅关闭')
  return 0
}

/**
 * external 子命令：:8788 对外 API 薄壳（语义全在 @studio-next/panel/external）。
 * 挂载语义与 overview 同款（逐目录 readDirectoryFiles → loadCompanyDirectory，校验不过
 * 拒绝挂载）；报表清单从目录文件集派生（reports/ 前缀——v0 只出清单不出正文）。
 * 触发面平台（拟稿）：fake 平台过真网关闸（createGatedPlatform——17-§7 写收口在 daemon
 * 侧装配，panel 包不碰 gateway）；DEV_GATEWAY_SECRET 开发密钥+警告，与 serve demo 同款，
 * 真平台接线与生产密钥归 daemon 装配后续刀。绑定面：缺省 127.0.0.1，--lan 显式绑 0.0.0.0
 * （D4 拟稿反转：D4「默认局域网」是部署意图，安全缺省只绑本机）。
 */
async function cmdExternal(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port', 'token', 'requests-per-minute']), new Set(['company']), new Set(['lan']))
  if ('error' in parsed) {
    console.error(`external：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`external：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    console.error('external：至少给一个 --company <公司目录>（可重复给多家）')
    console.error(USAGE)
    return 1
  }
  let port = 8788
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`external：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  let requestsPerMinute: number | undefined
  if (parsed.flags['requests-per-minute'] !== undefined) {
    requestsPerMinute = Number.parseInt(parsed.flags['requests-per-minute'], 10)
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
      console.error(`external：--requests-per-minute 取值非法：${parsed.flags['requests-per-minute']}（须为正整数）`)
      return 1
    }
  }

  const companies: ExternalCompanySource[] = []
  let firstSnapshot: CompanySnapshot | undefined
  for (const dir of companyDirs) {
    const resolved = path.resolve(dir)
    let files: Record<string, string>
    try {
      files = await readDirectoryFiles(resolved)
    } catch (err) {
      console.error(`external：读取公司目录失败 ${resolved}：${errText(err)}`)
      return 1
    }
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      console.error(`external：公司目录校验不通过（拒绝挂载，docs/04-§九）：${resolved}`)
      for (const issue of mounted.issues) console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
      return 1
    }
    const snapshot = mounted.snapshot
    if (firstSnapshot === undefined) firstSnapshot = snapshot
    companies.push({
      slug: snapshot.slug,
      snapshotProvider: () => snapshot,
      listReports: () =>
        Object.entries(files)
          .filter(([p]) => p.startsWith('reports/'))
          .map(([file, content]) => ({ file: file.slice('reports/'.length), bytes: content.length }))
          .filter((r) => !r.file.startsWith('.') && r.file !== ''), // 点文件（.gitkeep 占位）与目录本身不出清单
    })
  }

  // 触发面平台装配（拟稿）：fake 平台 + 真网关闸（issues.create 过 comment 动作词收口）。
  // 身份取首家快照（控制面无人员档案——与 serve daemonIdentity 同拟稿）；开发密钥+警告。
  const snapshotForIdentity = firstSnapshot as CompanySnapshot
  const ctx: SignatureContext = {
    company: snapshotForIdentity.name,
    dept: snapshotForIdentity.departments[0]?.path ?? 'departments/未挂部门',
    role: 'daemon',
    level: Math.max(1, snapshotForIdentity.level),
  }
  const author = ENGINE_CONFIG_DEFAULTS.actor
  const gateway = createGateway({
    secret: new TextEncoder().encode(DEV_GATEWAY_SECRET),
    clock: () => Date.now(),
    ticket: CONTROL_TICKET,
    ctx,
    author,
  })
  const platform = createGatedPlatform(createFakePlatform(), gateway, { ctx, author })
  console.warn('[external] 警告：触发面平台为 fake demo 骨架，网关密钥用开发缺省值（生产装配必配强密钥——17-§7；真平台接线归 daemon 后续刀）')

  const token = parsed.flags.token
  if (token === undefined && parsed.flags.db !== undefined) {
    console.warn('[external] 警告：给了 --db 但未给 --token——触发面全 401（fail-closed），只读信息面可用')
  }

  let handle
  try {
    handle = await serveExternal(port, companies, {
      ...(parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : {}),
      ...(token !== undefined ? { token } : {}),
      platform,
      ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
      ...(parsed.booleans.has('lan') ? { hostname: '0.0.0.0' } : {}),
    })
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`external 启动失败：${errText(err)}`)
    return 1
  }
  console.log(
    `[external] :8788 对外 API 已监听 → http://${handle.hostname}:${String(handle.port)}/v1/agent-card` +
      `${parsed.booleans.has('lan') ? '' : '（默认只绑本机——对局域网开放须 --lan，D4 拟稿反转）'}`,
  )
  console.log(
    `[external] 已挂载：${companies.map((c) => c.slug).join('、')}；` +
      (parsed.flags.db !== undefined ? `台账：${path.resolve(parsed.flags.db)}（触发面 kv 幂等写；信息面零写）` : '无台账（issues/finance 如实降级；触发面 501）') +
      (token !== undefined ? '' : '；触发面未配令牌（POST /v1/requests 全 401——fail-closed）'),
  )
  console.log('[external] 端面：/v1/agent-card｜/v1/company｜/v1/org｜/v1/people｜/v1/projects｜/v1/issues｜/v1/finance｜/v1/reports｜POST /v1/requests（token）｜/v1/events（501 占位）')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[external] 已优雅关闭')
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
    case 'candidates':
      return cmdCandidates(rest)
    case 'panel':
      return cmdPanel(rest)
    case 'overview':
      return cmdOverview(rest)
    case 'external':
      return cmdExternal(rest)
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
