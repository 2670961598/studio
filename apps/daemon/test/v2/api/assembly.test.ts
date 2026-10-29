/**
 * assembly/api 注入式装配 —— MIG-06 / IMPL-06-06 V2 测试
 *
 * 依据（实现单引用）：
 *   - plan/05 IMPL-06-06 冻结验收：`bun run test:v2 -- apps/daemon/test/v2/api` 绿；
 *     裸 platform 注入＝装配错误拒启；`api→panel` 边永禁（guard 绿即证）；
 *   - docs/v2/14 §四（API 只落单不派工：读面同源 PORT-OBS、写面唯一经 PORT-GATE；
 *     「API 进程零库零平台」；装配＝daemon 同进程注入）；
 *   - docs/v2/15 §一 SEC-FC-07（一切非测试装配只允许 gated 形态；裸 platform 注入＝
 *     装配错误拒启）与 §三 SEC-WD-03（写路径全行 gated 才算唯一写入者成立）；
 *   - docs/v2/16 §三 api 行（装配落 assembly/api；端点落地前不留占位依赖）。
 *
 * 栈形态：**fake 栈零外部依赖**——fake PORT-OBS 只读子口、fake PORT-GATE、fake 平台
 * （createFakePlatform）＋主循环/台账 spy；不跑真 LLM、不打网络、不写磁盘（临时目录
 * 仅本文件的只读仓扫描用）。
 *
 * 覆盖：
 *   ① 注入装配正例：只读 obs＋gated gate 注入成功，读/落单只经注入句柄（零主循环、
 *      零台账直写）；能力 wrapper 收窄（reportFault/平台七能力不可达）；装配行证据；
 *   ② 拒启面：裸 platform（顶层槽与 gate 槽）、缺 obs/gate、空/null 注入、主循环/台账
 *      槽、未知槽、坏 company/log、坏 obs 形状——一律 CONFIG_INVALID（fail-closed）；
 *   ③ 类型/运行期断言：ApiInjection/ApiAssembly 无 platform/engine/ledger/tick 槽；
 *      裸 FlowPlatform 不满足 GatePort；端口/装配面冻结；
 *   ④ 包声明：packages/api 声明依赖＝实际 import（无装饰依赖），且无 `api→panel` 边。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  CallContext,
  CallerRef,
  ClockReading,
  CompanyRef,
  DeliveryReceipt,
  ExternalIntent,
  FlowPlatform,
  GatePort,
  HealthReport,
  Identifier,
  IntentKey,
  IntentReceipt,
  NotificationEnvelope,
  PortResult,
  Projection,
  ReadContext,
  ViewId,
} from '@studio-next/contract'
import type { ApiIntakeAuthResult, ApiReadSources } from '@studio-next/api'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import {
  API_ASSEMBLY_MODE,
  API_FORBIDDEN_LEDGER_SLOTS,
  API_FORBIDDEN_MAIN_LOOP_SLOTS,
  API_FORBIDDEN_PLATFORM_SLOTS,
  assembleApi,
  assertApiInjection,
  type ApiAssembly,
  type ApiInjection,
  type ApiObservationReadFace,
} from '../../../src/assembly/api/index.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 公共夹具（fake 栈；全内存、零外部依赖）
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY: CompanyRef = { companyId: 'C-001', slug: 'demo' }
const NOW = '2026-10-28T00:00:00.000Z'
const VIEW: ViewId = { viewName: 'company', company: COMPANY }

const CALLER: CallerRef = { callerId: 'api:external-1', kind: 'program', programRef: 'PORT-GATE' }

const CALL_CTX: CallContext = {
  company: COMPANY,
  caller: CALLER,
  authority: [
    { recordId: 'grant:api-1', version: { recordId: 'grant:api-1', version: 1 }, grantClass: 'delegation' },
  ],
  signature: { actorKind: 'system', actorRef: 'api-assembly', onBehalfOf: 'commissioner:external-1' },
}

const READ_CTX: ReadContext = {
  readScope: { company: COMPANY, fields: ['company.name'], purpose: 'api-info-face' },
  caller: CALLER,
}

const INTENT: ExternalIntent = {
  company: COMPANY,
  source: 'http',
  requestKind: 'request',
  key: 'idem-0001',
  toolScope: 'intake_comment',
  auth: { tier: 'partner', credentialRef: 'credential:partner-1' },
  commissioner: { mapped: true, caller: CALLER },
  dispatcherAnchor: { defaulted: true, resolvedBy: 'intake_governance_position' },
  submittedBy: CALLER,
  body: { title: '外部需求（只落单不派工）' },
  payloadDigest: 'sha256:fixture',
  receivedAt: NOW,
}

const INTENT_KEY: IntentKey = {
  company: COMPANY,
  source: INTENT.source,
  requestKind: INTENT.requestKind,
  key: INTENT.key,
}

/** fake 投影（读面证据：只验装配/委派，不冒充业务读数真值） */
function projectionOf(view: ViewId): Projection {
  return {
    view,
    projectionRuleVersion: 'fake/v0',
    authoritativeSource: {
      endpoint: { endpointId: 'api-assembly-fake', kind: 'projection', location: 'in-process' },
      generation: 1,
    },
    sourceCursor: 'cursor-1',
    generatedAt: NOW,
    dataValidWindow: { from: '2026-10-27T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' },
    knowledgeScope: ['public'],
    viewCompleteness: 'complete',
    stateAssignments: [{ face: 'company', state: 'observed', basis: 'fake 栈注入', lastTrustedCursor: 'cursor-1' }],
    stateLegend: 'fake 投影（装配测试不验业务读数）',
    readOnly: true,
    mutatesFacts: false,
  }
}

