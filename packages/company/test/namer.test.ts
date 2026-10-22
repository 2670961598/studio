/**
 * 员工花名随机命名器测试（DEV-14；docs/36-§4 M-A——分级模板的确定性花名面）
 *
 * 断言面：
 *   1. 确定性：同种子同序列（跨进程跨机器稳定——模板再生成零 diff 的根）；
 *   2. 异种子发散：不同模板名不出同序列（等级间不串名）；
 *   3. 批内唯一：重抽兜底生效（数量远小于词池组合数时必然全唯一）；
 *   4. 形态：两字中文（形容词池×名词池各 32 字）；
 *   5. 域守卫：count 超词池组合上限 → 如实抛错（不静默产出重复名）。
 */
import { describe, expect, it } from 'vitest'
import { codenames, fnv1a, mulberry32, NAME_POOLS } from '../src/namer.ts'

describe('namer 确定性花名（DEV-14）', () => {
  it('同种子同序列（确定性——模板再生成零 diff 的根）', () => {
    expect(codenames('company-5-level', 13)).toEqual(codenames('company-5-level', 13))
    expect(codenames('company-3-level', 7)).toEqual(codenames('company-3-level', 7))
  })

  it('异种子发散：等级间不串序列', () => {
    const a = codenames('company-3-level', 7)
    const b = codenames('company-4-level', 10)
    expect(a).not.toEqual(b.slice(0, 7))
  })

  it('批内唯一（重抽兜底）', () => {
    for (const n of [2, 7, 10, 16, 64, 256]) {
      const names = codenames('company-9-level', n)
      expect(new Set(names).size).toBe(n)
      expect(names).toHaveLength(n)
    }
  })

  it('形态：两字中文（形容词×名词池直拼，无分隔符）', () => {
    for (const name of codenames('company-6-level', 15)) {
      expect(name).toMatch(/^[\u4e00-\u9fff]{2}$/)
      expect(NAME_POOLS.adjectives).toContain(name[0]!)
      expect(NAME_POOLS.nouns).toContain(name[1]!)
    }
  })

  it('词池形状：32×32 单字，两池无交集', () => {
    expect(NAME_POOLS.adjectives).toHaveLength(32)
    expect(NAME_POOLS.nouns).toHaveLength(32)
    for (const ch of NAME_POOLS.adjectives) expect(ch).toMatch(/^[\u4e00-\u9fff]$/)
    for (const ch of NAME_POOLS.nouns) expect(ch).toMatch(/^[\u4e00-\u9fff]$/)
    expect(NAME_POOLS.adjectives.filter((c) => NAME_POOLS.nouns.includes(c))).toEqual([])
  })

  it('域守卫：count 超词池组合上限 → 如实抛错（不静默产重复名）', () => {
    expect(() => codenames('company-3-level', 1025)).toThrow(/1024/)
  })

  it('底座原语：fnv1a 稳定；mulberry32 同种子同流', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('company-3-level')).toBe(fnv1a('company-3-level'))
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })

  it('黄金序列锚（种子冻结声明：改池/改种子=重新冻结，属口味变更须过审）', () => {
    // 首名锚：各等级模板首个花名（手抄冻结——pool 或种子变更须同步本断言与 REPORT 漂移注记）
    expect(codenames('company-3-level', 1)).toEqual(['朗窗'])
    expect(codenames('company-4-level', 1)).toEqual(['白原'])
    expect(codenames('company-9-level', 1)).toEqual(['望樵'])
    // 不同种子不同首名（同 count 时仅由种子决定）
    expect(codenames('company-3-level', 1)[0]).not.toBe(codenames('company-4-level', 1)[0])
  })
})
