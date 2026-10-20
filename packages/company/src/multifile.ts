/**
 * 公司目录多文件交叉校验 v0.1-M2.2（docs/04-§二/§九；需求 C2-04/C2-05；清偿 validator.ts
 * v0 头注挂账「departments/** 与 people/** 正文文件、.studio-next.yaml 交叉校验后续单补齐」）
 *
 * 职责：org-config.yaml 单文件校验通过后的**全目录面**——
 *   1. departments/<部门>/config.yaml：形状 + 索引↔文件双检（孤儿/悬空）+ leader∈people 索引
 *   2. 人事档案 departments/<部门>/people/<工号>.md：front-matter 形状 + 文件名=工号 + 六节弱校验
 *      + people 索引↔档案双检（孤儿/悬空）
 *   3. charter_ref 存在性（org-config 指到的文件在树中）
 *   4. .studio-next.yaml：形状 + schema 版本与 org-config 同源
 * 零 IO：输入是内存文件映射（同 validator 纪律）；行号沿用 LineCounter + AST range 回爬
 * （lineOfPath 自 validator 迁入此处，validator 反向引用——单一实现）。
 *
 * 拟稿待批清单（M2.2-①..⑧，制作人批示后固化；docs/04-§九.0 结构合法≠内容同款贯穿）：
 *   ① 人事档案 front-matter 必填集 = id/name/login/level/dept（以模板实形收——01-C2 只定
 *      索引键口径，档案逐字段必填未定稿；role/reports_to/skills/side_effects/executor/status 可选）
 *   ② people[].file 键缺省时的档案路径推导 = <dept>/people/<工号>.md（04-§二 树形约定；
 *      模板实形显式带 file 键，推导口径待批）
 *   ③ 档案六节存在性弱校验：`## <序>、` 前缀 + 节关键词包含（容忍模板式括号后缀）；
 *      缺节 issue 行号=正文起始行（弱校验口径待批；节内内容不校验——C2-04 内容归档案流程）
 *   ④ 部门 config.yaml 必填集镜像 org-config departments 条目（name/path/level/parent/
 *      leader/lanes/functions 必填；reports_to/rules/relations/jobs 可选——04-§二 树注释
 *      「部门章程/规定/主管/职能/泳道/汇报线」未逐键定必填，按「索引必填则文件必填」收）
 *   ⑤ 部门 config jobs 清单收形状（非空串数组=定时岗 id 引用）；与 org-config jobs 段的
 *      一致性**不校验**——模板自身不一致（config 只列 daily-report-工程部，org-config 两岗），
 *      模板对齐后另行收口（见本单汇报）
 *   ⑥ .studio-next.yaml 仅 schema 必填（版本一致性检查的输入）；template/created_at/
 *      last_validated_at/last_validation/framework_version 可选但收形状（null=未盖戳）；
 *      ISO 8601 正则口径 = 日期T时刻[.毫秒](Z|±HH:MM)（模板注释「带时区偏移」+init 写入
 *      toISOString() 双口径取并）
 *   ⑦ 孤儿与悬空同为阻断级 issue——DirectoryIssue 无 severity 通道（契约面），「孤儿=告警级」
 *      需先扩契约再降级；暂按阻断实现（C2-05 双检精确报工号，不静默）
 *   ⑧ charter 悬空规则名 charter/dangling（与其他域 <域>/dangling 同款命名，命名待批）
 *
 * 宽容位（strictFiles，M2.2-⑨ 拟稿待批——方案本体见 validator.ts MountOptions 头注）：
 *   multifileRules 只在 strictFiles!==false 时由 loadCompanyDirectory 调入；dir 域契约
 *   subject（dirSubject）传 false 保持 v0 单文件语义（CASES.md dir 域 v1 语义增补说明）。
 */
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { DirectoryIssue } from '@studio-next/contract'
import type { OrgConfig } from './validator.ts'

/**
 * org-config.yaml 的 schema 版本字面量（.studio-next.yaml 一致性检查的同源基准）。
 * DEV-32（docs/51-§三 B-1 定稿）起规范字面量为 `studio-next/org@1`；仓内既有语料
 * （templates×3 / DEV-27 夹具 / contract cases.json 冻结语料）仍为 `org-config/v1`——
 * 迁移期收**并集**（canonical 在前；语料迁移完成后收单表，走 docs/51-§九 版本化修订流）。
 */
