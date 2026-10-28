/**
 * hist —— PORT-HIST 数据面最小实现：记录唯一写口（v14 `records` 表）＋读/查询/修正/对账/记忆读
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.6（PORT-HIST 签名：append/get/query/correct/reconcile＋显式 tx 句柄）；
 *     plan/05 IMPL-04-06（本单）；plan/01 G-PORT-HIST / G-DOM-05；GAP-V2-09（多记录同域原子=显式 tx）
 *   - docs/v2/11 §〇（记录信封）、§0.4（身份/版本/幂等：同 id 内容一致=幂等返回既有、不一致=拒；
 *     同幂等键同理；身份一经分配不复用，修改只追加）、§0.5（时间分层：effectiveTime.from 落列、
 *     pending/effective 必填）、§一（74 类唯一登记处）、§0.9（13 AREA 封闭）
 *   - docs/v2/05 §三 DOM-05：`records`＝记录投影，**不是第四事实源**；本面不写 events、不写 cost_daily；
 *     投影钩子同事务触发＝目标（未证，治 L3J-P1-02）
 *   - docs/v2/10 §4.1（schemaRef/specVersion 引用串）；docs/v2/17 NEG-REC-05（DOM-05 负向面）
 *
 * 形状唯一源＝contract：信封＋族 payload 一律经 records.ts 接缝（contract `ALL_RECORD_SCHEMAS`）判，
 * 本文件零字段表（§0.6 枚举/形状零重述）。本单不新增记录类/端口（74 类/20 端口不变）。
 *
 * 列编码（v14 DDL 未冻结编码，归写面；读面同表回解，坏行 fail-closed）：
 *   - schema_ref/revises/producer = JSON 文本（contract 对象原形）；payload = JSON 文本；
 *   - idempotency_key = 五元组 JSON 数组 [companyRef, recordType, subjectId, operationClass,
 *     requesterSequence]（固定元序＝库侧 UNIQUE 的字节可比性）；五元组 companyRef/recordType 必须与
 *     信封一致，否则拒（§0.4-5 第①②元不可自相矛盾）；
 *   - produced_at/effective_time/created_at = epoch ms（v14 头注「信封 Timestamp 串↔毫秒转换归写面」；
 *     读面归一 UTC `Z`，小数秒超过毫秒按列口径截断）。
 *
 * v14 列集缺口（写面**拒收**而非静默丢字段——加列走提案流，DDL 归 IMPL-04-01）：
 *   - `basisRefs` 无落列 → 非空即拒（store/hist:basis-refs-unlanded）；
 *   - `effectiveTime.until` 无落列（§0.5 称 until 唯一存放点是信封）→ 出现即拒（store/hist:until-unlanded）。
 * 其余信封字段全列保存、无损回读（basisRefs 回读恒 []，与写面拒收互补）。
 *
 * 边界（如实登记，不冒充已闭合）：
 *   - reconcile 只做**投影自洽**对账（不跨 events/外部回执——跨源对账归 MIG-06 收割域）；只读、零写语句。
 *   - memory 只读 REC-MEM-01 且按 owner_scope **精确等值**（不自动继承：继承只能经 REC-MEM-03 的
 *     inherit/transfer_out 显式凭证）；未落 REC-MEM-02 访问审计（§3.3 每次访问留痕归 port 完整刀）。
 *   - payload() 的知悉范围遮罩/byteDigestState 三态未实现（归 IMPL-04-08/port 完整刀）；get 直返原 payload。
 *   - 零 `Date.now` 依赖：created_at 由注入时钟（缺省 Date.now）供，测试可复现。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, type MemoryDomain, type ReconcileDifferenceKind } from '@studio-next/contract'
import { optNum, optStr, str, type SqlRow } from './row-helpers.ts'
import {
  ALL_RECORD_SCHEMAS,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  v2RecordArea,
  type AllRecordType,
  type EffectiveSlotCarrier,
  type RecordEnvelope,
  type RecordValidationIssue,
} from './records.ts'

/** 记录（contract 信封原形；读面返形——`basisRefs` 恒 []，见文件头注缺口） */
export type HistRecord = RecordEnvelope<unknown>

