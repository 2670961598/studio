/**
 * dsh 适配器全链测试 —— 对 fake CLI harness（docs/18-§1.3 独立测试套件）
 *
 * P0 重写（docs/31-§5 修正清单 + §7 五探针实录）：golden 全部换真机实录
 * （P01/P04/P05/P07/A4/P08，来源见各 fixture 头注释）。
 *
 * 覆盖：
 *   - 全链：launch（传任务串）→stream 逐事件消费→resultStats 账目（tokens/duration/turns/cost）
 *   - launch 传任务串（P0）：任务书全文以 `--` 分隔的单个位置参数注入；真机 usage-error 面
 *     （无任务 → 顶层 error 事件 + exit 1）经 FAKE_REQUIRE_TASK 复现；任务书不可读如实抛错
 *   - 遥测红线（docs/31-§5-8）：DSH_TELEMETRY_MODE=DISABLED 注入且压过环境残留
 *   - kill 面（docs/31-§7 P-08 真机定性）：空 final + 无 turn_end + exit 0 = 被 kill
 *     （aborted 口径）——isCompleted 只认 turn_end.reason.kind==='completed'，且仅此一条
 *   - kill 普通挂起：SIGTERM 默认终止（信号死，无退出码）；kill 宽限升级：无视 SIGTERM
 *     的子进程在 graceMs 后被 SIGKILL 强杀
 *   - 失败分类面（P1，docs/31-A4/§7 P-04）：无凭证=MISSING_CREDENTIAL、凭证无效=AUTH
 *     （401 透传）——v1.5（2026-10-19 批）起 code 进 turn_end.errorCode 结构位，message
 *     原文留 error（前缀拼接方案废除；golden fixtures 原文不动，断言切到结构位）
 *   - session-id 收存（v1.5 三件套之二，docs/31-§5-6）：stream() 从流首 session 事件
 *     捕获 dsh 侧 session-<uuid> 写入 Handle.executorSessionId（续跑/对账）
 *   - resumeWithSession 接线：--session-id 透传进 argv 旗标区（P-05 真机形态）+ 空串拒收
 *   - AGENTS.md 通道（v1.5 三件套之一）：user_level/append → STUDIO_NEXT_INSTRUCTIONS=
 *     target（由 packages/dsh-bridge studio-next-bridge 插件消费——插件面测试归 dsh-bridge
 *     包；本套只断言 env 注入）；native → 不注入（真机原生发现通道）
 *   - 孙进程杀灭（execa 10 killDescendants 兑现面，docs/27-§4.3 案 A）：对照组裸 spawn
 *     直杀父 pid 证孙存活可检出（9.x 直杀语义）→ 整树软杀父孙同死 → 孙吞 TERM 由宽限
 *     到点的整组 SIGKILL 扫尾收口（kill() 父退即返回，不等满宽限）
 *   - detect：未安装（假 cmd / PATH 清空）明报不静默；可解析时版本+未锁版本 gap
 *   - estimate 冒烟（拟稿：v0.6 前细化）
 *   - AGENTS.md 通道 env 注入（映射已证伪留占位——见 dsh.ts 头注）
 *   - parseLine 单行导出与 parseStream 全文等价（streams 既有行为不改的旁证）
 *
 * env 注入说明：适配器 spawn 用 {...process.env} 打底——FAKE_* 旋钮经 process.env
 * 临时注入、finally 还原（withFakeEnv），不污染其他用例。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { StreamEvent, TaskBrief } from '@studio-next/contract'
import { DSH_DEFAULT_CMD, DshAdapter } from '../src/dsh.ts'
import { parseLine, parseStream } from '../src/streams.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const p01Fixture = fileURLToPath(new URL('./fixtures/dsh/P01-真成功流.ndjson', import.meta.url))
const p04Fixture = fileURLToPath(new URL('./fixtures/dsh/P04-错误凭据.ndjson', import.meta.url))
const a4Fixture = fileURLToPath(new URL('./fixtures/dsh/A4-无凭证.ndjson', import.meta.url))
const p08Fixture = fileURLToPath(new URL('./fixtures/dsh/P08-kill面.ndjson', import.meta.url))

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'dsh-adapter-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

/** 任务书全文（launch 的任务串来源——argv 注入断言用；单行、无换行，便于整行回显断言） */
const BRIEF_TEXT = 'TASK: 回声任务——按任务书全文回 PROBE-OK'

interface BriefOverrides {
  AGENTS_MD?: TaskBrief['AGENTS_MD']
  briefPath?: string
  credentials?: TaskBrief['credentials']
}

