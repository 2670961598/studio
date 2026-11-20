/**
 * 测试支撑：wake 套件共用 e2e helper（自 test/wake.nt.ts 抽出——BC-S2 拆件去重，阈 600 行）。
 * 消费方：test/wake.nt.ts、test/wake-source-seq.nt.ts；本文件不 import 任何测试件（无循环）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { connectNdjson, type RawClient, type WbFrame } from './ndjson.ts'
import type { ChatdHandle } from './proc.ts'

export function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `workbench-chatd-wake-${prefix}-`))
}

export async function withClient<T>(h: ChatdHandle, run: (c: RawClient) => Promise<T>): Promise<T> {
  await h.waitReady()
  const c = await connectNdjson(h.socketPath)
  try {
    return await run(c)
  } finally {
    c.close()
  }
}

export async function expectOk<T>(frame: WbFrame): Promise<T> {
  assert.equal(frame.ok, true, `期望 ok 响应：${JSON.stringify(frame)}`)
  return (frame as { ok: true; result: T }).result
}

/** 进程退出后直读库（审计/租约断言用；node:sqlite 返回 null 原型行，取标量比较）。 */
export function readDb(dbPath: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(dbPath)
  try {
    run(db)
  } finally {
    db.close()
  }
}
