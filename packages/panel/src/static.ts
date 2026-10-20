/**
 * static —— /vendor/* 与 /ui/* 两条静态路由（DEV-1 方案 §3.3；本刀唯一新增 IO 文件）
 *
 * 依据：docs/37-§5.1 路线 I（vendor 进仓 + 一条静态路由直引）、docs/37-§8「服务器层
 * 零改动（只加静态文件路由）」、docs/17-§8（:8787 端面——本文件不碰 /api/*，只读面不变）。
 *
 * 安全口径（穿越/泄漏防护，测试面见 test/shell-static.test.ts）：
 *   /vendor/:file —— 精确白名单（三件 vendor 文件名），拒一切其他取值；文件名不含
 *     路径分隔符，无目录可穿越；不列目录；首次读入后进程内缓存（总量 ~3.8 MiB）。
 *   /ui/*        —— 扩展名白名单（.js/.mjs/.css）+ 解码后逐段拒绝 `..`/反斜杠/NUL +
 *     path.resolve 前缀校验 + realpath 防符号链接逃逸；只暴露 packages/panel/ui/ 之下，
 *     src/、test/、package.json、vendor/ 均不可达。
 *
 * 缓存口径：vendor 文件名不变、内容随版本换——按 URL 查询串 ?v= 失效，故 immutable 年缓存；
 *   ui 模块随时改——no-cache + ETag（W/"mtime-size"）+ If-None-Match 304。
 */
import { readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'

/** vendor 白名单（与 vendor.lock.json 的 file 字段一一对应；改 lock 时同步改这里） */
export const VENDOR_FILES: readonly string[] = ['vue.esm-browser.prod.js', 'naive-ui.prod.mjs', 'echarts.esm.min.js']

/** /ui/* 允许的扩展名（前端模块与样式；未来加 .map 再议——不默认放开） */
const UI_EXTENSIONS = new Set(['.js', '.mjs', '.css'])

/** 扩展名 → content-type（charset 统一 utf-8） */
function contentTypeOf(file: string): string {
  const ext = path.extname(file)
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  return 'application/octet-stream'
}

/** mountPanelStatic 选项 */
export interface PanelStaticOptions {
  /** panel 包根（缺省 = 本文件所在 src/ 的上一级，即 packages/panel/） */
  packageRoot?: string
}

/** 默认包根：src/static.ts → ../ = packages/panel/（vendor/ 与 ui/ 都在包根下） */
function defaultPackageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

/** /ui/* 相对段校验：解码后任一段为 `..`/`.`、含反斜杠或 NUL 即拒（返回 null） */
function safeUiRelative(rawPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null // 半截百分号编码——恶意或坏客户端，一律 404
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segments = decoded.split('/')
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) return null
  if (path.extname(decoded) === '' || !UI_EXTENSIONS.has(path.extname(decoded))) return null
  return segments.join('/')
}

/**
 * 挂静态路由：/vendor/:file（白名单三件）与 /ui/*（ui 模块目录）。
 * GET/HEAD 同路由；404 一律 c.text('not found', 404)，不 fallback 到 /。
 */
export function mountPanelStatic(app: Hono, opts?: PanelStaticOptions): void {
  const packageRoot = path.resolve(opts?.packageRoot ?? defaultPackageRoot())
  const vendorRoot = path.join(packageRoot, 'vendor')
  const uiRoot = path.join(packageRoot, 'ui')

  // vendor 进程内缓存：文件名白名单锁死、内容随版本换文件，读一次即稳定（~3.8 MiB）
  const vendorCache = new Map<string, Buffer>()

  app.on(['GET', 'HEAD'], '/vendor/:file', async (c) => {
    const file = c.req.param('file')
    if (!VENDOR_FILES.includes(file)) return c.text('not found', 404)
    let bytes = vendorCache.get(file)
    if (bytes === undefined) {
      try {
        bytes = await readFile(path.join(vendorRoot, file))
      } catch {
        return c.text('not found', 404) // vendor 缺失（未跑 vendor-pull/被删）——不臆造内容
      }
      vendorCache.set(file, bytes)
    }
    const headers: Record<string, string> = {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    }
    return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(bytes), { status: 200, headers })
  })

  app.on(['GET', 'HEAD'], '/ui/*', async (c) => {
    // c.req.path 是原始（未解码）pathname：以 /ui/ 前缀截下相对部分再解码校验
    const rawPath = c.req.path
    if (!rawPath.startsWith('/ui/')) return c.text('not found', 404)
    const relative = safeUiRelative(rawPath.slice('/ui/'.length))
    if (relative === null) return c.text('not found', 404)

    let resolvedRoot: string
    try {
      resolvedRoot = realpathSync(uiRoot)
    } catch {
      return c.text('not found', 404) // ui/ 目录缺失（本刀新增目录，不应发生——防御）
    }
    // 候选路径从 realpath 根拼（macOS 上 /var 与 /private/var 这类别名就不打架了），
    // 再 realpath 一次：ui/ 内符号链接指向目录外即 404（前缀闸）
    const absolute = path.resolve(resolvedRoot, relative)
    let resolved: string
    try {
      resolved = realpathSync(absolute)
    } catch {
      return c.text('not found', 404)
    }
    if (!(resolved + path.sep).startsWith(resolvedRoot + path.sep)) return c.text('not found', 404)

    let info
    try {
      info = await stat(resolved)
    } catch {
      return c.text('not found', 404)
    }
    if (!info.isFile()) return c.text('not found', 404)

    const etag = `W/"${String(Math.round(info.mtimeMs))}-${String(info.size)}"`
    const headers: Record<string, string> = {
      'content-type': contentTypeOf(resolved),
      'content-length': String(info.size),
      'cache-control': 'no-cache',
      etag,
      'x-content-type-options': 'nosniff',
    }
    if (c.req.header('If-None-Match') === etag) return new Response(null, { status: 304, headers })

    try {
      const bytes = await readFile(resolved)
      return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(bytes), { status: 200, headers })
    } catch {
      // stat 与 read 之间被删等竞态：如实 404
      return c.text('not found', 404)
    }
  })
}
