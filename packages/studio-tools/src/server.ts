/**
 * studio-tools MCP server 工厂（docs/24-§二「工具能力层对内」第一块）
 *
 * 冻结口径（拟稿，改动先过批示）：
 *   - createStudioToolsServer({ gateway, deps })：用 @modelcontextprotocol/server 2.x
 *     注册六个工具（STUDIO_TOOLS 一一对应 GATEWAY_ACTIONS）。worker 经 MCP 调网关工具，
 *     AGENTS.md 只教「什么时候用哪个」，怎么调由 schema 承担（格式错误协议层拒）。
 *   - **wkey 从 MCP 初始化注入**（24-§二）：优先级为
 *     ① initialize 请求参数 `_meta['studio-wkey']`（连接捕获，见 withInitWkeyCapture——
 *       「MCP 初始化参数注入」的协议落点；stdio 无 HTTP 头，_meta 是唯一握手期通道）
 *     ② 构造 opts.wkey 宿主直注（daemon 派工时按单签发注入 / HTTP 形态从鉴权头提取）
 *     两者都过网关 HMAC 校验，无信任差异；握手 _meta 到达即覆写初值。
 *   - **fail-closed**：无 key（未 initialize / 未注入 / 注入非字符串）→ 六工具全部
 *     返回 { category:'auth', subcause:'missing-wkey' }，不碰网关不碰 deps。
 *   - 每次工具调用：schema 化参数重组为单行 `@action <verb> <json>` 经
 *     gateway.gateWrite（鉴权→结构化校验→署名注入）；拒绝码原样透传为
 *     { category:'gateway', subcause:<gw-*> }。
 *   - 状态推进永不在工具集：注册面=STUDIO_TOOLS，server.test.ts 断言
 *     tools/list 广告面与 GATEWAY_ACTIONS 完全一致（防漂移第二道钉）。
 *
 * 拟稿疑点（待批示，沿 gateway/wkey.ts 头注）：
 *   - [ ] wkey nonce 单次有效 vs MCP 会话复用：现行语义=一 wkey 过一次闸（本包测试
 *         gw-verify-replay 用例钉住现行行为）；生产相容方案（每调用现签/复用窗口）待批
 *   - [ ] evidence-write 大正文：content 内联进 @action payload 过闸，体积上限未定
 *   - [ ] initialize _meta 的 wkey 键名 'studio-wkey' 定名（拟稿）
 */
import { McpServer } from '@modelcontextprotocol/server'
import type {
  CallToolResult,
  Implementation,
  JSONRPCMessage,
  MessageExtraInfo,
  StandardSchemaWithJSON,
  ToolCallback,
  Transport,
} from '@modelcontextprotocol/server'
import type { Gateway, GateRejectReason } from '@studio-next/gateway'
import type { GatewayAction } from '@studio-next/contract'
import { z } from 'zod'
import { TOOL_SUBCAUSES } from './tools.ts'
import type { StudioToolsDeps, ToolEnv, ToolError, ToolFieldsOf, ToolArgsOf, StudioToolSpec } from './tools.ts'
import {
  ArticleTool,
  BudgetQueryTool,
  CommentTool,
  EvidenceWriteTool,
  HeartbeatTool,
  KbSearchTool,
} from './tools.ts'

/**
 * zod schema → MCP StandardSchemaWithJSON 的类型桥（只弥合类型层，零运行时行为）。
 *
 * zod ≥4.2 的**运行时**已实现 `~standard.jsonSchema`（本仓实锁 4.6.7，已实测
 * tools/list 的 JSON Schema 转换成功；SDK 对旧 zod 亦有 z.toJSONSchema 回退），
 * 但 zod 的**类型声明**只声明了 validate 面。且桥必须**内联**出现在 registerTool
 * 实参位：经 helper 函数包装时 TS 把泛型 S 坍缩到约束（z.ZodType→output=unknown），
 * 回调参数随之退化（实测变体对照）；zod 类型补齐后应删除本类型与三处内联桥。
 */
type McpSchemaOf<T extends z.ZodType> = StandardSchemaWithJSON<z.output<T>, z.output<T>>

/** initialize 参数 _meta 里携带 wkey 的键名（拟稿定名） */
export const WKEY_META_KEY = 'studio-wkey'

const SERVER_INFO_DEFAULT: Implementation = { name: 'studio-tools', version: '0.1.0' }

