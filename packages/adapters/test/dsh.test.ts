/**
 * dsh 适配器全链测试 —— 对 fake CLI harness（docs/18-§1.3 独立测试套件）
 *
 * 覆盖（任务口径：对 fake 全绿，真 CLI 行为留探针单）：
 *   - 全链：launch→stream 逐事件消费→resultStats 账目（tokens/duration/turns/cost）
 *   - 增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield 非整块缓冲
 *   - kill 已知坑（17-§6 冻结口径）：FAKE_HANG+FAKE_SIGTERM_EXIT=0 吞 SIGTERM 后退出码 0
 *     ——退出码 0 ≠ 成功，成功判定只认 turn_end.completed+输出非空（isCompleted）
 *   - kill 普通挂起：SIGTERM 默认终止（信号死，无退出码）；kill 宽限升级：无视 SIGTERM
 *     的子进程在 graceMs 后被 SIGKILL 强杀
 *   - detect：未安装（假 cmd / PATH 清空）明报不静默；可解析时版本+未锁版本 gap
 *   - estimate 冒烟（拟稿：v0.6 前细化）
 *   - AGENTS.md 通道 env 注入（映射拟稿，见 dsh.ts 头注）
 *   - parseLine 单行导出与 parseStream 全文等价（streams 既有行为不改的旁证）
 *
 * env 注入说明：适配器 spawn 用 {...process.env} 打底——FAKE_* 旋钮经 process.env
 * 临时注入、finally 还原（withFakeEnv），不污染其他用例。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { StreamEvent, TaskBrief } from '@studio-next/contract'
import { DshAdapter } from '../src/dsh.ts'
import { parseLine, parseStream } from '../src/streams.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const completedFixture = fileURLToPath(
  new URL('./fixtures/dsh/turn-completed.ndjson', import.meta.url),
)
const killedFixture = fileURLToPath(
  new URL('./fixtures/dsh/killed-mid-step.ndjson', import.meta.url),
)

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'dsh-adapter-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

interface BriefOverrides {
  AGENTS_MD?: TaskBrief['AGENTS_MD']
  briefPath?: string
}

function makeBrief(o: BriefOverrides = {}): TaskBrief {
  return {
    ticket: 'TEST-1',
    attempt: 1,
    briefPath: o.briefPath ?? join(workdir, 'brief.md'),
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
  }
}

function fakeAdapter(): DshAdapter {
  return new DshAdapter([process.execPath, fakeCli])
}

/** 临时注入 FAKE_* 旋钮到 process.env（适配器 spawn 时展开），结束还原 */
async function withFakeEnv(kvs: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(kvs)) {
    saved.set(k, process.env[k])
    process.env[k] = v
  }
  try {
    await fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const goldenEvents = (): StreamEvent[] =>
  parseStream(readFileSync(completedFixture, 'utf8'), 'dsh')

describe('全链：launch→stream→resultStats（fixture：turn-completed）', () => {
  it(
    '流事件与 golden 归一序列一致；账目 tokens/turns/cost/duration 如实',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: completedFixture }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        expect(h.executor).toBe('dsh')
        expect(h.pid).toBeGreaterThan(0)

        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        // spawn/行切割/单行归一全链无损：与全文 parseStream 严格一致
        expect(collected).toStrictEqual(goldenEvents())

        expect(adapter.exitCode(h)).toBe(0) // fake CLI 正常退出（记录价值）
        expect(adapter.isCompleted(h)).toBe(true) // turn_end.completed=true + log 非空

        const stats = await adapter.resultStats(h)
        expect(stats.tokens).toStrictEqual({ input: 3800, output: 2200, cached: 800 })
        expect(stats.turns).toBe(2) // step_end 计数
        expect(stats.cost).toStrictEqual({ usd: 0 }) // cost_native=false：待价目表折算（dsh.ts 头注）
        expect(stats.duration).toBeGreaterThanOrEqual(0)
      })
    },
    10_000,
  )

  it(
    '增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield，非整块缓冲',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: completedFixture, FAKE_DELAY_MS: '120' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const stamps: number[] = []
          for await (const ev of adapter.stream(h)) {
            stamps.push(Date.now())
            void ev
          }
          expect(stamps.length).toBe(goldenEvents().length)
          // 首末事件间隔 ≥ 4×30ms：事件确系逐行到达
          const first = stamps[0] ?? 0
          const last = stamps[stamps.length - 1] ?? 0
          expect(last - first).toBeGreaterThanOrEqual(120)
        },
      )
    },
    15_000,
  )

  it('stream 二次消费明报拒绝（一单一命、一流一收）', async () => {
    await withFakeEnv({ FAKE_FIXTURE: completedFixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev
      await expect(async () => {
        for await (const ev of adapter.stream(h)) void ev
      }).rejects.toThrow(/已消费/)
    })
  })
})

