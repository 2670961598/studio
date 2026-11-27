/**
 * agy-adapter.test.ts —— Antigravity CLI（agy）适配器首刀验收（team task-140；LANE-X）
 *
 * 冻结验收口径（task-140 交付物③）：全部用 fake CLI（`fake-cli/fake-agy.mjs` 场景文件
 * 驱动——agy env 白名单收不到 FAKE_* 旋钮，剧本只能落盘进 launch cwd），零网络零真机：
 *   ① 成功面：单对象 JSON 终稿 → log(response)+turn_end(completed,usage)，
 *      conversation_id→Handle.executorSessionId，num_turns→ResultStats.turns
 *   ② launch argv：-p 任务串 / --output-format json / --dangerously-skip-permissions /
 *      --model / --add-dir workspace / --print-timeout；**永不下发 --mode**（auto 不可用）
 *   ③ env 白名单（适配器面；三道闸纯函数直证见 agy-env.test.ts）：封闭允许集
 *      （PATH/HOME/LANG/TZ/TMPDIR/LC_*+代理键）放行、宿主敏感键与 FAKE_* 不可见；proxyEnv 钉扎
 *      直证；TaskBrief.credentials v1.4 只收封闭枚举键（STUDIO_TOOLS_WKEY）；枚举外键结构拒收
 *      （CONFIG_INVALID，子进程不起）且值不打印
 *   ④ 失败分类：auth→errorCode=AUTH＋登录/代理提示；quota→EXTERNAL_RATE_LIMIT；
 *      eligibility/region/超时/坏 JSON→无码（EXECUTOR_ERROR_CODES 冻结词表外无码，文本承载）；
 *      stderr AGY_ERROR 结构化行取证；finished_reason 在场＝残稿不计完成（usage 照记）
 *   ⑤ 超时 watchdog：print 超时→timeout 面整组回收（fake 挂起场景）；CLI 自退走残稿面
 *   ⑥ kill 升级链：SIGTERM 被吞→宽限→SIGKILL 整组回收；被杀会话无终态（aborted 口径）；
 *      已退出会话 kill 无可杀
 *   ⑦ detect 三态＋未安装＋版本地板；estimate v0 拟稿模型；resume fail-closed；二进制缺席
 *      ENOENT 面；构造选项形状闸；注册面 patches→argv；AGENTS_MD 通道（append 拼接进 -p /
 *      native 不拼 / user_level 拒收）；stream 单消费；SUCCESS 空输出不伪造成功
 *
 * 依据：docs/18-§一（六原语+detect 不达标明报）、docs/25-§二（v1.4 credentials）、
 *   docs/43-附录A-1 同型 env 白名单纪律、contract schemas/errors.ts EXECUTOR_ERROR_CODES
 *   冻结词表（词表外无码）；task-140 实测事实单（agy v1.5.18 参数与 JSON 形态）。
 * 边界：fake 场景=实测样本的**结构回放**（非保证面）；真机探钢单另行立（头注 agy.ts 拟稿段）；
 *   本文件 <600 行阈内自查（scripts/guards/boundary-rules.mjs）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { AgyAdapter } from '../../src/agy.ts'
import type { AgyAdapterOptions } from '../../src/agy.ts'
import { builtinResolver } from '../../src/agentconfig.ts'
import type { ClassifiedError, ExecutorAdapter, Handle, StreamEvent, TaskBrief } from '@studio-next/contract'

const fakeAgy = fileURLToPath(new URL('../fake-cli/fake-agy.mjs', import.meta.url))
const workdir = mkdtempSync(join(tmpdir(), 'agy-adapter-test-'))
const reportPath = join(workdir, 'agy-fake-report.json')
afterAll(() => rmSync(workdir, { recursive: true, force: true }))

const MODEL = 'Gemini 4 Neon (High)'
const TASK_TEXT = 'AGY-TEST: 执行演练任务文本（单行）'
const AGENTS_SEPARATOR = '\n\n--- AGENTS.md ---\n'
const SUCCESS_JSON = JSON.stringify({
  conversation_id: 'conv-abc-123',
  status: 'SUCCESS',
  response: '演练完成：产出一行结论。',
  duration_seconds: 5.18,
  num_turns: 1,
  usage: { input_tokens: 12297, output_tokens: 121, thinking_tokens: 119, cache_read_tokens: 0, total_tokens: 12418 },
})

interface FakeReport {
  pid: number
  argv: string[]
  cwd: string
  envKeys: string[]
  proxyEnv: Record<string, string | null>
}

let briefSeq = 0
function makeBrief(overrides: Partial<TaskBrief> = {}): TaskBrief {
  const briefPath = join(workdir, `brief-${String(++briefSeq)}.md`)
  writeFileSync(briefPath, TASK_TEXT, 'utf8')
  return {
    ticket: 'TEST-AGY',
    attempt: 1,
    briefPath,
    workspace: workdir,
    AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...overrides,
  }
}

function makeScenario(json: Record<string, unknown>, dir: string = workdir): string {
  const path = join(dir, 'agy-fake-scenario.json')
  writeFileSync(path, `${JSON.stringify(json)}\n`, 'utf8')
  return path
}

function adapter(opts: AgyAdapterOptions = {}): AgyAdapter {
  return new AgyAdapter([process.execPath, fakeAgy], opts)
}

/** 拉起＋消费到底：返回归一事件与 Handle（ExecutorAdapter 公共面即可——注册面工厂产物同走） */
async function run(a: ExecutorAdapter, task: TaskBrief): Promise<{ events: StreamEvent[]; handle: Handle }> {
  const h = await a.launch(task)
  const events: StreamEvent[] = []
  for await (const ev of a.stream(h)) events.push(ev)
  return { events, handle: h }
}

