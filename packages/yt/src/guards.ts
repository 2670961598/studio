/**
 * guard 面 —— v0 显式缺口（缺口必须明报，不静默，docs/23-§三）
 *
 * YouTrack workflow JS（状态迁移 guard 的平台第二道闸）是独立大件：
 * guard 管理三步法 + workflow 端点在 openapi.json 之外（N6：需锁版本+回归），
 * 且 guard 必须由 ticket-types.yaml 同源生成（禁平台手改，防双真源）。
 * 留待独立单；本版本 install/uninstall 一律显式抛错（CONFIG_INVALID）。
 */
import type { CompanySlug, GuardRule } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'

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
