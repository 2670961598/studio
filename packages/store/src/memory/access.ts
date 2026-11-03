/**
 * memory-access —— PORT-HIST 记忆访问审计面（REC-MEM-02）：读/写留痕＋scope 精确等值＋fail-closed
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/08 §3.3（访问留痕与使用限制：每次访问留审计痕——谁（任职/位置/程序）、何时、
 *     为何目的、读了哪域哪些条、用到哪件工作或决定、授权依据与到期；只统计读取次数或命中率
 *     不算访问记录；知悉范围变化须重新审批）；§三（三域唯一主表）；§3.2（文件读写不是处置授权）
 *   - docs/v2/11 §十三（REC-MEM-02 字段与不变量：每次访问留痕、访问被拒也是审计事件 ENU-66、
 *     知悉范围变化须重新审批）；§〇（记录信封）/§0.5（生效槽）；§十五-1（引用完整性：审计引用不得悬空）
 *   - docs/v2/14 §0.2-1（读面缺省＝拒：越权返回 Err，不得以 Ok(undefined) 冒充「无行」）／
 *     §1.6（PORT-HIST memoryWrite/memoryAuditAccess 签名；记录唯一写口）
 *   - docs/v2/17 NEG-REC-13（MEM 族负向面）；docs/v2/16 DISP-03（新增件须回指 v2/05–08/10/11 的 ID）
 *   - docs/17-§2（本面不新增主循环相位、零墙钟依赖，由调用点触发）／§6（不改收割四要件链）
 *
 * 形状唯一源＝contract：REC-MEM-02 payload 一律经 `validateMemoryAccessAudit`（mem.ts）判，
 * 本文件零字段表、零枚举重述；写入仍经 PORT-HIST 唯一写口 `hist.append`（不新增记录类/端口，
 * 74 类/20 端口不变）。底层读面复用 `hist.get/hist.memory`（scope 精确等值、不自动继承）。
 *
 * 访问控制语义（本单交付面）：
 *   - **scope 精确等值**：`query.scope` 须与调用方 `ctx.scope` 逐字节相等；条目 `owner_scope`
 *     命中亦按精确等值——父/子/前缀 scope 一律拒（继承只能经 REC-MEM-03 显式凭证）；
 *   - **fail-closed**：上下文缺项＝构造期拒（不签审计白条）；授权依据悬空/跨公司/到期、越权读
 *     ＝拒，且**先落 denied 审计再抛**（访问被拒也是审计事件）；
 *   - **审计不可缺**：读面审计写失败＝不返回条目；写面 REC-MEM-01 与 REC-MEM-02 显式同事务
 *     ——审计失败＝整体回滚，不留无审计的记忆条目。
 *
 * 边界（如实登记，不冒充已闭合）：
 *   1. 授权链实体效力归 PORT-AUTH（v2/14 §0.2：权源校验唯一经 PORT-AUTH）——本面只做三项机械
 *      检查：`basis_ref` 可解析到本公司在册记录、未到期、scope 精确等值；不判授予实体是否成立；
 *   2. REC-MEM-02 `layer_and_entries.entry_refs` 契约面 min 1（mem.ts）→ **零条目访问无法成证**：
 *      空扫描/无可引用条目的拒绝请求一律 fail-closed 拒（store/hist:memory-access-no-entries），
 *      不伪造引用、不写空白审计——契约面缺口登记于本单 plan/REPORT（不改契约）；
 *   3. 被拒写入不落 REC-MEM-02：目标条目尚未写入（entry_refs 无可引用条目）且无记忆内容暴露，
 *      拒绝即零副作用失败；该尝试的留痕归调用方错误面（不伪造悬空引用冒充审计）；
 *   4. `partial_provided`（ENU-66）本面不产生（单 scope 单次访问不混合授权面），保留给分批访问刀。
 */
import { configInvalid, type MemoryDomain } from '@studio-next/contract'
import {
  RECORD_TYPE_VERSION_INITIAL,
  type ObjectRef,
  type RecordRef,
} from '../../../contract/src/records/envelope.ts'
import {
  MEMORY_DOMAINS,
  validateMemoryAccessAudit,
  type MemoryAccessAuditPayload,
} from '../../../contract/src/records/mem.ts'
import type { HistFace, HistRecord, HistRecordRef, HistTx } from '../hist.ts'

