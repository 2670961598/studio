/**
 * engine/dispatch/execute.ts —— 派发相位执行体（executeDispatch，原 engine.ts 内函数）
 *
 * 20-§十五「按域拆件、零行为变更」：函数体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写）。
 * 派发序不变：装配（指令文件按通道能力路由落盘：native=workspace AGENTS.md；bridge 通道=
 * 每任务临时文件 instructions-store.ts）→ **预算闸（reserve 双行落账→才 launch，
 * 20-§六.8 不落即不派）** → registry 选适配器 → launch → work_records 落在途
 * → 平台迁已派发 → events 落 DISPATCH（note 携分层指纹与 intentKey——幂等索引依据）。
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
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EventRecord, Handle, TaskBrief, TicketId } from '@studio-next/contract'
import type { Action } from '@studio-next/core'
import { resolveDispatchPerson, type AutoAssignCarry } from '../assign/auto-assign.ts'
import { gateDispatch } from '../budget-gate.ts'
import { makeDispatchFail } from '../capability/index.ts'
import { personDayGateInput } from '../cost-guard/fold.ts'
import { WORKSPACE_UMASK } from '../jobs/harvest-recon.ts'
import { sentinelBriefBlock, sentinelDutyForTicket } from '../jobs/sentinel.ts'
import { instructionsTarget, removeInstructions, writeInstructions } from '../instructions-store.ts'
// 执行器选择链钩子（studio-dev-620；v2/07 §一）：钩子体驻 work/dispatch-selection.ts，
// 本文件只留相位 3 一次接线（engine.ts 零改动——#556 拆件后派发体在本文件）。
import { executionGuardHit, gateDispatchSelection } from '../work/dispatch-selection.ts'
import { resumeDispatchFace } from '../intents/relay-resume-faces.ts'
import type { ResumeDispatchPlan } from '../intents/relay-resume.ts'
import { applyDispatchProjection } from '../prm/dispatch-projection.ts'
// 定价发布生成缝（studio-dev-554/rework-584）：附件生成＋失败告警收在 pricing/publish.ts，
// 本文件只留一次调用（engine.ts 298 行不增——#556 拆件后派发体在本文件）。
import { preparePricingAttachment } from '../pricing/publish.ts'
import { aiwsWorkspaceOf } from '../prompt-assembly.ts'
import { blindArtifactPaths, createView, resolveReadTier, roleOfAssignee } from '../read-tiers.ts'
import { recordStartChain } from '../records/hooks.ts'
import { dispatchRoomDuty } from '../rooms/room-duty.ts'
import type { EventIndex } from '../sentinel/events-index.ts'
import { modelTierDispatchFace, resolveModelTier } from '../tier/model-tier.ts'
import type { TickActionResult, TickPhaseDispatchBudget } from '../tick-report/types.ts'
import { dropQueueCarry, queueDispatchAnchor } from '../todoqueue/queue.ts'
import { startSessionArchive } from '../sessions/archive.ts' // 会话归档接线（studio-dev-551）
import { mintWorkerKey, workerKeyCredentials, workerKeyGuidance, WORKER_WKEY_ENV_KEY } from '../worker-key.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { CONVERSATION_ACCEPTANCE } from '../conversation/protocol.ts'

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
): Promise<TickActionResult> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { platform, ledger, registry, config, lanes, inflight, budgetDeps, now, makeId, records, workerKeys, rooms, queueCarry } = rt
  const people = rt.people
  const assembler = rt.assembler
  const costGuard = rt.costGuard
  const seq = rt.seq
  const makeEvent = rt.makeEvent
  const syncMirror = rt.syncMirror
  const assignRuntime = rt.assignRuntime

    const ticket = action.ticket
    // state-diff 排队时已占泳道（决策即占用）——任何失败路径都必须归还，不留死锁
    const fail = makeDispatchFail({ face: rt.deps.capabilitySupply, ticket, actionType: action.type, attemptOf: () => index.attemptOf(ticket), at: () => new Date(now()).toISOString(), releaseLane: () => lanes.release(action.lane, ticket), dropInflight: () => inflight.delete(ticket),
      emitEscalate: (note) => makeEvent('ESCALATE', fresh, index.attemptOf(ticket), tickEvents, { note }) })
    if (inflight.has(ticket)) return fail('该单已有在途工位（幂等跳过，不双写）')
    const fresh = await platform.issues.get(ticket)
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
        ? modelTierDispatchFace(registry, tierResolve.tier, tierFallback)
        : undefined
    // resume 面（129-E 单E）：指名解析优先（同一家原生续跑），不可续=明报降级走 pick 新派
    //（resumeDispatchFace 一次取齐适配器/观测锚/装配入参——faces 件，语义源 relay-resume.ts；
    // fallback=档位适配器——tier 面选位先于 resume 判定，见上）
    const resumeFace =
      resumePlan !== undefined ? resumeDispatchFace(registry, resumePlan, tierFace?.adapter ?? registry.pick()) : undefined
    const candidate =
      resumeFace !== undefined && resumeFace.adapter !== undefined
        ? resumeFace.adapter
        : (tierFace?.adapter ?? registry.pick())
    if (candidate === undefined) return fail('注册表无存活 executor（registry.pick 空）', { kind: 'missing', capabilityRef: 'executor:registry.pick' })
    const attempt = index.attemptOf(ticket)
    // 执行器选择链（studio-dev-620；v2/07 §一）：单据指定＞岗位绑定＞默认；拒派不降级
    //（ESCALATE 每单每因一次——去重账 rt.selectionRejections）。解析/适配/留痕体在
    // work/dispatch-selection.ts，本文件只留相位 3 一次调用（docs/17-§2 派发；docs/17-§6
    // 拒派=不启动——fail 后不 transition/不 launch/不落工时单）。
    const selection = gateDispatchSelection(
      rt.deps.dispatchSelection,
      { registry, ticket, personId: person.id, candidate, resumeActive: resumeFace?.active === true },
      rt.selectionRejections,
      (note) => makeEvent('ESCALATE', fresh, attempt, tickEvents, { note }),
    )
    if (selection.kind === 'err') return fail(selection.message)
    const { adapter, anchor: selectionAnchor } = selection
    // workspace 落点（DEV-28，docs/43-§五 派发权限圈①cwd）：aiwsRoot 给定 → 员工家
    // .AIWS/<部门路径>/<工号>/tickets/<单号>/att<N>（收割四要件与 deliverables 收账经
    // dirname(briefPath) 随迁——闸门/台账引用零改动）；缺省 → 旧一次性布局（引擎直连
    // 测试回退面，serve 恒注入 aiwsRoot——正式链路一律员工家）
    const workspace =
      config.aiwsRoot !== undefined
        ? aiwsWorkspaceOf(config.aiwsRoot, person, ticket, attempt)
        : path.join(config.rootDir, 'workspaces', ticket, `att${attempt}`)
    const briefPath = path.join(workspace, 'brief.md')
    // AGENTS.md 落点按 adapter 通道能力路由（04-§六 B5 + docs/25-§3.1 v1.5#1，零 if executor——
    // 只读 capabilities）：native=workspace 根（原生发现，P-07）；user_level/append=bridge
    // 插件通道——每任务指令临时文件（workspace 外，<rootDir>/tmp/instructions/<单号>.md，
    // 0600），launch env STUDIO_NEXT_INSTRUCTIONS 指向它、由宿主插件注入系统提示 persona 段
    const agentsChannelKind = adapter.capabilities.agents_md
    const nativeAgents = agentsChannelKind === 'native'
    const agentsTarget = nativeAgents
      ? path.join(workspace, 'AGENTS.md')
      : instructionsTarget(config.rootDir, ticket)
    let instructionsPath: string | undefined // bridge 通道临时文件（收割/派发失败后清理）
    const at = now()
    let launched: Handle | undefined
    let prevUmask: number | undefined
    try {
      // 派发域 seatbelt 圈定→detect 前置（SEC-FC-05 后半 / 18-§一）：顺序锚在 engine.ts
      // dispatchPreflight——圈定失败即抛 → 本 catch → DISPATCH_FAIL（detect/装配/launch 零
      // 调用）；detect 前置 launch 前必跑，不达标明报不静默降级
      const { detect, seatbeltSegment } = await rt.dispatchPreflight(adapter, ticket, workspace)
      if (!detect.ok) return fail(`executor ${adapter.name} detect 不达标：${detect.gaps.join('；')}`, { kind: 'degraded', capabilityRef: `executor:${adapter.name}`, probe: { executor: adapter.name, version: detect.version, ok: false, gaps: detect.gaps } })
      // 派生即登记（v2/07 §四规则 1；GAP-V2-04 S6）：detect 通过后、任何 spawn/预算/落盘之前落登记，
      // 失败即不派（EXEC-01 fail-closed）。只记身份/后端/能力子集/时点；wkey 是 local-mint 例外，
      // 不进静态 catalogue（78-§7.4.1），凭据继承默认无（v2/07 §四规则 3）。
      const registration = rt.deps.derivationRegistry?.register({
        derivationId: `${ticket}:att${attempt}:${adapter.name}`,
        ticket,
        executor: adapter.name,
        backend: 'external-cli',
        capabilitySubset: `executor:${adapter.name}@${detect.version}`,
        derivedAt: new Date(at).toISOString(),
      })
      if (registration !== undefined && registration.kind !== 'ok') {
        return fail(
          `derivation-registration ${registration.error.category}/${registration.error.subcause}：${registration.error.detail ?? ''}`,
        )
      }
      // 读面分级（17-§7）：dispatch 装配时按岗选档（装配期选择非运行期闸——daemon 自身
      // 读不拦，见 src/engine/read-tiers.ts 头注与写闸的区别）。Blind 档在此补齐冻结验收命令
      //（config 同源）+ 本工位证据面路径；缺验收 → CONFIG_INVALID fail-closed（无验收
      // 不派工）——异常走本 catch=DISPATCH_FAIL 明报，不静默降档。
      const readTier = resolveReadTier(roleOfAssignee(fresh.assignee, people), config.readTierByRole)
      const readView = await createView(platform, readTier, ticket, {
        ...(readTier === 'blind'
          ? { blind: { acceptance: config.readBlindAcceptance ?? [], artifacts: blindArtifactPaths(workspace) } }
          : {}),
      })
      // 装配（L0-L5 → AGENTS.md + 任务书首版/续跑版，17-§5）与落盘（daemon 是 prompt 落盘者）。
      // resume 面（129-E）：face.assembleCtx 在场=续跑版（前情摘要注入）；降级面缺席=首版新派
      const assembled = assembler({
        issue: fresh,
        attempt,
        person,
        adapterName: adapter.name,
        adapterVersion: detect.version,
        capabilities: adapter.capabilities,
        workspace,
        briefPath,
        agentsTarget,
        agentsChannel: { channel: adapter.capabilities.agents_md, target: agentsTarget },
        readView,
        // 持久对话轮次（docs/21-§七.4）：任务书/闸门用 `test -s REPORT.md`，不用工程单验收
        ...(rt.deps.conversation?.store.turnOf(ticket) !== undefined ? { acceptanceOverride: CONVERSATION_ACCEPTANCE } : {}),
        ...(resumeFace?.assembleCtx !== undefined ? { resume: resumeFace.assembleCtx } : {}),
      })
      // —— P3-② 权限前移（studio-dev-100 提案 §4.3-2，治 E12 于干预窗内）：工位脚手架
      //    落盘与 worker 子进程（umask 随 fork 继承）统一 0o022——产物默认 ≥0644，收割/
      //    收账面（异用户部署）可达；finally 恢复原 mask（process.umask 进程全局态，
      //    窗口=脚手架落盘→launch 返回；engine 单线程逐派发，窗内 await 无并发落盘面）——
      //    【拟稿：executor 工具面硬编码 0600 的写入不受 umask 影响，残面由收割 stat
      //    兜底（HARVEST_DENIED）如实暴露，不静默】
      prevUmask = process.umask(WORKSPACE_UMASK)
      mkdirSync(workspace, { recursive: true })
      // 定价发布附件（studio-dev-554，docs/17-§2 派发相位）：type='pricing' 单在 launch 前由
      // daemon 从 models.yaml 三档确定性生成 deliverables/pricing.yaml；坏价目源头即拒
      // （抛错→DISPATCH_FAIL，不 transition 不 launch）并同前缀去重发 DAILY_ALARM。
      const pricingBrief = preparePricingAttachment({ ledger, company: config.company, issueType: fresh.type, ticket, workspace, at,
        tiers: rt.catalog !== undefined ? rt.catalog.tiers() : undefined, emitAlarm: (note) => makeEvent('DAILY_ALARM', fresh, attempt, tickEvents, { note }) })
      if (nativeAgents) {
        writeFileSync(agentsTarget, assembled.agentsMd.text, 'utf8')
      } else {
        // bridge 通道（v1.5#1）：组装文本落每任务临时文件（0600，「生成物勿手改」横幅
        // 由组装产物自带）——TaskBrief.AGENTS_MD.target 指向它，dsh 适配器注 env 交插件消费
        instructionsPath = agentsTarget
        writeInstructions(agentsTarget, assembled.agentsMd.text)
      }
      // 任务书追加 wkey 指引行（workerKeys 启用面；追加在六层组装产物之外、任务书是
      // per-attempt 操作面——指引行只指路不含凭据值，env 通道定调见 worker-key.ts 头注）
      // ＋定时岗产出哨兵段（127-A R1 批示③：工单型岗单注入三元组回写义务——per-attempt
      // 操作面同位；patrol 工件/普通单结构性不注入）
      const sentinelDuty = sentinelDutyForTicket(ledger, ticket)
      // 策略投影通道（SEC-SIG-04 信封闸／GAP-V2-02）：生成→签名→落盘→**回读验签**→消费；失败＝不 launch、不降级（NEG-RUN-01；体=prm/dispatch-projection.ts，字段拼装收口在接线体，本处只留调用）。
      const prm = applyDispatchProjection({ company: config.company, ticket, attempt, personId: person.id, personDept: person.dept, executor: adapter.name, executorVersion: detect.version, capabilities: adapter.capabilities, workspace, rootDir: config.rootDir, atMs: at })
      if (prm.kind === 'rejected') return fail(`PRM_FAIL：${prm.detail}`)
      const briefParts = [assembled.brief.text, prm.briefBlock]
      if (workerKeys !== undefined) briefParts.push(`${workerKeyGuidance()}\n`)
      if (sentinelDuty !== undefined) briefParts.push(sentinelBriefBlock(sentinelDuty))
      if (pricingBrief !== '') briefParts.push(pricingBrief)
      const briefText = briefParts.join('\n')
      writeFileSync(briefPath, briefText, 'utf8')
      const taskBrief = assembled.brief.taskBrief
      // 预算闸（TaskBrief 构造后、launch 前——20-§六.8 机制点）：估算（两态）→ reserve
      // 判定 → 过闸=双行落账（issue 先 person 后；落账与 launch 之间失败=不派，异常
      // 上抛本 catch→DISPATCH_FAIL）；超帽=refusal 行落账+不派；duplicate=沿用未结预留
      // （失败保留重派语义）。拟稿待批点清单见 src/engine/budget-gate.ts 头注。
      const personDay = personDayGateInput(costGuard, person, ledger, at) // 闸四·人日 hard 线（R6）：段声明且有 gate 档才带
      const gate = await gateDispatch(budgetDeps, {
        ticket,
        personId: person.id,
        adapter,
        taskBrief,
        briefChars: assembled.brief.text.length,
        ...(config.budgetTicketCapUsd !== undefined ? { fallbackTicketCapUsd: config.budgetTicketCapUsd } : {}),
        ...(config.budgetPersonCapUsd !== undefined ? { personCapUsd: config.budgetPersonCapUsd } : {}),
        ...(personDay !== undefined ? { personDay } : {}),
        now: at,
      })
      if (gate.kind === 'refused') {
        budget.budgetRefused += 1
        if (instructionsPath !== undefined) removeInstructions(instructionsPath) // 拒派即删（无收割会来收本 attempt）
        return fail(
          `budget-refusal:${gate.reason}：估算 $${gate.estimated} + 在途 $${gate.inflight} 超帽 $${gate.cap}` +
            `——refusal 行已落账（可查，F1-09），不派（20-§六.8 预留不落即不派的镜像面）`,
          { kind: 'cost_runaway', capabilityRef: `ticket:${ticket}/budget` },
        )
      }
      if (gate.kind === 'reserved') budget.budgetReserved += 1
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
      const launchBrief: TaskBrief = {
        ...taskBrief,
        ...(minted !== undefined ? { credentials: workerKeyCredentials(minted.token) } : {}),
      }
      launched = await adapter.launch(launchBrief)
      rt.crash.dispatchLaunched() // 崩溃注入②（F3-11）：launch 已返回、work_records 在途落账前——受控测试缝，默认零行为
      startSessionArchive(ledger, { ticket, personId: person.id, sessionId: launched.sessionId, at }) // 相位 3 会话归档 start 行（写失败抛→DISPATCH_FAIL，无归档不派）
      lanes.acquire(action.lane, ticket, at)
      const transitioned = await platform.issues.transition(ticket, action.toState)
      const workRecordId = makeId(at)
      ledger.insertWorkRecord({
        id: workRecordId,
        issue: ticket,
        person_id: person.id,
        executor: adapter.name,
        session_id: launched.sessionId,
        lane: action.lane,
        started_at: at,
        attempt,
        status: 'running',
      })
      inflight.set(ticket, {
        ticket,
        workRecordId,
        executor: adapter.name,
        handle: launched,
        workspace,
        briefPath,
        attempt,
        lane: action.lane,
        personId: person.id,
        dispatchedAtSeq: seq,
        ...(instructionsPath !== undefined ? { instructionsPath } : {}),
      })
      syncMirror(transitioned)
      // 记录族生产写面·相位 3 派发（docs/17-§2）：迁移→REC-WORK-06（前置不齐即拒，不臆造）
      if (records !== undefined) {
        const facts = rt.deps.recordPhaseFacts?.start({ ticket, attempt, at, actor: person.id, fromState: fresh.state, toState: action.toState })
        recordStartChain({ records, ticket, attempt, fromState: fresh.state, toState: action.toState, at, actor: person.id, ...(facts !== undefined ? { facts } : {}) })
      }
      // 队列等待锚（129-§6.2-R4）：DISPATCH note 尾携 wait/prio/boost（锚形冻结；
      // 计算体拆入 todoqueue/queue.ts queueDispatchAnchor——轨2 R1① 本单「先拆再增」行基线清偿）
      const queueAnchorInfo = queueDispatchAnchor(queueCarry, ticket, at)
      // resume 观测锚（129-E，F1-15「续跑派发不静默」）：note 尾锚+causation_id=上次工时单 id
      //（两形都带——因果链不因降级断；锚形见 faces 件 resumeDispatchFace 头注）
      makeEvent('DISPATCH', transitioned, attempt, tickEvents, {
        size: Buffer.byteLength(assembled.agentsMd.text, 'utf8'),
        payload_hash: `sha256:${createHash('sha256').update(assembled.agentsMd.text, 'utf8').digest('hex')}`,
        ...(resumeFace !== undefined ? { causation_id: resumeFace.causationId } : {}),
        note: `fp=${assembled.agentsMd.fingerprint};intent=${intentKey};executor=${adapter.name}@${detect.version}${tierFace?.noteAnchor ?? ''};read=${readTier};agents=${agentsTarget};brief=${briefPath};budget=${gate.kind === 'reserved' ? `reserve$${gate.estimated.toFixed(4)}` : `adopt$${gate.estimated.toFixed(4)}`}${minted !== undefined ? `;wkey=env:${WORKER_WKEY_ENV_KEY}:nonce=${minted.nonce}` : ''}${action.breakerProbe === true ? `;breaker=half-open-probe（冷却窗过——单次试探：成功即复位，失败回全开续冷却，DEV-46）` : ''}${seatbeltSegment}${selectionAnchor}${prm.noteAnchor}${resolved.autoAssignNote ?? ''}${queueAnchorInfo.waitAnchor}${resumeFace?.noteAnchor ?? ''}`,
      })
      // 派发成功即出队（129-§6.2）：携带条删——GATE_FAIL 回滚再入队走 touchQueueCarry
      // 新钟（attempt 轮次可区分，队列等待观测口径=每誓一钟，不跨轮累计）。
      if (queueAnchorInfo.entry !== undefined) dropQueueCarry(queueCarry, [ticket])
      // 单据房间供给（130-P3/DEV-20 P9）：ensureTicketRoom；失败 ESCALATE 不阻派发（幂等重跑收敛）
      if (rooms !== undefined) await dispatchRoomDuty(rooms, { ticket, title: fresh.title, dept: fresh.dept ?? person.dept, assignee: person.id }, (note) => makeEvent('ESCALATE', transitioned, attempt, tickEvents, { note }))
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail:
          `attempt=${attempt} executor=${adapter.name} lane=${action.lane}` +
          `;budget=${gate.kind === 'reserved' ? `reserve $${gate.estimated.toFixed(4)}` : `adopt（沿用未结预留）$${gate.estimated.toFixed(4)}`}` +
          (resumeFace?.detailSegment ?? ''),
      }
    } catch (err) {
      // 派发失败如实分类上报（DISPOSITIONS: DISPATCH_FAIL/retry）；v0 不计断路连击（拟稿）
      const msg = err instanceof Error ? err.message : String(err)
      if (launched !== undefined) await adapter.kill(launched, config.killGraceMs).catch(() => undefined)
      // bridge 通道临时指令文件即删：launch 失败=无收割会来收本 attempt，留着即泄漏
      //（清理策略见 instructions-store.ts 头注；重派会重写同路径）
      if (instructionsPath !== undefined) removeInstructions(instructionsPath)
      // 已签发的 worker wkey 随失败撤离（env 通道：launch 失败=凭据未进任何存活子进程，
      // token 只活在本次调用栈——丢弃即离场；不吊销 ticket——重试重签同 ticket，ticket 级
      // 吊销是终局动作，见 worker-key.ts 头注拟稿；失效兜底=TTL+nonce 单次）。
      return fail(`DISPATCH_FAIL：${msg}`)
    } finally {
      // P3-② 权限前移窗收口：恢复派发前 umask（早退面——detect 不达标/预算拒派/launch
      // 异常——同样不泄漏全局态）
      if (prevUmask !== undefined) process.umask(prevUmask)
    }
  }