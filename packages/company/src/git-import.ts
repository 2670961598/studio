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
 *   3. **schema 校验**：org-config/departments/people 全目录面（loadCompanyDirectory，
 *      写盘前先检——源不合法不产半成品；docs/43-§二 冻结 schema）；
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
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { parse as parseYaml } from 'yaml'
import type { FieldProvisionMap, FlowPlatform } from '@studio-next/contract'
import { configInvalid } from '@studio-next/contract'
import { loadCompanyDirectory } from './validator.ts'
import { AIWS_DIR, readDirectoryFiles } from './init.ts'
import { contentFingerprint, excludeAnchorFiles, readTrustAnchor, reseedTrustAnchorOnUpgrade, seedTrustAnchor } from './trust.ts'
import { extractPersonAttrs, installCompanyPlugins, type PluginInstallItem, type PluginInstallReport } from './dependencies.ts'

// ————————————————————————— 结构闸 —————————————————————————

/**
 * 顶层封闭内容集（v1 允许集 + v1.1 两员：dependencies.yaml、plugins/——docs/43-§四）。
 * `.studio-next/` 目录**不在集内**：锚是 daemon 自管目录，分发仓自带=信任态劫持面（显式拒）。
 */
const TOP_LEVEL_CONTENT_ALLOWLIST: readonly string[] = [
  '.studio-next.yaml',
  'org-config.yaml',
  'dependencies.yaml',
  'README.md',
  'charter.md',
  'charter',
  'departments',
  'prompts',
  'docs',
  'reports',
  'plugins',
]

/** 锚目录名（分发仓自带即拒——见 TOP_LEVEL_CONTENT_ALLOWLIST 注） */
const ANCHOR_DIR = '.studio-next'

interface ScanViolation {
  rule: string
  detail: string
}

/**
 * 克隆产物内容扫描（.git 除外——传输层元数据，复制时剥离，不是内容违规）：
 * 顶层封闭集外条目 / 自带锚目录 / 可执行位文件 / 符号链接 → 违规清单（空=过关）。
 */
async function scanPackageContent(sourceDir: string): Promise<ScanViolation[]> {
  const violations: ScanViolation[] = []
  const top = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of top) {
    // .git/.DS_Store=传输层/本地噪音（复制时剥离，walk 同款跳过）——不进内容集判定
    if (entry.name === '.git' || entry.name === '.DS_Store') continue
    if (!TOP_LEVEL_CONTENT_ALLOWLIST.includes(entry.name)) {
      if (entry.name === ANCHOR_DIR) {
        violations.push({ rule: 'import/anchor-present', detail: `分发仓自带 ${ANCHOR_DIR}/ 锚目录——锚是 daemon 自管目录（trust.json 是制作人侧信任态），自带锚=信任态劫持面（docs/43-§十-3 / docs/44 v1 信任锚设计）` })
        continue
      }
      violations.push({ rule: 'import/unknown-entry', detail: `顶层条目 ${entry.name} 不在公司包封闭内容集内（${TOP_LEVEL_CONTENT_ALLOWLIST.join('、')}）——未知文件拒收（附录 A-4 基线）` })
    }
  }
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue // 传输层/本地噪音：复制时剥离
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        violations.push({ rule: 'import/symlink-entry', detail: `${rel}——分发仓禁符号链接（路径逃逸载体）` })
        continue
      }
      if (entry.isDirectory()) {
        await walk(abs, rel)
      } else if (entry.isFile()) {
        const st = await stat(abs)
        if ((st.mode & 0o111) !== 0) {
          violations.push({ rule: 'import/exec-bit', detail: `${rel}（mode ${st.mode.toString(8)}）——分发仓禁可执行位文件（附录 A-2 基线；插件代码不需要 exec 位）` })
        }
      }
    }
  }
  await walk(sourceDir, '')
  return violations
}

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

/** provision 缺省态流表（五态；公司可经 yt.states/yt.flows 覆盖） */
const DEFAULT_STATES: readonly string[] = ['新单', '已派发', '证据就绪', '复验通过', '已交付']
const DEFAULT_FIELD_MAP: Record<string, string> = { state: 'State', dept: '部门', level: '等级' }

/**
 * 平台字段 provision 映射推导（docs/23-§二：字段/状态流映射=公司配置声明）：
 * 缺省 {state→State, dept→部门, level→等级} + 五态流；org-config yt.fields/yt.states/yt.flows 覆盖。
 */
