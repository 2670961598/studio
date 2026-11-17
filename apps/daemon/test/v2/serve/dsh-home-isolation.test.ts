/** task-112：DSH_HOME 隔离配置面 + DeepSeek 官方 key 拒收 + spawn 前 env 断言基础面。 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      const worker = join(root, 'worker.mjs')
      writeFileSync(worker, `#!/usr/bin/env node\nimport { readFileSync, appendFileSync } from 'node:fs'\nif (process.argv.includes('--version')) { console.log('0.2.1-rc.5'); process.exit(0) }\nappendFileSync(${JSON.stringify(envFile)}, JSON.stringify({ DSH_HOME: process.env.DSH_HOME ?? null, hasDeepseek: Object.keys(process.env).some(k => k === 'DEEPSEEK_API_KEY' || k.startsWith('DEEPSEEK_')) }))\nconst raw=readFileSync(${JSON.stringify(p01)},'utf8'); console.log(raw.split('\\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#')).join('\\n'))\n`, 'utf8')
      chmodSync(worker, 0o755)
      writeFileSync(join(root, 'brief.md'), 'task-118 fake launch')
      const adapter = new DshAdapter([process.execPath, worker], {})
      const brief: TaskBrief = { ticket: 'T-118', attempt: 1, briefPath: join(root, 'brief.md'), workspace: ws, AGENTS_MD: { channel: 'native', target: join(ws, 'AGENTS.md') } }
      const h = await adapter.launch(brief)
      for await (const _ of adapter.stream(h)) { void _ }
      const env = JSON.parse(readFileSync(envFile, 'utf8')) as { DSH_HOME: string | null; hasDeepseek: boolean }
      expect(env.DSH_HOME).toBe(join(ws, '.dsh-home'))
      expect(env.hasDeepseek).toBe(false)
      expect(() => assertNoOfficialProviderKeys({ DEEPSEEK_API_KEY: 'x' })).toThrow(/credential-forbidden/)
      expect(() => assertNoOfficialProviderKeys({ DEEPSEEK_ANY: 'x' })).toThrow(/credential-forbidden/)
      expect(() => assertNoOfficialProviderKeys({ STUDIO_TOOLS_WKEY: 'x' })).not.toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 10_000)
})
