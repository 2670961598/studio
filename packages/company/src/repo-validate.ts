/**
 * DEV-32 · 公司仓库判定器 —— docs/51《公司仓库规范正文》的实现面（单一判定器）。
 *
 * 职责（docs/51-§七 CLI 契约）：
 *   - 输入：<git-url | 本地路径 | tarball>（materializeCompanyRepoInput 物化成目录）
 *   - 五契约规则集全量：A 目录封闭集（A-1..A-5）/ B 逐文件 schema 与值域（B-1..B-6）/
 *     C 交叉引用（C-1..C-8）/ D 依赖（D-1..D-4）/ E 卫生（E-1..E-4，闸跑克隆产物）
 *   - 合法=PASS+摘要+「可初始化」；不合法=逐条违规 {规则号, 文件, 位置(行或键路径),
 *     违规描述, 修复建议}——不许只说「校验失败」
 *   - 退出码语义在 CLI 壳（apps/daemon bin）：0=合法 / 1=不合法 / 2=判定器自身错误
 *     （网络/权限/解包失败——RepoInputError 面）
 *
 * 面语义（face）：
 *   - source：`company validate` 缺省面 + DEV-27 导入流第一遍（git-url 通道=克隆产物即源面）
 *   - product：DEV-27 导入流第二遍（镜像+git 重建后、落锚前）——`.studio-next/` 锚为
 *     框架自落（git info/exclude 本地排除），A-5/E-3 豁免；`.AIWS/` 两面同禁（员工工作区
 *     在仓外同级，docs/43-§五）
 *
 * 共用核（单一实现，不另起炉灶）：
 *   - B/C 组主体=loadCompanyDirectory（validator.ts org 面 + multifile.ts 多文件面——
 *     DEV-27 既有共享核，内层规则号经 via 字段保留）
 *   - D 组=dependencies.ts（safeParseDependencies 非抛面 + planPluginInstalls 决策面）
 *   - 内容读取=init.ts readDirectoryFiles（排除表单源）
 *
 * 解释记录（规范冻结正文 vs 仓内语料的冲突裁定，详见任务书 deliverables/plan.md §4）：
 *   R1 schema 字面量并集（canonical=studio-next/org@1，迁移期兼容 org-config/v1）
 *   R2 封闭集并入框架自管两员（.studio-next.yaml 随行元信息 + reports/ 产出根）；
 *       缺 .studio-next.yaml 不违规（docs/51 A-2 未列必备——导入流产物面补写缺省桩）
 *   R3 工号/部门段=slug 语法形状域（大小写/中文随全司惯例），slug 本体仍按 docs/51 小写正则
 *   R4 slug 表与 init 通道现状漂移（init SLUG_RE 允 1-2 字符）——判定器按 docs/51 正则
 *   R5 company.version 迁移期「在场必须 semver、缺场不违规」
 *   R6 E-2 约定入口=插件 package.json main + dsh.bundle.patch 所指 + patch insert 条目
 *       name 字段所指（docs/34-§3.1 dsh 插件形态的声明面）
 *   R7 A-4/E-3 两面同禁 .AIWS；.studio-next/ 源面禁、产物面豁免
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml'
import { simpleGit } from 'simple-git'
import type { CompanySnapshot, DirectoryIssue, MountResult } from '@studio-next/contract'
import { loadCompanyDirectory } from './validator.ts'
import { lineOfPath } from './multifile.ts'
import {
  extractPersonAttrs,
  parsePlainVersion,
  planPluginInstalls,
  safeParseDependencies,
  type CompanyDependencies,
  type PluginInstallItem,
} from './dependencies.ts'
import { readDirectoryFiles } from './init.ts'

// ————————————————————————— 0. 规则号/常量（docs/51-§一..§六） —————————————————————————

export type RepoRuleId =
  | 'A-1' | 'A-2' | 'A-3' | 'A-4' | 'A-5'
  | 'B-1' | 'B-2' | 'B-3' | 'B-4' | 'B-5' | 'B-6'
  | 'C-1' | 'C-2' | 'C-3' | 'C-4' | 'C-5' | 'C-6' | 'C-7' | 'C-8'
  | 'D-1' | 'D-2' | 'D-3' | 'D-4'
  | 'E-1' | 'E-2' | 'E-3' | 'E-4'

/** 判定面：source=源仓（含 git-url 的克隆产物）；product=导入镜像+重建后的产物（锚豁免） */
export type RepoFace = 'source' | 'product'

/**
 * 顶层封闭集（docs/51-§二 枚举 + 框架自管两员 R2）：
 *   - 文件位：org-config.yaml / charter.md / dependencies.yaml / .gitignore / README.md /
 *     .studio-next.yaml（docs/44-§v1.1 挂载元信息随行）
 *   - 目录位：charter/ departments/ prompts/ docs/ plugins/ reports/（B-4 output 锚定的
 *     产出根；templates 与 DEV-27 允许集先例）
 */
const CLOSED_TOP_FILES: readonly string[] = [
  'org-config.yaml', 'charter.md', 'dependencies.yaml', '.gitignore', 'README.md', '.studio-next.yaml',
]
const CLOSED_TOP_DIRS: readonly string[] = ['charter', 'departments', 'prompts', 'docs', 'plugins', 'reports']

/** 锚目录与员工工作区（A-4/A-5/E-3 面语义见头注 R7） */
const ANCHOR_DIR = '.studio-next'
const AIWS_DIR = '.AIWS'

/** walk 排除面：.git=版本库非契约（A-3，克隆/解包同理跳过）；.DS_Store=系统杂音（与 DEV-27 同口径） */
const WALK_SKIP_NAMES: readonly string[] = ['.git', '.DS_Store']

/** E-4 资源护栏（docs/51-§六：实现期参数，拟稿可调——常量单源） */
export const REPO_SINGLE_FILE_MAX_BYTES = 8 * 1024 * 1024
export const REPO_FILE_COUNT_MAX = 5000

/** B-1 slug 语法域（docs/51-§三：小写字母/数字/连字符，3-64 字符，两端不断字） */
export const DOCS51_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

/** R3：工号/部门段=slug 语法形状域（大小写/中文随全司惯例：AGENT-1 / 工程部 均合法） */
const ID_SEGMENT_RE = /^[A-Za-z0-9\u4e00-\u9fff]+(?:-[A-Za-z0-9\u4e00-\u9fff]+)*$/

