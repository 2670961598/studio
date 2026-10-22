/**
 * relay-resume 消费件 —— 接力/续命两 kind 的消费语义（129-§6.1⑥ 分类学收口类 / §6.5 单E，
 * studio-dev-184；六源全通 v0.8 档收口——D1「源↔kind 非一一对应」缺口就此闭合）。
 *
 * 规格依据（实现单引用）：
 *   - 129 提案 §6.5 拆单表单 E：relay/resume 源——「接力（worker 完成→『请重估单 X』幂等
 *     提示）与续命（resume 续跑）补源（docs/22 在册，C10）」；§6.4 C6 注册三件套
 *     （源件+daemon.yaml 开关+manifest）——源本体见 relay-resume-sources.ts（本文件只管
 *     消费语义，people-change 先例同分工）。
 *   - docs/22-§二 接力行（F1-11）：worker 完成→「请重估单 X」幂等提示（本机+wkey+防抖）
 *     ——轮询粒度降到秒级。续命行（F1-15）：断点续跑（resume-cmd/resume 续跑协议）。
 *   - docs/02-F1-11：接力重投零重复派发（幂等三层：拍内 drainSeen+候选去重 / 跨拍
 *     seenIntentKeys / 状态机「已派发态无前向 dispatch」最深保险）。
 *   - docs/02-F1-15 续跑协议：从 work_records 取最近一次工时单（executor+session_id）→
 *     executor 原生续跑 → 注入前情摘要（上次 summary.json，docs/17-§6 收割 GATE_PASS 时
 *     落 work_records.summary_ref）→ 新工时单挂 causation_id 链到上次；续跑不重置 attempt
 *     计数；不支持续跑的 executor 明报并降级为新派。
 *   - docs/17-§5：任务书两版（首版/续跑版——续跑版含前情摘要节）——渲染归 prompt 包
 *     renderTaskBrief('resume')（既有实现零改），本文件出装配判据（ResumeDispatchPlan）。
 *   - docs/17-§2 主循环七相位：消费走相位 2 前置意图面、派发走相位 3——不增删相位、
 *     不改收割四要件（docs/17-§6）判定。
 *   - docs/25-§3.4（invoke v1.3/v1.4）：无 ticket 意图必填 dedupKey——relay/resume 语义
 *     对象是单号，ticket 必填（缺=明报拒收，fail-closed 21-§三同纪律）。
 *
 * 语义口径（本文件冻结，随实现收口）：
 *   - relay 消费=**零物化重估**：前五类消费全物化新单（岗单/唤醒单/联动单/落单/处置单），
 *     relay 把**已有单**推回决策候选（candidates）——零平台写、零 PATROL。不落 PATROL 是
 *     设计点：PATROL 键 append-only 不释放（events-index——schedule 物化留痕语义），若
 *     relay 留痕，同键重投会被拍门永久吞掉，而接力要求「每次完成都可再触发重估」。
 *     可观测面=决策条目+动作事件（decisions/actions 落账，17-§2 tick 返回）。
 *   - relay 是加速器不是正确性依赖：意图丢失（如 daemon 重启，ingest 是内存队列）只慢
 *     不错——活动流/镜像 rescan 兜底把单照常带回决策（22-§三 解耦③）。
 *   - resume 消费=重估+续跑上下文挂载：候选照常进 decide（派不派、过不过四闸归状态机，
 *     源不越权——22-§一「没有任何源能直接驱动 worker」）；断点可解析时**另**登记拍作用域
 *     续跑计划（planResume → engine dispatchQ 携带 → executeDispatch 切续跑形）。
 *   - 降级语义（F1-15 字面）：断点不可解析（无 session 工时单/无 summary_ref/sidecar 形状
 *     不符）→ errors 明报 + **降级为普通候选**（新派好过不派——用户意志是「让 X 再被做」）；
 *     executor 不在注册表/声明 session_resume=false → 派发面明报（DISPATCH note
 *     `resume=降级新派` 锚）+走首版任务书新派——两处都可观测，不静默。
 *   - 断点解析单一事实源=work_records（F1-15 字面「从 work_records 取最近一次工时单」）；
 *     payload 不携带 executor/session 覆盖位（伪造面负向封死——session id 是 executor
 *     本地命名空间，跨家不可续，不由意图面指认）。
 *   - 拍作用域边界（诚实标注）：计划不持久化——本拍 decide 未出 dispatch（如
 *     HOLD_PERSON_BUSY 顺延）即失效，重发 resume 意图即重试（源面 at-least-once）。
 */