function readReport(): FakeReport {
  return JSON.parse(readFileSync(reportPath, 'utf8')) as FakeReport
}

async function withHostEnv<T>(kvs: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(kvs)) {
    saved.set(k, process.env[k])
    process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('① 成功面 · 单对象 JSON 终稿归一', () => {
  it('SUCCESS → log(response)+turn_end(completed,usage)，conversation_id 入 Handle，num_turns 入账', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const a = adapter({ model: MODEL })
    const { events, handle } = await run(a, makeBrief())
    expect(events).toEqual([
      { type: 'log', text: '演练完成：产出一行结论。' },
      { type: 'turn_end', completed: true, usage: { input: 12297, output: 121, cache_read: 0 } },
    ])
    expect(handle.executorSessionId).toBe('conv-abc-123') // 对账面（续跑未接线，头注拟稿）
    expect(a.isCompleted(handle)).toBe(true)
    expect(a.exitCode(handle)).toBe(0)
    const stats = await a.resultStats(handle)
    expect(stats).toMatchObject({
      cost: { usd: 0 }, // cost_native=false：无原生成本字段，待价目表折算
      tokens: { input: 12297, output: 121, cache_read: 0 },
      turns: 1,
      model: MODEL,
    })
    expect(stats.duration).toBeGreaterThanOrEqual(0)
  })

  it('status=SUCCESS 但 response 为空 → 不伪造成功（completed=false 明报）', async () => {
    makeScenario({ stdout: JSON.stringify({ status: 'SUCCESS', response: '' }), exit: 0 })
    const a = adapter()
    const { events, handle } = await run(a, makeBrief())
    const turnEnd = events.find((e) => e.type === 'turn_end')
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false })
    expect((turnEnd as { error?: string }).error).toContain('response 为空')
    expect(a.isCompleted(handle)).toBe(false)
  })
})

