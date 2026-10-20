/**
 * aiws —— .AIWS 员工工作区树正式化单测（DEV-28）
 *
 * 依据（docs/43-§五 冻结 spec v1.1 + §十9 根归属定案）：
 *   - 建树同构：`.AIWS/<部门路径>/<工号>/` 镜像 org-config；幂等（重复 ensure 零新建零归档）
 *   - per-company 根守卫（§十9 不并树）：归属标记异 slug → CONFIG_INVALID fail-closed；
 *     无标记既有树（DEV-27 mkdir-only 产物）收养补记
 *   - 增量同步（随人事热重载）：新员工 → 新文件夹；离司 → **归档不删**（内容保留）；
 *     复职 → 新空目录、归档仍在；部门下线 → 整树归档
 *   - 家保留（结构性）：员工目录内部 sync 永不下探——家内容原样（负断言）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import { ensureAiwsTree } from '../src/aiws.ts'

let root = ''

const T0 = Date.parse('2026-10-22T08:00:00.000Z')
/** 确定性归档时间戳（同毫秒撞名 → 序号退避面可期） */
const fixedNow = (ms = T0): (() => Date) => (): Date => new Date(ms)

/** 最小组织面：两部门（一嵌套）+ 两员工 */
const DEPTS = [{ path: 'departments/工程部' }, { path: 'departments/工程部/平台组' }]
const PEOPLE = [
  { id: 'AGENT-1', dept: 'departments/工程部' },
  { id: 'AGENT-2', dept: 'departments/工程部/平台组' },
]

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-aiws-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('建树同构 + 幂等（docs/43-§五）', () => {
  it('首建：部门路径逐级展开、工号挂自己部门下；无人部门也有文件夹', () => {
    const aiwsRoot = path.join(root, 'same-structure')
    const result = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    expect(result.personDirs).toEqual(['departments/工程部/AGENT-1', 'departments/工程部/平台组/AGENT-2'])
    expect(result.created).toBeGreaterThan(0)
    expect(result.archived).toEqual([])
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部'))).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'))).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', '平台组', 'AGENT-2'))).toBe(true)
    // 归属标记：daemon 自管面（slug+时间戳）
    const marker = JSON.parse(readFileSync(path.join(aiwsRoot, '.studio-next.json'), 'utf8')) as { slug: string }
    expect(marker.slug).toBe('acme')
  })

  it('无人部门也有文件夹（部门先建，人不占位）', () => {
    const aiwsRoot = path.join(root, 'empty-dept')
    ensureAiwsTree(aiwsRoot, [...DEPTS, { path: 'departments/行政部' }], [], { slug: 'acme', now: fixedNow() })
    expect(existsSync(path.join(aiwsRoot, 'departments', '行政部'))).toBe(true)
  })

  it('幂等：重复 ensure 零新建零归档，personDirs 稳定', () => {
    const aiwsRoot = path.join(root, 'idempotent')
    const first = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    const second = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    expect(second.created).toBe(0)
    expect(second.archived).toEqual([])
    expect(second.personDirs).toEqual(first.personDirs)
  })

  it('slug 缺省=旧调用面：不写不读归属标记（行为兼容）', () => {
    const aiwsRoot = path.join(root, 'no-slug')
    ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE)
    expect(existsSync(path.join(aiwsRoot, '.studio-next.json'))).toBe(false)
  })
})

