/**
 * gated-platform —— FlowPlatform 写路径网关收口包装器（docs/17-§7「一切 YouTrack 写入经 wkey 网关」
 * 的 daemon 侧机制化：engine 此前直调 platform，是最后一条未收口的写路径）
 *
 * 依据（实现单引用）：
 *   - docs/17-§7 写入全收口：写方法先 gateway.gateWrite（fail-closed，被拒绝不绕过直调原
 *     platform）；控制面自身也过网关（不留绕过通道）；署名自动注入 [公司·部门·岗位·级别]。
 *   - docs/25-§4.1 / contract ports/gateway.ts：GATEWAY_ACTIONS 冻结六动词
 *     （comment/heartbeat/article/kb-search/evidence-write/budget-query）——**状态推进不在表内**
 *     （18-§二.3：agent 永远拿不到改状态通道）。
 *   - docs/24-§二：工具集=网关白名单的机器化（studio-tools MCP）——表是 worker 面。
 *
 * 覆盖面（对 FlowPlatform 七能力全量分类，结构穷尽由测试断言）：
 *   - 写面（过闸）：issues.create / issues.transition / issues.setField / comments.add /
 *     fields.provision / kb.upsert / links.link / guards.install / guards.uninstall
 *   - 读面（直通零开销——不触闸）：issues.list / issues.get / comments.list / fields.schema /
 *     kb.search / kb.get / activity.since / links.children
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - 【动词映射借道】控制面状态操作（create/transition/setField/link/provision/guards）在冻结
 *     白名单内无对应动词（六动词全是 worker 面：评论/心跳/文章/检索/证据/预算）。v0 借道
 *     'comment' + args.op 自述真实操作（如 {"op":"issues.transition","issue":"T-1","to":"已派发"}）。
 *     机制上等价（鉴权/吊销/时效/重放全链生效、payload 与申报动词一致），语义上是借用——
 *     GATEWAY_ACTIONS 增补控制面动词族（如 ctl-* 族）须改 contract 走批示，不属本单（只动 apps/daemon）。
 *   - 【错误分类】运行期拒绝按两级分类上抛为 ClassifiedError：category=EXTERNAL_REJECT
 *     （17-§9「外部系统拒绝需人介入协调，机器不自愈」——与 fail-closed 不自愈语义最贴；
 *     无 GATEWAY_REJECT 类别，归类拟稿），subcause=网关拒绝码（gw-verify-* / gw-action-*）。
 *     构造期非法（空工号/坏署名上下文）抛 CONFIG_INVALID（对齐 errors.ts 通道）。
 *   - 【信封不落库】gateWrite 返回的 signed.body 是 @action 信封原文（gateway 纪律：署名不改写
 *     正文、正文语义归平台侧）；包装器作为 daemon 侧最后一站，落库正文用**原始文本**重组
 *     SignedBody（署名工号/落款来自 daemon 侧身份入参——调用方不得自带 author/signature 伪造）。
 *
 * v0 简化与诚实边界（头注挂账）：
 *   - token 统一用控制面 control key（gateway.issueControlKey——CONTROL_TICKET 实例）；
 *     **按单 wkey（派发时随 TaskBrief 签发、收割/关单时吊销）不属本单**——worker 侧经
 *     studio-tools MCP 调闸是独立包后续单（opts.mintControlKey 是未来的接缝）。
 *   - nonce 单次有效 ⇒ **一调用一签发**：每次写前现铸短命 control key（缺省 TTL=CONTROL_TTL_DEFAULT
 *     15m，即铸即用）；revoke(CONTROL_TICKET) 即控制面通道一刀切吊销（此后全写面恒拒）。
 *   - 读面分级 Full/Focused/Blind（17-§7，验证岗 Blind 防生成者上下文污染）归 v0.8 读面单。
 *   - 包装器透明：engine 写调用签名不变（返回值仍是 FlowPlatform），零改动接线见 serve.ts。
 */
import { configInvalid } from '@studio-next/contract'
import { composeSignature, signedBody } from '@studio-next/gateway'
import type { Gateway, GateRejectReason, SignatureContext } from '@studio-next/gateway'
import type {
  ActivityPage,
  ClassifiedError,
  Comment,
  CompanySlug,
  FieldProvisionMap,
  FieldSchema,
  FlowPlatform,
  GatewayAction,
  GuardRule,
  IssueCreate,
  IssueQuery,
  IssueRecord,
  KbHit,
  LinkType,
  PersonId,
  SignedBody,
  TicketId,
} from '@studio-next/contract'

/** 写面方法名（过闸）——覆盖面清单的机器可读形态（结构穷尽由测试断言） */
export const GATED_WRITE_METHODS = [
  'issues.create',
  'issues.transition',
  'issues.setField',
  'comments.add',
  'fields.provision',
  'kb.upsert',
  'links.link',
  'guards.install',
  'guards.uninstall',
] as const

/** 读面方法名（直通零开销）——同上 */
export const PASSTHROUGH_READ_METHODS = [
  'issues.list',
  'issues.get',
  'comments.list',
  'fields.schema',
  'kb.search',
  'kb.get',
  'activity.since',
  'links.children',
] as const

