/**
 * stop-channel —— 控制面停机通道（CLI `studio-next stop` ↔ daemon，文件协议）
 *
 * 动机（DEV-9 P1 顺带项，2026-10-19 生产事故处置）：daemon 以 `nohup sh -c "…"` 双层壳
 * 起进程，运维 kill 壳（外层 sh）后 node 子进程存活成孤儿——kill 壳未杀孙。停机改走
 * daemon 自身优雅停（runtime.stop：停唤起源 → 在途 drain → engine.dispose() 对 worker
 * 整树 SIGTERM→SIGKILL），运维经控制面文件请求，不再依赖进程树外部信号猜 PID。
 *
 * 协议与 reload 手动通道同款（src/control/hot-reload.ts 控制面文件通道；拍边界纪律 docs/38-§2）：
 *   CLI：writeStopRequest（tmp+rename 原子写）→ awaitStopResult（轮询至 id 匹配）
 *   daemon：拍边界读请求（hotReload.check() 之后——停机前先把积压 reload 应答掉）→
 *           置停机标 → 主循环退出 → 优雅停收口 → writeStopResult 回执落盘
 *   幂等（DEV-41 修复，2026-10-20 daemon-taiga6 一拍自停事故——旧口径「请求文件不删 +
 *   lastSeenId 内存去重」在 daemon 重启后失忆：残留请求被当新请求消费，新进程起一拍即
 *   自我停机；应急曾是清 control 目录重启）：
 *     ① 去重位落 daemon_kv（键 STOP_LAST_SEEN_KV_KEY）——重启读回，与请求 id 比对去重；
 *     ② 请求消费后原子改名 .consume——live 面清空，新进程见无请求即正常起（消费件留档
 *       =最近一次已应答请求，单文件覆写有界不堆积）。
 *   回执文件**保留**：CLI 轮询按 id 匹配 stop.result.json、不读请求文件——②消费不碍
 *   兼容；旧回执不误读，重发请求（新 id）再得新回执。
 *
 * PORT-OPS 落口（IMPL-06-04 / G-PORT-OPS）：文件协议之外，本件同时是 `emergencyStop`／
 * `circuitBreak` 的**记录/证据面**落口——REC-WORK-18 紧急止损记录（服务端见文件末节；
 * 零事实源读写：记录写口经 `appendRecord` 注入；未授权/形状缺/写口失败一律 fail-closed）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  BreakReceipt,
  BreakTarget,
  CallContext,
  CircuitBreakRequest,
  EmergencyReview,
  EmergencyStopRequest,
  FailureCategory,
  FenceDeclaration,
  OpsAuthorization,
  PortFailure,
  PortResult,
  ReconcileHandle,
  Signature,
  StopReceipt,
} from '@studio-next/contract'
import { controlDirOf } from './hot-reload.ts'

export const STOP_REQUEST_FILE = 'stop.request.json'
export const STOP_RESULT_FILE = 'stop.result.json'
/**
 * 消费后的请求文件名（DEV-41 ②：live 请求原子改名至此——新进程见无 live 请求即正常起；
 * 留档=最近一次已应答请求，单文件覆写有界）。CLI 不读请求文件（只轮询回执按 id 匹配），
 * live 面清空不碍兼容。
 */
export const STOP_REQUEST_CONSUMED_FILE = `${STOP_REQUEST_FILE}.consume`
/**
 * 停机请求去重位的 daemon_kv 键（DEV-41 ①：lastSeenId 落台账跨重启——serve.ts 消费时先
 * 落 kv 再改名，重启读回与请求 id 比对；与 engine 的 'activity.cursor' / 'tick.seq' 同表
 * 同命名法，见 packages/store migrations v4）。
 */
export const STOP_LAST_SEEN_KV_KEY = 'stop.lastSeenId'

/** stop 请求（CLI 写；reason=运维口径的停机事由，随回执透传） */
export interface StopRequest {
  id: string
  requestedAt: number
  reason?: string
}

/** stop 回执（daemon 写；ok+stopped=true=优雅停收口完成；CLI 轮询至 id 匹配） */
export interface StopResult {
  id: string
  ok: boolean
  stopped: boolean
  reason?: string
  detail?: string
}

