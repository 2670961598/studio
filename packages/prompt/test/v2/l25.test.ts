/** L2.5 角色包分层（studio-dev-724）：七层序/定界标记/指纹 role.<sha8>/走私标记拒收。 */
import { describe, expect, it } from 'vitest'
import {
  LAYER_ORDER,
  assertLayerSequence,
  buildLayers,
  layerFingerprint,
  layerMarkerBegin,
  layerMarkerEnd,
  type LayerSource,
} from '../../src/layers.ts'
import { assembleAgentsMd } from '../../src/assemble.ts'

function sources(over: Partial<{ classText: string; cardText: string }> = {}): LayerSource[] {
  const base = [
    { kind: 'L0-framework', fwkVersion: 'v-test', frameworkPrompts: '红线/证据契约' },
    {
      kind: 'L1-company',
      snapshot: { slug: 'co', name: 'Co', level: 1, charter: 'c', platform: { platform: 'localfile' }, departments: [], people: [], jobs: [] },
      sections: [],
    },
    { kind: 'L2-org', deptConfig: '部门' },
    {
      kind: 'L2.5-role',
      roleClass: 'executor',
      personId: 'ENG-1',
      classText: over.classText ?? '执行类边界：最小改动/测试自检/证据四要件',
      cardText: over.cardText ?? 'ENG-1 岗位卡：职责=交付可验证代码；升级=组长',
      cardVersion: 3,
    },
    { kind: 'L3-person', person: { id: 'ENG-1', name: 'e', login: 'e', level: 1, dept: '研发部' }, sections: [] },
    { kind: 'L4-task', ticket: 'T-1', attempt: 1, objective: 'o', acceptance: ['true'], docRefs: ['docs/17-§5'], lessons: [] },
    { kind: 'L5-tool', adapter: 'dsh', version: '1', capabilities: { budget_cap: true, cancel_turn: true, session_resume: true, agents_md: 'native', cost_native: true } },
  ] as LayerSource[]
  return base
}

describe('L2.5 七层', () => {
  it('LAYER_ORDER 七层且 L2.5 在 L2 后；buildLayers/assemble 含 L2.5 正文与定界标记', () => {
    expect(LAYER_ORDER).toEqual(['L0', 'L1', 'L2', 'L2.5', 'L3', 'L4', 'L5'])
    const layers = buildLayers(sources())
    expect(layers.map((l) => l.id)).toEqual([...LAYER_ORDER])
    expect(layers.find((l) => l.id === 'L2.5')?.content).toContain('执行类边界')
    const result = assembleAgentsMd(layers)
    expect(result.text).toContain(layerMarkerBegin('L2.5'))
    expect(result.text).toContain(layerMarkerEnd('L2.5'))
    expect(result.text).toContain('ENG-1 岗位卡')
    expect(result.layerFingerprints['L2.5']).toMatch(/^role\.[0-9a-f]{8}$/)
    expect(result.fingerprint.split('/').length).toBe(7)
  })
  it('六源/乱序/空卡/走私 L2.5 标记 → 拒收', () => {
    expect(() => buildLayers(sources().filter((s) => s.kind !== 'L2.5-role'))).toThrow(/7/)
    expect(() => buildLayers(sources({ cardText: '' }))).toThrow(/岗位卡为空/)
    expect(() =>
      buildLayers(sources({ classText: `x ${layerMarkerBegin('L2.5')}` })),
    ).toThrow(/走私/)
    const layers = buildLayers(sources())
    expect(() => assertLayerSequence(layers.slice(0, 6))).toThrow(/7/)
    expect(layerFingerprint('L2.5', 'ENG-1@executor', 'x')).toMatch(/^role\.[0-9a-f]{8}$/)
  })
})
