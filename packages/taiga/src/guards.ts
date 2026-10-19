/**
 * guard 面 —— 平台侧第二道闸（docs/30 §6 守闸补偿；onboard 写面三件之一）。
 *
 * 真机事实（docs/32 §二⑤ + /tmp/taiga-probe/roles-probe-co.json + 2026-10-19 补测
 * P70-P72：PATCH /roles/{id} {permissions} → 200 整角色回显，无 version 语义）：
 *   - Taiga **无状态转换 guard**（角色×转换矩阵不存在）——第二道闸退化为
 *     「项目角色写权限收窄」：roles 携带 permissions 数组（成员类 33 枚/stakeholder 19 枚）
 *   - roles 全量可读：GET /api/v1/roles?project=<id>（真机实测）
 *
 * install 语义（收窄闸；GuardRule.from/to 是转换边，Taiga 无矩阵 → 边不落平台，
 *   只用于**状态存在性校验**防打错字；真正落平台的是 allowRoles 的并集）：
 *   - unrestricted = 存在缺 allowRoles 的规则（该边全员可转 → 无人可收窄）
 *   - allowed = 全部 allowRoles 并集；角色名不在其中 → PATCH 剥掉 modify_{entity}
 *     （保留 view/comment/add/delete——闸管的是状态迁移=modify；add/delete/comment
 *     不动：建单/评论是 worker 通讯面，删除是生命周期操作，均非转换）
 *   - **只收窄、不放宽**：allowed 角色不加 modify（出厂无 modify 的角色如
 *     stakeholder 不因 install 越权升级）
 *   - 幂等=先读现值 diff 再写：已收窄的角色零 PATCH；allowRoles 引用不存在的
 *     角色 / from-to 引用不存在的状态 → CONFIG_INVALID（onboard 期爆打字错）
 *   - 空规则集拒收（「无人可转」的收窄过激，拆闸请显式 uninstall）
 *
 * uninstall 语义 = **拆闸**：给所有缺 modify_{entity} 的角色 PATCH 补回（全员可写）。
 *   不是「恢复出厂」——出厂即无 modify 的角色（如 stakeholder 对 userstory）也会被
 *   放开；语义对齐「闸拆除=写权限回到全员」。升级路径（v0 无处存基线快照）：适配器
 *   无状态，精确恢复需 onboard 时落 roles 快照，留待后续切片。
 *
 * 公司作用域：Taiga 公司=项目（docs/30 §6 ③），install(company) 的 company 必须
 * 等于适配器绑定的 project slug，不一致显式报错（防跨公司误伤）。
 */
import type { CompanySlug, GuardRule } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { TaigaContext as Context } from './context.ts'
import { entityDescriptor, type TaigaEntity } from './entities.ts'
import { TaigaPlatformError } from './errors.ts'
import { TaigaClient, type FetchLike, type TaigaAuth } from './http.ts'
import { TaigaFieldMap } from './fieldmap.ts'
import { asArray, asObject, optBoolean, reqNumber, reqString } from './shape.ts'

export interface TaigaRoleInfo {
  id: number
  name: string
  slug: string
  computable: boolean
  /** 权限枚举数组（如 add_issue/modify_us/comment_wiki_page…；真机快照见 docs/32 §二⑤） */
  permissions: string[]
}

/** 角色读取入口参数（不组整平台实例时的最小访问面） */
export interface TaigaRolesOptions {
  baseUrl: string
  project: string
  auth: TaigaAuth
  entity?: TaigaEntity
  fetch?: FetchLike
}

/** 实体 ↔ 收窄闸权限键（枚举名照真机快照 roles-probe-co.json） */
const ENTITY_GATE_PERMS: Readonly<Record<TaigaEntity, { modify: string }>> = {
  userstory: { modify: 'modify_us' },
  issue: { modify: 'modify_issue' },
}

function parseRole(v: unknown): TaigaRoleInfo {
  const o = asObject(v, 'role')
  const rawPerms = asArray(o['permissions'], 'role.permissions')
  const permissions: string[] = []
  for (const p of rawPerms) {
    if (typeof p !== 'string') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unexpected-response-shape', 'role.permissions 应为 string[]')
    }
    permissions.push(p)
  }
  return {
    id: reqNumber(o, 'id', 'role'),
    name: reqString(o, 'name', 'role'),
    slug: reqString(o, 'slug', 'role'),
    computable: optBoolean(o, 'computable') ?? true,
    permissions,
  }
}

