/**
 * outbound.test.ts —— IMPL-07-11「出站扫描承担面·出站闸＋三不入」V2 安全腿
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-11（冻结验收：`bun run test:v2 -- apps/daemon/test/v2/security` 绿；
 *     NEG-SEC-07/N-g「失败事件可判定＋全出口覆盖」；`node scripts/scan-repo-secrets.mjs` 命中
 *     即拒；三不入强制点测试）；
 *   - docs/v2/15 §4.4（SEC-SEC-04：出站扫描承担者＝统一出站闸，五出口；失败事件名入词表
 *     或显式 gap 不静默；负向探针「注入探针秘密后全部导出物检索不到该值」PRB-07 扩全出口）；
 *   - docs/v2/15 §4.5（SEC-SEC-05：三不入——库/提示词/日志各自的机器强制点）；
 *   - docs/v2/17 NEG-SEC-07/N-g（出站扫描失败事件可判定且覆盖全出口）；
 *   - docs/audit-DSF/V13-01（承担者/失败出口缺口的治理面：三个失败事件名不在冻结词表）。
 *
 * 断言纪律（plan/04 §1.9.4）：真闸实现＋core 真脱敏纯函数＋真扫描脚本子进程，**不 mock
 * 扫描算法、不重试**；探针值只作假凭据注入（不涉真实凭据）。五条用例组分别钉：
 *   ①五出口零泄漏（PRB-07 全出口扩面）；②NEG-SEC-07 失败可判定＋词表缺口显式/可翻转；
 *   ③三不入强制点（库/提示词/日志）；④仓面扫描脚本命中即拒/干净即过/本仓零新增。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEventName } from '@studio-next/contract'
import type {
  ActivityPage,
  Comment,
  FieldSchema,
  FlowPlatform,
  IssueCreate,
  IssueRecord,
  KbHit,
  Notification,
  SignedBody,
} from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import {
  OUTBOUND_EVENT_VOCAB_GAP,
  OUTBOUND_EXIT_IDS,
  OUTBOUND_MON_OBSERVATION_GAP,
  OutboundBlockedError,
  collectOutboundKnowns,
  createLedgerFailureSink,
  createOutboundGate,
  createStoreWriteGuard,
  isDeterminableOutboundFailure,
  parseOutboundFailureNote,
  wireServeOutboundGate,
  wrapNotifyOutbound,
  wrapPlatformWrite,
} from '../../../src/assembly/outbound-gate/index.ts'
import type {
  OutboundFailureRecord,
  OutboundGate,
  OutboundGateOptions,
} from '../../../src/assembly/outbound-gate/index.ts'

// ————————————————————— 探针夹具（假值，非真实凭据） —————————————————————

/** 探针 token（25 字符——命中 core 已知值替换阈值，不命中仓面扫描的长串规则） */
const PROBE_TOKEN = 'tok_probe_7f3c9a1e5b2d4c6f'
/** 探针 key（第二个已知值——多值同源验证） */
const PROBE_KEY = 'key-probe-b4e1d9c7'
const KNOWN = [PROBE_TOKEN, PROBE_KEY]
const FIXED_TS = 1_700_000_000_000

/** 与 core 替换标记同形（只断言标记形，不复制算法） */
const mark = (value: string): string => `<redacted:${String(value.length)}>`

function makeGate(opts: Partial<OutboundGateOptions> = {}): { gate: OutboundGate; lines: string[] } {
  const lines: string[] = []
  const options: OutboundGateOptions = {
    knowns: KNOWN,
    now: (): number => FIXED_TS,
    log: (line: string): void => {
      lines.push(line)
    },
    ...(opts.isEventName !== undefined ? { isEventName: opts.isEventName } : {}),
    ...(opts.onFailure !== undefined ? { onFailure: opts.onFailure } : {}),
    ...(opts.knowns !== undefined ? { knowns: opts.knowns } : {}),
  }
  return { gate: createOutboundGate(options), lines }
}

/** 捕获失败（断言的判负面） */
function blockedFailure(run: () => unknown): OutboundFailureRecord {
  try {
    run()
  } catch (err) {
    if (err instanceof OutboundBlockedError) return err.failure
    throw err
  }
  throw new Error('期望出站闸拦截，实际未拦截——fail-closed 断言失败')
}

// ————————————————————— 出口 wrapper 测试替身（结构同形，非 mock 算法） —————————————————————