describe('② launch argv · 实测建议形（task-140 事实单）', () => {
  it('-p 任务串 + --output-format json + --dangerously-skip-permissions + --model + --add-dir + --print-timeout；永不下发 --mode', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    await run(adapter({ model: MODEL, printTimeoutSec: 30 }), makeBrief())
    const report = readReport()
    expect(report.argv).toEqual([
      '-p', TASK_TEXT,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--model', MODEL,
      '--add-dir', workdir,
      '--print-timeout', '30',
    ])
    expect(report.argv.some((arg) => arg === '--mode' || arg.startsWith('--mode='))).toBe(false) // --mode 与 --mode= 两形都不下发
    expect(report.argv).not.toContain('auto') // --mode auto 不可用（回退 default，实测 warning）
  })

  it('未配 model/printTimeoutSec → 两旗标缺席（缺省=default 模式、无 CLI 自管超时）', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    await run(adapter(), makeBrief())
    const { argv } = readReport()
    expect(argv).not.toContain('--model')
    expect(argv).not.toContain('--print-timeout')
  })
})

describe('③ env 白名单 · 封闭允许集＋代理键（docs/43-附录A-1 同型纪律）', () => {
  it('允许集透传、宿主敏感键/旋钮键不可见、proxyEnv 钉扎直证', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const events = await withHostEnv(
      {
        DEEPSEEK_API_KEY: 'deepseek-host-secret',
        GLM_ZCODE_KEY: 'glm-host-secret',
        KIMI_API_KEY: 'kimi-host-secret',
        DSH_PROFILE: 'headless',
        GEMINI_API_KEY: 'gemini-host-secret', // 宿主 API-key 路由未证：允许集外不透传（注入通道封闭枚举亦拒收，见 agy-env.test.ts）
        GOOGLE_API_KEY: 'google-host-secret',
        FAKE_SECRET: 'fake-knob-value',
        LC_ALL: 'zh_CN.UTF-8',
        https_proxy: 'http://lowercase-mirror.invalid:18080',
      },
      async () => {
        const { events: evs } = await run(adapter({ proxyEnv: { HTTPS_PROXY: 'http://proxy.invalid:18080' } }), makeBrief())
        return evs
      },
    )
    const report = readReport()
    // 允许集正断言（PATH/HOME 来自宿主；LC_ 前缀与小写代理镜像放行）
    for (const key of ['PATH', 'HOME', 'LC_ALL', 'https_proxy']) {
      expect(report.envKeys).toContain(key)
    }
    // 代理钉扎值直证（白名单键的值=适配器 proxyEnv 注入；宿主同名键被钉扎覆盖）
    expect(report.proxyEnv['HTTPS_PROXY']).toBe('http://proxy.invalid:18080')
    expect(report.proxyEnv['https_proxy']).toBe('http://lowercase-mirror.invalid:18080')
    // 敏感前缀/他家命名空间/测试旋钮：deny-by-default 不可见（负断言）
    for (const key of ['DEEPSEEK_API_KEY', 'GLM_ZCODE_KEY', 'KIMI_API_KEY', 'DSH_PROFILE', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAKE_SECRET']) {
      expect(report.envKeys).not.toContain(key)
    }
    // 事件文本不含宿主密钥值（凭据永不入日志）
    const allText = events.map((e) => ('text' in e ? e.text : JSON.stringify(e))).join(' ')
    for (const secret of ['deepseek-host-secret', 'glm-host-secret', 'kimi-host-secret', 'gemini-host-secret', 'google-host-secret', 'fake-knob-value']) {
      expect(allText).not.toContain(secret)
    }
  })

  it('TaskBrief.credentials v1.4 透传：封闭枚举键（STUDIO_TOOLS_WKEY）进子进程 env，值不出现在任何事件文本', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const { events } = await run(adapter(), makeBrief({ credentials: { STUDIO_TOOLS_WKEY: 'wkey-live-secret-1' } }))
    expect(readReport().envKeys).toContain('STUDIO_TOOLS_WKEY')
    const allText = events.map((e) => ('text' in e ? e.text : JSON.stringify(e))).join(' ')
    expect(allText).not.toContain('wkey-live-secret-1')
  })

  it('credentials 通道枚举外键 → CONFIG_INVALID 结构拒收，子进程不起、值不打印', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    rmSync(reportPath, { force: true })
    const a = adapter()
    await expect(a.launch(makeBrief({ credentials: { GLM_ZCODE_KEY: 'glm-cred-secret-2' } }))).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'agy/env-key-rejected',
    } satisfies Partial<ClassifiedError>)
    await expect(a.launch(makeBrief({ credentials: { DEEPSEEK_API_KEY: 'ds-cred-secret-3' } }))).rejects.toThrow(
      /AGY_ env-key-rejected|agy\/env-key-rejected/,
    )
    expect(existsSync(reportPath)).toBe(false) // 拒收发生在 spawn 前：无报告落盘
    // 值不打印（红名单：报错只点名键名——捕获后负断言，不做正则杂技）
    const captured: unknown = await a
      .launch(makeBrief({ credentials: { KIMI_API_KEY: 'kimi-cred-secret-4' } }))
      .then(() => undefined, (e: unknown) => e)
    expect(String(captured)).not.toContain('kimi-cred-secret-4')
    expect(String(captured)).toContain('KIMI_API_KEY')
  })
})

