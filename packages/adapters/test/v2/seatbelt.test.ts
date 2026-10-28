/**
 * seatbelt 必填化·adapters 侧（IMPL-07-08 验收；v2/15 §一 SEC-FC-05 前半／plan/02 §五-8 接口耦合）
 *
 * 本套只测**档位面**（旧套件 test/seatbelt.test.ts 是 DEV-29 attempt3 原型面，不动也不替代）：
 *   1. 缺省最严：不声明档位=read-only——写域零放行；公共解析面省略 seatbelt 亦绑 read-only
 *      （「不传=不圈定」的全权缺省已翻转，不再存在）
 *   2. 显式放宽：workspace-write 须显式 tier＋绝对路径根＋authorization 留痕；profile 逐条落根
 *   3. 非法档拒绝：'off' 一类不是档位（构造期 CONFIG_INVALID/seatbelt/tier-invalid）；
 *      read-only 带写域根、放宽缺根/缺留痕/相对根一律构造期拒收（不静默补全/丢弃）
 *   4. PRB-04 头注锚：seatbelt.ts 头注前置声明「PRB-04 未执行→实际拦截能力按不支持处理」——
 *      防后续把「profile 文本收口」读成「写域已封死」（v2/15 §一；v2/12 §3.3/§五）
 *
 * 环境自适应：profile 在 spawn **之前**落盘，故「profile 文本断言」与 sandbox-exec 能否
 * apply 无关（darwin 未沙箱/嵌套沙箱两环境同断言）；launch 后一律收流落定，不留悬挂子进程。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExecutorAdapter, ExecutorFamily, Handle, TaskBrief } from '@studio-next/contract'
import { builtinResolver, registerBuiltins } from '../../src/agentconfig.ts'
import { createRegistry } from '../../src/registry.ts'
import {
  DEFAULT_SEATBELT_PLAN,
  DEFAULT_SEATBELT_TIER,
  SEATBELT_TIERS,
  resolveSeatbeltGrant,
} from '../../src/seatbelt.ts'
import type { SeatbeltTier } from '../../src/seatbelt.ts'

const fakeCli = fileURLToPath(new URL('../fake-cli/fake-cli.mjs', import.meta.url))
const seatbeltSrc = fileURLToPath(new URL('../../src/seatbelt.ts', import.meta.url))
const agentconfigSrc = fileURLToPath(new URL('../../src/agentconfig.ts', import.meta.url))

const workdir = mkdtempSync(join(tmpdir(), 'seatbelt-v2-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function makeBrief(workspace: string): TaskBrief {
  const briefPath = join(workspace, 'brief.md')
  writeFileSync(briefPath, 'TASK: IMPL-07-08 seatbelt 档位面探针')
  return {
    ticket: 'IMPL-07-08',
    attempt: 1,
    briefPath,
    workspace,
    AGENTS_MD: { channel: 'native', target: join(workspace, 'AGENTS.md') },
  }
}

function freshWorkspace(tag: string): string {
  return mkdtempSync(join(workdir, `${tag}-`))
}

/** 制造一次真 launch 并读回它落的 profile（profile 在 spawn 前落盘——与 apply 成败无关） */
async function launchProfile(adapter: ExecutorAdapter, workspace: string): Promise<string> {
  const handle: Handle = await adapter.launch(makeBrief(workspace))
  const seatbeltDir = join(workspace, '.seatbelt')
  const files = readdirSync(seatbeltDir)
  expect(files.length).toBe(1)
  const profile = readFileSync(join(seatbeltDir, files[0] ?? ''), 'utf8')
  // 收流落定（只为不留子进程）：spawn 面成败不属本套断言面（断言面=已落盘的 profile 文本）
  try {
    for await (const event of adapter.stream(handle)) void event
  } catch {
    // sandbox-exec 不存在/嵌套 apply 被拒等环境面失败：profile 文本断言仍然成立
  }
  return profile
}

// ---------------------------------------------------------------------------
// 档位解析（resolveSeatbeltGrant＝构造期唯一守门点）
// ---------------------------------------------------------------------------

