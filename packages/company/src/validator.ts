/**
 * 公司目录校验器 v0（docs/04-§二/§九，需求 C1/C2；docs/25-§3.5 端口）
 *
 * 职责：org-config.yaml 结构校验 → MountResult（合法=快照 / 不合法=文件:行+修法）。
 * 零 IO：输入是内存文件映射（真实挂载壳在其上包装），可进契约、可单测（08 纯逻辑纪律）。
 * 行号定位：yaml@2 LineCounter + AST 节点 range（16-§二 选型登记），zod 路径回爬取最近祖先节点行。
 *
 * v0 范围：org-config.yaml 单文件；departments/** 与 people/** 正文文件、.studio-next.yaml
 * 交叉校验、relations 完整规则在 v0.1 后续单补齐（见 TODO）。
 *
 * v0.1-M3 扩键（16-§四 验收口径「init 出模板公司并通过自检」倒逼）：schema 收齐
 * templates/company-2-level/org-config.yaml 的全部已登记段落——jobs（04-§三 D9 定时岗，
 * 装载进 snapshot.jobs 留后续单）、accounts（04-§二 账号映射）、yt（03/N1 平台映射覆盖）、
 * executors（06-§三 executor 偏好）、departments[].relations（C2-02 / docs/25 DeptRelation）、
 * people[] 的 role/reports_to/skills/status/executor/file（01-C2 人事档案索引键）。
 * 纪律：只收「结构形状」，不增内容规则（04-§九.0 结构合法≠内容同款）；必填集与既有
 * 交叉规则零改动，契约 dir 域 3 case 口径不变。
 */
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { CompanySnapshot, DeptNode, DirectoryIssue, MountResult, PersonRef } from '@studio-next/contract'

const ORG_CONFIG_FILE = 'org-config.yaml'

const OrgConfigSchema = z.strictObject({
  schema: z.literal('org-config/v1'),
  company: z.strictObject({
    name: z.string().min(1),
    slug: z.string().min(1),
    mission: z.string().optional(),
    charter_ref: z.string().min(1),
    level: z.number().int().min(2).max(9),
    level_distribution: z.record(z.string(), z.number().int()),
    platform: z.string().optional(),
  }),
  departments: z.array(z.strictObject({
    name: z.string().min(1),
    path: z.string().min(1),
    leader: z.string().min(1),
    level: z.number().int(),
    parent: z.string().nullable(),
    lanes: z.array(z.string()),
    functions: z.array(z.string()),
    // C2-02 / docs/25 DeptRelation：形状先行，引用完整性（to 悬空等）留 relations 完整规则单
    relations: z.array(z.record(z.string(), z.unknown())).optional(),
  })).min(1),
  people: z.array(z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    login: z.string().min(1),
    level: z.number().int(),
    dept: z.string().min(1),
    // 01-C2 人事档案索引键（正文在 people/<工号>.md，此处只收形状不设内容枚举）
    role: z.string().optional(),
    reports_to: z.string().nullable().optional(),
    skills: z.array(z.string()).optional(),
    status: z.string().optional(),
    executor: z.string().optional(),
    file: z.string().optional(),
  })).min(1),
  // 04-§三 D9 定时岗（挂部门节点，装载进 snapshot.jobs 留后续单）；先收形状，不写死岗位类型
  jobs: z.array(z.record(z.string(), z.unknown())).optional(),
  // 04-§二 账号映射（账号=等级锚点，与人档案解耦）
  accounts: z.array(z.record(z.string(), z.unknown())).optional(),
  // 03/N1：YouTrack 项目与字段/状态流映射覆盖（公司可整体替换的默认模板）
  yt: z.record(z.string(), z.unknown()).optional(),
  // 06-§三：executor 偏好覆盖（缺省继承框架级 agent.yaml）
  executors: z.record(z.string(), z.unknown()).optional(),
})

type OrgConfig = z.infer<typeof OrgConfigSchema>

interface YamlNodeLike { range?: readonly number[] | null }

/** zod 路径 → 源行：从完整路径逐级上爬，取第一个有 range 的 AST 节点；兜底第 1 行 */
function lineOfPath(doc: ReturnType<typeof parseDocument>, lc: LineCounter, path: (string | number)[]): number {
  for (let cut = path.length; cut >= 0; cut--) {
    const node = doc.getIn(path.slice(0, cut), true)
    if (node !== null && typeof node === 'object') {
      const range = (node as YamlNodeLike).range
      if (range && range.length > 0 && range[0] !== undefined) {
        const pos = lc.linePos(range[0])
        return pos.line // linePos 返回 1 基行号（实测校准）
      }
    }
  }
  return 1
}

function zodIssuesToDirectoryIssues(doc: ReturnType<typeof parseDocument>, lc: LineCounter, issues: z.ZodIssue[]): DirectoryIssue[] {
  return issues.map((zi) => {
    const path = zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
    return {
      file: ORG_CONFIG_FILE,
      line: lineOfPath(doc, lc, path),
      rule: `org-config/missing-field:${path.join('.') || '(root)'}`,
      fix: zi.message,
    }
  })
}

