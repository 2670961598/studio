/**
 * harvest/park —— 增量泵驻留竞速（DEV-9 P1 冻结修复，docs/17-§2 拍有界；自 engine.ts
 * 抽件——20-§十五「先拆再增」）。纯计时件，无引擎闭包。
 */
import type { StreamEvent } from '@studio-next/contract'

/** 驻留哨兵：parkRace 计时器到点（本拍无事件/时间片尽）——迭代器驻留，下一拍续收 */
export const PARKED = Symbol('harvest-parked')

/**
 * 有界竞速：next() 就绪（含拒绝——原样传播走 WORKER_DEAD 面）则即时返回；ms 内未就绪
 * 返回 PARKED。挂起分支的拒绝由泵侧预附 catch 吞并记档（无悬空 unhandled rejection）。
 */
export function parkRace(next: Promise<IteratorResult<StreamEvent>>, ms: number): Promise<IteratorResult<StreamEvent> | typeof PARKED> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(PARKED), Math.max(1, ms))
    timer.unref()
    next.then(
      (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