/** 冻结 schema 工件引用（v2/10 §4.1；与 assembly/ops/envelope.ts 仓库内统一口径） */
export const MEMORY_ACCESS_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与 packages/contract/src/artifacts/generate.ts SPEC_VERSION 同值） */
export const MEMORY_ACCESS_SPEC_VERSION = '2.0.0'

/** 记忆访问审计的 proofBoundary（§0.7：证明什么/不证明什么——不以「已记录」一句覆盖） */
export const MEMORY_ACCESS_PROOF_BOUNDARY =
  '本记录证明一次记忆访问已按 REC-MEM-02 留痕（主体/时刻/用途/条目/授权依据/结果；访问被拒亦留痕）；' +
  '不证明授权链实体效力（权源解析归 PORT-AUTH，v2/14 §0.2），亦不证明被访问条目内容为真（记忆是历史派生物非证据——v2/01 §一）'

/** 访问主体（REC-MEM-02 `who`：任职/位置/程序三者分开，至少一项非空——§十三） */
export interface MemoryAccessWho {
  readonly holderRef: ObjectRef | null
  readonly positionRef: ObjectRef | null
  readonly procedureRef: ObjectRef | null
}

/**
 * 访问上下文（ReadContext 的记录面投影；scope 由运行时经 PORT-AUTH 解析后注入：
 * 本面不做权源实体判定，只判精确等值与留痕完整性）。
 */
export interface MemoryAccessContext {
  /** 调用方知悉范围（精确等值；不自动继承——继承只能经 REC-MEM-03 显式凭证） */
  readonly scope: string
  readonly who: MemoryAccessWho
  readonly purpose: {
    readonly why: string
    readonly forWorkOrDecisionRef: RecordRef
  }
  /** 授权依据与到期（basis_ref 须可解析到本公司在册记录，否则＝缺证拒） */
  readonly authority: {
    readonly basisRef: RecordRef
    readonly expiresAt: string
  }
  /** 访问时刻（缺省＝注入时钟；审计 when 同源） */
  readonly when?: string
  /** 知悉范围变化须重新审批（scope_change 必载审批引用——§十三） */
  readonly scopeChange?: {
    readonly newScope: string
    readonly reapprovalRef: RecordRef
  }
}

/** 记忆读请求（定向优先；省略 entryRefs 时＝按 scope 扫描，须给 domain） */
export interface MemoryReadQuery {
  readonly company: string
  /** 目标 owner_scope（须与 ctx.scope 精确等值） */
  readonly scope: string
  /** 记忆三域（扫描模式必填；定向模式可省，取条目自身域且须一致） */
  readonly domain?: MemoryDomain
  /** 定向读取的条目引用（REC-MEM-01）；省略＝按 scope 扫描 */
  readonly entryRefs?: readonly RecordRef[]
}

/** 记忆读回执（entries＝本次实际提供条目；audit＝本次 REC-MEM-02 记录引用） */
export interface MemoryReadResult {
  readonly entries: readonly HistRecord[]
  readonly audit: HistRecordRef
}

/** 直接落审计的输入（供其他端口把自己的访问留痕收口到同一写口） */
export interface MemoryAuditDraft {
  readonly company: string
  readonly payload: MemoryAccessAuditPayload
}

/** 记忆访问面（PORT-HIST 记忆子面；底层读写仍经唯一记录写口） */
export interface MemoryAccessFace {
  /** 读记忆（每次一条 REC-MEM-02；越权/缺证/到期＝denied 留痕后拒） */
  read(query: MemoryReadQuery, ctx: MemoryAccessContext): MemoryReadResult
  /** 写记忆条目（REC-MEM-01 与 REC-MEM-02 显式同事务——审计不可缺） */
  write(record: unknown, ctx: MemoryAccessContext): HistRecordRef
  /** 直接落 REC-MEM-02（条目引用须可解析到本公司在册 REC-MEM-01——悬空即拒） */
  auditAccess(draft: MemoryAuditDraft): HistRecordRef
}

/** 面工厂选项（makeId/now 全注入：不读墙钟、不造随机，测试可复现） */
export interface MemoryAccessFaceOptions {
  readonly makeId: () => string
  readonly now?: () => number
  /** 写入路径名（producer.writtenBy；生产＝装配面名，测试＝'test'） */
  readonly writtenBy?: string
}

/** 缺省写入路径（写路径与具名决定者分开——v2/11 §0.2-1） */
export const MEMORY_ACCESS_WRITTEN_BY = 'store:memory-access'

/** 授权机械检查的拒绝形（subcause/detail 由 configInvalid 抛出） */
interface AccessDenial {
  readonly subcause: string
  readonly detail: string
}

