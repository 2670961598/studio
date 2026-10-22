/**
 * claude 适配器全链测试 —— 对 fake CLI harness（docs/18-§1.3 独立测试套件）
 *
 * 覆盖（任务口径：对 fake 全绿，真 CLI 行为留探针单）：
 *   - 全链：launch→stream 逐事件消费→resultStats 原生账目（cost_native=true——
 *     cost=total_cost_usd、duration=duration_ms、turns=num_turns 全取自 result 事件）
 *   - 增量流：FAKE_DELAY_MS 逐行吐出——stream 逐行 yield 非整块缓冲
 *   - 错误终态（result-error fixture）：is_error=true → completed=false 但原生账目照收；
 *     FAKE_EXIT=3 佐证退出码不参与成功判定
 *   - kill 无终态面（claude 特有）：FAKE_HANG 半程被杀 → result 未到 = 无 turn_end、
 *     账目零值、nativeSessionId 未回填（dsh 无此面——它没有 result 事件语义）
 *   - kill 宽限升级：无视 SIGTERM 的子进程在 graceMs 后被 SIGKILL 强杀；kill 幂等
 *   - detect 版本门槛三态（docs/18-§一：claude≥2.1.277 才原生读 AGENTS.md）：
 *     ≥门槛 native 可用 / <门槛 ok:true+gaps 明示回退（不拦截启动）/ 解析失败·未装 ok:false
 *   - launch 参数注入（FAKE_ECHO_ARGS 回显）：-p --output-format stream-json 基座、
 *     预算帽 --max-budget-usd、续跑 --resume
 *   - AGENTS.md 通道：user_level=CLAUDE_CONFIG_DIR（拟稿变量）、append=--append-system-prompt-file
 *     （官方文档依据）、detect<门槛时 native/user_level 自动降级 append（17-§5 回退）
 *   - estimate 冒烟（与 dsh 相同的 v0 拟稿）；parseLine 单行导出与 parseStream 全文等价
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
import { ClaudeAdapter } from '../src/claude.ts'
import { parseLine, parseStream } from '../src/streams.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const successFixture = fileURLToPath(
  new URL('./fixtures/claude/result-success.jsonl', import.meta.url),
)
const errorFixture = fileURLToPath(new URL('./fixtures/claude/result-error.jsonl', import.meta.url))
const noResultFixture = fileURLToPath(
  new URL('./fixtures/claude/killed-no-result.jsonl', import.meta.url),
)

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'claude-adapter-test-'))
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
    ticket: 'TEST-2',
    attempt: 1,
    briefPath: o.briefPath ?? join(workdir, 'brief.md'),
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...(o.budgetCap !== undefined ? { budgetCap: o.budgetCap } : {}),
    ...(o.resume !== undefined ? { resume: o.resume } : {}),
    ...(o.credentials !== undefined ? { credentials: o.credentials } : {}),
  }
}

function fakeAdapter(): ClaudeAdapter {
  return new ClaudeAdapter([process.execPath, fakeCli])
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
  parseStream(readFileSync(successFixture, 'utf8'), 'claude')

/** FAKE_ECHO_ARGS 下取首条 log（argv 回显行）——launch 参数注入断言用 */
async function echoArgv(adapter: ClaudeAdapter, brief: TaskBrief): Promise<string> {
  const h = await adapter.launch(brief)
  const collected: StreamEvent[] = []
  for await (const ev of adapter.stream(h)) collected.push(ev)
  const first = collected[0]
  return first !== undefined && first.type === 'log' ? first.text : ''
}

describe('capabilities（能力声明冻结：17-§6 claude 行）', () => {
  it('budget_cap/cancel_turn/session_resume/agents_md/cost_native 五项如实', () => {
    expect(new ClaudeAdapter().capabilities).toStrictEqual({
      budget_cap: true, // --max-budget-usd
      cancel_turn: false,
      session_resume: true, // --resume
      agents_md: 'native', // 静态声明；<2.1.277 launch 自动降级（claude.ts 头注拟稿）
      cost_native: true, // result.total_cost_usd——四家第一家
    })
  })
})

