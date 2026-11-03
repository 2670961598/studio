/**
 * company-write-face —— 运行期写面（daemon 唯一写入者）定向红→绿用例（studio-dev-541）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（主循环七相位：挂单队列＝相位 7 尾消化，不增删相位）；
 *   - docs/17-§6（证据契约：提交成功≠已生效；失败如实分类、不伪造）；
 *   - docs/v2/05-§三 DOM-01（公司 git 目录唯一写入者＝daemon 挂单 commit）；
 *   - docs/v2/06-§五.1（已提交≠已生效）；docs/v2/11-§〇.4（重放零第二副作用）；
 *   - docs/v2/15（fail-closed：脏树/旁路＝拒写，不留半改态）。
 *
 * 改前必红：本单之前 `engine/company-write/runtime.ts` 不存在（engine/runtime 零调用），
 * 本文件 import 失败＝红；改后绿。全部用例零 git（commit/audit 注入替身）——真 git 面
 * 由 company-commit.e2e.test.ts 覆盖（本机 git 不可用时的环境边界见 REPORT「环境」）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import type { ClassifiedError } from '@studio-next/contract'
import {
  createCompanyWriteFace,
  createCompanyWriteQueue,
  type CompanyWriteDeps,
} from '../../../src/engine/company-write/runtime.ts'
import type { BypassFinding, CommitEvidence, SoleWriterAudit } from '../../../src/engine/company-commit/types.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function makeLedger(): Ledger {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-company-write-'))
  roots.push(root)
  return openLedger(path.join(root, 'ledger.sqlite'))
}

function auditOf(soleWriter: boolean, findings: readonly BypassFinding[] = []): SoleWriterAudit {
  return {
    companyDir: '/tmp/company',
    head: 'a'.repeat(40),
    baseline: 'b'.repeat(40),
    lastOwnedCommit: null,
    ownedCommits: 1,
    scannedCommits: 2,
    findings,
    soleWriter,
  }
}

function evidenceOf(status: 'committed' | 'replayed' | 'unchanged' = 'committed'): CommitEvidence {
  return {
    status,
    orderId: 'ORG-2026-0001',
    commit: status === 'unchanged' ? null : 'c'.repeat(40),
    message: 'ORG-2026-0001 组织变更',
    digest: 'd'.repeat(64),
    paths: status === 'unchanged' ? [] : ['departments/综合部/department.yaml'],
    recordRefs: ['REC-LIFE-08#org-event-0001'],
    previousHead: 'a'.repeat(40),
    baseline: null,
    verified: true,
  }
}

function classified(category: ClassifiedError['category'], subcause: string): Error & ClassifiedError {
  const err = new Error(`${category}/${subcause}：注入失败`) as Error & ClassifiedError
  err.category = category
  err.subcause = subcause
  return err
}

interface Harness {
  readonly ledger: Ledger
  readonly deps: CompanyWriteDeps
  readonly calls: { commit: unknown[]; applied: CommitEvidence[] }
}

function harness(overrides: Partial<CompanyWriteDeps> = {}): Harness {
  const ledger = makeLedger()
  const calls = { commit: [] as unknown[], applied: [] as CommitEvidence[] }
  const deps: CompanyWriteDeps = {
    companyDir: '/tmp/company',
    company: 'studio-dev',
    dept: 'departments/综合部',
    ledger,
    clock: () => 1_700_000_000_000,
    makeId: (ts) => makeUlid(ts),
    commit: async (_dir, order): Promise<CommitEvidence> => {
      calls.commit.push(order)
      return evidenceOf()
    },
    audit: async (): Promise<SoleWriterAudit> => auditOf(true),
    apply: (evidence): void => {
      calls.applied.push(evidence)
    },
    ...overrides,
  }
  return { ledger, deps, calls }
}

describe('company-write-face：唯一写入者前置审计（fail-closed 第一段）', () => {
  it('旁路写/脏树在场＝拒写：不调用 commit、零目录写入、落 ESCALATE', async () => {
    const h = harness({
      audit: async (): Promise<SoleWriterAudit> =>
        auditOf(false, [{ kind: 'dirty-worktree', detail: '工作树有未挂单改动', commit: null, path: 'org-config.yaml' }]),
    })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0001' })
    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe('rejected')
    expect(outcome.subcause).toBe('sole-writer-violation')
    expect(outcome.rollback).toBe('none')
    expect(h.calls.commit).toHaveLength(0)
    expect(h.calls.applied).toHaveLength(0)
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events.map((e) => e.event)).toEqual(['ESCALATE'])
    expect(events[0]?.note).toContain('COMPANY_COMMIT;BYPASS;ORG-2026-0001;dirty-worktree')
  })

  it('前置审计不可读＝拒写（不把读失败当无旁路）', async () => {
    const h = harness({
      audit: async (): Promise<SoleWriterAudit> => {
        throw new Error('git status 不可读')
      },
    })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0002' })
    expect(outcome.ok).toBe(false)
    expect(outcome.subcause).toBe('audit-failed')
    expect(outcome.rollback).toBe('none')
    expect(h.calls.commit).toHaveLength(0)
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events[0]?.event).toBe('ESCALATE')
    expect(events[0]?.note).toContain('COMPANY_COMMIT;AUDIT_FAILED')
  })
})

describe('company-write-face：挂单与回滚（fail-closed 第二/三段）', () => {
  it('提交成立＝ORG_UPGRADE 留痕 + 生效段调用（applied=true，一单恰一 commit 证据）', async () => {
    const h = harness()
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0001' })
    expect(outcome.ok).toBe(true)
    expect(outcome.status).toBe('committed')
    expect(outcome.applied).toBe(true)
    expect(outcome.commit).toBe('c'.repeat(40))
    expect(outcome.paths).toEqual(['departments/综合部/department.yaml'])
    expect(h.calls.commit).toHaveLength(1)
    expect(h.calls.applied).toHaveLength(1)
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events.map((e) => e.event)).toEqual(['ORG_UPGRADE'])
    expect(events[0]?.note).toContain('COMPANY_COMMIT;OK;ORG-2026-0001')
    expect(events[0]?.note).toContain('applied=true')
  })

  it('提交失败且回滚干净＝rollback=clean，ESCALATE 携两级分类子因，不宣称成功', async () => {
    let audits = 0
    const h = harness({
      audit: async (): Promise<SoleWriterAudit> => {
        audits += 1
        return auditOf(true)
      },
      commit: async (): Promise<CommitEvidence> => {
        throw classified('EXTERNAL_REJECT', 'company-commit/git-commit-failed')
      },
    })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0009' })
    expect(outcome.ok).toBe(false)
    expect(outcome.rollback).toBe('clean')
    expect(outcome.subcause).toBe('company-commit/git-commit-failed')
    expect(audits).toBe(2) // 前置 + 提交后复核（回滚零残留）
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events[0]?.event).toBe('ESCALATE')
    expect(events[0]?.note).toContain('COMPANY_COMMIT;FAIL;ORG-2026-0009;EXTERNAL_REJECT/company-commit/git-commit-failed')
    expect(events[0]?.note).toContain('rollback=clean')
  })

  it('回滚不完整（提交后审计仍有发现）＝rollback=incomplete，如实要求人工对账', async () => {
    let audits = 0
    const h = harness({
      audit: async (): Promise<SoleWriterAudit> => {
        audits += 1
        return audits === 1
          ? auditOf(true)
          : auditOf(false, [{ kind: 'dirty-worktree', detail: '回滚后仍有残留', commit: null, path: 'org-config.yaml' }])
      },
      commit: async (): Promise<CommitEvidence> => {
        throw classified('EXTERNAL_REJECT', 'company-commit/apply-failed')
      },
    })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0010' })
    expect(outcome.rollback).toBe('incomplete')
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events[0]?.note).toContain('rollback=incomplete')
    expect(events[0]?.note).toContain('不得宣称已回滚')
  })

  it('已提交未生效＝applied=false 且双事件（ORG_UPGRADE + ESCALATE）；不回滚已成立 commit', async () => {
    const h = harness({
      apply: (): void => {
        throw new Error('重装载校验失败')
      },
    })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0003' })
    expect(outcome.ok).toBe(true)
    expect(outcome.status).toBe('committed')
    expect(outcome.applied).toBe(false)
    expect(outcome.commit).toBe('c'.repeat(40))
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    // 两事件同一 clock 毫秒：queryEvents 升序按 ts 定序，同 ts 内先后非契约面——
    // 断言「集合 + 各自 note」而非位序（位序断言会把 ULID 随机尾当语义）。
    expect(events.map((e) => e.event).sort()).toEqual(['ESCALATE', 'ORG_UPGRADE'])
    const upgraded = events.find((e) => e.event === 'ORG_UPGRADE')
    const escalated = events.find((e) => e.event === 'ESCALATE')
    expect(upgraded?.note).toContain('COMPANY_COMMIT;OK;ORG-2026-0003')
    expect(escalated?.note).toContain('COMPANY_COMMIT;COMMITTED_NOT_APPLIED;ORG-2026-0003')
  })

  it('重放（replayed）＝ORG_UPGRADE 记 REPLAY，生效段幂等重载、零第二 commit', async () => {
    const h = harness({ commit: async (): Promise<CommitEvidence> => evidenceOf('replayed') })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0001' })
    expect(outcome.status).toBe('replayed')
    expect(outcome.applied).toBe(true)
    expect(h.calls.applied).toHaveLength(1)
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events[0]?.event).toBe('ORG_UPGRADE')
    expect(events[0]?.note).toContain('COMPANY_COMMIT;REPLAY;ORG-2026-0001')
  })

  it('无变化（unchanged）＝ORG_UPGRADE 记 UNCHANGED，commit 为空不伪造', async () => {
    const h = harness({ commit: async (): Promise<CommitEvidence> => evidenceOf('unchanged') })
    const outcome = await createCompanyWriteFace(h.deps).submit({ orderId: 'ORG-2026-0004' })
    expect(outcome.status).toBe('unchanged')
    expect(outcome.commit).toBeNull()
    const events = h.ledger.queryEvents({ company: 'studio-dev' })
    expect(events[0]?.note).toContain('COMPANY_COMMIT;UNCHANGED;ORG-2026-0004')
  })
})

describe('company-write-face：相位 7 尾队列（每拍有界，失败不盲目重排）', () => {
  it('每拍至多 maxPerTick 单；成功/失败分列计数；失败单不重排队', async () => {
    const h = harness()
    let n = 0
    const face = createCompanyWriteFace({
      ...h.deps,
      commit: async (): Promise<CommitEvidence> => {
        n += 1
        if (n === 2) throw classified('EXTERNAL_REJECT', 'company-commit/head-moved')
        return evidenceOf()
      },
    })
    const queue = createCompanyWriteQueue(face, 1)
    queue.enqueue({ orderId: 'ORG-A' })
    queue.enqueue({ orderId: 'ORG-B' })
    expect(queue.pending).toBe(2)
    const first = await queue.drain()
    expect(first.drained).toBe(1)
    expect(first.committed).toBe(1)
    expect(first.applied).toBe(1)
    expect(first.orderIds).toEqual(['ORG-A'])
    expect(queue.pending).toBe(1)
    const second = await queue.drain()
    expect(second.drained).toBe(1)
    expect(second.rejected).toBe(1)
    expect(queue.pending).toBe(0)
    const third = await queue.drain()
    expect(third.drained).toBe(0)
  })
})
