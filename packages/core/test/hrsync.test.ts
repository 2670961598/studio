/**
 * peopleDiff 分类器测试（DEV-48，docs/52-§5.1/§5.4/§11）：七类变动分类 / 复合拆条 /
 * ledgerStatus 判别基（入 vs 复）/ 无字段变=零事件（正文噪音不进人事流）/ op_key 幂等键 /
 * platformsFor 平台映射单一源 / renderPeopleDiff 摘要形。
 * 纯函数纪律：全分支行为断言，零 IO。
 */
import { describe, expect, it } from 'vitest'
import type { CompanySnapshot, CompanySnapshot as Snap } from '@studio-next/contract'
import {
  HR_EVENT_KINDS,
  diffPeople,
  hrOpKey,
  platformsFor,
  renderChange,
  renderPeopleDiff,
  type PeopleChange,
} from '../src/hrsync.ts'

/** 最小快照工厂（people 逐字段全控；departments/jobs 等无关面给最小合法形） */
function snap(people: Snap['people']): Snap {
  return {
    slug: 'demo',
    name: 'Demo Co',
    level: 2,
    departments: [{ path: '研发部', company: 'demo', leader: 'P-0', functions: [], lanes: [], parent: '' }],
    people,
    jobs: [],
    workflows: [],
  } as unknown as Snap
}

const P0 = { id: 'P-0', name: '张三', login: 'zhang', level: 2, dept: '研发部' }
const P1 = { id: 'P-1', name: '李四', login: 'li', level: 1, dept: '研发部' }

describe('diffPeople：七类变动分类（§5.1 表）', () => {
  it('新 id 且台账无行=入（field=*，next=level/dept 汇总）', () => {
    const d = diffPeople(snap([]), snap([{ ...P1 }]))
    expect(d.changes).toEqual([{ personId: 'P-1', kind: '入', field: '*', prev: null, next: 'level 1；dept 研发部' }])
    expect(d.unchanged).toBe(0)
    expect(d.before).toBe(0)
    expect(d.after).toBe(1)
  })

  it('新 id 且台账 status=retired/paused=复（台账镜像=第三方事实源）', () => {
    const idx = new Map([['P-1', 'retired']])
    const d = diffPeople(snap([]), snap([{ ...P1 }]), idx)
    expect(d.changes).toEqual([{ personId: 'P-1', kind: '复', field: '*', prev: 'retired', next: 'active' }])
    // 无台账注入=退化 prev 快照判别 → 入（单测语境）
    expect(diffPeople(snap([]), snap([{ ...P1 }])).changes[0]?.kind).toBe('入')
  })

  it('id 消失=退（prev=level/dept 汇总，next=null）', () => {
    const d = diffPeople(snap([P0, P1]), snap([P0]))
    expect(d.changes).toEqual([{ personId: 'P-1', kind: '退', field: '*', prev: 'level 1；dept 研发部', next: null }])
  })

  it('level 升=升 / 降=降（数值比较）', () => {
    const up = diffPeople(snap([P1]), snap([{ ...P1, level: 3 }])).changes
    expect(up).toEqual([{ personId: 'P-1', kind: '升', field: 'level', prev: '1', next: '3' }])
    const down = diffPeople(snap([{ ...P1, level: 3 }]), snap([P1])).changes
    expect(down[0]?.kind).toBe('降')
  })

  it('dept 变=调；name/login/role 描述类=调', () => {
    const dept = diffPeople(snap([P1]), snap([{ ...P1, dept: '交付部' }])).changes
    expect(dept).toEqual([{ personId: 'P-1', kind: '调', field: 'dept', prev: '研发部', next: '交付部' }])
    const name = diffPeople(snap([P1]), snap([{ ...P1, name: '李四四' }])).changes
    expect(name[0]).toEqual({ personId: 'P-1', kind: '调', field: 'name', prev: '李四', next: '李四四' })
    const role = diffPeople(snap([P1]), snap([{ ...P1, role: 'engineer' }])).changes
    expect(role[0]?.field).toBe('role')
  })

  it('status active↔paused=停/复；→retired=退；未知态迁移如实归调（不猜专名）', () => {
    const stop = diffPeople(snap([P1]), snap([{ ...P1, status: 'paused' }])).changes
    expect(stop).toEqual([{ personId: 'P-1', kind: '停', field: 'status', prev: 'active', next: 'paused' }])
    const resume = diffPeople(snap([{ ...P1, status: 'paused' }]), snap([P1])).changes
    expect(resume[0]?.kind).toBe('复')
    const retire = diffPeople(snap([P1]), snap([{ ...P1, status: 'retired' }])).changes
    expect(retire[0]?.kind).toBe('退')
    const odd = diffPeople(snap([{ ...P1, status: 'paused' }]), snap([{ ...P1, status: 'onleave' }])).changes
    expect(odd[0]).toEqual({ personId: 'P-1', kind: '调', field: 'status', prev: 'paused', next: 'onleave' })
  })

  it('同人无字段变=零事件（正文变更只 RELOAD 不进人事流——§13 风险3）', () => {
    const d = diffPeople(snap([P0, P1]), snap([P0, P1]))
    expect(d.changes).toEqual([])
    expect(d.unchanged).toBe(2)
  })

  it('复合变动拆条（一人数维同变；序=status→level→dept→name 稳定）', () => {
    const d = diffPeople(snap([P1]), snap([{ id: 'P-1', name: '李四四', login: 'li', level: 2, dept: '交付部', status: 'paused' }]))
    expect(d.changes.map((c) => [c.kind, c.field])).toEqual([
      ['停', 'status'],
      ['升', 'level'],
      ['调', 'dept'],
      ['调', 'name'],
    ])
  })
})