/** R5：semver 三元组（x.y.z） */
const SEMVER_RE = /^\d+\.\d+\.\d+$/

const ORG_CONFIG_FILE = 'org-config.yaml'
const DEPENDENCIES_FILE = 'dependencies.yaml'
const TARBALL_RE = /\.(?:tar|tar\.gz|tgz|tar\.bz2|tar\.xz)$/i

// ————————————————————————— 1. 结果形状（docs/51-§七 输出契约） —————————————————————————

/** 单条违规：规则号 + 文件 + 位置（行号 L<n> 或键路径）+ 违规描述 + 修复建议 */
export interface RepoViolation {
  rule: RepoRuleId
  file: string
  location: string
  problem: string
  fix: string
  /** 共享核内层规则号（org-config/missing-field:company.slug 等——DEV-27 既有断言面） */
  via?: string
  /** DEV-27 结构闸别名（import/unknown-entry、import/aiws-present、import/anchor-present 等——新旧规则号共存，测试与运维双面可读） */
  alias?: string
}

/** 合法但须明示的面（D-2 冲突警示；缺 meta 的迁移期提示等——不阻断） */
export interface RepoWarning {
  rule: string
  file: string
  location: string
  problem: string
}

/** PASS 摘要（docs/51-§七：公司/部门/人数/jobs/插件/能力缺失面） */
export interface RepoValidateSummary {
  name: string
  slug: string
  level: number
  departments: number
  people: number
  jobs: number
  plugins: number
  platform: string
  /** D-3 能力缺失面（绑定插件无仓内源——合法，安装面另行处理） */
  capabilityMissing: { name: string; required: string[]; detail: string }[]
  /** D-2 约束并集无解面（冲突警示——合法不装错） */
  conflicts: { name: string; required: string[]; detail: string }[]
}

export interface RepoValidateResult {
  ok: boolean
  face: RepoFace
  violations: RepoViolation[]
  warnings: RepoWarning[]
  /** --allow-extra 豁免留痕（A-1 封闭集外路径逐条列出，不豁免其他组） */
  exempted: string[]
  summary?: RepoValidateSummary
  /** org 面合法即给出（导入流/摘要共用同一快照——单一事实源） */
  snapshot?: CompanySnapshot
}

export interface RepoValidateOptions {
  /** 缺省 source；DEV-27 产物面跑 product（锚豁免） */
  face?: RepoFace
  /** --allow-extra：A-1 封闭集外路径豁免并留痕（不豁免 B/C/D/E） */
  allowExtra?: boolean
}

// ————————————————————————— 2. 物理 walk（A 组 + E-1/E-3/E-4 输入） —————————————————————————

interface WalkFile {
  rel: string
  size: number
  executable: boolean
}

interface WalkOutcome {
  topNames: string[]
  files: WalkFile[]
  symlinks: string[]
  /** plugins/ 下条目名（含文件条目——非目录形态由 D-4 指认） */
  pluginEntries: string[]
}

async function walkRepo(root: string, face: RepoFace): Promise<WalkOutcome> {
  const out: WalkOutcome = { topNames: [], files: [], symlinks: [], pluginEntries: [] }
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (WALK_SKIP_NAMES.includes(entry.name)) continue
      // 产物面锚=框架自落（R7）：整棵不参与 A/E 闸与内容面
      if (depth === 0 && face === 'product' && entry.name === ANCHOR_DIR) continue
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (depth === 0) out.topNames.push(entry.name)
      if (entry.isSymbolicLink()) {
        out.symlinks.push(rel)
        continue
      }
      if (entry.isDirectory()) {
        if (depth === 0 && entry.name === 'plugins') {
          for (const sub of await readdir(path.join(dir, entry.name), { withFileTypes: true })) {
            out.pluginEntries.push(sub.name)
          }
        }
        await walk(path.join(dir, entry.name), rel, depth + 1)
        continue
      }
      if (entry.isFile()) {
        const st = await stat(path.join(dir, entry.name))
        out.files.push({ rel, size: st.size, executable: (st.mode & 0o111) !== 0 })
      }
    }
  }
  await walk(root, '', 0)
  return out
}

// ————————————————————————— 3. A/E 物理闸 —————————————————————————

function closedSetGate(
  w: WalkOutcome,
  opts: { face: RepoFace; allowExtra: boolean },
): { violations: RepoViolation[]; exempted: string[] } {
  const violations: RepoViolation[] = []
  const exempted: string[] = []
  const exemptPrefixes: string[] = []

  const a1 = (file: string, location: string, problem: string, fix: string): void => {
    if (opts.allowExtra) exempted.push(file)
    else violations.push({ rule: 'A-1', file, location, problem, fix, alias: 'import/unknown-entry' })
  }

  for (const name of w.topNames) {
    if (name === ANCHOR_DIR) {
      // A-5（源面）+ E-3 重申；产物面已在 walk 跳过（R7）
      violations.push({
        rule: 'A-5', file: name, location: '顶层',
        problem: '源仓自带 .studio-next/ 锚目录（锚=导入后框架自落，git info/exclude 本地排除——源仓出现即锚劫持面）',
        fix: '删除 .studio-next/ 整目录（信任锚由框架在导入落锚时写入）',
        alias: 'import/anchor-present',
      })
      violations.push({
        rule: 'E-3', file: name, location: '顶层',
        problem: '源仓自带 .studio-next/ 锚目录（E 组重申：卫生闸跑在克隆产物上，此类目录必须在源仓 absent）',
        fix: '同 A-5：删除该目录',
        alias: 'import/anchor-present',
      })
      continue
    }
    if (name === AIWS_DIR) {
      violations.push({
        rule: 'A-4', file: name, location: '顶层',
        problem: '.AIWS/ 员工工作区出现在公司仓内（工作区在仓外同级——docs/43-§五，仓内出现即结构污染）',
        fix: '移出 .AIWS/ 到公司目录同级（框架导入流自会建树），不得入仓',
        // 专名别名：.AIWS 是已知的 daemon 自管目录，不是「未知文件」——DEV-33 收口
        // （与锚 import/anchor-present 对称；判定先于封闭集，不依赖清单成员关系）
        alias: 'import/aiws-present',
      })
      violations.push({
        rule: 'E-3', file: name, location: '顶层',
        problem: '.AIWS/ 出现在公司仓内（E 组重申：两面同禁——员工工作区不是公司配置面）',
        fix: '同 A-4：移出仓外',
        alias: 'import/aiws-present',
      })
      continue
    }
    if (!CLOSED_TOP_DIRS.includes(name) && !CLOSED_TOP_FILES.includes(name)) {
      if (opts.allowExtra) {
        exempted.push(name)
        exemptPrefixes.push(`${name}/`)
      } else {
        a1(name, '顶层', '封闭集外路径（docs/51-§二 枚举之外的顶层条目）', `删除 ${name}，或归位到封闭集内目录（--allow-extra 可显式豁免并留痕）`)
      }
    }
  }

  // A-1 子树形状：departments/** 只收 config.yaml 与 people/<工号>.md（深层嵌套部门按
  // 同一形状收——宽容位与 multifile ④ 同口径）；charter/ 只收一层 <名>.md（docs/51-§二）
  for (const f of w.files) {
    if (exemptPrefixes.some((p) => f.rel.startsWith(p))) continue
    if (f.rel.startsWith('departments/')) {
      const okShape =
        /^departments\/(?:[^/]+\/)*config\.yaml$/.test(f.rel) ||
        /^departments\/(?:[^/]+\/)*people\/[^/]+\.md$/.test(f.rel)
      if (!okShape) {
        a1(f.rel, '路径形状', 'departments/ 子树只收 config.yaml 与 people/<工号>.md（docs/51-§二 树形）', `移走 ${f.rel}（部门内附加文本归 docs/ 或 prompts/）`)
      }
      continue
    }
    if (f.rel.startsWith('charter/') && !/^charter\/[^/]+\.md$/.test(f.rel)) {
      a1(f.rel, '路径形状', 'charter/ 只收一层 <名>.md（docs/51-§二：charter.md 或 charter/<名>.md）', `整理 ${f.rel} 为 charter/<名>.md 形态`)
    }
  }
  return { violations, exempted }
}

