/**
 * kimi 适配器全链测试 —— 对 fake CLI harness（docs/18-§1.3 独立测试套件）
 *
 * 覆盖（任务口径：对 fake 全绿，真 CLI 行为留探针单）：
 *   - 全链：launch→stream 逐事件消费→会话结束 wire 合流→resultStats（**tokens=wire 逐轮
 *     求和总账**——1500+3300 / 220+910 / 0+1200；cost 恒 {usd:0} 待价目表折算、turns 取
 *     turn_end 计数、duration 自持墙钟）
 *   - wire 合流三面明示（对齐 streams.parseKimi 冻结行为：不静默降级）：wire 缺失（缺省
 *     resolver 拟稿路径进 log）/ wire 无 usage 记录 / wire 有 usage 但 stdout 无 turn_end 可挂
 *   - 缺 wire 不影响完成判定：isCompleted 只认 stdout 终态 + 输出非空（wire 只影响账目）
 *   - kill 无终态面（对齐 dsh/claude/codex 先例）：FAKE_HANG 半程被杀 → result 未到 =
 *     无 turn_end、wire 不落（fake 只在正常退出写）→ 明示 log + tokens 零值、isCompleted=false
 *   - kill 宽限升级：无视 SIGTERM 的子进程在 graceMs 后被 SIGKILL 强杀；kill 幂等
 *   - detect 三态（kimi 无版本门槛坑——gaps 空为常态）：可解析 ok:true 无 gaps /
 *     解析失败 ok:false / 未安装 ok:false
 *   - launch 参数注入（FAKE_ECHO_ARGS 回显）：`-p --output-format stream-json` 基座、
 *     续跑 `-S <sessionId>`（拟稿旗标形，docs/25-§3.1「-S 家族」）、budgetCap 传入不落地
 *   - AGENTS.md 通道（env 映射）：native=不注入、user_level=KIMI_CODE_HOME（docs/04 B5
 *     修订实锤）、append=KIMI_APPEND_SYSTEM_PROMPT_FILE（变量自拟，见 kimi.ts 头注）
 *   - estimate 冒烟（四家同一 v0 拟稿）；sumWireUsage 导出与 parseStream 冻结锚
 *
 * **`-p` 与 yolo/auto/plan 互斥**（docs/17-§6 kimi 行、02-F1-13、附A-2）：真 CLI 行为，
 * fake 上无法测互斥——记探针待办。框架侧防线在此冻结：适配器只构造 `-p` 基座、
 * 永不下发 yolo/auto/plan 类模式旗标（基座注入用例断言 not.toContain）。
 *
 * wire 路径拟稿（kimi.ts 头注）：真实 session 目录约定未知，缺省
 * `<workspace>/.kimi/sessions/<sessionId>/wire.jsonl`（sessionId=框架 Handle UUID）；
 * wire 存在面用注入 resolver 测，缺省 resolver 用「not found at <路径>」明示 log 反证公式。
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
import { KimiAdapter } from '../src/kimi.ts'
import type { WirePathResolver } from '../src/kimi.ts'
import { parseLine, parseStream, sumWireUsage } from '../src/streams.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const stdoutFixture = fileURLToPath(
  new URL('./fixtures/kimi/stdout-basic.jsonl', import.meta.url),
)
const wireFixture = fileURLToPath(
  new URL('./fixtures/kimi/stdout-basic.wire.jsonl', import.meta.url),
)

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'kimi-adapter-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

interface BriefOverrides {
  AGENTS_MD?: TaskBrief['AGENTS_MD']
  briefPath?: string
  budgetCap?: TaskBrief['budgetCap']
  resume?: TaskBrief['resume']
}

function makeBrief(o: BriefOverrides = {}): TaskBrief {
  return {
    ticket: 'TEST-4',
    attempt: 1,
    briefPath: o.briefPath ?? join(workdir, 'brief.md'),
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...(o.budgetCap !== undefined ? { budgetCap: o.budgetCap } : {}),
    ...(o.resume !== undefined ? { resume: o.resume } : {}),
  }
}

/** 假 CLI 适配器；resolver 缺省走拟稿缺省（测「not found at <拟稿路径>」明示面） */
function fakeAdapter(resolver?: WirePathResolver): KimiAdapter {
  return resolver === undefined
    ? new KimiAdapter([process.execPath, fakeCli])
    : new KimiAdapter([process.execPath, fakeCli], resolver)
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

const stdoutText = (): string => readFileSync(stdoutFixture, 'utf8')

/** kimi stdout 是 claude 同构（17-§6：形态同、无 usage）——消费方视角的 golden 序列 */
const claudeShapedEvents = (): StreamEvent[] => parseStream(stdoutText(), 'claude')

/** 一次性 wire 目录（fake CLI 正常退出前写 <dir>/wire.jsonl） */
const wireSessionDir = (): string => mkdtempSync(join(workdir, 'wire-session-'))

/** FAKE_ECHO_ARGS 下取首条 log（argv 回显行）——launch 参数注入断言用 */
async function echoArgv(adapter: KimiAdapter, brief: TaskBrief): Promise<string> {
  const h = await adapter.launch(brief)
  const collected: StreamEvent[] = []
  for await (const ev of adapter.stream(h)) collected.push(ev)
  const first = collected[0]
  return first !== undefined && first.type === 'log' ? first.text : ''
}

describe('capabilities（能力声明冻结：17-§6 kimi 行）', () => {
  it('budget_cap/cancel_turn/session_resume/agents_md/cost_native 五项如实', () => {
    expect(new KimiAdapter().capabilities).toStrictEqual({
      budget_cap: false, // 附A-2：无原生预算帽（三家除 claude 外均无预算参数）
      cancel_turn: false,
      session_resume: true, // `-S <sessionId>`（拟稿旗标形，docs/25-§3.1「-S 家族」；待探针）
      agents_md: 'native', // 复查报告实锤：kimi 读 AGENTS.md
      cost_native: false, // 无成本字段——价目表折算（cost 恒 {usd:0}，待批）
    })
  })
})

describe('全链：launch→stream→wire 合流→resultStats（fixture：stdout-basic + wire）', () => {
  it(
    'stdout 消费方视角与 claude 同构归一一致；resultStats tokens=wire 逐轮求和总账、turns=turn_end 计数',
    async () => {
      const wireDir = wireSessionDir()
      await withFakeEnv(
        {
          FAKE_FIXTURE: stdoutFixture,
          FAKE_WIRE_DIR: wireDir,
          FAKE_WIRE_FIXTURE: wireFixture,
        },
        async () => {
          const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
          const h = await adapter.launch(makeBrief())
          expect(h.executor).toBe('kimi')
          expect(h.pid).toBeGreaterThan(0)

          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)
          // stdout 部分（claude 同构、无 usage）逐行无损：与全文 parseStream('claude') 严格一致；
          // wire 求和挂载只落伴生状态（消费方已 yield 的 turn_end 不回补——流式固有，头注）
          expect(collected).toStrictEqual(claudeShapedEvents())
          // wire 挂载成功：无追加明示事件
          expect(collected.some((e) => e.text?.includes('wire.jsonl'))).toBe(false)

          expect(adapter.exitCode(h)).toBe(0) // fake CLI 正常退出（记录价值）
          expect(adapter.isCompleted(h)).toBe(true) // result 终态 + log 非空

          // **本家独有难点**：tokens=wire 逐轮求和总账（1500+3300 / 220+910 / 0+1200）
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 4800, output: 1130, cached: 1200 })
          expect(stats.turns).toBe(1) // kimi stdout 无 step 级事件——turn_end 计数
          expect(stats.duration).toBeGreaterThanOrEqual(0) // 自持墙钟
        },
      )
    },
    10_000,
  )

  it(
    'cost 恒 {usd:0}——cost_native=false「待价目表折算」（与 dsh/codex 同口径，不改 contract）',
    async () => {
      const wireDir = wireSessionDir()
      await withFakeEnv(
        {
          FAKE_FIXTURE: stdoutFixture,
          FAKE_WIRE_DIR: wireDir,
          FAKE_WIRE_FIXTURE: wireFixture,
        },
        async () => {
          const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
          const h = await adapter.launch(makeBrief())
          for await (const ev of adapter.stream(h)) void ev
          const stats = await adapter.resultStats(h)
          expect(stats.cost).toStrictEqual({ usd: 0 }) // tokens 有真账、成本折算待批
        },
      )
    },
    10_000,
  )

  it(
    '增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield，非整块缓冲',
    async () => {
      const wireDir = wireSessionDir()
      await withFakeEnv(
        {
          FAKE_FIXTURE: stdoutFixture,
          FAKE_DELAY_MS: '120',
          FAKE_WIRE_DIR: wireDir,
          FAKE_WIRE_FIXTURE: wireFixture,
        },
        async () => {
          const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
          const h = await adapter.launch(makeBrief())
          const stamps: number[] = []
          for await (const ev of adapter.stream(h)) {
            stamps.push(Date.now())
            void ev
          }
          expect(stamps.length).toBe(claudeShapedEvents().length)
          // 首事件（system）→末事件（result 终态）隔多个逐行延迟：≥60ms 证明逐行到达
          const first = stamps[0] ?? 0
          const last = stamps[stamps.length - 1] ?? 0
          expect(last - first).toBeGreaterThanOrEqual(60)
        },
      )
    },
    15_000,
  )

  it('stream 二次消费明报拒绝（一单一命、一流一收）', async () => {
    await withFakeEnv({ FAKE_FIXTURE: stdoutFixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev
      await expect(async () => {
        for await (const ev of adapter.stream(h)) void ev
      }).rejects.toThrow(/已消费/)
    })
  })
})