describe('全链：launch→stream→resultStats（fixture：result-success）', () => {
  it(
    '流事件与 golden 归一序列一致；账目取 result 原生 cost/tokens/duration/num_turns；session_id 回填',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: successFixture }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        expect(h.executor).toBe('claude')
        expect(h.pid).toBeGreaterThan(0)

        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        // spawn/行切割/单行归一全链无损：与全文 parseStream 严格一致
        expect(collected).toStrictEqual(goldenEvents())

        expect(adapter.exitCode(h)).toBe(0) // fake CLI 正常退出（记录价值）
        expect(adapter.isCompleted(h)).toBe(true) // result 归一 turn_end.completed + log 非空
        expect(adapter.nativeSessionId(h)).toBe('sess_2f9c') // result.session_id 回填（续跑用）

        // 原生账目（cost_native=true）：全部取自 result 事件，非折算非墙钟
        const stats = await adapter.resultStats(h)
        expect(stats.cost).toStrictEqual({ usd: 0.0137 }) // total_cost_usd
        expect(stats.tokens).toStrictEqual({ input: 1468, output: 233, cache_read: 5120 }) // result.usage 归一（cache_read_input_tokens 源 → 新键 cache_read，132-§6.1 单A）
        expect(stats.duration).toBe(4500) // duration_ms
        expect(stats.turns).toBe(2) // num_turns
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
          // 首事件（system 行）→末事件（result 行）隔 2 个逐行延迟：≥60ms 证明逐行到达
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
    '错误终态（result-error + FAKE_EXIT=3）：completed=false 但原生账目照收——退出码不参与判定',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: errorFixture, FAKE_EXIT: '3' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)
          // is_error=true / subtype=error_max_turns → 唯一终态判失败；result.text 空串不产 log
          expect(collected.some((e) => e.type === 'turn_end' && !e.completed)).toBe(true)
          expect(adapter.isCompleted(h)).toBe(false)
          expect(adapter.exitCode(h)).toBe(3) // 退出码只记录
          expect(adapter.nativeSessionId(h)).toBe('sess_2fa1')

          const stats = await adapter.resultStats(h)
          expect(stats.cost).toStrictEqual({ usd: 0.0972 }) // 出错单照样有真账
          expect(stats.tokens).toStrictEqual({ input: 9014, output: 8022 }) // 无缓存桶字段
          expect(stats.duration).toBe(61_000)
          expect(stats.turns).toBe(10)
        },
      )
    },
    10_000,
  )
})

describe('kill 无终态面（claude：result 未到 = 无终态；17-§6 kill 行）', () => {
  it(
    'FAKE_HANG 半程被杀：无 turn_end、账目零值、session_id 未回填（SIGTERM 默认终止）',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: noResultFixture, FAKE_HANG: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) collected.push(ev)
          })()
          // 挂起段：fixture 已吐完（system+assistant 两条 log），进程不退、result 未到
          await new Promise((r) => setTimeout(r, 300))
          expect(collected.length).toBe(2)

          await adapter.kill(h, 2_000)
          await consuming // kill 后 stdout 关闭，流自然收尾

          expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
          expect(adapter.exitCode(h)).toBeNull() // 被 SIGTERM 杀死：null（非 0）
          expect(adapter.isCompleted(h)).toBe(false)
          expect(adapter.nativeSessionId(h)).toBeUndefined() // result 未到：无回填
          // 无终态账面：cost 无来源、tokens 无事件、turns 0；duration 回退墙钟
          const stats = await adapter.resultStats(h)
          expect(stats.cost).toStrictEqual({ usd: 0 })
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(stats.turns).toBe(0)
          expect(stats.duration).toBeGreaterThanOrEqual(0)
        },
      )
    },
    15_000,
  )

  it(
    '宽限升级：子进程无视 SIGTERM——graceMs 后 SIGKILL 强杀（不杀则 kill 永不返回）',
    async () => {
      // cmd 注入一个吞 SIGTERM 且不退出的子进程（比 fake CLI 更极端：软杀完全无效）；
      // 末尾 -- 同上：追加旗标须落为位置参数，否则 node 直接 bad option 秒死
      const adapter = new ClaudeAdapter([
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1e9)',
        '--',
      ])
      const h = await adapter.launch(makeBrief())
      const consuming = (async () => {
        for await (const ev of adapter.stream(h)) void ev
      })()
      await new Promise((r) => setTimeout(r, 100))
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
      expect(adapter.nativeSessionId(h)).toBe('sess_2f9c')
    })
  })
})

// ---------------------------------------------------------------------------
// 孙进程杀灭冒烟（execa 10 killDescendants 兑现面，docs/27-§4.3 案 A；
// 对照组/整树软杀/吞信号扫尾三面详证在 dsh 套件——本冒烟钉住 claude spawn 选项不回退）
// ---------------------------------------------------------------------------

