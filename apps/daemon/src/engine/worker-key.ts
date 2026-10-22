/**
 * worker-key —— worker 级 wkey 生命周期接线件（docs/17-§7「wkey 按单签发、关单吊销」的 daemon 侧闭环）
 *
 * 生命周期（与 engine 相位对应；engine.ts 调用点）：
 *   - 签发（dispatch 相位，launch 前）：mintWorkerKey——scope=GATEWAY_ACTIONS 六动词全集
 *     （v0 不细分；细分化按动作词走批示）；nonce 经 makeNonce 注入（缺省 randomUUID，
 *     一 attempt 一 key——nonce 链干净）。
 *   - 注入（launch 前）：TaskBrief.credentials（contract v1.4）——
 *     workerKeyCredentials(token) 构造 `{ STUDIO_TOOLS_WKEY: token }` 随任务书进
 *     适配器，四家 executor 无条件透传进子进程 env（packages/adapters launch env 尾项）。
 *   - 吊销（终局面才吊销）：CLOSE = gateway.revoke(ticket)（同单全部 key
 *     立即失效，先于过期/重放判定）。【DEV-46 修订】断路熔断**不再吊销**——半开
 *     试探（冷却窗过后的单次重派）要重签新 key，ticket 级吊销会令试探 key 出生即死。
 *
 * 【通道选型——制作人已定调（2026-10-18，docs/25 头注）】凭据经子进程环境变量注入，
 *   永不入提示词/档案/任务书：wkey 投递走 env 通道（本文件现行形态）。旧文件通道
 *   （workspace `.studio-next/wkey` 0600）已删——env 通道相对文件通道的优势：
 *     a. 凭据离场=子进程终结（结构性撤离，无文件残留面、无 0600 权限维护面）；
 *     b. 适配器层单点透传（TaskBrief.credentials），不依赖 workspace 目录布局；
 *     c. 与 studio-tools 宿主直注键名同表（STUDIO_TOOLS_WKEY——worker 侧 MCP initialize
 *        `_meta['studio-wkey']` 或读 env 皆可接）。
 *   红名单（contract v1.4 冻结语义）：凭据值不记录/不打印——不进日志、事件 note、
 *   任务书正文、台账任何文本面。
 *
 * 【吊销粒度裁决】（拟稿待批——与任务书「GATE_FAIL 旧 key 吊销+重签」的偏差如实声明）：
 *   冻结的 revoke(ticket) 是 **ticket 级终局动作**（authority 无 per-key 吊销、无解吊销面，
 *   packages/gateway/wkey.ts）——一旦吊销，同 ticket 此后再签的 key 也死。若在 GATE_FAIL
 *   （将重派）时吊销，重签给下一 attempt worker 的 key 出生即死（结构性矛盾）。故：
 *     - GATE_FAIL / 派发失败（非终局，会重派重试）：**不吊销**——旧 key 的凭据已随
 *       子进程 env 离场（进程终结即撤离），失效兜底 = TTL + nonce 单次有效；重派重签
 *       = 新 TaskBrief 新 credentials（一 attempt 一 key，nonce 链干净）。
 *     - 断路熔断（DEV-46 起**非终局**）：**不吊销**——冷却窗过后半开试探重派要重签新
 *       key（同 GATE_FAIL 语义：env-离场 + TTL/nonce 兜底）；熔断期间凭据无重签面，
 *       压制由 decide HOLD_BREAKER_OPEN 保证。
 *     - CLOSE（终局，交付归档后不再有同 ticket 重签面）：吊销。
 *   per-key（nonce 级）吊销需 gateway 包扩 authority API（走批示，非本单可动）；该
 *   偏差作为疑点上报。
 *
 * 【TTL 拟稿】缺省 24h：主失效面是关单吊销，TTL 只是兜底（进程崩溃丢内存吊销集时凭据
 *   仍会自然过期）。阈值改动走批示。
 *
 * 【吊销可见性疑点】（上报，非本单可解）：gateway.revoke 记在**签发实例的内存 authority**
 *   （wkey.ts「已见 nonce/吊销集合均在内存（拟稿：生产换 store）」）。worker 侧验签实例与
 *   签发实例**同进程共享同一 Gateway 对象**时吊销即时生效（测试/demo 即此形态，本单 e2e
 *   钉死）；跨进程（stdio MCP 各起进程）时吊销不可见——teeth 依赖 authority 落 store
 *   （gateway 包挂账的后续单）。
 *
 * 纪律：只 import 不改 packages/*；时钟/nonce 全注入；本模块零盘 IO（env 通道下凭据
 *   不过文件系统——workspace 内无凭据落点）。
 */
import { randomUUID } from 'node:crypto'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { TicketId } from '@studio-next/contract'
import type { Gateway } from '@studio-next/gateway'