describe('wire 合流三面明示（对齐 streams.parseKimi 冻结行为：不静默降级）', () => {
  it(
    'wire 缺失：缺省 resolver 拟稿路径进明示 log（<workspace>/.kimi/sessions/<uuid>/wire.jsonl）；tokens 零值；isCompleted 不受影响',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: stdoutFixture }, async () => {
        const adapter = fakeAdapter() // 缺省 resolver（拟稿公式待探针，kimi.ts 头注）
        const h = await adapter.launch(makeBrief())
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)

        // 明示 log 精确含缺省拟稿路径——反证 defaultWirePath 公式（真实约定未知，待探针）
        const expectedPath = join(workdir, '.kimi', 'sessions', h.sessionId, 'wire.jsonl')
        expect(collected[collected.length - 1]).toStrictEqual({
          type: 'log',
          text: `[kimi] wire.jsonl not found at ${expectedPath}; usage unavailable（17-§6 已知坑）`,
        })

        // wire 只影响账目不影响完成面：stdout 终态在，isCompleted 仍 true
        expect(adapter.isCompleted(h)).toBe(true)
        const stats = await adapter.resultStats(h)
        expect(stats.tokens).toStrictEqual({ input: 0, output: 0 }) // 无来源不编造
        expect(stats.cost).toStrictEqual({ usd: 0 })
        expect(stats.turns).toBe(1)
      })
    },
    10_000,
  )

  it(
    'wire 可读但无 usage 记录：明示 log（与 parseKimi 同文）+ tokens 零值',
    async () => {
      const wireDir = wireSessionDir()
      // 手工构造只有 session.start/end、无 usage 行的 wire（非 JSON 行也容忍跳过）
      const noUsageWire = join(workdir, 'wire-no-usage.jsonl')
      writeFileSync(
        noUsageWire,
        `${'# no usage record\n'}${'{"type":"session.start","session_id":"k_sess_0007"}\n'}${'{"type":"session.end","session_id":"k_sess_0007"}\n'}`,
      )
      await withFakeEnv(
        { FAKE_FIXTURE: stdoutFixture, FAKE_WIRE_DIR: wireDir, FAKE_WIRE_FIXTURE: noUsageWire },
        async () => {
          const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)
          expect(collected[collected.length - 1]).toStrictEqual({
            type: 'log',
            text: '[kimi] no usage record in wire.jsonl; usage unavailable',
          })
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(adapter.isCompleted(h)).toBe(true)
        },
      )
    },
    10_000,
  )

  it(
    'wire 有 usage 但 stdout 无 turn_end 可挂：明示 log（与 parseKimi 同文）+ tokens 零值 + isCompleted=false',
    async () => {
      const wireDir = wireSessionDir()
      // 手工构造无 result 终态的 stdout（只有 system+assistant——被截断/未完单形态）
      const noResultStdout = join(workdir, 'stdout-no-result.jsonl')
      writeFileSync(
        noResultStdout,
        `${'{"type":"system","subtype":"init","session_id":"k_sess_0007"}\n'}${'{"type":"assistant","message":{"content":[{"type":"text","text":"开始实现流归一化…"}]}}\n'}`,
      )
      await withFakeEnv(
        { FAKE_FIXTURE: noResultStdout, FAKE_WIRE_DIR: wireDir, FAKE_WIRE_FIXTURE: wireFixture },
        async () => {
          const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)
          expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
          expect(collected[collected.length - 1]).toStrictEqual({
            type: 'log',
            text: '[kimi] wire usage found but stdout has no turn_end to attach',
          })
          // 冻结口径（镜像 parseKimi）：无 turn_end 可挂就不折算——tokens 零值不编造
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(stats.turns).toBe(0)
          expect(adapter.isCompleted(h)).toBe(false)
        },
      )
    },
    10_000,
  )
})

