/**
 * chat 面板 v3 增强端测试（docs/plan/11-公司门户-2026-11-23.md §十.3——panel 包加法式可选参）。
 *
 * 覆盖：linkify 纯函数（LINK_RE 白名单正则＋linkifySegments 分段＋isSafeLinkHref href 白名单——
 * 正则只认 https?://，其余 textContent 无 innerHTML）；page-script 新配置透传（draft/room/
 * peopleUrl 进 CONFIG；缺省零变化——v2 第一刀行为不动）；draft/room 注入面的 node --check
 * 语法门（新参数不破内联脚本）；房间/消息过滤与 @补全的 DOM 锚点。夹具/判例沿用 chat-panel.test.ts。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { LINK_RE_SOURCE, chatPageScript, isSafeLinkHref, linkifySegments, renderChatPage } from '../../src/chat/index.ts'

describe('linkify 纯函数（TS 单源本体——白名单只认 https?://）', () => {
  const re = new RegExp(LINK_RE_SOURCE, 'g') // LINK_RE 本体模块内私有；SOURCE 是唯一冻结出口
  it('LINK_RE（经 SOURCE 重建）：https 命中；javascript:/data:/ftp 不命中；尾随标点不入链接', () => {
    expect('文档见 https://example.com/a?b=1#c 好'.match(re)).toEqual(['https://example.com/a?b=1#c'])
    expect('javascript:alert(1)'.match(re)).toBe(null)
    expect('JAVASCRIPT:alert(1)'.match(re)).toBe(null)
    expect('data:text/html,x'.match(re)).toBe(null)
    expect('ftp://a.b/c'.match(re)).toBe(null)
    expect('http://localhost:8800/x_y'.match(re)).toEqual(['http://localhost:8800/x_y'])
    expect('见 https://a.b/c.'.match(re)).toEqual(['https://a.b/c']) // 尾点不入
    expect('(https://a.b/c)'.match(re)).toEqual(['https://a.b/c']) // 尾括号不入
    expect('https://a.b/c, 然后'.match(re)).toEqual(['https://a.b/c']) // 尾逗号不入
  })

  it('LINK_RE_SOURCE 可再拼正则（页面脚本经 CONFIG 注入同一 source——单源）', () => {
    expect(re.source).toBe(LINK_RE_SOURCE)
    expect(LINK_RE_SOURCE.startsWith('^')).toBe(false) // 全局搜索式（非锚定）
    expect(LINK_RE_SOURCE.startsWith('https?:')).toBe(true) // 白名单：只认 http(s) scheme
  })

  it('linkifySegments：链接段与文本段交替；kind=link 带 href、text 段带原文', () => {
    const segs = linkifySegments('看 https://example.com/x 与 javascript:alert(1)')
    expect(segs.map((s) => s.kind)).toEqual(['text', 'link', 'text'])
    expect(segs[0]?.kind === 'text' ? segs[0].text : '').toBe('看 ')
    expect(segs[1]?.kind === 'link' ? segs[1].href : '').toBe('https://example.com/x')
    expect(segs[2]?.kind === 'text' ? segs[2].text : '').toBe(' 与 javascript:alert(1)')
    // 纯文本段单段
    expect(linkifySegments('无链接正文')).toEqual([{ kind: 'text', text: '无链接正文' }])
    // 全链接
    const one = linkifySegments('https://a.b/c')
    expect(one).toEqual([{ kind: 'link', href: 'https://a.b/c' }])
  })

  it('isSafeLinkHref：href 属性白名单（^https?://）——script: 冒充链接被拒', () => {
    expect(isSafeLinkHref('https://a.b/c')).toBe(true)
    expect(isSafeLinkHref('HTTP://A.B/C')).toBe(true) // 大小写不敏感
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkHref(' data:text/html,x')).toBe(false)
    expect(isSafeLinkHref('//a.b/c')).toBe(false)
  })
})

describe('page-script v3 配置（draft/room/peopleUrl——加法式可选参）', () => {
  const scriptOf = (opts: Parameters<typeof chatPageScript>[0]): string => chatPageScript(opts)
  const configOf = (html: string): string => /var CONFIG = (\{.*?\});/s.exec(html)?.[1] ?? ''

  it('draft/room/peopleUrl 全给：CONFIG 逐一注入', () => {
    const config = configOf(
      scriptOf({ enabled: true, actor: 'PRIME-0', pollIntervalMs: 3000, draft: 'hi', room: 'room-1', peopleUrl: '/api/org' }),
    )
    expect(config).toContain('"draft":"hi"')
    expect(config).toContain('"room":"room-1"')
    expect(config).toContain('"peopleUrl":"/api/org"')
  })

  it('缺省零变化：未给 draft/room/peopleUrl 时 CONFIG 不含这三个键（v2 行为不动）', () => {
    const config = configOf(scriptOf({ enabled: true, actor: 'panel', pollIntervalMs: 3000 }))
    expect(config).not.toContain('"draft"')
    expect(config).not.toContain('"room"')
    expect(config).not.toContain('"peopleUrl"')
    expect(config).toContain('"actor":"panel"')
  })

  it('draft/room 含 < 时经 CONFIG 转义（\\u003c）——用户数据不串出脚本', () => {
    const config = configOf(scriptOf({ enabled: true, actor: 'panel', pollIntervalMs: 3000, draft: 'a<b', room: 'r<x>' }))
    expect(config).toContain('"draft":"a\\u003cb"')
    expect(config).toContain('"room":"r\\u003cx>"') // 只转义 <（> 无脚本逃逸面——JSON 内无终结符风险）
    expect(config).not.toContain('a<b')
  })

  it('带新参数的内联脚本仍过 node --check 语法门（draft/room/peopleUrl 注入不破语法）', () => {
    const html = renderChatPage({ enabled: true, defaultActorId: 'PRIME-0', draft: 'hi', room: 'room-1', peopleUrl: '/api/org' })
    const match = /<script>([\s\S]*?)<\/script>/.exec(html)
    expect(match).not.toBeNull()
    const root = mkdtempSync(path.join(tmpdir(), 'chat-v3-syntax-'))
    try {
      const probe = path.join(root, 'page.mjs')
      writeFileSync(probe, match?.[1] ?? '')
      expect(() => execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' })).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('页面锚点：房间过滤 #roomFilter、消息过滤 #msgFilter+#msgCount、@补全 #mentionBox', () => {
    const html = renderChatPage({ enabled: true, defaultActorId: 'panel' })
    expect(html).toContain('id="roomFilter"')
    expect(html).toContain('id="msgFilter"')
    expect(html).toContain('id="msgCount"')
    expect(html).toContain('id="mentionBox"')
    // 脚本面：@补全（fetch CONFIG.peopleUrl）与消息高亮 <mark>、appendRichText linkify
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
    expect(script).toContain('ensurePeople')
    expect(script).toContain('detectMention')
    expect(script).toContain('mark')
    expect(script).toContain('appendRichText')
    expect(script).toContain('isSafeLink')
    expect(script).toContain('LINK_SOURCE')
  })
})

describe('v3 transport 类型面（ChatScriptConfig 导出稳定——portal 侧装配依赖）', () => {
  it('chatPageScript 可用最小配置渲染（enabled/actor/pollIntervalMs 必填）', () => {
    const script = chatPageScript({ enabled: true, actor: 'panel', pollIntervalMs: 5000 })
    expect(script).toContain('var CONFIG =')
    expect(script).toContain('"actor":"panel"')
    expect(script).toContain('"pollIntervalMs":5000')
  })
})