/** append/correct 结果（身份＋是否本次落库；false=同 id/幂等键内容一致的重放） */
export interface HistRecordRef {
  readonly recordId: string
  readonly recordType: string
  readonly appended: boolean
}

/** 事务句柄（显式；多记录同域原子——v2/14 §1.6 / GAP-V2-09） */
export interface HistTx {
  readonly txId: string
  readonly open: boolean
}

/** 事务回执（recordRefs=本事务内经本面签发/重放的引用；abort 后恒空） */
export interface HistTxReceipt {
  readonly txId: string
  readonly committed: boolean
  readonly recordRefs: readonly HistRecordRef[]
}

/** 读面查询：company 必填；area/type 为闭集列过滤；since＝produced_at 下界（epoch ms，含） */
export interface HistQuery {
  readonly company: string
  readonly area?: string
  readonly type?: string
  readonly since?: number
}

/** 修正草案（REC-COR-01；追加不覆盖——v2/11 §2.1/ENU-70） */
export interface HistCorrectionDraft {
  /** 被修正记录 id（必须已存在；原行一字不动） */
  readonly targetRecordId: string
  /** 修正记录信封（recordType 必须 REC-COR-01；payload.corrects 须含 targetRecordId） */
  readonly record: unknown
}

/** 记忆读面（REC-MEM-01；scope＝payload.owner_scope 精确等值，不自动继承） */
export interface HistMemoryQuery {
  readonly company: string
  readonly scope: string
  readonly domain?: MemoryDomain
}

/** 对账查询（投影自洽面：company 必填；area/since/until 过滤，时间=produced_at epoch ms） */
export interface HistReconcileQuery {
  readonly company: string
  readonly area?: string
  readonly since?: number
  readonly until?: number
}

/** 对账差异（kind 取 ENU-68 六类中的本面可判四类：missing/disorder/conflict/undeterminable） */
export interface HistReconcileDifference {
  readonly kind: ReconcileDifferenceKind
  readonly recordId: string
  readonly detail: string
}

/** 对账批次（settled:false＝不得结清；差异不得压成「已对平」——v2/14 §1.6） */
export interface HistReconcileBatch {
  readonly query: HistReconcileQuery
  readonly checked: number
  readonly differences: readonly HistReconcileDifference[]
  readonly settled: boolean
  readonly completedAt: string
}

/** HIST 面（createHistFace 返回；唯一记录写口，读写同出一句柄） */
export interface HistFace {
  /** 开显式事务（单层；连接已在事务中＝拒） */
  begin(): HistTx
  /** 提交（refs=本事务内签发/重放的引用） */
  commit(tx: HistTx): HistTxReceipt
  /** 回滚（refs 恒空——已回滚的记录不得冒充已写） */
  abort(tx: HistTx): HistTxReceipt
  /** 追加（信封＋族 payload＋生效槽一律 contract 判；同 id/幂等键内容一致=返回既有） */
  append(record: unknown, tx?: HistTx): HistRecordRef
  /** 按 id 取记录；权威确认不存在=undefined（坏行=fail-closed） */
  get(recordId: string): HistRecord | undefined
  /** company 必填；area/type/since 过滤；produced_at,record_id 升序 */
  query(query: HistQuery): HistRecord[]
  /** 追加修正记录（REC-COR-01；原行不覆盖） */
  correct(draft: HistCorrectionDraft, tx?: HistTx): HistRecordRef
  /** 只读投影自洽对账（不跨 events/外部回执） */
  reconcile(query: HistReconcileQuery): HistReconcileBatch
  /** 记忆读面（REC-MEM-01 按 owner_scope 精确等值，不自动继承） */
  memory(query: HistMemoryQuery): HistRecord[]
}

