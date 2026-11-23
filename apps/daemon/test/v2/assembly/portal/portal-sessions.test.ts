/**
 * 公司门户 v2 第一刀端面测试（docs/plan/11-公司门户-2026-11-23.md §九：岗位会话
 * 档案＋组织架构图＋单子联动）。
 *
 * 全部走 createPortalApp(...).request() 进程内直打；zstd 解压面注入 fake（读夹具内
 * 明文 JSONL——不真起进程；unavailable/超时另配死体）；夹具见 sessions-fixtures.ts。
 * 断言面对契约：路由形状/严格校验 400/穿越 400/白名单 415/脱敏不漏主机路径/降级不冒充。
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { createPortalApp, mountCompany } from '../../../../src/assembly/portal/server.ts'
import { createPortalData } from '../../../../src/assembly/portal/data.ts'
import { normalizeTranscript, type DecompressFn } from '../../../../src/assembly/portal/sessions-transcript.ts'
import { dropTree, makeTree, type PortalTree } from './fixtures.ts'
import { SESS1_ID, SESS1_ID_UNKNOWN, SESS2_ID, SECRET_HOST, seedSessions, sess1Transcript } from './sessions-fixtures.ts'

/** fake 解压：直读夹具内明文 JSONL（夹具把 JSONL 写进 .zstd 位——形状一致，内容可读） */
const fakeDecompress: DecompressFn = async (file) => ({ ok: true, text: readFileSync(file, 'utf8'), truncated: false })
/** 死体：复刻 zstd CLI 缺位（页面/API 必须降级不 500） */
const deadDecompress: DecompressFn = async () => ({ ok: false, code: 'zstd-unavailable', message: '会话压缩工具不可用：未找到 zstd CLI' })

let tree: PortalTree
let bareTree: PortalTree
let app: Hono // 全装（.AIWS 在、fake 解压、平台在、chatd 无）
let deadApp: Hono // 同树＋死解压面（zstd-unavailable 降级）
let bareApp: Hono // 无 .AIWS 树（sessions-not-mounted 降级）

async function makeApp(t: PortalTree, decompress?: DecompressFn): Promise<Hono> {
  const mounted = await mountCompany(t.companyDir)
  return createPortalApp({
    data: createPortalData({
      company: mounted.snapshot,
      companyDir: t.companyDir,
      mission: mounted.mission,
      platformRoot: t.platformRoot,
      ledger: t.ledger,
      chatStats: async () => ({ available: false, rooms: 0, messages: 0 }),
      ...(decompress !== undefined ? { sessionDecompress: decompress } : {}),
    }),
    chat: { transport: null, defaultActorId: 'panel' },
    version: '0.1.0-test',
  })
}

beforeAll(async () => {
  tree = makeTree('sn-portal-sess-')
  seedSessions(tree)
  app = await makeApp(tree, fakeDecompress)
  deadApp = await makeApp(tree, deadDecompress)
  bareTree = makeTree('sn-portal-bare-')
  bareApp = await makeApp(bareTree)
})

afterAll(() => {
  dropTree(tree)
  dropTree(bareTree)
})

interface ApiSessionRow {
  ticket: string
  person: string
  dept: string
  attempt: number
  sessionId: string
  sessionCount: number
  hasReport: boolean
  hasSummary: boolean
  updatedAtMs: number
}

const rowsOf = async (q: string): Promise<ApiSessionRow[]> => {
  const r = (await (await app.request(`/api/sessions${q}`)).json()) as { items: ApiSessionRow[] }
  return r.items
}

