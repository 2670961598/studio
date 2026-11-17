/** task-104：KimiAdapter seatbelt 端子（纯构造 + agentconfig 注册面）；不真跑 sandbox，避免嵌套环境假红。 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRegistry } from '../../src/registry.ts'
import { builtinResolver, registerBuiltins } from '../../src/agentconfig.ts'
import { KimiAdapter, kimiSeatbeltInvocation } from '../../src/kimi.ts'
import { resolveSeatbeltGrant } from '../../src/seatbelt.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function workspace(): string { const d = mkdtempSync(join(tmpdir(), 'kimi-seatbelt-')); dirs.push(d); return d }

describe('task-104 Kimi seatbelt 端子', () => {
  it('workspace-write 计划 → argv 含 sandbox-exec、profile 含授权写根', () => {
    const w = workspace()
    const plan = resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: [w], authorization: 'task-104 测试授权' })
    const inv = kimiSeatbeltInvocation(plan, ['kimi', '-p', 'x'], w, 'T-1', 1)
    expect(inv.argv[0]).toBe('/usr/bin/sandbox-exec')
    expect(inv.argv).toContain('-f')
    expect(inv.argv).toContain(inv.profilePath)
    expect(readFileSync(inv.profilePath, 'utf8')).toContain(`(subpath "${w}")`)
  })

  it('read-only 计划 → 零写根；workspace-write 缺 authorization → 构造期拒', () => {
    const w = workspace()
    const ro = resolveSeatbeltGrant(undefined) // read-only 缺省最严
    const inv = kimiSeatbeltInvocation(ro, ['kimi', '-p', 'x'], w, 'T-1', 1)
    expect(inv.profileText).not.toContain('(allow file-write* (subpath')
    expect(() => resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: [w] })).toThrow(/authorization|留痕/)
  })

  it('agentconfig：kimi workspace-write 可注册（有端子）；claude 无端子仍拒', () => {
    const w = workspace()
    const grant = { tier: 'workspace-write' as const, writeRoots: [w], authorization: 'task-104 测试授权' }
    expect(() => registerBuiltins(createRegistry(), { kimi: { seatbelt: grant } })).not.toThrow()
    expect(() => registerBuiltins(createRegistry(), { claude: { seatbelt: grant } })).toThrow(/seatbelt-unenforceable/)
    expect(builtinResolver('kimi', grant)).toBeTypeOf('function')
    expect(new KimiAdapter(['kimi']).constructor).toBe(KimiAdapter)
  })
})
