/**
 * 知识库面 —— kb/**.md 树（任意深度 .md 文件）。
 *
 * search 用标题/路径/正文**子串匹配**（大小写不敏感）——v0 够用即可；
 * 升级路径：倒排索引或外接全文检索（如 SQLite FTS5），端口接口不变。
 * 搜索结果按路径排序，快照截断到固定窗宽，保证确定性。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { KbHit } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'
import { ensureDir, fileExists } from './fsutil.ts'
import { kbRoot } from './layout.ts'

const SNIPPET_WIDTH = 160
const SNIPPET_CONTEXT = 32

function resolveKbPath(root: string, path: string): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new LocalPlatformError('CONFIG_INVALID', 'kb-path-invalid', 'kb 路径必须非空')
  }
  if (!path.endsWith('.md')) {
    throw new LocalPlatformError('CONFIG_INVALID', 'kb-path-invalid', `kb 路径必须是 .md 文件：${path}`)
  }
  const base = resolve(kbRoot(root))
  const full = resolve(base, path)
  if (full === base || !full.startsWith(base + sep)) {
    throw new LocalPlatformError('CONFIG_INVALID', 'kb-path-escape', `kb 路径越出知识库根：${path}`)
  }
  return full
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function collectMdFiles(dir: string, base: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) collectMdFiles(full, base, out)
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(relative(base, full))
  }
}

function extractTitle(body: string, rel: string): string {
  for (const line of body.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line)
    if (m !== null && m[1] !== undefined) return m[1].trim()
  }
  return basename(rel).replace(/\.md$/, '')
}

function clip(s: string): string {
  return s.length > SNIPPET_WIDTH ? `${s.slice(0, SNIPPET_WIDTH)}…` : s
}

function buildSnippet(body: string, needle: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  if (needle === '') return clip(flat)
  const idx = flat.toLowerCase().indexOf(needle)
  if (idx < 0) return clip(flat) // 命中在标题/路径，正文从头截
  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const head = start > 0 ? '…' : ''
  return head + clip(flat.slice(start, start + SNIPPET_WIDTH))
}

export function kbUpsert(root: string, path: string, md: string): void {
  if (typeof md !== 'string') {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-kb-body', 'kb 正文必须是字符串')
  }
  const full = resolveKbPath(root, path)
  ensureDir(dirname(full))
  writeFileSync(full, md, 'utf8')
}

export function kbGet(root: string, path: string): string {
  const full = resolveKbPath(root, path)
  if (!fileExists(full) || !statSync(full).isFile()) {
    throw new LocalPlatformError('EXTERNAL_REJECT', 'kb-not-found', `kb 文档不存在：${path}`)
  }
  return readFileSync(full, 'utf8')
}

export function kbSearch(root: string, q: string): KbHit[] {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  const base = kbRoot(root)
  if (!fileExists(base)) return []
  const rels: string[] = []
  collectMdFiles(base, base, rels)
  rels.sort()
  const hits: KbHit[] = []
  for (const rel of rels) {
    const relPosix = toPosix(rel)
    const body = readFileSync(join(base, rel), 'utf8')
    const title = extractTitle(body, rel)
    const hit =
      relPosix.toLowerCase().includes(needle) ||
      title.toLowerCase().includes(needle) ||
      body.toLowerCase().includes(needle)
    if (!hit) continue
    hits.push({ path: relPosix, title, snippet: buildSnippet(body, needle) })
  }
  return hits
}
