// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L359-L576 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { companyAddGitUrl, deriveDirNameFromGitUrl } from '@studio-next/company'
import { materializeCompanyRepoInput, renderRepoValidation, repoValidationJson, validateCompanyRepo } from '@studio-next/company'
import { RepoInputError } from '@studio-next/company'
import { CREATE_PLATFORMS, companyCreate } from '@studio-next/company'
import type { CreatePlatform } from '@studio-next/company'
import { createLocalPlatform } from '@studio-next/localplatform'
import { openLedger } from '@studio-next/store'
import type { FlowPlatform } from '@studio-next/contract'
import { seedJobs } from '../serve.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdCompanyAdd(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['dir', 'work-root', 'plugin-root', 'platform-root', 'aiws-root', 'by']))
  if ('error' in parsed) {
    console.error(`company add：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const gitUrl = parsed.positionals[0]
  if (gitUrl === undefined) {
    console.error('company add：缺少 <git-url>（例：studio-next company add /path/to/company-repo my-corp）')
    console.error(USAGE)
    return 1
  }
  const name = parsed.positionals[1]
  if (parsed.positionals.length > 2) {
    console.error(`company add：多余的位置参数：${parsed.positionals.slice(2).join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const targetDir = path.resolve(parsed.flags.dir ?? path.join(parsed.flags['work-root'] ?? process.cwd(), name ?? deriveDirNameFromGitUrl(gitUrl)))
  const workRoot = path.resolve(parsed.flags['work-root'] ?? path.dirname(targetDir))
  const platformRoot = path.resolve(parsed.flags['platform-root'] ?? path.join(workRoot, 'var', 'platform'))
  const pluginRoot = path.resolve(parsed.flags['plugin-root'] ?? path.join(workRoot, 'var', 'plugins'))

  try {
    const platform = createLocalPlatform(platformRoot)
    const result = await companyAddGitUrl({
      gitUrl,
      ...(name !== undefined && parsed.flags.dir === undefined && parsed.flags['work-root'] !== undefined ? { name } : {}),
      targetDir,
      platform,
      pluginRoot,
      ...(parsed.flags['aiws-root'] !== undefined ? { aiwsRoot: path.resolve(parsed.flags['aiws-root']) } : {}),
      ...(parsed.flags.by !== undefined ? { importedBy: parsed.flags.by } : {}),
    })
    console.log(`公司目录：${result.dir}（slug=${result.slug}${result.upgraded ? '；升级通道' : '；首次导入'}${result.upgraded && !result.contentChanged ? '·内容未变幂等' : ''}）`)
    console.log(`git 提交：${result.gitCommit}`)
    console.log(`信任锚：.studio-next/trust.json trust=false（待制作人批准——docs/44 v1 信任锚设计）`)
    console.log(`平台字段 provision：${result.provisioned ? `已落 ${platformRoot}` : '未走（公司未声明 platform: localfile）'}`)
    console.log(`员工工作区树：${result.aiws.root}（${result.aiws.personDirs.length} 个工号文件夹）`)
    if (result.install !== undefined) {
      const items = result.install.items.map((i) => `${i.name}:${i.action}`).join('、')
      console.log(`依赖清单安装：${items === '' ? '（无依赖清单=零行为面）' : items}${result.install.confirmed ? '' : '；确认位=false 零落盘'}`)
      console.log(`安装清单日志：${result.install.logFile}`)
    }
    return 0
  } catch (err) {
    // ClassifiedError(CONFIG_INVALID) 面向上报（宁失败不半成品——fresh 通道产物已撤除）
    console.error(`company add 失败：${errText(err)}`)
    return 1
  }
}

/**
 * company create <slug> [名] —— 公司创建编排（DEV-15 / docs/36-§4 M-B 骨架刀）
 *
 * 链路（docs/36-§2⑤ 一条命令串完；幂等——同命令再跑=adopt 收敛）：init（模板→自检→git
 * 首提+平台绑定行）→ localfile 字段 provision → 全员建号（.AIWS 工位树+账号锚点断言）
 * → jobs 播种（seedJobs：新岗下槽不抢跑、既有行保序）→ 依赖清单安装（隔离插件根）→
 * 验收报告（<work-root>/var/create-reports/<slug>.md 覆盖式）。--dry-run 全相位零落盘。
 * 依赖组装在本壳：platform=localfile（M-B 唯一接线平台）、jobsSeeder=seedJobs 形状闭包
 * （开台账→播种→关台账；库不存在则随创建建库——create 是引导写面，与只读命令的
 * 「不代建库」闸不同向）。
 */
export async function cmdCompanyCreate(argv: string[]): Promise<number> {
  const parsed = parseArgv(
    argv,
    new Set(['name', 'dir', 'template', 'platform', 'work-root', 'db', 'plugin-root', 'platform-root', 'aiws-root', 'by']),
    undefined,
    new Set(['dry-run']),
  )
  if ('error' in parsed) {
    console.error(`company create：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const slug = parsed.positionals[0]
  if (slug === undefined) {
    console.error('company create：缺少 <slug>（例：studio-next company create demo-corp --platform localfile）')
    console.error(USAGE)
    return 1
  }
  const name = parsed.flags.name ?? parsed.positionals[1]
  if (parsed.positionals.length > 2) {
    console.error(`company create：多余的位置参数：${parsed.positionals.slice(2).join(' ')}`)
    console.error(USAGE)
    return 1
  }
  let platform: CreatePlatform | undefined
  if (parsed.flags.platform !== undefined) {
    if (!(CREATE_PLATFORMS as readonly string[]).includes(parsed.flags.platform)) {
      console.error(`company create：--platform 只收 ${CREATE_PLATFORMS.join('、')}（M-B 骨架只接 localfile——taiga/youtrack 接线归后续单，docs/36-§2③）`)
      return 1
    }
    platform = parsed.flags.platform as CreatePlatform
  }

  const targetDir = path.resolve(parsed.flags.dir ?? path.join(parsed.flags['work-root'] ?? process.cwd(), slug))
  const workRoot = path.resolve(parsed.flags['work-root'] ?? path.dirname(targetDir))
  const platformRoot = path.resolve(parsed.flags['platform-root'] ?? path.join(workRoot, 'var', 'platform'))
  const pluginRoot = path.resolve(parsed.flags['plugin-root'] ?? path.join(workRoot, 'var', 'plugins'))
  const dbPath = path.resolve(parsed.flags.db ?? path.join(workRoot, 'var', 'ledger.sqlite'))
  const dryRun = parsed.booleans.has('dry-run')

  try {
    const result = await companyCreate({
      slug,
      ...(name !== undefined ? { name } : {}),
      targetDir,
      ...(parsed.flags.template !== undefined ? { templateDir: parsed.flags.template } : {}),
      ...(platform !== undefined ? { platform } : {}),
      // 惰性工厂：localplatform 构造即 ensureDir——dry-run 从不解析，零落盘契约不破
      platformPort: (): FlowPlatform => createLocalPlatform(platformRoot),
      pluginRoot,
      dryRun,
      ...(parsed.flags['aiws-root'] !== undefined ? { aiwsRoot: path.resolve(parsed.flags['aiws-root']) } : {}),
      ...(parsed.flags.by !== undefined ? { createdBy: parsed.flags.by } : {}),
      jobsSeeder: (jobs, now) => {
        const ledger = openLedger(dbPath)
        try {
          return seedJobs(ledger, jobs, now)
        } finally {
          ledger.close()
        }
      },
    })
    for (const p of result.phases) console.log(`[${p.phase}] ${p.status}：${p.detail}`)
    console.log(dryRun ? 'dry-run：零落盘（如上为全相位计划面）' : `验收报告：${result.reportFile}`)
    return 0
  } catch (err) {
    // ClassifiedError(CONFIG_INVALID) 面向上报（P1 fresh 失败已撤除半成品；P2+ 失败目录保留、再跑收敛）
    console.error(`company create 失败：${errText(err)}`)
    return 1
  }
}

export async function cmdCompany(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'add':
      return cmdCompanyAdd(rest)
    case 'create':
      return cmdCompanyCreate(rest)
    case 'validate':
      return cmdCompanyValidate(rest)
    case undefined:
      console.error('company：缺少子命令（当前支持：add、create、validate）')
      console.error(USAGE)
      return 1
    default:
      console.error(`company：未知子命令：${sub}（当前支持：add、create、validate）`)
      console.error(USAGE)
      return 1
  }
}

/**
 * company validate <git-url | 本地路径 | tarball> [--json] [--allow-extra] —— 公司仓库
 * 判定器（DEV-32；docs/51 规范正文：五契约规则集 A/B/C/D/E 全量）。
 *
 * 输入物化：目录→直用；tarball→系统 tar 解包（条目消毒：拒绝绝对路径与 .. 段）；
 * git-url→真实克隆（克隆产物即 E 组闸面）。退出码三角：0=合法（PASS+摘要+可初始化）；
 * 1=不合法（逐条违规 {规则号,文件,位置,违规描述,修复建议}——不许只说「校验失败」）；
 * 2=判定器自身错误（网络/权限/解包失败——RepoInputError 面，与仓库不合法严格区分）。
 * --json=机器面（违规四元组+via/alias+摘要一并 JSON 化）；--allow-extra=A-1 封闭集外
 * 路径豁免并留痕（不豁免 B/C/D/E 组）。
 */
export async function cmdCompanyValidate(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set<string>(), undefined, new Set(['json', 'allow-extra', 'product']))
  if ('error' in parsed) {
    console.error(`company validate：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const input = parsed.positionals[0]
  if (input === undefined) {
    console.error('company validate：缺少 <git-url | 本地路径 | tarball>（例：studio-next company validate /path/to/company-repo --json）')
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 1) {
    console.error(`company validate：多余的位置参数：${parsed.positionals.slice(1).join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const json = parsed.booleans.has('json')
  let materialized
  try {
    materialized = await materializeCompanyRepoInput(input)
  } catch (err) {
    // 判定器自身错误（路径不存在/网络失败/解包失败）——exit 2 面，与「仓库不合法」严格区分
    if (err instanceof RepoInputError) {
      console.error(json ? JSON.stringify({ ok: false, input, error: `repo-input/${err.message}` }) : `company validate：判定器自身错误（exit 2）：${err.message}`)
      return 2
    }
    console.error(`company validate：物化输入失败：${errText(err)}`)
    return 2
  }
  try {
    const result = await validateCompanyRepo(materialized.dir, {
      allowExtra: parsed.booleans.has('allow-extra'),
      face: parsed.booleans.has('product') ? 'product' : 'source',
    })
    const text = json ? repoValidationJson(result, input) : renderRepoValidation(result, input)
    if (result.ok) {
      console.log(text)
      return 0
    }
    console.error(text)
    return 1
  } catch (err) {
    console.error(`company validate：判定失败：${errText(err)}`)
    return 2
  } finally {
    await materialized.cleanup()
  }
}

