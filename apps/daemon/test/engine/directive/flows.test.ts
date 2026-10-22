/**
 * directive-flows —— 批示归一 spike S1·S2·S3（studio-dev-171，130-§8 / docs/18-§2.1.1+§2.5）。
 *
 * S1 提案类型流声明过闸：org-config 声明 T:proposal（entity: userstory）过 W-1..W-9
 *   判定器全绿；六条阴性探针各打中一条冻结规则（保留词/重复态/锚不在册/锚链断裂/
 *   delivered 非终态/inbox 非首态）——判负线：声明面漏洞不得静默过闸。
 * S2 建单直落待批：deriveFieldProvision 折叠 typeInbox[proposal]=待批 → 平台
 *   provision 物化 → 建 proposal 单**不带 initialState** 落待批（不落新单/平台默认）。
 * S3 类型隔离不扰既有流：T 键只认 proposal；task/bug（W-9 保留词）与未声明类型
 *   照走等级流回退（L0/L1/L2 零扰动，缺省五态不误入待批）。
 *
 * 声明形态（as-built，docs/18-§2.1.1 冻结）：anchors.inbox=待批 → typeInbox 派生
 * 待批（建单直落）；approval 锚同位待批（decide 5b 收口等批示）；新单=终态后成员态
 * （打回声明边 待批→新单 可达——130-§6.1.1 意图的 DEV-43 等价表达，见 REPORT）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deriveFieldProvision, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, resolveTicketFlow, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform } from '@studio-next/contract'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'

/** initCompany 的 git 首提身份（e2e.test.ts 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'directive-flows-e2e@studio-next.invalid',
  GIT_COMMITTER_EMAIL: 'directive-flows-e2e@studio-next.invalid',
}

// ————————————————————————— 声明面（S1 阳性 + 阴性探针变体） —————————————————————————

interface DeclVariant {
  id?: string
  /** false = 整段去掉 entity 行（顶层桶变体） */
  entity?: string | false
  /** [state 名, final] 序列——顺序即流序 */
  states?: Array<[string, boolean?]>
  edges?: Array<[string, string]>
  anchors?: Record<string, string>
}

const POSITIVE: Required<Pick<DeclVariant, 'states' | 'edges' | 'anchors'>> = {
  states: [
    ['待批'],
    ['已派发'],
    ['证据就绪'],
    ['复验通过'],
    ['已交付', true],
    ['新单'],
  ],
  edges: [['待批', '新单']],
  anchors: { inbox: '待批', approval: '待批', dispatched: '已派发', evidence: '证据就绪', verified: '复验通过', delivered: '已交付' },
}

/** 组装 org-config 的 workflows 段（缺省=S1 阳性声明；变体覆写单点） */
function workflowsYaml(v: DeclVariant = {}): string {
  const states = v.states ?? POSITIVE.states
  const edges = v.edges ?? POSITIVE.edges
  const anchors = v.anchors ?? POSITIVE.anchors
  const lines: string[] = []
  lines.push('workflows:')
  lines.push('  types:')
  lines.push(`    - id: ${v.id ?? 'proposal'}`)
  if (v.entity !== false) lines.push(`      entity: ${v.entity ?? 'userstory'}`)
  lines.push('      states:')
  for (const [name, final] of states) {
    lines.push(`        - name: ${name}`)
    if (final === true) lines.push('          final: true')
  }
  if (edges.length > 0) {
    lines.push('      edges:')
    for (const [from, to] of edges) {
      lines.push(`        - from: ${from}`)
      lines.push(`          to: ${to}`)
    }
  }
  lines.push('      anchors:')
  for (const [k, val] of Object.entries(anchors)) lines.push(`        ${k}: ${val}`)
  return `\n# —— studio-dev-171 S1 提案类型流声明（docs/18-§2.1.1）——\n${lines.join('\n')}\n`
}

// ————————————————————————— 挂载面 —————————————————————————

let root = ''
let baseFiles: Record<string, string> = {}
let snapshot: CompanySnapshot

