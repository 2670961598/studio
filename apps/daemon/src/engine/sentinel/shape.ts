/**
 * shape —— 事件四要素形状＋人闸快照投影（自 engine.ts 小构件抽件——20-§十五
 * 「先拆再增」；纯函数，显式参数零引擎闭包）。
 *   - evtLevel/evtDept：EventRecord.level/dept 的裁剪缺省面（engine makeEvent/syncMirror 消费）；
 *   - tokenBuckets：四桶映射（F2-04 冻结列名；132-§6.1 单A·studio-dev-168）；
 *   - personLimitFor/personGateSnapshot：人闸帽与携带快照（129-§6.2-R3 第四闸，
 *     decide passGates 序冻结的输入投影）。
 */
import type { EventRecord, IssueRecord, ResultStats, TicketId } from '@studio-next/contract'

export function evtLevel(issue: IssueRecord): number {
  return Math.min(9, Math.max(1, issue.level ?? 1))
}

export function evtDept(issue: IssueRecord, deptFallback: string): string {
  return issue.dept ?? deptFallback
}

/**
 * 四桶映射（F2-04 冻结列名；kernel.TokenCounts 四桶直通——132-§6.1 单A·studio-dev-168）：
 * cache_read 兼容读 `cache_read ?? cached`（旧账键，读侧认——写侧一律新键在适配器钉死）；
 * cache_creation 直通（此前采集即丢，判负线⑤ 修复）。无值桶不落键（真值直录）。
 */
export function tokenBuckets(stats: ResultStats): EventRecord['tokens'] {
  const t = stats.tokens
  const out: Record<string, number> = { input: t.input, output: t.output }
  const cacheRead = t.cache_read ?? t.cached
  if (cacheRead !== undefined) out.cache_read = cacheRead
  if (t.cache_creation !== undefined) out.cache_creation = t.cache_creation
  return out as EventRecord['tokens']
}

/** 人闸帽入参（engine config 同形子集） */
export interface PersonLimitInputs {
  /** 覆盖表：工号 → 帽 */
  overrides: Readonly<Record<string, number>>
  /** 缺省帽（limits.maxInflightPerPerson——引擎侧兜底 1） */
  defaultLimit: number
}

/**
 * 人闸帽（129-§6.2-R3）：覆盖表 > 缺省（引擎侧兜底 1——decide 侧 Math.max(1,limit)
 * 再兜一次，双层 fail-closed）；批量执行岗才可 >1。
 */
export function personLimitFor(person: string, inputs: PersonLimitInputs): number {
  return inputs.overrides[person] ?? inputs.defaultLimit
}

/**
 * 人闸携带快照（129-§6.2-R3：第四闸插在泳道后每拍前——decide passGates 序冻结）。
 * 在工计数=内存 Inflight + 本拍已排队派发（两段式「先决后执」拍内即时生效——
 * inflightCount 同款折算面）。人不可解析=不注 gate（闸面跳过，人索引空时不误伤）。
 */
export function personGateSnapshot(
  person: string | undefined,
  dispatchPersons: ReadonlyMap<TicketId, string>,
  inflight: ReadonlyMap<TicketId, { personId: string }>,
  limits: PersonLimitInputs,
): { inflightCount: number; limit: number } | undefined {
  if (person === undefined) return undefined
  let inflightCount = 0
  for (const entry of inflight.values()) if (entry.personId === person) inflightCount += 1
  for (const p of dispatchPersons.values()) if (p === person) inflightCount += 1
  return { inflightCount, limit: personLimitFor(person, limits) }
}
