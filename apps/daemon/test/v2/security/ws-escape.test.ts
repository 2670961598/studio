/**
 * ws-escape.test.ts —— 派发域 seatbelt 圈定（IMPL-07-09；v2/15 §一 SEC-FC-05 后半）
 *
 * 依据：docs/v2/15 §一 SEC-FC-05（缺省最严／放宽须显式授权并留痕／派发校验失败不启动；
 *   实际拦截能力未探＝按不支持处理）；docs/v2/12 §3.3（写域·任务派工面＝未证，PRB-04 含
 *   符号链接逃逸未执行）／§3.1 WS-R3/R5（工位纯函数派生、cwd=该次尝试工位）；docs/v2/07
 *   §三 EXEC-01（fail-closed 三之一：校验失败不启动）；docs/plan/05 IMPL-07-09 验收口径
 *   「派发缺省圈定＋放宽显式授权留痕；派发校验失败不启动；NEG-RUN-04」。
 *
 * 本套六面：
 *   1. 缺省 read-only：不传授权＝写域零放行、无留痕（「不传=不圈定」路径必须不存在）；
 *   2. 显式放宽留痕：workspace-write 须授权原文＋授权面＋本 attempt 写域，note 行单行可判；
 *   3. **NEG-RUN-04**：符号链接/绝对路径逃逸被拒（realpath 判据；拒派不剪根、不静默降级）；
 *   4. 失败不 spawn：拒派全形下 spawn 调用计数恒 0，留痕先于 spawn，留痕失败同样不启动；
 *   5. 注册面随动：07-08 两参签名（base?＋seatbelt?）由本件组合调用，省略＝read-only；
 *   6. 接线面（真引擎）：`engine.executeDispatch` 前置 gate（缺省 read-only／放宽 note 落
 *      DISPATCH 台账／拒派 DISPATCH_FAIL 且 launch 零调用）＋`executor-face` 注册面源侧锚。
 * 断言纪律：fake 只替代外部端口（真引擎＋真 SQLite 台账；onLaunch 回显＝spawn 观察面，
 * docs/v2/17 §一 V3）；profile 渲染归 07-08 套件，本套只借 `dispatchSeatbeltProfile` 收口。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_SEATBELT_PLAN, createRegistry } from '@studio-next/adapters'
import type { AdapterFactory, SeatbeltGrant, SeatbeltTier } from '@studio-next/adapters'
import { openLedger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import type { TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import {
  DISPATCH_SEATBELT_TIERS,
  dispatchAdapterResolver,
  dispatchSeatbeltProfile,
  launchWorkerDispatch,
  resolveWorkerDispatchSeatbelt,
  seatbeltNote,
} from '../../../src/engine/work/dispatch-seatbelt.ts'
import type {
  WorkerDispatchGate,
  WorkerDispatchRequest,
  WorkerDispatchSeatbelt,
} from '../../../src/engine/work/dispatch-seatbelt.ts'

const workdir = mkdtempSync(join(tmpdir(), 'ws-escape-v2-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

const srcPath = fileURLToPath(new URL('../../../src/engine/work/dispatch-seatbelt.ts', import.meta.url))

/** 新工位（绝对路径；临时根下，跨平台同判） */
function newWorkspace(tag: string): string {
  return mkdtempSync(join(workdir, `${tag}-`))
}

/** 放宽授权（authorization 显式＝「谁/何单/何策略」留痕面） */
function widenGrant(workspace: string, authorization = 'IMPL-07-09 派发面放宽留痕'): {
  tier: 'workspace-write'
  writeRoots: readonly string[]
  authorization: string
} {
  return { tier: 'workspace-write', writeRoots: [workspace], authorization }
}

function request(over: Partial<WorkerDispatchRequest> & { workspace: string }): WorkerDispatchRequest {
  return { ticket: 'IMPL-07-09', executor: 'dsh', ...over }
}

