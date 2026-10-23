/**
 * merge-run —— 合并跑机器（202-P2，studio-dev-232，docs/17-§2 相位 5 真单刀，v0.5 核心）
 *
 * 语义总纲：合并跑=收割链复用，非新链。待验收位（post-verified 批准槽）+standing 批示
 * 在场+触发条件全齐 → daemon 在相位 5 以 resume 唤起**原工位原会话**（resumeWithSession
 * ——dsh 侧会话 id，契约 v1.5）自合并：最小合并任务书（续跑版+合并指令块）→ 同一条
 * 收割链（四要件冻结口径：终态 completed+非空输出+merge-REPORT 落盘+闸门 exit0——
 * 闸门=引擎亲跑门禁命令【R1】+合并提交存在性核验，折进要件 4 面不加要件）→ 全绿
 * GATE_PASS→daemon 代推 dev【R2】→MERGE 真事件（note=提交 sha/门禁摘要/会话续跑
 * 证据/推送结果）→ 迁已交付。宰相终审权保留：批示语义零变更，机器合并只是批准的
 * 执行面（R6）；失败/触发不齐=降级宰相手工链（ESCALATE chain=manual 锚，每单一次）。
 *
 * 触发五查（全齐才跑，缺结构性件=降级，占位性忙=顺延不弃单）：
 *   1. 验收位：approvalSlotOf(flow,state)==='post-verified'（否则=v0 模拟轨——零行为
 *      变更纪律：非 post-verified 位的 merge 动作 byte-identical 走原模拟合并）；
 *   2. standing 批示：directiveVerbNow.get(t) ?? index.directiveStandingOf(t) === '批准'
 *      （与 decide 同式同源——同拍批准同拍可合；autoApprove 不算，批示语义冻结）；
 *   3. 未标手工：index.mergeManualOf(t)===false（merge=manual 锚=自合并失败面/人工标记，
 *      机器合并终局让位——append-only）；
 *   4. 合并租约空闲：TTL+每拍续租+死主回收（202-P4，merge-lease.ts——泳道租约同模式
 *      加固，per-engine 实例）；他单活约在位=顺延不弃单（merge-lease-busy 下拍重试）；
 *   5. 断点可解析：work_records 末位带会话工时单 executor_session_id 在场+summary
 *      sidecar 可读+executor 在册且 session_resume=true+工位 repo rev-parse HEAD 可解析
 *      （=reviewTip，提交核验基线）。缺=降级手工链（重启打断合并跑同此面——running
 *      合并工时单无 executor_session_id 收口，末位断点即不可解析，P4 硬化前如实降级）。
 *
 * 收割位别四接线（收割链同构复用，语义位别如注）：
 *   - C7 幂等：DISPATCH note 携 merge-run 锚（events-index 不清 standing——批准在合并
 *     跑期间持续在场）；合并跑无 intent 键（无 GATE_PASS/GATE_FAIL 释放面差异）；
 *   - attempt 续号：DISPATCH 计数+1=F1-15 同口径（断路连击不被续跑洗白）；
 *   - 断路器：**不计连击也不复位**（合并跑成败与 worker 工质无关——纯合并面；两面皆
 *     不触 breaker，onSuccess/onWorkerError 都不调）；
 *   - 平台迁移面禁用：合并跑在途**零平台写**（不迁已派发、不回滚、不吊销 wkey、不
 *     acquire 泳道——原单仍占原泳道原人闸，结构性地不双占）；收割成功只迁已交付。
 *
 * 泳道/wkey/预算：wkey 恒不签发（无平台写面）；预算同一条闸（reserve→launch→settle 两面都结）；usage write-through 成功面。
 *
 * 降级语义（chain=manual，ESCALATE 锚每单一次=dedupe）：降级后**每拍重试触发检查**
 * （不因降级记档停摆——宰相修复阻断件后机器合并自恢复）；merge=manual 才是终局让位。
 * 手工链义务：宰相亲跑门禁→git merge --no-ff→代推——事件面由宰相批示流自留。
 *
 * 冲突兜底与手工链收口（202-P3，studio-dev-233，§5.5）：合并跑四要件不齐＝
 * MERGE_CONFLICT 既有类（ErrorCategory 词表）——事件名冻结零新增，分类随 GATE_FAIL/
 * ESCALATE note 走 category=MERGE_CONFLICT 锚（P2 缝注「同锚」即此）；**不自动重试**
 * （merge=manual 终局让位挡重派——同会话重试=同结果空转，合并跑面位别 disposition
 * 覆写 worker 循环面的 retry 行）。手工链完成后批示:批准（R6：宰相∪制作人∪派单策划）
 * →standing 重建→decide 再出 mergeTo→**v0 模拟迁移转正收口**（simulatedMergeTransition
 * 共体，实现体=merge-fallback.ts【BC-S2 拆】——note 如实=宰相手工链收口不冒认真单刀）。worker 消亡面
 * （failMergeHarvest）四要件不可判≠冲突：不加冲突锚不加 ESCALATE（标记让位仍走收口）。
 *
 * 拟稿待批点（后续刀缝）：重启接管、push 重试/对账、消亡面通知位别、跨进程互斥——
 * 本刀全部如实降级或如实入 note（租约 TTL/续租/死主已随 202-P4 收口）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  CostGuardConfig,
  EventRecord,
  ExecutorAdapter,
  FlowPlatform,
  Handle,
  IssueRecord,
  PersonRef,
  SummarySidecar,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'
import { flowAnchors, type StateFlow } from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import { gateDispatch, settleDispatch, type BudgetGateDeps } from '../budget-gate.ts'
import { foldHarvestCost, writeThroughHarvestUsage } from '../cost-guard/harvest.ts'
import { personDayGateInput } from '../cost-guard/fold.ts'
import { resolveResumePlan } from '../intents/relay-resume.ts'
import type { PromptAssembler } from '../prompt-assembly.ts'
import { blindArtifactPaths, createView, resolveReadTier, roleOfAssignee } from '../read-tiers.ts'
import { instructionsTarget, removeInstructions, writeInstructions } from '../instructions-store.ts'
import { WORKSPACE_UMASK } from '../jobs/harvest-recon.ts'
import type { TickActionResult, TickPhaseDispatchBudget } from '../tick-report/types.ts'
import { MERGE_CONFLICT_ANCHOR, MERGE_MANUAL_ANCHOR, MERGE_RUN_ANCHOR, type EventIndex } from '../sentinel/events-index.ts'
import { approvalSlotOf } from '../directive/wire.ts'
import type { DirectiveVerb } from '../directive/index.ts'
import type { EngineConfig, Inflight } from '../engine.ts'
import { MERGE_BRIEF_FILENAME, MERGE_RECEIPT_FILENAME, mergeDirectiveBlock } from './merge-brief.ts'
import { mergeLeaseKey, type MergeLeaseRegistry } from './merge-lease.ts'
import { degradeToManualChain, noteSafe, simulatedMergeTransition } from './merge-fallback.ts'
import type { MergeGitPort, MergeGateCommandPort } from './merge-gate.ts'
import { runMergeGate } from './merge-gate.ts'

/** 引擎侧 merge 动作形状（core decide 产物；此声明只为类型收窄，运行时透传） */
export interface MergeAction {
  type: 'merge'
  ticket: TicketId
  toState: string
}

