/**
 * 内存存储（Phase1 模块 A / P1-1b 原语义）：无持久化，全部钩子 no-op——重启即空。
 * 缺省模式（不设 WORKBENCH_CHATD_DB / 或 --memory 显式强制），完全向后兼容。
 */
import type { ChatStore } from './types.ts'

export class MemoryChatStore implements ChatStore {
  readonly mode = 'memory' as const

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

  recordIdempotency(): void {
    /* no-op */
  }

  close(): void {
    /* 无资源 */
  }
}