function catchError(run: () => unknown): string {
  try {
    run()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望拒派（CONFIG_INVALID），实际放行——fail-open 路径仍在')
}

// —— 接线夹具：真引擎栈（fake 平台/执行体＋真 SQLite 台账；onLaunch 计数=spawn 观察面） ——

const T0 = Date.parse('2026-11-02T00:00:00.000Z')

interface WireStack {
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledger: ReturnType<typeof openLedger>
  readonly engine: ReturnType<typeof createEngine>
  readonly root: string
  launches(): number
  advance(ms: number): void
}

/** 建栈（grantOf 以建根回调：授权面须引用该用例自己的根，不得跨用例） */
function wireStack(tag: string, grantOf?: (root: string) => SeatbeltGrant): WireStack {
  const root = mkdtempSync(join(workdir, `engine-${tag}-`))
  const ledger = openLedger(join(root, 'ledger.sqlite'))
  let t = T0
  let launches = 0
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  // 名字取 'dsh'：放宽档的端子核查面按内置家族名判（fake 只替代端口；见模块 assertWideningEnforceable）
  registry.register(createFakeAdapter({ name: 'dsh', onLaunch: () => (launches += 1) }), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['echo demo-ok'], docRefs: ['docs/17-§2（主循环七相位）'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => t,
    config: { ...ENGINE_CONFIG_DEFAULTS, company: DEMO_SNAPSHOT.slug, rootDir: join(root, 'var'), defaultPersonId: 'AGENT-1', deptFallback: 'departments/工程部', defaultLane: 'core', mirrorRescanEveryTicks: 1, stallAfterMs: 60_000 },
    people: DEMO_SNAPSHOT.people,
    ...(grantOf !== undefined ? { dispatchSeatbelt: grantOf(root) } : {}),
  })
  const advance = (ms: number): void => {
    t += ms
  }
  return { platform, ledger, engine, root, launches: () => launches, advance }
}

/** 推 n 拍（假时钟 +1000ms/拍） */
async function runWireTicks(stack: WireStack, n = 2): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) {
    stack.advance(1000)
    reports.push(await stack.engine.tick())
  }
  return reports
}

/** 全部派发动作结果（跨拍展平） */
function dispatchResults(reports: readonly TickReport[]): TickReport['phases']['dispatch']['results'] {
  return reports.flatMap((r) => r.phases.dispatch.results).filter((r) => r.actionType === 'dispatch')
}

// —— 一、缺省 read-only（派发缺省圈定；「不传＝不圈定」必须已亡） ——

describe('缺省最严：派发不传授权＝read-only、写域零放行、无留痕', () => {
  it('不传 grant：tier=read-only、writeRoots 空、trail 缺席（不是「不圈定」）', () => {
    const workspace = newWorkspace('default')
    const seatbelt = resolveWorkerDispatchSeatbelt(request({ workspace }))
    expect(seatbelt.tier).toBe('read-only')
    expect(seatbelt.writeRoots).toEqual([])
    expect(seatbelt.trail).toBeUndefined()
    expect(seatbelt.workspace).toBe(realpathSync(workspace))
    // 与 07-08 的缺省计划同源（缺省翻转只在 adapters 一处，本件不另立缺省）
    expect(seatbelt.tier).toBe(DEFAULT_SEATBELT_PLAN.tier)
    expect(DISPATCH_SEATBELT_TIERS).toEqual(['read-only', 'workspace-write'])
  })

  it('read-only profile：deny 在、allow file-write 零条（写域零放行是文本事实）', () => {
    const seatbelt = resolveWorkerDispatchSeatbelt(request({ workspace: newWorkspace('default-profile') }))
    const profile = dispatchSeatbeltProfile(seatbelt, 'IMPL-07-09/att1')
    expect(profile).toContain('(deny file-write*)')
    expect(profile).not.toContain('(allow file-write*')
    expect(profile).toContain(';; dispatch: IMPL-07-09/att1')
  })

  it('read-only 档追加产出位＝拒（read-only 加根＝静默放宽）', () => {
    const workspace = newWorkspace('readonly-extras')
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(
        request({ workspace, extraWriteRoots: [join(workspace, 'deliverables')] }),
      ),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-read-only-extra-roots/)
  })

  it('read-only 留痕 note：单行、档位可判读、写域计数 0', () => {
    const seatbelt = resolveWorkerDispatchSeatbelt(request({ workspace: newWorkspace('readonly-note') }))
    const note = seatbeltNote(seatbelt)
    expect(note).toContain('seatbelt=read-only')
    expect(note).toContain('roots=0')
    expect(note).not.toContain('\n')
  })
})

