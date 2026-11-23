/**
 * 指令台＋单子增强测试（docs/plan/11-公司门户-2026-11-23.md §十.1/§十.2）。
 *
 * 断言面对契约：/console 页面端点与预填链路、POST /api/console/send 校验族与成功路径
 * （发送走 chatd transport 假体——门户零直写）、/api/tickets/export 形状与上限、
 * states 多选/负责人/排序（端到端＋tickets-view 纯函数）。夹具与 harness 复用 fixtures.ts。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { ChatAppOptions, ChatPanelTransport } from '@studio-next/panel/chat'
import type { IssueRecord } from '@studio-next/contract'
import { createPortalApp, mountCompany } from '../../../../src/assembly/portal/server.ts'
import { createPortalData } from '../../../../src/assembly/portal/data.ts'
import {
  DEFAULT_TICKET_QUERY,
  csvCell,
  filterTickets,
  parseDirParam,
  parseSortParam,
  parseStatesParam,
  queryTickets,
  sortTickets,
  ticketsCsv,
  ticketsExportJson,
  ticketsExportName,
} from '../../../../src/assembly/portal/tickets-view.ts'
import { dropTree, makeTree, type PortalTree } from './fixtures.ts'

const VERSION = '0.1.0-test'
let tree: PortalTree
let app: Hono // 全装（平台在、chatd 无——发送 503 族）
let chatApp: Hono // 全装＋chatd mock——发送成功路径

/** chatd transport 假体（发送可捕获——整 input 入列，mentions 显隐可断言） */
const sent: Record<string, unknown>[] = []
const sendTransport: ChatPanelTransport = {
  async listRooms() {
    return [
      { roomId: 'room-1', kind: 'broadcast', name: '全员', memberIds: ['ENG-1', 'QA-1', 'PRIME-0'], headRoomSeq: 7 },
      { roomId: 'r2', kind: 'group', name: '研发', memberIds: ['ENG-1'], headRoomSeq: 1 },
    ]
  },
  async sendMessage(input) {
    sent.push({ ...input })
    return { seq: 99, roomSeq: 8, messageId: 'm-smoke', replayed: false }
  },
  async listMessages() {
    return { items: [], nextCursor: null, hasMore: false }
  },
  async read() {
    throw new Error('not-implemented')
  },
  async inbox() {
    return { actorId: 'PRIME-0', unread: 0, mentions: 0, pendingWakeIds: [], rooms: [] }
  },
}

async function makeApp(platformRoot: string | null, chat: ChatAppOptions): Promise<Hono> {
  const mounted = await mountCompany(tree.companyDir)
  return createPortalApp({
    data: createPortalData({
      company: mounted.snapshot,
      companyDir: tree.companyDir,
      mission: mounted.mission,
      platformRoot,
      ledger: tree.ledger,
      chatStats: async () => ({ available: chat.transport !== null, rooms: 2, messages: 8 }),
    }),
    chat,
    version: VERSION,
  })
}

beforeAll(async () => {
  tree = makeTree('sn-portal-console-')
  app = await makeApp(tree.platformRoot, { transport: null, defaultActorId: 'PRIME-0' })
  chatApp = await makeApp(tree.platformRoot, { transport: sendTransport, token: 'secret-token', defaultActorId: 'PRIME-0' })
})

afterAll(() => {
  dropTree(tree)
})

const htmlOf = async (a: Hono, pathAndQuery: string): Promise<string> => (await a.request(pathAndQuery)).text()

