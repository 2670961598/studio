/**
 * worker-key —— worker 级 wkey 生命周期接线件（docs/17-§7「wkey 按单签发、关单吊销」的 daemon 侧闭环）
 *
 * 生命周期（与 engine 相位对应；engine.ts 调用点）：
 *   - 签发（dispatch 相位，launch 前）：mintWorkerKey——scope=GATEWAY_ACTIONS 六动词全集
 *     （v0 不细分；细分化按动作词走批示）；nonce 经 makeNonce 注入（缺省 randomUUID，
 *     一 attempt 一 key——nonce 链干净）。
 *   - 注入（launch 前）：writeWorkerKeyFile——写 `<workspace>/.studio-next/wkey`（0600，
 *     目录 0700）；关单/收割失败后 removeWorkerKeyFile。
 *   - 吊销（终局面才吊销）：CLOSE / 断路熔断 = gateway.revoke(ticket)（同单全部 key
 *     立即失效，先于过期/重放判定）+ 删文件。
 *
 * 【吊销粒度裁决】（本单拟稿待批——与任务书「GATE_FAIL 旧 key 吊销+重签」的偏差如实声明）：
 *   冻结的 revoke(ticket) 是 **ticket 级终局动作**（authority 无 per-key 吊销、无解吊销面，
 *   packages/gateway/wkey.ts）——一旦吊销，同 ticket 此后再签的 key 也死。若在 GATE_FAIL
 *   （将重派）时吊销，重签给下一 attempt worker 的 key 出生即死（结构性矛盾）。故：
 *     - GATE_FAIL / 派发失败（非终局，会重派重试）：**只删文件**（凭据离场）——旧 key
 *       失效兜底 = TTL + nonce 单次有效；新 key 照常可用（一 attempt 一 key，nonce 链干净）。
 *     - CLOSE / 断路熔断（终局，不再有同 ticket 重签面）：吊销 + 删文件。
 *   per-key（nonce 级）吊销需 gateway 包扩 authority API（走批示，非本单可动）；本单将该
 *   偏差作为疑点上报。
 *
 * 【通道选型裁决】（本单拟稿待批）：
 *   - TaskBrief 无 wkey 字段（contract 冻结面不碰）——注入走 **workspace 文件通道**：
 *     daemon 在 launch 前把凭据写进 worker 的工作目录，四家 executor（dsh/claude/codex/kimi）
 *     通吃（均以 workspace 为工作目录）。备选方案的排除理由：
 *       a. execa env 直传最干净，但 TaskBrief 不带 env 字段（扩字段=动 contract 走批示）；
 *       b. 适配器 agentsMdEnv 式私约扩展在 packages/adapters——纪律「只动 apps/daemon」不许碰；
 *       c. 文件通道零契约变更（本单采用）；env 直传若批示通过，切换点=engine launch 前的
 *          writeWorkerKeyFile 调用（token 生成面不变）。
 *   - 文件内容 = 一行 `STUDIO_TOOLS_WKEY=<token>`（env 赋值形态——与 studio-tools 宿主直注
 *     键名对齐，packages/studio-tools/README「STUDIO_TOOLS_WKEY env 直注」接缝）；worker 侧
 *     按此行注入 MCP initialize `_meta['studio-wkey']` 或导出 env。readWorkerKeyFile 兼容
 *     裸 token 行（宽松读、严格写）。
 *   - 指引注入：任务书（brief.md）追加一行 workerKeyGuidance（AGENTS.md 是六层组装产物，
 *     追加会破层定界纯净度——engine.ts 落盘点拼 brief 文本）。
 *
 * 【TTL 拟稿】缺省 24h：主失效面是关单吊销，TTL 只是兜底（进程崩溃丢内存吊销集时凭据
 *   仍会自然过期）。阈值改动走批示。
 *
 * 【吊销可见性疑点】（上报，非本单可解）：gateway.revoke 记在**签发实例的内存 authority**
 *   （wkey.ts「已见 nonce/吊销集合均在内存（拟稿：生产换 store）」）。worker 侧验签实例与
 *   签发实例**同进程共享同一 Gateway 对象**时吊销即时生效（测试/demo 即此形态，本单 e2e
 *   钉死）；跨进程（stdio MCP 各起进程）时吊销不可见——teeth 依赖 authority 落 store
 *   （gateway 包挂账的后续单），本单只动 apps/daemon 不碰 packages/*。
 *
 * 纪律：只 import 不改 packages/*；时钟/nonce 全注入；本模块盘 IO 仅限 workspace 内
 * `.studio-next/` 目录（daemon 是 worker 工位的装配者，17-§5 同款边界）。
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { TicketId } from '@studio-next/contract'
import type { Gateway } from '@studio-next/gateway'

// ————————————————————————— 常量（拟稿定名，待批示） —————————————————————————

/** workspace 内的框架私有目录（wkey 文件的家；权限 0700） */
export const WORKER_WKEY_DIR = '.studio-next'