/** 读当前项目的角色×权限集（guards 素材暴露面） */
export async function readRoles(ctx: TaigaContext): Promise<TaigaRoleInfo[]> {
  const projectId = await ctx.project()
  const res = await ctx.client.request({ method: 'GET', path: '/roles', query: { project: String(projectId) } })
  return asArray(res.json, 'roles').map(parseRole).sort((a, b) => a.id - b.id)
}

/** 独立入口：不组整平台实例也能拉角色快照（onboard/审计脚本用） */
export async function readTaigaRoles(opts: TaigaRolesOptions): Promise<TaigaRoleInfo[]> {
  const ctx: TaigaContext = new Context(
    new TaigaClient(opts.baseUrl, opts.auth, opts.fetch),
    entityDescriptor(opts.entity ?? 'userstory'),
    opts.project,
    new TaigaFieldMap(undefined),
  )
  return readRoles(ctx)
}

function requireCompanyScope(ctx: TaigaContext, company: CompanySlug): void {
  if (typeof company !== 'string' || company.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-company-slug', 'company slug 必须非空')
  }
  if (company !== ctx.projectSlug) {
    throw new TaigaPlatformError(
      'CONFIG_INVALID',
      'company-scope-mismatch',
      `guards 作用域 ${company} ≠ 适配器绑定项目 ${ctx.projectSlug}（Taiga 公司=项目，docs/30 §6 ③；跨公司操作须另组该公司的适配器实例）`,
    )
  }
}

function validateRules(rules: GuardRule[]): void {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-guard-rules', 'guard 规则必须是非空数组（「无人可转」的收窄过激；拆闸请显式 uninstall）')
  }
  for (const r of rules) {
    if (typeof r !== 'object' || r === null || typeof r['from'] !== 'string' || r['from'].trim() === '' || typeof r['to'] !== 'string' || r['to'].trim() === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-guard-rules', 'guard 规则结构不合法（from/to 必须是非空字符串）')
    }
    const roles = (r as { allowRoles?: unknown })['allowRoles']
    if (roles !== undefined && !(Array.isArray(roles) && roles.every((x) => typeof x === 'string' && x.trim() !== ''))) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-guard-rules', 'guard 规则的 allowRoles 必须是字符串数组（或缺省=该边全员可转）')
    }
  }
}

async function patchRolePermissions(ctx: TaigaContext, roleId: number, permissions: string[]): Promise<void> {
  await ctx.client.request({ method: 'PATCH', path: `/roles/${String(roleId)}`, body: { permissions } })
}

export async function installGuards(ctx: TaigaContext, company: CompanySlug, rules: GuardRule[]): Promise<void> {
  requireCompanyScope(ctx, company)
  validateRules(rules)
  // from/to 引用状态集（打错字在 onboard 期爆；转换边本身不落平台——无矩阵）
  const statusNames = new Set((await ctx.statuses()).map((s) => s.name))
  for (const r of rules) {
    if (!statusNames.has(r.from) || !statusNames.has(r.to)) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-state', `guard 规则引用了状态集外的状态：${r.from} → ${r.to}（状态集：${[...statusNames].join('、')}）`)
    }
  }
  const unrestricted = rules.some((r) => r.allowRoles === undefined)
  const allowed = new Set<string>()
  for (const r of rules) {
    for (const role of r.allowRoles ?? []) allowed.add(role)
  }
  const roles = await readRoles(ctx)
  const known = new Set(roles.map((r) => r.name))
  for (const name of allowed) {
    if (!known.has(name)) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-role', `allowRoles 引用了项目不存在的角色：${name}（现有：${[...known].join('、')}）`)
    }
  }
  const modifyKey = ENTITY_GATE_PERMS[ctx.desc.entity].modify
  for (const role of roles) {
    const has = role.permissions.includes(modifyKey)
    const mayModify = unrestricted || allowed.has(role.name)
    if (has && !mayModify) {
      await patchRolePermissions(ctx, role.id, role.permissions.filter((p) => p !== modifyKey))
    }
  }
}

export async function uninstallGuards(ctx: TaigaContext, company: CompanySlug): Promise<void> {
  requireCompanyScope(ctx, company)
  const modifyKey = ENTITY_GATE_PERMS[ctx.desc.entity].modify
  for (const role of await readRoles(ctx)) {
    if (role.permissions.includes(modifyKey)) continue // 幂等：已有 modify 的角色零 PATCH
    await patchRolePermissions(ctx, role.id, [...role.permissions, modifyKey])
  }
}
