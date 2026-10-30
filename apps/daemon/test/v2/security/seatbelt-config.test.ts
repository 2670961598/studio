/**
 * seatbelt-config.test.ts —— daemon.yaml seatbelt 配置通道（IMPL-07-09 随动；v2/15 §一 SEC-FC-05）
 *
 * 依据：docs/plan/05 IMPL-07-09（派发域 seatbelt 调用方随动；缺省最严／放宽显式授权留痕）；
 *   docs/v2/15 §一 SEC-FC-05（缺省 read-only、放宽须显式授权并留痕、派发校验失败不启动）；
 *   docs/v2/12 §3.3（read-only/workspace-write 两档；PRB-04 实际拦截未探＝按不支持处理）。
 *
 * 本套钉三面（配置通道是「档位语义」在 daemon.yaml 的唯一入口，不新增记录类/端口）：
 *   1. 解析正例：缺省不写＝undefined（read-only 最严）／显式 read-only／workspace-write 三键齐备；
 *   2. 解析负例：tier 值域封闭、read-only 给 roots/auth 拒、workspace-write 缺键/空数组/非 JSON/
 *      相对路径/非字符串项拒——全部 fail-closed，不静默补全、不静默放宽；
 *   3. 装配注入：`ServeRuntime.dispatchSeatbelt` 与 `config.seatbelt` 深一致；同一 grant 同时进
 *      `dispatchAdapterResolver(config.seatbelt)`（executor-face）与 `EngineDeps.dispatchSeatbelt`
 *      （runtime）；缺省不注入＝read-only（runtime e2e DISPATCH note 可判）；
 *      workspace-write 在无 seatbelt 端子的 demo executor 上＝拒派（证明 grant 确已进引擎）；
 *      有端子的 dsh 名上＝DISPATCH note 携授权原文（解析产物→派发台账端到端）。
 *
 * 边界：PRB-04 未执行——本套只证「配置通道/计划/留痕」按档位收口，**不得**读成写域已封死；
 *   runtime 的 workspace-write e2e 用直接引擎（buildServeRuntime 恒装 fake executor，无 seatbelt
 *   端子是 07-08 的既有 fail-closed 面，不以测试夹具绕过），runtime 装配面另以深一致＋拒派断言。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRegistry, resolveSeatbeltGrant } from '@studio-next/adapters'
import type { SeatbeltGrant } from '@studio-next/adapters'
import { createLocalPlatform } from '@studio-next/localplatform'
import { openLedger } from '@studio-next/store'
import type { Ledger } from '@studio-next/store'
import { buildServeRuntime, parseDaemonConfig } from '../../../src/assembly/serve.ts'
import type { ServeConfig, ServeRuntime } from '../../../src/assembly/serve.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { createEngine, ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { dispatchAdapterResolver } from '../../../src/engine/work/dispatch-seatbelt.ts'

const T0 = Date.parse('2026-11-02T00:00:00.000Z')
const SECRET_ENV = 'STUDIO_GATEWAY_SECRET'
const GATEWAY_KEY_MATERIAL = 'studio-next-v2-seatbelt-config-channel-key-material-0123456789'
const AUTHORIZATION = '制作人 2026-10-30 批 / IMPL-07-09 配置通道'

const workdir = mkdtempSync(path.join(tmpdir(), 'seatbelt-config-v2-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function newRoot(tag: string): string {
  const root = mkdtempSync(path.join(workdir, `${tag}-`))
  mkdirSync(path.join(root, 'var'), { recursive: true })
  return root
}

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

/** 三键齐备的 workspace-write 片段（JSON 数组字符串用 YAML 单引号包裹——扁平 YAML 不收裸列表） */
function wideningLines(root: string): string[] {
  return [
    'seatbeltTier: workspace-write',
    `seatbeltWriteRoots: '${JSON.stringify([path.join(root, 'var')])}'`,
    `seatbeltAuthorization: ${AUTHORIZATION}`,
  ]
}