describe('档位解析：缺省最严（read-only）', () => {
  it('缺省最严：不传/空授权/显式 read-only 都是零写域 read-only（「不传=不圈定」已翻转）', () => {
    for (const plan of [
      resolveSeatbeltGrant(),
      resolveSeatbeltGrant({}),
      resolveSeatbeltGrant({ tier: 'read-only' }),
    ]) {
      expect(plan.tier).toBe('read-only')
      expect(plan.writeRoots).toEqual([])
      expect(plan.authorization).toBeUndefined()
    }
    expect(DEFAULT_SEATBELT_TIER).toBe('read-only')
    expect(SEATBELT_TIERS).toEqual(['read-only', 'workspace-write'])
  })

  it('缺省计划是冻结常量（拿到缺省再顺手放宽＝不可能，机制不是注释）', () => {
    expect(DEFAULT_SEATBELT_PLAN.tier).toBe('read-only')
    expect(DEFAULT_SEATBELT_PLAN.writeRoots).toEqual([])
    expect(Object.isFrozen(DEFAULT_SEATBELT_PLAN)).toBe(true)
    expect(resolveSeatbeltGrant()).toBe(DEFAULT_SEATBELT_PLAN)
  })

  it('档位是纯函数面：同参同计划（可落账/可复算），网域面正交不动', () => {
    const grant = {
      tier: 'workspace-write' as const,
      writeRoots: ['/w/t'],
      authorization: 'IMPL-07-08 单内',
    }
    expect(resolveSeatbeltGrant(grant)).toEqual(resolveSeatbeltGrant(grant))
    const readOnly = resolveSeatbeltGrant({})
    expect(readOnly.rpcEndpoints).toBeUndefined()
    expect(readOnly.outboundTcp).toBeUndefined()
  })
})

describe('档位解析：显式放宽（workspace-write 须显式、须留痕）', () => {
  it('显式放宽：tier＋绝对路径根＋authorization 留痕 → 计划逐条落根', () => {
    const plan = resolveSeatbeltGrant({
      tier: 'workspace-write',
      writeRoots: ['/w/ticket', '/w/out'],
      authorization: 'IMPL-07-08 显式放宽断言',
    })
    expect(plan.tier).toBe('workspace-write')
    expect(plan.writeRoots).toEqual(['/w/ticket', '/w/out'])
    expect(plan.authorization).toBe('IMPL-07-08 显式放宽断言')
  })

  it('放宽须显式：缺根／相对路径根／缺留痕（含空白留痕）一律构造期拒收', () => {
    expect(() => resolveSeatbeltGrant({ tier: 'workspace-write', authorization: 'x' })).toThrow(
      /seatbelt\/widening-without-roots/,
    )
    expect(() =>
      resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: ['rel/dir'], authorization: 'x' }),
    ).toThrow(/seatbelt\/write-root-invalid/)
    expect(() => resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: ['/w'] })).toThrow(
      /seatbelt\/widening-unauthorized/,
    )
    expect(() =>
      resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: ['/w'], authorization: '   ' }),
    ).toThrow(/seatbelt\/widening-unauthorized/)
  })
})

describe('档位解析：非法档拒绝（off 不是档位）', () => {
  it("'off' 一类「关掉即裸」不是档位：构造期 CONFIG_INVALID，不静默当 read-only/off", () => {
    for (const tier of ['off', 'unconfined', 'yolo', '']) {
      expect(() => resolveSeatbeltGrant({ tier: tier as SeatbeltTier })).toThrow(
        /seatbelt\/tier-invalid/,
      )
    }
    // 报错文本要点名两档（可判读，不是裸 throw）
    expect(() => resolveSeatbeltGrant({ tier: 'off' as SeatbeltTier })).toThrow(
      /read-only \| workspace-write/,
    )
  })

  it('read-only 档不得携带写域根（不静默丢根、也不静默放宽；省略 tier 同档）', () => {
    expect(() => resolveSeatbeltGrant({ writeRoots: ['/w'] })).toThrow(
      /seatbelt\/read-only-write-roots/,
    )
    expect(() => resolveSeatbeltGrant({ tier: 'read-only', writeRoots: ['/w'] })).toThrow(
      /seatbelt\/read-only-write-roots/,
    )
  })
})

// ---------------------------------------------------------------------------
// 内置工厂面（BUILTIN_FACTORIES 的 seatbelt 参数：省略=read-only，不静默给全权）
// ---------------------------------------------------------------------------

