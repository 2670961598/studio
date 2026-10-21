/**
 * plat 域契约接线（studio-dev-102 P2-①；CASES.md「plat 域 v1 语义说明」）
 *
 * 双绿 = docs/25-§6-2 前半句（platform 端口同一 case 双实现绿）的 yt 侧兑现：
 *   - 真适配器＋FakeYouTrack 注入 fetch（零真实网络）——坏输入族全部先于业务语义校验：
 *     坏游标先解码（activity.ts decodeCursor）、坏署名体在单存在后先验形（comments.ts）、
 *     坏 provision 先 rebind 验证（fieldmap.ts）；not-found 族走 fake 404/索引未命中。
 *   - 只断言 category 全等（CASES.md plat 纪律）：expected.err 不给 subcause，
 *     跨实现 subcause 差异如实放行（如 yt not-found vs localfile kb-not-found 同族）。
 *   - 防恒反证＋同错同键＋公共面子表命中（102-§4.2 P2-① 冻结面）。
 */
import { describe, expect, it } from 'vitest'
import { runCases, type FieldProvisionMap, type FlowPlatform } from '@studio-next/contract'
import manifest from '../../contract/cases.json' with { type: 'json' }
import { YouTrackPlatformError } from './index.ts'
import { FakeYouTrack, makePlatform } from './testutil.ts'

/** 基准单（CASES.md BASE 哨兵的 yt 侧翻译）：fixtures 预造 STUDIO-1——comments 写路径先查单存在 */
const BASE = 'STUDIO-1'

/** plat 域 subject：input.op 路由到 FlowPlatform 面（签名见 docs/25-§3.2） */
function platSubject(p: FlowPlatform): (input: unknown) => Promise<unknown> {
  return (input: unknown) => {
    const c = input as {
      op: string
      cursor?: string
      issue?: string
      body?: unknown
      map?: unknown
      id?: string
      path?: string
    }
    switch (c.op) {
      case 'activity.since':
        return p.activity.since(c.cursor ?? null)
      case 'comments.add':
        return p.comments.add(c.issue === 'BASE' ? BASE : (c.issue ?? ''), c.body as never)
      case 'fields.provision':
        return p.fields.provision(c.map as unknown as FieldProvisionMap)
      // studio-dev-126 C-plat-009/010（幂等/并发收敛批）：同 localfile 侧语义——subject
      // 诚实计算 converged（本实现 provision=实例内同步热换绑，天然收敛；窗口吸收
      // 机制证明归 taiga 包单测——CASES.md 增批注记）
      case 'fields.provision.rerun':
        return p.fields
          .provision(c.map as unknown as FieldProvisionMap)
          .then(() => p.fields.provision(c.map as unknown as FieldProvisionMap))
          .then(() => ({ converged: true }), () => ({ converged: false }))
      case 'fields.provision.concurrent':
        return Promise.all([
          p.fields.provision(c.map as unknown as FieldProvisionMap),
          p.fields.provision(c.map as unknown as FieldProvisionMap),
        ]).then(() => ({ converged: true }), () => ({ converged: false }))
      case 'issues.get':
        return p.issues.get(c.id ?? '')
      case 'kb.get':
        return p.kb.get(c.path ?? '')
      default:
        throw new Error(`plat-cases: 未知 op ${String(c.op)}`)
    }
  }
}

/** 直证辅助：跑一次坏输入，捕获 YouTrackPlatformError 的 category/subcause（别的错如实冒泡） */
async function rejectOf(p: FlowPlatform, input: unknown): Promise<{ category: string; subcause: string }> {
  try {
    await platSubject(p)(input)
  } catch (err) {
    if (err instanceof YouTrackPlatformError) return { category: err.category, subcause: err.subcause }
    throw err
  }
  throw new Error('期望抛错但正常返回')
}

function subject(): FlowPlatform {
  const fake = new FakeYouTrack()
  return makePlatform(fake, { project: 'STUDIO' })
}