/** deps 支撑的三工具（其 run 会调注入后端；失败归类 deps 而非 internal） */
const DEPS_BACKED: ReadonlySet<GatewayAction> = new Set(['kb-search', 'evidence-write', 'budget-query'])

/** 网关拒绝码 → 人读提示（subcause 才是机器口径，透传网关原码） */
const GATE_DENY_HINTS: Readonly<Record<GateRejectReason, string>> = {
  'gw-verify-malformed': 'wkey 形状非法',
  'gw-verify-bad-signature': 'wkey 签名不符（伪造或异密签发）',
  'gw-verify-revoked': '单已关，wkey 已吊销',
  'gw-verify-expired': 'wkey 已过期',
  'gw-verify-ticket-mismatch': 'wkey 单号与本网关实例不符',
  'gw-verify-scope': '该动作不在本 wkey 的 scope 内',
  'gw-verify-replay': 'wkey nonce 已消费（单次有效；现行语义一调用一签发，复用即撞重放）',
  'gw-action-not-an-action': 'payload 非结构化指令',
  'gw-action-bad-format': '@action 行格式残缺',
  'gw-action-unknown-verb': '动作词不在白名单',
  'gw-action-bad-json': '参数段 JSON 非法',
  'gw-action-bad-args': '参数段非对象',
  'gw-action-mismatch': '申报动作与 payload 动作词不一致',
  'gw-freeform-chinese': '自由中文正文（应走 LLM 回退通道，不走结构化工具）',
}

export interface StudioToolsServerOptions {
  /** 执行后端：写路径收口闸（gateWrite 全链 fail-closed；唯一写入通道） */
  readonly gateway: Gateway
  /** 注入后端：证据落盘/知识库检索/预算视图（IO 留在构造方） */
  readonly deps: StudioToolsDeps
  /** 宿主直注 wkey（daemon 派工按单签发/HTTP 鉴权头提取后注入）；缺省等 initialize _meta */
  readonly wkey?: string | undefined
  /** serverInfo（默认 { name:'studio-tools', version:'0.1.0' }） */
  readonly serverInfo?: Implementation | undefined
}

export interface StudioToolsServer {
  /** 底层 McpServer（高级接线用；工具注册已由工厂完成，勿重复注册） */
  readonly mcp: McpServer
  /**
   * 连接 transport（自动包装 withInitWkeyCapture：从 initialize 参数捕获 wkey）。
   * 与 mcp.connect 的区别仅在这一层捕获；不需要初始化注入时可直连 mcp.connect。
   */
  connect(transport: Transport): Promise<void>
  close(): Promise<void>
  /** 是否已持有凭据（不外泄 token 本体；测试/审计用） */
  readonly wkeyInjected: boolean
}

/**
 * withInitWkeyCapture —— 从 MCP initialize 请求参数捕获 wkey 的 transport 包装。
 *
 * 只看**第一条** initialize 消息的 params._meta[WKEY_META_KEY]；值为非空 string 才采纳
 * （其余一律忽略——fail-closed，不猜）。in/out 双向消息原样透传，不改写任何字节。
 * 仅捕获一次后停表（重连/重握手不再覆写；单连接语义）。
 */
export function withInitWkeyCapture(inner: Transport, onWkey: (wkey: string) => void): Transport {
  let downstream: ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined
  let seenInitialize = false
  const intercept: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void = (message, extra) => {
    if (!seenInitialize && typeof message === 'object' && message !== null && 'method' in message && message.method === 'initialize') {
      seenInitialize = true
      const meta = (message as { params?: { _meta?: Record<string, unknown> } }).params?._meta
      const candidate = meta?.[WKEY_META_KEY]
      if (typeof candidate === 'string' && candidate !== '') onWkey(candidate)
    }
    downstream?.(message, extra)
  }
  return {
    start: () => inner.start(),
    close: () => inner.close(),
    send: (message, options) => inner.send(message, options),
    get onmessage() {
      return downstream
    },
    set onmessage(fn) {
      downstream = fn
      inner.onmessage = intercept
    },
    get onerror() {
      return inner.onerror
    },
    set onerror(fn) {
      inner.onerror = fn
    },
    get onclose() {
      return inner.onclose
    },
    set onclose(fn) {
      inner.onclose = fn
    },
    get sessionId() {
      return inner.sessionId
    },
  }
}

