/**
 * dsh worker env 白名单测试 —— docs/43-附录A-1（安全基线：worker env 白名单+凭据键封闭枚举）
 * 的正式验收面（spike 验证记录见 docs/44-§二 条款1；正式化=同语义面移植，DEV-33b）
 *
 * 覆盖（对应 docs/43-§五 恶意样本 ③「worker env 探测」+ 附录A-1 本体）：
 *   - filterWorkerEnv 纯函数：封闭允许集外键（宿主密钥类）一律不透传（deny-by-default）
 *   - credentials 键域封闭枚举：PATH、NODE_OPTIONS、LD_ 前缀、DYLD_ 前缀、SHELL、HOME
 *     等注入键与枚举外键 → launch 抛 ClassifiedError(CONFIG_INVALID/dsh/credential-key-rejected)，
 *     子进程不起（结构拒收，非静默剔除）
 *   - 枚举内键（DEEPSEEK_API_KEY / STUDIO_TOOLS_WKEY）→ 透传进子进程 env（回显直证）
 *   - 恶意样本③（env 探测）：宿主注入假密钥 FAKE_SECRET 后拉起 worker（fake CLI 回显
 *     子进程可见的 env 键名全貌与点名键值）——断言宿主专有 env **不可见**（负断言），
 *     且可见键集合 ⊆ 封闭允许集 ∪ 框架注入键
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { StreamEvent, TaskBrief } from '@studio-next/contract'
import { DshAdapter, filterWorkerEnv, assertCredentialKeys } from '../src/dsh.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const p01Fixture = fileURLToPath(new URL('./fixtures/dsh/P01-真成功流.ndjson', import.meta.url))

const workdir = mkdtempSync(join(tmpdir(), 'dsh-env-whitelist-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function makeBrief(credentials?: TaskBrief['credentials']): TaskBrief {
  const briefPath = join(workdir, 'brief.md')
  writeFileSync(briefPath, 'TASK: env 探测演练', 'utf8')
  return {
    ticket: 'TEST-ENV',
    attempt: 1,
    briefPath,
    workspace: workdir,
    AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') },
    ...(credentials !== undefined ? { credentials } : {}),
  }
}

/** 临时注入宿主 env（恶意样本③的「宿主专有 env」注入面），结束还原（透传 fn 返回值） */
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

/** fake CLI 回显行采集：echo 旋钮输出的非 JSON 行（log 事件） */
async function echoLines(env: Record<string, string>, credentials?: TaskBrief['credentials']): Promise<string[]> {
  return withHostEnv(env, async () => {
    const adapter = new DshAdapter([process.execPath, fakeCli])
    const h = await adapter.launch(makeBrief(credentials))
    const logs: string[] = []
    for await (const ev of adapter.stream(h)) {
      if ((ev as StreamEvent).type === 'log') logs.push((ev as { type: 'log'; text: string }).text)
    }
    return logs
  })
}

describe('附录A-1 · filterWorkerEnv 纯函数（封闭允许集，deny-by-default）', () => {
  it('允许集内键透传、集外键（宿主密钥/注入键）一律丢弃', () => {
    const out = filterWorkerEnv({
      PATH: '/usr/bin',
      HOME: '/home/agent',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      TZ: 'Asia/Shanghai',
      TMPDIR: '/tmp',
      DSH_PROFILE: 'headless',
      // —— 集外键：全部预期不可见 ——
      FAKE_SECRET: 'hunter2-host-secret',
      NODE_OPTIONS: '--import=pwn.mjs',
      LD_PRELOAD: '/evil.so',
      DYLD_LIBRARY_PATH: '/evil/lib',
      SHELL: '/bin/evilsh',
      npm_config_REGISTRY: 'https://evil.example',
      GITHUB_TOKEN: 'ghp_hosttoken',
    })
    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/agent',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      TZ: 'Asia/Shanghai',
      TMPDIR: '/tmp',
      DSH_PROFILE: 'headless',
    })
  })

  it('undefined 值键不产出（process.env 语义）', () => {
    const out = filterWorkerEnv({ PATH: '/usr/bin', UNDEFINED_KEY: undefined })
    expect(out).toEqual({ PATH: '/usr/bin' })
  })
})