/** CLI 侧：原子写请求（tmp+rename——daemon 读到的恒是完整 JSON） */
export function writeStopRequest(rootDir: string, request: StopRequest): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, STOP_REQUEST_FILE)
  const tmp = `${target}.tmp-${request.id}`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** daemon 侧：读请求（无文件/坏 JSON → undefined——控制面文件坏不当停机，下拍再看） */
export function readStopRequest(rootDir: string): StopRequest | undefined {
  const target = path.join(controlDirOf(rootDir), STOP_REQUEST_FILE)
  if (!existsSync(target)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<StopRequest>
    if (typeof parsed.id !== 'string' || parsed.id === '') return undefined
    return {
      id: parsed.id,
      requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0,
      ...(typeof parsed.reason === 'string' && parsed.reason !== '' ? { reason: parsed.reason } : {}),
    }
  } catch {
    return undefined
  }
}

/** daemon 侧：写回执（原子写；CLI 按 id 匹配消费——在优雅停收口**之后**落） */
export function writeStopResult(rootDir: string, result: StopResult): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, STOP_RESULT_FILE)
  const tmp = `${target}.tmp-${result.id}`
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/**
 * daemon 侧：消费请求（DEV-41 ②，2026-10-20 daemon-taiga6 事故修复）——决定应答停机请求
 * 时把 live 请求原子改名 .consume（POSIX rename 语义：目标已存在则原子替换——留档恒为
 * 最近一次已应答请求，有界）。改名后 live 面清空：daemon 重启见无请求即正常起，不再起一
 * 拍自停。调用序（serve.ts）：**先**落 ①daemon_kv 去重位**再**本函数——改名前崩溃的窗口
 * 由 kv 读回去重兜底。返回是否成功：失败（并发覆写/fs 异常）不阻断停机——去重已在 kv。
 */
export function consumeStopRequest(rootDir: string): boolean {
  const dir = controlDirOf(rootDir)
  try {
    renameSync(path.join(dir, STOP_REQUEST_FILE), path.join(dir, STOP_REQUEST_CONSUMED_FILE))
    return true
  } catch {
    return false
  }
}

/** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢；提示见命令面） */
export async function awaitStopResult(rootDir: string, id: string, timeoutMs: number, pollMs = 100): Promise<StopResult | undefined> {
  const target = path.join(controlDirOf(rootDir), STOP_RESULT_FILE)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<StopResult>
        if (parsed.id === id) {
          return {
            id: parsed.id as string,
            ok: parsed.ok === true,
            stopped: parsed.stopped === true,
            ...(parsed.reason !== undefined ? { reason: String(parsed.reason) } : {}),
            ...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}),
          }
        }
      } catch {
        // 坏 JSON/读到写一半：下轮再读（daemon 侧原子写使本分支近不可达——兜底不炸）
      }
    }
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

// ————————————————————————— PORT-OPS 落口（IMPL-06-04 / G-PORT-OPS） —————————————————————————
//
// 依据：docs/plan/05 IMPL-06-04（emergencyStop/circuitBreak 落口=REC-WORK-18 记录/证据面）；
// docs/v2/14 §1.8（PORT-OPS；供能链 PORT-AUTH→PORT-OPS 单向，自身不新增权源）；docs/v2/11
// §六 REC-WORK-18（trigger/boundary_ref/actions_taken/not_authorized/evidence_preserved/
// notified/independent_review/effect_on_original）；docs/v2/15 §二 SEC-SIG-01（署名三值）。
//
// 定位：本件是 PORT-OPS 在控制面的**记录/证据面落口**——把止损/围栏请求落成 REC-WORK-18
// 记录草案并回执；不执行进程终止、不裁决权源、不私设台账（记录写口经 appendRecord 注入，
// 生产侧接 PORT-HIST 写口）。真实动作面（停注入/杀树/吊销）与其回执归后续单：本件只证
// 「记录已登记」，不证「已停」。
//
// fail-closed 三闸（任一不过＝Err：无记录、无回执、放行路径不存在）：
//   ① 供能闸：authorization 缺失/来源不明/policy verdict≠permitted/引用空白 → rejected_authority；
//   ② 署名闸：CallContext 缺、公司维/caller 空白、control 缺 decisionRef、system 缺 onBehalfOf
//      （SEC-FC-06）→ rejected_authority；
//   ③ 记录闸：REC-WORK-18 必填面缺（not_authorized 空集/notified 匿名/复核自审/无预设边界
//      缺升级引用/围栏空集）→ rejected_precondition；记录写口失败或抛出 → unavailable
//      （sideEffectPossible=true＋reconcile——不冒 Ok）。
// 结果不明独立标记：记录面 outcome 恒 'unknown'＋reconcile（不压成布尔「已停/未停」；
// 执行确认走 break/stop 回执与独立复核）。circuitBreak 请求形状无 notified/independent_review
// 槽位 → 记录以 gaps 显式缺口（不臆造具名位置），复核/通知归 v2/14 提案补形。

