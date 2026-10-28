/**
 * 端口与协议 —— 全部并行的唯一共享前提
 * 协议依据：docs/25-端口与协议.md（改动先改文档再改代码，07 顺序铁律）
 * 分级：v0.1 全部 experimental（08-§三）；升级条件见 docs/25-§一.3
 *
 * ── V2 导出面收口（MIG-03 / IMPL-03-04；MIG-06 / IMPL-06-09 退役收尾）──────
 * `invoke.ts`/`notifier.ts` 已并入 PORT-GATE 并**删除源件**（v2/14 §二 PORT-GATE
 * 行）；其 v0 兼容导出（InvokeIntent/InvokeSource/SourceManifest/Notification/
 * Notifier/EXTERNAL_AI_TOOLS/ExternalAiTool）现由 `gate.ts` §五同名再出，实现域
 * （matrix/boot 等）经包根 `@studio-next/contract` 取用不受影响。
 * 下方「V2 端口十三件」是 v2/14 §二 的 13 行映射：每个 PORT- 类型形状只落一件，
 * 别处不得再定义公共端口形状。
 */
export const PORT_VERSION = 'v0' as const
export type PortGrade = 'experimental' | 'beta' | 'stable' | 'deprecated'

// ── v0 兼容期导出（保留不删；退役归 DISP-04 后续波次）──
// 注：invoke/notifier 两件已删——兼容名（Notifier/InvokeSource 等）改由 gate.ts §五承载。
export * from './kernel.ts'
export * from './executor.ts'
export * from './platform.ts'
export * from './models.ts'
export * from './company.ts'
export * from './gateway.ts'

// ── V2 端口十三件（docs/v2/14 §二 端口-文件映射单点表；F5 唯一源）──
// 定义域
export * from './def.ts'
export * from './reg.ts'
// 治理域
export * from './auth.ts'
// 人事域
export * from './hr.ts'
// 工作域
export * from './work.ts'
// 执行域
export * from './exec.ts'
export * from './ws.ts'
// 证据与记忆域
export * from './evd.ts'
export * from './hist.ts'
// 供给域
export * from './trust.ts'
// 入口、观察与运维域
export * from './gate.ts'
export * from './obs.ts'
export * from './ops.ts'
