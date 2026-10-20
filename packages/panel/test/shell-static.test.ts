/**
 * 换装刀一测试：Vue 页壳（shell.ts）+ 静态路由（static.ts）+ vendor 进仓完整性。
 * 依据：DEV-1 方案 §3.3/§3.4/§10、docs/37-§5.1（路线 I：vendor 进仓零构建直引）。
 *
 * 纯函数面直接断言字符串；路由面用独立 Hono app + 显式 packageRoot（指向真实包根——
 * vendor 三件与 ui/ 模块都在仓里），不依赖 createPanelApp 的 ledger 注入。
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  PANEL_IMPORTMAP,
  PANEL_UI_ENTRY,
  VENDOR_FILES,
  mountPanelStatic,
  renderDashboardShell,
} from '../src/index.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = path.join(packageRoot, 'vendor')

function makeApp(): Hono {
  const app = new Hono()
  mountPanelStatic(app, { packageRoot })
  return app
}

// —— 页壳（纯函数） ——

describe('renderDashboardShell / PANEL_IMPORTMAP（shell.ts）', () => {
  it('importmap 三项映射：vue / naive-ui / echarts → /vendor/ 白名单文件（带 ?v=）', () => {
    expect(Object.keys(PANEL_IMPORTMAP).sort()).toEqual(['echarts', 'naive-ui', 'vue'])
    for (const target of Object.values(PANEL_IMPORTMAP)) {
      expect(target).toMatch(/^\/vendor\/[a-z0-9.\-]+\.m?js\?v=\d+\.\d+\.\d+$/)
    }
  })

  it('页壳：#app 挂载点 + importmap 脚本 + /ui/main.js 模块入口 + boot-error/noscript 指向 /legacy', () => {
    const html = renderDashboardShell()
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<script type="importmap">')
    expect(html).toContain(JSON.stringify({ imports: PANEL_IMPORTMAP }, null, 2))
    expect(html).toContain('<div id="app">')
    expect(html).toContain(`src="${PANEL_UI_ENTRY}"`)
    expect(html).toContain('id="boot-error"')
    expect(html).toContain('<noscript>')
    expect(html).toContain('href="/legacy"')
    // 兜底文案留在 #app 内（模块加载失败时可见，不白屏）
    const appStart = html.indexOf('<div id="app">')
    const appEnd = html.indexOf('</div>', appStart)
    expect(html.slice(appStart, appEnd)).toContain('boot-error')
  })
})

// —— vendor 进仓完整性（补丁携带产物的诚实闸） ——

describe('vendor 进仓完整性（vendor.lock.json ↔ 文件实存）', () => {
  it('三件 vendor 字节数与 SHA-256 与 lock 逐一相符', async () => {
    const lock = JSON.parse(await readFile(path.join(vendorRoot, 'vendor.lock.json'), 'utf8')) as Record<
      string,
      { file: string; bytes: number; sha256: string }
    >
    for (const file of VENDOR_FILES) {
      const entry = Object.values(lock).find((e) => e.file === file)
      expect(entry, `lock 缺 ${file}`).toBeDefined()
      const bytes = await readFile(path.join(vendorRoot, file))
      expect(bytes.length).toBe(entry!.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry!.sha256)
    }
  })
})

// —— 静态路由（/vendor/:file 白名单 + /ui/* 目录服务） ——

describe('GET /vendor/:file（白名单三件）', () => {
  it('白名单文件 200：JS 类型 + immutable 年缓存 + 全量字节', async () => {
    const app = makeApp()
    for (const file of VENDOR_FILES) {
      const res = await app.request(`/vendor/${file}`)
      expect(res.status, file).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      const bytes = Buffer.from(await res.arrayBuffer())
      const onDisk = await readFile(path.join(vendorRoot, file))
      expect(bytes.length).toBe(onDisk.length)
      expect(bytes.equals(onDisk)).toBe(true)
    }
  })

  it('白名单外一律 404：未知名 / 换扩展 / 编码穿越（..）/ 目录', async () => {
    const app = makeApp()
    for (const bad of [
      '/vendor/evil.js',
      '/vendor/vue.esm-browser.prod.js.bak',
      '/vendor/%2e%2e/package.json',
      '/vendor/%2e%2e%2fsrc%2fstatic.ts',
      '/vendor/',
    ]) {
      const res = await app.request(bad)
      expect(res.status, bad).toBe(404)
    }
    // 命中 /vendor/:file 路由但白名单拒掉的：正文是本路由的 'not found'
    for (const handler404 of ['/vendor/evil.js', '/vendor/vue.esm-browser.prod.js.bak']) {
      const res = await app.request(handler404)
      expect(await res.text()).toBe('not found')
    }
  })

  it('HEAD 同路由无响应体', async () => {
    const app = makeApp()
    const res = await app.request('/vendor/vue.esm-browser.prod.js', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String((await stat(path.join(vendorRoot, 'vue.esm-browser.prod.js'))).size))
    expect(await res.text()).toBe('')
  })
})

describe('GET /ui/*（模块目录服务）', () => {
  it('ui 模块 200：JS 类型 + no-cache + ETag（W/"mtime-size"）', async () => {
    const app = makeApp()
    const res = await app.request('/ui/main.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const etag = res.headers.get('etag')
    expect(etag).toMatch(/^W\/"\d+-\d+"$/)
    const info = await stat(path.join(packageRoot, 'ui', 'main.js'))
    expect(etag).toBe(`W/"${String(Math.round(info.mtimeMs))}-${String(info.size)}"`)
  })

  it('If-None-Match 命中 → 304 空体', async () => {
    const app = makeApp()
    const first = await app.request('/ui/main.js')
    const etag = first.headers.get('etag')
    const again = await app.request('/ui/main.js', { headers: { 'If-None-Match': etag ?? '' } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
  })

  it('扩展名白名单（.js/.mjs/.css）之外与不存在文件 404', async () => {
    const app = makeApp()
    for (const bad of ['/ui/main.ts', '/ui/nope.js', '/ui/', '/ui/README.md', '/ui/lib/']) {
      const res = await app.request(bad)
      expect(res.status, bad).toBe(404)
      expect(await res.text()).toBe('not found')
    }
  })

  it('穿越防御：.. 段（明文与编码）逃出 /ui 即 404，src/test/package.json 不可达', async () => {
    const app = makeApp()
    for (const bad of [
      '/ui/%2e%2e/src/static.ts',
      '/ui/%2e%2e/%2e%2e/%2e%2e/src/static.ts',
      '/ui/..%2F..%2Fpackage.json',
      '/ui/lib/%2e%2e/%2e%2e/%2e%2e/package.json',
      '/ui/%2e%2e/test/corpus.ts',
      '/ui/%2e%2e/src/shell.ts',
    ]) {
      const res = await app.request(bad)
      expect(res.status, bad).toBe(404)
    }
    // 明文 ../ 由 URL 规范化折掉——路由不匹配即 404（双保险之一总兜得住）
    const straight = await app.request('/ui/../package.json')
    expect(straight.status).toBe(404)
  })

  it('深层 ui 模块可达（lib/composables/charts/components 子目录）', async () => {
    const app = makeApp()
    for (const file of ['lib/feed.js', 'charts/options.js', 'components/ChartCard.js']) {
      const res = await app.request(`/ui/${file}`)
      expect(res.status, file).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    }
  })

  it('HEAD 同路由无响应体', async () => {
    const app = makeApp()
    const res = await app.request('/ui/main.js', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})