/** 记录面动作（端口形状无「实际处置动作」槽——记录只证登记动作，见各记录 gaps） */
const OPS_RECORD_FACE_ACTION = '登记 REC-WORK-18 止损记录（记录/证据面）'

/** 匿名责任者名单（v2/11 §六：receiver 必填具名位置，不得为「框架/系统/公司」——I-11） */
const ANONYMOUS_ACTORS: readonly string[] = ['框架', '系统', '公司', 'daemon', 'framework', 'system']

/** REC-WORK-18.effect_on_original 三枚 false（不追认原动作、不等于恢复、不推广为常态） */
const EFFECT_ON_ORIGINAL = {
  retroactiveApproval: false,
  equalsRecovery: false,
  normalizable: false,
} as const

/** REC-WORK-18 记录草案（端口形状→记录形状；字段名对齐 docs/v2/11 §六） */
export interface OpsStopRecord {
  readonly recordType: 'REC-WORK-18'
  readonly recordId: string
  readonly version: 1
  readonly company: string
  readonly at: string
  readonly kind: 'emergency_stop' | 'circuit_break'
  readonly reason: string
  readonly authorizationRef: string
  readonly trigger: string
  /** 预设紧急边界引用；null＝无预设边界（只允许不进入禁止/保留权限的保全与升级） */
  readonly boundaryRef: string | null
  readonly actionsTaken: readonly [string, ...string[]]
  /** 明确未做的事（空集不得冒充「未越权」——REC-WORK-18 判定条件） */
  readonly notAuthorized: readonly [string, ...string[]]
  readonly evidencePreserved: readonly string[]
  readonly notified: readonly string[]
  /** 事后独立复核；undefined＝请求形状无复核槽位（gaps 记缺口，不臆造具名位置） */
  readonly review: { readonly position: string; readonly due: string; readonly conclusion: string } | undefined
  readonly effectOnOriginal: typeof EFFECT_ON_ORIGINAL
  readonly outcome: 'unknown'
  /** 记录面显式缺口（不完整项逐条列，不以「已记录」一句覆盖） */
  readonly gaps: readonly string[]
  readonly signature: Signature
}

/** PORT-OPS 落口依赖（全注入；本件零事实源读写） */
export interface OpsLandingDeps {
  /** 铸记录 ID（生产=ULID；测试=确定性序列） */
  readonly makeId: () => string
  /** 记录时刻（ISO；注入时钟——不读墙钟） */
  readonly now: () => string
  /** REC-WORK-18 记录落地（生产=PORT-HIST 写口）：抛出＝未落地 → fail-closed，不冒 Ok */
  readonly appendRecord: (record: OpsStopRecord) => void
}

/** PORT-OPS 落口面（OperationsPort 的 control 实现；两方法均先过三闸再落记录） */
export interface OpsLanding {
  emergencyStop(req: EmergencyStopRequest, ctx: CallContext): PortResult<StopReceipt>
  circuitBreak(req: CircuitBreakRequest, ctx: CallContext): PortResult<BreakReceipt>
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const okOf = <T>(value: T): PortResult<T> => ({ kind: 'ok', value })
const errOf = (failure: PortFailure): PortResult<never> => ({ kind: 'err', error: failure })

/** 分类失败（v2/11 §0.4-6：Err 必答副作用可能/可否重试/对账入口/责任位置） */
function opsFailure(
  category: FailureCategory,
  subcause: string,
  detail: string,
  reconcile: ReconcileHandle,
  extra: { retryable?: boolean; sideEffectPossible?: boolean; responsiblePosition?: string } = {},
): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: extra.retryable ?? false,
    sideEffectPossible: extra.sideEffectPossible ?? false,
    reconcile,
    responsiblePosition: extra.responsiblePosition ?? '控制面停止通道（现场责任主体）',
  }
}