describe('④ 失败分类 · EXECUTOR_ERROR_CODES 冻结词表（词表外无码）', () => {
  async function errorFace(
    stdout: string,
    exit: number,
    stderr?: string,
  ): Promise<{ turnEnd: StreamEvent; logs: string[]; handle: Handle }> {
    makeScenario({ stdout, exit, ...(stderr !== undefined ? { stderr } : {}) })
    const { events, handle } = await run(adapter(), makeBrief())
    const turnEnd = events.filter((e) => e.type === 'turn_end')[0] as StreamEvent
    return { turnEnd, logs: events.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text), handle }
  }

  it('auth（"authentication failed or timed out"）→ errorCode=AUTH＋登录/代理提示；退出码如实记录', async () => {
    const { turnEnd, handle } = await errorFace(JSON.stringify({ status: 'ERROR', error: 'authentication failed or timed out' }), 1)
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false, errorCode: 'AUTH' })
    const error = (turnEnd as { error?: string }).error ?? ''
    expect(error).toContain('鉴权')
    expect(error).toContain('登录')
    expect(error).toContain('代理')
    expect(error).toContain('authentication failed or timed out') // 原文片段如实保留（脱敏截断后）
    expect(adapter().isCompleted(handle)).toBe(false)
    expect(adapter().exitCode(handle)).toBe(1)
    const stats = await adapter().resultStats(handle)
    expect(stats.tokens).toEqual({ input: 0, output: 0 }) // 失败面零账（不编造）
  })

  it('quota（"Usage limit exceeded"）→ errorCode=EXTERNAL_RATE_LIMIT；CLI 上报的 usage 失败面照记', async () => {
    const { turnEnd, handle } = await errorFace(
      JSON.stringify({ status: 'ERROR', error: 'Usage limit exceeded (quota 429)', conversation_id: 'conv-q', usage: { input_tokens: 31, output_tokens: 2 } }),
      1,
    )
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false, errorCode: 'EXTERNAL_RATE_LIMIT', usage: { input: 31, output: 2 } })
    expect((await adapter().resultStats(handle)).tokens).toEqual({ input: 31, output: 2 }) // 失败面真账照记
  })

  it('eligibility（"Eligibility check failed"）→ 文本分类、无码（词表外不加码）；region 同款', async () => {
    const { turnEnd } = await errorFace(
      JSON.stringify({ status: 'ERROR', error: 'Eligibility check failed: Your current account is not eligible for Antigravity. Verify your account to continue.' }),
      1,
    )
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false })
    expect('errorCode' in (turnEnd as Record<string, unknown>)).toBe(false)
    expect((turnEnd as { error?: string }).error).toContain('资格')
    const region = await errorFace(JSON.stringify({ status: 'ERROR', error: 'location not supported' }), 1)
    expect((region.turnEnd as { error?: string }).error).toContain('地区限制')
    expect('errorCode' in (region.turnEnd as Record<string, unknown>)).toBe(false)
  })

  it('坏 JSON＋非零退出 → exit 面明报（退出码+脱敏 stderr 片段），无码', async () => {
    // 夹具值 10 字符：满足脱敏正则（≥8），低于仓面扫描 bearer 阈值（裸 20）——夹具不仿真凭据形态
    const { turnEnd } = await errorFace('not-json-at-all', 3, '[agy] boom Bearer fake-tok-9')
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false })
    const error = (turnEnd as { error?: string }).error ?? ''
    expect(error).toContain('进程退出码 3')
    expect(error).toContain('not-json-at-all')
    expect(error).toContain('stderr: [agy] boom Bearer [REDACTED]') // stderr 片段脱敏后入账
    expect(error).not.toContain('fake-tok-9')
    expect('errorCode' in (turnEnd as Record<string, unknown>)).toBe(false)
  })

  it('stdout 空而 stderr 有 AGY_ERROR 结构化行 → 失败面分类（不落「stdout 为空」的坏稿面）', async () => {
    const { turnEnd } = await errorFace('', 3, 'noise\nAGY_ERROR: {"status":"UNAUTHENTICATED","code":16,"retryable":false}')
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false, errorCode: 'AUTH' })
    expect((turnEnd as { error?: string }).error).toContain('AGY_ERROR status=UNAUTHENTICATED code=16 retryable=false')
  })

  it('finished_reason 在场＝残稿不计完成：print_timeout → timeout 面（usage 照记、退出码 3 如实）；interrupted → other 面', async () => {
    const partial = JSON.stringify({
      ...JSON.parse(SUCCESS_JSON) as Record<string, unknown>,
      response: '残稿：只写了一半',
      finished_reason: 'print_timeout',
    })
    const { turnEnd, handle } = await errorFace(partial, 3, '[agy] print timeout after 30s with the turn still in progress')
    expect(turnEnd).toMatchObject({ type: 'turn_end', completed: false, usage: { input: 12297, output: 121, cache_read: 0 } })
    expect((turnEnd as { error?: string }).error).toContain('print 超时')
    expect('errorCode' in (turnEnd as Record<string, unknown>)).toBe(false)
    expect(adapter().isCompleted(handle)).toBe(false)
    expect(adapter().exitCode(handle)).toBe(3)
    const interrupted = await errorFace(JSON.stringify({ status: 'SUCCESS', response: '写到一半', finished_reason: 'interrupted' }), 130)
    expect(interrupted.turnEnd).toMatchObject({ type: 'turn_end', completed: false })
    expect((interrupted.turnEnd as { error?: string }).error).toContain('interrupted')
  })

  it('JSON 但 status 缺失 / 退出码 0 的坏稿 → bad-shape / bad-json 明报（不猜成功）', async () => {
    const { turnEnd } = await errorFace('{"foo": 1}', 0)
    expect((turnEnd as { completed?: boolean }).completed).toBe(false)
    expect((turnEnd as { error?: string }).error).toContain('status')
    const blank = await errorFace('', 0)
    expect((blank.turnEnd as { error?: string }).error).toContain('stdout 终稿不可解析')
    expect((blank.turnEnd as { error?: string }).error).toContain('stdout 为空')
  })
})

