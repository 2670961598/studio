/**
 * engine/dispatch/bound-stage —— 适配器绑定段（task-141 自 execute.ts 抽件；20-§十五「按域拆件、零行为变更」）
 *
 * 绑定段 = 自「选择闸」到「任务书落盘」的整段：选择闸（单据指定＞岗位绑定＞默认；拒派不降级）
 * → preflight（seatbelt 圈定→detect）→ 派生即登记 → 读面分级 → 装配 → 工位脚手架（umask）
 * → 定价附件 → AGENTS.md/指令文件 → PRM 投影 → 任务书。段内每一步都依赖**具体适配器**
 * （能力通道/名/版本），故 task-141 跨执行器换源（executor 不同）= 整段重跑；预算闸 reserve、
 * wkey 签发、崩溃注入①不在段内——换绑不重跑（一笔预留服务 N 次尝试，task-135 同口径）。
 *
 * 语句自 execute.ts 逐字迁出（宿主名由入参给齐）；两个顺序锚仍在 engine.ts（源侧锚测试
 * 钉死：`resolveWorkerDispatchSeatbelt({ ticket` 先于 `const detect = await adapter.detect()`）。
 * 换绑与派生登记（docs/quality/model-routing.md §10.2）：launch 前换绑=被弃段未 spawn，宿主先经
 * `retireDispatchDerivation` 撤其登记行（登记面无撤销口=不换绑 fail-closed）；launch 后换源换绑=
 * 被弃段已 spawn，登记行如实留痕不删。bridge 指令文件落盘前即经 `noteInstructions` 交出路径——
 * 段内其后任何抛错/失败、launch 失败都由宿主收口清理（首绑即登记，不依赖换绑）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EventRecord, ExecutorAdapter, IssueRecord, PersonRef, TaskBrief, TicketId } from '@studio-next/contract'
import { CONVERSATION_ACCEPTANCE } from '../conversation/protocol.ts'
import type { DispatchFail } from '../capability/index.ts'
import { instructionsTarget, writeInstructions } from '../instructions-store.ts'
import { WORKSPACE_UMASK } from '../jobs/harvest-recon.ts'
import { sentinelBriefBlock, sentinelDutyForTicket } from '../jobs/sentinel.ts'
import type { ResumeDispatchFace } from '../intents/relay-resume-faces.ts'
import { preparePricingAttachment } from '../pricing/publish.ts'
import type { AssembleDispatchOutput } from '../prompt-assembly.ts'
import { applyDispatchProjection, type DispatchProjectionApplyResult } from '../prm/dispatch-projection.ts'
import { blindArtifactPaths, createView, resolveReadTier, roleOfAssignee, type ReadTier } from '../read-tiers.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { derivationIdOf } from '../work/derivation-registration.ts'
import { gateDispatchSelection, type DispatchSelectionDeps } from '../work/dispatch-selection.ts'
import { workerKeyGuidance } from '../worker-key.ts'
import type { TickActionResult } from '../tick-report/types.ts'

export interface BoundStageInput {
  readonly rt: EngineRuntime
  readonly ticket: TicketId
  readonly fresh: IssueRecord
  readonly person: PersonRef
  readonly attempt: number
  readonly tickEvents: EventRecord[]
  readonly workspace: string
  readonly briefPath: string
  /** 本段候选适配器（源 executor 预绑后的候选；选择闸可改派——改派即链锁定） */
  readonly candidate: ExecutorAdapter
  readonly resumeFace: ResumeDispatchFace | undefined
  /** 选择闸依赖（task-141：**本档** sources executor 家族已并入放行集合；未配=原 deps 原样零漂移） */
  readonly selectionDeps: DispatchSelectionDeps | undefined
  /** 本段失败即派发失败（宿主 makeDispatchFail 闭包——释放泳道/撤在途/退化回执同口径） */
  readonly fail: DispatchFail
  /** umask 恢复位登记（段内改全局态后任何一步抛错——宿主 finally 仍须恢复；首次登记生效） */
  readonly setPrevUmask: (prev: number) => void
  /** bridge 指令文件落盘前上报路径（宿主持路径：段内其后抛错/失败、launch 失败均由宿主清理） */
  readonly noteInstructions: (target: string) => void
}