describe('kill 无终态面（kimi：result 未到 = 无终态；wire 只在正常退出落——被杀即缺）', () => {
  it(
    'FAKE_HANG 半程被杀：无 turn_end、wire 缺失明示、tokens 零值、isCompleted=false、exitCode=null',
    async () => {
      // 手工构造无 result 的 stdout：吐完即挂起（被杀前只有 system+assistant 两事件）
      const noResultStdout = join(workdir, 'stdout-no-result.jsonl')
      writeFileSync(
        noResultStdout,
        `${'{"type":"system","subtype":"init","session_id":"k_sess_0007"}\n'}${'{"type":"assistant","message":{"content":[{"type":"text","text":"开始实现流归一化…"}]}}\n'}`,
      )
      await withFakeEnv({ FAKE_FIXTURE: noResultStdout, FAKE_HANG: '1' }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        const collected: StreamEvent[] = []
        const consuming = (async () => {
          for await (const ev of adapter.stream(h)) collected.push(ev)
        })()
        // 挂起段：stdout 两行已吐完，进程不退、result 未到
        await new Promise((r) => setTimeout(r, 300))
        expect(collected.length).toBe(2)

        await adapter.kill(h, 2_000)
        await consuming // kill 后 stdout 关闭，流收尾→wire 读取→缺失明示

        expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
        // fake 只在正常退出写 wire：被杀会话 wire 缺失——明示 log（不静默降级）
        const last = collected[collected.length - 1]
        expect(last?.type === 'log' && last.text.includes('wire.jsonl not found')).toBe(true)
        expect(adapter.exitCode(h)).toBeNull() // 被 SIGTERM 杀死：null（非 0）
        expect(adapter.isCompleted(h)).toBe(false)
        const stats = await adapter.resultStats(h)
        expect(stats.cost).toStrictEqual({ usd: 0 })
        expect(stats.tokens).toStrictEqual({ input: 0, output: 0 }) // 无来源不编造
        expect(stats.turns).toBe(0)
      })
    },
    15_000,
  )

  it(
    '宽限升级：子进程无视 SIGTERM——graceMs 后 SIGKILL 强杀（不杀则 kill 永不返回）',
    async () => {
      // cmd 注入 node -e 回显目标 env：吞 SIGTERM 且不退（kimi 无吞信号坑——此为压力面）；
      // 末尾 -- 同上：适配器追加的流式旗标须落为位置参数，否则 node 直接 bad option 秒死
      const adapter = new KimiAdapter([
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => {}); process.stdout.write("READY\\n"); setInterval(() => {}, 1e9)',
        '--',
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
    const wireDir = wireSessionDir()
    await withFakeEnv(
      { FAKE_FIXTURE: stdoutFixture, FAKE_WIRE_DIR: wireDir, FAKE_WIRE_FIXTURE: wireFixture },
      async () => {
        const adapter = fakeAdapter(() => join(wireDir, 'wire.jsonl'))
        const h = await adapter.launch(makeBrief())
        for await (const ev of adapter.stream(h)) void ev // 已自然退出
        await adapter.kill(h, 1_000) // no-op：不抛
        await adapter.kill(h, 1_000) // 幂等：不抛
        expect(adapter.isCompleted(h)).toBe(true) // 先前完成判定不受影响
      },
    )
  })
})

