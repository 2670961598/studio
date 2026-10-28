/**
 * createLocalPlatform —— FlowPlatform 端口的 LocalFile 实现组装（docs/23、docs/25-§3.2）。
 *
 * 构造器注入根目录；实例无内状态（一切状态在盘上），同根多实例互通。
 * 时钟可注入（确定性回放/测试用）；activity 分页大小可注入（默认 100）。
 *
 * IMPL-07-03（v2/12 §2.2/§2.3；v2/14 §八）追加两面：
 *   - **读口**（本件末段）：404/缺省读口从「一律 Ok(undefined)」改为「**仅平台权威确认
 *     不存在**」⇒ Ok(undefined)；越权/不可确认（盘读失败、事件流损坏）＝Err，不冒充不存在；
 *     读上下文缺省＝拒。
 *   - **状态映射表视图**：唯一源＝`./binding.ts` 的绑定档案（本件只转引，不持有第二张表）。
 */
import type {
  ActivityPage,
  ClassifiedError,
  Comment,
  CompanySlug,
  FieldProvisionMap,
  FieldSchema,
  FlowPlatform,
  GuardRule,
  IssueCreate,
  IssueQuery,
  IssueRecord,
  KbHit,
  LinkType,
  PlatformRole,
  ReadContext,
  ReadScope,
  Result,
  SignedBody,
  TicketId,
} from '@studio-next/contract'
import { bindingProfile, mapState, type StateMapping, type StateMappingRow } from './binding.ts'
import { DEFAULT_PAGE_SIZE, activitySince } from './activity.ts'
import { addComment, listComments } from './comments.ts'
import { LocalPlatformError } from './errors.ts'
import { installGuards, readGuardRoles, uninstallGuards } from './guards.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { ensureDir } from './fsutil.ts'
import { createIssue, getIssue, listIssues, setIssueField, transitionIssue } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { issuesDir, kbRoot, metaDir } from './layout.ts'
import { addLink, childTickets } from './links.ts'