// —— 二、显式放宽：须显式授权＋留痕（07-08 守门＋派发域留痕面） ——

describe('显式放宽：workspace-write 须授权原文，本 attempt 写域逐条留痕', () => {
  it('tier＋绝对根＋authorization → 计划落根（realpath 归一）、trail 携授权面与写域', () => {
    const workspace = newWorkspace('widen')
    const grant = widenGrant(workspace, '制作人 2026-10-28 批 / IMPL-07-09')
    const seatbelt = resolveWorkerDispatchSeatbelt(request({ workspace, grant }))
    expect(seatbelt.tier).toBe('workspace-write')
    expect(seatbelt.writeRoots).toEqual([realpathSync(workspace)])
    expect(seatbelt.trail?.authorization).toBe('制作人 2026-10-28 批 / IMPL-07-09')
    expect(seatbelt.trail?.scopeRoots).toEqual([realpathSync(workspace)])
    expect(seatbelt.trail?.ticket).toBe('IMPL-07-09')
    expect(seatbelt.trail?.executor).toBe('dsh')
    // profile 逐条白名单本 attempt 写域（root 路径为 realpath 归一后的绝对路径）
    expect(dispatchSeatbeltProfile(seatbelt)).toContain(`(allow file-write* (subpath "${realpathSync(workspace)}"))`)
  })

  it('授权面内的追加产出位（跨目录产出位）逐条落计划；越出授权面即逃逸（见 NEG-RUN-04）', () => {
    const scope = newWorkspace('widen-scope')
    const workspace = join(scope, 'att1')
    mkdirSync(workspace, { recursive: true })
    const output = join(scope, 'deliverables')
    mkdirSync(output, { recursive: true })
    const seatbelt = resolveWorkerDispatchSeatbelt(
      request({
        workspace,
        grant: { tier: 'workspace-write', writeRoots: [scope], authorization: 'IMPL-07-09 跨目录产出位' },
        extraWriteRoots: [output],
      }),
    )
    expect(seatbelt.writeRoots).toEqual([realpathSync(workspace), realpathSync(output)])
    expect(seatbelt.trail?.scopeRoots).toEqual([realpathSync(scope)])
  })

  it('无 authorization 的放宽＝07-08 构造期拒（seatbelt/widening-unauthorized；本件不复制规则）', () => {
    const workspace = newWorkspace('widen-unauth')
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(request({ workspace, grant: { tier: 'workspace-write', writeRoots: [workspace] } })),
    )
    expect(message).toMatch(/CONFIG_INVALID\/seatbelt\/widening-unauthorized/)
  })

  it('留痕 note 单行可判读；authorization 内的分号/换行被归一（不注入 ;key=value 锚点面）', () => {
    const workspace = newWorkspace('widen-note')
    const seatbelt = resolveWorkerDispatchSeatbelt(
      request({ workspace, grant: widenGrant(workspace, 'IMPL-07-09; wait=999\n注入行') }),
    )
    const note = seatbeltNote(seatbelt)
    expect(note).toContain('seatbelt=workspace-write')
    expect(note).toContain('auth=')
    expect(note).toContain('roots=')
    expect(note).toContain('scope=')
    expect(note).not.toContain('\n')
    expect(note).not.toContain(';wait=') // 锚点注入面已压平（,wait= 是文本不是锚点）
  })

  it('放宽无留痕 sink＝拒派；有 sink 时先留痕后 spawn（顺序可判）', async () => {
    const workspace = newWorkspace('widen-order')
    const req = request({ workspace, grant: widenGrant(workspace) })
    let spawns = 0
    const bare: WorkerDispatchGate<string> = {
      spawn: async () => {
        spawns += 1
        return 'spawned'
      },
    }
    await expect(launchWorkerDispatch(req, bare)).rejects.toThrow(/dispatch\/seatbelt-trail-unrecorded/)
    expect(spawns).toBe(0)

    const order: string[] = []
    const outcome = await launchWorkerDispatch(req, {
      spawn: async (seatbelt) => {
        order.push(`spawn:${seatbelt.tier}`)
        return 'spawned'
      },
      recordWidening: (trail, note) => {
        order.push(`record:${trail.authorization}`)
        expect(note).toContain('seatbelt=workspace-write')
      },
    })
    expect(order).toEqual(['record:IMPL-07-09 派发面放宽留痕', 'spawn:workspace-write'])
    expect(outcome.result).toBe('spawned')
    expect(outcome.seatbelt.trail).toBeDefined()
  })

  it('留痕落账抛错→不 spawn（无痕的放宽不得启动）', async () => {
    const workspace = newWorkspace('widen-record-fail')
    let spawns = 0
    await expect(
      launchWorkerDispatch(request({ workspace, grant: widenGrant(workspace) }), {
        spawn: async () => {
          spawns += 1
          return 'spawned'
        },
        recordWidening: () => {
          throw new Error('台账写失败（注入）')
        },
      }),
    ).rejects.toThrow(/台账写失败/)
    expect(spawns).toBe(0)
  })
})