/** fake 读面（带调用记录；wrapper 只转调允许的四槽） */
interface FakeObsFace extends ApiObservationReadFace {
  readonly snapshots: ViewId[]
}

function makeFakeObs(): FakeObsFace {
  const snapshots: ViewId[] = []
  return {
    snapshots,
    snapshot(view: ViewId): PortResult<Projection> {
      snapshots.push(view)
      return { kind: 'ok', value: projectionOf(view) }
    },
    clock(): ClockReading {
      return { now: NOW, source: 'injected' }
    },
    newId(kind: string): Identifier {
      return { kind, value: `${kind}-0001`, sortable: true }
    },
    health(): PortResult<HealthReport> {
      return {
        kind: 'ok',
        value: {
          service: 'studio-next-api',
          checkedAt: NOW,
          availability: 'unavailable',
          resources: [],
          autonomyProven: false,
          proofBoundary: {
            proves: ['注入只读端口被调用'],
            doesNotProve: ['公司自治在线率（v2/05 §四）'],
          },
        },
      }
    },
  }
}

/** fake gated 入口（三方法全；调用面记录） */
interface FakeGateFace extends GatePort {
  readonly received: ExternalIntent[]
  readonly receiptQueries: IntentKey[]
}

function makeFakeGate(): FakeGateFace {
  const received: ExternalIntent[] = []
  const receiptQueries: IntentKey[] = []
  return {
    received,
    receiptQueries,
    receiveIntent(intent: ExternalIntent): PortResult<IntentReceipt> {
      received.push(intent)
      return {
        kind: 'ok',
        value: {
          intentRef: `intent:${intent.key}`,
          identity: {
            company: intent.company,
            source: intent.source,
            requestKind: intent.requestKind,
            key: intent.key,
          },
          outcome: 'queued',
          commissionerRef: 'commissioner:external-1',
          anchorRef: 'position:宰相',
          queuedAt: NOW,
          deduped: false,
        },
      }
    },
    receipt(key: IntentKey): PortResult<IntentReceipt | undefined> {
      receiptQueries.push(key)
      return { kind: 'ok', value: undefined }
    },
    notify(envelope: NotificationEnvelope): PortResult<DeliveryReceipt> {
      return {
        kind: 'ok',
        value: {
          notificationId: envelope.notificationId,
          dedupKey: envelope.dedupKey,
          deliveryState: 'sent',
          targets: ['#alert'],
          evidenceRefs: [],
          deduped: false,
          reconcile: { required: false, reason: 'fake 栈：通知非装配断言面' },
        },
      }
    },
  }
}

