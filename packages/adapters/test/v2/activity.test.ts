/**
 * activity —— executor 会话活性探测（看门狗活性锚 adapter 面；studio-dev-505）
 *
 * 依据（实现单引用）：docs/02-F1-08 看门狗三道（daemon 侧兜底活性面）；
 * docs/17-§6 dsh 行（会话落盘 session.v4.jsonl.zstd 真机形态）；
 * docs/v2/07-§三 EXEC-01/EXEC-02（活性观察面独立于自述）。
 *
 * 断言面：①会话 mtime=活性锚；②cwd 槽由 session id 扫描定位（不复制 dsh 私有编码）；
 * ③未知 executor 如实 unavailable；④坏/穿越形态 session id 拒探测（安全面）；
 * ⑤扫描结果缓存（未命中 TTL 内不重扫）。
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearActivityProbeCache,
  dshSessionsRoot,
  probeExecutorActivity,
  usesDshSessionProbe,
} from '../../src/activity.ts'

const roots: string[] = []

function makeHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-activity-'))
  roots.push(root)
  return root
}

/** 造会话文件：<home>/sessions/<cwd 槽>/session-<id>/session.v4.jsonl.zstd */
function makeSession(home: string, sessionId: string, mtimeMs: number, cwdSlot = '--cwd-slot--'): string {
  const dir = path.join(home, 'sessions', cwdSlot, `session-${sessionId}`)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, 'x')
  const sec = mtimeMs / 1000
  utimesSync(file, sec, sec)
  return file
}

beforeEach(() => {
  clearActivityProbeCache()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('probeExecutorActivity（dsh 会话 mtime）', () => {
  it('命中会话目录 → lastActivityAt=会话文件 mtime（活性锚）', () => {
    const home = makeHome()
    const mtime = Date.parse('2026-11-03T03:43:05.000Z')
    const file = makeSession(home, '4c4e1959-d854-4d1a-bf65-be0ec770d943', mtime)
    const probe = probeExecutorActivity({
      executor: 'dsh-mid',
      executorSessionId: '4c4e1959-d854-4d1a-bf65-be0ec770d943',
      dshHome: home,
    })
    expect(probe.lastActivityAt).toBe(Math.floor(mtime / 1000) * 1000) // utimes 秒级落盘
    expect(probe.source).toBe('session-mtime')
    expect(probe.sessionPath).toBe(file)
  })

  it('多 cwd 槽扫描定位（不复制 dsh 私有 cwd 编码）；窗口内缓存不重扫', () => {
    const home = makeHome()
    const mtime = Date.parse('2026-11-03T03:00:00.000Z')
    makeSession(home, 'other-id', mtime - 60_000, '--other--')
    makeSession(home, 'target-id', mtime, '--研发部编码槽--')
    const probe = probeExecutorActivity({ executor: 'dsh', executorSessionId: 'target-id', dshHome: home })
    expect(probe.lastActivityAt).toBe(Math.floor(mtime / 1000) * 1000)
    // 删除文件后 TTL 内仍读缓存（证明未每拍全目录扫描）
    const again = probeExecutorActivity({ executor: 'dsh', executorSessionId: 'target-id', dshHome: home, missRetryMs: 60_000 })
    expect(again.lastActivityAt).toBe(probe.lastActivityAt)
  })

  it('未登记探测的 executor → unavailable（不猜活性）', () => {
    const home = makeHome()
    const probe = probeExecutorActivity({ executor: 'claude', executorSessionId: 'x', dshHome: home })
    expect(probe.lastActivityAt).toBeUndefined()
    expect(probe.reason).toBe('no-probe-registered')
  })

  it('session id 缺省/非法（路径穿越形）→ 拒探测且不触盘', () => {
    const home = makeHome()
    expect(probeExecutorActivity({ executor: 'dsh', dshHome: home }).reason).toBe('session-id-unknown')
    const evil = probeExecutorActivity({ executor: 'dsh', executorSessionId: '../../etc/passwd', dshHome: home })
    expect(evil.lastActivityAt).toBeUndefined()
    expect(evil.reason).toBe('session-id-invalid')
  })

  it('会话目录不存在 → not-found（不炸；sessions 根缺失同理）', () => {
    const home = makeHome()
    const probe = probeExecutorActivity({ executor: 'dsh', executorSessionId: 'nope', dshHome: home })
    expect(probe.lastActivityAt).toBeUndefined()
    expect(probe.reason).toBe('not-found')
  })

  it('dsh 家族判定：dsh/dsh-mid/high/low 走会话探测，其余不走', () => {
    expect(usesDshSessionProbe('dsh')).toBe(true)
    expect(usesDshSessionProbe('dsh-mid')).toBe(true)
    expect(usesDshSessionProbe('claude')).toBe(false)
    expect(dshSessionsRoot('/x')).toBe('/x/sessions')
  })
})
