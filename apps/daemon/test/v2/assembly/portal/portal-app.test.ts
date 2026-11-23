/**
 * 公司门户端面测试（docs/plan/11-公司门户-2026-11-23.md §1.2 页面规格／§1.3 API／
 * §三 数据来源·降级矩阵·安全）。
 *
 * 全部走 createPortalApp(...).request() 进程内直打（不占端口）；夹具见 fixtures.ts。
 * 断言面对契约（页面端点/降级不冒充/XSS 转义/错误码），不对实现细节。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { ChatPanelTransport, ChatAppOptions } from '@studio-next/panel/chat'
import { createPortalApp, mountCompany } from '../../../../src/assembly/portal/server.ts'
import { createPortalData, extractMission } from '../../../../src/assembly/portal/data.ts'
import { dropTree, makeTree, seedEvent, type PortalTree } from './fixtures.ts'

const VERSION = '0.1.0-test'
let tree: PortalTree
let app: Hono // 全装（平台在、chatd 无）
let bareApp: Hono // 降级装（平台缺、chatd 无）
let chatApp: Hono // 全装＋chatd mock

/** chatd transport 假体（listRooms/inbox 供统计与未读徽标；listMessages 按房间成员校验——
 *  非成员抛 WB_INVALID_ARGUMENT，复刻真 chatd「actor is not a room member」；其余面抛错即可） */
const fakeTransport: ChatPanelTransport = {
  async listRooms(input) {
    if (input.token !== 'secret-token') throw new Error('unauthorized')
    return [
      { roomId: 'r1', kind: 'broadcast', name: '研发部', memberIds: ['ENG-1', 'PRIME-0'], headRoomSeq: 12 },
      { roomId: 'r2', kind: 'group', name: '大厅', memberIds: ['ENG-1', 'QA-1'], headRoomSeq: 3 },
    ]
  },
  async listMessages(input) {
    const members: Record<string, readonly string[]> = { r1: ['ENG-1', 'PRIME-0'], r2: ['ENG-1', 'QA-1'] }
    if (!(members[input.roomId] ?? []).includes(input.actorId)) {
      // 真 chatd 的成员校验错带 WB 码（classifyChatFailure 只认 err.code——消息文本不猜码）
      const err = new Error('actor is not a room member') as Error & { code: string }
      err.code = 'WB_INVALID_ARGUMENT'
      throw err
    }
    return { items: [{ seq: 1, roomSeq: 1, roomId: input.roomId, senderId: 'ENG-1', body: '[fixture] hello', mentions: [], createdAt: 1_700_000_000_000 }], nextCursor: null, hasMore: false }
  },
  async sendMessage() {
    throw new Error('not-implemented')
  },
  async read() {
    throw new Error('not-implemented')
  },
  async inbox(input) {
    // 未读聚合：PRIME-0 在 r1 有 2 条未读（导航徽标面）；其余 0
    const rooms = input.actorId === 'PRIME-0' ? [{ roomId: 'r1', unread: 2, pendingWakes: 0 }] : []
    return { actorId: input.actorId, unread: rooms.reduce((s, r) => s + r.unread, 0), mentions: 0, pendingWakeIds: [], rooms }
  },
}

async function makeApp(tree: PortalTree, platformRoot: string | null, chat: ChatAppOptions): Promise<Hono> {
  // mountCompany 同步快照（校验不过抛错——夹具必须合法）
  const mounted = await mountCompany(tree.companyDir)
  return createPortalApp({
    data: createPortalData({
      company: mounted.snapshot,
      companyDir: tree.companyDir,
      mission: mounted.mission,
      platformRoot,
      ledger: tree.ledger,
      chatStats: async () =>
        chat.transport === null
          ? { available: false, rooms: 0, messages: 0 }
          : { available: true, rooms: 2, messages: 15 },
    }),
    chat,
    version: VERSION,
  })
}

