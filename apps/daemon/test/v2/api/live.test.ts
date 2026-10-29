/**
 * assembly/api 装配接线（runServe 同进程 API：readers/auth/监听/停机）—— MIG-06 欠账收口 V2 测试
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（API-01..16：GET 走只读投影、POST 唯一经 PORT-GATE；「API 进程零库零
 *     平台」；默认绑定环回；快照未命中=503 非 404；finance 缺源=unknown 不补 0）；
 *   - docs/plan/mig08-closeout.md §六 欠账①②（runServe→assembleApi/createApiApp 接线、
 *     API readers/auth 供给）与五出口扫描面（api-response＝第 5 出口）；
 *   - docs/v2/15 §一 SEC-FC-07（gated-only）、§三 SEC-WD-01（读写同一公司维）、
 *     §七 SEC-ROOT（root 不入接口面）、§4.4（API 响应出站闸）；
 *   - docs/v2/16 §三 api 行（`api→panel` 边永禁）。
 *
 * 栈形态：**fake 栈零外部依赖**——`platform: fake` ＋ demo 快照 ＋ 临时台账（ephemeral
 * 端口，真 node:http 监听环回）；不跑真 LLM、不打外部网络、不写真实用户目录。
 *
 * 覆盖：
 *   ① buildServeRuntime 装配 API app（同进程；readers=快照投影；apiPort 缺省 0）；
 *   ② 真 HTTP ephemeral：200 公司维／组织／人事聚合／项目卡；403 跨公司；503 缺口面（不补 0）；
 *   ③ 触发面 fail-closed：无凭据 401、partner 未装配 401、签名档 401、root 403；
 *   ④ 停机：close 后端口不可连；start 幂等；
 *   ⑤ 第 5 出口：JSON 响应过 guardApiResponse；闸阻断＝500 固定体（原响应不出站）；
 *   ⑥ 边界：assembly/api 零 panel/store/平台 import、零 console、相对 import 带 .ts。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp, MAX_REQUEST_BODY_BYTES } from '@studio-next/api'
import type { CompanyRef, CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { buildServeRuntime, DEMO_SNAPSHOT, parseDaemonConfig, type ServeRuntime } from '../../../src/assembly/serve.ts'
import { API_READ_FACE_GAPS, API_READ_FACE_SERVED, buildApiReaders } from '../../../src/assembly/api/readers.ts'
import { buildFailClosedGate, buildServeObsFace } from '../../../src/assembly/api/serve-face.ts'
import { buildApiIntakeAuth } from '../../../src/assembly/api/auth.ts'
import { startApiServer, type ApiServerHandle } from '../../../src/assembly/api/live.ts'

const NOW_MS = 1_700_000_000_000
const COMPANY: CompanyRef = { companyId: 'demo', slug: 'demo' }
const SNAPSHOT: CompanySnapshot = DEMO_SNAPSHOT

/** 临时根（afterAll 整根删除；失败也不留盘） */
const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'sn-api-live-'))
  roots.push(root)
  return root
}

/** 扁平 daemon.yaml（fake 栈；apiPort 缺省 0＝ephemeral，不抢 8788） */
function daemonYaml(root: string): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    '# assembly/api live 测试（fake 栈；零外部依赖）',
    `db: ${q(path.join(root, 'var', 'ledger.sqlite'))}`,
    'platform: fake',
    'company: demo',
    `rootDir: ${q(path.join(root, 'var'))}`,
    'tickMs: 25',
    '',
  ].join('\n')
}

/** fetch JSON（真 HTTP；状态码＋解析体一并返回） */
async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const res = await fetch(url, init)
  const text = await res.text()
  const body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  return { status: res.status, body, text }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、fake 栈：buildServeRuntime → API app 装配（同步装配、无监听）
// ─────────────────────────────────────────────────────────────────────────────

