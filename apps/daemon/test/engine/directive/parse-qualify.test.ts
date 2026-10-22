/**
 * parse-qualify —— 批示归一层单元面（studio-dev-171，docs/18-§2.5 / 130-§6.1.2）：
 *   - 词表 v1 四动词解析/畸形五族（全角冒号/越界/粘字/多行/空理由）；
 *   - 资格校验三拒因（unknown-actor/not-whitelisted/dispatch-law）+制作人豁免；
 *   - 事件索引站立（APPROVE verb 置位 / DISPATCH 清零 / ESCALATE 不站立）与消费键。
 * 引擎面（S4/S5）见同目录 directive.e2e.test.ts；声明面（S1/S2/S3）见 flows.test.ts。
 */
import { describe, expect, it } from 'vitest'
import type { EventRecord, PersonRef } from '@studio-next/contract'
import { buildDirectiveAuthorizer, parseDirectiveComment, type DirectivePerson } from '../../../src/engine/directive/index.ts'
import { buildEventIndex } from '../../../src/engine/sentinel/events-index.ts'

const DEPT = 'departments/工程部'

function person(id: string, login: string, level: number, dept = DEPT): PersonRef {
  return { id, name: id, login, level, dept }
}

/** 名册（departments/工程部）：deps.directives 注入面消费——与 snapshot.people 独立 */
const ROSTER: readonly PersonRef[] = [
  person('ENG-1', 'eng-1', 1), // 被派单 worker（缺省 assignee）
  person('ENG-0', 'eng-0', 3), // 工程部部长（departments 表 leader 位）
  person('ENG-2', 'eng-2', 3), // 与部长同级（dispatch-law 负面：3≤3 非严格高）
  person('PLN-9', 'pln-9', 1), // 非白名单（伪造批示面）
  person('PRIME-0', 'prime-0', 5), // 组织锚白名单（extraWhitelist 按工号）
  person('BIG-9', 'big-9', 9), // 与制作人同级（制作人豁免面：9≤9）
  person('producer', 'boss', 9), // 制作人（§2.3 任意介入不受限——含派单律豁免）
]

const DIRECTIVE_DEPS = {
  departments: new Map([[DEPT, 'ENG-0']]),
  extraWhitelist: ['PRIME-0'],
  producer: 'producer',
}

// ————————————————————————— 单元面：词表 v1 解析 —————————————————————————

describe('parseDirectiveComment（词表 v1 四动词；行式=行首「批示:」半角冒号）', () => {
  it('四动词全解析：批准/拆单/搁置容留尾注，打回理由必填', () => {
    expect(parseDirectiveComment('批示:批准')).toEqual({ kind: 'directive', verb: '批准', text: '' })
    expect(parseDirectiveComment('批示:批准 收尾后交付')).toEqual({ kind: 'directive', verb: '批准', text: '收尾后交付' })
    expect(parseDirectiveComment('批示:打回 范围太大，先做词表')).toEqual({ kind: 'directive', verb: '打回', text: '范围太大，先做词表' })
    expect(parseDirectiveComment('批示:拆单')).toEqual({ kind: 'directive', verb: '拆单', text: '' })
    expect(parseDirectiveComment('批示:搁置')).toEqual({ kind: 'directive', verb: '搁置', text: '' })
  })

  it('无批示行=自由言论（不消费不落事件）；署名行/正文行不算批示', () => {
    expect(parseDirectiveComment('进度正常，方案对齐中')).toEqual({ kind: 'none' })
    expect(parseDirectiveComment('[公司·部门·岗位·1]\n正文提及批准但行首无词头')).toEqual({ kind: 'none' })
    expect(parseDirectiveComment('收到，我看下\n[署名]')).toEqual({ kind: 'none' })
  })

  it('畸形族（fail-closed 可观测）：全角冒号/越界动词/粘字/多行/打回空理由', () => {
    expect(parseDirectiveComment('批示：批准')).toEqual({ kind: 'malformed', why: 'fullwidth-colon' })
    expect(parseDirectiveComment('批示:通过')).toEqual({ kind: 'malformed', why: 'unknown-verb' })
    expect(parseDirectiveComment('批示:批准了')).toEqual({ kind: 'malformed', why: 'verb-glued' })
    expect(parseDirectiveComment('批示:批准\n再看一眼\n批示:搁置')).toEqual({ kind: 'malformed', why: 'multiple-lines' })
    expect(parseDirectiveComment('批示:打回')).toEqual({ kind: 'malformed', why: 'reject-no-reason' })
    expect(parseDirectiveComment('批示:打回 ')).toEqual({ kind: 'malformed', why: 'reject-no-reason' })
  })

  it('行首空白不算批示行头（防引用拼接误触发）；\\r\\n 行尾容错', () => {
    expect(parseDirectiveComment(' 批示:批准')).toEqual({ kind: 'none' })
    expect(parseDirectiveComment('> 批示:批准')).toEqual({ kind: 'none' })
    expect(parseDirectiveComment('批示:批准\r\n')).toEqual({ kind: 'directive', verb: '批准', text: '' })
  })
})

