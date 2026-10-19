/**
 * 知识库面 —— Taiga wiki 即 KB（docs/30 §6 ⑧：公司=项目，wiki 页=知识文档）。
 *
 *   path→slug 映射（2026-10-19 真机实测修正）：**Taiga wiki slug 不允许斜杠和点**
 *      （Django SlugField：仅 Unicode 字母/数字/下划线/连字符——POST /wiki 带
 *      'a/b' 或 '.md' 均为 400，证据 probe-evidence/taiga-links
 *      manifest「slug 探针」三条）。首刀头注「slug 允许斜杠」系未实测假设，作废。
 *      端口 path（树形，如 guide/deploy.md）统一折平：'/' 与 '.' 归一为 '-'、
 *      首尾剥净、折叠重复（get/upsert/search 三面同规则，读写对称）；折平后
 *      'guide/deploy' 与 'guide-deploy' 同页——已知合并语义，消费方须知。
 *
 *   get    GET /api/v1/wiki/by_slug?slug=&project=（真机实测路径）
 *   search GET /api/v1/wiki?project= 分页拉全量 → slug/正文子串匹配（大小写不敏感；
 *          Taiga 无 wiki 检索端点，客户端过滤，与 localplatform v0 同式；
 *          实测列表响应内嵌 content，无二次拉取）
 *   upsert 按 slug 幂等写（onboard 写面三件之一，2026-10-19 落地；真机端点形状
 *          全部经 probe-evidence/taiga-links P60-P66 核验）：
 *          ① GET by_slug 探测——不存在 → POST /wiki {project, slug, content}（201，
 *             version=1；重复 slug 是 400 __all__，P65——所以必须先探测不盲 POST）
 *          ② 已存在且内容一致 → 不发写（真机 PATCH 会推 version/editions，幂等
 *             重入必须短路，两跑同结果的关键）
 *          ③ 已存在且内容有变 → PATCH /wiki/{id} {content, version}——version 是
 *             wiki 页自身乐观并发号（缺/错均 400 "The version parameter is not
 *             valid"，P61/P62；成功 version+1、editions+1，P63）
 */
import type { KbHit } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { TaigaPlatformError } from './errors.ts'
import { asArray, asObject, optString, reqNumber, reqString } from './shape.ts'

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

/** 端口 path → Taiga wiki slug（树形折平；三面同规则保证读写对称） */
function pathToSlug(path: string): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'kb-path-invalid', 'kb 路径必须非空')
  }
  if (path.startsWith('/') || path.endsWith('/') || path.includes('..')) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径非法：${path}`)
  }
  // 尾缀 '.md' 先剥（与 localplatform kb/**.md 树对齐：'guide/deploy.md' ≡ 'guide/deploy'）
  const stripped = path.endsWith('.md') ? path.slice(0, -3) : path
  const slug = stripped
    .replace(/[/.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径折平后为空 slug：${path}`)
  }
  return slug
}

export async function kbGet(ctx: TaigaContext, path: string): Promise<string> {
  const slug = pathToSlug(path)
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

export async function kbUpsert(ctx: TaigaContext, path: string, md: string): Promise<void> {
  const slug = pathToSlug(path)
  if (typeof md !== 'string') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-kb-body', 'kb 正文必须是字符串')
  }
  const projectId = await ctx.project()
  // ① 探测（404 = 不存在，走建页；其余错误照抛）
  let page: { id: number; content: string; version: number } | null = null
  try {
    const res = await ctx.client.request({ method: 'GET', path: '/wiki/by_slug', query: { slug, project: String(projectId) } })
    const o = asObject(res.json, 'wiki')
    page = { id: reqNumber(o, 'id', 'wiki'), content: optString(o, 'content') ?? '', version: reqNumber(o, 'version', 'wiki') }
  } catch (err) {
    if (!(err instanceof TaigaPlatformError && err.subcause === 'not-found')) throw err
  }
  if (page === null) {
    await ctx.client.request({ method: 'POST', path: '/wiki', body: { project: projectId, slug, content: md } })
    return
  }
  // ② 内容一致即幂等短路（不推 version/editions）；③ 有变才 PATCH（带页自身 version）
  if (page.content === md) return
  await ctx.client.request({ method: 'PATCH', path: `/wiki/${String(page.id)}`, body: { content: md, version: page.version } })
}