interface PlatformCapture {
  readonly calls: { method: string; input: unknown }[]
}

function fakePlatform(capture: PlatformCapture): FlowPlatform {
  const issue = (id: string): IssueRecord => ({ id, title: '', state: 'x', updated: 't' })
  return {
    issues: {
      list: async (): Promise<IssueRecord[]> => [],
      get: async (id: string): Promise<IssueRecord> => issue(id),
      create: async (input: IssueCreate): Promise<IssueRecord> => {
        capture.calls.push({ method: 'issues.create', input })
        return { ...issue('T-1'), title: input.title }
      },
      transition: async (id: string): Promise<IssueRecord> => issue(id),
      setField: async (_id: string, _field: string, value: unknown): Promise<void> => {
        capture.calls.push({ method: 'issues.setField', input: value })
      },
    },
    comments: {
      add: async (id: string, body: SignedBody): Promise<void> => {
        capture.calls.push({ method: 'comments.add', input: { id, body } })
      },
      list: async (): Promise<Comment[]> => [],
    },
    fields: {
      schema: async (): Promise<FieldSchema[]> => [],
      provision: async (): Promise<void> => {},
    },
    kb: {
      upsert: async (path: string, md: string): Promise<void> => {
        capture.calls.push({ method: 'kb.upsert', input: { path, md } })
      },
      search: async (): Promise<KbHit[]> => [],
      get: async (): Promise<string> => '',
    },
    activity: { since: async (): Promise<ActivityPage> => ({ items: [], nextCursor: null }) },
    links: {
      link: async (): Promise<void> => {},
      children: async (): Promise<string[]> => [],
    },
    guards: {
      install: async (): Promise<void> => {},
      uninstall: async (): Promise<void> => {},
    },
  }
}

interface LedgerCapture {
  readonly ledger: Ledger
  readonly events: Record<string, unknown>[]
}

function fakeLedger(): LedgerCapture {
  const events: Record<string, unknown>[] = []
  const ledger = {
    appendEvent: (record: unknown): { id: string; appended: boolean } => {
      events.push(record as Record<string, unknown>)
      const id = (record as { id?: unknown }).id
      return { id: typeof id === 'string' ? id : 'x', appended: true }
    },
  } as unknown as Ledger
  return { ledger, events }
}

const SCANNER_PATH = join(fileURLToPath(new URL('../../../../..', import.meta.url)), 'scripts/scan-repo-secrets.mjs')

interface ScannerHit {
  readonly file: string
  readonly rule: string
  readonly line: number
  readonly valueHash: string
}

interface ScannerJson {
  readonly ok: boolean
  readonly rules: readonly string[]
  readonly newHits: readonly ScannerHit[]
  readonly baselineHits: readonly ScannerHit[]
  readonly staleBaseline: number
}

/** 子进程跑真扫描脚本（验收命令同体：`node scripts/scan-repo-secrets.mjs`） */
function runScanner(args: readonly string[]): { status: number; json: ScannerJson | undefined; raw: string } {
  const proc = spawnSync('node', [SCANNER_PATH, ...args], { encoding: 'utf8' })
  const raw = `${proc.stdout ?? ''}${proc.stderr ?? ''}`
  let json: ScannerJson | undefined
  if (proc.stdout !== null && proc.stdout.trim().length > 0) {
    try {
      json = JSON.parse(proc.stdout.trim()) as ScannerJson
    } catch {
      json = undefined
    }
  }
  return { status: proc.status ?? -1, json, raw }
}

/** 临时夹具目录（用完即删；测试面不往仓里落文件） */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'studio-outbound-scan-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ————————————————————— 一、五出口：目录/零泄漏/覆盖 —————————————————————