/** pid 存活探测（signal 0）；孤儿僵尸在被收割前仍报在（waitDead 含收割窗口） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 轮询等 pid 消亡；到点未死返回 false */
async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !isAlive(pid)
}

/** 等孙进程就绪：pid 文件落盘且探活成功（孙自落 pid=就绪信号，fake CLI 孙进程侧写） */
async function waitGrandchildReady(pidFile: string, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return pid
    } catch {
      // pid 文件尚未落盘：孙还在启动
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`孙进程就绪超时：${pidFile} 未落盘或孙未存活`)
}

describe('孙进程杀灭冒烟（execa 10 killDescendants：整树软杀——详证三面在 dsh 套件）', () => {
  it(
    'FAKE_HANG 父 + 长眠孙——kill() 一发 SIGTERM 父孙同死（9.x 直杀做不到）',
    async () => {
      const pidFile = join(workdir, `claude-grandchild-${Date.now()}.pid`)
      await withFakeEnv({ FAKE_HANG: '1', FAKE_GRANDCHILD_PID_FILE: pidFile }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        const consuming = (async () => {
          for await (const ev of adapter.stream(h)) void ev
        })()
        const gpid = await waitGrandchildReady(pidFile)
        expect(isAlive(gpid)).toBe(true) // 杀前孙确在
        await adapter.kill(h, 2_000) // 父默认 TERM 即死：kill() 快速返回
        await consuming
        expect(await waitDead(gpid, 3_000)).toBe(true) // 孙随整组同灭
      })
    },
    15_000,
  )
})

describe('detect（版本门槛 2.1.277 三态——docs/18-§一：≥门槛才原生读 AGENTS.md）', () => {
  it('≥门槛：`2.1.277 (Claude Code)` 形态 → ok=true、版本号、无 gaps', async () => {
    await withFakeEnv({ FAKE_VERSION: '2.1.277 (Claude Code)' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toStrictEqual({ name: 'claude', version: '2.1.277', ok: true, gaps: [] })
    })
  })

  it('高于门槛：2.2.0 → ok=true 无 gaps（数字段比较，非字典序）', async () => {
    await withFakeEnv({ FAKE_VERSION: '2.2.0' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r.ok).toBe(true)
      expect(r.version).toBe('2.2.0')
      expect(r.gaps).toStrictEqual([])
    })
  })

  it('低于门槛：2.1.276 → ok=true + gaps 明示 agents_md 回退（不拦截启动）', async () => {
    await withFakeEnv({ FAKE_VERSION: '2.1.276' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r.ok).toBe(true) // 不拦截启动
      expect(r.version).toBe('2.1.276')
      expect(r.gaps.length).toBe(1)
      expect(r.gaps[0]).toMatch(/^claude-agents-md-fallback:2\.1\.276<2\.1\.277:degrade-to-append_system_prompt$/)
    })
  })

  it('解析失败：版本串不可识别 → ok=false 明报', async () => {
    await withFakeEnv({ FAKE_VERSION: 'unknown-release-format' }, async () => {
      const r = await fakeAdapter().detect()
      expect(r).toMatchObject({ name: 'claude', ok: false, version: '' })
      expect(r.gaps).toContain('claude-version-unparsed')
    })
  })

  it('未安装：假 cmd 二进制不存在 → ok=false + claude-not-installed', async () => {
    const r = await new ClaudeAdapter(['claude-harness-definitely-missing']).detect()
    expect(r).toMatchObject({ name: 'claude', ok: false, version: '' })
    expect(r.gaps).toContain('claude-not-installed')
  })
})

describe('launch 参数注入（FAKE_ECHO_ARGS 回显 argv）', () => {
  it(
    '基座形态：-p --output-format stream-json；无预算帽/续跑/append 时不注入对应旗标',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief())
        expect(echo).toContain('-p')
        expect(echo).toContain('--output-format stream-json')
        expect(echo).not.toContain('--max-budget-usd')
        expect(echo).not.toContain('--resume')
        expect(echo).not.toContain('--append-system-prompt-file')
      })
    },
    10_000,
  )

  it(
    '预算帽：budgetCap.usd=5 → --max-budget-usd 5（budget_cap=true 落地）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(fakeAdapter(), makeBrief({ budgetCap: { usd: 5 } }))
        expect(echo).toContain('--max-budget-usd 5')
      })
    },
    10_000,
  )

  it(
    '续跑：resume.sessionId=sess_2f9c → --resume sess_2f9c（session_resume=true 落地）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(
          fakeAdapter(),
          makeBrief({ resume: { sessionId: 'sess_2f9c', summaryPath: join(workdir, 'summary.json') } }),
        )
        expect(echo).toContain('--resume sess_2f9c')
      })
    },
    10_000,
  )
})

