/**
 * company create —— 公司创建编排内核（DEV-15 / docs/36-§4 M-B 骨架刀）
 *
 * 规范依据：
 *   - docs/36-§2⑤（向导流执行面：init→platform onboard→建号→jobs 装载→插件 provisioning→
 *     验收报告，全程 --dry-run 可预演）与 §4 M-B（创建内核刀——依赖在飞的 onboard 写面与
 *     下批 daemon 接线刀；本骨架=端口注入面先行，接线归后续刀）
 *   - docs/30-§6（onboard 九步幂等基线：「全部资源先 GET 按名找、找到即 diff-复用」；
 *     ④=全员建号（memberships→register，平台侧）；localfile 无平台账号层——contract
 *     ports/platform.ts PlatformActivity.actor 注记）
 *   - docs/17-§2（调度表 jobs 表：定时岗全部来自公司目录配置——本命令 P4 播种面）
 *   - docs/17-§6（收割四要件：终态 completed+输出非空+REPORT 落盘+闸门 exit=0——P6
 *     报告面与退出码口径以此对齐）
 *   - docs/04-§二（accounts=账号锚点映射，账号=等级锚点）、§九（daemon 是公司目录唯一
 *     写入者——create 属 init 同款引导写 bootstrap）
 *   - docs/23-§二（换平台=改一行配置——create 时落 platform 绑定行）
 *   - docs/43-§四（依赖清单与插件绑定——P5 直接复用 installCompanyPlugins）、§五（.AIWS
 *     员工工作区树，不进公司 git 目录）
 *
 * 六相位（每相位幂等、可重入；同命令再跑=收敛不重建）：
 *   P1 init      模板→公司目录（复用 init.ts 全链）+ 平台绑定行落盘（§2③ 公司配置面的
 *                命令化：--platform，M-B 只接 localfile）。已有合法同 slug 目录=adopt
 *                （复用不重建）；已有异 slug/非公司目录=fail-closed 拒绝。
 *   P2 provision 平台字段/状态流 provision（FlowPlatform 端口注入；公司声明 platform=
 *                localfile 才走——与 git-import 同闸）。
 *   P3 accounts  全员建号：本地面=.AIWS 工位树（ensureAiwsTree）+ org-config 账号锚点
 *                一致性断言（people[].login ↔ accounts[]，等级锚点对齐；缺失=fail-closed，
 *                补写归 daemon 常规写后续单）；平台面=AccountProvisioner 注入位（taiga
 *                memberships 归端口扩展后续单，v0 骨架交付本地退化实现）。
 *   P4 jobs      快照 jobs → 台账 jobs 表播种（JobsSeeder 注入——seedJobs 语义：新岗
 *                next_run_at=cron 下槽不抢跑、既有行保序不清欠账；注入面避免
 *                company→daemon 反向依赖——依赖方向恒为 daemon→company）。
 *   P5 plugins   依赖清单安装（installCompanyPlugins：plan 决策+隔离根落位，天然幂等——
 *                satisfied/replace 行动词汇报）。
 *   P6 report    验收报告落盘（<workRoot>/var/create-reports/<slug>.md，覆盖式=末次 run；
 *                相位表+证据指针——17-§6「REPORT 落盘」的创建面对齐）。
 *
 * --dry-run：全相位只出计划零落盘——不 init、不 provision、不建树、不开台账、不装插件、
 * 不写报告文件（模板可挂载性以内存挂载证之；「占位替换面跑真路才可证」如实入报告边界注记）。
 *
 * 失败语义（宁失败不半成品）：P1 fresh 通道任一子步失败=整体撤除（initCompany 自带；平台
 * 绑定子步失败由本核撤除本 run 新建目录）；P2-P6 失败=目录保留（已是合法公司）、相位面上报
 * exit 1、再跑收敛（幂等契约）。--rollback 面（docs/30-§6）归后续单。
 */
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
import { configInvalid } from '@studio-next/contract'
import type { CompanySnapshot, FlowPlatform, PersonRef, ScheduledJob } from '@studio-next/contract'
import { initCompany, readDirectoryFiles, AIWS_DIR } from './init.ts'
import { deriveFieldProvision, extractOrgYt } from './git-import.ts'
import { ensureAiwsTree, type AiwsTreeResult } from './aiws.ts'
import { loadCompanyDirectory, SLUG_RE } from './validator.ts'
import { installCompanyPlugins, extractPersonAttrs } from './dependencies.ts'
import type { PluginInstallReport } from './dependencies.ts'

