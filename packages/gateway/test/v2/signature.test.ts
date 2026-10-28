/**
 * signature.test.ts —— ctl- 动作词族＋署名审计断言（SEC-SIG-03 / SEC-SIG-01；plan/05 IMPL-07-10）
 *
 * 依据：
 *   - v2/15 §二 SEC-SIG-03（ctl- 词族入网关校验；申报/实文一致性沿 `gw-action-mismatch`；
 *     审计面 transition 不得显示为 comment；迁移期 `op` 借道允许但须记降级标记）；
 *   - v2/15 §二 SEC-SIG-01（署名必须回到真实决定人；「daemon 做的/工具做的/公司做的」不是
 *     可结算的署名）＋ v2/15 §一 SEC-FC-06（常量 daemon 不得作为最终署名）；
 *   - v2/14 §二-2（六动词值与借道禁令）；v2/09 ENU-119（值集唯一主表）；v2/17 §4.1
 *     NEG-SEC-05/N-e（ctl 申报不一致被拒、transition 不得显示为 comment）与
 *     NEG-SEC-06/N-f（署名不可还原决定人判负）。
 *
 * 断言口径（负向行按「放行路径必须不存在」）：
 *   - 六动词逐一 positive：申报＝实文 → allowed 且审计动作＝ctl- 自身（不是 comment）；
 *   - N-e：ctl 申报与实文/args.op 自述任一处分叉 → 恰为 gw-action-mismatch，无放行分支；
 *   - N-f：署名不可还原决定人＝判负（failures 非空，不得折成 0）；常量 daemon 即使解析器
 *     能给记录洗白也不放行（SEC-FC-06）。
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction, PersonId, SignedBody } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '../../src/gateway.ts'
import type { Gateway, GateWriteResult } from '../../src/gateway.ts'
import {
  GATEWAY_ACTION_WORDS,
  GATEWAY_CTL_ACTIONS,
  parseAction,
  resolveAuditAction,
} from '../../src/actions.ts'
import type { GatewayActionWord } from '../../src/actions.ts'
import { auditDecisionMaker, auditSignatureLedger } from '../../src/signature.ts'
import type { SignatureActorRef, SignatureContext } from '../../src/signature.ts'

const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
const CTX: SignatureContext = { company: '测试公司', dept: '平台部', role: 'daemon', level: 2 }
const T0 = 1_700_000_000_000

/** contract 冻结六动词（worker 面；本单不改 contract，扩表走批示流） */
const WORKER_VERBS = ['comment', 'heartbeat', 'article', 'kb-search', 'evidence-write', 'budget-query'] as const

/** 闸实例（控制面单号绑定；author 可注入以演出 N-f 场景） */
function makeGateway(author: PersonId = 'P-001'): Gateway {
  return createGateway({ secret: SECRET, clock: () => T0, ticket: CONTROL_TICKET, ctx: CTX, author })
}

/** 按 scope 现签一张短命 key（一调用一签发：nonce 单次有效） */
function keyFor(gw: Gateway, scope: readonly GatewayActionWord[]): string {
  return gw.issue({ ticket: CONTROL_TICKET, scope: [...scope], ttl: '10m', nonce: randomUUID() })
}

/** 断言放行并窄化结果（失败即抛出，不走「放行路径存在」的默认） */
function expectAllowed(result: GateWriteResult): Extract<GateWriteResult, { allowed: true }> {
  if (!result.allowed) throw new Error(`期望放行，实际被拒：${result.reason}`)
  return result
}

function expectMismatch(result: GateWriteResult): void {
  expect(result).toEqual({ allowed: false, reason: 'gw-action-mismatch' })
}

// ---------------------------------------------------------------------------
// 一、ctl- 词族（SEC-SIG-03）：值集、解析、过闸
// ---------------------------------------------------------------------------

