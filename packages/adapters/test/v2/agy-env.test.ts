/**
 * agy-env.test.ts —— agy 子进程 env 三道闸纯函数直证（task-147 env 闸加固；LANE-X）
 *
 * 冻结验收口径（verifier 12 例探针全拒；docs/quality/agy-adapter.md §四；语义定义在 agy-argv.ts 头注）：
 *   ① 宿主封闭允许集（filterAgyEnv）：允许集键原样收录（比对 lower-case），其余宿主键一概不透传
 *   ② 注入通道封闭枚举（assertAgyInjectKeys／buildAgyEnv）：proxyEnv 只收代理四键大小写两形，
 *      credentials 只收 STUDIO_TOOLS_WKEY；枚举外键结构拒收（CONFIG_INVALID/agy/env-key-rejected）
 *      ——HOME／PATH 等宿主专属键经通道出现即拒；12 例探针经两条通道全拒；大小写变体同拒；
 *      非拒收表的枚举外键（TMPDIR／FOO）同样拒——钉住闸②本身（上述键全在高危表、闸③兜得住，
 *      单独删闸② credentials 调用不红；TMPDIR／FOO 只有闸②能拒，删即红）
 *   ③ 高危拒收终检（assertAgyEnvSafety）：verifier 调用形 `{...filterAgyEnv(宿主), ...注入}` 对
 *      12 例探针全拒（HOME／PATH 逐字节核对宿主原值；漏传基准按空基准判）；允许集键与凭据枚举键通过
 *   ④ 适配器面（fake CLI）：构造期 proxyEnv 键闸；launch 注入非法凭据键 → spawn 前拒收、无报告落盘；
 *      正对照（合法凭据键）证明夹具有效
 *
 * 依据：docs/43-附录A-1 同型纪律（封闭允许集，deny-by-default）、docs/25-§二（v1.4 credentials：
 *   值不记录不打印）；夹具凭据一律 fake- 低熵值（无真实凭证，主机名 .invalid）。
 *   禁 skip/only/todo/retry；本文件 <600 行阈内。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClassifiedError, TaskBrief } from '@studio-next/contract'
import { AgyAdapter } from '../../src/agy.ts'
import { assertAgyInjectKeys, assertAgyEnvSafety, buildAgyEnv, filterAgyEnv } from '../../src/agy-argv.ts'

/** 合成宿主 env（测试进程真实 env 不参与——断言可复现） */
const HOST: Readonly<Record<string, string | undefined>> = {
  PATH: '/usr/bin:/bin',
  HOME: '/tmp/agy-env-test-home',
  LANG: 'zh_CN.UTF-8',
  TZ: 'Asia/Shanghai',
  TMPDIR: '/tmp/agy-env-test-tmp',
  LC_ALL: 'zh_CN.UTF-8',
  https_proxy: 'http://lowercase-mirror.invalid:18080',
  SHELL: '/bin/zsh', // 宿主可有：允许集外，filterAgyEnv 不透传
  TERM: 'xterm-256color', // 同上
  UNDEFINED_MAYBE: undefined, // undefined 值跳过（不进子进程）
}

