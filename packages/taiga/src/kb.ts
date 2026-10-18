/**
 * 知识库面 —— Taiga wiki 即 KB（docs/30 §6 ⑧：公司=项目，wiki 页=知识文档）。
 *
 *   get    GET /api/v1/wiki/by_slug?slug=&project=（真机实测路径；path 即 wiki slug，
 *          支持多级如 guide/deploy——Taiga slug 允许斜杠）
 *   search GET /api/v1/wiki?project= 分页拉全量 → slug/正文子串匹配（大小写不敏感；
 *          Taiga 无 wiki 检索端点，客户端过滤，与 localplatform v0 同式；
 *          实测列表响应内嵌 content，无二次拉取）
 *   upsert **本切片显式未实现**（写面只做 issues+comments；POST /wiki 真机已实证
 *          可行——docs/32 §二⑧——落地在 onboard 切片）
 */
import type { KbHit } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { TaigaPlatformError, notImplemented } from './errors.ts'
import { asArray, asObject, optString, reqString } from './shape.ts'

const SNIPPET_WIDTH = 160
const SNIPPET_CONTEXT = 32

interface WikiPage {
  slug: string
  content: string
}

function parseWikiPage(v: unknown): WikiPage {
  const o = asObject(v, 'wiki')
  return { slug: reqString(o, 'slug', 'wiki'), content: optString(o, 'content') ?? '' }
}

function requireSlug(path: string): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'kb-path-invalid', 'kb 路径（=wiki slug）必须非空')
  }
  if (path.startsWith('/') || path.endsWith('/') || path.includes('..')) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径非法：${path}`)
  }
  return path
}

export async function kbGet(ctx: TaigaContext, path: string): Promise<string> {
  const slug = requireSlug(path)
  const projectId = await ctx.project()
  try {
    const res = await ctx.client.request({
      method: 'GET',
      path: '/wiki/by_slug',
      query: { slug, project: String(projectId) },
    })
    return parseWikiPage(res.json).content
  } catch (err) {
    if (err instanceof TaigaPlatformError && err.subcause === 'not-found') {
      throw new TaigaPlatformError('EXTERNAL_REJECT', 'kb-not-found', `kb 文档不存在：${path}`)
    }
    throw err
  }
}

function extractTitle(body: string, slug: string): string {
  for (const line of body.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line)
    if (m !== null && m[1] !== undefined) return m[1].trim()
  }
  return slug
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

export async function kbSearch(ctx: TaigaContext, q: string): Promise<KbHit[]> {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  const projectId = await ctx.project()
  const pages = await ctx.client.paginate(
    { method: 'GET', path: '/wiki', query: { project: String(projectId) } },
    (v) => asArray(v, 'wiki-list').map(parseWikiPage),
    100,
  )
  const hits: KbHit[] = []
  for (const page of pages.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const hit = page.slug.toLowerCase().includes(needle) || page.content.toLowerCase().includes(needle)
    if (!hit) continue
    hits.push({ path: page.slug, title: extractTitle(page.content, page.slug), snippet: buildSnippet(page.content, needle) })
  }
  return hits
}

export async function kbUpsert(_path: string, _md: string): Promise<void> {
  throw notImplemented('kb-upsert', '写面本切片只做 issues+comments；POST /wiki 真机已实证（docs/32 §二⑧），落地在 onboard 切片')
}
