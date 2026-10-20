/**
 * evolution-e2e —— 进化链端到端：一个真实改进提案走完「谱系 + 三态闸门 + 判负」全链（16-§四 v0.10）
 *
 * 依据（实现单引用）：
 *   - docs/16-§四 v0.10 验收件「一次真实提案走完全链」+ 验收口径「无 candidate id 的生产改动判负」。
 *   - docs/17-§3「进化」行：观测→提案→候选制品（谱系）→沙箱→三态闸门→灰度→切权→复盘——
 *     本套证明到「判负」为止，链上每跳都以**台账读面回查**（不只 core 返回值——台账视角的链路证明）。
 *   - docs/20-§九（变更与进化全链）：一切改进走候选制品管线；判据类=宪法内核改=制作人亲批。
 *   - docs/02 F3-01（统一入口禁旁路/无 candidate id 判负）、F3-02（四元组+谱系缺一不进闸门、
 *     反追谱系）、F3-03（三态闸门 fail-closed，escalate=制作人触点）。
 *
 * daemon 模式接力（沿 store v5-candidates.test.ts「迁移接力」先例，本套的形态基线是
 * test/e2e.test.ts demo 全链）：**决策在 core 纯函数，落库在 store 读写面**——
 *   - 提案：core proposeCandidate（形状/幂等/谱系三闸）→ store insertCandidate（同闸镜像）；
 *   - 迁移：core transitionCandidate（机器边表 + verification 守卫）→ store transitionCandidate
 *     （乐观锁 WHERE status=期望当前值）；
 *   - 闸门/人裁：core gate / applyGateDecision / makerRuling → store 乐观锁落库；
 *   - 判负：core assertChangeAuthorized 消费 **store.candidatesByStatus(授权态集)**——
 *     active 集从台账取，判负即台账视角。
 *
 * 本刀证明范围与后续刀清单（诚实边界，头注冻结）：
 *   - 沙箱真执行器（sandboxRun 的真跑面）、灰度（shadow 并行记账+决策字段级 diff，F3-04）、
 *     切权（supervisor 重启加载，17-§2）、复盘（POSTMORTEM）——归后续刀；本套以证据快照
 *     注入模拟沙箱产物（假想，非真跑）。
 *   - verification 快照写面【已清偿——切 store 正式面】：沙箱完成点落列改走
 *     ledger.updateVerification（v5 增补写面：sandboxed 窗口闸 + serializeVerification
 *     与 insert 同源——packages/store/src/ledger.ts），写后立即经 store 读面回查再进闸门：
 *     闸门证据确实流经台账，不是内存直通。本套早前版本以裸 SQL 模拟该写点的历史已终结。
 *   - 判负面挂主循环/网关写径（生产改动的拦截点接线）——归后续刀；本套在测试内调判定核。
 *     serve 启动自检（观察模式：框架资产清单跑 authorize，unauthorized 落 ESCALATE 不阻断
 *     启动）已另单接线（src/evolve/evolve-guard.ts + test/evolve/evolve-guard.test.ts）；阻断模式+
 *     资产面扩展归真单刀。
 *   - 观测产物（metrics 快照）为假想语料：证明链路形状，不证明观测器本身（观测器归后续刀）。
 *
 * 环境与纪律：os.tmpdir() 真文件库（沿 store 测试风格，不用 :memory:）；四场景各一独立库
 * （语料隔离）；候选 id 确定性生成（ULID 形状计数段——e2e.test.ts deterministicIds 同款；
 * core 头注「候选 id 生成归调用方（daemon 持 ULID）」的测试替身）；只动本测试文件
 * （core/store 只 import）；strict / 零新依赖 / 只写可擦除 TS。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AUTHORIZING_STATUSES,
  applyGateDecision,
  assertChangeAuthorized,
  decisionToStatus,
  gate,
  makerRuling,
  proposeCandidate as corePropose,
  transitionCandidate as coreTransition,
} from '@studio-next/core'
import type {
  AssetKind,
  BlastRadius,
  CandidateRecord,
  CandidateStatus,
  ChangeRejectedError,
  GateDecision,
  GateEvidence,
  NearMiss,
  ProposedChange,
} from '@studio-next/core'
import { CANDIDATE_STATUS_VALUES, openLedger } from '@studio-next/store'
import type { CandidateRow, Ledger } from '@studio-next/store'

// ————————————————————————— 测试基建 —————————————————————————

const T0 = Date.parse('2026-10-16T00:00:00.000Z')
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')

let root = ''
let idSeq = 0
let clockMs = T0

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-evolution-e2e-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 确定性 ULID 形状候选 id（'0' 时间段 + 计数尾段，26 字符——e2e.test.ts 同款手法） */
function nextId(): string {
  idSeq += 1
  return '0'.repeat(10) + String(idSeq).padStart(16, '0')
}

