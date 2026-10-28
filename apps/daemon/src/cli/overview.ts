// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1129-L1250 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { mountHotCompanySource, serveOverview } from '@studio-next/panel/overview'
import type { HotCompanyHandle, OverviewCompanySource, ReportFileMeta } from '@studio-next/panel/overview'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import { errText, parseArgv } from './argv.ts'


/** 人事档案文件发现（与 company/multifile isPersonFile 同规则：departments 任意深度下的 people/<工号>.md） */
const PERSON_FILE_RE = /(?:^|\/)departments\/[^/]+\/people\/([^/]+)\.md$/

/** 报表树占位件过滤（与 harvest-recon deliverablesOf 同款：.gitkeep/.DS_Store 不是报表件） */
const REPORT_PLACEHOLDER_FILES = new Set(['.gitkeep', '.DS_Store'])

/**
 * 报表目录元数据扫描（127-B v1）：公司目录 reports/ 树 stat 递归——产出相对路径+大小+
 * mtime（**辅助列**数据源；时序权威=台账事件，P4）。目录不存在=空清单（公司还没落过报表
 * 件，如实）。单条目 stat 失败（权限等）跳过该条：辅助列读面尽力而为，不因单件不可读
 * 拒整面（归档缺失判定归台账事件对账，不靠本扫描）。占位件过滤同 harvest-recon。
 */
export function scanReportFiles(companyDir: string): ReportFileMeta[] {
  const root = path.join(companyDir, 'reports')
  if (!existsSync(root)) return []
  const out: ReportFileMeta[] = []
  const walk = (dir: string, prefix: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 目录级不可读：该子树退缺（辅助列尽力而为，不拒面）
    }
    for (const entry of entries) {
      if (REPORT_PLACEHOLDER_FILES.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(abs, rel)
        continue
      }
      if (!entry.isFile()) continue // 符号链接等非普通件不计（与 readDirectoryFiles 同口径）
      try {
        const st = statSync(abs)
        out.push({ relPath: `reports/${rel}`, sizeBytes: st.size, mtimeMs: st.mtimeMs })
      } catch {
        // 单件 stat 失败跳过：辅助列缺省在面板如实显示（读面未挂/不可读不判归档缺失）
      }
    }
  }
  walk(root, '')
  return out
}

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
 * DEV-12 刀二起挂「热」源（mountHotCompanySource）：快照带装载时间标注（JSON 读面
 * snapshotMeta），公司目录 fs.watch(recursive) 防抖热重载——目录变更下一请求即见，
 * 重载失败保旧图（lastError 亮在页面上）。档案正文按文件名=工号建映射（校验器保证
 * 文件名与 front-matter id 一致）。默认只绑本机。
 */
export async function cmdOverview(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.overview) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port']), new Set(['company']))
  if ('error' in parsed) {
    return usageFail('overview', parsed.error, CONCISE.overview)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('overview', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.overview)
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    return usageFail('overview', '至少给一个 --company <公司目录>（可重复给多家）', CONCISE.overview)
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
  const hotHandles: HotCompanyHandle[] = []
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
    const makeSource = (loaded: Record<string, string>, snapshot: CompanySnapshot): OverviewCompanySource => {
      const personFiles = new Map<string, string>()
      for (const [p, content] of Object.entries(loaded)) {
        const m = PERSON_FILE_RE.exec(p)
        if (m !== null && m[1] !== undefined) personFiles.set(m[1], content)
      }
      const mission = extractMission(loaded['org-config.yaml'])
      return {
        slug: snapshot.slug,
        snapshotProvider: () => snapshot,
        ...(mission !== undefined ? { mission } : {}),
        readPersonFile: (personId) => personFiles.get(personId),
        // 报表快照（reports/<…>.json）：目录读面已全量在手——loaded[ref] 直查（DEV-36 月报段；
        // 热源重载后新报即可见，无需重启进程）
        readReportFile: (jsonRef) => loaded[jsonRef],
        // 报表目录元数据（127-B v1）：reports/ 树 stat——大小/mtime 辅助列；闭包每次调用
        // 现扫（热源重载/新报表落盘后下一请求即见；panel 零 IO——本件是唯一磁盘读点）
        listReportFiles: () => scanReportFiles(resolved),
      }
    }
    const hot = mountHotCompanySource({
      directory: resolved,
      initial: makeSource(files, mounted.snapshot),
      reload: async () => {
        const fresh = await readDirectoryFiles(resolved)
        const remounted = loadCompanyDirectory(fresh)
        if (!remounted.ok) {
          throw new Error(
            `公司目录校验不通过（保旧图，docs/04-§九）：${remounted.issues.map((i) => `${i.file}:${i.line} [${i.rule}]`).join('；')}`,
          )
        }
        return makeSource(fresh, remounted.snapshot)
      },
    })
    hotHandles.push(hot)
    companies.push(hot.source)
  }

  let handle
  try {
    handle = await serveOverview(port, companies, parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : undefined)
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`overview 启动失败：${errText(err)}`)
    return 1
  }
  // E16③（studio-dev-103）：启动日志端口前缀=实际监听端口——原硬编码 :8789 在 --port 换口时谎报
  console.log(`[overview] :${String(handle.port)} 公司概览面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[overview] 已挂载：${companies.map((c) => c.slug).join('、')}${parsed.flags.db !== undefined ? `；台账：${path.resolve(parsed.flags.db)}（零写）` : '；无台账（progress/finance 页如实显示无台账数据）'}`)
  console.log('[overview] 热重载：目录监听中（fs.watch recursive，防抖 150ms——目录变更下一请求即见；重载失败保旧图）/api/overview/* JSON 带 snapshotMeta 快照标注')
  console.log('[overview] 端面：/ 换装页（Naive UI+ECharts，SPA）｜/legacy 旧版只读面｜/api/overview/* JSON｜/<slug>/ 概览｜/<slug>/org|people|progress|finance|reports 各 tab｜/<slug>/people/<工号> 档案')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  for (const hot of hotHandles) hot.close()
  console.log('[overview] 已优雅关闭（含目录监听器）')
  return 0
}

/**
 * external 子命令：:8788 对外 API 薄壳（语义全在 @studio-next/panel/external）。
 * 挂载语义与 overview 同款（逐目录 readDirectoryFiles → loadCompanyDirectory，校验不过
 * 拒绝挂载）；报表清单从目录文件集派生（reports/ 前缀——v0 只出清单不出正文）。
 * 触发面平台：写路径一律过真网关闸（createGatedPlatform——17-§7 写收口在 daemon 侧装配，
 * panel 包不碰 gateway）；签根**无开发缺省**（SEC-FC-02：只从部署秘密源注入 env
 * STUDIO_GATEWAY_SECRET，仓内不存密钥值——本注释原引的开发常量已随 IMPL-07-06 删除）。
 * 绑定面：缺省 127.0.0.1，--lan 显式绑 0.0.0.0（D4 拟稿反转：D4「默认局域网」是部署意图，
 * 安全缺省只绑本机）。
 */
