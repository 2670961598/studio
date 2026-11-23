/**
 * 公司门户 v3 第二刀全局面测试（docs/plan/11-公司门户-2026-11-23.md §十.3/§十.4/§十.5）。
 *
 * 断言面对契约：全局搜索 SEARCH_FN「提取脚本段在 Node 里跑」（chat-panel 判例）＋壳层
 * 注入面（导航/脚注/data-people）；会话详情首事件时间（缺 createdAt 显示「时间未知」，
 * 不冒 1970）；/chat?draft=/room= 预填与 peopleUrl 注入（@补全开启）；聊天 linkify
 * 正则白名单（从页面脚本提取 LINK_SOURCE 在 Node 里跑——https 命中/js 不命中/尾标点不入）。
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { ChatAppOptions, ChatPanelTransport } from '@studio-next/panel/chat'
import { createPortalApp, mountCompany } from '../../../../src/assembly/portal/server.ts'
import { createPortalData } from '../../../../src/assembly/portal/data.ts'
import type { DecompressFn } from '../../../../src/assembly/portal/sessions-transcript.ts'
import { dropTree, makeTree, type PortalTree } from './fixtures.ts'
import { SESS1_ID, seedSessions } from './sessions-fixtures.ts'

const VERSION = '0.1.0-test'
/** fake 解压：夹具把明文 JSONL 写进 .zstd 位（与 sessions-fixtures 同判例） */
const fakeDecompress: DecompressFn = async (file) => ({ ok: true, text: readFileSync(file, 'utf8'), truncated: false })

/** chatd transport 假体（/chat 装配与 rooms 面够用即可） */
const fakeTransport: ChatPanelTransport = {
  async listRooms(input) {
    if (input.token !== 'secret-token') throw new Error('unauthorized')
    return [
      { roomId: 'room-1', kind: 'broadcast', name: '全员', memberIds: ['ENG-1', 'PRIME-0'], headRoomSeq: 5 },
      { roomId: 'r2', kind: 'group', name: '研发', memberIds: ['ENG-1'], headRoomSeq: 1 },
    ]
  },
  async listMessages() {
    return { items: [], nextCursor: null, hasMore: false }
  },
  async sendMessage() {
    throw new Error('not-implemented')
  },
  async read() {
    throw new Error('not-implemented')
  },
  async inbox() {
    return { actorId: 'PRIME-0', unread: 0, mentions: 0, pendingWakeIds: [], rooms: [] }
  },
}

let tree: PortalTree
let bareTree: PortalTree
let app: Hono // 全装（平台在、会话在、chatd mock）
let bareApp: Hono // 降级装（平台缺、chatd 无）

async function makeApp(t: PortalTree, platformRoot: string | null, chat: ChatAppOptions): Promise<Hono> {
  const mounted = await mountCompany(t.companyDir)
  return createPortalApp({
    data: createPortalData({
      company: mounted.snapshot,
      companyDir: t.companyDir,
      mission: mounted.mission,
      platformRoot,
      ledger: t.ledger,
      chatStats: async () => ({ available: chat.transport !== null, rooms: 2, messages: 6 }),
      ...(platformRoot !== null ? { sessionDecompress: fakeDecompress } : {}),
    }),
    chat,
    version: VERSION,
  })
}

beforeAll(async () => {
  tree = makeTree('sn-portal-v3-')
  seedSessions(tree)
  app = await makeApp(tree, tree.platformRoot, { transport: fakeTransport, token: 'secret-token', defaultActorId: 'PRIME-0' })
  bareTree = makeTree('sn-portal-v3-bare-')
  bareApp = await makeApp(bareTree, null, { transport: null, defaultActorId: 'PRIME-0' })
})

afterAll(() => {
  dropTree(tree)
  dropTree(bareTree)
})

const htmlOf = async (a: Hono, pathAndQuery: string): Promise<string> => (await a.request(pathAndQuery)).text()

