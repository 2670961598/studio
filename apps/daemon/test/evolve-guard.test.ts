/**
 * evolve-guard —— 进化管线 daemon 侧判负闸测试（v0 接线单：20-§九 判负 / 02-F3-01 / 17-§3）
 *
 * 断言面（实现单口径逐条钉死）：
 *  1. createEvolveGuard.authorize：
 *     - 授权命中（approved / promoted）→ 返回授权候选（台账视角的谱系/日志锚）；
 *     - 判负 → ChangeRejectedError 透传（category/subcause/nearMisses 原文）；
 *     - **入参语义=候选全集非授权集**（e2e 头注「判负入参语义收窄说明」）：draft 占键
 *       （status-not-authorizing）/ 同资产异内容（hash-mismatch）/ retired 吊销仍拒——
 *       近似命中诊断要求非授权态行可见，只喂授权态行即失明（测试以 draft/retired 语料证之）；
 *     - 形状坏（空 asset_path / 空 diff_hash）→ core 通道直通（evolve/change-malformed）。
 *  2. runEvolveStartupSelfCheck（v0 观察模式三态 + 边缘）：
 *     - 空库首启（candidates 零行）→ 跳过全部检查（skipped='empty-ledger'，checked=0），
 *       零事件、日志如实；
 *     - 全绿 → 零事件、日志全绿行；
 *     - unauthorized → ESCALATE 事件落账（note 携 nearMisses 摘要原文）+ 汇报表可断言；
 *     - 资产文件缺失 → errors 如实上报，不阻断（无 throw、无该资产事件）；
 *     - 判负以外异常（hash 空=形状坏）→ 上抛 fail-fast（观察模式不掩盖代码级 bug）。
 *  3. serve 接线三态（buildServeRuntime 装配期自检）：
 *     - 空库首启零检查如实 / 全绿无事件 / unauthorized 落 ESCALATE 且启动不被阻断。
 *
 * 环境与纪律：os.tmpdir() 真文件库（沿 daemon 测试风格）；语料走 store 正式读写面
 * （insertCandidate/transitionCandidate/**updateVerification**——沙箱完成写点同链路）；
 * 自检注入面（manifest/hashFile/fileExists/makeId）确定性替身；只动本测试文件与被测源；
 * strict / 零新依赖 / 只写可擦除 TS。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChangeRejectedError, GateEvidence, NearMiss } from '@studio-next/core'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEvolveGuard, runEvolveStartupSelfCheck, type EvolveSelfCheckDeps } from '../src/evolve-guard.ts'
import { buildServeRuntime, DEMO_SNAPSHOT, type ServeConfig, type ServeRuntime } from '../src/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''
const T0 = Date.parse('2026-10-16T00:00:00.000Z')

let idSeq = 0
let clockMs = T0

/** 确定性 ULID 形状事件 id（e2e deterministicIds 同款——contract UlidSchema 过闸形状） */
function nextId(): string {
  idSeq += 1
  return '0'.repeat(10) + String(idSeq).padStart(16, '0')
}

/** 确定性时钟步进 */
function tickClock(ms = 10): number {
  clockMs += ms
  return clockMs
}

/**
 * 语料工厂：走 store 正式读写面沿机器链推进（insert → draft→proposed→sandboxed →
 * **updateVerification（沙箱完成写点）** → gated→approved → 终态）——daemon 模式接力
 * 的库侧缩影（决策归 core 纯函数由 e2e 证明，此处钉读写面链路本身）。
 */
function seedCandidate(
  ledger: Ledger,
  spec: { id: string; asset_path: string; diff_hash: string },
  end: 'draft' | 'approved' | 'promoted' | 'retired',
): void {
  ledger.insertCandidate({
    id: spec.id,
    asset_type: 'prompt',
    asset_path: spec.asset_path,
    version: 'v1',
    diff_hash: spec.diff_hash,
    blast_radius: 'isolated',
    verification: null,
    parent_id: null,
    status: 'draft',
    created_at: tickClock(),
  })
  if (end === 'draft') return
  ledger.transitionCandidate(spec.id, 'draft', 'proposed')
  ledger.transitionCandidate(spec.id, 'proposed', 'sandboxed')
  const green: GateEvidence = { sandboxPass: true, blastRadiusOk: true }
  expect(ledger.updateVerification(spec.id, green)).toBe(true)
  ledger.transitionCandidate(spec.id, 'sandboxed', 'gated')
  ledger.transitionCandidate(spec.id, 'gated', 'approved')
  if (end === 'promoted') ledger.transitionCandidate(spec.id, 'approved', 'promoted')
  if (end === 'retired') ledger.transitionCandidate(spec.id, 'approved', 'retired')
  expect(ledger.getCandidate(spec.id)?.status).toBe(end)
}

