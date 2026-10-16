/**
 * studio-tools 工具表 —— 单一事实源（docs/24-§二、docs/25-§4.1）
 *
 * 冻结口径（拟稿，改动先过批示）：
 *   - 六工具与 GATEWAY_ACTIONS **一一对应**（同名同序）：comment/heartbeat/article/
 *     kb-search/evidence-write/budget-query——「工具集=网关白名单的机器化」（24-§二）。
 *     两表一致性由测试钉死（tools.test.ts：STUDIO_TOOLS ↔ GATEWAY_ACTIONS 对齐断言，
 *     不一致即红）；server.test.ts 再断言 live server 广告面（tools/list）与白名单一致。
 *   - **状态推进永不在表内**（24-§二/25-§4.1）：agent 拿不到改状态通道，本表是唯一
 *     工具面，新增工具=动 GATEWAY_ACTIONS=动契约（25-§4.1 批示流）。
 *   - AGENTS.md（prompt 包 L5）只引用本表教「什么时候用哪个」；「怎么调」由 MCP
 *     input schema 承担——格式错误由协议层拒绝，不再靠模型自觉（24-§二）。
 *   - 输入 schema 全部 strictObject：多余字段拒收（fail-closed，不猜不修复）。
 *   - 输出统一两级错误分类 { category, subcause }（机器可读）；category 冻结四族：
 *     auth（凭据缺失）/ gateway（网关拒绝码透传）/ deps（注入后端失败）/ internal。
 *   - run() 是纯执行体：只组包，不做鉴权（鉴权在 server.ts 的网关闸前置于 run）；
 *     deps 由构造方注入（IO 留在外面的纪律与 core/gateway 一致）。
 */
import { z } from 'zod'
import type { Gateway } from '@studio-next/gateway'
import type { GatewayAction, SignedBody } from '@studio-next/contract'

// ---------------------------------------------------------------------------
// 错误两级分类（category/subcause，机器可读冻结面）
// ---------------------------------------------------------------------------

/** 错误族（冻结：新增须过批示——AGENTS.md/收割侧按此分诊） */
export const TOOL_ERROR_CATEGORIES = ['auth', 'gateway', 'deps', 'internal'] as const
export type ToolErrorCategory = (typeof TOOL_ERROR_CATEGORIES)[number]

/** subcause 冻结值（gateway 族为网关拒绝码原样透传，见 GATE_DENY_HINTS） */
export const TOOL_SUBCAUSES = {
  /** auth：wkey 未随 MCP 初始化注入（initialize _meta 或构造 opts.wkey）——全工具 fail-closed */
  authMissingWkey: 'missing-wkey',
  /** deps：注入的证据落盘后端失败 */
  depsEvidenceWrite: 'evidence-write-failed',
  /** deps：注入的知识库检索后端失败 */
  depsKbSearch: 'kb-search-failed',
  /** deps：注入的预算视图后端失败 */
  depsBudgetQuery: 'budget-query-failed',
  /** internal：执行体意外抛错（无伪造、如实上报） */
  internalUnexpected: 'unexpected',
} as const

export interface ToolError {
  readonly category: ToolErrorCategory
  readonly subcause: string
  readonly message: string
}

/** 拒绝形态的输出 schema（六工具共用的 deny 分支） */
const DenyOutput = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    category: z.enum(TOOL_ERROR_CATEGORIES),
    subcause: z.string().min(1),
    message: z.string(),
  }),
})

// ---------------------------------------------------------------------------
// 注入后端（deps）：IO 留在构造方，本包只持有函数形状
// ---------------------------------------------------------------------------

/** 知识库命中（kb-search 返回项；score 高=更相关，排序归后端） */
export interface KbHit {
  readonly path: string
  readonly score: number
  readonly snippet?: string | undefined
}

const KbHitSchema = z.strictObject({
  path: z.string().min(1),
  score: z.number(),
  snippet: z.string().optional(),
})

export interface WriteEvidenceOutcome {
  readonly bytes: number
}

export interface StudioToolsDeps {
  /** evidence-write 的落盘后端（daemon 侧实现：写本单证据目录，返回落盘字节数） */
  writeEvidence(path: string, content: string): Promise<WriteEvidenceOutcome>
  /** kb-search 的检索后端（kb 包实现：命中列表） */
  searchKb(query: string): Promise<readonly KbHit[]>
  /** budget-query 的预算视图后端（core 预算模块实现：只读视图） */
  queryBudget(issue: string): Promise<Readonly<Record<string, unknown>>>
}