/** 面工厂选项：时钟注入（created_at/completedAt；缺省 Date.now） */
export interface HistFaceOptions {
  readonly now?: () => number
}

/** 写口列投影（v14 列集；created_at 库侧补列，回读不入信封） */
interface RecordColumns {
  readonly record_id: string
  readonly record_type: string
  readonly record_area: string
  readonly schema_ref: string
  readonly spec_version: string
  readonly company: string
  readonly produced_at: number
  readonly producer: string
  readonly payload: string
  readonly proof_boundary: string | null
  readonly effective_state: string
  readonly effective_time: number | null
  readonly revises: string | null
  readonly idempotency_key: string | null
}

/** 解码问题（列级；对账面收差异、读写面抛 CONFIG_INVALID） */
interface DecodeIssue {
  readonly path: string
  readonly message: string
}

type DecodeOutcome =
  | { readonly ok: true; readonly record: HistRecord }
  | { readonly ok: false; readonly issues: readonly DecodeIssue[] }

const INSERT_RECORD_SQL =
  'INSERT INTO records (record_id, record_type, record_area, schema_ref, spec_version, company, produced_at, producer, payload, proof_boundary, effective_state, effective_time, revises, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'

/** Timestamp 串 → epoch ms（contract TimestampSchema 已锁形状；不可解析=调用方 bug） */
function epochMs(timestamp: string): number {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) configInvalid('store/hist:bad-timestamp', `timestamp 不可解析：${timestamp}`)
  return ms
}

/** epoch ms → UTC `Z` 串（读面归一；契约 TimestampSchema 收） */
function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString()
}

/** 幂等键落列形（五元组固定序 JSON 数组——UNIQUE 列字节可比） */
function idempotencyKeyText(key: HistRecord['idempotencyKey']): string | null {
  if (key === undefined) return null
  return JSON.stringify([key.companyRef, key.recordType, key.subjectId, key.operationClass, key.requesterSequence])
}

/** 信封 → 列投影（写面唯一映射；不写 created_at——归插入点时钟） */
function columnsOf(record: HistRecord): RecordColumns {
  return {
    record_id: record.recordId,
    record_type: record.recordType,
    record_area: v2RecordArea(record.recordType),
    schema_ref: JSON.stringify(record.schemaRef),
    spec_version: record.specVersion,
    company: record.companyRef,
    produced_at: epochMs(record.producedAt),
    producer: JSON.stringify(record.producer),
    payload: JSON.stringify(record.payload),
    proof_boundary: record.proofBoundary ?? null,
    effective_state: record.effectiveState,
    effective_time: record.effectiveTime === undefined ? null : epochMs(record.effectiveTime.from),
    revises: record.revises === undefined ? null : JSON.stringify(record.revises),
    idempotency_key: idempotencyKeyText(record.idempotencyKey),
  }
}

/**
 * 行 ↔ 列投影全列比较（created_at 不入）。
 * 幂等键重放场景（ignoreId+ignoreProducedAt）：重复提交可携新 recordId 与新「系统获知时刻」，
 * 语义内容（类型/payload/生产者/生效槽/版本链/幂等键）一致即返既有——§0.4-4 不产生第二次副作用。
 */
function sameColumns(row: SqlRow, cols: RecordColumns, options: { readonly ignoreId?: boolean; readonly ignoreProducedAt?: boolean } = {}): boolean {
  return (
    (options.ignoreId === true || str(row, 'record_id') === cols.record_id) &&
    str(row, 'record_type') === cols.record_type &&
    str(row, 'record_area') === cols.record_area &&
    str(row, 'schema_ref') === cols.schema_ref &&
    str(row, 'spec_version') === cols.spec_version &&
    str(row, 'company') === cols.company &&
    (options.ignoreProducedAt === true || optNum(row, 'produced_at') === cols.produced_at) &&
    str(row, 'producer') === cols.producer &&
    str(row, 'payload') === cols.payload &&
    (optStr(row, 'proof_boundary') ?? null) === cols.proof_boundary &&
    str(row, 'effective_state') === cols.effective_state &&
    (optNum(row, 'effective_time') ?? null) === cols.effective_time &&
    (optStr(row, 'revises') ?? null) === cols.revises &&
    (optStr(row, 'idempotency_key') ?? null) === cols.idempotency_key
  )
}