beforeAll(async () => {
  tree = makeTree('sn-portal-app-')
  const now = Date.now()
  seedEvent(tree.ledger, { ts: now, event: 'HEARTBEAT' })
  seedEvent(tree.ledger, { ts: now - 60_000, event: 'DISPATCH', issue: 'PORTAL-1', note: 'intent=dispatch|PORTAL-1' })
  seedEvent(tree.ledger, { ts: now - 120_000, event: 'CLOSE', issue: 'PORTAL-1', cost_usd: 1.25 })
  seedEvent(tree.ledger, { ts: now - 3 * 24 * 3_600_000, event: 'PATROL', issue: 'PORTAL-3' })
  app = await makeApp(tree, tree.platformRoot, { transport: null, defaultActorId: 'panel' })
  bareApp = await makeApp(tree, null, { transport: null, defaultActorId: 'panel' })
  // chatd 已配：缺省操作者=门户缺省在册工号（与 CLI --chat-actor 缺省同源；见 portal-cli.test）
  chatApp = await makeApp(tree, tree.platformRoot, { transport: fakeTransport, token: 'secret-token', defaultActorId: 'PRIME-0' })
})

afterAll(() => {
  dropTree(tree)
})

const htmlOf = async (a: Hono, pathAndQuery: string): Promise<string> => (await a.request(pathAndQuery)).text()
const jsonOf = async (a: Hono, pathAndQuery: string): Promise<unknown> => (await a.request(pathAndQuery)).json()