/** 交叉规则（04-§二：结构合法性——模板默认值不参与校验，不写死） */
function crossRules(doc: ReturnType<typeof parseDocument>, lc: LineCounter, org: OrgConfig): DirectoryIssue[] {
  const out: DirectoryIssue[] = []
  const dist = org.company.level_distribution
  const peopleByLevel = new Map<number, number>()
  for (const p of org.people) peopleByLevel.set(p.level, (peopleByLevel.get(p.level) ?? 0) + 1)

  // 等级分布与 people 实数必须相等（org-config.yaml 模板注释的冻结规则）
  const distEntries = Object.entries(dist)
  const distTotal = distEntries.reduce((s, [, n]) => s + n, 0)
  const declaredLevels = new Set(distEntries.map(([k]) => Number(k)))
  const mismatch =
    distTotal !== org.people.length ||
    distEntries.some(([k, n]) => (peopleByLevel.get(Number(k)) ?? 0) !== n) ||
    [...peopleByLevel.keys()].some((lv) => !declaredLevels.has(lv))
  if (mismatch) {
    out.push({
      file: ORG_CONFIG_FILE,
      line: lineOfPath(doc, lc, ['company', 'level_distribution']),
      rule: 'org-config/level-count-mismatch',
      fix: `level_distribution 声明 ${distTotal} 人（按档 ${JSON.stringify(dist)}），people 实有 ${org.people.length} 人（按档 ${JSON.stringify(Object.fromEntries(peopleByLevel))}）——两口径必须相等`,
    })
  }

  // 悬空引用：部门 leader 必须是已登记工号；人员 dept 必须是已登记部门 path
  const peopleIds = new Set(org.people.map((p) => p.id))
  const deptPaths = new Set(org.departments.map((d) => d.path))
  org.departments.forEach((d, i) => {
    if (!peopleIds.has(d.leader)) {
      out.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(doc, lc, ['departments', i, 'leader']),
        rule: 'org-config/dangling-ref',
        fix: `leader ${d.leader} 不在 people 索引中（悬空引用双检）`,
      })
    }
  })
  org.people.forEach((p, i) => {
    if (!deptPaths.has(p.dept)) {
      out.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(doc, lc, ['people', i, 'dept']),
        rule: 'org-config/dangling-ref',
        fix: `dept ${p.dept} 不在 departments 索引中（悬空引用双检）`,
      })
    }
  })
  return out
}

function toSnapshot(org: OrgConfig): CompanySnapshot {
  const departments: DeptNode[] = org.departments.map((d) => ({
    name: d.name, path: d.path, parent: d.parent, leader: d.leader, level: d.level,
    lanes: d.lanes, functions: d.functions, relations: [],
  }))
  const people: PersonRef[] = org.people.map((p) => ({
    id: p.id, name: p.name, login: p.login, level: p.level, dept: p.dept,
  }))
  return {
    slug: org.company.slug,
    name: org.company.name,
    level: org.company.level,
    charter: org.company.charter_ref,
    platform: { platform: org.company.platform ?? 'youtrack' },
    departments,
    people,
    jobs: [],
  }
}

/** 目录校验入口（契约 dir 域的 subject） */
export function loadCompanyDirectory(files: Record<string, string>): MountResult {
  const src = files[ORG_CONFIG_FILE]
  if (src === undefined) {
    return { ok: false, issues: [{ file: ORG_CONFIG_FILE, line: 1, rule: 'org-config/missing-file', fix: '公司目录必须含 org-config.yaml（04-§二 目录契约）' }] }
  }

  const lc = new LineCounter()
  const doc = parseDocument(src, { lineCounter: lc })

  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((e) => ({
        file: ORG_CONFIG_FILE,
        line: e.pos[0] !== undefined ? lc.linePos(e.pos[0]).line : 1,
        rule: 'org-config/yaml-syntax',
        fix: e.message,
      })),
    }
  }

  const parsed = OrgConfigSchema.safeParse(doc.toJS())
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToDirectoryIssues(doc, lc, parsed.error.issues) }
  }

  const cross = crossRules(doc, lc, parsed.data)
  if (cross.length > 0) return { ok: false, issues: cross }

  return { ok: true, snapshot: toSnapshot(parsed.data) }
}

/** dir 域契约 subject：case 输入形状 {files} → 校验器 API（CASES.md 域约定） */
export function dirSubject(input: unknown): MountResult {
  const files = (input as { files?: Record<string, string> }).files
  if (files === undefined || typeof files !== 'object') {
    return { ok: false, issues: [{ file: '(input)', line: 1, rule: 'contract/bad-input', fix: 'dir 域 case 的 input 必须形如 {files: {路径: 内容}}' }] }
  }
  return loadCompanyDirectory(files)
}
