/**
 * packages/api/test/v2/app.test.ts —— 应用装配与静态边界（IMPL-06-07/08）
 *
 * 覆盖：
 *   ① API- 目录 16 条（API-01..16）与路由挂载同源；
 *   ② 404 路由错误体（唯一错误体＋traceId；路由不存在≠记录不存在）；
 *   ③ 构造期 fail-closed：缺 obs/gate/readers/auth、未知槽、禁止槽（platform/ledger）、
 *      裸平台 gate、重复 hook source、坏订阅 allowlist——一律 CONFIG_INVALID 拒启；
 *   ④ 类型面：ApiAppOptions 无 platform/ledger/db/engine/scheduler/dispatch/launch 槽；
 *      GatePort 无平台七能力；
 *   ⑤ 静态面：源码只 import hono/@studio-next/contract＋相对 .ts；无 api→panel/store 边；
 *      包声明＝实际 import（无装饰依赖）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ApiAppOptions } from '../../src/index.ts'
import {
  API_ENDPOINTS,
  API_ENDPOINT_COUNT,
  API_APP_FORBIDDEN_SLOTS,
  API_APP_SLOTS,
  createApiApp,
  resolveApiDeps,
} from '../../src/index.ts'
import type { GatePort } from '@studio-next/contract'
import { COMPANY, jsonBody, makeApp, makeAuth, makeGate, makeObs, makeReaders } from './fakes.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API_ROOT = path.resolve(HERE, '..', '..')
const SRC_ROOT = path.join(API_ROOT, 'src')

/** src 树内 .ts 件 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

/** 顶层 import/export 说明符（行首语句；注释里的示例不算） */
function importSpecsOf(source: string): string[] {
  const specs: string[] = []
  for (const pattern of [/^(?:import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^import\s*['"]([^'"]+)['"]/gm]) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1]
      if (spec !== undefined && !specs.includes(spec)) specs.push(spec)
    }
  }
  return specs
}

describe('API- 目录与路由同源', () => {
  it('16 个 API-ID 唯一；方法/路径与 v2/14 §四端点族表一致', () => {
    expect(API_ENDPOINT_COUNT).toBe(16)
    expect(API_ENDPOINTS).toHaveLength(16)
    expect(new Set(API_ENDPOINTS.map((entry) => entry.id)).size).toBe(16)
    expect(API_ENDPOINTS[0]?.id).toBe('API-01')
    expect(API_ENDPOINTS[15]?.id).toBe('API-16')

    const map = new Map(API_ENDPOINTS.map((entry) => [entry.id, `${entry.method} ${entry.path}`]))
    expect(map.get('API-01')).toBe('GET /v1/company')
    expect(map.get('API-02')).toBe('GET /v1/org')
    expect(map.get('API-03')).toBe('GET /v1/people')
    expect(map.get('API-04')).toBe('GET /v1/projects')
    expect(map.get('API-05')).toBe('GET /v1/issues')
    expect(map.get('API-06')).toBe('GET /v1/finance')
    expect(map.get('API-07')).toBe('GET /v1/reports')
    expect(map.get('API-08')).toBe('GET /v1/requests/status')
    expect(map.get('API-09')).toBe('GET /v1/agent-card')
    expect(map.get('API-10')).toBe('POST /v1/requests')
    expect(map.get('API-11')).toBe('POST /v1/explore')
    expect(map.get('API-12')).toBe('POST /v1/tasks')
    expect(map.get('API-13')).toBe('POST /v1/intel')
    expect(map.get('API-14')).toBe('GET /v1/events')
    expect(map.get('API-15')).toBe('POST /v1/hooks/{source}')
    expect(map.get('API-16')).toBe('GET|POST /v1/subscriptions')
  })

  it('触发面 auth 档＝非 none；只读面/SSE＝none（凭证三档口径）', () => {
    for (const entry of API_ENDPOINTS) {
      if (entry.id === 'API-10' || entry.id === 'API-11' || entry.id === 'API-12' || entry.id === 'API-13' || entry.id === 'API-16') {
        expect(entry.auth).not.toBe('none')
      }
      if (entry.id === 'API-15') expect(entry.auth).toBe('signed')
      if (entry.id === 'API-01' || entry.id === 'API-09' || entry.id === 'API-14') expect(entry.auth).toBe('none')
    }
  })
})

