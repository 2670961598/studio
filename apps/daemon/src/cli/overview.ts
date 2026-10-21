// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1129-L1250 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { mountHotCompanySource, serveOverview } from '@studio-next/panel/overview'
import type { HotCompanyHandle, OverviewCompanySource } from '@studio-next/panel/overview'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'


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
 * DEV-12 刀二起挂「热」源（mountHotCompanySource）：快照带装载时间标注（JSON 读面
 * snapshotMeta），公司目录 fs.watch(recursive) 防抖热重载——目录变更下一请求即见，
 * 重载失败保旧图（lastError 亮在页面上）。档案正文按文件名=工号建映射（校验器保证
 * 文件名与 front-matter id 一致）。默认只绑本机。
 */
export async function cmdOverview(argv: string[]): Promise<number> {
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
  console.log(`[overview] :8789 公司概览面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[overview] 已挂载：${companies.map((c) => c.slug).join('、')}${parsed.flags.db !== undefined ? `；台账：${path.resolve(parsed.flags.db)}（零写）` : '；无台账（progress/finance 页如实显示无台账数据）'}`)
  console.log('[overview] 热重载：目录监听中（fs.watch recursive，防抖 150ms——目录变更下一请求即见；重载失败保旧图）/api/overview/* JSON 带 snapshotMeta 快照标注')
  console.log('[overview] 端面：/ 换装页（Naive UI+ECharts，SPA）｜/legacy 旧版只读面｜/api/overview/* JSON｜/<slug>/ 概览｜/<slug>/org|people|progress|finance 各 tab｜/<slug>/people/<工号> 档案')
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
 * 触发面平台（拟稿）：fake 平台过真网关闸（createGatedPlatform——17-§7 写收口在 daemon
 * 侧装配，panel 包不碰 gateway）；DEV_GATEWAY_SECRET 开发密钥+警告，与 serve demo 同款，
 * 真平台接线与生产密钥归 daemon 装配后续刀。绑定面：缺省 127.0.0.1，--lan 显式绑 0.0.0.0
 * （D4 拟稿反转：D4「默认局域网」是部署意图，安全缺省只绑本机）。
 */
