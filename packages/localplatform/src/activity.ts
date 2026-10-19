/**
 * 活动流 —— 全局 activity.jsonl（append-only），单调递增 id（a-000001…）。
 *
 * 游标语义（docs/25-§3.2，NA1 教训：增量必须不重不漏）：
 *   - 游标是**不透明字符串**；本实现的内部形态 = 「最后见过的活动 id」边界
 *   - since(cursor) 返回 id 严格大于该边界的全部活动（升序），翻页用 nextCursor
 *   - null cursor = 从头全量；nextCursor=null = 没有更多
 *   - 无新增 → items=[] 且 nextCursor=null，调用方持有的游标自然不变
 *
 * id 分配 v0：全量读末取 max+1（单 daemon 写 + 演示规模假设）；
 * 升级路径：实例内计数器或 meta/seq 落盘（接口不变，游标格式自解释）。
 *
 * kind 词表（v1.6 冻结，docs/25-§3.2）：本实现产 created/commented/transitioned/
 * field-set（全在 PLATFORM_ACTIVITY_KINDS 冻结集内）。
 */
import type { ActivityPage, PlatformActivity, TicketId } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'
import { appendJsonl, isPlainObject, readJsonl } from './fsutil.ts'
import { activityPath } from './layout.ts'

const ID_PREFIX = 'a-'
const ID_WIDTH = 6

export const DEFAULT_PAGE_SIZE = 100

export function formatActivityId(n: number): string {
  return `${ID_PREFIX}${String(n).padStart(ID_WIDTH, '0')}`
}

/** 解析活动 id / 游标；无法解释的游标如实报错（不静默当从头） */
export function parseActivityId(id: string): number {
  if (!id.startsWith(ID_PREFIX) || !/^\d+$/.test(id.slice(ID_PREFIX.length))) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-cursor', `无法解释的游标/活动 id：${id}`)
  }
  const n = Number(id.slice(ID_PREFIX.length))
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-cursor', `游标/活动 id 越界：${id}`)
  }
  return n
}

function isPlatformActivity(v: unknown): v is PlatformActivity {
  if (!isPlainObject(v)) return false
  if (
    typeof v['id'] !== 'string' ||
    typeof v['ts'] !== 'string' ||
    typeof v['issue'] !== 'string' ||
    typeof v['kind'] !== 'string'
  ) {
    return false
  }
  const actor = v['actor']
  return actor === undefined || typeof actor === 'string'
}

function loadActivities(path: string): PlatformActivity[] {
  return readJsonl(path).map((line, i) => {
    if (!isPlatformActivity(line)) {
      throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-activity', `${path}: 第 ${i + 1} 行不是合法活动记录`)
    }
    return line
  })
}

export function readActivities(root: string): PlatformActivity[] {
  return loadActivities(activityPath(root)).sort((x, y) => parseActivityId(x.id) - parseActivityId(y.id))
}

/** 下一个活动 id（末行 max+1） */
export function nextActivityId(root: string): string {
  let max = 0
  for (const act of loadActivities(activityPath(root))) {
    const n = parseActivityId(act.id)
    if (n > max) max = n
  }
  return formatActivityId(max + 1)
}

export interface ActivityInput {
  issue: TicketId
  kind: string
  actor?: string
}

/** 追加一条活动（id 单调递增；写入面只被 gateway 调用的纪律由上层保证） */
export function appendActivity(root: string, now: () => string, input: ActivityInput): PlatformActivity {
  const act: PlatformActivity = {
    id: nextActivityId(root),
    ts: now(),
    issue: input.issue,
    kind: input.kind,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
  }
  appendJsonl(activityPath(root), act)
  return act
}

/** since(cursor)：返回 id 严格大于 cursor 的活动（升序），超出 pageSize 分页 */
export function activitySince(root: string, cursor: string | null, pageSize: number): ActivityPage {
  const after = cursor === null ? 0 : parseActivityId(cursor)
  const fresh = readActivities(root).filter((a) => parseActivityId(a.id) > after)
  if (fresh.length <= pageSize) {
    return { items: fresh, nextCursor: null }
  }
  const items = fresh.slice(0, pageSize)
  const last = items[items.length - 1]
  // slice 后必非空（fresh.length > pageSize ≥ 1），last 收窄仅安抚 noUncheckedIndexedAccess
  return { items, nextCursor: last === undefined ? null : last.id }
}
