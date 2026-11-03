/**
 * hist/read —— hist 读面：v14 `records` 行解码/contract 形状闸 ＋ 读面知悉范围（ReadContext）闸与审计
 * （从 hist.ts 拆出；分层宪法 20-§十五 尺寸阈 600 行——studio-dev-543 读面接线后 hist.ts 超限，
 * 按阈拆件不抬基线；本件落 store/src/hist/ 子域（目录阈 25：store/src 直属保持 25 件，不向平面加散件）。
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §0.2-1（读面缺省＝拒；越权＝Err，**不得** Ok(undefined) 冒充「无行」；
 *     Ok(undefined) 只表权威确认不存在）／§1.6（PORT-HIST get/query/reconcile 读签名）；
 *   - docs/v2/15 §五 SEC-RD-01（readScope＋caller 字段承载，治 P0-10；读面越界访问留痕）；
 *   - docs/v2/11 §〇（记录信封）/§0.5（生效槽一致性）；docs/v2/05 §三 DOM-05（records＝记录投影）；
 *   - docs/17-§2（相位机）／§6（收割四要件）＝本单派发面：读面接线不改相位/收割判据。
 *
 * 口径：
 *   - 解码：列编码未冻结（归写面），读面同表回解；坏行 fail-closed（读面不得冒充「无行」）。
 *   - 知悉范围：读方法必带 ReadContext；缺省/畸形＝拒；越权＝拒（Err，不得拿 undefined/空集冒充
 *     「无行」）。公司维＝records.company 与 readScope.company 任一槽（companyId/slug）相等即同维
 *     （与 daemon assembly/api/readers.ts 同口径）；字段维本单只校验「非空声明」——字段级 payload
 *     遮罩归 IMPL-04-08/port 完整刀（不冒充已闭合）。
 *   - 审计：每次读调用经 `onRead` 交出一行（谁在读/范围依据/判定）；本件零 IO、零写。
 */
import { configInvalid } from '@studio-next/contract'
import type { CallerKind, ClassifiedError, FailureCategory, ReadContext } from '@studio-next/contract'
import { optNum, optStr, str, type SqlRow } from '../row-helpers.ts'
import {
  ALL_RECORD_SCHEMAS,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  type AllRecordType,
  type EffectiveSlotCarrier,
  type RecordEnvelope,
  type RecordValidationIssue,
} from '../records.ts'

/** 记录（contract 信封原形；读面返形——`basisRefs` 恒 []，见 hist.ts 头注缺口） */
export type HistRecord = RecordEnvelope<unknown>

/** epoch ms → UTC `Z` 串（读面归一；契约 TimestampSchema 收） */
export function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString()
}

/** 解码问题（列级；对账面收差异、读写面抛 CONFIG_INVALID） */
export interface DecodeIssue {
  readonly path: string
  readonly message: string
}