describe('内置工厂 seatbelt 参数：缺省最严（不传=read-only 档）', () => {
  it('builtinResolver 省略 seatbelt → dsh launch 落 read-only profile：写域零放行', async () => {
    const ws = freshWorkspace('default')
    const adapter = builtinResolver('dsh')!([process.execPath, fakeCli])
    const profile = await launchProfile(adapter, ws)
    expect(profile).toContain('(deny file-write*)')
    expect(profile.match(/\(allow file-write\*/g) ?? []).toHaveLength(0) // 零白名单=只读档（不是 off）
    expect(profile).toContain('(deny network*)')
    expect(profile).toContain(';; dispatch: IMPL-07-08/att1')
  })

  it('read-only 档不白名单 dsh scratch：dshHomeRedirect 只作 env 重定向，不进写域', async () => {
    const ws = freshWorkspace('readonly-home')
    const dshHome = join(ws, '.dsh-home')
    const adapter = builtinResolver('dsh', { dshHomeRedirect: dshHome })!([
      process.execPath,
      fakeCli,
    ])
    const profile = await launchProfile(adapter, ws)
    expect(profile.match(/\(allow file-write\*/g) ?? []).toHaveLength(0)
    expect(profile).not.toContain(dshHome)
  })
})

describe('内置工厂 seatbelt 参数：显式放宽才放宽', () => {
  it('builtinResolver 显式放宽 → profile 逐条白名单授权根（未授权根不进文）', async () => {
    const ws = freshWorkspace('widen')
    const adapter = builtinResolver('dsh', {
      tier: 'workspace-write',
      writeRoots: [ws],
      authorization: 'IMPL-07-08 显式放宽断言',
    })!([process.execPath, fakeCli])
    const profile = await launchProfile(adapter, ws)
    expect(profile).toContain('(deny file-write*)')
    expect(profile).toContain(`(allow file-write* (subpath "${ws}"))`)
    expect(profile.match(/\(allow file-write\*/g) ?? []).toHaveLength(1) // 只有计划里的根进文
    expect(profile).toContain(';; dispatch: IMPL-07-08/att1')
  })

  it('放宽的构造期守门在解析面：builtinResolver 收到非法档/未授权放宽立即拒', () => {
    expect(() => builtinResolver('dsh', { tier: 'off' as SeatbeltTier })).toThrow(
      /seatbelt\/tier-invalid/,
    )
    expect(() =>
      builtinResolver('dsh', { tier: 'workspace-write', writeRoots: ['/w'], authorization: '  ' }),
    ).toThrow(/seatbelt\/widening-unauthorized/)
  })

  it('无 seatbelt 端子的家族（claude/codex/kimi）：显式放宽拒收，read-only 缺省照过', () => {
    for (const family of ['claude', 'codex', 'kimi'] as const) {
      const widened = builtinResolver(family, {
        tier: 'workspace-write',
        writeRoots: ['/w'],
        authorization: 'IMPL-07-08',
      })!
      expect(() => widened(['x'])).toThrow(/agentconfig\/seatbelt-unenforceable/)
      // 缺省 read-only 不盖「已放宽」章也不拒构造（实际圈定缺失按 PRB-04 前置登记）
      expect(builtinResolver(family)!(['x']).name).toBe(family)
    }
  })

  it('registerBuiltins 的 seatbelt 覆盖同走构造期守门（per-family 覆盖面）', () => {
    const ok = registerBuiltins(createRegistry())
    expect(ok.list().map((e) => e.name)).toEqual(['dsh', 'claude', 'codex', 'kimi'])
    expect(() =>
      registerBuiltins(createRegistry(), { dsh: { seatbelt: { tier: 'off' as SeatbeltTier } } }),
    ).toThrow(/seatbelt\/tier-invalid/)
    expect(() =>
      registerBuiltins(createRegistry(), {
        dsh: { seatbelt: { tier: 'workspace-write', writeRoots: ['/w'] } },
      }),
    ).toThrow(/seatbelt\/widening-unauthorized/)
  })
})

// ---------------------------------------------------------------------------
// 头注锚（PRB-04 前置声明；SEC-FC-05 接口耦合）
// ---------------------------------------------------------------------------

describe('头注锚（文档口径落代码，防后续误读）', () => {
  it('seatbelt.ts 头注前置声明 PRB-04 未执行 → 实际拦截能力按不支持处理', () => {
    const src = readFileSync(seatbeltSrc, 'utf8')
    const header = src.slice(0, src.indexOf('*/'))
    expect(header).toContain('PRB-04')
    expect(header).toMatch(/未执行/)
    expect(header).toMatch(/按不支持处理/)
    expect(header).toMatch(/符号链接/) // PRB-04 负向项：符号链接逃逸未探即未证
    expect(header).toContain('read-only')
    expect(header).toContain('workspace-write')
    expect(header).toMatch(/缺省最严/)
  })

  it('agentconfig.ts 头注登记 SEC-FC-05 必填化与 §五-8 接口耦合（派发域随动 07-09）', () => {
    const src = readFileSync(agentconfigSrc, 'utf8')
    const header = src.slice(0, src.indexOf('*/'))
    expect(header).toContain('SEC-FC-05')
    expect(header).toContain('IMPL-07-09')
    expect(header).toContain('seatbelt')
    expect(header).toMatch(/必填/)
  })
})

// 面完整性：四家都在可解析面内（缺省绑定不留黑洞），未知名不静默
describe('面完整性', () => {
  const families: readonly ExecutorFamily[] = ['dsh', 'claude', 'codex', 'kimi']
  it('builtinResolver 覆盖四家；未知名 undefined（wireRegistry 明报路径不变）', () => {
    for (const family of families) expect(builtinResolver(family)).toBeDefined()
    expect(builtinResolver('nope')).toBeUndefined()
  })
})
