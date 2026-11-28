/**
 * terminal-backfill —— task-158 / FIX-04 ②（Kimi 总审 P0-04）：已有证据原位复验、补终态（不重跑模型）
 *
 * 依据：docs/quality/idempotent-closeout.md §2（复验）/§5（测试面）；
 *       docs/sentinel-logs/全面Review拆分-2026-11-28.md §2.1 FIX-04 验收 ③④；
 *       docs/quality/reviews/2026-11-28/00-overall-review.md §2.1 P0-04。
 * 现场（只读取证）：工位已有 REPORT.md（size=10847）+ 真验收闸 exit=0，仅 turn_end 自述
 * error=401 → 判「四要件缺【终态 completed】」整单回退新单重跑——证据在、模型白跑。
 * 修法：仅缺「终态自述」且其余三要件齐 + 注入真验收闸 → 复验闸独立复跑（零模型调用）：
 * 过=补终态走成功链（GATE_PASS note 留痕「来源=证据复验」）；不过=照旧 GATE_FAIL（尾段留复验结果）。
 *
 * 断言面：
 *   正例：REPORT size>0 ∧ 首闸 exit=0 ∧ 自述非 completed → 补终态、launch 恰 1 次（模型调用=0 次新增）
 *   负例（四要件/验收语义零放宽）：REPORT 缺／首闸 exit≠0／复验 exit≠0／无真验收闸（占位闸）→ GATE_FAIL 原样
 *   纯函数：资格判定序、复验闸 fail-closed（size=0／抛异常／exit≠0）
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { harvestRequirementsOf } from '../../../src/engine/harvest/batch.ts'
import {
  reverifyTerminalByEvidence,
  TERMINAL_BACKFILL_GAP,
  terminalBackfillIneligibility,
} from '../../../src/engine/harvest/reverify.ts'
import { createAcceptanceGateRunner, type GateInput, type GateRunner } from '../../../src/engine/gate.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, eventsOf, runTicks, type WorkTestStack } from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

const real = (cmd: string): GateRunner => createAcceptanceGateRunner([cmd])

async function backfillStack(label: string, gate: { gateRunner: GateRunner; reverifyGate?: GateRunner }) {
  let launches = 0
  const stack = await createWorkStack(label, {}, { gate, onLaunch: () => { launches += 1 } })
  stack.mode.value = 'external_error' // REPORT+summary 落盘、输出非空、turn_end completed=false（429 自述）
  const ticket = await createTicket(stack, `补终态：${label}`)
  return { stack, ticket, launches: () => launches }
}

function passNotes(stack: WorkTestStack, ticket: string): string[] {
  return eventsNamed(stack.ledger, ticket, 'GATE_PASS').map((e) => e.note ?? '')
}
function failNotes(stack: WorkTestStack, ticket: string): string[] {
  return eventsNamed(stack.ledger, ticket, 'GATE_FAIL').map((e) => e.note ?? '')
}

describe('T3 正例：工位已有 REPORT + 真验收闸 exit=0、仅缺终态自述 → 原位复验补终态、不重跑模型', () => {
  it('external_error 自述（429）→ 复验闸过 → GATE_PASS 补终态（留痕来源=证据复验）→ 证据就绪 → CLOSE；launch 恰 1 次', async () => {
    const { stack, ticket, launches } = await backfillStack('fix04-t3-ok', { gateRunner: real('true'), reverifyGate: real('true') })
    await runTicks(stack, 8)
    const passes = passNotes(stack, ticket)
    expect(passes).toHaveLength(1)
    expect(passes[0]).toContain('四要件齐（completed=补终态[来源=证据复验；原自述 completed=false；')
    expect(passes[0]).toContain('REPORT size=')
    expect(passes[0]).toMatch(/；\[1\] exit=0/)
    expect(passes[0]).toMatch(/errorKind=/) // task-157 分类尾段照旧（供给错如实留痕）
    expect(failNotes(stack, ticket)).toHaveLength(0)
    expect(eventsOf(stack.ledger, ticket).map((e) => e.event)).toContain('CLOSE')
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(1)
    expect(launches()).toBe(1) // 模型调用次数=0 次新增：复验只跑闸门
    expect(stack.ledger.listWorkRecords({ issue: ticket }).map((r) => `${r.attempt}:${r.status}`)).toEqual(['1:done'])
  })

  it('incomplete 自述（无 error 的未完成自述）同款：证据齐即补终态——自述槽由复验替代，不放宽三要件', async () => {
    const { stack, ticket, launches } = await backfillStack('fix04-t3-incomplete', { gateRunner: real('true'), reverifyGate: real('true') })
    stack.mode.value = 'incomplete'
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(1)
    expect(passNotes(stack, ticket)[0]).toContain('来源=证据复验')
    expect(eventsOf(stack.ledger, ticket).map((e) => e.event)).toContain('CLOSE')
    expect(launches()).toBe(1)
  })
})

describe('T3 负例：四要件/验收语义零放宽——不具资格或复验不过=照旧 GATE_FAIL', () => {
  it('复验闸 exit≠0 → 不补终态：GATE_FAIL 四要件缺项文案不动，尾段留「补终态复验不过」', async () => {
    const { stack, ticket, launches } = await backfillStack('fix04-t3-reverify-red', { gateRunner: real('true'), reverifyGate: real('false') })
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(0)
    const fails = failNotes(stack, ticket)
    expect(fails.length).toBeGreaterThanOrEqual(1)
    expect(fails[0]).toContain('四要件缺【终态 completed】')
    expect(fails[0]).toContain('补终态复验不过（复验闸门 exit=1；')
    expect(launches()).toBeGreaterThanOrEqual(2) // 判不过=照旧回退重派（不吞失败）
  })

  it('REPORT 未落盘（no_report）→ 无补终态资格：GATE_FAIL 原样（无复验尾段），重派', async () => {
    const { stack, ticket, launches } = await backfillStack('fix04-t3-no-report', { gateRunner: real('true'), reverifyGate: real('true') })
    stack.mode.value = 'no_report'
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(0)
    const fails = failNotes(stack, ticket)
    expect(fails[0]).toContain('REPORT 落盘')
    expect(fails[0]).not.toContain('补终态')
    expect(launches()).toBeGreaterThanOrEqual(2)
  })

  it('首闸 exit≠0（验收红）→ 无资格：GATE_FAIL 原样（复验闸不得越过首闸）', async () => {
    const { stack, ticket } = await backfillStack('fix04-t3-first-gate-red', { gateRunner: real('false'), reverifyGate: real('true') })
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(0)
    expect(failNotes(stack, ticket)[0]).toContain('闸门 exit=0')
    expect(failNotes(stack, ticket)[0]).not.toContain('补终态')
  })

  it('无真验收闸（v0 占位闸门 exit0=模拟）→ 无资格：external_error 自述照旧 GATE_FAIL——改动前世界零变化', async () => {
    let launches = 0
    const stack = await createWorkStack('fix04-t3-placeholder', {}, { onLaunch: () => { launches += 1 } })
    stack.mode.value = 'external_error'
    const ticket = await createTicket(stack, '占位闸：无补终态资格')
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(0)
    expect(failNotes(stack, ticket)[0]).toContain('四要件缺【终态 completed】')
    expect(failNotes(stack, ticket)[0]).not.toContain('补终态')
    expect(launches).toBeGreaterThanOrEqual(2)
  })

  it('有真验收闸但未注入复验闸 → 仍无资格（复验面须显式注入，不借用首闸身份）', async () => {
    const { stack, ticket } = await backfillStack('fix04-t3-no-reverifier', { gateRunner: real('true') })
    await runTicks(stack, 8)
    expect(passNotes(stack, ticket)).toHaveLength(0)
    expect(failNotes(stack, ticket)[0]).toContain('四要件缺【终态 completed】')
    expect(failNotes(stack, ticket)[0]).not.toContain('补终态')
  })
})

describe('T3 纯函数：资格判定序 + 复验闸 fail-closed', () => {
  const reverifier: GateRunner = { run: async () => ({ exitCode: 0, reportExists: true, reportPath: '/x/REPORT.md', note: '真验收闸门：REPORT size=9；[1] exit=0' }) }
  const req = (over: Partial<Parameters<typeof harvestRequirementsOf>[0]>) =>
    harvestRequirementsOf({ completed: false, nonEmptyOutput: true, reportExists: true, exit0: true, terminalObserved: true, terminalError: 'x', ...over })

  it('判定序：四要件齐→终态未观测→输出空→REPORT 缺→首闸 exit≠0→无真验收闸；全过=undefined', () => {
    expect(terminalBackfillIneligibility(req({ completed: true }), reverifier)).toBe('四要件齐（无需补终态）')
    expect(terminalBackfillIneligibility(req({ terminalObserved: false }), reverifier)).toBe('终态未观测（未采集≠完成，EXEC-05）')
    expect(terminalBackfillIneligibility(req({ nonEmptyOutput: false }), reverifier)).toBe('输出为空')
    expect(terminalBackfillIneligibility(req({ reportExists: false }), reverifier)).toBe('REPORT 未落盘')
    expect(terminalBackfillIneligibility(req({ exit0: false }), reverifier)).toBe('首闸 exit≠0')
    expect(terminalBackfillIneligibility(req({}), undefined)).toBe('无真验收闸（占位闸门 exit0=模拟，无补终态资格）')
    expect(terminalBackfillIneligibility(req({}), reverifier)).toBeUndefined()
  })

  it('复验：REPORT size=0 → 不过且不跑闸；闸抛异常 → fail-closed 留痕不上抛；exit≠0 → 不过；全过 → ok 携 size 与闸 note', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sn-reverify-'))
    try {
      const reportPath = path.join(dir, 'REPORT.md')
      writeFileSync(reportPath, '', 'utf8')
      let runs = 0
      const counting: GateRunner = { run: async () => { runs += 1; return { exitCode: 0, reportExists: true, reportPath } } }
      const input: GateInput = { ticket: 'T-1', attempt: 1, workspace: dir, briefPath: path.join(dir, 'brief.md') }
      expect(await reverifyTerminalByEvidence({ reverifier: counting, input, reportPath })).toEqual({ ok: false, reason: 'REPORT 复验 size=0（须 >0）' })
      expect(runs).toBe(0)
      writeFileSync(reportPath, 'report-body', 'utf8')
      expect(await reverifyTerminalByEvidence({ reverifier: { run: async () => { throw new Error('spawn EPERM') } }, input, reportPath })).toEqual({ ok: false, reason: '复验闸异常：spawn EPERM' })
      expect(await reverifyTerminalByEvidence({ reverifier: { run: async () => ({ exitCode: 2, reportExists: true, reportPath, note: '验收红' }) }, input, reportPath })).toEqual({ ok: false, reason: '复验闸门 exit=2；验收红' })
      expect(await reverifyTerminalByEvidence({ reverifier: { run: async () => ({ exitCode: 0, reportExists: false, reportPath }) }, input, reportPath })).toEqual({ ok: false, reason: '复验闸门 exit=0；（无 note）' })
      expect(await reverifyTerminalByEvidence({ reverifier: reverifier, input, reportPath })).toEqual({ ok: true, reportSize: 'report-body'.length, note: '真验收闸门：REPORT size=9；[1] exit=0' })
      expect(TERMINAL_BACKFILL_GAP).toContain('来源=证据复验')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
