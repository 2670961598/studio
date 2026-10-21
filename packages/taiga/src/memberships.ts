/**
 * memberships —— Taiga 成员面：人事同步器的 Taiga 执行面（DEV-48，docs/52-§六）
 *
 * 规格依据（实现单引用）：
 *   - docs/52-§6.1 邀请令牌建号流：POST /memberships {project, username, role} 发邀请 →
 *     **邀请令牌不落 API 响应**（落 console/邮件日志——§13 风险 1）→ 注册流
 *     POST /auth/register {type:'private', token, accepted_terms:true, username, password}
 *     建号并绑定成员身份（docs/32 §二④ 真机实测口径）。
 *   - docs/52-§6.2 角色绑定/调整：POST 邀请时带角色；在职成员角色调整走
 *     PATCH /memberships/{id} {role: roleId}；退场 DELETE /memberships/{id}。
 *     「调」（部门迁移）无 Taiga 动作——Taiga 无部门语义（§6.2 表内「-」）。
 *   - docs/52-§6.3 GET-first 幂等纪律：**业务幂等（ensure-shape）归 daemon 同步执行体**
 *     （apps/daemon engine/hrsync——包内只提供原子端点与判重读面，与 matrix client
 *     薄层分工对齐，§7.4 同款纪律）。
 *
 * 本包边界（零 npm 依赖、shape.ts 手写窄校验）：
 *   - 角色 slug→id 解析走 GET /roles?project=（实例缓存 WeakMap——roles 是项目级配置，
 *     membership 增删不改 roles，无需随 invalidateMeta 联动）。
 *   - registerWithInviteToken **不吃 TaigaContext**（auth/register 是公开端点，无 JWT）：
 *     独立 baseUrl + 注入 fetch——与 TaigaClient 同层的薄网络函数。
 *   - findInviteToken 纯函数：console/邮件日志文本 → token（§6.1 步③的文本面）。
 */

import { TaigaPlatformError } from './transport/errors.ts'
import type { TaigaContext } from './transport/context.ts'
import type { FetchLike } from './transport/http.ts'
import { asArray, asObject, optBoolean, optNumberNull, optString, optStringNull, reqNumber, reqString } from './transport/shape.ts'
import { LIST_PAGE_SIZE } from './transport/entities.ts'

/** 成员行（MembershipDetailSerializer 消费字段投影；full_name/email 隐私面可缺省） */
export interface TaigaMembership {
  id: number
  username: string
  /** 角色显示名（owner/成员自定义角色——guards provisionFields 同族配置面） */
  roleName: string
  /** 角色 slug（幂等比对键——显示名可改，slug 稳定） */
  roleSlug: string
  /** 是否激活（停用成员位仍占席——true 缺省，serializer 对未激活可缺省） */
  isActive: boolean
  fullName?: string
  email?: string
}

function parseMembership(v: unknown): TaigaMembership {
  const o = asObject(v, 'membership')
  const fullName = optStringNull(o, 'full_name')
  const email = optStringNull(o, 'email')
  return {
    id: reqNumber(o, 'id', 'membership'),
    username: reqString(o, 'username', 'membership'),
    roleName: optString(o, 'role_name') ?? '',
    roleSlug: optString(o, 'role_slug') ?? '',
    isActive: optBoolean(o, 'is_active') ?? true,
    ...(fullName !== undefined ? { fullName } : {}),
    ...(email !== undefined ? { email } : {}),
  }
}

/** 项目角色（GET /roles?project=；slug→id 解析表） */
export interface TaigaRoleRef {
  id: number
  name: string
  slug: string
}

/** roles 缓存（TaigaContext 实例生命周期——项目级配置不变，无 invalidate 面需求） */
const ROLES_CACHE = new WeakMap<TaigaContext, Map<string, TaigaRoleRef>>()

async function rolesOf(ctx: TaigaContext): Promise<Map<string, TaigaRoleRef>> {
  const cached = ROLES_CACHE.get(ctx)
  if (cached !== undefined) return cached
  const projectId = await ctx.project()
  const res = await ctx.client.request({ method: 'GET', path: '/roles', query: { project: String(projectId) } })
  // 真机实测（docs/32 §二⑤ + guards.readRoles 同源）：GET /roles?project= 返回裸数组
  const out = new Map<string, TaigaRoleRef>()
  for (const item of asArray(res.json, 'roles')) {
    const o = asObject(item, 'role')
    const ref: TaigaRoleRef = {
      id: reqNumber(o, 'id', 'role'),
      name: reqString(o, 'name', 'role'),
      slug: reqString(o, 'slug', 'role'),
    }
    out.set(ref.slug, ref)
    out.set(ref.name, ref) // 显示名也可解析（装配侧配置写显示名时兜底）
  }
  if (out.size === 0) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'no-roles', `项目 ${ctx.projectSlug} 角色集为空（roles 解析失败或未配置）`)
  }
  ROLES_CACHE.set(ctx, out)
  return out
}

