/**
 * serve-config —— 批示归一层的装配缝（studio-dev-171，docs/18-§2.5）。
 *
 * serve 侧恒注入归一层依赖（结构面）：白名单第一源=dept leader 表（快照装配，
 * 热重载整组换）；组织锚白名单/制作人为部署配置（daemon.yaml 可选键——缺省=部长
 * 单源；制作人未配置走未知 actor 面 fail-closed 拒，宁拒不错派）。
 */
import type { DirectiveGateDeps } from './qualify.ts'

/** daemon.yaml 配置面（ServeConfig.directive* 两键直通） */
export interface ServeDirectiveOptions {
  /** 制作人账号/工号（豁免派单律） */
  producer?: string | undefined
  /** 组织锚白名单原始串（分号分隔工号/账号，如 PRIME-0;pln-0） */
  whitelist?: string | undefined
}

/**
 * 白名单串解析（解析即验，129-§6.2-R3 同款纪律）：分号分隔工号/账号，空段剔除；
 * 全空=未配（undefined——面保持部长单源，不注空数组）。
 */
export function parseWhitelistSpec(raw: string): string[] | undefined {
  const list = raw.split(';').map((s) => s.trim()).filter((s) => s !== '')
  return list.length > 0 ? list : undefined
}

/** serve → EngineDeps.directives 装配（leader 表随快照；配置键可选注入） */
export function buildServeDirectiveDeps(
  opts: ServeDirectiveOptions,
  departments: ReadonlyArray<{ path: string; leader: string }>,
): DirectiveGateDeps {
  const extraWhitelist = opts.whitelist === undefined ? undefined : parseWhitelistSpec(opts.whitelist)
  return {
    departments: new Map(departments.map((d) => [d.path, d.leader])),
    ...(extraWhitelist !== undefined ? { extraWhitelist } : {}),
    ...(opts.producer !== undefined ? { producer: opts.producer } : {}),
  }
}