// ————————————————————————— 注入面 —————————————————————————

/** 合并跑依赖（serve 装配注入；缺省=面关零行为——v0 模拟轨不变） */
export interface MergeRunDeps {
  /** 目标分支（R5：恒 dev 家分支；缺省 'dev' 由 serve 给） */
  targetBranch: string
  /** 冻结门禁命令（R1：引擎亲跑；缺省 ['bun','run','test'] 由 serve 给） */
  gateCommand: readonly string[]
  /** 工位内 repo 相对路径（默认 'repo'——工位约定布局） */
  repoRelPath?: string
  /** git 四原语+代推端口（真实现=default-deps.ts spawn 版；测试=fake） */
  git: MergeGitPort
  /** 门禁命令端口（repo 内执行；超时=code≠0+note 如实） */
  gate: MergeGateCommandPort
}

/** 在途合并跑上下文（Inflight.mergeRun 在场=合并跑收割位别接线生效） */
export interface MergeRunContext {
  deps: MergeRunDeps
  leaseKey: string
  targetBranch: string
  /** 派发时工位 repo HEAD（提交核验基线：须成目标分支祖先） */
  reviewTip: string
  receiptPath: string
  /** 因果链锚：所续工时单 id（DISPATCH causation_id 同源） */
  causationId: string
  /** dsh 侧会话 id（契约 v1.5——resumeWithSession 唤起证据，MERGE note 留痕） */
  executorSessionId: string
}

