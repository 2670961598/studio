/**
 * authority-evidence.test —— 授权判定证据落账 + shadow→enforce 接线（studio-dev-579）
 *
 * 依据：
 *   - docs/v2/08 §1.9（授权判定证据：events 落点、形状=AuthorityEvidence、SQL 可复算）；
 *   - docs/v2/15 §一 SEC-FC-08（禁止「只 log 不落账」与无限期 shadow；enforce 期限）；
 *   - docs/17-§2（写路径经 gated-platform 收口）、docs/17-§6（判定必须留痕）。
 *
 * 断言面（对应任务书验收②③④）：
 *   1. 生产装配（wireGatedPlatform + 真 openLedger）写一次平台写 → events 表恰一条
 *      `GW_AUTHORITY_DECISION`，note 含 action/ticket/mode/state/evidenceId，payload_hash=evidenceId；
 *   2. evidenceId 可由 note 字段复算（规范化摘要单点）；
 *   3. 启动日志可读出 mode(shadow/enforce) 与 requireClaim；
 *   4. shadow（放行+留痕）与 enforce（无主张拒、底层零调用）两态红绿；
 *   5. 证据落账失败 → 本次写被拒（gw-authority-evidence-failed，无留痕不放行）；
 *   6. shadow 过 authorityEnforceBy → 启动即 CONFIG_INVALID（不许无限期 shadow）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FlowPlatform } from '@studio-next/contract'
import type { AuthorityRefusal, PolicyState } from '@studio-next/core'
import { CONTROL_TICKET } from '@studio-next/gateway'
import { openLedger, type Ledger } from '@studio-next/store'
import { recomputeAuthorityEvidenceId } from '../../../src/engine/tools/authority-gate.ts'
import { AUTHORITY_EVIDENCE_EVENT } from '../../../src/engine/tools/authority-evidence.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import { wireGatedPlatform } from '../../../src/assembly/platform/wire.ts'
import { GATEWAY_SECRET_ENV, daemonIdentity, parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const NOW = Date.parse('2026-11-03T00:00:00.000Z')
const SECRET_TEXT = '0123456789abcdef0123456789abcdef'
const CONFIG = parseDaemonConfig(['db: ./var/x.sqlite', 'company: demo', 'platform: fake', ''].join('\n'))
const IDENTITY = daemonIdentity(CONFIG, DEMO_SNAPSHOT, { env: { [GATEWAY_SECRET_ENV]: SECRET_TEXT } })

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newLedger(): { ledger: Ledger; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studio-579-auth-'))
  dirs.push(dir)
  return { ledger: openLedger(join(dir, 'ledger.sqlite')), dir }
}

function wiring(ledger: Ledger, extra: { requireClaim?: boolean; enforceBy?: string } = {}): {
  wired: FlowPlatform
  lines: string[]
} {
  const lines: string[] = []
  const wired = wireGatedPlatform(createFakePlatform(), CONFIG, IDENTITY, () => NOW, (line) => lines.push(line), {
    authorityEvidence: {
      ledger,
      company: CONFIG.company,
      actor: IDENTITY.author,
      dept: IDENTITY.ctx.dept,
      level: IDENTITY.ctx.level,
    },
    ...extra,
  })
  return { wired, lines }
}

function authorityEvents(ledger: Ledger): ReturnType<Ledger['queryEvents']> {
  return ledger.queryEvents({ company: CONFIG.company }).filter((event) => event.event === AUTHORITY_EVIDENCE_EVENT)
}

describe('证据落账：events/GW_AUTHORITY_DECISION（非仅日志）', () => {
  it('shadow 写一次平台写 → 恰一行证据，note 含 action/ticket/mode/state/evidenceId，payload_hash=evidenceId', async () => {
    const { ledger } = newLedger()
    try {
      const { wired } = wiring(ledger)
      await wired.issues.create({ title: '证据落账正向' })
      const rows = authorityEvents(ledger)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row?.issue).toBe(CONTROL_TICKET) // create 无 args.issue：控制面哨兵单号（如实）
      const note = JSON.parse(row?.note ?? '{}') as Record<string, unknown>
      expect(note).toMatchObject({
        schemaRef: 'authority-evidence/v1',
        action: 'ctl-create',
        ticket: CONTROL_TICKET,
        mode: 'shadow',
        state: 'uncovered',
      })
      expect(typeof note['evidenceId']).toBe('string')
      expect(row?.payload_hash).toBe(note['evidenceId'])
      // 复算：note 字段 → 同一 evidenceId（审计面单点）
      expect(
        recomputeAuthorityEvidenceId({
          ticket: String(note['ticket']),
          action: String(note['action']),
          atMs: Number(note['atMs']),
          state: note['state'] as PolicyState,
          chain: note['chain'] as readonly string[],
          refusals: note['refusals'] as readonly AuthorityRefusal[],
        }),
      ).toBe(note['evidenceId'])
    } finally {
      ledger.close()
    }
  })

  it('真单号落账：transition 的 args.issue 作为证据 ticket（不再全记控制面哨兵）', async () => {
    const { ledger } = newLedger()
    try {
      const { wired } = wiring(ledger)
      const created = await wired.issues.create({ title: '真单号' })
      await wired.issues.transition(created.id, '已派发')
      const rows = authorityEvents(ledger)
      expect(rows.map((row) => row.issue)).toContain(created.id)
    } finally {
      ledger.close()
    }
  })

  it('证据落账失败 → 本次写被拒（gw-authority-evidence-failed；无留痕不放行）', async () => {
    const broken = { appendEvent: (): never => { throw new Error('ledger down') } }
    const lines: string[] = []
    const wired = wireGatedPlatform(createFakePlatform(), CONFIG, IDENTITY, () => NOW, (line) => lines.push(line), {
      authorityEvidence: { ledger: broken, company: CONFIG.company, actor: IDENTITY.author, dept: IDENTITY.ctx.dept, level: IDENTITY.ctx.level },
    })
    await expect(wired.issues.create({ title: '落账失败' })).rejects.toMatchObject({
      category: 'EXTERNAL_REJECT',
      subcause: 'gw-authority-evidence-failed',
    })
    expect(lines.join('\n')).toContain('证据落账失败')
  })
})

describe('模式可见与红绿对照：shadow 放行+留痕 / enforce 无主张拒', () => {
  it('启动日志读出 mode=shadow requireClaim=false 与 evidence 落点', () => {
    const { ledger } = newLedger()
    try {
      const { lines } = wiring(ledger)
      const log = lines.join('\n')
      expect(log).toContain('mode=shadow requireClaim=false')
      expect(log).toContain(`evidence=events/${AUTHORITY_EVIDENCE_EVENT}`)
    } finally {
      ledger.close()
    }
  })

  it('无 sink 的测试/对照装配：启动日志明示 log-only 降级（不冒充已落账）', () => {
    const lines: string[] = []
    wireGatedPlatform(createFakePlatform(), CONFIG, IDENTITY, () => NOW, (line) => lines.push(line))
    expect(lines.join('\n')).toContain('evidence=log-only【降级')
  })

  it('enforce：启动日志 mode=enforce / requireClaim=true；无主张写被拒且底层零调用', async () => {
    const { ledger } = newLedger()
    try {
      let calls = 0
      const inner = createFakePlatform()
      const platform: FlowPlatform = {
        ...inner,
        issues: { ...inner.issues, create: async (input) => { calls += 1; return inner.issues.create(input) } },
      }
      const lines: string[] = []
      const wired = wireGatedPlatform(platform, CONFIG, IDENTITY, () => NOW, (line) => lines.push(line), {
        authorityEvidence: { ledger, company: CONFIG.company, actor: IDENTITY.author, dept: IDENTITY.ctx.dept, level: IDENTITY.ctx.level },
        requireClaim: true,
      })
      expect(lines.join('\n')).toContain('mode=enforce requireClaim=true')
      await expect(wired.issues.create({ title: 'enforce 拒' })).rejects.toMatchObject({
        category: 'EXTERNAL_REJECT',
        subcause: 'gw-authority-required',
      })
      expect(calls).toBe(0)
      // 拒也留痕：拒绝不是「无记录」收场（17-§6）
      const rows = authorityEvents(ledger)
      expect(rows).toHaveLength(1)
      const note = JSON.parse(rows[0]?.note ?? '{}') as Record<string, unknown>
      expect(note).toMatchObject({ mode: 'enforce', state: 'uncovered' })
    } finally {
      ledger.close()
    }
  })

  it('shadow 已过 authorityEnforceBy → 启动拒（CONFIG_INVALID/authority-enforce-overdue）', () => {
    const { ledger } = newLedger()
    try {
      expect(() => wiring(ledger, { enforceBy: '2026-01-01' })).toThrow(/authority-enforce-overdue/)
    } finally {
      ledger.close()
    }
  })
})

describe('配置键：authorityRequireClaim / authorityEnforceBy（解析即验）', () => {
  it('缺省＝shadow（undefined→wire 按 false 处理）；显式 true/false 与 ISO 日期可解析', () => {
    expect(CONFIG.authorityRequireClaim).toBeUndefined()
    const cfg = parseDaemonConfig(
      ['db: ./var/x.sqlite', 'company: demo', 'platform: fake', 'authorityRequireClaim: true', 'authorityEnforceBy: 2026-12-31', ''].join('\n'),
    )
    expect(cfg.authorityRequireClaim).toBe(true)
    expect(cfg.authorityEnforceBy).toBe('2026-12-31')
  })

  it('坏日期/坏布尔＝CONFIG_INVALID 明报（不猜不取整）', () => {
    expect(() => parseDaemonConfig('authorityEnforceBy: 2026-02-31\n')).toThrow(/authority-enforce-by-invalid/)
    expect(() => parseDaemonConfig('authorityEnforceBy: 2026/12/31\n')).toThrow(/authority-enforce-by-invalid/)
  })
})