function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString()
}

function requireText(value: unknown, subcause: string, detail: string): string {
  if (typeof value !== 'string' || value.trim() === '') configInvalid(subcause, detail)
  return value
}

/** 记录引用（ID＋类型版本；身份一经分配不复用——§0.4-1） */
function refOf(record: HistRecord): RecordRef {
  return { refType: record.recordType, refId: record.recordId, refVersion: RECORD_TYPE_VERSION_INITIAL }
}

/** 条目记忆域（contract 已判形；此处防御性收窄，坏行 fail-closed） */
function domainOf(record: HistRecord): MemoryDomain {
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) {
    configInvalid('store/hist:memory-entry-payload', `条目 ${record.recordId} payload 非对象（读面不得冒充可用记忆）`)
  }
  const domain = (payload as { domain?: unknown }).domain
  if (typeof domain !== 'string' || !(MEMORY_DOMAINS as readonly string[]).includes(domain)) {
    configInvalid('store/hist:memory-entry-domain', `条目 ${record.recordId} 域不在 ENU-63 三域内`)
  }
  return domain as MemoryDomain
}

/** 条目 owner_scope（scope 精确等值的比较面） */
function ownerScopeOf(record: HistRecord): string {
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) {
    configInvalid('store/hist:memory-entry-payload', `条目 ${record.recordId} payload 非对象`)
  }
  const scope = (payload as { owner_scope?: unknown }).owner_scope
  if (typeof scope !== 'string' || scope.trim() === '') {
    configInvalid('store/hist:memory-entry-scope-missing', `条目 ${record.recordId} 缺 owner_scope（scope 精确等值无可判依据）`)
  }
  return scope
}

/** 待写条目的 owner_scope（disposition 前先判，避免写后才发现越权） */
function ownerScopeOfDraft(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const payload = (record as { payload?: unknown }).payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const scope = (payload as { owner_scope?: unknown }).owner_scope
  return typeof scope === 'string' ? scope : undefined
}

/** 具名决定者：who 三分取首个非空引用（审计不得匿名——§0.2-1） */
function decidedByOf(ctx: MemoryAccessContext): string {
  const id = ctx.who.holderRef?.refId ?? ctx.who.positionRef?.refId ?? ctx.who.procedureRef?.refId
  if (id === undefined) configInvalid('store/hist:memory-access-incomplete', '访问主体缺项：任职/位置/程序至少一项（REC-MEM-02.who——§十三）')
  return id
}

/**
 * v14 记录面工厂之外的记忆访问面工厂：`hist` 须已是迁移完成的唯一记录写口。
 * 只增访问留痕与访问控制，不改 hist 的读写语义（append/get/memory 原样复用）。
 */