export interface LocalPlatformOptions {
  /** 时钟注入：默认 new Date().toISOString()；确定性回放注入固定步进时钟 */
  now?: () => string
  /** activity 分页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function defaultNow(): string {
  return new Date().toISOString()
}

export function createLocalPlatform(root: string, opts?: LocalPlatformOptions): FlowPlatform {
  const now = opts?.now ?? defaultNow
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
  ensureDir(issuesDir(root))
  ensureDir(kbRoot(root))
  ensureDir(metaDir(root))
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(root, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return getIssue(root, id)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(root, now, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(root, now, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        setIssueField(root, now, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        addComment(root, now, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(root, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(root)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        provisionFields(root, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        kbUpsert(root, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(root, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(root, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(root, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        addLink(root, now, a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return childTickets(root, id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        installGuards(root, company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        uninstallGuards(root, company)
      },
      async read(company: CompanySlug): Promise<PlatformRole[]> {
        return readGuardRoles(root, company)
      },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 读口（IMPL-07-03；v2/14 §0.2-1 读面缺省＝拒；L3-J-P0-01；L3O-04 平台 404 单一口径）
//
// 口径（LocalFile 也同规：**读不到 ≠ 没有**）：
//   - **仅平台权威确认不存在**（单据文件不存在 ⇒ `issue-not-found`）⇒ Ok(undefined)；
//   - 越权（读上下文/可见字段不合法）、不可确认（盘读失败/事件流损坏/非适配器异常）⇒ Err，
//     **不得**用 Ok(undefined) 把「读不出来」伪装成「本来就没有这张单」（80-§6.3/§8.2、D21）；
//   - 读上下文缺省/畸形 ⇒ Err（读方法必带 `ReadContext`；可见字段空集＝越权→拒）。
// 本读口不改 FlowPlatform 签名（契约冻结，cases C-plat-007 口径不变）：它是适配器侧的判定面。
// ─────────────────────────────────────────────────────────────────────────────

/** 权威「不存在」的唯一标记：本实现对「单据文件不存在」的收口 subcause。其余 subcause 一律 Err */
const AUTHORITATIVE_ABSENT = 'issue-not-found'

/**
 * 读上下文校验（v2/14 §0.2-1）：`null`＝通过；否则 Err。
 * 缺省、readScope 缺失、可见字段空集/畸形、调用者缺失——全部 fail-closed。
 */
export function readContextDenial(ctx: ReadContext | undefined): ClassifiedError | null {
  if (!ctx) {
    return {
      category: 'CONFIG_INVALID',
      subcause: 'read-context-missing',
      detail: '读方法必带 ReadContext（v2/14 §0.2-1：缺省＝拒，不得按「无行」处理）',
    }
  }
  const scope = (ctx as { readScope?: ReadScope }).readScope
  if (!scope) {
    return {
      category: 'CONFIG_INVALID',
      subcause: 'read-scope-missing',
      detail: 'ReadContext.readScope 必带（读面范围不是可选项）',
    }
  }
  const fields: unknown = (scope as { fields?: unknown }).fields
  if (!Array.isArray(fields) || fields.length === 0 || fields.some((f) => typeof f !== 'string' || f.trim() === '')) {
    return {
      category: 'CONFIG_INVALID',
      subcause: 'read-scope-invalid',
      detail: 'ReadScope.fields 必须是非空字符串数组（空集＝越权→Err，不得 Ok(undefined) 冒充无行）',
    }
  }
  const caller = (ctx as { caller?: { callerId?: unknown } }).caller
  if (!caller || typeof caller.callerId !== 'string' || caller.callerId.trim() === '') {
    return { category: 'CONFIG_INVALID', subcause: 'read-caller-missing', detail: 'ReadContext.caller.callerId 必带（无调用者＝拒）' }
  }
  return null
}

/** 适配器异常 → 分级 Err：任何未收口成「权威不存在」的错误都不得降级成 Ok(undefined) */
function readFailure(err: unknown): ClassifiedError {
  if (err instanceof LocalPlatformError) {
    return { category: err.category, subcause: err.subcause, detail: err.message }
  }
  // 盘读失败（EACCES/EISDIR/EMFILE…）不是「不存在」：不可确认 ⇒ Err(STALL)
  return {
    category: 'STALL',
    subcause: 'read-unconfirmable',
    detail: `盘面读失败/非适配器异常，读结果不可确认（不冒充不存在）：${err instanceof Error ? err.message : String(err)}`,
  }
}

function isIssueRecordShape(v: unknown): v is IssueRecord {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { id?: unknown; state?: unknown }
  return typeof o.id === 'string' && o.id !== '' && typeof o.state === 'string'
}

/**
 * 读单：读上下文必带 → 权威「文件不存在」⇒ Ok(undefined) → 越权/不可确认 ⇒ Err。
 * 返回的 Ok(undefined) **只**表示「这张单确实不在盘上」；它不表示越权、不表示盘读失败、
 * 也不表示事件流损坏（后两者都是 Err，见 readFailure）。
 */
export async function readIssue(
  platform: FlowPlatform,
  id: TicketId,
  ctx: ReadContext | undefined,
): Promise<Result<IssueRecord | undefined, ClassifiedError>> {
  const denial = readContextDenial(ctx)
  if (denial !== null) return { kind: 'err', error: denial }
  let raw: unknown
  try {
    raw = await platform.issues.get(id)
  } catch (err) {
    if (err instanceof LocalPlatformError && err.subcause === AUTHORITATIVE_ABSENT) {
      return { kind: 'ok', value: undefined }
    }
    return { kind: 'err', error: readFailure(err) }
  }
  if (!isIssueRecordShape(raw)) {
    return {
      kind: 'err',
      error: {
        category: 'STALL',
        subcause: 'read-shape-invalid',
        detail: `读回不是 IssueRecord 形状（不可确认，不冒充不存在）：${id}`,
      },
    }
  }
  return { kind: 'ok', value: raw }
}

/**
 * 读单＋绑定状态判决：状态映射表**唯一源**＝`./binding.ts` 的绑定档案
 * （本件不自造第二张表，v2/12 §2.3）。不存在时不映射（不猜平台态）。
 */
export async function readIssueState(
  platform: FlowPlatform,
  id: TicketId,
  ctx: ReadContext | undefined,
  bindingId?: string,
): Promise<Result<{ record: IssueRecord; mapping: StateMapping } | undefined, ClassifiedError>> {
  const read = await readIssue(platform, id, ctx)
  if (read.kind === 'err') return read
  const record = read.value
  if (record === undefined) return { kind: 'ok', value: undefined }
  const mapping = mapState(record.state, bindingId)
  if (mapping.kind === 'err') return mapping
  return { kind: 'ok', value: { record, mapping: mapping.value } }
}

/** 状态映射表视图（唯一源＝绑定档案；本文件只转引，不持有第二张表） */
export function stateMappingTable(bindingId?: string): Result<readonly StateMappingRow[], ClassifiedError> {
  const profile = bindingProfile(bindingId)
  if (profile.kind === 'err') return profile
  return { kind: 'ok', value: profile.value.stateMappings }
}