describe('§十.4 壳层全局搜索（SEARCH_FN 提取执行＋注入面）', () => {
  /** 从渲染页提取 SEARCH_FN 函数体并在 Node 里跑（前端行为非纸面断言——chat-panel 判例） */
  const searchFnOf = async (page: string): Promise<(value: string, people: string[]) => string | null> => {
    const start = page.indexOf('var SEARCH_FN = function (value, people) {')
    expect(start).toBeGreaterThan(-1)
    const end = page.indexOf('} /*SEARCH_FN_END*/;', start)
    expect(end).toBeGreaterThan(start)
    const body = page.slice(start + 'var SEARCH_FN = '.length, end + '}'.length)
    return new Function(`return ${body}`)() as (value: string, people: string[]) => string | null
  }

  it('SEARCH_FN：工号（大小写不敏感）→ /sessions?person=；非工号 → /tickets?q=；空值 null', async () => {
    const searchFn = await searchFnOf(await htmlOf(app, '/'))
    expect(searchFn('ENG-1', ['ENG-1', 'QA-1'])).toBe('/sessions?person=ENG-1')
    expect(searchFn('eng-1', ['ENG-1'])).toBe('/sessions?person=eng-1') // 大小写不敏感全等
    expect(searchFn('PORTAL-1', ['ENG-1'])).toBe('/tickets?q=PORTAL-1')
    expect(searchFn('登录页', ['ENG-1'])).toBe(`/tickets?q=${encodeURIComponent('登录页')}`)
    expect(searchFn('', ['ENG-1'])).toBe(null)
    expect(searchFn('  ', ['ENG-1'])).toBe(null)
    expect(searchFn('x', [])).toBe('/tickets?q=x')
    expect(searchFn('a&b', [])).toBe(`/tickets?q=${encodeURIComponent('a&b')}`) // encodeURIComponent 防注入
  })

  it('壳层注入面：五页＋/console 均有 #globalSearch（data-people=org 工号）＋导航「指令台」＋脚注', async () => {
    for (const path of ['/', '/tickets', '/org', '/reports', '/sessions', '/console']) {
      const html = await htmlOf(app, path)
      expect(html).toContain('id="globalSearchForm"')
      expect(html).toContain('id="globalSearch"')
      expect(html).toContain('data-people="[')
      expect(html).toContain('href="/console"')
      expect(html).toContain('foot-note')
      expect(html).toContain('指令台＝经聊天唤醒')
    }
    // data-people 内容＝org 名册工号（服务端注入、esc 转义）
    const html = await htmlOf(app, '/')
    expect(html).toContain('data-people="[')
    expect(html).toMatch(/data-people="\[[^\]]*&quot;ENG-1&quot;[^\]]*\]"/)
  })

  it('降级装（无 org 数据不可——org 恒在）：bareApp 仍有搜索框与 people', async () => {
    const html = await htmlOf(bareApp, '/')
    expect(html).toContain('id="globalSearch"')
    expect(html).toContain('data-people="[')
  })
})

describe('§十.4 会话详情首事件时间（1970 bug 修复面）', () => {
  const SESS3_ID = 'session-33333333-3333-4333-8333-333333333333'
  const T3 = Date.parse('2026-11-22T12:00:00.000Z')
  let t3Tree: PortalTree
  let t3App: Hono

  beforeAll(async () => {
    // 独立树：首事件（session）缺 time 与 createdAt（归一化落 0 → 修前渲染 1970-01-01）；
    // 第二事件带 time（须照常渲染）——契约：缺时事件显示「时间未知」，全文不冒 1970。
    t3Tree = makeTree('sn-portal-v3-t1970-')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const path = await import('node:path')
    const att = path.join(t3Tree.root, '.AIWS', 'departments', '研发部', 'ENG-1', 'tickets', 'SESS-3', 'att1')
    mkdirSync(path.join(att, '.dsh-home', 'sessions', 'ws-host-secret', SESS3_ID), { recursive: true })
    writeFileSync(path.join(att, 'brief.md'), '# 任务书 SESS-3\n')
    const lines = [
      JSON.stringify({ seq: 1, type: 'session', data: { id: SESS3_ID, version: 4, cwd: '/tmp/ws' } }), // 无 time／无 createdAt
      JSON.stringify({ seq: 2, time: T3 + 1000, type: 'user/message', data: { content: [{ type: 'text', text: '首事件时间修复检查' }] } }),
    ]
    writeFileSync(path.join(att, '.dsh-home', 'sessions', 'ws-host-secret', SESS3_ID, 'session.v4.jsonl.zstd'), `${lines.join('\n')}\n`)
    // 平台补 SESS-3 单（档案索引按工位树×平台单闭合——同 sessions-fixtures 判例）
    writeFileSync(
      path.join(t3Tree.platformRoot, 'issues', 'SESS-3.jsonl'),
      [
        JSON.stringify({ type: 'created', ts: '2026-11-22T11:00:00.000Z', state: '已派发', input: { title: '首事件时间检查单', description: '无业务含义。', type: 'devtask', dept: 'departments/研发部', level: 2, assignee: 'ENG-1', lane: 'core' } }),
        '',
      ].join('\n'),
    )
    t3App = await makeApp(t3Tree, t3Tree.platformRoot, { transport: null, defaultActorId: 'PRIME-0' })
  })

  afterAll(() => {
    dropTree(t3Tree)
  })

  it('首事件缺 time/createdAt：渲染「时间未知」，全文不冒 1970／Invalid Date', async () => {
    const html = await htmlOf(t3App, '/sessions/SESS-3/att1')
    expect(html).toContain('时间未知')
    expect(html).not.toContain('1970')
    expect(html).not.toContain('Invalid Date')
    expect(html).not.toContain('NaN')
    expect(html).toContain('首事件时间修复检查')
  })
})