export function createMemoryAccessFace(hist: HistFace, options: MemoryAccessFaceOptions): MemoryAccessFace {
  const clock = options.now ?? (() => Date.now())
  const writtenBy = options.writtenBy ?? MEMORY_ACCESS_WRITTEN_BY

  /** 上下文完整性与可判性（缺项＝构造期拒：不签审计白条，不留半条记录） */
  const assertAccessContext = (ctx: MemoryAccessContext): void => {
    requireText(ctx.scope, 'store/hist:memory-access-incomplete', '访问范围 scope 缺失/空（知悉范围必填——v2/08 §3.3）')
    if (typeof ctx.who !== 'object' || ctx.who === null) {
      configInvalid('store/hist:memory-access-incomplete', '访问主体 who 缺失（任职/位置/程序三者分开——§十三）')
    }
    if (typeof ctx.purpose !== 'object' || ctx.purpose === null) {
      configInvalid('store/hist:memory-access-incomplete', '访问用途 purpose 缺失（每次访问须载目的——§3.3）')
    }
    if (typeof ctx.authority !== 'object' || ctx.authority === null) {
      configInvalid('store/hist:memory-access-incomplete', '授权依据 authority 缺失（须载依据与到期——§3.3）')
    }
    const who = ctx.who
    if (who.holderRef == null && who.positionRef == null && who.procedureRef == null) {
      configInvalid('store/hist:memory-access-incomplete', '访问主体缺项：任职/位置/程序至少一项（REC-MEM-02.who——§十三）')
    }
    requireText(ctx.purpose.why, 'store/hist:memory-access-incomplete', '访问用途 why 缺失/空（每次访问须载目的——§3.3）')
    if (ctx.purpose.forWorkOrDecisionRef == null) {
      configInvalid('store/hist:memory-access-incomplete', '访问用途须指向具体工作或决定（purpose.for_work_or_decision_ref——§3.3）')
    }
    if (ctx.authority.basisRef == null) {
      configInvalid('store/hist:memory-access-incomplete', '授权依据 basis_ref 缺失（访问须可追溯授权依据与到期——§3.3）')
    }
    if (typeof ctx.authority.expiresAt !== 'string' || Number.isNaN(Date.parse(ctx.authority.expiresAt))) {
      configInvalid('store/hist:memory-access-incomplete', `授权到期 expires_at 非法：${String(ctx.authority.expiresAt)}（须带偏移 timestamp）`)
    }
    if (ctx.when !== undefined && Number.isNaN(Date.parse(ctx.when))) {
      configInvalid('store/hist:memory-access-incomplete', `访问时刻 when 非法：${ctx.when}`)
    }
  }

  const assertReadQuery = (query: MemoryReadQuery): void => {
    requireText(query.company, 'store/hist:memory-company-missing', 'memory 读须给 company（多公司部署读面必带公司维——SEC-WD-01）')
    requireText(query.scope, 'store/hist:memory-scope-empty', 'memory scope 不得为空（按 scope 精确读，不自动继承）')
  }

  /** 条目引用解析（定向读取；不存在/非记忆/跨公司＝拒，不冒充「无行」——§0.2-1） */
  const resolveEntry = (recordId: string, company: string): HistRecord => {
    const record = hist.get(recordId)
    if (record === undefined) {
      configInvalid('store/hist:memory-entry-missing', `条目 ${recordId} 权威确认不存在（不得冒充「无记忆」）`)
    }
    if (record.recordType !== 'REC-MEM-01') {
      configInvalid('store/hist:memory-entry-not-memory', `引用 ${recordId} 为 ${record.recordType}，非 REC-MEM-01（访问台账只收记忆条目）`)
    }
    if (record.companyRef !== company) {
      configInvalid('store/hist:memory-entry-foreign-company', `条目 ${recordId} 属公司 ${record.companyRef}，非 ${company}（跨公司读＝越权）`)
    }
    return record
  }

  /** 授权机械检查：依据在册（同公司）＋未到期＋scope 精确等值＋条目 scope 等值 */
  const accessDenialOf = (
    ctx: MemoryAccessContext,
    when: string,
    company: string,
    targetScope: string,
    entries: readonly HistRecord[],
  ): AccessDenial | undefined => {
    const basis = hist.get(ctx.authority.basisRef.refId)
    if (basis === undefined) {
      return {
        subcause: 'store/hist:memory-authority-missing',
        detail: `授权依据 ${ctx.authority.basisRef.refId} 不在册（悬空引用＝缺证，§十五-1——fail-closed）`,
      }
    }
    if (basis.companyRef !== company) {
      return {
        subcause: 'store/hist:memory-authority-foreign-company',
        detail: `授权依据 ${ctx.authority.basisRef.refId} 属公司 ${basis.companyRef}，非 ${company}（跨公司授权无效）`,
      }
    }
    if (!(Date.parse(ctx.authority.expiresAt) > Date.parse(when))) {
      return {
        subcause: 'store/hist:memory-authority-expired',
        detail: `授权于 ${ctx.authority.expiresAt} 到期（访问时刻 ${when}）——到期即拒，不自动续期`,
      }
    }
    if (targetScope !== ctx.scope) {
      return {
        subcause: 'store/hist:memory-scope-denied',
        detail: `访问范围须精确等值：请求 scope=${targetScope} ≠ 调用方 scope=${ctx.scope}（不自动继承——v2/08 §3.3；继承只能经 REC-MEM-03 显式凭证）`,
      }
    }
    for (const entry of entries) {
      if (ownerScopeOf(entry) !== targetScope) {
        return {
          subcause: 'store/hist:memory-entry-scope-denied',
          detail: `条目 ${entry.recordId} owner_scope=${ownerScopeOf(entry)} ≠ 请求 scope=${targetScope}（越权读＝拒）`,
        }
      }
    }
    return undefined
  }

  /** REC-MEM-02 payload（who/when/purpose/layer_and_entries/authority_ref/result[/scope_change]） */
  const auditPayloadOf = (
    ctx: MemoryAccessContext,
    when: string,
    domain: MemoryDomain,
    entryRefs: readonly RecordRef[],
    result: 'provided' | 'denied',
  ): MemoryAccessAuditPayload => ({
    who: {
      holder_ref: ctx.who.holderRef,
      position_ref: ctx.who.positionRef,
      procedure_ref: ctx.who.procedureRef,
    },
    when,
    purpose: { why: ctx.purpose.why, for_work_or_decision_ref: ctx.purpose.forWorkOrDecisionRef },
    layer_and_entries: { domain, entry_refs: [...entryRefs] },
    authority_ref: { basis_ref: ctx.authority.basisRef, expires_at: ctx.authority.expiresAt },
    result,
    ...(ctx.scopeChange === undefined
      ? {}
      : { scope_change: { new_scope: ctx.scopeChange.newScope, reapproval_ref: ctx.scopeChange.reapprovalRef } }),
  })

  /** 信封＋contract 判定（形状唯一源；不合法即拒，不静默降级） */
  const auditEnvelope = (payload: MemoryAccessAuditPayload, company: string, decidedBy: string): unknown => {
    const record = {
      recordId: options.makeId(),
      recordType: 'REC-MEM-02',
      schemaRef: MEMORY_ACCESS_SCHEMA_REF,
      specVersion: MEMORY_ACCESS_SPEC_VERSION,
      companyRef: company,
      producedAt: payload.when,
      producer: { decidedBy, writtenBy },
      basisRefs: [],
      payload,
      effectiveState: 'effective',
      effectiveTime: { from: payload.when },
      proofBoundary: MEMORY_ACCESS_PROOF_BOUNDARY,
    }
    const outcome = validateMemoryAccessAudit(record)
    if (!outcome.ok) {
      const first = outcome.issues[0]
      configInvalid(`store/hist:memory-audit-invalid:${first?.path ?? '(root)'}`, first?.message)
    }
    return record
  }

  /** 审计条目引用完整性（§十五-1：审计不得引悬空/跨公司/非记忆记录） */
  const assertAuditEntries = (entryRefs: readonly RecordRef[], company: string): void => {
    for (const ref of entryRefs) {
      const record = hist.get(ref.refId)
      if (record === undefined) {
        configInvalid('store/hist:memory-audit-entry-missing', `审计引用条目 ${ref.refId} 不存在（引用悬空＝缺证——§十五-1）`)
      }
      if (record.recordType !== 'REC-MEM-01') {
        configInvalid('store/hist:memory-audit-entry-invalid', `审计引用 ${ref.refId} 为 ${record.recordType}，非 REC-MEM-01`)
      }
      if (record.companyRef !== company) {
        configInvalid('store/hist:memory-audit-entry-foreign-company', `审计引用条目 ${ref.refId} 属公司 ${record.companyRef}，非 ${company}`)
      }
    }
  }

  /** 审计落库（同事务优先：写面审计与条目同 tx；读面独立提交） */
  const appendAudit = (
    payload: MemoryAccessAuditPayload,
    company: string,
    decidedBy: string,
    tx: HistTx | undefined,
  ): HistRecordRef => {
    assertAuditEntries(payload.layer_and_entries.entry_refs, company)
    const record = auditEnvelope(payload, company, decidedBy)
    return tx === undefined ? hist.append(record) : hist.append(record, tx)
  }

  const read = (query: MemoryReadQuery, ctx: MemoryAccessContext): MemoryReadResult => {
    assertReadQuery(query)
    assertAccessContext(ctx)
    const when = ctx.when ?? isoTimestamp(clock())
    const targeted = query.entryRefs !== undefined
    let entries: HistRecord[]
    if (targeted) {
      const refs = query.entryRefs ?? []
      if (refs.length === 0) {
        configInvalid('store/hist:memory-access-no-entries', '定向读取须至少一条条目引用（REC-MEM-02 entry_refs min 1——零条目不成证）')
      }
      entries = refs.map((ref) => resolveEntry(ref.refId, query.company))
    } else {
      if (query.domain === undefined) {
        configInvalid('store/hist:memory-domain-required', '扫描读取必填 domain（REC-MEM-02 layer_and_entries 单域——§十三）')
      }
      entries = hist.memory({ company: query.company, scope: query.scope, domain: query.domain })
    }
    if (entries.length === 0) {
      configInvalid(
        'store/hist:memory-access-no-entries',
        `scope=${query.scope} 下无条目可审计（REC-MEM-02 entry_refs min 1）——fail-closed：不返回空列表冒充「已访问」，不签审计白条`,
      )
    }
    const domains = new Set(entries.map(domainOf))
    const firstDomain = domains.values().next().value
    if (firstDomain === undefined) {
      configInvalid('store/hist:memory-domain-missing', '访问条目无记忆域（坏行 fail-closed）')
    }
    const entryRefs = entries.map(refOf)
    const denial = accessDenialOf(ctx, when, query.company, query.scope, entries)
    if (denial !== undefined) {
      // 访问被拒也是审计事件（ENU-66）：先落 denied 留痕，再 fail-closed 抛。
      // 拒绝记录取「请求域 > 首条目域」作单域槽（域一致性回调用方错误面判，不在被拒时混入提供结果）。
      appendAudit(
        auditPayloadOf(ctx, when, query.domain ?? firstDomain, entryRefs, 'denied'),
        query.company,
        decidedByOf(ctx),
        undefined,
      )
      configInvalid(denial.subcause, denial.detail)
    }
    if (domains.size !== 1) {
      configInvalid('store/hist:memory-domain-mixed', '同次访问条目跨记忆域（REC-MEM-02 单域——§十三）；按域分批访问')
    }
    if (query.domain !== undefined && firstDomain !== query.domain) {
      configInvalid('store/hist:memory-domain-mismatch', `请求域 ${query.domain} 与条目域 ${firstDomain} 不一致`)
    }
    const audit = appendAudit(auditPayloadOf(ctx, when, firstDomain, entryRefs, 'provided'), query.company, decidedByOf(ctx), undefined)
    return { entries, audit }
  }

  const write = (record: unknown, ctx: MemoryAccessContext): HistRecordRef => {
    assertAccessContext(ctx)
    if (typeof record !== 'object' || record === null) {
      configInvalid('store/hist:memory-entry-not-object', '记忆写入须携完整记录信封（contract REC-MEM-01——不接裸 payload）')
    }
    const company = requireText(
      (record as { companyRef?: unknown }).companyRef,
      'store/hist:memory-company-missing',
      '记忆写入须给 companyRef（多公司部署写面必带公司维——SEC-WD-01）',
    )
    const draftScope = ownerScopeOfDraft(record)
    if (draftScope === undefined) {
      configInvalid('store/hist:memory-entry-scope-missing', '待写条目缺 payload.owner_scope（scope 精确等值无可判依据）')
    }
    if (draftScope !== ctx.scope) {
      configInvalid(
        'store/hist:memory-scope-denied',
        `写入范围须精确等值：条目 owner_scope=${draftScope} ≠ 调用方 scope=${ctx.scope}（越权写＝拒）`,
      )
    }
    const when = ctx.when ?? isoTimestamp(clock())
    const denial = accessDenialOf(ctx, when, company, draftScope, [])
    if (denial !== undefined) configInvalid(denial.subcause, denial.detail)
    const tx = hist.begin()
    try {
      const entryRef = hist.append(record, tx)
      const stored = hist.get(entryRef.recordId)
      if (stored === undefined) {
        configInvalid('store/hist:memory-entry-unreadable', `写入条目 ${entryRef.recordId} 同事务内不可回读（不落无审计记忆）`)
      }
      if (ownerScopeOf(stored) !== ctx.scope) {
        configInvalid('store/hist:memory-scope-denied', `写入条目 owner_scope=${ownerScopeOf(stored)} ≠ 调用方 scope=${ctx.scope}`)
      }
      appendAudit(auditPayloadOf(ctx, when, domainOf(stored), [refOf(stored)], 'provided'), company, decidedByOf(ctx), tx)
      hist.commit(tx)
      return entryRef
    } catch (error) {
      if (tx.open) {
        try {
          hist.abort(tx)
        } catch {
          // 原始错误优先：回滚失败不得覆盖写入失败/审计缺证的判负原因
        }
      }
      throw error
    }
  }

  const auditAccess = (draft: MemoryAuditDraft): HistRecordRef => {
    requireText(draft.company, 'store/hist:memory-company-missing', '审计记录须给 company（多公司部署写面必带公司维——SEC-WD-01）')
    const who = draft.payload.who
    const decidedBy = who.holder_ref?.refId ?? who.position_ref?.refId ?? who.procedure_ref?.refId
    if (decidedBy === undefined) {
      configInvalid('store/hist:memory-access-incomplete', '访问主体缺项：任职/位置/程序至少一项（REC-MEM-02.who——§十三）')
    }
    return appendAudit(draft.payload, draft.company, decidedBy, undefined)
  }

  return { read, write, auditAccess }
}
