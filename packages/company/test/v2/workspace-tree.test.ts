/**
 * workspace-tree —— 常驻角色工作目录树（studio-dev-723 / 计划 725；docs/90-§八）
 *
 * 断言：汇报链嵌套/组员在组长下；幂等（二次 created=0 且不覆盖 agent.md/memory.md）；
 * 离司归档不删（内容保留）；根归属异 slug fail-closed；路径逃逸拒；docs/work 结构。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkspaceTree, WORKSPACES_DIR } from '../../src/workspace-tree.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-tree-'))
  dirs.push(dir)
  return path.join(dir, WORKSPACES_DIR)
}

const DEPTS = [
  { path: 'departments/综合部', leader: 'PRIME-0' },
  { path: 'departments/研发部', leader: 'ENG-0' },
]
const PEOPLE = [
  { id: 'PRIME-0', dept: 'departments/综合部', name: '最高宰相', role: '老板' },
  { id: 'HF-1', dept: 'departments/综合部', reportsTo: 'PRIME-0', name: '综合组长' },
  { id: 'ENG-0', dept: 'departments/研发部', name: '研发组长' },
  { id: 'ENG-1', dept: 'departments/研发部', reportsTo: 'ENG-0', name: '程序工程师' },
  { id: 'QA-1', dept: 'departments/研发部', reportsTo: 'ENG-0', name: '质量工程师' },
]
const NOW = (): Date => new Date('2026-11-05T00:00:00.000Z')

describe('ensureWorkspaceTree', () => {
  it('建树：空→按汇报链嵌套（组员是组长子目录），agent.md/memory.md/docs/work 齐', () => {
    const root = tempRoot()
    const result = ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'demo', now: NOW })
    expect(result.created).toBeGreaterThan(0)
    expect(result.personDirs).toEqual([
      'departments/综合部/PRIME-0',
      'departments/综合部/PRIME-0/HF-1',
      'departments/研发部/ENG-0',
      'departments/研发部/ENG-0/ENG-1',
      'departments/研发部/ENG-0/QA-1',
    ])
    for (const rel of result.personDirs) {
      const abs = path.join(root, ...rel.split('/'))
      expect(existsSync(path.join(abs, 'agent.md'))).toBe(true)
      expect(existsSync(path.join(abs, 'memory.md'))).toBe(true)
      expect(existsSync(path.join(abs, 'docs'))).toBe(true)
      expect(existsSync(path.join(abs, 'work'))).toBe(true)
    }
    expect(readFileSync(path.join(root, 'departments/研发部/ENG-0/ENG-1/agent.md'), 'utf8')).toContain('汇报：ENG-0')
    const marker = JSON.parse(readFileSync(path.join(root, '.studio-next.json'), 'utf8')) as { slug: string; kind: string }
    expect(marker).toMatchObject({ slug: 'demo', kind: 'workspaces' })
  })

  it('幂等：二次调用 created=0，agent.md/memory.md 不覆盖（家内容保留）', () => {
    const root = tempRoot()
    ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'demo', now: NOW })
    const agent = path.join(root, 'departments/研发部/ENG-0/ENG-1/agent.md')
    writeFileSync(agent, '自定义 agent 内容\n', 'utf8')
    const second = ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'demo', now: NOW })
    expect(second.created).toBe(0)
    expect(second.archived).toEqual([])
    expect(readFileSync(agent, 'utf8')).toBe('自定义 agent 内容\n')
  })

  it('离司/下线：目录整树改名归档不删（内容原样）', () => {
    const root = tempRoot()
    ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'demo', now: NOW })
    const removedDir = path.join(root, 'departments/研发部/ENG-0/QA-1')
    writeFileSync(path.join(removedDir, 'memory.md'), '重要记忆\n', 'utf8')
    const next = PEOPLE.filter((person) => person.id !== 'QA-1')
    const result = ensureWorkspaceTree(root, DEPTS, next, { slug: 'demo', now: NOW })
    expect(result.personDirs).toHaveLength(4)
    expect(result.archived).toContain('departments/研发部/ENG-0/QA-1')
    const archivedAbs = path.join(root, 'departments/研发部/ENG-0/QA-1.archived-1793836800000')
    expect(existsSync(archivedAbs)).toBe(true)
    expect(readFileSync(path.join(archivedAbs, 'memory.md'), 'utf8')).toBe('重要记忆\n')
    expect(existsSync(removedDir)).toBe(false)
  })

  it('根归属异 slug fail-closed；路径逃逸拒（工号 ../../x）', () => {
    const root = tempRoot()
    ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'demo', now: NOW })
    expect(() => ensureWorkspaceTree(root, DEPTS, PEOPLE, { slug: 'other', now: NOW })).toThrow(/占用/)
    expect(() => ensureWorkspaceTree(root, DEPTS, [{ id: '../../x', dept: 'departments/研发部' }], { slug: 'demo', now: NOW })).toThrow(/非法路径段/)
    expect(() => ensureWorkspaceTree(root, [{ path: 'departments/../x', leader: 'A' }], [], { slug: 'demo', now: NOW })).toThrow(/非法路径段/)
  })
})