describe('五出口覆盖：目录是唯一定义，wired/gap 逐条可判（v2/15 §4.4；NEG-SEC-07）', () => {
  it('目录恰五项；wired=3、gap=2，缺口码精确（不静默）', () => {
    const { gate } = makeGate()
    const coverage = gate.coverage()
    expect(coverage.exits.map((e) => e.id)).toEqual([...OUTBOUND_EXIT_IDS])
    expect(coverage.exits).toHaveLength(5)
    expect(coverage.exits.filter((e) => e.status === 'wired').map((e) => e.id)).toEqual([
      'platform-write',
      'notify',
      'log-egress',
      'api-response',
    ])
    expect(coverage.gaps).toEqual(['evidence-export:no-export-channel'])
    expect(coverage.gapCount).toBe(1)
    expect(coverage.gaps.every((code) => code.includes(':'))).toBe(true)
  })

  it('装配行显式带剩余缺口＋词表缺口（serve 装配真实入口）', () => {
    const capture = fakeLedger()
    const lines: string[] = []
    const wiring = wireServeOutboundGate({
      env: {},
      ledger: capture.ledger,
      company: 'probe-co',
      dept: 'departments/研发部',
      issue: '-',
      clock: (): number => FIXED_TS,
      rawLog: (line: string): void => {
        lines.push(line)
      },
    })
    expect(wiring.startupLine).toContain('evidence-export:no-export-channel')
    expect(wiring.startupLine).not.toContain('api-response:api-assembly-not-wired')
    expect(wiring.startupLine).toContain('redaction-failed')
    expect(lines.join('\n')).toContain('outbound-gate')
  })

  it('knowns 收集：同源 env 键集（TAIGA_* / MATRIX_*）＋装配单元补充面', () => {
    const collected = collectOutboundKnowns({ TAIGA_TOKEN: PROBE_TOKEN }, [PROBE_KEY])
    expect(collected).toContain(PROBE_TOKEN)
    expect(collected).toContain(PROBE_KEY)
    // 短值不替换（与 core MIN_KNOWN_LENGTH 同阈值）——不得混进扫描集
    expect(collectOutboundKnowns({ TAIGA_TOKEN: 'short' })).toEqual([])
  })
})

describe('探针秘密五出口零泄漏（PRB-07 扩全出口）', () => {
  it('platform-write：issues.create/comments.add/kb.upsert 出站前过闸（真 wrapper）', async () => {
    const { gate } = makeGate()
    const capture: PlatformCapture = { calls: [] }
    const platform = wrapPlatformWrite(fakePlatform(capture), gate)
    await platform.issues.create({ title: `任务 ${PROBE_TOKEN}`, description: `描述 ${PROBE_KEY}` })
    await platform.comments.add('T-1', { author: 'p-001', body: `正文 ${PROBE_TOKEN}`, signature: '[公司·部·岗]' })
    await platform.kb.upsert('docs/kb.md', `知识 ${PROBE_KEY}`)
    const seen = JSON.stringify(capture.calls)
    expect(seen).not.toContain(PROBE_TOKEN)
    expect(seen).not.toContain(PROBE_KEY)
    expect(seen).toContain(mark(PROBE_TOKEN))
    expect(gate.coverage().exits.find((e) => e.id === 'platform-write')?.scans).toBe(3)
  })

  it('notify：Notification 出站前过闸（真 wrapper；面发送≠接受不变）', async () => {
    const { gate } = makeGate()
    const messages: Notification[] = []
    const face = wrapNotifyOutbound(
      {
        send: async (message: Notification): Promise<{ sent: readonly string[]; failed: readonly [] }> => {
          messages.push(message)
          return { sent: ['alert'], failed: [] }
        },
      },
      gate,
    )
    const report = await face.send(
      { kind: 'alert', title: `告警 ${PROBE_TOKEN}`, body: `正文 ${PROBE_KEY}`, links: [{ label: '证据', url: `https://example.test/${PROBE_TOKEN}` }] },
      { alert: true },
    )
    expect(report.sent).toEqual(['alert'])
    const seen = JSON.stringify(messages)
    expect(seen).not.toContain(PROBE_TOKEN)
    expect(seen).not.toContain(PROBE_KEY)
  })

  it('log-egress：日志行过闸，拦截/脱敏均不落原值', () => {
    const { gate } = makeGate()
    const redacted = gate.guardLog(`[serve] 派发 ${PROBE_TOKEN} 到 T-1`)
    expect(redacted).not.toContain(PROBE_TOKEN)
    expect(redacted).toContain(mark(PROBE_TOKEN))
    const envLine = gate.guardLog(`[serve] env TAIGA_PASSWORD=${PROBE_TOKEN} 就绪`)
    expect(envLine).not.toContain(PROBE_TOKEN)
    expect(envLine).toContain('TAIGA_PASSWORD=<redacted:env>')
  })

  it('evidence-export / api-response：wrapper 零泄漏（catalog gap 显式、不冒充满覆盖）', () => {
    const { gate } = makeGate()
    const evidence = gate.guardEvidenceExport(`证据导出：${PROBE_TOKEN}\n结论：通过`)
    expect(evidence).not.toContain(PROBE_TOKEN)
    const api = gate.guardApiResponse({ data: { title: PROBE_TOKEN, nested: { body: [PROBE_KEY] } }, count: 1 })
    expect(JSON.stringify(api)).not.toContain(PROBE_TOKEN)
    expect(JSON.stringify(api)).not.toContain(PROBE_KEY)
    // 生产出口已接线；evidence-export 仍是 gap（两条不同事实）
    const coverage = gate.coverage()
    expect(coverage.exits.find((e) => e.id === 'evidence-export')?.status).toBe('gap')
    expect(coverage.exits.find((e) => e.id === 'api-response')?.status).toBe('wired')
    expect(coverage.scanned).toBeGreaterThanOrEqual(2)
  })
})