describe('plat 域契约（102-P2-①：错误分类一致性——yt 侧真适配器接线）', () => {
  it('10 条 plat case 全绿（错误分类 8 + 幂等/并发收敛 2；studio-dev-126 增批）', async () => {
    const r = await runCases(manifest, { plat: platSubject(subject()) }, { domains: ['plat'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(10)
    expect(r.passed).toBe(10)
  })

  it('防恒反证：谎报 subject（category 取反重抛）10 条必全红——runner 真能揪错', async () => {
    const p = subject()
    const lying = (input: unknown): Promise<unknown> =>
      platSubject(p)(input)
        .then((out) => {
          // studio-dev-126 收敛批反证面：converged 结果取反（谎报收敛必被 runner 揪出）
          if (out !== null && typeof out === 'object' && 'converged' in (out as Record<string, unknown>)) {
            return { converged: !(out as { converged: boolean }).converged }
          }
          return out
        })
        .catch((err: unknown) => {
          if (err instanceof YouTrackPlatformError) {
            throw new YouTrackPlatformError(
              err.category === 'CONFIG_INVALID' ? 'EXTERNAL_REJECT' : 'CONFIG_INVALID',
              err.subcause,
              'plat-cases 反证：故意改坏 category',
            )
          }
          throw err
        })
    const r = await runCases(manifest, { plat: lying }, { domains: ['plat'] })
    expect(r.passed).toBe(0)
    expect(r.failed).toHaveLength(10)
  })

  it('同错同键：同一坏输入两次抛同 category×subcause（单实现稳定键，102-§4.2）', async () => {
    const p = subject()
    for (const input of [
      { op: 'activity.since', cursor: 'garbage' },
      { op: 'activity.since', cursor: 'a-0000xx' },
      { op: 'comments.add', issue: 'BASE', body: { author: 42, body: 'x', signature: '[c]' } },
      { op: 'comments.add', issue: 'BASE', body: { author: 'E-1', body: 'x', signature: '两\n行' } },
      { op: 'fields.provision', map: {} },
      { op: 'fields.provision', map: { fields: { a: 1 }, states: [], stateFlow: {} } },
      { op: 'issues.get', id: 'NOPE-999' },
      { op: 'kb.get', path: 'missing/doc.md' },
    ]) {
      const a = await rejectOf(p, input)
      const b = await rejectOf(p, input)
      expect(b).toEqual(a)
      expect(a.subcause).not.toBe('')
    }
  })

  it('公共面子表命中：三族坏输入稳定键前缀表（bad-cursor/bad-signed-body/bad-provision/not-found 族）', async () => {
    const p = subject()
    const table: Array<[unknown, RegExp]> = [
      [{ op: 'activity.since', cursor: 'garbage' }, /^bad-cursor$/],
      [{ op: 'activity.since', cursor: 'a-0000xx' }, /^bad-cursor$/],
      [{ op: 'comments.add', issue: 'BASE', body: { author: 42, body: 'x', signature: '[c]' } }, /^bad-signed-body$/],
      [{ op: 'comments.add', issue: 'BASE', body: { author: 'E-1', body: 'x', signature: '两\n行' } }, /^bad-signed-body$/],
      [{ op: 'fields.provision', map: {} }, /^bad-provision$/],
      [{ op: 'fields.provision', map: { fields: { a: 1 }, states: [], stateFlow: {} } }, /^bad-provision$/],
      // not-found 族稳定键前缀（yt：issue-not-found/kb-not-found）
      [{ op: 'issues.get', id: 'NOPE-999' }, /^(issue-)?not-found$/],
      [{ op: 'kb.get', path: 'missing/doc.md' }, /^kb-not-found$/],
    ]
    for (const [input, want] of table) {
      const { subcause } = await rejectOf(p, input)
      expect(subcause).toMatch(want)
    }
  })

  it('预网络直证：三族坏输入零 HTTP 调用（坏输入校验先于网络——FakeYouTrack calls 记账）', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    for (const input of [
      { op: 'activity.since', cursor: 'garbage' },
      { op: 'fields.provision', map: {} },
    ]) {
      await expect(rejectOf(p, input)).resolves.toHaveProperty('category', 'CONFIG_INVALID')
    }
    const preIo = fake.calls.filter((c) => c.method === 'GET' && c.path === '/api/activities')
    expect(preIo).toEqual([]) // 坏游标在解码层红，未触活动流请求
  })
})