/** M-B 骨架接线的平台集（docs/36-§2③：仅列「capabilities 已声明适配」的选项） */
export const CREATE_PLATFORMS = ['localfile'] as const
export type CreatePlatform = (typeof CREATE_PLATFORMS)[number]

/** 相位名（固定序——报告表与测试断言的共同锚） */
export const CREATE_PHASES = ['init', 'provision', 'accounts', 'jobs', 'plugins', 'report'] as const
export type CreatePhaseName = (typeof CREATE_PHASES)[number]

/**
 * 相位状态词汇（封闭枚举，报告表消费）：
 *   created     本 run 新建（init fresh）
 *   adopted     复用既有合法目录（幂等再跑的主形态）
 *   provisioned 已执行 provision / 建号 / 播种 / 安装（本 run 落了写动作——动作本身幂等）
 *   skipped     注入缺失或闸未开（如实上报原因，不静默）
 *   planned     dry-run 计划面（零落盘）
 */
export type CreatePhaseStatus = 'created' | 'adopted' | 'provisioned' | 'skipped' | 'planned'

export interface CreatePhaseOutcome {
  phase: CreatePhaseName
  status: CreatePhaseStatus
  /** 单行摘要（报告表与 CLI 输出共用——人可读证据面） */
  detail: string
}

/** 全员建号注入位（P3 平台面）：localfile 退化实现见 createLocalAnchorAccounts */
export interface AccountProvisioner {
  /** 实现名（报告可见性：'localfile-anchors' | 'taiga-memberships' | …） */
  readonly kind: string
  provisionMembers(input: { slug: string; dryRun: boolean; people: readonly PersonRef[] }): Promise<AccountProvisionReport>
}

export interface AccountProvisionReport {
  /** 平台侧已建号数（localfile 恒 0——无平台账号层） */
  provisioned: number
  /** 既有号复用数（localfile=锚点已声明且对齐数） */
  reused: number
  note: string
}

/** jobs 播种注入位（P4）：daemon 侧 seedJobs 的形状（seeded/kept——幂等观测面） */
export type JobsSeeder = (jobs: readonly ScheduledJob[], now: number) => { seeded: number; kept: number }

export interface CompanyCreateOptions {
  slug: string
  /** 公司名（缺省=slug；透传 init） */
  name?: string
  /** 公司目录（缺省=<workRoot>/<slug>） */
  targetDir?: string
  /** 模板目录（缺省仓根 templates/company-2-level——透传 init） */
  templateDir?: string
  /** 工作根（缺省=targetDir 同级；.AIWS/var 布局锚点——docs/43 布局同款） */
  workRoot?: string
  /**
   * 平台绑定（M-B：localfile；缺省不落绑定行=沿用模板缺省 youtrack）。
   * 落盘行=org-config company.platform（docs/23-§二「换平台=改一行配置」的创建时定版）。
   */
  platform?: CreatePlatform
  /**
   * FlowPlatform 端口注入（P2；不给=skipped）。可给实例或**惰性工厂**——dry-run 从不解析
   * 工厂（实现可能在构造时落目录，如 localplatform 的 ensureDir；零落盘契约因此要求
   * CLI/测试侧传工厂而非实例）。
   */
  platformPort?: FlowPlatform | (() => FlowPlatform)
  /** 建号面注入（P3 平台面；不给=本地退化实现） */
  accounts?: AccountProvisioner
  /** jobs 播种注入（P4；不给=skipped） */
  jobsSeeder?: JobsSeeder
  /** 隔离插件根（P5；不给=skipped——绝不缺省写用户 ~/.dsh，docs/43-§四） */
  pluginRoot?: string
  /** .AIWS 树根（缺省=<workRoot>/.AIWS——不进公司 git 目录，docs/43-§五） */
  aiwsRoot?: string
  /** 报告落盘根（缺省=<workRoot>/var/create-reports） */
  reportRoot?: string
  dryRun?: boolean
  createdBy?: string
  now?: () => Date
  /** 插件安装确认位（透传 installCompanyPlugins；拒=false 只出计划零落盘） */
  confirmInstall?: (view: { company: string; planned: { name: string; action: string }[] }) => boolean | Promise<boolean>
}