describe('kill 已知坑（17-§6：被 kill 后退出码=0 且 final 为空——退出码不构成成功）', () => {
  it(
    'FAKE_HANG+FAKE_SIGTERM_EXIT=0：吞 SIGTERM 后退出码 0，但无 turn_end → 判定未完成',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: killedFixture, FAKE_HANG: '1', FAKE_SIGTERM_EXIT: '0' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) collected.push(ev)
          })()
          // 挂起段：fixture 已吐完（3 事件、无 turn_end），进程不退、stdout 未关
          await new Promise((r) => setTimeout(r, 300))
          expect(collected.length).toBe(3)

          await adapter.kill(h, 2_000)
          await consuming // kill 后 stdout 关闭，流自然收尾

          expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
          // 坑位实锤：退出码 0（吞 SIGTERM 后 exit 0）却没有任何 turn_end.completed——「未完成」
          expect(adapter.exitCode(h)).toBe(0)
          expect(adapter.isCompleted(h)).toBe(false)
          // 被杀半程的账目照样可收：部分 usage + 已完 step 计数
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 900, output: 120, cached: 0 })
          expect(stats.turns).toBe(1)
        },
      )
    },
    15_000,
  )

  it(
    '普通挂起（不吞信号）：SIGTERM 默认终止——信号死无退出码，判定未完成',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: killedFixture, FAKE_HANG: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) void ev
          })()
          await new Promise((r) => setTimeout(r, 300))
          await adapter.kill(h, 2_000)
          await consuming
          expect(adapter.exitCode(h)).toBeNull() // 被 SIGTERM 杀死：null（非 0）
          expect(adapter.isCompleted(h)).toBe(false)
        },
      )
    },
    15_000,
  )

  it(
    '宽限升级：子进程无视 SIGTERM——graceMs 后 SIGKILL 强杀（不杀则 kill 永不返回）',
    async () => {
      // cmd 注入一个吞 SIGTERM 且不退出的子进程（比 fake CLI 更极端：软杀完全无效）
      const adapter = new DshAdapter([
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => {}); process.stdout.write("READY\\n"); setInterval(() => {}, 1e9)',
      ])
      const h = await adapter.launch(makeBrief())
      const events: unknown[] = []
      const consuming = (async () => {
        for await (const ev of adapter.stream(h)) events.push(ev)
      })()
      // 竞态修复（2026-10-17 宰相）：等 READY 首事件再杀——SIGTERM 早于子进程装好处理器时
      // 子进程秒死，宽限断言必翻（负载下首现）；READY=处理器已装好的就绪信号
      await new Promise<void>((resolve) => {
        const tick = setInterval(() => { if (events.length > 0) { clearInterval(tick); resolve() } }, 5)
        setTimeout(() => { clearInterval(tick); resolve() }, 5_000)
      })
      const t0 = Date.now()
      await adapter.kill(h, 300)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250) // 确实等满宽限才升级
      await consuming
      expect(adapter.exitCode(h)).toBeNull() // SIGKILL：信号死，无退出码
      expect(adapter.isCompleted(h)).toBe(false)
    },
    15_000,
  )

  it('kill 幂等 + 已退出进程不重复杀', async () => {
    await withFakeEnv({ FAKE_FIXTURE: completedFixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev // 已自然退出
      await adapter.kill(h, 1_000) // no-op：不抛
      await adapter.kill(h, 1_000) // 幂等：不抛
      expect(adapter.isCompleted(h)).toBe(true) // 先前完成判定不受影响
    })
  })
})

