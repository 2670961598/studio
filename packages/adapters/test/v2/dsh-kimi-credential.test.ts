/**
 * kimi-on-dsh §5/§8（docs/quality/kimi-on-dsh.md）：KIMI_API_KEY 进 dsh 凭据白名单——
 *   ① ENV_KEY_ALLOWLIST 宿主 env 放行（仅键名新增，deny-by-default 不变）；
 *   ② CREDENTIAL_KEY_ENUM credentials 键域收纳（DEEPSEEK_* 与未知键照旧结构拒收）；
 *   ③ launch 透传端到端：TaskBrief.credentials 的 KIMI_API_KEY 进 worker env，
 *      值不进 worker 输出流/任何文本面（夹具值只以键名+长度呈报——值红名单纪律）。
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkedCredentials } from '../../src/dsh/helpers.ts'
import { assertCredentialKeys, filterWorkerEnv } from '../../src/dsh/basics.ts'
import { DshAdapter } from '../../src/dsh.ts'
import type { TaskBrief } from '@studio-next/contract'

/** 夹具值（fake- 前缀低熵——scan-repo-secrets PLACEHOLDER 豁免；真 token 永不入仓） */
const FAKE_KIMI = 'fake-kimi-token-value'
const FAKE_WKEY = 'fake-wkey-value'

describe('kimi-on-dsh §5 KIMI_API_KEY 白名单', () => {
  it('ENV_KEY_ALLOWLIST：KIMI_API_KEY 放行（仅键名新增）；deny-by-default 纪律不变', () => {
    const env = filterWorkerEnv({ KIMI_API_KEY: FAKE_KIMI, PATH: '/bin', HOME: '/h', DEEPSEEK_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', NODE_OPTIONS: 'x', SOME_RANDOM_KEY: 'x' })
    expect(env['KIMI_API_KEY']).toBe(FAKE_KIMI)
    expect(env['PATH']).toBe('/bin')
    expect(env['HOME']).toBe('/h')
    expect(env['DEEPSEEK_API_KEY']).toBeUndefined()
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['NODE_OPTIONS']).toBeUndefined()
    expect(env['SOME_RANDOM_KEY']).toBeUndefined()
  })

  it('CREDENTIAL_KEY_ENUM：KIMI_API_KEY 收纳且可与 STUDIO_TOOLS_WKEY 并存；官方/未知键照旧拒收', () => {
    expect(checkedCredentials({ KIMI_API_KEY: FAKE_KIMI })).toEqual({ KIMI_API_KEY: FAKE_KIMI })
    expect(checkedCredentials({ STUDIO_TOOLS_WKEY: FAKE_WKEY, KIMI_API_KEY: FAKE_KIMI })).toEqual({ STUDIO_TOOLS_WKEY: FAKE_WKEY, KIMI_API_KEY: FAKE_KIMI })
    expect(() => checkedCredentials({ DEEPSEEK_API_KEY: 'x' })).toThrow(/封闭枚举|合法键/)
    expect(() => checkedCredentials({ KIMI_API_TOKEN: 'x' })).toThrow(/封闭枚举|合法键/)
    expect(() => assertCredentialKeys({ PATH: '/bin' })).toThrow(/credential-key-rejected/)
  })

  it('launch 端到端：credentials 注入 KIMI_API_KEY 进 worker env（与 WKEY 并存）；值不落输出流；可见键 ⊆ 白名单∪框架键', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-kimi-cred-'))
    try {
      const ws = join(root, 'ws'); mkdirSync(ws)
      const probeFile = join(root, 'probe.json')
      const p01 = join(process.cwd(), 'packages/adapters/test/fixtures/dsh/P01-真成功流.ndjson')
      const sourceRoot = join(root, 'host-dsh'); mkdirSync(join(sourceRoot, 'profiles', 'headless'), { recursive: true })
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'cordis.patch.yml'), '- id: agent-default-model\n')
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'cordis.yml'), 'profile: headless\n')
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'package.json'), '{"name":"headless"}\n')
      // worker 探针：只回显键名集合＋点名键的存在性与长度——凭据值不进任何回显面
      const worker = join(root, 'worker.mjs')
      writeFileSync(worker, `#!/usr/bin/env node\nimport { appendFileSync, readFileSync } from 'node:fs'\nif (process.argv.includes('--version')) { console.log('0.2.1-rc.5'); process.exit(0) }\nappendFileSync(${JSON.stringify(probeFile)}, JSON.stringify({ keys: Object.keys(process.env).sort(), hasKimi: typeof process.env.KIMI_API_KEY === 'string', kimiLen: (process.env.KIMI_API_KEY ?? '').length, hasWkey: typeof process.env.STUDIO_TOOLS_WKEY === 'string' }))\nconst raw=readFileSync(${JSON.stringify(p01)},'utf8'); console.log(raw.split('\\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#')).join('\\n'))\n`, 'utf8')
      chmodSync(worker, 0o755)
      writeFileSync(join(root, 'brief.md'), 'kimi-on-dsh §5 fake launch')
      const adapter = new DshAdapter([process.execPath, worker], {})
      const brief: TaskBrief = { ticket: 'T-K5', attempt: 1, briefPath: join(root, 'brief.md'), workspace: ws, AGENTS_MD: { channel: 'native', target: join(ws, 'AGENTS.md') }, credentials: { KIMI_API_KEY: FAKE_KIMI, STUDIO_TOOLS_WKEY: FAKE_WKEY } }
      const savedHome = process.env['DSH_HOME']; process.env['DSH_HOME'] = sourceRoot
      let streamText = ''
      try {
        const h = await adapter.launch(brief)
        for await (const chunk of adapter.stream(h)) streamText += JSON.stringify(chunk) + '\n'
      } finally { if (savedHome === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = savedHome }
      const probe = JSON.parse(readFileSync(probeFile, 'utf8')) as { keys: string[]; hasKimi: boolean; kimiLen: number; hasWkey: boolean }
      // 注入到位：KIMI_API_KEY/WKEY 都在；值只以长度呈报（不回显原文）
      expect(probe.hasKimi).toBe(true)
      expect(probe.kimiLen).toBe(FAKE_KIMI.length)
      expect(probe.hasWkey).toBe(true)
      // 可见键 ⊆ 白名单 ∪ 框架注入键（deny-by-default 的端到端直证）
      const allowed = new Set(['PATH', 'HOME', 'LANG', 'TZ', 'TMPDIR', 'GLM_ZCODE_KEY', 'OPENCODE_GO_API_KEY', 'KIMI_API_KEY', 'STUDIO_TOOLS_WKEY', 'STUDIO_NEXT_INSTRUCTIONS', '__CF_USER_TEXT_ENCODING']) // 末键=macOS spawn 系统注入
      const visible = probe.keys.filter((k) => !k.startsWith('DSH_') && !k.startsWith('LC_'))
      expect(visible.filter((k) => !allowed.has(k))).toEqual([])
      // 值不落输出流（worker 只回显键名/长度——流文本不含夹具值）
      expect(streamText.includes(FAKE_KIMI)).toBe(false)
      expect(streamText.includes(FAKE_WKEY)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 10_000)
})