describe('⑤ 超时 watchdog · print 超时整组回收', () => {
  it('挂起不退 + printTimeoutSec → timeout 面终态（completed=false 明报，非静默挂死）', { timeout: 20_000 }, async () => {
    makeScenario({ stdout: '', exit: 0, hang: true }) // 挂起：CLI 不自管超时也不自退
    const a = adapter({ printTimeoutSec: 1 }) // 最小合法值：watchdog=1s+4s 宽放后整组回收（真值口径不变）
    const h = await a.launch(makeBrief())
    const events: StreamEvent[] = []
    for await (const ev of a.stream(h)) events.push(ev)
    const turnEnd = events.filter((e) => e.type === 'turn_end')[0] as { completed?: boolean; error?: string }
    expect(turnEnd?.completed).toBe(false)
    expect(turnEnd?.error).toContain('print 超时')
    expect(a.exitCode(h)).toBeNull() // 被信号杀死：退出码 null（证据价值面）
    expect(a.isCompleted(h)).toBe(false)
    expect((await a.resultStats(h)).tokens).toEqual({ input: 0, output: 0 }) // 超时面零账（不编造）
  })

  it('CLI 自管 --print-timeout 到点自退（残稿面）→ watchdog 不干预，按 stdout 终稿分类', { timeout: 20_000 }, async () => {
    // 夹具按时自退（非挂起）：watchdog 宽限内进程已落定——走 finished_reason=print_timeout 残稿面
    makeScenario({ stdout: JSON.stringify({ status: 'SUCCESS', response: '残', finished_reason: 'print_timeout' }), exit: 3 })
    const { events } = await run(adapter({ printTimeoutSec: 1 }), makeBrief())
    expect(events[0]).toMatchObject({ type: 'log' })
    expect(events[1]).toMatchObject({ type: 'turn_end', completed: false })
    expect((events[1] as { error?: string }).error).toContain('print 超时（--print-timeout 到点')
  })
})

