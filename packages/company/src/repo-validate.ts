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
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { CompanySnapshot, DirectoryIssue, MountResult } from '@studio-next/contract'
import { loadCompanyDirectory } from './validator.ts'
import { readDirectoryFiles } from './init.ts'

// 判定器分域拆件（docs/20-§十五.三；原文件余量 ≥50，行为零漂移）：
// model=规则号/常量/结果形状；layer-extras=增补面；deps-face=D 组；input-render=输入物化/渲染。
import {
  AIWS_DIR,
  ANCHOR_DIR,
  CLOSED_TOP_DIRS,
  CLOSED_TOP_FILES,
  DEPENDENCIES_FILE,
  ORG_CONFIG_FILE,
  REPO_FILE_COUNT_MAX,
  REPO_SINGLE_FILE_MAX_BYTES,
  WALK_SKIP_NAMES,
  type RepoFace,
  type RepoRuleId,
  type RepoValidateOptions,
  type RepoValidateResult,
  type RepoValidateSummary,
  type RepoViolation,
  type RepoWarning,
} from './repo-validate/model.ts'
import { layerExtras } from './repo-validate/layer-extras.ts'
import { depsFace } from './repo-validate/deps-face.ts'
import { RepoInputError } from './repo-validate/input-render.ts'

// 公开面再出口（packages/company/src/index.ts 的 `export *` 与既有导入面零改行）。
export type {
  RepoFace,
  RepoRuleId,
  RepoValidateOptions,
  RepoValidateResult,
  RepoValidateSummary,
  RepoViolation,
  RepoWarning,
} from './repo-validate/model.ts'
export { DOCS51_SLUG_RE, REPO_FILE_COUNT_MAX, REPO_SINGLE_FILE_MAX_BYTES } from './repo-validate/model.ts'
export { RepoInputError, materializeCompanyRepoInput } from './repo-validate/input-render.ts'
export { renderRepoValidation, repoValidationJson } from './repo-validate/input-render.ts'

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
