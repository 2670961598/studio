/**
 * gateway-wire.test.ts —— 装配层「只产 gated 形态」（SEC-FC-01/02 的 daemon 腿；NEG-SEC-01/N-a）
 *
 * 依据：v2/15 §一 SEC-FC-01（`gateway:false` 命中即返回裸 platform＝禁止形态；目标＝装配层只产
 *   gated 形态、注入裸 platform 判装配错误）／SEC-FC-02（签根来源可见、值不入日志）；
 *   v2/17 NEG-SEC-01/N-a（绕网关直调 adapter 无路径/失败——本件落**装配腿**：闸拒绝时底层
 *   platform 不被调用）；docs/plan/05 IMPL-07-06「删除 wire.ts 裸 platform 分支」。
 *
 * 断言口径：fail-closed 是机制不是台词——被拒的写调用必须**零底层副作用**，且旧开关形态
 * （伪造 `gateway:false`）在装配层已无效果。
 */
import { describe, expect, it } from 'vitest'
import type { FlowPlatform } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import { wireGatedPlatform } from '../../../src/assembly/platform/wire.ts'
import { GATEWAY_SECRET_ENV, daemonIdentity, parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'

const SECRET_TEXT = '0123456789abcdef0123456789abcdef'
const SECRET_HEX = Buffer.from(SECRET_TEXT, 'utf8').toString('hex')
const CONFIG = parseDaemonConfig(['db: ./var/x.sqlite', 'company: demo', 'platform: fake', ''].join('\n'))
const CLOCK = (): number => 1_700_000_000_000

/** 记录底层平台写调用（NEG-SEC-01/N-a 的「底层未被调用」判据） */
function recordingPlatform(): { platform: FlowPlatform; calls: string[] } {
  const inner = createFakePlatform({ now: (): string => '2026-06-01T00:00:00Z' })
  const calls: string[] = []
  const platform: FlowPlatform = {
    ...inner,
    issues: {
      ...inner.issues,
      create: async (input) => {
        calls.push('issues.create')
        return inner.issues.create(input)
      },
    },
  }
  return { platform, calls }
}

/** 部署形态身份（env 签根注入） */
const ENV_IDENTITY = daemonIdentity(CONFIG, DEMO_SNAPSHOT, { env: { [GATEWAY_SECRET_ENV]: SECRET_TEXT } })
/** demo 形态身份（进程内临时签根，带降级标记） */
const DEMO_IDENTITY = daemonIdentity(CONFIG, DEMO_SNAPSHOT, { env: {}, random: (n: number): Uint8Array => new Uint8Array(n).fill(3) })

describe('SEC-FC-01 只产 gated 形态（裸 platform 分支已删除）', () => {
  it('wireGatedPlatform 返回包装器而非原平台：写方法函数身份不同（无直调句柄）', () => {
    const { platform: raw } = recordingPlatform()
    const wired = wireGatedPlatform(raw, CONFIG, ENV_IDENTITY, CLOCK, () => {})
    expect(wired).not.toBe(raw)
    expect(wired.issues.create).not.toBe(raw.issues.create)
    expect((wired as unknown as { platform?: unknown }).platform).toBeUndefined()
  })

  it('伪造旧开关形态 `gateway:false` 在装配层已无效果（仍产 gated 形态）', () => {
    const { platform: raw } = recordingPlatform()
    const forged = { ...CONFIG, gateway: false } as unknown as typeof CONFIG
    const wired = wireGatedPlatform(raw, forged, ENV_IDENTITY, CLOCK, () => {})
    expect(wired).not.toBe(raw)
    expect(wired.issues.create).not.toBe(raw.issues.create)
  })

  it('正向对照：合法闸实例下写路径照常放行并落到平台', async () => {
    const { platform: raw, calls } = recordingPlatform()
    const wired = wireGatedPlatform(raw, CONFIG, ENV_IDENTITY, CLOCK, () => {})
    const created = await wired.issues.create({ title: 'N-a 正向对照' })
    expect(calls).toEqual(['issues.create'])
    expect(created.title).toBe('N-a 正向对照')
  })
})

describe('NEG-SEC-01/N-a 闸拒绝＝底层零副作用（无绕过路径）', () => {
  it('控制面吊销后写调用被拒（EXTERNAL_REJECT/gw-verify-revoked），底层 platform 未被调用', async () => {
    const { platform: raw, calls } = recordingPlatform()
    const gateway = createGateway({ secret: ENV_IDENTITY.secret, clock: CLOCK, ticket: CONTROL_TICKET, ctx: ENV_IDENTITY.ctx, author: ENV_IDENTITY.author })
    gateway.revoke(CONTROL_TICKET) // 关单/收口即死：此后全写面恒拒
    const wired = wireGatedPlatform(raw, CONFIG, ENV_IDENTITY, CLOCK, () => {}, { gateway })
    await expect(wired.issues.create({ title: 'N-a 负向' })).rejects.toMatchObject({
      category: 'EXTERNAL_REJECT',
      subcause: 'gw-verify-revoked',
    })
    expect(calls).toEqual([])
  })

  it('闸拒绝不影响读面直通（读面透明，不因写闸关闭而变成「全裸」）', async () => {
    const { platform: raw } = recordingPlatform()
    const gateway = createGateway({ secret: ENV_IDENTITY.secret, clock: CLOCK, ticket: CONTROL_TICKET, ctx: ENV_IDENTITY.ctx, author: ENV_IDENTITY.author })
    gateway.revoke(CONTROL_TICKET)
    const wired = wireGatedPlatform(raw, CONFIG, ENV_IDENTITY, CLOCK, () => {}, { gateway })
    await expect(wired.issues.list({})).resolves.toEqual([])
  })
})

describe('SEC-FC-02 签根来源可见、值不落日志', () => {
  it('env 形态：启动日志标 env 键名，且不含签根值（明文/hex）', () => {
    const { platform: raw } = recordingPlatform()
    const lines: string[] = []
    wireGatedPlatform(raw, CONFIG, ENV_IDENTITY, CLOCK, (line) => lines.push(line))
    const log = lines.join('\n')
    expect(log).toContain(`签根来源=env ${GATEWAY_SECRET_ENV}`)
    expect(log).toContain('全收口')
    expect(log).not.toContain(SECRET_TEXT)
    expect(log).not.toContain(SECRET_HEX)
  })

  it('demo 形态：降级标记显式落日志（不静默），值同样不落日志', () => {
    const { platform: raw } = recordingPlatform()
    const lines: string[] = []
    wireGatedPlatform(raw, CONFIG, DEMO_IDENTITY, CLOCK, (line) => lines.push(line))
    const log = lines.join('\n')
    expect(log).toContain('demo-ephemeral')
    expect(log).toContain('【降级标记】')
    expect(log).not.toContain(Buffer.from(DEMO_IDENTITY.secret).toString('hex'))
  })
})
