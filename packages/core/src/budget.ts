/**
 * budget —— 预算链纯逻辑（reserve→settle→refusal；docs/16-§三「预算」行）
 *
 * 规格依据（实现单引用）：
 *   - docs/16-§三：预算 = reserve→settle→refusal；价目表在 models.yaml；
 *     成本按「每成功交付」记账（settle 行载 actual_usd，即成功交付的实际成本）。
 *   - docs/20-§六.8（质量红线）：不超预算帽；**预算预留-结算不落即不派**——
 *     reserve 是派发前的判定面：拒绝（重复/超帽）即不派，成功即返回账行让调用方落账。
 *   - docs/02 F1-09：launch 前原子预留 → 完工 settle 释放 → 超额调用前拒绝落 refusal
 *     （「考虑过但未执行」）；refusal 可查。
 *   - docs/17-§3：budgets 表列 = id / scope_kind(issue/person/company) / scope_id /
 *     kind(reserve/settle/refusal) / estimated / actual / ts——BudgetRow 逐列对齐
 *     （store 侧 appendBudget/queryBudgets 落账面已备，对接归后续单）。
 *   - docs/01 C1-09：预算预留-结算 + 四级 rollup——person 档行让「人之和」可从
 *     budgets 表直接聚合（票档行管票，人档行管人）。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - **双行落账**：一次预留落两条 reserve 行——issue 档（scope_id=单号）+ person 档
 *     （scope_id=工号），同 ts 同额；id 约定：人档行 = 票档行 id + '#p'。票档行支撑
 *     「同票重复预留」判定与单票净视图；人档行支撑「在途净预留」按人聚合（岗级帽的
 *     比较基准）与 person 级 rollup。17-§3 budgets 表的 scope_kind 三值正是此用途；
 *     双行 vs 单行（person 聚合改由派发侧 join）为拟稿，待 daemon 接线时批示定稿。
 *   - **帽的作用域**：ticketCap（TaskBrief.budgetCap，kernel.ts）对**该票**在途净预留
 *     比较；personCap（04-§四 岗级预算）对**该人**在途净预留（跨票合计）比较。
 *     两帽可同给（各自比较，先票后人，超即拒）；均不给 = 不设限（调用方责任）。
 *   - **refusal 不封死**：refusal 只记 refused，不动 reserved、不挡后续 reserve——
 *     同票可带更低估算再试（或等人结清再试）。F1-09「refusal 可查」不含「封禁」义。
 *   - **refusal 单行**（issue 档）：拒的是一次派发（票的事实）；person 维度 refused
 *     聚合暂无行源，如需再扩双行（拟稿）。
 *   - **settle 冲销全部在途**：对票档冲销该票全部未结预留（任务书语义）；对应人档行
 *     按同额冲销（人池里还有他人/他票预留时为部分冲销）。冲销额显式写进 settle 行的
 *     estimated_usd（对账友好，非「缺省=冲销全部」的隐式义——折叠对外来行仍兼容缺省）。
 *   - **结算必须先有预留**：无未结预留可结 → CONFIG_INVALID（20-§六.8：结算不落即
 *     不派的镜像——不能凭空结算）。refusal 不是预留，不满足结算前提。
 *   - **精度口径**：沿 models.ts 冻结口径——IEEE-754 双精度直算不凑整；台账存原始
 *     double；显示层各自取整。
 *   - settle 的 person 档行依赖 reserve 链内记忆的 ticket→person 桥（reserverOf）；
 *     折叠可从 '#p' id 约定重建桥（幂等重放），外来无配对行则只落票档行（如实，不猜）。
 *
 * 纯函数纪律（core 零 IO）：状态不可变（views/reserverOf 均换新 Map，未变返回原引用）；
 * 零 IO、零随机；时钟（now）与行 id 一律入参——id 生成归调用方（daemon 持 ULID）。
 */

import type { ClassifiedError, Money, PersonId, TicketId } from '@studio-next/contract'

// ---------------------------------------------------------------------------
// 行类型（对齐 store budgets 列；拟升 contract——store/src/records.ts 的临时闸同形）
// ---------------------------------------------------------------------------

/** 预算主体类别（17-§3 budgets.scope_kind） */
export type BudgetScopeKind = 'issue' | 'person' | 'company'

/** 预算三节点（16-§三 / F1-09） */
export type BudgetKind = 'reserve' | 'settle' | 'refusal'

/**
 * 预算账行：与 store budgets 表逐列对齐（estimated_usd/actual_usd 可空列 → 可选字段）。
 * 行流升序（store queryBudgets 的 ORDER BY ts,id 即满足）是折叠的输入约定。
 */
