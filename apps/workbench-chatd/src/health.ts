/**
 * workbench-chatd health（Phase1 模块 A / P1-1b）。
 * 契约对齐：packages/workbench-transport/src/types.ts 的冻结 HealthResult（v1 字段只读不改、不静默扩字段）。
 * 本包不 import transport 包（分层宪法 §十五：新包间边=提案流），DTO 以镜像方式对齐，
 * 由 apps/workbench-chatd/test/contract.nt.ts 用真客户端断言协议值一致。
 */
export const WORKBENCH_CHATD_PROTOCOL = 'workbench-transport/v1'
export const SERVER_NAME = 'workbench-chatd'
export const SERVER_VERSION = '0.1.0'
/** 运行模式标记：P1-1b 为内存 mock；P1-2（模块 C）换 vendor collab + SQLite 后摘除。 */
export const SERVER_MODE = 'mock'

/** 冻结 HealthResult 镜像（与 transport v1 逐字段一致；不增不减）。 */
export interface HealthResult {
  readonly ok: true
  readonly protocol: typeof WORKBENCH_CHATD_PROTOCOL
  readonly server: string
  readonly startedAt: number
}

/** health 结果：mock 模式经 server 字段表达（`workbench-chatd/0.1.0+mock`），不扩冻结字段。 */
export function buildHealth(startedAt: number): HealthResult {
  return {
    ok: true,
    protocol: WORKBENCH_CHATD_PROTOCOL,
    server: `${SERVER_NAME}/${SERVER_VERSION}+${SERVER_MODE}`,
    startedAt,
  }
}