describe('ctl- 动作词族入网关校验（SEC-SIG-03 / ENU-119）', () => {
  it('值集恰六个且与 worker 面六动词并集（contract 冻结表不被本单改动）', () => {
    expect([...GATEWAY_CTL_ACTIONS]).toEqual([
      'ctl-create',
      'ctl-transition',
      'ctl-set-field',
      'ctl-link',
      'ctl-provision',
      'ctl-guards',
    ])
    expect(new Set(GATEWAY_CTL_ACTIONS).size).toBe(6)
    // contract 冻结六动词字面仍为 worker 面（扩表走批示流，本单只在 gateway 侧合成词表）
    expect([...GATEWAY_ACTIONS]).toEqual([...WORKER_VERBS])
    expect([...GATEWAY_ACTION_WORDS]).toEqual([...WORKER_VERBS, ...GATEWAY_CTL_ACTIONS])
    // 两面不重叠：ctl- 前缀是控制面平台写的唯一入口，worker 面动词不得混入
    for (const verb of GATEWAY_CTL_ACTIONS) expect(WORKER_VERBS).not.toContain(verb)
  })

  it('六动词逐一可解析（行首 @action + JSON 对象；非 comment 别名）', () => {
    for (const verb of GATEWAY_CTL_ACTIONS) {
      expect(parseAction(`@action ${verb} {"issue":"T-1"}`)).toEqual({ ok: true, action: verb, args: { issue: 'T-1' } })
    }
    // 裸 transition 仍表外（ctl- 是唯一合法拼写，不猜、不兼容别名）
    expect(parseAction('@action transition {"to":"Done"}')).toEqual({ ok: false, reason: 'unknown-verb' })
  })

  it('六动词逐一双向过闸：申报＝实文 → allowed，审计动作＝ctl- 自身（不是 comment）', () => {
    const gw = makeGateway()
    for (const verb of GATEWAY_CTL_ACTIONS) {
      const payload = `@action ${verb} {"issue":"T-1","to":"Done"}`
      const result = expectAllowed(gw.gateWriteCtl(keyFor(gw, [verb]), verb, payload))
      expect(result.action).toBe(verb)
      expect(result.action).not.toBe('comment')
      // 署名注入不改写正文（gateway 既有纪律）；author 为工号（可回指）
      expect(result.signed).toMatchObject({ author: 'P-001', body: payload, signature: '[测试公司·平台部·daemon·2]' })
      // 直报 ctl- 不是借道：不得出现降级标记
      expect('audit' in result).toBe(false)
    }
  })

  it('transition 不得显示为 comment：直报审计动作＝ctl-transition；comment 借道带降级标记', () => {
    const gw = makeGateway()
    const direct = expectAllowed(
      gw.gateWriteCtl(keyFor(gw, ['ctl-transition']), 'ctl-transition', '@action ctl-transition {"issue":"T-1","to":"Done"}'),
    )
    expect(direct.action).toBe('ctl-transition')

    // 迁移期 op 借道：实文字面仍是 comment（wkey 申报域），但审计面还原为 ctl-transition 且降级
    const borrowed = expectAllowed(
      gw.gateWrite(keyFor(gw, ['comment']), 'comment', '@action comment {"op":"issues.transition","issue":"T-1","to":"Done"}'),
    )
    expect(borrowed.action).toBe('comment')
    expect(borrowed.audit).toEqual({
      action: 'ctl-transition',
      downgraded: true,
      selfDeclaredOp: 'issues.transition',
      mismatch: false,
    })
    expect(borrowed.audit?.action).not.toBe('comment')

    // 审计解析与闸内判定同源：ctl- 直报不降级；自由评论不冒充 transition
    expect(resolveAuditAction('ctl-transition', { issue: 'T-1' })).toEqual({
      action: 'ctl-transition',
      downgraded: false,
      mismatch: false,
    })
    expect(resolveAuditAction('comment', { body: '说明' })).toEqual({ action: 'comment', downgraded: false, mismatch: false })
  })
})