export interface CompanyCreateResult {
  slug: string
  dir: string
  /** git 提交（fresh=平台绑定/首提；adopt=当前 HEAD；dry-run=undefined） */
  gitCommit?: string
  /** 目录快照（dry-run fresh=模板内存挂载快照——计划面计数用） */
  snapshot: CompanySnapshot
  /** 相位结果（固定序） */
  phases: readonly CreatePhaseOutcome[]
  /** .AIWS 建树结果（dry-run=零工位——计划面计数入 detail） */
  aiws: AiwsTreeResult
  /** 报告文件路径（dry-run=undefined——零落盘） */
  reportFile?: string
  install?: PluginInstallReport
}

/** git 提交身份（repo 局部配置——与 git-import 同款纪律：不依赖机器全局身份，确定性） */
const GIT_IDENTITY = { name: 'studio-next-create', email: 'create@studio-next.invalid' }

/** 默认模板：与 init.ts 同源（仓根 templates/company-2-level；dry-run 计划面预检用） */
function defaultTemplateDir(): string {
  return fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))
}

/** 挂载公司目录（失败=CONFIG_INVALID；create 通道专用错误码带上修法） */
async function mountOrReject(dir: string, what: string): Promise<CompanySnapshot> {
  let files: Record<string, string>
  try {
    files = await readDirectoryFiles(dir)
  } catch (err) {
    configInvalid('create/target-unreadable', `${what}：目录不可读（${dir}）：${err instanceof Error ? err.message : String(err)}`)
  }
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) {
    configInvalid(
      'create/target-not-company',
      `${what}：目录未过公司目录校验（docs/04-§二）——create 只收本框架公司目录：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`,
    )
  }
  return mounted.snapshot
}

/**
 * 平台绑定行落盘（fresh 通道子步）：org-config company 段插入 `platform: <name>`。
 * 锚点=列 0 的 `company:` 行（validator 必收段——找不到即模板漂移 fail-closed）。
 * 写后重挂载自检（先检后写同款纪律的反向：写后回读），不合法即抛（调用方撤除半成品）。
 */
async function writePlatformBinding(targetDir: string, platform: CreatePlatform, slug: string): Promise<void> {
  const orgPath = path.join(targetDir, 'org-config.yaml')
  const src = await readFile(orgPath, 'utf8')
  const lines = src.split('\n')
  const anchor = lines.findIndex((l) => l === 'company:')
  if (anchor === -1) {
    configInvalid('create/platform-anchor-missing', 'org-config.yaml 缺列 0 的「company:」段锚（模板漂移——停手改模板对齐，docs/04-§二）')
  }
  if (lines.some((l) => /^\s*platform:/u.test(l))) {
    configInvalid('create/platform-already-bound', 'org-config.yaml 已有 platform 行——绑定只落一次（再跑应走 adopt 通道；此为模板漂移）')
  }
  lines.splice(anchor + 1, 0, `  platform: ${platform} # 创建时定版（docs/23-§二 换平台=改一行配置；studio-next company create）`)
  await writeFile(orgPath, lines.join('\n'), 'utf8')
  const snapshot = await mountOrReject(targetDir, '平台绑定后自检')
  if (snapshot.platform.platform !== platform) {
    configInvalid('create/platform-bind-failed', `平台绑定回读不符：期望 ${platform}，实得 ${snapshot.platform.platform}（slug=${slug}）`)
  }
}

/** 模板内存挂载（dry-run fresh 通道：证「模板可挂载」而不落盘） */
async function mountTemplate(templateDir: string): Promise<CompanySnapshot> {
  if (!existsSync(templateDir)) {
    configInvalid('create/template-missing', `模板目录不存在：${templateDir}`)
  }
  const mounted = loadCompanyDirectory(await readDirectoryFiles(templateDir))
  if (!mounted.ok) {
    configInvalid(
      'create/template-not-mountable',
      `模板未过目录校验（dry-run 计划面即拒——docs/04-§二）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`,
    )
  }
  return mounted.snapshot
}

/**
 * localfile 建号退化实现（P3 平台面缺省）：无平台账号层（contract ports/platform.ts 注记：
 * 「LocalFile 例外=工号——本就无平台账号层」），建号=org-config 账号锚点一致性断言——
 * people[].login 必须有 accounts[] 锚且等级锚点对齐（账号=等级锚点，工号=人；docs/04-§二）。
 * 缺失/错档=fail-closed（补写常规面归 daemon 后续单——本核只断言不代写）。
 */