// ————————————————————————— 常量（拟稿定名，待批示） —————————————————————————

/**
 * env 注入键名（与 studio-tools 宿主直注键名同一张表，README 接缝）：
 * daemon 经 TaskBrief.credentials 注入 → 适配器透传 → 子进程 env STUDIO_TOOLS_WKEY。
 */
export const WORKER_WKEY_ENV_KEY = 'STUDIO_TOOLS_WKEY'

/** 缺省 TTL（拟稿：24h——关单吊销是主失效面，TTL 是兜底；见头注） */
export const WORKER_WKEY_TTL_DEFAULT = '24h'

// ————————————————————————— 依赖注入 —————————————————————————

/** engine 侧依赖（EngineDeps.workerKeys；缺省不注入=worker key 面关闭，行为零变更） */
export interface WorkerKeyDeps {
  /**
   * 签发/吊销机构（Gateway 的 issue/revoke 面；gateWrite 不在此用——worker 侧验签归
   * studio-tools 接线的 per-ticket 实例）。实例绑定口径：serve 侧绑 CONTROL_TICKET
   * （verify 面结构性失效——本实例永远不能验 worker key，防误用）；测试/打通场景与
   * worker 侧共享同一对象（吊销即时可见，见头注疑点）。
   */
  gateway: Gateway
  /** nonce 生成器（缺省 randomUUID；测试注入确定性序列） */
  makeNonce?: () => string
}

// ————————————————————————— 签发 —————————————————————————

/** 签发产物：token 本体 + nonce（nonce 已在 token 内，回读仅供审计/测试断言） */
export interface MintedWorkerKey {
  readonly token: string
  readonly nonce: string
}

/**
 * mintWorkerKey —— 按单签发 worker wkey（17-§7）。
 *
 * scope=GATEWAY_ACTIONS 六动词全集（v0 不细分）；exp 由 gateway 时钟 + ttl 计算；
 * nonce 唯一性由调用方注入的 makeNonce 保证（缺省 randomUUID）。
 * claims 非法（空单号/坏 ttl）→ gateway.issue 抛 CONFIG_INVALID（fail-closed 上抛）。
 */
export function mintWorkerKey(
  gateway: Gateway,
  input: { ticket: TicketId; ttl?: string; makeNonce?: () => string },
): MintedWorkerKey {
  const nonce = input.makeNonce !== undefined ? input.makeNonce() : randomUUID()
  const token = gateway.issue({
    ticket: input.ticket,
    scope: [...GATEWAY_ACTIONS],
    ttl: input.ttl ?? WORKER_WKEY_TTL_DEFAULT,
    nonce,
  })
  return { token, nonce }
}

// ————————————————————————— 注入（env 通道） —————————————————————————

/**
 * workerKeyCredentials —— launch 前把 token 包装成 TaskBrief.credentials（contract v1.4）。
 * 适配器无条件透传进子进程 env（红名单：值不记录不打印）；token 本体自此只活在
 * TaskBrief 对象与子进程 env 里——daemon 侧不留副本（审计锚=DISPATCH note 携 nonce）。
 */
export function workerKeyCredentials(token: string): Record<string, string> {
  return { [WORKER_WKEY_ENV_KEY]: token }
}

// ————————————————————————— 任务书指引 —————————————————————————

/**
 * workerKeyGuidance —— 任务书（brief.md）追加的一行指引：告诉 worker 凭据已在环境变量、
 * 怎么用（studio-tools MCP initialize `_meta['studio-wkey']` 或读 env）、失效口径（关单即
 * 吊销）。「怎么调」的细节归 MCP schema（24-§二）——本行只指路不复述协议，不含凭据值。
 */
export function workerKeyGuidance(): string {
  return (
    `- 平台写入凭据（wkey）：已注入环境变量 \`${WORKER_WKEY_ENV_KEY}\`（本工位子进程 env），` +
    `经 studio-tools MCP 的 initialize 参数 \`_meta['studio-wkey']\` 注入使用；关单即吊销（17-§7），过期/吊销后不得再写平台。`
  )
}

/**
 * 吊销一单的 worker key（终局面：CLOSE——交付归档后不再重派，吊销安全；DEV-46 起
 * 熔断**不**再吊销：冷却后半开试探要重签新 key，ticket 级吊销会令试探 key 出生即死）。
 * env 通道下凭据本体已随子进程终结离场——吊销封死的是 TTL 兜底面（nonce 单次有效）。
 * 130-P3 自 engine.ts 相位缝拆出（20-§十五「先拆再增」）；未注入面=false 不吊销。
 */
export function revokeWorkerKey(workerKeys: WorkerKeyDeps | undefined, ticket: TicketId): boolean {
  if (workerKeys === undefined) return false
  workerKeys.gateway.revoke(ticket)
  return true
}