import { readFileSync } from 'node:fs'
import type {
  ExecutorAdapter,
  InvokeIntent,
  SummarySidecar,
  TicketId,
} from '@studio-next/contract'
import { validateSummarySidecar } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'

// ————————————————————————— 负载形状（结构校验：外部内容按不可信输入对待，21-§三） —————————————————————————

/**
 * relay 意图负载形状（129-§6.1⑥ 接力类）：纯溯源展示位——reason 只进日志/观测，不进任何
 * 判定（relay 的语义对象全在 intent.ticket，payload 无承载义务）。
 */
export interface RelayIntentPayload {
  /** 完成事实溯源（如「GATE_PASS：四要件齐」——展示性，noteSafe 归消费面外：本 payload 不落 note） */
  reason?: string
}

/** 结构校验：payload 可整体缺省（语义对象全在 intent.ticket，payload 无承载义务）；
 *  给了就得是对象且 reason 在场时为非空串 → 错误原因串；过 → 收窄为 RelayIntentPayload。
 *  未知键不拒但惰性（reason 之外的字段永不回流事件面——note 落账只走 intentKey 锚） */
export function checkRelayPayload(payload: unknown): RelayIntentPayload | string {
  if (payload === undefined) return {}
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  if (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason === '')) return 'reason 非字符串或空串'
  return payload as RelayIntentPayload
}

/**
 * resume 意图负载形状（129-§6.1⑥ 续命类）：cause=触发溯源（「重启接管」/「CLI resume」），
 * 同 relay——纯展示位。**不含** executor/session_id 覆盖位（断点解析单一事实源=work_records，
 * 见文件头注）。
 */
export interface ResumeIntentPayload {
  /** 触发溯源（展示性） */
  cause?: string
}

/** 结构校验：同 checkRelayPayload（payload 可整体缺省；cause 在场时须为串——展示位不苛长度） */
export function checkResumePayload(payload: unknown): ResumeIntentPayload | string {
  if (payload === undefined) return {}
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  if (p.cause !== undefined && (typeof p.cause !== 'string' || p.cause === '')) return 'cause 非字符串或空串'
  return payload as ResumeIntentPayload
}

// ————————————————————————— 续跑计划（F1-15 断点解析 → 派发面输入） —————————————————————————

/**
 * 续跑派发计划（拍作用域：drain 登记 → 同拍 dispatch 消费；未派发即失效——重发意图即重试）。
 * causationId=上次工时单 id（F1-15「新工时单挂 causation_id 链到上次」——DISPATCH 事件
 * causation_id 列，EventRecord 既有可选位非加列）。
 */
export interface ResumeDispatchPlan {
  /** 上次工时单 executor（原生续跑用同一家——session id 是 executor 本地命名空间） */
  executor: string
  /** 上次会话 id（work_records.session_id；launch 面走 TaskBrief.resume.sessionId） */
  sessionId: string
  /** 上次 summary.json 落点（work_records.summary_ref——收割 GATE_PASS 时落账，17-§6） */
  summaryPath: string
  /** 上次 summary sidecar（前情摘要数据源——renderTaskBrief('resume') 必填，17-§5） */
  summary: SummarySidecar
  /** 因果链锚（上次工时单 id——DISPATCH 事件 causation_id） */
  causationId: string
  /** 上次誓号（观测面：detail/note 溯源「续自第 N 誓」） */
  lastAttempt: number
}

/** 断点解析结果：计划 | 不可续原因（明报降级用——失败面恒有话说，不静默） */
export type ResumePlanOutcome = ResumeDispatchPlan | { unavailable: string }

