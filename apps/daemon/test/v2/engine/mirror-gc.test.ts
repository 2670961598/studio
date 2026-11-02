/**
 * mirror-gc —— daemon 相位 1 尾镜像 GC 维护步（studio-dev-511）
 *
 * 依据：docs/17-§2（相位内维护步，不增删相位）/ docs/17-§3（ticket_mirror=可重建投影）、
 *       任务书 §3（daemon 侧 GC + 备份 + 观测留痕 + 不误删在册行 + 幂等）。
 *
 * 覆盖：
 *   1. 删除面：残行删除、在册行保留、备份落盘、日志/daemon_kv 留痕；
 *   2. 幂等：二次 GC 0 删、不重复备份；
 *   3. fail-safe：平台拉取失败/活动集空=跳过（不备份不删）；节流窗=undefined；
 *   4. 备份失败=不删（异常上抛，残行仍在）；
 *   5. 引擎接线：首拍 force 真跑，tick report `collect.mirrorGc` 可读，LOCAL-* 消失、在册单仍在。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  MIRROR_GC_LAST_KEY,
  mirrorGcBackupDir,
  runMirrorGcTick,
  type MirrorGcDeps,
} from '../../../src/engine/mirror-gc/step.ts'
import { createTicket, createWorkStack, disposeWorkStacks, T0, tick } from '../records/fixtures/work-stack.ts'

const COMPANY = 'studio-dev'

afterAll(async () => {
  await disposeWorkStacks()
})

/** 镜像行构造器（GC 只关心 issue/company） */
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

/** 建临时库根 + 台账；返回清理函数 */
async function makeLedger(label: string): Promise<{ root: string; ledger: Ledger; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-mirror-gc-${label}-`))
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  return {
    root,
    ledger,
    cleanup: async () => {
      ledger.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** 步骤依赖基线（测试按需覆盖） */
function depsOf(ledger: Ledger, root: string, over: Partial<MirrorGcDeps> = {}): MirrorGcDeps {
  return {
    ledger,
    company: COMPANY,
    rootDir: root,
    activeIssues: ['studio-dev-1'],
    listOk: true,
    seq: 1,
    now: T0,
    force: true,
    ...over,
  }
}

describe('runMirrorGcTick（相位 1 尾维护步）', () => {
  it('删除残行 + 在册行不动 + 备份/日志/daemon_kv 留痕；二次 0 删不重复备份', async () => {
    const { root, ledger, cleanup } = await makeLedger('delete')
    try {
      ledger.upsertTicketMirror(mirror('studio-dev-1'))
      ledger.upsertTicketMirror(mirror('LOCAL-1'))
      ledger.upsertTicketMirror(mirror('LOCAL-2'))
      const logs: string[] = []

      const report = runMirrorGcTick(depsOf(ledger, root, { log: (line) => logs.push(line) }))
      expect(report).toMatchObject({
        ran: true,
        reason: 'deleted',
        deleted: 2,
        samples: ['LOCAL-1', 'LOCAL-2'],
        totalBefore: 3,
        kept: 1,
      })
      expect(report?.backupPath !== undefined && existsSync(report.backupPath)).toBe(true)
      expect(report?.backupBytes).toBeGreaterThan(0)
      expect(ledger.getTicketMirror('LOCAL-1')).toBeUndefined()
      expect(ledger.getTicketMirror('LOCAL-2')).toBeUndefined()
      expect(ledger.getTicketMirror('studio-dev-1')?.issue).toBe('studio-dev-1')
      expect(logs.some((line) => line.includes('[mirror-gc]') && line.includes('deleted=2'))).toBe(true)

      const last = JSON.parse(ledger.kvGet(MIRROR_GC_LAST_KEY) ?? '{}') as Record<string, unknown>
      expect(last).toMatchObject({ company: COMPANY, deleted: 2, kept: 1, totalBefore: 3 })

      // 幂等：二次 force 评估=no-stale，0 删、不新增备份
      const backupsBefore = readdirSync(mirrorGcBackupDir(root)).length
      const second = runMirrorGcTick(depsOf(ledger, root, { seq: 2 }))
      expect(second).toMatchObject({ ran: true, reason: 'no-stale', deleted: 0, kept: 1 })
      expect(readdirSync(mirrorGcBackupDir(root)).length).toBe(backupsBefore)
    } finally {
      await cleanup()
    }
  })

  it('fail-safe：平台拉取失败/活动集空=跳过（不备份不删）；节流窗=undefined', async () => {
    const { root, ledger, cleanup } = await makeLedger('skip')
    try {
      ledger.upsertTicketMirror(mirror('LOCAL-1'))

      const unavailable = runMirrorGcTick(depsOf(ledger, root, { listOk: false }))
      expect(unavailable).toMatchObject({ ran: false, reason: 'platform-unavailable', deleted: 0 })
      expect(ledger.getTicketMirror('LOCAL-1')).toBeDefined()
      expect(existsSync(mirrorGcBackupDir(root))).toBe(false)

      const empty = runMirrorGcTick(depsOf(ledger, root, { activeIssues: [] }))
      expect(empty).toMatchObject({ ran: false, reason: 'empty-active-set', deleted: 0 })
      expect(ledger.getTicketMirror('LOCAL-1')).toBeDefined()

      // 非首拍且未到节流窗 → undefined（不进 tick report、不评估）
      expect(runMirrorGcTick(depsOf(ledger, root, { force: false, seq: 2 }))).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('备份失败=不删（异常上抛，残行仍在）', async () => {
    const { root, ledger, cleanup } = await makeLedger('backup-fail')
    try {
      ledger.upsertTicketMirror(mirror('LOCAL-1'))
      // 备份目录位置先占成普通文件 → mkdir/backup 失败
      mkdirSync(path.join(root, 'backups'), { recursive: true })
      writeFileSync(mirrorGcBackupDir(root), 'not-a-dir')

      expect(() => runMirrorGcTick(depsOf(ledger, root))).toThrow()
      expect(ledger.getTicketMirror('LOCAL-1')).toBeDefined()
    } finally {
      await cleanup()
    }
  })
})

describe('引擎接线（首拍 force 真跑）', () => {
  it('tick 后 LOCAL-* 消失、在册单仍在、collect.mirrorGc 留痕', async () => {
    const stack = await createWorkStack('mirror-gc-engine', { mirrorGcEveryTicks: 1 })
    const ticket = await createTicket(stack)
    // 引擎配置 company=DEMO_SNAPSHOT.slug='demo'（syncMirror 落 company=config.company）
    stack.ledger.upsertTicketMirror(mirror('LOCAL-ENGINE-1', 'demo'))

    const report = await tick(stack)
    expect(report.phases.collect.mirrorGc).toMatchObject({ ran: true, reason: 'deleted', deleted: 1, samples: ['LOCAL-ENGINE-1'] })
    expect(stack.ledger.getTicketMirror('LOCAL-ENGINE-1')).toBeUndefined()
    expect(stack.ledger.getTicketMirror(ticket)).toBeDefined()
    expect(existsSync(mirrorGcBackupDir(path.join(stack.root, 'var')))).toBe(true)
    expect(readdirSync(mirrorGcBackupDir(path.join(stack.root, 'var'))).length).toBe(1)
  })
})
