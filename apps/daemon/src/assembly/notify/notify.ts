/**
 * notify 广播中继装配（105-刀B，studio-dev-219）
 *
 * 自 assembly/serve.ts 拆出（BC-S2 先拆再增纪律 §十五.三.3）：三件套装配——
 *   ① 拍边界事件中继（runServe 主循环 tick() 后调 relayEvents——七相位结构不动，
 *      中继在 serve 边界、engine 零感知）
 *   ② escalate cost-threshold 警戒出口切 IM（181 v0 log 线保留——console/面板第一
 *      落点语义不变，IM 是叠加面；129 批示项④ busy 队首+即时提醒）
 *   ③ 惊动计量（PATROL note 锚 notify=sent:N;failed:N；事件词表零新增——零发送
 *      零失败批零落账；08-§四十 ≤3/日 预算的可测基线）
 *
 * daemon 不 import @studio-next/matrix（25-§一.2）：面=结构同形 NotifyBroadcastFace
 * （engine/notify/broadcast.ts），boot 组合根注入 createMatrixBroadcastFace 产物。
 */
import { createCostNotifyOutlet } from '../../engine/intents/escalate.ts'
import type { CostThresholdNotice } from '../../engine/intents/escalate.ts'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import { createNotifyRelay } from '../../engine/notify/relay.ts'
import type { EventRecord } from '@studio-next/contract'
import { makeUlid } from '../../engine/tools/id.ts'

/** 装配入参（serve 装配缝裁出——面+公司面常数+台账/时钟/日志） */
export interface WireNotifyOptions {
  /** 广播面（boot 注入 createMatrixBroadcastFace 产物；缺省=不装配零行为） */
  face: NotifyBroadcastFace
  company: string
  /** 计量锚=心跳哨兵单（181 PATROL/ESCALATE 同锚） */
  heartbeatIssue: string
  actor: string
  deptFallback: string
  /** events 唯一写口（计量 PATROL 行落账） */
  ledger: { appendEvent(record: unknown): unknown }
  clock: () => number
  /** cost 警戒 target→部门解析（people 索引活取——热重载随快照） */
  people: readonly { id: string; dept: string }[]
  log: (line: string) => void
}

/** 装配产物：拍边界中继面 + EngineDeps.notify 出口（v0 log 线已并入） */
export interface WiredNotify {
  relayEvents: (events: readonly EventRecord[]) => Promise<void>
  costNoticeOutlet: (notice: CostThresholdNotice) => void
}

/**
 * 一站装配：notifyRelay + cost 警戒出口（v0 log 线恒留——console/面板第一落点；
 * IM 即时广播叠加）。from=bot 代发出面署名（105-刀B-4，docs/21-§三二选一）。
 */
export function wireNotifyAssembly(opts: WireNotifyOptions): WiredNotify {
  const relay = createNotifyRelay({
    face: opts.face,
    from: `daemon@${opts.company}（bot 代发）`,
    deptOf: (target: string): string | undefined => {
      const p = opts.people.find((person) => person.id === target)
      return p?.dept
    },
    log: opts.log,
    onMeasure: (batch): void => {
      try {
        opts.ledger.appendEvent({
          id: makeUlid(opts.clock()),
          ts: opts.clock(),
          company: opts.company,
          issue: opts.heartbeatIssue,
          event: 'PATROL',
          actor: opts.actor,
          attempt: 1,
          level: 1,
          dept: opts.deptFallback,
          tokens: { input: 0 },
          note:
            `notify=sent:${batch.sent};failed:${batch.failed}` +
            `;roles=${Object.entries(batch.byRole).map(([k, v]) => `${k}:${v}`).join(',') || '-'}` +
            `;kinds=${Object.entries(batch.byKind).map(([k, v]) => `${k}:${v}`).join(',') || '-'}` +
            '（105-刀B-7 惊动计量：08-§四十 ≤3/日 预算的可测基线）',
        })
      } catch (err) {
        // 计量是观测面非执行前置——落账失败只留日志（不阻主循环/广播）
        opts.log(`[notify] 惊动计量 PATROL 落账失败（观测面软失败）：${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })
  const costLogOutlet = createCostNotifyOutlet(opts.log)
  return {
    relayEvents: relay.relayEvents,
    costNoticeOutlet: (notice: CostThresholdNotice): void => {
      costLogOutlet(notice)
      relay.costNoticeOutlet(notice)
    },
  }
}