// ————————————————————————— 单元面：角色校验（fail-closed） —————————————————————————

describe('buildDirectiveAuthorizer（白名单=dept leader∪extraWhitelist∪producer；派单律=严格高）', () => {
  const roster: readonly DirectivePerson[] = ROSTER.map((p) => ({ id: p.id, login: p.login, level: p.level }))
  const auth = buildDirectiveAuthorizer(DIRECTIVE_DEPS, () => roster, 'ENG-1')
  const issue = { dept: DEPT, level: 1, assignee: 'ENG-1' }

  it('未知 actor=拒（宁拒不错派）——账号与工号两形态都可解析', () => {
    expect(auth.qualify('ghost', issue, '批准')).toEqual({ ok: false, why: 'unknown-actor' })
    expect(auth.resolveActor('eng-0')?.id).toBe('ENG-0')
    expect(auth.resolveActor('ENG-0')?.id).toBe('ENG-0')
    expect(auth.resolveActor('ghost')).toBeUndefined()
  })

  it('白名单第一源=departments 表 leader（按工号）；非白名单署名=拒（伪造防御面）', () => {
    expect(auth.qualify('eng-0', issue, '批准')).toEqual({ ok: true, person: roster[1], exempt: false })
    expect(auth.qualify('PLN-9', issue, '批准')).toEqual({ ok: false, why: 'not-whitelisted', person: roster[3] })
    // 名册在册但 deps.departments 未认（如换 leader 后旧号）——同样拒：部门表是唯一源
    expect(auth.qualify('ENG-2', { dept: 'departments/无此部', level: 1 }, '批准')).toEqual({
      ok: false,
      why: 'not-whitelisted',
      person: roster[2],
    })
  })

  it('组织锚白名单按工号或账号命中（PRIME-0 两形态）', () => {
    expect(auth.qualify('PRIME-0', issue, '批准').ok).toBe(true)
    expect(auth.qualify('prime-0', issue, '批准').ok).toBe(true)
  })

  it('制作人豁免（§2.3 任意介入不受限——含派单律）', () => {
    // assignee=BIG-9（level 9）：非豁免者 9≤9 违派单律；制作人两形态（账号/工号）豁免
    const bigIssue = { dept: DEPT, level: 9, assignee: 'BIG-9' }
    expect(auth.qualify('producer', bigIssue, '批准')).toEqual({ ok: true, person: roster[6], exempt: true })
    expect(auth.qualify('boss', bigIssue, '批准')).toEqual({ ok: true, person: roster[6], exempt: true })
  })

  it('派单律：批示人 level 须严格高于被派单人（仅动词「批准」）', () => {
    const sameLevel = { dept: DEPT, level: 3, assignee: 'ENG-2' }
    expect(auth.qualify('eng-0', sameLevel, '批准')).toEqual({ ok: false, why: 'dispatch-law', person: roster[1] })
    expect(auth.qualify('eng-0', issue, '批准').ok).toBe(true) // 3 > 1
    // 非批准动词不吃派单律（打回/搁置/拆单不派工）
    expect(auth.qualify('eng-0', sameLevel, '打回').ok).toBe(true)
    expect(auth.qualify('eng-0', sameLevel, '搁置').ok).toBe(true)
  })

  it('被派单人不可解析=拒（assignee 与缺省链都断）——宁拒不错派；缺省链可达=按缺省比级', () => {
    // 名册只留 eng-0/pln-9：assignee=NOBODY 且 defaultAssignee 不可解析 → 目标断链=拒
    const noDefault = buildDirectiveAuthorizer(DIRECTIVE_DEPS, () => [roster[1], roster[3]], 'MISSING-DEFAULT')
    expect(noDefault.qualify('eng-0', { dept: DEPT, level: 1, assignee: 'NOBODY' }, '批准')).toEqual({
      ok: false,
      why: 'dispatch-law',
      person: roster[1],
    })
    // 名册全空 + defaultAssignee 未给：同断链面
    expect(noDefault.qualify('eng-0', { dept: DEPT, level: 1 }, '批准')).toEqual({
      ok: false,
      why: 'dispatch-law',
      person: roster[1],
    })
    // assignee 未知回退 defaultAssignee（与引擎 resolvePerson 同源链）：3 > 1 放行
    expect(auth.qualify('eng-0', { dept: DEPT, level: 1, assignee: 'NOBODY' }, '批准').ok).toBe(true)
  })

  it('资格拒三拒因齐备且优先序=未知 actor → 白名单 → 派单律', () => {
    // 未知 actor 优先于白名单（ghost 连白名单判定都不进）
    expect(auth.qualify('ghost', { dept: 'departments/无此部' }, '批准')).toEqual({ ok: false, why: 'unknown-actor' })
    // 白名单优先于派单律（PLN-9 若在白名单外，先判 not-whitelisted 而非 dispatch-law）
    expect(auth.qualify('PLN-9', { dept: DEPT, level: 1, assignee: 'NOBODY' }, '批准')?.why === 'not-whitelisted').toBe(true)
  })
})