describe('附录A-1 · credentials 键域封闭枚举（结构拒收，不起子进程）', () => {
  const injectionKeys: ReadonlyArray<[string, string]> = [
    ['PATH', '/evil/bin'],
    ['NODE_OPTIONS', '--import=evil.mjs'],
    ['LD_PRELOAD', '/evil.so'],
    ['DYLD_LIBRARY_PATH', '/evil/lib'],
    ['SHELL', '/bin/evilsh'],
    ['HOME', '/evil/home'],
  ]

  for (const [key, value] of injectionKeys) {
    it(`注入高危键 ${key} → CONFIG_INVALID（dsh/credential-key-rejected）`, async () => {
      await withHostEnv({ DSH_FAKE_FIXTURE: p01Fixture }, async () => {
        const adapter = new DshAdapter([process.execPath, fakeCli])
        await expect(adapter.launch(makeBrief({ [key]: value }))).rejects.toMatchObject({
          category: 'CONFIG_INVALID',
          subcause: 'dsh/credential-key-rejected',
        })
      })
    })
  }

  it('枚举外普通键（如 MY_COMPANY_KEY）→ 同样结构拒收', () => {
    expect(() => assertCredentialKeys({ MY_COMPANY_KEY: 'x' })).toThrow(
      /CONFIG_INVALID\/dsh\/credential-key-rejected.*MY_COMPANY_KEY.*封闭枚举/,
    )
  })

  it('枚举内键（DEEPSEEK_API_KEY / STUDIO_TOOLS_WKEY）→ assertCredentialKeys 直接过', () => {
    expect(() =>
      assertCredentialKeys({ DEEPSEEK_API_KEY: 'sk-fake', STUDIO_TOOLS_WKEY: 'wk-fake' }),
    ).not.toThrow()
  })

  it('枚举内键经 launch 真透传进子进程 env（回显直证，值不进断言外的日志面）', async () => {
    const logs = await echoLines(
      { DSH_FAKE_FIXTURE: p01Fixture, DSH_FAKE_ECHO_ENV: 'DEEPSEEK_API_KEY,STUDIO_TOOLS_WKEY' },
      { DEEPSEEK_API_KEY: 'sk-fake-model-key', STUDIO_TOOLS_WKEY: 'wk-fake-platform-key' },
    )
    expect(logs).toContain('fake-cli env: DEEPSEEK_API_KEY=sk-fake-model-key')
    expect(logs).toContain('fake-cli env: STUDIO_TOOLS_WKEY=wk-fake-platform-key')
  })
})

describe('恶意样本③ · worker env 探测：白名单后宿主专有 env 不可见（负断言）', () => {
  it('宿主注入 FAKE_SECRET/NODE_OPTIONS 后拉起 worker——点名键 <unset>、键名全貌不含集外键', async () => {
    const logs = await echoLines(
      {
        DSH_FAKE_FIXTURE: p01Fixture,
        DSH_FAKE_ECHO_ENV: 'FAKE_SECRET,NODE_OPTIONS,PATH,HOME,DSH_TELEMETRY_MODE',
        DSH_FAKE_ECHO_ENV_KEYS: '1',
        FAKE_SECRET: 'hunter2-host-secret',
        NODE_OPTIONS: '--import=host-side.mjs',
      },
    )
    // 点名回显：宿主专有键不可见（<unset>），允许集键可见
    expect(logs).toContain('fake-cli env: FAKE_SECRET=<unset>')
    expect(logs).toContain('fake-cli env: NODE_OPTIONS=<unset>')
    expect(logs.some((l) => l.startsWith('fake-cli env: PATH=/'))).toBe(true)
    expect(logs.some((l) => l.startsWith('fake-cli env: HOME=/'))).toBe(true)
    // 遥测红线覆盖可见（DISABLED——非宿主残留）
    expect(logs).toContain('fake-cli env: DSH_TELEMETRY_MODE=DISABLED')

    // 键名全貌（恶意 worker 的 full env dump 探测面）：可见键 ⊆ 封闭允许集 ∪ 框架注入键
    const keysLine = logs.find((l) => l.startsWith('fake-cli env-keys:'))
    expect(keysLine).toBeDefined()
    const seen = (keysLine as string)
      .slice('fake-cli env-keys: '.length)
      .split(',')
      .filter((k) => k !== '')
    expect(seen).not.toContain('FAKE_SECRET')
    expect(seen).not.toContain('NODE_OPTIONS')
    const allowed = (k: string): boolean =>
      ['PATH', 'HOME', 'LANG', 'TZ', 'TMPDIR', 'DSH_TELEMETRY_MODE', 'STUDIO_NEXT_INSTRUCTIONS'].includes(k) ||
      k.startsWith('LC_') ||
      k.startsWith('DSH_')
    // FAKE_ 前缀键=harness 别名在**子进程内**折算的产物（DSH_FAKE_X → FAKE_X）——每个 FAKE_X
    // 都必须有 DSH_FAKE_X 孪生在列，否则即白名单漏 key
    const seenSet = new Set(seen)
    const folded = seen.filter((k) => k.startsWith('FAKE_'))
    for (const f of folded) expect(seenSet.has(`DSH_${f}`)).toBe(true)
    // __CF_USER_TEXT_ENCODING：macOS libuv/CoreFoundation 在 spawn 层之下自动注入（不经过
    // 适配器 env 选项）——非白名单漏点，如实豁免并记录
    const osInjected = new Set(['__CF_USER_TEXT_ENCODING'])
    const illegal = seen.filter((k) => !allowed(k) && !osInjected.has(k) && !k.startsWith('FAKE_'))
    expect(illegal).toEqual([]) // 任何集外键可见即白名单失守
  })
})
