/**
 * 事件 → 频道广播路由表（105-刀B-2，studio-dev-219 任务书冻结口径；纯函数零 IO）
 *
 * 冻结路由（任务书原文：「GATE_PASS/STALL/断路/警戒→#alert 与部门频道；日报产物→
 * 部门频道；制作人总览频道低噪摘要」；总览语义=130 提案 §6.7.1「过闸/交付/成本摘要/
 * STALL/断路 bot 广播（F1 announce- 法；低噪只读）」）：
 *
 * | 事件                              | #alert | 部门频道 | 总览（摘要形） | kind    |
 * |-----------------------------------|--------|----------|----------------|---------|
 * | GATE_PASS（常规单过闸）            | ✓      | ✓        | ✓              | gate    |
 * | GATE_PASS note 携 `;output=`      | —      | ✓        | —              | report  |
 * |   （岗日报产物归档，output-account）|        |          |                |         |
 * | STALL（在工静默/咬合）             | ✓      | ✓        | ✓              | stall   |
 * | CIRCUIT_BREAK（断路）              | ✓      | ✓        | ✓              | breaker |
 * | DAILY_ALARM（日警戒）              | ✓      | ✓        | ✓              | alarm   |
 * | escalate cost-threshold 消费       | ✓      | ✓(target 部门) | ✓(成本摘要) | cost    |
 *
 * 低噪纪律（docs/21-§三 E8 同精神；130 §6.7.1）：其余事件（DISPATCH/PATROL/
 * HARVEST_DENIED/GATE_FAIL/ESCALATE/REPORT_MISSING…）**不广播**——面板与台账是完备
 * 事实源，IM 是精选副本；日报产物只进部门频道（例行产物不是告警）。批示项 7（路由表
 * 落位 org-config vs daemon.yaml）本刀按任务书冻结口径走**代码级冻结路由**（零配置面
 * ——配置化留待批示后另接，plan.md 呈审批点登记）。
 *
 * 总览=低噪摘要：overview 只投单行摘要件（digest=kind+title+一行核心事实），全文
 * （body 明细）只进 #alert 与部门频道——「低噪只读」的机制化落点。
 */
import type { EventRecord, Notification } from '@studio-next/contract'

/** 一条事件的广播计划：全文（alert/dept）+ 摘要件（overview）+ 目标频道角色 */
export interface EventBroadcastPlan {
  kind: string
  /** 全文通知（→ #alert 与部门频道） */
  message: Notification
  /** 摘要通知（→ 总览；单行低噪形） */
  digest: Notification
  targets: { alert: boolean; dept: string; overview: boolean }
}

/** GATE_PASS note 里的岗产物归档落位（output-account noteSuffix `;output=<target>`） */
export function reportOutputOf(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const m = /(?:^|;)output=([^;]+)/.exec(note)
  return m === null ? undefined : m[1]
}

/** 事件单行核心事实（摘要件 body——note 首段截断，低噪） */
function digestFact(event: EventRecord): string {
  const head = (event.note ?? '').split('；')[0]?.split(';')[0] ?? ''
  return head.slice(0, 120)
}

/**
 * 事件 → 广播计划（不在路由表=undefined 不广播）。from=出面署名（105-刀B-4：bot 代发
 * 带署名——系统面 relay 用 daemon 出面身份，人面四段式 composeSignature 归人面发送侧；
 * 调用方传入，本函数零依赖）。
 */
export function planEventBroadcast(event: EventRecord, from: string): EventBroadcastPlan | undefined {
  const issue = event.issue
  const dept = event.dept
  const base = (kind: string, title: string): { message: Notification; digest: Notification } => ({
    message: { kind, title, body: event.note ?? '', from },
    digest: { kind, title, body: digestFact(event), from },
  })
  switch (event.event) {
    case 'GATE_PASS': {
      const output = reportOutputOf(event.note)
      if (output !== undefined) {
        // 日报产物（岗单收割+归档）：只进部门频道（例行产物不是告警——任务书冻结口径）
        return {
          kind: 'report',
          message: { kind: 'report', title: `日报产物归档 ${issue}`, body: `落位：${output}`, from },
          digest: { kind: 'report', title: `日报产物归档 ${issue}`, body: `落位：${output}`, from },
          targets: { alert: false, dept, overview: false },
        }
      }
      const { message, digest } = base('gate', `过闸 ${issue}`)
      return { kind: 'gate', message, digest, targets: { alert: true, dept, overview: true } }
    }
    case 'STALL': {
      const { message, digest } = base('stall', `在工静默告警 ${issue}`)
      return { kind: 'stall', message, digest, targets: { alert: true, dept, overview: true } }
    }
    case 'CIRCUIT_BREAK': {
      const { message, digest } = base('breaker', `断路 ${issue}`)
      return { kind: 'breaker', message, digest, targets: { alert: true, dept, overview: true } }
    }
    case 'DAILY_ALARM': {
      const { message, digest } = base('alarm', `日警戒 ${issue}`)
      return { kind: 'alarm', message, digest, targets: { alert: true, dept, overview: true } }
    }
    default:
      return undefined
  }
}

/** cost-threshold 警戒广播计划（字段面=CostThresholdNotice 的结构子集，零 import 环） */
export interface CostNoticeLike {
  scope: string
  period: string
  tier: string
  pct: number
  runningUsd: number
  budgetUsd: number
  target: string
  dedupKey: string
  staleFlag: boolean
}

/**
 * cost-threshold 警戒通知（129-D/181 escalate 消费拍交接件→IM 广播；129-§6.1② notify 档
 * + 132-§6.4 dispatch+notify 档的即时提醒面——批示项④「busy 时队首+即时提醒」）：
 * #alert + target 所在部门频道 + 总览成本摘要（130 §6.7.1「成本摘要」面）。
 */
export function planCostNoticeBroadcast(
  notice: CostNoticeLike,
  targetDept: string | undefined,
  from: string,
): { kind: string; message: Notification; digest: Notification; targets: { alert: boolean; dept?: string; overview: boolean } } {
  const body = [
    `范围：${notice.scope}（${notice.period}，${notice.tier} 档）`,
    `用量：$${notice.runningUsd} / 预算 $${notice.budgetUsd}（${notice.pct}%）`,
    `提醒对象：${notice.target}${targetDept !== undefined ? `（${targetDept}）` : ''}`,
    ...(notice.staleFlag ? ['含 unpriced/stale 计价格（口径见价目表快照）'] : []),
    `幂等键：${notice.dedupKey}`,
  ].join('\n')
  const title = `成本警戒 ${notice.scope} ${notice.tier}（${notice.pct}%）`
  return {
    kind: 'cost',
    message: { kind: 'cost', title, body, from },
    digest: { kind: 'cost', title, body: `$${notice.runningUsd}/$${notice.budgetUsd}（${notice.pct}%）→ ${notice.target}`, from },
    targets: { alert: true, overview: true, ...(targetDept !== undefined && targetDept !== '' ? { dept: targetDept } : {}) },
  }
}
