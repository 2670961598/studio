/**
 * session-archive —— store 会话收口面（studio-dev-551）V2 定向红→绿用例
 *
 * 依据：docs/17-§3（sessions 行）/ docs/17-§6（记录落库在判定之后）/ docs/v2/07 EXEC-04
 *       （会话证据归档收割入台账＝V07-P2-2 追账项）。
 *
 * 覆盖：收口一次（ended_at/turns/archive_path）、COALESCE 只补不清、行缺失=false（不补插）、
 *       重复收口=CONFIG_INVALID（不静默覆盖）、坏入参=CONFIG_INVALID。
 * 改前红：Ledger.endSession 生产面不存在（先用形状断言钉住，再测行为）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '../../src/index.ts'

/** 目标面形状（子集）——改前缺失=形状断言红，行为用例随后逐条红 */
interface EndSessionFace {
  endSession?: (sessionId: string, end: unknown) => boolean
}

const SID = 'sess-store-551'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-session-archive-'))
  ledger = openLedger(path.join(root, 'ledger.sqlite'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

function seed(sessionId: string): void {
  ledger.insertSession({ session_id: sessionId, issue: 'T-551', person_id: 'QA-3', started_at: 1_000 })
}

function face(): Required<EndSessionFace> {
  return ledger as unknown as Required<EndSessionFace>
}

describe('Ledger.endSession：会话收口面（store 写口）', () => {
  it('形状：Ledger 暴露 endSession（生产写面存在，非仅 insert/get/list）', () => {
    expect(typeof face().endSession).toBe('function') // 改前红：undefined
  })

  it('收口一次：ended_at/turns/archive_path 落行；重复收口=CONFIG_INVALID（不静默覆盖）', () => {
    seed(SID)
    expect(face().endSession(SID, { ended_at: 2_000, turns: 3, archive_path: '/tmp/session.v4.jsonl.zstd' })).toBe(true)
    const row = ledger.getSession(SID)
    expect(row?.ended_at).toBe(2_000)
    expect(row?.turns).toBe(3)
    expect(row?.archive_path).toBe('/tmp/session.v4.jsonl.zstd')
    expect(() => face().endSession(SID, { ended_at: 3_000 })).toThrow(/CONFIG_INVALID/)
    expect(ledger.getSession(SID)?.ended_at).toBe(2_000)
  })

  it('COALESCE 只补不清：收口缺省 turns/archive_path 时既有值保留', () => {
    const sid = 'sess-store-coalesce'
    ledger.insertSession({
      session_id: sid,
      issue: 'T-551',
      person_id: 'QA-3',
      archive_path: '/tmp/a.zstd',
      turns: 5,
      started_at: 1_000,
    })
    expect(face().endSession(sid, { ended_at: 2_000 })).toBe(true)
    const row = ledger.getSession(sid)
    expect(row?.archive_path).toBe('/tmp/a.zstd')
    expect(row?.turns).toBe(5)
  })

  it('行缺失=false：不补插冒认归档（零行副作用）', () => {
    const before = ledger.listSessions().length
    expect(face().endSession('sess-absent', { ended_at: 2_000 })).toBe(false)
    expect(ledger.listSessions().length).toBe(before)
  })

  it('坏入参=CONFIG_INVALID：ended_at 缺失/负数拒收（不入账）', () => {
    seed('sess-store-bad')
    expect(() => face().endSession('sess-store-bad', {})).toThrow(/CONFIG_INVALID/)
    expect(() => face().endSession('sess-store-bad', { ended_at: -1 })).toThrow(/CONFIG_INVALID/)
    expect(ledger.getSession('sess-store-bad')?.ended_at).toBeUndefined()
  })
})