describe('⑥ kill 升级链 · SIGTERM 被吞→宽限→SIGKILL 整组回收', () => {
  it('吞 TERM 挂起进程：kill(graceMs) 落定、被杀会话无终态（aborted 口径，零账）', { timeout: 20_000 }, async () => {
    makeScenario({ stdout: '', exit: 0, hang: true, ignoreTerm: true })
    const a = adapter()
    const h = await a.launch(makeBrief())
    await a.kill(h, 150) // TERM 被吞 → 150ms 宽限 → SIGKILL（升级链收口）
    const events: StreamEvent[] = []
    for await (const ev of a.stream(h)) events.push(ev) // killed → 无终态事件
    expect(events).toEqual([])
    expect(a.isCompleted(h)).toBe(false)
    expect(a.exitCode(h)).toBeNull()
    const stats = await a.resultStats(h)
    expect(stats.tokens).toEqual({ input: 0, output: 0 })
    expect(stats.turns).toBe(0)
    expect(await a.kill(h, 150)).toBeUndefined() // 幂等
  })

  it('已自然退出的会话：kill 无可杀、即时落定、终态事件不被改写', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const a = adapter()
    const { events, handle } = await run(a, makeBrief())
    const before = JSON.stringify(events)
    expect(await a.kill(handle, 150)).toBeUndefined()
    expect(JSON.stringify(events)).toBe(before)
    expect(a.isCompleted(handle)).toBe(true)
  })
})