describe('per-company 根守卫（docs/43-§十9 不并树）', () => {
  it('异 slug 拒收：CONFIG_INVALID fail-closed（两家公司共用一根=并树，结构性拒绝）', () => {
    const aiwsRoot = path.join(root, 'owned')
    ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    expect(() => ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'other-corp', now: fixedNow() })).toThrowError(
      expect.objectContaining<Partial<ClassifiedError>>({ category: 'CONFIG_INVALID', subcause: 'aiws/root-owned' }),
    )
    // 原家照常可用（同 slug 放行）
    expect(() => ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })).not.toThrow()
  })

  it('无标记既有树（DEV-27 mkdir-only 产物）→ 收养补标记，内容不扰', () => {
    const aiwsRoot = path.join(root, 'adopt')
    // 手种旧树（无标记）+ 员工家内容
    mkdirSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'), { recursive: true })
    const legacyFile = path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1', 'legacy-draft.md')
    writeFileSync(legacyFile, 'DEV-27 时代的员工草稿\n', 'utf8')
    const result = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    expect(result.archived).toEqual([]) // 收养≠归档：结构本就同构
    expect(existsSync(path.join(aiwsRoot, '.studio-next.json'))).toBe(true)
    expect(readFileSync(legacyFile, 'utf8')).toContain('DEV-27 时代的员工草稿')
  })

  it('标记损坏/缺 slug → fail-closed（无法判定归属即拒绝，不猜）', () => {
    const aiwsRoot = path.join(root, 'broken-marker')
    mkdirSync(aiwsRoot, { recursive: true })
    writeFileSync(path.join(aiwsRoot, '.studio-next.json'), 'not-json', 'utf8')
    expect(() => ensureAiwsTree(aiwsRoot, DEPTS, [], { slug: 'acme', now: fixedNow() })).toThrowError(
      expect.objectContaining<Partial<ClassifiedError>>({ subcause: 'aiws/owner-marker' }),
    )
  })
})

