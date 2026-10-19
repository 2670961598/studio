/**
 * guard 面 —— v0 显式缺口（缺口必须明报，不静默，docs/23-§三）
 *
 * YouTrack workflow JS（状态迁移 guard 的平台第二道闸）是独立大件：
 * guard 管理三步法 + workflow 端点在 openapi.json 之外（N6：需锁版本+回归），
 * 且 guard 必须由 ticket-types.yaml 同源生成（禁平台手改，防双真源）。
 * 留待独立单；本版本 install/uninstall 一律显式抛错（CONFIG_INVALID）。
 *
 * read 读位（v1.6，docs/25-§3.2 修订刀第 1 条）：同样归 N6 后续单——YouTrack 侧
 * 角色/权限读取走 Hub 域或 permission-scheme 端点（不在已核 openapi 白名单），
 * 不臆造端点；本版本显式抛错（CONFIG_INVALID/yt-guards-not-implemented），
 * slug 校验先行（与 localplatform read 共享的错误面）。
 */
import type { CompanySlug, GuardRule, PlatformRole } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'

function requireCompanySlug(company: CompanySlug): void {
  if (typeof company !== 'string' || company.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-company-slug', 'company slug 必须非空')
  }
}

export function installGuards(_company: CompanySlug, _rules: GuardRule[]): Promise<void> {
  return Promise.reject(
    new YouTrackPlatformError(
      'CONFIG_INVALID',
      'yt-guards-not-implemented',
      'YouTrack workflow guard 是独立后续单（N6：guard 由 ticket-types.yaml 同源生成 + workflow 端点锁版本）；v0 显式缺口，不静默',
    ),
  )
}

export function uninstallGuards(_company: CompanySlug): Promise<void> {
  return Promise.reject(
    new YouTrackPlatformError(
      'CONFIG_INVALID',
      'yt-guards-not-implemented',
      'YouTrack workflow guard 是独立后续单（N6）；v0 显式缺口，不静默',
    ),
  )
}

export function readGuards(company: CompanySlug): Promise<PlatformRole[]> {
  requireCompanySlug(company)
  return Promise.reject(
    new YouTrackPlatformError(
      'CONFIG_INVALID',
      'yt-guards-not-implemented',
      'YouTrack 角色/权限读取面同归 N6 后续单（Hub 域角色与 permission-scheme 端点不在已核 openapi 白名单，不臆造）；v0 显式缺口，不静默',
    ),
  )
}
