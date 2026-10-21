/**
 * plat 域契约接线（studio-dev-102 P2-①；CASES.md「plat 域 v1 语义说明」）
 *
 * 双绿 = docs/25-§6-2 前半句（platform 端口同一 case 双实现绿）的 localfile 侧兑现：
 *   - 内存实现＋tmpRoot（零网络零真实落盘面）——坏输入族全部先于业务语义校验：
 *     坏游标先解析（activity.ts parseActivityId）、坏 provision 先形状校验（fields.ts）、
 *     坏署名体在单存在后先验形（comments.ts，与 yt 同序）；not-found 族走空根未命中。
 *   - 只断言 category 全等（CASES.md plat 纪律）：expected.err 不给 subcause，
 *     跨实现 subcause 差异如实放行（如 localfile kb-not-found vs yt not-found 同族）。
 *   - 防恒反证＋同错同键＋公共面子表命中（102-§4.2 P2-① 冻结面）。
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCases, type FieldProvisionMap, type FlowPlatform } from '@studio-next/contract'
import manifest from '../../contract/cases.json' with { type: 'json' }
import { LocalPlatformError, createLocalPlatform } from './index.ts'
import { fixedClock, tmpRoot } from './testutil.ts'

let root: string

beforeEach(() => {
  root = tmpRoot('platcases')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 基准单（CASES.md BASE 哨兵的 localfile 侧翻译）：预建一张单，comments 写路径先查单存在（同 yt 序） */
async function subject(): Promise<{ p: FlowPlatform; base: string }> {
  const p = createLocalPlatform(root, { now: fixedClock() })
  const rec = await p.issues.create({ title: 'plat-case 基准单' })
  return { p, base: rec.id }
}

/** plat 域 subject：input.op 路由到 FlowPlatform 面（签名见 docs/25-§3.2） */
function platSubject(p: FlowPlatform, base: string): (input: unknown) => Promise<unknown> {
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
        return p.comments.add(c.issue === 'BASE' ? base : (c.issue ?? ''), c.body as never)
      case 'fields.provision':
        return p.fields.provision(c.map as unknown as FieldProvisionMap)
      // studio-dev-126 C-plat-009/010（幂等/并发收敛批）：subject 诚实计算 converged——
      // 二跑/竞跑任一抛错即 false（case 的 out 断言把它钉死为 true，假收敛必红）
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

/** 直证辅助：跑一次坏输入，捕获 LocalPlatformError 的 category/subcause（别的错如实冒泡） */
async function rejectOf(p: FlowPlatform, base: string, input: unknown): Promise<{ category: string; subcause: string }> {
  try {
    await platSubject(p, base)(input)
  } catch (err) {
    if (err instanceof LocalPlatformError) return { category: err.category, subcause: err.subcause }
    throw err
  }
  throw new Error('期望抛错但正常返回')
}

describe('plat 域契约（102-P2-①：错误分类一致性——localfile 侧内存实现接线）', () => {
  it('10 条 plat case 全绿（错误分类 8 + 幂等/并发收敛 2；studio-dev-126 增批）', async () => {
    const { p, base } = await subject()
    const r = await runCases(manifest, { plat: platSubject(p, base) }, { domains: ['plat'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(10)
    expect(r.passed).toBe(10)
  })

  it('防恒反证：谎报 subject（category 取反重抛）10 条必全红——runner 真能揪错', async () => {
    const { p, base } = await subject()
    const lying = (input: unknown): Promise<unknown> =>
      platSubject(p, base)(input)
        .then((out) => {
          // studio-dev-126 收敛批反证面：converged 结果取反（谎报收敛必被 runner 揪出）
          if (out !== null && typeof out === 'object' && 'converged' in (out as Record<string, unknown>)) {
            return { converged: !(out as { converged: boolean }).converged }
          }
          return out
        })
        .catch((err: unknown) => {
          if (err instanceof LocalPlatformError) {
            throw new LocalPlatformError(
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
    const { p, base } = await subject()
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
      const a = await rejectOf(p, base, input)
      const b = await rejectOf(p, base, input)
      expect(b).toEqual(a)
      expect(a.subcause).not.toBe('')
    }
  })

  it('公共面子表命中：三族坏输入稳定键前缀表（bad-cursor/bad-signed-body/bad-provision/not-found 族）', async () => {
    const { p, base } = await subject()
    const table: Array<[unknown, RegExp]> = [
      [{ op: 'activity.since', cursor: 'garbage' }, /^bad-cursor$/],
      [{ op: 'activity.since', cursor: 'a-0000xx' }, /^bad-cursor$/],
      [{ op: 'comments.add', issue: 'BASE', body: { author: 42, body: 'x', signature: '[c]' } }, /^bad-signed-body$/],
      [{ op: 'comments.add', issue: 'BASE', body: { author: 'E-1', body: 'x', signature: '两\n行' } }, /^bad-signed-body$/],
      [{ op: 'fields.provision', map: {} }, /^bad-provision$/],
      [{ op: 'fields.provision', map: { fields: { a: 1 }, states: [], stateFlow: {} } }, /^bad-provision$/],
      // not-found 族稳定键前缀（localfile：issue-not-found/kb-not-found）
      [{ op: 'issues.get', id: 'NOPE-999' }, /^issue-not-found$/],
      [{ op: 'kb.get', path: 'missing/doc.md' }, /^kb-not-found$/],
    ]
    for (const [input, want] of table) {
      const { subcause } = await rejectOf(p, base, input)
      expect(subcause).toMatch(want)
    }
  })

  it('坏 provision 零落盘直证：脏 map 拒收后 fields.json 不存在（校验先于写盘——同 yt 预网络序）', async () => {
    const { p } = await subject()
    const fieldsJson = join(root, 'meta', 'fields.json')
    const first = await rejectOf(p, 'LOCAL-0', { op: 'fields.provision', map: {} })
    expect(first).toEqual({ category: 'CONFIG_INVALID', subcause: 'bad-provision' })
    expect(existsSync(fieldsJson)).toBe(false) // 拒收即零落盘（无半写状态）
    const again = await rejectOf(p, 'LOCAL-0', { op: 'fields.provision', map: {} })
    expect(again).toEqual(first) // 幂等面：同坏输入再打仍同键拒收
  })
})