describe('detect（三态——kimi 无版本门槛坑，gaps 空为常态）', () => {
  it('`kimi-cli 1.2.3` 形态 → ok=true、版本号、无 gaps（无门槛即达标）', async () => {
    await withFakeEnv({ FAKE_VERSION: 'kimi-cli 1.2.3' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toStrictEqual({ name: 'kimi', version: '1.2.3', ok: true, gaps: [] })
    })
  })

  it('裸语义化版本 `0.9.0` → ok=true 无 gaps', async () => {
    await withFakeEnv({ FAKE_VERSION: '0.9.0' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toStrictEqual({ name: 'kimi', version: '0.9.0', ok: true, gaps: [] })
    })
  })

  it('解析失败：版本串不可识别 → ok=false 明报', async () => {
    await withFakeEnv({ FAKE_VERSION: 'unknown-release-format' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toMatchObject({ name: 'kimi', ok: false, version: '' })
      expect(r.gaps).toContain('kimi-version-unparsed')
    })
  })

  it('未安装：假 cmd 二进制不存在 → ok=false + kimi-not-installed', async () => {
    const r = await new KimiAdapter(['kimi-harness-definitely-missing']).detect()
    expect(r).toMatchObject({ name: 'kimi', ok: false, version: '' })
    expect(r.gaps).toContain('kimi-not-installed')
  })
})