/** 供能闸（PORT-AUTH→PORT-OPS 单向：只收已核验政策结论或具名决定；缺省/异源＝拒） */
type AuthCheck = { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly why: string }

function checkAuthorization(auth: OpsAuthorization | undefined): AuthCheck {
  if (auth === undefined || auth === null || typeof auth !== 'object') {
    return { ok: false, why: 'authorization 缺失（PORT-OPS 只由 PORT-AUTH 供能，自身不新增权源）' }
  }
  const a = auth as { poweredBy?: unknown; commandRef?: unknown; verdict?: unknown; decisionRef?: unknown }
  if (a.poweredBy === 'policy_verdict') {
    if (a.verdict !== 'permitted') return { ok: false, why: `政策结论非 permitted（${String(a.verdict)}）` }
    const ref = textOf(a.commandRef)
    return ref === '' ? { ok: false, why: 'policy_verdict 缺 commandRef' } : { ok: true, ref }
  }
  if (a.poweredBy === 'decision') {
    const ref = textOf(a.decisionRef)
    return ref === '' ? { ok: false, why: 'decision 缺 decisionRef' } : { ok: true, ref }
  }
  return { ok: false, why: `供能来源不明（${String(a.poweredBy)}；只收 policy_verdict|decision）` }
}

/** 署名/公司维闸（SEC-SIG-01 同构造口径：system 缺 onBehalfOf 即非法；公司维必带） */
type CtxCheck =
  | { readonly ok: true; readonly company: string; readonly signature: Signature; readonly callerId: string }
  | { readonly ok: false; readonly why: string }

function checkContext(ctx: CallContext): CtxCheck {
  if (ctx === undefined || ctx === null || typeof ctx !== 'object') return { ok: false, why: 'CallContext 缺失' }
  const company = textOf(ctx.company?.slug) !== '' ? textOf(ctx.company.slug) : textOf(ctx.company?.companyId)
  if (company === '') return { ok: false, why: '公司维缺失（SEC-WD-01）' }
  const callerId = textOf(ctx.caller?.callerId)
  if (callerId === '') return { ok: false, why: 'caller 缺失（权源主张者不可匿名）' }
  const sig = ctx.signature as unknown
  if (sig === undefined || sig === null || typeof sig !== 'object') return { ok: false, why: '署名缺失（SEC-SIG-01）' }
  const s = sig as { actorKind?: unknown; actorRef?: unknown; onBehalfOf?: unknown; decisionRef?: unknown }
  if (textOf(s.actorRef) === '') return { ok: false, why: '署名 actorRef 空白' }
  if (s.actorKind === 'system' && textOf(s.onBehalfOf) === '') {
    return { ok: false, why: 'system 署名缺 onBehalfOf（SEC-FC-06/SEC-SIG-01）——代写须可还原决定人' }
  }
  if (s.actorKind === 'control' && textOf(s.decisionRef) === '') return { ok: false, why: 'control 署名缺 decisionRef' }
  if (s.actorKind !== 'person' && s.actorKind !== 'control' && s.actorKind !== 'system') {
    return { ok: false, why: `署名主体未知（${String(s.actorKind)}）` }
  }
  return { ok: true, company, signature: ctx.signature, callerId }
}

/** 具名引用清单闸（notified/evidence_preserved 共用；notified 额外拒匿名责任者） */
function namedListProblem(items: unknown, what: string, opts: { minOne: boolean; rejectAnonymous: boolean }): string | undefined {
  if (!Array.isArray(items)) return `${what} 非数组`
  if (opts.minOne && items.length === 0) return `${what} 为空——须逐项具名（空集不得冒充「无越权/已通知」）`
  for (const item of items as readonly unknown[]) {
    const v = textOf(item)
    if (v === '') return `${what} 含空白项`
    if (opts.rejectAnonymous && ANONYMOUS_ACTORS.includes(v.toLowerCase())) {
      return `${what} 含匿名责任者「${v}」（须具名位置/工号——I-11）`
    }
  }
  return undefined
}