export function createLocalAnchorAccounts(orgConfigSrc: string): AccountProvisioner {
  return {
    kind: 'localfile-anchors',
    async provisionMembers(input): Promise<AccountProvisionReport> {
      const anchors = parseAccountAnchors(orgConfigSrc)
      let reused = 0
      const missing: string[] = []
      const mismatched: string[] = []
      for (const p of input.people) {
        const hit = anchors.get(p.login)
        if (hit === undefined) {
          missing.push(`${p.id}→${p.login}`)
        } else if (hit !== p.level) {
          mismatched.push(`${p.login}: 账号锚 ${hit} 级，人档案 ${p.level} 级`)
        } else {
          reused += 1
        }
      }
      if (missing.length > 0 || mismatched.length > 0) {
        const parts: string[] = []
        if (missing.length > 0) parts.push(`缺账号锚：${missing.join('、')}（org-config.yaml accounts 段补 {login, level} 行——建号补写面归 daemon 常规写后续单）`)
        if (mismatched.length > 0) parts.push(`等级锚点错档：${mismatched.join('、')}（账号=等级锚点，须与人档案 level 相等——docs/04-§二）`)
        configInvalid('create/accounts-inconsistent', parts.join('\n'))
      }
      return { provisioned: 0, reused, note: `localfile 无平台账号层——${reused} 个账号锚点全对齐（平台侧 memberships 建号归端口扩展后续单，docs/30-§6④）` }
    },
  }
}

/** org-config accounts 段轻解析（login→level；条目可跨行——`- login: x` 起条、缩进
 *  `level: n` 归条；全量校验已在 loadCompanyDirectory 过，此处只取锚点视图） */
function parseAccountAnchors(orgSrc: string): Map<string, number> {
  const out = new Map<string, number>()
  let current: string | undefined
  for (const line of linesOfYamlSection(orgSrc, 'accounts')) {
    const itemStart = /^\s*-\s*login:\s*(\S+)/u.exec(line)
    if (itemStart !== null) {
      current = itemStart[1]
      continue
    }
    const lv = /^\s*level:\s*(\d+)/u.exec(line)
    if (current !== undefined && lv !== null) {
      out.set(current, Number(lv[1]))
      current = undefined
    }
  }
  return out
}

/** 取 YAML 顶段行（`accounts:` 起、下一顶段止——轻量行扫；形状耦合已在校验闸收口） */
function linesOfYamlSection(src: string, section: string): string[] {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l === `${section}:`)
  if (start === -1) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string
    if (/^\S/u.test(line)) break
    out.push(line)
  }
  return out
}

/** 验收报告渲染（P6；md 落盘与 stdout 行共用一源——证据面不双写漂移） */
export function renderCreateReport(input: {
  slug: string
  dir: string
  at: string
  by: string
  dryRun: boolean
  phases: readonly CreatePhaseOutcome[]
  gitCommit?: string
  aiws: AiwsTreeResult
  install?: PluginInstallReport
}): string {
  const table = input.phases.map((p) => `| ${p.phase} | ${p.status} | ${p.detail} |`).join('\n')
  const installLine =
    input.install !== undefined
      ? `- 插件安装清单：${input.install.logFile}（${input.install.items.map((i) => `${i.name}:${i.action}`).join('、') || '无依赖面'}）`
      : '- 插件安装：未走（未注入隔离插件根）'
  return [
    `# company create 验收报告 · ${input.slug}`,
    '',
    `- 时间：${input.at}｜动作人：${input.by}｜模式：${input.dryRun ? 'dry-run（零落盘计划面）' : '执行'}`,
    `- 公司目录：${input.dir}${input.gitCommit !== undefined ? `｜git：${input.gitCommit.slice(0, 12)}` : ''}`,
    `- 相位数：${input.phases.length}/${CREATE_PHASES.length}（docs/36-§2⑤ 链）`,
    '',
    '| 相位 | 状态 | 摘要 |',
    '|---|---|---|',
    table,
    '',
    `- 员工工作区树：${input.aiws.root}（${input.aiws.personDirs.length} 个工号文件夹，不进公司 git 目录——docs/43-§五）`,
    installLine,
    input.dryRun
      ? '- 边界：dry-run 只证模板可挂载与计划面——占位替换/git 首提/provision/播种/安装跑真路才可证（docs/36-§2⑤「全程 --dry-run 可预演」的诚实面）'
      : '- 幂等：同命令再跑=adopt+收敛（不重建；报告覆盖为本文件——docs/30-§6 幂等基线）',
    '',
    '规范依据：docs/36-§2⑤/§4 M-B｜docs/17-§2（jobs 播种面）｜docs/17-§6（报告落盘口径）｜docs/30-§6（onboard 幂等基线）｜docs/43-§四/§五',
    '',
  ].join('\n')
}