function hygieneGate(w: WalkOutcome): RepoViolation[] {
  const violations: RepoViolation[] = []
  // E-1 符号链接（任意深度；.git 内不判——版本库非契约）
  for (const rel of w.symlinks) {
    violations.push({
      rule: 'E-1', file: rel, location: '符号链接',
      problem: '符号链接条目（克隆产物上可指向仓外——拒收）',
      fix: `以真实文件/目录替换 ${rel}`,
      alias: 'import/symlink-entry',
    })
  }
  // E-4 单文件 >8MB / 总数 >5000
  for (const f of w.files) {
    if (f.size > REPO_SINGLE_FILE_MAX_BYTES) {
      violations.push({
        rule: 'E-4', file: f.rel, location: `文件 ${Math.ceil(f.size / 1024 / 1024)}MB`,
        problem: `单文件超过 ${REPO_SINGLE_FILE_MAX_BYTES / 1024 / 1024}MB 资源护栏`,
        fix: `瘦身 ${f.rel}（大资产走外部存储，公司仓只收配置与文本）`,
      })
    }
  }
  if (w.files.length > REPO_FILE_COUNT_MAX) {
    violations.push({
      rule: 'E-4', file: '(仓库)', location: `文件数 ${w.files.length}`,
      problem: `文件总数超过 ${REPO_FILE_COUNT_MAX} 资源护栏`,
      fix: '裁剪仓库（公司仓不是资产库；生成物不入版本库）',
    })
  }
  return violations
}

/**
 * E-2 约定入口集（R6）：插件 package.json `main` + `dsh.bundle.patch` 所指文件 +
 * patch insert 条目 name 字段所指文件（./src/index.mjs 形态——docs/34-§3.1 声明面）。
 * 入口集之外任何 exec 位 → E-2（闸跑克隆产物——git clone 保 exec 位，恶意者可旅行）。
 */
function pluginAllowedExecutables(files: Record<string, string>, pluginName: string): Set<string> {
  const allowed = new Set<string>()
  const base = `plugins/${pluginName}`
  const addRef = (ref: unknown): void => {
    if (typeof ref !== 'string' || ref === '') return
    const clean = ref.replace(/^\.\//, '')
    if (clean === '' || clean.startsWith('/') || clean.split('/').includes('..')) return
    allowed.add(`${base}/${clean}`)
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(files[`${base}/package.json`] ?? '')
  } catch {
    return allowed // package.json 缺失/坏 JSON → D-4 指认；E-2 无入口可豁免
  }
  if (pkg === null || typeof pkg !== 'object') return allowed
  const rec = pkg as Record<string, unknown>
  addRef(rec['main'])
  const dsh = rec['dsh']
  const bundle = dsh !== null && typeof dsh === 'object' ? (dsh as Record<string, unknown>)['bundle'] : undefined
  if (bundle !== null && typeof bundle === 'object') {
    const patch = (bundle as Record<string, unknown>)['patch']
    if (typeof patch === 'string') {
      const patchRel = `${base}/${patch.replace(/^\.\//, '')}`
      allowed.add(patchRel)
      const patchSrc = files[patchRel]
      if (patchSrc !== undefined) {
        try {
          collectPatchNameRefs(parseYaml(patchSrc), addRef)
        } catch {
          // patch 解析失败 → D-4 指认；E-2 不额外豁免
        }
      }
    }
  }
  return allowed
}

/** patch yml 递归收集 insert 条目 name: ./rel 形态的入口引用 */
function collectPatchNameRefs(node: unknown, addRef: (ref: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPatchNameRefs(item, addRef)
  } else if (node !== null && typeof node === 'object') {
    for (const [k, sub] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'name') addRef(sub)
      else collectPatchNameRefs(sub, addRef)
    }
  }
}

// ————————————————————————— 4. B/C 内容面（共享核映射 + 判定器增补） —————————————————————————

