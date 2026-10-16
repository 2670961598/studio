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
 * templates/company-2-level/org-config.yaml 的全部已登记段落——jobs（04-§三 D9 定时岗）、
 * accounts（04-§二 账号映射）、yt（03/N1 平台映射覆盖）、executors（06-§三 executor 偏好）、
 * departments[].relations（C2-02 / docs/25 DeptRelation）、people[] 的
 * role/reports_to/skills/status/executor/file（01-C2 人事档案索引键）。
 * 纪律：只收「结构形状」，不增内容规则（04-§九.0 结构合法≠内容同款）；必填集与既有
 * 交叉规则零改动，契约 dir 域 3 case 口径不变。
 *
 * v0.1-M4 jobs 装载（04-§三 D9；18-§三「定时岗全部来自公司目录配置」的 company 侧落点）：
 * jobs 段从 record(unknown) 收为结构化（OrgJobSchema），映射装载进 snapshot.jobs
 * （contract ScheduledJob，docs/25-§3.5）——daemon 侧 seedJobs 消费快照即可播种 jobs 表。
 * 模板字段 → ScheduledJob 字段的映射规则逐字段冻结在 OrgJobSchema 头注（缺省值与形状
 * 变换全部【拟稿待批】，编号 M4-①..⑧，制作人批示后固化）。
 */
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { CompanySnapshot, DeptNode, DirectoryIssue, MountResult, PersonRef, RoleName, ScheduledJob } from '@studio-next/contract'

const ORG_CONFIG_FILE = 'org-config.yaml'

/**
 * cron 形状闸：非空且 trim 后至多 6 个空白分隔段（5 段标准 cron / croner 6 段含秒变体）。
 * 与 store JobRecord.cronShapeOk（packages/store/src/records.ts）同规则——段内语法解析
 * 归 daemon 侧 croner，此处与 store 同为形状挡板【M4-③ 拟稿待批：两处同规实现，
 * 收口（company 依赖 contract 不依赖 store，暂按零新依赖各自实现）归后续单】。
 */
function cronShapeOk(expr: string): boolean {
  const trimmed = expr.trim()
  return trimmed !== '' && trimmed.split(/\s+/).length <= 6
}

/**
 * 04-§三 D9 定时岗条目（v0.1-M4 收紧：原 z.record(z.string(), z.unknown()) 只收形状不装载，
 * 见 git 历史；本单起装载进 snapshot.jobs）。
 *
 * 映射表（模板实形 templates/company-2-level/org-config.yaml jobs 段 → contract ScheduledJob，
 * 逐字段冻结；缺省值与形状变换全部【拟稿待批】，编号 M4-①..⑧）：
 *
 *   模板字段     → ScheduledJob 字段     缺省 / 变换
 *   ─────────────────────────────────────────────────────────────────────────────
 *   id          → job_id                原样（必填非空；跨司唯一性归 store jobs 表主键口径【M4-⑧】）
 *   （无）      → company               = company.slug 本司注入（D9 挂公司目录，快照即本司）
 *   dept        → dept                  原样；缺省=根部门 path（首个 parent:null，兜底 departments[0]）【M4-①】
 *   cron        → cron                  原样（必填；形状闸 cronShapeOk ≤6 空白段，与 store 同规则【M4-③】）
 *   role        → role                  原样（RoleName 开放串，不设枚举）；缺省=type（岗位缺省随任务类型兜底）【M4-②】
 *   type        → payload.type          任务类型不进顶层，随 payload 透传（与 daemon demo 岗
 *                                      payload={type,…} 同形；report|audit|…自由扩展不写死）【M4-④】
 *   output      → payload.output        产出落点随 payload 透传（报表命名约定见 04-§三）【M4-④】
 *   level       → level                 缺省=company.level（岗未标级即随公司级）【M4-⑤】；界 1-9 同
 *                                      store JobRecord 与 04-§四 agent 等级
 *   model_tier  → model_tier            冻结枚举 'high'|'mid'|'low'（contract ModelTier['tier']）；
 *                                      缺省='low'（定时岗缺省低档省成本）【M4-⑥】
 *   budget_cap  → budget_cap={usd:n}    yaml 裸数（USD/次）→ Money 形状变换【M4-⑦】；缺省=不设帽
 *
 *   payload 组装：{type?, output?} 只收已定义键；type 与 output 皆缺 → 不设 payload。
 *   role 与 type 至少给其一（下方 refine 挡——不造 'patroller' 类魔法缺省岗名，04-§九.0 不写死）。
 *   strictObject：未知键拒收（与 departments/people 段同纪律——结构收紧即报错定位到行，不静默忽略）。
 */
