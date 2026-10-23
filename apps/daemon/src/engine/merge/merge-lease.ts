/**
 * merge-lease —— 合并租约簿（202-P4，studio-dev-234；泳道租约同模式：lanes/registry.ts 对偶件，
 * 但泳道侧注释明言「续租/死主回收归后续刀」——合并侧按任务书三面先行落地）。
 *
 * 语义（任务书领土：目标分支键（company,dev）合并租约，TTL＋续租＋死主回收）：
 *   - 键=`${company}:${targetBranch}`——同枝同时只进一列合并（dev 串行面）；
 *   - TTL 到期=死主视同无主：可夺占（死主回收——泄漏租约【占位后派发链异常中断且双
 *     释放面均未触】的自愈；过期不复活：续租只续活约，死主判定以到期时刻为准）；
 *   - 续租=在途合并跑每拍续命（engine 相位 5 头 renewMergeLeases——真门禁分钟级长跑
 *     不被 TTL 误夺；单次拍间隙超 TTL【daemon 停摆】视同死主让道，单进程推送面由
 *     收割序串行化兜底）；
 *   - 等待者顺延不失败：acquire=false → actionResults=merge-lease-busy（执行面结果，
 *     非 decide 闸——决策码零增）。
 * 进程内簿（跨进程互斥归后续刀，泳道租约 v0 同口径）：进程重启即清空，无持久面。
 */
import type { TicketId } from '@studio-next/contract'
import type { Inflight } from '../engine.ts'

/** 租约键（P2 定型：公司+目标分支——runMergeAction 与队列栏投影同源） */
export function mergeLeaseKey(company: string, targetBranch: string): string {
  return `${company}:${targetBranch}`
}

export interface MergeLeaseEntry {
  holder: TicketId
  expiresAt: number
}

/** 租约观测快照（expired=true＝有记录但已过期=死主待回收；无记录=holder:null 且 expired=false） */
export interface MergeLeaseState {
  key: string
  holder: TicketId | null
  expiresAt?: number
  expired: boolean
}

export interface MergeLeaseRegistry {
  /** 观测（只读——tick report 合并队列栏租约态投影源） */
  state(key: string, at: number): MergeLeaseState
  /** 占用（幂等重进=true；他单活约在位=false=顺延；死主过期=可夺——回收面） */
  acquire(key: string, ticket: TicketId, at: number): boolean
  /** 续租（活约且持有人匹配才续——过期不复活） */
  renew(key: string, ticket: TicketId, at: number): boolean
  /** 释放（持有人校验——失败面/收口面各调一次，双释放安全） */
  release(key: string, ticket: TicketId): void
}

export function createMergeLeaseRegistry(ttlMs: number): MergeLeaseRegistry {
  const leases = new Map<string, MergeLeaseEntry>()
  const live = (key: string, at: number): MergeLeaseEntry | undefined => {
    const l = leases.get(key)
    return l !== undefined && l.expiresAt > at ? l : undefined // TTL 到期=死主视同无主
  }
  return {
    state: (key, at) => {
      const raw = leases.get(key)
      const l = live(key, at)
      return { key, holder: l?.holder ?? null, ...(l !== undefined ? { expiresAt: l.expiresAt } : {}), expired: raw !== undefined && l === undefined }
    },
    acquire: (key, ticket, at) => {
      const l = live(key, at)
      if (l !== undefined && l.holder !== ticket) return false
      leases.set(key, { holder: ticket, expiresAt: at + ttlMs })
      return true
    },
    renew: (key, ticket, at) => {
      const l = live(key, at)
      if (l === undefined || l.holder !== ticket) return false
      l.expiresAt = at + ttlMs
      return true
    },
    release: (key, ticket) => {
      const l = leases.get(key)
      if (l !== undefined && l.holder === ticket) leases.delete(key)
    },
  }
}

/** 续租面宿主（结构探测——engine 的 MergeRunHost 满足此形；本件不反向 import merge-run.ts） */
export interface MergeLeaseHostFace {
  config: { company: string }
  inflight: ReadonlyMap<TicketId, Pick<Inflight, 'ticket' | 'mergeRun'>>
  mergeRun: { targetBranch: string } | undefined
  mergeLease: MergeLeaseRegistry
}

/** 相位 5 头每拍续命：在途合并跑（Inflight.mergeRun 在场）逐单续租——长跑不被 TTL 误夺 */
export function renewMergeLeases(host: MergeLeaseHostFace, at: number): void {
  for (const entry of host.inflight.values()) {
    if (entry.mergeRun !== undefined) host.mergeLease.renew(entry.mergeRun.leaseKey, entry.ticket, at)
  }
}

/** 合并队列栏（tick report 只读投影——任务书面：等待单/在跑单/租约态） */
export interface MergeQueueFace {
  /** 本拍 merge-lease-busy 顺延单（下拍重试） */
  waiting: readonly TicketId[]
  /** 在跑单（Inflight.mergeRun 在场——含死主让道后的双列异常如实投影） */
  running: readonly TicketId[]
  /** 租约态（面关 mergeRun=undefined → null） */
  lease: MergeLeaseState | null
}

export function mergeQueueFace(host: MergeLeaseHostFace, waiting: readonly TicketId[], at: number): MergeQueueFace {
  const running = [...host.inflight.values()].filter((e) => e.mergeRun !== undefined).map((e) => e.ticket)
  const lease = host.mergeRun !== undefined ? host.mergeLease.state(mergeLeaseKey(host.config.company, host.mergeRun.targetBranch), at) : null
  return { waiting, running, lease }
}
