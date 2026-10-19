/**
 * guard 面 —— meta/guards.json 落盘（Record<CompanySlug, GuardRule[]>）。
 *
 * **仅落盘，不执行**（任务定调）：LocalFile 是契约靶子——guard 规则持久化到盘上
 * 供查阅/迁移/契约测试；真正的闸是 daemon state-diff（第一道，18-§二.2），
 * YouTrack 侧 JS guard 是平台第二道。未来 LocalFile 若需执行，升级路径是
 * 在 transition() 里按 installed 规则做表校验（接口不变）。
 *
 * uninstall 对未知公司幂等（删不存在的键 = 无操作）。
 *
 * read 读位（v1.6，docs/25-§3.2 修订刀第 1 条）：LocalFile **无平台角色真源**——
 * read() = 已装 guard 规则的**角色投影**（契约靶子语义，如实投影不造）：
 *   - allowRoles 去重为主档（slug=name=角色名，首见序）
 *   - permissions = 该角色放行的「from→to」串（LocalFile 自有编码，非平台词表）
 *   - 无 allowRoles 的规则（全员放行）不产生角色条目
 *   - 未安装/已卸载公司 → 空清单（幂等口径同 uninstall）
 */
import type { CompanySlug, GuardRule, PlatformRole } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'
import { isPlainObject, readJson, writeJson } from './fsutil.ts'
import { guardsPath } from './layout.ts'

function isGuardRule(v: unknown): v is GuardRule {
  if (!isPlainObject(v)) return false
  if (typeof v['from'] !== 'string' || typeof v['to'] !== 'string') return false
  const roles = v['allowRoles']
  return roles === undefined || (Array.isArray(roles) && roles.every((r) => typeof r === 'string'))
}

function requireCompanySlug(company: CompanySlug): void {
  if (typeof company !== 'string' || company.trim() === '') {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-company-slug', 'company slug 必须非空')
  }
}

function loadGuardFile(root: string): Record<string, GuardRule[]> {
  return readJson<Record<string, GuardRule[]>>(guardsPath(root), {})
}

export function installGuards(root: string, company: CompanySlug, rules: GuardRule[]): void {
  requireCompanySlug(company)
  if (!Array.isArray(rules) || !rules.every((r) => isGuardRule(r))) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-guard-rules', 'guard 规则结构不合法（from/to/allowRoles）')
  }
  const all = loadGuardFile(root)
  all[company] = rules
  writeJson(guardsPath(root), all)
}

export function uninstallGuards(root: string, company: CompanySlug): void {
  requireCompanySlug(company)
  const all = loadGuardFile(root)
  if (!(company in all)) return // 幂等
  delete all[company]
  writeJson(guardsPath(root), all)
}

/** 读位（v1.6）：已装 guard 规则的角色投影（见文件头注）；未装/已卸载 → 空清单 */
export function readGuardRoles(root: string, company: CompanySlug): PlatformRole[] {
  requireCompanySlug(company)
  const rules = loadGuardFile(root)[company] ?? []
  const byRole = new Map<string, string[]>()
  for (const rule of rules) {
    for (const role of rule.allowRoles ?? []) {
      const perms = byRole.get(role)
      if (perms === undefined) byRole.set(role, [`${rule.from}→${rule.to}`])
      else perms.push(`${rule.from}→${rule.to}`)
    }
  }
  return [...byRole.entries()].map(([slug, permissions]) => ({ slug, name: slug, permissions }))
}
