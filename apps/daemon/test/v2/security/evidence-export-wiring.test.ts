/**
 * evidence-export-wiring.test.ts —— 第 5 出口「证据导出」生产接线（studio-dev-533）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §4.4（SEC-SEC-04）：出站闸覆盖五出口；**无扫描通道的出口登记缺口不得静默
 *     放行**——本单补齐 evidence-export（此前 `evidence-export:no-export-channel` gap）；
 *   - docs/v2/15 §4.5（SEC-SEC-05）：三不入强制点（本单只接出站面，不改三不入）；
 *   - docs/v2/08 §1.1-1.4（证据包/来源锚）：归档证据件不得被静默改写——证据导出面处置=
 *     **拒发**（命中即拒绝该次导出，不脱敏改写），完整性引用（40/64 hex 摘要）保留；
 *   - docs/17-§2 主循环七相位（相位 4「收割」尾 P3 对账步）／§6 收割四要件（四要件判定
 *     本单零改动，收账/对账是后置步）。
 *
 * 接线面（生产）：`runServe 装配序`把 `outbound.gate.guardEvidenceExport` 注入
 * `engineConfig.evidenceExportGuard`，收割两处归档写出前过闸：
 *   ① `engine/jobs/output-account.ts`（GATE_PASS 岗产物收账）；
 *   ② `engine/jobs/harvest-recon.ts`（相位 4 尾 P3 对账补收）。
 * 拒发=本次不写归档（fail-closed），note/onProblem/事件如实留痕；四要件与收割结论不变。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { DEFAULT_SERVE_CONFIG, buildServeRuntime, type ServeConfig } from '../../../src/assembly/serve.ts'
import {
  OutboundBlockedError,
  createOutboundGate,
  isDeterminableOutboundFailure,
  parseOutboundFailureNote,
} from '../../../src/assembly/outbound-gate/index.ts'
import type { OutboundGate } from '../../../src/assembly/outbound-gate/index.ts'
import { accountJobOutput } from '../../../src/engine/jobs/output-account.ts'
import { runHarvestRecon } from '../../../src/engine/jobs/harvest-recon.ts'

// ————————————————————— 夹具（假值；非真实凭据） —————————————————————
const PROBE_TOKEN = 'tok_probe_7f3c9a1e5b2d4c6f'
const PROBE_KEY = 'key-probe-b4e1d9c7'
/** 完整性引用（sha256 形；证据链引用，不得被抹除） */
const DIGEST = 'f7e7f7f72918335e7564e8de1b64a89c08d06354f938c193d3dd5dd0f86220fd'
const T0 = 1_700_000_000_000
const COMPANY = 'demo'
const DEPT = 'departments/研发部'