/** 工具执行环境（server.ts 组装；run() 只经 env 取依赖，不自行鉴权） */
export interface ToolEnv {
  readonly gateway: Gateway
  readonly deps: StudioToolsDeps
  /** 当前会话凭据（MCP 初始化注入）；缺省=undefined → 全工具 fail-closed */
  readonly wkey: () => string | undefined
}

// ---------------------------------------------------------------------------
// 六工具输入/输出 schema（「怎么调」的唯一权威——MCP 层据此拒坏输入）
// ---------------------------------------------------------------------------

export const CommentInput = z.strictObject({
  issue: z.string().min(1).describe('目标单据 id（评论落在哪张单上）'),
  body: z.string().min(1).describe('评论正文（进展汇报/结论回执/公开留言）'),
})

export const HeartbeatInput = z.strictObject({
  issue: z.string().min(1).describe('本单 id（向看护证明 worker 仍活动）'),
})

export const ArticleInput = z.strictObject({
  path: z.string().min(1).describe('知识库文章路径（kb 内相对路径，upsert 语义）'),
  markdown: z.string().describe('文章 markdown 全文'),
})

export const KbSearchInput = z.strictObject({
  query: z.string().min(1).describe('检索词（干活前先查现成知识/教训）'),
})

export const EvidenceWriteInput = z.strictObject({
  path: z.string().min(1).describe('证据文件路径（本单证据目录内相对路径）'),
  content: z.string().min(1).describe('证据内容全文（完成只认落盘证据）'),
})

export const BudgetQueryInput = z.strictObject({
  issue: z.string().min(1).describe('本单 id（花前先看预算视图）'),
})

/** 各工具输出 = ok 分支（结构化成功回执）与 deny 分支（两级错误）的判别并集 */
export const CommentOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('comment'),
    issue: z.string().min(1),
    author: z.string().min(1),
    signature: z.string().min(1),
  }),
  DenyOutput,
])
export const HeartbeatOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('heartbeat'),
    issue: z.string().min(1),
    author: z.string().min(1),
    signature: z.string().min(1),
  }),
  DenyOutput,
])
export const ArticleOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('article'),
    path: z.string().min(1),
    author: z.string().min(1),
    signature: z.string().min(1),
  }),
  DenyOutput,
])
export const KbSearchOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('kb-search'),
    hits: z.array(KbHitSchema),
  }),
  DenyOutput,
])
export const EvidenceWriteOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('evidence-write'),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
  }),
  DenyOutput,
])
export const BudgetQueryOutput = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal('budget-query'),
    view: z.record(z.string(), z.unknown()),
  }),
  DenyOutput,
])

// ---------------------------------------------------------------------------
// 工具规格（名字+schema+「什么时候用」文档+执行体）
// ---------------------------------------------------------------------------

/** name→输入 schema 的映射（类型层锁定 spec.input 形状） */
type ToolInputMap = {
  comment: typeof CommentInput
  heartbeat: typeof HeartbeatInput
  article: typeof ArticleInput
  'kb-search': typeof KbSearchInput
  'evidence-write': typeof EvidenceWriteInput
  'budget-query': typeof BudgetQueryInput
}

/** name→输出 schema 的映射 */
type ToolOutputMap = {
  comment: typeof CommentOutput
  heartbeat: typeof HeartbeatOutput
  article: typeof ArticleOutput
  'kb-search': typeof KbSearchOutput
  'evidence-write': typeof EvidenceWriteOutput
  'budget-query': typeof BudgetQueryOutput
}

export type ToolArgsOf<A extends GatewayAction> = z.output<ToolInputMap[A]>
export type ToolOkOf<A extends GatewayAction> = Extract<z.output<ToolOutputMap[A]>, { ok: true }>
/** run 返回体（server.ts 负责再包 { ok:true, action } 公共壳） */
export type ToolFieldsOf<A extends GatewayAction> = Omit<ToolOkOf<A>, 'ok' | 'action'>

export interface StudioToolSpec<A extends GatewayAction = GatewayAction> {
  /** 与 GATEWAY_ACTIONS 同名（一一对应，测试钉死） */
  readonly name: A
  readonly title: string
  /** 「什么时候用哪个」——AGENTS.md L5 引用；「怎么调」不写在这里（schema 承担） */
  readonly description: string
  readonly input: ToolInputMap[A]
  readonly output: ToolOutputMap[A]
  /** 纯执行体：网关已放行（signed=署名回执）后组包；只经 env 取 deps，不鉴权 */
  readonly run: (args: ToolArgsOf<A>, env: ToolEnv, signed: SignedBody) => Promise<ToolFieldsOf<A>>
}