export function deriveFieldProvision(orgYt: Record<string, unknown> | undefined): FieldProvisionMap {
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
  return { fields, states, stateFlow }
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// ————————————————————————— git-url → 目录名 —————————————————————————

/** git-url/路径末段去 .git → 缺省目录名（/path/company-src → company-src；https://x/y.git → y） */
export function deriveDirNameFromGitUrl(gitUrl: string): string {
  const trimmed = gitUrl.replace(/[\\/]+$/, '')
  const base = trimmed.split('/').pop() ?? trimmed
  return base.replace(/\.git$/, '') || 'company'
}

// ————————————————————————— .AIWS 员工工作区树（docs/43-§五） —————————————————————————

/**
 * 建员工工作区树 `.AIWS/<部门路径>/<工号>/`——镜像 org-config 组织结构（部门层级沿用
 * departments 树的 path 与 parent；叶子=people 逐工号的文件夹；people/<工号>.md 是文件，
 * .AIWS 下对应位置是文件夹——员工可在自己文件夹里做任意事）。
 * 落点=公司根目录（公司 git 目录/var 的同级，**不进公司 git 目录**）；幂等（mkdir 已存在
 * 即过）；部门文件夹先建（无人部门也有文件夹），员工文件夹挂其 dept.path 下。
 * 排除面见 AIWS_DIR 注（init.ts）——.git/.DS_Store 同款被指纹与监听排除。
 */
export function ensureAiwsTree(
  aiwsRoot: string,
  departments: readonly { path: string }[],
  people: readonly { id: string; dept: string }[],
): { root: string; personDirs: string[] } {
  mkdirSync(path.join(aiwsRoot), { recursive: true })
  const personDirs: string[] = []
  for (const dept of departments) {
    mkdirSync(path.join(aiwsRoot, ...dept.path.split('/')), { recursive: true })
  }
  for (const person of people) {
    const rel = [...person.dept.split('/'), person.id]
    mkdirSync(path.join(aiwsRoot, ...rel), { recursive: true })
    personDirs.push(rel.join('/'))
  }
  return { root: aiwsRoot, personDirs }
}

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
  /** .AIWS 员工工作区树（建树结果——根与工号文件夹清单） */
  aiws: { root: string; personDirs: string[] }
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

  // 1. 内容扫描（封闭集/锚劫持/exec 位/符号链接——.git 除外，复制时剥离）
  const violations = await scanPackageContent(sourceDir)
  if (violations.length > 0) {
    configInvalid('import/structure-rejected', `公司包结构拒收（${violations.length} 项违规）：\n${violations.map((v) => `  [${v.rule}] ${v.detail}`).join('\n')}`)
  }

  // 2. 源侧全量校验（写盘前先检——org-config/departments/people 结构，docs/43-§二冻结契约）
  const sourceFiles = await readDirectoryFiles(sourceDir)
  const mounted = loadCompanyDirectory(sourceFiles)
  if (!mounted.ok) {
    configInvalid('import/self-check-failed', `源未过目录校验（docs/04-§二 目录契约；schema 冻结见 docs/43-§二）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`)
  }
  const slug = mounted.snapshot.slug

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

  // 6. 锚（fresh=落锚 trust=false；upgrade=重落 trust=false——新内容=未批准面，fail-closed）
  const targetFiles = await readDirectoryFiles(targetDir)
  if (!upgraded) {
    seedTrustAnchor(targetDir, slug, targetFiles, { by, at: iso, note: `company add <git-url>: ${slug}` })
  } else {
    reseedTrustAnchorOnUpgrade(targetDir, slug, targetFiles, { by, at: iso, note: `upgrade: ${slug} 内容更新` })
  }
  const fingerprint = contentFingerprint(excludeAnchorFiles(targetFiles))

  // 6b. .AIWS 员工工作区树（fresh 与 upgrade 同建——升级后组织可能扩编；幂等 mkdir。
  //     落点缺省=公司根目录（targetDir 同级），不进公司 git 目录——docs/43-§五）
  const aiwsRoot = opts.aiwsRoot ?? path.join(path.dirname(targetDir), AIWS_DIR)
  const aiws = ensureAiwsTree(aiwsRoot, mounted.snapshot.departments, mounted.snapshot.people)

  // 7. 平台字段 provision（端口注入；公司声明 platform: localfile 才走——docs/23-§二「换平台=改配置行」）
  let provisioned = false
  if (opts.platform !== undefined && mounted.snapshot.platform.platform === 'localfile') {
    await opts.platform.fields.provision(deriveFieldProvision(extractOrgYt(sourceFiles['org-config.yaml'] ?? '')))
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

/** 轻取 org-config yt 段（provision 推导输入；全量校验已在 loadCompanyDirectory 过） */
function extractOrgYt(orgSrc: string): Record<string, unknown> | undefined {
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