/** 共享核 DirectoryIssue → docs/51 规则号映射（via 保留内层规则号） */
function mapSharedIssue(issue: DirectoryIssue): RepoViolation | null {
  const at = (rule: RepoRuleId, problem: string, alias?: string): RepoViolation => ({
    rule,
    file: issue.file,
    location: `L${issue.line}`,
    problem,
    fix: issue.fix,
    via: issue.rule,
    ...(alias !== undefined ? { alias } : {}),
  })
  if (issue.rule === 'org-config/missing-file') return null // A-2 物理闸已指认（避免双报）
  if (issue.rule === 'org-config/yaml-syntax') return at('B-1', 'org-config.yaml YAML 语法错误')
  if (issue.rule === 'org-config/level-count-mismatch') return at('C-8', 'level_distribution 总账与 people 实数不一致')
  if (issue.rule === 'org-config/dangling-ref') {
    const leader = issue.fix.startsWith('leader')
    return at(leader ? 'C-3' : 'C-1', leader ? '部门 leader 悬空（不在 people 索引）' : '人员 dept 悬空（不在 departments 索引）')
  }
  if (/^org-config\/missing-field(?::|$)/.test(issue.rule)) {
    const first = (issue.rule.split(':')[1] ?? '').split('.')[0]
    const rule: RepoRuleId = first === 'departments' ? 'B-2' : first === 'people' ? 'B-3' : first === 'jobs' ? 'B-4' : 'B-1'
    return at(rule, 'org-config.yaml 逐文件 schema 违规（键形状/值域）')
  }
  switch (issue.rule.split(':')[0]) {
    case 'dept/dangling':
      return at('A-2', 'org-config 声明的部门缺 config.yaml（必备位缺件）')
    case 'dept/orphan':
      return at('B-2', '部门 config.yaml 无对应 org-config 声明（索引-文件双检）')
    case 'dept/leader-dangling':
      return at('C-3', '部门 config leader 悬空（非 people 成员工号）')
    case 'dept/yaml-syntax':
    case 'dept/missing-field':
      return at('B-2', '部门 config.yaml schema 违规')
    case 'people/bad-front-matter':
      return at('B-3', '人事档案缺 front-matter（--- 分隔）')
    case 'people/dangling':
      return at('C-4', 'people[].file 指向的档案文件不存在')
    case 'people/orphan':
      return at('C-4', '档案文件无 org-config people 索引条目')
    case 'people/file-id-mismatch':
    case 'people/id-mismatch':
      return at('C-4', '档案文件名与工号不一致（<dept>/people/<工号>.md 锚定）')
    case 'people/missing-field':
      return at('B-3', '人事档案 front-matter schema 违规')
    case 'charter/dangling':
      return at('C-2', 'charter_ref 指向的文件不存在')
    case 'meta/missing-file':
      return null // R2：缺 .studio-next.yaml 不违规（docs/51 A-2 未列；导入产物面补桩）
    case 'meta/yaml-syntax':
    case 'meta/missing-field':
    case 'meta/schema-mismatch':
      return at('B-1', '.studio-next.yaml 挂载元信息损坏（R2：随行面在场须完整且与 org schema 同源）')
    default:
      return at('B-1', '目录契约违规（共享核指认）')
  }
}

