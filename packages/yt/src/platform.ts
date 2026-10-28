/**
 * createYouTrackPlatform —— FlowPlatform 端口的 YouTrack 实现组装（docs/23/25-§3.2）。
 *
 * 公司作用域在构造时绑定（docs/25-§3.2「适配器实例=公司作用域」）：
 *   - fields: FieldProvisionMap —— 业务字段名↔平台字段名翻译表（state 映射必给）
 *   - project: 项目短名（N1 公司=一个 YouTrack 项目）——issues 查询加 project: 前缀、
 *     activity 按项目前缀过滤、create 的落点（create 缺它显式报错）
 *   - fetch 可注入（缺省 globalThis.fetch；测试注入 fake 回放，零真实网络）
 *
 * v0 不做：超时/重试/限流（见 errors.ts 头注）；真实例冒烟=独立集成单。
 *
 * IMPL-07-01（v2/12 §2.2/§2.3；v2/14 §八）追加两面：
 *   - **读口**（本件末段）：404/缺省读口从「一律 Ok(undefined)」改为「**仅平台权威确认
 *     不存在**」⇒ Ok(undefined)；越权/不可确认＝Err，不冒充不存在；读上下文缺省＝拒。
 *   - **状态映射表视图**：唯一源＝`./binding.ts` 的绑定档案（本件不持有第二张表）。
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
import { YouTrackPlatformError } from './errors.ts'
import { FieldTranslator } from './fieldmap.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { installGuards, readGuards, uninstallGuards } from './guards.ts'
import { YtHttpClient, type FetchLike } from './http.ts'
import { createIssue, listIssues, fetchIssueJson, setIssueField, toIssueRecord, transitionIssue, type IssueDeps } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { LinkFacade } from './links.ts'

export interface YouTrackPlatformOptions {
  /** 实例根（如 https://youtrack.internal）；尾斜杠自动剥 */
  baseUrl: string
  /** Bearer token（永久 token；密钥永不入库——由部署环境注入） */
  token: string
  /** 公司字段/状态映射（构造期校验：state 映射必给，见 fieldmap.ts） */
  fields: FieldProvisionMap
  /** 项目短名（公司作用域；create 必需——拟稿待批点，见 index.ts 头注） */
  project?: string
  /** 时钟注入：v0 预留未用（一切时间戳以平台响应为准，服务器权威） */
  clock?: () => string
  /** fetch 注入（缺省 globalThis.fetch；测试 fake 回放） */
  fetch?: FetchLike
  /** activity 返回页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function validateOptions(opts: YouTrackPlatformOptions): void {
  if (typeof opts.baseUrl !== 'string' || !/^https?:\/\//.test(opts.baseUrl)) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-base-url', `baseUrl 必须是 http(s) URL：${String(opts.baseUrl)}`)
  }
  if (typeof opts.token !== 'string' || opts.token.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-token', 'token 必须是非空字符串')
  }
}

export function createYouTrackPlatform(opts: YouTrackPlatformOptions): FlowPlatform {
  validateOptions(opts)
  const http = new YtHttpClient(opts.baseUrl, opts.token, opts.fetch ?? globalThis.fetch)
  const tr = new FieldTranslator(opts.fields) // 构造期校验（含 state 映射必给）
  const project = opts.project
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const links = new LinkFacade(http)
  const deps: IssueDeps = {
    http,
    tr,
    project,
    projectIdCache: { id: null },
    links,
  }
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(http, tr, project, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return toIssueRecord(await fetchIssueJson(http, id), tr)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(deps, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(http, tr, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        return setIssueField(deps, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        return addComment(http, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(http, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(http, tr)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        provisionFields(tr, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        return kbUpsert(http, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(http, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(http, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(http, project, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        return links.link(a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return links.children(id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        return installGuards(company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        return uninstallGuards(company)
      },
      async read(company: CompanySlug): Promise<PlatformRole[]> {
        return readGuards(company)
      },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 读口（IMPL-07-01；v2/14 §0.2-1 读面缺省＝拒；L3-J-P0-01；L3O-04 平台 404 单一口径）
//
// 口径（治 L3O-04「两包各写各的 404 结论」）：
//   - **仅平台权威确认不存在**（适配器把 HTTP 404 收口为 `issue-not-found`）⇒ Ok(undefined)；
//   - 越权（401/403 → auth-rejected）、不可确认（网络/5xx/形状漂移/非适配器异常）⇒ Err，
//     **不得**用 Ok(undefined)/空值把「读不出来」伪装成「本来就没有」（80-§6.3/§8.2、D21）；
//   - 读上下文缺省/畸形 ⇒ Err（读方法必带 `ReadContext`；可见字段空集＝越权→拒）。
// 本读口不改 FlowPlatform 签名（契约冻结，cases C-plat-007 口径不变）：它是适配器侧的
// 判定面，供宿主/读路由消费。
// ─────────────────────────────────────────────────────────────────────────────

/** 权威「不存在」的唯一标记：适配器对平台 404 的收口 subcause。其余 subcause 一律 Err */
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
  if (err instanceof YouTrackPlatformError) {
    return { category: err.category, subcause: err.subcause, detail: err.message }
  }
  return {
    category: 'STALL',
    subcause: 'read-unconfirmable',
    detail: `非适配器异常，读结果不可确认（不冒充不存在）：${err instanceof Error ? err.message : String(err)}`,
  }
}

function isIssueRecordShape(v: unknown): v is IssueRecord {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { id?: unknown; state?: unknown }
  return typeof o.id === 'string' && o.id !== '' && typeof o.state === 'string'
}

/**
 * 读单：读上下文必带 → 平台权威 404 ⇒ Ok(undefined) → 越权/不可确认 ⇒ Err。
 * 返回的 Ok(undefined) **只**表示「平台权威确认这张单不存在」；它不表示越权、
 * 不表示读失败、也不表示缓存未命中。
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
    if (err instanceof YouTrackPlatformError && err.subcause === AUTHORITATIVE_ABSENT) {
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
 * （本件不自造第二张表，v2/12 §2.3 / L3O-02）。不存在时不映射（不猜平台态）。
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