/** 包装器选项（daemon 侧控制面身份——署名注入的权威来源） */
export interface GatedPlatformOptions {
  /** 署名上下文四身份位（公司/部门/岗位/级别；构造期校验，非法抛 CONFIG_INVALID） */
  ctx: SignatureContext
  /** 署名工号（SignedBody.author；控制面身份，非人员工号——拟稿口径） */
  author: PersonId
  /**
   * 控制 key 铸造器注入（缺省 gateway.issueControlKey——一调用一签发）。
   * 测试注入坏 token 验 fail-closed；未来按单 wkey 在此接缝切换（TODO 头注）。
   */
  mintControlKey?: () => string
}

/** 运行期拒绝（两级分类的运行级通道：Error 本体 + ClassifiedError 形状，对齐 configInvalid 手法） */
function gatewayRejected(subcause: GateRejectReason, detail: string): Error & ClassifiedError {
  const err = new Error(`EXTERNAL_REJECT/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'EXTERNAL_REJECT'
  err.subcause = subcause
  err.detail = detail
  return err
}

/**
 * createGatedPlatform —— 把 FlowPlatform 包成写路径过闸的代理。
 *
 * @param platform 底层平台（fake / 未来 localfile|yt——包装器不感知实现）
 * @param gateway 网关实例（控制面实例：ticket=CONTROL_TICKET；由调用方构造注入）
 * @param opts    daemon 侧身份 + key 铸造器
 */
export function createGatedPlatform(platform: FlowPlatform, gateway: Gateway, opts: GatedPlatformOptions): FlowPlatform {
  // 构造期校验（两级分类的构造级通道）：空工号明报；署名上下文复用 gateway 的校验（单一口径）
  if (opts.author === '') throw configInvalid('gwp-empty-author', '网关署名工号不得为空（daemon 侧身份入参）')
  composeSignature(opts.ctx)

  const mint = opts.mintControlKey ?? ((): string => gateway.issueControlKey())

  /**
   * 写路径闸（17-§7）：现铸短命 control key → gateWrite（鉴权→结构化→署名）。
   * 被拒 → EXTERNAL_REJECT/<gw-*> 上抛，**底层 platform 不被调用**（fail-closed，绝不绕过）。
   * payload=包装器自组的 @action 信封（JSON.stringify 恒产对象、无裸换行——首行信封稳定）。
   */
  function gate(action: GatewayAction, args: Record<string, unknown>, op: string): void {
    const token = mint()
    const payload = `@action ${action} ${JSON.stringify(args)}`
    const verdict = gateway.gateWrite(token, action, payload)
    if (!verdict.allowed) {
      throw gatewayRejected(
        verdict.reason,
        `平台写 ${op} 被网关拒绝（申报动作 ${action}；fail-closed：底层平台未被调用）`,
      )
    }
  }

  return {
    issues: {
      // —— 读面直通（零开销：不触闸）——
      list: (q: IssueQuery): Promise<IssueRecord[]> => platform.issues.list(q),
      get: (id: TicketId): Promise<IssueRecord> => platform.issues.get(id),
      // —— 写面过闸 ——
      async create(input: IssueCreate): Promise<IssueRecord> {
        gate('comment', { op: 'issues.create', ...input }, 'issues.create')
        return platform.issues.create(input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        gate('comment', { op: 'issues.transition', issue: id, to: toState }, 'issues.transition')
        return platform.issues.transition(id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        // JSON 无 undefined——显式归一 null（信封稳定性，不改写给平台的原值）
        gate('comment', { op: 'issues.setField', issue: id, field, value: value === undefined ? null : value }, 'issues.setField')
        return platform.issues.setField(id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        // 调用方只供正文文本；author/signature 由 daemon 侧身份统一注入（防伪造署名）——
        // 信封（@action 行）不落库，落库正文=原文（见头注「信封不落库」拟稿）
        gate('comment', { issue: id, body: body.body }, 'comments.add')
        return platform.comments.add(id, signedBody(opts.ctx, opts.author, body.body))
      },
      list: (id: TicketId): Promise<Comment[]> => platform.comments.list(id),
    },
    fields: {
      schema: (): Promise<FieldSchema[]> => platform.fields.schema(),
      async provision(map: FieldProvisionMap): Promise<void> {
        gate('comment', { op: 'fields.provision', states: map.states, fields: Object.keys(map.fields) }, 'fields.provision')
        return platform.fields.provision(map)
      },
    },
    kb: {
      async upsert(p: string, md: string): Promise<void> {
        gate('article', { path: p, md }, 'kb.upsert')
        return platform.kb.upsert(p, md)
      },
      search: (q: string): Promise<KbHit[]> => platform.kb.search(q),
      get: (p: string): Promise<string> => platform.kb.get(p),
    },
    activity: {
      since: (cursor: string | null): Promise<ActivityPage> => platform.activity.since(cursor),
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        gate('comment', { op: 'links.link', a, b, type }, 'links.link')
        return platform.links.link(a, b, type)
      },
      children: (id: TicketId): Promise<TicketId[]> => platform.links.children(id),
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        gate('comment', { op: 'guards.install', company, rules: rules.length }, 'guards.install')
        return platform.guards.install(company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        gate('comment', { op: 'guards.uninstall', company }, 'guards.uninstall')
        return platform.guards.uninstall(company)
      },
    },
  }
}