export const ORG_CONFIG_SCHEMA_VERSION = 'org-config/v1'
export const ORG_CONFIG_SCHEMA_LITERALS = ['studio-next/org@1', ORG_CONFIG_SCHEMA_VERSION] as const

const ORG_CONFIG_FILE = 'org-config.yaml'
const META_FILE = '.studio-next.yaml'

// ───────────────────────── 共用：行号定位（自 validator 迁入，单一实现） ─────────────────────────

interface YamlNodeLike { range?: readonly number[] | null }

/** zod 路径 → 源行：从完整路径逐级上爬，取第一个有 range 的 AST 节点；兜底第 1 行。
 *  offset：fm 块等「文档内行号→文件行号」的平移量（multifile 人事档案用）。 */
export function lineOfPath(doc: ReturnType<typeof parseDocument>, lc: LineCounter, path: (string | number)[], offset = 0): number {
  for (let cut = path.length; cut >= 0; cut--) {
    const node = doc.getIn(path.slice(0, cut), true)
    if (node !== null && typeof node === 'object') {
      const range = (node as YamlNodeLike).range
      if (range && range.length > 0 && range[0] !== undefined) {
        const pos = lc.linePos(range[0])
        return pos.line + offset // linePos 返回 1 基行号（实测校准）
      }
    }
  }
  return 1 + offset
}

/** zod issues → DirectoryIssue（按文件与规则前缀参数化；org-config/dept-config/people-fm/meta 共用） */
export function zodIssuesToDirectoryIssues(
  doc: ReturnType<typeof parseDocument>,
  lc: LineCounter,
  issues: z.ZodIssue[],
  file: string,
  rulePrefix: string,
  offset = 0,
): DirectoryIssue[] {
  return issues.map((zi) => {
    const path = zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
    return {
      file,
      line: lineOfPath(doc, lc, path, offset),
      rule: `${rulePrefix}:${path.join('.') || '(root)'}`,
      fix: zi.message,
    }
  })
}

function parseYaml(src: string): { doc: ReturnType<typeof parseDocument>; lc: LineCounter } {
  const lc = new LineCounter()
  return { doc: parseDocument(src, { lineCounter: lc }), lc }
}

/** yaml 语法错误 → 逐条 issue（文件级共用） */
function yamlSyntaxIssues(doc: ReturnType<typeof parseDocument>, lc: LineCounter, file: string, rule: string): DirectoryIssue[] {
  return doc.errors.map((e) => ({
    file,
    line: e.pos[0] !== undefined ? lc.linePos(e.pos[0]).line : 1,
    rule,
    fix: e.message,
  }))
}

// ───────────────────────── 1. departments/**/config.yaml ─────────────────────────

/**
 * 部门配置形状（04-§二 树注释 + 模板实形；必填集拟稿 M2.2-④）。
 * relations 形状先行与 org-config departments[].relations 同款（C2-02 / docs/25 DeptRelation），
 * 引用完整性（to 悬空等）仍留 relations 完整规则单。jobs=定时岗 id 清单（M2.2-⑤）。
 */
const DeptConfigSchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().min(1),
  level: z.number().int(),
  parent: z.string().nullable(),
  leader: z.string().min(1),
  lanes: z.array(z.string().min(1)),
  functions: z.array(z.string().min(1)),
  reports_to: z.string().nullable().optional(),
  rules: z.array(z.string()).optional(),
  relations: z.array(z.record(z.string(), z.unknown())).optional(),
  jobs: z.array(z.string().min(1)).optional(),
})

/** departments/<部门>/config.yaml 发现（含嵌套子部门 departments/A/departments/B/config.yaml——04-§二） */
function isDeptConfigFile(p: string): boolean {
  return /(?:^|\/)departments\/[^/]+\/config\.yaml$/.test(p)
}

// ───────────────────────── 2. 人事档案 front-matter + 六节 ─────────────────────────