export interface BudgetRow {
  id: string
  scope_kind: BudgetScopeKind
  scope_id: string
  kind: BudgetKind
  /** 预留估算 / settle 行=冲销额 / refusal 行=被拒估算（USD） */
  estimated_usd?: number
  /** 成功交付实际成本（settle 行；「成本按每成功交付记账」） */
  actual_usd?: number
  ts: number
}

/** 人档行 id 后缀（双行约定：人档行 id = 票档行 id + 本后缀；导出供 daemon 对账用） */
export const BUDGET_PERSON_SUFFIX = '#p'

/** refusal 行 id 后缀（拒的是本次派发预留尝试：调用方传入的 id + 本后缀） */
export const BUDGET_REFUSAL_SUFFIX = '#r'

// ---------------------------------------------------------------------------
// 净预留视图与折叠
// ---------------------------------------------------------------------------

/** 单主体净预留视图：在途净预留 / 已结实际成本 / 被拒估算合计（USD，double 直算） */
export interface BudgetView {
  /** 在途净预留 = Σ未结 reserve 的 estimated − Σsettle 冲销额（下限 0） */
  reserved: number
  /** 已结算实际成本 = Σsettle 的 actual（每成功交付记账） */
  settled: number
  /** 被拒估算合计 = Σrefusal 的 estimated（「考虑过但未执行」，可查） */
  refused: number
}

/** scope 键（`${scope_kind}:${scope_id}`；仅作 Map 键用，不回析） */
export function budgetScopeKey(scopeKind: BudgetScopeKind, scopeId: string): string {
  return `${scopeKind}:${scopeId}`
}

/** 全部主体 → 净视图（折叠产物，行流可完整重建） */
export type BudgetViews = ReadonlyMap<string, BudgetView>

/**
 * 预算台账操作态：净视图 + ticket→person 桥（该票未结预留的落账人；settle 冲销
 * 双方池的桥）。桥由 reserve 链维护，折叠按 '#p' id 约定重建（见头注拟稿点）。
 */
export interface BudgetLedgerState {
  views: BudgetViews
  reserverOf: ReadonlyMap<TicketId, PersonId>
}

/** 空台账（初始态） */
export function emptyBudgetLedger(): BudgetLedgerState {
  return { views: new Map(), reserverOf: new Map() }
}

/** 查主体净视图（无记录 = 零视图；不进 state，只读查询面） */
export function budgetView(state: BudgetLedgerState, scopeKind: BudgetScopeKind, scopeId: string): BudgetView {
  return state.views.get(budgetScopeKey(scopeKind, scopeId)) ?? { reserved: 0, settled: 0, refused: 0 }
}

// —— 折叠的行校验（运行期；TS 类型挡不住 JS 调用方/坏行流，算术被 NaN 毒化必须拦） ——

const SCOPE_KINDS: readonly BudgetScopeKind[] = ['issue', 'person', 'company']
const KINDS: readonly BudgetKind[] = ['reserve', 'settle', 'refusal']

function budgetInvalid(op: string, detail: string): never {
  const err = new Error(`CONFIG_INVALID/${op}：${detail}`) as Error & ClassifiedError
  err.category = 'CONFIG_INVALID'
  err.subcause = op
  err.detail = detail
  throw err
}

function assertFoldRow(row: BudgetRow): void {
  if (typeof row.id !== 'string' || row.id === '') {
    budgetInvalid('budget/fold:bad-id', `行 id 非空字符串：${JSON.stringify(row.id)}`)
  }
  if (!SCOPE_KINDS.includes(row.scope_kind)) {
    budgetInvalid('budget/fold:bad-scope-kind', `未知 scope_kind=${String(row.scope_kind)}（仅 issue/person/company，17-§3）`)
  }
  if (!KINDS.includes(row.kind)) {
    budgetInvalid('budget/fold:bad-kind', `未知 kind=${String(row.kind)}（仅 reserve/settle/refusal，16-§三）`)
  }
  if (!Number.isFinite(row.ts)) {
    budgetInvalid('budget/fold:bad-ts', `ts=${String(row.ts)} 非有限数`)
  }
  const est = row.estimated_usd
  if (est !== undefined && (!Number.isFinite(est) || est < 0)) {
    budgetInvalid('budget/fold:bad-estimated', `estimated_usd=${String(est)} 须为非负有限数`)
  }
  const act = row.actual_usd
  if (act !== undefined && (!Number.isFinite(act) || act < 0)) {
    budgetInvalid('budget/fold:bad-actual', `actual_usd=${String(act)} 须为非负有限数`)
  }
}