describe('§十.3 /chat 预填与 @补全注入（panel 包加法式参数）', () => {
  it('/chat?draft=hi：CONFIG 注入 draft；无参时无 draft 键', async () => {
    const withDraft = await htmlOf(app, '/chat?draft=hi')
    expect(withDraft).toContain('"draft":"hi"')
    const noDraft = await htmlOf(app, '/chat')
    expect(noDraft).not.toContain('"draft"')
  })

  it('/chat?room=r1：CONFIG 注入 room（页面进入即选房间）；未知 room 不注入', async () => {
    expect(await htmlOf(app, '/chat?room=r1')).toContain('"room":"r1"')
    expect(await htmlOf(app, '/chat?room=')).not.toContain('"room":')
  })

  it('peopleUrl=/api/org 注入（@补全开启）＋draft 经服务端净化（控制字符剥离）', async () => {
    expect(await htmlOf(app, '/chat')).toContain('"peopleUrl":"/api/org"')
    const dirty = await htmlOf(app, '/chat?draft=a%0Ab')
    expect(dirty).toContain('"draft":"ab"')
    expect(dirty).not.toContain('"draft":"a\\nb"') // 净化面：CONFIG JSON 不落 \n 字面转义
  })
})

describe('§十.3 聊天 linkify 白名单（LINK_SOURCE 从页面脚本提取执行）', () => {
  /** 提取 var LINK_SOURCE = "…" 并 new RegExp 跑白名单 */
  const linkReOf = async (page: string): Promise<RegExp> => {
    const m = /var LINK_SOURCE = ("(?:[^"\\]|\\.)*")/.exec(page)
    expect(m).not.toBeNull()
    const source = JSON.parse(m?.[1] ?? '""') as string
    return new RegExp(source, 'g')
  }

  it('https 命中；javascript:/data: 不命中；尾随标点不入链接', async () => {
    const re = await linkReOf(await htmlOf(app, '/chat'))
    expect('看 https://example.com/a?b=1 好'.match(re)).toEqual(['https://example.com/a?b=1'])
    expect('javascript:alert(1)'.match(re)).toBe(null)
    expect('data:text/html,<b>x</b>'.match(re)).toBe(null)
    expect('see https://a.b/c.'.match(re)).toEqual(['https://a.b/c']) // 尾点不入
    expect('(https://a.b/c)'.match(re)).toEqual(['https://a.b/c']) // 尾括号不入
    expect('http://localhost:8800/x_y'.match(re)).toEqual(['http://localhost:8800/x_y'])
    expect('ftp://a.b/c'.match(re)).toBe(null) // 非 http(s) 白名单外
  })

  it('脚本含 isSafeLink 二次校验（href 白名单防线不在正则一层收口）', async () => {
    const page = await htmlOf(app, '/chat')
    expect(page).toContain('isSafeLink')
    expect(page).toMatch(/target\s*=\s*['"]_blank['"]/)
    expect(page).toContain('noopener')
  })
})

describe('§十.4 单子/会话详情操作区（指令台＋聊天预填＋复制）', () => {
  it('/tickets/PORTAL-1：指令台按钮（person=assignee&ticket）、聊天 draft 预填、复制单号/链接', async () => {
    const html = await htmlOf(app, '/tickets/PORTAL-1')
    expect(html).toContain('href="/console?person=ENG-1&ticket=PORTAL-1"')
    expect(html).toContain('让负责人处理（指令台）')
    // draft 预填 href：url() 编码面（解回原文比对，避免与 encodeURIComponent 逐字符耦合）
    const draftHref = /href="(\/chat\?draft=[^"]+)"/.exec(html)?.[1] ?? ''
    expect(draftHref.startsWith('/chat?draft=')).toBe(true)
    expect(decodeURIComponent(draftHref.slice('/chat?draft='.length))).toBe('关于 PORTAL-1（登录页改版：支持暗色主题）：')
    expect(html).toContain('在聊天中询问')
    expect(html).toContain('data-copy="PORTAL-1"')
    expect(html).toContain('data-copy-link="/tickets/PORTAL-1"')
  })

  it(`/sessions/SESS-1/att1：指令台按钮（person=ENG-1&ticket=SESS-1）＋聊天 draft`, async () => {
    const html = await htmlOf(app, `/sessions/SESS-1/att1?sessionId=${SESS1_ID}`)
    expect(html).toContain('href="/console?person=ENG-1&ticket=SESS-1"')
    expect(html).toMatch(/href="\/chat\?draft=[^"]+"/)
  })
})
