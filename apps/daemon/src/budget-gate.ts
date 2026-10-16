/**
 * budget-gate —— daemon 侧预算闸：派发前 reserve / 收割后 settle 的接线件
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§六.8（质量红线）：不超预算帽；**预算预留-结算不落即不派**——
 *     落账调用（ledger.appendBudget）与 launch 调用之间的任何失败=不派（机制点，
 *     非自律）：本模块先落账、后返回；engine 收到 reserved/adopted 才 launch。
 *   - docs/16-§三：预算 = reserve→settle→refusal；成本按「每成功交付」记账
 *     （settle 行载 actual_usd）。
 *   - docs/17-§3：budgets 表列与 core BudgetRow 逐列对齐（store appendBudget/
 *     queryBudgets 落账面）；行 id 归 daemon（id.ts ULID，core 纯函数纪律）。
 *   - core/budget.ts（判定引擎）：reserve 双帽判定 + 双行（issue+person，人档行
 *     id=票档行 id+'#p'）+ refusal 行（id+'#r'）；settle 冲销全部未结预留。
 *   - core/models.ts（价目表）：parseModelsYaml 装载 + estimateCost 折算
 *     （17-§4：价目表在 models.yaml，改动走批示）。
 *
 * 估算两态（价目表接入面；头注说明——缺省**不**拷贝 models.example.yaml）：
 *   - 态 A「有价目表」（catalog 注入，daemon.yaml models: 段装载）：
 *     estimated = max(适配器 estimate, estimateCost(任务书字符量折算 tokens, 档))。
 *     折算系数（拟稿待批）：任务书正文字符 ÷4 ≈ 输入 tokens（chars/token 拟稿），
 *     产出按输入 1/2 估（OUTPUT_INPUT_RATIO）；档取 resolve('main_worker')——
 *     派发主岗（17-§4 roles 最小集必登记）。取 max=保守预留（宁多不少：多留
 *     只是暂时占位，settle 全额冲销，actual 才是记账面）。双帽（票级+岗级）均生效。
 *   - 态 B「无价目表」（缺省）：estimated = 适配器 estimate(taskBrief) 自报
 *     （contract ExecutorAdapter.estimate 现有面；fake=0.01 与固定实际成本同额）——
 *     仅票级帽判定（岗级帽的比较基准=价目折算，无价目表时配置的岗级帽不生效，
 *     如实呈现，不静默假装有依据）。适配器自报为 0 时超帽判定形同虚设——降级态
 *     的诚实边界；0 值预留的折叠视图不可见接缝见 settleDispatch 头注（no-op 结算拟稿）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **duplicate=沿用（失败保留的重派语义）**：reserve 判 duplicate（同票已有
 *     未结预留）且该单**无在途工位**时——沿用既有预留继续派（不落新行）。这是
 *     「收割失败路径预留保留：断路器回首批位后重派继续用同一笔额度」的机制面：
 *     一笔预留服务 N 次尝试直到成功 settle 一次冲销（成本按每成功交付记账）。
 *     跳过派发仅发生在既有预留确属在途工位时——engine 的 inflight 预检已拦，
 *     本闸防御性同判（见 gateDispatch 的 adopt 前置）。若批示改为「失败释放」，
 *     落点=failHarvest 后追加冲销行（本刀不动，语义经测试锚定）。
 *   - **双行落账顺序 issue 先 person 后**：appendBudget 是单行语句（store 面无
 *     跨行事务，扩面归 store 后续单），两行间失败留半行。issue 先落=失败时该票
 *     恒 duplicate→adopt/跳过，**绝不会双派**（红线机制点）；person 半行缺位的
 *     极端态由 settle 桥（'#p' 配对）如实降级为只结票档（core/budget.ts 头注）。
 *   - **settle 异常不破坏收割结论**：四要件齐=收割成功（17-§6）与预算结算是
 *     两个事实面；settle 抛 CONFIG_INVALID（无预留可结——正常流不可能：每次
 *     派发必先 reserve/adopt）时收割照常收口，异常如实入 tick errors——预留
 *     滞留会让同票后续派发走 adopt（可见、可对账），不静默。
 *   - 票级帽源：TaskBrief.budgetCap（单票面，装配侧可设）优先，缺省回退引擎
 *     配置帽 budgetTicketCapUsd（全局缺省帽——单票字段帽从平台字段面装载归
 *     网关后续刀）。
 *
 * 纪律：只 import 不改 packages/*；id 一律经注入 makeId（ULID 归 daemon，id.ts）；
 * 时钟一律入参（now）；本模块零随机零盘 IO（ledger 注入）。
 */
