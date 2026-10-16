/**
 * read-tiers —— 单据读面三档视图（docs/17-§7 末行「读面分级：Full/Focused/Blind
 * （验证岗 Blind，防生成者上下文污染）」的 daemon 侧机制化）
 *
 * 三档语义拟稿（冻结候选——文档只有一句，全表在此与汇报承载，批示后升 docs）：
 *   | 档      | 读面                                                        | 谁用   |
 *   |---------|-------------------------------------------------------------|--------|
 *   | Full    | 全量：标题+状态+关键字段+正文+评论全量（旧→新原序）          | 生成岗 |
 *   | Focused | 标题+状态+关键字段+评论摘要（全评论→最后 N 条+总计数）       | 协作岗 |
 *   | Blind   | 标题+冻结验收命令+产出物路径清单；正文与评论一概不可见       | 验证岗 |
 *
 *   Blind 的机制立意：verify 的是**证据**不是**叙事**——生成者的正文/评论是自述叙事，
 *   读进验证岗上下文即污染（「他说做完了」≠「验收命令绿了」）；故 Blind 档在视图结构上
 *   剥离正文与评论（对象上不存在这两个键——结构保证，不是调用方约定）。
 *
 * 与写闸（gated-platform.ts）的结构区别（头注裁决理由）：
 *   - 写闸是**运行期闸**：把 FlowPlatform 包成代理，每次写先 gateWrite（fail-closed，
 *     被拒不触底层平台）——写是危险面，须逐调用拦截。
 *   - 读面分级是**装配期选择**：createView 只在 dispatch 装配时按岗选档构造一份视图
 *     （decorator，非 wrapper）——**不包 platform、不拦截 daemon 自身读**。理由：
 *     daemon 主循环自身需要全量读面（采集相位 issues.list 全量对账、state-diff 决策、
 *     收割相位 issues.get——拦了就破七相位）；污染防线的位置是「派给 worker 的上下文
 *     装了什么」（装配入参），不是「谁能读平台」。worker 侧运行期读走 studio-tools
 *     网关白名单（24-§二）——两道防线各管各的面，互不越位。
 *
 * 落点分工（与 worker-key.ts 同款裁决）：
 *   - 任务书（brief.md，per-attempt 操作面）追加「单据读面」节（renderReadViewSection）
 *     ——AGENTS.md 是六层组装产物，追加破层定界纯净度，不走；
 *   - Blind 档边界声明+产出物路径**另入 AGENTS.md L4 scope**（持久通道抗 auto-compact：
 *     任务书可能被压缩，防污染边界必须长存——接线见 prompt-assembly.ts）。
 *
 * 【拟升 contract】ReadTier / TicketReadView / TicketKeyFields / CommentDigest——
 *   v0 放 daemon 包内定义（contract 未冻结读面分级协议），prompt L4 消费面稳定后
 *   升包走进化管线（F3-01）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - 【role→tier 映射】main_worker=Full、verifier=Blind、summarizer/precheck=Focused、
 *     未登记角色=Focused（保守档：宁可少看叙事，不多看）。EngineConfig.readTierByRole
 *     按键覆盖（公司可改档）。
 *   - 【角色解析】v0 单据与人事档案均无 role 元数据（PersonRef 无 role 面、IssueRecord
 *     无 role 字段）——拟稿：assignee 为**非工号串**（不命中 people 索引）即视为角色名
 *     （岗单据形态：物化时 assignee=job.role，engine.ts 既定口径）；assignee 为工号或
 *     缺省 → main_worker（直派人无角色面，默认生成岗）。真角色面（人档 role 字段/单据
 *     role 字段）落地后此处切换。
 *   - 【Focused 窗口】评论摘要窗口缺省 5（trim.ts keepRecentN=3 同型拟稿，未做数据
 *     试算）；CreateViewOptions.focusedWindow 可调。
 *   - 【Blind 产出物路径清单】v0=本工位证据面（workspace/REPORT.md/summary.json——收割
 *     四要件「REPORT 落盘」的约定落点，gate.ts 同表）；「验证对象工位」（经 links 关联
 *     的生成者工位）归真单刀——v0 无单据↔工位关联面，不伪造。
 *   - 【叙事消毒】单据正文/评论是平台侧人写+agent 写内容，v0 原样入任务书读面节；
 *     是否按 C2-10 untrusted 通道消毒（sanitizeUntrusted）待批示——文档只对「网页可
 *     编辑内容」强制，平台单据叙事未明说。
 *
 * 纯函数纪律：createView 不改入参、不缓存、不写盘（platform 读幂等，同输入恒同输出）；
 * 渲染/映射函数零 IO 零时间内取。
 */
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import type { Comment, FlowPlatform, PersonId, PersonRef, RoleName, TicketId } from '@studio-next/contract'
import { REPORT_FILENAME, SUMMARY_FILENAME } from './gate.ts'