/** 判定器增补面：共享核未覆盖的 docs/51 值域/交叉引用（slug/version/dist/唯一性/C-4 锚定/C-5/C-6/B-6） */
function layerExtras(files: Record<string, string>, orgSrc: string, charterRef: string): RepoViolation[] {
  // 索引本位检查（形状/唯一性/值域/锚定）只依赖 org-config 可解析——不挂全局面成败：
  // 共享核先行指认结构/交叉问题，增补面照常补位（B-3 形状不因 C-4 先发而被吞）
  const lc = new LineCounter()
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(orgSrc, { lineCounter: lc })
  } catch {
    return [] // YAML 语法崩坏已由共享核 B-1 指认——增补面无从挂点
  }
  const raw = doc.toJS()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [] // 同上：结构面已指认
  const out: RepoViolation[] = []
  const lineAt = (keyPath: (string | number)[]): number => lineOfPath(doc, lc, keyPath)
  const company = ((raw as Record<string, unknown>)['company'] ?? {}) as Record<string, unknown>

  // B-1 slug 语法域（docs/51 小写正则；R4：判定器按规范正则收，严于 init 通道）
  const slug = typeof company['slug'] === 'string' ? company['slug'] : ''
  if (!DOCS51_SLUG_RE.test(slug)) {
    out.push({
      rule: 'B-1', file: ORG_CONFIG_FILE, location: `L${lineAt(['company', 'slug'])}`,
      problem: `company.slug="${slug}" 不在 slug 语法域（^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$——小写字母/数字/连字符，3-64 字符，两端不断字）`,
      fix: '改为全小写连字符 slug（例：demo-corp）',
    })
  }
  // R5 version：在场必须 semver 三元组
  if (company['version'] !== undefined && (typeof company['version'] !== 'string' || !SEMVER_RE.test(company['version']))) {
    out.push({
      rule: 'B-1', file: ORG_CONFIG_FILE, location: `L${lineAt(['company', 'version'])}`,
      problem: `company.version=${JSON.stringify(company['version'])} 不是 semver 三元组（x.y.z）`,
      fix: '改为形如 1.0.0 的 semver（迁移期可缺省该键）',
    })
  }
  // B-1 level_distribution：值=非负整数（docs/51-§三）
  const dist = (company['level_distribution'] ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(dist)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      out.push({
        rule: 'B-1', file: ORG_CONFIG_FILE, location: `company.level_distribution.${k}`,
        problem: `level_distribution["${k}"]=${JSON.stringify(v)}（值须为非负整数）`,
        fix: '改为非负整数（该档人数）',
      })
    }
  }

  const departments = Array.isArray(raw['departments']) ? (raw['departments'] as Record<string, unknown>[]) : []
  const people = Array.isArray(raw['people']) ? (raw['people'] as Record<string, unknown>[]) : []
  const jobs = Array.isArray(raw['jobs']) ? (raw['jobs'] as Record<string, unknown>[]) : []
  const deptPaths = new Set(departments.map((d) => String(d['path'] ?? '')))

  // B-3 工号：形状 + 全司唯一
  const seenIds = new Map<string, number>()
  people.forEach((p, i) => {
    const id = typeof p['id'] === 'string' ? p['id'] : ''
    if (!ID_SEGMENT_RE.test(id)) {
      out.push({
        rule: 'B-3', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'id'])}`,
        problem: `people[${i}].id="${id}" 不在工号语法形状域（字母/数字/连字符段，两端不断字——R3：大小写随全司惯例）`,
        fix: '改为 AGENT-1 形态工号',
      })
    }
    const first = seenIds.get(id)
    if (first !== undefined) {
      out.push({
        rule: 'B-3', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'id'])}`,
        problem: `工号 ${id} 重复（全司唯一；首见 people[${first}]）`,
        fix: `改 people[${i}].id 为未用工号`,
      })
    } else {
      seenIds.set(id, i)
    }
  })

  // B-4 jobs id 全司唯一
  const seenJobs = new Map<string, number>()
  jobs.forEach((j, i) => {
    const id = typeof j['id'] === 'string' ? j['id'] : ''
    const first = seenJobs.get(id)
    if (first !== undefined) {
      out.push({
        rule: 'B-4', file: ORG_CONFIG_FILE, location: `L${lineAt(['jobs', i, 'id'])}`,
        problem: `jobs[${i}].id="${id}" 重复（全司唯一；首见 jobs[${first}]）`,
        fix: '定时岗 id 改为全司唯一串',
      })
    } else {
      seenJobs.set(id, i)
    }
  })

  // C-4 file 路径锚定：在场必须恰为 <dept>/people/<工号>.md（docs/51-§三 B-3/C-4）
  people.forEach((p, i) => {
    if (p['file'] === undefined) return // 缺省由共享核推导（M2.2-②）
    const dept = String(p['dept'] ?? '')
    const id = String(p['id'] ?? '')
    if (p['file'] !== `${dept}/people/${id}.md`) {
      out.push({
        rule: 'C-4', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'file'])}`,
        problem: `people[${i}].file=${JSON.stringify(p['file'])} 与锚定位 ${dept}/people/${id}.md 不一致`,
        fix: `改为 ${dept}/people/${id}.md（或删 file 键走缺省推导）`,
      })
    }
  })

  // C-6 parent：悬空（不在 departments[].path 索引）或成环（链走不终于 null）
  departments.forEach((d, i) => {
    const parent = d['parent']
    if (parent === null || parent === undefined) return
    const parentPath = String(parent)
    if (!deptPaths.has(parentPath)) {
      out.push({
        rule: 'C-6', file: ORG_CONFIG_FILE, location: `L${lineAt(['departments', i, 'parent'])}`,
        problem: `departments[${i}].parent="${parentPath}" 悬空（不在 departments[].path 索引）`,
        fix: '改为已登记部门 path，或 null（根部门）',
      })
      return
    }
    const visited = new Set<string>([String(d['path'] ?? '')])
    let cursor: unknown = parent
    while (typeof cursor === 'string') {
      if (visited.has(cursor)) {
        out.push({
          rule: 'C-6', file: ORG_CONFIG_FILE, location: `L${lineAt(['departments', i, 'parent'])}`,
          problem: `departments[${i}].parent 链成环（${[...visited, cursor].join(' → ')}）`,
          fix: '部门树 parent 链必须终于 null（根部门）——断环',
        })
        return
      }
      visited.add(cursor)
      const node = departments.find((x) => String(x['path'] ?? '') === cursor)
      if (node === undefined) break // 悬空由上方单检指认
      cursor = node['parent']
    }
  })

  // C-5 双清单互检：org-config jobs ↔ 部门 config jobs（双向）
  const rootDept = departments.find((d) => d['parent'] === null) ?? departments[0]
  const orgJobIds = new Set(jobs.map((j) => String(j['id'] ?? '')))
  const configJobs = new Map<string, string[]>()
  for (const d of departments) {
    const p = String(d['path'] ?? '')
    const src = files[`${p}/config.yaml`]
    if (src === undefined) continue // dept/dangling 由共享核指认（A-2）
    try {
      const parsed = parseYaml(src) as Record<string, unknown>
      if (Array.isArray(parsed['jobs'])) {
        configJobs.set(p, parsed['jobs'].filter((x): x is string => typeof x === 'string'))
      }
    } catch {
      continue // dept config YAML 语法错由共享核指认
    }
  }
  for (const j of jobs) {
    const id = String(j['id'] ?? '')
    const dept = typeof j['dept'] === 'string' ? j['dept'] : String(rootDept?.['path'] ?? '')
    const list = configJobs.get(dept)
    if (list === undefined || !list.includes(id)) {
      out.push({
        rule: 'C-5', file: `${dept}/config.yaml`, location: 'jobs',
        problem: `org-config jobs 岗位 "${id}" 挂靠 ${dept}，但其部门 config jobs 清单未收录（${list === undefined ? '清单缺失' : `现清单 [${list.join(', ')}]`}）`,
        fix: `在 ${dept}/config.yaml jobs 清单补 "${id}"（双清单必须一致）`,
      })
    }
  }
  for (const [dept, list] of configJobs) {
    for (const id of list) {
      if (!orgJobIds.has(id)) {
        out.push({
          rule: 'C-5', file: `${dept}/config.yaml`, location: 'jobs',
          problem: `部门 config jobs 清单含 "${id}"，但 org-config.yaml jobs 段无此岗`,
          fix: `补 org-config jobs 段该岗，或从 ${dept}/config.yaml 清单移除`,
        })
      }
    }
  }

  // B-6 charter 与 prompts/ 非空文本
  const charterSrc = files[charterRef]
  if (charterSrc !== undefined && charterSrc.trim() === '') {
    out.push({
      rule: 'B-6', file: charterRef, location: 'L1',
      problem: `章程文件 ${charterRef} 为空（charter 与 prompts/ 须非空文本）`,
      fix: '补章程正文（空文件不算章程）',
    })
  }
  for (const [rel, src] of Object.entries(files)) {
    if (rel.startsWith('prompts/') && src.trim() === '') {
      out.push({
        rule: 'B-6', file: rel, location: 'L1',
        problem: `prompts/ 片段 ${rel} 为空文件`,
        fix: '补提示词片段正文或删除该文件',
      })
    }
  }
  return out
}

// ————————————————————————— 5. D 组（依赖面） —————————————————————————

interface DepsFace {
  violations: RepoViolation[]
  conflicts: RepoValidateSummary['conflicts']
  capabilityMissing: RepoValidateSummary['capabilityMissing']
  deps: CompanyDependencies | null
}

function depsFace(
  files: Record<string, string>,
  pluginEntries: readonly string[],
  orgSrcForPersons: string,
): DepsFace {
  const violations: RepoViolation[] = []
  const conflicts: RepoValidateSummary['conflicts'] = []
  const capabilityMissing: RepoValidateSummary['capabilityMissing'] = []

  // D-4：plugins/* 逐目录形态检查（不限于被绑定者——入仓插件必须个个成型）
  for (const name of pluginEntries) {
    const base = `plugins/${name}`
    const d4 = (location: string, problem: string, fix: string): void => {
      violations.push({ rule: 'D-4', file: base, location, problem, fix })
    }
    const pkgSrc = files[`${base}/package.json`]
    if (pkgSrc === undefined) {
      d4('package.json', '插件目录缺 package.json（dsh 插件形态——docs/34-§3.1）', `补 ${base}/package.json（name/version/main/dsh.bundle）或整目录移出 plugins/`)
      continue
    }
    let pkg: unknown
    try {
      pkg = JSON.parse(pkgSrc)
    } catch (err) {
      d4('package.json', `package.json 不是合法 JSON（${err instanceof Error ? err.message : String(err)}）`, '修 JSON 语法')
      continue
    }
    if (pkg === null || typeof pkg !== 'object') {
      d4('package.json', 'package.json 顶层须为对象', '改为 {"name","version","main","dsh.bundle"} 形态')
      continue
    }
    const rec = pkg as Record<string, unknown>
    if (typeof rec['name'] !== 'string' || rec['name'] === '') d4('package.json:name', '缺 name（非空串）', `补 "name"（约定=插件目录名 ${name}）`)
    if (typeof rec['version'] !== 'string' || parsePlainVersion(String(rec['version'])) === null) {
      d4('package.json:version', `version=${JSON.stringify(rec['version'])} 不是精确 x.y.z 版本`, '改为形如 1.0.0')
    }
    const dshRef = rec['dsh']
    const bundle = dshRef !== null && typeof dshRef === 'object' ? (dshRef as Record<string, unknown>)['bundle'] : undefined
    const patchRef = bundle !== null && typeof bundle === 'object' ? (bundle as Record<string, unknown>)['patch'] : undefined
    if (typeof patchRef !== 'string' || patchRef === '') {
      d4('package.json:dsh.bundle.patch', '缺 dsh.bundle.patch（字符串，指向仓内 patch 文件——嵌套 dsh.bundle 形态）', '补 "dsh": {"bundle": {"patch": "<file>.patch.yml"}} 并落盘该文件')
    } else {
      const patchRel = `${base}/${patchRef.replace(/^\.\//, '')}`
      if (files[patchRel] === undefined) d4(patchRel, 'dsh.bundle.patch 所指 patch 文件不在仓内', `补 ${patchRel}（含 insert 条目与 name: ./src/<入口>）`)
    }
  }

  // B-5/C-7/D-1/D-2/D-3：dependencies.yaml（可选件——缺场零绑定面，B-5 不违规）
  const depsSrc = files[DEPENDENCIES_FILE]
  if (depsSrc === undefined) return { violations, conflicts, capabilityMissing, deps: null }
  const parsed = safeParseDependencies(depsSrc)
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      const isAttr = issue.path.endsWith('.when.attr')
      const isVersion = issue.path.endsWith('.version')
      violations.push({
        rule: isAttr ? 'C-7' : isVersion ? 'D-1' : 'B-5',
        file: DEPENDENCIES_FILE,
        location: issue.path,
        problem: isAttr
          ? `when.attr 非法（${issue.message}——绑定域只收 role/dept/level/skills/executor/status）`
          : isVersion
            ? `version 约束非法（${issue.message}——只收 ^x.y(.z) 与精确两形态）`
            : `dependencies.yaml schema 违规（${issue.message}）`,
        fix: isAttr
          ? '改 when.attr 为六属性之一（role/dept/level/skills/executor/status）'
          : isVersion
            ? '改 version 为 ^1.2.3 或 1.2.3 形态（无 ~/>=/通配/*）'
            : '按 schema 修正 dependencies.yaml（strictObject——未知字段拒收）',
        via: `deps/invalid:${issue.path}`,
      })
    }
    return { violations, conflicts, capabilityMissing, deps: null }
  }

  // D-2 冲突警示 / D-3 能力缺失面（planPluginInstalls 决策面——installed 空=全新装视角；
  // org 面未过时传空串——persons 留空，B/C 组已先行指认，此处不重复报）
  const persons = orgSrcForPersons.trim() === '' ? [] : extractPersonAttrs(orgSrcForPersons)
  const sources: Record<string, { origin: 'package'; version: string }> = {}
  for (const name of pluginEntries) {
    const pkgSrc = files[`plugins/${name}/package.json`]
    if (pkgSrc === undefined) continue
    try {
      const pkg = JSON.parse(pkgSrc) as Record<string, unknown>
      if (typeof pkg['version'] === 'string') sources[name] = { origin: 'package', version: pkg['version'] }
    } catch {
      // D-4 已指认
    }
  }
  const items: PluginInstallItem[] = planPluginInstalls({ deps: parsed.data, persons, installed: {}, sources })
  for (const item of items) {
    if (item.action === 'conflict') conflicts.push({ name: item.name, required: item.required, detail: item.detail })
    else if (item.action === 'missing') capabilityMissing.push({ name: item.name, required: item.required, detail: item.detail })
  }
  return { violations, conflicts, capabilityMissing, deps: parsed.data }
}