// ---------------------------------------------------------------------------
// 工具执行：fail-closed 鉴权 → gateWrite → run 组包 → 结构化输出
// ---------------------------------------------------------------------------

function okResult(action: GatewayAction, fields: Record<string, unknown>): CallToolResult {
  const structured = { ok: true, action, ...fields }
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

function denyResult(error: ToolError): CallToolResult {
  const structured = { ok: false, error }
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: true,
  }
}

/** schema 化参数 → 单行 @action 载荷（JSON.stringify 无换行；与 actions.ts 冻结格式对齐） */
function gatePayload<A extends GatewayAction>(action: A, args: ToolArgsOf<A>): string {
  return `@action ${action} ${JSON.stringify(args)}`
}

async function runTool<A extends GatewayAction>(spec: StudioToolSpec<A>, args: ToolArgsOf<A>, env: ToolEnv): Promise<CallToolResult> {
  // 0) fail-closed：凭据未注入即全拒（不碰网关不烧 nonce）
  const token = env.wkey()
  if (token === undefined || token === '') {
    return denyResult({
      category: 'auth',
      subcause: TOOL_SUBCAUSES.authMissingWkey,
      message: `wkey 未随 MCP 初始化注入（initialize 参数 _meta['${WKEY_META_KEY}'] 或构造 opts.wkey）——工具 ${spec.name} fail-closed`,
    })
  }
  // 1) 网关闸：鉴权 → 结构化校验 → 署名注入（拒绝码原样透传）
  const gated = env.gateway.gateWrite(token, spec.name, gatePayload(spec.name, args))
  if (!gated.allowed) {
    return denyResult({ category: 'gateway', subcause: gated.reason, message: GATE_DENY_HINTS[gated.reason] })
  }
  // 2) 纯执行体组包（deps 失败→deps 族；其余意外→internal；不伪造不隐瞒）
  try {
    const fields: ToolFieldsOf<A> = await spec.run(args, env, gated.signed)
    return okResult(spec.name, fields as Record<string, unknown>)
  } catch (err) {
    if (DEPS_BACKED.has(spec.name)) {
      return denyResult({
        category: 'deps',
        subcause: `${spec.name}-failed`,
        message: `注入后端执行 ${spec.name} 失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
    return denyResult({
      category: 'internal',
      subcause: TOOL_SUBCAUSES.internalUnexpected,
      message: `工具 ${spec.name} 执行体意外抛错：${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

/**
 * createStudioToolsServer —— 组装 studio-tools 内部 MCP server。
 *
 * 六个工具全部走 runTool 公共闸（无旁路）；注册面=STUDIO_TOOLS 单一事实源，
 * 与 GATEWAY_ACTIONS 的对齐由 tools.test.ts / server.test.ts（tools/list）双钉。
 */
export function createStudioToolsServer(opts: StudioToolsServerOptions): StudioToolsServer {
  const cell: { token: string | undefined } = { token: opts.wkey }
  const env: ToolEnv = { gateway: opts.gateway, deps: opts.deps, wkey: () => cell.token }
  const mcp = new McpServer(opts.serverInfo ?? SERVER_INFO_DEFAULT)

  const register = <A extends GatewayAction>(spec: StudioToolSpec<A>): void => {
    // 泛型 A 下 SDK 对回调参数的推导退化为 unknown（实测变体对照），显式收窄到
    // ToolArgsOf<A>；三处内联桥的缘由见 McpSchemaOf 头注
    const cb = (args: ToolArgsOf<A>): Promise<CallToolResult> => runTool(spec, args, env)
    mcp.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input as unknown as McpSchemaOf<(typeof spec)['input']>,
        outputSchema: spec.output as unknown as McpSchemaOf<(typeof spec)['output']>,
      },
      cb as unknown as ToolCallback<McpSchemaOf<(typeof spec)['input']>>,
    )
  }
  register(CommentTool)
  register(HeartbeatTool)
  register(ArticleTool)
  register(KbSearchTool)
  register(EvidenceWriteTool)
  register(BudgetQueryTool)

  return {
    mcp,
    connect: async (transport) => {
      await mcp.connect(withInitWkeyCapture(transport, (wkey) => (cell.token = wkey)))
    },
    close: () => mcp.close(),
    get wkeyInjected() {
      return cell.token !== undefined && cell.token !== ''
    },
  }
}