describe('页面端面（五页同端口）', () => {
  it('概览：hero 公司名/使命、统计卡、最近活动滤心跳、最近单子、组织摘要、快捷入口', async () => {
    const html = await htmlOf(app, '/')
    expect(html).toContain('<h1>门户测试公司</h1>')
    expect(html).toContain('用一条可验证的交付链，把需求变成有证据的产出')
    expect(html).toContain('单子总数')
    expect(html).toContain('进行中')
    expect(html).toContain('已交付')
    expect(html).toContain('今日台账事件')
    expect(html).toContain('daemon 在线')
    expect(html).toContain('最近活动')
    expect(html).toContain('已滤心跳')
    expect(html).toContain('最近单子')
    expect(html).toContain('组织摘要')
    expect(html).toContain('快捷入口')
    // hero 平台 chip：读 PlatformBinding.platform（可读名），不串成 [object Object]
    expect(html).toContain('平台 localfile')
    expect(html).not.toContain('[object Object]')
    // 活动滤心跳：DISPATCH/CLOSE 在、HEARTBEAT 徽标不在（/api/activity 才是原始流）
    expect(html).toContain('DISPATCH')
    expect(html).toContain('CLOSE')
    expect(html).not.toContain('>HEARTBEAT<')
  })

  it('单子列表：表头七列、状态 chips 带计数、单号链接', async () => {
    const html = await htmlOf(app, '/tickets')
    expect(html).toContain('<th>单号</th>')
    expect(html).toContain('<th>标题</th>')
    expect(html).toContain('<th>状态</th>')
    expect(html).toContain('<th>负责人</th>')
    expect(html).toContain('<th>部门</th>')
    expect(html).toContain('<th>泳道</th>')
    expect(html).toContain('<th>更新</th>')
    expect(html).toContain('href="/tickets/PORTAL-1"')
    // 页头副题：公司 slug＋平台全树只读——host 绝对路径不出页面（§三.安全）
    expect(html).toContain('portal-demo 平台全树 · 只读')
    expect(html).not.toContain(tree.platformRoot)
    expect(html).not.toContain('平台 /')
    // chips：全部 3 ＋ 三态各一（计数药丸等高同基线）
    expect(html).toContain('全部<span class="count num">3</span>')
    expect(html).toContain('已派发<span class="count num">1</span>')
    expect(html).toContain('已交付<span class="count num">1</span>')
    expect(html).toContain('Archived<span class="count num">1</span>')
  })

  it('状态筛选＋搜索＋分页参数联动', async () => {
    const state = await htmlOf(app, '/tickets?state=Archived')
    expect(state).toContain('href="/tickets/PORTAL-3"')
    expect(state).not.toContain('href="/tickets/PORTAL-1"')
    const search = await htmlOf(app, '/tickets?q=登录页')
    expect(search).toContain('href="/tickets/PORTAL-1"')
    expect(search).not.toContain('href="/tickets/PORTAL-3"')
    const none = await htmlOf(app, '/tickets?q=不存在的关键字')
    expect(none).toContain('没有匹配的单子')
    // 分页：page 越界钳到末页
    const page = await htmlOf(app, '/tickets?page=99&size=10')
    expect(page).toContain('第 1/1 页')
    // 搜索框保留关键字；state 旧参并入多选 chips（§十.2：checkbox checked 保留勾选）
    const kept = await htmlOf(app, '/tickets?state=Archived&q=旧巡逻')
    expect(kept).toContain('name="q" value="旧巡逻"')
    expect(kept).toContain('name="states" value="Archived" checked')
  })

  it('单子详情：meta 网格、时间线三类事件与状态推进高亮', async () => {
    const html = await htmlOf(app, '/tickets/PORTAL-1')
    expect(html).toContain('返回单子列表')
    expect(html).toContain('<dt>类型</dt>')
    // 部门短名（不露 departments/ 路径前缀）；等级与组织页同款 .lvl 徽标（L<n> 统一）
    expect(html).toContain('<dt>部门</dt><dd>研发部</dd>')
    expect(html).toContain('<span class="lvl">L2</span>')
    // 本单无父单：整行隐藏（原「父单 —」占位）
    expect(html).not.toContain('<dt>父单</dt>')
    expect(html).toContain('事件时间线')
    expect(html).toContain('3 条事件')
    expect(html).toContain('创建单据')
    expect(html).toContain('状态推进')
    expect(html).toContain('tl-state highlight')
    expect(html).toContain('字段写入')
    expect(html).toContain('泳道</code>')
    expect(html).toContain('<code>qa</code>')
    // 时间线推进：新单 → 已派发
    expect(html).toContain('新单')
    expect(html).toContain('已派发')
    // 本单无验收段：不出验收卡
    expect(html).not.toContain('验收口径')
  })

  it('验收口径拆段：PORTAL-2 描述与验收分开渲染；有父单才出行', async () => {
    const html = await htmlOf(app, '/tickets/PORTAL-2')
    expect(html).toContain('验收口径</h2>')
    expect(html).toContain('闸门 exit=0')
    // 「## 验收口径」标题行不残留在描述卡
    expect(html).not.toContain('## 验收口径')
    // 父单存在：行渲染＋指向上级的链接
    expect(html).toContain('<dt>父单</dt><dd><a class="mono" href="/tickets/PORTAL-1">PORTAL-1</a></dd>')
  })

  it('组织：部门树（嵌套缩进）＋人员名册五列', async () => {
    const html = await htmlOf(app, '/org')
    expect(html).toContain('部门树')
    expect(html).toContain('人员名册')
    expect(html).toContain('<th>工号</th>')
    expect(html).toContain('<th>姓名</th>')
    expect(html).toContain('<th>部门</th>')
    expect(html).toContain('<th>等级</th>')
    expect(html).toContain('<th>登录名</th>')
    expect(html).toContain('工程师甲')
    expect(html).toContain('平台组')
    expect(html).toContain('负责人 工程师甲（ENG-1）')
  })

  it('报表：列表跳过占位件、指向查看端；查看渲染文本与元信息', async () => {
    const list = await htmlOf(app, '/reports')
    expect(list).toContain('2026-11-20-report-a.md')
    expect(list).toContain('reports/研发部/run.sh')
    expect(list).not.toContain('.gitkeep')
    expect(list).not.toContain('.DS_Store')
    const view = await htmlOf(app, `/reports/view?path=${encodeURIComponent('reports/研发部/2026-11-21-report-b.txt')}`)
    expect(view).toContain('返回报表列表')
    expect(view).toContain('纯文本报表')
    expect(view).toContain('<pre class="file-pre">')
  })

  it('报表：服务端 q 过滤＋limit 截断＋范围分页（1500+ 件不整页倾倒）', async () => {
    // 未筛：总数＋搜索框在顶部；4 件 < 缺省 100 → 不出「显示前」、不出分页器
    const all = await htmlOf(app, '/reports')
    expect(all).toContain('公司目录 reports/ 下共 4 个文件')
    expect(all).not.toContain('显示前')
    expect(all).not.toContain('class="pager"')
    expect(all).toMatch(/<form class="search" method="get" action="\/reports">/)
    // limit 截断：头部标「显示前 N」，分页器给范围/总数/页码，翻页链接续传 q/limit
    const capped = await htmlOf(app, '/reports?q=&limit=2')
    expect(capped).toContain('公司目录 reports/ 下共 4 个文件（显示前 2）')
    expect(capped).toContain('第 1–2 条 / 共 4 条 · 第 1/2 页')
    expect(capped).toContain('href="/reports?limit=2&amp;page=2"')
    expect(capped).not.toContain('run.sh') // 第 2 页的件不落第 1 页
    const page2 = await htmlOf(app, '/reports?limit=2&page=2')
    expect(page2).toContain('第 3–4 条 / 共 4 条 · 第 2/2 页')
    expect(page2).toContain('run.sh')
    // page 越界钳到末页（与 /tickets 同口径）
    const over = await htmlOf(app, '/reports?limit=3&page=99')
    expect(over).toContain('第 4–4 条 / 共 4 条 · 第 2/2 页')
    // q 过滤（路径关键字，大小写不敏感）：匹配数＋全树数；链接续传关键字
    const filtered = await htmlOf(app, '/reports?q=REPORT-A')
    expect(filtered).toContain('关键字「REPORT-A」匹配 1 个文件（全树 4 个）')
    expect(filtered).toContain('value="REPORT-A"')
    expect(filtered).toContain('href="/reports?limit=100"') // 清除关键字
    expect(filtered).not.toContain('2026-11-21-report-b.txt')
    // 无命中：空态不冒充、不崩
    const none = await htmlOf(app, '/reports?q=不存在的关键字')
    expect(none).toContain('没有匹配的文件')
    // 坏参数 400（limit 非整数）；limit 超上限钳到 500 而非报错
    const bad = await app.request('/reports?limit=abc')
    expect(bad.status).toBe(400)
    expect(await bad.text()).toContain('bad-query')
    const clamped = await app.request('/reports?limit=99999')
    expect(clamped.status).toBe(200)
    // XSS：关键字原样回显须转义
    const xss = await htmlOf(app, `/reports?q=${encodeURIComponent('<script>alert(1)</script>')}`)
    expect(xss).not.toContain('<script>alert(1)')
    expect(xss).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('壳层：主题脚本/切换钮/只读徽标/五项导航（无监控面链接）', async () => {
    const html = await htmlOf(app, '/')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain("localStorage.getItem('portal-theme')")
    expect(html).toContain('id="themeToggle"')
    expect(html).toContain('只读')
    for (const label of ['概览', '单子', '聊天', '组织', '报表']) expect(html).toContain(`<span>${label}</span>`)
    expect(html).not.toContain('8791')
    expect(html).not.toContain('/monitor')
    expect(html).toContain('<meta name="robots" content="noindex">')
  })
})

describe('安全（§三.安全：XSS 收口在渲染面、路径越界拒）', () => {
  it('单据标题/描述/验收的用户文本全转义（<script> 不落裸标签）', async () => {
    const html = await htmlOf(app, '/tickets/PORTAL-2')
    expect(html).not.toContain('<script>alert("xss")')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<img src=x onerror')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // 列表页标题同样转义
    const list = await htmlOf(app, '/tickets?q=xss')
    expect(list).toContain('&lt;script&gt;')
    expect(list).not.toContain('<script>alert')
  })

  it('报表查看：正文转义、白名单后缀、越界与非法段一律 400', async () => {
    const view = await htmlOf(app, `/reports/view?path=${encodeURIComponent('reports/研发部/2026-11-21-report-b.txt')}`)
    expect(view).not.toContain('<script>不执行</script>')
    expect(view).toContain('&lt;script&gt;不执行&lt;/script&gt;')
    for (const probe of [
      'reports/研发部/run.sh', // 后缀白名单外
      '../org-config.yaml', // 无 reports/ 前缀
      'reports/../../company/org-config.yaml', // 前缀正确但内含越界段
      'reports/..%2F..%2Fetc%2Fpasswd', // 编码态越界
      'reports/', // 目录而非文件
      'reports/a%5Cb.md', // 反斜杠段
    ]) {
      const res = await app.request(`/reports/view?path=${probe}`)
      expect(res.status, probe).toBe(400)
      expect(await res.text(), probe).toContain('path-')
    }
    const none = await app.request(`/reports/view?path=${encodeURIComponent('reports/研发部/nope.md')}`)
    expect(none.status).toBe(404)
    expect(await none.text()).toContain('report-not-found')
    const missing = await app.request('/reports/view')
    expect(missing.status).toBe(400)
  })

  it('坏单号 400（页面与 JSON 两面）', async () => {
    const page = await app.request('/tickets/BAD%20ID')
    expect(page.status).toBe(400)
    expect(await page.text()).toContain('bad-ticket-id')
    const api = await app.request('/api/tickets/BAD%20ID')
    expect(api.status).toBe(400)
    expect(await api.json()).toMatchObject({ ok: false, error: { code: 'bad-ticket-id' } })
  })
})

describe('降级矩阵（缺件不冒充——§三）', () => {
  it('未接平台：列表空态提示、API available=false、详情 404 platform-not-mounted', async () => {
    const list = await htmlOf(bareApp, '/tickets')
    expect(list).toContain('未接单子平台')
    expect(list).toContain('--platform-root')
    const api = (await jsonOf(bareApp, '/api/tickets')) as { available: boolean; total: number; items: unknown[] }
    expect(api.available).toBe(false)
    expect(api.total).toBe(0)
    expect(api.items).toEqual([])
    const detail = await bareApp.request('/tickets/PORTAL-1')
    expect(detail.status).toBe(404)
    expect(await detail.text()).toContain('platform-not-mounted')
  })

  it('chatd 未配：/chat 降级卡（不冒充空房间）、/api/chat/* 503', async () => {
    const chat = await htmlOf(app, '/chat')
    expect(chat).toContain('chat-embed')
    expect(chat).toContain('门户启用方式')
    expect(chat).toContain('--chatd-socket')
    const rooms = await app.request('/api/chat/rooms')
    expect(rooms.status).toBe(503)
  })

  it('chatd 已配：/api/chat/rooms 200、/chat 渲染装配、统计面可用、token 不落页面', async () => {
    const rooms = await chatApp.request('/api/chat/rooms')
    expect(rooms.status).toBe(200)
    const body = (await rooms.json()) as { rooms?: unknown[] }
    expect(Array.isArray(body.rooms)).toBe(true)
    const chat = await htmlOf(chatApp, '/chat')
    expect(chat).toContain('chat-embed')
    expect(chat).toContain('id="rooms"')
    expect(chat).toContain('id="sendForm"')
    // 渲染层脱敏同源（门户嵌装=单源 renderChatBody）：消息体渲染套 maskHostPaths，
    // 主机绝对路径 → <path>（只读卫生面；chatd 数据不动）
    expect(chat).toContain('maskHostPaths(message.body)')
    expect(chat).toContain("'<path>'")
    expect(chat).not.toContain('secret-token')
    const stats = (await jsonOf(chatApp, '/api/stats')) as { stats: { chat: { available: boolean; rooms: number; messages: number } } }
    expect(stats.stats.chat).toEqual({ available: true, rooms: 2, messages: 15 })
  })

  it('聊天缺省操作者透传：/chat 页 CONFIG、/api/chat/* 与导航徽标同一默认 actor', async () => {
    const chat = await htmlOf(chatApp, '/chat')
    // 页面 CONFIG 注入装配面缺省工号（CLI --chat-actor 同源；缺省 'panel' 会吃 WB_INVALID_ARGUMENT）
    expect(chat).toContain('"actor":"PRIME-0"')
    expect(chat).not.toContain('"actor":"panel"')
    // API 不带 actor 参数＝同一缺省（同源不双轨）
    const ok = await chatApp.request('/api/chat/messages?roomId=r1')
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; page?: { items: unknown[] } }
    expect(body.ok).toBe(true)
    expect((body.page?.items ?? []).length).toBe(1)
    // 非成员 actor：400 可读错误（透传 WB_INVALID_ARGUMENT），不是 500
    const member = await chatApp.request('/api/chat/messages?roomId=r1&actor=panel')
    expect(member.status).toBe(400)
    expect(await member.json()).toMatchObject({ ok: false, error: { code: 'WB_INVALID_ARGUMENT' } })
    // 页内降级文案存在（脚本面：成员未入→可读提示，不当内部错误渲染）
    expect(chat).toContain('不是该房间成员')
    // 未读徽标取数源同 actor；unread 聚合给 2
    const inbox = (await jsonOf(chatApp, '/api/chat/rooms?actor=PRIME-0')) as { totalUnread: number }
    expect(inbox.totalUnread).toBe(2)
  })

  it('聊天导航未读徽标：chatd 已配才渲染（hidden 起步），未配不渲染不取数', async () => {
    const withChat = await htmlOf(chatApp, '/')
    expect(withChat).toContain('id="navChatUnread"')
    expect(withChat).toContain('data-src="/api/chat/rooms?actor=PRIME-0"')
    expect(withChat).toContain('navChatUnread')
    expect(withChat).toContain('hidden')
    const noChat = await htmlOf(app, '/')
    expect(noChat).not.toContain('navChatUnread')
  })

  it('空台账＋无平台：空态文案（不伪造事件流/单子）、daemon 静默', async () => {
    const empty = makeTree('sn-portal-empty-', { platform: false })
    try {
      const a = await makeApp(empty, empty.platformRoot, { transport: null, defaultActorId: 'panel' })
      const html = await htmlOf(a, '/')
      expect(html).toContain('daemon 静默')
      expect(html).toContain('暂无台账事件')
      expect(html).toContain('暂无单子')
      const stats = (await jsonOf(a, '/api/stats')) as { stats: { ledger: { todayEvents: number; todayCostUsd: number | null } } }
      expect(stats.stats.ledger).toEqual({ todayEvents: 0, todayCostUsd: null })
      const org = (await jsonOf(a, '/api/org')) as { company: { name: string }; departments: unknown[] }
      expect(org.company.name).toBe('门户测试公司')
      expect(org.departments.length).toBe(2)
    } finally {
      dropTree(empty)
    }
  })
})

describe('只读 JSON API（§1.3：统一 {ok,…}、错误码可读）', () => {
  it('GET /api/stats：五块统计＋daemon 在线（心跳 10 分钟窗）', async () => {
    const body = (await jsonOf(app, '/api/stats')) as {
      stats: {
        tickets: { available: boolean; total: number; active: number; delivered: number }
        ledger: { todayEvents: number; todayCostUsd: number | null }
        chat: { available: boolean; rooms: number; messages: number }
        org: { departments: number; people: number }
        daemonOnline: boolean
      }
    }
    expect(body.stats.tickets).toEqual({ available: true, total: 3, active: 1, delivered: 1 })
    expect(body.stats.org).toEqual({ departments: 2, people: 3 })
    expect(body.stats.daemonOnline).toBe(true)
    expect(body.stats.ledger.todayEvents).toBe(3) // 旧事件在 UTC 日外
    expect(body.stats.ledger.todayCostUsd).toBe(1.25)
  })

  it('GET /api/activity：原始流（含心跳）、倒序、limit 钳位、坏参数 400', async () => {
    const body = (await jsonOf(app, '/api/activity?limit=2')) as { count: number; events: { event: string }[] }
    expect(body.count).toBe(2)
    expect(body.events.map((e) => e.event)).toEqual(['HEARTBEAT', 'DISPATCH'])
    const bad = await app.request('/api/activity?limit=abc')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, error: { code: 'bad-query' } })
    const clamp = (await jsonOf(app, '/api/activity?limit=99999')) as { count: number }
    expect(clamp.count).toBe(4) // 钳到 200 而非报错
  })

  it('GET /api/tickets：筛选/搜索/分页三参数', async () => {
    const all = (await jsonOf(app, '/api/tickets')) as { total: number; items: { id: string }[] }
    expect(all.total).toBe(3)
    expect(all.items.map((t) => t.id)).toEqual(['PORTAL-2', 'PORTAL-1', 'PORTAL-3']) // updated 降序
    const filtered = (await jsonOf(app, '/api/tickets?state=Archived')) as { total: number; items: { id: string }[] }
    expect(filtered.total).toBe(1)
    expect(filtered.items[0]?.id).toBe('PORTAL-3')
    const paged = (await jsonOf(app, '/api/tickets?limit=1&offset=1')) as { total: number; items: { id: string }[] }
    expect(paged.items.map((t) => t.id)).toEqual(['PORTAL-1'])
    const searched = (await jsonOf(app, '/api/tickets?q=eng-1')) as { total: number }
    expect(searched.total).toBe(1) // 负责人命中
    const bad = await app.request('/api/tickets?limit=-1')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, error: { code: 'bad-query' } })
  })

  it('GET /api/tickets/:id：详情含描述拆段与事件时间线', async () => {
    const body = (await jsonOf(app, '/api/tickets/PORTAL-2')) as {
      ticket: { id: string; parent: string }
      description: string
      acceptance: string | null
      events: { kind: string; to: string | undefined }[]
    }
    expect(body.ticket.parent).toBe('PORTAL-1')
    expect(body.description).not.toContain('验收口径')
    expect(body.acceptance).toContain('闸门 exit=0')
    expect(body.events).toEqual([{ kind: 'created', ts: '2026-11-22T08:00:00.000Z', to: '已交付' }])
    const missing = await app.request('/api/tickets/PORTAL-404')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ ok: false, error: { code: 'issue-not-found' } })
  })

  it('GET /api/org 与 /api/reports 形状', async () => {
    const org = (await jsonOf(app, '/api/org')) as { company: { slug: string; level: number }; people: { id: string; deptName: string }[] }
    expect(org.company.slug).toBe('portal-demo')
    expect(org.company.level).toBe(2)
    expect(org.people.length).toBe(3)
    const reports = (await jsonOf(app, '/api/reports')) as { total: number; q?: string; files: { relPath: string }[] }
    expect(reports.files.map((f) => f.relPath)).toContain('reports/研发部/run.sh')
    expect(reports.files.every((f) => f.relPath.startsWith('reports/'))).toBe(true)
    expect(reports.files.length).toBe(4) // .gitkeep/.DS_Store 跳过
    expect(reports.total).toBe(4) // 缺省=全清单（现契约形状不变，只加 total）
    expect(reports.q).toBeUndefined()
  })

  it('GET /api/reports：可选 q/limit/offset（缺省全清单；limit/offset 切片；坏参数 400）', async () => {
    const filtered = (await jsonOf(app, '/api/reports?q=summary')) as { total: number; q: string; files: { relPath: string }[] }
    expect(filtered.q).toBe('summary')
    expect(filtered.total).toBe(1)
    expect(filtered.files.length).toBe(1)
    const paged = (await jsonOf(app, '/api/reports?limit=2&offset=1')) as { total: number; files: { relPath: string }[] }
    expect(paged.total).toBe(4)
    expect(paged.files.map((f) => f.relPath)).toEqual(['reports/研发部/2026-11-21-report-b.txt', 'reports/研发部/run.sh'])
    const none = (await jsonOf(app, '/api/reports?q=zzz')) as { total: number; files: unknown[] }
    expect(none.total).toBe(0)
    expect(none.files).toEqual([])
    for (const probe of ['limit=-1', 'offset=abc', 'q=x'.repeat(121)]) {
      const bad = await app.request(`/api/reports?${probe}`)
      expect(bad.status, probe).toBe(400)
      expect(await bad.json(), probe).toMatchObject({ ok: false, error: { code: 'bad-query' } })
    }
    const clamped = (await jsonOf(app, '/api/reports?limit=501')) as { files: unknown[] }
    expect(clamped.files.length).toBe(4) // 超上限钳到 500 而非报错
  })

  it('未知端点：页面 404 HTML、API 404 JSON', async () => {
    const page = await app.request('/nope')
    expect(page.status).toBe(404)
    expect(await page.text()).toContain('not-found')
    const api = await app.request('/api/nope')
    expect(api.status).toBe(404)
    expect(await api.json()).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})

describe('mission 提取（org-config 单行口径，与 cli/overview.ts extractMission 同形）', () => {
  it('裸值/引号/行尾注释/缺省四形', () => {
    expect(extractMission('mission: 直说使命')).toBe('直说使命')
    expect(extractMission('mission: "引号使命"')).toBe('引号使命')
    expect(extractMission('mission: 尾注使命 # 注释')).toBe('尾注使命')
    expect(extractMission("mission: '单引'")).toBe('单引')
    expect(extractMission('')).toBe('')
    expect(extractMission(undefined)).toBe('')
    // 嵌在 company: 段内的缩进行
    expect(extractMission('company:\n  name: 甲\n  mission: 嵌套使命\n')).toBe('嵌套使命')
    // 引号＋行尾注释并存：先按「非纯引号值」走注释剥离分支（两口径一致，不双剥离）
    expect(extractMission('mission: "引号使命" # 行尾注\n')).toBe('"引号使命"')
  })
})