// ————————————————————————— 单元面：事件索引（站立/消费键派生） —————————————————————————

describe('buildEventIndex 批示派生（APPROVE verb 置位 / DISPATCH 清零 / ESCALATE 不站立）', () => {
  let n = 0
  const ev = (event: string, note?: string): EventRecord => {
    n += 1
    return {
      id: `01JTEST${String(n).padStart(10, '0')}`,
      ts: n,
      company: 'demo-corp',
      issue: 'T-1',
      event,
      actor: 'daemon',
      attempt: 1,
      level: 1,
      dept: DEPT,
      ...(note !== undefined ? { note } : {}),
    } as EventRecord
  }

  it('DIRECTIVE APPROVE 置站立；DISPATCH 消费清零；ESCALATE 面=消费键不站立', () => {
    const idx = buildEventIndex([
      ev('APPROVE', 'DIRECTIVE;verb=批准;actor=eng-0;directive=c-1'),
      ev('ESCALATE', 'DIRECTIVE_REJECTED;why=not-whitelisted;verb=批准;actor=pln-9;directive=c-2'),
    ])
    expect(idx.directiveStandingOf('T-1')).toBe('批准')
    expect([...idx.directiveKeys].sort()).toEqual(['c-1', 'c-2'])

    const after = buildEventIndex([
      ev('APPROVE', 'DIRECTIVE;verb=批准;actor=eng-0;directive=c-1'),
      ev('DISPATCH', undefined),
      ev('ESCALATE', 'DIRECTIVE_MALFORMED;why=fullwidth-colon;actor=x;directive=c-3'),
    ])
    expect(after.directiveStandingOf('T-1')).toBeNull() // 批准被派发消费
    expect([...after.directiveKeys].sort()).toEqual(['c-1', 'c-3'])
  })

  it('非 DIRECTIVE 前缀的 APPROVE/ESCALATE 不进食（既有事件面零污染）', () => {
    const idx = buildEventIndex([ev('APPROVE', 'autoApprove demo'), ev('ESCALATE', 'UNKNOWN_STATE;state=X')])
    expect(idx.directiveStandingOf('T-1')).toBeNull()
    expect(idx.directiveKeys.size).toBe(0)
  })
})