function makeBrief(o: BriefOverrides = {}): TaskBrief {
  const briefPath = o.briefPath ?? join(workdir, 'brief.md')
  // P0 起 launch 读任务书全文作任务串——缺省任务书由测试侧落盘（真实装配管线的等价物）。
  // 显式指定 briefPath 的用例归用例自管（estimate 长文 / 不存在路径），此处不越权代写
  if (o.briefPath === undefined) writeFileSync(briefPath, BRIEF_TEXT)
  return {
    ticket: 'TEST-1',
    attempt: 1,
    briefPath,
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...(o.credentials !== undefined ? { credentials: o.credentials } : {}),
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

const goldenEvents = (): StreamEvent[] => parseStream(readFileSync(p01Fixture, 'utf8'), 'dsh')

describe('全链：launch→stream→resultStats（golden：P01 真成功流）', () => {
  it(
    '流事件与 golden 归一序列一致；账目 tokens/turns/cost/duration 如实；isCompleted=true；dsh 侧 sessionId 捕获入 Handle',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: p01Fixture }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        expect(h.executor).toBe('dsh')
        expect(h.pid).toBeGreaterThan(0)
        expect(h.executorSessionId).toBeUndefined() // 捕获前无此键（流首 session 事件消费时才写）

        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        // spawn/行切割/单行归一全链无损：与全文 parseStream 严格一致
        expect(collected).toStrictEqual(goldenEvents())

        // session-id 收存（v1.5，docs/31-§5-6）：流首 session 事件的 session-<uuid> → Handle
        expect(h.executorSessionId).toBe('session-2d65719e-2aa4-416a-af42-4a612026e671')

        expect(adapter.exitCode(h)).toBe(0) // fake CLI 正常退出（记录价值）
        // 终态判据唯一化：turn_end(reason.kind=completed)→turn_end{completed:true} 存在即真
        expect(adapter.isCompleted(h)).toBe(true)

        const stats = await adapter.resultStats(h)
        // step_end camelCase usage 累计：inputTokens 4510 / outputTokens 26 / cacheReadTokens 256
        expect(stats.tokens).toStrictEqual({ input: 4510, output: 26, cached: 256 })
        expect(stats.turns).toBe(1) // step_end 计数（单 turn 单 step）
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
        { FAKE_FIXTURE: p01Fixture, FAKE_DELAY_MS: '120' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const stamps: number[] = []
          for await (const ev of adapter.stream(h)) {
            stamps.push(Date.now())
            void ev
          }
          expect(stamps.length).toBe(goldenEvents().length)
          // 首末事件间隔 ≥ 120ms：事件确系逐行到达
          const first = stamps[0] ?? 0
          const last = stamps[stamps.length - 1] ?? 0
          expect(last - first).toBeGreaterThanOrEqual(120)
        },
      )
    },
    15_000,
  )

  it('stream 二次消费明报拒绝（一单一命、一流一收）', async () => {
    await withFakeEnv({ FAKE_FIXTURE: p01Fixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev
      await expect(async () => {
        for await (const ev of adapter.stream(h)) void ev
      }).rejects.toThrow(/已消费/)
    })
  })
})

describe('launch 传任务串（P0：docs/31-§0 发现 2/§5-1——任务=单个位置参数，不传真机必败）', () => {
  it('argv 注入：任务书全文以 `--` 分隔的单个位置参数追加（防任务串以 `-` 开头被当旗标）', async () => {
    await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      // 回显行（非 JSON）归一为 log：`--` 分隔符 + 任务书全文单参数
      expect(collected).toStrictEqual([{ type: 'log', text: `fake-cli argv: -- ${BRIEF_TEXT}` }])
    })
  })

  it('缺省命令基座冻结：dsh --profile headless --json（任务串在其后追加）', () => {
    expect(DSH_DEFAULT_CMD).toStrictEqual(['dsh', '--profile', 'headless', '--json'])
  })

  it(
    'FAKE_REQUIRE_TASK=1（真机 usage-error 面）：任务串在 → 正常回放；适配器判定不受影响',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: p01Fixture, FAKE_REQUIRE_TASK: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          for await (const ev of adapter.stream(h)) collected.push(ev)
          expect(collected).toStrictEqual(goldenEvents())
          expect(adapter.exitCode(h)).toBe(0)
          expect(adapter.isCompleted(h)).toBe(true)
        },
      )
    },
    10_000,
  )

  it('任务书不可读：launch 如实抛错（装配管线缺件前置失败，不静默传空）', async () => {
    const adapter = fakeAdapter()
    const brief = makeBrief({ briefPath: join(workdir, 'no-such-brief.md') })
    await expect(adapter.launch(brief)).rejects.toThrow(/任务书不可读/)
  })
})

