/**
 * drain —— 相位 2 前置：意图队列消费（kind→handler 普适分发表）
 *
 * 自 engine.ts 抽件（20-§十五「先拆再增」——129-E studio-dev-184 拆出腾基线，语义逐字
 * 保持；engine 只留出队/收账锚）。消费门（105-刀A A-2）：前置共闸对全 kind 一致
 * （公司匹配 → 分发表命中 → 无 ticket 意图缺 dedupKey=HOLD_INTENT_MALFORMED 明报拒收，
 * 25-§3.4 v1.3），无 kind 特判（判负线①）。
 *
 * 分发表开闸史：schedule｜mention（105-刀A）→ webhook｜data-change（129-A，本体
 * intent-taxonomy.ts）→ escalate（129-D 181，本体 escalate.ts——costGuard 活取+notify
 * 出口经 escalateDeps 追加注入）→ relay｜resume（129-E 184，本体 relay-resume.ts——
 * 六源全通 v0.8 档收口；装配缝 relay-resume-faces.ts）。分发表外 kind 仅 ticket
 * （活动/镜像内部 kind，非源产面）。
 */
import type {
  CostGuardConfig,
  EventRecord,
  FlowPlatform,
  InvokeIntent,
  IssueRecord,
  TicketId,
} from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import {
  DEFAULT_FLOW_TABLE,
  flowAnchors,
  intentKeyOf,
  resolveTicketFlow,
} from '@studio-next/core'
import { createDataChangeConsumer, createMentionConsumer, createWebhookConsumer } from './taxonomy.ts'
import { createEscalateConsumer, type CostThresholdNotice } from './escalate.ts'
import { wireRelayResumeFaces, type RelayResumeFaces } from './relay-resume-faces.ts'

/** drain 依赖（engine tick 作用域注入——本件零引擎内部状态持有，回写全走引址面） */
export interface DrainDeps {
  /** 本拍已出队意图（engine tick splice 产物——本件不持队列） */
  drained: readonly InvokeIntent[]
  ledger: Ledger
  platform: FlowPlatform
  syncMirror: (issue: IssueRecord) => void
  makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  tickEvents: EventRecord[]
  config: {
    company: string
    flows?: Parameters<typeof resolveTicketFlow>[0]
    dataChangeRoutes?: Readonly<Record<string, string>>
    costThresholdTarget?: string
    costThresholdLane?: string
  }
  people: ReadonlyArray<{ id: string; dept?: string }>
  departments?: ReadonlyArray<{ path: string; lanes: readonly string[] }>
  costGuard: () => CostGuardConfig | undefined
  notify?: (notice: CostThresholdNotice) => void
  /** 队列峰值优先级登记位（P0-B「priority=3 置顶」——escalate 消费件注入面） */
  touch: (ticket: TicketId, intent: InvokeIntent) => void
  onMutation: () => void
  /** 明报面（tick errors） */
  errors: string[]
  /** 拍内幂等（同拍同键只消费一次） */
  drainSeen: Set<string>
  /** 决策候选（同拍一单至多一动作——engine 候选去重不变量） */
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  /** 跨拍意图幂等键集（PATROL 留痕键 append-only——22-§三.2） */
  patrolKeys: ReadonlySet<string>
  /** 拍首时戳（schedule 物化标题 ISO 锚） */
  startedAt: number
}