/**
 * resolveResumePlan —— 断点解析（F1-15 字面）：work_records 取**最后一条带 session_id** 的
 * 工时单（listWorkRecords 按 started_at 升序——末位即最近；status 不筛：done/failed/
 * interrupted 的 session 在 executor 侧均可续，断点≠必须成功过）→ 读 summary_ref 落点的
 * summary.json → 过 SummarySidecarSchema（summary/v1）。
 *
 * 三不可续面（各自明报，消费 handler 降级为新派候选）：
 *   ① 无 session 工时单（单从未被派发过——无断点）；
 *   ② 有 session 无 summary_ref（上次收割没交 sidecar——前情摘要不可构造，17-§5 续跑版
 *      必带 summary，「不静默降级为首版」是 prompt 包契约，此处如实拒续）；
 *   ③ sidecar 读不出/形状不符（文件被清理或 worker 乱写——受验拒收，不猜不代写）。
 *
 * 读盘失败不 throw：断点解析的失败是**业务结果**不是配置错误（与 resolve() 抛 CONFIG_INVALID
 * 的语义不对称是有意——registry 头注同款辨析）。
 */
export function resolveResumePlan(ledger: Ledger, ticket: TicketId): ResumePlanOutcome {
  const records = ledger.listWorkRecords({ issue: ticket }).filter((r) => r.session_id !== undefined)
  const last = records.at(-1)
  if (last === undefined) {
    return { unavailable: '无断点可续（work_records 无 session 工时单——单从未被派发过，F1-15「从 work_records 取最近一次工时单」落空）' }
  }
  if (last.summary_ref === undefined) {
    return { unavailable: `上次工时单（attempt ${last.attempt}）无 summary_ref——前情摘要不可构造（收割未交 sidecar，17-§5 续跑版必带 summary）` }
  }
  let raw: string
  try {
    raw = readFileSync(last.summary_ref, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { unavailable: `summary sidecar 读不出（${last.summary_ref}：${msg}）——工位归档位可能被清理` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { unavailable: `summary sidecar 非 JSON（${last.summary_ref}）——受验拒收不猜（21-§三）` }
  }
  const verdict = validateSummarySidecar(parsed)
  if (!verdict.ok) {
    const first = verdict.issues[0]
    return { unavailable: `summary sidecar 形状不符 summary/v1（${last.summary_ref}：${first === undefined ? '(root)' : `${first.path}: ${first.message}`}）` }
  }
  return {
    executor: last.executor,
    sessionId: last.session_id as string,
    summaryPath: last.summary_ref,
    summary: parsed as SummarySidecar,
    causationId: last.id,
    lastAttempt: last.attempt,
  }
}

/**
 * pickResumeAdapter —— 派发面续跑适配器选择（engine executeDispatch 调用）：plan.executor
 * 指名解析（原生续跑用同一家）→ 命中且 session_resume=true → 续跑形；否则回退 fallback
 * （registry.pick()——engine 传入）并带降级因（明报锚——DISPATCH note `resume=降级新派`，
 * F1-15「不支持续跑的 executor 明报并降级为新派」）。resolve 落空（executor 已除名）不
 * throw：降级是业务结果（回退面），派发不因续跑失败而失败。
 *
 * registry 形参=结构面 `{ resolve() }`（ExecutorRegistry 结构满足——resolve 指名取本体；
 * 查无此名 throw CONFIG_INVALID，此处 catch 成降级因）。本文件不 import 适配器包
 * （25-§一.2 依赖方向同款纪律，taxonomy.ts 头注判负线⑦；engine 侧注入全型）。
 */
export function pickResumeAdapter(
  registry: { resolve(name: string): ExecutorAdapter },
  plan: ResumeDispatchPlan,
  fallback: ExecutorAdapter | undefined,
): { adapter: ExecutorAdapter | undefined; degradedReason?: string } {
  let registered: ExecutorAdapter | undefined
  try {
    registered = registry.resolve(plan.executor)
  } catch {
    registered = undefined // resolve 落空=CONFIG_INVALID（指名引用失败）——降级是业务结果，不外抛炸派发
  }
  if (registered === undefined) {
    return { adapter: fallback, degradedReason: `executor ${plan.executor} 不在注册表（上次工时单的执行家已除名）` }
  }
  if (!registered.capabilities.session_resume) {
    return { adapter: fallback, degradedReason: `executor ${plan.executor} 声明 session_resume=false（25-§3.1 能力声明——dsh v0 不支持原生续跑）` }
  }
  return { adapter: registered }
}

// ————————————————————————— 消费 handler 工厂 —————————————————————————

/**
 * 消费依赖（engine tick 作用域注入——taxonomy/escalate 同款：本文件零引擎内部状态持有）。
 * relay 只用 errors/candidates/drainSeen 三件；resume 另用 ledger（断点解析事实源）+
 * planResume（拍作用域计划登记面——engine 内 dispatchQ 携带到执行面）。
 */
export interface RelayResumeConsumerDeps {
  /** 断点解析事实源（resume 用；relay 零盘零账面） */
  ledger: Ledger
  /** 明报面（拒收/降级原因——tick errors） */
  errors: string[]
  /** 拍内幂等（同拍同键只消费一次） */
  drainSeen: Set<string>
  /** 决策候选（同拍一单至多一动作——engine 候选去重不变量，push 前自查） */
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  /** 续跑计划登记面（拍作用域：engine drain 段建 Map，dispatch 段消费） */
  planResume: (ticket: TicketId, plan: ResumeDispatchPlan) => void
}

/**
 * relay 消费 handler（129-E，F1-11）：「请重估单 X」——ticket 必填→payload 受验→已有候选
 * 去重→推回决策候选。零物化零 PATROL（头注设计点）；幂等三层交给引擎既有面（drainSeen/
 * seenIntentKeys/状态机——F1-11 接力重投零重复派发）。
 */
export function createRelayConsumer(
  deps: RelayResumeConsumerDeps,
): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    if (intent.ticket === undefined) {
      deps.errors.push('意图消费：relay 意图缺 ticket（重估对象不可缺——F1-11「请重估单 X」的 X）——丢弃')
      return
    }
    const checked = checkRelayPayload(intent.payload)
    if (typeof checked === 'string') {
      deps.errors.push(`意图消费：relay 意图 payload 形状不符（${checked}）——丢弃`)
      return
    }
    // 同拍一单至多一动作（17-§2）：本拍已是候选（活动/镜像/其他意图物化）的单不重复推——
    // 双候选=双 decide=双 dispatch=第二誓 fail() 误清第一誓 inflight/lane（状态腐坏），
    // 候选去重不变量由 engine affected 循环同款保护（studio-dev-184 §四-4）
    if (deps.candidates.some((c) => c.ticket === intent.ticket)) {
      deps.drainSeen.add(intentKey)
      return
    }
    deps.candidates.push({ ticket: intent.ticket, intent })
    deps.drainSeen.add(intentKey)
  }
}

