/**
 * 评论面 —— YouTrack comments API（docs/25-§3.2 v1.2：SignedBody.author 一等公民）
 *
 * 文本编码（add 写入、list 解析，同一约定两向互逆）：
 *   <!-- actor: {author} -->     ← 机器头：工号（Comment.author 由此派生——YouTrack
 *                                  comment.author 是 token 账号（bot），不是工号）
 *   {body 逐字保留，可多行}
 *   {signature 单行}            ← 署名展示形态（[公司·部门·岗位·级别]，gateway 注入）
 *
 * 依据：docs/25-§3.2 裁决 3——author 派生 Comment.author、signature 只是展示；
 * 非本适配器写入的外来评论（无机器头）：author=平台 author.login（缺省 unknown）、
 * body=全文（含末行，不剥离署名）。
 * 分页：comments 列表 $top/$skip（docs/03 N10 防坑）。
 */
import { z } from 'zod'
import type { Comment, SignedBody, TicketId } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import type { YtHttpClient } from './http.ts'
import { fetchIssueJson } from './issues.ts'

const COMMENT_PAGE_SIZE = 100
const MAX_COMMENT_PAGES = 1000

const ACTOR_HEAD_RE = /^<!-- actor: (\S+) -->\n?/

const commentJsonSchema = z.looseObject({
  id: z.string(),
  text: z.string(),
  created: z.number(),
  author: z.looseObject({ login: z.string().optional() }).optional(),
})
type CommentJson = z.infer<typeof commentJsonSchema>

/** 正文/署名不得伪造机器头行（解析串道防护，对齐 localplatform 纪律） */
function validateSignedBody(body: SignedBody): void {
  if (typeof body.author !== 'string' || typeof body.body !== 'string' || typeof body.signature !== 'string') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-signed-body', '评论 author/body/signature 必须是字符串')
  }
  if (body.author.includes('\n') || body.author.trim() === '' || /\s/.test(body.author)) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-signed-body', 'author 必须是单行非空无空白工号')
  }
  if (body.signature.includes('\n')) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-signed-body', '署名必须是单行')
  }
  for (const line of [...body.body.split('\n'), body.signature]) {
    if (ACTOR_HEAD_RE.test(line)) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-signed-body', '正文/署名不得伪造 actor 机器头行')
    }
  }
}

export async function addComment(http: YtHttpClient, id: TicketId, body: SignedBody): Promise<void> {
  await fetchIssueJson(http, id) // 单不存在 → EXTERNAL_REJECT / issue-not-found
  validateSignedBody(body)
  const text = `<!-- actor: ${body.author} -->\n${body.body}\n${body.signature}`
  await http.request(commentJsonSchema, {
    method: 'POST',
    path: `/api/issues/${encodeURIComponent(id)}/comments`,
    query: { fields: 'id,text,created,author(login)' },
    body: { text },
  })
}

/** YouTrack comment JSON → Comment（机器头剥离/署名行剥离/author 派生） */
function toComment(issue: TicketId, json: CommentJson): Comment {
  const m = ACTOR_HEAD_RE.exec(json.text)
  if (m === null) {
    return {
      id: json.id,
      issue,
      author: json.author?.login ?? 'unknown',
      body: json.text,
      created: new Date(json.created).toISOString(),
    }
  }
  const rest = json.text.slice(m[0].length)
  const lines = rest.split('\n')
  lines.pop() // 末行=署名行（展示形态剥离；body 逐字保留）
  return {
    id: json.id,
    issue,
    author: m[1] ?? 'unknown',
    body: lines.join('\n'),
    created: new Date(json.created).toISOString(),
  }
}

export async function listComments(http: YtHttpClient, id: TicketId): Promise<Comment[]> {
  const out: Comment[] = []
  let skip = 0
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const batch = await http.request(z.array(commentJsonSchema), {
      method: 'GET',
      path: `/api/issues/${encodeURIComponent(id)}/comments`,
      query: { fields: 'id,text,created,author(login)', $top: String(COMMENT_PAGE_SIZE), $skip: String(skip) },
    })
    out.push(...batch.map((c) => toComment(id, c)))
    if (batch.length < COMMENT_PAGE_SIZE) return out
    skip += COMMENT_PAGE_SIZE
  }
  throw new YouTrackPlatformError(
    'CONFIG_INVALID',
    'pagination-runaway',
    `comments 翻页超过 ${String(MAX_COMMENT_PAGES)} 页仍未取尽（$skip 可能被实例忽略，N10）`,
  )
}
