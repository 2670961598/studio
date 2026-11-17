/** Kimi 真实 2.1.1 形态离线 fixture（task-98 P0/P1；真实探针 /tmp/kimi-live-probe 脱敏副本）。 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { KimiAdapter } from '../../src/kimi.ts'
import type { StreamEvent, TaskBrief } from '@studio-next/contract'

const fakeCli = fileURLToPath(new URL('../fake-cli/fake-cli.mjs', import.meta.url))
const workdir = mkdtempSync(join(tmpdir(), 'kimi-live-test-'))
afterAll(() => rmSync(workdir, { recursive: true, force: true }))
const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/kimi/${name}`, import.meta.url))

function makeBrief(resume?: string): TaskBrief {
  const briefPath = join(workdir, 'brief.md')
  writeFileSync(briefPath, 'kimi real task brief')
  return { ticket: 'TEST-REAL', attempt: 1, briefPath, workspace: workdir, AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') }, ...(resume !== undefined ? { resume: { sessionId: resume, summaryPath: join(workdir, 'summary.json') } } : {}) }
}
async function withEnv(kvs: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(kvs)) { saved.set(k, process.env[k]); process.env[k] = v }
  try { await fn() } finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
}

describe('真实 kimi 2.1.1 形态（P0/P1 离线 fixture）', () => {
  it('真实 out7 + wire-main：合成 completed；session id 捕获；usage.record 合流（忽略 token_counting）', async () => {
    const root = mkdtempSync(join(workdir, 'kimi-home-'))
    const sessionId = 'session_54478d6b-3d9e-49b3-84b1-12bdde186354'
    const wireDir = join(root, 'sessions', 'wd_km-probe_22c1ccfb527a', sessionId, 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    writeFileSync(join(wireDir, 'wire.jsonl'), readFileSync(fixture('live-wire-main.jsonl')))
    await withEnv({ KIMI_CODE_HOME: root, FAKE_FIXTURE: fixture('live-out7.jsonl') }, async () => {
      const adapter = new KimiAdapter([process.execPath, fakeCli])
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(h.executorSessionId).toBe(sessionId)
      expect(collected.find((e) => e.type === 'turn_end')).toMatchObject({ type: 'turn_end', completed: true })
      expect(adapter.isCompleted(h)).toBe(true)
      const stats = await adapter.resultStats(h)
      // live wire 3 条 usage.record 合计；token_counting.turn_recorded 不双计
      expect(stats.tokens).toStrictEqual({ input: 23587, output: 120, cache_read: 54784, cache_creation: 0 })
      expect(adapter.exitCode(h)).toBe(0)
    })
  }, 10_000)

  it('续跑 argv 用 CLI session_<uuid>（-S），并带 -p <briefText>；真实 resume 流可完成', async () => {
    const sessionId = 'session_54478d6b-3d9e-49b3-84b1-12bdde186354'
    await withEnv({ FAKE_ECHO_ARGS: '1', FAKE_FIXTURE: fixture('live-resume.jsonl') }, async () => {
      const adapter = new KimiAdapter([process.execPath, fakeCli])
      const h = await adapter.launch(makeBrief(sessionId))
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      const first = collected[0]
      expect(first?.type).toBe('log')
      const text = first?.type === 'log' ? first.text : ''
      expect(text).toContain(`-S ${sessionId}`)
      expect(text).toContain('-p kimi real task brief')
      expect(adapter.isCompleted(h)).toBe(true)
    })
  }, 10_000)
})
