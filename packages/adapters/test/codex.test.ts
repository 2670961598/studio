/**
 * codex 适配器全链测试 —— 对 fake CLI harness（docs/18-§1.3 独立测试套件）
 *
 * 覆盖（任务口径：对 fake 全绿，真 CLI 行为留探针单）：
 *   - 全链：launch→stream 逐事件消费→resultStats（cost_native=false——cost 恒 0 待价目表折算、
 *     tokens 取 turn_end.usage（turn.completed 总账）、turns 取 step_end 计数、duration 自持墙钟）
 *   - 增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield 非整块缓冲
 *   - 失败面（turn-failed fixture，17-§6 已知坑）：turn.failed 无 usage——失败路径 tokens 零值、
 *     无 turn_end.completed=true（冻结）；错误信息 log 透传 + turn_end.error 挂载（协议 v1.1）；
 *     FAKE_EXIT=1 佐证退出码不参与成功判定
 *   - kill 无终态面（对齐 claude killed-no-result 先例）：FAKE_HANG 半程被杀 → turn.completed
 *     未到 = 无 turn_end、tokens 零值、isCompleted=false；step 事件照收（turns=1）
 *   - kill 宽限升级：无视 SIGTERM 的子进程在 graceMs 后被 SIGKILL 强杀；kill 幂等
 *   - detect 三态（codex 无版本门槛坑——gaps 空为常态）：可解析 ok:true 无 gaps /
 *     解析失败 ok:false / 未安装 ok:false
 *   - launch 参数注入（FAKE_ECHO_ARGS 回显）：exec --json 基座、续跑 --resume（拟稿旗标形）、
 *     budgetCap 传入不落地（budget_cap=false 照实——无预算帽旗标）
 *   - AGENTS.md 通道（env 映射拟稿）：native=不注入、user_level=CODEX_HOME、
 *     append=CODEX_APPEND_INSTRUCTIONS_FILE（变量自拟，见 codex.ts 头注）
 *   - estimate 冒烟（与 dsh/claude 相同的 v0 拟稿）；parseLine 单行导出与 parseStream 全文等价
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
import { CodexAdapter } from '../src/codex.ts'
import { parseLine, parseStream } from '../src/streams.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const successFixture = fileURLToPath(
  new URL('./fixtures/codex/turn-completed.jsonl', import.meta.url),
)
const failedFixture = fileURLToPath(
  new URL('./fixtures/codex/turn-failed.jsonl', import.meta.url),
)
const killedFixture = fileURLToPath(
  new URL('./fixtures/codex/killed-no-turn.jsonl', import.meta.url),
)

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'codex-adapter-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

interface BriefOverrides {
  AGENTS_MD?: TaskBrief['AGENTS_MD']
  briefPath?: string
  budgetCap?: TaskBrief['budgetCap']
  resume?: TaskBrief['resume']
  credentials?: TaskBrief['credentials']
}

function makeBrief(o: BriefOverrides = {}): TaskBrief {
  return {
    ticket: 'TEST-3',
    attempt: 1,
    briefPath: o.briefPath ?? join(workdir, 'brief.md'),
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...(o.budgetCap !== undefined ? { budgetCap: o.budgetCap } : {}),
    ...(o.resume !== undefined ? { resume: o.resume } : {}),
    ...(o.credentials !== undefined ? { credentials: o.credentials } : {}),
  }
}

function fakeAdapter(): CodexAdapter {
  return new CodexAdapter([process.execPath, fakeCli])
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

const goldenEvents = (): StreamEvent[] => parseStream(readFileSync(successFixture, 'utf8'), 'codex')

/** FAKE_ECHO_ARGS 下取首条 log（argv 回显行）——launch 参数注入断言用 */
async function echoArgv(adapter: CodexAdapter, brief: TaskBrief): Promise<string> {
  const h = await adapter.launch(brief)
  const collected: StreamEvent[] = []
  for await (const ev of adapter.stream(h)) collected.push(ev)
  const first = collected[0]
  return first !== undefined && first.type === 'log' ? first.text : ''
}

describe('capabilities（能力声明冻结：17-§6 codex 行）', () => {
  it('budget_cap/cancel_turn/session_resume/agents_md/cost_native 五项如实', () => {
    expect(new CodexAdapter().capabilities).toStrictEqual({
      budget_cap: false, // 无原生预算帽——调度侧不传帽，预算管控走框架断路
      cancel_turn: false,
      session_resume: true, // codex exec --resume（拟稿旗标形，codex.ts 头注）
      agents_md: 'native', // 拟稿：假设原生读 workspace AGENTS.md（待探针）
      cost_native: false, // 无成本字段——价目表折算（cost 恒 {usd:0}，待批）
    })
  })
})