// ---------------------------------------------------------------------------
// 二、NEG-SEC-05 / N-e：ctl 申报不一致被拒（gw-action-mismatch 机制沿用）
// ---------------------------------------------------------------------------

describe('NEG-SEC-05/N-e：申报与实文不一致必须拒（无放行分支）', () => {
  it('申报 ctl-transition、实文 comment（以借道字面冒充 transition）→ gw-action-mismatch', () => {
    const gw = makeGateway()
    expectMismatch(
      gw.gateWriteCtl(keyFor(gw, ['ctl-transition']), 'ctl-transition', '@action comment {"op":"issues.transition","issue":"T-1"}'),
    )
  })

  it('申报 comment、实文 ctl-transition（借道口反向冒充）→ gw-action-mismatch', () => {
    const gw = makeGateway()
    expectMismatch(gw.gateWrite(keyFor(gw, ['comment']), 'comment', '@action ctl-transition {"issue":"T-1"}'))
  })

  it('ctl 族内部错配（申报 ctl-transition、实文 ctl-set-field）→ gw-action-mismatch', () => {
    const gw = makeGateway()
    expectMismatch(
      gw.gateWriteCtl(keyFor(gw, ['ctl-transition']), 'ctl-transition', '@action ctl-set-field {"issue":"T-1","field":"x"}'),
    )
  })

  it('args.op 自述与申报动词分叉 → gw-action-mismatch（不猜以哪边为准）', () => {
    const gw = makeGateway()
    // ctl- 申报声称别的控制面操作
    expectMismatch(
      gw.gateWriteCtl(keyFor(gw, ['ctl-transition']), 'ctl-transition', '@action ctl-transition {"op":"issues.create"}'),
    )
    // worker 面动词夹带控制面 op：借道只允许 comment 一处，其余一律拒
    expectMismatch(gw.gateWrite(keyFor(gw, ['article']), 'article', '@action article {"op":"issues.transition"}'))
  })

  it('入口动词域互斥（运行期硬化）：worker 口不得夹带 ctl-，控制面口不得夹带 worker 动词', () => {
    const gw = makeGateway()
    const workerToken = keyFor(gw, ['comment'])
    const ctlToken = keyFor(gw, ['ctl-create'])
    // 擦除后无类型：这两条用显式跨界断言运行期硬化（不依赖类型门）
    expectMismatch(gw.gateWrite(workerToken, 'ctl-create' as unknown as GatewayAction, '@action ctl-create {}'))
    expectMismatch(gw.gateWriteCtl(ctlToken, 'comment' as unknown as (typeof GATEWAY_CTL_ACTIONS)[number], '@action comment {}'))
  })

  it('scope 是动作词的独立闸：ctl 动词不在 key scope 内 → gw-verify-scope（不被 mismatch 掩盖）', () => {
    const gw = makeGateway()
    expect(gw.gateWriteCtl(keyFor(gw, ['comment']), 'ctl-create', '@action ctl-create {}')).toEqual({
      allowed: false,
      reason: 'gw-verify-scope',
    })
  })
})

// ---------------------------------------------------------------------------
// 三、NEG-SEC-06 / N-f：署名不可还原决定人判负（SEC-SIG-01 / SEC-FC-06）
// ---------------------------------------------------------------------------

/** 决定人回指解析器夹具（任职/决定记录引用；缺一条即为回指断裂） */
const ACTORS: Readonly<Record<PersonId, SignatureActorRef>> = {
  'P-001': { actorKind: 'person', recordRef: 'REC-LIFE-01/person-p001' },
  'CTL-ROOT': { actorKind: 'control', recordRef: 'REC-DEC-01/decision-1' },
}

function resolveActor(author: PersonId): SignatureActorRef | undefined {
  return ACTORS[author]
}