describe('launch 参数注入（FAKE_ECHO_ARGS 回显 argv）', () => {
  it(
    '基座形态：-p --output-format stream-json；无续跑不注入 -S；永不下发 yolo/auto/plan（互斥防线，头注）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief())
        expect(echo).toContain('-p --output-format stream-json')
        expect(echo).not.toContain('-S')
        // `-p` 与 yolo/auto/plan 互斥（17-§6）：框架侧冻结——适配器构造的 argv 永不含模式旗标
        expect(echo).not.toContain('yolo')
        expect(echo).not.toContain('auto')
        expect(echo).not.toContain('plan')
      })
    },
    10_000,
  )

  it(
    '续跑：resume.sessionId=sess_9f2e → -S sess_9f2e（拟稿旗标形，session_resume=true 落地）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(
          fakeAdapter(),
          makeBrief({ resume: { sessionId: 'sess_9f2e', summaryPath: join(workdir, 'summary.json') } }),
        )
        expect(echo).toContain('-S sess_9f2e')
      })
    },
    10_000,
  )

  it(
    'budgetCap 传入不落地：无任何预算帽旗标（budget_cap=false 照实声明——与 dsh/codex 同做法）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief({ budgetCap: { usd: 5 } }))
        expect(echo).toContain('-p --output-format stream-json') // 基座照常
        expect(echo).not.toContain('budget') // 无旗标可落地——能力声明即契约，调度侧不应传帽
      })
    },
    10_000,
  )
})

