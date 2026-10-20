/**
 * sentinels —— DEV-49 A4 双哨：未知态哨 + 状态集巡逻核（docs/52-§十；S0=docs/32-§九）。
 *
 * 防线分工：根治三步（@studio-next/taiga factory：默认态重指/存量归化/出厂态退役，
 * onboard 接线）治**存量与默认值**；引擎哨治**增量回流**——出厂态残留/平台侧手改/
 * 新模板重拷再进平台时，NOOP_UNKNOWN_STATE 静默链（14 单卡 2 小时的观察黑洞，
 * docs/17-§2 state-diff）之上叠一层账面告警。
 *
 * 设计约束（冻结面不碰）：
 *   - 事件词表既有名（ESCALATE）——不扩 contract EVENT_NAMES
 *   - 主循环七相位结构不变（docs/17-§2）：哨在相位 1 尾执行（数据源=相位 1 已取的
 *     issues.list 全量——哨本体零额外平台 IO；巡逻核唯一读放大 fields.schema 由
 *     statusSetPatrolEveryTicks 节流，mirrorRescanEveryTicks 同法）
 *   - 哨=观测非驱动：不改平台态（根治动作在 onboard 三步）；计 mutations（RESUME
 *     同口径）——有哨账的拍不落心跳，防心跳掩盖哨事件
 *
 * 洪泛控制（append-only 事件派生键，PATROL 键同法；键集由 events-index.ts 重建）：
 *   - 单级哨：键=`${ticket}|${state}`——每单每态告一次（治存量后不刷屏；新流外态=新键=新告）
 *   - 巡逻核：键=漂移状态名——每状态名告一次
 */
import type { FieldSchema, IssueRecord, TicketId } from '@studio-next/contract'
import { DEFAULT_FLOW_TABLE, flowStates, type FlowTable, type StateFlow } from '@studio-next/core'

/** 哨事件落账口（引擎闭包 makeEvent 的窄投影：词表/账面细节留在引擎） */
export type SentinelEmit = (issue: IssueRecord, attempt: number, note: string) => void

/** 双哨依赖（引擎拍内可得的全部输入；纯函数化便于崩溃注入与测试） */
export interface Dev49SentinelDeps {
  /** 相位 1 已取的全量单（哨数据源——不额外拉平台） */
  issues: readonly IssueRecord[]
  /** 定流器（引擎 flowOf 同函数——两处定流永不漂移，docs/18-§2.1.1） */
  flowOf(issue: IssueRecord): StateFlow | undefined
  /** 单级哨已告键集（事件派生） */
  alarmedKeys: ReadonlySet<string>
  /** 巡逻核已告状态名集（事件派生） */
  driftKeys: ReadonlySet<string>
  /** attempt 求值器（事件派生） */
  attemptOf(ticket: TicketId): number
  /** 落账口 */
  emit: SentinelEmit
  /** 巡逻核输入（every=0 即关——负对照/测试隔离口径） */
  patrol: {
    seq: number
    every: number
    schema(): Promise<FieldSchema[]>
    flows?: FlowTable
    heartbeatIssue: string
    deptFallback: string
    at: number
  }
  /** schema 拉取失败归 errors 面（平台故障走平台故障的道，不误报哨） */
  onError(message: string): void
}

export interface Dev49SentinelOut {
  /** 单级哨本拍新告数 */
  alarmed: number
  /** 巡逻核本拍新告漂移状态名数（非巡逻拍恒 0） */
  drift: number
}

/**
 * 心跳哨兵单构造（HEARTBEAT 与巡逻核共用——events.issue 必填，contract）：
 * 无真实单据的平台级告警挂 config.heartbeatIssue（'-'）。
 */
export function heartbeatSentinelRecord(heartbeatIssue: string, deptFallback: string, at: number): IssueRecord {
  return {
    id: heartbeatIssue,
    title: '心跳哨兵',
    state: '-',
    dept: deptFallback,
    level: 1,
    updated: new Date(at).toISOString(),
  }
}

/** DEV-49 A4 双哨（相位 1 尾执行；体上移出 engine.ts=尺寸基线清偿，docs/20-§十五.三） */
export async function runDev49Sentinels(deps: Dev49SentinelDeps): Promise<Dev49SentinelOut> {
  // —— 单级哨：流可解析而 state∉声明集的单告警（闭单不豁免——闭单流外态正是残留类）——
  let alarmed = 0
  for (const issue of deps.issues) {
    const flow = deps.flowOf(issue)
    if (flow === undefined) continue // 流不可解析归 NOOP_UNKNOWN_FLOW 观测面（哨只管流外态）
    if (flowStates(flow).includes(issue.state)) continue
    if (deps.alarmedKeys.has(`${issue.id}|${issue.state}`)) continue
    deps.emit(issue, deps.attemptOf(issue.id), `UNKNOWN_STATE;state=${issue.state};type=${issue.type ?? '-'};level=${String(issue.level ?? '-')}`)
    alarmed += 1
  }

  // —— 巡逻核：平台状态集 − 有效流表声明集 ≠∅ → 心跳哨兵单逐漂移状态名告警 ——
  let drift = 0
  if (deps.patrol.every > 0 && deps.patrol.seq % deps.patrol.every === 0) {
    const schema = await deps.patrol.schema().catch((err: unknown) => {
      deps.onError(`状态集巡逻核失败（fields.schema）：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    })
    const platformStates = schema?.find((f) => f.name === 'state')?.values
    if (platformStates !== undefined) {
      const declared = new Set<string>()
      for (const flow of Object.values(deps.patrol.flows ?? DEFAULT_FLOW_TABLE)) {
        for (const s of flowStates(flow)) declared.add(s)
      }
      for (const name of platformStates) {
        if (declared.has(name) || deps.driftKeys.has(name)) continue
        deps.emit(
          heartbeatSentinelRecord(deps.patrol.heartbeatIssue, deps.patrol.deptFallback, deps.patrol.at),
          1,
          `UNKNOWN_STATUS;status=${name};declared=${String(declared.size)}`,
        )
        drift += 1
      }
    }
  }
  return { alarmed, drift }
}
