/**
 * 公司目录校验器 v0（docs/04-§二/§九，需求 C1/C2；docs/25-§3.5 端口）
 *
 * 职责：org-config.yaml 结构校验 → MountResult（合法=快照 / 不合法=文件:行+修法）。
 * 零 IO：输入是内存文件映射（真实挂载壳在其上包装），可进契约、可单测（08 纯逻辑纪律）。
 * 行号定位：yaml@2 LineCounter + AST 节点 range（16-§二 选型登记），zod 路径回爬取最近祖先节点行。
 *
 * v0.1-M2.2 多文件面（清偿 v0 头注挂账）：org-config.yaml 单文件校验全绿后，缺省继续
 * **全目录交叉校验**（multifile.ts：departments/<部门>/config.yaml、人事档案 front-matter、
 * charter_ref、.studio-next.yaml；拟稿清单 M2.2-①..⑧ 见该文件头注）。dir 域契约 subject
 * 以宽容位 strictFiles:false 保持 v0 单文件语义（CASES.md dir 域 v1 语义增补说明，M2.2-⑨
 * 拟稿待批）。relations 完整规则（to 悬空等）仍留后续单。
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
 *
 * v0.1-M5 岗位运作规格首刀（docs/35-§3，制作人 2026-10-19 批复「岗位拓展的很好，没啥问题」）：
 * jobs 条目扩 triggers.cadence（五档位→装载期展开 cron，自定义 cron 保留）/ outputs / sla /
 * escalate 四段——形状闸在本文件，档位/时长解析面与 daemon 读视图在 src/cadence.ts，daemon
 * 侧两新唤起源（cadence 档位展开器 + SLA/升级计时器）消费 payload。oncall/subscribe 值守面
 * 与 notify 发送端下刀（35-§4 矩阵两 ☐ 归后续单）。
 */
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { CompanySnapshot, DeptNode, DirectoryIssue, MountResult, PersonRef, RoleName, ScheduledJob, TicketWorkflows } from '@studio-next/contract'
import { expandCadence, parseJobDuration } from './cadence.ts'
import { ORG_CONFIG_SCHEMA_LITERALS, lineOfPath, multifileRules, zodIssuesToDirectoryIssues } from './multifile.ts'

const ORG_CONFIG_FILE = 'org-config.yaml'

/**
 * slug 语法闸（docs/43-附录A-4 语法域：单一校验平面）：小写字母/数字/连字符，非空、
 * 两端不断字——init 通道自此导入，org-config/import/manifest 各通道共一张表
 * （panel 侧 URL 路由段闸同表收口：external/overview 导入本导出）。
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 产出落点相对路径闸（docs/43-附录A-4 语法域：标识/路径/目标域字段收语法域；spike 验证
 * 记录 docs/44-§二 条款5）：
 *   - 禁绝对路径（POSIX `/` 开头 / Windows 盘符）
 *   - 禁 `..` 段（目录逃逸——docs/42-剧本6 output 自由串的解）
 *   - 分隔符统一 POSIX（禁反斜杠）；内部空段非法（尾段空=目录标记，允许）
 */
export function isSafeRelativeOutputPath(p: string): boolean {
  if (p === '' || p === '.') return false
  if (p.startsWith('/') || p.includes('\\')) return false
  if (/^[A-Za-z]:/.test(p)) return false
  const segments = p.split('/')
  if (segments.slice(0, -1).includes('')) return false
  if (segments.includes('..')) return false
  return true
}