// —— 三、NEG-RUN-04：符号链接/绝对路径逃逸被拒（拒派，不剪根不降级） ——

describe('NEG-RUN-04 逃逸被拒：绝对路径与符号链接同判（realpath 为判据）', () => {
  it('绝对路径逃逸：追加产出位在授权面外 → dispatch/seatbelt-write-root-escape', () => {
    const workspace = newWorkspace('escape-abs')
    const outside = newWorkspace('escape-abs-outside')
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(
        request({ workspace, grant: widenGrant(workspace), extraWriteRoots: [outside] }),
      ),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-write-root-escape/)
    // 报错文本点名越出的根与授权面（可判读，不吞证据）
    expect(message).toContain(outside)
    expect(message).toContain(realpathSync(workspace))
  })

  it('绝对路径逃逸：系统根（/etc）一类同样拒（不存在「系统目录默认放行」）', () => {
    const workspace = newWorkspace('escape-etc')
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(
        request({ workspace, grant: widenGrant(workspace), extraWriteRoots: ['/etc'] }),
      ),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-write-root-escape/)
  })

  it('绝对路径逃逸：`..` 词法回溯到授权面外同样拒（realpath 归一后判，不吃字面）', () => {
    const workspace = newWorkspace('escape-dotdot')
    const sibling = join(workdir, 'escape-dotdot-target')
    mkdirSync(sibling, { recursive: true })
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(
        request({
          workspace,
          grant: widenGrant(workspace),
          extraWriteRoots: [join(workspace, '..', 'escape-dotdot-target')],
        }),
      ),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-write-root-escape/)
    expect(message).toContain(realpathSync(sibling))
  })

  it('符号链接逃逸：工位内链接指向授权面外 → 拒（不按路径字面放行）', () => {
    const workspace = newWorkspace('escape-link')
    const outside = newWorkspace('escape-link-outside')
    symlinkSync(outside, join(workspace, 'escape'))
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(
        request({ workspace, grant: widenGrant(workspace), extraWriteRoots: [join(workspace, 'escape')] }),
      ),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-write-root-escape/)
    expect(message).toContain(realpathSync(outside))
  })

  it('符号链接工位：派发工位本体是符号链接 → 拒（派生面被链接化即拒派）', () => {
    const realWorkspace = newWorkspace('escape-ws-real')
    const linkWorkspace = join(workdir, 'escape-ws-link')
    symlinkSync(realWorkspace, linkWorkspace)
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(request({ workspace: linkWorkspace, grant: widenGrant(realWorkspace) })),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-workspace-symlink/)
  })

  it('工位不在授权面：授权面=另一目录 → dispatch/seatbelt-workspace-outside-scope', () => {
    const workspace = newWorkspace('escape-ws')
    const otherScope = newWorkspace('escape-scope')
    const message = catchError(() =>
      resolveWorkerDispatchSeatbelt(request({ workspace, grant: widenGrant(otherScope) })),
    )
    expect(message).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-workspace-outside-scope/)
  })

  it('相对路径（工位/追加根）＝拒（内核面按 cwd 解析＝隐式放宽）', () => {
    const workspace = newWorkspace('relative')
    expect(catchError(() => resolveWorkerDispatchSeatbelt(request({ workspace: 'relative/ws' })))).toMatch(
      /CONFIG_INVALID\/dispatch\/seatbelt-workspace-absolute/,
    )
    expect(
      catchError(() =>
        resolveWorkerDispatchSeatbelt(
          request({ workspace, grant: widenGrant(workspace), extraWriteRoots: ['deliverables'] }),
        ),
      ),
    ).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-write-root-absolute/)
  })

  it('授权面本身是符号链接别名：按目标归一成立（判据按目标，不按字面）', () => {
    const realScope = newWorkspace('alias-real')
    const alias = join(workdir, 'alias-link')
    symlinkSync(realScope, alias)
    const seatbelt = resolveWorkerDispatchSeatbelt(
      request({
        workspace: realScope,
        grant: { tier: 'workspace-write', writeRoots: [alias], authorization: 'IMPL-07-09 别名授权' },
      }),
    )
    expect(seatbelt.writeRoots).toEqual([realpathSync(realScope)])
    expect(seatbelt.trail?.scopeRoots).toEqual([realpathSync(realScope)])
  })
})