// ————————————————————————— 6. 判定入口 —————————————————————————

/**
 * 公司仓库判定器主入口（docs/51 五契约全量）。物理 walk（A/E）+ 内容面（B/C 共享核+
 * 增补）+ 依赖面（D）。org 面合法即附 snapshot（导入流共用同一判定器——单一事实源）。
 * 目录不存在=判定器自身错误（RepoInputError，CLI exit 2），与仓库不合法（ok:false）严格区分。
 */
export async function validateCompanyRepo(dir: string, opts?: RepoValidateOptions): Promise<RepoValidateResult> {
  const face: RepoFace = opts?.face ?? 'source'
  const allowExtra = opts?.allowExtra === true
  if (!existsSync(dir)) throw new RepoInputError(`待判定目录不存在：${dir}`)
  const violations: RepoViolation[] = []
  const warnings: RepoWarning[] = []

  // — 物理 walk + A/E 闸 —
  const w = await walkRepo(dir, face)
  const gate = closedSetGate(w, { face, allowExtra })
  violations.push(...gate.violations, ...hygieneGate(w))

  // — A-2 必备位（org-config.yaml / 章程位 / ≥1 部门 config） —
  const hasOrg = w.files.some((f) => f.rel === ORG_CONFIG_FILE)
  if (!hasOrg) {
    violations.push({
      rule: 'A-2', file: ORG_CONFIG_FILE, location: '顶层',
      problem: '缺 org-config.yaml（公司配置必备位）',
      fix: '补 org-config.yaml（schema: studio-next/org@1 起手，docs/51-§三 B-1）',
    })
  }
  if (!w.files.some((f) => f.rel === 'charter.md' || /^charter\/[^/]+\.md$/.test(f.rel))) {
    violations.push({
      rule: 'A-2', file: 'charter.md', location: '顶层',
      problem: '缺章程位（charter.md 或 charter/<名>.md 必备其一）',
      fix: '补 charter.md（org-config.company.charter_ref 指向它）',
    })
  }
  if (!w.files.some((f) => /^departments\/(?:[^/]+\/)*config\.yaml$/.test(f.rel))) {
    violations.push({
      rule: 'A-2', file: 'departments/', location: '顶层',
      problem: '缺部门配置位（departments/<部门>/config.yaml ≥1）',
      fix: '补 departments/<部门>/config.yaml（org-config departments[] 逐条镜像）',
    })
  }

  // — 内容面（B/C）：readDirectoryFiles 与判定器同排除口径（.git/.DS_Store/.AIWS） —
  const files = await readDirectoryFiles(dir)
  let orgFaceOk = false
  let snapshot: CompanySnapshot | undefined
  if (hasOrg) {
    const orgFace: MountResult = loadCompanyDirectory(files, { strictFiles: false })
    if (!orgFace.ok) {
      for (const issue of orgFace.issues) {
        const mapped = mapSharedIssue(issue)
        if (mapped !== null) violations.push(mapped)
      }
    } else {
      orgFaceOk = true
      snapshot = orgFace.snapshot
      // A-2 增补：charter_ref 必须落在章程位（docs/51-§二 括注：charter_ref 指向章程位）
      const charterRef = snapshot.charter
      if (charterRef !== 'charter.md' && !charterRef.startsWith('charter/')) {
        violations.push({
          rule: 'A-2', file: charterRef, location: 'company.charter_ref',
          problem: `charter_ref="${charterRef}" 不在章程位（charter.md 或 charter/<名>.md）`,
          fix: '章程落在章程位，charter_ref 指向它',
        })
      }
      const full: MountResult = loadCompanyDirectory(files)
      if (!full.ok) {
        const metaMissing = files['.studio-next.yaml'] === undefined
        for (const issue of full.issues) {
          if (metaMissing && issue.rule === 'meta/missing-file') continue // R2：缺 meta 不违规
          const mapped = mapSharedIssue(issue)
          if (mapped !== null) violations.push(mapped)
        }
        if (metaMissing && full.issues.every((i) => i.rule === 'meta/missing-file')) {
          warnings.push({
            rule: 'meta/missing', file: '.studio-next.yaml', location: '顶层',
            problem: '缺 .studio-next.yaml 挂载元信息（docs/51 A-2 未列必备——合法；导入流产物面将补写缺省桩）',
          })
        }
      }
    }
  }

  // — 判定器增补面（org-config 在场即跑——索引本位检查不依赖全局面成败） —
  if (files[ORG_CONFIG_FILE] !== undefined) {
    violations.push(...layerExtras(files, files[ORG_CONFIG_FILE], snapshot?.charter ?? ''))
  }

  // — E-2 exec 位（约定入口外）——闸在物化产物上跑（克隆保 exec 位） —
  const allowedExec = new Set<string>()
  for (const name of w.pluginEntries) {
    for (const rel of pluginAllowedExecutables(files, name)) allowedExec.add(rel)
  }
  for (const f of w.files) {
    if (f.executable && !allowedExec.has(f.rel)) {
      violations.push({
        rule: 'E-2', file: f.rel, location: 'exec 位',
        problem: '可执行位文件（plugins 约定入口之外——克隆可旅行 exec 位，故拒收）',
        fix: `去除 exec 位（chmod -x ${f.rel}）；插件入口经 package.json main/patch 声明`,
        alias: 'import/exec-bit',
      })
    }
  }

  // — D 组 —
  const deps = depsFace(files, w.pluginEntries, orgFaceOk ? (files[ORG_CONFIG_FILE] ?? '') : '')
  violations.push(...deps.violations)
  for (const c of deps.conflicts) {
    warnings.push({
      rule: 'D-2', file: DEPENDENCIES_FILE, location: `plugins[${c.name}]`,
      problem: `约束并集无解（${c.required.join(' ∪ ')}）：${c.detail}——合法不阻断，安装面按冲突不装错处理`,
    })
  }

  const summary: RepoValidateSummary | undefined = snapshot === undefined ? undefined : {
    name: snapshot.name,
    slug: snapshot.slug,
    level: snapshot.level,
    departments: snapshot.departments.length,
    people: snapshot.people.length,
    jobs: snapshot.jobs.length,
    plugins: w.pluginEntries.length,
    platform: snapshot.platform.platform,
    capabilityMissing: deps.capabilityMissing,
    conflicts: deps.conflicts,
  }
  return {
    ok: violations.length === 0,
    face,
    violations,
    warnings,
    exempted: gate.exempted,
    ...(summary !== undefined ? { summary } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
  }
}

// ————————————————————————— 7. CLI 面：输入物化（路径 / git-url / tarball） —————————————————————————

/** 判定器自身错误（退出码 2 面：路径不存在/网络失败/解包失败——与「不合法」exit 1 严格区分） */
export class RepoInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoInputError'
  }
}