/** 断言判负：CONFIG_INVALID/evolve/unauthorized + ChangeRejectedError 形状；返回错误（近一步断言） */
function expectUnauthorized(fn: () => unknown): ChangeRejectedError {
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
  return err
}

/** 自检依赖注入（确定性）：清单/哈希/时钟/事件 id 全替身 */
const MANIFEST = [
  { path: 'prompts/frozen/a.md', why: '测试冻结资产 A' },
  { path: 'prompts/frozen/b.md', why: '测试冻结资产 B' },
] as const

const HASHES: Readonly<Record<string, string>> = {
  'prompts/frozen/a.md': 'sha256:aaaaaaaa',
  'prompts/frozen/b.md': 'sha256:bbbbbbbb',
}

/** 造自检依赖（log 收集返回行数组；覆盖项按用例改写） */
function selfCheckDeps(ledger: Ledger, over: Partial<EvolveSelfCheckDeps> = { }): { deps: EvolveSelfCheckDeps; lines: string[] } {
  const lines: string[] = []
  const deps: EvolveSelfCheckDeps = {
    ledger,
    clock: tickClock,
    makeId: nextId,
    company: 'demo',
    actor: 'daemon',
    dept: 'departments/工程部',
    log: (line) => lines.push(line),
    manifest: MANIFEST,
    fileExists: (p) => p in HASHES,
    hashFile: (p) => HASHES[p] ?? 'sha256:unknown',
    ...over,
  }
  return { deps, lines }
}