/**
 * 人事档案 front-matter 形状（01-C2-04 + 模板实形；必填集拟稿 M2.2-①）。
 * side_effects 为档案独有键（防派错工，01-C2-04）；org-config people[] 索引无此键。
 */
const PersonFrontMatterSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  login: z.string().min(1),
  level: z.number().int(),
  dept: z.string().min(1),
  role: z.string().optional(),
  reports_to: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  side_effects: z.array(z.string()).optional(),
  executor: z.string().optional(),
  status: z.string().optional(),
})

/** departments/<部门>/people/<工号>.md 发现（04-§二：档案挂部门树下） */
function isPersonFile(p: string): boolean {
  return /(?:^|\/)departments\/[^/]+\/people\/[^/]+\.md$/.test(p)
}

/** 档案固定六节（01-C2-04：定位/职责/做过的事/技能本体/表现画像/自述）；弱匹配拟稿 M2.2-③ */
const PERSON_SECTIONS: ReadonlyArray<readonly [numeral: string, keyword: string]> = [
  ['一', '定位'],
  ['二', '职责'],
  ['三', '做过的事'],
  ['四', '技能本体'],
  ['五', '表现画像'],
  ['六', '自述'],
]

interface FrontMatterExtraction { fmText: string; closeLine: number }

/** front-matter 抽取：首行 `---` 起、首个整行 `---` 止（C2-04 约定）；无分隔结构 → null */
function extractFrontMatter(src: string): FrontMatterExtraction | null {
  const lines = src.split('\n')
  const first = lines[0]
  if (first === undefined || first.trimEnd() !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.trimEnd() === '---') {
      return { fmText: lines.slice(1, i).join('\n'), closeLine: i + 1 } // closeLine=1 基行号
    }
  }
  return null
}

interface ValidatedPerson {
  fm: z.infer<typeof PersonFrontMatterSchema>
  /** front-matter 内 id 键所在文件行（id-mismatch 定位用） */
  idLine: number
}

/** 单份档案校验（front-matter 形状 + 六节存在性）；issue 直推 issues，返回 null=结构不完整 */
function validatePersonFile(path: string, src: string, issues: DirectoryIssue[]): ValidatedPerson | null {
  const extracted = extractFrontMatter(src)
  if (extracted === null) {
    issues.push({ file: path, line: 1, rule: 'people/bad-front-matter', fix: '人事档案必须以 --- 分隔的 front-matter 开头（首行 --- 起、首个整行 --- 止，01-C2-04）' })
    return null
  }
  const fmLineOffset = 1 // fm 文档第 1 行 = 文件第 2 行（首行是开界 ---）
  const { doc, lc } = parseYaml(extracted.fmText)
  if (doc.errors.length > 0) {
    for (const issue of yamlSyntaxIssues(doc, lc, path, 'people/bad-front-matter')) {
      issues.push({ ...issue, line: issue.line + fmLineOffset })
    }
    return null
  }
  const parsed = PersonFrontMatterSchema.safeParse(doc.toJS())
  if (!parsed.success) {
    issues.push(...zodIssuesToDirectoryIssues(doc, lc, parsed.error.issues, path, 'people-fm/missing-field', fmLineOffset))
    return null
  }
  // 六节弱校验（M2.2-③）：正文起始行起找 `## <序>、…<关键词>`；缺节定位到正文起始行
  const bodyStart = extracted.closeLine + 1
  const bodyLines = src.split('\n').slice(extracted.closeLine)
  for (const [numeral, keyword] of PERSON_SECTIONS) {
    const present = bodyLines.some((line) => new RegExp(`^##\\s*${numeral}、`).test(line) && line.includes(keyword))
    if (!present) {
      issues.push({
        file: path,
        line: bodyStart,
        rule: `people/missing-section:${numeral}`,
        fix: `档案缺固定六节之「${numeral}、${keyword}」（01-C2-04；弱校验只查节标题存在，节内内容归人事流程）`,
      })
    }
  }
  return { fm: parsed.data, idLine: lineOfPath(doc, lc, ['id'], fmLineOffset) }
}

// ───────────────────────── 4. .studio-next.yaml ─────────────────────────