describe('遥测红线（docs/31-§5-8：dsh 默认 FEEDBACK_ONLY 外发 deepseeksvc.com——一律禁外发）', () => {
  it('launch env 注入 DSH_TELEMETRY_MODE=DISABLED', async () => {
    await withFakeEnv({ FAKE_ECHO_ENV: 'DSH_TELEMETRY_MODE' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([
        { type: 'log', text: 'fake-cli env: DSH_TELEMETRY_MODE=DISABLED' },
      ])
    })
  })

  it('环境残留 FEEDBACK_ONLY 被注入值压过（红线优先级最高）', async () => {
    await withFakeEnv(
      { FAKE_ECHO_ENV: 'DSH_TELEMETRY_MODE', DSH_TELEMETRY_MODE: 'FEEDBACK_ONLY' },
      async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        expect(collected).toStrictEqual([
          { type: 'log', text: 'fake-cli env: DSH_TELEMETRY_MODE=DISABLED' },
        ])
      },
    )
  })
})

describe('kill 面（docs/31-§7 P-08 真机定性：空 final + 无 turn_end + exit 0 = 被 kill——aborted 口径）', () => {
  it(
    'FAKE_HANG+FAKE_SIGTERM_EXIT=0：优雅空 final、无 turn_end、退出码 0——判定未完成（非成功非失败）',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: p08Fixture, FAKE_HANG: '1', FAKE_SIGTERM_EXIT: '0' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const collected: StreamEvent[] = []
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) collected.push(ev)
          })()
          // 挂起段：fixture 已吐完（3 归一事件——final 空文本不产事件），进程不退、stdout 未关
          await new Promise((r) => setTimeout(r, 300))
          expect(collected.length).toBe(3)

          await adapter.kill(h, 2_000)
          await consuming // kill 后 stdout 关闭，流自然收尾

          // P-08 实录形态：无任何 turn_end 事件（终态判据唯一化的根据）
          expect(collected.some((e) => e.type === 'turn_end')).toBe(false)
          // 坑位实锤：退出码 0（优雅收尾）+ 空 final + 无 turn_end → isCompleted=false；
          // 「输出非空」（session/turn_start 原文 log 在流里）绝不参与判定
          expect(adapter.exitCode(h)).toBe(0)
          expect(adapter.isCompleted(h)).toBe(false)
          // 被杀半程的账目照样可收：无任何 step usage → 零账（不编造）
          const stats = await adapter.resultStats(h)
          expect(stats.tokens).toStrictEqual({ input: 0, output: 0 })
          expect(stats.turns).toBe(0)
        },
      )
    },
    15_000,
  )

  it(
    '普通挂起（不吞信号）：SIGTERM 默认终止——信号死无退出码，判定未完成',
    async () => {
      await withFakeEnv(
        { FAKE_FIXTURE: p08Fixture, FAKE_HANG: '1' },
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
    await withFakeEnv({ FAKE_FIXTURE: p01Fixture }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.launch(makeBrief())
      for await (const ev of adapter.stream(h)) void ev // 已自然退出
      await adapter.kill(h, 1_000) // no-op：不抛
      await adapter.kill(h, 1_000) // 幂等：不抛
      expect(adapter.isCompleted(h)).toBe(true) // 先前完成判定不受影响
    })
  })
})

