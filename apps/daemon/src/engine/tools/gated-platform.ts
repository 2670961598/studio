/**
 * gated-platform —— FlowPlatform 写路径网关收口包装器（docs/17-§7「一切 YouTrack 写入经 wkey 网关」
 * 的 daemon 侧机制化：engine 此前直调 platform，是最后一条未收口的写路径）
 *
 * 依据（实现单引用）：
 *   - docs/17-§7 写入全收口：写方法先过 gateway（worker 面 `gateWrite` / 控制面面
 *     `gateWriteCtl`；fail-closed，被拒绝不绕过直调原 platform）；控制面自身也过网关
 *     （不留绕过通道）；署名自动注入 [公司·部门·岗位·级别]。
 *   - docs/v2/15 §二 SEC-SIG-03 / docs/v2/14 §二-2 / docs/v2/09 ENU-119：控制面平台写
 *     申报 ctl- 六动词，禁借道 `comment`（本件=接线落点；动作词值集仍归 gateway 侧合成）。
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
 * 动作词路由（studio-dev-545；SEC-SIG-03 / docs/v2/15 §二、docs/v2/14 §二-2）：
 *   - 控制面平台写（create/transition/setField/link/provision/guards）**不再借道 comment**：
 *     申报动词走 ctl- 六动词（ctl-create / ctl-transition / ctl-set-field / ctl-link /
 *     ctl-provision / ctl-guards），入口恒为 `gateway.gateWriteCtl`（与 gateWrite 同一条闸链，
 *     只切申报动词域）；op→动词路由表复用 gateway 的 `CONTROL_OP_ACTIONS`（唯一源，
 *     本文件不重写 ctl- 字面量），禁第二值域源。
 *   - worker 面写（comments.add / kb.upsert）仍走 `gateway.gateWrite` 的 comment/article——
 *     两面入口与词域互斥，运行期硬化（擦除后无类型仍拦）：ctl- 动词从 worker 口进入＝
 *     gw-action-mismatch，worker 动词从 ctl 口进入同拒。
 *   - 审计面：args.op 自述保留（如 {"op":"issues.transition",...}），resolveAuditAction 直报
 *     ctl- 与自述同族＝一致、不降级；transition 不再显示为 comment（v2/15 §二）。
 *   - 缺证/未登记动词 fail-closed：授权链拒、wkey 拒、动词域不匹配任一命中＝EXTERNAL_REJECT，
 *     底层 platform 零调用（不静默放行、不降级）。
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
import { CONTROL_OP_ACTIONS, CONTROL_TICKET, composeSignature, isCtlAction, isGatewayAction, signedBody } from '@studio-next/gateway'
import type { CtlAction, Gateway, GatewayActionWord, GateWriteResult, SignatureContext } from '@studio-next/gateway'
import type { AuthorityGate } from './authority-gate.ts'
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
  mintControlKey?: (action: GatewayActionWord) => string
  /**
   * 授权链闸（studio-dev-528；缺省不启用＝存量装配零变更）。给出即在 wkey 鉴权前先过
   * core/authority 五函数接线（engine/tools/authority-gate.ts）：拒绝＝EXTERNAL_REJECT/
   * gw-authority-*，底层 platform 零调用（fail-closed）。
   */
  authority?: AuthorityGate
  /** 授权证据的单号锚（缺省 CONTROL_TICKET——控制面实例口径） */
  ticket?: TicketId
}

