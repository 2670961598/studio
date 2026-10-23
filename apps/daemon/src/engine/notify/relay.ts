/**
 * notify 中继（105-刀B，studio-dev-219）——事件→频道广播的执行体 + 惊动计量。
 *
 * 落位：serve 主循环**拍边界**（engine.tick() 收口后、下一拍前，docs/17-§2 七相位结构
 * 不动——中继在相位外只读本拍新事件 TickReport.events，不写引擎状态）。escalate
 * cost-threshold 警戒不走本中继：181 消费拍经 EngineDeps.notify 出口即时发（busy 场景
 * =队首+即时提醒，129 批示项④——不等拍尾），出口由 serve 装配时指向本文件的
 * costNoticeOutlet（ deptOf 注入 people 索引解析 target 部门）。
 *
 * 失败面（刀B-6）：广播是沟通面非执行前置——face 软失败/异常只落日志+计量 failed 数，
 * 永不抛出阻主循环（面板（:8789，读 events 台账）始终是 critical 第一落点；矩阵挂=
 * IM 副本缺失，台账/面板事实完备，docs/19-§六冻结序不变）。
 *
 * 惊动计量（刀B-7）：每批聚合一次 onMeasure（PATROL note 锚 `notify=sent:<n>…`，serve
 * 装配面落台账——事件词表冻结零新增，NOTIFY_* 枚举扩展仍 gated 批示项 8；08-§四十 ≤3/日
 * 惊动预算的可测基线=按 note 计数聚合）。零发送零失败批不计量（零噪音面）。
 */
import type { EventRecord, Notification } from '@studio-next/contract'
import type { CostThresholdNotice } from '../intents/escalate.ts'
import { NotifyDedup } from './dedup.ts'
import { planCostNoticeBroadcast, planEventBroadcast } from './route.ts'
import type { NotifyBroadcastFace, NotifySendReport } from './broadcast.ts'

/** 惊动计量批（一批聚合一次；serve 装配面写 PATROL note） */
export interface NotifyMeasureBatch {
  sent: number
  failed: number
  /** 分角色计数（alert/overview/dept:<path>） */
  byRole: Readonly<Record<string, number>>
  /** 分事件 kind 计数（gate/report/stall/breaker/alarm/cost） */
  byKind: Readonly<Record<string, number>>
}

export interface NotifyRelayOptions {
  face: NotifyBroadcastFace
  /** 出面署名（Notification.from——105-刀B-4；serve 传 `daemon@<company>` 形） */
  from: string
  /** cost 警戒 target 工号 → 部门 path（serve 注入 people 索引活取；缺省=只投 #alert+总览） */
  deptOf?: (target: string) => string | undefined
  log?: (line: string) => void
  dedup?: NotifyDedup
  /** 计量回调（每批聚合一次；零发送零失败不调） */
  onMeasure?: (batch: NotifyMeasureBatch) => void
}

/** 计量累加器（一批一个） */
class Tally {
  sent = 0
  failed = 0
  readonly byRole: Record<string, number> = {}
  readonly byKind: Record<string, number> = {}

  private static bump(map: Record<string, number>, key: string): void {
    map[key] = (map[key] ?? 0) + 1
  }

  absorb(report: NotifySendReport, kind: string): void {
    for (const _role of report.sent) {
      this.sent += 1
      Tally.bump(this.byRole, _role)
      Tally.bump(this.byKind, kind)
    }
    for (const _f of report.failed) {
      this.failed += 1
      Tally.bump(this.byKind, kind)
    }
  }

  get empty(): boolean {
    return this.sent === 0 && this.failed === 0
  }

  snapshot(): NotifyMeasureBatch {
    return { sent: this.sent, failed: this.failed, byRole: { ...this.byRole }, byKind: { ...this.byKind } }
  }
}

/** 广播全文/摘要到目标频道（face 契约永不抛——双保险 try/catch 归中继，刀B-6） */
async function deliver(
  face: NotifyBroadcastFace,
  full: Notification,
  digest: Notification,
  targets: { alert: boolean; dept?: string; overview: boolean },
  kind: string,
  tally: Tally,
  log: (line: string) => void,
): Promise<void> {
  const sends: Array<{ message: Notification; targets: { alert?: boolean; overview?: boolean; dept?: string } }> = []
  if (targets.alert || (targets.dept !== undefined && targets.dept !== '')) {
    sends.push({
      message: full,
      targets: { ...(targets.alert ? { alert: true } : {}), ...(targets.dept !== undefined && targets.dept !== '' ? { dept: targets.dept } : {}) },
    })
  }
  if (targets.overview) sends.push({ message: digest, targets: { overview: true } })
  for (const s of sends) {
    try {
      const report = await face.send(s.message, s.targets)
      tally.absorb(report, kind)
      for (const f of report.failed) {
        log(`[notify] 广播软失败（${kind}→${f.target}，面板仍第一落点——刀B-6）：${f.reason}`)
      }
    } catch (err) {
      // face 契约永不抛；双保险防装配面换实现时把沟通面故障升级成主循环错误
      const msg = err instanceof Error ? err.message : String(err)
      log(`[notify] 广播异常（${kind}，双保险捕获；面板仍第一落点）：${msg}`)
      tally.failed += 1
      tally.byKind[kind] = (tally.byKind[kind] ?? 0) + 1
    }
  }
}

/** relay 工厂：拍边界事件中继 + cost 警戒即时出口（181 EngineDeps.notify 接线件） */
export function createNotifyRelay(options: NotifyRelayOptions): {
  /** 拍边界事件中继（serve 主循环 tick() 后调用；只读 events，永不抛） */
  relayEvents: (events: readonly EventRecord[]) => Promise<void>
  /** cost-threshold 警戒即时出口（消费拍发，不等拍尾——129 批示项④） */
  costNoticeOutlet: (notice: CostThresholdNotice) => void
} {
  const log = options.log ?? ((): void => {})
  const dedup = options.dedup ?? new NotifyDedup()
  const measure = (tally: Tally): void => {
    if (!tally.empty) options.onMeasure?.(tally.snapshot())
  }
  return {
    async relayEvents(events: readonly EventRecord[]): Promise<void> {
      const tally = new Tally()
      for (const event of events) {
        const plan = planEventBroadcast(event, options.from)
        if (plan === undefined) continue
        if (!dedup.shouldSend(event.event, event.issue, event.attempt, event.note)) continue
        await deliver(options.face, plan.message, plan.digest, plan.targets, plan.kind, tally, log)
      }
      measure(tally)
    },
    costNoticeOutlet(notice: CostThresholdNotice): void {
      // 消费拍即时发（fire-and-forget）：出口是同步签名（EngineDeps.notify），IM 投递
      // 异步化不阻消费；失败面同 relay（日志+计数，不抛）
      void (async (): Promise<void> => {
        const dept = options.deptOf?.(notice.target)
        const plan = planCostNoticeBroadcast(notice, dept, options.from)
        const tally = new Tally()
        await deliver(options.face, plan.message, plan.digest, plan.targets, plan.kind, tally, log)
        measure(tally)
      })().catch((err: unknown): void => {
        log(`[notify] cost 警戒广播异常（双保险捕获）：${err instanceof Error ? err.message : String(err)}`)
      })
    },
  }
}