describe('会话档案 API（§九.1 索引/详情/严格校验）', () => {
  it('GET /api/sessions：available/全行/updatedAt 倒序/行字段', async () => {
    const r = (await (await app.request('/api/sessions')).json()) as { ok: boolean; available: boolean; total: number; scanned: number; items: ApiSessionRow[] }
    expect(r.ok).toBe(true)
    expect(r.available).toBe(true)
    expect(r.total).toBe(3)
    expect(r.scanned).toBe(3)
    expect(r.items.map((x) => `${x.ticket}:att${String(x.attempt)}`)).toEqual(['SESS-1:att1', 'SESS-2:att1', 'SESS-1:att2'])
    const first = r.items[0] as ApiSessionRow
    expect(first).toMatchObject({ ticket: 'SESS-1', person: 'ENG-1', dept: '研发部', attempt: 1, sessionId: SESS1_ID, sessionCount: 1, hasReport: true, hasSummary: true })
  })

  it('过滤：person/ticket/q＋limit/offset 分页', async () => {
    expect((await rowsOf('?person=ENG-1')).map((x) => x.attempt)).toEqual([1, 2])
    expect((await rowsOf('?person=QA-1')).map((x) => x.ticket)).toEqual(['SESS-2'])
    expect((await rowsOf('?ticket=SESS-2')).map((x) => x.person)).toEqual(['QA-1'])
    expect((await rowsOf('?q=qa-1')).map((x) => x.ticket)).toEqual(['SESS-2'])
    expect((await rowsOf('?limit=1&offset=1')).map((x) => x.ticket)).toEqual(['SESS-2'])
  })

  it('严格校验 400：person 形/越界、ticket 形、坏 JSON 参数', async () => {
    for (const q of ['?person=BAD PERSON', '?person=../etc', '?ticket=../etc', '?limit=abc', '?offset=-1']) {
      const res = await app.request(`/api/sessions${q}`)
      expect(res.status, q).toBe(400)
    }
    const res = await app.request('/api/sessions?person=ENG-404')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-person')
  })

  it('GET /api/sessions/:ticket/:attempt：files/sessions/events/usage 全形状', async () => {
    const res = await app.request(`/api/sessions/SESS-1/att1?sessionId=${SESS1_ID}`)
    expect(res.status).toBe(200)
    const v = (await res.json()) as {
      person: string
      dept: string
      files: { brief: boolean; report: boolean; summary: boolean; deliverables: { relPath: string }[] }
      sessions: { id: string }[]
      events: { kind: string }[]
      usage: { turns: number; toolCalls: number; errors: number; provider: string | null; model: string | null }
      transcript: { available: boolean }
    }
    expect(v.person).toBe('ENG-1')
    expect(v.files).toMatchObject({ brief: true, report: true, summary: true })
    expect(v.files.deliverables.map((d) => d.relPath).sort()).toEqual(['deliverables/big.log', 'deliverables/data.json', 'deliverables/notes/a.md', 'deliverables/skipme.bin'])
    expect(v.sessions.map((s) => s.id)).toEqual([SESS1_ID])
    expect(v.transcript.available).toBe(true)
    expect(v.usage).toMatchObject({ turns: 2, toolCalls: 2, errors: 2, provider: 'dsh', model: 'glm-test' })
    const kinds = v.events.map((e) => e.kind)
    for (const k of ['session', 'config', 'brief', 'user', 'assistant', 'reasoning', 'tool_call', 'tool_result', 'error', 'compaction', 'turn']) expect(kinds).toContain(k)
    expect(kinds).not.toContain('step')
    // 脱敏在归一化层（页面与 API 回包同罩）：API 事件文本不带主机绝对路径
    expect(JSON.stringify(v.events)).not.toContain(SECRET_HOST)
    expect(JSON.stringify(v.events)).toContain('<path>')
  })

  it('详情校验：att 形/会话 id 形 400；未发现 404；person 反查', async () => {
    expect((await app.request('/api/sessions/SESS-1/att99x')).status).toBe(400)
    expect((await app.request('/api/sessions/SESS-1/1')).status).toBe(400)
    expect((await app.request('/api/sessions/NOPE-9/att1')).status).toBe(404)
    expect((await app.request(`/api/sessions/SESS-1/att1?sessionId=session-x`)).status).toBe(400)
    expect((await app.request(`/api/sessions/SESS-2/att1?sessionId=${SESS2_ID}`)).status).toBe(200)
    expect((await app.request(`/api/sessions/SESS-2/att1?sessionId=${SESS1_ID_UNKNOWN}`)).status).toBe(404)
    expect((await app.request('/api/sessions/SESS-1/att1?person=QA-1')).status).toBe(404)
    expect((await app.request('/api/sessions/SESS-1/att1?person=ENG-1')).status).toBe(200)
  })
})

describe('轨迹归一化 normalizeTranscript（§九.1 截断/跳噪/usage）', () => {
  it('usage 汇总＋噪声跳过＋超长截断＋坏行计数', () => {
    const { events, usage } = normalizeTranscript(sess1Transcript())
    expect(usage).toMatchObject({ lines: 22, parseErrors: 1, turns: 2, userMessages: 1, assistantMessages: 2, toolCalls: 2, toolResults: 2, errors: 2, provider: 'dsh', model: 'glm-test' })
    expect(usage.durationMs).toBe(20_000)
    expect(usage.skipped).toBe(2) // step/start＋session/title
    const long = events.find((e) => e.kind === 'assistant' && e.text !== null && e.text.length > 100)
    expect(long?.truncated).toBe(true)
    expect(long?.text?.length).toBe(4_000)
    const call = events.find((e) => e.kind === 'tool_call' && e.title === 'bash')
    expect(call?.detail).toContain('ls -la')
    const err = events.filter((e) => e.kind === 'error')
    expect(err.every((e) => e.isError)).toBe(true)
  })
})

