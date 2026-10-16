/**
 * 知识库面 —— YouTrack articles 端点（docs/03：articles 读写已实测可用）
 *
 * 路径↔文章树映射（v0 约定）：
 *   - kb 路径 `a/b/标题.md` = 文章树位置：父链=各段 summary，叶子=去 .md 的 summary
 *   - resolve：列表全量（$top/$skip 翻页）建索引，按 (父id, summary) 逐段下钻；
 *     同父同名歧义 → 显式报错（YouTrack 不保证 summary 唯一——v0 已知局限）
 *   - upsert：缺的中间层与叶子逐级创建（POST /api/articles，parentArticle 挂父），
 *     已存在叶子改 content（POST /api/articles/{id}）
 *   - search：服务端 query 参数 + 客户端路径重建与快照截断（对齐 localplatform 呈现：
 *     路径升序、快照固定窗宽，保证确定性）
 */
import { z } from 'zod'
import type { KbHit } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import type { YtHttpClient } from './http.ts'

const KB_PAGE_SIZE = 100
const MAX_KB_PAGES = 1000
const SNIPPET_WIDTH = 160
const SNIPPET_CONTEXT = 32

const ARTICLE_LIST_FIELDS = 'id,summary,parentArticle(id)'

const articleListSchema = z.looseObject({
  id: z.string(),
  summary: z.string(),
  parentArticle: z.looseObject({ id: z.string().optional() }).nullable().optional(),
})
type ArticleListNode = z.infer<typeof articleListSchema>

interface ArticleIndex {
  /** id → 节点 */
  byId: Map<string, ArticleListNode>
  /** `父id|summary` → id（父为根时键 `|summary`） */
  byParentAndSummary: Map<string, string>
}

/** kb 路径纪律（对齐 localplatform）：非空、.md 结尾、不越界、无空段 */
function validateKbPath(path: string): { segments: string[]; title: string } {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'kb-path-invalid', 'kb 路径必须非空')
  }
  if (!path.endsWith('.md')) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径必须是 .md 文件：${path}`)
  }
  const segments = path.slice(0, -'.md'.length).split('/')
  if (segments.some((s) => s.trim() === '') || path.startsWith('/') || segments.includes('..')) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'kb-path-escape', `kb 路径不合法（空段/越界）：${path}`)
  }
  const title = segments[segments.length - 1]
  if (title === undefined || title.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径叶子段必须非空：${path}`)
  }
  return { segments, title }
}

async function listArticles(http: YtHttpClient, fields: string): Promise<ArticleListNode[]> {
  const out: ArticleListNode[] = []
  let skip = 0
  for (let page = 0; page < MAX_KB_PAGES; page++) {
    const batch = await http.request(z.array(articleListSchema), {
      method: 'GET',
      path: '/api/articles',
      query: { fields, $top: String(KB_PAGE_SIZE), $skip: String(skip) },
    })
    out.push(...batch)
    if (batch.length < KB_PAGE_SIZE) return out
    skip += KB_PAGE_SIZE
  }
  throw new YouTrackPlatformError(
    'CONFIG_INVALID',
    'pagination-runaway',
    `articles 翻页超过 ${String(MAX_KB_PAGES)} 页仍未取尽（$skip 可能被实例忽略，N10）`,
  )
}

function buildIndex(nodes: ReadonlyArray<ArticleListNode>): ArticleIndex {
  const byId = new Map<string, ArticleListNode>()
  const byParentAndSummary = new Map<string, string>()
  for (const n of nodes) {
    byId.set(n.id, n)
    const parentKey = n.parentArticle?.id ?? ''
    const key = `${parentKey}|${n.summary}`
    if (byParentAndSummary.has(key)) {
      throw new YouTrackPlatformError(
        'CONFIG_INVALID',
        'kb-ambiguous-path',
        `同名兄弟文章歧义：${n.summary}（YouTrack 不保证 summary 唯一——v0 已知局限）`,
      )
    }
    byParentAndSummary.set(key, n.id)
  }
  return { byId, byParentAndSummary }
}

/** 沿路径下钻，返回已存在的最长路径与最后落点 id（缺段由 upsert 逐级补建） */
function walkPath(index: ArticleIndex, segments: ReadonlyArray<string>): { deepestId: string | null; resolved: number } {
  let current: string | null = null
  let resolved = 0
  for (const seg of segments) {
    const next = index.byParentAndSummary.get(`${current ?? ''}|${seg}`)
    if (next === undefined) break
    current = next
    resolved += 1
  }
  return { deepestId: current, resolved }
}