function mountWith(yaml: string): ReturnType<typeof loadCompanyDirectory> {
  return loadCompanyDirectory({ ...baseFiles, 'org-config.yaml': `${baseFiles['org-config.yaml'] ?? ''}${yaml}` })
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-directive-flows-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const files = await readDirectoryFiles(companyDir)
  // 模板自带 T:patrol 段拆掉（typeflows.e2e 同序）——本文件语料 proposal 为唯一类型面
  baseFiles = {
    ...files,
    'org-config.yaml': (files['org-config.yaml'] ?? '').replace(/\n# 单据类型流声明[\s\S]*?(?=\n# YouTrack 账号锚点映射)/, ''),
  }
  const mounted = mountWith(workflowsYaml())
  if (!mounted.ok) {
    throw new Error(`S1 阳性声明挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line} ${i.rule}`).join('；')}`)
  }
  snapshot = mounted.snapshot
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— S1：声明过闸（W-1..W-9） —————————————————————————

describe('S1 提案类型流声明（130-§8 判负线：声明面漏洞不得静默过闸）', () => {
  it('阳性：W-1..W-9 全绿挂载，快照就位', () => {
    const types = snapshot.workflows?.types ?? []
    expect(types.map((t) => t.id)).toEqual(['proposal'])
    expect(types[0]?.entity).toBe('userstory')
    expect(types[0]?.states.map((s) => `${s.name}${s.final === true ? '*' : ''}`)).toEqual([
      '待批',
      '已派发',
      '证据就绪',
      '复验通过',
      '已交付*',
      '新单',
    ])
    expect(types[0]?.anchors).toEqual(POSITIVE.anchors)
    expect(types[0]?.edges).toEqual([{ from: '待批', to: '新单' }])
  })

  it('探针①保留词（W-9）：id=bug / id=task 双拒 workflow-reserved-type-id', () => {
    for (const id of ['bug', 'task']) {
      const m = mountWith(workflowsYaml({ id }))
      expect(m.ok).toBe(false)
      expect(m.issues.some((i) => i.rule.endsWith('workflow-reserved-type-id'))).toBe(true)
    }
  })

  it('探针②重复态（W-2）：states 重复打回 workflow-dup-state', () => {
    const m = mountWith(workflowsYaml({ states: [...POSITIVE.states, ['待批']] }))
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-dup-state'))).toBe(true)
  })

  it('探针③锚不在册（W-3）：anchors.inbox 指向未声明态 workflow-anchor-not-in-states', () => {
    const m = mountWith(workflowsYaml({ anchors: { ...POSITIVE.anchors, inbox: '草稿' } }))
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-anchor-not-in-states'))).toBe(true)
  })

  it('探针④锚链断裂（W-8）：主干序打乱（已派发/证据就绪互换）workflow-anchor-chain', () => {
    const m = mountWith(
      workflowsYaml({
        states: [
          ['待批'],
          ['证据就绪'],
          ['已派发'],
          ['复验通过'],
          ['已交付', true],
          ['新单'],
        ],
      }),
    )
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-anchor-chain'))).toBe(true)
  })

  it('探针⑤终态锚（W-4）：delivered 非终态 workflow-delivered-not-final', () => {
    const m = mountWith(
      workflowsYaml({
        states: [
          ['待批'],
          ['已派发'],
          ['证据就绪'],
          ['复验通过'],
          ['已交付'],
          ['新单'],
        ],
      }),
    )
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-delivered-not-final'))).toBe(true)
  })

  it('探针⑥首态（W-3）：inbox 非 states 首态 workflow-inbox-not-first', () => {
    const m = mountWith(
      workflowsYaml({
        states: [
          ['新单'],
          ['待批'],
          ['已派发'],
          ['证据就绪'],
          ['复验通过'],
          ['已交付', true],
        ],
        edges: [],
        anchors: { ...POSITIVE.anchors, delivered: '已交付' },
      }),
    )
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-inbox-not-first'))).toBe(true)
  })

  it('探针⑦边端不在册（W-6）：edges 引用未声明态 workflow-edge-not-in-states', () => {
    const m = mountWith(workflowsYaml({ edges: [['待批', '无此态']] }))
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-edge-not-in-states'))).toBe(true)
  })

  it('探针⑧实体 slug（W-7）：entity 非 slug 语法 workflow-bad-entity', () => {
    const m = mountWith(workflowsYaml({ entity: 'User Story!' }))
    expect(m.ok).toBe(false)
    expect(m.issues.some((i) => i.rule.endsWith('workflow-bad-entity'))).toBe(true)
  })
})

// ————————————————————————— S2：建单直落待批 —————————————————————————

describe('S2 建单直落待批（130-§8 判负线：落新单/平台默认=判负）', () => {
  let platform: FlowPlatform

  beforeAll(() => {
    platform = createFakePlatform({ now: () => new Date(Date.parse('2026-10-22T00:00:00.000Z')).toISOString() })
  })

  it('deriveFieldProvision 折叠：typeInbox[proposal]=待批；userstory 实体桶六态；顶桶不掺', () => {
    const map = deriveFieldProvision(undefined, snapshot.workflows)
    expect(map.typeInbox).toEqual({ proposal: '待批' })
    expect(map.typeFlows?.proposal).toEqual({
      待批: ['已派发', '新单'],
      已派发: ['证据就绪'],
      证据就绪: ['复验通过'],
      复验通过: ['已交付'],
    })
    // D7 分桶：entity 类型（userstory）态入实体桶不落顶层——顶层保持缺省五态
    expect(map.entities?.userstory?.states).toEqual(['待批', '已派发', '证据就绪', '复验通过', '已交付', '新单'])
    expect(map.states).not.toContain('待批')
  })

  it('provision 物化后建 proposal 单（不带 initialState）直落待批——不落新单/平台默认', async () => {
    await platform.fields.provision(deriveFieldProvision(undefined, snapshot.workflows))
    const created = await platform.issues.create({
      title: '提案：词表 v2 扩展',
      type: 'proposal',
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    expect(created.state).toBe('待批')
    expect(created.state).not.toBe('新单')
  })
})

// ————————————————————————— S3：类型隔离不扰既有流 —————————————————————————

describe('S3 类型隔离（130-§8 判负线：既有等级流被扰动=判负）', () => {
  let platform: FlowPlatform

  beforeAll(() => {
    platform = createFakePlatform({ now: () => new Date(Date.parse('2026-10-22T00:00:00.000Z')).toISOString() })
  })

  it('流表解析（serve 同序合并：DEFAULT 铺底 + T 键覆盖顶）：保留词/未声明类型回退等级流', () => {
    const t = flowsFromWorkflows(snapshot.workflows)
    expect(t).toBeDefined()
    const merged: FlowTable = { ...DEFAULT_FLOW_TABLE, ...t }
    expect(resolveTicketFlow(merged, 'proposal', undefined)?.mainline).toEqual(['待批', '已派发', '证据就绪', '复验通过', '已交付', '新单'])
    // W-9 保留词恒查不到 T 键 → 等级回退（task 单 L0 物化语义保持）
    expect(resolveTicketFlow(merged, 'task', 0)?.mainline[0]).toBe('新单')
    expect(resolveTicketFlow(merged, 'bug', 1)?.mainline).toEqual(DEFAULT_FLOW_TABLE.L1?.mainline)
    // 未声明类型 + 无等级 → 无流（decide NOOP_UNKNOWN_FLOW 诚实不静默）
    expect(resolveTicketFlow(merged, 'feature', undefined)).toBeUndefined()
    expect(resolveTicketFlow(merged, undefined, 1)?.mainline).toEqual(DEFAULT_FLOW_TABLE.L1?.mainline)
  })

  it('既有等级流零扰动：L0/L1/L2 三键与缺省表逐字段一致；不产 T:task/T:bug 键', () => {
    const t = flowsFromWorkflows(snapshot.workflows)
    const merged: FlowTable = { ...DEFAULT_FLOW_TABLE, ...t }
    for (const key of ['L0', 'L1', 'L2'] as const) {
      expect(merged[key]).toEqual(DEFAULT_FLOW_TABLE[key])
    }
    expect(Object.keys(merged).filter((k) => k.startsWith('T:'))).toEqual(['T:proposal'])
  })

  it('provision 物化后：他型建单落缺省五态首态新单——不误入待批', async () => {
    await platform.fields.provision(deriveFieldProvision(undefined, snapshot.workflows))
    const task = await platform.issues.create({ title: '岗单', type: 'task', dept: snapshot.departments[0]?.path })
    expect(task.state).toBe('新单')
    const undeclared = await platform.issues.create({ title: '未声明类型', type: 'feature', dept: snapshot.departments[0]?.path })
    expect(undeclared.state).toBe('新单')
    const untyped = await platform.issues.create({ title: '未带类型', dept: snapshot.departments[0]?.path })
    expect(untyped.state).toBe('新单')
  })
})