// ————————————————————————— 档位 —————————————————————————

/** 读面三档（17-§7：Full/Focused/Blind） */
export type ReadTier = 'full' | 'focused' | 'blind'

/** 档位清单（机器可读；三档穷尽由测试断言） */
export const READ_TIERS: readonly ReadTier[] = ['full', 'focused', 'blind']

/** Focused 评论摘要窗口：最后 N 条（拟稿缺省 5，见头注） */
export const DEFAULT_FOCUSED_COMMENT_WINDOW = 5

// ————————————————————————— 视图结构（【拟升 contract】） —————————————————————————

/** 关键字段投影（Full/Focused 带；Blind 不带——最小面） */
export interface TicketKeyFields {
  type?: string
  dept?: string
  level?: number
  lane?: string
  assignee?: PersonId
  parent?: TicketId
  updated: string
}

/** 评论摘要（Focused：全评论 → 最后 N 条 + 总计数，防上下文膨胀） */
export interface CommentDigest {
  /** 评论总数（窗口外的以计数呈现） */
  total: number
  /** 最后 N 条（旧→新平台原序） */
  window: readonly Comment[]
}

/** 单据读面视图（createView 产物；供 prompt L4 消费——v0 结构，拟升 contract） */
export interface TicketReadView {
  tier: ReadTier
  issue: TicketId
  title: string
  state: string
  /** 关键字段（full/focused；blind 结构性无此键） */
  fields?: TicketKeyFields
  /** 正文（仅 full，原样全量；focused/blind 结构性无此键） */
  description?: string
  /** 评论全量（仅 full，旧→新原序） */
  comments?: readonly Comment[]
  /** 评论摘要（仅 focused） */
  commentDigest?: CommentDigest
  /** 冻结验收命令（仅 blind，一命令一行；与 L4 acceptance 同源） */
  acceptance?: readonly string[]
  /** 产出物路径清单（仅 blind——验收所须最小面） */
  artifacts?: readonly string[]
}

/** Blind 补齐面（非平台数据：冻结验收命令 + 产出物路径——装配侧注入） */
export interface BlindFace {
  acceptance: readonly string[]
  artifacts: readonly string[]
}

/** createView 选项 */
export interface CreateViewOptions {
  /** Focused 评论摘要窗口（缺省 DEFAULT_FOCUSED_COMMENT_WINDOW） */
  focusedWindow?: number
  /** Blind 补齐面（tier='blind' 时必填且验收命令非空——fail-closed，无验收不派工） */
  blind?: BlindFace
}

// ————————————————————————— role → tier（拟稿映射表） —————————————————————————

/** 缺省映射（拟稿可配：EngineConfig.readTierByRole 按键覆盖） */
export const DEFAULT_ROLE_READ_TIERS: Readonly<Record<string, ReadTier>> = {
  main_worker: 'full',
  verifier: 'blind',
  summarizer: 'focused',
  precheck: 'focused',
}

/** 未登记角色的落档（拟稿：保守档——协作侧宁可少看叙事不多看） */
export const UNMAPPED_ROLE_READ_TIER: ReadTier = 'focused'

/** role→tier 解析（覆盖表按键胜出：有效表 = {...缺省表, ...覆盖表}；查无=保守档） */
export function resolveReadTier(role: RoleName, overrides?: Readonly<Record<string, ReadTier>>): ReadTier {
  const map: Readonly<Record<string, ReadTier | undefined>> =
    overrides === undefined ? DEFAULT_ROLE_READ_TIERS : { ...DEFAULT_ROLE_READ_TIERS, ...overrides }
  return map[role] ?? UNMAPPED_ROLE_READ_TIER
}

/**
 * 派发上下文的角色解析（拟稿，见头注）：assignee 为非工号串=角色名（岗单据形态，
 * 物化时 assignee=job.role）；assignee 为工号（命中 people 索引）或缺省=main_worker
 * （直派人无角色元数据，默认生成岗）。
 */