/** ISO 8601（带时区偏移或 Z；毫秒可选）——模板注释口径 + init 写入 toISOString() 双口径取并（M2.2-⑥） */
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const isoOrNull = z.union([z.null(), z.string().regex(ISO8601_RE, { message: '须为 ISO 8601 带时区偏移（如 2026-10-16T09:00:00+08:00 或 Z 结尾），或 null=未盖戳' })])

/** 挂载元信息形状（04-§二 + 模板实形；仅 schema 必填——M2.2-⑥） */
const StudioNextMetaSchema = z.strictObject({
  schema: z.string().min(1),
  template: z.string().min(1).optional(),
  created_at: isoOrNull.optional(),
  last_validated_at: isoOrNull.optional(),
  last_validation: z.union([z.null(), z.literal('pass'), z.literal('fail')]).optional(),
  framework_version: z.union([z.null(), z.string()]).optional(),
})

// ───────────────────────── 全目录规则入口 ─────────────────────────

/**
 * 多文件交叉规则总入口（只在 org-config 单文件校验全绿后调入——org 不合法时先修索引再谈目录）。
 * 输出的 issues 与 crossRules 直接合并（任一非空=挂载拒绝）；规则名与拟稿编号见文件头注。
 */
export function multifileRules(
  files: Record<string, string>,
  org: OrgConfig,
  orgDoc: ReturnType<typeof parseDocument>,
  orgLc: LineCounter,
): DirectoryIssue[] {
  const issues: DirectoryIssue[] = []
  const personIds = new Set(org.people.map((p) => p.id))
  const stripTrailingSlash = (p: string): string => p.replace(/\/+$/, '')

  // ── 1. departments/**/config.yaml：索引↔文件双检 + 形状 + leader 交叉 ──
  const indexedConfigPaths = new Set<string>()
  org.departments.forEach((d, i) => {
    const expected = `${stripTrailingSlash(d.path)}/config.yaml`
    indexedConfigPaths.add(expected)
    if (files[expected] === undefined) {
      issues.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(orgDoc, orgLc, ['departments', i]),
        rule: 'dept/dangling',
        fix: `departments 索引引用 ${expected}，但目录树中无此文件（悬空索引——04-§二：部门目录须含 config.yaml；补文件或修 path）`,
      })
    }
  })
  for (const cfgPath of Object.keys(files).filter(isDeptConfigFile).sort()) {
    const src = files[cfgPath]
    if (src === undefined) continue // filter 已保证存在；noUncheckedIndexedAccess 防御
    const { doc, lc } = parseYaml(src)
    // 孤儿定位：能解析则取 name 键行，否则第 1 行（形状/语法问题另有伴发 issue）
    const orphanLine = doc.errors.length === 0 && DeptConfigSchema.safeParse(doc.toJS()).success
      ? lineOfPath(doc, lc, ['name'])
      : 1
    if (!indexedConfigPaths.has(cfgPath)) {
      issues.push({
        file: cfgPath,
        line: orphanLine,
        rule: 'dept/orphan',
        fix: `部门配置 ${cfgPath} 存在于目录树，但不在 org-config.yaml departments 索引中（孤儿部门——C2-05 双检：入索引或删目录）`,
      })
    }
    if (doc.errors.length > 0) {
      issues.push(...yamlSyntaxIssues(doc, lc, cfgPath, 'dept-config/yaml-syntax'))
      continue
    }
    const parsed = DeptConfigSchema.safeParse(doc.toJS())
    if (!parsed.success) {
      issues.push(...zodIssuesToDirectoryIssues(doc, lc, parsed.error.issues, cfgPath, 'dept-config/missing-field'))
      continue
    }
    if (!personIds.has(parsed.data.leader)) {
      issues.push({
        file: cfgPath,
        line: lineOfPath(doc, lc, ['leader']),
        rule: 'dept/leader-dangling',
        fix: `leader ${parsed.data.leader} 不在 org-config.yaml people 索引中（部门领导必须指向已登记工号——04-§二）`,
      })
    }
  }

  // ── 2. 人事档案：索引↔档案双检 + front-matter/文件名/六节 ──
  const refPathOf = (p: OrgConfig['people'][number]): string =>
    p.file !== undefined ? p.file : `${stripTrailingSlash(p.dept)}/people/${p.id}.md` // M2.2-② 推导拟稿
  const entryByRefPath = new Map<string, OrgConfig['people'][number]>()
  org.people.forEach((p, i) => {
    const ref = refPathOf(p)
    if (files[ref] === undefined) {
      issues.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(orgDoc, orgLc, ['people', i, 'file']),
        rule: 'people/dangling',
        fix: `people 索引 ${p.id} 引用档案 ${ref}，但目录树中无此文件（悬空索引${p.file === undefined ? '——file 键缺省按 <dept>/people/<工号>.md 推导，M2.2-② 拟稿口径' : ''}）`,
      })
    } else {
      entryByRefPath.set(ref, p)
    }
  })
  for (const personPath of Object.keys(files).filter(isPersonFile).sort()) {
    const src = files[personPath]
    if (src === undefined) continue
    const entry = entryByRefPath.get(personPath)
    const validated = validatePersonFile(personPath, src, issues)
    if (validated === null) continue // front-matter 不完整：id 交叉无从谈起，已有 issue 兜住
    if (entry === undefined) {
      issues.push({
        file: personPath,
        line: validated.idLine,
        rule: 'people/orphan',
        fix: `人事档案 ${personPath} 不被 org-config.yaml people 索引引用（孤儿档案——C2-05 双检：入索引或移出目录）`,
      })
    }
    const fileStem = personPath.split('/').pop()?.replace(/\.md$/, '') ?? ''
    if (fileStem !== validated.fm.id) {
      issues.push({
        file: personPath,
        line: validated.idLine,
        rule: 'people/file-id-mismatch',
        fix: `档案文件名 ${fileStem} ≠ front-matter id ${validated.fm.id}（工号=文件名=永不变主键——01-C2-04；以 front-matter id 为准改文件名）`,
      })
    }
    if (entry !== undefined && entry.id !== validated.fm.id) {
      issues.push({
        file: personPath,
        line: validated.idLine,
        rule: 'people/id-mismatch',
        fix: `people 索引条目 id ${entry.id} ≠ 档案 front-matter id ${validated.fm.id}（索引与档案工号必须一致——工号永不变主键）`,
      })
    }
  }

  // ── 3. charter_ref 存在性 ──
  if (files[org.company.charter_ref] === undefined) {
    issues.push({
      file: ORG_CONFIG_FILE,
      line: lineOfPath(orgDoc, orgLc, ['company', 'charter_ref']),
      rule: 'charter/dangling', // 命名拟稿 M2.2-⑧
      fix: `charter_ref 指向 ${org.company.charter_ref}，但目录树中无此文件（公司章程是目录契约必备件——04-§二）`,
    })
  }

  // ── 4. .studio-next.yaml：必备 + 形状 + schema 同源 ──
  const metaSrc = files[META_FILE]
  if (metaSrc === undefined) {
    issues.push({ file: META_FILE, line: 1, rule: 'meta/missing-file', fix: '公司目录必须含 .studio-next.yaml（挂载元信息——04-§二 目录契约）' })
  } else {
    const { doc, lc } = parseYaml(metaSrc)
    if (doc.errors.length > 0) {
      issues.push(...yamlSyntaxIssues(doc, lc, META_FILE, 'meta/yaml-syntax'))
    } else {
      const parsed = StudioNextMetaSchema.safeParse(doc.toJS())
      if (!parsed.success) {
        issues.push(...zodIssuesToDirectoryIssues(doc, lc, parsed.error.issues, META_FILE, 'meta/missing-field'))
      } else if (parsed.data.schema !== org.schema) {
        issues.push({
          file: META_FILE,
          line: lineOfPath(doc, lc, ['schema']),
          rule: 'meta/schema-mismatch',
          fix: `.studio-next.yaml schema=${parsed.data.schema} 与 org-config.yaml schema=${org.schema} 不一致（两处必须同源——04-§二/§九：schema 版本迁移由 daemon 统一执行）`,
        })
      }
    }
  }

  return issues
}