/** 确定性时钟步进（created_at 递增——(created_at,id) 排序面的语料基础） */
function tickClock(ms = 10): number {
  clockMs += ms
  return clockMs
}

/** 真实 diff 哈希（sha256 hex——「真实提案」语料：hash 是真内容哈希，非魔数） */
function diffHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
}

/** store 行 → core 记录（verification 经 JSON 往返按 unknown 读出，收窄回 core 形状——写入口径保证可收窄） */
function toCoreRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    asset_type: row.asset_type,
    asset_path: row.asset_path,
    version: row.version,
    diff_hash: row.diff_hash,
    blast_radius: row.blast_radius,
    verification: row.verification as GateEvidence | null,
    parent_id: row.parent_id,
    status: row.status,
  }
}

/** 全量候选（store 读面——全状态集即全量；(created_at,id) 升序） */
function allCandidates(ledger: Ledger): CandidateRow[] {
  return ledger.candidatesByStatus([...CANDIDATE_STATUS_VALUES])
}

/** 提案入参（id/created_at 由本测试的确定性供给器生成） */
interface ProposeSpec {
  asset_type: AssetKind
  asset_path: string
  version: string
  diff_hash: string
  blast_radius: BlastRadius
  parent_id: string | null
}

/**
 * daemon 模式提案接力：core proposeCandidate 判定（形状/幂等/谱系三闸——existing 从 store
 * 读面装载）→ created 时 store insertCandidate 落库（镜像闸再过一遍）。两闸分歧即如实抛。
 */
function daemonPropose(ledger: Ledger, spec: ProposeSpec): { created: boolean; id: string } {
  const existing = allCandidates(ledger).map(toCoreRecord)
  const outcome = corePropose({ id: nextId(), ...spec }, existing)
  if (outcome.created) {
    const res = ledger.insertCandidate({ ...outcome.record, created_at: tickClock() })
    if (!res.inserted) throw new Error(`core created=true 但 store 幂等命中（两闸分歧，候选 ${outcome.record.id}）`)
  }
  return { created: outcome.created, id: outcome.record.id }
}

/** daemon 模式机器迁移接力：core transitionCandidate 判边（含 verification 守卫）→ store 乐观锁落库 */
function daemonTransition(ledger: Ledger, id: string, to: CandidateStatus): void {
  const row = ledger.getCandidate(id)
  if (row === undefined) throw new Error(`候选 ${id} 不在库（读面回查失败）`)
  const next = coreTransition(toCoreRecord(row), to)
  if (!ledger.transitionCandidate(id, row.status, next.status)) {
    throw new Error(`乐观锁落库失败：${id} ${row.status}→${next.status}（期望当前值已过期）`)
  }
}

/**
 * 沙箱完成写点（**store 正式面**）：verification 快照落列 = ledger.updateVerification
 * （v5 增补写面：sandboxed 窗口闸——他态 CONFIG_INVALID；序列化 serializeVerification 与
 * insertCandidate 同源单一 helper）。写后立即经 store 读面回查，闸门证据确实流经台账。
 */
function writeVerification(ledger: Ledger, id: string, evidence: GateEvidence): void {
  const ok = ledger.updateVerification(id, evidence)
  if (!ok) throw new Error(`updateVerification 落库失败：候选 ${id} 不在库（无此行=false——语料装配错序）`)
  const back = ledger.getCandidate(id)?.verification
  expect(back).toEqual(evidence)
}

/** daemon 模式闸门接力：core gate 纯决策 → applyGateDecision（gated→三态）→ store 乐观锁落库 */
function daemonGate(ledger: Ledger, id: string, evidence: GateEvidence): GateDecision {
  const row = ledger.getCandidate(id)
  if (row === undefined) throw new Error(`候选 ${id} 不在库（读面回查失败）`)
  const record = toCoreRecord(row)
  const decision = gate(record, evidence)
  const applied = applyGateDecision(record, decision)
  if (!ledger.transitionCandidate(id, row.status, applied.status)) {
    throw new Error(`闸门决策落库失败：${id} ${row.status}→${applied.status}`)
  }
  return decision
}