describe('失败分类面（P1：docs/31-A4/§7 P-04——v1.5 起 errorCode 结构位，message 原文留 error）', () => {
  it(
    'P04 错误凭据：errorCode=AUTH、error=401 原文（无前缀）、isCompleted=false、usage 全 0 账如实、exit=1',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: p04Fixture, FAKE_EXIT: '1' }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)

        const turnEnd = collected.find(
          (e): e is Extract<StreamEvent, { type: 'turn_end' }> => e.type === 'turn_end',
        )
        expect(turnEnd).toBeDefined()
        // v1.5 结构位：code 进 errorCode；error=message 原文（前缀方案废除）
        expect(turnEnd?.errorCode).toBe('AUTH')
        expect(turnEnd?.error).toMatch(/^401 /) // 上游 401 JSON 透传，无 AUTH 前缀
        expect(turnEnd?.completed).toBe(false)
        expect(adapter.isCompleted(h)).toBe(false)
        expect(adapter.exitCode(h)).toBe(1) // 真机失败面 exit=1（证据价值）

        const stats = await adapter.resultStats(h)
        expect(stats.tokens).toStrictEqual({ input: 0, output: 0, cached: 0 }) // 四桶全 0 如实入账
        expect(stats.turns).toBe(1)
        // 失败面照样捕获 dsh 侧 sessionId（对账面不因失败缺席）
        expect(h.executorSessionId).toBe('session-c70a23a6-7b4f-4af8-89bf-4450515ea0b3')
      })
    },
    10_000,
  )

  it(
    'A4 无凭证：errorCode=MISSING_CREDENTIAL（与 AUTH 并列）、error=llm-deepseek 原文、step_end 无 usage → 零账',
    async () => {
      await withFakeEnv({ FAKE_FIXTURE: a4Fixture, FAKE_EXIT: '1' }, async () => {
        const adapter = fakeAdapter()
        const h = await adapter.launch(makeBrief())
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)

        const turnEnd = collected.find(
          (e): e is Extract<StreamEvent, { type: 'turn_end' }> => e.type === 'turn_end',
        )
        expect(turnEnd?.completed).toBe(false)
        expect(turnEnd?.errorCode).toBe('MISSING_CREDENTIAL')
        expect(turnEnd?.error).toMatch(/^llm-deepseek: no API key /) // 原文，无前缀
        expect(adapter.isCompleted(h)).toBe(false)
        expect(adapter.exitCode(h)).toBe(1)

        const stats = await adapter.resultStats(h)
        expect(stats.tokens).toStrictEqual({ input: 0, output: 0 }) // 无任何 step usage：零账不编造
        expect(stats.turns).toBe(1)
        expect(h.executorSessionId).toBe('session-0ec30278-155a-46f7-bdcf-2ba8f08c2081')
      })
    },
    10_000,
  )
})

// ---------------------------------------------------------------------------
// 孙进程杀灭（execa 10 killDescendants：16-§二「唯一内建进程组杀法」兑现面，
// docs/27-§4.3 案 A——9.x 直杀子进程覆盖不到子孙树，本组为升级核心价值的直接证明）
// ---------------------------------------------------------------------------

/** pid 存活探测（ps 等价）：signal 0 探活；孤儿僵尸在被收割前仍报在（waitDead 含收割窗口） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 轮询等 pid 消亡（含孤儿僵尸被 launchd/init 收割的窗口）；到点未死返回 false */
async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !isAlive(pid)
}

/** 等孙进程就绪：pid 文件落盘且探活成功（孙自落 pid=就绪信号——文件在 fake CLI 孙进程侧写） */
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

describe('孙进程杀灭（execa 10 killDescendants：整树软杀 + 宽限整树硬杀）', () => {
  it(
    '对照组（9.x 语义）：裸 spawn 直杀父 pid——孙进程存活（断言机制非盲证，升级动机实锤）',
    async () => {
      const pidFile = join(workdir, `grandchild-control-${Date.now()}.pid`)
      // 裸 child_process.spawn + 只杀父 pid ＝ execa 9.x 无 killDescendants 的同款直杀语义
      const parent = spawn(process.execPath, [fakeCli], {
        env: { ...process.env, FAKE_HANG: '1', FAKE_GRANDCHILD_PID_FILE: pidFile },
        stdio: 'ignore',
      })
      let gpid = 0
      try {
        gpid = await waitGrandchildReady(pidFile)
        parent.kill('SIGTERM') // 直杀父——不波及子孙树
        await new Promise<void>((r) => parent.once('exit', r))
        await new Promise((r) => setTimeout(r, 300)) // 给「本该整组波及」留足观察窗
        expect(isAlive(gpid)).toBe(true) // 孙仍活：直杀覆盖不到——9.x 做不到整树杀的实证
      } finally {
        if (gpid > 0) {
          // 对照组孤儿孙收口：直杀 pid + 等收割（不留长眠孤儿）
          try {
            process.kill(gpid, 'SIGKILL')
          } catch {
            // 已死
          }
          await waitDead(gpid, 3_000)
        }
      }
    },
    15_000,
  )

  it(
    '整树软杀：FAKE_HANG 父 + 长眠孙——kill() 一发 SIGTERM，父孙同死',
    async () => {
      const pidFile = join(workdir, `grandchild-term-${Date.now()}.pid`)
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
        expect(await waitDead(gpid, 3_000)).toBe(true) // 孙随整组同灭（对照组已证直杀做不到）
      })
    },
    15_000,
  )

  it(
    '宽限扫尾硬杀整树：孙吞 SIGTERM、父默认即死——kill() 父退即返回，孙在 graceMs 后被整组 SIGKILL 收口',
    async () => {
      const pidFile = join(workdir, `grandchild-sweep-${Date.now()}.pid`)
      await withFakeEnv(
        { FAKE_HANG: '1', FAKE_GRANDCHILD_PID_FILE: pidFile, FAKE_GRANDCHILD_IGNORE_TERM: '1' },
        async () => {
          const adapter = fakeAdapter()
          const h = await adapter.launch(makeBrief())
          const consuming = (async () => {
            for await (const ev of adapter.stream(h)) void ev
          })()
          const gpid = await waitGrandchildReady(pidFile)
          const t0 = Date.now()
          await adapter.kill(h, 400) // 父默认 TERM 即死：kill() 不等满宽限即返回
          expect(Date.now() - t0).toBeLessThan(350)
          // 孙吞 TERM 存活过父退——此刻只有宽限扫尾定时器能收它：400ms 整组 SIGKILL
          expect(await waitDead(gpid, 3_000)).toBe(true)
          await consuming
        },
      )
    },
    15_000,
  )
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