export async function drainIntents(deps: DrainDeps): Promise<RelayResumeFaces> {
  const { ledger, platform, syncMirror, makeEvent, tickEvents, config, people, errors, drainSeen, candidates } = deps

  // schedule handler：排程意图物化岗单据（v0.4 既有语义逐字保持——payload.job_id 校验/
  // 台账查岗/L0 物化/PATROL 留痕）
  const consumeSchedule = async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    const payload = (intent.payload ?? {}) as { job_id?: unknown }
    if (typeof payload.job_id !== 'string' || payload.job_id === '') {
      errors.push('意图消费：schedule 意图 payload 缺 job_id——丢弃')
      return
    }
    const job = ledger.getJob(payload.job_id)
    if (job === undefined) {
      errors.push(`意图消费：job ${payload.job_id} 不在台账（热更移除？）——丢弃`)
      return
    }
    try {
      // 物化岗单据：岗流 + job.role 命工号则精确指派（口径见 engine.ts 文件头注）。
      // 落位分型（DEV-40 + 127-A R3 丁案——studio-dev-127 §4.4 批示①，2026-10-22）：
      //   - 工单型岗（report/cadence 等产出实工件）：type='task' 不指定落位→适配器落流程
      //     初态（新单），照走 v0.4 派发-收割链（16-§四）；budget_cap 正因会派发才存在。
      //   - 巡查岗（payload.type='patrol'）：**type='patrol' 丁案**——终态名走
      //     workflows T:patrol 类型流声明（推荐「巡毕无产出」final；W-9 只保留 bug/task，
      //     patrol 可声明——DEV-43 类型优先解析）；镜像 state≠「已交付」→报表已交付计数
      //     结构性不含巡查工件（spike-② 判负线）。T:patrol 未声明→L0 delivered 兜底
      //     （现状行为原样；装载警告面 jobContractLoadWarnings 让退化可见，不炸既有配置）。
      //     巡查工件不是工单——落终态锚点结构性不可派发，decide 恒走回收 CLOSE。
      const isPatrolArtifact = ((job.payload as { type?: unknown } | undefined)?.type) === 'patrol'
      // 岗单物化流：resolveTicketFlow 同函数同序（与 decide/flowOf 永不漂移）——工单型走
      // 'task'（W-9 不收 T:task，恒落 L0 回退=现状）；巡查型走 'patrol'（T 优先 L 回退）
      const materializeType = isPatrolArtifact ? 'patrol' : 'task'
      const artifactFlow = resolveTicketFlow(config.flows ?? DEFAULT_FLOW_TABLE, materializeType, 0)
      const created = await platform.issues.create({
        title: `[定时岗] ${job.job_id} ${new Date(deps.startedAt).toISOString()}`,
        type: materializeType,
        dept: job.dept,
        level: 0,
        assignee: job.role,
        ...(isPatrolArtifact && artifactFlow !== undefined ? { initialState: flowAnchors(artifactFlow).delivered } : {}),
      })
      syncMirror(created)
      makeEvent('PATROL', created, 1, tickEvents, {
        note: `intent=${intentKey};job=${job.job_id};cron=${job.cron};role=${job.role};dedup=${intent.dedupKey};来源=${intent.source}`,
      })
      deps.onMutation()
      drainSeen.add(intentKey)
      candidates.push({ ticket: created.id, intent })
    } catch (err) {
      errors.push(`意图消费：job ${job.job_id} 岗单据物化失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // webhook｜data-change handler（129-A）：本体拆在 engine/intent-taxonomy.ts（20-§十五
  // 尺寸门「先拆再增」——129-§6.1 分类学消费件：契约面+消费工厂零引擎内部态持有）；
  // 此处只以 tick 作用域依赖装配（共闸四件+落单面注入），分发表注册口径与 105-刀A 同构。
  // mention 消费件同族迁入（129-D 181 先拆再增）；escalate 消费件（129-D）本体在
  // engine/intents/escalate.ts——costGuard 活取（热重载感知）+notify 出口（刀B 登记位）
  // +costThresholdTarget/Lane（缺省路由表/泳道落位）经 escalateDeps 追加注入。
  const consumerDeps = {
    platform,
    syncMirror,
    makeEvent,
    tickEvents,
    config,
    people,
    errors,
    drainSeen,
    candidates,
    onMutation: deps.onMutation,
  }
  const consumeWebhook = createWebhookConsumer(consumerDeps)
  const consumeDataChange = createDataChangeConsumer(consumerDeps)
  const consumeMention = createMentionConsumer(consumerDeps)
  const consumeEscalate = createEscalateConsumer({
    ...consumerDeps,
    ...(deps.departments !== undefined ? { departments: deps.departments } : {}),
    costGuard: deps.costGuard,
    ...(deps.notify !== undefined ? { notify: deps.notify } : {}),
    touch: deps.touch,
  })

  // —— relay/resume 消费件（129-E 单E，studio-dev-184；装配缝 intents/relay-resume-faces.ts）——
  // resumePlans=拍作用域续跑计划登记面（drain 段登记→本拍 dispatch 段携带→executeDispatch
  // 切续跑形；未派发即失效——重发意图即重试）
  const relayResume = wireRelayResumeFaces({ ledger, errors, drainSeen, candidates })

  // 普适分发表（105-刀A A-2）：新 kind 开闸=注册一个 handler，前置共闸/幂等零改。
  // 129-A 扩 webhook（只落单——落单链收口+派工链登记位）｜data-change（联动单物化+
  // 路由指派）两行；129-D（181）开 escalate 槽——cost-threshold 类消费（处置单物化/
  // notify 出口/gate 留痕，sla 类仍 class 级明报归刀B）。
  const intentHandlers: {
    [K in InvokeIntent['kind']]?: (intent: InvokeIntent, intentKey: string) => Promise<void>
  } = {
    schedule: consumeSchedule,
    mention: consumeMention,
    webhook: consumeWebhook,
    'data-change': consumeDataChange,
    escalate: consumeEscalate,
    relay: relayResume.consumeRelay, // 129-E（184）：零物化重估——F1-11「请重估单 X」
    resume: relayResume.consumeResume, // 129-E（184）：断点续跑——F1-15 work_records 断点+续跑版任务书
  }

  for (const intent of deps.drained) {
    if (intent.company !== config.company) {
      errors.push(`意图消费：公司不匹配（intent=${intent.company} engine=${config.company}）——丢弃`)
      continue
    }
    const handler = intentHandlers[intent.kind]
    if (handler === undefined) {
      errors.push(`意图消费：kind='${intent.kind}' 不支持（消费门分发表：schedule｜mention（105-刀A）；webhook｜data-change（129-A）；escalate（129-D，class 级判别——sla 类仍归刀B）；relay｜resume（129-E——六源全通 v0.8 档收口）；分发表外仅 ticket（活动/镜像内部 kind，非源产面）——丢弃`)
      continue
    }
    // HOLD_INTENT_MALFORMED 前置闸（25-§3.4 v1.3，判负线②）：无 ticket 意图必填
    // dedupKey——明报拒收不静默（对 schedule/mention 及后续开闸的每个 kind 一致）
    if (intent.ticket === undefined && (typeof intent.dedupKey !== 'string' || intent.dedupKey === '')) {
      errors.push(`意图消费：${intent.kind} 意图缺 dedupKey（无 ticket 意图必填，invoke v1.3）——丢弃`)
      continue
    }
    const intentKey = intentKeyOf(intent)
    // 意图幂等（22-§三.2）：PATROL 已留痕的键（append-only 不释放——markRan 已记账，
    // 重投不得重跑）或本拍重复键，只物化一次
    if (deps.patrolKeys.has(intentKey) || drainSeen.has(intentKey)) continue
    await handler(intent, intentKey)
  }
  return relayResume // resumePlans 登记面读口（engine dispatch 段携带——拍作用域）
}
