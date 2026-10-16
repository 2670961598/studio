/**
 * 链接面 —— meta/links.jsonl（append-only，一行一链 {a,b,type,ts}）。
 *
 * children(id) 的两个来源取并集（去重、按单号升序）：
 *   1. link(id, b, 'parent-child') 显式链（a 为父）
 *   2. 单据 parent 字段（IssueCreate.parent / setField('parent', …)）
 * 两视图独立维护（link 不回写 parent 字段），语义都以「父←子」聚合呈现。
 */
import type { LinkType, TicketId } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'
import { appendJsonl, isPlainObject, readJsonl } from './fsutil.ts'
import { linksPath } from './layout.ts'
import { compareTicketIds, getIssue, listIssues } from './issues.ts'

interface LinkRecord {
  a: TicketId
  b: TicketId
  type: LinkType
  ts: string
}

const LINK_TYPES: readonly LinkType[] = ['parent-child', 'depends-on', 'relates-to']

function isLinkRecord(v: unknown): v is LinkRecord {
  if (!isPlainObject(v)) return false
  return (
    typeof v['a'] === 'string' &&
    typeof v['b'] === 'string' &&
    LINK_TYPES.includes(v['type'] as LinkType) &&
    typeof v['ts'] === 'string'
  )
}

function loadLinks(root: string): LinkRecord[] {
  return readJsonl(linksPath(root)).map((line, i) => {
    if (!isLinkRecord(line)) {
      throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-links', `${linksPath(root)}: 第 ${i + 1} 行不是合法链接`)
    }
    return line
  })
}

export function addLink(root: string, now: () => string, a: TicketId, b: TicketId, type: LinkType): void {
  if (!LINK_TYPES.includes(type)) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-link-type', `未知链接类型：${String(type)}`)
  }
  if (a === b) {
    throw new LocalPlatformError('CONFIG_INVALID', 'self-link', `链接两端不能是同一单据：${a}`)
  }
  getIssue(root, a)
  getIssue(root, b) // 单不存在 → EXTERNAL_REJECT
  appendJsonl(linksPath(root), { a, b, type, ts: now() })
}

export function childTickets(root: string, id: TicketId): TicketId[] {
  const set = new Set<TicketId>()
  for (const rec of loadLinks(root)) {
    if (rec.a === id && rec.type === 'parent-child') set.add(rec.b)
  }
  for (const rec of listIssues(root, {})) {
    if (rec.parent === id) set.add(rec.id)
  }
  return [...set].sort(compareTicketIds)
}
