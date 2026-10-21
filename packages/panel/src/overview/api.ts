/**
 * overview api —— :8789 JSON 读面的纯投影层（DEV-12 执行刀二；零 IO、零 Hono）
 *
 * 依据：docs/37-§8（服务器层只加路由不改语义——本刀为概览面新增 /api/overview/* JSON
 * 读面，供换装后的 Vue 页消费；旧服务端渲染面整组迁 /legacy，逐字节保留）、
 * docs/04-§七（slug 路由/404 口径在 JSON 面同样成立：未知 slug 404 JSON）。
 *
 * 快照时间标注（DEV-12 热重载能力其一）双时间戳口径：
 *   - asOf：**响应取数时刻**（server 侧 Date.now() 传入——每次请求都是新的）；
 *   - snapshotMeta：**快照装载时刻/代数/监听态**（来自 wiring 注入的 snapshotInfo——
 *     目录热重载后 version+1、at 换新；无注入位时缺省，不臆造）。
 * 页面两处都亮：取数时间答「这份数据何时拉的」，快照时间答「公司目录何时装载的」。
 *
 * 与 views.ts 同款分层纪律：本文件零 IO、零 Hono；聚合复用 views.ts 纯函数
 * （buildOrgTree/buildProgressSnapshot/buildFinanceSnapshot——服务端聚合，不整树前端算）。
 */
import type { CompanySnapshot, PersonRef } from '@studio-next/contract'
import type { SnapshotInfo } from './reload.ts'
import { buildOrgTree, type FinanceSnapshot, type OrgTreeNode, type ProgressSnapshot } from './views.ts'

/** 快照装载信息（JSON 形状——at 同时给 epoch 与 ISO，前端展示免换算歧义） */
export interface SnapshotMetaJson {
  at: number
  atIso: string
  version: number
  watching: boolean
  lastError: string | null
}

/** snapshotInfo → JSON（无注入位=undefined，字段缺省不臆造） */
export function snapshotMetaJson(info: SnapshotInfo | undefined): SnapshotMetaJson | undefined {
  if (info === undefined) return undefined
  return { at: info.at, atIso: new Date(info.at).toISOString(), version: info.version, watching: info.watching, lastError: info.lastError }
}

/** 公司清单 payload（/api/overview/companies） */
export interface CompaniesPayload {
  basis: 'company-directory'
  asOf: string
  companies: Array<{
    slug: string
    name: string
    level: number
    platform: string
    departmentCount: number
    peopleCount: number
    mission: string | null
    snapshotMeta?: SnapshotMetaJson | undefined
  }>
}

/** 组织树节点（JSON 形状：children 嵌套，promoted/cyclic 以 path 列表另列——悬空/成环诚实标记） */
export interface OrgTreeNodeJson {
  name: string
  path: string
  leader: string
  level: number
  lanes: string[]
  functions: string[]
  children: OrgTreeNodeJson[]
}