/** 折叠单行 → 新视图条目（纯算术：settle 缺省冲销额=全部在途——外来行兼容） */
function applyRowToViews(views: Map<string, BudgetView>, row: BudgetRow): void {
  const key = budgetScopeKey(row.scope_kind, row.scope_id)
  const prev = views.get(key) ?? { reserved: 0, settled: 0, refused: 0 }
  const next: BudgetView = { ...prev }
  if (row.kind === 'reserve') {
    next.reserved += row.estimated_usd ?? 0
  } else if (row.kind === 'refusal') {
    next.refused += row.estimated_usd ?? 0
  } else {
    // settle：冲销 estimated_usd（缺省=全部在途）；实际成本入 settled
    const release = row.estimated_usd ?? next.reserved
    next.reserved = Math.max(0, next.reserved - release)
    next.settled += row.actual_usd ?? 0
  }
  views.set(key, next)
}

/**
 * 纯折叠：升序 budgets 行流 → 净视图 + ticket→person 桥。
 * 幂等：同行流重折叠必同结果（纯算术 + 确定性配对）；操作链（reserve/settle）发出的
 * 行流重折叠必复现操作态——「状态 = 行流的折叠」是本模块的核心不变律（测试锚定）。
 * 桥重建：person 档 reserve 行（id=X#p）与 issue 档 reserve 行（id=X）按 id 茎配对；
 * settle 行消费桥（未结预留清零，桥随之失效）。
 */
export function foldBudgets(rows: readonly BudgetRow[]): BudgetLedgerState {
  const views = new Map<string, BudgetView>()
  for (const row of rows) {
    assertFoldRow(row)
    applyRowToViews(views, row)
  }

  // 桥重建（第二遍；先集人档 id 茎 → 再按行序 replay 桥的建/销）
  const stemPerson = new Map<string, PersonId>()
  for (const row of rows) {
    if (
      row.kind === 'reserve' &&
      row.scope_kind === 'person' &&
      row.id.endsWith(BUDGET_PERSON_SUFFIX)
    ) {
      stemPerson.set(row.id.slice(0, -BUDGET_PERSON_SUFFIX.length), row.scope_id)
    }
  }
  const reserverOf = new Map<TicketId, PersonId>()
  for (const row of rows) {
    if (row.kind === 'reserve' && row.scope_kind === 'issue') {
      const person = stemPerson.get(row.id)
      if (person !== undefined) reserverOf.set(row.scope_id, person)
    } else if (row.kind === 'settle' && row.scope_kind === 'issue') {
      reserverOf.delete(row.scope_id)
    }
  }
  return { views, reserverOf }
}

// ---------------------------------------------------------------------------
// reserve —— 派发前判定面（20-§六.8：预留不落即不派）
// ---------------------------------------------------------------------------

/** 预留入参：id 归调用方生成（core 零 IO 零随机）；双帽均可选（见头注拟稿点） */
export interface ReserveInput {
  /** 本次预留的票档行 id（ULID 等，调用方生成）；人档行自动派生 id+'#p' */
  id: string
  ticket: TicketId
  person: PersonId
  /** 预留估算（models.estimateCost 的产物；价目表驱动） */
  estimated: Money
  /** 票级预算帽（TaskBrief.budgetCap）：该票在途净预留+估算 ≤ 帽 */
  ticketCap?: Money
  /** 岗级预算帽（04-§四）：该人在途净预留（跨票合计）+估算 ≤ 帽 */
  personCap?: Money
  /** 时钟入参（epoch ms） */
  now: number
}

/** 预留结果：成功=双行待落账；拒绝分重复（无新账）与超帽（refusal 行待落账） */
export type ReserveResult =
  | {
      ok: true
      /** 落账后的新台账（已含双行效果；不可变更新） */
      newState: BudgetLedgerState
      /** 待落账行（issue + person；调用方走 store.appendBudget——预留不落即不派） */
      rows: [BudgetRow, BudgetRow]
    }
  | {
      ok: false
      /** duplicate=同票已有未结预留（调用方状态机错乱/重复派发，无新账行） */
      reason: 'duplicate'
      /** 原状态原引用（未变） */
      newState: BudgetLedgerState
    }
  | {
      ok: false
      /** over-ticket-cap / over-person-cap：超帽拒绝（F1-09：调用前拒绝） */
      reason: 'over-ticket-cap' | 'over-person-cap'
      /** 触发拒绝的帽（usd） */
      cap: Money
      /** 比较时该作用域的在途净预留（票帽=该票；人帽=该人跨票合计） */
      inflight: number
      /** 本次估算 */
      estimated: Money
      /** refusal 行（issue 档；refusal 也是一条账——调用方落账，可查） */
      refusal: BudgetRow
      /** 落账 refusal 后的新台账（refused 已计入） */
      newState: BudgetLedgerState
    }

