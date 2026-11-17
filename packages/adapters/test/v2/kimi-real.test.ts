/** Kimi 真实 2.1.1 形态离线 fixture（task-98 P0/P1；真实探针 /tmp/kimi-live-probe 脱敏副本）。 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      expect(stats.model).toBe('kimi-code/kimi-for-coding')
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

describe('task-123 wire 异步落盘重试', () => {
  it('wire 在进程退出后 ~500ms 才写 → 有界重试读到 model/usage 并挂 turn_end', async () => {
    const root = mkdtempSync(join(workdir, 'wire-late-'))
    const sid = 'session_54478d6b-3d9e-49b3-84b1-12bdde186354'
    const wireDir = join(root, 'sessions', 'wd_late_abc', sid, 'agents', 'main')
    const worker = join(root, 'worker.mjs')
    const out = fixture('live-out7.jsonl')
    const wire = fixture('live-wire-main.jsonl')
    writeFileSync(worker, `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('2.1.1'); process.exit(0) }
console.log(readFileSync(${JSON.stringify(out)}, 'utf8'))
setTimeout(() => { mkdirSync(${JSON.stringify(wireDir)}, { recursive: true }); writeFileSync(${JSON.stringify(join(wireDir, 'wire.jsonl'))}, readFileSync(${JSON.stringify(wire)})) }, 500)
await new Promise((r) => setTimeout(r, 700))
`, 'utf8')
    // 上面模板含 import 后语句：写为真正的 mjs 模块（顶层 await）
    writeFileSync(worker, `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('2.1.1'); process.exit(0) }
console.log(readFileSync(${JSON.stringify(out)}, 'utf8'))
setTimeout(() => { mkdirSync(${JSON.stringify(wireDir)}, { recursive: true }); writeFileSync(${JSON.stringify(join(wireDir, 'wire.jsonl'))}, readFileSync(${JSON.stringify(wire)})) }, 500)
await new Promise((r) => setTimeout(r, 700))
`, 'utf8')
    chmodSync(worker, 0o755)
    const savedHome = process.env['KIMI_CODE_HOME']; process.env['KIMI_CODE_HOME'] = root
    try {
      const adapter = new KimiAdapter([process.execPath, worker])
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      const stats = await adapter.resultStats(h)
      expect(stats.model).toBe('kimi-code/kimi-for-coding')
      expect(stats.tokens).toStrictEqual({ input: 23587, output: 120, cache_read: 54784, cache_creation: 0 })
      expect(collected.some((e) => e.type === 'log' && e.text.includes('wire.jsonl not found'))).toBe(false)
    } finally { if (savedHome === undefined) delete process.env['KIMI_CODE_HOME']; else process.env['KIMI_CODE_HOME'] = savedHome }
  }, 10_000)

  it('wire 始终缺失：有界等待超时后明示 log，不伪造 model/usage', async () => {
    const root = mkdtempSync(join(workdir, 'wire-timeout-'))
    const worker = join(root, 'worker.mjs')
    const out = fixture('live-out7.jsonl')
    writeFileSync(worker, `import { readFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('2.1.1'); process.exit(0) }
console.log(readFileSync(${JSON.stringify(out)}, 'utf8'))
`, 'utf8')
    chmodSync(worker, 0o755)
    const savedHome = process.env['KIMI_CODE_HOME']; process.env['KIMI_CODE_HOME'] = root
    try {
      const adapter = new KimiAdapter([process.execPath, worker])
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected.some((e) => e.type === 'log' && e.text.includes('wire.jsonl not found'))).toBe(true)
      const stats = await adapter.resultStats(h)
      expect(stats.model).toBeUndefined()
      expect(stats.tokens).toEqual({ input: 0, output: 0 })
    } finally { if (savedHome === undefined) delete process.env['KIMI_CODE_HOME']; else process.env['KIMI_CODE_HOME'] = savedHome }
  }, 10_000)
})
