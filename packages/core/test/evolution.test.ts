/**
 * evolution 进化管线测试 —— 16-§四 v0.10 / 02-F3-01/02/03 / 20-§八.3/§九 / 08-§五 D8：
 * 状态机全迁移+非法拒 / 谱系链·环·断链 fail-closed / 幂等提案（键=资产×内容，终态放行换代）/
 * 三态闸门矩阵（证据组合×资产类型×blast_radius×策略——判据类恒 escalate）/ 判负面
 * （无匹配拒 / 匹配过 / retired 吊销匹配仍拒 / nearMisses 诊断）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import {
  applyGateDecision,
  assertChangeAuthorized,
  AUTHORIZING_STATUSES,
  blastRadiusRank,
  canTransitionStatus,
  candidatesById,
  CANDIDATE_STATUSES,
  CRITERION_ASSET_KIND,
  DEFAULT_GATE_POLICY,
  gate,
  legalNextStatuses,
  lineage,
  makerRuling,
  proposeCandidate,
  transitionCandidate,
  type BlastRadius,
  type CandidateRecord,
  type CandidateStatus,
  type ChangeRejectedError,
  type GateDecision,
  type GateEvidence,
  type GatePolicy,
  type ProposalInput,
} from '../src/evolution.ts'

/** 断言抛错并返回（category+subcause 双验；同 budget.test.ts 手法） */
function expectThrow(fn: () => unknown, category: string, subcause: string): Error & ClassifiedError {
  try {
    fn()
  } catch (err) {
    const e = err as Error & ClassifiedError
    expect(e.category).toBe(category)
    expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error(`应抛 ${category}/${subcause} 但未抛`)
}

// ---------------------------------------------------------------------------
// 夹具：候选记录构造（draft 起步，verification 依需注入）
// ---------------------------------------------------------------------------

let seq = 0
/** 提案入参（默认 prompt/isolated/初代；exactOptionalPropertyTypes 无可选字段，直接字面量） */
function prop(o: Partial<ProposalInput> & { id: string }): ProposalInput {
  seq += 1
  return {
    id: o.id,
    asset_type: o.asset_type ?? 'prompt',
    asset_path: o.asset_path ?? `prompts/main_${seq}.md`,
    version: o.version ?? '0.1.0',
    diff_hash: o.diff_hash ?? `hash_${seq}`,
    blast_radius: o.blast_radius ?? 'isolated',
    parent_id: o.parent_id !== undefined ? o.parent_id : null,
  }
}

/** 便捷：登记即推进到目标态（走合法机器链；gated 需 verification） */
function candidateAt(
  status: CandidateStatus,
  o: Partial<ProposalInput> & { id: string },
  verification: GateEvidence | null = null,
  existing: readonly CandidateRecord[] = [],
): CandidateRecord {
  let r = proposeCandidate(prop(o), existing).record
  if (status === 'draft') return r
  r = transitionCandidate(r, 'proposed')
  if (status === 'proposed') return r
  r = transitionCandidate(r, 'sandboxed')
  if (status === 'sandboxed') return r
  if (verification === null) throw new Error('测试夹具：进 gated 需 verification')
  r = { ...r, verification }
  r = transitionCandidate(r, 'gated')
  if (status === 'gated') return r
  const d: GateDecision = gate(r, verification)
  r = applyGateDecision(r, d)
  if (status === 'approved' || status === 'rejected' || status === 'escalated') {
    if (r.status !== status) {
      // 闸门自然结论不达目标态时用人裁/失败注入补齐（构造面，不掩盖被测语义）
      if (status === 'approved') r = r.status === 'escalated' ? makerRuling(r, 'approve') : r
      if (status === 'rejected') r = r.status === 'escalated' ? makerRuling(r, 'reject') : r
      if (r.status !== status) throw new Error(`夹具无法到 ${status}（闸门结论 ${r.status}）——改用直接注入`)
    }
    return r
  }
  if (status === 'promoted') return transitionCandidate(r, 'promoted')
  if (status === 'retired') return transitionCandidate(transitionCandidate(r, 'promoted'), 'retired')
  throw new Error(`夹具不支持目标态 ${status}`)
}

/** 直接注入记录（终态/环等非法形状构造面——被测对象是防御面） */
function injected(o: Partial<CandidateRecord> & { id: string }): CandidateRecord {
  return {
    id: o.id,
    asset_type: o.asset_type ?? 'prompt',
    asset_path: o.asset_path ?? `prompts/x_${o.id}.md`,
    version: o.version ?? '0.1.0',
    diff_hash: o.diff_hash ?? `hash_${o.id}`,
    blast_radius: o.blast_radius ?? 'isolated',
    verification: o.verification !== undefined ? o.verification : null,
    parent_id: o.parent_id !== undefined ? o.parent_id : null,
    status: o.status ?? 'draft',
  }
}

const GREEN: GateEvidence = { sandboxPass: true, blastRadiusOk: true }

// ---------------------------------------------------------------------------
// 1. 状态机：全迁移 + 非法拒
// ---------------------------------------------------------------------------

describe('状态机：legalNextStatuses 全表与迁移合法性', () => {
  it('全状态后继表（机器边 ∪ 闸门三态 ∪ 人裁边）——快照即冻结面', () => {
    const table = Object.fromEntries(
      CANDIDATE_STATUSES.map(s => [s, [...legalNextStatuses(s)]] as [string, CandidateStatus[]]),
    ) as Record<CandidateStatus, CandidateStatus[]>
    expect(table).toEqual({
      draft: ['proposed'],
      proposed: ['sandboxed'],
      sandboxed: ['gated'],
      gated: ['approved', 'rejected', 'escalated'],
      escalated: ['approved', 'rejected'],
      approved: ['promoted', 'retired'],
      promoted: ['retired'],
      rejected: [],
      retired: [],
    })
  })

  it('canTransitionStatus：合法/非法抽查（跳级拒、终态无出边）', () => {
    expect(canTransitionStatus('draft', 'proposed')).toBe(true)
    expect(canTransitionStatus('gated', 'approved')).toBe(true)
    expect(canTransitionStatus('escalated', 'rejected')).toBe(true)
    expect(canTransitionStatus('approved', 'retired')).toBe(true)
    expect(canTransitionStatus('draft', 'gated')).toBe(false) // 跳级
    expect(canTransitionStatus('gated', 'promoted')).toBe(false) // 旁路 approve
    expect(canTransitionStatus('rejected', 'proposed')).toBe(false) // 终态
    expect(canTransitionStatus('retired', 'promoted')).toBe(false) // 终态
    expect(canTransitionStatus('draft', 'draft')).toBe(false) // 自环
  })

  it('机器链全迁移：draft→proposed→sandboxed→gated（带 verification）→approved→promoted→retired', () => {
    let r = candidateAt('gated', { id: 'c1' }, GREEN)
    r = applyGateDecision(r, gate(r, GREEN)) // isolated+全绿 → approve
    expect(r.status).toBe('approved')
    r = transitionCandidate(r, 'promoted')
    expect(r.status).toBe('promoted')
    r = transitionCandidate(r, 'retired')
    expect(r.status).toBe('retired')
  })

  it('迁移不可变：原记录不动、谱系列（parent_id/version/diff_hash）原样——fork-only 无 rebase 面', () => {
    const child = proposeCandidate(prop({ id: 'child', parent_id: 'root' }), [injected({ id: 'root' })]).record
    const next = transitionCandidate(child, 'proposed')
    expect(next).not.toBe(child)
    expect(child.status).toBe('draft')
    expect(next.parent_id).toBe('root')
    expect(next.version).toBe(child.version)
    expect(next.diff_hash).toBe(child.diff_hash)
    expect(next.asset_path).toBe(child.asset_path)
  })

  it('非法机器迁移显式拒：EVOLVE_REJECT/evolve/illegal-transition（跳级/回退/自环抽查）', () => {
    const d = proposeCandidate(prop({ id: 'd' }), []).record
    expectThrow(() => transitionCandidate(d, 'sandboxed'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // draft 跳 sandboxed
    expectThrow(() => transitionCandidate(d, 'draft'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // 自环
    const p = transitionCandidate(d, 'proposed')
    expectThrow(() => transitionCandidate(p, 'gated'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // 跳沙箱
    const g = candidateAt('gated', { id: 'g1' }, GREEN)
    expectThrow(() => transitionCandidate(g, 'promoted'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // 绕 approve
    expectThrow(() => transitionCandidate(g, 'draft'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // 回退
    const rej = injected({ id: 'rej', status: 'rejected' })
    expectThrow(() => transitionCandidate(rej, 'proposed'), 'EVOLVE_REJECT', 'evolve/illegal-transition') // 终态复活
    const ret = injected({ id: 'ret', status: 'retired' })
    expectThrow(() => transitionCandidate(ret, 'promoted'), 'EVOLVE_REJECT', 'evolve/illegal-transition')
  })

  it('sandboxed→gated 守卫：无验证结果拒（F3-02 缺一不进闸门）；有则过', () => {
    let r = proposeCandidate(prop({ id: 'w1' }), []).record
    r = transitionCandidate(transitionCandidate(r, 'proposed'), 'sandboxed')
    expectThrow(() => transitionCandidate(r, 'gated'), 'EVOLVE_REJECT', 'evolve/verification-missing')
    const ok = transitionCandidate({ ...r, verification: GREEN }, 'gated')
    expect(ok.status).toBe('gated')
  })
})

describe('状态机：闸门三态边与人裁边单独收口（禁旁路）', () => {
  it('applyGateDecision：gated 态三 verdict 各到其位', () => {
    const g = candidateAt('gated', { id: 'a1' }, GREEN)
    expect(applyGateDecision(g, { decision: 'approve', reason: 'all-evidence-green', note: '' }).status).toBe('approved')
    expect(applyGateDecision(g, { decision: 'reject', reason: 'sandbox-failed', note: '' }).status).toBe('rejected')
    expect(applyGateDecision(g, { decision: 'escalate', reason: 'criterion-locked', note: '' }).status).toBe('escalated')
  })

  it('applyGateDecision 非 gated 态拒：EVOLVE_REJECT/evolve/not-gated', () => {
    const p = transitionCandidate(proposeCandidate(prop({ id: 'a2' }), []).record, 'proposed')
    expectThrow(() => applyGateDecision(p, { decision: 'approve', reason: 'all-evidence-green', note: '' }), 'EVOLVE_REJECT', 'evolve/not-gated')
  })

  it('makerRuling：escalated → approved / rejected（制作人亲批面，20-§八.3）', () => {
    const e = injected({ id: 'm1', status: 'escalated' })
    expect(makerRuling(e, 'approve').status).toBe('approved')
    expect(makerRuling(e, 'reject').status).toBe('rejected')
  })

  it('makerRuling 非 escalated 态拒：EVOLVE_REJECT/evolve/not-escalated', () => {
    const g = candidateAt('gated', { id: 'm2' }, GREEN)
    expectThrow(() => makerRuling(g, 'approve'), 'EVOLVE_REJECT', 'evolve/not-escalated')
  })

  it('approved→retired 弃案边（批后未晋升即放弃）', () => {
    const a = candidateAt('approved', { id: 'm3' }, GREEN)
    expect(transitionCandidate(a, 'retired').status).toBe('retired')
  })
})

// ---------------------------------------------------------------------------
// 2. 谱系：链 / 环 / 断链 / 挂接守卫
// ---------------------------------------------------------------------------

describe('lineage：全祖先链', () => {
  it('四代链反追 3 跳（F3-02「任一上线资产反追 ≥3 跳谱系」）——自含起点、新→旧', () => {
    const g1 = injected({ id: 'g1' })
    const g2 = injected({ id: 'g2', parent_id: 'g1' })
    const g3 = injected({ id: 'g3', parent_id: 'g2' })
    const g4 = injected({ id: 'g4', parent_id: 'g3' })
    const byId = candidatesById([g1, g2, g3, g4])
    expect(lineage(g4, byId).map(r => r.id)).toEqual(['g4', 'g3', 'g2', 'g1'])
    expect(lineage(g4, byId)).toHaveLength(4)
  })

  it('初代（parent_id=null）谱系=仅自身', () => {
    const root = injected({ id: 'solo' })
    expect(lineage(root, candidatesById([root])).map(r => r.id)).toEqual(['solo'])
  })

  it('断链拒：祖先不在索引 → CONFIG_INVALID/evolve/lineage-broken（不静默截断）', () => {
    const orphan = injected({ id: 'orphan', parent_id: 'ghost' })
    expectThrow(() => lineage(orphan, candidatesById([orphan])), 'CONFIG_INVALID', 'evolve/lineage-broken')
  })

  it('自引用环拒：parent_id 指向自身 → CONFIG_INVALID/evolve/lineage-cycle', () => {
    const selfRef = injected({ id: 'self' })
    selfRef.parent_id = 'self'
    expectThrow(() => lineage(selfRef, candidatesById([selfRef])), 'CONFIG_INVALID', 'evolve/lineage-cycle')
  })

  it('二环/三环拒：a→b→a / a→b→c→a', () => {
    const a = injected({ id: 'a', parent_id: 'b' })
    const b = injected({ id: 'b', parent_id: 'a' })
    expectThrow(() => lineage(a, candidatesById([a, b])), 'CONFIG_INVALID', 'evolve/lineage-cycle')
    const c1 = injected({ id: 'c1', parent_id: 'c2' })
    const c2 = injected({ id: 'c2', parent_id: 'c3' })
    const c3 = injected({ id: 'c3', parent_id: 'c1' })
    expectThrow(() => lineage(c1, candidatesById([c1, c2, c3])), 'CONFIG_INVALID', 'evolve/lineage-cycle')
  })
})

describe('proposeCandidate：谱系挂接守卫', () => {
  it('父不在现存集拒：CONFIG_INVALID/evolve/parent-unknown', () => {
    expectThrow(() => proposeCandidate(prop({ id: 'x', parent_id: 'ghost' }), []), 'CONFIG_INVALID', 'evolve/parent-unknown')
  })

  it('自引用拒：CONFIG_INVALID/evolve/self-parent', () => {
    expectThrow(() => proposeCandidate(prop({ id: 'x', parent_id: 'x' }), []), 'CONFIG_INVALID', 'evolve/self-parent')
  })

  it('挂接成环拒：CONFIG_INVALID/evolve/lineage-cycle（child 已在父链祖先中）', () => {
    const g1 = injected({ id: 'r1' })
    const g2 = injected({ id: 'r2', parent_id: 'r1' })
    // 新提案 id=r1 挂父 r2 → r2 的祖先含 r1 → 环
    expectThrow(
      () => proposeCandidate(prop({ id: 'r1', parent_id: 'r2', diff_hash: 'other' }), [g1, g2]),
      'CONFIG_INVALID', 'evolve/lineage-cycle',
    )
  })

  it('形状闸：空列/值域外 → CONFIG_INVALID/evolve/bad-proposal', () => {
    expectThrow(() => proposeCandidate(prop({ id: '' }), []), 'CONFIG_INVALID', 'evolve/bad-proposal')
    expectThrow(() => proposeCandidate(prop({ id: 'x', version: '' }), []), 'CONFIG_INVALID', 'evolve/bad-proposal')
    expectThrow(
      () => proposeCandidate({ ...prop({ id: 'x' }), asset_type: 'magic' as never }, []),
      'CONFIG_INVALID', 'evolve/bad-proposal',
    )
  })

  it('blastRadiusRank：序=风险递增；未知值拒', () => {
    expect(blastRadiusRank('isolated')).toBeLessThan(blastRadiusRank('company'))
    expect(blastRadiusRank('company')).toBeLessThan(blastRadiusRank('framework'))
    expectThrow(() => blastRadiusRank('galaxy' as BlastRadius), 'CONFIG_INVALID', 'evolve/bad-blast-radius')
  })
})

// ---------------------------------------------------------------------------
// 3. 幂等提案
// ---------------------------------------------------------------------------

describe('proposeCandidate：同 asset_path×diff_hash 幂等', () => {
  it('重复提案返回既有 id 不新建（在途态保持不变，输入 id 被忽略）', () => {
    const first = proposeCandidate(prop({ id: 'p1', asset_path: 'prompts/a.md', diff_hash: 'h1' }), [])
    expect(first.created).toBe(true)
    let advanced = transitionCandidate(first.record, 'proposed')
    const again = proposeCandidate(prop({ id: 'OTHER', asset_path: 'prompts/a.md', diff_hash: 'h1' }), [advanced])
    expect(again.created).toBe(false)
    expect(again.record.id).toBe('p1')
    expect(again.record.status).toBe('proposed')
  })

  it('键含资产：不同 asset_path 同 diff_hash → 各自成候选（不误并）', () => {
    const a = proposeCandidate(prop({ id: 'a', asset_path: 'p/a.md', diff_hash: 'same' }), [])
    const b = proposeCandidate(prop({ id: 'b', asset_path: 'p/b.md', diff_hash: 'same' }), [a.record])
    expect(b.created).toBe(true)
    expect(b.record.id).toBe('b')
  })

  it('键含内容：同 asset_path 不同 diff_hash → 新候选', () => {
    const a = proposeCandidate(prop({ id: 'a', asset_path: 'p/a.md', diff_hash: 'h1' }), [])
    const b = proposeCandidate(prop({ id: 'b', asset_path: 'p/a.md', diff_hash: 'h2' }), [a.record])
    expect(b.created).toBe(true)
  })

  it('终态命中放行新建：rejected 后同键再提=换代（谱系接续的入口）', () => {
    const rejected = injected({ id: 'old', asset_path: 'p/a.md', diff_hash: 'h1', status: 'rejected' })
    const next = proposeCandidate(prop({ id: 'new', asset_path: 'p/a.md', diff_hash: 'h1', parent_id: 'old' }), [rejected])
    expect(next.created).toBe(true)
    expect(next.record.id).toBe('new')
    expect(next.record.parent_id).toBe('old')
  })

  it('终态命中放行新建：retired（吊销/退役）后同键再提=新代（回滚原内容重提路径）', () => {
    const retired = injected({ id: 'v1', asset_path: 'p/a.md', diff_hash: 'h1', status: 'retired' })
    const next = proposeCandidate(prop({ id: 'v2', asset_path: 'p/a.md', diff_hash: 'h1' }), [retired])
    expect(next.created).toBe(true)
  })

  it('draft 创建即形状完备：verification=null、status=draft、谱系字段原样', () => {
    const root = injected({ id: 'root' })
    const r = proposeCandidate(prop({ id: 'kid', parent_id: 'root', blast_radius: 'company', asset_type: 'org_config' }), [root]).record
    expect(r.status).toBe('draft')
    expect(r.verification).toBeNull()
    expect(r.parent_id).toBe('root')
    expect(r.blast_radius).toBe('company')
    expect(r.asset_type).toBe('org_config')
  })
})

// ---------------------------------------------------------------------------
// 4. 三态闸门矩阵：证据组合 × 资产类型 × blast_radius × 策略
// ---------------------------------------------------------------------------

/** 闸门夹具：进到 gated 的候选（verification=evidence 落快照） */
function gatedCandidate(o: Partial<ProposalInput> & { id: string }, evidence: GateEvidence): CandidateRecord {
  return candidateAt('gated', o, evidence)
}

describe('gate：批准路径（approve 全条件枚举）', () => {
  it('全绿 + isolated + 非判据类 → approve/all-evidence-green（无 judges 亦批——沙箱为主证据）', () => {
    const c = gatedCandidate({ id: 'ok1' }, GREEN)
    const d = gate(c, GREEN)
    expect(d.decision).toBe('approve')
    expect(d.reason).toBe('all-evidence-green')
  })

  it('全绿 + judges 全 pass → 仍 approve（裁判是加强通道，非必要条件）', () => {
    const c = gatedCandidate({ id: 'ok2' }, GREEN)
    const d = gate(c, { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'claude', pass: true }, { judge: 'kimi', pass: true }] })
    expect(d.decision).toBe('approve')
  })

  it('策略放宽：autoApproveMaxBlast=company 时 company 级全绿 → approve（公司面可调档）', () => {
    const relaxed: GatePolicy = { autoApproveMaxBlast: 'company' }
    const c = gatedCandidate({ id: 'ok3', blast_radius: 'company' }, GREEN)
    expect(gate(c, GREEN, relaxed).decision).toBe('approve')
    expect(gate(c, GREEN, DEFAULT_GATE_POLICY).decision).toBe('escalate') // 默认档仍 escalate
  })
})

describe('gate：判据类资产恒 escalate（L4 锁死，非策略项）', () => {
  it('判据类全绿（isolated+沙箱绿+影响面绿+裁判全过）→ escalate/criterion-locked', () => {
    const c = gatedCandidate({ id: 'cr1', asset_type: CRITERION_ASSET_KIND, blast_radius: 'isolated' }, GREEN)
    const d = gate(c, GREEN)
    expect(d.decision).toBe('escalate')
    expect(d.reason).toBe('criterion-locked')
  })

  it('策略放宽到 framework 也锁：判据类不受 GatePolicy 影响（护栏外置——宪法面不可配置）', () => {
    const maxPolicy: GatePolicy = { autoApproveMaxBlast: 'framework' }
    const c = gatedCandidate({ id: 'cr2', asset_type: CRITERION_ASSET_KIND }, GREEN)
    expect(gate(c, GREEN, maxPolicy).reason).toBe('criterion-locked')
  })

  it('优先序①：判据类优先于沙箱红——宪法面任何触碰都到制作人（审计面）', () => {
    const c = gatedCandidate({ id: 'cr3', asset_type: CRITERION_ASSET_KIND }, { sandboxPass: true, blastRadiusOk: true })
    const d = gate(c, { sandboxPass: false, blastRadiusOk: true })
    expect(d.decision).toBe('escalate')
    expect(d.reason).toBe('criterion-locked')
  })
})

describe('gate：fail-closed 证据面', () => {
  it('沙箱红 → reject/sandbox-failed', () => {
    const c = gatedCandidate({ id: 'sb1' }, GREEN)
    const d = gate(c, { sandboxPass: false, blastRadiusOk: true })
    expect(d.decision).toBe('reject')
    expect(d.reason).toBe('sandbox-failed')
  })

  it('证据缺失与 false 同判：sandboxPass 缺（JS 调用方）→ reject（无审批人=无证据=不放行）', () => {
    const c = gatedCandidate({ id: 'sb2' }, GREEN)
    const d = gate(c, { blastRadiusOk: true } as GateEvidence)
    expect(d.decision).toBe('reject')
    expect(d.reason).toBe('sandbox-failed')
  })

  it('影响面红/缺 → escalate/blast-radius-breached（治理判断人裁）', () => {
    const c = gatedCandidate({ id: 'br1' }, GREEN)
    expect(gate(c, { sandboxPass: true, blastRadiusOk: false }).reason).toBe('blast-radius-breached')
    expect(gate(c, { sandboxPass: true, blastRadiusOk: false }).decision).toBe('escalate')
    expect(gate(c, { sandboxPass: true } as GateEvidence).reason).toBe('blast-radius-breached')
  })

  it('优先序：沙箱红优先于影响面红 → reject（技术面先判，确定性首命中）', () => {
    const c = gatedCandidate({ id: 'pri1' }, GREEN)
    expect(gate(c, { sandboxPass: false, blastRadiusOk: false }).reason).toBe('sandbox-failed')
  })

  it('judges 任一不过 → reject/judge-failed', () => {
    const c = gatedCandidate({ id: 'jd1' }, GREEN)
    const d = gate(c, { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'a', pass: true }, { judge: 'b', pass: false }] })
    expect(d.decision).toBe('reject')
    expect(d.reason).toBe('judge-failed')
  })

  it('形状不完备（空 version/验证快照缺）→ reject/incomplete-record（「缺一不进闸门」防御面）', () => {
    const broken = { ...gatedCandidate({ id: 'bad1' }, GREEN), version: '' }
    expect(gate(broken, GREEN).reason).toBe('incomplete-record')
    const noSnap = { ...gatedCandidate({ id: 'bad2' }, GREEN), verification: null }
    expect(gate(noSnap, GREEN).reason).toBe('incomplete-record')
  })
})

describe('gate：blast_radius×策略定档（F3-03 初期保守档）', () => {
  it('全绿 + company + 默认策略 → escalate/blast-radius-above-auto-approve', () => {
    const c = gatedCandidate({ id: 'bl1', blast_radius: 'company' }, GREEN)
    const d = gate(c, GREEN)
    expect(d.decision).toBe('escalate')
    expect(d.reason).toBe('blast-radius-above-auto-approve')
  })

  it('全绿 + framework + 放宽到 company 仍 → escalate（超上限恒人裁）', () => {
    const c = gatedCandidate({ id: 'bl2', blast_radius: 'framework' }, GREEN)
    expect(gate(c, GREEN, { autoApproveMaxBlast: 'company' }).reason).toBe('blast-radius-above-auto-approve')
  })

  it('同输入恒同决策（golden 可回放——两次调用深度相等）', () => {
    const c = gatedCandidate({ id: 'det1', blast_radius: 'company' }, GREEN)
    expect(gate(c, GREEN)).toEqual(gate(c, GREEN))
  })
})

// ---------------------------------------------------------------------------
// 5. 判负面：无 candidate id 的生产改动判负
// ---------------------------------------------------------------------------

describe('assertChangeAuthorized：判负与放行', () => {
  const CHANGE = { asset_path: 'prompts/main.md', diff_hash: 'h9' }

  it('无候选集 → 判负 CONFIG_INVALID/evolve/unauthorized（fail-closed：无授权即拒）', () => {
    const e = expectThrow(() => assertChangeAuthorized(CHANGE, []), 'CONFIG_INVALID', 'evolve/unauthorized') as ChangeRejectedError
    expect(e.nearMisses).toEqual([])
  })

  it('命中 approved → 放行并返回授权候选', () => {
    const approved = candidateAt('approved', { id: 'ap1', asset_path: 'prompts/main.md', diff_hash: 'h9' }, GREEN)
    const got = assertChangeAuthorized(CHANGE, [approved])
    expect(got.id).toBe('ap1')
  })

  it('命中 promoted → 放行（切权在产仍授权）', () => {
    const promoted = candidateAt('promoted', { id: 'pm1', asset_path: 'prompts/main.md', diff_hash: 'h9' }, GREEN)
    expect(assertChangeAuthorized(CHANGE, [promoted]).id).toBe('pm1')
  })

  it('路径同哈希异 → 判负 + nearMiss(hash-mismatch)', () => {
    const other = injected({ id: 'o1', asset_path: 'prompts/main.md', diff_hash: 'other' })
    const e = expectThrow(() => assertChangeAuthorized(CHANGE, [other]), 'CONFIG_INVALID', 'evolve/unauthorized') as ChangeRejectedError
    expect(e.nearMisses).toEqual([{ id: 'o1', asset_path: 'prompts/main.md', diff_hash: 'other', status: 'draft', reason: 'hash-mismatch' }])
  })

  it('路径哈希同但状态未授权（draft/proposed/sandboxed/gated/escalated/rejected）→ 判负 + nearMiss(status-not-authorizing)', () => {
    for (const status of ['draft', 'proposed', 'sandboxed', 'gated', 'escalated', 'rejected'] as const) {
      const c = injected({ id: `s-${status}`, asset_path: 'prompts/main.md', diff_hash: 'h9', status })
      const e = expectThrow(() => assertChangeAuthorized(CHANGE, [c]), 'CONFIG_INVALID', 'evolve/unauthorized') as ChangeRejectedError
      expect(e.nearMisses[0]?.reason).toBe('status-not-authorizing')
      expect(e.nearMisses[0]?.status).toBe(status)
    }
  })

  it('revoked 语义：retired 吊销匹配仍拒（授权态只有 approved|promoted——吊销即失效）', () => {
    const retired = candidateAt('retired', { id: 'rv1', asset_path: 'prompts/main.md', diff_hash: 'h9' }, GREEN)
    const e = expectThrow(() => assertChangeAuthorized(CHANGE, [retired]), 'CONFIG_INVALID', 'evolve/unauthorized') as ChangeRejectedError
    expect(e.nearMisses[0]?.status).toBe('retired')
    expect(e.nearMisses[0]?.reason).toBe('status-not-authorizing')
  })

  it('多候选并存：未授权在前、授权在后 → 放行取授权者（存在性语义，不猜）', () => {
    const noise = injected({ id: 'n1', asset_path: 'prompts/main.md', diff_hash: 'other' })
    const approved = candidateAt('approved', { id: 'ap2', asset_path: 'prompts/main.md', diff_hash: 'h9' }, GREEN)
    expect(assertChangeAuthorized(CHANGE, [noise, approved]).id).toBe('ap2')
  })

  it('他资产同哈希不算授权：纯 diff 匹配不跨资产放行', () => {
    const elsewhere = candidateAt('approved', { id: 'ew1', asset_path: 'prompts/other.md', diff_hash: 'h9' }, GREEN)
    expectThrow(() => assertChangeAuthorized(CHANGE, [elsewhere]), 'CONFIG_INVALID', 'evolve/unauthorized')
  })

  it('改动形状坏（空路径/空哈希）→ CONFIG_INVALID/evolve/change-malformed', () => {
    expectThrow(() => assertChangeAuthorized({ asset_path: '', diff_hash: 'h' }, []), 'CONFIG_INVALID', 'evolve/change-malformed')
    expectThrow(() => assertChangeAuthorized({ asset_path: 'a', diff_hash: '' }, []), 'CONFIG_INVALID', 'evolve/change-malformed')
  })

  it('AUTHORIZING_STATUSES 恰为 approved|promoted（判负面的授权口径冻结面）', () => {
    expect(AUTHORIZING_STATUSES).toEqual(['approved', 'promoted'])
  })
})

// ---------------------------------------------------------------------------
// 6. 端到端链路拼合：提案→谱系→闸门→人裁→晋升（16-§四「一次真实提案走完全链」的纯逻辑核）
// ---------------------------------------------------------------------------

describe('全链拼合：判据类提案经 escalate→制作人亲批→promoted 后授权生产改动', () => {
  it('criterion 恒 escalate，人裁放行，promoted 后同 diff 改动放行', () => {
    // 第一代判据类提案
    const p1 = proposeCandidate(prop({ id: 'gen1', asset_type: CRITERION_ASSET_KIND, asset_path: 'acceptance/gate.yaml', diff_hash: 'crit-h1', blast_radius: 'framework' }), [])
    let r = p1.record
    r = transitionCandidate(transitionCandidate(r, 'proposed'), 'sandboxed')
    const evidence: GateEvidence = { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'verifier', pass: true }] }
    r = transitionCandidate({ ...r, verification: evidence }, 'gated')
    // 闸门：判据类即使全绿也 escalate（制作人触点）
    let d = gate(r, evidence)
    expect(d.decision).toBe('escalate')
    r = applyGateDecision(r, d)
    expect(r.status).toBe('escalated')
    // 制作人亲批放行 → promoted
    r = transitionCandidate(makerRuling(r, 'approve'), 'promoted')
    // 判负面：同资产同哈希的生产改动此时放行（谱系可反追）
    const authorized = assertChangeAuthorized({ asset_path: 'acceptance/gate.yaml', diff_hash: 'crit-h1' }, [r])
    expect(authorized.id).toBe('gen1')
    expect(lineage(r, candidatesById([r])).map(x => x.id)).toEqual(['gen1'])
  })

  it('换代重提接谱系：被拒初代 fork 子代走全链（好变体出自平庸祖先——08 共性 7）', () => {
    const g1 = injected({ id: 'old1', asset_path: 'prompts/sum.md', diff_hash: 'h-old', status: 'rejected' })
    const p = proposeCandidate(prop({ id: 'new1', asset_path: 'prompts/sum.md', diff_hash: 'h-new', parent_id: 'old1' }), [g1])
    expect(p.created).toBe(true)
    const chain = lineage(p.record, candidatesById([g1, p.record]))
    expect(chain.map(x => x.id)).toEqual(['new1', 'old1'])
    // 全链到 approved 后，新 diff 放行、旧 diff 仍无授权
    let r = p.record
    r = transitionCandidate(transitionCandidate(r, 'proposed'), 'sandboxed')
    r = transitionCandidate({ ...r, verification: GREEN }, 'gated')
    r = applyGateDecision(r, gate(r, GREEN))
    expect(r.status).toBe('approved')
    expect(assertChangeAuthorized({ asset_path: 'prompts/sum.md', diff_hash: 'h-new' }, [g1, r]).id).toBe('new1')
    expectThrow(() => assertChangeAuthorized({ asset_path: 'prompts/sum.md', diff_hash: 'h-old' }, [g1, r]), 'CONFIG_INVALID', 'evolve/unauthorized')
  })
})
