/**
 * 评论面 —— issues/<id>.comments.md 追加块（含署名行）。
 *
 * 块格式（机器头 + 人读体，追加-only）：
 *   <!-- comment {"id":"c-000001","created":"…","author":"…"} -->
 *   <正文，可多行，逐字保留>
 *   <署名行（=SignedBody.signature，单行）>
 *   <!-- /comment c-000001 -->
 *
 * v1.2 迁移（2026-10-17，宰相执行——docs/25-§3.2 裁决）：SignedBody.author 是归因
 * 一等公民（工号），signature 只是展示形态；Comment.author 取 body.author，
 * 署名行仍落 signature（人读）。上游 gateway 负责注入。
 * 注入防护：正文/署名伪造 `<!-- /comment` 行会被拒（CONFIG_INVALID），防解析串道。
 */
import type { Comment, SignedBody, TicketId } from '@studio-next/contract'
import { appendActivity } from './activity.ts'
import { LocalPlatformError } from './errors.ts'
import { appendLine, readTextIfExists } from './fsutil.ts'
import { commentsPath } from './layout.ts'
import { getIssue } from './issues.ts'

const HEADER_PREFIX = '<!-- comment '
const FOOTER_PREFIX = '<!-- /comment '
const ID_PREFIX = 'c-'
const ID_WIDTH = 6

interface CommentMeta {
  id: string
  created: string
  author: string
}

export function listComments(root: string, id: TicketId): Comment[] {
  const text = readTextIfExists(commentsPath(root, id))
  if (text === null) return []
  const lines = text.split('\n')
  const out: Comment[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith(HEADER_PREFIX)) {
      if (!line.endsWith(' -->')) {
        throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-comments', `${commentsPath(root, id)}: 评论头行损坏`)
      }
      let meta: CommentMeta
      try {
        const parsed = JSON.parse(line.slice(HEADER_PREFIX.length, line.length - ' -->'.length)) as unknown
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as Record<string, unknown>)['id'] !== 'string' ||
          typeof (parsed as Record<string, unknown>)['created'] !== 'string' ||
          typeof (parsed as Record<string, unknown>)['author'] !== 'string'
        ) {
          throw new Error('shape')
        }
        meta = parsed as CommentMeta
      } catch (err) {
        throw new LocalPlatformError(
          'CONFIG_INVALID',
          'corrupt-comments',
          `${commentsPath(root, id)}: 评论头行不是合法元数据：${String(err)}`,
        )
      }
      const inner: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').startsWith(FOOTER_PREFIX)) {
        inner.push(lines[i] ?? '')
        i += 1
      }
      if (i >= lines.length) {
        throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-comments', `${commentsPath(root, id)}: 评论块缺结束标记`)
      }
      inner.pop() // 末行是署名行（author 已在头行元数据里，这里只剥离）
      out.push({ id: meta.id, issue: id, author: meta.author, body: inner.join('\n'), created: meta.created })
    }
    i += 1
  }
  return out
}

export function addComment(root: string, now: () => string, id: TicketId, body: SignedBody): void {
  getIssue(root, id) // 单不存在 → EXTERNAL_REJECT
  if (typeof body.author !== 'string' || typeof body.body !== 'string' || typeof body.signature !== 'string') {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-signed-body', '评论 author/body/signature 必须是字符串')
  }
  if (body.author.includes('\n') || body.signature.includes('\n')) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-signed-body', 'author 与署名必须是单行')
  }
  const author = body.author.trim() === '' ? 'unknown' : body.author
  for (const line of [...body.body.split('\n'), body.signature]) {
    if (line.startsWith(FOOTER_PREFIX)) {
      throw new LocalPlatformError('CONFIG_INVALID', 'bad-signed-body', '正文/署名不得伪造评论结束标记行')
    }
  }
  const nextNo = listComments(root, id).length + 1
  const cid = `${ID_PREFIX}${String(nextNo).padStart(ID_WIDTH, '0')}`
  const meta: CommentMeta = { id: cid, created: now(), author }
  const block = [HEADER_PREFIX + JSON.stringify(meta) + ' -->', body.body, body.signature, `${FOOTER_PREFIX}${cid} -->`].join('\n')
  appendLine(commentsPath(root, id), block)
  appendActivity(root, now, { issue: id, kind: 'commented', actor: author })
}