/** fake 只读投影读取器（八件齐；返回空投影——注入面装配断言不验业务读数） */
function makeFakeReaders(): ApiReadSources {
  return {
    company: () => undefined,
    org: () => undefined,
    people: () => undefined,
    projects: () => undefined,
    issues: () => undefined,
    finance: () => undefined,
    reports: () => undefined,
    agentCard: () => undefined,
  }
}

/** fake 触发面认证器（fail-closed：与本仓 auth.ts 同向——恒拒，不匿名放行） */
function makeFakeAuth(): (input: { readonly method: string }) => ApiIntakeAuthResult {
  return () => ({ ok: false, status: 401, subcause: 'credential-missing' })
}

/** 合法注入面（正例基线） */
function baseInjection(): ApiInjection {
  return { company: COMPANY, obs: makeFakeObs(), gate: makeFakeGate(), readers: makeFakeReaders(), auth: makeFakeAuth() }
}

/** 模拟 JS 调用面（类型闸之外的运行期入参；装配仍须 fail-closed） */
function asInjected(value: Record<string, unknown>): ApiInjection {
  return value as unknown as ApiInjection
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、注入装配正例
// ─────────────────────────────────────────────────────────────────────────────

describe('注入装配正例（fake 栈：只读端口＋gated 入口）', () => {
  it('assembleApi：读/落单只经注入句柄；零主循环、零台账直写、零裸平台', () => {
    const obs = makeFakeObs()
    const gate = makeFakeGate()
    // fake 运行栈：主循环/台账/平台只用于证「装配体未持有」——装配入参里根本不出现
    const runtime = {
      engine: { ingest: vi.fn(), tick: vi.fn() },
      ledger: { kvSet: vi.fn(), kvGet: vi.fn(), close: vi.fn() },
      platform: createFakePlatform(),
    }
    const logs: string[] = []

    const assembly = assembleApi({
      company: COMPANY,
      obs,
      gate,
      readers: makeFakeReaders(),
      auth: makeFakeAuth(),
      log: (line: string): void => void logs.push(line),
    })

    expect(assembly.mode).toBe(API_ASSEMBLY_MODE)
    expect(assembly.mode).toBe('in-process')
    expect(assembly.company).toEqual(COMPANY)
    expect(Object.isFrozen(assembly)).toBe(true)
    expect(Object.isFrozen(assembly.ports)).toBe(true)
    expect(Object.isFrozen(assembly.ports.obs)).toBe(true)
    expect(Object.isFrozen(assembly.ports.gate)).toBe(true)

    // 只读面收窄：wrapper 只留 PORT-OBS 四槽（reportFault 不可达）
    expect(Object.keys(assembly.ports.obs).sort()).toEqual(['clock', 'health', 'newId', 'snapshot'])
    expect(assembly.ports.obs).not.toBe(obs)
    // gated-only 收窄：wrapper 只留 PORT-GATE 三方法（平台七能力不可达）
    expect(Object.keys(assembly.ports.gate).sort()).toEqual(['notify', 'receipt', 'receiveIntent'])
    expect(assembly.ports.gate).not.toBe(gate)

    // 读面委派（fake 记录到调用）
    expect(assembly.ports.obs.snapshot(VIEW, READ_CTX).kind).toBe('ok')
    expect(obs.snapshots).toEqual([VIEW])
    expect(assembly.ports.obs.clock()).toEqual({ now: NOW, source: 'injected' })
    expect(assembly.ports.obs.newId('trace').value).toBe('trace-0001')
    expect(assembly.ports.obs.health(READ_CTX).kind).toBe('ok')

    // 写面委派：唯一入口是 gate.receiveIntent（只落单，不派工）
    expect(assembly.ports.gate.receiveIntent(INTENT, CALL_CTX).kind).toBe('ok')
    expect(gate.received).toEqual([INTENT])
    expect(assembly.ports.gate.receipt(INTENT_KEY, READ_CTX).kind).toBe('ok')
    expect(gate.receiptQueries).toEqual([INTENT_KEY])

    // API 不独立取主循环/不直写台账：装配体零引用，调用期零触达
    expect(runtime.engine.ingest).not.toHaveBeenCalled()
    expect(runtime.engine.tick).not.toHaveBeenCalled()
    expect(runtime.ledger.kvSet).not.toHaveBeenCalled()
    expect(Object.values(assembly)).not.toContain(runtime.engine)
    expect(Object.values(assembly)).not.toContain(runtime.ledger)
    expect(Object.values(assembly)).not.toContain(runtime.platform)
    expect(Object.keys(assembly).sort()).toEqual(['app', 'company', 'mode', 'ports'])
    // 装配面含 Hono app（端点族序列化唯一源＝packages/api；本件只交装配序）
    expect(typeof assembly.app.fetch).toBe('function')
    const assemblyRecord = assembly as unknown as Record<string, unknown>
    expect(['engine', 'ledger', 'platform', 'tick', 'ingest'].filter((key) => key in assemblyRecord)).toEqual([])

    // 装配序证据：同进程装配行（含 gated/零直写口径）＋app 装配行（端点族）
    expect(logs).toHaveLength(2)
    expect(logs[0]).toContain('[api] app 装配完成')
    expect(logs[1]).toContain('[api] 注入式装配完成')
    expect(logs[1]).toContain('company=demo')
    expect(logs[1]).toContain('gate=PORT-GATE(gated-only')
    expect(logs[1]).toContain('readers=8')
    expect(logs[1]).toContain('auth=fail-closed')
    expect(logs[1]).toContain('零主循环')
    expect(logs[1]).toContain('零台账直写')

    // 注入面校验函数本身可独立调用（返回收窄后的冻结面）
    const checked = assertApiInjection(baseInjection())
    expect(checked.company).toEqual(COMPANY)
    expect(Object.isFrozen(checked)).toBe(true)
  })

  it('装配面冻结：ports/company 事后不可改（运行期防二次注入）', () => {
    const assembly = assembleApi(baseInjection())
    const mutablePorts = assembly.ports as { obs?: ApiObservationReadFace }
    const mutableCompany = assembly.company as { slug: string }
    expect(() => {
      mutablePorts.obs = makeFakeObs()
    }).toThrow(TypeError)
    expect(() => {
      mutableCompany.slug = 'other'
    }).toThrow(TypeError)
    expect(assembly.ports.obs).toBeDefined()
    expect(assembly.company.slug).toBe('demo')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 二、拒启面（fail-closed）
// ─────────────────────────────────────────────────────────────────────────────

describe('拒启面（裸 platform／缺注入／直写槽）', () => {
  it('裸 platform 注入＝装配错误拒启（SEC-FC-07：API 注入面零平台）', () => {
    const bare = createFakePlatform()
    const injection = asInjected({ ...baseInjection(), platform: bare })
    expect(() => assembleApi(injection)).toThrow(/CONFIG_INVALID\/api\/assembly:bare-platform/)
    expect(() => assembleApi(injection)).toThrow(/SEC-FC-07/)
    // gated 平台句柄同样不进 API 注入面（v2/14 §四「零平台」：写面唯一经 gate）
    expect(() => assembleApi(asInjected({ ...baseInjection(), gatedPlatform: bare }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:bare-platform/,
    )
    expect(() => assembleApi(asInjected({ ...baseInjection(), flowPlatform: bare }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:bare-platform/,
    )
  })

  it('裸 platform 塞进 gate 槽亦拒（gated-only：平台七能力不满足 PORT-GATE）', () => {
    const injection = asInjected({ company: COMPANY, obs: makeFakeObs(), gate: createFakePlatform() })
    expect(() => assembleApi(injection)).toThrow(/CONFIG_INVALID\/api\/assembly:bare-platform/)
    expect(() => assembleApi(injection)).toThrow(/gated-only/)
  })

  it('缺 obs／缺 gate／缺 readers／缺 auth／空注入／null 注入＝拒启（半面启动不许当降级）', () => {
    expect(() => assembleApi(asInjected({ company: COMPANY, gate: makeFakeGate() }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:missing-obs/,
    )
    expect(() => assembleApi(asInjected({ company: COMPANY, obs: makeFakeObs() }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:missing-gate/,
    )
    expect(() =>
      assembleApi(asInjected({ company: COMPANY, obs: makeFakeObs(), gate: makeFakeGate(), auth: makeFakeAuth() })),
    ).toThrow(/CONFIG_INVALID\/api\/assembly:missing-readers/)
    expect(() =>
      assembleApi(asInjected({ company: COMPANY, obs: makeFakeObs(), gate: makeFakeGate(), readers: makeFakeReaders() })),
    ).toThrow(/CONFIG_INVALID\/api\/assembly:missing-auth/)
    expect(() => assembleApi(asInjected({}))).toThrow(/CONFIG_INVALID\/api\/assembly:company-missing/)
    expect(() => assembleApi(null as unknown as ApiInjection)).toThrow(
      /CONFIG_INVALID\/api\/assembly:injection-shape/,
    )
    expect(() => assembleApi(undefined as unknown as ApiInjection)).toThrow(
      /CONFIG_INVALID\/api\/assembly:injection-shape/,
    )
  })

  it('主循环/台账/平台类禁止槽出现即拒（API 不持主循环、不直写台账）', () => {
    for (const slot of API_FORBIDDEN_MAIN_LOOP_SLOTS) {
      expect(() => assembleApi(asInjected({ ...baseInjection(), [slot]: { marker: slot } }))).toThrow(
        /CONFIG_INVALID\/api\/assembly:main-loop/,
      )
    }
    for (const slot of API_FORBIDDEN_LEDGER_SLOTS) {
      expect(() => assembleApi(asInjected({ ...baseInjection(), [slot]: { marker: slot } }))).toThrow(
        /CONFIG_INVALID\/api\/assembly:direct-ledger/,
      )
    }
    for (const slot of API_FORBIDDEN_PLATFORM_SLOTS) {
      expect(() => assembleApi(asInjected({ ...baseInjection(), [slot]: createFakePlatform() }))).toThrow(
        /CONFIG_INVALID\/api\/assembly:bare-platform/,
      )
    }
  })

  it('只读面收窄校验：obs 缺方法→拒；未知槽/坏 company/坏 log 形状→拒', () => {
    const obsWithoutHealth = {
      snapshot: (): PortResult<Projection> => ({ kind: 'ok', value: projectionOf(VIEW) }),
      clock: (): ClockReading => ({ now: NOW, source: 'injected' }),
      newId: (kind: string): Identifier => ({ kind, value: kind, sortable: true }),
    }
    expect(() => assembleApi(asInjected({ company: COMPANY, obs: obsWithoutHealth, gate: makeFakeGate() }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:obs-shape/,
    )

    expect(() => assembleApi(asInjected({ ...baseInjection(), mystery: 1 }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:unknown-slot/,
    )
    expect(() =>
      assembleApi(asInjected({ ...baseInjection(), company: { companyId: '', slug: 'demo' } })),
    ).toThrow(/CONFIG_INVALID\/api\/assembly:company-invalid/)
    expect(() =>
      assembleApi(asInjected({ ...baseInjection(), company: { companyId: 'C-001', slug: 'Bad Slug' } })),
    ).toThrow(/CONFIG_INVALID\/api\/assembly:company-invalid/)
    expect(() => assembleApi(asInjected({ ...baseInjection(), log: 'not-a-function' }))).toThrow(
      /CONFIG_INVALID\/api\/assembly:log-shape/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 三、类型面（编译期闸；typecheck:v2 即证据）
// ─────────────────────────────────────────────────────────────────────────────

describe('类型面（编译期收口）', () => {
  it('ApiInjection/ApiAssembly 无 platform/engine/ledger/tick 槽；读面无 reportFault', () => {
    expectTypeOf<ApiInjection>().toHaveProperty('company')
    expectTypeOf<ApiInjection>().toHaveProperty('obs')
    expectTypeOf<ApiInjection>().toHaveProperty('gate')
    expectTypeOf<ApiInjection>().not.toHaveProperty('platform')
    expectTypeOf<ApiInjection>().not.toHaveProperty('gatedPlatform')
    expectTypeOf<ApiInjection>().not.toHaveProperty('engine')
    expectTypeOf<ApiInjection>().not.toHaveProperty('ingest')
    expectTypeOf<ApiInjection>().not.toHaveProperty('tick')
    expectTypeOf<ApiInjection>().not.toHaveProperty('ledger')
    expectTypeOf<ApiInjection>().not.toHaveProperty('db')
    expectTypeOf<ApiObservationReadFace>().not.toHaveProperty('reportFault')
    expectTypeOf<ApiAssembly>().not.toHaveProperty('engine')
    expectTypeOf<ApiAssembly>().not.toHaveProperty('ledger')
    expectTypeOf<ApiAssembly>().not.toHaveProperty('platform')
    // 裸 FlowPlatform 结构上不是 GatePort（gated-only：平台句柄不可冒充意图入口）
    expectTypeOf<FlowPlatform>().not.toExtend<GatePort>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 四、packages/api 装配声明（无装饰依赖；api→panel 边不出现）
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))
const API_PKG_PATH = path.join(REPO_ROOT, 'packages', 'api', 'package.json')
const API_SRC_DIR = path.join(REPO_ROOT, 'packages', 'api', 'src')

/** src 树内 .ts 件（包声明＝真实 import 的机械比对面） */
function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

/** 静态 import/export 的模块说明符（doc 注释里的示例不参与——仓内件实测无此形） */
function importSpecsOf(file: string): string[] {
  const specs: string[] = []
  for (const match of readFileSync(file, 'utf8').matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1] ?? match[2]
    if (spec !== undefined) specs.push(spec)
  }
  return specs
}

/** 说明符 → 包名（相对/node: 内置/null；作用域包取两段） */
function packageOfSpec(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('/')) return null
  const [scope, name] = spec.split('/')
  if (scope === undefined) return null
  if (scope.startsWith('@')) return name === undefined ? null : `${scope}/${name}`
  return scope
}

describe('packages/api 装配声明（真实依赖，不留装饰）', () => {
  it('声明依赖＝实际 import；无 api→panel 边', () => {
    const pkg = JSON.parse(readFileSync(API_PKG_PATH, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ])
    const imported = new Set(
      collectTsFiles(API_SRC_DIR)
        .flatMap(importSpecsOf)
        .map(packageOfSpec)
        .filter((name): name is string => name !== null),
    )

    // 不留装饰依赖（v2/16 §三 api 行「端点落地前不留占位依赖」）
    expect([...declared].filter((name) => !imported.has(name))).toEqual([])
    // 不隐式使用未声明依赖（声明门与 import 图同源）
    expect([...imported].filter((name) => !declared.has(name))).toEqual([])
    // api→panel 边永禁（v2/14 §二/§四；guard 同判据）
    expect(declared.has('@studio-next/panel')).toBe(false)
    expect(imported.has('@studio-next/panel')).toBe(false)
  })
})
