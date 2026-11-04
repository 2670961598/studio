/** 724：daemon 默认装配器注入 L2.5 角色包（类模板+岗位卡）；未配置=诚实默认类边界。 */
import { describe, expect, it } from 'vitest'
import type { CompanySnapshot, ExecutorCapabilities, IssueRecord, PersonRef } from '@studio-next/contract'
import { LAYER_ORDER } from '@studio-next/prompt'
import { createDefaultAssembler, type AssembleDispatchInput, type AssemblerContext } from '../../../src/engine/prompt-assembly.ts'
import type { TicketReadView } from '../../../src/engine/read-tiers.ts'

const person: PersonRef = { id: 'ENG-1', name: '执行甲', login: 'eng-1', level: 1, dept: '研发部' }
const snapshot: CompanySnapshot = {
  slug: 'co', name: 'Co', level: 1, charter: 'c', platform: { platform: 'localfile' },
  departments: [{ name: '研发部', path: '研发部', parent: null, leader: 'ENG-1', level: 1, lanes: ['dev'], functions: ['研发'], relations: [] }],
  people: [person], jobs: [],
}
const issue: IssueRecord = { id: 'T-1', title: 't', state: '已派发', type: 'devtask', dept: '研发部', level: 1, assignee: 'ENG-1', updated: '2026-11-05T00:00:00.000Z' }
const capabilities: ExecutorCapabilities = { budget_cap: true, cancel_turn: true, session_resume: true, agents_md: 'native', cost_native: true }
const view: TicketReadView = { tier: 'full', issue: 'T-1', title: 't', state: '已派发', fields: { type: 'devtask', dept: '研发部', level: 1, assignee: 'ENG-1', updated: issue.updated }, description: 'd', comments: [] }
const input: AssembleDispatchInput = {
  issue, attempt: 1, person, adapterName: 'dsh', adapterVersion: '1', capabilities,
  workspace: '/tmp/724/att1', briefPath: '/tmp/724/att1/brief.md', agentsTarget: '/tmp/724/att1/AGENTS.md',
  agentsChannel: { channel: 'native', target: '/tmp/724/att1/AGENTS.md' }, readView: view,
}
function ctx(over: Partial<AssemblerContext> = {}): AssemblerContext {
  return {
    fwkVersion: 'v-test', frameworkPrompts: '红线', snapshot, acceptance: ['true'], docRefs: ['docs/17-§5'],
    ...over,
  }
}

describe('724 L2.5 role pack in daemon assembler', () => {
  it('注入 rolePack → AGENTS.md 含 L2.5 类模板+岗位卡，指纹段 role.<sha8>，7 段', () => {
    const assembler = createDefaultAssembler(ctx({
      rolePack: () => ({ roleClass: 'executor', classText: '执行类模板：最小改动/测试自检', cardText: 'ENG-1 岗位卡：交付可验证代码', cardVersion: 2 }),
    }))
    const out = assembler(input)
    expect(out.agentsMd.text).toContain('LAYER:L2.5:BEGIN')
    expect(out.agentsMd.text).toContain('执行类模板')
    expect(out.agentsMd.text).toContain('ENG-1 岗位卡')
    expect(out.agentsMd.layerFingerprints['L2.5']).toMatch(/^role\.[0-9a-f]{8}$/)
    expect(Object.keys(out.agentsMd.layerFingerprints)).toEqual([...LAYER_ORDER])
  })
  it('未配置 rolePack → 仍有 L2.5（诚实默认类边界，不冒充角色卡）', () => {
    const out = createDefaultAssembler(ctx())(input)
    expect(out.agentsMd.text).toContain('LAYER:L2.5:BEGIN')
    expect(out.agentsMd.text).toContain('未配置岗位卡')
    expect(out.agentsMd.text).toContain('未配置 prompts/roles')
  })
})