export type DecodeOutcome =
  | { readonly ok: true; readonly record: HistRecord }
  | { readonly ok: false; readonly issues: readonly DecodeIssue[] }

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
export function decodeRow(row: SqlRow): DecodeOutcome {
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

export type ParseOutcome =
  | { readonly ok: true; readonly record: HistRecord }
  | { readonly ok: false; readonly issues: readonly RecordValidationIssue[] }

/** 记录闸：未登记类型＋信封/族 payload（contract 74 类）＋生效槽一致性（§0.5） */
export function parseRecord(record: unknown): ParseOutcome {
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
export function requireRecord(record: unknown): HistRecord {
  const outcome = parseRecord(record)
  if (outcome.ok) return outcome.record
  const first = outcome.issues[0]
  configInvalid(`store/record:invalid:${first?.path ?? '(root)'}`, first?.message)
}

/** 读面方法名（审计行区分四法） */
export type HistReadMethod = 'get' | 'query' | 'reconcile' | 'memory'

/**
 * 读面审计行（本单实现要求③「上下文来源可审计」）：谁在读（callerId/kind）、范围依据
 * （company/fields/purpose）、判定与计数。本面**不写记录**（读面零写；审计落点归装配——
 * REC-MEM-02 访问审计/MON-09 留痕走 port 完整刀），经 `HistFaceOptions.onRead` 交给装配面落
 * 事件/日志（fail-closed：钩子抛错即上抛，不静默吞审计失败）。
 */
export interface HistReadAudit {
  readonly method: HistReadMethod
  readonly decision: 'allow' | 'deny'
  readonly callerId: string | null
  readonly callerKind: CallerKind | null
  /** 范围依据：`companyId/slug`（上下文缺/畸形时 null） */
  readonly company: string | null
  readonly fields: readonly string[]
  readonly purpose: string | null
  readonly recordCount: number
  /** 拒绝子因（allow 恒 null） */
  readonly subcause: string | null
  readonly at: string
}

/**
 * 读面拒绝（v2/14 §0.2-1：越权＝Err，**不得** Ok(undefined) 冒充「无行」）。
 * 照 store/readonly.ts 先例补处置轴 `failure`（契约 `ClassifiedError` 现无此字段——不改契约形状，
 * docs/80 TS-SCALAR-10：观测轴 ErrorCategory 与处置轴 FailureClass 不得合并）：
 * `category`＝观测轴（CONFIG_INVALID，与 taiga auth-rejected 同口径），`failure`＝处置轴
 * （缺证=rejected_precondition；越权/空字段集=rejected_forbidden）。
 */
export interface HistReadDenial extends ClassifiedError {
  readonly failure: FailureCategory
}

/** 读面拒绝规格（校验纯函数的返回；`null`＝通过） */
export interface HistReadDenialSpec {
  readonly subcause: string
  readonly failure: FailureCategory
  readonly detail: string
}

/** 调用者三分（v2/11 REC-MEM-02.who 同轴；值集唯一源=contract CallerKind） */
const CALLER_KINDS: readonly CallerKind[] = ['employment', 'position', 'program']

/**
 * 读上下文校验（纯函数；`null`＝通过）。
 * 缺省、readScope 缺、公司维缺/畸形、可见字段空集/畸形、用途缺、调用者缺/畸形——一律拒。
 */
export function readContextDenial(rc: ReadContext | undefined): HistReadDenialSpec | null {
  if (rc === undefined || rc === null || typeof rc !== 'object') {
    return {
      subcause: 'store/hist:read-context-missing',
      failure: 'rejected_precondition',
      detail: '读方法必带 ReadContext（v2/14 §0.2-1：缺省＝拒，不得按「无行」处理）',
    }
  }
  const scope = (rc as { readScope?: unknown }).readScope
  if (scope === undefined || scope === null || typeof scope !== 'object') {
    return {
      subcause: 'store/hist:read-scope-missing',
      failure: 'rejected_precondition',
      detail: 'ReadContext.readScope 必带（读面范围不是可选项——v2/15 §五 SEC-RD-01）',
    }
  }
  const company = (scope as { company?: unknown }).company
  if (company === undefined || company === null || typeof company !== 'object') {
    return {
      subcause: 'store/hist:read-scope-company-missing',
      failure: 'rejected_precondition',
      detail: 'ReadScope.company 必带（多公司视图按公司维隔离——SEC-WD-01）',
    }
  }
  const companyId = (company as { companyId?: unknown }).companyId
  const slug = (company as { slug?: unknown }).slug
  if (typeof companyId !== 'string' || companyId.trim() === '' || typeof slug !== 'string' || slug.trim() === '') {
    return {
      subcause: 'store/hist:read-scope-company-invalid',
      failure: 'rejected_precondition',
      detail: 'ReadScope.company 须为 {companyId, slug} 非空串（公司维缺失/畸形＝拒）',
    }
  }
  const fields = (scope as { fields?: unknown }).fields
  if (!Array.isArray(fields) || fields.length === 0 || fields.some((field) => typeof field !== 'string' || field.trim() === '')) {
    return {
      subcause: 'store/hist:read-scope-fields-invalid',
      failure: 'rejected_forbidden',
      detail: 'ReadScope.fields 必须是非空字符串数组（空集＝越权→拒，不得 Ok(undefined) 冒充无行）',
    }
  }
  const purpose = (scope as { purpose?: unknown }).purpose
  if (typeof purpose !== 'string' || purpose.trim() === '') {
    return {
      subcause: 'store/hist:read-purpose-missing',
      failure: 'rejected_precondition',
      detail: 'ReadScope.purpose 必带（读面须说明用途，审计面才可判读「范围依据」）',
    }
  }
  const caller = (rc as { caller?: unknown }).caller
  if (caller === undefined || caller === null || typeof caller !== 'object') {
    return {
      subcause: 'store/hist:read-caller-missing',
      failure: 'rejected_precondition',
      detail: 'ReadContext.caller 必带（无调用者＝拒）',
    }
  }
  const callerId = (caller as { callerId?: unknown }).callerId
  if (typeof callerId !== 'string' || callerId.trim() === '') {
    return {
      subcause: 'store/hist:read-caller-missing',
      failure: 'rejected_precondition',
      detail: 'ReadContext.caller.callerId 必带（无调用者＝拒）',
    }
  }
  const kind = (caller as { kind?: unknown }).kind
  if (typeof kind !== 'string' || !CALLER_KINDS.includes(kind as CallerKind)) {
    return {
      subcause: 'store/hist:read-caller-kind-invalid',
      failure: 'rejected_precondition',
      detail: `ReadContext.caller.kind 须为 ${CALLER_KINDS.join('|')}（实得 ${String(kind)}）`,
    }
  }
  return null
}

/** 公司维是否在知悉范围内（companyId/slug 任一命中即同维——assembly/api/readers.ts 同口径） */
export function companyInReadScope(rc: ReadContext, companyRef: string): boolean {
  const { companyId, slug } = rc.readScope.company
  return companyRef === companyId || companyRef === slug
}

/** 读面拒绝 → 抛 ClassifiedError 形状 Error（附处置轴 failure；不改契约形状） */
export function readDenied(denial: HistReadDenialSpec): never {
  const err = new Error(`CONFIG_INVALID/${denial.subcause}：${denial.detail}`) as Error & {
    category: ClassifiedError['category']
    subcause: string
    detail?: string
    failure: FailureCategory
  }
  err.category = 'CONFIG_INVALID'
  err.subcause = denial.subcause
  err.detail = denial.detail
  err.failure = denial.failure
  throw err
}

/** 读面闸（createHistFace 持有；四读法共用同一闸与同一审计面） */
export interface HistReadGuards {
  /** 审计行发射（allow/deny 都记；钩子抛错上抛） */
  emit(method: HistReadMethod, decision: 'allow' | 'deny', rc: ReadContext | undefined, recordCount: number, subcause: string | null): void
  /** 读上下文闸：缺省/畸形＝拒（先记审计再抛） */
  requireReadContext(method: HistReadMethod, rc: ReadContext): ReadContext
  /** 公司维闸：越权＝拒（不泄漏记录存在性/内容） */
  requireCompanyInScope(method: HistReadMethod, rc: ReadContext, companyRef: string): void
  /** 读执行＋审计（坏行/解码失败也留痕：deny＋实际 subcause） */
  auditedRead<T>(method: HistReadMethod, ctx: ReadContext, run: () => T, size: (value: T) => number): T
}

/** 读面闸工厂（时钟注入用于审计 `at`；onRead 缺省＝不落审计行，闸行为不变） */
export function createHistReadGuards(options: { readonly now: () => number; readonly onRead?: (audit: HistReadAudit) => void }): HistReadGuards {
  const auditSink = options.onRead

  const emit: HistReadGuards['emit'] = (method, decision, rc, recordCount, subcause) => {
    if (auditSink === undefined) return
    const bag = (rc ?? {}) as {
      readScope?: { company?: { companyId?: unknown; slug?: unknown }; fields?: unknown; purpose?: unknown }
      caller?: { callerId?: unknown; kind?: unknown }
    }
    const scope = bag.readScope
    const caller = bag.caller
    const company = scope?.company
    const companyId = typeof company?.companyId === 'string' ? company.companyId : ''
    const slug = typeof company?.slug === 'string' ? company.slug : ''
    const kind = caller?.kind
    auditSink({
      method,
      decision,
      callerId: typeof caller?.callerId === 'string' && caller.callerId !== '' ? caller.callerId : null,
      callerKind: typeof kind === 'string' && CALLER_KINDS.includes(kind as CallerKind) ? (kind as CallerKind) : null,
      company: companyId === '' && slug === '' ? null : `${companyId}/${slug}`,
      fields: Array.isArray(scope?.fields) ? scope.fields.filter((field): field is string => typeof field === 'string') : [],
      purpose: typeof scope?.purpose === 'string' ? scope.purpose : null,
      recordCount,
      subcause,
      at: isoTimestamp(options.now()),
    })
  }

  const requireReadContext: HistReadGuards['requireReadContext'] = (method, rc) => {
    const denial = readContextDenial(rc)
    if (denial !== null) {
      emit(method, 'deny', rc, 0, denial.subcause)
      throw readDenied(denial)
    }
    return rc
  }

  const requireCompanyInScope: HistReadGuards['requireCompanyInScope'] = (method, rc, companyRef) => {
    if (companyInReadScope(rc, companyRef)) return
    emit(method, 'deny', rc, 0, 'store/hist:read-forbidden')
    throw readDenied({
      subcause: 'store/hist:read-forbidden',
      failure: 'rejected_forbidden',
      detail: `越权读：调用者 ${rc.caller.callerId}（${rc.caller.kind}）的知悉范围 ${rc.readScope.company.companyId}/${rc.readScope.company.slug} 不含公司 ${companyRef}（purpose=${rc.readScope.purpose}；拒，不泄漏记录存在性与内容）`,
    })
  }

  const auditedRead: HistReadGuards['auditedRead'] = <T>(method: HistReadMethod, ctx: ReadContext, run: () => T, size: (value: T) => number): T => {
    try {
      const value = run()
      emit(method, 'allow', ctx, size(value), null)
      return value
    } catch (error) {
      const subcause = (error as { subcause?: unknown }).subcause
      emit(method, 'deny', ctx, 0, typeof subcause === 'string' ? subcause : 'store/hist:read-failed')
      throw error
    }
  }

  return { emit, requireReadContext, requireCompanyInScope, auditedRead }
}