async function createArticle(
  http: YtHttpClient,
  summary: string,
  content: string,
  parentId: string | null,
): Promise<string> {
  const created = await http.request(
    z.looseObject({ id: z.string(), summary: z.string().optional() }),
    {
      method: 'POST',
      path: '/api/articles',
      query: { fields: 'id,summary' },
      body: { summary, content, ...(parentId === null ? {} : { parentArticle: { id: parentId } }) },
    },
  )
  return created.id
}

async function updateArticleContent(http: YtHttpClient, id: string, content: string): Promise<void> {
  await http.request(z.looseObject({ id: z.string(), summary: z.string().optional() }), {
    method: 'POST',
    path: `/api/articles/${encodeURIComponent(id)}`,
    query: { fields: 'id,summary' },
    body: { content },
  })
}

export async function kbUpsert(http: YtHttpClient, path: string, md: string): Promise<void> {
  if (typeof md !== 'string') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-kb-body', 'kb 正文必须是字符串')
  }
  const { segments, title } = validateKbPath(path)
  const nodes = await listArticles(http, ARTICLE_LIST_FIELDS)
  const index = buildIndex(nodes)
  const { deepestId, resolved } = walkPath(index, segments)
  if (resolved === segments.length) {
    // 整条路径已存在：deepestId 即叶子——覆盖 content，不新建
    await updateArticleContent(http, deepestId as string, md)
    return
  }
  // 有缺段：补缺的中间层与叶子（resolved 段已存在，其后逐级创建）
  let parentId = deepestId
  for (let i = resolved; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (seg === undefined) break
    parentId = await createArticle(http, seg, '', parentId)
  }
  await createArticle(http, title, md, parentId)
}

/** 叶子路径 → 文章 id（不存在显式报错） */
async function resolveLeaf(http: YtHttpClient, path: string): Promise<string> {
  const { segments } = validateKbPath(path)
  const index = buildIndex(await listArticles(http, ARTICLE_LIST_FIELDS))
  const { deepestId, resolved } = walkPath(index, segments)
  if (resolved < segments.length) {
    throw new YouTrackPlatformError('EXTERNAL_REJECT', 'kb-not-found', `kb 文档不存在：${path}`)
  }
  return deepestId as string
}

export async function kbGet(http: YtHttpClient, path: string): Promise<string> {
  const id = await resolveLeaf(http, path)
  const article = await http.request(z.looseObject({ id: z.string(), content: z.string() }), {
    method: 'GET',
    path: `/api/articles/${encodeURIComponent(id)}`,
    query: { fields: 'id,summary,content' },
  })
  return article.content
}

function clip(s: string): string {
  return s.length > SNIPPET_WIDTH ? `${s.slice(0, SNIPPET_WIDTH)}…` : s
}

function buildSnippet(body: string, needle: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  if (needle === '') return clip(flat)
  const idx = flat.toLowerCase().indexOf(needle)
  if (idx < 0) return clip(flat)
  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const head = start > 0 ? '…' : ''
  return head + clip(flat.slice(start, start + SNIPPET_WIDTH))
}

export async function kbSearch(http: YtHttpClient, q: string): Promise<KbHit[]> {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  const found = await http.request(
    z.array(z.looseObject({ id: z.string(), summary: z.string(), content: z.string().optional() })),
    {
      method: 'GET',
      path: '/api/articles',
      query: { query: q, fields: 'id,summary,content', $top: String(KB_PAGE_SIZE), $skip: '0' },
    },
  )
  if (found.length === 0) return []
  // 路径重建：全量索引 + 父链回溯
  const index = buildIndex(await listArticles(http, ARTICLE_LIST_FIELDS))
  const hits: KbHit[] = []
  for (const f of found) {
    const segs: string[] = []
    let cur = index.byId.get(f.id)
    while (cur !== undefined) {
      segs.unshift(cur.summary)
      const parentId = cur.parentArticle?.id
      cur = parentId === undefined ? undefined : index.byId.get(parentId)
    }
    hits.push({
      path: `${segs.join('/')}.md`,
      title: f.summary,
      snippet: buildSnippet(f.content ?? '', needle),
    })
  }
  hits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return hits
}