export type RepoInputKind = 'path' | 'git-url' | 'tarball'

export interface MaterializedRepoInput {
  kind: RepoInputKind
  /** 物化后的仓库目录（路径通道=原目录；git-url=克隆产物；tarball=解包产物） */
  dir: string
  cleanup: () => Promise<void>
}

function looksLikeGitUrl(input: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input)) return true // https:// / file:// / ssh://
  if (input.startsWith('git@')) return true // git@host:path
  return /^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/.test(input) // scp 形态 host:path
}

/**
 * 输入物化：目录→直用；tarball（.tar/.tar.gz/.tgz/…）→系统 tar 解包（条目先消毒：拒绝对
 * 路径与 .. 段）；git-url→simple-git 克隆到暂存。失败抛 RepoInputError（CLI 层 exit 2）。
 */
export async function materializeCompanyRepoInput(input: string): Promise<MaterializedRepoInput> {
  const trimmed = input.trim()
  if (trimmed === '') throw new RepoInputError('输入为空（用法：studio-next company validate <git-url|路径|tarball> [--json] [--allow-extra]）')

  let st: Awaited<ReturnType<typeof stat>> | undefined
  try {
    st = await stat(trimmed)
  } catch {
    st = undefined
  }
  if (st?.isDirectory() === true) {
    return { kind: 'path', dir: path.resolve(trimmed), cleanup: async () => undefined }
  }
  if (st?.isFile() === true && TARBALL_RE.test(trimmed)) {
    return extractTarball(trimmed)
  }
  if (st !== undefined) {
    throw new RepoInputError(`输入是文件但不是 tarball 形态（.tar/.tar.gz/.tgz）：${trimmed}`)
  }
  if (looksLikeGitUrl(trimmed)) {
    const staging = await mkdtemp(path.join(tmpdir(), 'studio-next-validate-'))
    const cloneDir = path.join(staging, 'src')
    try {
      await simpleGit().clone(trimmed, cloneDir)
    } catch (err) {
      await rm(staging, { recursive: true, force: true })
      throw new RepoInputError(`git 克隆失败（网络/权限/仓库不存在）：${err instanceof Error ? err.message : String(err)}`)
    }
    return { kind: 'git-url', dir: cloneDir, cleanup: async () => rm(staging, { recursive: true, force: true }) }
  }
  throw new RepoInputError(`路径不存在且不是 git-url：${trimmed}`)
}