describe('hrOpKey / platformsFor（§11/§六§七映射单一源）', () => {
  it('op_key=person|kind|platform|field|prev|next；同变动重放同键', () => {
    const c: PeopleChange = { personId: 'P-1', kind: '升', field: 'level', prev: '1', next: '3' }
    expect(hrOpKey(c, 'taiga')).toBe('P-1|升|taiga|level|1|3')
    expect(hrOpKey(c, 'taiga')).toBe(hrOpKey({ ...c }, 'taiga'))
    expect(hrOpKey(c, 'matrix')).not.toBe(hrOpKey(c, 'taiga'))
  })

  it('入/退→三面；升/降→taiga+matrix；调(dept)→matrix；调(描述维)→空；停/复→matrix+ledger', () => {
    const mk = (kind: PeopleChange['kind'], field = 'level'): PeopleChange => ({ personId: 'P-1', kind, field, prev: null, next: null })
    expect(platformsFor(mk('入', '*'))).toEqual(['taiga', 'matrix', 'ledger'])
    expect(platformsFor(mk('退', '*'))).toEqual(['taiga', 'matrix', 'ledger'])
    expect(platformsFor(mk('升'))).toEqual(['taiga', 'matrix'])
    expect(platformsFor(mk('降'))).toEqual(['taiga', 'matrix'])
    expect(platformsFor(mk('调', 'dept'))).toEqual(['matrix'])
    expect(platformsFor(mk('调', 'name'))).toEqual([])
    expect(platformsFor(mk('停', 'status'))).toEqual(['matrix', 'ledger'])
    expect(platformsFor(mk('复', 'status'))).toEqual(['matrix', 'ledger'])
  })
})

describe('渲染面（renderChange/renderPeopleDiff——note/摘要消费形）', () => {
  it('入/退汇总形 vs 字段维形', () => {
    expect(renderChange({ personId: 'P-1', kind: '入', field: '*', prev: null, next: 'level 1；dept 研发部' })).toBe('P-1 入（∅→level 1；dept 研发部）')
    expect(renderChange({ personId: 'P-1', kind: '升', field: 'level', prev: '1', next: '3' })).toBe('P-1.level 1→3（升）')
  })

  it('摘要=七值序计数拼接；零变动=无人事变动', () => {
    const d = diffPeople(
      snap([P0, P1]),
      snap([{ ...P0, status: 'retired' }, { ...P1, level: 2 }, { id: 'P-2', name: '王五', login: 'wang', level: 1, dept: '研发部' }]),
    )
    // 七值序（入调升降停复退）过滤计数：入1；升1；退1
    expect(renderPeopleDiff(d)).toBe('入1；升1；退1')
    expect(renderPeopleDiff({ changes: [], unchanged: 0, before: 0, after: 0 })).toBe('无人事变动')
  })
})

describe('值域冻结源', () => {
  it('HR_EVENT_KINDS 七值有序（docs/17-§3）', () => {
    expect(HR_EVENT_KINDS).toEqual(['入', '调', '升', '降', '停', '复', '退'])
  })
})
