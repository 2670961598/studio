/**
 * git-import —— `company add <git-url>` git 网址导入流（DEV-27 正式化；
 * docs/43-§一「git 网址即公司」+ §十-1/2/3/4 定稿增补；docs/44-§v1.1 机制一验证面）
 *
 * 链路（一条命令安装，docs/43-§一）：
 *   1. **克隆**：git clone <git-url> 到暂存目录——克隆是**传输手段**（docs/43-§一/附录 A-2）；
 *      本地路径/URL 同一入口（测试用本地 git 仓走真实 git clone，零外网）；
 *   2. **剥离活性 .git → 重建本地仓**：分发仓的 .git（钩子/配置/对象库）一律不落地——
 *      内容复制排除**任何深度**的 .git（docs/43-§十-1 直导同核；禁整目录复制——naive
 *      复制才是钩子开口的主通道），产物 `git init` + 首提（干净 git 目录+首次 commit；
 *      钩子/配置不随行——源仓预埋 .git/hooks/post-merge 之类不存活，负断言进测试）；
 *      本地路径通道与 git-url 通道共用同一导入核（同构支持，docs/43-§一）；
 *   3. **判定器（DEV-32 单一共用核）**：docs/51 五契约全量判定（repo-validate.ts——
 *      `company validate` 同一实现）。导入流内嵌**两遍**（docs/51-§七）：源仓面（克隆
 *      产物即源面，写盘前先检——源不合法不产半成品）+ 产物面（镜像+git 重建后、落锚前
 *      ——E 组闸跑产物）。违规映射：A/E 组→import/structure-rejected（别名 import/*
 *      沿用）；B/C/D 组→import/self-check-failed（内层规则号 via 随行）；
 *   4. **初始化**：挂载元信息盖戳 + 平台字段 provision（FlowPlatform 端口注入——
 *      localfile 实现由调用方给，docs/23；本包不依赖任何平台实现）+ 信任锚
 *      .studio-next/trust.json trust=false（docs/44 v1 信任锚设计，trust.ts）+
 *      **.AIWS 员工工作区树**（公司根目录同级，不进公司 git 目录——docs/43-§五）+
 *      可选插件根注入 → 依赖清单自动安装（docs/43-§四，dependencies.ts）；
 *   5. **升级**（docs/43-§十-2 升级四点）：同一公司再次导入=升级通道——镜像同步内容
 *      （删除源已删文件）→ **内容变了才新 commit**（幂等：同版本再导 HEAD 不变零新提交）；
 *      锚重落 trust=false（新内容=未批准面，fail-closed）；.studio-next.yaml 盖戳字段
 *      （created_at 等 daemon 自管状态）不随源回卷；升级只认**有锚公司+slug 同家**
 *      （错家拒收）。
 *
 * 结构闸（**跑在克隆产物上**——exec 权限位经 git clone 可旅行，不跑源仓工作树，
 * docs/43-§十-3；.git 除外——它是传输层，复制时剥离）：
 *   - 顶层封闭内容集（v1 允许集 + v1.1 两员：dependencies.yaml、plugins/——docs/43-§四）
 *   - 分发仓不得自带 .studio-next/ 锚目录（锚是 daemon 自管——自带锚=信任态劫持面，
 *     docs/43-§十-3 显式拒收）
 *   - 可执行位文件/符号链接拒收（沿 v1 附录 A-2/A-4 基线；插件代码不需要 exec 位）
 *
 * 失败纪律：任一步不过抛 ClassifiedError(CONFIG_INVALID)；fresh 通道新建目录整体撤除
 * （同 init.ts 宁失败不半成品）。
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { parse as parseYaml } from 'yaml'
import type { FieldProvisionMap, FlowPlatform, TicketWorkflows } from '@studio-next/contract'
import { configInvalid } from '@studio-next/contract'
import { validateCompanyRepo, type RepoValidateOptions, type RepoValidateResult } from './repo-validate.ts'
import { AIWS_DIR, readDirectoryFiles } from './init.ts'
import { ensureAiwsTree, type AiwsTreeResult } from './aiws.ts'
import { contentFingerprint, excludeAnchorFiles, readTrustAnchor, reseedTrustAnchorOnUpgrade, seedTrustAnchor } from './trust.ts'
import { extractPersonAttrs, installCompanyPlugins, type PluginInstallItem, type PluginInstallReport } from './dependencies.ts'

// ————————————————————————— 判定器注入（DEV-32 两遍共用核） —————————————————————————

/** 锚目录名（产物面判定器豁免——daemon 自管；git info/exclude 本地排除） */
const ANCHOR_DIR = '.studio-next'