// —— 四、失败不 spawn（SEC-FC-05「派发校验失败不启动」的观察面） ——

describe('派发校验失败不启动：拒派全形 spawn 恒 0；通过形恰一次', () => {
  it('非法档/未授权放宽/逃逸/未知执行体：逐形拒派且 spawn 零调用', async () => {
    const workspace = newWorkspace('no-spawn')
    const outside = newWorkspace('no-spawn-outside')
    let spawns = 0
    const gate: WorkerDispatchGate<string> = {
      spawn: async () => {
        spawns += 1
        return 'spawned'
      },
      recordWidening: () => {
        throw new Error('不该走到留痕（校验已拒）')
      },
    }
    const rejected: readonly WorkerDispatchRequest[] = [
      // 非法档（'off' 一类不是档位）
      { ticket: 'T-1', executor: 'dsh', workspace, grant: { tier: 'off' as SeatbeltTier } },
      // 未授权放宽（缺 authorization）
      { ticket: 'T-2', executor: 'dsh', workspace, grant: { tier: 'workspace-write', writeRoots: [workspace] } },
      // 绝对路径逃逸
      { ticket: 'T-3', executor: 'dsh', workspace, grant: widenGrant(workspace), extraWriteRoots: [outside] },
      // 未知执行体（放宽无处落地）
      { ticket: 'T-4', executor: 'nobody', workspace, grant: widenGrant(workspace) },
    ]
    for (const req of rejected) {
      await expect(launchWorkerDispatch(req, gate)).rejects.toThrow(/CONFIG_INVALID\//)
    }
    expect(spawns).toBe(0)
  })

  it('通过形：read-only 缺省派发成功，spawn 收到零写域计划且恰一次', async () => {
    const workspace = newWorkspace('spawn-ok')
    let seen: WorkerDispatchSeatbelt | undefined
    let spawns = 0
    const outcome = await launchWorkerDispatch(request({ workspace }), {
      spawn: async (seatbelt) => {
        spawns += 1
        seen = seatbelt
        return 'launched'
      },
    })
    expect(spawns).toBe(1)
    expect(seen?.tier).toBe('read-only')
    expect(seen?.writeRoots).toEqual([])
    expect(outcome.seatbelt.tier).toBe('read-only')
    expect(outcome.result).toBe('launched')
  })
})

// —— 五、注册面随动（07-08 两参签名：base?＋seatbelt?；省略＝read-only） ——

describe('注册面随动：07-08 两参签名由本件组合（省略＝read-only，装配期即守门）', () => {
  it('四家名/档位位/判断位同源解析；未知名 undefined（不猜家）', () => {
    const resolver = dispatchAdapterResolver()
    for (const name of ['dsh', 'claude', 'codex', 'kimi', 'dsh-mid', 'dsh-judge']) {
      expect(resolver(name)).toBeDefined()
    }
    expect(resolver('nope')).toBeUndefined()
  })

  it('装配期守门：非法档/未授权放宽建 resolver 时即 CONFIG_INVALID（不等到 launch）', () => {
    const workspace = newWorkspace('assemble-gate')
    expect(catchError(() => dispatchAdapterResolver({ tier: 'off' as SeatbeltTier }))).toMatch(
      /CONFIG_INVALID\/seatbelt\/tier-invalid/,
    )
    expect(
      catchError(() => dispatchAdapterResolver({ tier: 'workspace-write', writeRoots: [workspace] })),
    ).toMatch(/CONFIG_INVALID\/seatbelt\/widening-unauthorized/)
  })

  it('显式放宽绑到工厂：dsh 按授权面构造；无端子家族工厂构造期即拒（agentconfig 同向）', () => {
    const workspace = newWorkspace('assemble-bind')
    const grant = widenGrant(workspace)
    const dsh = dispatchAdapterResolver(grant)('dsh')
    expect(dsh?.(undefined).name).toBe('dsh')
    const claude = dispatchAdapterResolver(grant)('claude')
    expect(catchError(() => claude?.(undefined))).toMatch(/CONFIG_INVALID\/agentconfig\/seatbelt-unenforceable/)
    // read-only 缺省对四家都可构造（缺省档不盖「已放宽」章，也不拒）
    expect(dispatchAdapterResolver()('claude')?.(undefined).name).toBe('claude')
  })

  it('放宽在无端子家族/未知执行体上＝派发面拒（不冒充已放宽）', () => {
    const workspace = newWorkspace('assemble-terminal')
    expect(
      catchError(() =>
        resolveWorkerDispatchSeatbelt(request({ workspace, executor: 'claude', grant: widenGrant(workspace) })),
      ),
    ).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-unenforceable/)
    expect(
      catchError(() =>
        resolveWorkerDispatchSeatbelt(request({ workspace, executor: 'nobody', grant: widenGrant(workspace) })),
      ),
    ).toMatch(/CONFIG_INVALID\/dispatch\/seatbelt-unknown-executor/)
  })

  it('base 注入面透传：自定义家走 base（本件不替 base 决定圈定）', () => {
    const custom: AdapterFactory = () => {
      throw new Error('构造面不在本断言面')
    }
    const resolver = dispatchAdapterResolver(undefined, (name) => (name === 'custom' ? custom : undefined))
    expect(resolver('custom')).toBe(custom)
  })
})