function assertMoney(op: string, field: string, v: Money): void {
  if (!Number.isFinite(v.usd) || v.usd < 0) {
    budgetInvalid(`${op}:bad-${field}`, `${field}.usd=${String(v.usd)} 须为非负有限数`)
  }
}

function assertReserveInput(input: ReserveInput): void {
  if (typeof input.id !== 'string' || input.id === '') {
    budgetInvalid('budget/reserve:bad-id', 'id 须为非空字符串（ULID 等，调用方生成）')
  }
  if (input.id.includes(BUDGET_PERSON_SUFFIX) || input.id.includes(BUDGET_REFUSAL_SUFFIX)) {
    budgetInvalid('budget/reserve:bad-id', `id 不得含保留后缀（${BUDGET_PERSON_SUFFIX}/${BUDGET_REFUSAL_SUFFIX}，双行 id 派生约定）`)
  }
  if (typeof input.ticket !== 'string' || input.ticket === '') {
    budgetInvalid('budget/reserve:bad-ticket', 'ticket 须为非空字符串')
  }
  if (typeof input.person !== 'string' || input.person === '') {
    budgetInvalid('budget/reserve:bad-person', 'person 须为非空字符串')
  }
  if (!Number.isFinite(input.now) || input.now < 0) {
    budgetInvalid('budget/reserve:bad-now', `now=${String(input.now)} 须为非负有限数（epoch ms）`)
  }
  assertMoney('budget/reserve', 'estimated', input.estimated)
  if (input.ticketCap !== undefined) assertMoney('budget/reserve', 'ticketCap', input.ticketCap)
  if (input.personCap !== undefined) assertMoney('budget/reserve', 'personCap', input.personCap)
}

/**
 * 预留判定（纯）：重复预留拒（同票已有未结预留）；超帽拒并产 refusal 行。
 * 判定顺序冻结：duplicate → ticketCap → personCap（确定性，同输入必同输出）。
 * 拒绝路径不落 reserve（不派）；refusal 行交调用方落账后 newState 才生效于持久面。
 */
export function reserve(state: BudgetLedgerState, input: ReserveInput): ReserveResult {
  assertReserveInput(input)

  // 闸一：同票已有未结预留 → 重复预留（无新账行，状态原引用返回）
  const ticketView = budgetView(state, 'issue', input.ticket)
  if (ticketView.reserved > 0) {
    return { ok: false, reason: 'duplicate', newState: state }
  }

  // 闸二：票级帽（TaskBrief.budgetCap）——该票在途净预留+估算 ≤ 帽
  if (input.ticketCap !== undefined && ticketView.reserved + input.estimated.usd > input.ticketCap.usd) {
    return refusedReserve(state, input, 'over-ticket-cap', input.ticketCap, ticketView.reserved)
  }

  // 闸三：岗级帽——该人在途净预留（跨票合计）+估算 ≤ 帽
  const personView = budgetView(state, 'person', input.person)
  if (input.personCap !== undefined && personView.reserved + input.estimated.usd > input.personCap.usd) {
    return refusedReserve(state, input, 'over-person-cap', input.personCap, personView.reserved)
  }

  // 过闸：双行落账（issue 档 + person 档，同 ts 同额；见头注拟稿点）
  const issueRow: BudgetRow = {
    id: input.id,
    scope_kind: 'issue',
    scope_id: input.ticket,
    kind: 'reserve',
    estimated_usd: input.estimated.usd,
    ts: input.now,
  }
  const personRow: BudgetRow = {
    id: input.id + BUDGET_PERSON_SUFFIX,
    scope_kind: 'person',
    scope_id: input.person,
    kind: 'reserve',
    estimated_usd: input.estimated.usd,
    ts: input.now,
  }
  const views = new Map(state.views)
  applyRowToViews(views, issueRow)
  applyRowToViews(views, personRow)
  const reserverOf = new Map(state.reserverOf)
  reserverOf.set(input.ticket, input.person)
  return { ok: true, newState: { views, reserverOf }, rows: [issueRow, personRow] }
}