/** 组织 payload（/api/overview/:slug/org） */
export interface OrgPayload {
  slug: string
  basis: 'parent-chain'
  roots: OrgTreeNodeJson[]
  promoted: string[]
  cyclic: string[]
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

/** 概览卡 payload（/api/overview/:slug/snapshot） */
export interface CompanySnapshotPayload {
  slug: string
  name: string
  level: number
  mission: string | null
  charter: string
  platform: string
  departmentCount: number
  peopleCount: number
  jobCount: number
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

/** 人事列表 payload（/api/overview/:slug/people） */
export interface PeoplePayload {
  slug: string
  people: Array<{ id: string; name: string; login: string; level: number; dept: string; hasBody: boolean }>
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

/** 人事档案 payload（/api/overview/:slug/people/:personId；body=null=在册但正文缺失） */
export interface PersonPayload {
  slug: string
  person: { id: string; name: string; login: string; level: number; dept: string }
  body: string | null
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

/** 进度 payload（/api/overview/:slug/progress；progress=null=无台账降级） */
export interface ProgressPayload {
  slug: string
  progress: ProgressSnapshot | null
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

/** 财务 payload（/api/overview/:slug/finance；finance=null=无台账降级） */
export interface FinancePayload {
  slug: string
  finance: FinanceSnapshot | null
  asOf: string
  snapshotMeta?: SnapshotMetaJson | undefined
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** 公司清单 payload 构造（entries=server 侧逐家取快照后的行） */
export function buildCompaniesPayload(
  entries: ReadonlyArray<{ slug: string; snapshot: CompanySnapshot; mission: string | undefined; info?: SnapshotInfo | undefined }>,
  asOfMs: number,
): CompaniesPayload {
  return {
    basis: 'company-directory',
    asOf: iso(asOfMs),
    companies: entries.map((e) => ({
      slug: e.slug,
      name: e.snapshot.name,
      level: e.snapshot.level,
      platform: e.snapshot.platform.platform,
      departmentCount: e.snapshot.departments.length,
      peopleCount: e.snapshot.people.length,
      mission: e.mission ?? null,
      ...(e.info !== undefined ? { snapshotMeta: snapshotMetaJson(e.info) } : {}),
    })),
  }
}

/** 组织树节点 → JSON（嵌套 children） */
function orgNodeJson(node: OrgTreeNode): OrgTreeNodeJson {
  return {
    name: node.dept.name,
    path: node.dept.path,
    leader: node.dept.leader,
    level: node.dept.level,
    lanes: [...node.dept.lanes],
    functions: [...node.dept.functions],
    children: node.children.map(orgNodeJson),
  }
}

/** 组织 payload 构造（buildOrgTree 复用——悬空/成环提升为根的口径与 /legacy 面同源） */
export function buildOrgPayload(slug: string, snapshot: CompanySnapshot, asOfMs: number, info?: SnapshotInfo): OrgPayload {
  const tree = buildOrgTree(snapshot.departments)
  return {
    slug,
    basis: 'parent-chain',
    roots: tree.roots.map(orgNodeJson),
    promoted: tree.promoted.map((d) => d.path),
    cyclic: tree.cyclic.map((d) => d.path),
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}

/** 概览卡 payload 构造 */
export function buildCompanySnapshotPayload(
  slug: string,
  snapshot: CompanySnapshot,
  mission: string | undefined,
  asOfMs: number,
  info?: SnapshotInfo,
): CompanySnapshotPayload {
  return {
    slug,
    name: snapshot.name,
    level: snapshot.level,
    mission: mission ?? null,
    charter: snapshot.charter,
    platform: snapshot.platform.platform,
    departmentCount: snapshot.departments.length,
    peopleCount: snapshot.people.length,
    jobCount: snapshot.jobs.length,
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}

/** 人事列表 payload 构造（hasBody=档案正文可读——链接/缺省的判据与 /legacy 面同源） */
export function buildPeoplePayload(
  slug: string,
  snapshot: CompanySnapshot,
  hasBody: (personId: string) => boolean,
  asOfMs: number,
  info?: SnapshotInfo,
): PeoplePayload {
  return {
    slug,
    people: snapshot.people.map((p) => ({ ...p, hasBody: hasBody(p.id) })),
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}

/** 人事档案 payload 构造 */
export function buildPersonPayload(
  slug: string,
  person: PersonRef,
  body: string | undefined,
  asOfMs: number,
  info?: SnapshotInfo,
): PersonPayload {
  return {
    slug,
    person: { id: person.id, name: person.name, login: person.login, level: person.level, dept: person.dept },
    body: body ?? null,
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}

/** 进度 payload 构造 */
export function buildProgressPayload(slug: string, progress: ProgressSnapshot | null, asOfMs: number, info?: SnapshotInfo): ProgressPayload {
  return {
    slug,
    progress,
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}

/** 财务 payload 构造 */
export function buildFinancePayload(slug: string, finance: FinanceSnapshot | null, asOfMs: number, info?: SnapshotInfo): FinancePayload {
  return {
    slug,
    finance,
    asOf: iso(asOfMs),
    ...(info !== undefined ? { snapshotMeta: snapshotMetaJson(info) } : {}),
  }
}
