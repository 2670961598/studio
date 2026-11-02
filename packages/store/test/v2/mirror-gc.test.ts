/**
 * mirror-gc —— ticket_mirror 投影 GC 删除面 + 一致性备份（studio-dev-511）
 *
 * 依据：docs/17-§3（ticket_mirror=可重建投影，权威源=平台）/ docs/17-§2（相位内维护步）、
 *       任务书 §3（删残行/备份回滚/幂等/跨公司与空表/不得对生产库跑删除用例）。
 *
 * 覆盖（定向红→绿）：
 *   ① 删除面：构造 LOCAL-* 残行 → GC 后消失；
 *   ② 不误删在册行：平台活动集内行 0 删；
 *   ③ 幂等：二次 GC 删除 0 行；
 *   ④ 跨公司：只删目标 company，异司残行不动；空表=0；
 *   ⑤ fail-safe：空活动集/非法活动集元素 fail-closed 拒删；
 *   ⑥ 备份/回滚：VACUUM INTO 快照含删除前行；副本恢复后原样（逐行相等）；
 *   ⑦ 备份保留：只清本前缀、按 keep 留最新。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MIRROR_GC_BACKUP_PREFIX,
  openLedger,
  pruneLedgerBackups,
  type Ledger,
} from '../../src/index.ts'
import { T0 } from './fixtures.ts'

const COMPANY = 'studio-dev'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-mirror-gc-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 镜像行构造器（只填 GC 关心的列） */
function mirror(issue: string, company = COMPANY): Record<string, unknown> {
  return {
    issue,
    company,
    created: T0,
    updated: T0,
    state: '新单',
    type: 'task',
    dept: 'departments/研发部',
    level: 1,
    dispatcher: 'daemon',
  }
}

/** 打开一库并在 finally 关闭 */
function withLedger<T>(name: string, fn: (ledger: Ledger) => T): T {
  const ledger = openLedger(path.join(root, name))
  try {
    return fn(ledger)
  } finally {
    ledger.close()
  }
}

/** ClassifiedError 形状捕获（测试判类） */
interface ClassifiedThrown extends Error {
  category?: string
  subcause?: string
}

function catchThrown(fn: () => unknown): ClassifiedThrown {
  try {
    fn()
  } catch (err) {
    return err as ClassifiedThrown
  }
  throw new Error('期望抛错但未抛')
}

describe('pruneTicketMirrors（镜像投影 GC 删除面）', () => {
  it('① 删除面 + ② 不误删在册行：LOCAL-* 残行消失、活动集内行 0 删', () => {
    withLedger('delete.db', (ledger) => {
      const active = ['studio-dev-1', 'studio-dev-2', 'studio-dev-3']
      for (const issue of active) ledger.upsertTicketMirror(mirror(issue))
      ledger.upsertTicketMirror(mirror('LOCAL-1'))
      ledger.upsertTicketMirror(mirror('LOCAL-2'))

      const result = ledger.pruneTicketMirrors(COMPANY, active)
      expect(result).toEqual({
        company: COMPANY,
        deleted: 2,
        samples: ['LOCAL-1', 'LOCAL-2'],
        kept: 3,
        totalBefore: 5,
      })
      expect(ledger.listTicketMirrors().map((row) => row.issue).sort()).toEqual(active)
      expect(ledger.getTicketMirror('LOCAL-1')).toBeUndefined()
      expect(ledger.getTicketMirror('studio-dev-1')?.issue).toBe('studio-dev-1')
    })
  })

  it('③ 幂等：二次 GC 删除 0 行、行集不变', () => {
    withLedger('idempotent.db', (ledger) => {
      ledger.upsertTicketMirror(mirror('studio-dev-1'))
      ledger.upsertTicketMirror(mirror('LOCAL-9'))
      expect(ledger.pruneTicketMirrors(COMPANY, ['studio-dev-1']).deleted).toBe(1)
      const second = ledger.pruneTicketMirrors(COMPANY, ['studio-dev-1'])
      expect(second.deleted).toBe(0)
      expect(second.totalBefore).toBe(1)
      expect(second.kept).toBe(1)
      expect(ledger.listTicketMirrors().map((row) => row.issue)).toEqual(['studio-dev-1'])
    })
  })

  it('④ 跨公司：只删目标 company，异司残行不动；空表=0', () => {
    withLedger('cross-company.db', (ledger) => {
      ledger.upsertTicketMirror(mirror('studio-dev-1'))
      ledger.upsertTicketMirror(mirror('LOCAL-1'))
      ledger.upsertTicketMirror(mirror('OTHER-LOCAL-1', 'other-co'))
      const result = ledger.pruneTicketMirrors(COMPANY, ['studio-dev-1'])
      expect(result.deleted).toBe(1)
      expect(result.totalBefore).toBe(2)
      // 异司残行（company=other-co）仍在；目标公司只剩在册行
      expect(ledger.getTicketMirror('OTHER-LOCAL-1')?.company).toBe('other-co')
      expect(ledger.listTicketMirrors().filter((row) => row.company === COMPANY).map((row) => row.issue)).toEqual(['studio-dev-1'])

      // 空表边界：目标公司无行 → 0 删、0 行
      const empty = ledger.pruneTicketMirrors('empty-co', ['studio-dev-1'])
      expect(empty).toEqual({ company: 'empty-co', deleted: 0, samples: [], kept: 0, totalBefore: 0 })
    })
  })

  it('⑤ fail-safe：空活动集/非法活动集元素 fail-closed 拒删', () => {
    withLedger('fail-safe.db', (ledger) => {
      ledger.upsertTicketMirror(mirror('LOCAL-1'))
      const empty = catchThrown(() => ledger.pruneTicketMirrors(COMPANY, []))
      expect(empty.category).toBe('CONFIG_INVALID')
      expect(empty.subcause).toBe('store/ticket-mirror:empty-active-set')
      // 拒删后行仍在（fail-closed 未动库）
      expect(ledger.getTicketMirror('LOCAL-1')).toBeDefined()

      const bad = catchThrown(() => ledger.pruneTicketMirrors(COMPANY, ['studio-dev-1', '']))
      expect(bad.category).toBe('CONFIG_INVALID')
      expect(bad.subcause).toBe('store/ticket-mirror:bad-active-issue')
    })
  })
})