describe('全链：launch→stream→resultStats（fixture：turn-completed）', () => {
  it(
    '流事件与 golden 归一序列一致；tokens 取 turn_end.usage、turns 取 step 计数、cost 零值待折算',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: successFixture }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        expect(h.executor).toBe('codex')
        expect(h.pid).toBeGreaterThan(0)

        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        // spawn/行切割/单行归一全链无损：与全文 parseStream 严格一致
        expect(collected).toStrictEqual(goldenEvents())

        expect(adapter.exitCode(h)).toBe(0) // fake CLI 正常退出（记录价值）
        expect(adapter.isCompleted(h)).toBe(true) // turn.completed 归一 turn_end.completed + log 非空

        // cost_native=false：cost 恒 0「待价目表折算」（与 dsh 同口径，codex.ts 头注）
        const stats = await adapter.resultStats(h)
        expect(stats.cost).toStrictEqual({ usd: 0 })
        expect(stats.tokens).toStrictEqual({ input: 2100, output: 640 }) // turn.completed.usage
        expect(stats.turns).toBe(2) // step_end 计数（command_execution + agent_message）
        expect(stats.duration).toBeGreaterThanOrEqual(0) // 自持墙钟
      })
    },
    10_000,
  )

  it(
    '增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield，非整块缓冲',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: successFixture, FAKE_DELAY_MS: '120' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const stamps: number[] = []
          for await (const ev of adapter.stream(h)) {
            stamps.push(Date.now())
            void ev
          }
          expect(stamps.length).toBe(goldenEvents().length)
          // 首事件（item.started）→末事件（turn.completed）隔多个逐行延迟：≥60ms 证明逐行到达
          const first = stamps[0] ?? 0
          const last = stamps[stamps.length - 1] ?? 0
          expect(last - first).toBeGreaterThanOrEqual(60)
        },
      )
    },
    15_000,
  )

  it('stream 二次消费明报拒绝（一单一命、一流一收）', async () => {
    await withFakeEnv({ FAKE_FIXTURE: successFixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev
      await expect(async () => {
        for await (const ev of adapter.stream(h)) void ev
      }).rejects.toThrow(/已消费/)
    })
  })

  it(
    'budgetCap 传入不落地：无任何预算帽旗标（budget_cap=false 照实声明——与 dsh 同做法）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief({ budgetCap: { usd: 5 } }))
        expect(echo).toContain('exec --json') // 基座照常
        expect(echo).not.toContain('budget') // 无旗标可落地——能力声明即契约，调度侧不应传帽
      })
    },
    10_000,
  )
})

describe('失败面（turn.failed 无 usage——17-§6 已知坑；v1.1 turn_end.error 落地）', () => {
  it(
    'turn-failed + FAKE_EXIT=1：completed=false、tokens 零值冻结；错误信息 log 透传 + turn_end.error 挂载',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: failedFixture, FAKE_EXIT: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)

          // 错误信息双落点：log 原文透传 + turn_end.error（协议 v1.1 裁决，streams.ts 落地）
          expect(collected).toContainEqual({ type: 'log', text: 'turn failed: upstream model timeout' })
          expect(collected).toContainEqual({
            type: 'turn_end',
            completed: false,
            error: 'upstream model timeout',
          })
          // 冻结口径：失败路径无任何 turn_end.completed=true
          expect(collected.some((e) => e.type === 'turn_end' && e.completed)).toBe(false)
          expect(adapter.isCompleted(h)).toBe(false)
          expect(adapter.exitCode(h)).toBe(1) // 退出码只记录，不参与判定

          // 已知坑冻结：turn.failed 无 usage——tokens 零值（无来源不折算、不编造）
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(stats.cost).toStrictEqual({ usd: 0 })
          expect(stats.turns).toBe(0) // item.started 无对应 item.completed——step_end 计数为 0
          expect(stats.duration).toBeGreaterThanOrEqual(0)
        },
      )
    },
    10_000,
  )
})