/** 超帽拒绝：refusal 行（issue 档，id+#r）+ 计入 refused 的新台账（refusal 只记录不封死） */
function refusedReserve(
  state: BudgetLedgerState,
  input: ReserveInput,
  reason: 'over-ticket-cap' | 'over-person-cap',
  cap: Money,
  inflight: number,
): ReserveResult {
  const refusal: BudgetRow = {
    id: input.id + BUDGET_REFUSAL_SUFFIX,
    scope_kind: 'issue',
    scope_id: input.ticket,
    kind: 'refusal',
    estimated_usd: input.estimated.usd,
    ts: input.now,
  }
  const views = new Map(state.views)
  applyRowToViews(views, refusal)
  return {
    ok: false,
    reason,
    cap,
    inflight,
    estimated: input.estimated,
    refusal,
    newState: { views, reserverOf: state.reserverOf },
  }
}

// ---------------------------------------------------------------------------
// settle —— 完工结算（成本按每成功交付记账）
// ---------------------------------------------------------------------------

/** 结算入参：actual=成功交付实际成本（收割侧 estimateCost/原生 cost 折算） */
export interface SettleInput {
  /** 票档 settle 行 id（人档行自动派生 id+'#p'） */
  id: string
  ticket: TicketId
  actual: Money
  now: number
}

/** 结算结果：冲销额 + 待落账行（票档必有；人档行依桥，桥在则双行） */
export interface SettleResult {
  ok: true
  newState: BudgetLedgerState
  /** 待落账行（调用方走 store.appendBudget） */
  rows: BudgetRow[]
  /** 本次冲销的在途净预留额（= 该票全部未结预留合计） */
  released: number
}

function assertSettleInput(input: SettleInput): void {
  if (typeof input.id !== 'string' || input.id === '') {
    budgetInvalid('budget/settle:bad-id', 'id 须为非空字符串（ULID 等，调用方生成）')
  }
  if (input.id.includes(BUDGET_PERSON_SUFFIX) || input.id.includes(BUDGET_REFUSAL_SUFFIX)) {
    budgetInvalid('budget/settle:bad-id', `id 不得含保留后缀（${BUDGET_PERSON_SUFFIX}/${BUDGET_REFUSAL_SUFFIX}，双行 id 派生约定）`)
  }
  if (typeof input.ticket !== 'string' || input.ticket === '') {
    budgetInvalid('budget/settle:bad-ticket', 'ticket 须为非空字符串')
  }
  if (!Number.isFinite(input.now) || input.now < 0) {
    budgetInvalid('budget/settle:bad-now', `now=${String(input.now)} 须为非负有限数（epoch ms）`)
  }
  assertMoney('budget/settle', 'actual', input.actual)
}

/**
 * 结算（纯）：冲销该票**全部**未结预留，落 settle 行（actual=成功交付成本）。
 * 无预留可结 → CONFIG_INVALID（结算必须先有预留；refusal 不算预留）——20-§六.8
 * 「结算不落即不派」的镜像：不允许凭空结算。人档行按同额冲销人池（他票预留留存，
 * 即「部分场景」），actual 同时计入人档 settled（C1-09 person 级 rollup 行源）。
 */
export function settle(state: BudgetLedgerState, input: SettleInput): SettleResult {
  assertSettleInput(input)

  const ticketView = budgetView(state, 'issue', input.ticket)
  if (ticketView.reserved <= 0) {
    budgetInvalid(
      'budget/settle:no-reserve',
      `单 ${input.ticket} 无未结预留可结算（reserved=0）——结算必须先有预留（20-§六.8；refusal 不算预留）`,
    )
  }

  const released = ticketView.reserved
  const issueRow: BudgetRow = {
    id: input.id,
    scope_kind: 'issue',
    scope_id: input.ticket,
    kind: 'settle',
    estimated_usd: released,
    actual_usd: input.actual.usd,
    ts: input.now,
  }
  const rows: BudgetRow[] = [issueRow]

  const views = new Map(state.views)
  applyRowToViews(views, issueRow)

  // 桥在人池行才落（外来无配对行流折叠出的态无桥——只结票档，不猜人）
  const person = state.reserverOf.get(input.ticket)
  const reserverOf = new Map(state.reserverOf)
  reserverOf.delete(input.ticket)
  if (person !== undefined) {
    const personRow: BudgetRow = {
      id: input.id + BUDGET_PERSON_SUFFIX,
      scope_kind: 'person',
      scope_id: person,
      kind: 'settle',
      estimated_usd: released,
      actual_usd: input.actual.usd,
      ts: input.now,
    }
    rows.push(personRow)
    applyRowToViews(views, personRow)
  }

  return { ok: true, newState: { views, reserverOf }, rows, released }
}