describe('§十.1 指令台页面（GET /console）', () => {
  it('缺省渲染：岗位下拉（org people）、模板下拉、确认卡、审计卡、单号/文本区/发送钮', async () => {
    const html = await htmlOf(app, '/console')
    expect(html).toContain('id="consolePerson"')
    expect(html).toContain('id="consoleRoom"')
    expect(html).toContain('id="consoleTemplate"')
    expect(html).toContain('id="consoleTicket"')
    expect(html).toContain('id="consoleText"')
    expect(html).toContain('id="consoleSend"')
    expect(html).toContain('id="consoleConfirm"')
    expect(html).toContain('id="confirmYes"')
    expect(html).toContain('id="confirmNo"')
    expect(html).toContain('id="auditList"')
    expect(html).toContain('id="consoleStatus"')
    // 岗位下拉来自 org 名册（ENG-1/OPS-1/QA-1 全在）
    expect(html).toContain('ENG-1 工程师甲（研发部）')
    expect(html).toContain('OPS-1 运维乙（平台组）')
    expect(html).toContain('QA-1 测试丙（研发部）')
    // 房间列表由页面 JS 取 /api/chat/rooms 刷新（缺省静态只列 room-1 兜底）
    expect(html).toContain('"/api/chat/rooms"')
    // 5 模板全在 CONFIG（页面 JS 切换填充）
    for (const id of ['create', 'redraft', 'ask', 'daily', 'custom']) expect(html).toContain(`"${id}"`)
    // 操作审计只进 localStorage（浏览器本地，不进台账/平台）
    expect(html).toContain('portal-console-audit')
  })

  it('?person=&ticket= 预填链路：文本区按模板替换 @工号 与单号占位', async () => {
    const html = await htmlOf(app, '/console?person=ENG-1&ticket=PORTAL-1')
    expect(html).toContain('"person":"ENG-1"')
    expect(html).toContain('"ticket":"PORTAL-1"')
    // 文本区预填（ask 模板带 {{ticket}}）：占位符已替换（CONFIG 模板表保留 {{…}} 原文）
    const ask = await htmlOf(app, '/console?person=ENG-1&ticket=PORTAL-1&template=ask')
    const textarea = /<textarea id="consoleText"[^>]*>([\s\S]*?)<\/textarea>/.exec(ask)?.[1] ?? ''
    expect(textarea).toContain('@ENG-1')
    expect(textarea).toContain('PORTAL-1')
    expect(textarea).not.toContain('{{person}}')
    expect(textarea).not.toContain('{{ticket}}')
    // 下拉选中项回填
    expect(ask).toContain('<option value="ENG-1" selected>')
  })

  it('校验族：未知岗位 400 bad-person；坏单号 400 bad-ticket-id；模板白名单外宽容回落', async () => {
    expect((await app.request('/console?person=ENG-404')).status).toBe(400)
    expect(await htmlOf(app, '/console?person=ENG-404')).toContain('bad-person')
    expect((await app.request('/console?ticket=BAD%20ID')).status).toBe(400)
    expect(await htmlOf(app, '/console?ticket=BAD%20ID')).toContain('bad-ticket-id')
    // 宽容回落：未知模板 id 落缺省 create（不炸页面；CONFIG 内 templateId 见 JSON 串）
    const html = await htmlOf(app, '/console?template=no-such')
    expect(html).toContain('"templateId":"create"')
    // 控制字符/超长 room → 400
    expect((await app.request('/console?room=a%0Ab')).status).toBe(400)
  })
})