/** daemon 模式人裁接力：core makerRuling（escalated→approved|rejected）→ store 乐观锁落库 */
function daemonRuling(ledger: Ledger, id: string, ruling: 'approve' | 'reject'): void {
  const row = ledger.getCandidate(id)
  if (row === undefined) throw new Error(`候选 ${id} 不在库（读面回查失败）`)
  const applied = makerRuling(toCoreRecord(row), ruling)
  if (!ledger.transitionCandidate(id, row.status, applied.status)) {
    throw new Error(`人裁落库失败：${id} ${row.status}→${applied.status}`)
  }
}

/**
 * 判负判定核（生产改动授权断言）——被检查候选全集从 store 读面取（全状态集一查）。
 * 授权过滤（approved|promoted）在判定核内部；nearMisses 诊断要求非授权态可见（core
 * evolution.test.ts 同口径：draft/retired/rejected 均进 nearMisses，activeCandidates
 * 语义=被检查的全集，非「仅授权态行」——若只喂授权态行，诊断面即失明）。
 */
function authorize(ledger: Ledger, change: ProposedChange): CandidateRecord {
  return assertChangeAuthorized(change, allCandidates(ledger).map(toCoreRecord))
}

/** 断言判负：CONFIG_INVALID/evolve/unauthorized + nearMisses 断言回调；返回错误全文 */
function expectUnauthorized(fn: () => unknown, onNearMisses?: (misses: readonly NearMiss[]) => void): string {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const err = caught as ChangeRejectedError
  expect(err.category).toBe('CONFIG_INVALID')
  expect(err.subcause).toBe('evolve/unauthorized')
  expect(Array.isArray(err.nearMisses)).toBe(true)
  if (onNearMisses !== undefined) onNearMisses(err.nearMisses)
  return err.message
}

// ————————————————————————— 场景 A：完整批准链 —————————————————————————

