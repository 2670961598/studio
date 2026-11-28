/**
 * engine/dispatch/execute.ts —— 派发相位执行体（executeDispatch，原 engine.ts 内函数）
 *
 * 20-§十五「按域拆件、零行为变更」：函数体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写）。
 * 派发序不变：装配（指令文件按通道能力路由落盘：native=workspace AGENTS.md；bridge 通道=
 * 每任务临时文件 instructions-store.ts）→ **预算闸（reserve 双行落账→才 launch，
 * 20-§六.8 不落即不派）** → registry 选适配器 → launch → work_records 落在途
 * → 平台迁已派发 → events 落 DISPATCH（note 携分层指纹与 intentKey——幂等索引依据）。
 *
 * task-141 抽件：适配器绑定段（选择闸→preflight→派生登记→读面→装配→脚手架→定价附件→
 * 指令文件→PRM→任务书）迁 engine/dispatch/bound-stage.ts（语句逐字；段内每步依赖具体适配器，
 * 故按源 executor 换绑=整段重跑）；本文件留段前候选预绑、段后精确选源收敛（routeAndBind）、
 * 预算闸、launch/换源重试与在途落账。未配置 models.yaml sources[].executor 时与抽件前
 * 逐字节一致（docs/quality/model-routing.md §10）。
 *
 * 两个顺序锚仍在 engine.ts（源侧锚测试钉死：`resolveWorkerDispatchSeatbelt({ ticket` 先于
 * `const detect = await adapter.detect()`，且 DISPATCH note 的 seatbelt 审计段同源）：
 *   - seatbelt→detect 前置：rt.dispatchPreflight（engine.ts）
 *   - 崩溃注入①②：rt.crash.dispatchReserved／dispatchLaunched（engine.ts 集中声明）
 *
 * resume 面（129-E studio-dev-184，F1-15）：resumePlan 在（拍作用域——drain 段 resume
 * 意图消费时登记）→ 适配器优先指名解析 plan.executor（原生续跑用同一家——session id
 * 是 executor 本地命名空间）→ 装配入参带 resume{sessionId, summaryPath, summary} →
 * 任务书续跑版（前情摘要注入，17-§5）；executor 除名/声明 session_resume=false →
 * 明报降级为新派（DISPATCH note `resume=降级新派` 锚——F1-15 字面「不支持续跑的
 * executor 明报并降级为新派」，不静默）。续跑不重置 attempt 计数（attemptOf 天然续号
 * ——断路器连击口径不被续跑洗白）；DISPATCH 事件挂 causation_id=上次工时单 id（F1-15
 * 「新工时单挂 causation_id 链到上次」——EventRecord 既有可选列填列非加列）。
 * task-141：路由源 executor 非续跑同族 → 同样降级新派（不强行跨执行器续跑）；同族则续跑位
 * 优先于源 executor 位（session 归属执行位）。
 */
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import type { EventRecord, ExecutorAdapter, Handle, IssueRecord, TaskBrief, TicketId } from '@studio-next/contract'
import type { Action } from '@studio-next/core'
import { resolveDispatchPerson, type AutoAssignCarry } from '../assign/auto-assign.ts'
import { gateDispatch } from '../budget-gate.ts'
import { makeDispatchFail } from '../capability/index.ts'
import { personDayGateInput } from '../cost-guard/fold.ts'
// Kimi（kimi-coding）access token 注入面（docs/quality/kimi-on-dsh.md §4）：launch 前现读
// token 文件（按需刷新）→ TaskBrief.credentials v1.4 env 通道；fail-safe 不抛不阻派发。
import { kimiTokenCredentials } from './kimi-token.ts'
// 适配器绑定段（task-141 抽件：选择闸→…→任务书；语义源见 bound-stage.ts 头注）
import { runBoundStage, type BoundDispatch, type BoundStageInput } from './bound-stage.ts'
// 执行器选择链钩子（studio-dev-620；v2/07 §一）：钩子体驻 work/dispatch-selection.ts，
// 本文件只留执行类单据监控调用（775/C3）；选择闸随绑定段（bound-stage.ts）。
import { executionGuardHit } from '../work/dispatch-selection.ts'
import { retireDispatchDerivation } from '../work/derivation-registration.ts'
import { resumeDispatchFace, type ResumeDispatchFace } from '../intents/relay-resume-faces.ts'
import type { ResumeDispatchPlan } from '../intents/relay-resume.ts'
import { removeInstructions } from '../instructions-store.ts'
import { aiwsWorkspaceOf } from '../prompt-assembly.ts'
import { recordStartChain } from '../records/hooks.ts'
import { dispatchRoomDuty } from '../rooms/room-duty.ts'
import type { EventIndex } from '../sentinel/events-index.ts'
import { modelTierDispatchFace, resolveModelTier } from '../tier/model-tier.ts'
import type { TickActionResult, TickPhaseDispatchBudget } from '../tick-report/types.ts'
import { dropQueueCarry, queueDispatchAnchor } from '../todoqueue/queue.ts'
import { startSessionArchive } from '../sessions/archive.ts' // 会话归档接线（studio-dev-551）
import { mintWorkerKey, workerKeyCredentials, WORKER_WKEY_ENV_KEY } from '../worker-key.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { releaseWithEpoch } from '../lanes/release.ts'
import { yieldAttemptCloseout } from '../recovery/closeout.ts'
import { evaluateDispatchAcceptance } from '../acceptance/index.ts'
import { selectModelSource, classifyFailure, isFailoverClass, type SelectOutcome } from '../routing/router.ts'
import { quotaProbeNote, recordRoutedFailure } from '../routing/quota-gate.ts'
import { provisionSourceOverlay } from '../routing/overlay.ts'
import { adapterForSource, reconcileSourceResume, sameExecutorFamily, sourceExecutorFamilies, sourceRef } from '../routing/source-executor.ts'
import { budgetView, createModelCatalog, foldBudgets, type ModelsConfig, type ModelSourceSpec } from '@studio-next/core'