function catchError(run: () => unknown): string {
  try {
    run()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望 CONFIG_INVALID 拒绝，实际放行——fail-open 路径仍在')
}

// —— 一、解析正例：缺省不写＝read-only 最严 ——

describe('daemon.yaml seatbelt 三键：缺省不写＝read-only（不注入 grant）', () => {
  it('三键全缺省：cfg.seatbelt 恒 undefined（不是隐性 {tier:read-only}）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.seatbelt).toBeUndefined()
  })

  it('显式 seatbeltTier: read-only → {tier:read-only}（不携带 roots/auth）', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nseatbeltTier: read-only`)
    expect(cfg.seatbelt).toEqual({ tier: 'read-only' })
    expect(cfg.seatbelt?.writeRoots).toBeUndefined()
    expect(cfg.seatbelt?.authorization).toBeUndefined()
  })

  it('workspace-write 三键齐备：JSON 数组字符串 → 绝对路径列表；authorization 原文（trim）', () => {
    const root = newRoot('parse-ok')
    const cfg = parseDaemonConfig(
      [BASE_YAML, ...wideningLines(root).map((line) => (line.startsWith('seatbeltAuthorization') ? `${line}   ` : line))].join('\n'),
    )
    expect(cfg.seatbelt).toEqual({
      tier: 'workspace-write',
      writeRoots: [path.join(root, 'var')],
      authorization: AUTHORIZATION,
    })
    // 与 07-08 守门同源：解析产物可被 resolveSeatbeltGrant 直接接受（非法档/无授权不可能走到装配面）
    expect(resolveSeatbeltGrant(cfg.seatbelt)).toEqual({
      tier: 'workspace-write',
      writeRoots: [path.join(root, 'var')],
      authorization: AUTHORIZATION,
      dshHomeRedirect: undefined,
      profileDir: undefined,
      rpcEndpoints: undefined,
      outboundTcp: undefined,
    })
  })

  it('多个绝对根逐条保留（逐条显式，不去重不补全）', () => {
    const root = newRoot('parse-roots')
    const a = path.join(root, 'var', 'a')
    const b = path.join(root, 'var', 'b')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })
    const cfg = parseDaemonConfig(
      [
        BASE_YAML,
        'seatbeltTier: workspace-write',
        `seatbeltWriteRoots: '${JSON.stringify([a, b])}'`,
        `seatbeltAuthorization: ${AUTHORIZATION}`,
      ].join('\n'),
    )
    expect(cfg.seatbelt?.writeRoots).toEqual([a, b])
  })
})

// —— 一b、出口键 outboundTcp（模型 API 出口过渡面，2026-10-31 studio-dev-269 att9-11 收口）——

describe('daemon.yaml seatbeltOutboundTcp：host 值域 {*,localhost}、port 1-65535、fail-closed', () => {
  it('workspace-write 四键齐备 → grant 携带端点列表（resolveSeatbeltGrant 同源过闸）', () => {
    const root = newRoot('egress-ok')
    const cfg = parseDaemonConfig(
      [...wideningLines(root), `seatbeltOutboundTcp: '${JSON.stringify([{ host: '*', port: 443 }, { host: 'localhost', port: 8443 }])}'`].join('\n'),
    )
    expect(cfg.seatbelt?.outboundTcp).toEqual([
      { host: '*', port: 443 },
      { host: 'localhost', port: 8443 },
    ])
    expect(resolveSeatbeltGrant(cfg.seatbelt!).outboundTcp).toEqual([
      { host: '*', port: 443 },
      { host: 'localhost', port: 8443 },
    ])
  })

  it('不写 outboundTcp → 恒 undefined（无隐式出口——网域缺省只留回环宿主 RPC）', () => {
    const root = newRoot('egress-absent')
    const cfg = parseDaemonConfig([...wideningLines(root)].join('\n'))
    expect(cfg.seatbelt?.outboundTcp).toBeUndefined()
  })

  it('read-only（含缺省档）给 outboundTcp → 拒（read-only 无放宽面）', () => {
    expect(
      catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltOutboundTcp: '${JSON.stringify([{ host: '*', port: 443 }])}'`)),
    ).toMatch(/read-only 档（含未声明 seatbeltTier 的缺省档）不得给 seatbeltOutboundTcp/)
  })

  it('坏值全拒：非 JSON／非数组／空数组／host 值域外（域名）／port 越界或非整数', () => {
    const root = newRoot('egress-bad')
    const lines = (tcp: string) => [...wideningLines(root), `seatbeltOutboundTcp: '${tcp}'`].join('\n')
    expect(catchError(() => parseDaemonConfig(lines('not-json')))).toMatch(/seatbeltOutboundTcp.*非 JSON/)
    expect(catchError(() => parseDaemonConfig(lines('{"host":"*","port":443}')))).toMatch(/非空 JSON 数组/)
    expect(catchError(() => parseDaemonConfig(lines('[]')))).toMatch(/非空 JSON 数组/)
    expect(catchError(() => parseDaemonConfig(lines(JSON.stringify([{ host: 'api.example.com', port: 443 }]))))).toMatch(
      /host 值域为 '\*'\|'localhost'/,
    )
    expect(catchError(() => parseDaemonConfig(lines(JSON.stringify([{ host: '*', port: 0 }]))))).toMatch(/port 须为 1-65535/)
    expect(catchError(() => parseDaemonConfig(lines(JSON.stringify([{ host: '*', port: 443.5 }]))))).toMatch(/port 须为 1-65535/)
    expect(catchError(() => parseDaemonConfig(lines(JSON.stringify([{ host: '*', port: '443' }]))))).toMatch(/port 须为 1-65535/)
  })
})