describe('NEG-SEC-06/N-f：署名不可还原决定人＝判负', () => {
  it('正向：工号署名可回指任职记录 → 判过（审计动作与署名同时成立）', () => {
    const gw = makeGateway('P-001')
    const signed = expectAllowed(
      gw.gateWriteCtl(keyFor(gw, ['ctl-transition']), 'ctl-transition', '@action ctl-transition {"issue":"T-1","to":"Done"}'),
    ).signed
    expect(auditDecisionMaker(signed, resolveActor)).toEqual({
      ok: true,
      author: 'P-001',
      actor: { actorKind: 'person', recordRef: 'REC-LIFE-01/person-p001' },
    })
  })

  it('常量 daemon 署名：即使解析器能给记录也不得洗白 → gw-sig-placeholder-author（SEC-FC-06）', () => {
    const gw = makeGateway('daemon')
    // 现状写路径不在此处拒（构造期收口归 daemon 侧 IMPL-06-04）；本件是审计断言腿：判负即不得算绿
    const signed = expectAllowed(gw.gateWrite(keyFor(gw, ['comment']), 'comment', '@action comment {"body":"代写"}')).signed
    expect(signed.author).toBe('daemon')
    const laundered = (author: PersonId): SignatureActorRef | undefined =>
      author === 'daemon' ? { actorKind: 'person', recordRef: 'REC-LIFE-01/laundered' } : resolveActor(author)
    expect(auditDecisionMaker(signed, laundered)).toEqual({
      ok: false,
      author: 'daemon',
      reason: 'gw-sig-placeholder-author',
    })
  })

  it('回指断裂：工号存在但解析不到任职/决定记录 → gw-sig-unresolvable-decision-maker', () => {
    const gw = makeGateway('P-404')
    const signed = expectAllowed(gw.gateWrite(keyFor(gw, ['comment']), 'comment', '@action comment {"body":"x"}')).signed
    expect(auditDecisionMaker(signed, resolveActor)).toEqual({
      ok: false,
      author: 'P-404',
      reason: 'gw-sig-unresolvable-decision-maker',
    })
  })

  it('空主体/空记录引用：同样判负（不造默认值、不折成通过）', () => {
    const emptyAuthor: SignedBody = { author: '', body: 'x', signature: '[测试公司·平台部·daemon·2]' }
    expect(auditDecisionMaker(emptyAuthor, resolveActor)).toEqual({ ok: false, author: '', reason: 'gw-sig-empty-author' })
    const blankRef: SignedBody = { author: 'P-001', body: 'x', signature: '[测试公司·平台部·daemon·2]' }
    expect(auditDecisionMaker(blankRef, () => ({ actorKind: 'person', recordRef: '   ' }))).toEqual({
      ok: false,
      author: 'P-001',
      reason: 'gw-sig-unresolvable-decision-maker',
    })
  })

  it('台账审计：可还原行全过时 failures＝0；出现不可还原行即判负（failures 非空）', () => {
    const gw = makeGateway()
    const daemonGw = makeGateway('daemon')
    const rows: SignedBody[] = [
      expectAllowed(gw.gateWriteCtl(keyFor(gw, ['ctl-create']), 'ctl-create', '@action ctl-create {"issue":"T-1"}')).signed,
      expectAllowed(gw.gateWriteCtl(keyFor(gw, ['ctl-link']), 'ctl-link', '@action ctl-link {"a":"T-1","b":"T-2"}')).signed,
    ]
    // 全可还原：审计断言「台账中署名不可还原决定人的记录＝0」成立
    expect(auditSignatureLedger(rows, resolveActor)).toEqual({ audited: 2, failures: [] })

    // 掺入一条 daemon 常量署名：判负必须显性，不得折成 0（N-f 判据）
    const daemonRow = expectAllowed(daemonGw.gateWrite(keyFor(daemonGw, ['comment']), 'comment', '@action comment {"body":"代写"}')).signed
    const report = auditSignatureLedger([...rows, daemonRow], resolveActor)
    expect(report.audited).toBe(3)
    expect(report.failures).toEqual([{ index: 2, author: 'daemon', reason: 'gw-sig-placeholder-author' }])
    expect(report.failures.length).toBeGreaterThan(0)
  })
})