describe('kill 无终态面（codex：turn.completed 未到 = 无终态；对齐 claude 先例）', () => {
  it(
    'FAKE_HANG 半程被杀：无 turn_end、tokens 零值、isCompleted=false；step 事件照收（turns=1）',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: killedFixture, FAKE_HANG: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) collected.push(ev)
          })()
          // 挂起段：fixture 已吐完（step_start×2 + step_end×1），进程不退、turn.completed 未到
          await new Promise((r) => setTimeout(r, 300))
          expect(collected.length).toBe(3)

          await adapter.kill(h, 2_000)
          await consuming // kill 后 stdout 关闭，流自然收尾

          expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
          expect(adapter.exitCode(h)).toBeNull() // 被 SIGTERM 杀死：null（非 0）
          expect(adapter.isCompleted(h)).toBe(false)
          // 无终态账面：tokens 无来源零值、cost 无来源 0；step 事件照收——turns=1
          const stats = await adapter.resultStats(h)
          expect(stats.cost).toStrictEqual({ usd: 0 })
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(stats.turns).toBe(1)
          expect(stats.duration).toBeGreaterThanOrEqual(0)
        },
      )
    },
    15_000,
  )

  it(
    '宽限升级：子进程无视 SIGTERM——graceMs 后 SIGKILL 强杀（不杀则 kill 永不返回）',
    async () => {
      // cmd 注入一个吞 SIGTERM 且不退出的子进程（codex 无吞信号坑——此为压力面）；
      // 末尾 -- 同上：追加旗标须落为位置参数，否则 node 直接 bad option 秒死
      const adapter = new CodexAdapter([
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
      // 竞态修复（2026-10-18 宰相，补 dsh/kimi 修复时遗漏的 codex 孪生）：等 READY 首事件再杀——
      // SIGTERM 早于子进程装好处理器时子进程秒死，宽限断言必翻
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
    await withFakeEnv({ FAKE_FIXTURE: successFixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev // 已自然退出
      await adapter.kill(h, 1_000) // no-op：不抛
      await adapter.kill(h, 1_000) // 幂等：不抛
      expect(adapter.isCompleted(h)).toBe(true) // 先前完成判定不受影响
    })
  })
})

describe('detect（三态——codex 无版本门槛坑，gaps 空为常态）', () => {
  it('`codex-cli 0.42.0` 形态 → ok=true、版本号、无 gaps（无门槛即达标）', async () => {
    await withFakeEnv({ FAKE_VERSION: 'codex-cli 0.42.0' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toStrictEqual({ name: 'codex', version: '0.42.0', ok: true, gaps: [] })
    })
  })

  it('裸语义化版本 `0.9.0` → ok=true 无 gaps', async () => {
    await withFakeEnv({ FAKE_VERSION: '0.9.0' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toStrictEqual({ name: 'codex', version: '0.9.0', ok: true, gaps: [] })
    })
  })

  it('解析失败：版本串不可识别 → ok=false 明报', async () => {
    await withFakeEnv({ FAKE_VERSION: 'unknown-release-format' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toMatchObject({ name: 'codex', ok: false, version: '' })
      expect(r.gaps).toContain('codex-version-unparsed')
    })
  })

  it('未安装：假 cmd 二进制不存在 → ok=false + codex-not-installed', async () => {
    const r = await new CodexAdapter(['codex-harness-definitely-missing']).detect()
    expect(r).toMatchObject({ name: 'codex', ok: false, version: '' })
    expect(r.gaps).toContain('codex-not-installed')
  })
})

describe('launch 参数注入（FAKE_ECHO_ARGS 回显 argv）', () => {
  it(
    '基座形态：exec --json；无续跑时不注入 --resume',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief())
        expect(echo).toContain('exec --json')
        expect(echo).not.toContain('--resume')
      })
    },
    10_000,
  )

  it(
    '续跑：resume.sessionId=sess_7c1d → --resume sess_7c1d（拟稿旗标形，session_resume=true 落地）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(
          fakeAdapter(),
          makeBrief({ resume: { sessionId: 'sess_7c1d', summaryPath: join(workdir, 'summary.json') } }),
        )
        expect(echo).toContain('--resume sess_7c1d')
      })
    },
    10_000,
  )
})