const SNAPSHOT: CompanySnapshot = {
  slug: COMPANY,
  name: 'Demo 公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '研发部', path: DEPT, parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: DEPT }],
  jobs: [],
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-evidence-export-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function gateOf(knowns: readonly string[] = [PROBE_TOKEN, PROBE_KEY]): OutboundGate {
  return createOutboundGate({ knowns, now: (): number => T0 })
}

let seq = 0
function appendEvent(ledger: Ledger, issue: string, event: string, note?: string): void {
  seq += 1
  ledger.appendEvent({
    id: `01JTEST${String(seq).padStart(19, '0')}`,
    ts: T0 + seq,
    company: COMPANY,
    issue,
    event,
    actor: 'daemon',
    attempt: 1,
    level: 2,
    dept: DEPT,
    tokens: { input: 0 },
    ...(note !== undefined ? { note } : {}),
  } as never)
}

function jobOf(jobId: string, output: string): JobRecord {
  return {
    job_id: jobId,
    company: COMPANY,
    dept: DEPT,
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload: { type: 'report', output },
    next_run_at: 0,
  }
}

/** 岗单台账语料：PATROL 锚（job=）＋可选 GATE_PASS（report= 锚） */
function seedJobTicket(ledger: Ledger, ticket: string, jobId: string, output: string, reportPath?: string): void {
  appendEvent(ledger, ticket, 'PATROL', `job=${jobId}`)
  if (reportPath !== undefined) appendEvent(ledger, ticket, 'GATE_PASS', `四要件齐（completed/非空/REPORT/exit0）；report=${reportPath}`)
  ledger.upsertJob(jobOf(jobId, output))
}

describe('第 5 出口 gate 语义：拒发档 + 完整性引用保留（v2/15 §4.4）', () => {
  it('命中已知秘密值＝拒绝该次证据导出（不脱敏改写、记录可判定）', () => {
    const gate = gateOf()
    let failure: unknown
    try {
      gate.guardEvidenceExport(`# REPORT\n证据 ${PROBE_TOKEN}\n`)
    } catch (err) {
      failure = err
    }
    expect(failure instanceof OutboundBlockedError).toBe(true)
    if (!(failure instanceof OutboundBlockedError)) throw failure
    expect(failure.failure.point).toBe('evidence-export')
    expect(failure.failure.code).toBe('redaction-failed')
    expect(isDeterminableOutboundFailure(failure.failure)).toBe(true)
    expect(parseOutboundFailureNote(failure.failure.note)?.point).toBe('evidence-export')
    expect(gate.coverage().exits.find((e) => e.id === 'evidence-export')?.blocked).toBe(1)
  })

  it('完整性引用（40/64 hex 摘要）保留原值，不被当成长随机串抹除', () => {
    const gate = gateOf()
    const text = `# REPORT\n证据哈希 sha256:${DIGEST}\n结论：通过\n`
    expect(gate.guardEvidenceExport(text)).toBe(text)
  })

  it('证据正文含英文 slug/UUID/长标题（≥32 位标识）→ 放行且逐字节不变（studio-dev-733）', () => {
    const gate = gateOf([])
    const text = [
      '# REPORT',
      '去重键 worker-9d4469aa-4de8-459a-9f10-534dd457b244',
      'uuid 6be29ffa-c38d-4446-956b-6651ae65fa47',
      '标题 clearroute-releases-open-source-platform-to-govern-enterprise-ai-agents',
      'slug delivered_with_declared_cost_source_break',
    ].join('\n')
    expect(gate.guardEvidenceExport(text)).toBe(text)
    expect(gate.failures()).toHaveLength(0)
    expect(gate.coverage().exits.find((e) => e.id === 'evidence-export')?.blocked).toBe(0)
  })

  it('仅形状文本（未命中 knowns）不再按 unknown-shape 拒发；已知秘密值仍由第一用例拒发（口径变更见 REPORT）', () => {
    // studio-dev-733 口径：证据导出面关闭形态兜底（slug/UUID/长标题是合法证据内容）；
    // 只拒已知秘密值残留（见上方「命中已知秘密值」用例）。本用例显式锁定新旧语义差。
    const gate = gateOf([])
    const bearer = `Authorization: Bearer ${'A1b2C3d4E5f6G7h8I9j0K1l2'}`
    expect(gate.guardEvidenceExport(bearer)).toBe(bearer)
    expect(gate.coverage().exits.find((e) => e.id === 'evidence-export')?.blocked).toBe(0)
  })
})

describe('生产接线①：收割 GATE_PASS 岗产物收账（output-account）归档前过闸', () => {
  it('干净证据（含 sha256 完整性引用）→ 归档成功且与工位副本逐字节一致（P3 哈希幂等不受影响）', () => {
    const ledger = openLedger(path.join(root, 'acct-ok.sqlite'))
    try {
      const companyDir = path.join(root, 'acct-ok-company')
      const ws = path.join(root, 'acct-ok-ws')
      mkdirSync(ws, { recursive: true })
      const reportPath = path.join(ws, 'REPORT.md')
      const text = `# REPORT\n证据哈希 sha256:${DIGEST}\n结论：通过\n`
      writeFileSync(reportPath, text, 'utf8')
      seedJobTicket(ledger, 'T-1', 'report-job', 'reports/研发部/', reportPath)
      const gate = gateOf()
      const r = accountJobOutput({
        ledger,
        ticket: 'T-1',
        reportPath,
        companyDir,
        now: () => T0,
        guardEvidenceExport: (t): string => gate.guardEvidenceExport(t),
      })
      expect(r.noteSuffix).toContain(';output=')
      const archived = readFileSync(r.target as string, 'utf8')
      expect(archived).toBe(text) // 不改写（拒发档不脱敏；完整性引用保留）
      expect(gate.coverage().exits.find((e) => e.id === 'evidence-export')?.scans).toBe(1)
    } finally {
      ledger.close()
    }
  })

  it('命中探针秘密 → 拒发：目标零落盘、note 如实留痕、闸失败记录可判定', () => {
    const ledger = openLedger(path.join(root, 'acct-blocked.sqlite'))
    try {
      const companyDir = path.join(root, 'acct-blocked-company')
      const ws = path.join(root, 'acct-blocked-ws')
      mkdirSync(ws, { recursive: true })
      const reportPath = path.join(ws, 'REPORT.md')
      writeFileSync(reportPath, `# REPORT\n证据 ${PROBE_TOKEN}\n`, 'utf8')
      seedJobTicket(ledger, 'T-2', 'report-job', 'reports/研发部/', reportPath)
      const gate = gateOf()
      const problems: string[] = []
      const r = accountJobOutput({
        ledger,
        ticket: 'T-2',
        reportPath,
        companyDir,
        now: () => T0,
        onProblem: (m) => problems.push(m),
        guardEvidenceExport: (t): string => gate.guardEvidenceExport(t),
      })
      expect(r.noteSuffix).toContain('output-err=证据导出拒发')
      expect(r.target).toBeUndefined()
      expect(problems).toHaveLength(1)
      expect(gate.failures()).toHaveLength(1)
      expect(gate.failures()[0]?.point).toBe('evidence-export')
      expect(readFileSync(reportPath, 'utf8')).toContain(PROBE_TOKEN) // 工位副本不动
      const archivedDir = path.join(companyDir, 'reports/研发部')
      expect(existsSync(archivedDir) ? readdirCount(archivedDir) : 0).toBe(0)
    } finally {
      ledger.close()
    }
  })

  it('sidecar summary 命中 → 归档 REPORT 已写、侧车被拒发（sidecar-err 留痕，哨兵门另行处置）', () => {
    const ledger = openLedger(path.join(root, 'acct-sidecar.sqlite'))
    try {
      const companyDir = path.join(root, 'acct-sidecar-company')
      const ws = path.join(root, 'acct-sidecar-ws')
      mkdirSync(ws, { recursive: true })
      const reportPath = path.join(ws, 'REPORT.md')
      const summaryPath = path.join(ws, 'summary.json')
      writeFileSync(reportPath, '# REPORT\n结论：通过\n', 'utf8')
      writeFileSync(summaryPath, JSON.stringify({ note: PROBE_KEY }), 'utf8')
      seedJobTicket(ledger, 'T-3', 'report-job', 'reports/研发部/', reportPath)
      const gate = gateOf()
      const r = accountJobOutput({
        ledger,
        ticket: 'T-3',
        reportPath,
        companyDir,
        now: () => T0,
        summaryPath,
        guardEvidenceExport: (t): string => gate.guardEvidenceExport(t),
      })
      expect(r.noteSuffix).toContain(';output=')
      expect(r.sidecarSuffix).toContain('sidecar-err')
      expect(r.sidecarTarget).toBeUndefined()
    } finally {
      ledger.close()
    }
  })
})

/** 目录内普通文件数（不引入额外依赖） */
function readdirCount(dir: string): number {
  try {
    return readdirSync(dir).length
  } catch {
    return 0
  }
}

describe('生产接线②：相位 4 尾 P3 对账补收（harvest-recon）归档前过闸', () => {
  it('缺归档补收：干净证据 → repaired=1 且归档与工位副本一致', () => {
    const ledger = openLedger(path.join(root, 'recon-ok.sqlite'))
    try {
      const companyDir = path.join(root, 'recon-ok-company')
      const ws = path.join(root, 'recon-ok-ws')
      mkdirSync(ws, { recursive: true })
      const reportPath = path.join(ws, 'REPORT.md')
      const text = `# REPORT\n证据哈希 sha256:${DIGEST}\n结论：通过\n`
      writeFileSync(reportPath, text, 'utf8')
      seedJobTicket(ledger, 'T-4', 'report-job', 'reports/研发部/', reportPath)
      const gate = gateOf()
      const r = runHarvestRecon({
        ledger,
        companyDir,
        emit: (): void => {},
        guardEvidenceExport: (t): string => gate.guardEvidenceExport(t),
      })
      expect(r.repaired).toBe(1)
      expect(r.manual).toBe(0)
      const archivedDir = path.join(companyDir, 'reports/研发部')
      const names = readdirSync(archivedDir)
      expect(names).toHaveLength(1)
      expect(readFileSync(path.join(archivedDir, names[0] as string), 'utf8')).toBe(text)
    } finally {
      ledger.close()
    }
  })

  it('缺归档补收：命中探针秘密 → 拒发（manual++、目标零落盘、REPORT_MISSING 事件在案）', () => {
    const ledger = openLedger(path.join(root, 'recon-blocked.sqlite'))
    try {
      const companyDir = path.join(root, 'recon-blocked-company')
      const ws = path.join(root, 'recon-blocked-ws')
      mkdirSync(ws, { recursive: true })
      const reportPath = path.join(ws, 'REPORT.md')
      writeFileSync(reportPath, `# REPORT\n证据 ${PROBE_TOKEN}\n结论：通过\n`, 'utf8')
      seedJobTicket(ledger, 'T-5', 'report-job', 'reports/研发部/', reportPath)
      const gate = gateOf()
      const emitted: string[] = []
      const problems: string[] = []
      const r = runHarvestRecon({
        ledger,
        companyDir,
        emit: (name, ticket): void => {
          emitted.push(`${name}:${ticket}`)
        },
        onProblem: (m) => problems.push(m),
        guardEvidenceExport: (t): string => gate.guardEvidenceExport(t),
      })
      expect(r.repaired).toBe(0)
      expect(r.manual).toBe(1)
      expect(emitted).toContain('REPORT_MISSING:T-5')
      expect(problems.join('\n')).toContain('出站闸拦截（redaction-failed）')
      const archivedDir = path.join(companyDir, 'reports/研发部')
      expect(existsSync(archivedDir) ? readdirCount(archivedDir) : 0).toBe(0)
      expect(gate.failures()[0]?.point).toBe('evidence-export')
    } finally {
      ledger.close()
    }
  })

  it('确定性拒发：同单同 srcHash 只过闸一次（跨拍跳过、不刷事件）；内容变化/new 单正常补收', () => {
    const ledger = openLedger(path.join(root, 'recon-blocked-retry.sqlite'))
    try {
      const companyDir = path.join(root, 'recon-blocked-retry-company')
      const ws = path.join(root, 'recon-blocked-retry-ws')
      mkdirSync(ws, { recursive: true })
      const blockedPath = path.join(ws, 'REPORT.md')
      writeFileSync(blockedPath, `# REPORT\n证据 ${PROBE_TOKEN}\n结论：通过\n`, 'utf8')
      seedJobTicket(ledger, 'T-5R', 'report-job', 'reports/研发部/', blockedPath)
      const gate = gateOf()
      let guardCalls = 0
      const guard = (t: string): string => {
        guardCalls += 1
        return gate.guardEvidenceExport(t)
      }
      const emitted: string[] = []
      const problems: string[] = []
      const run = (): ReturnType<typeof runHarvestRecon> =>
        runHarvestRecon({ ledger, companyDir, emit: (name, ticket): void => { emitted.push(`${name}:${ticket}`) }, onProblem: (m) => problems.push(m), guardEvidenceExport: guard })
      const first = run()
      expect(first.repaired).toBe(0)
      expect(guardCalls).toBe(1)
      expect(emitted.filter((line) => line === 'HARVEST_INVALID:T-5R')).toHaveLength(1)
      // 第二拍（模拟下一轮 recon）：同内容——不再过闸、不再落事件
      const second = run()
      expect(second.repaired).toBe(0)
      expect(guardCalls).toBe(1)
      expect(emitted.filter((line) => line === 'HARVEST_INVALID:T-5R')).toHaveLength(1)
      expect(gate.failures()).toHaveLength(1) // 出站闸只记首次阻断
      // 内容修好（hash 变）→ 自动重试并放行
      writeFileSync(blockedPath, `# REPORT\n证据已清理\n结论：通过\n`, 'utf8')
      const third = run()
      expect(third.repaired).toBe(1)
      expect(guardCalls).toBe(2)
      // 新增单（新 ticket）正常补收，不受旧单跳过表影响
      const cleanPath = path.join(ws, 'REPORT-clean.md')
      writeFileSync(cleanPath, '# REPORT\n结论：通过\n', 'utf8')
      seedJobTicket(ledger, 'T-6R', 'report-job', 'reports/研发部/', cleanPath)
      const fourth = run()
      expect(fourth.repaired).toBe(1)
    } finally {
      ledger.close()
    }
  })
})

describe('生产接线③：runServe 装配序（buildServeRuntime）真实注入＋装配行可读', () => {
  it('启动装配行含五出口 wired=5 / gap=0 与 evidence-export=wired（真机 boot 日志同源）', async () => {
    const cfg: ServeConfig = {
      ...DEFAULT_SERVE_CONFIG,
      db: path.join(root, 'serve.sqlite'),
      platform: 'fake',
      company: COMPANY,
      rootDir: path.join(root, 'serve-root'),
      tickMs: 10,
      maxActionsPerTick: 4,
      maxInflight: 2,
      stallAfterMs: 60_000,
      stallKillAfterAlarms: 0,
      laneTtlMs: 30 * 60_000,
      breakerThreshold: 3,
      autoApprove: false,
      jobs: false,
      jobPollMs: 15_000,
      matrix: false,
      fileWatch: false,
      cadence: false,
      sla: false,
      reloadWatch: false,
    }
    const ledger = openLedger(cfg.db)
    const lines: string[] = []
    const runtime = buildServeRuntime(cfg, ledger, SNAPSHOT, { log: (line) => lines.push(line), clock: () => T0 })
    try {
      const boot = lines.join('\n')
      expect(boot).toContain('[outbound-gate] 五出口：wired=5 / gap=0')
      expect(boot).toContain('evidence-export=wired')
      expect(boot).toContain('guardEvidenceExport：拒发档')
    } finally {
      await runtime.stop()
    }
  })
})