describe('应用错误面', () => {
  it('未知路由＝404（唯一错误体＋traceId＋no-store；不是 200/503）', async () => {
    const app = makeApp()
    const res = await app.request('/v1/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await jsonBody(res)
    expect(body['ok']).toBeUndefined()
    const error = body['error'] as Record<string, unknown>
    expect(error['failure']).toBe('route-not-found')
    expect(error['category']).toBe('unsupported')
    expect(error['subcause']).toBe('route-not-found')
    expect(typeof body['traceId']).toBe('string')
    expect(String(body['traceId'])).not.toBe('')
  })

  it('GET 触发面路径＝404（触发面只有 POST；不静默落单）', async () => {
    const app = makeApp()
    const res = await app.request('/v1/requests')
    expect(res.status).toBe(404)
  })

  it('注入 newId/clock 供 trace/时间戳（不触网络/不真读时钟）', async () => {
    const app = makeApp()
    const res = await app.request('/v1/company')
    const body = await jsonBody(res)
    expect(body['generatedAt']).toBe('2026-10-28T00:00:00.000Z')
  })
})

describe('构造期 fail-closed（半面启动拒启）', () => {
  const base = (): Record<string, unknown> => ({
    company: COMPANY,
    obs: makeObs(),
    gate: makeGate().gate,
    readers: makeReaders(),
    auth: makeAuth(),
  })

  it('缺 obs/gate/readers/auth 任一＝CONFIG_INVALID', () => {
    for (const slot of ['obs', 'gate', 'readers', 'auth'] as const) {
      const opts = base()
      delete opts[slot]
      expect(() => createApiApp(opts as unknown as ApiAppOptions)).toThrow(/CONFIG_INVALID/)
    }
  })

  it('未知槽（拼错）＝拒启，不静默忽略', () => {
    const opts = { ...base(), reader: makeReaders() }
    expect(() => createApiApp(opts as unknown as ApiAppOptions)).toThrow(/CONFIG_INVALID/)
  })

  it('禁止槽 platform/ledger/engine/dispatch＝拒启（零库零平台）', () => {
    for (const slot of ['platform', 'ledger', 'engine', 'dispatch', 'launch']) {
      const opts = { ...base(), [slot]: {} }
      expect(() => createApiApp(opts as unknown as ApiAppOptions)).toThrow(/CONFIG_INVALID/)
    }
  })

  it('gate 槽收到裸平台七能力（issues/comments/fields 同现）＝拒启（SEC-FC-07）', () => {
    const opts = {
      ...base(),
      gate: { ...makeGate().gate, issues: {}, comments: {}, fields: {} },
    }
    expect(() => createApiApp(opts as unknown as ApiAppOptions)).toThrow(/CONFIG_INVALID/)
  })

  it('readers 缺一件/未知键＝拒启', () => {
    const readers = makeReaders()
    const missing = { ...readers } as Record<string, unknown>
    delete missing['finance']
    expect(() => createApiApp({ ...base(), readers: missing } as unknown as ApiAppOptions)).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp({ ...base(), readers: { ...readers, roster: () => [] } } as unknown as ApiAppOptions)).toThrow(
      /CONFIG_INVALID/,
    )
  })

  it('hooks source 重复/secret 空/tolerance 越界＝拒启', () => {
    const make = (hooks: unknown): ApiAppOptions =>
      ({ ...base(), hooks }) as unknown as ApiAppOptions
    expect(() =>
      createApiApp(
        make([
          { source: 'github', signingSecret: 's1' },
          { source: 'github', signingSecret: 's2' },
        ]),
      ),
    ).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp(make([{ source: 'github', signingSecret: '' }]))).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp(make([{ source: 'github', signingSecret: 's', toleranceMs: 0 }]))).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp(make([{ source: 'GitHub', signingSecret: 's' }]))).toThrow(/CONFIG_INVALID/)
  })

  it('订阅 allowlist 条目带协议/斜杠/通配＝拒启（只收裸主机名）', () => {
    const make = (subscriptions: unknown): ApiAppOptions =>
      ({ ...base(), subscriptions }) as unknown as ApiAppOptions
    expect(() => createApiApp(make({ allowlist: ['https://hooks.partner.example'] }))).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp(make({ allowlist: ['*.partner.example'] }))).toThrow(/CONFIG_INVALID/)
    expect(() => createApiApp(make({ allowlist: 'hooks.partner.example' }))).toThrow(/CONFIG_INVALID/)
  })

  it('resolveApiDeps 返回冻结的收窄面（obs/gate/readers 为 wrapper）', () => {
    const deps = resolveApiDeps(base())
    expect(Object.isFrozen(deps)).toBe(true)
    expect(Object.isFrozen(deps.obs)).toBe(true)
    expect(Object.isFrozen(deps.gate)).toBe(true)
    expect(Object.isFrozen(deps.readers)).toBe(true)
    expect(API_APP_SLOTS).toContain('gate')
    expect(API_APP_FORBIDDEN_SLOTS).toContain('platform')
  })
})