/**
 * 判定器函数形状（=validateCompanyRepo 签名）。RepoImportOptions.validator 可注入替身，
 * 测试据此取证「两遍跑过」（源仓面+产物面各一次——docs/51-§七 导入流内嵌同一判定器）；
 * 缺省=本包 validateCompanyRepo（单一实现，不另起炉灶）。
 */
export type RepoValidator = (dir: string, opts?: RepoValidateOptions) => Promise<RepoValidateResult>

/** 违规 → 导入流分类错误（A/E=structure-rejected 带 import/* 别名；B/C/D=self-check-failed 带 via） */
function rejectByValidation(result: RepoValidateResult, faceLabel: string): never {
  const structural = result.violations.some((v) => /^[AE]-/.test(v.rule))
  const lines = result.violations.map((v) => {
    const tag = /^[AE]-/.test(v.rule) ? (v.alias ?? v.rule) : (v.via ?? v.rule)
    return `  [${tag}]（docs/51 ${v.rule}）${v.file} @ ${v.location}：${v.problem}；修法：${v.fix}`
  })
  const head = `公司仓未过 docs/51 五契约判定（${faceLabel}${result.violations.length} 条违规——DEV-32 判定器）：`
  if (structural) {
    configInvalid('import/structure-rejected', `${head}\n${lines.join('\n')}`)
  }
  configInvalid('import/self-check-failed', `${head}\n${lines.join('\n')}`)
}

// ————————————————————————— 挂载元信息盖戳 + 平台 provision —————————————————————————

/**
 * 内容树枚举（剥离 .git/.DS_Store 后的相对路径集——镜像同步的源面）。
 * 任何深度的 .git（含嵌套 plugins/foo/.git 子仓元数据）都在此剥离。
 */