describe('AGENTS.md 通道（env 映射拟稿——codex.ts 头注；变量语义待探针）', () => {
  // cmd 注入 node -e 回显目标 env：末尾 `--` 让适配器追加的流式旗标（exec/--json/--resume）
  // 落为 node 的位置参数而非选项——否则 node 把 -e 后的 -p/--json 类参数报 bad option
  const envEchoAdapter = (varName: string): CodexAdapter =>
    new CodexAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
      '--',
    ])

  it(
    'user_level 通道 → CODEX_HOME=target 透传（变量真实存在；目录/文件语义拟稿待探针）',
    async () => {
      const target = join(workdir, 'codex-home')
      const adapter = envEchoAdapter('CODEX_HOME')
      const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: target }])
    },
    10_000,
  )

  it('native 通道 → 不注入 CODEX_HOME（codex 原生读 workspace AGENTS.md——拟稿假设）', async () => {
    const adapter = envEchoAdapter('CODEX_HOME')
    const h = await adapter.launch(makeBrief())
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    // 无换行残行回流为 log：'<unset>' 证明未注入
    expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
  }, 10_000)

  it(
    'append_system_prompt 通道 → CODEX_APPEND_INSTRUCTIONS_FILE=target（变量自拟，镜像 dsh 同通道做法）',
    async () => {
      const target = join(workdir, 'agents-append.md')
      const adapter = envEchoAdapter('CODEX_APPEND_INSTRUCTIONS_FILE')
      const h = await adapter.launch(
        makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
      )
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: target }])
    },
    10_000,
  )
})

describe('TaskBrief.credentials 透传（v1.4 短命按单凭据——launch env 无条件注入，值不打印不记录）', () => {
  const ECHO_LINE = 'fake-cli env: STUDIO_TOOLS_WKEY='

  it('携带 credentials → 键值出现在子进程 env（FAKE_ECHO_ENV 回显 → log 事件）', async () => {
    await withFakeEnv({ FAKE_ECHO_ENV: 'STUDIO_TOOLS_WKEY' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief({ credentials: { STUDIO_TOOLS_WKEY: 'wkey-fake-token-att1' } }))
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      // 回显行（非 JSON）归一为 log：凭据确已透传进子进程 env（docs/25-§二 v1.4）
      expect(collected).toStrictEqual([{ type: 'log', text: `${ECHO_LINE}wkey-fake-token-att1` }])
    })
  })

  it('未携带 credentials → 该变量未设置（<unset>——可选字段零行为变更）', async () => {
    await withFakeEnv({ FAKE_ECHO_ENV: 'STUDIO_TOOLS_WKEY' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: `${ECHO_LINE}<unset>` }])
    })
  })
})

describe('estimate（拟稿：与 dsh/claude 相同的 v0 模型——v0.6 前细化）', () => {
  it('按任务书字符量粗估 + 低 confidence：60000 字符 → $0.2', async () => {
    const briefPath = join(workdir, 'brief-estimate.md')
    writeFileSync(briefPath, 'x'.repeat(60_000))
    const r = await new CodexAdapter().estimate(makeBrief({ briefPath }))
    expect(r.estimated.usd).toBeCloseTo(0.2, 4)
    expect(r.confidence).toBe(0.2)
  })
})

describe('parseLine 单行导出（codex 家族——含 v1.1 turn.failed→error 映射面）', () => {
  it('fixture 逐行过 parseLine 展平 ≡ parseStream 全文解析（成功与失败两样本）', () => {
    for (const [name, text] of [
      ['turn-completed', readFileSync(successFixture, 'utf8')],
      ['turn-failed', readFileSync(failedFixture, 'utf8')],
    ] as const) {
      const flattened = text.split('\n').flatMap((l) => parseLine(l, 'codex'))
      expect(flattened, name).toStrictEqual(parseStream(text, 'codex'))
    }
  })

  it('turn.failed 单行 → log + turn_end{completed:false,error}（v1.1 裁决落地的单行面）', () => {
    expect(
      parseLine('{"type":"turn.failed","error":{"message":"boom"}}', 'codex'),
    ).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: 'turn failed: boom' },
      { type: 'turn_end', completed: false, error: 'boom' },
    ])
  })

  it('空行/注释行 → 空数组；sessionId 未知 → 明报抛错（伴生状态守卫）', async () => {
    expect(parseLine('# comment', 'codex')).toStrictEqual([])
    expect(parseLine('', 'codex')).toStrictEqual([])
    const adapter = new CodexAdapter()
    const bogus = { executor: 'codex', sessionId: 'no-such-session', pid: -1 }
    await expect(adapter.resultStats(bogus)).rejects.toThrow(/no-such-session/)
    expect(() => adapter.isCompleted(bogus)).toThrow(/no-such-session/)
  })
})
