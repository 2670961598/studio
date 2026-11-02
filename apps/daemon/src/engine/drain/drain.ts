/**
 * engine/drain —— 受权重启的 draining 控制面（studio-dev-504 S2）
 *
 * 依据（实现单引用）：docs/17-§2（主循环七相位——draining 只关相位 3 派发闸，不增删
 *   相位）；docs/17-§6（收割四要件——自然结算照四要件判，超时不判四要件、不判
 *   GATE_FAIL，标 interrupted「停机不是工人失败」）；#497 plan §4.3/§4.4（C-3 单活
 *   stop-then-start、C-4 有界结算 180s）。
 *
 * 职责边界：
 *   - begin(reason)/cancel()：拍边界调用（serve 主循环单线程），只置内存闸，不杀 worker；
 *   - forceSettleTimeout()：到期唯一杀面——对在途 handle 走既有 kill 链（SIGTERM→宽限→
 *     SIGKILL），对仍 running 的 work_record 收口 interrupted（不判四要件、不结算预算、
 *     不烧断路连击）；返回如实 interrupted 清单进检查点摘要与事件。
 *   - 本模块不读时钟做决策（now 注入）、不写事件（留痕归 serve 编排）；drain 期间自然
 *     收割仍由 engine.tick 的相位 4 照跑（本模块不碰 inflight 的自然收口）。
 *
 * 诚实边界（#497 §8.2）：单写者 lease 下不能双活；本模块只保证「授权重启在期限内等自然
 * 结算、到期如实 interrupted」，不宣称零中断。
 */
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { Inflight } from '../tick/types.ts'

/** 到期收口的单条记录（进检查点摘要 / RESTART;phase=drain_timeout note） */
export interface DrainInterruptedItem {
  ticket: TicketId
  attempt: number
  workRecordId: string
}

/** 到期收口结果（interrupted 恒如实列出，空数组=期限内自然清零） */
export interface DrainSettleResult {
  interrupted: readonly DrainInterruptedItem[]
  /** 未在 inflight 但 work_records 仍 running 的孤儿条数（台账面异常观测，非四要件判定） */
  orphaned: number
}

/** draining 控制器（engine 持有；serve 经 Engine 门面调用） */
export interface DrainController {
  /** 进入 draining（拍边界；幂等——已 draining 不重置计时） */
  begin(reason: string): void
  /** 撤销 draining（未进 checkpointing 前可撤销；清计时） */
  cancel(): void
  /** 是否 draining（tick 相位 3 闸读取） */
  readonly active: boolean
  /** draining 事由（面关=undefined） */
  readonly reason: string | undefined
  /** 进入 draining 的墙钟时刻（面关=undefined） */
  readonly startedAt: number | undefined
  /** 到期强收：整树杀在途 + running 收口 interrupted（幂等；返回如实清单） */
  forceSettleTimeout(): Promise<DrainSettleResult>
}

/** 构造 draining 控制器（engine 装配一次；闭包持 inflight/ledger/registry） */
export function createDrainController(deps: {
  ledger: Ledger
  inflight: Map<TicketId, Inflight>
  registry: ExecutorRegistry
  killGraceMs: number
  now: () => number
}): DrainController {
  let active = false
  let reason: string | undefined
  let startedAt: number | undefined

  return {
    begin(nextReason: string): void {
      if (active) return // 幂等：重复请求不重置计时/事由（计时起点=授权通过时刻）
      active = true
      reason = nextReason
      startedAt = deps.now()
    },
    cancel(): void {
      active = false
      reason = undefined
      startedAt = undefined
    },
    get active(): boolean {
      return active
    },
    get reason(): string | undefined {
      return reason
    },
    get startedAt(): number | undefined {
      return startedAt
    },
    async forceSettleTimeout(): Promise<DrainSettleResult> {
      const interrupted: DrainInterruptedItem[] = []
      // 1) 在途 handle：既有 kill 链（与 dispose()/stop 通道同一条；await=等死）
      for (const entry of [...deps.inflight.values()]) {
        try {
          const adapter = deps.registry.resolve(entry.executor)
          await adapter.kill(entry.handle, deps.killGraceMs)
        } catch {
          // kill 失败如实继续收口台账（v0 停机面保序：不让单点 kill 异常阻断整批收口）
        }
        try {
          deps.ledger.endWorkRecord(entry.workRecordId, { status: 'interrupted', ended_at: deps.now() })
        } catch {
          // 已 ended/无此行：幂等面不重复收口（台账终态以首次为准）
        }
        interrupted.push({ ticket: entry.ticket, attempt: entry.attempt, workRecordId: entry.workRecordId })
      }
      deps.inflight.clear()
      // 2) 台账面仍 running 的孤儿（进程内正常链路不产生；dispose 后/异常残留）同口径收口
      let orphaned = 0
      for (const rec of deps.ledger.listWorkRecords()) {
        if (rec.status !== 'running') continue
        try {
          deps.ledger.endWorkRecord(rec.id, { status: 'interrupted', ended_at: deps.now() })
          orphaned += 1
          interrupted.push({ ticket: rec.issue, attempt: rec.attempt, workRecordId: rec.id })
        } catch {
          // 与上面同口径：收口失败不冒充成功，孤儿计数只计确实收口的行
        }
      }
      return { interrupted, orphaned }
    },
  }
}
