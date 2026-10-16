/**
 * v0.2 首刀·快照与重建测试：dumpEvents（JSONL 单向派生，F2-11）+ rebuild（F2-12）
 * + **删库重建演习**（16-§四 v0.2 验收口径：删库重建演习一次通过）。
 *
 * 演习形态：真文件库写入 N 条（含前缀族事件 / 四桶变体 / 全可选字段）→ dump → close+删库文件
 * （db/-wal/-shm 三件）→ rebuild(JSONL → 新库) → 断言：events 计数一致 + queryEvents 全量
 * deep-equal + schema_version 一致。
 * 失败面：坏 JSONL（第 3 行非 JSON / 合法 JSON 但过不了契约）→ 重建中止、指明行号、
 * 单事务回滚（目标库零残留事件）。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger, rebuild, type Ledger } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-rebuild-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 演习语料：覆盖前缀族（GW_* / REPORT_*）、四桶变体（各单桶+全四桶+零值桶）、可选字段满配 */
function drillCorpus(): EventRecord[] {
  const base = 1780000000000
  const events: EventRecord[] = []
  const push = (patch: Partial<EventRecord>): void => {
    const i = events.length
    const ts = base + i * 1000
    events.push({
      id: makeUlid(ts),
      ts,
      company: i % 3 === 0 ? 'poly' : 'games',
      issue: `STUDIO-${200 + (i % 5)}`,
      event: 'DISPATCH',
      actor: `AGENT-${1 + (i % 4)}:agent-${1 + (i % 4)}`,
      attempt: 1 + (i % 3),
      level: 2 + (i % 6),
      dept: 'departments/工程部',
      tokens: { input: 10 + i, output: 5 + i },
      ...patch,
    })
  }
  push({ event: 'DISPATCH' })
  push({ event: 'GATE_PASS', correlation_id: 'corr-a' })
  push({ event: 'GATE_FAIL', causation_id: 'cause-b', note: '验收红' })
  push({ event: 'QA_BACK' })
  push({ event: 'MERGE', payload_hash: 'sha256:abcd1234', size: 4096 })
  push({ event: 'CLOSE', duration_ms: 123456 })
  push({ event: 'STALL' })
  push({ event: 'QUARANTINE' })
  push({ event: 'APPROVE' })
  push({ event: 'ESCALATE' })
  push({ event: 'LLM', tokens: { input: 0 }, cost_usd: 0 })
  push({ event: 'SELF_EVAL', tokens: { output: 777 } })
  push({ event: 'POSTMORTEM', tokens: { cache_read: 100000 } })
  push({ event: 'PATROL', tokens: { cache_creation: 2048 } })
  push({ event: 'ORG_UPGRADE' })
  push({ event: 'KB_UPDATE' })
  push({ event: 'SCHEMA_EVOLVE' })
  push({ event: 'DAILY_ALARM' })
  push({ event: 'HEARTBEAT', tokens: { input: 0 } })
  push({ event: 'CIRCUIT_BREAK' })
  push({ event: 'RESUME' })
  push({ event: 'INVOKE_EXTERNAL' })
  push({ event: 'GW_COMMENT', correlation_id: 'corr-gw', causation_id: 'cause-b' })
  push({ event: 'GW_KB_SEARCH' })
  push({ event: 'REPORT_DAILY', payload_hash: 'sha256:feedface', size: 8192, duration_ms: 42, cost_usd: 0.0025, note: '日报' })
  push({
    event: 'LLM',
    tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
    cost_usd: 0.0125,
    duration_ms: 98765,
    size: 512,
    payload_hash: 'sha256:0011223344556677',
    note: '全可选字段',
    correlation_id: 'corr-full',
    causation_id: 'cause-full',
  })
  return events
}

/** 删库三件套（db + -wal + -shm）：演习的「删库」动作 */
function dropDatabase(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
}

describe('dumpEvents（库 → JSONL 单向派生，F2-11）', () => {
  it('逐行含 ULID、行数=库内计数、行序升序', () => {
    const dbPath = path.join(root, 'dump.db')
    const ledger = openLedger(dbPath)
    for (const e of drillCorpus()) ledger.appendEvent(e)
    const jsonl = path.join(root, 'dump.jsonl')
    const { lines } = ledger.dumpEvents(jsonl)
    const total = ledger.queryEvents().length
    expect(lines).toBe(total)

    const raw = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l !== '')
    expect(raw.length).toBe(total)
    const ids = raw.map((l) => (JSON.parse(l) as EventRecord).id)
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const tss = raw.map((l) => (JSON.parse(l) as EventRecord).ts)
    expect([...tss].sort((a, b) => a - b)).toEqual(tss)
    ledger.close()
  })
})