const RELATIVE_OUTPUT_MESSAGE =
  '产出落点须为相对公司目录根的 POSIX 路径（禁绝对路径、禁 .. 逃逸段、禁反斜杠——docs/43-附录A-4 语法域）'

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
 * 04-§三 D9 定时岗条目（v0.1-M4 收紧装载进 snapshot.jobs；v0.1-M5 岗位运作规格首刀扩五段
 * ——docs/35-§3，制作人 2026-10-19 批复；档位/时长解析面在 src/cadence.ts）。
 *
 * 映射表（模板实形 templates/company-2-level/org-config.yaml jobs 段 → contract ScheduledJob，
 * 逐字段冻结；缺省值与形状变换全部【拟稿待批】，编号 M4-①..⑧ + M5-①..⑥）：
 *
 *   模板字段     → ScheduledJob 字段     缺省 / 变换
 *   ─────────────────────────────────────────────────────────────────────────────
 *   id          → job_id                原样（必填非空；跨司唯一性归 store jobs 表主键口径【M4-⑧】）
 *   （无）      → company               = company.slug 本司注入（D9 挂公司目录，快照即本司）
 *   dept        → dept                  原样；缺省=根部门 path（首个 parent:null，兜底 departments[0]）【M4-①】
 *   cron        → cron                  原样；**与 triggers.cadence 恰给其一**【M5-⓪】（自定义 cron 或
 *                                      档位二选一——docs/35-§3「节奏档位枚举……不写死表达式」）
 *   triggers.cadence/at → cron 展开     cron=expandCadence(tier, at)（装载期即展开成真 cron——
 *                                      contract ScheduledJob.cron 必填；缺省时刻表【M5-①】见 cadence.ts）
 *   triggers.*  → payload.cadence_tier/_at  档位原样留观测（daemon cadence 源选岗面）【M5-③】
 *   sla         → payload.sla           {first_ack_ms, resolve_hint_ms}——"15m"/"4h" 形时长解析
 *                                      为 ms【M5-⑤】；执行面=daemon SLA 计时器源（first-ack 产
 *                                      escalate 意图；resolve-hint 本刀只解析）
 *   escalate    → payload.escalate      [{after_ms, unacked}]——升级链档（notify 目标原样串）
 *                                      【M5-⑥】；语义执行（notify 链发送）归 notify 端口后续刀
 *   outputs     → payload.outputs       string[] 产出物清单（报表模板名；模板绑定归报表面后续刀）【M5-④】
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
 *   payload 组装：{type?, output?, cadence_tier?, cadence_at?, outputs?, sla?, escalate?} 只收已
 *   定义键；全缺 → 不设 payload。
 *   role 与 type 至少给其一（下方 refine 挡——不造 'patroller' 类魔法缺省岗名，04-§九.0 不写死）。
 *   strictObject：未知键拒收（与 departments/people 段同纪律——结构收紧即报错定位到行，不静默忽略）。
 */

/** 时长形态闸："15m"/"4h"/"30s"/"2d"（解析归 cadence.ts parseJobDuration，M5-② 语法拟稿） */
const DurationSchema = z.string().min(1).refine((s) => parseJobDuration(s) !== null, {
  message: '时长须形如 30s / 15m / 4h / 2d（正整数+单位，docs/35-§3）',
})

/** triggers 段（docs/35-§3 五入口中本刀落 schema 的 cadence 面；oncall/subscribe 下刀） */
const OrgJobTriggersSchema = z
  .strictObject({
    cadence: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'quarterly']).optional(),
    at: z.string().min(1).optional(),
  })
  .refine((t) => t.cadence !== undefined, {
    message: 'triggers 段至少给 cadence（at 不能单独出现——docs/35-§3）',
  })
  .refine((t) => !(t.cadence !== undefined && t.at !== undefined && !expandCadenceOk(t.cadence, t.at)), {
    message: 'at 须形如 "HH:MM"（hourly 不收 at；d<N> 日锚仅 monthly/quarterly——docs/35-§3）',
  })

/** 档位+at 合法性（展开器零抛版：expandCadence 的规则判定，refine 用） */
function expandCadenceOk(tier: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly', at: string): boolean {
  try {
    expandCadence(tier, at)
    return true
  } catch {
    return false
  }
}