const OrgJobSchema = z.strictObject({
  /** → job_id（必填非空，原样） */
  id: z.string().min(1),
  /** → cron（必填；形状闸与 store JobRecord 同规则，解析归 daemon croner——M4-③） */
  cron: z.string().min(1).refine(cronShapeOk, { message: 'cron 须为非空串且至多 6 个空白分隔段（段内语法解析归 daemon croner，此处只挡形状）' }),
  /** → dept（可选；缺省=根部门 path——M4-①） */
  dept: z.string().min(1).optional(),
  /** → role（可选；缺省以 type 兜底——M4-②；RoleName 开放串不设枚举） */
  role: z.string().min(1).optional(),
  /** → payload.type（可选——M4-④；任务类型自由扩展不写死） */
  type: z.string().min(1).optional(),
  /** → level（可选；缺省=company.level——M4-⑤；界 1-9 同 store JobRecord / 04-§四） */
  level: z.number().int().min(1).max(9).optional(),
  /** → model_tier（可选；缺省='low'——M4-⑥；冻结枚举同 contract ModelTier['tier']） */
  model_tier: z.enum(['high', 'mid', 'low']).optional(),
  /** → budget_cap={usd:n}（可选裸数 USD/次——M4-⑦；缺省=不设帽） */
  budget_cap: z.number().min(0).optional(),
  /** → payload.output（可选——M4-④；产出落点，报表按 04-§三约定命名） */
  output: z.string().min(1).optional(),
}).refine((j) => j.role !== undefined || j.type !== undefined, {
  message: 'role（岗位）与 type（任务类型）至少给其一——ScheduledJob.role 必填，缺 role 时以 type 兜底（M4-②）',
})

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
  // 04-§三 D9 定时岗（v0.1-M4：结构收紧并装载进 snapshot.jobs——条目 schema 与映射表见 OrgJobSchema 头注）
  jobs: z.array(OrgJobSchema).optional(),
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

/**
 * jobs 装载（v0.1-M4，04-§三 D9）：yaml jobs 段 → ScheduledJob[]。
 * 映射规则逐字段冻结在 OrgJobSchema 头注（拟稿待批 M4-①..⑧）；company=本司 slug；
 * dept 缺省=根部门（首个 parent:null，兜底 departments[0]——M4-①）。
 */
function toJobs(org: OrgConfig): ScheduledJob[] {
  if (org.jobs === undefined) return []
  const rootDept = org.departments.find((d) => d.parent === null)?.path ?? org.departments[0]?.path ?? ''
  return org.jobs.map((j) => ({
    job_id: j.id,
    company: org.company.slug,
    dept: j.dept ?? rootDept, // M4-①
    cron: j.cron,
    // M4-②：schema refine 保证 role/type 至少其一（见 OrgJobSchema），断言免检
    role: (j.role ?? j.type) as RoleName,
    level: j.level ?? org.company.level, // M4-⑤
    model_tier: j.model_tier ?? 'low', // M4-⑥
    ...(j.budget_cap !== undefined ? { budget_cap: { usd: j.budget_cap } } : {}), // M4-⑦
    ...(j.type !== undefined || j.output !== undefined
      ? { payload: { ...(j.type !== undefined ? { type: j.type } : {}), ...(j.output !== undefined ? { output: j.output } : {}) } } // M4-④
      : {}),
  }))
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
    jobs: toJobs(org),
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