describe('§十.1 POST /api/console/send（发送编排契约）', () => {
  const post = async (a: Hono, body: unknown): Promise<Response> =>
    a.request('/api/console/send', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

  it('chatd 未配：503 chat-disabled（门户不直写，不伪装成功）', async () => {
    const res = await post(app, { person: 'ENG-1', roomId: 'room-1', templateId: 'custom', text: 'hi' })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('chat-disabled')
  })

  it('请求体校验族 400：bad-json／missing-field／text-too-long／bad-template／bad-ticket-id', async () => {
    expect((await post(app, 'not-json')).status).toBe(400)
    const missing = (await (await post(app, { person: 'ENG-1', roomId: 'room-1', text: '' })).json()) as { error: { code: string } }
    expect(missing.error.code).toBe('missing-field')
    const tooLong = (await (await post(app, { person: 'ENG-1', roomId: 'room-1', text: 'x'.repeat(4001) })).json()) as { error: { code: string } }
    expect(tooLong.error.code).toBe('text-too-long')
    const badTpl = (await (await post(app, { person: 'ENG-1', roomId: 'room-1', templateId: 'nope', text: 'hi' })).json()) as { error: { code: string } }
    expect(badTpl.error.code).toBe('bad-template')
    const badTicket = (await (await post(app, { person: 'ENG-1', roomId: 'room-1', text: 'hi', ticket: 'BAD ID' })).json()) as { error: { code: string } }
    expect(badTicket.error.code).toBe('bad-ticket-id')
  })

  it('数据面校验：不在册工号 400 person-unknown；房间不存在 404 room-not-found', async () => {
    const person = (await (await post(chatApp, { person: 'ENG-404', roomId: 'room-1', templateId: 'custom', text: 'hi' })).json()) as { error: { code: string } }
    expect(person.error.code).toBe('person-unknown')
    const room = (await (await post(chatApp, { person: 'ENG-1', roomId: 'no-such-room', templateId: 'custom', text: 'hi' })).json()) as { error: { code: string; message: string } }
    expect(room.error.code).toBe('room-not-found')
    expect(room.error.message).toContain('room-1')
  })

  it('成功路径：transport 收到逐字段一致的发送（sender=PRIME-0、无 mentions 字段），响应含 seq/roomSeq/chatUrl', async () => {
    sent.length = 0
    const res = await post(chatApp, { person: 'ENG-1', roomId: 'room-1', templateId: 'custom', text: '[t] 请处理 PORTAL-1', ticket: 'PORTAL-1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; seq: number; roomSeq: number; roomId: string; message: string; chatUrl: string }
    expect(body.ok).toBe(true)
    expect(body.seq).toBe(99)
    expect(body.roomSeq).toBe(8)
    expect(body.roomId).toBe('room-1')
    expect(body.message).toBe('[t] 请处理 PORTAL-1')
    expect(body.chatUrl).toBe('/chat?room=room-1')
    expect(sent).toHaveLength(1)
    // 发送面：操作者=门户缺省 PRIME-0；正文原样（模板占位在页面侧替换）；不显式传 mentions
    expect(sent[0]?.senderId).toBe('PRIME-0')
    expect(sent[0]?.body).toBe('[t] 请处理 PORTAL-1')
    expect('mentions' in (sent[0] ?? {})).toBe(false) // chatd 按正文 @工号 产 wake——不显式传 mentions
  })
})

describe('§十.2 单子多选筛选/负责人/排序（页面端到端）', () => {
  it('states 多选：已派发＋Archived 两张齐出、已交付不出；GET 表单 checkbox 复选', async () => {
    const html = await htmlOf(app, '/tickets?states=已派发&states=Archived')
    expect(html).toContain('href="/tickets/PORTAL-1"')
    expect(html).toContain('href="/tickets/PORTAL-3"')
    expect(html).not.toContain('href="/tickets/PORTAL-2"')
    expect(html).toContain('name="states" value="已派发" checked')
    expect(html).toContain('name="states" value="Archived" checked')
  })

  it('负责人过滤：ENG-1 单出 PORTAL-1；下拉来自 /api/org', async () => {
    const html = await htmlOf(app, '/tickets?assignee=ENG-1')
    expect(html).toContain('href="/tickets/PORTAL-1"')
    expect(html).not.toContain('href="/tickets/PORTAL-2"')
    expect(html).toContain('name="assignee"')
    expect(html).toContain('<option value="ENG-1" selected>')
  })

  it('排序：id 升序 PORTAL-1 在前、id 降序 PORTAL-3 在前；updated 升序 PORTAL-2 在前', async () => {
    const idAsc = await htmlOf(app, '/tickets?sort=id&dir=asc')
    expect(idAsc.indexOf('/tickets/PORTAL-1')).toBeLessThan(idAsc.indexOf('/tickets/PORTAL-3'))
    const idDesc = await htmlOf(app, '/tickets?sort=id&dir=desc')
    expect(idDesc.indexOf('/tickets/PORTAL-3')).toBeLessThan(idDesc.indexOf('/tickets/PORTAL-1'))
    const upAsc = await htmlOf(app, '/tickets?dir=asc')
    expect(upAsc.indexOf('/tickets/PORTAL-3')).toBeLessThan(upAsc.indexOf('/tickets/PORTAL-2'))
  })

  it('旧参 state= 零变化：/tickets?state=Archived 仍过滤且并入 chips', async () => {
    const html = await htmlOf(app, '/tickets?state=Archived')
    expect(html).toContain('href="/tickets/PORTAL-3"')
    expect(html).not.toContain('href="/tickets/PORTAL-1"')
    expect(html).toContain('name="states" value="Archived" checked')
  })

  it('参数越界宽容：未知 sort/dir 落缺省；states 段超长丢弃不炸页面', async () => {
    const html = await htmlOf(app, `/tickets?sort=bogus&dir=bogus&states=${'x'.repeat(80)},Archived`)
    expect(html).toContain('href="/tickets/PORTAL-3"')
    expect(html).not.toContain('<b>500</b>')
  })
})

describe('§十.2 /api/tickets/export（同源筛选导出）', () => {
  it('CSV：BOM＋表头＋行；Content-Disposition attachment；筛选只出命中行', async () => {
    const res = await app.request('/api/tickets/export?format=csv&states=已派发')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.headers.get('Content-Disposition')).toContain('.csv')
    // BOM 断言走字节面（fetch 的 .text() 按 spec 吃掉前导 BOM——线上字节才是 Excel 看到的）
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(text).toContain('单号,标题,状态')
    expect(text).toContain('PORTAL-1')
    expect(text).not.toContain('PORTAL-2')
    expect(text).toContain('\r\n') // RFC4180 CRLF 行尾
  })

  it('JSON：{ok,total,returned,capped,items} 形状；format 缺失 400', async () => {
    const res = await app.request('/api/tickets/export?format=json')
    const body = (await res.json()) as { ok: boolean; total: number; returned: number; capped: boolean; items: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.total).toBe(3)
    expect(body.returned).toBe(3)
    expect(body.capped).toBe(false)
    expect(body.items).toHaveLength(3)
    expect((await app.request('/api/tickets/export')).status).toBe(400)
  })

  it('5000 行上限：returned=5000、capped=true（纯函数面——端点先切片再交 JSON 单源）', () => {
    const rows: IssueRecord[] = Array.from({ length: 5001 }, (_, i) => ({
      id: `T-${String(i + 1).padStart(5, '0')}`,
      title: `单 ${String(i + 1)}`,
      state: '已派发',
      updated: '2026-11-20T10:00:00.000Z',
    }))
    const out = ticketsExportJson(rows.slice(0, 5000), rows.length) as { returned: number; capped: boolean; items: unknown[] }
    expect(out.returned).toBe(5000)
    expect(out.capped).toBe(true)
    expect(out.items).toHaveLength(5000)
    const ok = ticketsExportJson(rows.slice(0, 3), 3) as { returned: number; capped: boolean }
    expect(ok.capped).toBe(false)
    expect(ok.returned).toBe(3)
  })
})

describe('§十.2 tickets-view 纯函数', () => {
  const rows: IssueRecord[] = [
    { id: 'PORTAL-1', title: '登录页改版', state: '已派发', assignee: 'ENG-1', dept: 'departments/研发部', lane: 'qa', updated: '2026-11-20T11:00:00.000Z' },
    { id: 'PORTAL-2', title: '交付单', state: '已交付', assignee: 'QA-1', updated: '2026-11-22T08:00:00.000Z' },
    { id: 'PORTAL-3', title: '旧巡逻单', state: 'Archived', updated: '2026-11-20T11:00:00.000Z' },
  ]

  it('parseStatesParam：逗号拆分/去空白/去重/≤16/超长段丢弃', () => {
    expect(parseStatesParam(' 已派发 ,Archived, 已派发 ')).toEqual(['已派发', 'Archived'])
    expect(parseStatesParam('')).toEqual([])
    expect(parseStatesParam(undefined)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => `s${String(i)}`).join(',')
    expect(parseStatesParam(many)).toHaveLength(16)
    expect(parseStatesParam(`${'x'.repeat(80)},Archived`)).toEqual(['Archived'])
  })

  it('parseSortParam/parseDirParam：白名单外落缺省', () => {
    expect(parseSortParam('id')).toBe('id')
    expect(parseSortParam('bogus')).toBe('updated')
    expect(parseSortParam(undefined)).toBe('updated')
    expect(parseDirParam('asc')).toBe('asc')
    expect(parseDirParam('desc')).toBe('desc')
    expect(parseDirParam('bogus')).toBe('desc')
  })

  it('filterTickets：states∈／assignee 全等／search 子串（大小写不敏感）', () => {
    expect(filterTickets(rows, { states: ['已派发'], assignee: undefined, search: '' }).map((t) => t.id)).toEqual(['PORTAL-1'])
    expect(filterTickets(rows, { states: ['已派发', 'Archived'], assignee: undefined, search: '' }).map((t) => t.id)).toEqual(['PORTAL-1', 'PORTAL-3'])
    expect(filterTickets(rows, { states: [], assignee: 'ENG-1', search: '' }).map((t) => t.id)).toEqual(['PORTAL-1'])
    expect(filterTickets(rows, { states: [], assignee: undefined, search: '巡逻' }).map((t) => t.id)).toEqual(['PORTAL-3'])
    expect(filterTickets(rows, { states: [], assignee: undefined, search: 'qa-1' }).map((t) => t.id)).toEqual(['PORTAL-2'])
    expect(filterTickets(rows, { states: [], assignee: undefined, search: '' })).toHaveLength(3)
  })

  it('sortTickets：updated 串序＋id tiebreak；dir 翻转；不改入参', () => {
    const updatedDesc = sortTickets(rows, 'updated', 'desc')
    expect(updatedDesc.map((t) => t.id)).toEqual(['PORTAL-2', 'PORTAL-1', 'PORTAL-3']) // 同 updated 时 id 升序 tiebreak
    expect(sortTickets(rows, 'updated', 'asc').map((t) => t.id)).toEqual(['PORTAL-1', 'PORTAL-3', 'PORTAL-2']) // asc 主键升序，并列段仍 id 升序
    expect(sortTickets(rows, 'id', 'asc').map((t) => t.id)).toEqual(['PORTAL-1', 'PORTAL-2', 'PORTAL-3'])
    expect(sortTickets(rows, 'id', 'desc').map((t) => t.id)).toEqual(['PORTAL-3', 'PORTAL-2', 'PORTAL-1'])
    expect(rows.map((t) => t.id)).toEqual(['PORTAL-1', 'PORTAL-2', 'PORTAL-3']) // 入参零变化
    expect(DEFAULT_TICKET_QUERY.sort).toBe('updated')
  })

  it('queryTickets：筛选＋排序单源合成', () => {
    const out = queryTickets(rows, { states: ['Archived'], assignee: undefined, search: '', sort: 'id', dir: 'desc' })
    expect(out.map((t) => t.id)).toEqual(['PORTAL-3'])
  })

  it('csvCell：引号/逗号/换行转义（RFC4180）', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(ticketsCsv(rows.slice(0, 1)).startsWith('\uFEFF单号,')).toBe(true)
    expect(ticketsExportName('csv', Date.UTC(2026, 10, 23, 1, 2, 3))).toBe('tickets-20261123.csv')
    expect(ticketsExportName('json', Date.UTC(2026, 10, 23, 1, 2, 3))).toBe('tickets-20261123.json')
  })
})