describe('增量同步（随人事热重载——docs/43-§五「人事变树变」）', () => {
  it('新员工 → 新文件夹；离司 → 归档不删（内容保留）；复职 → 新空目录、归档仍在', () => {
    const aiwsRoot = path.join(root, 'hr-sync')
    ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })

    // 扩编：AGENT-3 入职工程部 → 新文件夹
    const grown = ensureAiwsTree(
      aiwsRoot,
      DEPTS,
      [...PEOPLE, { id: 'AGENT-3', dept: 'departments/工程部' }],
      { slug: 'acme', now: fixedNow() },
    )
    expect(grown.created).toBe(1)
    expect(grown.archived).toEqual([])
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-3'))).toBe(true)

    // AGENT-3 家里写真实内容后离司 → 归档（改名不删），内容可读
    const draft = path.join(aiwsRoot, 'departments', '工程部', 'AGENT-3', 'tickets', 'T-9', 'att1', 'REPORT.md')
    mkdirSync(path.dirname(draft), { recursive: true })
    writeFileSync(draft, 'AGENT-3 的交付证据\n', 'utf8')
    const shrunk = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow(T0 + 1000) })
    expect(shrunk.created).toBe(0)
    expect(shrunk.archived).toEqual(['departments/工程部/AGENT-3'])
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-3'))).toBe(false)
    const archived = readdirSync(path.join(aiwsRoot, 'departments', '工程部')).find((n) => n.startsWith('AGENT-3.archived-'))
    expect(archived).toBeDefined()
    expect(readFileSync(path.join(aiwsRoot, 'departments', '工程部', archived ?? '', 'tickets', 'T-9', 'att1', 'REPORT.md'), 'utf8')).toContain('AGENT-3 的交付证据')

    // 复职：新空目录，归档仍在（工号史不篡改）
    const rehired = ensureAiwsTree(
      aiwsRoot,
      DEPTS,
      [...PEOPLE, { id: 'AGENT-3', dept: 'departments/工程部' }],
      { slug: 'acme', now: fixedNow(T0 + 2000) },
    )
    expect(rehired.created).toBe(1)
    expect(rehired.archived).toEqual([]) // 归档名不算活、不再二动
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-3'))).toBe(true)
    expect(readdirSync(path.join(aiwsRoot, 'departments', '工程部')).filter((n) => n.startsWith('AGENT-3.archived-'))).toHaveLength(1)
  })

  it('部门下线 → 整树归档（子树内容一次保留；嵌套活部门不受牵连）', () => {
    const aiwsRoot = path.join(root, 'dept-offline')
    const org = [{ path: 'departments/工程部' }, { path: 'departments/工程部/平台组' }, { path: 'departments/设计部' }]
    ensureAiwsTree(aiwsRoot, org, PEOPLE, { slug: 'acme', now: fixedNow() })
    const designDraft = path.join(aiwsRoot, 'departments', '设计部', 'draft.md')
    writeFileSync(designDraft, '设计部遗物\n', 'utf8')

    // 设计部下线（工程部/平台组及其员工全保留）
    const after = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow(T0 + 3000) })
    expect(after.archived).toEqual(['departments/设计部'])
    expect(existsSync(path.join(aiwsRoot, 'departments', '设计部'))).toBe(false)
    const archived = readdirSync(path.join(aiwsRoot, 'departments')).find((n) => n.startsWith('设计部.archived-'))
    expect(archived).toBeDefined()
    expect(readFileSync(path.join(aiwsRoot, 'departments', archived ?? '', 'draft.md'), 'utf8')).toContain('设计部遗物')
    // 活部门与员工不受牵连
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'))).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', '平台组', 'AGENT-2'))).toBe(true)
  })

  it('家内部不下探（结构性负断言）：在编员工家内的任意内容 sync 后原样', () => {
    const aiwsRoot = path.join(root, 'home-privacy')
    ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    // 家内手种「非组织面」目录与工位证据——结构上像「离司残留」，但人在编 → 永不动
    const stranger = path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1', '随便什么', 'notes.md')
    mkdirSync(path.dirname(stranger), { recursive: true })
    writeFileSync(stranger, '员工在自己文件夹里做任意事\n', 'utf8')
    const again = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow(T0 + 4000) })
    expect(again.archived).toEqual([])
    expect(readFileSync(stranger, 'utf8')).toContain('员工在自己文件夹里做任意事')
  })

  it('根级垃圾目录（非组织面）→ 归档（.AIWS 根是 daemon 管结构面）', () => {
    const aiwsRoot = path.join(root, 'root-junk')
    ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow() })
    mkdirSync(path.join(aiwsRoot, 'tmp-drop'), { recursive: true })
    writeFileSync(path.join(aiwsRoot, 'tmp-drop', 'x.txt'), 'x\n', 'utf8')
    const after = ensureAiwsTree(aiwsRoot, DEPTS, PEOPLE, { slug: 'acme', now: fixedNow(T0 + 5000) })
    expect(after.archived).toEqual(['tmp-drop'])
    expect(readdirSync(aiwsRoot).some((n) => n.startsWith('tmp-drop.archived-'))).toBe(true)
    // 归属标记文件不受影响
    expect(existsSync(path.join(aiwsRoot, '.studio-next.json'))).toBe(true)
  })

  it('同毫秒重复归档撞名 → 序号退避不覆盖', () => {
    const aiwsRoot = path.join(root, 'stamp-clash')
    const withDept = [{ path: 'departments/工程部' }]
    ensureAiwsTree(aiwsRoot, withDept, [{ id: 'AGENT-1', dept: 'departments/工程部' }], { slug: 'acme', now: fixedNow() })
    // 两轮离司/复职压在同一时间戳上
    ensureAiwsTree(aiwsRoot, withDept, [], { slug: 'acme', now: fixedNow(T0) })
    ensureAiwsTree(aiwsRoot, withDept, [{ id: 'AGENT-1', dept: 'departments/工程部' }], { slug: 'acme', now: fixedNow(T0) })
    const second = ensureAiwsTree(aiwsRoot, withDept, [], { slug: 'acme', now: fixedNow(T0) })
    expect(second.archived).toEqual(['departments/工程部/AGENT-1'])
    const names = readdirSync(path.join(aiwsRoot, 'departments', '工程部')).filter((n) => n.startsWith('AGENT-1.archived-'))
    expect(names).toHaveLength(2)
  })
})