export interface BoundDispatch {
  /** 本段入参候选（源 executor 预绑后的候选） */
  readonly candidate: ExecutorAdapter
  readonly adapter: ExecutorAdapter
  /** 选择闸改派（单据指定/岗位绑定指向别家）：链选定优先——本 dispatch 不再按源 executor 换绑 */
  readonly chainLocked: boolean
  readonly selectionAnchor: string
  readonly workspace: string
  readonly briefPath: string
  readonly nativeAgents: boolean
  readonly agentsTarget: string
  readonly instructionsPath: string | undefined
  readonly detect: Awaited<ReturnType<ExecutorAdapter['detect']>>
  readonly seatbeltSegment: string
  readonly readTier: ReadTier
  readonly assembled: AssembleDispatchOutput
  readonly prm: Extract<DispatchProjectionApplyResult, { kind: 'ok' }>
  readonly taskBrief: TaskBrief
  /** 段内时点（与 task-141 前 execute.ts 同位：选择闸后、preflight 前） */
  readonly at: number
  /** 本段派生登记 id（`<ticket>:att<N>:<adapter>`；宿主 launch 前换绑时据此撤销） */
  readonly derivationId: string
}

export type BoundStageRun =
  | { readonly kind: 'bound'; readonly bound: BoundDispatch }
  | { readonly kind: 'failed'; readonly result: TickActionResult }