// —— 六、接线面·真引擎：派发前置 gate（缺省 read-only／放宽留痕／拒派不 spawn） ——

describe('接线面·真引擎：executeDispatch 前置 gate（SEC-FC-05 后半落主循环）', () => {
  it('缺省不注入 grant：派发成功、launch 恰一次、DISPATCH note 携 seatbelt=read-only;roots=0', async () => {
    const stack = wireStack('ro')
    const created = await stack.platform.issues.create({ title: '派发面缺省档', type: 'task', level: 0 })
    const results = dispatchResults(await runWireTicks(stack, 3))
    expect(results[0]?.ok).toBe(true)
    expect(stack.launches()).toBe(1)
    const events = stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')
    expect(events).toHaveLength(1)
    expect(events[0]?.note).toContain(';seatbelt=read-only;roots=0;workspace=')
  })

  it('显式放宽：DISPATCH note 携授权原文＋本 attempt 写域（留痕随派发落账）', async () => {
    const stack = wireStack('widen', (root) => ({
      tier: 'workspace-write',
      writeRoots: [join(root, 'var')],
      authorization: 'IMPL-07-09 引擎接线放宽留痕',
    }))
    const created = await stack.platform.issues.create({ title: '派发面放宽档', type: 'task', level: 0 })
    await runWireTicks(stack, 3)
    expect(stack.launches()).toBe(1)
    const note = stack.ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')?.note ?? ''
    expect(note).toContain('seatbelt=workspace-write;auth=IMPL-07-09 引擎接线放宽留痕;roots=')
    expect(note).toContain(`workspaces/${created.id}/att1`)
  })

  it('拒派面：工位不在授权面 → DISPATCH_FAIL，launch 零调用、无 DISPATCH 台账、平台不迁移', async () => {
    const stack = wireStack('reject', (root) => ({
      tier: 'workspace-write',
      writeRoots: [join(root, 'elsewhere')],
      authorization: 'IMPL-07-09 越界授权面',
    }))
    mkdirSync(join(stack.root, 'elsewhere'), { recursive: true })
    const created = await stack.platform.issues.create({ title: '派发面拒派', type: 'task', level: 0 })
    const before = (await stack.platform.issues.get(created.id)).state
    const results = dispatchResults(await runWireTicks(stack, 2))
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(results[0]?.detail ?? '').toContain('DISPATCH_FAIL')
    expect(results[0]?.detail ?? '').toContain('dispatch/seatbelt-workspace-outside-scope')
    expect(stack.launches()).toBe(0)
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    expect((await stack.platform.issues.get(created.id)).state).toBe(before)
  })

  it('拒派面·NEG-RUN-04：工位被符号链接化 → 拒派（launch 零调用，detail 点名 workspace-symlink）', async () => {
    const stack = wireStack('symlink')
    const created = await stack.platform.issues.create({ title: '派发面符号链接工位', type: 'task', level: 0 })
    const parent = join(stack.root, 'var', 'workspaces', created.id)
    mkdirSync(parent, { recursive: true })
    mkdirSync(join(stack.root, 'outside-att'), { recursive: true })
    symlinkSync(join(stack.root, 'outside-att'), join(parent, 'att1'))
    const results = dispatchResults(await runWireTicks(stack, 2))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.detail ?? '').toContain('dispatch/seatbelt-workspace-symlink')
    expect(stack.launches()).toBe(0)
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
  })
})