/** wkey 文件名（workspace 相对）：`<workspace>/.studio-next/wkey` */
export const WORKER_WKEY_FILENAME = 'wkey'

/** 文件内的 env 赋值键名（与 studio-tools 宿主直注键名同一张表，README 接缝） */
export const WORKER_WKEY_ENV_KEY = 'STUDIO_TOOLS_WKEY'

/** 缺省 TTL（拟稿：24h——关单吊销是主失效面，TTL 是兜底；见头注） */
export const WORKER_WKEY_TTL_DEFAULT = '24h'

/** wkey 文件路径（workspace → 绝对路径） */
export function workerKeyFilePath(workspace: string): string {
  return path.join(workspace, WORKER_WKEY_DIR, WORKER_WKEY_FILENAME)
}

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

// ————————————————————————— 注入（文件通道） —————————————————————————

/**
 * writeWorkerKeyFile —— launch 前把 token 写进 workspace（0600，目录 0700）。
 * chmodSync 强制精确权限（mkdir/write 的 mode 受进程 umask 影响，显式 chmod 不受）。
 * 返回文件绝对路径（engine 记账/关单删除用）。
 */
export function writeWorkerKeyFile(workspace: string, token: string): string {
  const filePath = workerKeyFilePath(workspace)
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  writeFileSync(filePath, `${WORKER_WKEY_ENV_KEY}=${token}\n`, { mode: 0o600 })
  chmodSync(filePath, 0o600)
  return filePath
}

/**
 * readWorkerKeyFile —— worker 侧消费面（读回 token）。
 * 兼容两种形态：`STUDIO_TOOLS_WKEY=<token>` 赋值行 / 裸 token 行（宽松读）。
 * 文件缺失/空/全空白 → undefined（fail-closed：读不到凭据=没有凭据，不猜）。
 */
export function readWorkerKeyFile(workspace: string): string | undefined {
  const filePath = workerKeyFilePath(workspace)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const line = raw.trim()
  if (line === '') return undefined
  const prefix = `${WORKER_WKEY_ENV_KEY}=`
  return line.startsWith(prefix) ? line.slice(prefix.length) : line
}

/**
 * removeWorkerKeyFile —— 删 wkey 文件（关单/收割失败后；幂等：缺失不抛）。
 * 入参是 writeWorkerKeyFile 返回的绝对路径（engine 的 liveWorkerKeys 记账值）。
 */
export function removeWorkerKeyFile(filePath: string): void {
  rmSync(filePath, { force: true })
}

// ————————————————————————— 任务书指引 —————————————————————————

/**
 * workerKeyGuidance —— 任务书（brief.md）追加的一行指引：告诉 worker 从哪读凭据、
 * 怎么用（studio-tools MCP initialize `_meta['studio-wkey']`）、失效口径（关单即吊销）。
 * 「怎么调」的细节归 MCP schema（24-§二）——本行只指路不复述协议。
 */
export function workerKeyGuidance(workspace: string): string {
  return (
    `- 平台写入凭据（wkey）：从 \`${workerKeyFilePath(workspace)}\` 读一行 \`${WORKER_WKEY_ENV_KEY}=<token>\`，` +
    `经 studio-tools MCP 的 initialize 参数 \`_meta['studio-wkey']\` 注入使用；关单即吊销（17-§7），过期/吊销后不得再写平台。`
  )
}