/**
 * resume 消费 handler（129-E，F1-15）：ticket 必填→payload 受验→断点解析。可行：登记拍作用域
 * 续跑计划+推候选；不可行：errors 明报+**降级为普通候选**（新派好过不派——F1-15 降级语义，
 * executor 能力面的降级归派发面 pickResumeAdapter，两层降级各自明报）。
 */
export function createResumeConsumer(
  deps: RelayResumeConsumerDeps,
): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    if (intent.ticket === undefined) {
      deps.errors.push('意图消费：resume 意图缺 ticket（续跑对象不可缺——F1-15「studio resume <单号>」的单号）——丢弃')
      return
    }
    const checked = checkResumePayload(intent.payload)
    if (typeof checked === 'string') {
      deps.errors.push(`意图消费：resume 意图 payload 形状不符（${checked}）——丢弃`)
      return
    }
    const plan = resolveResumePlan(deps.ledger, intent.ticket)
    if ('unavailable' in plan) {
      deps.errors.push(
        `意图消费：resume 断点不可解析，降级为新派候选（${plan.unavailable}）——F1-15「不支持续跑明报并降级为新派」`,
      )
    } else {
      deps.planResume(intent.ticket, plan)
    }
    if (deps.candidates.some((c) => c.ticket === intent.ticket)) {
      deps.drainSeen.add(intentKey)
      return
    }
    deps.candidates.push({ ticket: intent.ticket, intent })
    deps.drainSeen.add(intentKey)
  }
}