/** 运行期拒绝（两级分类的运行级通道：Error 本体 + ClassifiedError 形状，对齐 configInvalid 手法） */
function gatewayRejected(subcause: string, detail: string): Error & ClassifiedError {
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

  // 每次写按**本次申报动词**现铸最小 scope 的 control key（ctl- 写必须显式声明 ctl- scope，
  // 否则网关 scope 判定恒拒——studio-dev-545；worker 写仍只声明 worker 动词）
  const mint = opts.mintControlKey ?? ((action: GatewayActionWord): string => gateway.issueControlKey({ scope: [action] }))

  /**
   * 唯一闸链执行体（17-§7 / SEC-SIG-03）：入口由 face 决定（worker=gateWrite / ctl=gateWriteCtl），
   * 其余步骤（授权链判定 → 现铸短命 control key → 网关鉴权/结构化/署名）完全同构——
   * 不是两条闸、不设旁路。任一步被拒 → EXTERNAL_REJECT/<gw-*> 上抛，**底层 platform 不被调用**
   * （fail-closed，绝不绕过）。payload=包装器自组的 @action 信封（JSON.stringify 恒产对象、
   * 无裸换行——首行信封稳定）。
   *
   * 入口动词域硬化（先于授权/铸造 token）：worker 口只收 contract 六动词，ctl 口只收 ctl- 六动词；
   * 不匹配＝gw-action-mismatch（擦除后无类型仍拦，越权动词不进任何判定链）。
   */
  function runGate(face: 'worker' | 'ctl', action: GatewayActionWord, args: Record<string, unknown>, op: string): void {
    let entryAction: GatewayAction | CtlAction
    if (face === 'ctl') {
      if (!isCtlAction(action)) {
        throw gatewayRejected(
          'gw-action-mismatch',
          `平台写 ${op} 从控制面口夹带非 ctl- 动作 ${action}（fail-closed：底层平台未被调用）`,
        )
      }
      entryAction = action
    } else {
      if (!isGatewayAction(action)) {
        throw gatewayRejected(
          'gw-action-mismatch',
          `平台写 ${op} 从 worker 口夹带 ctl- 动作 ${action}（fail-closed：底层平台未被调用）`,
        )
      }
      entryAction = action
    }
    // 0) 授权链判定（先于铸造 token：拒绝不烧 nonce；证据由闸内 record 落点留痕）
    if (opts.authority !== undefined) {
      const decision = opts.authority.authorize({ action: entryAction, args, ticket: opts.ticket ?? CONTROL_TICKET })
      if (!decision.allowed) {
        throw gatewayRejected(
          decision.reason ?? 'gw-authority-prohibited',
          `平台写 ${op} 被授权链拒绝（动作 ${entryAction}；state=${decision.state}；evidence=${decision.evidenceId}；` +
            `fail-closed：底层平台未被调用）`,
        )
      }
    }
    const token = mint(entryAction)
    const payload = `@action ${entryAction} ${JSON.stringify(args)}`
    // 入口切换只切申报动词域：ctl- 走 gateWriteCtl，其余走 gateWrite（同一条闸链）
    const verdict: GateWriteResult = isCtlAction(entryAction)
      ? gateway.gateWriteCtl(token, entryAction, payload)
      : gateway.gateWrite(token, entryAction, payload)
    if (!verdict.allowed) {
      throw gatewayRejected(
        verdict.reason,
        `平台写 ${op} 被网关拒绝（申报动作 ${entryAction}；fail-closed：底层平台未被调用）`,
      )
    }
  }

  /** worker 面写入口（contract 六动词：comment/article 等） */
  function gate(action: GatewayAction, args: Record<string, unknown>, op: string): void {
    runGate('worker', action, args, op)
  }

  /** 控制面写入口（ctl- 六动词；禁借道 gateWrite） */
  function gateCtl(action: CtlAction, args: Record<string, unknown>, op: string): void {
    runGate('ctl', action, args, op)
  }

  return {
    issues: {
      // —— 读面直通（零开销：不触闸）——
      list: (q: IssueQuery): Promise<IssueRecord[]> => platform.issues.list(q),
      get: (id: TicketId): Promise<IssueRecord> => platform.issues.get(id),
      // —— 写面过闸 ——
      async create(input: IssueCreate): Promise<IssueRecord> {
        gateCtl(CONTROL_OP_ACTIONS['issues.create'], { op: 'issues.create', ...input }, 'issues.create')
        return platform.issues.create(input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        gateCtl(CONTROL_OP_ACTIONS['issues.transition'], { op: 'issues.transition', issue: id, to: toState }, 'issues.transition')
        return platform.issues.transition(id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        // JSON 无 undefined——显式归一 null（信封稳定性，不改写给平台的原值）
        gateCtl(
          CONTROL_OP_ACTIONS['issues.setField'],
          { op: 'issues.setField', issue: id, field, value: value === undefined ? null : value },
          'issues.setField',
        )
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
        gateCtl(
          CONTROL_OP_ACTIONS['fields.provision'],
          { op: 'fields.provision', states: map.states, fields: Object.keys(map.fields) },
          'fields.provision',
        )
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
        gateCtl(CONTROL_OP_ACTIONS['links.link'], { op: 'links.link', a, b, type }, 'links.link')
        return platform.links.link(a, b, type)
      },
      children: (id: TicketId): Promise<TicketId[]> => platform.links.children(id),
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        gateCtl(CONTROL_OP_ACTIONS['guards.install'], { op: 'guards.install', company, rules: rules.length }, 'guards.install')
        return platform.guards.install(company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        gateCtl(CONTROL_OP_ACTIONS['guards.uninstall'], { op: 'guards.uninstall', company }, 'guards.uninstall')
        return platform.guards.uninstall(company)
      },
    },
  }
}