describe('接线面·装配：注册面走派发域唯一调用点（源侧锚，防回退「不传圈定」）', () => {
  it('executor-face 用 dispatchAdapterResolver(config.seatbelt)，旧组合 judgeAwareResolver(tierAwareResolver()) 不存在', () => {
    const faceSrc = readFileSync(
      fileURLToPath(new URL('../../../src/assembly/serve/executor-face.ts', import.meta.url)),
      'utf8',
    )
    expect(faceSrc).toContain('dispatchAdapterResolver(config.seatbelt)')
    expect(faceSrc).not.toContain('judgeAwareResolver(tierAwareResolver())')
  })

  it('engine.ts：gate 在 detect 之前、DISPATCH note 携 seatbeltNote（顺序即语义）', () => {
    const engineSrc = readFileSync(fileURLToPath(new URL('../../../src/engine/engine.ts', import.meta.url)), 'utf8')
    const gate = engineSrc.indexOf('resolveWorkerDispatchSeatbelt({ ticket')
    const detect = engineSrc.indexOf('const detect = await adapter.detect()')
    expect(gate).toBeGreaterThan(0)
    expect(detect).toBeGreaterThan(gate)
    expect(engineSrc).toContain('${seatbeltNote(seatbelt)}')
  })
})

// —— 七、头注锚（文档口径落代码，防后续把「计划收口」读成「写域已封死」） ——

describe('头注锚（SEC-FC-05 后半／PRB-04 前置／不启动判据）', () => {
  it('dispatch-seatbelt.ts 头注登记：SEC-FC-05 后半、PRB-04 未执行按不支持、NEG-RUN-04、失败不启动', () => {
    const src = readFileSync(srcPath, 'utf8')
    const header = src.slice(0, src.indexOf('*/'))
    const flat = header.replaceAll(/\s+/g, '')
    expect(header).toContain('SEC-FC-05')
    expect(flat).toContain('缺省最严')
    expect(flat).toContain('放宽须显式授权并留痕')
    expect(flat).toContain('派发校验失败不启动')
    expect(header).toContain('NEG-RUN-04')
    expect(header).toContain('PRB-04')
    expect(flat).toContain('未执行')
    expect(flat).toContain('按不支持处理')
    expect(flat).toContain('符号链接')
    expect(flat).toContain('不冒充已闭合')
  })
})
