/** 787 P0-4：overview 单实例锁 + 监听地址校验（纯函数） */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireOverviewLock, normalizeOverviewHost, overviewLockPath, releaseOverviewLock } from '../../../src/cli/overview.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function tempDir() { const d = mkdtempSync(path.join(tmpdir(), 'sn-overview-lock-')); dirs.push(d); return d }

describe('787：overview 单实例锁', () => {
  it('acquire → 第二实例拒绝 → release 后可再取', () => {
    const dir = tempDir()
    const lock = acquireOverviewLock(8789, dir)
    expect(overviewLockPath(8789, dir)).toBe(path.join(dir, 'overview.8789.lock'))
    expect(() => acquireOverviewLock(8789, dir)).toThrow(/已有 overview 实例/)
    releaseOverviewLock(lock)
    const again = acquireOverviewLock(8789, dir)
    releaseOverviewLock(again)
  })

  it('死 pid 锁（进程不存在）自动清理并取得', () => {
    const dir = tempDir()
    const file = overviewLockPath(8789, dir)
    writeFileSync(file, '999999\n', 'utf8')
    const lock = acquireOverviewLock(8789, dir)
    expect(lock.file).toBe(file)
    releaseOverviewLock(lock)
  })
})

describe('787：监听地址（默认仅环回；对外需显式批准）', () => {
  it('缺省/loopback 通过；非环回无 OVERVIEW_ALLOW_LAN → 拒；有则过', () => {
    expect(normalizeOverviewHost(undefined, {})).toBe('127.0.0.1')
    expect(normalizeOverviewHost('127.0.0.1', {})).toBe('127.0.0.1')
    expect(normalizeOverviewHost('localhost', {})).toBe('localhost')
    expect(() => normalizeOverviewHost('0.0.0.0', {})).toThrow(/制作人批准/)
    expect(normalizeOverviewHost('0.0.0.0', { OVERVIEW_ALLOW_LAN: '1' })).toBe('0.0.0.0')
  })
})