describe('会话档案页面（§九.1 列表/详情/标签页/文件预览）', () => {
  it('/sessions：表头/结论一句列/筛选联动/人员链接', async () => {
    const html = await (await app.request('/sessions')).text()
    expect(html).toContain('会话档案')
    expect(html).toContain('<th>摘要一句</th>')
    expect(html).toContain('SESS-1 att1 结论：交付组织架构图与单子联动。'.slice(0, 20))
    expect(html).toContain('/sessions?person=ENG-1')
    expect(html).toContain('/tickets/SESS-1')
    const eng = await (await app.request('/sessions?person=ENG-1')).text()
    expect(eng).toContain('SESS-1')
    expect(eng).not.toContain('href="/tickets/SESS-2"')
    const bad = await app.request('/sessions?person=ENG-404')
    expect(bad.status).toBe(400)
    expect(await bad.text()).toContain('bad-person')
  })

  it('/sessions/:ticket/:attempt：头卡/标签页/时间线/主机路径脱敏', async () => {
    const html = await (await app.request(`/sessions/SESS-1/att1?sessionId=${SESS1_ID}`)).text()
    expect(html).toContain('工位会话 · SESS-1 第 1 次尝试')
    expect(html).toContain(SESS1_ID)
    expect(html).toContain('会话时间线')
    expect(html).toContain('摘要')
    expect(html).toContain('任务书')
    expect(html).toContain('交付物')
    expect(html).toContain('ev-tool_call')
    expect(html).toContain('我先看一下目录结构。')
    // 脱敏：主机绝对路径与 workspace-key 目录名都不出页面（maskHostPaths→<path>，经 esc 后为 &lt;path&gt;）
    expect(html).not.toContain(SECRET_HOST)
    expect(html).not.toContain('ws-host-secret')
    expect(html).toContain('&lt;path&gt;')
  })

  it('标签页：摘要/REPORT/任务书/交付物（白名单外标不可预览）', async () => {
    const report = await (await app.request(`/sessions/SESS-1/att1?tab=report`)).text()
    expect(report).toContain('REPORT SESS-1')
    expect(report).not.toContain(SECRET_HOST)
    const brief = await (await app.request(`/sessions/SESS-1/att1?tab=brief`)).text()
    expect(brief).toContain('# 任务书 SESS-1')
    const summary = await (await app.request(`/sessions/SESS-1/att1?tab=summary`)).text()
    expect(summary).toContain('SESS-1 att1 结论')
    const deliv = await (await app.request(`/sessions/SESS-1/att1?tab=deliverables`)).text()
    expect(deliv).toContain('deliverables/notes/a.md')
    expect(deliv).toContain('deliverables/data.json')
    expect(deliv).toContain('文本外不预览') // skipme.bin：白名单外——占位不冒充
  })

  it('>200 事件折叠为百条一组（<details>；无 JS 可用）', async () => {
    const html = await (await app.request('/sessions/SESS-2/att1')).text()
    expect(html).toContain('260 条事件')
    expect(html).toContain('<details class="ev-fold">')
    expect(html).toContain('check-0')
    expect(html).toContain('check-255')
  })

  it('无会话尝试：详情页降级不冒充（no-session）', async () => {
    const res = await app.request('/sessions/SESS-1/att2')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('该尝试未发现会话轨迹')
  })

  it('文件预览：白名单 200／非白名单 415／穿越 400／缺文件 404／超 200KB 截断', async () => {
    const base = '/sessions/SESS-1/att1/file'
    const ok = await app.request(`${base}?path=${encodeURIComponent('brief.md')}`)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('# 任务书 SESS-1')
    const json = await app.request(`${base}?path=${encodeURIComponent('deliverables/data.json')}`)
    expect(json.status).toBe(200)
    const bin = await app.request(`${base}?path=${encodeURIComponent('deliverables/skipme.bin')}`)
    expect(bin.status).toBe(415)
    expect(await bin.text()).toContain('unsupported-file-type')
    for (const p of ['../../../etc/passwd', '/etc/passwd', 'deliverables/../..//etc/passwd', '']) {
      const res = await app.request(`${base}${p === '' ? '' : `?path=${encodeURIComponent(p)}`}`)
      expect(res.status, p).toBe(400)
    }
    // 已编码穿越（%2F 解码后含 .. 段）：同样 400
    expect((await app.request(`${base}?path=..%2F..%2Fetc%2Fpasswd`)).status).toBe(400)
    expect((await app.request(`${base}?path=${encodeURIComponent('deliverables/missing.md')}`)).status).toBe(404)
    const big = await app.request(`${base}?path=${encodeURIComponent('deliverables/big.log')}`)
    expect(big.status).toBe(200)
    const bigHtml = await big.text()
    expect(bigHtml).toContain('超 200KB 截断')
  })
})

