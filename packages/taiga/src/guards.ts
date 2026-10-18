/**
 * guard 面 —— 平台侧第二道闸（docs/30 §6 守闸补偿）。
 *
 * 真机事实（docs/32 §二⑤ + /tmp/taiga-probe/roles-probe-co.json）：
 *   - Taiga **无状态转换 guard**（角色×转换矩阵不存在）——第二道闸退化为
 *     「项目角色写权限收窄」：roles 携带 permissions 数组（成员类 33 枚/stakeholder 19 枚）
 *   - roles 全量可读：GET /api/v1/roles?project=<id>（真机实测）
 *
 * 本切片：
 *   - **读面**：readTaigaRoles() 暴露角色×permissions 数组（guards 素材，包级导出——
 *     端口 guards 只有 install/uninstall 两个写方法，无读位，缺口已报不改 contract）
 *   - install/uninstall：**显式未实现**（写面本轮只做 issues+comments）——落地=
 *     PATCH /roles/{id} 收窄 permissions（docs/30 §6 ⑤），onboard 切片实施
 */
import type { CompanySlug, GuardRule } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { TaigaContext as Context } from './context.ts'
import { entityDescriptor, type TaigaEntity } from './entities.ts'
import { TaigaPlatformError, notImplemented } from './errors.ts'
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

export async function installGuards(_company: CompanySlug, _rules: GuardRule[]): Promise<void> {
  throw notImplemented('guards-install', 'Taiga 无转换矩阵，第二道闸=角色权限收窄（PATCH /roles，docs/30 §6 ⑤）；写面本切片只做 issues+comments')
}

export async function uninstallGuards(_company: CompanySlug): Promise<void> {
  throw notImplemented('guards-uninstall', '同 install：角色权限收窄的写入面落地在 onboard 切片')
}