// ————————————————————— 二、NEG-SEC-07/N-g：失败事件可判定＋词表缺口 —————————————————————

describe('NEG-SEC-07/N-g：失败事件可判定（确定性失败行，值零出现）', () => {
  it('redaction-failed：脱敏后仍检出已知值＝阻断并留可判定记录', () => {
    // 已知值恰是替换标记的子串（`redacted` 在 `<redacted:N>` 内）——真实的自校验失败面
    const { gate } = makeGate({ knowns: ['redacted'] })
    const failure = blockedFailure(() => gate.guard('platform-write', 'redacted'))
    expect(failure.code).toBe('redaction-failed')
    expect(failure.surface).toBe('exit')
    expect(failure.point).toBe('platform-write')
    expect(isDeterminableOutboundFailure(failure)).toBe(true)
    const parsed = parseOutboundFailureNote(failure.note)
    expect(parsed).toEqual({
      surface: 'exit',
      point: 'platform-write',
      code: 'redaction-failed',
      action: 'blocked',
      vocabulary: 'gap',
      fallbackEvent: 'ESCALATE',
    })
    expect(failure.note).not.toContain('redacted=') // 结构行不回显被扫值
  })

  it('unknown-shape：不可扫描叶子＝阻断（不能保证扫干净的形态不放行）', () => {
    const { gate } = makeGate()
    const failure = blockedFailure(() => gate.guardApiResponse({ ok: true, fn: (): number => 1 }))
    expect(failure.code).toBe('unknown-shape')
    expect(isDeterminableOutboundFailure(failure)).toBe(true)
    expect(parseOutboundFailureNote(failure.note)?.point).toBe('api-response')
    expect(gate.coverage().blocked).toBe(1)
  })

  it('notify-blocked：通知扫描失败＝不发送（软失败面）且双记录可判', async () => {
    const { gate } = makeGate({ knowns: ['redacted'] })
    const sent: Notification[] = []
    const face = wrapNotifyOutbound(
      {
        send: async (message: Notification): Promise<{ sent: readonly string[]; failed: readonly [] }> => {
          sent.push(message)
          return { sent: ['alert'], failed: [] }
        },
      },
      gate,
    )
    const report = await face.send({ kind: 'alert', title: 'redacted', body: 'content' }, { alert: true })
    expect(report.sent).toEqual([])
    expect(report.failed).toEqual([{ target: 'outbound-gate', reason: 'notify-blocked' }])
    expect(sent).toEqual([]) // 底层面零调用＝fail-closed 的判据
    const codes = gate.failures().map((f) => f.code)
    expect(codes).toContain('redaction-failed')
    expect(codes).toContain('notify-blocked')
    const blocked = gate.failures().find((f) => f.code === 'notify-blocked')
    expect(blocked !== undefined && isDeterminableOutboundFailure(blocked)).toBe(true)
  })

  it('词表缺口显式：三个文档失败名未入冻结词表（contract 词表唯一判定者）', () => {
    expect(OUTBOUND_EVENT_VOCAB_GAP.status).toBe('open')
    expect([...OUTBOUND_EVENT_VOCAB_GAP.names].sort()).toEqual(['notify-blocked', 'redaction-failed', 'unknown-shape'])
    for (const name of OUTBOUND_EVENT_VOCAB_GAP.names) expect(isEventName(name)).toBe(false)
    expect(isEventName(OUTBOUND_EVENT_VOCAB_GAP.fallbackEvent)).toBe(true) // 落账承载是冻结名
    expect(OUTBOUND_EVENT_VOCAB_GAP.proposalRef).toContain('IMPL-07-11')
    // 观察面呈现也是显式缺口：台账可判≠监控行已覆盖（v2/15 §4.4-③）
    expect(OUTBOUND_MON_OBSERVATION_GAP.status).toBe('open')
    expect(OUTBOUND_MON_OBSERVATION_GAP.target).toContain('MON-12')
  })

  it('词表增补后自动翻转：registered＋vocab=registered（机制先就位）', () => {
    const { gate } = makeGate({
      knowns: ['redacted'],
      isEventName: (candidate: string): boolean => candidate === 'redaction-failed',
    })
    const failure = blockedFailure(() => gate.guard('log-egress', 'redacted'))
    expect(failure.vocabulary.registered).toBe(true)
    expect(failure.vocabulary.gap).toBe(false)
    expect(failure.note).toContain('vocab=registered')
    expect(parseOutboundFailureNote(failure.note)?.vocabulary).toBe('registered')
  })

  it('留证落点：ESCALATE 冻结事件 note 携可判定行（零新增事件名；值不入台账）', () => {
    const capture = fakeLedger()
    const sink = createLedgerFailureSink({
      ledger: capture.ledger,
      company: 'probe-co',
      actor: 'daemon/outbound-gate',
      dept: 'departments/研发部',
      issue: '-',
      clock: (): number => FIXED_TS,
      log: (): void => {},
    })
    const { gate } = makeGate({ onFailure: sink })
    blockedFailure(() => gate.guardApiResponse({ fn: (): number => 1 }))
    expect(capture.events).toHaveLength(1)
    const event = capture.events[0]
    expect(event?.['event']).toBe('ESCALATE')
    expect(isEventName(String(event?.['event']))).toBe(true) // 冻结词表既有名（零新事件名）
    const note = String(event?.['note'])
    expect(note.startsWith('outbound-gate: ')).toBe(true)
    const parsed = parseOutboundFailureNote(note.slice('outbound-gate: '.length))
    expect(parsed?.code).toBe('unknown-shape')
    expect(parsed?.point).toBe('api-response')
    expect(note).not.toContain(PROBE_TOKEN)
  })
})

