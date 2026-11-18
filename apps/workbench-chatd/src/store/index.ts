/**
 * 存储后端装配（Phase1 模块 C 最小刀）：按 config 选 memory（缺省，向后兼容）/ sqlite（WORKBENCH_CHATD_DB）。
 * 选择优先级：--memory 显式强制 > WORKBENCH_CHATD_DB > 缺省 memory（见 config.ts）。
 */
import type { ChatdConfig } from '../config.ts'
import type { Logger } from '../log.ts'
import { MemoryChatStore } from './memory.ts'
import { SqliteChatStore } from './sqlite.ts'
import type { ChatStore } from './types.ts'

export function createChatStore(config: ChatdConfig, log: Logger): ChatStore {
  if (config.dbPath === undefined) return new MemoryChatStore()
  const store = new SqliteChatStore(config.dbPath)
  log.info('store_sqlite_open', { dbPath: config.dbPath })
  return store
}
