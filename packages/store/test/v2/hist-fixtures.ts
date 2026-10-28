/**
 * hist-fixtures —— IMPL-04-06 / PORT-HIST 记录面测试共用夹具（仅 test/v2 的 hist-* 两件使用）
 *
 * 纪律：不碰真实台账、不读环境、时钟注入固定（created_at/completedAt 可复现）；确定性 ULID 复用
 * `fixtures.ts`（同 test/v2 内共享件，不复制）。本文件不是测试文件（不受 .test.ts 收集）。
 *
 * 依据：plan/05 IMPL-04-06（临时库 migrate 到 v15）；docs/v2/11 §〇（信封）/§0.4（幂等）/§0.5（时间）；
 * docs/v2/14 §1.6（PORT-HIST 签名）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openSqlite } from '../../src/driver.ts'
import { createHistFace, type HistFace } from '../../src/hist.ts'
import { migrate } from '../../src/migrations.ts'
import { T0, ulid } from './fixtures.ts'

export { T0, ulid }

/** 测试时钟（固定） */
export const CLOCK = T0 + 9_000_000
/** 主测试公司（各 describe 用独立 company 隔离共享库） */
export const COMPANY = 'studio-hist'

export const iso = (ms: number): string => new Date(ms).toISOString()

/** 临时目录真文件库 + 已 migrate 的面（每测试文件一套；afterAll 关库删目录） */
export interface HistHarness {
  readonly dir: string
  readonly db: DatabaseSync
  readonly hist: HistFace
  close(): Promise<void>
}

export async function openHistHarness(): Promise<HistHarness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-v2-hist-'))
  const db = openSqlite(path.join(dir, 'hist.db'))
  migrate(db)
  return {
    dir,
    db,
    hist: createHistFace(db, { now: () => CLOCK }),
    close: async (): Promise<void> => {
      db.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export interface IdemKey {
  companyRef: string
  recordType: string
  subjectId: string
  operationClass: string
  requesterSequence: string
}

export interface EnvelopeOver {
  recordId?: string
  companyRef?: string
  producedAt?: string
  /** null=不携 effectiveTime（pending/effective 缺它＝形状拒） */
  effectiveTime?: { from: string; until?: string } | null
  effectiveState?: 'pending' | 'effective' | 'expired'
  proofBoundary?: string
  basisRefs?: Array<{ refId: string; refVersion: string }>
  revises?: { refId: string; refVersion: string }
  idempotencyKey?: IdemKey
  schemaRef?: { schemaId: string; schemaVersion: string }
}

/** 合法信封（recordType 的族 payload 由调用方给；over 改信封维） */
export function envelope(recordType: string, payload: unknown, over: EnvelopeOver = {}): Record<string, unknown> {
  const producedAt = over.producedAt ?? iso(T0 + 1_000)
  const effectiveTime = over.effectiveTime === undefined ? { from: producedAt } : over.effectiveTime
  return {
    recordId: over.recordId ?? ulid(T0 + 1_000, 1),
    recordType,
    schemaRef: over.schemaRef ?? { schemaId: 'rec.test', schemaVersion: '1.0.0' },
    specVersion: '2.1.0',
    companyRef: over.companyRef ?? COMPANY,
    producedAt,
    producer: { decidedBy: 'ENG-1', writtenBy: 'daemon' },
    basisRefs: over.basisRefs ?? [],
    payload,
    effectiveState: over.effectiveState ?? 'effective',
    ...(effectiveTime === null ? {} : { effectiveTime }),
    ...(over.proofBoundary === undefined ? {} : { proofBoundary: over.proofBoundary }),
    ...(over.revises === undefined ? {} : { revises: over.revises }),
    ...(over.idempotencyKey === undefined ? {} : { idempotencyKey: over.idempotencyKey }),
  }
}

export function idemKey(over: Partial<IdemKey> = {}): IdemKey {
  return {
    companyRef: COMPANY,
    recordType: 'REC-EVT-01',
    subjectId: 'STUDIO-1',
    operationClass: 'append',
    requesterSequence: 'seq-1',
    ...over,
  }
}

/** REC-EVT-01 合法 payload（common.ts §7；over 可改字段/去掉必填） */
export function evtPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_kind: 'observation',
    actor_ref: 'ENG-1',
    occurred_at: iso(T0 + 1_000),
    observed_at: iso(T0 + 1_000),
    payload_summary: '观察到一次采集（中文与 "转义" 均原样）',
    source_kind: 'harness',
    cursor: 'cursor-1',
    event_completeness: 'unknown',
    ...over,
  }
}

/** REC-ASSET-02 合法 payload（asset.ts §4；用于跨 AREA 查询） */
export function assetLossPayload(): Record<string, unknown> {
  return {
    bound_host: { executor: 'claude', binding_ref: { refId: 'binding-1', refVersion: '1.0.0' } },
    lost_capabilities: [
      { capability: 'dsh-plugin', loss_face: '插件加载', unavailable_statement: '本宿主不可用（逐项明示）' },
    ],
    compensations: [],
    evidence_gaps: ['外部后端保留自身权限系统'],
  }
}

/** REC-MEM-01 合法 payload（mem.ts §3；owner_scope 是记忆读面的 scope） */
export function memPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = iso(T0 + 1_000)
  return {
    domain: 'personal',
    personal_subtype: 'fact',
    owner_scope: 'ENG-1',
    source_refs: [{ refType: 'REC-EVT-01', refId: ulid(T0, 900), refVersion: '1.0.0' }],
    observation_vs_interpretation: { observation: '观察到一次失败', interpretation: '可能是环境问题' },
    formed_at: ts,
    valid_at: ts,
    review_at: iso(T0 + 86_400_000),
    confidence: 'medium',
    knowledge_scope: 'task:STUDIO-1',
    correction_lineage: [],
    disputed: false,
    ...over,
  }
}

/** REC-COR-01 合法 payload（common.ts §6；corrects 指向被修正记录） */
export function corPayload(targetRecordId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    corrects: [{ refType: 'REC-EVT-01', refId: targetRecordId, refVersion: '1.0.0' }],
    correction_kind: 'supersede',
    corrected_fields: [{ field: 'payload_summary', old_value: '旧摘要', new_value: '新摘要' }],
    affected_conclusions: ['观察面 MON-03'],
    authority_ref: { refType: 'REC-AUTH-01', refId: ulid(T0, 901), refVersion: '1.0.0' },
    effective_from: iso(T0 + 2_000),
    original_preserved: true,
    ...over,
  }
}

/** REC-DEC-01 合法 payload（common.ts §4；带生效槽——§0.5 一致性用例） */
export function decPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decided_by: 'ENG-1',
    decision_kind: 'subject_classification',
    subject_ref: { refId: 'subject-1', refVersion: '1.0.0' },
    verdict: 'internal_position',
    conditions: [],
    rationale: '按授权表分类（理由不得为空）',
    basis_refs: [{ refType: 'REC-AUTH-01', refId: ulid(T0, 902), refVersion: '1.0.0' }],
    scope_judged: { judged: ['主体分类'], not_judged: ['利益冲突'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: iso(T0 + 1_000),
    external_effect_state: 'none',
    ...over,
  }
}

/** 某公司 records 行数（wider 为附加 SQL 片段，常以 " AND ..." 起始） */
export function countRecords(db: DatabaseSync, company: string, wider = ''): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM records WHERE company = ?${wider}`).get(company) as { c: number }
  return Number(row.c)
}

/** 单行原始列（原行不覆盖断言用） */
export function recordRow(db: DatabaseSync, recordId: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId) as Record<string, unknown>
}