// ————————————————————— 三、三不入强制点（库/提示词/日志） —————————————————————

describe('三不入强制点（v2/15 §4.5；SEC-SEC-05）', () => {
  it('不入库：appendEvent 记录 note 脱敏、payload_hash 完整性引用原样保留', () => {
    const { gate } = makeGate()
    const capture = fakeLedger()
    const guarded = createStoreWriteGuard(capture.ledger, gate)
    const hash = `sha256:${'ab'.repeat(32)}`
    guarded.appendEvent({
      id: '01HQ0000000000000000000000',
      ts: FIXED_TS,
      company: 'probe-co',
      issue: 'T-1',
      event: 'ESCALATE',
      actor: 'p-001',
      attempt: 1,
      level: 1,
      dept: 'departments/研发部',
      tokens: { input: 0 },
      payload_hash: hash,
      note: `台账日志 ${PROBE_TOKEN} 与 ${PROBE_KEY}`,
    })
    expect(capture.events).toHaveLength(1)
    const recorded = capture.events[0]
    expect(String(recorded?.['note'])).not.toContain(PROBE_TOKEN)
    expect(String(recorded?.['note'])).not.toContain(PROBE_KEY)
    expect(String(recorded?.['note'])).toContain(mark(PROBE_TOKEN))
    // 结构标识列不是自由文本承载位：sha256 形恰似长随机串，脱敏它＝毁证据链
    expect(recorded?.['payload_hash']).toBe(hash)
    expect(gate.coverage().threeNotIn.find((p) => p.id === 'store')?.scans).toBe(1)
  })

  it('不入库：脱敏自校验失败＝拒写（底层零写入）', () => {
    const { gate } = makeGate({ knowns: ['redacted'] })
    const capture = fakeLedger()
    const guarded = createStoreWriteGuard(capture.ledger, gate)
    const failure = blockedFailure(() =>
      guarded.appendEvent({ id: '01HQ0000000000000000000001', note: 'redacted', event: 'ESCALATE' }),
    )
    expect(failure.surface).toBe('three-not-in')
    expect(failure.point).toBe('store')
    expect(failure.code).toBe('redaction-failed')
    expect(capture.events).toEqual([])
  })

  it('不入提示词：严格档只换已知值（教学示例原样可见），失败阻断且可判', () => {
    const { gate } = makeGate()
    const text = `任务书：示例 password=example123 必须原样；真实 ${PROBE_TOKEN} 不外泄`
    const scanned = gate.guardPromptText(text)
    expect(scanned).not.toContain(PROBE_TOKEN)
    expect(scanned).toContain(mark(PROBE_TOKEN))
    expect(scanned).toContain('password=example123') // 内部供给面不做形状兜底（docs/80-§11.2.1 分工）
    expect(gate.promptRedactor('前缀 ' + PROBE_KEY)).not.toContain(PROBE_KEY)
    const strict = makeGate({ knowns: ['redacted'] })
    const failure = blockedFailure(() => strict.gate.guardPromptText('redacted'))
    expect(failure.point).toBe('prompt')
    expect(failure.code).toBe('redaction-failed')
    expect(strict.gate.coverage().threeNotIn.find((p) => p.id === 'prompt')?.blocked).toBe(1)
  })

  it('不入日志：env 名带值打印检出即抹值＋失败可判定（值形态双判据）', () => {
    const { gate } = makeGate()
    const line = gate.guardLog(`[gateway] boot MATRIX_SHARED_SECRET=${PROBE_TOKEN} ok`)
    expect(line).not.toContain(PROBE_TOKEN)
    expect(line).toContain('MATRIX_SHARED_SECRET=<redacted:env>')
    const failures = gate.failures()
    const envFailure = failures.find((f) => f.code === 'env-print-blocked')
    expect(envFailure !== undefined && isDeterminableOutboundFailure(envFailure)).toBe(true)
    expect(envFailure?.action).toBe('redacted')
    expect(envFailure?.point).toBe('log')
    expect(gate.coverage().threeNotIn.find((p) => p.id === 'log')?.scans).toBe(1)
  })
})

