/**
 * 端口与协议 —— 全部并行的唯一共享前提
 * 协议依据：docs/25-端口与协议.md（改动先改文档再改代码，07 顺序铁律）
 * 分级：v0.1 全部 experimental（08-§三）；升级条件见 docs/25-§一.3
 */
export const PORT_VERSION = 'v0' as const
export type PortGrade = 'experimental' | 'beta' | 'stable' | 'deprecated'

export * from './kernel.js'
export * from './executor.js'
export * from './platform.js'
export * from './models.js'
export * from './invoke.js'
export * from './company.js'
export * from './gateway.js'
export * from './notifier.js'