describe('detect（launch 前必跑；不达标明报，绝不静默降级）', () => {
  it('未安装：假 cmd 二进制不存在 → ok=false + dsh-not-installed', async () => {
    const adapter = new DshAdapter(['dsh-harness-definitely-missing'])
    const r = await adapter.detect()
    expect(r).toMatchObject({ name: 'dsh', ok: false, version: '' })
    expect(r.gaps).toContain('dsh-not-installed')
  })

  it('未安装（PATH 清空）：缺省 dsh 在空 PATH 下找不到 → dsh-not-installed', async () => {
    const adapter = new DshAdapter() // 缺省 cmd：dsh --profile headless --json
    const savedPath = process.env.PATH
    process.env.PATH = ''
    try {
      const r = await adapter.detect()
      expect(r.ok).toBe(false)
      expect(r.gaps).toContain('dsh-not-installed')
    } finally {
      process.env.PATH = savedPath
    }
  })

  it('可解析：node --version → ok=true、版本号、未锁版本 gap 明报（不拦截）', async () => {
    const adapter = new DshAdapter([process.execPath, fakeCli])
    const r = await adapter.detect()
    expect(r.ok).toBe(true)
    expect(r.version).toMatch(/^\d+\.\d+/)
    expect(r.gaps.length).toBe(1)
    expect(r.gaps[0]).toMatch(/^dsh-version-unlocked:expected 0\.2\.0-rc\.2,got /)
  })
})

describe('estimate（拟稿：预算估算模型 v0——v0.6 前细化）', () => {
  it('按任务书字符量粗估 + 低 confidence：60000 字符 → $0.2', async () => {
    const briefPath = join(workdir, 'brief-estimate.md')
    writeFileSync(briefPath, 'x'.repeat(60_000))
    const r = await new DshAdapter().estimate(makeBrief({ briefPath }))
    expect(r.estimated.usd).toBeCloseTo(0.2, 4)
    expect(r.confidence).toBe(0.2)
  })

  it('任务书不可读：地板价 $0.05 兜底，不抛错', async () => {
    const r = await new DshAdapter().estimate(
      makeBrief({ briefPath: join(workdir, 'no-such-brief.md') }),
    )
    expect(r.estimated.usd).toBe(0.05)
    expect(r.confidence).toBe(0.2)
  })
})

describe('AGENTS.md 通道 env 注入（映射拟稿，dsh.ts agentsMdEnv）', () => {
  // cmd 注入 node -e 回显目标 env：值经 stdout 以 log 事件回流断言
  const echoAdapter = (varName: string): DshAdapter =>
    new DshAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
    ])

  it('user_level 通道 → DSH_AGENTS_MD=target 透传', async () => {
    const target = join(workdir, 'agents-user-level.md')
    const adapter = echoAdapter('DSH_AGENTS_MD')
    const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('append_system_prompt 通道 → DSH_APPEND_SYSTEM_PROMPT_FILE=target 透传', async () => {
    const target = join(workdir, 'agents-append.md')
    const adapter = echoAdapter('DSH_APPEND_SYSTEM_PROMPT_FILE')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('native 通道 → 不注入任何 DSH_* 通道变量', async () => {
    const adapter = echoAdapter('DSH_AGENTS_MD')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    // 无换行残行回流为 log：'<unset>' 证明未注入
    expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
  })
})

describe('parseLine 单行导出（streams.ts 新增导出——既有行为不改的旁证）', () => {
  it('dsh 家族：fixture 逐行过 parseLine 展平 ≡ parseStream 全文解析', () => {
    const text = readFileSync(completedFixture, 'utf8')
    const flattened = text.split('\n').flatMap((l) => parseLine(l, 'dsh'))
    expect(flattened).toStrictEqual(parseStream(text, 'dsh'))
  })

  it('空行/注释行 → 空数组；二次消费守卫用的 sessionId 未知 → 明报抛错', async () => {
    expect(parseLine('# comment', 'dsh')).toStrictEqual([])
    expect(parseLine('', 'dsh')).toStrictEqual([])
    const adapter = new DshAdapter()
    const bogus = { executor: 'dsh', sessionId: 'no-such-session', pid: -1 }
    await expect(adapter.resultStats(bogus)).rejects.toThrow(/no-such-session/)
  })
})
