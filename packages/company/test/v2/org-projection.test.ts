/**
 * MIG-05 / IMPL-05-03 · org 纯投影（树面＋零 IO＋O3-01 三契约互斥复验）
 *
 * 依据：docs/v2/06 §五（5.1 拟任≠事实／5.2 CL 主张与 N／5.3 空编与保留权力）、
 *       docs/v2/03 §2.4（CL 判据是结构事实）§八（N 单元域重叠判负）、
 *       docs/v2/17 O3-01 行（「V2 已消解；随 MIG-05 复验」）、docs/plan/05 IMPL-05-03。
 *
 * 覆盖（本件）：
 *   - 零 IO 静态面：`src/projection/**` 只含相对 `.ts` import，无 node:/工作区包、无 fs/net/
 *     时钟/随机/控制台/动态 import；头注含只读兼容（MIG-08）与 O3-01 声明
 *   - 纯函数面：同输入同输出（声明顺序不敏感）、冻结输入可跑且输入零改写、输出 JSON 可序列化
 *   - 树面：父子/深度/前序、legacy 索引↔逐文件镜像、漂移/悬空/成环/重复声明 → 阻断
 *   - O3-01 三契约互斥：同对象 legacy+definition → 阻断且不出两权威节点；定义包独有 →
 *     definition 权威；不相交 → 各归其面；O3_01 复验记录常量
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildOrgTree,
  ISSUE_CODES,
  O3_01,
  ORG_PROJECTION_CONTRACT,
  projectOrganization,
} from '../../src/projection/index.ts'
import type {
  OrganizationProjectionInput,
  ParsedDepartment,
  ParsedDepartmentFile,
  ParsedPerson,
  ParsedUnit,
  ParsedVacancy,
} from '../../src/projection/index.ts'

const PROJECTION_DIR = fileURLToPath(new URL('../../src/projection/', import.meta.url))
const PROJECTION_FILES = readdirSync(PROJECTION_DIR).filter((entry) => entry.endsWith('.ts'))

// ───────────────────────── 夹具 ─────────────────────────

interface DeptSpec {
  path: string
  name?: string
  leader?: string | null
  parent?: string | null
  level?: number
}

function dept(spec: DeptSpec): ParsedDepartment {
  return {
    name: spec.name ?? spec.path.split('/').pop() ?? spec.path,
    path: spec.path,
    leader: spec.leader === undefined ? 'AGENT-1' : spec.leader,
    parent: spec.parent === undefined ? null : spec.parent,
    ...(spec.level !== undefined ? { level: spec.level } : {}),
  }
}

interface InputOptions {
  level?: number
  departments?: readonly ParsedDepartment[]
  people?: readonly ParsedPerson[]
  departmentFiles?: readonly ParsedDepartmentFile[]
  definitionDepartments?: readonly ParsedDepartment[]
  units?: readonly ParsedUnit[]
  vacancies?: readonly ParsedVacancy[]
}

function makeInput(options: InputOptions): OrganizationProjectionInput {
  return {
    org: {
      company: {
        name: '示例公司',
        slug: 'demo-corp',
        level: options.level ?? 3,
        charter_ref: 'charter.md',
      },
      ...(options.departments !== undefined ? { departments: options.departments } : {}),
      ...(options.people !== undefined ? { people: options.people } : {}),
      ...(options.units !== undefined ? { units: options.units } : {}),
      ...(options.vacancies !== undefined ? { vacancies: options.vacancies } : {}),
    },
    ...(options.departmentFiles !== undefined ? { departmentFiles: options.departmentFiles } : {}),
    ...(options.definitionDepartments !== undefined
      ? { definition: { departments: options.definitionDepartments } }
      : {}),
  }
}

const PEOPLE: readonly ParsedPerson[] = [
  { id: 'AGENT-1', name: '工程师甲', level: 2, status: 'active' },
  { id: 'AGENT-2', name: '工程师乙', level: 2, status: 'active' },
  { id: 'AGENT-3', name: '工程师丙', level: 3, status: 'active' },
]

function treeFixture(): OrganizationProjectionInput {
  return makeInput({
    departments: [
      dept({ path: 'departments/工程部', leader: 'AGENT-1' }),
      dept({ path: 'departments/工程部/departments/平台组', leader: 'AGENT-2', parent: 'departments/工程部' }),
      dept({ path: 'departments/综合部', leader: 'AGENT-3' }),
    ],
    people: PEOPLE,
  })
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

// ───────────────────────── 一、零 IO（静态面·机器可判） ─────────────────────────

describe('零 IO · src/projection 静态面', () => {
  it('只含相对 .ts import：无 node:/工作区包/裸包名（Node 原生 type-stripping 可直跑）', () => {
    expect(PROJECTION_FILES.length).toBeGreaterThanOrEqual(5)
    const specifiers: string[] = []
    for (const file of PROJECTION_FILES) {
      const text = readFileSync(`${PROJECTION_DIR}${file}`, 'utf8')
      for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (specifier !== undefined) specifiers.push(`${file} → ${specifier}`)
      }
      for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
        const specifier = match[1]
        if (specifier !== undefined) specifiers.push(`${file} → ${specifier}`)
      }
    }
    expect(specifiers.length).toBeGreaterThan(0)
    for (const entry of specifiers) {
      const specifier = entry.split(' → ')[1] ?? ''
      expect(specifier, entry).toMatch(/^\.\.?\//)
      expect(specifier, entry).toMatch(/\.ts$/)
      expect(specifier, entry).not.toContain('node:')
      expect(specifier, entry).not.toContain('@studio-next/')
    }
  })

  it('无文件/网络/时钟/随机/控制台/动态 import（零 IO 与可复算）', () => {
    const forbidden = [
      'process.',
      'fetch(',
      'XMLHttpRequest',
      'new Date(',
      'Date.now(',
      'Math.random(',
      'setTimeout(',
      'setInterval(',
      'console.',
      'require(',
      'import(',
    ]
    for (const file of PROJECTION_FILES) {
      const text = readFileSync(`${PROJECTION_DIR}${file}`, 'utf8')
      for (const token of forbidden) {
        expect(text.includes(token), `${file} 含禁止 token：${token}`).toBe(false)
      }
    }
  })

  it('头注声明 org-config/departments 只读兼容（至 MIG-08）与 O3-01 复验，出口契约可判', () => {
    const head = readFileSync(`${PROJECTION_DIR}index.ts`, 'utf8')
    expect(head).toContain('MIG-08')
    expect(head).toContain('只读')
    expect(head).toContain('O3-01')
    expect(head).toContain('零 IO')
    expect(ORG_PROJECTION_CONTRACT).toEqual({
      version: 'org-projection/v1',
      io: 'zero',
      authorityRule: 'one-object-one-authority',
      legacyCompatUntil: 'MIG-08',
    })
  })
})

// ───────────────────────── 二、纯函数（确定性/输入不可变） ─────────────────────────

describe('纯投影 · 同输入同输出且输入零改写', () => {
  it('两次调用深相等；冻结输入可跑（冻结对象被写会抛，未抛即零改写）', () => {
    const input = deepFreeze(treeFixture())
    const first = projectOrganization(input)
    const second = projectOrganization(input)
    expect(first).toEqual(second)
  })

  it('输入在调用前后逐字节不变（JSON 快照对比）', () => {
    const input = treeFixture()
    const before = JSON.stringify(input)
    projectOrganization(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('声明顺序不敏感（索引按 path 码点序输出——不依赖输入顺序）', () => {
    const forward = makeInput({
      departments: [
        dept({ path: 'departments/A', leader: 'AGENT-1' }),
        dept({ path: 'departments/B', leader: 'AGENT-2' }),
        dept({ path: 'departments/B/departments/C', leader: 'AGENT-3', parent: 'departments/B' }),
      ],
      people: PEOPLE,
    })
    const reversed = makeInput({
      departments: [
        dept({ path: 'departments/B/departments/C', leader: 'AGENT-3', parent: 'departments/B' }),
        dept({ path: 'departments/B', leader: 'AGENT-2' }),
        dept({ path: 'departments/A', leader: 'AGENT-1' }),
      ],
      people: PEOPLE,
    })
    expect(projectOrganization(reversed)).toEqual(projectOrganization(forward))
  })

  it('输出可 JSON 序列化（无函数/无递归引用；节点表扁平）', () => {
    const result = projectOrganization(treeFixture())
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})

// ───────────────────────── 三、树面 ─────────────────────────

describe('组织树 · parent 链是结构事实（level 字段不参与）', () => {
  it('根/深度/子表/前序：一棵两枝树 + 嵌套子部门', () => {
    const result = projectOrganization(treeFixture())
    expect(result.status).toBe('ok')
    expect(result.tree.roots).toEqual(['departments/工程部', 'departments/综合部'])
    expect(result.tree.preorder).toEqual([
      'departments/工程部',
      'departments/工程部/departments/平台组',
      'departments/综合部',
    ])
    expect(result.tree.maxDepth).toBe(1)
    const byPath = new Map(result.tree.nodes.map((node) => [node.path, node]))
    const root = byPath.get('departments/工程部')
    const child = byPath.get('departments/工程部/departments/平台组')
    expect(root?.depth).toBe(0)
    expect(root?.childPaths).toEqual(['departments/工程部/departments/平台组'])
    expect(child?.depth).toBe(1)
    expect(child?.parent).toBe('departments/工程部')
    expect(child?.leaderRef).toBe('AGENT-2')
    expect(child?.leaderResolved).toBe(true)
    expect(root?.authority).toBe('legacy-readonly')
    expect(root?.contract).toBe('legacy')
    expect(root?.declaredBy).toEqual(['legacy-index'])
  })

  it('legacy 索引↔逐文件镜像：同字段不阻断，节点记两个镜像声明面', () => {
    const index = dept({ path: 'departments/工程部', leader: 'AGENT-1' })
    const file: ParsedDepartmentFile = { ...index, reports_to: null, jobs: [] }
    const result = projectOrganization(makeInput({ departments: [index], departmentFiles: [file], people: PEOPLE }))
    expect(result.status).toBe('ok')
    expect(result.tree.nodes[0]?.declaredBy).toEqual(['legacy-index', 'legacy-file'])
  })

  it('legacy 镜像漂移（索引 leader≠逐文件 leader）→ 阻断，不静默择一', () => {
    const index = dept({ path: 'departments/工程部', leader: 'AGENT-1' })
    const file: ParsedDepartmentFile = { ...index, leader: 'AGENT-2' }
    const result = projectOrganization(makeInput({ departments: [index], departmentFiles: [file], people: PEOPLE }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.legacyFaceDrift)
    expect(result.issues.find((issue) => issue.code === ISSUE_CODES.legacyFaceDrift)?.detail).toContain('leader')
  })

  it('parent 悬空 → 阻断，节点不入树（不伪造根）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [dept({ path: 'departments/工程部', parent: 'departments/不存在' })],
        people: PEOPLE,
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.tree.nodes).toEqual([])
    expect(result.tree.roots).toEqual([])
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.danglingParent)
  })

  it('parent 成环 → 阻断且不递归展开（无根、无前序）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [
          dept({ path: 'departments/A', parent: 'departments/B' }),
          dept({ path: 'departments/B', parent: 'departments/A' }),
        ],
        people: PEOPLE,
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.tree.roots).toEqual([])
    expect(result.tree.preorder).toEqual([])
    expect(result.tree.maxDepth).toBe(0)
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.parentCycle)
  })

  it('同一来源重复声明（同 path 两条）→ 阻断（对象身份不唯一）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [
          dept({ path: 'departments/工程部', leader: 'AGENT-1' }),
          dept({ path: 'departments/工程部', leader: 'AGENT-2' }),
        ],
        people: PEOPLE,
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.duplicateDeclaration)
  })

  it('声明形状不完整（name 空）→ 阻断（不静默跳过冒充无事）', () => {
    const result = projectOrganization(
      makeInput({ departments: [dept({ path: 'departments/工程部', name: '' })], people: PEOPLE }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.declarationShape)
  })
})

// ───────────────────────── 四、O3-01 三契约互斥复验 ─────────────────────────

describe('O3-01 · 同一对象不出现两权威（三契约互斥复验）', () => {
  it('同 path 同时出现在 legacy 与 definition → 阻断，冲突对象不入树（无两权威节点）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [dept({ path: 'departments/工程部', leader: 'AGENT-1' })],
        people: PEOPLE,
        definitionDepartments: [dept({ path: 'departments/工程部', leader: null })],
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.authority.conflicts).toEqual(['departments/工程部'])
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.authorityConflict)
    expect(result.tree.nodes).toEqual([])
    // 同一对象不得在 legacyObjects 与 definitionObjects 各留一份
    expect(result.authority.legacyObjects).toEqual([])
    expect(result.authority.definitionObjects).toEqual([])
  })

  it('definition 独有对象 → definition 权威（不是 legacy 优先，也不是合并）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [dept({ path: 'departments/工程部', leader: 'AGENT-1' })],
        people: PEOPLE,
        definitionDepartments: [dept({ path: 'departments/定义部', leader: null })],
      }),
    )
    expect(result.status).toBe('ok')
    const definitionNode = result.tree.nodes.find((node) => node.path === 'departments/定义部')
    expect(definitionNode?.authority).toBe('definition')
    expect(definitionNode?.contract).toBe('definition')
    expect(definitionNode?.declaredBy).toEqual(['definition'])
    expect(result.authority.definitionObjects).toEqual(['departments/定义部'])
    expect(result.authority.legacyObjects).toEqual(['departments/工程部'])
    expect(result.authority.conflicts).toEqual([])
  })

  it('legacy 与 definition 不相交 → 各归其面，无冲突（迁移期并存的可判形态）', () => {
    const input = makeInput({
      departments: [
        dept({ path: 'departments/A', leader: 'AGENT-1' }),
        dept({ path: 'departments/B', leader: 'AGENT-2' }),
      ],
      people: PEOPLE,
      definitionDepartments: [dept({ path: 'departments/C', leader: null })],
    })
    const result = projectOrganization(input)
    expect(result.status).toBe('ok')
    expect(result.authority.legacyObjects).toEqual(['departments/A', 'departments/B'])
    expect(result.authority.definitionObjects).toEqual(['departments/C'])
    expect(result.tree.nodes.map((node) => node.authority)).toEqual(['legacy-readonly', 'legacy-readonly', 'definition'])
  })

  it('O3-01 复验记录可判（表名/规则/消解口径/冲突处置）', () => {
    const result = projectOrganization(treeFixture())
    expect(result.authority.table).toBe('O3-01')
    expect(result.authority.rule).toBe('one-object-one-authority')
    expect(result.authority.resolution).toBe('legacy-readonly-projection+definition-authority')
    expect(O3_01).toEqual({
      id: 'O3-01',
      rule: 'one-object-one-authority',
      resolution: 'legacy-readonly-projection+definition-authority',
      onConflict: 'reject',
    })
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['authority', 'tree', 'structure', 'issues', 'status']))
  })

  it('buildOrgTree 可独立消费（只树面，不依赖结构面）；authority 一并返回', () => {
    const built = buildOrgTree(treeFixture())
    expect(built.tree.roots).toEqual(['departments/工程部', 'departments/综合部'])
    expect(built.authority.table).toBe('O3-01')
    expect(built.issues.every((issue) => issue.area === 'authority' || issue.area === 'tree')).toBe(true)
  })
})