describe('组织架构图（§九.2 树图/子树人数/?dept= 过滤/人员行入口）', () => {
  it('/org：架构图节点（名称/负责人/等级/子树人数）＋部门树保留', async () => {
    const html = await (await app.request('/org')).text()
    expect(html).toContain('组织架构图')
    expect(html).toContain('class="org-node')
    expect(html).toContain('研发部')
    expect(html).toContain('平台组')
    expect(html).toContain('工程师甲')
    expect(html).toContain('3 人') // 研发部子树＝ENG-1＋QA-1＋OPS-1
    expect(html).toContain('部门树')
    expect((html.match(/\/sessions\?person=/g) ?? []).length).toBe(3)
  })

  it('?dept= 过滤：子树收拢人员表；坏路径 400', async () => {
    const dev = await (await app.request(`/org?dept=${encodeURIComponent('departments/研发部')}`)).text()
    expect(dev).toContain('部门过滤中')
    expect((dev.match(/\/sessions\?person=/g) ?? []).length).toBe(3) // 含子部门平台组 OPS-1
    const ops = await (await app.request(`/org?dept=${encodeURIComponent('departments/研发部/平台组')}`)).text()
    expect((ops.match(/\/sessions\?person=/g) ?? []).length).toBe(1)
    expect(ops).toContain('运维乙')
    expect((await app.request('/org?dept=departments/不存在')).status).toBe(400)
  })

  it('人员行快捷入口：会话（?person=）与单子（/tickets?q=）', async () => {
    const html = await (await app.request('/org')).text()
    expect(html).toContain(`href="/sessions?person=ENG-1"`)
    expect(html).toContain(`href="/tickets?q=ENG-1"`)
  })
})

describe('单子联动（§九.3）', () => {
  it('/tickets/:id：工位尝试与会话区块（尝试行→详情；文件徽标）', async () => {
    const html = await (await app.request('/tickets/SESS-1')).text()
    expect(html).toContain('工位尝试与会话')
    expect(html).toContain('href="/sessions/SESS-1/att1"')
    expect(html).toContain('href="/sessions/SESS-1/att2"')
    expect(html).toContain('REPORT')
    expect(html).toContain('1 条会话')
  })

  it('/tickets：有会话的单子行出「会话」快捷链接；无会话的不出', async () => {
    const html = await (await app.request('/tickets')).text()
    expect(html).toContain(`href="/sessions?ticket=SESS-1"`)
    expect(html).not.toContain(`href="/sessions?ticket=PORTAL-1"`)
  })

  it('/ 概览：会话档案快捷入口＋最近会话卡（3 条内）', async () => {
    const html = await (await app.request('/')).text()
    expect(html).toContain('会话档案')
    expect(html).toContain('最近会话')
    expect(html).toContain('href="/sessions/SESS-1/att1"')
  })

  it('无尝试单子：区块降级文案（不冒充）', async () => {
    const html = await (await app.request('/tickets/PORTAL-2')).text()
    expect(html).toContain('暂无尝试记录')
  })
})

describe('降级矩阵（§三/§九.1：无 .AIWS／zstd 不可用）', () => {
  it('无 .AIWS：API available:false 空列表；页面明报；详情 404', async () => {
    const r = (await (await bareApp.request('/api/sessions')).json()) as { available: boolean; items: unknown[]; total: number }
    expect(r.available).toBe(false)
    expect(r.items).toEqual([])
    expect(r.total).toBe(0)
    const html = await (await bareApp.request('/sessions')).text()
    expect(html).toContain('未发现工位档案树')
    const res = await bareApp.request('/api/sessions/SESS-1/att1')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('sessions-not-mounted')
    const overview = await (await bareApp.request('/')).text()
    expect(overview).toContain('未发现工位档案树')
  })

  it('zstd 不可用：时间线降级横幅；摘要/REPORT 标签不受影响', async () => {
    const api = (await (await deadApp.request('/api/sessions/SESS-1/att1')).json()) as { transcript: { available: boolean; code: string }; events: unknown[] }
    expect(api.transcript.available).toBe(false)
    expect(api.transcript.code).toBe('zstd-unavailable')
    expect(api.events).toEqual([])
    const html = await (await deadApp.request('/sessions/SESS-1/att1')).text()
    expect(html).toContain('会话压缩工具不可用')
    const report = await (await deadApp.request('/sessions/SESS-1/att1?tab=report')).text()
    expect(report).toContain('REPORT SESS-1')
  })
})