describe('场景 A 完整批准链：观测 → 提案 → 沙箱 → 闸门全绿 → approved → 判负放行 → promoted → 判负再验', () => {
  let ledger: Ledger
  let candId = ''
  const assetPath = 'prompts/engineering/AGENT-1.md'
  /** 假想观测产物（metrics 快照——观测器归后续刀，此处为链路语料） */
  const observation = { probe: 'gate_pass_rate', window: '2026-10-09..2026-10-16', baseline: 0.9, observed: 0.82, samples: 214 }
  const diffText = [
    '--- a/prompts/engineering/AGENT-1.md',
    '+++ b/prompts/engineering/AGENT-1.md',
    '@@ 交付纪律 @@',
    '-完成后自查一遍再交。',
    '+完成后按验收口径逐条自查并留证据引用（观测 gate_pass_rate 0.82→目标 0.9）。',
  ].join('\n')
  const evidence: GateEvidence = { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'glm-5.3', pass: true }, { judge: 'kimi-k2', pass: true }] }

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'scenario-a.sqlite'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('观测→提案：metrics 快照显示回退（observed<baseline）→ proposeCandidate 落 draft（初代、无快照）', () => {
    // 观测产物如实成案：回退才立项（拟稿语料——链路形状的输入面）
    expect(observation.observed).toBeLessThan(observation.baseline)
    const outcome = daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v2',
      diff_hash: diffHash(diffText),
      blast_radius: 'isolated',
      parent_id: null,
    })
    expect(outcome.created).toBe(true)
    candId = outcome.id

    // 台账视角回查：draft 全列落库（verification null=未跑沙箱；parent null=初代显式标记）
    const row = ledger.getCandidate(candId)
    expect(row).toEqual({
      id: candId,
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v2',
      diff_hash: diffHash(diffText),
      blast_radius: 'isolated',
      verification: null,
      parent_id: null,
      status: 'draft',
      created_at: expect.any(Number),
    } satisfies CandidateRow)
    expect(ledger.candidatesByStatus(['draft']).map((r) => r.id)).toEqual([candId])
    // 谱系锚点：初代自含
    expect(ledger.lineageOf(candId)?.map((r) => r.id)).toEqual([candId])
  })

  it('幂等提案：同 (asset_path,diff_hash) 非终态命中 → 既有 id 不新建（core 与 store 两闸同判）', () => {
    const again = daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v3-重提',
      diff_hash: diffHash(diffText),
      blast_radius: 'isolated',
      parent_id: null,
    })
    expect(again.created).toBe(false)
    expect(again.id).toBe(candId)
    // store 镜像闸同判：换 id 直插同键 → inserted=false 返既有 id
    const mirrored = ledger.insertCandidate({
      id: nextId(),
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v3-重提',
      diff_hash: diffHash(diffText),
      blast_radius: 'isolated',
      verification: null,
      parent_id: null,
      status: 'draft',
      created_at: tickClock(),
    })
    expect(mirrored).toEqual({ id: candId, inserted: false })
    expect(allCandidates(ledger)).toHaveLength(1)
  })

  it('draft→proposed→sandboxed：机器迁移逐跳落库（乐观锁），沙箱证据快照注入后读面可回查', () => {
    daemonTransition(ledger, candId, 'proposed')
    expect(ledger.getCandidate(candId)?.status).toBe('proposed')
    daemonTransition(ledger, candId, 'sandboxed')
    expect(ledger.getCandidate(candId)?.status).toBe('sandboxed')
    // 沙箱完成：verification 快照落列（模拟写点，头注冻结）——读面 deep-equal 往返
    writeVerification(ledger, candId, evidence)
    expect(ledger.getCandidate(candId)?.verification).toEqual(evidence)
  })

  it('sandboxed→gated→applyGateDecision（all-evidence-green）→ approved：三态决策落库', () => {
    // 进闸门前 verification 非 null（F3-02 缺一不进闸门——core 守卫读的是 store 回查行）
    daemonTransition(ledger, candId, 'gated')
    expect(ledger.getCandidate(candId)?.status).toBe('gated')
    const decision = daemonGate(ledger, candId, evidence)
    expect(decision.decision).toBe('approve')
    expect(decision.reason).toBe('all-evidence-green')
    expect(decisionToStatus(decision.decision)).toBe('approved')
    expect(ledger.getCandidate(candId)?.status).toBe('approved')
    // 授权态集读面：approved 即在 active 集（判负查的消费面）
    expect(ledger.candidatesByStatus([...AUTHORIZING_STATUSES]).map((r) => r.id)).toEqual([candId])
  })

  it('判负放行：模拟生产改动 (asset_path, diff_hash) 命中 approved 候选——active 集来自台账', () => {
    const hit = authorize(ledger, { asset_path: assetPath, diff_hash: diffHash(diffText) })
    expect(hit.id).toBe(candId)
    expect(hit.status).toBe('approved')
    expect(ledger.getCandidate(hit.id)?.status).toBe('approved')
  })

  it('approved→promoted：切权位就绪（灰度/真切权归后续刀）——promoted 仍授权，同改动再验放行', () => {
    daemonTransition(ledger, candId, 'promoted')
    expect(ledger.getCandidate(candId)?.status).toBe('promoted')
    const hit = authorize(ledger, { asset_path: assetPath, diff_hash: diffHash(diffText) })
    expect(hit.status).toBe('promoted')
  })

  it('判负再验：promoted→retired（退役/回滚）后**同改动拒**——吊销即失效，nearMisses 如实诊断', () => {
    daemonTransition(ledger, candId, 'retired')
    expect(ledger.getCandidate(candId)?.status).toBe('retired')
    // active 集已无此候选（授权态只有 approved|promoted）
    expect(ledger.candidatesByStatus([...AUTHORIZING_STATUSES])).toEqual([])
    const message = expectUnauthorized(
      () => authorize(ledger, { asset_path: assetPath, diff_hash: diffHash(diffText) }),
      (misses) => {
        expect(misses).toEqual([
          { id: candId, asset_path: assetPath, diff_hash: diffHash(diffText), status: 'retired', reason: 'status-not-authorizing' },
        ])
      },
    )
    expect(message).toContain('无 candidate id 的生产改动判负')
  })
})

// ————————————————————————— 场景 B：判据类 escalate → 制作人亲批 ————————————————————