describe('buildServeRuntime：对外 API 同进程装配（readers/auth 注入）', () => {
  let root: string
  let ledger: Ledger
  let runtime: ServeRuntime
  const logs: string[] = []

  beforeAll(async () => {
    root = await makeRoot()
    await mkdir(path.join(root, 'var'), { recursive: true })
    const config = parseDaemonConfig(daemonYaml(root))
    // apiPort 缺省 0＝ephemeral（不抢 :8788；生产 daemon.yaml 显式指定 8788）
    expect(config.apiPort).toBe(0)
    ledger = openLedger(path.resolve(config.db))
    runtime = buildServeRuntime(config, ledger, SNAPSHOT, {
      log: (line: string): void => {
        logs.push(line)
      },
      clock: (): number => NOW_MS,
    })
  })

  afterAll(async () => {
    try {
      await runtime.stop()
    } catch {
      /* 已停（断言失败面兜底） */
    }
    try {
      ledger.close()
    } catch {
      /* already closed */
    }
    for (const item of roots) await rm(item, { recursive: true, force: true })
    roots.length = 0
  })

  it('装配面形状：in-process 标记、Hono app、serve 侧 start/close 生命周期在位', () => {
    const assembly = runtime.api.assembly
    expect(assembly.mode).toBe('in-process')
    expect(assembly.company).toEqual(COMPANY)
    expect(typeof assembly.app.fetch).toBe('function')
    expect(typeof runtime.api.start).toBe('function')
    expect(typeof runtime.api.close).toBe('function')
    expect(Object.isFrozen(assembly)).toBe(true)

    // 装配行证据（app 装配＋注入装配；同进程 gated-only 口径）
    const joined = logs.join('\n')
    expect(joined).toContain('[api] app 装配完成')
    expect(joined).toContain('[api] 注入式装配完成')
    expect(joined).toContain('readers=8')
    expect(joined).toContain('gated-only')

    // 只读面目录：有源四面 / 缺口四面（缺口显式，不补 0/空/绿）
    expect([...API_READ_FACE_SERVED]).toEqual(['company', 'org', 'people', 'projects'])
    expect([...API_READ_FACE_GAPS]).toEqual(['issues', 'finance', 'reports', 'agentCard'])
  })

  it('app.request 进程内驱动：公司维 200；finance 缺口 503（不补 0）', async () => {
    const company = await runtime.api.assembly.app.request('/v1/company')
    expect(company.status).toBe(200)
    const companyBody = (await company.json()) as { ok: boolean; company: { slug: string; name: string } }
    expect(companyBody.ok).toBe(true)
    expect(companyBody.company.slug).toBe('demo')

    const finance = await runtime.api.assembly.app.request('/v1/finance')
    expect(finance.status).toBe(503)
    const financeBody = (await finance.json()) as { error: { failure: string; subcause: string }; finance?: unknown }
    expect(financeBody.error.failure).toBe('view-unavailable')
    expect(financeBody.finance).toBeUndefined() // 不补 0、不给空摘要
  })

  it('配置面：apiPort 显式值装载；坏值/越界＝CONFIG_INVALID 拒（parse 面 fail-closed）', () => {
    expect(parseDaemonConfig(['db: ./x.sqlite', 'company: demo', 'platform: fake', 'apiPort: 8788'].join('\n')).apiPort).toBe(8788)
    expect(() =>
      parseDaemonConfig(['db: ./x.sqlite', 'company: demo', 'platform: fake', 'apiPort: 70000'].join('\n')),
    ).toThrow(/apiPort 须为 0\.\.65535 的整数/)
    // 非整数标量在标量收窄面即拒（num：须为非负数——fail-closed 不猜取整）
    expect(() =>
      parseDaemonConfig(['db: ./x.sqlite', 'company: demo', 'platform: fake', 'apiPort: 1.5'].join('\n')),
    ).toThrow(/daemon\.yaml：apiPort 须为非负数/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 二、真 HTTP ephemeral：读面/公司维/缺口/触发面认证/停机
// ─────────────────────────────────────────────────────────────────────────────

describe('startApiServer：真 HTTP ephemeral（环回；零外部依赖）', () => {
  let root: string
  let ledger: Ledger
  let runtime: ServeRuntime
  let server: ApiServerHandle
  const logs: string[] = []

  beforeAll(async () => {
    root = await makeRoot()
    await mkdir(path.join(root, 'var'), { recursive: true })
    const config = parseDaemonConfig(daemonYaml(root))
    ledger = openLedger(path.resolve(config.db))
    runtime = buildServeRuntime(config, ledger, SNAPSHOT, {
      log: (line: string): void => {
        logs.push(line)
      },
      clock: (): number => NOW_MS,
    })
    server = await runtime.api.start()
  })

  afterAll(async () => {
    try {
      await runtime.stop()
    } catch {
      /* 已停（断言失败面兜底） */
    }
    try {
      ledger.close()
    } catch {
      /* already closed */
    }
    for (const item of roots) await rm(item, { recursive: true, force: true })
    roots.length = 0
  })

  it('启动行打印实际端口/只读面/缺口；start 幂等（同句柄）', async () => {
    expect(server.url).toBe(`http://127.0.0.1:${String(server.port)}`)
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBeGreaterThan(0)
    const line = logs.find((item) => item.includes('对外 API 已监听'))
    expect(line).toBeDefined()
    expect(line).toContain(server.url)
    expect(line).toContain('只读面=company/org/people/projects')
    expect(line).toContain('finance(')
    expect(line).toContain('503 不补 0')
    // 幂等：重复 start 返回同一句柄（不重复监听）
    const again = await runtime.api.start()
    expect(again.port).toBe(server.port)
    expect(again.url).toBe(server.url)
  })

  it('GET /v1/company：200＋公司维同源；未知公司/跨公司 403（SEC-WD-01）', async () => {
    const ok = await fetchJson(`${server.url}/v1/company`)
    expect(ok.status).toBe(200)
    expect(ok.body['ok']).toBe(true)
    expect(ok.body['readOnly']).toBe(true)
    const company = ok.body['company'] as Record<string, unknown>
    expect(company['companyId']).toBe('demo')
    expect(company['slug']).toBe('demo')
    expect(company['name']).toBe(SNAPSHOT.name)
    expect(company['platform']).toBe(SNAPSHOT.platform.platform)

    const unknown = await fetchJson(`${server.url}/v1/company?company=no-such-co`)
    expect(unknown.status).toBe(403)
    const unknownError = unknown.body['error'] as Record<string, unknown>
    expect(unknownError['subcause']).toBe('company-scope-mismatch')

    // 跨公司读隔离对其它只读面同一规则（不是只有 company 面校验）
    const crossOrg = await fetchJson(`${server.url}/v1/org?company=other-co`)
    expect(crossOrg.status).toBe(403)
    expect((crossOrg.body['error'] as Record<string, unknown>)['subcause']).toBe('company-scope-mismatch')
  })

  it('GET /v1/org・/v1/people・/v1/projects：快照投影 200（聚合/单项目卡；零库）', async () => {
    const org = await fetchJson(`${server.url}/v1/org`)
    expect(org.status).toBe(200)
    const orgView = org.body['org'] as { company: string; departments: Array<Record<string, unknown>>; warnings: string[] }
    expect(orgView.company).toBe('demo')
    expect(orgView.departments).toHaveLength(SNAPSHOT.departments.length)
    expect(orgView.departments[0]?.['path']).toBe(SNAPSHOT.departments[0]?.path)
    expect(orgView.departments[0]?.['headcount']).toBe(SNAPSHOT.people.length)
    expect(orgView.warnings).toEqual([])

    const people = await fetchJson(`${server.url}/v1/people`)
    expect(people.status).toBe(200)
    const peopleView = people.body['people'] as { total: number; byDepartment: Array<{ key: string; count: number }> }
    expect(peopleView.total).toBe(SNAPSHOT.people.length)
    expect(peopleView.byDepartment).toEqual([{ key: SNAPSHOT.people[0]?.dept, count: SNAPSHOT.people.length }])

    const projects = await fetchJson(`${server.url}/v1/projects`)
    expect(projects.status).toBe(200)
    const items = projects.body['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]?.['projectId']).toBe('demo')
    // 单据投影缺源：不补 totalIssues/byState（槽位不出现，不是 0）
    expect(items[0]?.['totalIssues']).toBeUndefined()
    expect(items[0]?.['byState']).toBeUndefined()
  })

  it('缺口只读面＝503 且不补 0/空：finance・issues・reports・agent-card', async () => {
    for (const face of ['finance', 'issues', 'reports'] as const) {
      const res = await fetchJson(`${server.url}/v1/${face}`)
      expect(res.status).toBe(503)
      const error = res.body['error'] as Record<string, unknown>
      expect(error['failure']).toBe('view-unavailable')
      // 不以 0/空列表/unknown 摘要冒充
      expect(res.body[face]).toBeUndefined()
      expect(res.text).not.toContain('"value":0')
    }
    const card = await fetchJson(`${server.url}/v1/agent-card`)
    expect(card.status).toBe(503)
    expect((card.body['error'] as Record<string, unknown>)['failure']).toBe('view-unavailable')
  })

  it('触发面 fail-closed：无凭据 401、partner/signed 未装配 401、root 403（不匿名放行）', async () => {
    const triggerUrl = `${server.url}/v1/requests`
    const noCredential = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dedupKey: 'k-1', commissioner: { mapped: false, externalPrincipal: 'p', identityMappingBasis: 'b' }, body: {} }),
    })
    expect(noCredential.status).toBe(401)
    expect((noCredential.body['error'] as Record<string, unknown>)['subcause']).toBe('credential-missing')

    const partner = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer partner-1', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(partner.status).toBe(401)
    expect((partner.body['error'] as Record<string, unknown>)['subcause']).toBe('partner-credential-unwired')

    const signed = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { 'x-studio-signature': 'sig', 'x-studio-timestamp': '1', 'x-studio-nonce': 'n' },
      body: '{}',
    })
    expect(signed.status).toBe(401)
    expect((signed.body['error'] as Record<string, unknown>)['subcause']).toBe('signed-intake-unwired')

    // root 凭据一律拒（SEC-ROOT-01：root 不进接口面）——头声明与 Authorization 两形态都拒
    const rootHeader = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { 'x-studio-credential-class': 'root', authorization: 'Bearer scoped-1' },
      body: '{}',
    })
    expect(rootHeader.status).toBe(403)
    expect((rootHeader.body['error'] as Record<string, unknown>)['subcause']).toBe('root-credential-forbidden')

    const rootScheme = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { authorization: 'Root operating-key' },
      body: '{}',
    })
    expect(rootScheme.status).toBe(403)
    expect((rootScheme.body['error'] as Record<string, unknown>)['subcause']).toBe('root-credential-forbidden')

    // 载荷上限在监听壳先拦（与端点同源常量；不先缓冲无限载荷）——413 不是 401/500
    const tooLarge = await fetchJson(triggerUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer partner-1' },
      body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1),
    })
    expect(tooLarge.status).toBe(413)
    expect((tooLarge.body['error'] as Record<string, unknown>)['failure']).toBe('payload-too-large')
  })

  it('停机：close 后端口不可连（再请求失败；不残留监听）', async () => {
    const url = server.url
    const before = await fetchJson(`${url}/v1/company`)
    expect(before.status).toBe(200)
    await runtime.api.close()
    await expect(fetch(`${url}/v1/company`)).rejects.toThrow()
    // close 幂等（停机收口可重入）
    await expect(runtime.api.close()).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 三、第 5 出口：API 响应面过 guardApiResponse（生产装配点＝live.ts JSON 回写）
// ─────────────────────────────────────────────────────────────────────────────

describe('API 响应面出站闸（第 5 出口 wrapper；fail-closed）', () => {
  it('JSON 响应过闸并回写；闸阻断＝500 固定体（原响应不出站、不泄漏公司名）', async () => {
    const obs = buildServeObsFace({ clock: (): number => NOW_MS })
    const makeApp = (): ReturnType<typeof createApiApp> =>
      createApiApp({
        company: COMPANY,
        obs,
        gate: buildFailClosedGate(),
        readers: buildApiReaders(SNAPSHOT, obs),
        auth: buildApiIntakeAuth(),
      })

    const seen: unknown[] = []
    const guarded = await startApiServer(makeApp(), {
      port: 0,
      guardResponse: (payload: unknown): unknown => {
        seen.push(payload)
        return payload
      },
    })
    try {
      const ok = await fetchJson(`${guarded.url}/v1/company`)
      expect(ok.status).toBe(200)
      expect(seen).toHaveLength(1)
      const payload = seen[0] as { ok?: boolean; company?: { slug?: string } }
      expect(payload.ok).toBe(true)
      expect(payload.company?.slug).toBe('demo')
    } finally {
      await guarded.close()
    }

    const blocked = await startApiServer(makeApp(), {
      port: 0,
      guardResponse: (): unknown => {
        throw new Error('outbound-gate blocked')
      },
    })
    try {
      const res = await fetchJson(`${blocked.url}/v1/company`)
      expect(res.status).toBe(500)
      expect((res.body['error'] as Record<string, unknown>)['subcause']).toBe('api-response-blocked')
      // 原响应不出站：公司名/公司维不外露（阻断体是固定常量）
      expect(res.text).not.toContain(SNAPSHOT.name)
    } finally {
      await blocked.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 四、边界（机制而非自律）：api→panel 零 import、零库/平台/console、.ts 相对 import
// ─────────────────────────────────────────────────────────────────────────────

describe('装配边界（assembly/api 目录）', () => {
  const apiSrcDir = fileURLToPath(new URL('../../../src/assembly/api/', import.meta.url))
  const files = readdirSync(apiSrcDir).filter((file) => file.endsWith('.ts'))
  const sources = new Map(files.map((file) => [file, readFileSync(path.join(apiSrcDir, file), 'utf8')]))

  it('api→panel 零 import；零库/零平台 import（API 进程零库零平台）', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('index.ts')
    expect(files).toContain('readers.ts')
    expect(files).toContain('auth.ts')
    expect(files).toContain('live.ts')
    const forbidden = [
      '@studio-next/panel',
      '@studio-next/store',
      '@studio-next/localplatform',
      '@studio-next/taiga',
      '@studio-next/matrix',
      'node:sqlite',
    ]
    for (const [file, text] of sources) {
      for (const spec of forbidden) {
        expect(text, `${file} 不得出现 ${spec}`).not.toContain(`from '${spec}'`)
      }
    }
  })

  it('零 console 直写（监听壳不写 stdout）；相对 import 全带 .ts', () => {
    for (const [file, text] of sources) {
      expect(text, `${file} 不得 console 直写`).not.toMatch(/\bconsole\.(log|error|warn|info)\(/)
      for (const match of text.matchAll(/\bfrom\s+'(\.{1,2}\/[^']+)'/g)) {
        const spec = match[1] ?? ''
        expect(spec.endsWith('.ts') || spec.endsWith('/'), `${file} 相对 import 须带 .ts：${spec}`).toBe(true)
      }
    }
  })
})