describe('AGENTS.md 通道（映射 + 版本门槛自动降级；user_level 变量为拟稿）', () => {
  // cmd 注入 node -e 回显目标 env：末尾 `--` 让适配器追加的流式旗标（-p/--output-format）
  // 落为 node 的位置参数而非选项——否则 node 把 -p 当 --print、--output-format 报 bad option
  const envEchoAdapter = (varName: string): ClaudeAdapter =>
    new ClaudeAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
      '--',
    ])

  it(
    'user_level 通道 → CLAUDE_CONFIG_DIR=target 透传（变量名拟稿，claude.ts 头注）',
    async () => {
      const target = join(workdir, 'claude-config')
      const adapter = envEchoAdapter('CLAUDE_CONFIG_DIR')
      const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: target }])
    },
    10_000,
  )

  it(
    'native 通道（未 detect）→ 不注入 CLAUDE_CONFIG_DIR',
    async () => {
      const adapter = envEchoAdapter('CLAUDE_CONFIG_DIR')
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      // 无换行残行回流为 log：'<unset>' 证明未注入
      expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
    },
    10_000,
  )

  it(
    'append_system_prompt 通道 → --append-system-prompt-file <target>（官方文档依据，17-§6/复查 A3）',
    async () => {
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const target = join(workdir, 'agents-append.md')
        const echo = await echoArgv(
          fakeAdapter(),
          makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
        )
        expect(echo).toContain('--append-system-prompt-file')
        expect(echo).toContain(target)
      })
    },
    10_000,
  )

  it(
    'native 通道 + detect<门槛 → 自动降级 append_system_prompt（gaps 已明报，非静默）',
    async () => {
      const adapter = fakeAdapter()
      await withFakeEnv({ FAKE_VERSION: '2.1.276' }, async () => {
        const r = await adapter.detect()
        expect(r.ok).toBe(true)
        expect(r.gaps[0]).toMatch(/^claude-agents-md-fallback:/)
      })
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(adapter, makeBrief()) // native 缺省通道
        expect(echo).toContain('--append-system-prompt-file')
        expect(echo).toContain(join(workdir, 'AGENTS.md')) // target 透传
      })
    },
    15_000,
  )

  it(
    'user_level 通道 + detect<门槛 → 同降级 append（17-§5：claude<2.1.277 回退 append-system-prompt-file）',
    async () => {
      const adapter = fakeAdapter()
      await withFakeEnv({ FAKE_VERSION: '2.1.200' }, async () => {
        await adapter.detect()
      })
      await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
        const echo = await echoArgv(
          adapter,
          makeBrief({ AGENTS_MD: { channel: 'user_level', target: join(workdir, 'claude-config') } }),
        )
        expect(echo).toContain('--append-system-prompt-file')
      })
    },
    15_000,
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

describe('estimate（拟稿：与 dsh 相同的 v0 模型——v0.6 前细化）', () => {
  it('按任务书字符量粗估 + 低 confidence：60000 字符 → $0.2', async () => {
    const briefPath = join(workdir, 'brief-estimate.md')
    writeFileSync(briefPath, 'x'.repeat(60_000))
    const r = await new ClaudeAdapter().estimate(makeBrief({ briefPath }))
    expect(r.estimated.usd).toBeCloseTo(0.2, 4)
    expect(r.confidence).toBe(0.2)
  })
})

describe('parseLine 单行导出（claude 家族——streams.ts 既有行为不改的旁证）', () => {
  it('fixture 逐行过 parseLine 展平 ≡ parseStream 全文解析', () => {
    const text = readFileSync(successFixture, 'utf8')
    const flattened = text.split('\n').flatMap((l) => parseLine(l, 'claude'))
    expect(flattened).toStrictEqual(parseStream(text, 'claude'))
  })

  it('空行/注释行 → 空数组；sessionId 未知 → 明报抛错（伴生状态守卫）', async () => {
    expect(parseLine('# comment', 'claude')).toStrictEqual([])
    expect(parseLine('', 'claude')).toStrictEqual([])
    const adapter = new ClaudeAdapter()
    const bogus = { executor: 'claude', sessionId: 'no-such-session', pid: -1 }
    await expect(adapter.resultStats(bogus)).rejects.toThrow(/no-such-session/)
    expect(() => adapter.nativeSessionId(bogus)).toThrow(/no-such-session/)
  })
})