describe('场景 B 判据类 escalate 链：criterion 提案证据全绿仍恒 escalate → makerRuling 亲批 → approved', () => {
  let ledger: Ledger
  let candId = ''
  const assetPath = 'criteria/acceptance/gate.yaml'
  const evidence: GateEvidence = { sandboxPass: true, blastRadiusOk: true } // 证据全绿也不豁免宪法面

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'scenario-b.sqlite'))
    candId = daemonPropose(ledger, {
      asset_type: 'criterion',
      asset_path: assetPath,
      version: 'v0.3.1',
      diff_hash: diffHash('criteria/acceptance/gate.yaml：验收口径阈值 0.9→0.92'),
      blast_radius: 'framework',
      parent_id: null,
    }).id
  })

  afterAll(() => {
    ledger.close()
  })

  it('criterion 走机器链到 gated：draft→proposed→sandboxed（快照注入）→gated 逐跳落库', () => {
    daemonTransition(ledger, candId, 'proposed')
    daemonTransition(ledger, candId, 'sandboxed')
    writeVerification(ledger, candId, evidence)
    daemonTransition(ledger, candId, 'gated')
    expect(ledger.getCandidate(candId)?.status).toBe('gated')
  })

  it('闸门恒 escalate（criterion-locked）：证据全绿仍不机器批——判据类=宪法内核（20-§九），escalated 落库', () => {
    const decision = daemonGate(ledger, candId, evidence)
    expect(decision).toEqual({
      decision: 'escalate',
      reason: 'criterion-locked',
      note: expect.any(String),
    } satisfies GateDecision)
    expect(ledger.getCandidate(candId)?.status).toBe('escalated')
  })

  it('机器边封锁（禁旁路结构化）：transitionCandidate 从 escalated 出发即拒——人裁只经 makerRuling', () => {
    const record = toCoreRecord(ledger.getCandidate(candId) as CandidateRow)
    expect(() => coreTransition(record, 'approved')).toThrowError(/evolve\/illegal-transition.*人裁只经 makerRuling/)
    // 台账不受影响：仍在人裁位
    expect(ledger.getCandidate(candId)?.status).toBe('escalated')
  })

  it('makerRuling 亲批 → approved 落库（制作人触点机制闭环）→ 判负放行', () => {
    daemonRuling(ledger, candId, 'approve')
    expect(ledger.getCandidate(candId)?.status).toBe('approved')
    const hit = authorize(ledger, { asset_path: assetPath, diff_hash: diffHash('criteria/acceptance/gate.yaml：验收口径阈值 0.9→0.92') })
    expect(hit.id).toBe(candId)
    expect(ledger.candidatesByStatus([...AUTHORIZING_STATUSES]).map((r) => r.id)).toEqual([candId])
  })

  it('人裁口只对 escalated 开放：approved 后再施加裁决即拒（evolve/not-escalated）——一次性触点', () => {
    const record = toCoreRecord(ledger.getCandidate(candId) as CandidateRow)
    expect(() => makerRuling(record, 'reject')).toThrowError(/evolve\/not-escalated/)
    expect(ledger.getCandidate(candId)?.status).toBe('approved')
  })
})

// ————————————————————————— 场景 C：谱系换代链 ————————————————————

