/** task-112：DSH_HOME 隔离配置面 + DeepSeek 官方 key 拒收 + spawn 前 env 断言基础面。 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkedCredentials } from '../../../../../packages/adapters/src/dsh/helpers.ts'
import { filterWorkerEnv } from '../../../../../packages/adapters/src/dsh/basics.ts'
import { DshAdapter, assertNoOfficialProviderKeys } from '../../../../../packages/adapters/src/dsh.ts'
import type { TaskBrief } from '@studio-next/contract'
import { resolveSeatbeltGrant } from '@studio-next/adapters'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'

const BASE = ['db: /tmp/x/var/ledger.sqlite', 'platform: localfile', 'company: demo', 'rootDir: /tmp/x/var', 'jobs: false'].join('\n')

describe('task-112 DSH_HOME 隔离/官方 key', () => {
  it('credentials 封闭枚举移除 DeepSeek：DEEPSEEK_API_KEY/DEEPSEEK_* 结构拒收，STUDIO_TOOLS_WKEY 保留', () => {
    expect(() => checkedCredentials({ DEEPSEEK_API_KEY: 'x' })).toThrow(/封闭枚举|合法键/)
    expect(() => checkedCredentials({ DEEPSEEK_X: 'x' })).toThrow(/封闭枚举|合法键/)
    expect(checkedCredentials({ STUDIO_TOOLS_WKEY: 'w' })).toEqual({ STUDIO_TOOLS_WKEY: 'w' })
  })

  it('filterWorkerEnv 不透传 DeepSeek 官方 key；dshHomeIsolation 配置进入圈定计划且可回退', () => {
    const env = filterWorkerEnv({ DEEPSEEK_API_KEY: 'x', PATH: '/bin' })
    expect(env['DEEPSEEK_API_KEY']).toBeUndefined()
    expect(env['PATH']).toBe('/bin')
    const on = resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: ['/w'], authorization: 'task-112' })
    expect(on.dshHomeIsolation).toBeUndefined() // 缺省由 dshAdapterOptions 置 true
    const off = resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots: ['/w'], authorization: 'task-112', dshHomeIsolation: false })
    expect(off.dshHomeIsolation).toBe(false)
    const cfg = parseDaemonConfig(`${BASE}\nseatbeltTier: workspace-write\nseatbeltWriteRoots: '["/w"]'\nseatbeltAuthorization: 'task-112'\ndshHomeIsolation: false`)
    expect(cfg.seatbelt?.dshHomeIsolation).toBe(false)
  })

  it('无 seatbelt 的 fake launch 仍隔离 DSH_HOME=<workspace>/.dsh-home，env 无 DEEPSEEK_*；官方 key 断言 helper 继续拒', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-home-env-'))
    try {
      const ws = join(root, 'ws'); mkdirSync(ws)
      const envFile = join(root, 'env.json')
      const p01 = join(process.cwd(), 'packages/adapters/test/fixtures/dsh/P01-真成功流.ndjson')
      const sourceRoot = join(root, 'host-dsh'); mkdirSync(join(sourceRoot, 'profiles', 'headless'), { recursive: true })
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'cordis.patch.yml'), '- id: agent-default-model\n')
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'cordis.yml'), 'profile: headless\n')
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'package.json'), '{"name":"headless"}\n')
      writeFileSync(join(sourceRoot, '.env'), 'GLM_ZCODE_KEY=glm-test\nDEEPSEEK_API_KEY=sk-should-not\nOPENCODE_GO_API_KEY=oc-test\nKIMI_API_KEY=kim-test\nGLM_BASE_URL=https://glm.test\nDEEPSEEK_BASE_URL=https://deepseek.test\n')
      writeFileSync(join(sourceRoot, 'profiles', 'headless', '.env'), 'SHOULD_NOT_COPY=1\n')
      mkdirSync(join(sourceRoot, 'profiles', 'headless', 'node_modules'))
      writeFileSync(join(sourceRoot, 'profiles', 'headless', 'node_modules', 'provider.mjs'), '// provider\n')
      const worker = join(root, 'worker.mjs')
      writeFileSync(worker, `#!/usr/bin/env node\nimport { existsSync, readFileSync, appendFileSync } from 'node:fs'\nif (process.argv.includes('--version')) { console.log('0.2.1-rc.5'); process.exit(0) }\nconst home=process.env.DSH_HOME ?? ''\nappendFileSync(${JSON.stringify(envFile)}, JSON.stringify({ DSH_HOME: home, hasDeepseek: Object.keys(process.env).some(k => k === 'DEEPSEEK_API_KEY' || k.startsWith('DEEPSEEK_')), hasProfile: existsSync(home + '/profiles/headless/cordis.patch.yml'), hasProvider: existsSync(home + '/profiles/headless/node_modules/provider.mjs'), copiedEnv: existsSync(home + '/profiles/headless/.env') }))\nconst raw=readFileSync(${JSON.stringify(p01)},'utf8'); console.log(raw.split('\\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#')).join('\\n'))\n`, 'utf8')
      chmodSync(worker, 0o755)
      writeFileSync(join(root, 'brief.md'), 'task-118 fake launch')
      const adapter = new DshAdapter([process.execPath, worker], {})
      const brief: TaskBrief = { ticket: 'T-118', attempt: 1, briefPath: join(root, 'brief.md'), workspace: ws, AGENTS_MD: { channel: 'native', target: join(ws, 'AGENTS.md') } }
      const savedHome = process.env['DSH_HOME']; process.env['DSH_HOME'] = sourceRoot
      try {
        const h = await adapter.launch(brief)
        for await (const _ of adapter.stream(h)) { void _ }
      } finally { if (savedHome === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = savedHome }
      const env = JSON.parse(readFileSync(envFile, 'utf8')) as { DSH_HOME: string | null; hasDeepseek: boolean; hasProfile: boolean; hasProvider: boolean; copiedEnv: boolean }
      expect(env.DSH_HOME).toBe(join(ws, '.dsh-home'))
      expect(env.hasDeepseek).toBe(false)
      expect(env.hasProfile).toBe(true)
      expect(env.hasProvider).toBe(true)
      expect(env.copiedEnv).toBe(false)
      const isolatedEnv = join(ws, '.dsh-home', '.env')
      const envText = readFileSync(isolatedEnv, 'utf8')
      expect(envText).toContain('GLM_ZCODE_KEY=glm-test')
      expect(envText).toContain('OPENCODE_GO_API_KEY=oc-test')
      expect(envText).toContain('KIMI_API_KEY=kim-test')
      expect(envText).toContain('GLM_BASE_URL=https://glm.test')
      expect(envText).not.toContain('DEEPSEEK')
      expect(statSync(isolatedEnv).mode & 0o777).toBe(0o600)
      expect(() => assertNoOfficialProviderKeys({ DEEPSEEK_API_KEY: 'x' })).toThrow(/credential-forbidden/)
      expect(() => assertNoOfficialProviderKeys({ DEEPSEEK_ANY: 'x' })).toThrow(/credential-forbidden/)
      expect(() => assertNoOfficialProviderKeys({ STUDIO_TOOLS_WKEY: 'x' })).not.toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 10_000)
})