/** 精确选源收敛步（routeAndBind 回传；unavailable=换源重选无源可用，调用方定 HOLD/fail 口径） */
type RouteStep =
  | { readonly kind: 'off' }
  | { readonly kind: 'bound' }
  | { readonly kind: 'unavailable'; readonly outcome: Extract<SelectOutcome, { ok: false }> }
  | { readonly kind: 'failed'; readonly result: TickActionResult }
/** 同 dispatch 换源步（routeFailoverOn 回传；failed=换绑段失败——result 已含首源错误） */
type FailoverStep =
  | { readonly kind: 'switched' }
  | { readonly kind: 'not' }
  | { readonly kind: 'failed'; readonly result: TickActionResult }
/** dsh 家族 overlay/model 端子（结构能力——零 if executor，缺端子即不套 overlay） */
type OverlayFace = { setSourceOverlay?: (p: string | undefined) => void; setModel?: (m: string | undefined) => void; getSourceOverlay?: () => string | undefined; getModel?: () => string | undefined }

export async function executeDispatch(
  rt: EngineRuntime,
  action: Extract<Action, { type: 'dispatch' }>,
  intentKey: string,
  index: EventIndex,
  tickEvents: EventRecord[],
  budget: TickPhaseDispatchBudget,
  resumePlan?: ResumeDispatchPlan,
  autoAssign?: AutoAssignCarry,
  dispatchPersons?: ReadonlyMap<TicketId, string>,
  laneEpoch?: number,
): Promise<TickActionResult> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { platform, ledger, registry, config, lanes, inflight, budgetDeps, now, makeId, records, workerKeys, rooms, queueCarry } = rt
  const people = rt.people
  const costGuard = rt.costGuard
  const seq = rt.seq
  const makeEvent = rt.makeEvent
  const syncMirror = rt.syncMirror
  const assignRuntime = rt.assignRuntime

    const ticket = action.ticket
    // state-diff 排队时已占泳道（决策即占用）——任何失败路径都必须归还，不留死锁
    const fail = makeDispatchFail({ face: rt.deps.capabilitySupply, ticket, actionType: action.type, attemptOf: () => index.attemptOf(ticket), at: () => new Date(now()).toISOString(), releaseLane: () => {
      // studio-dev-812：释放带 epoch（phase2 acquire 返回值）；无传入(旧调用面)时仅当
      // 本单在册租约存在用其 epoch（LOCAL-329 多槽：按 ticket 精确）；否则跳过（禁止无 epoch 释放）。
      const state = lanes.state(action.lane)
      const epoch = laneEpoch ?? state.holders.find((h) => h.ticket === ticket)?.epoch
      const result = releaseWithEpoch(lanes, { lane: action.lane, ticket, epoch })
      if (!result.ok && result.reason === 'stale-epoch') {
        makeEvent('ESCALATE', { id: ticket } as IssueRecord, index.attemptOf(ticket), tickEvents, {
          note: `lease-epoch-stale;lane=${action.lane};ticket=${ticket};epoch=${String(result.epoch)};current=${String(result.currentEpoch)}——派发失败释放被拒（812；不误放新 epoch）`,
        })
      }
    }, dropInflight: () => inflight.delete(ticket),
      emitEscalate: (note) => makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, { note }) })
    if (inflight.has(ticket)) return fail('该单已有在途工位（幂等跳过，不双写）')
    const fresh = await platform.issues.get(ticket)
    // —— 验收口径门（task-39；提案 task-38）：功能类新单缺 acceptance_criteria → enforce 拒派 /
    //    observe 告警放行；存量 legacy 只告警不阻塞（enforceSince 持久化判定）。——
    const acceptanceGate = evaluateDispatchAcceptance(rt.acceptance, fresh)
    if (!acceptanceGate.allow) {
      const blockKey = `${ticket}|acceptance-dispatch-blocked`
      if (!rt.acceptance.warned?.has(blockKey)) {
        rt.acceptance.warned?.add(blockKey)
        makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, { note: acceptanceGate.note ?? 'ACCEPTANCE_BLOCKED（缺验收标准，task-39）' })
      }
      return fail(acceptanceGate.note ?? 'ACCEPTANCE_BLOCKED（缺验收标准，task-39）')
    }
    if (acceptanceGate.note !== undefined) {
      makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, { note: acceptanceGate.note })
    }
    // 派工对象解析（轨2 R1①，studio-dev-345）：面开且无 assignee→分配器选人+写回平台
    // （在途最小/同级轮转/并发帽；失败 fail-closed 顺延不回退缺省人）；体=assign/auto-assign.ts
    const resolved = await resolveDispatchPerson(assignRuntime(), { ticket, fresh, ...(autoAssign !== undefined ? { carried: autoAssign } : {}), ...(dispatchPersons !== undefined ? { dispatchPersons } : {}) })
    if (!resolved.ok) return fail(resolved.detail)
    const person = resolved.person
    // 任职闸门执行位兜底（v2/02 §3.4，防自动分配换人/新调用面绕过）：进入预算/装配/launch
    // 之前再判一次——决策位（core HOLD_NOT_IN_SERVICE）已拒，此处 fail-closed、零副作用。
    const employmentRefusal = rt.hrGate.refusalOf(person.id)
    if (employmentRefusal !== undefined) return fail(employmentRefusal)
    // 775/C3 执行类单据监控：受监控岗位（如发布岗 REL-1）被指派含执行关键词单据 →
    // ESCALATE 人工复核 + 拒派（防绕过 719 审批执行 deploy/tag/push）。面关（roles 未配）零行为变。
    const executionGuard = executionGuardHit({
      title: fresh.title,
      ...(fresh.description !== undefined ? { description: fresh.description } : {}),
      personId: person.id,
      ...(person.role !== undefined ? { personRole: person.role } : {}),
      ...(config.executionGuardRoles !== undefined ? { guardRoles: config.executionGuardRoles } : {}),
      ...(config.executionGuardKeywords !== undefined ? { keywords: config.executionGuardKeywords } : {}),
    })
    if (executionGuard.hit) {
      makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, {
        note: `执行类单据指派受监控岗位（775/C3）：assignee=${person.id};role=${String(person.role)};keyword=${String(executionGuard.keyword)}——拒派人工复核`,
      })
      return fail(`执行类单据不得派给发布岗（775/C3）：assignee=${person.id}; keyword=${String(executionGuard.keyword)}——已 ESCALATE`)
    }
    // 模型档选位（studio-dev-196）：单>岗>角色三级解析（model-tier.ts）；面关（models.yaml
    // 未装载）=tierFace undefined，选位与现行为逐字节一致。档面在 resume 面前：resume 不可
    // 续的 fallback=档位适配器（降级新派不降档——接力同档）。
    const tierResolve = resolveModelTier(
      {
        ticket,
        assignee: fresh.assignee,
        people,
        jobAnchor: index.jobAnchorOf(ticket),
        jobTierOf: (id) => ledger.getJob(id)?.model_tier,
      },
      config,
    )
    const tierFallback = registry.pick()
    const tierFace =
      tierResolve !== undefined && tierFallback !== undefined
        ? modelTierDispatchFace(registry, tierResolve.tier, tierFallback, rt.config.tierExecutors?.[tierResolve.tier])
        : undefined
    // resume 面（129-E 单E）：指名解析优先（同一家原生续跑），不可续=明报降级走 pick 新派
    //（resumeDispatchFace 一次取齐适配器/观测锚/装配入参——faces 件，语义源 relay-resume.ts；
    // fallback=档位适配器——tier 面选位先于 resume 判定，见上）
    let resumeFace: ResumeDispatchFace | undefined =
      resumePlan !== undefined ? resumeDispatchFace(registry, resumePlan, tierFace?.adapter ?? registry.pick()) : undefined
    // 档位既有候选（resume＞tier＞pick；未配 sources[].executor 时与 task-141 前同序同值）
    const tierCandidate: ExecutorAdapter | undefined =
      resumeFace !== undefined && resumeFace.adapter !== undefined ? resumeFace.adapter : (tierFace?.adapter ?? registry.pick())
    if (tierCandidate === undefined) return fail('注册表无存活 executor（registry.pick 空）', { kind: 'missing', capabilityRef: 'executor:registry.pick' })
    const attempt = index.attemptOf(ticket)
    // —— task-141 源 executor 面（docs/quality/model-routing.md §10）：本档 sources[].executor 在场=面开 ——
    //   ① 选择闸放行集合=tierExecutors ∪ **本档** sources executor 家族（按派发档位取、他档不放行；空集=原 deps，零漂移）；
    //   ② 预绑：零 token、无预算预检探源（排序与精确选源同序——差额只在预算预检，由绑定段后的
    //      精确选源 routeAndBind 收敛换绑）→ 显式 executor=registry.resolve 指名，缺省=档位候选原样；
    //   ③ 续跑：路由源 executor 非续跑同族 → 不强行续跑，降级新派（F1-15 明报锚，不静默）。
    const tierSources = tierResolve !== undefined ? rt.modelRouting?.sources[tierResolve.tier] : undefined
    const sourceFamilies = sourceExecutorFamilies(tierSources)
    const selectionDeps =
      sourceFamilies.size > 0 && rt.deps.dispatchSelection !== undefined
        ? { ...rt.deps.dispatchSelection, sourceExecutors: sourceFamilies }
        : rt.deps.dispatchSelection
    const executorArmed = (tierSources ?? []).some((source) => source.executor !== undefined)
    let resumeLocked = false // 续跑同族位优先于源 executor 位（对账 reconcileSourceResume——routing/source-executor.ts）
    let candidate = tierCandidate
    if (executorArmed && tierResolve !== undefined && rt.modelRouting !== undefined && tierSources !== undefined) {
      const probe = selectModelSource({ tier: tierResolve.tier, sources: tierSources, state: rt.modelRouting.state, now: now(), tokens: { input: 0, output: 0 }, quota: rt.modelRouting.quota, probeTicket: ticket })
      if (probe.ok) {
        const picked = adapterForSource(probe.source, registry, tierCandidate)
        if (picked.kind === 'err') return fail(`MODEL_ROUTING_FAIL;tier=${tierResolve.tier};reason=EXECUTOR_UNKNOWN;${picked.error}（task-141 fail-closed 不降档）`)
        const reconciled = reconcileSourceResume(resumeFace, probe.source, picked.value)
        candidate = reconciled.adapter
        resumeFace = reconciled.face
        resumeLocked = reconciled.resumeLocked
      }
      // 探源不可用（全源冷却/额度耗尽）→ 候选沿档位既有链；精确选源在绑定段后如实 HOLD/fail
    }
    let launched: Handle | undefined
    let prevUmask: number | undefined
    let boundLive: BoundDispatch | undefined // 当前绑定的适配器（catch 段 kill 用；launched 在 ⇒ 必在）——首绑即登记，不依赖换绑
    let pendingInstructions: string | undefined // bridge 通道指令文件（绑定段落盘前登记；派发未成即删——首绑/换绑同口径）
    let dispatched = false // 终局成功标志：finally 据此清指令文件（段内抛错/launch 失败/拒派/换绑未成一处收口）
    let launchTried = false // launch 已尝试=被弃段已 spawn（登记行留痕）；未尝试=换绑前须撤其派生登记
    try {
      // workspace 落点（DEV-28，docs/43-§五 派发权限圈①cwd）：aiwsRoot 给定 → 员工家
      // .AIWS/<部门路径>/<工号>/tickets/<单号>/att<N>（收割四要件与 deliverables 收账经
      // dirname(briefPath) 随迁——闸门/台账引用零改动）；缺省 → 旧一次性布局（引擎直连
      // 测试回退面，serve 恒注入 aiwsRoot——正式链路一律员工家）
      const workspace =
        config.aiwsRoot !== undefined
          ? aiwsWorkspaceOf(config.aiwsRoot, person, ticket, attempt)
          : path.join(config.rootDir, 'workspaces', ticket, `att${attempt}`)
      const briefPath = path.join(workspace, 'brief.md')
      const stageBase = {
        rt, ticket, fresh, person, attempt, tickEvents, workspace, briefPath, selectionDeps, fail,
        setPrevUmask: (prev: number): void => { prevUmask ??= prev }, // 首次登记生效（换绑重跑不覆盖原 mask）
        noteInstructions: (target: string): void => { pendingInstructions = target },
      } satisfies Omit<BoundStageInput, 'candidate' | 'resumeFace'>
      const first = await runBoundStage({ ...stageBase, candidate, resumeFace })
      if (first.kind === 'failed') return first.result
      let bound: BoundDispatch = first.bound
      boundLive = bound
      const adopt = (next: BoundDispatch): void => {
        bound = next
        boundLive = next
      }
      const at = bound.at // 段内时点（选择闸后、preflight 前——与 task-141 前同位；换绑不改，reserve/工时单同一钟）
      // 预算闸（TaskBrief 构造后、launch 前——20-§六.8 机制点）：估算（两态）→ reserve
      // 判定 → 过闸=双行落账（issue 先 person 后；落账与 launch 之间失败=不派，异常
      // 上抛本 catch→DISPATCH_FAIL）；超帽=refusal 行落账+不派；duplicate=沿用未结预留
      // （失败保留重派语义）。拟稿待批点清单见 src/engine/budget-gate.ts 头注。
      // —— task-56 多源路由：选源（优先级+quota 池化打分+可用性+预算预检）→ per-source
      //    overlay → 源价目预算闸 ——
      //    task-135 收尾：① allowBudgetDowngrade 读引擎配置（daemon.yaml；缺省 false=现状
      //    HOLD 不降档）；② 同 dispatch 内一次换源（launch 失败且无首段输出→冷却+留痕→
      //    对下一源重试一次；见下方 launch 段 routeFailoverOn）。
      //    task-141：本档显式 sources[].executor 在场=路由面开（不限 dsh 名）；选中源 executor
      //    与绑定不同→换绑适配器（routeAndBind）。
      let routedSource: ModelSourceSpec | undefined
      let routedCatalog: ReturnType<typeof createModelCatalog> | undefined
      let routingNote = ''
      let routedBinding: { dsh: OverlayFace; overlay: string | undefined; model: string | undefined } | undefined
      const routingActive = rt.modelRouting !== undefined && tierResolve !== undefined && rt.catalog !== undefined && (bound.adapter.name === 'dsh' || executorArmed)
      // 最近一次选源的预算上下文（HOLD 事件 note 复用；每次选源（含换源重选）刷新）
      let heldTicketCap: number | undefined
      let heldTicketRemaining: number | undefined
      let heldCompanyRemaining: number | undefined
      /** 选源（预算按当前台账折叠重算——launch 失败换源重选时已含本次 reserve）；非路由面=undefined */
      const selectRouted = (): SelectOutcome | undefined => {
        if (!routingActive || rt.modelRouting === undefined || tierResolve === undefined || rt.catalog === undefined) return undefined
        const sources = rt.modelRouting.sources[tierResolve.tier]
        if (sources === undefined || sources.length === 0) return undefined
        const briefChars = bound.assembled.brief.text.length
        const inputTokens = Math.ceil(briefChars / 4)
        const tokens = { input: inputTokens, output: Math.ceil(inputTokens * 0.5) }
        const ticketCap = bound.taskBrief.budgetCap?.usd ?? config.budgetTicketCapUsd
        // task-66 F3：remaining = cap − settled − reserved（沿用 budget-gate 的 issue/person/company 行折叠口径）
        const budgetState = foldBudgets([
          ...ledger.queryBudgets({ scope_kind: 'issue', scope_id: ticket }),
          ...ledger.queryBudgets({ scope_kind: 'person', scope_id: person.id }),
          ...ledger.queryBudgets({ scope_kind: 'company', scope_id: config.company }),
        ])
        const ticketView = budgetView(budgetState, 'issue', ticket)
        const ticketRemaining = ticketCap !== undefined ? Math.max(0, ticketCap - ticketView.settled - ticketView.reserved) : undefined
        const companyView = budgetView(budgetState, 'company', config.company)
        const companyRemaining = costGuard !== undefined
          ? Math.max(0, costGuard.dailyBudgetUsd.company - companyView.settled - companyView.reserved)
          : undefined
        heldTicketCap = ticketCap
        heldTicketRemaining = ticketRemaining
        heldCompanyRemaining = companyRemaining
        // task-135：allowBudgetDowngrade 接配置（daemon.yaml 布尔；缺省 false=现状 HOLD 不降档）
        const allowDowngrade = config.allowBudgetDowngrade === true
        return selectModelSource({
          tier: tierResolve.tier,
          sources,
          state: rt.modelRouting.state, quota: rt.modelRouting.quota, probeTicket: ticket, // task-157：供给级配额池（supply-quota-gating.md §2.5）
          now: at,
          tokens,
          budget: {
            ...(ticketRemaining !== undefined ? { ticketRemainingUsd: ticketRemaining } : {}),
            ...(companyRemaining !== undefined ? { companyRemainingUsd: companyRemaining } : {}),
            allowBudgetDowngrade: allowDowngrade,
          },
        })
      }
      /** 预算 HOLD 事件（task-66 F4 去重：同 ticket+source 一次；连续 tick 重试不刷屏） */
      const emitBudgetHold = (outcome: Extract<SelectOutcome, { ok: false }>): void => {
        if (outcome.reason !== 'BUDGET_EXCEEDED') return
        const warnKey = `${ticket}|${outcome.source?.id ?? 'none'}|budget-hold`
        if (rt.routingWarnings.has(warnKey)) return
        rt.routingWarnings.add(warnKey)
        makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, {
          note: `MODEL_ROUTING_BUDGET_HOLD;tier=${tierResolve?.tier ?? 'n/a'};cap=${heldTicketCap !== undefined ? `ticket=$${String(heldTicketCap)}` : 'ticket=none'};remaining=ticket=$${heldTicketRemaining !== undefined ? heldTicketRemaining.toFixed(4) : 'n/a'};company=$${heldCompanyRemaining !== undefined ? heldCompanyRemaining.toFixed(4) : 'n/a'};estimated=$${outcome.estimatedUsd?.toFixed(4) ?? 'n/a'};source=${outcome.source?.id ?? 'n/a'}${config.allowBudgetDowngrade === true ? '（task-135 budget HOLD；allowBudgetDowngrade=true 全源超帽）' : '（task-66 budget HOLD；不降档）'}`,
        })
      }
      /** 选中源 → per-source 价目目录 + DISPATCH note 段（换源时 fallbackFrom 留痕；源锚=id[@executor]） */
      const applyRoutedSource = (source: ModelSourceSpec, skipped: readonly string[], fallbackFrom?: ModelSourceSpec): void => {
        if (rt.catalog === undefined || tierResolve === undefined) return
        const tiers = Object.fromEntries(rt.catalog.tiers().map((t) => [t.tier, { provider: t.provider, model: t.model, price: t.price }])) as ModelsConfig['tiers']
        tiers[tierResolve.tier] = { provider: source.provider, model: source.model, price: source.price }
        routedCatalog = createModelCatalog({ tiers, roles: rt.config.modelTierByRole ?? { main_worker: 'mid' } })
        routingNote = `;routing=${sourceRef(source)}${fallbackFrom !== undefined ? `;routing-fallbackFrom=${sourceRef(fallbackFrom)}` : ''};routing-price=in$${String(source.price.inputPerM)}/out$${String(source.price.outputPerM)}${skipped.length > 0 ? `;routing-skipped=${skipped.join('|')}` : ''}${quotaProbeNote(rt, source, ticket, now())}`
      }
      /** 换绑前清理上一适配器的指令文件/AGENTS.md（通道不同=旧产物成孤儿；同通道由重跑段覆写） */
      const discardBound = (next: ExecutorAdapter): void => {
        const nextNative = next.capabilities.agents_md === 'native'
        if (bound.nativeAgents && !nextNative) rmSync(bound.agentsTarget, { force: true })
        if (!bound.nativeAgents && nextNative && bound.instructionsPath !== undefined) removeInstructions(bound.instructionsPath)
      }
      /**
       * 精确选源并收敛到源 executor 的适配器（task-141）：选中源 executor 与当前绑定不同 → 换绑
       * （清理上一适配器产物→绑定段整段重跑→以新装配重选）；选择闸改派（chainLocked）/续跑同族位
       * =链与会话优先，不换绑——链执行器非选中源家族时源未实际执行，不归因（无源锚/冷却/FAILOVER）。
       * 每轮收敛（首绑收敛／launch 失败换源收敛各一轮）至多换绑一次；换绑后重选仍指向他执行器
       * =不稳定，fail-closed 明报。launch 未尝试的换绑先撤被弃段派生登记（无撤销口=不换绑）。
       */
      const routeAndBind = async (fallbackFrom?: ModelSourceSpec): Promise<RouteStep> => {
        let rebinds = 0
        for (;;) {
          const outcome = selectRouted()
          if (outcome === undefined) return { kind: 'off' }
          if (!outcome.ok) return { kind: 'unavailable', outcome }
          const want = executorArmed ? adapterForSource(outcome.source, registry, tierCandidate) : undefined
          if (want?.kind === 'err') return { kind: 'failed', result: fail(`MODEL_ROUTING_FAIL;tier=${tierResolve?.tier};reason=EXECUTOR_UNKNOWN;${want.error}（task-141 fail-closed 不降档）`) }
          if (want?.kind === 'ok' && want.value !== bound.adapter && !bound.chainLocked && !resumeLocked) {
            if (rebinds >= 1) return { kind: 'failed', result: fail(`MODEL_ROUTING_FAIL;tier=${tierResolve?.tier};reason=EXECUTOR_REBIND_UNSTABLE;换绑后重选仍指向他执行器 ${want.value.name}（已绑 ${bound.adapter.name}）——task-141 每轮收敛至多换绑一次，fail-closed 不降档`) }
            rebinds += 1
            if (!launchTried) {
              // 被弃段未 spawn：先撤其派生登记（登记面无撤销口/撤销被拒=不换绑 fail-closed——不留「未发生的派生」行）
              const refusal = retireDispatchDerivation(rt.deps.derivationRegistry, bound.derivationId)
              if (refusal !== undefined) return { kind: 'failed', result: fail(`MODEL_ROUTING_FAIL;tier=${tierResolve?.tier};reason=EXECUTOR_REBIND_UNREVOKED;换绑前撤销被弃段派生登记未成（${bound.derivationId}：${refusal}）——不换绑，task-141 fail-closed`) }
            }
            discardBound(want.value)
            const rerun = await runBoundStage({ ...stageBase, candidate: want.value, resumeFace })
            if (rerun.kind === 'failed') return { kind: 'failed', result: rerun.result }
            adopt(rerun.bound)
            continue // 以新装配重选（任务书长度随适配器变——预算预检以新装配为准）
          }
          if (want?.kind === 'ok' && want.value !== bound.adapter && !sameExecutorFamily(want.value, bound.adapter)) return { kind: 'bound' } // 链执行器非源家族：源未实际执行，不归因
          routedSource = outcome.source
          applyRoutedSource(routedSource, outcome.skipped, fallbackFrom)
          return { kind: 'bound' }
        }
      }
      const restoreRoutedBinding = (): void => {
        // task-66 F2：launch 后清回；argv 已在 spawn 时快照，在途子进程不受影响；失败也清
        if (routedBinding === undefined) return
        routedBinding.dsh.setSourceOverlay?.(routedBinding.overlay)
        routedBinding.dsh.setModel?.(routedBinding.model)
      }
      /**
       * 源 overlay/model 绑定到当前适配器：dsh 家族=per-source overlay + setModel（task-56）；非 dsh
       * 执行器不套 overlay（task-141：适配器无 overlay 端子，源 provider/model 只作价目/身份）。
       * 首绑记回滚值；换绑到新适配器=先清回旧适配器再记新回滚值（finally 只清回当前绑定）。
       */
      const bindRoutedOverlay = (): void => {
        if (routedSource === undefined || rt.modelRouting === undefined || tierResolve === undefined) return
        const dsh = bound.adapter as OverlayFace
        if (executorArmed && typeof dsh.setSourceOverlay !== 'function' && typeof dsh.setModel !== 'function') {
          restoreRoutedBinding()
          routedBinding = undefined
          return
        }
        const overlayPath = provisionSourceOverlay(rt.modelRouting.rootDir, tierResolve.tier, routedSource)
        if (routedBinding === undefined || routedBinding.dsh !== dsh) routedBinding = { dsh, overlay: dsh.getSourceOverlay?.(), model: dsh.getModel?.() }
        dsh.setSourceOverlay?.(overlayPath)
        dsh.setModel?.(`${routedSource.provider}/${routedSource.model}`)
        // task-59：success 归 harvest 收口（launch 成功≠收割成功），此处不写 success/状态
      }
      const routingOutcome = await routeAndBind()
      if (routingOutcome.kind === 'failed') return routingOutcome.result
      if (routingOutcome.kind === 'unavailable') {
        emitBudgetHold(routingOutcome.outcome)
        const note = `MODEL_ROUTING_FAIL;tier=${tierResolve?.tier};reason=${routingOutcome.outcome.reason};${routingOutcome.outcome.detail}（task-56 fail-closed 不降档）`
        return fail(note)
      }
      const personDay = personDayGateInput(costGuard, person, ledger, at) // 闸四·人日 hard 线（R6）：段声明且有 gate 档才带
      const gateDeps = routedCatalog !== undefined ? { ...budgetDeps, catalog: routedCatalog } : budgetDeps
      const gate = await gateDispatch(gateDeps, {
        ticket,
        personId: person.id,
        adapter: bound.adapter,
        taskBrief: bound.taskBrief,
        briefChars: bound.assembled.brief.text.length,
        ...(config.budgetTicketCapUsd !== undefined ? { fallbackTicketCapUsd: config.budgetTicketCapUsd } : {}),
        ...(config.budgetPersonCapUsd !== undefined ? { personCapUsd: config.budgetPersonCapUsd } : {}),
        ...(personDay !== undefined ? { personDay } : {}),
        now: at,
      })
      if (gate.kind === 'refused') {
        budget.budgetRefused += 1
        if (bound.instructionsPath !== undefined) removeInstructions(bound.instructionsPath) // 拒派即删（无收割会来收本 attempt）
        return fail(
          `budget-refusal:${gate.reason}：估算 $${gate.estimated} + 在途 $${gate.inflight} 超帽 $${gate.cap}` +
            `——refusal 行已落账（可查，F1-09），不派（20-§六.8 预留不落即不派的镜像面）`,
          { kind: 'cost_runaway', capabilityRef: `ticket:${ticket}/budget` },
        )
      }
      if (gate.kind === 'reserved') budget.budgetReserved += 1
      bindRoutedOverlay()
      rt.crash.dispatchReserved() // 崩溃注入①（F3-11）：reserve 双行已落账、launch 前——受控测试缝，默认零行为（src/engine/crash-points.ts）
      // worker wkey 签发+注入（17-§7：预算过闸后、launch 前——超帽拒派不签发凭据）：
      // mint（scope=六动词全集、一 attempt 一 key）→ TaskBrief.credentials（v1.4 env 通道，
      // 2026-10-18 制作人定调）——适配器无条件透传进子进程 env；daemon 不留 token 副本
      //（审计锚=下方 DISPATCH note 携 nonce；凭据值红名单，任何 note/日志永不含）
      const minted =
        workerKeys !== undefined
          ? mintWorkerKey(workerKeys.gateway, {
              ticket,
              ...(workerKeys.makeNonce !== undefined ? { makeNonce: workerKeys.makeNonce } : {}),
            })
          : undefined
      // Kimi via DSH（docs/quality/kimi-on-dsh.md §4）：实际生效 provider=kimi-coding 且执行器为
      // dsh 家族时，launch 前现读（按需刷新）token 文件注入 KIMI_API_KEY（同 v1.4 env 通道；
      // 凭据值红名单，任何 note/日志/台账永不含）。fail-safe：文件缺失/刷新败=不注入不阻派发
      //（worker AUTH 失败收场→路由按 auth 类冷却换源，glm-main 兜底）。failover 换源后重建 brief。
      // 注入 provider=「实际生效源」：路由面选中源优先（routedSource，failover 换源随重建刷新）；
      // 无路由面但 tier overlay 生效时取 tier 解析 provider（models.yaml hot-swap 写
      // var/tmp/dsh-tier-<tier>.yml 仍生效）——事故 2026-11-23：tier 执行器名（dsh-high/dsh-mid/
      // dsh-low）下 routingActive 不成立、routedSource 恒 undefined，注入只认 routedSource 致
      // worker 拿不到 KIMI_API_KEY 必败（GATE_FAIL 连击→熔断）。两者皆无=undefined 不注入。
      const tierProvider = tierResolve !== undefined
        ? rt.catalog?.tiers().find((t) => t.tier === tierResolve.tier)?.provider
        : undefined
      const buildLaunchBrief = async (): Promise<TaskBrief> => {
        const kimiCreds = await kimiTokenCredentials(rt.deps.kimiToken, { executorName: bound.adapter.name, provider: routedSource?.provider ?? tierProvider })
        return {
          ...bound.taskBrief,
          ...(minted !== undefined || kimiCreds !== undefined
            ? { credentials: { ...(minted !== undefined ? workerKeyCredentials(minted.token) : {}), ...(kimiCreds ?? {}) } }
            : {}),
        }
      }
      const launchBrief: TaskBrief = await buildLaunchBrief()
      // task-135 同 dispatch 内一次换源：launch 抛错=未产生首段输出，且失败类可换源
      //（400/拒答不换——设计 §3）→ 冷却当前源+留痕 MODEL_ROUTING_FAILOVER → 重选下一源
      // → 重绑 overlay/model → 重试 launch 一次（每 dispatch 至多 1 次换源、每源至多 1 次）。
      // 预算闸不重跑：本次 reserve 未结，gateDispatch adopt 语义「一笔预留服务 N 次尝试」
      // 覆盖重试；重选预检按落账后折叠（已含 reserve）判新源是否超帽。
      // task-141：下一源 executor 不同=换绑适配器（绑定段重跑）；留痕带 from/to=<id@executor>。
      let failoverUsed = false
      let failoverNote = ''
      const routeFailoverOn = async (err: unknown, firstMsg: string): Promise<FailoverStep> => {
        if (!routingActive || rt.modelRouting === undefined || tierResolve === undefined || routedSource === undefined || failoverUsed) return { kind: 'not' }
        if (!isFailoverClass(classifyFailure(err))) return { kind: 'not' }
        failoverUsed = true
        // 失败登记：冷却+持久化（daemon_kv 与 harvest 回填同键同口径）；quota 类另记供给池（task-157 §2.2）
        const rec = recordRoutedFailure(rt, routedSource, err, at)
        // 重选（状态已含冷却→当前源自然跳过；预算按落账后折叠重算）
        const outcome = selectRouted()
        // 留痕（task-66 F4 同口径去重：同票同源一次；task-141 面开时带 from/to 源锚；task-157 去重键加 resetAt=探针再败另留一条）
        const warnKey = `${ticket}|${routedSource.id}|launch-failover|${rec.cls.resetAt ?? 'none'}`
        if (!rt.routingWarnings.has(warnKey)) {
          rt.routingWarnings.add(warnKey)
          makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, {
            note: `MODEL_ROUTING_FAILOVER;tier=${tierResolve.tier};source=${executorArmed ? sourceRef(routedSource) : routedSource.id};class=${rec.class};cooldownMs=${String(rec.cooldownMs)}${executorArmed && outcome !== undefined && outcome.ok ? `;from=${sourceRef(routedSource)};to=${sourceRef(outcome.source)}` : ''}（task-135 同dispatch换源）${rec.note}`,
          })
        }
        if (outcome === undefined || !outcome.ok) {
          if (outcome !== undefined) emitBudgetHold(outcome)
          failoverNote = outcome !== undefined && !outcome.ok ? `换源不可用（${outcome.reason};${outcome.detail}）` : '换源不可用（无路由源）'
          return { kind: 'not' }
        }
        const step = await routeAndBind(routedSource)
        if (step.kind === 'failed') return { kind: 'failed', result: { ...step.result, detail: `launch 失败且跨执行器换源未成（首源错误：${firstMsg}）：${step.result.detail}` } }
        if (step.kind !== 'bound') {
          failoverNote = '换源不可用（无路由源）'
          return { kind: 'not' }
        }
        bindRoutedOverlay()
        return { kind: 'switched' }
      }
      launchTried = true
      try {
        launched = await bound.adapter.launch(launchBrief)
      } catch (launchErr) {
        const firstMsg = launchErr instanceof Error ? launchErr.message : String(launchErr)
        const step = await routeFailoverOn(launchErr, firstMsg)
        if (step.kind === 'failed') return step.result
        if (step.kind === 'not') {
          if (failoverNote !== '') throw new Error(`${firstMsg}；${failoverNote}`)
          throw launchErr
        }
        try {
          launched = await bound.adapter.launch(await buildLaunchBrief()) // 换源后重建 brief（新源非 kimi-coding 即不再注入；跨执行器=新适配器新任务书）
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          throw new Error(`launch 失败且同 dispatch 换源重试仍失败（${executorArmed && routedSource !== undefined ? sourceRef(routedSource) : (routedSource?.id ?? 'n/a')}；首源错误：${firstMsg}）：${retryMsg}`)
        }
      } finally {
        restoreRoutedBinding()
      }
      rt.crash.dispatchLaunched() // 崩溃注入②（F3-11）：launch 已返回、work_records 在途落账前——受控测试缝，默认零行为
      startSessionArchive(ledger, { ticket, personId: person.id, sessionId: launched.sessionId, at }) // 相位 3 会话归档 start 行（写失败抛→DISPATCH_FAIL，无归档不派）
      const liveLaneEpoch = lanes.acquire(action.lane, ticket, at) // studio-dev-809/812：二次 acquire 保留；inflight 用最新租约 epoch
      const transitioned = await platform.issues.transition(ticket, action.toState)
      const workRecordId = makeId(at)
      ledger.insertWorkRecord({
        id: workRecordId,
        issue: ticket,
        person_id: person.id,
        executor: bound.adapter.name,
        session_id: launched.sessionId,
        lane: action.lane,
        started_at: at,
        attempt,
        status: 'running',
      })
      inflight.set(ticket, {
        ticket,
        workRecordId,
        executor: bound.adapter.name,
        handle: launched,
        workspace,
        briefPath,
        attempt,
        lane: action.lane,
        laneEpoch: liveLaneEpoch,
        personId: person.id,
        ...(routedSource !== undefined && tierResolve !== undefined ? { routedSourceId: routedSource.id, routedTier: tierResolve.tier } : {}),
        startedAt: at,
        dispatchedAtSeq: seq,
        ...(bound.instructionsPath !== undefined ? { instructionsPath: bound.instructionsPath } : {}),
      })
      yieldAttemptCloseout(rt.attemptCloseouts, ticket, attempt) // FIX-04 ①：新派发让位同号/降号旧认领（T7 誓号复用不卡死）
      syncMirror(transitioned)
      // 记录族生产写面·相位 3 派发（docs/17-§2）：迁移→REC-WORK-06（前置不齐即拒，不臆造）
      if (records !== undefined) {
        const facts = rt.deps.recordPhaseFacts?.start({ ticket, attempt, at, actor: person.id, fromState: fresh.state, toState: action.toState })
        recordStartChain({ records, ticket, attempt, fromState: fresh.state, toState: action.toState, at, actor: person.id, ...(facts !== undefined ? { facts } : {}) })
      }
      // 队列等待锚（129-§6.2-R4）：DISPATCH note 尾携 wait/prio/boost（锚形冻结；计算体拆入 todoqueue/queue.ts）
      const queueAnchorInfo = queueDispatchAnchor(queueCarry, ticket, at)
      // 档位锚：未配 executor / 绑定即档位候选=档位既有锚；源 executor 换绑=改述源 executor 绑定（task-141）
      const tierAnchor = (): string => {
        if (!executorArmed || bound.adapter === tierCandidate) return tierFace?.noteAnchor ?? ''
        return `;tier=${tierResolve?.tier}@${bound.adapter.name}（${bound.chainLocked ? '选择链改派，不按源 executor 换绑' : `源 executor=${routedSource !== undefined ? sourceRef(routedSource) : 'n/a'}`}，task-141）`
      }
      // resume 观测锚（129-E，F1-15「续跑派发不静默」）：note 尾锚+causation_id=上次工时单 id
      //（两形都带——因果链不因降级断；锚形见 faces 件 resumeDispatchFace 头注）
      makeEvent('DISPATCH', transitioned, attempt, tickEvents, {
        size: Buffer.byteLength(bound.assembled.agentsMd.text, 'utf8'),
        payload_hash: `sha256:${createHash('sha256').update(bound.assembled.agentsMd.text, 'utf8').digest('hex')}`,
        ...(resumeFace !== undefined ? { causation_id: resumeFace.causationId } : {}),
        note: `fp=${bound.assembled.agentsMd.fingerprint};intent=${intentKey};executor=${bound.adapter.name}@${bound.detect.version}${tierAnchor()};read=${bound.readTier};agents=${bound.agentsTarget};brief=${briefPath};budget=${gate.kind === 'reserved' ? `reserve$${gate.estimated.toFixed(4)}` : `adopt$${gate.estimated.toFixed(4)}`}${minted !== undefined ? `;wkey=env:${WORKER_WKEY_ENV_KEY}:nonce=${minted.nonce}` : ''}${action.breakerProbe === true ? `;breaker=half-open-probe（冷却窗过——单次试探：成功即复位，失败回全开续冷却，DEV-46）` : ''}${bound.seatbeltSegment}${bound.selectionAnchor}${bound.prm.noteAnchor}${resolved.autoAssignNote ?? ''}${queueAnchorInfo.waitAnchor}${resumeFace?.noteAnchor ?? ''}${routingNote}`,
      })
      // 派发成功即出队（129-§6.2）：携带条删——GATE_FAIL 回滚再入队走 touchQueueCarry
      // 新钟（attempt 轮次可区分，队列等待观测口径=每誓一钟，不跨轮累计）。
      if (queueAnchorInfo.entry !== undefined) dropQueueCarry(queueCarry, [ticket])
      // 单据房间供给（130-P3/DEV-20 P9）：ensureTicketRoom；失败 ESCALATE 不阻派发（幂等重跑收敛）
      if (rooms !== undefined) await dispatchRoomDuty(rooms, { ticket, title: fresh.title, dept: fresh.dept ?? person.dept, assignee: person.id }, (note) => makeEvent('ESCALATE', transitioned, attempt, tickEvents, { note }))
      dispatched = true
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail:
          `attempt=${attempt} executor=${bound.adapter.name} lane=${action.lane}` +
          `;budget=${gate.kind === 'reserved' ? `reserve $${gate.estimated.toFixed(4)}` : `adopt（沿用未结预留）$${gate.estimated.toFixed(4)}`}` +
          (resumeFace?.detailSegment ?? ''),
      }
    } catch (err) {
      // 派发失败如实分类上报（DISPOSITIONS: DISPATCH_FAIL/retry）；v0 不计断路连击（拟稿）
      const msg = err instanceof Error ? err.message : String(err)
      if (launched !== undefined && boundLive !== undefined) await boundLive.adapter.kill(launched, config.killGraceMs).catch(() => undefined)
      // bridge 临时指令文件的清理归 finally（pendingInstructions：首绑即登记，不依赖换绑）
      // 已签发的 worker wkey 随失败撤离（env 通道：launch 失败=凭据未进任何存活子进程，
      // token 只活在本次调用栈——丢弃即离场；不吊销 ticket——重试重签同 ticket，ticket 级
      // 吊销是终局动作，见 worker-key.ts 头注拟稿；失效兜底=TTL+nonce 单次）。
      return fail(`DISPATCH_FAIL：${msg}`)
    } finally {
      // P3-② 权限前移窗收口：恢复派发前 umask（早退面——detect 不达标/预算拒派/launch
      // 异常——同样不泄漏全局态）
      if (prevUmask !== undefined) process.umask(prevUmask)
      // 派发未成（段内抛错/launch 失败/拒派/换绑未成）：bridge 临时指令文件即删——无收割会来收本 attempt，留着即泄漏
      if (!dispatched && pendingInstructions !== undefined) removeInstructions(pendingInstructions)
    }
  }
