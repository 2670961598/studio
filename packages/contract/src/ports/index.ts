/**
 * 端口与协议 —— 全部并行的唯一共享前提
 * 协议依据：docs/25-端口与协议.md（改动先改文档再改代码，07 顺序铁律）
 * 分级：v0.1 全部 experimental（08-§三）；升级条件见 docs/25-§一.3
 */
export const PORT_VERSION = 'v0' as const
export type PortGrade = 'experimental' | 'beta' | 'stable' | 'deprecated'

export * from './kernel.ts'
export * from './executor.ts'
export * from './platform.ts'
export * from './models.ts'
export * from './invoke.ts'
export * from './company.ts'
export * from './gateway.ts'
export * from './notifier.ts'
