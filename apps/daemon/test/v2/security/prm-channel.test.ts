/**
 * test/v2/security/prm-channel —— 派发前策略投影通道（生产接线面）真栈契约
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §2.2／§三 EXEC-01：派发前策略投影校验 fail-closed——失败**不启动、不降级
 *     宽权限**（NEG-RUN-01「缺失/摘要不符/过期/引用不一致」）；
 *   - docs/v2/15 §二 SEC-SIG-04（签名者独立于持有者｜信任锚｜单调代次防重放；目标未证，
 *     本件只证信封闸机制面）／GAP-V2-02；
 *   - docs/v2/14 §六（生成器归 daemon 侧；本件是唯一生产调用点）／docs/v2/12 §1.6（PRM-G7）；
 *   - docs/17 §2（主循环七相位：接线面在「派发」相位前置，不新增相位）／docs/17 §6
 *     （收割四要件判据不变——本单只加派发前置）。
 *
 * 断言纪律：真引擎＋真 SQLite 台账＋fake 平台/执行体（fake 只替代外部端口——docs/v2/17 §一 V3）；
 * 正向只证「派发进行了验签并消费投影」；负向只证「拒绝面」——零 DISPATCH、零在途、平台不迁移。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verifyProjectionEnvelope, type ProjectionEnvelope } from '@studio-next/core'
import {
  createTicket,
  createWorkStack,
  disposeWorkStacks,
  eventsNamed,
  issueOf,
  runTicks,
} from '../records/fixtures/work-stack.ts'
import {
  PRM_ENVELOPE_FILE,
  prmEnvelopePath,
  prmNodeCrypto,
  prmSigningKeyPath,
  readPublishedProjection,
  resolveDispatchProjection,
  type DispatchProjectionRequest,
} from '../../../src/engine/prm/dispatch-projection.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

const T0 = Date.parse('2026-11-01T00:00:00.000Z')

function requestOver(rootDir: string, workspace: string, over: Partial<DispatchProjectionRequest> = {}): DispatchProjectionRequest {
  return {
    company: 'demo',
    ticket: 'T-PRM-1',
    attempt: 1,
    personRef: 'person:AGENT-1',
    executor: 'fake-work',
    executorVersion: '1.0.0',
    capabilityRefs: ['capability:fake-work@1.0.0'],
    grantRefs: ['person:AGENT-1'],
    planRef: 'plan:T-PRM-1#att1',
    secretTypes: [],
    workspace,
    rootDir,
    atMs: T0,
    ...over,
  }
}

describe('生产接线：派发前生成→签名→落盘→回读验签→消费', () => {
  it('真引擎派发一拍：DISPATCH note 携 prm 锚；封套落工位且可验签；任务书携投影段', async () => {
    const stack = await createWorkStack('prm-ok')
    const ticket = await createTicket(stack)
    await runTicks(stack, 1)

    const dispatches = eventsNamed(stack.ledger, ticket, 'DISPATCH')
    expect(dispatches).toHaveLength(1)
    const note = dispatches[0]?.note ?? ''
    expect(note).toContain(';prm=sha256:')
    expect(note).toContain(';prm.sig=ok;')
    expect(note).toContain(';prm.gen=1')

    const rootDir = path.join(stack.root, 'var')
    const workspace = path.join(rootDir, 'workspaces', ticket, 'att1')
    const envelopePath = path.join(workspace, PRM_ENVELOPE_FILE)
    expect(envelopePath).toBe(prmEnvelopePath(workspace))

    // 边界锚：工位内不得出现 `.studio-next/`（wkey 文件通道已废的既有回归锚）
    expect(existsSync(path.join(workspace, '.studio-next'))).toBe(false)

    // 消费面：封套由 daemon 控制面密钥签发，可被独立验签（信任锚=状态目录密钥）
    const key = readFileSync(prmSigningKeyPath(rootDir), 'utf8').trim()
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8')) as ProjectionEnvelope
    expect(envelope.keyId).toBe(`k-${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`)
    const verified = verifyProjectionEnvelope(envelope, {
      crypto: prmNodeCrypto,
      keys: { [envelope.keyId]: key },
      nowMs: T0 + 1000,
      holderRef: 'person:AGENT-1',
      requireLaunchable: true,
    })
    expect(verified.kind).toBe('ok')
    if (verified.kind === 'ok') {
      expect(verified.value.generation).toBe(envelope.generation)
      expect(verified.value.projection.digest).toBe(envelope.projection.digest)
    }

    // 交付面：任务书携投影段（摘要/代次/keyId；不含密钥值）
    const brief = readFileSync(path.join(workspace, 'brief.md'), 'utf8')
    expect(brief).toContain('策略投影（PRM · SEC-SIG-04 信封闸）')
    expect(brief).toContain(envelope.projection.digest)
    expect(brief).not.toContain(key)
  })

  it('fail-closed：签发密钥坏（过短）＝拒派——零 launch、零 DISPATCH、平台状态不迁移', async () => {
    const stack = await createWorkStack('prm-badkey')
    const rootDir = path.join(stack.root, 'var')
    mkdirSync(path.join(rootDir, 'prm'), { recursive: true })
    writeFileSync(prmSigningKeyPath(rootDir), 'short', 'utf8')

    const ticket = await createTicket(stack)
    const before = await issueOf(stack, ticket)
    await runTicks(stack, 2)

    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(0)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(0)
    const after = await issueOf(stack, ticket)
    expect(after.state).toBe(before.state)
  })

  it('fail-closed：代次簿坏 JSON＝拒派且不重置（防静默清空重放面）', async () => {
    const stack = await createWorkStack('prm-badgen')
    const rootDir = path.join(stack.root, 'var')
    const workspace = path.join(rootDir, 'workspaces', 'T-PRM-2', 'att1')
    mkdirSync(path.join(rootDir, 'prm'), { recursive: true })
    writeFileSync(path.join(rootDir, 'prm', 'generations.json'), '{not json', 'utf8')

    const face = resolveDispatchProjection(requestOver(rootDir, workspace, { ticket: 'T-PRM-2' }))
    expect(face.kind).toBe('rejected')
    if (face.kind === 'rejected') expect(face.subcause).toBe('prm-generation-state-corrupt')
  })
})

describe('篡改→拒（消费面读回校验）与单调代次（防重放）', () => {
  it('回读封套被改一字节（工位内封套可被持有者触达）＝验签拒，不消费', async () => {
    const stack = await createWorkStack('prm-tamper')
    const rootDir = path.join(stack.root, 'var')
    const workspace = path.join(rootDir, 'workspaces', 'T-PRM-3', 'att1')
    mkdirSync(workspace, { recursive: true })

    const published = resolveDispatchProjection(requestOver(rootDir, workspace, { ticket: 'T-PRM-3' }))
    expect(published.kind).toBe('ok')
    if (published.kind !== 'ok') return

    // 篡改投影内容（不重算摘要）：摘要不符＝拒（NEG-RUN-01 摘要不符）
    const raw = JSON.parse(readFileSync(prmEnvelopePath(workspace), 'utf8')) as Record<string, unknown>
    const projection = raw['projection'] as { segments: Record<string, { sourceRefs: string[] }> }
    projection.segments['tools']!.sourceRefs = ['cap:evil=1']
    writeFileSync(prmEnvelopePath(workspace), `${JSON.stringify(raw)}\n`, 'utf8')

    const readBack = readPublishedProjection(workspace)
    expect('kind' in readBack).toBe(false)
    const key = readFileSync(prmSigningKeyPath(rootDir), 'utf8').trim()
    const face = verifyProjectionEnvelope(readBack, {
      crypto: prmNodeCrypto,
      keys: { [(readBack as ProjectionEnvelope).keyId]: key },
      nowMs: T0,
      lastGeneration: 0,
      holderRef: 'person:AGENT-1',
      requireLaunchable: true,
    })
    expect(face.kind).toBe('err')
    if (face.kind === 'err') expect(face.error.subcause).toBe('prm-digest-mismatch')
  })

  it('同单重复派发＝代次递增（1→2）；旧封套代次回退＝重放拒', async () => {
    const stack = await createWorkStack('prm-gen')
    const rootDir = path.join(stack.root, 'var')
    const workspace1 = path.join(rootDir, 'workspaces', 'T-PRM-4', 'att1')
    const workspace2 = path.join(rootDir, 'workspaces', 'T-PRM-4', 'att2')
    mkdirSync(workspace1, { recursive: true })
    mkdirSync(workspace2, { recursive: true })

    const first = resolveDispatchProjection(requestOver(rootDir, workspace1, { ticket: 'T-PRM-4', attempt: 1 }))
    const second = resolveDispatchProjection(requestOver(rootDir, workspace2, { ticket: 'T-PRM-4', attempt: 2 }))
    expect(first.kind).toBe('ok')
    expect(second.kind).toBe('ok')
    if (first.kind !== 'ok' || second.kind !== 'ok') return
    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)

    const key = readFileSync(prmSigningKeyPath(rootDir), 'utf8').trim()
    const replayed = verifyProjectionEnvelope(first.envelope, {
      crypto: prmNodeCrypto,
      keys: { [first.keyId]: key },
      nowMs: T0,
      lastGeneration: second.generation,
      holderRef: 'person:AGENT-1',
      requireLaunchable: true,
    })
    expect(replayed.kind).toBe('err')
    if (replayed.kind === 'err') expect(replayed.error.subcause).toBe('prm-generation-replay')
  })
})

describe('与 v0 面边界（不互相冒充）', () => {
  it('本通道只消费 core/prm 执行策略投影，不 import v0 公司投影面', () => {
    const source = readFileSync(new URL('../../../src/engine/prm/dispatch-projection.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*company\/src\/projection/)
    expect(source).not.toContain("from '@studio-next/company'")
    // 生成/验签的唯一来源＝core prm（信封闸）；本件不另写生成器或验签算法
    expect(source).toContain("from '@studio-next/core'")
  })
})