export function roleOfAssignee(assignee: PersonId | undefined, people: readonly PersonRef[]): RoleName {
  if (assignee !== undefined && assignee !== '' && !people.some((p) => p.id === assignee)) {
    return assignee
  }
  return 'main_worker'
}

// ————————————————————————— 视图构造（纯装饰层） —————————————————————————

/** IssueRecord → 关键字段投影（undefined 键结构性省略） */
function keyFieldsOf(rec: {
  type?: string
  dept?: string
  level?: number
  lane?: string
  assignee?: PersonId
  parent?: TicketId
  updated: string
}): TicketKeyFields {
  return {
    ...(rec.type !== undefined ? { type: rec.type } : {}),
    ...(rec.dept !== undefined ? { dept: rec.dept } : {}),
    ...(rec.level !== undefined ? { level: rec.level } : {}),
    ...(rec.lane !== undefined ? { lane: rec.lane } : {}),
    ...(rec.assignee !== undefined ? { assignee: rec.assignee } : {}),
    ...(rec.parent !== undefined ? { parent: rec.parent } : {}),
    updated: rec.updated,
  }
}

/**
 * createView —— 按档构造单据读面视图（17-§7 读面分级的机制落点；纯装饰层：
 * **不包 platform、不拦截 daemon 自身读**——分级是装配期选择非运行期闸，见头注）。
 *
 *   full：    issues.get + comments.list → 字段+正文+评论全量
 *   focused： issues.get + comments.list → 字段+摘要（窗口外只留计数）
 *   blind：   **只** issues.get → 标题/状态 + opts.blind 补齐面；description/comments
 *             在视图对象上**结构性不存在**（防生成者上下文污染是结构保证不是约定）
 *
 * blind 档缺 opts.blind 或验收命令为空 → CONFIG_INVALID fail-closed（纪律 3：无验收
 * 不派工——标题+验收命令+产出物路径是 Blind 的完整最小面，缺一不可）。
 */
export async function createView(
  platform: FlowPlatform,
  tier: ReadTier,
  issueId: TicketId,
  opts?: CreateViewOptions,
): Promise<TicketReadView> {
  const rec = await platform.issues.get(issueId)

  if (tier === 'blind') {
    if (opts?.blind === undefined || opts.blind.acceptance.length === 0) {
      configInvalid(
        'read-tiers/blind-acceptance',
        'Blind 档必须带非空冻结验收命令（标题+验收命令+产出物路径=最小面；无验收不派工——纪律 3）',
      )
    }
    const blind = opts.blind
    return {
      tier,
      issue: rec.id,
      title: rec.title,
      state: rec.state,
      acceptance: [...blind.acceptance],
      artifacts: [...blind.artifacts],
    }
  }

  if (tier === 'focused') {
    const comments = await platform.comments.list(issueId)
    const window = Math.max(0, opts?.focusedWindow ?? DEFAULT_FOCUSED_COMMENT_WINDOW)
    return {
      tier,
      issue: rec.id,
      title: rec.title,
      state: rec.state,
      fields: keyFieldsOf(rec),
      commentDigest: { total: comments.length, window: window === 0 ? [] : comments.slice(-window) },
    }
  }

  // full（READ_TIERS 三档穷尽：tier 非 blind/focused 即 full——测试断言穷尽性）
  const comments = await platform.comments.list(issueId)
  return {
    tier,
    issue: rec.id,
    title: rec.title,
    state: rec.state,
    fields: keyFieldsOf(rec),
    ...(rec.description !== undefined ? { description: rec.description } : {}),
    comments: [...comments],
  }
}

// ————————————————————————— Blind 产出物路径 —————————————————————————

/**
 * Blind 产出物路径清单（v0=本工位证据面：workspace 根 + REPORT.md + summary.json——
 * 收割四要件「REPORT 落盘」的约定落点，与 gate.ts 同一张表；「验证对象工位」关联面
 * 归真单刀，见头注拟稿）。
 */
export function blindArtifactPaths(workspace: string): string[] {
  return [workspace, path.join(workspace, REPORT_FILENAME), path.join(workspace, SUMMARY_FILENAME)]
}

// ————————————————————————— 任务书读面节渲染 —————————————————————————