export const CommentTool: StudioToolSpec<'comment'> = {
  name: 'comment',
  title: '署名评论',
  description:
    '给单据追加一条网关署名评论：进展汇报、结论回执、需要留痕的公开说明。评什么写 body；不推进单据状态（状态推进永不在工具集）。',
  input: CommentInput,
  output: CommentOutput,
  run: async (args, _env, signed) => ({
    issue: args.issue,
    author: signed.author,
    signature: signed.signature,
  }),
}

export const HeartbeatTool: StudioToolSpec<'heartbeat'> = {
  name: 'heartbeat',
  title: '活性心跳',
  description:
    '长任务执行中定期向平台报告本单仍在活动，防看护误判僵死。只报「还活着」，不带结论；完成/结论走 comment 或证据落盘。',
  input: HeartbeatInput,
  output: HeartbeatOutput,
  run: async (args, _env, signed) => ({
    issue: args.issue,
    author: signed.author,
    signature: signed.signature,
  }),
}

export const ArticleTool: StudioToolSpec<'article'> = {
  name: 'article',
  title: '知识库写入',
  description:
    '知识库文章 upsert：把可复复用的经验、教训、作业知识沉淀为 markdown 文章。新知识与旧文同路径即覆盖更新。',
  input: ArticleInput,
  output: ArticleOutput,
  run: async (args, _env, signed) => ({
    path: args.path,
    author: signed.author,
    signature: signed.signature,
  }),
}

export const KbSearchTool: StudioToolSpec<'kb-search'> = {
  name: 'kb-search',
  title: '知识库检索',
  description: '干活前先查知识库：有没有现成做法/前人教训，避免重复踩坑。返回命中列表（path+摘要+相关度）。',
  input: KbSearchInput,
  output: KbSearchOutput,
  run: async (args, env) => ({ hits: [...(await env.deps.searchKb(args.query))] }),
}

export const EvidenceWriteTool: StudioToolSpec<'evidence-write'> = {
  name: 'evidence-write',
  title: '证据落盘',
  description:
    '把完成证据（REPORT、输出物清单、测试原文等）写入本单证据目录。完成只认落盘证据——无证据=无完成。',
  input: EvidenceWriteInput,
  output: EvidenceWriteOutput,
  run: async (args, env) => {
    const outcome = await env.deps.writeEvidence(args.path, args.content)
    return { path: args.path, bytes: outcome.bytes }
  },
}

export const BudgetQueryTool: StudioToolSpec<'budget-query'> = {
  name: 'budget-query',
  title: '预算视图',
  description: '查本单预算视图（预留/已结算/剩余额度与价目口径）。花大成本的动作前先看，避免断路。',
  input: BudgetQueryInput,
  output: BudgetQueryOutput,
  run: async (args, env) => ({ view: { ...(await env.deps.queryBudget(args.issue)) } }),
}

/**
 * STUDIO_TOOLS —— 工具表单一事实源。
 * 顺序与 GATEWAY_ACTIONS 逐位对齐（comment/heartbeat/article/kb-search/evidence-write/budget-query）；
 * 对齐由 tools.test.ts 静态断言 + server.test.ts 的 tools/list 广告面断言双重钉死。
 */
export const STUDIO_TOOLS = [
  CommentTool,
  HeartbeatTool,
  ArticleTool,
  KbSearchTool,
  EvidenceWriteTool,
  BudgetQueryTool,
] as const

/** 工具名列表（= GATEWAY_ACTIONS 的镜像，供快速对照/测试） */
export const STUDIO_TOOL_NAMES: readonly GatewayAction[] = STUDIO_TOOLS.map((t) => t.name)

/** 供 AGENTS.md 生成器（prompt 包 L5）引用的摘要：名字+schema 摘要+对应 GatewayAction */
export interface StudioToolSummary {
  readonly name: GatewayAction
  readonly action: GatewayAction
  readonly title: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export function studioToolSummaries(): readonly StudioToolSummary[] {
  return STUDIO_TOOLS.map((t) => ({
    name: t.name,
    action: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input) as Record<string, unknown>,
  }))
}