describe('场景 C 谱系换代链：v1 被拒（sandbox-failed）→ 同资产原样重提=换代 → 两代谱系 → v2 批准', () => {
  let ledger: Ledger
  let v1 = ''
  let v2 = ''
  const assetPath = 'prompts/dispatch/brief.md'
  const sameDiff = 'prompts/dispatch/brief.md：任务书模板首段加「先读验收口径」一句'
  const hash = diffHash(sameDiff)

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'scenario-c.sqlite'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('v1 走链进闸门，沙箱红 → reject（sandbox-failed）→ rejected 终态落库', () => {
    v1 = daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v1',
      diff_hash: hash,
      blast_radius: 'isolated',
      parent_id: null,
    }).id
    daemonTransition(ledger, v1, 'proposed')
    daemonTransition(ledger, v1, 'sandboxed')
    writeVerification(ledger, v1, { sandboxPass: false, blastRadiusOk: true })
    daemonTransition(ledger, v1, 'gated')
    const decision = daemonGate(ledger, v1, { sandboxPass: false, blastRadiusOk: true })
    expect(decision.decision).toBe('reject')
    expect(decision.reason).toBe('sandbox-failed')
    expect(ledger.getCandidate(v1)?.status).toBe('rejected')
    // 终态在授权集外：此刻该资产无任何授权
    expect(ledger.candidatesByStatus([...AUTHORIZING_STATUSES])).toEqual([])
  })

  it('同资产同 hash 原样重提（parent=v1）：终态放行新建=换代——两代并存、谱系 fork 正确', () => {
    const outcome = daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: assetPath,
      version: 'v2-原样重提',
      diff_hash: hash, // 原样：同 (asset_path, diff_hash)——rejected 终态放行新建（换代重提）
      blast_radius: 'isolated',
      parent_id: v1,
    })
    expect(outcome.created).toBe(true)
    v2 = outcome.id
    expect(v2).not.toBe(v1)

    // 台账视角：同键两行并存（rejected 一代 + draft 新一代）；谱系新→旧 [v2, v1]
    const sameKey = allCandidates(ledger).filter((r) => r.asset_path === assetPath && r.diff_hash === hash)
    expect(sameKey.map((r) => [r.id, r.status])).toEqual([[v1, 'rejected'], [v2, 'draft']])
    expect(ledger.lineageOf(v2)?.map((r) => r.id)).toEqual([v2, v1])
    expect(ledger.lineageOf(v2)?.[1]?.status).toBe('rejected')
    // 换代后键占位：非终态 v2 在键上——再次同键提案幂等命中 v2（不新建第三代）
    const third = daemonPropose(ledger, {
      asset_type: 'prompt', asset_path: assetPath, version: 'v3', diff_hash: hash, blast_radius: 'isolated', parent_id: null,
    })
    expect(third).toEqual({ created: false, id: v2 })
  })

  it('v2 以绿证据走链批准：approved 落库——两代谱系保持（好变体出自平庸祖先的档案面）', () => {
    daemonTransition(ledger, v2, 'proposed')
    daemonTransition(ledger, v2, 'sandboxed')
    const green: GateEvidence = { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'glm-5.3', pass: true }] }
    writeVerification(ledger, v2, green)
    daemonTransition(ledger, v2, 'gated')
    const decision = daemonGate(ledger, v2, green)
    expect(decision).toEqual({ decision: 'approve', reason: 'all-evidence-green', note: expect.any(String) } satisfies GateDecision)
    expect(ledger.getCandidate(v2)?.status).toBe('approved')
    // 谱系不因状态迁移漂移（parent_id 不可变，fork-only）：仍 [v2, v1]
    expect(ledger.lineageOf(v2)?.map((r) => [r.id, r.status])).toEqual([[v2, 'approved'], [v1, 'rejected']])
    // 判负：换代批准后同改动放行（授权命中的是 v2 不是 v1）
    const hit = authorize(ledger, { asset_path: assetPath, diff_hash: hash })
    expect(hit.id).toBe(v2)
    expect(hit.status).toBe('approved')
  })
})

// ————————————————————————— 场景 D：判负负面 ————————————————————

describe('场景 D 判负负面：裸改动拒（nearMisses 诊断）+ 跨资产同 hash 不放行', () => {
  let ledger: Ledger
  const hashX = diffHash('prompts/qa/checklist.md：交付前清单加证据引用一条')

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'scenario-d.sqlite'))
    // 语料：asset-X 已批准（hashX）；asset-C 有 draft 占键（hashC）
    const approvedId = daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: 'prompts/qa/checklist.md',
      version: 'v2',
      diff_hash: hashX,
      blast_radius: 'isolated',
      parent_id: null,
    }).id
    daemonTransition(ledger, approvedId, 'proposed')
    daemonTransition(ledger, approvedId, 'sandboxed')
    const green: GateEvidence = { sandboxPass: true, blastRadiusOk: true }
    writeVerification(ledger, approvedId, green)
    daemonTransition(ledger, approvedId, 'gated')
    daemonGate(ledger, approvedId, green)
    expect(ledger.getCandidate(approvedId)?.status).toBe('approved')
    daemonPropose(ledger, {
      asset_type: 'prompt',
      asset_path: 'prompts/review/policy.md',
      version: 'v1',
      diff_hash: diffHash('prompts/review/policy.md：评审策略首稿'),
      blast_radius: 'isolated',
      parent_id: null,
    })
  })

  afterAll(() => {
    ledger.close()
  })

  it('裸改动拒：无任何候选记录的资产——nearMisses 空 + 报文如实指明', () => {
    const message = expectUnauthorized(
      () => authorize(ledger, { asset_path: 'org-config.yaml', diff_hash: diffHash('org-config.yaml：未走管线的裸改动') }),
      (misses) => {
        expect(misses).toEqual([])
      },
    )
    expect(message).toContain('该资产无任何候选记录')
  })

  it('跨资产同 hash 不放行：判负匹配键是 (asset_path, diff_hash) 二元组——纯 hash 相同不授权', () => {
    // asset-X 已批准 hashX；改到另一资产路径、内容哈希相同 → 拒（不把 A 资产的授权借给 B 资产）
    expectUnauthorized(
      () => authorize(ledger, { asset_path: 'prompts/other/steal.md', diff_hash: hashX }),
      (misses) => {
        expect(misses).toEqual([]) // steal.md 自身无候选——近似命中按同资产路径归集
      },
    )
    // 对照：正确二元组仍放行（同 hash 在正确资产上命中）
    expect(authorize(ledger, { asset_path: 'prompts/qa/checklist.md', diff_hash: hashX }).status).toBe('approved')
  })

  it('同资产近似命中诊断：draft 占键=状态未授权；异内容=hash 不符——nearMisses 逐条如实', () => {
    const hashC = diffHash('prompts/review/policy.md：评审策略首稿')
    // 同资产同内容但 draft（未授权态）
    const msg1 = expectUnauthorized(
      () => authorize(ledger, { asset_path: 'prompts/review/policy.md', diff_hash: hashC }),
      (misses) => {
        expect(misses).toHaveLength(1)
        expect(misses[0]?.reason).toBe('status-not-authorizing')
        expect(misses[0]?.status).toBe('draft')
      },
    )
    expect(msg1).toContain('近似命中')
    // 同资产不同内容（hash 不符）
    expectUnauthorized(
      () => authorize(ledger, { asset_path: 'prompts/review/policy.md', diff_hash: diffHash('prompts/review/policy.md：未登记的另一改动') }),
      (misses) => {
        expect(misses).toHaveLength(1)
        expect(misses[0]?.reason).toBe('hash-mismatch')
      },
    )
  })
})