/** 引擎侧宿主（createEngine 单点装配——合并跑所需引擎内件全经此注入，不二次 import；热换绑定（assembler/people/costGuard）经 thunk 取活值） */
export interface MergeRunHost {
  platform: FlowPlatform
  ledger: Ledger
  registry: ExecutorRegistry
  assemble: PromptAssembler
  config: EngineConfig
  people: () => readonly PersonRef[]
  budgetDeps: BudgetGateDeps
  costGuard: () => CostGuardConfig | undefined
  /** 模型档表（catalog.tiers()——cost 折算同源；面关=undefined） */
  modelTiers: (() => readonly unknown[]) | undefined
  inflight: Map<TicketId, Inflight>
  mergeRun: MergeRunDeps | undefined
  /** 合并租约簿（202-P4：per-engine 实例——createEngine 内建；TTL/续租/死主回收见 merge-lease.ts） */
  mergeLease: MergeLeaseRegistry
  seq: () => number
  now: () => number
  makeId: (ts: number) => string
  makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { tokens?: EventRecord['tokens']; cost_usd?: number; duration_ms?: number; size?: number; payload_hash?: string; note?: string; causation_id?: string },
  ) => EventRecord
  syncMirror: (issue: IssueRecord) => void
  resolvePerson: (issue: { assignee?: string }) => PersonRef | undefined
  flowOf: (issue: { type?: string; level?: number }) => StateFlow | undefined
}

/** 相位 5 动作出口：deferred=占位性顺延（不计数不上报）；counted=合并完成（merged++）；mutated=有台账事件（mutations++）；leaseBusy=租约忙顺延（202-P4 等待单信号——队列栏收集面） */
export interface MergeActionOutcome {
  result: TickActionResult
  deferred: boolean
  counted: boolean
  mutated: boolean
  leaseBusy?: boolean
}

// ————————————————————————— 断点解析（触发第 5 查） —————————————————————————

/** 合并跑断点：resolveResumePlan 同源 + executor_session_id（v13 列——resumeWithSession 唤起凭据）+ reviewTip */
export interface MergeRunPlan {
  executor: string
  daemonSessionId: string
  executorSessionId: string
  summary: SummarySidecar
  summaryPath: string
  workspace: string
  repoDir: string
  reviewTip: string
  causationId: string
  lastAttempt: number
}

/**
 * 断点可解析判定：末位带 session_id 工时单**必须**带 executor_session_id（dsh 侧会话——
 * daemon 侧 uuid 续不了原会话）；严格末位不回扫（重启打断的合并工时单=末位 running 无
 * 收口 → 如实不可解析降级手工链——重试唤起死会话风险面 P2 不接，P4 硬化）。
 * summary 可读=resolveResumePlan 面（含 sidecar 形状校验）；executor 能力=结构探测。
 */
async function resolveMergeRunPlan(
  host: MergeRunHost,
  deps: MergeRunDeps,
  ticket: TicketId,
): Promise<{ plan: MergeRunPlan } | { degrade: string }> {
  const resume = resolveResumePlan(host.ledger, ticket)
  if ('unavailable' in resume) return { degrade: `断点不可解析（${resume.unavailable}）` }
  const last = host.ledger
    .listWorkRecords({ issue: ticket })
    .filter((r) => r.session_id !== undefined && r.session_id !== '')
    .at(-1)
  if (last === undefined) return { degrade: '断点不可解析（无带会话工时单）' }
  if (last.executor_session_id === undefined || last.executor_session_id === '') {
    return { degrade: '断点不可解析（末位工时单无 executor_session_id——dsh 侧会话 id 未收口；重启打断的合并跑同此面，P4 硬化前降级手工链）' }
  }
  let adapter: ExecutorAdapter
  try {
    adapter = host.registry.resolve(resume.executor)
  } catch {
    return { degrade: `executor ${resume.executor} 不在注册表（末位工时单的执行家已除名）` }
  }
  if (!adapter.capabilities.session_resume) {
    return { degrade: `executor ${resume.executor} 声明 session_resume=false（合并跑需原生续跑唤起原会话）` }
  }
  if (typeof (adapter as { resumeWithSession?: unknown }).resumeWithSession !== 'function') {
    return { degrade: `executor ${resume.executor} 无 resumeWithSession 面（契约 v1.5 唤起口缺位——结构探测不过）` }
  }
  const workspace = path.dirname(resume.summaryPath)
  const repoDir = path.join(workspace, deps.repoRelPath ?? 'repo')
  const reviewTip = await deps.git.revParseHead(repoDir)
  if (reviewTip === undefined) {
    return { degrade: `工位 repo 不可解析（${repoDir} rev-parse HEAD 失败——提交核验基线缺位）` }
  }
  return {
    plan: {
      executor: resume.executor,
      daemonSessionId: resume.sessionId,
      executorSessionId: last.executor_session_id,
      summary: resume.summary,
      summaryPath: resume.summaryPath,
      workspace,
      repoDir,
      reviewTip,
      causationId: resume.causationId,
      lastAttempt: resume.lastAttempt,
    },
  }
}