describe('AGENTS.md 通道（env 映射——kimi.ts 头注；user_level 变量有 docs/04 B5 实锤）', () => {
  // cmd 注入 node -e 回显目标 env：末尾 `--` 让适配器追加的流式旗标（-p/--output-format/
  // stream-json/-S）落为 node 的位置参数而非选项——否则 node 把 -e 后的 -p 类参数报 bad option
  const envEchoAdapter = (varName: string): KimiAdapter =>
    new KimiAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
      '--',
    ])

  it(
    'user_level 通道 → KIMI_CODE_HOME=target 透传（docs/04-§97 B5 修订实锤，非自拟）',
    async () => {
      const target = join(workdir, 'kimi-code-home')
      const adapter = envEchoAdapter('KIMI_CODE_HOME')
      const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected[0]).toStrictEqual({ type: 'log', text: target })
    },
    10_000,
  )

  it('native 通道 → 不注入 KIMI_CODE_HOME（复查报告实锤：kimi 原生读 workspace AGENTS.md）', async () => {
    const adapter = envEchoAdapter('KIMI_CODE_HOME')
    const h = await adapter.launch(makeBrief())
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    // 无换行残行回流为 log：'<unset>' 证明未注入
    expect(collected[0]).toStrictEqual({ type: 'log', text: '<unset>' })
  }, 10_000)

  it(
    'append_system_prompt 通道 → KIMI_APPEND_SYSTEM_PROMPT_FILE=target（变量自拟，镜像 dsh 同通道做法）',
    async () => {
      const target = join(workdir, 'agents-append.md')
      const adapter = envEchoAdapter('KIMI_APPEND_SYSTEM_PROMPT_FILE')
      const h = await adapter.launch(
        makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
      )
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected[0]).toStrictEqual({ type: 'log', text: target })
    },
    10_000,
  )
})

describe('estimate（拟稿：四家相同的 v0 模型——v0.6 前细化）', () => {
  it('按任务书字符量粗估 + 低 confidence：60000 字符 → $0.2', async () => {
    const briefPath = join(workdir, 'brief-estimate.md')
    writeFileSync(briefPath, 'x'.repeat(60_000))
    const r = await new KimiAdapter().estimate(makeBrief({ briefPath }))
    expect(r.estimated.usd).toBeCloseTo(0.2, 4)
    expect(r.confidence).toBe(0.2)
  })
})

describe('伴生状态守卫 + streams 冻结锚（kimi 家族）', () => {
  it('空行/注释行 → 空数组；sessionId 未知 → 明报抛错（伴生状态守卫）', async () => {
    expect(parseLine('# comment', 'kimi')).toStrictEqual([])
    expect(parseLine('', 'kimi')).toStrictEqual([])
    const adapter = new KimiAdapter()
    const bogus = { executor: 'kimi', sessionId: 'no-such-session', pid: -1 }
    await expect(adapter.resultStats(bogus)).rejects.toThrow(/no-such-session/)
    expect(() => adapter.isCompleted(bogus)).toThrow(/no-such-session/)
  })

  it('sumWireUsage 导出=wire 逐轮求和（4800/1130/1200）；parseStream 冻结口径挂最后一个 turn_end——适配器合流与之一致', () => {
    const wireText = readFileSync(wireFixture, 'utf8')
    const summed = sumWireUsage(wireText)
    expect(summed).toStrictEqual({ input: 4800, output: 1130, cached: 1200 })
    // 冻结锚：全文级 parseStream(text,'kimi',wire) 的 turn_end.usage 与求和一致——
    // 适配器 mergeWireUsage 挂的是同一个数（25-§3.1 裁决#4 假设口径，探针前不动）
    const merged = parseStream(stdoutText(), 'kimi', wireText)
    const turnEnd = merged.find((e) => e.type === 'turn_end')
    expect(turnEnd !== undefined && turnEnd.type === 'turn_end' ? turnEnd.usage : undefined)
      .toStrictEqual(summed)
  })
})