const OrgJobSchema = z
  .strictObject({
    /** → job_id（必填非空，原样） */
    id: z.string().min(1),
    /** → cron（可选；与 triggers.cadence 恰给其一——M5-⓪；形状闸与 store JobRecord 同规则，解析归 daemon croner——M4-③） */
    cron: z.string().min(1).refine(cronShapeOk, { message: 'cron 须为非空串且至多 6 个空白分隔段（段内语法解析归 daemon croner，此处只挡形状）' }).optional(),
    /** → triggers.cadence 档位（可选；档位展开器接管 cron——M5-①/③） */
    triggers: OrgJobTriggersSchema.optional(),
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
    /** → payload.output（可选——M4-④；产出落点，报表按 04-§三约定命名；语法域闸附录A-4） */
    output: z.string().min(1).refine(isSafeRelativeOutputPath, { message: RELATIVE_OUTPUT_MESSAGE }).optional(),
    /** → payload.outputs（可选 string[]——M5-④；产出物清单=报表模板名；语法域闸附录A-4） */
    outputs: z.array(z.string().min(1).refine(isSafeRelativeOutputPath, { message: RELATIVE_OUTPUT_MESSAGE })).optional(),
    /** → payload.sla（可选——M5-⑤；时长形态闸，ms 变换在装载） */
    sla: z
      .strictObject({
        'first-ack': DurationSchema.optional(),
        'resolve-hint': DurationSchema.optional(),
      })
      .refine((s) => s['first-ack'] !== undefined || s['resolve-hint'] !== undefined, {
        message: 'sla 段至少给 first-ack / resolve-hint 其一（docs/35-§3）',
      })
      .optional(),
    /** → payload.escalate（可选——M5-⑥；升级链档，notify 语义执行归 notify 端口后续刀） */
    escalate: z
      .array(z.strictObject({ after: DurationSchema, unacked: z.string().min(1) }))
      .min(1)
      .optional(),
  })
  .refine((j) => j.role !== undefined || j.type !== undefined, {
    message: 'role（岗位）与 type（任务类型）至少给其一——ScheduledJob.role 必填，缺 role 时以 type 兜底（M4-②）',
  })
  .refine((j) => (j.cron !== undefined) !== (j.triggers !== undefined && j.triggers.cadence !== undefined), {
    message: 'cron 与 triggers.cadence 恰给其一（自定义 cron 或节奏档位，不双写不缺省——docs/35-§3 / M5-⓪）',
  })

// ————————————————— workflows 段（DEV-43，docs/51 v1.1 B-1 + W-1..W-9；docs/18-§2.1.1） —————————————————

/** 状态声明：YAML 裸串或对象形 {name, final?}（装载期归一为对象——W-2） */
const WorkflowStateSchema = z.union([
  z.string().min(1),
  z.strictObject({ name: z.string().min(1), final: z.boolean().optional() }),
])

const WorkflowEdgeSchema = z.strictObject({ from: z.string().min(1), to: z.string().min(1) })

const WorkflowAnchorsSchema = z.strictObject({
  inbox: z.string().min(1),
  dispatched: z.string().min(1),
  evidence: z.string().min(1),
  verified: z.string().min(1),
  delivered: z.string().min(1),
  approval: z.string().min(1).optional(),
})

const WorkflowTypeSchema = z.strictObject({
  id: z.string().min(1),
  entity: z.string().min(1).optional(),
  states: z.array(WorkflowStateSchema).min(2),
  edges: z.array(WorkflowEdgeSchema).optional(),
  anchors: WorkflowAnchorsSchema,
})

const WorkflowsSchema = z.strictObject({
  types: z.array(WorkflowTypeSchema).min(1),
})