import type {
  ExecutorAdapter,
  ModelCatalog,
  Money,
  PersonId,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'
import {
  budgetView,
  foldBudgets,
  reserve,
  settle,
  type BudgetLedgerState,
  type BudgetRow,
} from '@studio-next/core'
import type { Ledger } from '@studio-next/store'

// ————————————————————————— 估算折算系数（态 A；拟稿待批，见头注） —————————————————————————

/** 任务书正文字符 → 输入 tokens 折算（拟稿：4 字符/token） */
export const ESTIMATE_CHARS_PER_TOKEN = 4

/** 产出 tokens 按输入的比率估（拟稿：产出=输入/2） */
export const ESTIMATE_OUTPUT_INPUT_RATIO = 0.5

/** 派发主岗角色（态 A 折算取档的角色；17-§4 roles 最小集必登记） */
export const ESTIMATE_ROLE = 'main_worker'

// ————————————————————————— 折叠入参：双 scope 行流 —————————————————————————

/**
 * 预算台账现态（判定引擎输入）：票档行（issue:ticket）+ 人档行（person:personId）
 * 双 scope 拼接 → foldBudgets。store 的 queryBudgets 是单 scope 面（无全表列举），
 * 而本闸的判定面恰只需要这两个 scope 的视图 + 桥：人档行全集让 ticket→person 桥
 * 按 '#p' id 茎重建（settle 双行的前提）。行序：各 scope 内 ts,id 升序（store 契约），
 * 跨 scope 拼接不破坏折叠正确性（视图算术按 scope 隔离、交换律成立；桥只消费
 * issue 行序与 person 行的 id 茎集合）。
 */
export function foldScopes(ledger: Ledger, ticket: TicketId, personId: PersonId): BudgetLedgerState {
  const rows: BudgetRow[] = [
    ...ledger.queryBudgets({ scope_kind: 'issue', scope_id: ticket }),
    ...ledger.queryBudgets({ scope_kind: 'person', scope_id: personId }),
  ]
  return foldBudgets(rows)
}

// ————————————————————————— 估算（两态） —————————————————————————

/**
 * 派发估算（两态，见头注）：态 B=适配器自报；态 A=与价目折算取 max（保守）。
 * 纯 IO 面：适配器 estimate 调用 + catalog 纯折算；不落任何账。
 */
export async function estimateDispatch(
  adapter: ExecutorAdapter,
  taskBrief: TaskBrief,
  briefChars: number,
  catalog?: ModelCatalog,
): Promise<Money> {
  const selfReported = await adapter.estimate(taskBrief)
  if (catalog === undefined) {
    return { usd: selfReported.estimated.usd }
  }
  // 态 A：任务书字符量 → tokens → estimateCost（resolve 抛 CONFIG_INVALID=配置坏，如实上抛）
  const inputTokens = Math.ceil(briefChars / ESTIMATE_CHARS_PER_TOKEN)
  const outputTokens = Math.ceil(inputTokens * ESTIMATE_OUTPUT_INPUT_RATIO)
  const tier = catalog.resolve(ESTIMATE_ROLE).tier
  const priced = catalog.estimateCost({ input: inputTokens, output: outputTokens }, tier)
  return { usd: Math.max(selfReported.estimated.usd, priced.usd) }
}

// ————————————————————————— 派发前闸 —————————————————————————

/** 预算闸依赖（engine 注入；ledger=落账面，makeId=ULID，catalog=态 A 缺省态 B） */
export interface BudgetGateDeps {
  ledger: Ledger
  makeId: (ts: number) => string
  catalog?: ModelCatalog
}

/** 派发闸入参（executeDispatch 相位组装） */
export interface BudgetGateInput {
  ticket: TicketId
  personId: PersonId
  adapter: ExecutorAdapter
  taskBrief: TaskBrief
  /** 任务书正文字符量（态 A 折算输入） */
  briefChars: number
  /** 票级帽（USD）：TaskBrief.budgetCap 优先，引擎配置帽回退；两者皆无=不设限 */
  fallbackTicketCapUsd?: number
  /** 岗级帽（USD；仅态 A 生效——见头注两态） */
  personCapUsd?: number
  now: number
}

/** 派发闸结论：reserved=新落双行可派；adopted=沿用未结预留可派；refused=不派 */
export type BudgetGateDecision =
  | { kind: 'reserved'; estimated: number; rows: [BudgetRow, BudgetRow] }
  | { kind: 'adopted'; estimated: number }
  | {
      kind: 'refused'
      reason: 'over-ticket-cap' | 'over-person-cap'
      estimated: number
      cap: number
      inflight: number
      refusal: BudgetRow
    }

/**
 * 派发前闸（20-§六.8 机制点）：
 *   1. 折叠现态（双 scope）→ 该票已有未结预留且无在途工位 → **adopt**（失败保留
 *      重派语义，头注拟稿）——不落新行直接放行 launch；
 *   2. 估算（两态）→ reserve 判定 → 过闸=双行落账（issue 先 person 后——顺序即
 *      机制：落账调用与 launch 调用间失败=不派）；
 *   3. 超帽=refusal 行落账 + 不派（F1-09「考虑过但未执行」，可查；不封死）。
 * 调用方约定：仅收到 reserved/adopted 才 launch；refused 即 fail（engine 释放泳道）。
 */
export async function gateDispatch(
  deps: BudgetGateDeps,
  input: BudgetGateInput,
): Promise<BudgetGateDecision> {
  const state = foldScopes(deps.ledger, input.ticket, input.personId)

  // 闸〇（duplicate→adopt）：同票已有未结预留（收割失败保留 / 落账-launch 间崩溃残留）
  // ——沿用既有预留继续派（一笔预留服务 N 次尝试，成功 settle 一次冲销）。真在途
  // 工位的双派由 engine inflight 预检拦（本闸对 inflight 不知情，防御面归上层）。
  const ticketInflight = budgetView(state, 'issue', input.ticket).reserved
  if (ticketInflight > 0) {
    return { kind: 'adopted', estimated: ticketInflight }
  }

  const estimated = await estimateDispatch(input.adapter, input.taskBrief, input.briefChars, deps.catalog)
  const ticketCapUsd = input.taskBrief.budgetCap?.usd ?? input.fallbackTicketCapUsd
  const result = reserve(state, {
    id: deps.makeId(input.now),
    ticket: input.ticket,
    person: input.personId,
    estimated,
    ...(ticketCapUsd !== undefined ? { ticketCap: { usd: ticketCapUsd } } : {}),
    // 岗级帽仅态 A 生效（态 B 估算=适配器自报，岗级比较基准无价目依据——头注两态）
    ...(deps.catalog !== undefined && input.personCapUsd !== undefined
      ? { personCap: { usd: input.personCapUsd } }
      : {}),
    now: input.now,
  })

  if (result.ok) {
    // 双行落账：issue 先 person 后（头注拟稿——顺序即「不落即不派」的失败安全面）。
    // appendBudget 抛错=不派（异常上抛给 engine 的派发 catch→DISPATCH_FAIL）。
    deps.ledger.appendBudget(result.rows[0])
    deps.ledger.appendBudget(result.rows[1])
    return { kind: 'reserved', estimated: estimated.usd, rows: result.rows }
  }
  if (result.reason === 'duplicate') {
    // 折叠态与上面预检的窗口竞态在单线程 daemon 不存在；防御性走 adopt（同语义）
    return { kind: 'adopted', estimated: ticketInflight }
  }
  // 超帽：refusal 行落账（可查；不封死——F1-09）+ 不派
  deps.ledger.appendBudget(result.refusal)
  return {
    kind: 'refused',
    reason: result.reason,
    estimated: result.estimated.usd,
    cap: result.cap.usd,
    inflight: result.inflight,
    refusal: result.refusal,
  }
}

// ————————————————————————— 收割后结算 —————————————————————————

/** 结算入参（harvestOne 成功路径组装；actual=收割 resultStats.cost） */
export interface SettleDispatchInput {
  ticket: TicketId
  personId: PersonId
  actual: Money
  now: number
}

/** 结算结论：冲销额 + 落账行（票档必有；人档行依 '#p' 桥——双行对账面） */
export interface SettleDispatchResult {
  released: number
  actualUsd: number
  rows: BudgetRow[]
}

/**
 * 收割成功结算（16-§三「成本按每成功交付记账」）：settle(actual) → 双行落账
 * （票档冲销额+actual；人档同额，桥在则双行——core settle 语义）。
 *
 * 0 额预留接缝（拟稿待批）：态 B 下适配器自报估算为 0 时，reserve 行照落（审计轨迹）
 * 但 core 折叠视图 reserved 恒 0（额度算术看不见 0 值行）——此时结算走 **no-op**：
 * 不落 settle 行（无额可冲销的空账不落），返回 released=0。行面按「reserve 行数 >
 * settle 行数」判未结（settle 冲销全部在途，故至多一 settle 闭一批 reserve）。
 * 真无预留可结（一行皆无）=CONFIG_INVALID 上抛（core 语义镜像：不能凭空结算）。
 */
export function settleDispatch(
  deps: BudgetGateDeps,
  input: SettleDispatchInput,
): SettleDispatchResult {
  const state = foldScopes(deps.ledger, input.ticket, input.personId)
  if (budgetView(state, 'issue', input.ticket).reserved <= 0) {
    const issueRows = deps.ledger.queryBudgets({ scope_kind: 'issue', scope_id: input.ticket })
    const openCount =
      issueRows.filter((r) => r.kind === 'reserve').length - issueRows.filter((r) => r.kind === 'settle').length
    if (openCount > 0) {
      // 0 额未结预留（估算=0 的适配器）：视图无额可冲销——no-op 结算（见头注接缝拟稿）
      return { released: 0, actualUsd: input.actual.usd, rows: [] }
    }
  }
  const result = settle(state, {
    id: deps.makeId(input.now),
    ticket: input.ticket,
    actual: input.actual,
    now: input.now,
  })
  for (const row of result.rows) deps.ledger.appendBudget(row)
  return { released: result.released, actualUsd: input.actual.usd, rows: result.rows }
}