/** 平台触达申报闸：有平台写＝必申报控制面动作（ctl- 词族；op 借道须降级标记） */
function touchProblem(touch: { requiresPlatformWrite?: unknown; declaration?: unknown } | undefined): string | undefined {
  if (touch === undefined || touch === null) return 'requiresPlatformWrite 缺失（PORT-OPS 每次操作须显式声明平台触达）'
  if (touch.requiresPlatformWrite === true) {
    const decl = touch.declaration as { action?: unknown; degradedBypass?: unknown } | undefined
    if (decl === undefined || typeof decl.action !== 'string' || decl.action === '') return 'requiresPlatformWrite=true 但缺控制面动作申报'
    if (decl.action === 'op') {
      return decl.degradedBypass === 'ledger_marked' ? undefined : 'op 借道须显式降级标记 degradedBypass=ledger_marked（ENU-119）'
    }
    return decl.action.startsWith('ctl-') ? undefined : `控制面动作只收 ctl- 词族（收到 ${decl.action}）——transition 不得显示为 comment`
  }
  if (touch.requiresPlatformWrite === false) {
    return touch.declaration === undefined ? undefined : '无平台写却携控制面动作申报（申报与实文不一致）'
  }
  return 'requiresPlatformWrite 非布尔'
}

/** 紧急边界闸（两态：预设边界内先行；无预设＝只能不进入禁止/保留权限的保全与升级） */
function boundaryProblem(boundary: EmergencyStopRequest['boundary']): string | undefined {
  if (boundary === undefined || boundary === null) return 'boundary 缺失（须显式两态）'
  if (boundary.preset === true) {
    if (textOf(boundary.boundaryRef) === '') return '预设边界缺 boundaryRef'
    const permitted = boundary.permittedActions
    return Array.isArray(permitted) && permitted.length > 0 ? undefined : '预设边界缺 permittedActions（边界内可做的事须列全）'
  }
  if (boundary.preset === false) {
    if (textOf(boundary.escalationRef) === '') return '无预设边界须携 escalationRef（只能保全与升级）'
    return boundary.prohibitedAmplification === true ? undefined : '无预设边界须显式 prohibitedAmplification=true'
  }
  return 'boundary.preset 非布尔'
}

/** 独立复核闸（REC-WORK-18：位置/期限必填；复核者＝现场责任主体＝自审拒） */
function reviewProblem(review: EmergencyReview | undefined, check: { signature: Signature; callerId: string }): string | undefined {
  if (review === undefined || review === null) return 'independent_review 缺失（REC-WORK-18 必填）'
  const position = textOf(review.reviewerRef)
  if (position === '') return 'independent_review.reviewerRef 空白（复核须具名位置）'
  const signature = check.signature as unknown as { actorRef?: unknown; onBehalfOf?: unknown }
  const responsible = [textOf(signature.actorRef), textOf(signature.onBehalfOf), check.callerId]
  if (responsible.includes(position)) return '复核者=现场责任主体（自审）——独立复核须独立于现场责任人'
  return textOf(review.due) === '' ? 'independent_review.due 缺失（复核须有期限）' : undefined
}

/** 围栏目标闸（只引用既有工作/出工段/执行体，不新造对象） */
function breakTargetProblem(target: BreakTarget | undefined): string | undefined {
  if (target === undefined || target === null) return 'target 缺失'
  if (target.kind === 'work') return textOf(target.workRef) === '' ? 'target.workRef 空白' : undefined
  if (target.kind === 'segment') return textOf(target.segmentRef) === '' ? 'target.segmentRef 空白' : undefined
  if (target.kind === 'executor') return textOf(target.bindingRef) === '' ? 'target.bindingRef 空白' : undefined
  return `target.kind 未知（${String((target as { kind?: unknown }).kind)}）`
}

/** 围栏声明闸（scope 逐项列全；机制未证＝记录显式缺口，不得宣称已冻结） */
function fenceProblem(fence: FenceDeclaration | undefined): string | undefined {
  if (fence === undefined || fence === null) return 'fence 缺失（止损围栏须声明冻结面）'
  if (!Array.isArray(fence.scope) || fence.scope.length === 0) return 'fence.scope 为空——须逐项列全（空集不得冒充全量）'
  for (const item of fence.scope as readonly unknown[]) if (textOf(item) === '') return 'fence.scope 含空白项'
  if (typeof fence.stopInjection !== 'boolean' || typeof fence.revokeDerived !== 'boolean' || typeof fence.mechanismProven !== 'boolean') {
    return 'fence 三键必须为布尔（stopInjection/revokeDerived/mechanismProven）'
  }
  return undefined
}