// ————————————————————————— 相位 5 入口（双轨） —————————————————————————

/**
 * 相位 5 合并动作执行体（engine 唯一调用面）：
 * 面关（host.mergeRun 缺省）或非 post-verified 位 → v0 模拟轨 byte-identical；
 * post-verified → standing 批示在场+已标 merge=manual → **手工链收口**（202-P3：v0 模拟
 * 迁移转正——宰相手工链完成后批示:批准【R6】重建站立，decide 再出 mergeTo 即此处收口）；
 * 未标 manual → 触发五查 → 真单刀派发 / 降级手工链（ESCALATE chain=manual 每单一次）/
 * 顺延（lease 忙/批示不在场——不计数不上报，下一拍重进）。
 */
export async function runMergeAction(
  host: MergeRunHost,
  action: MergeAction,
  index: EventIndex,
  tickEvents: EventRecord[],
  budget: TickPhaseDispatchBudget,
  directiveVerbNow: ReadonlyMap<TicketId, DirectiveVerb>,
): Promise<MergeActionOutcome> {
  const ticket = action.ticket
  const deps = host.mergeRun
  try {
    const fresh = await host.platform.issues.get(ticket)
    const flow = host.flowOf(fresh)
    // —— 轨道分派：面关/非验收位=v0 模拟（零行为变更——P1 语义与测试不动） ——
    if (deps === undefined || flow === undefined || approvalSlotOf(flow, fresh.state) !== 'post-verified') {
      return simulatedMergeTransition(host, action, index, tickEvents, `→${action.toState}（v0 模拟合并：无真 git 合并，归 v0.5 真单刀）`, `→${action.toState}（模拟）`)
    }
    // —— 触发五查（占位性忙=顺延；结构性缺=降级；全齐=派发） ——
    const standing = directiveVerbNow.get(ticket) ?? index.directiveStandingOf(ticket)
    if (standing !== '批准') {
      return { result: { ticket, actionType: action.type, ok: true, detail: 'standing 批示已不在场（本拍顺延重查）' }, deferred: true, counted: false, mutated: false }
    }
    if (index.mergeManualOf(ticket)) {
      // —— 手工链收口（202-P3）：merge=manual 终局让位后的一次性收口面 —— 冲突兜底/
      //    消亡面已落标记（append-only），宰相手工链完成+批示:批准【R6】重建站立→本拍
      //    mergeTo 进此分支：v0 模拟迁移转正（同迁移语义零变更，note 如实——无真 git
      //    合并，git 面由宰相手工链亲跑）。不再派发/降级：合并跑总数恒 1（不自动重试）。
      return simulatedMergeTransition(
        host, action, index, tickEvents,
        `→${action.toState}（手工链收口：宰相手工链完成＋批示:批准【R6：宰相∪制作人∪派单策划】——v0 模拟迁移转正：无真 git 合并，git 面由宰相手工链亲跑；${MERGE_MANUAL_ANCHOR} 终局让位自合并，一次失败不二跑）`,
        `→${action.toState}（手工链收口——宰相手工链+v0 模拟迁移转正）`,
      )
    }
    const leaseKey = mergeLeaseKey(host.config.company, deps.targetBranch)
    if (!host.mergeLease.acquire(leaseKey, ticket, host.now())) {
      return { result: { ticket, actionType: action.type, ok: true, detail: 'merge-lease-busy（在途合并跑占位——顺延不弃单，下拍重试）' }, deferred: true, counted: false, mutated: false, leaseBusy: true }
    }
    const resolved = await resolveMergeRunPlan(host, deps, ticket)
    if ('degrade' in resolved) {
      host.mergeLease.release(leaseKey, ticket)
      return degradeToManualChain(host, fresh, index, tickEvents, resolved.degrade)
    }
    const launched = await dispatchMergeRun(host, deps, resolved.plan, fresh, index, tickEvents, budget, leaseKey)
    if (!launched.ok) {
      host.mergeLease.release(leaseKey, ticket)
      return { result: launched.result, deferred: false, counted: false, mutated: false }
    }
    // 派发成功：DISPATCH 已落账（mutated）；合并完成计数在收割收口面（counted=false）
    return { result: launched.result, deferred: false, counted: false, mutated: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { result: { ticket, actionType: action.type, ok: false, detail: `合并跑异常：${msg}` }, deferred: false, counted: false, mutated: false }
  }
}

// ————————————————————————— 派发（resume 唤起原会话） —————————————————————————

/** resumeWithSession 结构面（dsh 实现=类方法；契约接口外——结构探测，不 import 适配器包） */
type ResumeWithSessionFn = (task: TaskBrief, executorSessionId: string) => Promise<Handle>

/**
 * 合并跑派发：executeDispatch 同构镜像（装配/预算/launch/工时单/在途登记），位别接线
 * （零平台写、无 wkey、无泳道 acquire、attempt 续号）+ 合并指令块追加 + resume 唤起。
 * 预算 refusal=不派（预留不落即不派同律）；各失败面清指令文件；umask 窗口同款（P3-②）。
 */
async function dispatchMergeRun(
  host: MergeRunHost,
  deps: MergeRunDeps,
  plan: MergeRunPlan,
  fresh: IssueRecord,
  index: EventIndex,
  tickEvents: EventRecord[],
  budget: TickPhaseDispatchBudget,
  leaseKey: string,
): Promise<{ ok: boolean; result: TickActionResult }> {
  const ticket = fresh.id
  const person = host.resolvePerson(fresh)
  if (person === undefined) return { ok: false, result: { ticket, actionType: 'merge', ok: false, detail: '人员索引为空（people 未注入）——不派合并跑' } }
  const adapter = host.registry.resolve(plan.executor)
  const detect = await adapter.detect()
  if (!detect.ok) return { ok: false, result: { ticket, actionType: 'merge', ok: false, detail: `executor ${adapter.name} detect 不达标：${detect.gaps.join('；')}` } }
  const attempt = index.attemptOf(ticket)
  const workspace = plan.workspace
  const briefPath = path.join(workspace, MERGE_BRIEF_FILENAME)
  const receiptPath = path.join(workspace, MERGE_RECEIPT_FILENAME)
  const nativeAgents = adapter.capabilities.agents_md === 'native'
  const agentsTarget = nativeAgents ? path.join(workspace, 'AGENTS.md') : instructionsTarget(host.config.rootDir, ticket)
  let instructionsPath: string | undefined
  const at = host.now()
  let prevUmask: number | undefined
  try {
    const readTier = resolveReadTier(roleOfAssignee(fresh.assignee, host.people()), host.config.readTierByRole)
    const readView = await createView(host.platform, readTier, ticket, {
      ...(readTier === 'blind'
        ? { blind: { acceptance: host.config.readBlindAcceptance ?? [], artifacts: blindArtifactPaths(workspace) } }
        : {}),
    })
    const assembled = host.assemble({
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
      resume: {
        sessionId: plan.daemonSessionId,
        summaryPath: plan.summaryPath,
        summary: plan.summary,
        note: `合并跑续跑（202-P2）：续自第 ${plan.lastAttempt} 誓——本誓为批准后的自合并（先门禁后 MERGE）`,
      },
    })
    prevUmask = process.umask(WORKSPACE_UMASK)
    mkdirSync(workspace, { recursive: true })
    if (nativeAgents) {
      writeFileSync(agentsTarget, assembled.agentsMd.text, 'utf8')
    } else {
      instructionsPath = agentsTarget
      writeInstructions(agentsTarget, assembled.agentsMd.text)
    }
    const briefText = `${assembled.brief.text}\n${mergeDirectiveBlock(deps.targetBranch, deps.gateCommand)}`
    writeFileSync(briefPath, briefText, 'utf8')
    const taskBrief = assembled.brief.taskBrief
    const personDay = personDayGateInput(host.costGuard(), person, host.ledger, at)
    const gate = await gateDispatch(host.budgetDeps, {
      ticket,
      personId: person.id,
      adapter,
      taskBrief,
      briefChars: assembled.brief.text.length,
      ...(host.config.budgetTicketCapUsd !== undefined ? { fallbackTicketCapUsd: host.config.budgetTicketCapUsd } : {}),
      ...(host.config.budgetPersonCapUsd !== undefined ? { personCapUsd: host.config.budgetPersonCapUsd } : {}),
      ...(personDay !== undefined ? { personDay } : {}),
      now: at,
    })
    if (gate.kind === 'refused') {
      budget.budgetRefused += 1
      if (instructionsPath !== undefined) removeInstructions(instructionsPath)
      return { ok: false, result: { ticket, actionType: 'merge', ok: false, detail: `budget-refusal:${gate.reason}：估算 $${gate.estimated} 超帽——不派合并跑（refusal 行已落账）` } }
    }
    if (gate.kind === 'reserved') budget.budgetReserved += 1
    const resumeFn = (adapter as { resumeWithSession?: unknown }).resumeWithSession
    const launched =
      typeof resumeFn === 'function'
        ? await (resumeFn as ResumeWithSessionFn).call(adapter, taskBrief, plan.executorSessionId)
        : await adapter.launch(taskBrief)
    const workRecordId = host.makeId(at)
    const lane = fresh.lane ?? host.config.defaultLane
    host.ledger.insertWorkRecord({
      id: workRecordId,
      issue: ticket,
      person_id: person.id,
      executor: adapter.name,
      session_id: launched.sessionId,
      lane,
      started_at: at,
      attempt,
      status: 'running',
    })
    host.inflight.set(ticket, {
      ticket,
      workRecordId,
      executor: adapter.name,
      handle: launched,
      workspace,
      briefPath,
      attempt,
      lane,
      personId: person.id,
      dispatchedAtSeq: host.seq(),
      ...(instructionsPath !== undefined ? { instructionsPath } : {}),
      mergeRun: { deps, leaseKey, targetBranch: deps.targetBranch, reviewTip: plan.reviewTip, receiptPath, causationId: plan.causationId, executorSessionId: plan.executorSessionId },
    })
    host.makeEvent('DISPATCH', fresh, attempt, tickEvents, {
      size: Buffer.byteLength(assembled.agentsMd.text, 'utf8'),
      payload_hash: `sha256:${createHash('sha256').update(assembled.agentsMd.text, 'utf8').digest('hex')}`,
      causation_id: plan.causationId,
      note: `fp=${assembled.agentsMd.fingerprint};${MERGE_RUN_ANCHOR};executor=${adapter.name}@${detect.version};read=${readTier};agents=${agentsTarget};brief=${briefPath};budget=${gate.kind === 'reserved' ? `reserve$${gate.estimated.toFixed(4)}` : `adopt$${gate.estimated.toFixed(4)}`};resume=${plan.executorSessionId}@${adapter.name}（合并跑唤起原会话，续自第 ${plan.lastAttempt} 誓，causation=${plan.causationId}）`,
    })
    return { ok: true, result: { ticket, actionType: 'merge', ok: true, detail: '合并跑已派发（resume 唤起原会话→自合并；收割收口在途）' } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (instructionsPath !== undefined) removeInstructions(instructionsPath)
    return { ok: false, result: { ticket, actionType: 'merge', ok: false, detail: `MERGE_DISPATCH_FAIL：${msg}` } }
  } finally {
    if (prevUmask !== undefined) process.umask(prevUmask)
  }
}

// ————————————————————————— 收割收口（先门禁后 MERGE） —————————————————————————

/**
 * 合并跑收割收口（finalizeHarvest 位别分支）：四要件=终态 completed+非空输出+回执落盘+
 * 闸门 exit0（=门禁命令 exit0【R1 引擎亲跑】∧ 合并提交存在性核验——两面都绿才算绿）。
 * 全绿序：GATE_PASS→代推 dev（R2，失败入 note 不阻迁移）→MERGE 真事件（sha/门禁摘要/
 * 会话续跑证据/推送结果）→迁已交付→工时单 done+executor_session_id 收口→预算结算→
 * usage write-through→租约释放。缺件：GATE_FAIL（merge-run+merge=manual+category=
 * MERGE_CONFLICT 锚——202-P3 冲突兜底：清站立+终局让位+分类可观测）+ESCALATE 通知宰相
 * +工时单 failed+结算（不留悬空预留）+租约释放——**无回滚无断路无平台迁移，不自动重试**
 * （留待验收位归宰相手工链；批示:批准【R6】后模拟迁移收口）。
 */
export async function closeOutMergeHarvest(
  host: MergeRunHost,
  adapter: ExecutorAdapter,
  entry: Inflight,
  tickEvents: EventRecord[],
  errors: string[],
): Promise<'completed' | 'failed'> {
  const ticket = entry.ticket
  const ctx = entry.mergeRun
  if (ctx === undefined) throw new Error('closeOutMergeHarvest：Inflight.mergeRun 缺位（调用面错接线）')
  const deps = ctx.deps
  const completed = entry.foldCompleted ?? false
  const nonEmptyOutput = entry.foldNonEmpty ?? false
  let receiptExists = false
  try {
    receiptExists = statSync(ctx.receiptPath).size > 0
  } catch {
    receiptExists = false
  }
  const gate = await runMergeGate({ git: deps.git, gate: deps.gate, repoDir: path.join(entry.workspace, deps.repoRelPath ?? 'repo'), reviewTip: ctx.reviewTip, targetBranch: ctx.targetBranch })
  const verdict = { completed, nonEmptyOutput, receiptExists, exit0: gate.exit0 }
  const fourOk = verdict.completed && verdict.nonEmptyOutput && verdict.receiptExists && verdict.exit0
  const fresh = await host.platform.issues.get(ticket)
  const stats = await adapter.resultStats(entry.handle)
  const harvestCost = foldHarvestCost(host.ledger, host.config.company, stats, host.modelTiers !== undefined ? (host.modelTiers() as never) : undefined, host.now())
  const missing = [
    ...(verdict.completed ? [] : ['终态completed']),
    ...(verdict.nonEmptyOutput ? [] : ['非空输出']),
    ...(verdict.receiptExists ? [] : [`回执${MERGE_RECEIPT_FILENAME}`]),
    ...(verdict.exit0 ? [] : ['闸门exit0']),
  ].join('/')
  const endedAt = host.now()
  const execSid = entry.handle.executorSessionId ?? ctx.executorSessionId
  let budgetNote = '' // 预算结算（两面都结——不留悬空预留；异常如实入 note 不改判）
  try {
    const settled = settleDispatch(host.budgetDeps, { ticket, personId: entry.personId, actual: { usd: harvestCost.usd }, now: endedAt })
    budgetNote = `;budget=settle 冲销 $${settled.released.toFixed(4)} 实际 $${settled.actualUsd.toFixed(4)}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`合并跑预算结算异常 ${ticket}：${msg}`)
    budgetNote = `;budget=settle 失败（${msg}）`
  }
  if (!fourOk) {
    host.ledger.endWorkRecord(entry.workRecordId, { ended_at: endedAt, status: 'failed', ...(execSid !== undefined ? { executor_session_id: execSid } : {}) })
    host.inflight.delete(ticket)
    host.mergeLease.release(ctx.leaseKey, ticket)
    // —— 冲突兜底（202-P3，§5.5）：四要件跑完可判不齐＝MERGE_CONFLICT 既有类 ——
    // GATE_FAIL（merge-run 锚清站立+merge=manual 锚终局让位【P2 已落】）+category 锚
    // 分类可观测；ESCALATE 通知宰相（低噪不广播）。不做 chain=manual 式 dedupe：冲突
    // 每单至多一次（manual 锚 append-only 挡重派→合并跑单次），且 chain=manual 锚留给
    // 降级面——免吞「先降级后冲突」单的冲突通知。worker 消亡面不进此分支（不可判≠冲突）。
    host.makeEvent('GATE_FAIL', fresh, entry.attempt, tickEvents, {
      note: `合并跑四要件缺 ${missing}；${noteSafe(gate.note)};${MERGE_RUN_ANCHOR};${MERGE_MANUAL_ANCHOR};${MERGE_CONFLICT_ANCHOR}——冲突兜底：一次自合并失败即宰相手工链（不自动重试：同会话重试=同结果空转；待验收位不动：无回滚/无断路/无平台迁移；工时单 failed+预算已结算）${budgetNote}`,
    })
    host.makeEvent('ESCALATE', fresh, entry.attempt, tickEvents, {
      note: `MERGE_CONFLICT：合并跑四要件缺 ${missing}——一次自合并失败即宰相手工链兜底（${MERGE_MANUAL_ANCHOR} 终局让位自合并，不自动重试：同会话重试=同结果空转）；手工链完成后批示:批准（R6：宰相∪制作人∪派单策划）即模拟迁移收口;${MERGE_RUN_ANCHOR};${MERGE_CONFLICT_ANCHOR}`,
    })
    if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
    return 'failed'
  }
  // —— 全绿：先门禁后 MERGE ——
  host.makeEvent('GATE_PASS', fresh, entry.attempt, tickEvents, {
    tokens: stats.tokens,
    cost_usd: harvestCost.usd,
    duration_ms: stats.duration,
    note: `合并跑四要件齐（终态/非空/回执${MERGE_RECEIPT_FILENAME}/闸门exit0）；${MERGE_RUN_ANCHOR};gate=${noteSafe(gate.note)};receipt=${ctx.receiptPath}${budgetNote}${harvestCost.noteSuffix}`,
  })
  const push = await deps.git.push(path.join(entry.workspace, deps.repoRelPath ?? 'repo'), ctx.targetBranch)
  const flow = host.flowOf(fresh)
  const toState = flow !== undefined ? flowAnchors(flow).delivered : '已交付' // 等级未登记流防御缺省（正常链路 flow 恒在）
  const transitioned = await host.platform.issues.transition(ticket, toState)
  host.syncMirror(transitioned)
  const usageNote = writeThroughHarvestUsage({
    ledger: host.ledger, company: host.config.company, personId: entry.personId, workRecordId: entry.workRecordId,
    model: stats.model, tokens: stats.tokens, endedAt, makeId: host.makeId, onError: (message) => errors.push(message),
  })
  host.ledger.endWorkRecord(entry.workRecordId, {
    ended_at: endedAt,
    status: 'done',
    cost_usd: harvestCost.usd,
    tokens: stats.tokens,
    ...(stats.model !== undefined ? { model: stats.model } : {}),
    report_ref: ctx.receiptPath,
    ...(execSid !== undefined ? { executor_session_id: execSid } : {}),
  })
  host.makeEvent('MERGE', transitioned, entry.attempt, tickEvents, {
    tokens: stats.tokens,
    cost_usd: harvestCost.usd,
    duration_ms: stats.duration,
    note: `→${toState}（v0.5 真单刀：sha=${gate.mergeSha ?? '?'};gate=exit0【${noteSafe(gate.note)}】;resume=${ctx.executorSessionId}@${entry.executor}（唤起原会话自合并，causation=${ctx.causationId}）;push=${push.ok ? `ok（${push.note}）` : `fail（${push.note}——迁移照走，P4 重试面）`}${usageNote}）`,
  })
  host.inflight.delete(ticket)
  host.mergeLease.release(ctx.leaseKey, ticket)
  if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
  return 'completed'
}

/**
 * 合并跑失败收口（failHarvest 位别分支——worker 消亡/executor 除名面）：GATE_FAIL+手工
 * 链锚+工时单 failed+结算+租约释放。断路器**不计连击**（位别接线：合并跑成败与工质
 * 无关）；无回滚无平台迁移（留待验收位）。
 */
export async function failMergeHarvest(
  host: MergeRunHost,
  entry: Inflight,
  detail: string,
  tickEvents: EventRecord[],
): Promise<'failed'> {
  const ticket = entry.ticket
  const ctx = entry.mergeRun
  const endedAt = host.now()
  const execSid = entry.handle.executorSessionId ?? ctx?.executorSessionId
  host.ledger.endWorkRecord(entry.workRecordId, { ended_at: endedAt, status: 'failed', ...(execSid !== undefined ? { executor_session_id: execSid } : {}) })
  host.inflight.delete(ticket)
  if (ctx !== undefined) host.mergeLease.release(ctx.leaseKey, ticket)
  let budgetNote = ''
  try {
    const settled = settleDispatch(host.budgetDeps, { ticket, personId: entry.personId, actual: { usd: 0 }, now: endedAt })
    budgetNote = `;budget=settle 冲销 $${settled.released.toFixed(4)} 实际 $0`
  } catch {
    budgetNote = ';budget=settle 失败（预留滞留——同票后续派发 adopt 可见）'
  }
  const issue = await host.platform.issues.get(ticket).catch((): IssueRecord => ({ id: ticket }) as IssueRecord)
  host.makeEvent('GATE_FAIL', issue, entry.attempt, tickEvents, {
    note: `${noteSafe(detail)};${MERGE_RUN_ANCHOR};${MERGE_MANUAL_ANCHOR}——降级宰相手工链（待验收位不动：无回滚/无断路/无平台迁移）${budgetNote}`,
  })
  if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
  return 'failed'
}
