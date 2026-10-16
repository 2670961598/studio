/**
 * guard 面 —— meta/guards.json 落盘（Record<CompanySlug, GuardRule[]>）。
 *
 * **仅落盘，不执行**（任务定调）：LocalFile 是契约靶子——guard 规则持久化到盘上
 * 供查阅/迁移/契约测试；真正的闸是 daemon state-diff（第一道，18-§二.2），
 * YouTrack 侧 JS guard 是平台第二道。未来 LocalFile 若需执行，升级路径是
 * 在 transition() 里按 installed 规则做表校验（接口不变）。
 *
 * uninstall 对未知公司幂等（删不存在的键 = 无操作）。
 */
import type { CompanySlug, GuardRule } from '@studio-next/contract'
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