/** circuitBreak 的「明确未做」清单（从围栏声明取反——不越声明范围，不追认原动作） */
function circuitNotAuthorized(fence: FenceDeclaration): readonly [string, ...string[]] {
  const items: [string, ...string[]] = ['未追认原动作（围栏声明不构成对原动作的追认）']
  if (!fence.stopInjection) items.push('未停止注入（fence.stopInjection=false）')
  if (!fence.revokeDerived) items.push('未撤销派生执行体（fence.revokeDerived=false）')
  return items
}

/** 铸记录 ID＋时戳（依赖面异常＝fail-closed；不裸抛——落分类 Err） */
function stampOf(deps: OpsLandingDeps): { recordId: string; at: string } | undefined {
  try {
    return { recordId: deps.makeId(), at: deps.now() }
  } catch {
    return undefined
  }
}

/** 记录落地（写口失败＝fail-closed；写口成功后回执才成立） */
function landRecord(deps: OpsLandingDeps, record: OpsStopRecord): string | undefined {
  try {
    deps.appendRecord(record)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const RECONCILE_NONE = { required: false, reason: '未授权/前置不成立：未执行任何动作，无副作用需对账' } as const

/** 建 PORT-OPS 落口（一引擎/一 CLI 进程一实例；零内部状态） */
export function createOpsLanding(deps: OpsLandingDeps): OpsLanding {
  return {
    emergencyStop(req: EmergencyStopRequest, ctx: CallContext): PortResult<StopReceipt> {
      const auth = checkAuthorization(req?.authorization)
      if (!auth.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-unauthorized', `PORT-OPS.emergencyStop 未授权：${auth.why}`, RECONCILE_NONE))
      }
      const context = checkContext(ctx)
      if (!context.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-signature-invalid', `PORT-OPS.emergencyStop 署名/公司维不成立：${context.why}`, RECONCILE_NONE))
      }
      const problem =
        (textOf(req.reason) === '' ? 'reason 缺失（匿名处置不成立）' : undefined) ??
        (textOf(req.triggerRef) === '' ? 'triggerRef 缺失（止损须引触发记录）' : undefined) ??
        boundaryProblem(req.boundary) ??
        namedListProblem(req.notAuthorized, 'not_authorized', { minOne: true, rejectAnonymous: false }) ??
        namedListProblem(req.notified, 'notified', { minOne: true, rejectAnonymous: true }) ??
        namedListProblem(req.evidencePreserved, 'evidence_preserved', { minOne: false, rejectAnonymous: false }) ??
        reviewProblem(req.review, context) ??
        touchProblem(req)
      if (problem !== undefined) {
        return errOf(opsFailure('rejected_precondition', 'ops-record-invalid', `REC-WORK-18 不成立：${problem}`, RECONCILE_NONE))
      }
      const stamp = stampOf(deps)
      if (stamp === undefined) {
        return errOf(opsFailure('unavailable', 'ops-stamp-failed', 'PORT-OPS.emergencyStop 记录标识/时戳铸造失败（fail-closed）', RECONCILE_NONE, { retryable: true }))
      }
      const { recordId, at } = stamp
      const review = req.review
      const reviewConclusion = textOf(review.conclusion) === '' ? `未完成（复核期限 ${review.due}，由 ${review.reviewerRef} 独立作出）` : textOf(review.conclusion)
      const record: OpsStopRecord = {
        recordType: 'REC-WORK-18',
        recordId,
        version: 1,
        company: context.company,
        at,
        kind: 'emergency_stop',
        reason: req.reason,
        authorizationRef: auth.ref,
        trigger: req.triggerRef,
        boundaryRef: req.boundary.preset ? req.boundary.boundaryRef : null,
        actionsTaken: [OPS_RECORD_FACE_ACTION],
        notAuthorized: req.notAuthorized,
        evidencePreserved: req.evidencePreserved,
        notified: req.notified,
        review: {
          position: review.reviewerRef,
          due: review.due,
          // 结论未给＝复核未完成（显式待办标记，不臆造结论；补结论归复核记录，不覆写本事件）
          conclusion: reviewConclusion,
        },
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        gaps: ['actions_taken：端口形状无处置动作槽——本记录只证登记动作，实际保全/通知动作由执行面回填（v2/14 提案补形）'],
        signature: context.signature,
      }
      const failure = landRecord(deps, record)
      if (failure !== undefined) {
        return errOf(
          opsFailure('unavailable', 'ops-record-unlanded', `REC-WORK-18 记录未落地（写口异常）：${failure}`, {
            required: true,
            query: { recordType: 'REC-WORK-18', keys: { recordId } },
          }, { retryable: true, sideEffectPossible: true, responsiblePosition: '台账写口（PORT-HIST）' }),
        )
      }
      return okOf({
        recordId,
        version: 1,
        actionsTaken: record.actionsTaken,
        notAuthorized: record.notAuthorized,
        evidencePreserved: record.evidencePreserved,
        notified: req.notified,
        review: review.conclusion === undefined ? { reviewerRef: review.reviewerRef, due: review.due } : { reviewerRef: review.reviewerRef, due: review.due, conclusion: review.conclusion },
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        reconcile: { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId } } },
      })
    },

    circuitBreak(req: CircuitBreakRequest, ctx: CallContext): PortResult<BreakReceipt> {
      const auth = checkAuthorization(req?.authorization)
      if (!auth.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-unauthorized', `PORT-OPS.circuitBreak 未授权：${auth.why}`, RECONCILE_NONE))
      }
      const context = checkContext(ctx)
      if (!context.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-signature-invalid', `PORT-OPS.circuitBreak 署名/公司维不成立：${context.why}`, RECONCILE_NONE))
      }
      const problem =
        (textOf(req.reason) === '' ? 'reason 缺失（匿名处置不成立）' : undefined) ??
        (textOf(req.triggerRef) === '' ? 'triggerRef 缺失（止损须引触发记录；观察事件不构成止损权源）' : undefined) ??
        breakTargetProblem(req.target) ??
        fenceProblem(req.fence) ??
        touchProblem(req)
      if (problem !== undefined) {
        return errOf(opsFailure('rejected_precondition', 'ops-record-invalid', `止损围栏不成立：${problem}`, RECONCILE_NONE))
      }
      const stamp = stampOf(deps)
      if (stamp === undefined) {
        return errOf(opsFailure('unavailable', 'ops-stamp-failed', 'PORT-OPS.circuitBreak 记录标识/时戳铸造失败（fail-closed）', RECONCILE_NONE, { retryable: true }))
      }
      const recordId = stamp.recordId
      const fence = req.fence
      const record: OpsStopRecord = {
        recordType: 'REC-WORK-18',
        recordId,
        version: 1,
        company: context.company,
        at: stamp.at,
        kind: 'circuit_break',
        reason: req.reason,
        authorizationRef: auth.ref,
        trigger: req.triggerRef,
        boundaryRef: null,
        actionsTaken: [OPS_RECORD_FACE_ACTION],
        notAuthorized: circuitNotAuthorized(fence),
        evidencePreserved: [],
        notified: [],
        review: undefined,
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        gaps: [
          'circuit_break 分型：请求形状无 notified/independent_review/evidence_preserved 槽位——显式缺口，不臆造具名位置（复核/通知归 v2/14 提案补形）',
          '无预设紧急边界（fence 是围栏声明，不是 emergency boundary）——只登记保全与升级，不进入禁止/保留权限',
          'actions_taken：端口形状无处置动作槽——本记录只证登记动作',
          ...(fence.mechanismProven ? [] : ['围栏机制未证（mechanismProven=false）——不得宣称旧写入者已被冻结']),
        ],
        signature: context.signature,
      }
      const failure = landRecord(deps, record)
      if (failure !== undefined) {
        return errOf(
          opsFailure('unavailable', 'ops-record-unlanded', `REC-WORK-18 记录未落地（写口异常）：${failure}`, {
            required: true,
            query: { recordType: 'REC-WORK-18', keys: { recordId } },
          }, { retryable: true, sideEffectPossible: true, responsiblePosition: '台账写口（PORT-HIST）' }),
        )
      }
      return okOf({
        recordId,
        stopped: [],
        fence: { scope: fence.scope, stopInjection: fence.stopInjection, revokeDerived: fence.revokeDerived, mechanismProven: fence.mechanismProven },
        residual: [],
        outcome: 'unknown',
        reconcile: { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId } } },
      })
    },
  }
}