// —— 二、解析负例：值域封闭＋read-only 禁放宽键＋workspace-write 缺键/坏根拒 ——

describe('daemon.yaml seatbelt 负例：不静默放宽、不静默补全', () => {
  it('tier 值域封闭（off/大小写/未知值一律拒）', () => {
    for (const tier of ['off', 'readonly', 'WORKSPACE-WRITE', 'workspace_write']) {
      expect(catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltTier: ${tier}`))).toMatch(
        /seatbeltTier 须为 read-only\|workspace-write/,
      )
    }
  })

  it('read-only（含未声明 tier 的缺省档）给 roots/auth → 拒', () => {
    const root = newRoot('parse-ro')
    expect(
      catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltTier: read-only\nseatbeltWriteRoots: '${JSON.stringify([path.join(root, 'var')])}'`)),
    ).toMatch(/read-only 档（含未声明 seatbeltTier 的缺省档）不得给 seatbeltWriteRoots/)
    expect(catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltTier: read-only\nseatbeltAuthorization: ${AUTHORIZATION}`))).toMatch(
      /read-only 档（含未声明 seatbeltTier 的缺省档）不得给 seatbeltAuthorization/,
    )
    // 未声明 tier＝缺省 read-only：也不得借「没写 tier」偷偷放宽
    expect(catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltWriteRoots: '${JSON.stringify([path.join(root, 'var')])}'`))).toMatch(
      /read-only 档/,
    )
    expect(catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltAuthorization: ${AUTHORIZATION}`))).toMatch(/read-only 档/)
  })

  it('workspace-write 缺 roots/auth → 拒（含只给其一的中间态）', () => {
    const root = newRoot('parse-missing')
    expect(catchError(() => parseDaemonConfig(`${BASE_YAML}\nseatbeltTier: workspace-write`))).toMatch(
      /须配 seatbeltWriteRoots/,
    )
    expect(
      catchError(() =>
        parseDaemonConfig(
          `${BASE_YAML}\nseatbeltTier: workspace-write\nseatbeltWriteRoots: '${JSON.stringify([path.join(root, 'var')])}'`,
        ),
      ),
    ).toMatch(/须配 seatbeltAuthorization/)
  })

  it('roots 坏形态：空数组/非 JSON/非数组 JSON/非字符串项/相对路径一律拒', () => {
    const cases: readonly [string, RegExp][] = [
      ["'[]'", /不得为空数组/],
      ["'not-json'", /须为 JSON 数组字符串/],
      ["'{}'", /须为 JSON 数组/],
      ["'[1]'", /每项须为绝对路径字符串/],
      ["'[\"\"]'", /每项须为绝对路径字符串/],
      ["'[\"relative/path\"]'", /每项须为绝对路径字符串/],
    ]
    for (const [roots, pattern] of cases) {
      const message = catchError(() =>
        parseDaemonConfig(
          `${BASE_YAML}\nseatbeltTier: workspace-write\nseatbeltWriteRoots: ${roots}\nseatbeltAuthorization: ${AUTHORIZATION}`,
        ),
      )
      expect(message).toMatch(pattern)
    }
  })

  it('roots 含控制字符 / 根目录 / → 拒（profile 断行与显式全盘两风险）', () => {
    const cases: readonly [string, RegExp][] = [
      ["'[\"/abs/root\\n\"]'", /不得含控制字符/],
      ["'[\"/\"]'", /不得为根目录/],
      ["'[\"/tmp/../\"]'", /不得为根目录/],
    ]
    for (const [roots, pattern] of cases) {
      const message = catchError(() =>
        parseDaemonConfig(
          `${BASE_YAML}\nseatbeltTier: workspace-write\nseatbeltWriteRoots: ${roots}\nseatbeltAuthorization: ${AUTHORIZATION}`,
        ),
      )
      expect(message).toMatch(pattern)
    }
  })

  it('resolver 行为面：workspace-write + claude 内置工厂 → 装配期 CONFIG_INVALID/seatbelt-unenforceable', () => {
    const root = newRoot('resolver-claude')
    const grant: SeatbeltGrant = { tier: 'workspace-write', writeRoots: [path.join(root, 'var')], authorization: AUTHORIZATION }
    const factory = dispatchAdapterResolver(grant)('claude')
    expect(factory).toBeDefined()
    expect(catchError(() => factory?.(undefined))).toMatch(/CONFIG_INVALID\/agentconfig\/seatbelt-unenforceable/)
  })

  it('roots 未加引号（裸 YAML 列表）→ 明报须引号包裹的 JSON 数组字符串（不猜）', () => {
    const message = catchError(() =>
      parseDaemonConfig(
        `${BASE_YAML}\nseatbeltTier: workspace-write\nseatbeltWriteRoots: ["/abs/root"]\nseatbeltAuthorization: ${AUTHORIZATION}`,
      ),
    )
    expect(message).toMatch(/引号包裹的 JSON 数组字符串/)
  })

  it('authorization 空白 → 拒（trim 后空＝无留痕）', () => {
    const root = newRoot('parse-blank-auth')
    expect(
      catchError(() =>
        parseDaemonConfig(
          [
            BASE_YAML,
            'seatbeltTier: workspace-write',
            `seatbeltWriteRoots: '${JSON.stringify([path.join(root, 'var')])}'`,
            "seatbeltAuthorization: '   '",
          ].join('\n'),
        ),
      ),
    ).toMatch(/seatbeltAuthorization 须非空白/)
  })
})

// —— 三、装配注入：runtime 深一致＋同一 grant 进 resolver/engine ——

interface RuntimeHarness {
  readonly config: ServeConfig
  readonly runtime: ServeRuntime
  readonly ledger: Ledger
  readonly ticket: string
}

async function buildRuntime(root: string, extra: readonly string[]): Promise<RuntimeHarness> {
  const yaml = [
    `db: ${JSON.stringify(path.join(root, 'var', 'ledger.sqlite'))}`,
    'platform: localfile',
    'company: demo',
    `rootDir: ${JSON.stringify(path.join(root, 'var'))}`,
    'tickMs: 25',
    ...extra,
  ].join('\n')
  const config = parseDaemonConfig(yaml)
  const platformDir = path.join(root, 'var', 'platform')
  mkdirSync(platformDir, { recursive: true })
  const seed = createLocalPlatform(platformDir)
  const issue = await seed.issues.create({ title: 'seatbelt config runtime', type: 'task', level: 0, initialState: '新单' })
  const ledger = openLedger(config.db)
  const runtime = buildServeRuntime(config, ledger, DEMO_SNAPSHOT, { log: () => {}, clock: () => T0 })
  return { config, runtime, ledger, ticket: issue.id }
}

let savedSecret: string | undefined
beforeEach(() => {
  savedSecret = process.env[SECRET_ENV]
  process.env[SECRET_ENV] = GATEWAY_KEY_MATERIAL // localfile 非 demo 形态：签根须由部署秘密源注入（SEC-FC-02）
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_ENV]
  else process.env[SECRET_ENV] = savedSecret
  savedSecret = undefined
})

describe('buildServeRuntime：seatbelt grant 装配注入（同源、缺省不注入）', () => {
  it('缺省不写：runtime.dispatchSeatbelt 恒 undefined；DISPATCH note=read-only（e2e 缺省不注入）', async () => {
    const root = newRoot('runtime-default')
    const { config, runtime, ledger, ticket } = await buildRuntime(root, [])
    try {
      expect(config.seatbelt).toBeUndefined()
      expect(runtime.dispatchSeatbelt).toBeUndefined()
      const report = await runtime.engine.tick()
      expect(report.errors).toEqual([])
      const note = ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'DISPATCH')?.note ?? ''
      expect(note).toContain(';seatbelt=read-only;roots=0;workspace=')
    } finally {
      await runtime.stop()
    }
  })

  it('workspace-write：runtime.dispatchSeatbelt 深一致＋grant 确已进引擎（demo executor 无端子=拒派）', async () => {
    const root = newRoot('runtime-widen')
    const { config, runtime, ledger, ticket } = await buildRuntime(root, wideningLines(root))
    const expected: SeatbeltGrant = {
      tier: 'workspace-write',
      writeRoots: [path.join(root, 'var')],
      authorization: AUTHORIZATION,
    }
    try {
      expect(config.seatbelt).toEqual(expected)
      expect(runtime.dispatchSeatbelt).toEqual(expected) // 装配面同引用：不是「配置读到了但没往下传」
      const report = await runtime.engine.tick()
      const dispatch = report.phases.dispatch.results.find((r) => r.actionType === 'dispatch')
      // buildServeRuntime 缺省装 fake executor（无 seatbelt 端子）——放宽无处落地即拒派；
      // 若 grant 没进引擎，这一单会以 read-only 静默派发成功（本断言就是「已注入」的行为证据）
      expect(dispatch?.ok).toBe(false)
      expect(dispatch?.detail ?? '').toContain('dispatch/seatbelt-unknown-executor')
      expect(ledger.queryEvents({ issue: ticket }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    } finally {
      await runtime.stop()
    }
  })

  it('装配源锚：executor-face 与 runtime 同取 config.seatbelt（不各写一份配置读取）', () => {
    const faceSrc = readFileSync(
      fileURLToPath(new URL('../../../src/assembly/serve/executor-face.ts', import.meta.url)),
      'utf8',
    )
    expect(faceSrc).toContain('dispatchAdapterResolver(config.seatbelt)')
    const runtimeSrc = readFileSync(fileURLToPath(new URL('../../../src/assembly/serve/runtime.ts', import.meta.url)), 'utf8')
    expect(runtimeSrc).toContain('...(config.seatbelt !== undefined ? { dispatchSeatbelt: config.seatbelt } : {})')
    expect(runtimeSrc).toContain('dispatchSeatbelt: config.seatbelt')
  })
})

// —— 四、端到端：解析产物→引擎派发→DISPATCH note 携授权原文 ——

describe('配置通道端到端：daemon.yaml 解析产物→派发 note 留痕（有 seatbelt 端子的 dsh 名）', () => {
  it('workspace-write：DISPATCH note 含授权原文＋本 attempt 写域（read-only 缺省的反面）', async () => {
    const root = newRoot('e2e-widen')
    const config = parseDaemonConfig(
      [`db: ${JSON.stringify(path.join(root, 'var', 'ledger.sqlite'))}`, 'platform: fake', 'company: demo', ...wideningLines(root)].join(
        '\n',
      ),
    )
    expect(config.seatbelt?.authorization).toBe(AUTHORIZATION)
    const ledger = openLedger(config.db)
    try {
      const platform = createFakePlatform()
      const registry = createRegistry()
      registry.register(createFakeAdapter({ name: 'dsh' }), { default: true })
      const engine = createEngine({
        platform,
        ledger,
        registry,
        assembler: createDefaultAssembler({
          fwkVersion: 'v0.5-test',
          frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
          snapshot: DEMO_SNAPSHOT,
          acceptance: ['echo demo-ok'],
          docRefs: ['docs/17-§2（主循环七相位）'],
        }),
        gateRunner: createDefaultGateRunner(),
        clock: () => T0,
        config: {
          ...ENGINE_CONFIG_DEFAULTS,
          company: DEMO_SNAPSHOT.slug,
          rootDir: path.join(root, 'var'),
          defaultPersonId: 'AGENT-1',
          deptFallback: 'departments/工程部',
          defaultLane: 'core',
          mirrorRescanEveryTicks: 1,
        },
        people: DEMO_SNAPSHOT.people,
        ...(config.seatbelt !== undefined ? { dispatchSeatbelt: config.seatbelt } : {}),
      })
      const created = await platform.issues.create({ title: '配置通道端到端', type: 'task', level: 0 })
      const report = await engine.tick()
      const dispatch = report.phases.dispatch.results.find((r) => r.actionType === 'dispatch')
      expect(dispatch?.ok).toBe(true)
      const note = ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')?.note ?? ''
      expect(note).toContain(`seatbelt=workspace-write;auth=${AUTHORIZATION}`)
      expect(note).toContain(';roots=')
      expect(note).toContain(';scope=')
      expect(note).toContain(`workspaces/${created.id}/att1`)
    } finally {
      ledger.close()
    }
  })
})