/** slug（或显示名）→ 角色 id（invite/patchRole 共用解析面；未配置 → CONFIG_INVALID fail-closed） */
export async function roleIdOf(ctx: TaigaContext, slugOrName: string): Promise<number> {
  const roles = await rolesOf(ctx)
  const hit = roles.get(slugOrName)
  if (hit === undefined) {
    throw new TaigaPlatformError(
      'CONFIG_INVALID',
      'unknown-role',
      `角色「${slugOrName}」未在项目 ${ctx.projectSlug} 声明（taigaRoles 配置面或项目角色集漂移）`,
    )
  }
  return hit.id
}

/** 成员全量（GET /memberships?project= 分页拉全；含未激活——判重面需要全席） */
export async function listMemberships(ctx: TaigaContext): Promise<TaigaMembership[]> {
  const projectId = await ctx.project()
  const raws = await ctx.client.paginate(
    { method: 'GET', path: '/memberships', query: { project: String(projectId) } },
    (v) => (Array.isArray(v) ? (v as unknown[]) : []),
    LIST_PAGE_SIZE,
  )
  return raws.map(parseMembership)
}

/** 按用户名找成员（ensure-shape 判重读面；未找到=undefined——调用方决定 invite） */
export async function findMembershipByUsername(ctx: TaigaContext, username: string): Promise<TaigaMembership | undefined> {
  for (const m of await listMemberships(ctx)) {
    if (m.username === username) return m
  }
  return undefined
}

/**
 * 发成员邀请（POST /memberships {project, username, role}）。
 * 邀请发出后**令牌不在本响应内**（落 console/邮件日志——§6.1/§13 风险1）：
 * 令牌抓取走 findInviteToken + 装配侧日志读面（daemon faces 轮询），不在本包。
 */
export async function inviteMember(ctx: TaigaContext, input: { username: string; roleSlug: string }): Promise<TaigaMembership> {
  const projectId = await ctx.project()
  const roleId = await roleIdOf(ctx, input.roleSlug)
  const res = await ctx.client.request({
    method: 'POST',
    path: '/memberships',
    body: { project: projectId, username: input.username, role: roleId },
  })
  return parseMembership(asObject(res.json, 'membership-create'))
}

/** 在职成员角色调整（PATCH /memberships/{id} {role}；升/降面） */
export async function patchMembershipRole(ctx: TaigaContext, membershipId: number, roleSlug: string): Promise<void> {
  const roleId = await roleIdOf(ctx, roleSlug)
  await ctx.client.request({ method: 'PATCH', path: `/memberships/${String(membershipId)}`, body: { role: roleId } })
}

/** 移除成员（DELETE /memberships/{id}；退场面——账号保留、席位释放，§6.2） */
export async function removeMembership(ctx: TaigaContext, membershipId: number): Promise<void> {
  await ctx.client.request({ method: 'DELETE', path: `/memberships/${String(membershipId)}` })
}

/**
 * 邀请令牌注册建号（POST /auth/register——公开端点，无 JWT，不吃 TaigaContext）。
 * docs/32 §二④ 真机实测 + docs/52-§6.1 步④：{type:'private', token, accepted_terms:true,
 * username, password} → 201 建号并绑定被邀成员身份。**token 一次性**（重放 400——
 * 幂等收敛归 daemon 执行体：注册冲突即视为已建号，§7.4 ensure-shape）。
 */
export async function registerWithInviteToken(input: {
  baseUrl: string
  token: string
  username: string
  password: string
  fullName?: string
  fetch?: FetchLike
}): Promise<{ username: string; userId?: number }> {
  const fetchLike: FetchLike = input.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const url = `${input.baseUrl.replace(/\/+$/, '')}/api/v1/auth/register`
  const body: Record<string, unknown> = {
    type: 'private',
    token: input.token,
    accepted_terms: true,
    username: input.username,
    password: input.password,
  }
  if (input.fullName !== undefined) body['full_name'] = input.fullName
  const res = await fetchLike(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => `HTTP ${String(res.status)}`)
    throw new TaigaPlatformError(
      'EXTERNAL_REJECT',
      'register-rejected',
      `邀请注册被拒（${String(res.status)}）：${detail}（token 一次性/过期/已用——ensure-shape 语义下冲突≈已建号，调用方判定）`,
    )
  }
  const o = asObject(await res.json().catch(() => ({})), 'auth/register')
  const userId = optNumberNull(o, 'id') ?? undefined
  return { username: reqString(o, 'username', 'auth/register'), ...(userId !== undefined ? { userId } : {}) }
}

/**
 * 日志文本 → 邀请令牌（§6.1 步③文本面；纯函数）。
 * 抓取形（console/邮件两源并收，docs/32 实测邮件模板 + docker logs）：
 *   - 注册链接尾段：/register/<token>（邮件正文/docker console 输出）
 *   - 裸键值：token=<token> / "token": "<token>"（结构化日志）
 * token 字符集实测为 URL-safe 长串（大小写字母数字+-_，≥20）。取**最后**一处命中
 * （多邀请并发时日志最新行=最近一次邀请——轮询窗口语义，装配侧保证窗口）。
 */
export function findInviteToken(text: string): string | null {
  const PATH_RE = /\/register\/([A-Za-z0-9_-]{20,})/g
  const KV_RE = /\btoken["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})/g
  let last: string | null = null
  for (const m of text.matchAll(PATH_RE)) last = m[1] ?? null
  for (const m of text.matchAll(KV_RE)) last = m[1] ?? null
  return last
}