const OrgConfigSchema = z.strictObject({
  // DEV-32（docs/51-§三 B-1）：canonical=studio-next/org@1；org-config/v1=迁移期兼容
  // （templates/DEV-27 夹具/契约 cases.json 语料仍在用——收口计划见 multifile.ts 头注）
  schema: z.enum(ORG_CONFIG_SCHEMA_LITERALS),
  company: z.strictObject({
    name: z.string().min(1),
    // slug 语法域（docs/43-附录A-4）：与 init 通道同规——单一校验平面（SLUG_RE 单表，
    // init.ts 导入共表）；URL 路由段安全（panel external/overview 同表收口）
    slug: z.string().min(1).refine((s) => SLUG_RE.test(s), {
      message: 'slug 须形如 my-corp（小写字母/数字/连字符，两端不断字——与 init 通道同规，docs/43-附录A-4）',
    }),
    mission: z.string().optional(),
    // DEV-32（docs/51-§三 B-1）：version=semver 三元组；迁移期可缺省（仓内语料未带——
    // 在场不合法由判定器层指认到行，见 repo-validate.ts R5 解释记录）
    version: z.string().optional(),
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
  // DEV-43（docs/51 v1.1 B-1）：单据类型流声明（可选；不声明=现状行为）——
  // 结构形状在本层，内容规则 W-1..W-9 在 workflowRules（逐条指认到行）
  workflows: WorkflowsSchema.optional(),
  // 03/N1：YouTrack 项目与字段/状态流映射覆盖（公司可整体替换的默认模板）
  yt: z.record(z.string(), z.unknown()).optional(),
  // 06-§三：executor 偏好覆盖（缺省继承框架级 agent.yaml）
  executors: z.record(z.string(), z.unknown()).optional(),
})

/** org-config.yaml 解析后的强类型（multifile.ts 交叉规则的输入；type-only 反向引用零运行时环） */
export type OrgConfig = z.infer<typeof OrgConfigSchema>

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
 * jobs 装载（v0.1-M4，04-§三 D9；v0.1-M5 岗位运作规格五段——docs/35-§3）：yaml jobs 段 → ScheduledJob[]。
 * 映射规则逐字段冻结在 OrgJobSchema 头注（拟稿待批 M4-①..⑧ + M5-①..⑥）；company=本司 slug；
 * dept 缺省=根部门（首个 parent:null，兜底 departments[0]——M4-①）。
 */
function toJobs(org: OrgConfig): ScheduledJob[] {
  if (org.jobs === undefined) return []
  const rootDept = org.departments.find((d) => d.parent === null)?.path ?? org.departments[0]?.path ?? ''
  return org.jobs.map((j) => {
    // M5-⓪：cron 与 triggers.cadence 恰给其一（schema refine 保证），断言免检同 M4-② 风格
    const cron = j.cron ?? expandCadence(j.triggers?.cadence as 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly', j.triggers?.at)
    const sla = j.sla
    return {
      job_id: j.id,
      company: org.company.slug,
      dept: j.dept ?? rootDept, // M4-①
      cron,
      // M4-②：schema refine 保证 role/type 至少其一（见 OrgJobSchema），断言免检
      role: (j.role ?? j.type) as RoleName,
      level: j.level ?? org.company.level, // M4-⑤
      model_tier: j.model_tier ?? 'low', // M4-⑥
      ...(j.budget_cap !== undefined ? { budget_cap: { usd: j.budget_cap } } : {}), // M4-⑦
      ...(hasOpsPayload(j, sla)
        ? {
            payload: {
              ...(j.type !== undefined ? { type: j.type } : {}), // M4-④
              ...(j.output !== undefined ? { output: j.output } : {}), // M4-④
              ...(j.triggers?.cadence !== undefined ? { cadence_tier: j.triggers.cadence } : {}), // M5-③
              ...(j.triggers?.at !== undefined ? { cadence_at: j.triggers.at } : {}), // M5-③
              ...(j.outputs !== undefined ? { outputs: j.outputs } : {}), // M5-④
              ...(sla !== undefined
                ? {
                    sla: {
                      ...(sla['first-ack'] !== undefined ? { first_ack_ms: parseJobDuration(sla['first-ack']) as number } : {}), // M5-⑤
                      ...(sla['resolve-hint'] !== undefined ? { resolve_hint_ms: parseJobDuration(sla['resolve-hint']) as number } : {}), // M5-⑤
                    },
                  }
                : {}),
              ...(j.escalate !== undefined
                ? { escalate: j.escalate.map((e) => ({ after_ms: parseJobDuration(e.after) as number, unacked: e.unacked })) } // M5-⑥
                : {}),
            },
          }
        : {}),
    }
  })
}

/** ops 段存在性（payload 组装前置：type/output 既有 + cadence/outputs/sla/escalate 新段——全缺则不设 payload） */
function hasOpsPayload(
  j: {
    type?: string | undefined
    output?: string | undefined
    outputs?: string[] | undefined
    triggers?: { cadence?: string | undefined; at?: string | undefined } | undefined
    escalate?: Array<{ after: string; unacked: string }> | undefined
  },
  sla?: { 'first-ack'?: string | undefined; 'resolve-hint'?: string | undefined } | undefined,
): boolean {
  return (
    j.type !== undefined ||
    j.output !== undefined ||
    j.outputs !== undefined ||
    j.triggers?.cadence !== undefined ||
    sla !== undefined ||
    j.escalate !== undefined
  )
}

/** workflows 段装载态（states 已归一为对象形） */
interface WorkflowTypeLoaded {
  id: string
  entity?: string | undefined
  states: Array<{ name: string; final?: boolean | undefined }>
  edges?: Array<{ from: string; to: string }> | undefined
  anchors: {
    inbox: string; dispatched: string; evidence: string; verified: string; delivered: string
    approval?: string | undefined
  }
}

/** 裸串状态归一为对象形（装载期，W-2：final 缺省 false） */
function normalizeWorkflowStates(
  states: Array<string | { name: string; final?: boolean | undefined }>,
): WorkflowTypeLoaded['states'] {
  return states.map((s) => (typeof s === 'string' ? { name: s } : { name: s.name, ...(s.final === true ? { final: true } : {}) }))
}

/**
 * 主干直接后继 fwd(s)（DEV-43 W-8 用）：序表相邻且左态非终态；线性序至多一个。
 * 与 core/flows.ts forwardStates 同语义重演（company 包不依赖 core——包边界，两处
 * 测试锁定同构；core 侧消费 finalStates，本侧消费声明 final 标记）。
 */
function mainlineFwd(t: WorkflowTypeLoaded): (s: string) => string | undefined {
  const names = t.states.map((s) => s.name)
  const finals = new Set(t.states.filter((s) => s.final === true).map((s) => s.name))
  return (s: string): string | undefined => {
    const i = names.indexOf(s)
    if (i < 0 || i >= names.length - 1) return undefined
    if (finals.has(names[i] as string)) return undefined // 左态终态：截断（W-5 推导语义）
    return names[i + 1]
  }
}

/**
 * workflows 内容规则 W-1..W-9（DEV-43，docs/51 v1.1 B-1；逐条指认到文件:行）。
 * 结构形状（states ≥2、五锚必填、edge 键形状）已由 zod 层拦下——本层管内容：
 * 唯一性/成员关系/锚点链/保留词。
 */
function workflowRules(doc: ReturnType<typeof parseDocument>, lc: LineCounter, org: OrgConfig): DirectoryIssue[] {
  if (org.workflows === undefined) return []
  const out: DirectoryIssue[] = []
  const push = (i: number, path: (string | number)[], rule: string, fix: string): void => {
    out.push({ file: ORG_CONFIG_FILE, line: lineOfPath(doc, lc, ['workflows', 'types', i, ...path]), rule: `org-config/${rule}`, fix })
  }
  const seenIds = new Set<string>()
  org.workflows.types.forEach((raw, i) => {
    const t: WorkflowTypeLoaded = { ...raw, states: normalizeWorkflowStates(raw.states) }
    const names = t.states.map((s) => s.name)
    const namesSet = new Set(names)
    const finals = new Set(t.states.filter((s) => s.final === true).map((s) => s.name))

    // W-1 + W-9：id 语法/唯一/保留词表
    if (!SLUG_RE.test(t.id) || t.id.includes(':')) {
      push(i, ['id'], 'workflow-bad-type-id', `类型 id=${t.id} 须为 slug 段语法且禁冒号（FlowTable 键形 T:<type> 的命名空间隔离——docs/51 W-1）`)
    } else if (t.id === 'bug' || t.id === 'task') {
      push(i, ['id'], 'workflow-reserved-type-id', `类型 id=${t.id} 是系统保留词（bug=断路器自动开单·不定级待人定级后派；task=定时岗单物化 type——docs/51 W-9）。声明同 id 会劫持引擎写死行为；制作人可用别名 id（如 defect/缺陷）+ entity 映射满足同语义`)
    } else if (seenIds.has(t.id)) {
      push(i, ['id'], 'workflow-dup-type-id', `类型 id=${t.id} 重复（全司唯一——docs/51 W-1）`)
    }
    seenIds.add(t.id)

    // W-2：状态名类内唯一（非空与 ≥2 已由 schema 拦）
    const seenNames = new Set<string>()
    names.forEach((n, j) => {
      if (seenNames.has(n)) push(i, ['states', j], 'workflow-dup-state', `状态名 ${n} 类内重复（docs/51 W-2）`)
      seenNames.add(n)
    })

    // W-3：五锚∈状态名；inbox=首态；approval∈状态名
    const anchorEntries: Array<[keyof WorkflowTypeLoaded['anchors'], string]> = [
      ['inbox', t.anchors.inbox],
      ['dispatched', t.anchors.dispatched],
      ['evidence', t.anchors.evidence],
      ['verified', t.anchors.verified],
      ['delivered', t.anchors.delivered],
    ]
    for (const [key, value] of anchorEntries) {
      if (!namesSet.has(value)) {
        push(i, ['anchors', key], 'workflow-anchor-not-in-states', `anchors.${String(key)}=${value} 不在 states 声明集 [${names.join(',')}] 内（docs/51 W-3）`)
      }
    }
    if (names[0] !== undefined && t.anchors.inbox !== names[0]) {
      push(i, ['anchors', 'inbox'], 'workflow-inbox-not-first', `anchors.inbox=${t.anchors.inbox} 必须=states 首态 ${names[0]}（docs/51 W-3）`)
    }
    if (t.anchors.approval !== undefined && !namesSet.has(t.anchors.approval)) {
      push(i, ['anchors', 'approval'], 'workflow-anchor-not-in-states', `anchors.approval=${t.anchors.approval} 不在 states 声明集 [${names.join(',')}] 内（docs/51 W-3）`)
    }

    // W-4：delivered 落终态
    if (namesSet.has(t.anchors.delivered) && !finals.has(t.anchors.delivered)) {
      push(i, ['anchors', 'delivered'], 'workflow-delivered-not-final', `anchors.delivered=${t.anchors.delivered} 必须落在 final: true 状态（终态语义锚定——docs/51 W-4）`)
    }

    // W-6：edges 两端∈状态名；(from,to) 不重复
    const seenPairs = new Set<string>()
    t.edges?.forEach((e, j) => {
      if (!namesSet.has(e.from) || !namesSet.has(e.to)) {
        push(i, ['edges', j], 'workflow-edge-not-in-states', `edges[${j}] ${e.from}→${e.to} 两端须各自∈状态名 [${names.join(',')}]（docs/51 W-6）`)
      }
      const pair = `${e.from}\u0000${e.to}`
      if (seenPairs.has(pair)) {
        push(i, ['edges', j], 'workflow-dup-edge', `edges 重复边 ${e.from}→${e.to}（docs/51 W-6）`)
      }
      seenPairs.add(pair)
    })

    // W-7：entity slug 段语法（值域闸在平台侧 provision——判定器平台中立）
    if (t.entity !== undefined && !SLUG_RE.test(t.entity)) {
      push(i, ['entity'], 'workflow-bad-entity', `entity=${t.entity} 须为 slug 段语法（值域 userstory|issue|task 的枚举闸在平台侧 provision——docs/51 W-7）`)
    }

    // W-8：五锚主干相邻链（approval 只许插 inbox 后/verified 后两槽）
    const fwd = mainlineFwd(t)
    const a = t.anchors
    const slot1ok = fwd(a.inbox) === a.dispatched || (fwd(a.inbox) === a.approval && a.approval !== undefined && fwd(a.approval) === a.dispatched)
    const slot2ok = fwd(a.dispatched) === a.evidence
    const slot3ok = fwd(a.evidence) === a.verified
    const slot4ok = fwd(a.verified) === a.delivered || (fwd(a.verified) === a.approval && a.approval !== undefined && fwd(a.approval) === a.delivered)
    if (!slot1ok) {
      push(i, ['anchors'], 'workflow-anchor-chain', `锚点链断裂：inbox(${a.inbox}) 的主干直接后继须=dispatched(${a.dispatched})（或先=approval 再→dispatched——approval 只许插 inbox 后/verified 后两槽）。当前后继=${String(fwd(a.inbox)) ?? '（无/被终态截断）'}（docs/51 W-8；decide 5c 派发依赖此边）`)
    }
    if (!slot2ok) {
      push(i, ['anchors'], 'workflow-anchor-chain', `锚点链断裂：dispatched(${a.dispatched}) 的主干直接后继须=evidence(${a.evidence})。当前后继=${String(fwd(a.dispatched)) ?? '（无/被终态截断）'}（docs/51 W-8）`)
    }
    if (!slot3ok) {
      push(i, ['anchors'], 'workflow-anchor-chain', `锚点链断裂：evidence(${a.evidence}) 的主干直接后继须=verified(${a.verified})。当前后继=${String(fwd(a.evidence)) ?? '（无/被终态截断）'}（docs/51 W-8）`)
    }
    if (!slot4ok) {
      push(i, ['anchors'], 'workflow-anchor-chain', `锚点链断裂：verified(${a.verified}) 的主干直接后继须=delivered(${a.delivered})（或先=approval 再→delivered）。当前后继=${String(fwd(a.verified)) ?? '（无/被终态截断）'}（docs/51 W-8；decide 5f/5b 合并依赖此边——断裂则 delivered 结构性不可达）`)
    }
  })
  return out
}

/** workflows 装载（→ contract TicketWorkflows；states 归一为对象形进快照） */
function toWorkflows(org: OrgConfig): TicketWorkflows | undefined {
  if (org.workflows === undefined) return undefined
  return {
    types: org.workflows.types.map((t) => ({
      id: t.id,
      ...(t.entity !== undefined ? { entity: t.entity } : {}),
      states: normalizeWorkflowStates(t.states).map((s) => ({ name: s.name, ...(s.final === true ? { final: true } : {}) })),
      ...(t.edges !== undefined ? { edges: t.edges } : {}),
      anchors: {
        inbox: t.anchors.inbox,
        dispatched: t.anchors.dispatched,
        evidence: t.anchors.evidence,
        verified: t.anchors.verified,
        delivered: t.anchors.delivered,
        ...(t.anchors.approval !== undefined ? { approval: t.anchors.approval } : {}),
      },
    })),
  }
}

function toSnapshot(org: OrgConfig): CompanySnapshot {  const departments: DeptNode[] = org.departments.map((d) => ({
    name: d.name, path: d.path, parent: d.parent, leader: d.leader, level: d.level,
    lanes: d.lanes, functions: d.functions, relations: [],
  }))
  const people: PersonRef[] = org.people.map((p) => ({ // status/role 可选携带（DEV-48，docs/52-§5.1）：缺省键不落显式 undefined
    id: p.id, name: p.name, login: p.login, level: p.level, dept: p.dept, ...(p.status !== undefined ? { status: p.status } : {}), ...(p.role !== undefined ? { role: p.role } : {}),
  }))
  const snap: CompanySnapshot = {
    slug: org.company.slug,
    name: org.company.name,
    level: org.company.level,
    charter: org.company.charter_ref,
    platform: { platform: org.company.platform ?? 'youtrack' },
    departments,
    people,
    jobs: toJobs(org),
  }
  const wf = toWorkflows(org)
  if (wf !== undefined) snap.workflows = wf
  return snap
}

/**
 * 目录挂载入参（M2.2 新增宽容位）。
 *
 * strictFiles 方案【M2.2-⑨ 拟稿待批】：M2.2 起 loadCompanyDirectory 缺省做**全目录校验**
 * （04-§二 契约全貌——multifile.ts）；但 dir 域契约 3 case 的 input 只有 org-config.yaml
 * 单文件（v0 语料），按全检语义 C-dir-001 将因部门/档案/元信息文件缺失翻红——契约语料
 * 单写者纪律（不为本单改 cases.json），故：
 *   - strictFiles=true（缺省）：全目录校验（init 自检 / validate / serve 挂载走此面）
 *   - strictFiles=false：只校验 org-config.yaml 单文件（v0 语义；dir 域契约 subject
 *     dirSubject 固定传此值——CASES.md「dir 域 v1 语义增补说明」）
 * 多文件面的契约化留给后续 dir2 域批次（开批时落 case，本方案头注即增补说明本体）。
 */
export interface MountOptions {
  /** 缺省 true=全目录校验；false=只校验 org-config.yaml（v0 单文件语义） */
  strictFiles?: boolean
}

/** 目录校验入口（org-config 单文件面 + 缺省全目录面；契约 dir 域的 subject 经 dirSubject 包装） */
export function loadCompanyDirectory(files: Record<string, string>, opts?: MountOptions): MountResult {
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
    return { ok: false, issues: zodIssuesToDirectoryIssues(doc, lc, parsed.error.issues, ORG_CONFIG_FILE, 'org-config/missing-field') }
  }

  const issues = [
    ...crossRules(doc, lc, parsed.data),
    ...workflowRules(doc, lc, parsed.data),
    ...(opts?.strictFiles === false ? [] : multifileRules(files, parsed.data, doc, lc)),
  ]
  if (issues.length > 0) return { ok: false, issues }

  return { ok: true, snapshot: toSnapshot(parsed.data) }
}

/** dir 域契约 subject：case 输入形状 {files} → 校验器 API（CASES.md 域约定）。
 *  strictFiles:false 固定传参——dir 域 v1 语义冻结为 org-config 单文件校验（M2.2-⑨ 拟稿，
 *  CASES.md「dir 域 v1 语义增补说明」）；多文件面归后续 dir2 契约批次。 */
export function dirSubject(input: unknown): MountResult {
  const files = (input as { files?: Record<string, string> }).files
  if (files === undefined || typeof files !== 'object') {
    return { ok: false, issues: [{ file: '(input)', line: 1, rule: 'contract/bad-input', fix: 'dir 域 case 的 input 必须形如 {files: {路径: 内容}}' }] }
  }
  return loadCompanyDirectory(files, { strictFiles: false })
}