/**
 * 公司创建编排（六相位；幂等；--dry-run 零落盘）。
 * 成功=全相位过 + 报告落盘（dry-run=计划面随返回值，零落盘）；失败抛 ClassifiedError(CONFIG_INVALID)。
 */
export async function companyCreate(opts: CompanyCreateOptions): Promise<CompanyCreateResult> {
  // 入口闸（三验——fresh 通道 initCompany 会再验，dry-run/adopt 通道在此收口）
  if (!SLUG_RE.test(opts.slug)) {
    configInvalid('create/bad-slug', `slug 必须形如 my-corp（小写字母/数字/连字符，非空、两端不断字——概览路由 /<slug>/ 的 URL 片段），实得 ${JSON.stringify(opts.slug)}`)
  }
  if (opts.name !== undefined && opts.name.trim() === '') {
    configInvalid('create/bad-name', '公司名不能为空白')
  }
  if (opts.platform !== undefined && !(CREATE_PLATFORMS as readonly string[]).includes(opts.platform)) {
    configInvalid('create/bad-platform', `--platform 只收 ${CREATE_PLATFORMS.join('、')}（M-B 骨架只接 localfile——taiga/youtrack 接线归后续单，docs/36-§2③「仅列已声明适配的选项」）`)
  }

  const now = opts.now ?? ((): Date => new Date())
  const by = opts.createdBy ?? 'producer'
  const targetDir = path.resolve(opts.targetDir ?? path.join(opts.workRoot ?? process.cwd(), opts.slug))
  const workRoot = path.resolve(opts.workRoot ?? path.dirname(targetDir))
  const aiwsRoot = path.resolve(opts.aiwsRoot ?? path.join(workRoot, AIWS_DIR))
  const reportRoot = path.resolve(opts.reportRoot ?? path.join(workRoot, 'var', 'create-reports'))
  const dryRun = opts.dryRun === true
  const phases: CreatePhaseOutcome[] = []

  // ———— P1 init：adopt-or-create（幂等主形态=adopt） ————
  const occupied = targetOccupied(targetDir)
  let snapshot: CompanySnapshot
  let gitCommit: string | undefined

  if (occupied) {
    snapshot = await mountOrReject(targetDir, 'adopt 通道')
    if (snapshot.slug !== opts.slug) {
      configInvalid('create/slug-mismatch', `目标目录是 ${snapshot.slug} 的公司，命令给 ${opts.slug}——错家公司拒收（slug=org-config company.slug，单一事实源）`)
    }
    if (opts.platform !== undefined && snapshot.platform.platform !== opts.platform) {
      configInvalid('create/platform-mismatch', `目标目录平台绑定是 ${snapshot.platform.platform}，命令给 ${opts.platform}——平台绑定创建时定版（docs/23-§二），换平台走配置批示面`)
    }
    gitCommit = await headOf(targetDir)
    phases.push({ phase: 'init', status: 'adopted', detail: `复用既有合法目录（slug=${snapshot.slug}${gitCommit !== undefined ? `，HEAD ${gitCommit.slice(0, 12)}` : '，无 git——adopt 不补建'}）` })
  } else if (dryRun) {
    snapshot = await mountTemplate(path.resolve(opts.templateDir ?? defaultTemplateDir()))
    phases.push({ phase: 'init', status: 'planned', detail: `将从模板生成 ${targetDir}（模板内存挂载通过：${snapshot.people.length} 人/${snapshot.departments.length} 部门/${snapshot.jobs.length} 岗）` })
  } else {
    try {
      const init = await initCompany({ slug: opts.slug, ...(opts.name !== undefined ? { name: opts.name } : {}), targetDir, ...(opts.templateDir !== undefined ? { templateDir: opts.templateDir } : {}) })
      if (opts.platform !== undefined) {
        await writePlatformBinding(targetDir, opts.platform, opts.slug)
        const git = simpleGit(targetDir)
        await git.addConfig('user.name', GIT_IDENTITY.name)
        await git.addConfig('user.email', GIT_IDENTITY.email)
        gitCommit = await commitAll(targetDir, `create: 平台绑定落 ${opts.platform}（slug=${opts.slug}；docs/23-§二——studio-next company create）`)
      } else {
        gitCommit = init.gitCommit
      }
    } catch (err) {
      // P1 整体撤除（fresh 通道本 run 新建目录——init 子步失败 initCompany 自撤，绑定子步失败此处兜底撤）
      await rmQuiet(targetDir)
      throw err
    }
    snapshot = await mountOrReject(targetDir, 'init 后自检')
    phases.push({ phase: 'init', status: 'created', detail: `模板→目录+自检+git${opts.platform !== undefined ? `+平台绑定 ${opts.platform}` : ''}（HEAD ${gitCommit?.slice(0, 12) ?? '?'}）` })
  }

  // org-config 源（P2/P3/P5 消费；dry-run fresh=模板源不落盘——空串走缺省映射）
  const orgSrc = occupied || !dryRun ? await readFile(path.join(targetDir, 'org-config.yaml'), 'utf8') : ''
  const provisionMap = deriveFieldProvision(extractOrgYt(orgSrc))
  // P2 判定用有效平台：dry-run fresh 按命令声明的绑定计划（绑定行将是 init 子步产物），
  // 其余通道按目录事实（snapshot.platform——org-config 单一事实源）
  const effectivePlatform = dryRun && !occupied && opts.platform !== undefined ? opts.platform : snapshot.platform.platform

  // ———— P2 provision：平台字段/状态流（端口注入；localfile 闸——与 git-import 同判） ————
  if (opts.platformPort === undefined) {
    phases.push({ phase: 'provision', status: 'skipped', detail: '未注入 FlowPlatform 端口（CLI 缺省注入 localfile；taiga/youtrack 接线归后续单）' })
  } else if (effectivePlatform !== 'localfile') {
    phases.push({ phase: 'provision', status: 'skipped', detail: `公司平台=${effectivePlatform}≠localfile——M-B 骨架只 provision localfile（docs/23-§二）` })
  } else if (dryRun) {
    phases.push({ phase: 'provision', status: 'planned', detail: `将落字段/状态流 provision（${provisionMap.states.join('→')}；幂等=同值重落）` })
  } else {
    const port = typeof opts.platformPort === 'function' ? opts.platformPort() : opts.platformPort
    await port.fields.provision(provisionMap)
    phases.push({ phase: 'provision', status: 'provisioned', detail: `字段/状态流已落（${provisionMap.states.join('→')}；重跑同值收敛——docs/30-§6 幂等基线）` })
  }

  // ———— P3 accounts：全员建号（本地面 .AIWS+锚点断言；平台面注入位） ————
  const provisioner = opts.accounts ?? createLocalAnchorAccounts(orgSrc)
  const aiwsExisted = existsSync(aiwsRoot)
  let aiws: AiwsTreeResult
  if (dryRun) {
    aiws = { root: aiwsRoot, personDirs: [], created: 0, archived: [] }
    phases.push({ phase: 'accounts', status: 'planned', detail: `将建 ${AIWS_DIR} 工位树（${snapshot.people.length} 工号文件夹）+ 账号锚点断言（${provisioner.kind}）` })
  } else {
    // slug=本司真 slug：per-company 根守卫（docs/43-§十9 不并树）+ 增量同步（幂等可重入）
    aiws = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug, now })
    const report = await provisioner.provisionMembers({ slug: snapshot.slug, dryRun, people: snapshot.people })
    phases.push({
      phase: 'accounts',
      status: 'provisioned',
      detail: `${AIWS_DIR} ${aiwsExisted ? '复用' : '新建'}（${aiws.personDirs.length} 工位${aiws.archived.length > 0 ? `、归档 ${aiws.archived.length}` : ''}）+ ${provisioner.kind}：${report.note}`,
    })
  }

  // ———— P4 jobs：快照→台账播种（注入面；seeded/kept 幂等观测） ————
  if (opts.jobsSeeder === undefined) {
    phases.push({ phase: 'jobs', status: 'skipped', detail: '未注入 JobsSeeder（daemon 接线归后续刀——CLI 骨架已注 seedJobs 形状闭包）' })
  } else if (dryRun) {
    phases.push({ phase: 'jobs', status: 'planned', detail: `将播种 ${snapshot.jobs.length} 岗进台账 jobs 表（新岗 next_run_at=cron 下槽不抢跑；既有行保序——docs/17-§2）` })
  } else {
    const seeded = opts.jobsSeeder(snapshot.jobs, now().getTime())
    phases.push({ phase: 'jobs', status: 'provisioned', detail: `播种完成：新 ${seeded.seeded} 岗／保序 ${seeded.kept} 岗（重启不清欠账——docs/17-§2 调度表语义）` })
  }

  // ———— P5 plugins：依赖清单安装（隔离根注入才走） ————
  let install: PluginInstallReport | undefined
  if (opts.pluginRoot === undefined) {
    phases.push({ phase: 'plugins', status: 'skipped', detail: '未注入隔离插件根（绝不缺省写用户 ~/.dsh——docs/43-§四；CLI 缺省注入 <workRoot>/var/plugins）' })
  } else if (dryRun) {
    // installCompanyPlugins 在 confirm=false 时仍追加 install-log——dry-run 连日志都不许落，整段跳过
    phases.push({ phase: 'plugins', status: 'planned', detail: `将按 dependencies.yaml 计划安装到隔离根 ${opts.pluginRoot}（install-log 亦不触——零落盘）` })
  } else {
    install = await installCompanyPlugins({
      companyDir: targetDir,
      pluginRoot: opts.pluginRoot,
      persons: extractPersonAttrs(orgSrc),
      by,
      now,
      ...(opts.confirmInstall !== undefined ? { confirm: opts.confirmInstall } : {}),
    })
    const counts = countActions(install)
    phases.push({ phase: 'plugins', status: 'provisioned', detail: `安装面：${counts}（日志 ${install.logFile}；重跑 satisfied 收敛——docs/43-§四）` })
  }

  // ———— P6 report：验收报告落盘（覆盖式=末次 run；dry-run=零落盘） ————
  const at = now().toISOString()
  const reportFile = dryRun ? undefined : path.join(reportRoot, `${opts.slug}.md`)
  if (reportFile !== undefined) {
    await mkdir(reportRoot, { recursive: true })
    await writeFile(reportFile, renderCreateReport({ slug: opts.slug, dir: targetDir, at, by, dryRun, phases, ...(gitCommit !== undefined ? { gitCommit } : {}), aiws, ...(install !== undefined ? { install } : {}) }), 'utf8')
  }
  phases.push({
    phase: 'report',
    status: dryRun ? 'planned' : 'provisioned',
    detail: dryRun ? '报告将落 <workRoot>/var/create-reports/<slug>.md（dry-run 零落盘——返回值即计划面）' : `验收报告已落 ${reportFile}（覆盖式=末次 run；17-§6 报告落盘口径）`,
  })

  return {
    slug: dryRun && !occupied ? opts.slug : snapshot.slug,
    dir: targetDir,
    ...(gitCommit !== undefined ? { gitCommit } : {}),
    snapshot,
    phases,
    aiws,
    ...(reportFile !== undefined ? { reportFile } : {}),
    ...(install !== undefined ? { install } : {}),
  }
}

// ————————————————————————— 小工具（本文件私有） —————————————————————————

/** 目标目录占用判定（不存在/空=false；读失败按占用走——挂载闸出分类错误，不裸崩） */
function targetOccupied(dir: string): boolean {
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).length > 0
  } catch {
    return true
  }
}

async function headOf(dir: string): Promise<string | undefined> {
  try {
    return await simpleGit(dir).revparse(['HEAD'])
  } catch {
    return undefined
  }
}

/** 暂存区收提（干净=返回当前 HEAD——幂等面不产空提交；与 git-import 同语义） */
async function commitAll(dir: string, message: string): Promise<string> {
  const git = simpleGit(dir)
  await git.add('-A')
  const status = await git.status()
  if (status.isClean()) return git.revparse(['HEAD'])
  const commit = await git.commit(message)
  return commit.commit
}

async function rmQuiet(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // 故意吞掉：原始失败原因优先上报
  }
}

function countActions(install: PluginInstallReport): string {
  const counts = new Map<string, number>()
  for (const item of install.items) counts.set(item.action, (counts.get(item.action) ?? 0) + 1)
  const s = [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(' ')
  return s === '' ? '无依赖清单=零行为面' : s
}