// ————————————————————— 四、仓面扫描门禁脚本（IMPL-07-11 验收） —————————————————————

describe('scripts/scan-repo-secrets.mjs：命中即拒、干净即过、本仓零新增', () => {
  it('本机路径/IP/凭证模式夹具 → exit 1，五规则逐条命中（值不回显）', () => {
    withTempDir((dir) => {
      // 夹具值全部由片段拼装：测试源码本身不得成为仓面扫描的新命中
      const hostPath = ['', 'Users', 'probe-owner', 'company', 'org-config.yaml'].join('/')
      const privateIp = [192, 168, 7, 9].join('.')
      const privateKey = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('')
      const provider = ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'].join('')
      const assignment = ['password=', 'Zq7Xk2Lm9Pw4'].join('')
      writeFileSync(join(dir, 'leak.txt'), [hostPath, privateIp, privateKey, provider, assignment].join('\n'), 'utf8')
      const run = runScanner(['--root', dir, '--json'])
      expect(run.status).toBe(1)
      expect(run.json?.ok).toBe(false)
      const rules = (run.json?.newHits ?? []).map((h) => h.rule)
      expect(new Set(rules)).toEqual(
        new Set(['host-absolute-path', 'private-ip', 'private-key', 'provider-token', 'credential-assign']),
      )
      // 输出只报位置与指纹：值不得回显（否则扫描器自己成为泄漏面）
      for (const hit of run.json?.newHits ?? []) {
        expect(hit.valueHash).toMatch(/^[0-9a-f]{16}$/)
        expect(JSON.stringify(hit)).not.toContain(privateIp)
        expect(JSON.stringify(hit)).not.toContain(hostPath)
      }
    })
  })

  it('干净目录 → exit 0（ok=true，零命中）', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'notes.md'), '常规说明：无本机路径、无内网 IP、无凭证。\n', 'utf8')
      const run = runScanner(['--root', dir, '--json'])
      expect(run.status).toBe(0)
      expect(run.json?.ok).toBe(true)
      expect(run.json?.newHits).toEqual([])
    })
  })

  it('本仓扫描 → exit 0（新增命中=0；存量基线显式登记>0，--strict 量存量债）', () => {
    const run = runScanner(['--json'])
    expect(run.raw).not.toBe('')
    expect(run.status).toBe(0)
    expect(run.json?.newHits).toEqual([])
    // 存量债不静默：基线计数可见、过期基线须清理（只减不增）
    expect((run.json?.baselineHits ?? []).length).toBeGreaterThan(0)
    expect(run.json?.staleBaseline).toBe(0)
    // --strict（目标态零命中）当前应判负——基线未清前不得宣称「仓面已净」
    const strict = runScanner(['--strict'])
    expect(strict.status).toBe(1)
  })
})