describe('删库重建演习（16-§四 v0.2 验收口径）', () => {
  it('写入→close+删库→rebuild→计数/全量 deep-equal/schema_version 三一致', () => {
    const dbPath = path.join(root, 'drill.db')
    const jsonl = path.join(root, 'drill.jsonl')
    const rebuiltPath = path.join(root, 'drill-rebuilt.db')

    // ① 写入 N 条演习语料并快照
    const ledger = openLedger(dbPath)
    const corpus = drillCorpus()
    for (const e of corpus) ledger.appendEvent(e)
    const before = ledger.queryEvents()
    const versionBefore = ledger.version()
    ledger.dumpEvents(jsonl)
    ledger.close()

    // ② 删库（三件套真删，不留 -wal/-shm）
    dropDatabase(dbPath)
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(`${dbPath}-wal`)).toBe(false)

    // ③ 重建：JSONL → 新库逐条 appendEvent
    const result = rebuild(jsonl, rebuiltPath)
    expect(result.events).toBe(corpus.length)
    expect(result.version).toBe(versionBefore)

    // ④ 验收：计数一致 + queryEvents 全量 deep-equal + schema_version 一致
    const rebuilt = openLedger(rebuiltPath)
    expect(rebuilt.queryEvents().length).toBe(before.length)
    expect(rebuilt.queryEvents()).toEqual(before)
    expect(rebuilt.version()).toBe(versionBefore)
    // 逐条校验全过（appendEvent 内契约闸重放即逐条校验；再显式抽全量比对 id 序）
    expect(rebuilt.queryEvents().map((e) => e.id)).toEqual(before.map((e) => e.id))
    rebuilt.close()

    // ⑤ 重复 rebuild 同一 JSONL 到已重建库：幂等（F2-13 回填幂等语义）
    const again = rebuild(jsonl, rebuiltPath)
    expect(again.events).toBe(corpus.length)
    const check = openLedger(rebuiltPath)
    expect(check.queryEvents()).toEqual(before)
    check.close()
  })

  it('同库删后原路径重建：删库文件后 rebuild 回原路径，数据无损', () => {
    const dbPath = path.join(root, 'inplace.db')
    const jsonl = path.join(root, 'inplace.jsonl')
    const ledger = openLedger(dbPath)
    const corpus = drillCorpus().slice(0, 5)
    for (const e of corpus) ledger.appendEvent(e)
    const before = ledger.queryEvents()
    ledger.dumpEvents(jsonl)
    ledger.close()
    dropDatabase(dbPath)
    const result = rebuild(jsonl, dbPath)
    expect(result.events).toBe(corpus.length)
    const reopened = openLedger(dbPath)
    expect(reopened.queryEvents()).toEqual(before)
    reopened.close()
  })
})

describe('坏 JSONL 重建中止（失败面）', () => {
  it('第 3 行非 JSON：中止、指明行号、目标库单事务回滚零事件', () => {
    const jsonl = path.join(root, 'bad-json.jsonl')
    const target = path.join(root, 'bad-json-target.db')
    const good = drillCorpus()[0] as EventRecord
    writeFileSync(jsonl, [JSON.stringify(good), JSON.stringify({ ...good, id: makeUlid(1780000001000) }), '<<<不是JSON>>>'].join('\n') + '\n', 'utf8')

    let caught: unknown
    try {
      rebuild(jsonl, target)
    } catch (err) {
      caught = err
    }
    const err = caught as Error & { category?: string; subcause?: string }
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe('store/rebuild:bad-line')
    expect(err.message).toContain('第 3 行')
    // 单事务回滚：目标库零事件（migration 已落，schema_version 独立事务）
    const l = openLedger(target)
    expect(l.queryEvents().length).toBe(0)
    expect(l.version()).toBe(4)
    l.close()
  })

  it('第 2 行合法 JSON 但过不了契约（坏事件）：同样中止+行号+零残留', () => {
    const jsonl = path.join(root, 'bad-record.jsonl')
    const target = path.join(root, 'bad-record-target.db')
    const good = drillCorpus()[0] as EventRecord
    const bad = { ...good, event: 'not-an-event' }
    writeFileSync(jsonl, [JSON.stringify(good), JSON.stringify(bad)].join('\n') + '\n', 'utf8')

    let caught: unknown
    try {
      rebuild(jsonl, target)
    } catch (err) {
      caught = err
    }
    const err = caught as Error & { subcause?: string; message?: string }
    expect(err.subcause).toBe('store/rebuild:bad-line')
    expect(err.message).toContain('第 2 行')
    expect(err.message).toContain('evt/invalid:event')
    const l = openLedger(target)
    expect(l.queryEvents().length).toBe(0)
    l.close()
  })
})