async function listContentFiles(sourceDir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.DS_Store') continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await listContentFiles(path.join(sourceDir, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

// ————————————————————————— 挂载元信息盖戳 + 平台 provision —————————————————————————

/** 挂载元信息（升级时保留本地侧——盖戳字段是 daemon 自管状态，不随源回卷 docs/43-§十-2） */
const META_FILE = '.studio-next.yaml'

/** 盖戳（fresh 通道）：created_at/last_validated_at/last_validation 的 null → 值（lenient——只在恰为 null 行时替换） */
function stampMeta(meta: string, iso: string): string {
  return meta
    .replace(/^created_at: null$/m, `created_at: ${JSON.stringify(iso)}`)
    .replace(/^last_validated_at: null$/m, `last_validated_at: ${JSON.stringify(iso)}`)
    .replace(/^last_validation: null$/m, 'last_validation: pass')
}

/**
 * 缺省元信息桩（DEV-32 R2）：源仓缺 .studio-next.yaml 合法（docs/51-§二 A-2 未列必备），
 * 导入产物面由框架补写——schema 字面量与 org-config 同源（multifile 同源检），盖戳字段
 * null 待 stampMeta 盖值（与 templates 随行形态同构）。
 */
function defaultMetaStub(orgConfigSrc: string): string {
  let schema = 'studio-next/org@1'
  try {
    const doc = parseYaml(orgConfigSrc) as { schema?: unknown } | null
    if (doc !== null && typeof doc === 'object' && typeof doc['schema'] === 'string' && doc['schema'] !== '') {
      schema = doc['schema']
    }
  } catch {
    // 判定器已过——org-config 必可解析；防御性兜底用 canonical 字面量
  }
  return [
    '# Studio Next 挂载元信息（.studio-next.yaml）—— 导入流补写缺省桩（DEV-32 R2）',
    '# 源仓缺本文件合法（docs/51-§二 A-2 未列必备）；产物面由框架补齐，盖戳字段随导入流盖值。',
    '',
    `schema: ${schema}`,
    'template: git-import',
    'created_at: null',
    'last_validated_at: null',
    'last_validation: null',
    'framework_version: null',
    '',
  ].join('\n')
}

/** provision 缺省态流表（五态；公司可经 yt.states/yt.flows 覆盖） */
const DEFAULT_STATES: readonly string[] = ['新单', '已派发', '证据就绪', '复验通过', '已交付']
const DEFAULT_FIELD_MAP: Record<string, string> = { state: 'State', dept: '部门', level: '等级' }

/**
 * 平台字段 provision 映射推导（docs/23-§二：字段/状态流映射=公司配置声明）：
 * 缺省 {state→State, dept→部门, level→等级} + 五态流；org-config yt.fields/yt.states/yt.flows 覆盖；
 * workflows 类型声明折叠（DEV-43，docs/18-§2.1.1）——
 *   - 无 entity 类型：状态并入顶层 states（绑定实体承载；首现序去重）
 *   - entity 类型：状态进 entities.<entity>.states（provision 建到对应实体工作流档案）
 *   - typeInbox[id]=anchors.inbox（建单落位第二优先级，IssueCreate.initialState 解析序）
 *   - typeFlows[id]=该类「主干前向边+声明边」合并表（per-type 键化——顶层 stateFlow
 *     保持 legacy-only 永不并集：跨类型同名状态后继不合并，guard 接线日按 type 取表）
 */
export function deriveFieldProvision(
  orgYt: Record<string, unknown> | undefined,
  workflows?: TicketWorkflows,
): FieldProvisionMap {
  const fields = { ...DEFAULT_FIELD_MAP }
  const stateFlow: Record<string, string[]> = {}
  let states: string[] = [...DEFAULT_STATES]
  if (orgYt !== undefined) {
    if (isPlainRecord(orgYt['fields'])) {
      for (const [k, v] of Object.entries(orgYt['fields'])) {
        if (typeof v === 'string') fields[k] = v
      }
    }
    if (Array.isArray(orgYt['states']) && orgYt['states'].every((s) => typeof s === 'string')) {
      states = orgYt['states'] as string[]
    }
    if (isPlainRecord(orgYt['flows'])) {
      for (const [k, v] of Object.entries(orgYt['flows'])) {
        if (Array.isArray(v) && v.every((s) => typeof s === 'string')) stateFlow[k] = v as string[]
      }
    }
  }
  // workflows 折叠（DEV-43）：W-1..W-9 已过判定器（调用序=validate 先于 provision），
  // 此处只做推导不做校验；不声明=三个可选键不落（旧 map 形状零变化）
  const ytTypeInbox = readYtTypeInbox(orgYt)
  if (workflows !== undefined && workflows.types.length > 0) {
    const typeInbox: Record<string, string> = {}
    const typeFlows: Record<string, Record<string, string[]>> = {}
    const entities: Record<string, { states: string[] }> = {}
    for (const t of workflows.types) {
      const names = t.states.map((s) => s.name)
      const finals = new Set(t.states.filter((s) => s.final === true).map((s) => s.name))
      typeInbox[t.id] = t.anchors.inbox
      // 主干前向边（终态截断——与 core forwardStates 同推导）+ 声明边合并（per-type）
      const flow: Record<string, string[]> = {}
      const push = (from: string, to: string): void => {
        const list = flow[from] ?? (flow[from] = [])
        if (!list.includes(to)) list.push(to)
      }
      for (let i = 0; i < names.length - 1; i++) {
        const from = names[i] as string
        if (!finals.has(from)) push(from, names[i + 1] as string)
      }
      for (const e of t.edges ?? []) push(e.from, e.to)
      typeFlows[t.id] = flow
      // 状态落位：entity 类型进实体档案；无 entity 并入顶层（首现序去重）
      if (t.entity !== undefined) {
        const bucket = entities[t.entity] ?? (entities[t.entity] = { states: [] })
        for (const n of names) if (!bucket.states.includes(n)) bucket.states.push(n)
      } else {
        for (const n of names) if (!states.includes(n)) states.push(n)
      }
    }
    // yt.typeInbox 逐键覆盖（130-P1）：workflows 派生项（anchors.inbox）之上 yt 同键胜出
    // ——收件态可经 yt 直改而不动类型声明；per-key 合并使未覆盖键保留派生值（跨刀共存）。
    if (ytTypeInbox !== undefined) Object.assign(typeInbox, ytTypeInbox)
    return { fields, states, stateFlow, typeInbox, typeFlows, entities }
  }
  // 无 workflows 也可单收 yt.typeInbox（无类型流声明的轻量落位面——收件态须已在
  // yt.states/缺省五态内，validator typeInboxRules 拦未知态；typeFlows/entities 不落）
  if (ytTypeInbox !== undefined) return { fields, states, stateFlow, typeInbox: { ...ytTypeInbox } }
  return { fields, states, stateFlow }
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * yt.typeInbox 读取（130-P1，studio-dev-172）：`yt.typeInbox: {<type>: <收件态>}` 直改
 * 建单落位（IssueCreate initialState 解析序第二级——packages/taiga fieldmap.initialStateFor）。
 * 只读推导不校验（校验面归 validator typeInboxRules，调用序=validate 先于 provision）；
 * 非字符串值防御性跳过（与 yt.fields/states/flows 同纪律），空 record=未声明。
 */
function readYtTypeInbox(orgYt: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (orgYt === undefined) return undefined
  const raw = orgYt['typeInbox']
  if (!isPlainRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ————————————————————————— git-url → 目录名 —————————————————————————

/** git-url/路径末段去 .git → 缺省目录名（/path/company-src → company-src；https://x/y.git → y） */
export function deriveDirNameFromGitUrl(gitUrl: string): string {
  const trimmed = gitUrl.replace(/[\\/]+$/, '')
  const base = trimmed.split('/').pop() ?? trimmed
  return base.replace(/\.git$/, '') || 'company'
}

// ————————————————————————— .AIWS 员工工作区树（docs/43-§五） —————————————————————————
// 建树+增量同步+per-company 根守卫正式化归 aiws.ts（DEV-28）：本文件只消费（建司即建、
// 升级同建，公共 API 经 index.ts 的 aiws.ts 导出面）；排除面见 init.ts SCAN_EXCLUDED_NAMES。

// ————————————————————————— 导入核（git-url 与本地路径同构共用——docs/43-§十-1） —————————————————————————

export interface RepoImportOptions {
  /** 源目录（git-url 通道=克隆产物；本地路径通道=分发仓本体——都含 .git，复制时剥离） */
  sourceDir: string
  /** 目标公司目录 */
  targetDir: string
  importedBy?: string
  now?: () => Date
  /** 平台端口注入（给出且公司 platform=localfile → fields.provision；docs/23） */
  platform?: FlowPlatform
  /** 隔离插件根（给出 → 依赖清单自动安装；不缺省——绝不写用户 ~/.dsh） */
  pluginRoot?: string
  /** .AIWS 员工工作区树根（缺省=<targetDir 同级>/.AIWS——公司根目录，不进公司 git 目录） */
  aiwsRoot?: string
  /** 插件安装确认位（透传 dependencies.ts confirm；缺省自动装） */
  confirmInstall?: (view: { company: string; planned: PluginInstallItem[] }) => boolean | Promise<boolean>
  /** 判定器注入（DEV-32：缺省=validateCompanyRepo；测试取证两遍跑过） */
  validator?: RepoValidator
}

export interface RepoImportResult {
  dir: string
  slug: string
  /** 本次导入的 git 提交哈希（幂等升级=上次哈希，contentChanged=false） */
  gitCommit: string
  fingerprint: string
  /** false=首次导入；true=升级通道（目标已是本框架导入的公司） */
  upgraded: boolean
  /** 内容是否真的变化（幂等面：同版本再导=false，无新提交——docs/43-§十-2） */
  contentChanged: boolean
  provisioned: boolean
  /** .AIWS 员工工作区树（建树+增量同步结果——根、工号清单、新建数、归档清单） */
  aiws: AiwsTreeResult
  install?: PluginInstallReport
}

/** git 提交身份（repo 局部配置——不依赖机器全局 git 身份，确定性） */
const GIT_IDENTITY = { name: 'studio-next-import', email: 'import@studio-next.invalid' }

/** 暂存区收提（干净=返回当前 HEAD——幂等升级不产空提交） */
async function commitAll(dir: string, message: string): Promise<string> {
  const git = simpleGit(dir)
  await git.add('-A')
  const status = await git.status()
  if (status.isClean()) return git.revparse(['HEAD'])
  const commit = await git.commit(message)
  return commit.commit
}

/** 内容文件字节级复制（源→目标；mode 随 copyFile 新建文件缺省 0644——exec 位已被扫描拒收） */
async function copyContentFiles(sourceDir: string, targetDir: string, rels: readonly string[]): Promise<void> {
  for (const rel of rels) {
    const abs = path.join(targetDir, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await copyFile(path.join(sourceDir, rel), abs)
  }
}

/** 删除目标侧源已不存在的内容文件（保留 .git/ 与 .studio-next/——daemon 自管；返回删除清单） */
async function pruneStaleContent(targetDir: string, keep: ReadonlySet<string>): Promise<string[]> {
  const removed: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (prefix === '' && (entry.name === '.git' || entry.name === '.DS_Store' || entry.name === ANCHOR_DIR)) continue
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, rel)
        if ((await readdir(abs)).length === 0) await rm(abs, { recursive: true, force: true }) // 清空目录回收
      } else if (entry.isFile() && !keep.has(rel)) {
        await rm(abs, { force: true })
        removed.push(rel)
      }
    }
  }
  await walk(targetDir, '')
  return removed
}

/** 撤除 fresh 通道半成品（清理失败不掩盖原始错误） */
async function cleanupFresh(targetDir: string, targetExisted: boolean): Promise<void> {
  try {
    await rm(targetDir, { recursive: true, force: true })
    if (targetExisted) await mkdir(targetDir, { recursive: true })
  } catch {
    // 故意吞掉
  }
}

/**
 * 导入核：扫描 → 源侧全量校验 → fresh/upgrade 通道分流 → 内容镜像（剥 .git）→
 * git（fresh=init+首提；upgrade=变更才提交）→ 锚 → provision → 插件安装。
 */
export async function importCompanyRepo(opts: RepoImportOptions): Promise<RepoImportResult> {
  const now = opts.now ?? (() => new Date())
  const iso = now().toISOString()
  const by = opts.importedBy ?? 'producer'
  const sourceDir = path.resolve(opts.sourceDir)
  const targetDir = path.resolve(opts.targetDir)

  if (!existsSync(sourceDir)) configInvalid('import/source-missing', `源目录不存在：${sourceDir}`)

  // 1+2. 判定器·源仓面（DEV-32：docs/51 五契约全量，A 目录封闭集/B 逐文件/C 交叉引用/
  //     D 依赖/E 卫生——克隆产物即源面；写盘前先检，源不合法不产半成品）
  const validator = opts.validator ?? validateCompanyRepo
  const sourceResult = await validator(sourceDir, { face: 'source' })
  if (!sourceResult.ok) rejectByValidation(sourceResult, '源仓面，')
  const snapshot = sourceResult.snapshot
  if (snapshot === undefined) configInvalid('import/self-check-failed', '判定器未给出快照（org 面未过——内部一致性问题）')
  const slug = snapshot.slug
  const sourceFiles = await readDirectoryFiles(sourceDir)
  const sourceHasMeta = sourceFiles[META_FILE] !== undefined

  // 3. 通道分流：目标不存在/空=fresh；非空=须是本框架导入过的公司（锚为证）且 slug 同家（docs/43-§十-2）
  const targetExisted = existsSync(targetDir)
  const targetEntries = targetExisted ? await readdir(targetDir) : []
  const upgraded = targetEntries.length > 0
  const anchor = upgraded ? readTrustAnchor(targetDir) : null
  if (upgraded) {
    if (anchor === null) {
      configInvalid('import/target-not-imported', `目标目录已存在且非空、但无本框架导入锚（${targetDir}）——升级通道只认 company add 导入过的公司；init 通道目录或外来目录不在此列（宁失败不半成品）`)
    }
    if (anchor.slug !== slug) {
      configInvalid('import/slug-mismatch', `目标目录是 ${anchor.slug} 的公司，源是 ${slug}——错家公司拒升级（slug=org-config company.slug，单一事实源）`)
    }
  }

  // 4. 内容镜像（任何深度的 .git 在此剥离——分发仓内容导入，落地为干净内容树；
  //    upgrade 通道保留本地 .studio-next.yaml——盖戳字段是 daemon 自管状态不随源回卷）
  const contentRels = await listContentFiles(sourceDir)
  try {
    if (!upgraded) {
      if (!targetExisted) await mkdir(targetDir, { recursive: true })
      await copyContentFiles(sourceDir, targetDir, contentRels)
      // R2 缺省桩：源仓缺 .studio-next.yaml 合法（docs/51 A-2 未列）——产物面由框架补写
      // 缺省桩（schema 与 org 同源；盖戳字段 null 待盖），挂载元信息自齐
      if (!sourceHasMeta) await writeFile(path.join(targetDir, META_FILE), defaultMetaStub(sourceFiles['org-config.yaml'] ?? ''), 'utf8')
      const metaPath = path.join(targetDir, META_FILE)
      if (existsSync(metaPath)) await writeFile(metaPath, stampMeta(await readFile(metaPath, 'utf8'), iso), 'utf8')
    } else {
      // keep 含 META（prune 保留本地侧）；copy 跳过 META（源的 null 桩不覆盖本地盖戳值）
      await pruneStaleContent(targetDir, new Set(contentRels))
      await copyContentFiles(sourceDir, targetDir, contentRels.filter((rel) => rel !== META_FILE))
    }
  } catch (err) {
    if (!upgraded) await cleanupFresh(targetDir, targetExisted)
    throw err
  }

  // 5. git：fresh=init+锚目录本地排除+首提；upgrade=内容变了才提交（幂等面——HEAD 对比直证）
  let gitCommit: string
  const headBefore = upgraded ? await simpleGit(targetDir).revparse(['HEAD']) : ''
  try {
    if (!upgraded) {
      const git = simpleGit(targetDir)
      await git.init()
      // 锚目录=daemon 自管，进 .git/info/exclude（本地排除——内容树不出现 .gitignore，分发不随行）
      const excludePath = path.join(targetDir, '.git', 'info', 'exclude')
      const excludeBase = existsSync(excludePath) ? await readFile(excludePath, 'utf8') : ''
      await mkdir(path.dirname(excludePath), { recursive: true })
      await writeFile(excludePath, `${excludeBase}${excludeBase === '' || excludeBase.endsWith('\n') ? '' : '\n'}${ANCHOR_DIR}/\n`, 'utf8')
      await git.addConfig('user.name', GIT_IDENTITY.name)
      await git.addConfig('user.email', GIT_IDENTITY.email)
      gitCommit = await commitAll(targetDir, `import: git-url 导入公司 ${slug}（剥 .git 重建本地仓；trust=false 待批准——docs/43-§一/附录 A-2）`)
    } else {
      gitCommit = await commitAll(targetDir, `import(upgrade): 同家公司再导入 ${slug}（内容镜像同步；trust 重落 false——docs/43-§一「升级=同一导入流」）`)
    }
  } catch (err) {
    if (!upgraded) await cleanupFresh(targetDir, targetExisted)
    configInvalid('import/git-commit-failed', `git 提交失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const contentChanged = !upgraded || gitCommit !== headBefore

  // 5b. 判定器·产物面（DEV-32 第二遍：镜像+git 重建后、落锚前——docs/51-§七「E 组闸跑
  //     产物」；锚=daemon 自管在此豁免。源面已过而产物不过=镜像/重建引入，宁失败撤除）
  const productResult = await validator(targetDir, { face: 'product' })
  if (!productResult.ok) {
    if (!upgraded) await cleanupFresh(targetDir, targetExisted)
    rejectByValidation(productResult, '产物面，')
  }

  // 6. 锚（fresh=落锚 trust=false；upgrade=重落 trust=false——新内容=未批准面，fail-closed）
  const targetFiles = await readDirectoryFiles(targetDir)
  if (!upgraded) {
    seedTrustAnchor(targetDir, slug, targetFiles, { by, at: iso, note: `company add <git-url>: ${slug}` })
  } else {
    reseedTrustAnchorOnUpgrade(targetDir, slug, targetFiles, { by, at: iso, note: `upgrade: ${slug} 内容更新` })
  }
  const fingerprint = contentFingerprint(excludeAnchorFiles(targetFiles))

  // 6b. .AIWS 员工工作区树（fresh 与 upgrade 同建——升级后组织可能扩编；幂等可重入，
  //     增量同步=扩编建目录/缩编归档不删。落点缺省=公司根目录（targetDir 同级），不进
  //     公司 git 目录——docs/43-§五；slug=仓库真 slug——per-company 根守卫不并树，§十9）
  const aiwsRoot = opts.aiwsRoot ?? path.join(path.dirname(targetDir), AIWS_DIR)
  const aiws = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, {
    slug: snapshot.slug,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  // 7. 平台字段 provision（端口注入；公司声明 platform: localfile 才走——docs/23-§二「换平台=改配置行」）
  let provisioned = false
  if (opts.platform !== undefined && snapshot.platform.platform === 'localfile') {
    await opts.platform.fields.provision(deriveFieldProvision(extractOrgYt(sourceFiles['org-config.yaml'] ?? ''), snapshot.workflows))
    provisioned = true
  }

  // 8. 依赖清单自动安装（隔离插件根注入才走——绝不缺省写用户目录；docs/43-§四）
  let install: PluginInstallReport | undefined
  if (opts.pluginRoot !== undefined) {
    install = await installCompanyPlugins({
      companyDir: targetDir,
      pluginRoot: opts.pluginRoot,
      persons: extractPersonAttrs(sourceFiles['org-config.yaml'] ?? ''),
      by,
      now,
      ...(opts.confirmInstall !== undefined ? { confirm: opts.confirmInstall } : {}),
    })
  }

  return {
    dir: targetDir,
    slug,
    gitCommit,
    fingerprint,
    upgraded,
    contentChanged,
    provisioned,
    aiws,
    ...(install !== undefined ? { install } : {}),
  }
}

/** 轻取 org-config yt 段（provision 推导输入；全量校验已在 loadCompanyDirectory 过。
 *  DEV-15 起导出：company create 编排核（create.ts）与导入流共用同一推导——单一实现） */
export function extractOrgYt(orgSrc: string): Record<string, unknown> | undefined {
  if (orgSrc === '') return undefined
  try {
    const doc = parseYaml(orgSrc) as unknown
    if (isPlainRecord(doc) && isPlainRecord(doc['yt'])) return doc['yt']
  } catch {
    // 校验已过，此处防御性吞（返回 undefined=用缺省映射）
  }
  return undefined
}

// ————————————————————————— company add <git-url>（克隆通道壳） —————————————————————————

export interface CompanyAddOptions {
  /** git-url（任何 git 可 clone 的形态：https://、git@、本地路径、file://） */
  gitUrl: string
  /** 目标目录（缺省 ./<名>/<url 末段名>） */
  targetDir?: string
  /** [名]：目录名兜底（优先于 url 末段推导） */
  name?: string
  importedBy?: string
  now?: () => Date
  platform?: FlowPlatform
  pluginRoot?: string
  /** .AIWS 员工工作区树根（缺省=<targetDir 同级>/.AIWS） */
  aiwsRoot?: string
  confirmInstall?: (view: { company: string; planned: PluginInstallItem[] }) => boolean | Promise<boolean>
}

export type CompanyAddResult = RepoImportResult

/**
 * `studio-next company add <git-url> [名]`：克隆到暂存 → 导入核 → 撤暂存。
 * 升级=同一 git-url（或同 slug 源）再次调用（导入核的 upgrade 通道）。
 */
export async function companyAddGitUrl(opts: CompanyAddOptions): Promise<CompanyAddResult> {
  const gitUrl = opts.gitUrl.trim()
  if (gitUrl === '') configInvalid('import/bad-git-url', 'git-url 不能为空（例：studio-next company add /path/to/company-repo my-corp）')
  const targetDir = opts.targetDir ?? path.resolve(opts.name ?? deriveDirNameFromGitUrl(gitUrl))
  const staging = await mkdtemp(path.join(tmpdir(), 'studio-next-clone-'))
  try {
    const cloneDir = path.join(staging, 'src')
    await simpleGit().clone(gitUrl, cloneDir)
    return await importCompanyRepo({
      sourceDir: cloneDir,
      targetDir,
      ...(opts.importedBy !== undefined ? { importedBy: opts.importedBy } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
      ...(opts.pluginRoot !== undefined ? { pluginRoot: opts.pluginRoot } : {}),
      ...(opts.aiwsRoot !== undefined ? { aiwsRoot: opts.aiwsRoot } : {}),
      ...(opts.confirmInstall !== undefined ? { confirmInstall: opts.confirmInstall } : {}),
    })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