/** 关键字段 → 渲染行（固定序：类型/部门/等级/泳道/派工/父单/更新时刻） */
function fieldLines(f: TicketKeyFields): string[] {
  const entries: Array<[string, string]> = []
  if (f.type !== undefined) entries.push(['类型', f.type])
  if (f.dept !== undefined) entries.push(['部门', f.dept])
  if (f.level !== undefined) entries.push(['等级', String(f.level)])
  if (f.lane !== undefined) entries.push(['泳道', f.lane])
  if (f.assignee !== undefined) entries.push(['派工', f.assignee])
  if (f.parent !== undefined) entries.push(['父单', f.parent])
  entries.push(['更新', f.updated])
  return entries.map(([k, v]) => `- ${k}：${v}`)
}

/** 单条评论渲染块（`- [id] author（created）：` + 缩进正文——多行正文保原样续行） */
function commentBlock(c: Comment): string {
  const body = c.body
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  return `- [${c.id}] ${c.author}（${c.created}）：\n${body}`
}

/** 视图形状完整性防御（渲染前校验：档位专属面缺失=畸形视图，明报不静默残缺渲染） */
function assertViewShape(view: TicketReadView): void {
  if (view.tier === 'blind' && (view.acceptance === undefined || view.acceptance.length === 0)) {
    configInvalid('read-tiers/render-blind-acceptance', 'Blind 视图缺冻结验收命令（畸形视图拒渲染——createView 是唯一合法构造口）')
  }
  if (view.tier === 'focused' && view.commentDigest === undefined) {
    configInvalid('read-tiers/render-focused-digest', 'Focused 视图缺评论摘要（畸形视图拒渲染）')
  }
  if (view.tier === 'full' && view.comments === undefined) {
    configInvalid('read-tiers/render-full-comments', 'Full 视图缺评论全量（畸形视图拒渲染）')
  }
}

/**
 * renderReadViewSection —— 视图 → 任务书（brief.md）追加的「单据读面」节（纯函数）。
 * 落点口径：任务书是 per-attempt 操作面（wkey 指引行同款裁决）；Blind 边界声明另入
 * AGENTS.md L4 scope（抗 compact 持久通道）——接线见 prompt-assembly.ts。
 */
export function renderReadViewSection(view: TicketReadView): string {
  assertViewShape(view)
  const head = `- 单据：${view.issue}「${view.title}」（状态：${view.state}）`
  const parts: string[] = []

  if (view.tier === 'blind') {
    const acceptance = view.acceptance as readonly string[]
    const artifacts = view.artifacts ?? []
    parts.push(
      '## 单据读面（Blind · 验证岗最小面——正文与评论一概不可见）',
      head,
      '- 本单为 Blind 档（17-§7 验证岗防生成者上下文污染）：生成者正文/评论对本任务不可见；完成判定只依据下列验收命令与产出物——verify 的是证据不是叙事，不得采信叙事自述，也不得向平台检索本单叙事补全上下文',
      '### 冻结验收命令（以此为准）',
      ...acceptance.map((cmd) => `- \`${cmd}\``),
      '### 产出物路径清单',
      ...(artifacts.length > 0 ? artifacts.map((p) => `- \`${p}\``) : ['- （无）']),
    )
    return `\n${parts.join('\n')}\n`
  }

  if (view.tier === 'focused') {
    const digest = view.commentDigest as CommentDigest
    const hidden = digest.total - digest.window.length
    parts.push(
      '## 单据读面（Focused · 协作岗摘要面——防上下文膨胀）',
      head,
      '### 关键字段',
      ...fieldLines(view.fields ?? { updated: '' }),
      `### 评论摘要（共 ${digest.total} 条；仅示最后 ${digest.window.length} 条）`,
      ...(digest.window.length > 0 ? digest.window.map(commentBlock) : ['- （无评论）']),
      ...(hidden > 0 ? [`（其余 ${hidden} 条以计数呈现——如需全量请走 Full 档装配）`] : []),
    )
    return `\n${parts.join('\n')}\n`
  }

  // full
  const comments = view.comments as readonly Comment[]
  parts.push(
    '## 单据读面（Full · 生成岗全量面）',
    head,
    '### 关键字段',
    ...fieldLines(view.fields ?? { updated: '' }),
    '### 正文',
    view.description ?? '（无正文）',
    `### 评论（${comments.length} 条，旧→新）`,
    ...(comments.length > 0 ? comments.map(commentBlock) : ['- （无评论）']),
  )
  return `\n${parts.join('\n')}\n`
}