describe('backupTo（GC 前一致性备份/回滚）', () => {
  it('⑥ 备份含删除前行；副本恢复后原样（逐行相等）', () => {
    withLedger('backup.db', (ledger) => {
      for (const issue of ['studio-dev-1', 'studio-dev-2', 'LOCAL-1', 'LOCAL-2']) ledger.upsertTicketMirror(mirror(issue))
      const before = ledger.listTicketMirrors().sort((a, b) => a.issue.localeCompare(b.issue))

      const backupPath = path.join(root, 'backups', 'gc-1.sqlite')
      const backup = ledger.backupTo(backupPath)
      expect(backup.path).toBe(backupPath)
      expect(backup.bytes).toBeGreaterThan(0)
      expect(existsSync(backupPath)).toBe(true)

      // 备份是完整一致快照：打开即见删除前 4 行
      const snapshot = openLedger(backupPath)
      try {
        expect(snapshot.listTicketMirrors().map((row) => row.issue).sort()).toEqual(before.map((row) => row.issue))
      } finally {
        snapshot.close()
      }

      // GC 后原库只剩在册行；备份仍 4 行
      expect(ledger.pruneTicketMirrors(COMPANY, ['studio-dev-1', 'studio-dev-2']).deleted).toBe(2)
      expect(ledger.listTicketMirrors()).toHaveLength(2)

      // 回滚演练：把备份复制成新库 → 行集与原库删除前逐行相等
      const restorePath = path.join(root, 'restore.sqlite')
      copyFileSync(backupPath, restorePath)
      const restored = openLedger(restorePath)
      try {
        const rows = restored.listTicketMirrors().sort((a, b) => a.issue.localeCompare(b.issue))
        expect(rows).toEqual(before)
      } finally {
        restored.close()
      }

      // 不覆盖既有备份（防把回滚点覆盖掉）
      const exists = catchThrown(() => ledger.backupTo(backupPath))
      expect(exists.category).toBe('CONFIG_INVALID')
      expect(exists.subcause).toBe('store/backup:exists')
    })
  })

  it('⑦ 备份保留：只清本前缀、按 keep 留最新', () => {
    const dir = path.join(root, 'retention')
    mkdirSync(dir, { recursive: true })
    for (const n of ['1', '2', '3', '4']) writeFileSync(path.join(dir, `${MIRROR_GC_BACKUP_PREFIX}${n}.sqlite`), 'x')
    writeFileSync(path.join(dir, 'keep-me.txt'), 'x')

    expect(pruneLedgerBackups(dir, 2)).toEqual([`${MIRROR_GC_BACKUP_PREFIX}1.sqlite`, `${MIRROR_GC_BACKUP_PREFIX}2.sqlite`])
    expect(readdirSync(dir).sort()).toEqual([
      'keep-me.txt',
      `${MIRROR_GC_BACKUP_PREFIX}3.sqlite`,
      `${MIRROR_GC_BACKUP_PREFIX}4.sqlite`,
    ])

    const bad = catchThrown(() => pruneLedgerBackups(dir, 0))
    expect(bad.category).toBe('CONFIG_INVALID')
    expect(bad.subcause).toBe('store/backup:bad-keep')
  })
})
