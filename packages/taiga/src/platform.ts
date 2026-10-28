/**
 * createTaigaPlatform —— FlowPlatform 端口的 Taiga 实现组装（docs/23、docs/25-§3.2）。
 *
 * 公司作用域构造期绑定（适配器实例=公司作用域）：
 *   - project：项目 slug（公司=项目，docs/30 §6 ③；必填——全部读写的落点）
 *   - entity：单据承载实体（默认 userstory=docs/32 真机试点全验路径；issue 备用；
 *     task 仅作 workflows 类型流 entity 映射的 provision 档案目标——DEV-43 v1 运行时
 *     单实体 CRUD 绑定仍 userstory|issue，按类型路由建单归 v2，docs/18-§2.1.1）
 *   - fields：业务字段↔Taiga 自定义属性映射（可缺省：state/title/description/assignee
 *     原生；type/dept/level/lane 等自定义维不映射则读不见、写显式报错）
 *   - auth：密码态（自动登录+401 刷新/重登）或预换 token 态（有 refresh 才可续）
 *   - fetch 可注入（缺省 globalThis.fetch；测试 fake 回放零真实网络）
 *
 * IMPL-07-02（v2/12 §2.2/§2.3；v2/14 §八）追加两面：
 *   - **读口**（本件末段）：404/缺省读口从「一律 Ok(undefined)」改为「**仅平台权威确认
 *     不存在**」⇒ Ok(undefined)；越权/不可确认＝Err，不冒充不存在；读上下文缺省＝拒。
 *   - **状态映射表视图**：**唯一源＝`./binding.ts` 的绑定档案**（L3O-02 治「表散落」：
 *     本件只转引、不持有第二张表）。BC-T1（transport 禁引 fieldmap）不受影响——
 *     binding.ts 不在 transport 内、也不 import transport。
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
  ReadContext,
  ReadScope,
  Result,
  SignedBody,
  TicketId,
} from '@studio-next/contract'
import { bindingProfile, mapState, type StateMapping, type StateMappingRow } from './binding.ts'
import { DEFAULT_PAGE_SIZE, activitySince } from './activity.ts'
import { addComment, listComments } from './comments.ts'
import { TaigaContext } from './transport/context.ts'
import { entityDescriptor, type TaigaEntity } from './transport/entities.ts'
import { TaigaPlatformError } from './transport/errors.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { TaigaFieldMap } from './fieldmap.ts'
import { installGuards, uninstallGuards } from './guards.ts'
import { TaigaClient, type FetchLike, type TaigaAuth } from './transport/http.ts'
import { createIssue, getIssue, listIssues, setIssueField, transitionIssue } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { children as linkChildren, link as addLink } from './links.ts'

export interface TaigaPlatformOptions {
  /** 实例根（如 http://localhost:9000）；/api/v1 由客户端拼接；尾斜杠自动剥 */
  baseUrl: string
  /** 项目 slug（公司作用域；单据 TicketId 前缀即它） */
  project: string
  /** 认证：密码态或预换 token 态（docs/32 §二① JWT） */
  auth: TaigaAuth
  /** 单据承载实体（默认 userstory；issue 备用；task 仅 provision 档案面——运行时单实体 CRUD 绑定归 v2，docs/18-§2.1.1） */
  entity?: TaigaEntity
  /** 业务字段↔Taiga 自定义属性映射（可缺省，见头注） */
  fields?: FieldProvisionMap
  /** fetch 注入（缺省 globalThis.fetch；测试 fake 回放） */
  fetch?: FetchLike
  /** activity 返回页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function validateOptions(opts: TaigaPlatformOptions): void {
  if (typeof opts.baseUrl !== 'string' || !/^https?:\/\//.test(opts.baseUrl)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-base-url', `baseUrl 必须是 http(s) URL：${String(opts.baseUrl)}`)
  }
  if (typeof opts.project !== 'string' || opts.project.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-project', 'project（项目 slug，公司作用域）必填')
  }
  if (opts.auth === undefined || opts.auth === null) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', 'auth 必填（密码态或 token 态）')
  }
  if (opts.auth.type === 'password') {
    if (typeof opts.auth.username !== 'string' || opts.auth.username === '' || typeof opts.auth.password !== 'string' || opts.auth.password === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', '密码态需要非空 username/password')
    }
  } else if (opts.auth.type === 'token') {
    if (typeof opts.auth.token !== 'string' || opts.auth.token === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', 'token 态需要非空 token')
    }
  } else {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', `未知 auth 类型：${String((opts.auth as { type: string }).type)}`)
  }
}

/** 组装上下文（guards.ts 的独立角色读取入口共用） */
export function buildContext(opts: TaigaPlatformOptions): TaigaContext {
  validateOptions(opts)
  const client = new TaigaClient(opts.baseUrl, opts.auth, opts.fetch)
  return new TaigaContext(client, entityDescriptor(opts.entity ?? 'userstory'), opts.project, new TaigaFieldMap(opts.fields))
}

export function createTaigaPlatform(opts: TaigaPlatformOptions): FlowPlatform {
  const ctx = buildContext(opts)
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(ctx, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return getIssue(ctx, id)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(ctx, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(ctx, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        return setIssueField(ctx, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        return addComment(ctx, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(ctx, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(ctx)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        return provisionFields(ctx, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        return kbUpsert(ctx, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(ctx, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(ctx, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(ctx, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        return addLink(ctx, a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return linkChildren(ctx, id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        return installGuards(ctx, company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        return uninstallGuards(ctx, company)
      },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 读口（IMPL-07-02；v2/14 §0.2-1 读面缺省＝拒；L3-J-P0-01；L3O-04 平台 404 单一口径）
//
// 口径（治 L3O-04「taiga 把 404 写成 CONFIG_INVALID/前置缺件」的漂移）：
//   - **仅平台权威确认不存在**（适配器把单据端点 HTTP 404 收口为 `issue-not-found`）⇒ Ok(undefined)；
//   - 越权（401/403 → auth-rejected）、不可确认（网络/5xx/形状漂移/项目端点 404/非适配器异常）⇒ Err，
//     **不得**用 Ok(undefined) 把「读不出来」或「绑定指错项目」伪装成「本来就没有这张单」
//     （80-§6.3/§8.2、D21）；
//   - 读上下文缺省/畸形 ⇒ Err（读方法必带 `ReadContext`；可见字段空集＝越权→拒）。
// 本读口不改 FlowPlatform 签名（契约冻结，cases C-plat-007 口径不变）：它是适配器侧的判定面。
// ─────────────────────────────────────────────────────────────────────────────

/** 权威「不存在」的唯一标记：适配器对平台单据 404 的收口 subcause。其余 subcause 一律 Err */
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
  if (err instanceof TaigaPlatformError) {
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
 * 返回的 Ok(undefined) **只**表示「平台权威确认这张单不存在」；项目端点 404（绑定指错）
 * 不是「单据不存在」，落 Err。
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
    if (err instanceof TaigaPlatformError && err.subcause === AUTHORITATIVE_ABSENT) {
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

/** 状态映射表视图（唯一源＝绑定档案；本文件只转引，不持有第二张表——L3O-02） */
export function stateMappingTable(bindingId?: string): Result<readonly StateMappingRow[], ClassifiedError> {
  const profile = bindingProfile(bindingId)
  if (profile.kind === 'err') return profile
  return { kind: 'ok', value: profile.value.stateMappings }
}