async function extractTarball(tarPath: string): Promise<MaterializedRepoInput> {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-next-tar-'))
  const fail = async (reason: string): Promise<never> => {
    await rm(dir, { recursive: true, force: true })
    throw new RepoInputError(reason)
  }
  const list = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' })
  if (list.status !== 0) return fail(`tarball 无法读取（${(list.stderr ?? '').trim() || `tar -tf 退出码 ${list.status}`}）`)
  for (const rawEntry of list.stdout.split('\n')) {
    const entry = rawEntry.trim()
    if (entry === '') continue
    const normalized = entry.replace(/^\.\//, '')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      return fail(`tarball 条目不安全（${entry}——绝对路径或 .. 逃逸段，拒解包）`)
    }
  }
  const extract = spawnSync('tar', ['-xf', tarPath, '-C', dir], { encoding: 'utf8' })
  if (extract.status !== 0) return fail(`tarball 解包失败（${(extract.stderr ?? '').trim() || `tar -xf 退出码 ${extract.status}`}）`)
  // 常见形态：单根目录包裹（foo-1.0/…）→ 下探；org-config 在根则直用
  if (!existsSync(path.join(dir, ORG_CONFIG_FILE))) {
    const top = await readdir(dir, { withFileTypes: true })
    const only = top.length === 1 ? top[0] : undefined
    if (only !== undefined && only.isDirectory() && existsSync(path.join(dir, only.name, ORG_CONFIG_FILE))) {
      return { kind: 'tarball', dir: path.join(dir, only.name), cleanup: async () => rm(dir, { recursive: true, force: true }) }
    }
  }
  return { kind: 'tarball', dir, cleanup: async () => rm(dir, { recursive: true, force: true }) }
}

// ————————————————————————— 8. 渲染面（人读 + JSON；apps/daemon bin 消费） —————————————————————————

/** 人读输出（PASS=摘要+可初始化；FAIL=逐条违规——不许只说校验失败） */
export function renderRepoValidation(result: RepoValidateResult, input?: string): string {
  const lines: string[] = []
  const head = input !== undefined ? `（输入：${input}）` : ''
  if (result.ok) {
    const s = result.summary
    lines.push(`PASS${head}`)
    if (s !== undefined) {
      lines.push(`  ${s.name}（slug=${s.slug}，${s.level} 级公司，platform=${s.platform}）`)
      lines.push(`  部门 ${s.departments} · 人数 ${s.people} · jobs ${s.jobs} · 插件 ${s.plugins}（仓内）`)
      lines.push(`  能力面：${s.capabilityMissing.length === 0 ? '齐备' : `缺失 ${s.capabilityMissing.map((m) => `${m.name}（需求 ${m.required.join('|')}，无仓内源）`).join('；')}`}`)
    }
    if (result.exempted.length > 0) lines.push(`  豁免（--allow-extra）：${result.exempted.join('、')}`)
    lines.push('可初始化（company add 前置=validate PASS——docs/51-§七）')
  } else {
    lines.push(`FAIL${head} ${result.violations.length} 条违规（docs/51 五契约；退出码 1）`)
    for (const v of result.violations) {
      const alias = v.alias !== undefined ? `（${v.alias}）` : ''
      lines.push(`  [${v.rule}]${alias} ${v.file} @ ${v.location}：${v.problem}；修法：${v.fix}`)
    }
    if (result.exempted.length > 0) lines.push(`  豁免（--allow-extra）：${result.exempted.join('、')}`)
  }
  for (const warn of result.warnings) {
    lines.push(`  警示 [${warn.rule}] ${warn.file} @ ${warn.location}：${warn.problem}`)
  }
  return lines.join('\n')
}

/** JSON 输出（--json；结构=RepoValidateResult 投影，违规逐条四元组+via/alias） */
export function repoValidationJson(result: RepoValidateResult, input?: string): string {
  return JSON.stringify(
    {
      ok: result.ok,
      face: result.face,
      ...(input !== undefined ? { input } : {}),
      violations: result.violations.map((v) => ({
        rule: v.rule,
        file: v.file,
        location: v.location,
        problem: v.problem,
        fix: v.fix,
        ...(v.via !== undefined ? { via: v.via } : {}),
        ...(v.alias !== undefined ? { alias: v.alias } : {}),
      })),
      warnings: result.warnings,
      exempted: result.exempted,
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
    },
    null,
    2,
  )
}
