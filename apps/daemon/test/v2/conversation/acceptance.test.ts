/**
 * 会话轮次按单验收覆盖测（studio-dev-646；docs/21-§七.4）
 *
 * 背景：全局 acceptance 是工程单口径（含 deliverables/plan.md），对话题用它必红。
 * 会话轮次按单覆盖为 `test -s REPORT.md`；本测钉：命中覆盖、非命中走全局、空覆盖 fail-closed。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcceptanceGateRunner } from '../../../src/engine/gate.ts'
import { CONVERSATION_ACCEPTANCE } from '../../../src/engine/conversation/protocol.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace(withReport: boolean): { workspace: string; briefPath: string } {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-conversation-gate-'))
  dirs.push(dir)
  if (withReport) writeFileSync(path.join(dir, 'REPORT.md'), '回复正文\n')
  return { workspace: dir, briefPath: path.join(dir, 'brief.md') }
}

describe('createAcceptanceGateRunner · acceptanceFor', () => {
  it('命中会话轮次 → 用覆盖命令（test -s REPORT.md）exit 0；不跑全局红命令', async () => {
    const gate = createAcceptanceGateRunner(['exit 7'], {
      acceptanceFor: (ticket) => (ticket === 'CHAT-1' ? CONVERSATION_ACCEPTANCE : undefined),
    })
    const ws = workspace(true)
    const outcome = await gate.run({ ticket: 'CHAT-1', attempt: 1, ...ws })
    expect(outcome.exitCode).toBe(0)
    expect(outcome.reportExists).toBe(true)
    expect(outcome.note).toContain('真验收闸门')
  })

  it('非会话单 → 沿用全局 acceptance（红命令仍红）', async () => {
    const gate = createAcceptanceGateRunner(['exit 7'], {
      acceptanceFor: (ticket) => (ticket === 'CHAT-1' ? CONVERSATION_ACCEPTANCE : undefined),
    })
    const outcome = await gate.run({ ticket: 'WORK-1', attempt: 1, ...workspace(true) })
    expect(outcome.exitCode).toBe(7)
  })

  it('覆盖为空数组 → fail-closed（不判过）', async () => {
    const gate = createAcceptanceGateRunner(['true'], { acceptanceFor: () => [] })
    const outcome = await gate.run({ ticket: 'CHAT-1', attempt: 1, ...workspace(true) })
    expect(outcome.exitCode).toBe(1)
    expect(outcome.note).toContain('验收命令为空')
  })

  it('REPORT 缺失 → 覆盖命令也不跑（四要件第 3 条先拦）', async () => {
    const gate = createAcceptanceGateRunner(['true'], { acceptanceFor: () => CONVERSATION_ACCEPTANCE })
    const outcome = await gate.run({ ticket: 'CHAT-1', attempt: 1, ...workspace(false) })
    expect(outcome.exitCode).toBe(1)
    expect(outcome.reportExists).toBe(false)
  })
})