describe('⑦ detect / estimate / resume / AGENTS_MD / stream 单消费', () => {
  it('detect：达标 ok / 低于地板 gap / 版本串不可解析 gap / 未安装 gap', async () => {
    const ok = await adapter().detect() // cwd 无场景 → 夹具缺省 1.5.18
    expect(ok).toMatchObject({ name: 'agy', version: '1.5.18', ok: true, gaps: [] })
    const low = await new AgyAdapter([process.execPath, fakeAgy, '--fake-agy-scenario', makeScenario({ version: '1.2.0' })]).detect()
    expect(low.ok).toBe(false)
    expect(low.gaps[0]).toContain('agy-version-unsupported')
    const unparsed = await new AgyAdapter([process.execPath, fakeAgy, '--fake-agy-scenario', makeScenario({ version: 'garbage-out' })]).detect()
    expect(unparsed.gaps).toEqual(['agy-version-unparsed'])
    const missing = await new AgyAdapter(['agy-definitely-not-installed-xyz']).detect()
    expect(missing.ok).toBe(false)
    expect(missing.gaps[0]).toContain('agy-not-installed')
  })

  it('estimate：v0 拟稿模型（地板 0.05 / confidence 0.2）；任务书缺文件按地板兜底', async () => {
    const est = await adapter().estimate(makeBrief())
    expect(est.confidence).toBe(0.2)
    expect(est.estimated.usd).toBeGreaterThanOrEqual(0.05)
    expect(est.estimated.usd).toBeLessThanOrEqual(8)
    const missing = await adapter().estimate({ ...makeBrief(), briefPath: join(workdir, 'no-such-brief.md') })
    expect(missing.estimated.usd).toBe(0.05)
  })

  it('resume 传入 → launch fail-closed（session_resume=false，续跑留探钢单）；子进程不起', async () => {
    rmSync(reportPath, { force: true })
    await expect(adapter().launch(makeBrief({ resume: { sessionId: 's-1', summaryPath: 'x.md' } }))).rejects.toThrow(/续跑未接线/)
    expect(existsSync(reportPath)).toBe(false)
  })

  it('二进制缺席 → launch 如实 reject（ENOENT 面；detect 前置漏网时不静默挂死）', async () => {
    const missing = new AgyAdapter(['agy-definitely-not-installed-xyz'])
    await expect(missing.launch(makeBrief())).rejects.toThrow(/ENOENT|未取得 pid/)
    rmSync(join(workdir, 'no-such-agents.md'), { force: true })
    await expect(
      adapter().launch(makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target: join(workdir, 'no-such-agents.md') } })),
    ).rejects.toThrow(/AGENTS_MD\.target 不可读/) // 装配缺件：launch 前置失败如实上报
  })

  it('构造选项形状坏 → CONFIG_INVALID/agy/option-invalid（配置写了没生效比报错更难查）', () => {
    const bad: AgyAdapterOptions[] = [{ model: '' }, { model: '   ' }, { model: 'a\nb' }, { printTimeoutSec: 0 }, { printTimeoutSec: 1.5 }, { printTimeoutSec: -3 }]
    for (const opts of bad) {
      expect(() => adapter(opts)).toThrow(/agy\/option-invalid/)
    }
    expect(adapter({ model: MODEL, printTimeoutSec: 1 }).name).toBe('agy') // 合法形状照过
  })

  it('注册面 patches → argv：agent.yaml 的 model / print-timeout-sec 经 builtinResolver 工厂直达旗标', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const factory = builtinResolver('agy')
    if (factory === undefined) throw new Error('builtinResolver(agy) 应可解析')
    const a = factory([process.execPath, fakeAgy], { model: MODEL, 'print-timeout-sec': 900 })
    const { handle } = await run(a, makeBrief())
    const { argv } = readReport()
    expect(argv[argv.indexOf('--model') + 1]).toBe(MODEL)
    expect(argv[argv.indexOf('--print-timeout') + 1]).toBe('900')
    expect((await a.resultStats(handle)).model).toBe(MODEL)
  })

  it('AGENTS_MD：append_system_prompt 拼进 -p；native 不拼；user_level 拒收', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const agentsPath = join(workdir, `agents-${String(++briefSeq)}.md`)
    writeFileSync(agentsPath, 'AGENTS 内容：本仓纪律。', 'utf8')
    await run(adapter(), makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target: agentsPath } }))
    const prompt = readReport().argv[1] ?? '' // argv[0]='-p'，argv[1]=任务串（含拼接）
    expect(prompt).toBe(`${TASK_TEXT}${AGENTS_SEPARATOR}AGENTS 内容：本仓纪律。`)
    await run(adapter(), makeBrief()) // native：不拼（CLI 自行发现，头注拟稿）
    expect(readReport().argv[1]).toBe(TASK_TEXT)
    await expect(
      adapter().launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target: agentsPath } })),
    ).rejects.toThrow(/user_level/)
  })

  it('stream 二次消费 → 拒（一单一命、一流一收）', async () => {
    makeScenario({ stdout: SUCCESS_JSON, exit: 0 })
    const a = adapter()
    const { handle } = await run(a, makeBrief())
    await expect(a.stream(handle).next()).rejects.toThrow(/已消费/)
  })
})
