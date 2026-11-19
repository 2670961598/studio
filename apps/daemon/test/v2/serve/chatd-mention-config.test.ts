/**
 * chatd 唤起源配置面测试（M4-1 接线收口，team task-136）
 *
 * 覆盖（提案 docs/plan/07-…-2026-11-19.md §5.4 配置面收口）：
 *   - 缺省零漂移：mentionSource=matrix、chatdSocket/mentionPollMs 不写=undefined；
 *   - chatd 选中：chatdSocket 显式绝对路径直通；缺省推导 <companyDir>/var/workbench/chat.sock；
 *   - fail-closed：非法 mentionSource 值／相对 chatdSocket／非正整数 mentionPollMs／
 *     无 companyDir 又未配 socket／与 matrix: true 双开 → CONFIG_INVALID 拒启；
 *   - 装配纪律：mentionSource: chatd 开而未注入工厂 → buildServeRuntime CONFIG_INVALID
 *     （matrix 判例同款），注入后注册表含 chatd 源（manifest 名一致）；
 *   - healthz 加法观测：mentionSource 字段注入才出现于 body（不改协议——旧探针忽略未知字段）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { buildHealthz } from '../../../src/assembly/api/healthz.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { buildServeRuntime, DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

const BASE = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')
const TMP = mkdtempSync(path.join(tmpdir(), 'sn-chatd-cfg-'))

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

/** fake 栈 daemon.yaml（buildServeRuntime 直装用——零外部依赖，lifecycle e2e 同款） */
function fakeYaml(extra: readonly string[] = []): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    `db: ${q(path.join(TMP, 'ledger.sqlite'))}`,
    'platform: fake',
    'company: demo',
    `rootDir: ${q(path.join(TMP, 'var'))}`,
    'tickMs: 25',
    ...extra,
  ].join('\n')
}

describe('mentionSource/chatdSocket/mentionPollMs（解析面）', () => {
  it('缺省：mentionSource=matrix（生产现状零漂移）、chatdSocket/mentionPollMs 不写=undefined', () => {
    const cfg = parseDaemonConfig(BASE)
    expect(cfg.mentionSource).toBe('matrix')
    expect(cfg.chatdSocket).toBeUndefined()
    expect(cfg.mentionPollMs).toBeUndefined()
  })

  it('mentionSource: chatd + companyDir → chatdSocket 缺省推导 <companyDir>/var/workbench/chat.sock（绝对路径）', () => {
    const companyDir = path.join(TMP, 'company-a')
    const cfg = parseDaemonConfig(`${BASE}\nmentionSource: chatd\ncompanyDir: ${JSON.stringify(companyDir)}`)
    expect(cfg.mentionSource).toBe('chatd')
    expect(cfg.chatdSocket).toBe(path.join(path.resolve(companyDir), 'var/workbench/chat.sock'))
    expect(path.isAbsolute(cfg.chatdSocket ?? '')).toBe(true)
  })

  it('显式 chatdSocket 绝对路径直通；mentionPollMs 正整数直通', () => {
    const sock = path.join(TMP, 'custom.sock')
    const cfg = parseDaemonConfig(`${BASE}\nmentionSource: chatd\nchatdSocket: ${JSON.stringify(sock)}\nmentionPollMs: 5000`)
    expect(cfg.chatdSocket).toBe(sock)
    expect(cfg.mentionPollMs).toBe(5000)
  })

  it('非法 mentionSource 值 → CONFIG_INVALID（值域 matrix|chatd）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nmentionSource: slack`)).toThrow(/CONFIG_INVALID.*mentionSource.*matrix\|chatd/)
  })

  it('chatdSocket 相对路径 → CONFIG_INVALID（socket 定位不许含糊）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nmentionSource: chatd\nchatdSocket: var/run/chat.sock`)).toThrow(/chatdSocket 须为绝对路径/)
  })

  it('mentionPollMs 非正整数 → CONFIG_INVALID（busy-loop 面拒启不兜底）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nmentionSource: chatd\nmentionPollMs: 0`)).toThrow(/mentionPollMs 须为正整数/)
  })

  it('mentionSource: chatd 与 matrix: true 互斥 → CONFIG_INVALID（双唤起源=双写）', () => {
    const text = [
      BASE,
      'mentionSource: chatd',
      `companyDir: ${JSON.stringify(TMP)}`,
      'matrix: true',
      'matrixHomeserverUrl: http://127.0.0.1:8008',
      'matrixUserId: @bot:studio.local',
    ].join('\n')
    expect(() => parseDaemonConfig(text)).toThrow(/互斥/)
  })

  it('chatd 缺 chatdSocket 且无 companyDir → CONFIG_INVALID（不猜 cwd 相对路径）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nmentionSource: chatd`)).toThrow(/缺 chatdSocket 且无 companyDir/)
  })
})

describe('buildServeRuntime 装配纪律（开而未注入=CONFIG_INVALID，matrix 判例）', () => {
  it('mentionSource: chatd 未注入 chatdSource → 拒启；注入工厂 → 注册表含 chatd 源', async () => {
    const cfg = parseDaemonConfig(fakeYaml([`mentionSource: chatd\nchatdSocket: ${JSON.stringify(path.join(TMP, 'chat.sock'))}`]))
    const ledger = openLedger(path.resolve(cfg.db))
    try {
      expect(() => buildServeRuntime(cfg, ledger, DEMO_SNAPSHOT, { log: () => {} })).toThrow(
        /CONFIG_INVALID：mentionSource: chatd 需注入 chatd 源工厂/,
      )
      const built = buildServeRuntime(cfg, ledger, DEMO_SNAPSHOT, {
        log: () => {},
        chatdSource: () => ({
          name: 'chatd',
          start: (): void => undefined,
          stop: (): void => undefined,
        }),
      })
      expect(built.sources.list().some((entry) => entry.source.name === 'chatd')).toBe(true)
      expect(built.sources.list().find((entry) => entry.source.name === 'chatd')?.manifest?.name).toBe('chatd')
      await built.stop()
    } finally {
      try {
        ledger.close()
      } catch {
        // 已随 runtime.stop 收口（lifecycle e2e 同款 swallow——不掩盖断言失败）
      }
    }
  })
})

describe('healthz 加法观测（mentionSource 状态；不改协议）', () => {
  const baseInput = {
    pid: 1,
    startedAt: 0,
    now: 1_000,
    tick: { seq: 1, count: 1, lastAt: 999, tickMs: 25 },
    chain: { ok: true, checkedAt: 999, events: 1, tipPrefix: 'x' },
  }

  it('注入 mentionSource → body 带字段；不注入 → 字段不出现（旧探针零感知）', () => {
    expect(buildHealthz({ ...baseInput, mentionSource: 'chatd' }).body.mentionSource).toBe('chatd')
    expect(buildHealthz({ ...baseInput, mentionSource: 'matrix' }).body.mentionSource).toBe('matrix')
    expect(buildHealthz(baseInput).body.mentionSource).toBeUndefined()
    expect(Object.keys(buildHealthz(baseInput).body)).not.toContain('mentionSource')
  })
})