/** verifier 12 例探针（/tmp/verify-agy-env-probe.mjs 同值；加固前 11 例放行、仅末例对照已拒） */
const PROBES: [string, Record<string, string>][] = [
  ['HOME 覆盖（凭据发现路径劫持）', { HOME: '/tmp/attacker-home' }],
  ['PATH 覆盖（可执行解析劫持）', { PATH: '/tmp/attacker-bin' }],
  ['NODE_OPTIONS 预载注入', { NODE_OPTIONS: '--require=/tmp/evil.js' }],
  ['DYLD_INSERT_LIBRARIES 链接器注入', { DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' }],
  ['SHELL 覆盖', { SHELL: '/tmp/evil-shell' }],
  ['GEMINI_API_KEY', { GEMINI_API_KEY: 'fake-gemini-key' }],
  ['GOOGLE_API_KEY', { GOOGLE_API_KEY: 'fake-google-key' }],
  ['glm_api_key（全小写）', { glm_api_key: 'fake-glm-key' }],
  ['DeepSeek_API_KEY（混合大小写）', { DeepSeek_API_KEY: 'fake-deepseek-key' }],
  ['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: 'fake-anthropic-key' }],
  ['OPENAI_API_KEY', { OPENAI_API_KEY: 'fake-openai-key' }],
  ['GLM_API_KEY（对照：加固前已拒）', { GLM_API_KEY: 'fake-glm-upper-key' }],
]

/** 大小写变体＋拒收表其余条目（lower-case 后比对：与正写同拒） */
const VARIANTS: [string, Record<string, string>][] = [
  ['home 全小写', { home: '/tmp/attacker-home' }],
  ['Path 首字母大写', { Path: '/tmp/attacker-bin' }],
  ['node_options 全小写', { node_options: '--require=/tmp/evil.js' }],
  ['Node_Options 混合', { Node_Options: '--require=/tmp/evil.js' }],
  ['NODE_PATH 模块解析', { NODE_PATH: '/tmp/evil-modules' }],
  ['dyld_insert_libraries 全小写', { dyld_insert_libraries: '/tmp/evil.dylib' }],
  ['LD_PRELOAD（dsh 同列）', { LD_PRELOAD: '/tmp/evil.so' }],
  ['Shell 混合', { Shell: '/tmp/evil-shell' }],
  ['BASH_ENV 启动文件', { BASH_ENV: '/tmp/evil.sh' }],
  ['gemini_api_key 全小写', { gemini_api_key: 'fake-gemini-key' }],
  ['Google_Api_Key 混合', { Google_Api_Key: 'fake-google-key' }],
  ['Glm_Zcode_Key（dsh GLM 键）', { Glm_Zcode_Key: 'fake-glm-key' }],
  ['kimi_api_key 全小写', { kimi_api_key: 'fake-kimi-key' }],
  ['ANTHROPIC_AUTH_TOKEN（前缀）', { ANTHROPIC_AUTH_TOKEN: 'fake-anthropic-token' }],
  ['openai_base_url（前缀）', { openai_base_url: 'http://evil.invalid/v1' }],
  ['CLAUDE_CODE_OAUTH_TOKEN（他家执行体）', { CLAUDE_CODE_OAUTH_TOKEN: 'fake-claude-token' }],
  // 拒收表逐条至少一例「只有本条能拒」的键（纯前缀、无凭据形后缀——防规则被删而用例不红）
  ['GEMINI_MODEL（Gemini 纯前缀）', { GEMINI_MODEL: 'fake-model' }],
  ['GOOGLE_CLOUD_PROJECT（Google 纯前缀）', { GOOGLE_CLOUD_PROJECT: 'fake-project' }],
  ['antigravity_config（Antigravity 纯前缀，小写）', { antigravity_config: 'fake-antigravity-config' }],
  ['CLAUDE_CONFIG_DIR（他家执行体纯前缀）', { CLAUDE_CONFIG_DIR: '/tmp/attacker-claude' }],
  ['CODEX_HOME（他家执行体纯前缀）', { CODEX_HOME: '/tmp/attacker-codex' }],
  ['DEEPSEEK_BASE_URL（他家 provider 纯前缀）', { DEEPSEEK_BASE_URL: 'http://evil.invalid/v1' }],
  ['glm_zcode_model（他家 provider 纯前缀，小写）', { glm_zcode_model: 'fake-model' }],
  ['KIMI_CODE_HOME（他家 provider 纯前缀）', { KIMI_CODE_HOME: '/tmp/attacker-kimi' }],
  ['DSH_SESSION_DIR（dsh 纯前缀）', { DSH_SESSION_DIR: '/tmp/attacker-dsh' }],
  ['NODE_PRELOAD', { NODE_PRELOAD: '/tmp/evil.js' }],
  ['LD_LIBRARY_PATH', { LD_LIBRARY_PATH: '/tmp/evil-lib' }],
  ['ENV（shell 注入面）', { ENV: '/tmp/evil.sh' }],
  ['IFS（shell 注入面）', { IFS: 'fake-ifs-value' }],
  ['PROMPT_COMMAND（shell 注入面）', { PROMPT_COMMAND: 'fake-prompt-command' }],
  ['X_APIKEY（凭据形后缀）', { X_APIKEY: 'fake-generic-key' }],
  ['db_secret（凭据形后缀，小写）', { db_secret: 'fake-generic-secret' }],
  ['MY_PASSWD（凭据形后缀）', { MY_PASSWD: 'fake-generic-password' }],
  ['AUTH_CREDENTIAL（凭据形后缀单数）', { AUTH_CREDENTIAL: 'fake-generic-credential' }],
  ['AUTH_CREDENTIALS（凭据形后缀复数）', { AUTH_CREDENTIALS: 'fake-generic-credentials' }],
  ['SOME_SERVICE_API_KEY（凭据形后缀兜底）', { SOME_SERVICE_API_KEY: 'fake-generic-key' }],
  ['MY_TOKEN（凭据形后缀兜底）', { MY_TOKEN: 'fake-generic-token' }],
  ['STUDIO_TOOLS_PASSWORD（凭据形后缀兜底）', { STUDIO_TOOLS_PASSWORD: 'fake-generic-password' }],
]

/** 捕获任意抛出（形状闸用：子因由调用方断言）；没抛＝用例红 */
function captureThrow(fn: () => unknown, label = ''): Error & ClassifiedError {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  expect(caught, `${label}：应抛 CONFIG_INVALID——未抛即放行`).toBeInstanceOf(Error)
  return caught as Error & ClassifiedError
}

/** 捕获键闸的结构拒收：类别/子因双断言 */
function captureReject(fn: () => unknown): Error & ClassifiedError {
  const err = captureThrow(fn)
  expect(err.category).toBe('CONFIG_INVALID')
  expect(err.subcause).toBe('agy/env-key-rejected')
  return err
}

/** 报文只带键名不带值（红名单纪律） */
function expectNamedNotValue(err: Error, key: string, value: string): void {
  expect(err.message).toContain(JSON.stringify(key))
  expect(err.message).not.toContain(value)
}

describe('① 宿主封闭允许集 · filterAgyEnv', () => {
  it('允许集键原样收录（比对 lower-case：Path／Home／小写代理镜像／LC_ 前缀），undefined 值跳过', () => {
    const env = filterAgyEnv({ ...HOST, Path: '/usr/local/bin:/usr/bin', Home: '/tmp/agy-env-test-home-variant', LC_CTYPE: 'UTF-8' })
    expect(env).toEqual({
      PATH: HOST.PATH,
      HOME: HOST.HOME,
      LANG: HOST.LANG,
      TZ: HOST.TZ,
      TMPDIR: HOST.TMPDIR,
      LC_ALL: HOST.LC_ALL,
      https_proxy: HOST.https_proxy,
      Path: '/usr/local/bin:/usr/bin', // 键按宿主原样透传（不归一大小写）
      Home: '/tmp/agy-env-test-home-variant',
      LC_CTYPE: 'UTF-8',
    })
  })

  it('允许集外宿主键一概不透传（deny-by-default，不是黑名单剔除）', () => {
    const env = filterAgyEnv({
      ...HOST,
      NODE_OPTIONS: '--require=/tmp/evil.js',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      GEMINI_API_KEY: 'fake-gemini-key',
      glm_api_key: 'fake-glm-key',
      ANTHROPIC_API_KEY: 'fake-anthropic-key',
      OPENAI_API_KEY: 'fake-openai-key',
      FAKE_SECRET: 'fake-knob-value',
    })
    expect(env).not.toHaveProperty('SHELL') // 宿主可有，但不在允许集
    expect(env).not.toHaveProperty('TERM')
    expect(env).not.toHaveProperty('UNDEFINED_MAYBE')
    expect(Object.keys(env).filter((k) => /NODE_OPTIONS|DYLD_|_KEY$|^glm_|^FAKE_/i.test(k))).toEqual([])
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'TZ', 'https_proxy'])
  })
})

describe('② 注入通道封闭枚举 · assertAgyInjectKeys／buildAgyEnv', () => {
  it('proxyEnv 八个字面全收；合并后覆盖宿主同名代理键（钉扎）', () => {
    const proxyEnv = {
      HTTPS_PROXY: 'http://proxy.invalid:18080', HTTP_PROXY: 'http://proxy.invalid:18080',
      ALL_PROXY: 'socks5://proxy.invalid:18081', NO_PROXY: 'localhost,127.0.0.1',
      https_proxy: 'http://proxy.invalid:18082', http_proxy: 'http://proxy.invalid:18082',
      all_proxy: 'socks5://proxy.invalid:18083', no_proxy: 'localhost',
    }
    const env = buildAgyEnv({ base: HOST, proxyEnv })
    expect(env).toEqual({ ...filterAgyEnv(HOST), ...proxyEnv })
    expect(env.https_proxy).toBe('http://proxy.invalid:18082') // 宿主小写镜像被钉扎覆盖
    expect(() => assertAgyInjectKeys('proxyEnv', proxyEnv)).not.toThrow()
  })

  it('proxyEnv 混合大小写（写了不生效的形态）与非代理键 → 拒收：混合形报「不在封闭枚举内」，非代理键点名危害', () => {
    const mixed = captureReject(() => buildAgyEnv({ base: HOST, proxyEnv: { Https_Proxy: 'http://proxy.invalid:18080' } }))
    expectNamedNotValue(mixed, 'Https_Proxy', 'proxy.invalid')
    expect(mixed.message).toContain('不在封闭枚举内')
    expect(mixed.message).toContain('HTTPS_PROXY') // 报文列出封闭枚举（配置写错有处可查）
    const neutral = captureReject(() => assertAgyInjectKeys('proxyEnv', { TMPDIR: '/tmp/attacker-tmp' }))
    expect(neutral.message).toContain('不在封闭枚举内') // 非高危的枚举外键：同一子因，措辞不同
    const risky = captureReject(() => assertAgyInjectKeys('proxyEnv', { HTTPS_PROXY: 'http://proxy.invalid:18080', HOME: '/tmp/attacker-home' }))
    expect(risky.message).toContain('HOME') // 逐键判：枚举内键放行，首个越界键即抛（HOME 命中高危表）
    expect(risky.message).toContain('宿主专属键')
  })

  it('credentials 只收 STUDIO_TOOLS_WKEY；KIMI_API_KEY（dsh 家族 provider 键）对 agy 属第三方凭据 → 拒收', () => {
    const env = buildAgyEnv({ base: HOST, credentials: { STUDIO_TOOLS_WKEY: 'fake-wkey-value' } })
    expect(env.STUDIO_TOOLS_WKEY).toBe('fake-wkey-value')
    const err = captureReject(() => buildAgyEnv({ base: HOST, credentials: { KIMI_API_KEY: 'fake-kimi-key' } }))
    expectNamedNotValue(err, 'KIMI_API_KEY', 'fake-kimi-key')
    expect(err.message).toContain('他家执行体')
  })

  it('credentials 枚举外「非拒收表」键（TMPDIR／FOO）→ 拒收：钉住闸② credentials 检查本身（闸③兜不住的键；删闸② credentials 调用本例必红）', () => {
    // 既有枚举外用例的键全在高危表——单独删闸② credentials 调用时闸③合并后兜住、用例不红。
    // TMPDIR（允许集键、非宿主专属）／FOO（中性键）不在拒收表：合并后闸③放行，只有闸②能拒。
    for (const [key, value] of [['TMPDIR', 'x'], ['FOO', 'x']] as const) {
      const err = captureReject(() => buildAgyEnv({ base: HOST, credentials: { [key]: value } }))
      expectNamedNotValue(err, key, value)
      // 报文是闸②措辞（带通道名、报枚举外、列出封闭枚举），不是闸③的「属高危拒收键」——证明拒收来自闸②
      expect(err.message).toContain('credentials')
      expect(err.message).toContain('不在封闭枚举内')
      expect(err.message).toContain('STUDIO_TOOLS_WKEY')
    }
    // 正对照：合法凭据键＋合法代理键照常通过，TMPDIR 仍是宿主原值（拒收针对键名，不是夹具坏了）
    const env = buildAgyEnv({
      base: HOST,
      proxyEnv: { HTTPS_PROXY: 'http://proxy.invalid:18080' },
      credentials: { STUDIO_TOOLS_WKEY: 'fake-wkey-value' },
    })
    expect(env.TMPDIR).toBe(HOST.TMPDIR)
    expect(env.STUDIO_TOOLS_WKEY).toBe('fake-wkey-value')
    expect(env.HTTPS_PROXY).toBe('http://proxy.invalid:18080')
  })

  it.each(PROBES)('探针经 proxyEnv 通道 → 结构拒收：%s', (_label, extra) => {
    const [key] = Object.keys(extra)
    const value = extra[key ?? ''] ?? ''
    const err = captureReject(() => buildAgyEnv({ base: HOST, proxyEnv: extra }))
    expectNamedNotValue(err, key ?? '', value)
  })

  it.each(PROBES)('探针经 credentials 通道 → 结构拒收：%s', (_label, extra) => {
    const [key] = Object.keys(extra)
    const value = extra[key ?? ''] ?? ''
    const err = captureReject(() => buildAgyEnv({ base: HOST, credentials: extra }))
    expectNamedNotValue(err, key ?? '', value)
  })

  it.each(VARIANTS)('大小写变体/拒收表其余条目经两通道 → 结构拒收：%s', (_label, extra) => {
    for (const channel of ['proxyEnv', 'credentials'] as const) {
      const err = captureReject(() => assertAgyInjectKeys(channel, extra))
      const [key] = Object.keys(extra)
      expect(err.message).toContain(channel)
      expectNamedNotValue(err, key ?? '', extra[key ?? ''] ?? '')
    }
  })

  it('合成顺序：两通道都合法才合并；先过 proxyEnv 闸再过 credentials 闸（前者拒收时后者不再看）', () => {
    const both = captureReject(() =>
      buildAgyEnv({ base: HOST, proxyEnv: { HTTPS_PROXY: 'http://proxy.invalid:18080' }, credentials: { OPENAI_API_KEY: 'fake-openai-key' } }),
    )
    expectNamedNotValue(both, 'OPENAI_API_KEY', 'fake-openai-key')
    const first = captureReject(() =>
      buildAgyEnv({ base: HOST, proxyEnv: { PATH: '/tmp/attacker-bin' }, credentials: { OPENAI_API_KEY: 'fake-openai-key' } }),
    )
    expect(first.message).toContain('PATH')
    expect(first.message).not.toContain('OPENAI_API_KEY')
  })
})

describe('③ 高危拒收终检 · assertAgyEnvSafety', () => {
  it.each(PROBES)('verifier 调用形 {...filterAgyEnv(宿主), ...注入}（给宿主基准）→ 拒收：%s', (_label, extra) => {
    const [key] = Object.keys(extra)
    const value = extra[key ?? ''] ?? ''
    const err = captureReject(() => assertAgyEnvSafety({ ...filterAgyEnv(HOST), ...extra }, HOST))
    expectNamedNotValue(err, key ?? '', value)
  })

  it.each(VARIANTS)('大小写变体/拒收表其余条目合并后 → 拒收：%s', (_label, extra) => {
    const [key] = Object.keys(extra)
    const err = captureReject(() => assertAgyEnvSafety({ ...filterAgyEnv(HOST), ...extra }, HOST))
    expectNamedNotValue(err, key ?? '', extra[key ?? ''] ?? '')
  })

  it('允许集键＋凭据枚举键的合并 env 通过（正对照）；HOME／PATH 与宿主原值一致即放行', () => {
    const env = { ...filterAgyEnv(HOST), HTTPS_PROXY: 'http://proxy.invalid:18080', STUDIO_TOOLS_WKEY: 'fake-wkey-value' }
    expect(() => assertAgyEnvSafety(env, HOST)).not.toThrow()
  })

  it('HOME／PATH 覆盖：逐字节核对宿主原值即拒（含宿主无同名键的大小写变体）；漏传基准按空基准判（fail-closed）', () => {
    const overridden = { ...filterAgyEnv(HOST), HOME: '/tmp/attacker-home' }
    const err = captureReject(() => assertAgyEnvSafety(overridden, HOST))
    expect(err.message).toContain('宿主专属键')
    expect(err.message).toContain('HOME')
    expectNamedNotValue(err, 'HOME', '/tmp/attacker-home')
    const pathHit = captureReject(() => assertAgyEnvSafety({ ...filterAgyEnv(HOST), PATH: '/tmp/attacker-bin' }, HOST))
    expect(pathHit.message).toContain('PATH')
    // 大小写变体键（宿主无同名键）＝注入：同样拒
    const variant = captureReject(() => assertAgyEnvSafety({ ...filterAgyEnv(HOST), Home: '/tmp/attacker-home' }, HOST))
    expect(variant.message).toContain('宿主专属键')
    // 漏传基准（JS 调用方）：HOME／PATH 在场无处核对 → 判覆盖（不给「不核对」旁门）
    const noRef = captureReject(() => assertAgyEnvSafety(overridden, undefined))
    expect(noRef.message).toContain('宿主专属键')
    // 无 HOME／PATH 的 env 漏传基准：只做高危表
    expect(() => assertAgyEnvSafety({ LANG: 'zh_CN.UTF-8' }, undefined)).not.toThrow()
  })
})

describe('④ 适配器面 · fake CLI（spawn 前拒收）', () => {
  const fakeAgy = fileURLToPath(new URL('../fake-cli/fake-agy.mjs', import.meta.url))
  const workdir = mkdtempSync(join(tmpdir(), 'agy-env-test-'))
  const reportPath = join(workdir, 'agy-fake-report.json')
  afterAll(() => rmSync(workdir, { recursive: true, force: true }))

  let briefSeq = 0
  function makeBrief(overrides: Partial<TaskBrief> = {}): TaskBrief {
    const briefPath = join(workdir, `brief-${String(++briefSeq)}.md`)
    writeFileSync(briefPath, 'AGY-TEST: env 闸演练任务文本', 'utf8')
    return {
      ticket: 'TEST-AGY',
      attempt: 1,
      briefPath,
      workspace: workdir,
      AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') },
      ...overrides,
    }
  }

  it('构造期 proxyEnv 闸：非代理键 → CONFIG_INVALID/agy/env-key-rejected；形状坏（非对象/数组/值非字符串）→ agy/option-invalid；合法代理键放行', () => {
    for (const [label, extra] of PROBES) {
      const err = captureReject(() => new AgyAdapter([process.execPath, fakeAgy], { proxyEnv: extra }))
      expectNamedNotValue(err, Object.keys(extra)[0] ?? '', extra[Object.keys(extra)[0] ?? ''] ?? '')
      expect(err.message, label).toContain('proxyEnv')
    }
    // 形状坏（非对象/数组/值非字符串）＝选项形状错，不混入键闸子因；报文只带键名与类型，值不打印
    const badShapes: [string, unknown][] = [
      ['null', null],
      ['数组', ['http://proxy.invalid:18080']],
      ['值非字符串', { HTTPS_PROXY: 123 }],
      ['值 null', { HTTPS_PROXY: null }],
    ]
    for (const [label, shape] of badShapes) {
      const err = captureThrow(() => new AgyAdapter([process.execPath, fakeAgy], { proxyEnv: shape as Record<string, string> }), label)
      expect(err.category, label).toBe('CONFIG_INVALID')
      expect(err.subcause, label).toBe('agy/option-invalid')
      expect(err.message, label).not.toContain('proxy.invalid')
    }
    expect(() => new AgyAdapter([process.execPath, fakeAgy], { proxyEnv: { HTTPS_PROXY: 'http://proxy.invalid:18080' } })).not.toThrow()
  })

  it('launch：credentials 注入 12 例探针 → spawn 前拒收、无报告落盘、值不打印', async () => {
    rmSync(reportPath, { force: true })
    const a = new AgyAdapter([process.execPath, fakeAgy])
    for (const [label, extra] of PROBES) {
      const caught: unknown = await a.launch(makeBrief({ credentials: extra })).then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(caught, label).toBeInstanceOf(Error)
      expect((caught as ClassifiedError).category, label).toBe('CONFIG_INVALID')
      expect((caught as ClassifiedError).subcause, label).toBe('agy/env-key-rejected')
      const [key] = Object.keys(extra)
      expect(String(caught), label).toContain(key)
      expect(String(caught), label).not.toContain(extra[key ?? ''] ?? '')
    }
    expect(existsSync(reportPath)).toBe(false)
  })

  it('正对照：合法凭据键照常拉起 fake CLI（证明夹具有效，上述拒收不是夹具坏了）', async () => {
    // 场景文件落 launch cwd（=task.workspace）：fake CLI 的剧本位（零 env 依赖）
    const response = JSON.stringify({ conversation_id: 'conv-env-1', status: 'SUCCESS', response: 'ok' })
    writeFileSync(join(workdir, 'agy-fake-scenario.json'), `${JSON.stringify({ stdout: response, exit: 0 })}\n`, 'utf8')
    const a = new AgyAdapter([process.execPath, fakeAgy])
    const h = await a.launch(makeBrief({ credentials: { STUDIO_TOOLS_WKEY: 'fake-wkey-live' } }))
    const events: unknown[] = []
    for await (const ev of a.stream(h)) events.push(ev)
    expect(a.isCompleted(h)).toBe(true)
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { envKeys: string[] }
    expect(report.envKeys).toContain('STUDIO_TOOLS_WKEY')
    expect(report.envKeys).not.toContain('NODE_OPTIONS')
  })
})