/** serve 配置（demo 最小面；gateway 缺省开——判负自检与网关开关无关） */
function serveConfig(db: string): ServeConfig {
  return {
    db,
    platform: 'fake',
    company: 'demo',
    rootDir: path.join(root, 'ws'),
    tickMs: 60_000,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 3_600_000,
    // DEV-44：本套测 schema 进化面非响置面——刀关（0）保持改动前告警-only 语义
    stallKillAfterAlarms: 0,
    laneTtlMs: 1_800_000,
    breakerThreshold: 3,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15_000,
    matrix: false,
    fileWatch: false,
    gateway: true,
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-evolve-guard-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 判负闸本体 —————————————————————————

describe('createEvolveGuard.authorize（core 判定核 ∘ 台账候选全集）', () => {
  let ledger: Ledger

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'guard.sqlite'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('授权命中：approved / promoted 候选放行——返回授权候选（谱系/日志锚）', () => {
    seedCandidate(ledger, { id: 'g-approve', asset_path: 'prompts/guard/approved.md', diff_hash: 'sha256:ok-1' }, 'approved')
    seedCandidate(ledger, { id: 'g-promote', asset_path: 'prompts/guard/promoted.md', diff_hash: 'sha256:ok-2' }, 'promoted')
    const guard = createEvolveGuard(ledger)
    const hitA = guard.authorize('prompts/guard/approved.md', 'sha256:ok-1')
    expect(hitA.id).toBe('g-approve')
    expect(hitA.status).toBe('approved')
    const hitB = guard.authorize('prompts/guard/promoted.md', 'sha256:ok-2')
    expect(hitB.id).toBe('g-promote')
    expect(hitB.status).toBe('promoted')
  })

  it('判负 nearMisses 透传（全集语义）：draft 占键=状态未授权；同资产异内容=hash 不符——非授权态行必须进诊断', () => {
    seedCandidate(ledger, { id: 'g-draft', asset_path: 'prompts/guard/draft.md', diff_hash: 'sha256:same' }, 'draft')
    seedCandidate(ledger, { id: 'g-other-hash', asset_path: 'prompts/guard/draft.md', diff_hash: 'sha256:different' }, 'draft')
    const guard = createEvolveGuard(ledger)
    const err = expectUnauthorized(() => guard.authorize('prompts/guard/draft.md', 'sha256:same'))
    // 全集喂入的证明：draft 行（非授权态）在 nearMisses 里可见——只喂授权集此诊断即空
    expect(err.nearMisses).toEqual([
      { id: 'g-draft', asset_path: 'prompts/guard/draft.md', diff_hash: 'sha256:same', status: 'draft', reason: 'status-not-authorizing' },
      { id: 'g-other-hash', asset_path: 'prompts/guard/draft.md', diff_hash: 'sha256:different', status: 'draft', reason: 'hash-mismatch' },
    ] satisfies NearMiss[])
    expect(err.message).toContain('近似命中')
  })

  it('裸改动拒：无任何候选记录的资产——nearMisses 空 + 报文如实指明', () => {
    const guard = createEvolveGuard(ledger)
    const err = expectUnauthorized(() => guard.authorize('org-config.yaml', 'sha256:bare'))
    expect(err.nearMisses).toEqual([])
    expect(err.message).toContain('该资产无任何候选记录')
    expect(err.change).toEqual({ asset_path: 'org-config.yaml', diff_hash: 'sha256:bare' })
  })

  it('retired 吊销仍拒（授权态只有 approved|promoted）：回滚后同改动判负，nearMisses 如实', () => {
    seedCandidate(ledger, { id: 'g-retired', asset_path: 'prompts/guard/retired.md', diff_hash: 'sha256:gone' }, 'retired')
    const guard = createEvolveGuard(ledger)
    const err = expectUnauthorized(() => guard.authorize('prompts/guard/retired.md', 'sha256:gone'))
    expect(err.nearMisses).toEqual([
      { id: 'g-retired', asset_path: 'prompts/guard/retired.md', diff_hash: 'sha256:gone', status: 'retired', reason: 'status-not-authorizing' },
    ] satisfies NearMiss[])
  })

  it('形状坏直通 core 通道（evolve/change-malformed）：空 asset_path / 空 diff_hash', () => {
    const guard = createEvolveGuard(ledger)
    expect(() => guard.authorize('', 'sha256:x')).toThrowError(/CONFIG_INVALID\/evolve\/change-malformed/)
    expect(() => guard.authorize('a.md', '')).toThrowError(/evolve\/change-malformed/)
  })
})

// ————————————————————————— 2. 启动自检（观察模式三态 + 边缘） —————————————————————————

describe('runEvolveStartupSelfCheck（serve 启动自检，v0 观察模式）', () => {
  it('空库首启：跳过全部检查（skipped=empty-ledger，checked=0）——零事件、日志如实', () => {
    const ledger = openLedger(path.join(root, 'selfcheck-empty.sqlite'))
    try {
      const { deps, lines } = selfCheckDeps(ledger)
      const report = runEvolveStartupSelfCheck(deps)
      expect(report.skipped).toBe('empty-ledger')
      expect(report.checked).toBe(0)
      expect(report.authorized).toBe(0)
      expect(report.unauthorized).toEqual([])
      expect(report.events).toEqual([])
      expect(report.errors).toEqual([])
      expect(ledger.queryEvents()).toEqual([]) // 不落事件
      expect(lines.join('\n')).toContain('台账零候选')
      expect(lines.join('\n')).toContain('零检查如实上报')
    } finally {
      ledger.close()
    }
  })

  it('全绿无事件：清单资产当前 hash 均命中 approved/promoted 候选——零 ESCALATE、日志全绿', () => {
    const ledger = openLedger(path.join(root, 'selfcheck-green.sqlite'))
    try {
      seedCandidate(ledger, { id: 's-a', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
      seedCandidate(ledger, { id: 's-b', asset_path: 'prompts/frozen/b.md', diff_hash: HASHES['prompts/frozen/b.md']! }, 'promoted')
      const { deps, lines } = selfCheckDeps(ledger)
      const report = runEvolveStartupSelfCheck(deps)
      expect(report.skipped).toBeNull()
      expect(report).toMatchObject({ checked: 2, authorized: 2 })
      expect(report.unauthorized).toEqual([])
      expect(report.events).toEqual([])
      expect(report.errors).toEqual([])
      expect(ledger.queryEvents().filter((e) => e.event === 'ESCALATE')).toEqual([])
      expect(lines.join('\n')).toContain('全绿')
    } finally {
      ledger.close()
    }
  })

  it('unauthorized → ESCALATE 落账（note 携 nearMisses 摘要）：draft 占键资产判负、绿资产不受累', () => {
    const ledger = openLedger(path.join(root, 'selfcheck-escalate.sqlite'))
    try {
      seedCandidate(ledger, { id: 's-a2', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
      seedCandidate(ledger, { id: 's-b2', asset_path: 'prompts/frozen/b.md', diff_hash: HASHES['prompts/frozen/b.md']! }, 'draft') // 占键未授权
      const { deps, lines } = selfCheckDeps(ledger)
      const report = runEvolveStartupSelfCheck(deps)
      expect(report.skipped).toBeNull()
      expect(report.checked).toBe(2)
      expect(report.authorized).toBe(1)
      expect(report.unauthorized).toHaveLength(1)
      const finding = report.unauthorized[0]!
      expect(finding.asset_path).toBe('prompts/frozen/b.md')
      expect(finding.nearMisses).toEqual([
        { id: 's-b2', asset_path: 'prompts/frozen/b.md', diff_hash: HASHES['prompts/frozen/b.md']!, status: 'draft', reason: 'status-not-authorizing' },
      ] satisfies NearMiss[])
      // 台账留痕面：一发现一 ESCALATE，全列断言（契约形状 + nearMisses 摘要在 note）
      const escalates = ledger.queryEvents().filter((e) => e.event === 'ESCALATE')
      expect(escalates).toHaveLength(1)
      const evt = escalates[0]!
      expect(evt).toMatchObject({
        company: 'demo',
        issue: '-',
        actor: 'daemon',
        attempt: 1,
        level: 1,
        dept: 'departments/工程部',
        tokens: { input: 0 },
      })
      expect(evt.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/) // 确定性 ULID 形状过契约闸
      expect(evt.note).toContain('EVOLVE_GUARD 启动自检判负')
      expect(evt.note).toContain('prompts/frozen/b.md')
      expect(evt.note).toContain('近似命中') // nearMisses 摘要原文落账
      expect(evt.note).toContain('观察模式不阻断启动')
      expect(report.events.map((e) => e.id)).toEqual([evt.id])
      expect(lines.join('\n')).toContain('unauthorized=1')
    } finally {
      ledger.close()
    }
  })

  it('资产文件缺失：errors 如实上报，不阻断（无 throw、缺失资产不计 checked、不落事件）', () => {
    const ledger = openLedger(path.join(root, 'selfcheck-missing.sqlite'))
    try {
      seedCandidate(ledger, { id: 's-a3', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
      const { deps, lines } = selfCheckDeps(ledger, {
        fileExists: (p) => p === 'prompts/frozen/a.md', // b.md 缺失
      })
      const report = runEvolveStartupSelfCheck(deps)
      expect(report.skipped).toBeNull()
      expect(report.checked).toBe(1) // 只查存在的
      expect(report.authorized).toBe(1)
      expect(report.unauthorized).toEqual([])
      expect(report.errors).toHaveLength(1)
      expect(report.errors[0]).toContain('prompts/frozen/b.md')
      expect(report.errors[0]).toContain('不冒充 unauthorized')
      expect(report.events).toEqual([])
      expect(ledger.queryEvents()).toEqual([])
      expect(lines.join('\n')).toContain('资产文件缺失')
    } finally {
      ledger.close()
    }
  })

  it('判负以外异常上抛（fail-fast）：hash 形状坏 → core evolve/change-malformed 直通，不静默吞', () => {
    const ledger = openLedger(path.join(root, 'selfcheck-malformed.sqlite'))
    try {
      seedCandidate(ledger, { id: 's-a4', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
      const { deps } = selfCheckDeps(ledger, {
        hashFile: () => '', // 空 hash=生产改动形状坏——代码级问题，观察模式不掩盖
      })
      expect(() => runEvolveStartupSelfCheck(deps)).toThrowError(/evolve\/change-malformed/)
      expect(ledger.queryEvents()).toEqual([]) // 未落任何事件（fail-fast 先于落账）
    } finally {
      ledger.close()
    }
  })
})

// ————————————————————————— 3. serve 接线三态（buildServeRuntime 装配期自检） —————————————————————————

describe('serve 启动自检接线（buildServeRuntime，观察模式三态）', () => {
  it('空库首启：自检跳过（零检查如实）——零事件、启动不受影响', async () => {
    const db = path.join(root, 'serve-empty.sqlite')
    const ledger = openLedger(db)
    const lines: string[] = []
    const rt: ServeRuntime = buildServeRuntime(serveConfig(db), ledger, DEMO_SNAPSHOT, {
      log: (l) => lines.push(l),
      clock: () => tickClock(),
      evolveSelfCheck: { manifest: MANIFEST, hashFile: (p) => HASHES[p] ?? 'sha256:unknown', fileExists: (p) => p in HASHES },
    })
    expect(rt.evolveSelfCheck.skipped).toBe('empty-ledger')
    expect(rt.evolveSelfCheck.checked).toBe(0)
    expect(rt.evolveSelfCheck.events).toEqual([])
    expect(ledger.queryEvents()).toEqual([]) // 无 ESCALATE（也无心跳——装配期未 tick）
    expect(lines.join('\n')).toContain('零检查如实上报')
    expect(rt.engine).toBeDefined() // 启动未阻断
    await rt.stop()
  })

  it('全绿无事件：清单资产均有 approved 候选命中——零 ESCALATE，台账零事件', async () => {
    const db = path.join(root, 'serve-green.sqlite')
    const ledger = openLedger(db)
    seedCandidate(ledger, { id: 'v-a', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
    seedCandidate(ledger, { id: 'v-b', asset_path: 'prompts/frozen/b.md', diff_hash: HASHES['prompts/frozen/b.md']! }, 'approved')
    const lines: string[] = []
    const rt = buildServeRuntime(serveConfig(db), ledger, DEMO_SNAPSHOT, {
      log: (l) => lines.push(l),
      clock: () => tickClock(),
      evolveSelfCheck: { manifest: MANIFEST, hashFile: (p) => HASHES[p] ?? 'sha256:unknown', fileExists: (p) => p in HASHES },
    })
    expect(rt.evolveSelfCheck.skipped).toBeNull()
    expect(rt.evolveSelfCheck).toMatchObject({ checked: 2, authorized: 2 })
    expect(rt.evolveSelfCheck.unauthorized).toEqual([])
    expect(ledger.queryEvents().filter((e) => e.event === 'ESCALATE')).toEqual([])
    expect(lines.join('\n')).toContain('全绿')
    await rt.stop()
  })

  it('unauthorized：ESCALATE 落台账 + 观察模式不阻断启动（引擎照常装配、可停机）', async () => {
    const db = path.join(root, 'serve-escalate.sqlite')
    const ledger = openLedger(db)
    seedCandidate(ledger, { id: 'w-a', asset_path: 'prompts/frozen/a.md', diff_hash: HASHES['prompts/frozen/a.md']! }, 'approved')
    seedCandidate(ledger, { id: 'w-b', asset_path: 'prompts/frozen/b.md', diff_hash: 'sha256:stale-approved-hash' }, 'approved') // hash 不符=近似命中
    const lines: string[] = []
    const rt = buildServeRuntime(serveConfig(db), ledger, DEMO_SNAPSHOT, {
      log: (l) => lines.push(l),
      clock: () => tickClock(),
      evolveSelfCheck: { manifest: MANIFEST, hashFile: (p) => HASHES[p] ?? 'sha256:unknown', fileExists: (p) => p in HASHES },
    })
    expect(rt.evolveSelfCheck.skipped).toBeNull()
    expect(rt.evolveSelfCheck.unauthorized).toHaveLength(1)
    expect(rt.evolveSelfCheck.unauthorized[0]!.asset_path).toBe('prompts/frozen/b.md')
    const escalates = ledger.queryEvents().filter((e) => e.event === 'ESCALATE')
    expect(escalates).toHaveLength(1)
    expect(escalates[0]!.note).toContain('prompts/frozen/b.md')
    expect(escalates[0]!.note).toContain('hash-mismatch') // nearMisses 摘要（近似命中原文）
    expect(escalates[0]!.company).toBe('demo')
    expect(lines.join('\n')).toContain('unauthorized=1')
    expect(lines.join('\n')).toContain('观察模式不阻断启动')
    expect(rt.engine).toBeDefined() // 观察模式：判负不阻启动
    await rt.stop() // 停机面照常
  })
})