/** 幂等键列 → 五元组（坏形=解码问题） */
function decodeIdempotencyKey(value: unknown, issues: DecodeIssue[]): HistRecord['idempotencyKey'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 5 || !value.every((part) => typeof part === 'string')) {
    issues.push({ path: 'idempotency_key', message: 'idempotency_key 列须为五元组 JSON 数组（[companyRef, recordType, subjectId, operationClass, requesterSequence]）' })
    return undefined
  }
  const [companyRef = '', recordType = '', subjectId = '', operationClass = '', requesterSequence = ''] = value as string[]
  return { companyRef, recordType, subjectId, operationClass, requesterSequence }
}

/** 行 → 信封（列编码回解；不判形状——形状由 parseRecord 统一判） */
function decodeRow(row: SqlRow): DecodeOutcome {
  const issues: DecodeIssue[] = []
  const jsonColumn = (column: string): unknown => {
    const raw = optStr(row, column)
    if (raw === undefined) return undefined
    try {
      return JSON.parse(raw) as unknown
    } catch {
      issues.push({ path: column, message: `${column} 列不是合法 JSON` })
      return undefined
    }
  }
  const payload = jsonColumn('payload')
  const producer = jsonColumn('producer')
  const schemaRef = jsonColumn('schema_ref')
  const revises = jsonColumn('revises')
  const idempotencyKey = decodeIdempotencyKey(jsonColumn('idempotency_key'), issues)
  const producedAt = optNum(row, 'produced_at')
  if (producedAt === undefined || !Number.isFinite(producedAt)) issues.push({ path: 'produced_at', message: 'produced_at 缺失或非有限数（NOT NULL 整数列）' })
  if (issues.length > 0 || producedAt === undefined || !Number.isFinite(producedAt)) return { ok: false, issues }
  const effectiveTime = optNum(row, 'effective_time')
  if (effectiveTime !== undefined && !Number.isFinite(effectiveTime)) {
    issues.push({ path: 'effective_time', message: 'effective_time 非有限数（epoch ms 整数列）' })
    return { ok: false, issues }
  }
  const proofBoundary = optStr(row, 'proof_boundary')
  const record: HistRecord = {
    recordId: str(row, 'record_id'),
    recordType: str(row, 'record_type'),
    schemaRef: schemaRef as HistRecord['schemaRef'],
    specVersion: str(row, 'spec_version'),
    companyRef: str(row, 'company'),
    producedAt: isoTimestamp(producedAt),
    producer: producer as HistRecord['producer'],
    basisRefs: [],
    payload: payload as unknown,
    effectiveState: str(row, 'effective_state') as HistRecord['effectiveState'],
    ...(effectiveTime === undefined ? {} : { effectiveTime: { from: isoTimestamp(effectiveTime) } }),
    ...(proofBoundary === undefined ? {} : { proofBoundary }),
    ...(revises === undefined ? {} : { revises: revises as NonNullable<HistRecord['revises']> }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }
  return { ok: true, record }
}

type ParseOutcome =
  | { readonly ok: true; readonly record: HistRecord }
  | { readonly ok: false; readonly issues: readonly RecordValidationIssue[] }

/** 记录闸：未登记类型＋信封/族 payload（contract 74 类）＋生效槽一致性（§0.5） */
function parseRecord(record: unknown): ParseOutcome {
  const bag = typeof record === 'object' && record !== null ? (record as { recordType?: unknown }) : undefined
  const recordType = bag?.recordType
  if (typeof recordType !== 'string' || !Object.hasOwn(ALL_RECORD_SCHEMAS, recordType)) {
    return {
      ok: false,
      issues: [{ path: 'recordType', message: `recordType=${String(recordType)} 未在 contract 74 类登记（v2/11 §一：未登记即悬空引用）` }],
    }
  }
  const parsed = ALL_RECORD_SCHEMAS[recordType as AllRecordType].safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const slot = checkEffectiveSlotConsistency(parsed.data as EffectiveSlotCarrier)
  return slot.ok ? { ok: true, record: parsed.data as RecordEnvelope<unknown> } : { ok: false, issues: slot.issues }
}

/** 记录闸（写面形）：非法即 CONFIG_INVALID（首个 issue 路径入 subcause，对齐 assertRecord 风格） */
function requireRecord(record: unknown): HistRecord {
  const outcome = parseRecord(record)
  if (outcome.ok) return outcome.record
  const first = outcome.issues[0]
  configInvalid(`store/record:invalid:${first?.path ?? '(root)'}`, first?.message)
}

/** v14 列集可落性闸（缺列字段拒收，不静默丢——见文件头注缺口） */
function assertLandable(record: HistRecord): void {
  if (record.basisRefs.length > 0) {
    configInvalid(
      'store/hist:basis-refs-unlanded',
      `basisRefs 有 ${record.basisRefs.length} 条依据引用，但 v14 records 列集无 basis_refs 列（§0.4-2 依据引用不得静默丢弃；加列走提案流）`,
    )
  }
  if (record.effectiveTime?.until !== undefined) {
    configInvalid(
      'store/hist:until-unlanded',
      'effectiveTime.until 是 §0.5 的区间终点唯一存放点，但 v14 records 列集无 until 列——拒收而非丢字段（加列走提案流）',
    )
  }
  const key = record.idempotencyKey
  if (key !== undefined && (key.companyRef !== record.companyRef || key.recordType !== record.recordType)) {
    configInvalid(
      'store/hist:idempotency-scope-mismatch',
      `幂等键 scope（${key.companyRef}/${key.recordType}）与信封（${record.companyRef}/${record.recordType}）不一致（§0.4-5 第①②元）`,
    )
  }
}

/** REC-COR-01 修正目标链接：payload.corrects 须含目标记录（不覆盖原行的机械前提） */
function correctsTarget(payload: unknown, targetRecordId: string): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const corrects = (payload as { corrects?: unknown }).corrects
  return (
    Array.isArray(corrects) &&
    corrects.some((item) => typeof item === 'object' && item !== null && (item as { refId?: unknown }).refId === targetRecordId)
  )
}

