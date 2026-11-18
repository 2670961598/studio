/**
 * 内存存储（Phase1 模块 A / P1-1b 原语义 + P1-2 wake lease）：无持久化，全部钩子 no-op——重启即空。
 * 缺省模式（不设 WORKBENCH_CHATD_DB / 或 --memory 显式强制），完全向后兼容。
 * wake 租约语义在 dispatch 层用 state.wakeLeases/wakeEvents 内存实现（租约/重投/dead-letter
 * 照常生效，审计事件保留在进程内数组），仅「重启恢复」不可用——与既有内存 mock 语义一致。
 */
import type { ChatStore } from './types.ts'

export class MemoryChatStore implements ChatStore {
  readonly mode = 'memory' as const
  /** 可注入时钟（与 SqliteChatStore 同口径；缺省 Date.now，生产行为不变）。 */
  readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  hydrate(): void {
    /* 内存模式无可恢复状态 */
  }

  insertRoom(): void {
    /* no-op：状态只活在进程内 */
  }

  appendMessage(): void {
    /* no-op */
  }

  setRead(): void {
    /* no-op */
  }

  updateWake(): void {
    /* no-op */
  }

  recordWakeTransition(): void {
    /* no-op：租约/审计只活在 state（进程内） */
  }

  recordIdempotency(): void {
    /* no-op */
  }

  close(): void {
    /* 无资源 */
  }
}