// ————————————————————————— CLI 面（加分件）：candidates list ————————————————————

describe('CLI 面：studio-next candidates list --db（只读列表面薄壳）', () => {
  function runBin(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args], { encoding: 'utf8' })
      let out = ''
      let err = ''
      child.stdout?.on('data', (d: string) => {
        out += d
      })
      child.stderr?.on('data', (d: string) => {
        err += d
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        resolve({ code, out, err })
      })
    })
  }

  it('真 bin 进程列出候选现状：汇总行 + 逐行（id/状态/资产/谱系父），只读零写', { timeout: 30_000 }, async () => {
    const dbPath = path.join(root, 'cli.sqlite')
    const ledger = openLedger(dbPath)
    const approved = daemonPropose(ledger, {
      asset_type: 'prompt', asset_path: 'prompts/cli/a.md', version: 'v2',
      diff_hash: diffHash('prompts/cli/a.md：cli 语料'), blast_radius: 'isolated', parent_id: null,
    }).id
    daemonTransition(ledger, approved, 'proposed')
    daemonTransition(ledger, approved, 'sandboxed')
    const green: GateEvidence = { sandboxPass: true, blastRadiusOk: true }
    writeVerification(ledger, approved, green)
    daemonTransition(ledger, approved, 'gated')
    daemonGate(ledger, approved, green)
    const child = daemonPropose(ledger, {
      asset_type: 'prompt', asset_path: 'prompts/cli/b.md', version: 'v1',
      diff_hash: diffHash('prompts/cli/b.md：cli 语料二'), blast_radius: 'isolated', parent_id: approved,
    }).id
    const before = JSON.stringify(allCandidates(ledger))
    ledger.close()

    const result = await runBin(['candidates', 'list', '--db', dbPath])
    expect(result.code).toBe(0)
    expect(result.out).toContain('候选 2 条')
    expect(result.out).toContain('approved=1')
    expect(result.out).toContain('draft=1')
    expect(result.out).toContain(approved)
    expect(result.out).toContain(child)
    expect(result.out).toContain('prompts/cli/a.md')
    expect(result.out).toContain(`parent=${approved}`)

    // 只读零写：行集字节不变（再开库比对）
    const reopened = openLedger(dbPath)
    expect(JSON.stringify(allCandidates(reopened))).toBe(before)
    reopened.close()
  })

  it('库不存在即拒（只读面不代建库）：exit 1 + 如实报文', { timeout: 30_000 }, async () => {
    const result = await runBin(['candidates', 'list', '--db', path.join(root, 'no-such.sqlite')])
    expect(result.code).toBe(1)
    expect(result.err).toContain('库不存在')
  })
})