describe('AGENTS.md 通道 env 注入（v1.5 三件套之一：插件通道——STUDIO_NEXT_INSTRUCTIONS 由 packages/dsh-bridge studio-next-bridge 消费；docs/31-A1/§5-5 裁决 docs/25-§3.1 v1.5#1）', () => {
  // cmd 注入 node -e 回显目标 env：值经 stdout 以 log 事件回流断言
  const echoAdapter = (varName: string): DshAdapter =>
    new DshAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
    ])

  it('user_level 通道 → STUDIO_NEXT_INSTRUCTIONS=target 透传', async () => {
    const target = join(workdir, 'agents-user-level.md')
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('append_system_prompt 通道 → STUDIO_NEXT_INSTRUCTIONS=target 透传（dsh 无 append 专道，两通道汇一）', async () => {
    const target = join(workdir, 'agents-append.md')
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('native 通道 → 不注入通道变量（真机原生发现：launch cwd 向上扫 AGENTS.md，P-07 实证）', async () => {
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    // 无换行残行回流为 log：'<unset>' 证明未注入
    expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
  })

  it('证伪变量已移除：DSH_AGENTS_MD / DSH_APPEND_SYSTEM_PROMPT_FILE 全通道零注入', async () => {
    for (const channel of ['user_level', 'append_system_prompt'] as const) {
      const adapter = echoAdapter('DSH_AGENTS_MD')
      const h = await adapter.launch(
        makeBrief({ AGENTS_MD: { channel, target: join(workdir, 'agents-x.md') } }),
      )
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
    }
  })
})

describe('resumeWithSession（v1.5 三件套之二接线：--session-id 透传——docs/31-§7 P-05 真机形态/§3.4 约束；capabilities.session_resume 仍 false）', () => {
  it('argv 注入：--session-id <id> 插在 `--` 任务串之前（dsh 旗标区）', async () => {
    await withFakeEnv({ FAKE_ECHO_ARGS: '1' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.resumeWithSession(
        makeBrief(),
        'session-2d65719e-2aa4-416a-af42-4a612026e671',
      )
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([
        {
          type: 'log',
          text: `fake-cli argv: --session-id session-2d65719e-2aa4-416a-af42-4a612026e671 -- ${BRIEF_TEXT}`,
        },
      ])
    })
  })

  it('空串/纯空白会话 id 拒收（真机同款立即失败面前置明报）', async () => {
    const adapter = fakeAdapter()
    await expect(adapter.resumeWithSession(makeBrief(), '')).rejects.toThrow(/dsh 侧会话 id/)
    await expect(adapter.resumeWithSession(makeBrief(), '   ')).rejects.toThrow(/dsh 侧会话 id/)
  })

  it('未知 id 面（真机 docs/31-§2 A5）：stdout 0 事件即败——isCompleted=false 如实（回放空输出 fixture）', async () => {
    // fake CLI 无 FAKE_FIXTURE：零输出退出 1——真机未知 --session-id 的等价形态
    await withFakeEnv({ FAKE_EXIT: '1' }, async () => {
      const adapter = fakeAdapter()
      const h = await adapter.resumeWithSession(makeBrief(), 'session-nonexistent')
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([])
      expect(adapter.isCompleted(h)).toBe(false)
      expect(adapter.exitCode(h)).toBe(1)
    })
  })
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

describe('parseLine 单行导出（streams.ts 既有导出——行为不改的旁证）', () => {
  it('dsh 家族：fixture 逐行过 parseLine 展平 ≡ parseStream 全文解析', () => {
    const text = readFileSync(p01Fixture, 'utf8')
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