/**
 * v14 记录面工厂（db 须已 migrate 到 v15；本面只读写 `records`，不触 events/cost_daily）。
 * 写面唯一：append/correct；读面 get/query/reconcile/memory 均 fail-closed 于坏行。
 */
export function createHistFace(db: DatabaseSync, options: HistFaceOptions = {}): HistFace {
  const clock = options.now ?? (() => Date.now())
  const txStates = new WeakMap<HistTx, { readonly refs: HistRecordRef[] }>()
  let txSeq = 0

  const assertTx = (tx: HistTx | undefined): void => {
    if (tx === undefined) return
    if (!tx.open) configInvalid('store/hist:tx-closed', `tx=${tx.txId} 已 commit/abort，不得再写`)
    if (!txStates.has(tx)) configInvalid('store/hist:tx-foreign', `tx=${tx.txId} 非本面句柄（显式 tx 只在本 face 内有效）`)
  }

  const settle = (tx: HistTx, committed: boolean): HistTxReceipt => {
    assertTx(tx)
    if (!db.isTransaction) configInvalid('store/hist:tx-lost', `tx=${tx.txId} 对应事务已不在（外部 commit/rollback？）`)
    const state = txStates.get(tx)
    db.exec(committed ? 'COMMIT' : 'ROLLBACK')
    ;(tx as { open: boolean }).open = false
    txStates.delete(tx)
    return { txId: tx.txId, committed, recordRefs: committed ? (state?.refs ?? []) : [] }
  }

  const begin = (): HistTx => {
    if (db.isTransaction) configInvalid('store/hist:tx-nested', '本面只开单层事务：连接已在事务中（先 commit/abort 再开）')
    db.exec('BEGIN IMMEDIATE')
    const tx: HistTx = { txId: `hist-tx-${++txSeq}`, open: true }
    txStates.set(tx, { refs: [] })
    return tx
  }

  const insertRow = (cols: RecordColumns, tx: HistTx | undefined): HistRecordRef => {
    const finish = (ref: HistRecordRef): HistRecordRef => {
      if (tx !== undefined) txStates.get(tx)?.refs.push(ref)
      return ref
    }
    const byId = db.prepare('SELECT * FROM records WHERE record_id = ?').get(cols.record_id) as SqlRow | undefined
    if (byId !== undefined) {
      if (!sameColumns(byId, cols)) {
        configInvalid('store/hist:duplicate-id', `recordId=${cols.record_id} 已存在且内容不一致（身份一经分配不复用，修改只追加——v2/11 §0.4-1）`)
      }
      return finish({ recordId: cols.record_id, recordType: cols.record_type, appended: false })
    }
    if (cols.idempotency_key !== null) {
      const byKey = db
        .prepare('SELECT * FROM records WHERE company = ? AND record_type = ? AND idempotency_key = ?')
        .get(cols.company, cols.record_type, cols.idempotency_key) as SqlRow | undefined
      if (byKey !== undefined) {
        if (!sameColumns(byKey, cols, { ignoreId: true, ignoreProducedAt: true })) {
          configInvalid(
            'store/hist:duplicate-idempotency-key',
            `幂等键命中但内容不一致（同键异内容=拒写，重复提交只返回既有——v2/11 §0.4-4/§0.4-5）`,
          )
        }
        return finish({ recordId: str(byKey, 'record_id'), recordType: str(byKey, 'record_type'), appended: false })
      }
    }
    db.prepare(INSERT_RECORD_SQL).run(
      cols.record_id,
      cols.record_type,
      cols.record_area,
      cols.schema_ref,
      cols.spec_version,
      cols.company,
      cols.produced_at,
      cols.producer,
      cols.payload,
      cols.proof_boundary,
      cols.effective_state,
      cols.effective_time,
      cols.revises,
      cols.idempotency_key,
      clock(),
    )
    return finish({ recordId: cols.record_id, recordType: cols.record_type, appended: true })
  }

  const append = (record: unknown, tx?: HistTx): HistRecordRef => {
    assertTx(tx)
    const checked = requireRecord(record)
    assertLandable(checked)
    return insertRow(columnsOf(checked), tx)
  }

  const correct = (draft: HistCorrectionDraft, tx?: HistTx): HistRecordRef => {
    assertTx(tx)
    const checked = requireRecord(draft.record)
    if (checked.recordType !== 'REC-COR-01') {
      configInvalid('store/hist:not-correction', `recordType=${checked.recordType} 须为 REC-COR-01（修正只走 REC-COR-01 追加）`)
    }
    const target = db.prepare('SELECT record_id FROM records WHERE record_id = ?').get(draft.targetRecordId)
    if (target === undefined) {
      configInvalid('store/hist:correction-target-missing', `修正目标 ${draft.targetRecordId} 不存在（不覆盖不存在的行，也不补造原行）`)
    }
    if (!correctsTarget(checked.payload, draft.targetRecordId)) {
      configInvalid(
        'store/hist:correction-target-unlinked',
        `REC-COR-01 payload.corrects 未含目标 ${draft.targetRecordId}（修正必须显式指向被修正记录——§2.1）`,
      )
    }
    assertLandable(checked)
    return insertRow(columnsOf(checked), tx)
  }

  /** 行读闸：解码＋contract 形状双关；坏行即 CONFIG_INVALID（读面不得冒充「无行」） */
  const readRowChecked = (row: SqlRow): HistRecord => {
    const decoded = decodeRow(row)
    const issues = decoded.ok ? [] : decoded.issues
    const shape = decoded.ok ? parseRecord(decoded.record) : undefined
    if (decoded.ok && shape !== undefined && shape.ok) return shape.record
    const all = shape !== undefined && !shape.ok ? shape.issues : issues
    const first = all[0]
    configInvalid(`store/hist:corrupt-row:${first?.path ?? '(root)'}`, first?.message ?? '行不可解码')
  }

  const selectRows = (query: HistQuery & { readonly until?: number }): SqlRow[] => {
    const where = ['company = ?']
    const params: Array<string | number> = [query.company]
    if (query.area !== undefined) {
      where.push('record_area = ?')
      params.push(query.area)
    }
    if (query.type !== undefined) {
      where.push('record_type = ?')
      params.push(query.type)
    }
    if (query.since !== undefined) {
      where.push('produced_at >= ?')
      params.push(query.since)
    }
    if (query.until !== undefined) {
      where.push('produced_at <= ?')
      params.push(query.until)
    }
    const sql = `SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY produced_at ASC, record_id ASC`
    return db.prepare(sql).all(...params) as SqlRow[]
  }

  const get = (recordId: string): HistRecord | undefined => {
    const row = db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId) as SqlRow | undefined
    return row === undefined ? undefined : readRowChecked(row)
  }

  const query = (q: HistQuery): HistRecord[] => selectRows(q).map(readRowChecked)

  const reconcile = (q: HistReconcileQuery): HistReconcileBatch => {
    const rows = selectRows(q)
    const differences: HistReconcileDifference[] = []
    const add = (kind: ReconcileDifferenceKind, recordId: string, detail: string): void => {
      differences.push({ kind, recordId, detail })
    }
    for (const row of rows) {
      const recordId = str(row, 'record_id')
      const decoded = decodeRow(row)
      if (!decoded.ok) {
        for (const issue of decoded.issues) add('undeterminable', recordId, `${issue.path}: ${issue.message}`)
        continue
      }
      const shape = parseRecord(decoded.record)
      if (!shape.ok) {
        add('conflict', recordId, shape.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
        continue
      }
      const record = shape.record
      const area = v2RecordArea(record.recordType)
      if (str(row, 'record_area') !== area) {
        add('conflict', recordId, `record_area=${str(row, 'record_area')} 与类型派生域 ${area} 不一致（§0.9 列 CHECK 外的坏行）`)
      }
      const revises = record.revises
      if (revises !== undefined) {
        const target = db.prepare('SELECT produced_at FROM records WHERE record_id = ?').get(revises.refId) as SqlRow | undefined
        if (target === undefined) {
          add('missing', recordId, `revises → ${revises.refId} 不存在（版本链悬空，§0.4-1）`)
        } else if ((optNum(target, 'produced_at') ?? 0) > (optNum(row, 'produced_at') ?? 0)) {
          add('disorder', recordId, `修正/新版本先于被修正记录（revises → ${revises.refId}，§0.4-3 时间轴乱序）`)
        }
      }
    }
    return {
      query: q,
      checked: rows.length,
      differences,
      settled: differences.length === 0,
      completedAt: isoTimestamp(clock()),
    }
  }

  const memory = (q: HistMemoryQuery): HistRecord[] => {
    if (q.scope.trim() === '') configInvalid('store/hist:memory-scope-empty', 'memory scope 不得为空（按 scope 精确读，不自动继承）')
    return query({ company: q.company, type: 'REC-MEM-01' }).filter((record) => {
      const payload = record.payload
      if (typeof payload !== 'object' || payload === null) return false
      const bag = payload as { owner_scope?: unknown; domain?: unknown }
      return bag.owner_scope === q.scope && (q.domain === undefined || bag.domain === q.domain)
    })
  }

  return {
    begin,
    commit: (tx) => settle(tx, true),
    abort: (tx) => settle(tx, false),
    append,
    get,
    query,
    correct,
    reconcile,
    memory,
  }
}