export async function runBoundStage(input: BoundStageInput): Promise<BoundStageRun> {
  const { rt, ticket, fresh, person, attempt, tickEvents, workspace, briefPath, candidate, resumeFace, selectionDeps, fail, setPrevUmask, noteInstructions } = input
  const { registry, config, ledger } = rt
  const people = rt.people
  const assembler = rt.assembler
  const makeEvent = rt.makeEvent
  // 执行器选择链（studio-dev-620；v2/07 §一）：单据指定＞岗位绑定＞默认；拒派不降级
  //（ESCALATE 每单每因一次——去重账 rt.selectionRejections）。解析/适配/留痕体在
  // work/dispatch-selection.ts，本文件只留相位 3 一次调用（docs/17-§2 派发；docs/17-§6
  // 拒派=不启动——fail 后不 transition/不 launch/不落工时单）。
  const selection = gateDispatchSelection(
    selectionDeps,
    { registry, ticket, personId: person.id, candidate, resumeActive: resumeFace?.active === true },
    rt.selectionRejections,
    (note) => makeEvent('ESCALATE', fresh, attempt, tickEvents, { note }),
  )
  if (selection.kind === 'err') return { kind: 'failed', result: fail(selection.message) }
  const { adapter, anchor: selectionAnchor } = selection
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
  const at = rt.now()
  // 派发域 seatbelt 圈定→detect 前置（SEC-FC-05 后半 / 18-§一）：顺序锚在 engine.ts
  // dispatchPreflight——圈定失败即抛 → 宿主 catch → DISPATCH_FAIL（detect/装配/launch 零
  // 调用）；detect 前置 launch 前必跑，不达标明报不静默降级
  const { detect, seatbeltSegment } = await rt.dispatchPreflight(adapter, ticket, workspace)
  if (!detect.ok) return { kind: 'failed', result: fail(`executor ${adapter.name} detect 不达标：${detect.gaps.join('；')}`, { kind: 'degraded', capabilityRef: `executor:${adapter.name}`, probe: { executor: adapter.name, version: detect.version, ok: false, gaps: detect.gaps } }) }
  // 派生即登记（v2/07 §四规则 1；GAP-V2-04 S6）：detect 通过后、任何 spawn/预算/落盘之前落登记，
  // 失败即不派（EXEC-01 fail-closed）。只记身份/后端/能力子集/时点；wkey 是 local-mint 例外，
  // 不进静态 catalogue（78-§7.4.1），凭据继承默认无（v2/07 §四规则 3）。
  const derivationId = derivationIdOf(ticket, attempt, adapter.name)
  const registration = rt.deps.derivationRegistry?.register({
    derivationId,
    ticket,
    executor: adapter.name,
    backend: 'external-cli',
    capabilitySubset: `executor:${adapter.name}@${detect.version}`,
    derivedAt: new Date(at).toISOString(),
  })
  if (registration !== undefined && registration.kind !== 'ok') {
    return { kind: 'failed', result: fail(`derivation-registration ${registration.error.category}/${registration.error.subcause}：${registration.error.detail ?? ''}`) }
  }
  // 读面分级（17-§7）：dispatch 装配时按岗选档（装配期选择非运行期闸——daemon 自身
  // 读不拦，见 src/engine/read-tiers.ts 头注与写闸的区别）。Blind 档在此补齐冻结验收命令
  //（config 同源）+ 本工位证据面路径；缺验收 → CONFIG_INVALID fail-closed（无验收
  // 不派工）——异常走宿主 catch=DISPATCH_FAIL 明报，不静默降档。
  const readTier = resolveReadTier(roleOfAssignee(fresh.assignee, people), config.readTierByRole)
  const readView = await createView(rt.platform, readTier, ticket, {
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
  setPrevUmask(process.umask(WORKSPACE_UMASK))
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
    noteInstructions(agentsTarget) // 落盘前交出路径：写盘自身抛错（EISDIR/ENOSPC）也由宿主清
    writeInstructions(agentsTarget, assembled.agentsMd.text)
  }
  // 任务书追加 wkey 指引行（workerKeys 启用面；追加在六层组装产物之外、任务书是
  // per-attempt 操作面——指引行只指路不含凭据值，env 通道定调见 worker-key.ts 头注）
  // ＋定时岗产出哨兵段（127-A R1 批示③：工单型岗单注入三元组回写义务——per-attempt
  // 操作面同位；patrol 工件/普通单结构性不注入）
  const sentinelDuty = sentinelDutyForTicket(ledger, ticket)
  // 策略投影通道（SEC-SIG-04 信封闸／GAP-V2-02）：生成→签名→落盘→**回读验签**→消费；失败＝不 launch、不降级（NEG-RUN-01；体=prm/dispatch-projection.ts，字段拼装收口在接线体，本处只留调用）。
  const prm = applyDispatchProjection({ company: config.company, ticket, attempt, personId: person.id, personDept: person.dept, executor: adapter.name, executorVersion: detect.version, capabilities: adapter.capabilities, workspace, rootDir: config.rootDir, atMs: at })
  if (prm.kind === 'rejected') return { kind: 'failed', result: fail(`PRM_FAIL：${prm.detail}`) }
  const briefParts = [assembled.brief.text, prm.briefBlock]
  if (rt.workerKeys !== undefined) briefParts.push(`${workerKeyGuidance()}\n`)
  if (sentinelDuty !== undefined) briefParts.push(sentinelBriefBlock(sentinelDuty))
  if (pricingBrief !== '') briefParts.push(pricingBrief)
  const briefText = briefParts.join('\n')
  writeFileSync(briefPath, briefText, 'utf8')
  return {
    kind: 'bound',
    bound: {
      candidate,
      adapter,
      chainLocked: adapter !== candidate,
      selectionAnchor,
      workspace,
      briefPath,
      nativeAgents,
      agentsTarget,
      instructionsPath,
      detect,
      seatbeltSegment,
      readTier,
      assembled,
      prm,
      taskBrief: assembled.brief.taskBrief,
      at,
      derivationId,
    },
  }
}
