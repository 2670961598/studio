/**
 * kv —— daemon_kv 读写面（v4 吸收面：daemon 合龙件三债之一；自 ledger.ts 原样拆出，
 * 零行为变更）
 *
 * 表 DDL 归 migrations v4：DDL/语句与 daemon 现行 engine.ts 的 kvGetStmt/kvSetStmt 逐字
 * 一致（接管期间 daemon 自建语句与本面共存，同表同语义，存量数据原地续用）。
 * 键闸=非空串（空键=调用方 bug 拒收）；value 不闸（空串=daemon「游标 null」持久形态）。
 * db 由 openLedger 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'

/** daemon_kv 读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface KvFace {
  // —— v4 吸收面（daemon 合龙件三债；见文件头注 v4 段） ——
  /** daemon_kv 读：缺键=null；键闸=非空串（拟稿）。接管关系见 migrations v4 头注 */
  kvGet(key: string): string | null
  /** daemon_kv 写（upsert 语义；语句与 daemon 现行 kvSet 字节级一致；value 允空串） */
  kvSet(key: string, value: string): void
}

// —— v4 daemon_kv 读写语句（与 daemon 现行 engine.ts 的 kvGetStmt/kvSetStmt 逐字一致——字节级兼容；
//     DDL 见 migrations v4：接管期间 daemon 自建语句与本面共存，同表同语义） ——

const KV_GET_SQL = 'SELECT value FROM daemon_kv WHERE key = ?'
const KV_SET_SQL = 'INSERT INTO daemon_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'

/** kv 键闸（拟稿）：非空字符串——空键=调用方 bug，拒收；value 不设闸（空串=daemon「游标 null」持久形态） */
function assertKvKey(key: string): void {
  if (typeof key !== 'string' || key === '') {
    configInvalid('store/kv:bad-key', 'kv 键须为非空字符串')
  }
}

/** daemon_kv 面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createKvFace(db: DatabaseSync): KvFace {
  // —— v4 吸收面实现（daemon 合龙件三债；接口行注与文件头注 v4 段为语义依据） ——

  const kvGet = (key: string): string | null => {
    assertKvKey(key)
    const row = db.prepare(KV_GET_SQL).get(key) as { value: string } | undefined
    return row === undefined ? null : row.value
  }

  const kvSet = (key: string, value: string): void => {
    assertKvKey(key)
    db.prepare(KV_SET_SQL).run(key, value)
  }

  return {
    kvGet,
    kvSet,
  }
}