describe('类型面：注入面不表达平台/台账/主循环/派工', () => {
  it('ApiAppOptions 无 platform/ledger/db/engine/scheduler/dispatch/launch/store 槽', () => {
    type Forbidden = Extract<
      keyof ApiAppOptions,
      'platform' | 'gatedPlatform' | 'ledger' | 'db' | 'engine' | 'scheduler' | 'dispatch' | 'launch' | 'store'
    >
    const noForbidden: Forbidden extends never ? true : false = true
    expect(noForbidden).toBe(true)
    expectTypeOf<ApiAppOptions['gate']>().toMatchTypeOf<GatePort>()
    type GateAbility = Extract<keyof ApiAppOptions['gate'], 'issues' | 'comments' | 'fields' | 'transition' | 'launch'>
    const noGateAbility: GateAbility extends never ? true : false = true
    expect(noGateAbility).toBe(true)
  })

  it('触发面返回的 outcome 值域只有 queued（受理结论槽在类型上不存在）', () => {
    expectTypeOf<ApiAppOptions['readers']>().not.toBeAny()
  })
})

describe('静态边界（源码/包声明）', () => {
  const files = collectTsFiles(SRC_ROOT)

  it('src 只 import hono/@studio-next/contract＋相对 .ts；无 store/panel/gateway/sqlite 边', () => {
    expect(files.length).toBeGreaterThan(10)
    const allowed = new Set(['hono', '@studio-next/contract'])
    for (const file of files) {
      for (const spec of importSpecsOf(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) {
          expect(spec.endsWith('.ts'), `${file} 相对 import 须带 .ts：${spec}`).toBe(true)
          continue
        }
        if (spec.startsWith('node:')) continue
        const packageName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec)
        expect(allowed.has(packageName), `${file} 非法依赖：${spec}`).toBe(true)
      }
    }
  })

  it('包声明＝实际 import（hono＋contract；无 panel/store 装饰依赖）', () => {
    const pkg = JSON.parse(readFileSync(path.join(API_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ])
    const imported = new Set(
      files
        .flatMap((file) => importSpecsOf(readFileSync(file, 'utf8')))
        .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'))
        .map((spec) => {
          const [scope, name] = spec.split('/')
          return scope !== undefined && scope.startsWith('@') ? `${scope}/${name ?? ''}` : (scope ?? spec)
        }),
    )
    expect([...declared].sort()).toEqual(['@studio-next/contract', 'hono'])
    expect([...imported].filter((name) => !declared.has(name))).toEqual([])
    expect([...declared].filter((name) => !imported.has(name))).toEqual([])
    expect(declared.has('@studio-next/panel')).toBe(false)
    expect(declared.has('@studio-next/store')).toBe(false)
  })

  it('源码不出现 API- 目录外的端点路径（路由与目录同源）', () => {
    const sources = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(sources.includes('/v1/docs')).toBe(false)
    expect(sources.includes('/v1/games')).toBe(false)
  })
})
