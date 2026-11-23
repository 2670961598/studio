/**
 * kimi-on-dsh §4/§8（docs/quality/kimi-on-dsh.md）：serve 注入面 wireKimiTokenFace——
 * 刷新器 CLI 装配契约（argv/env 收口/超时/串行化/吞错映射/日志零 token）＋
 * 真子进程端到端（假 OAuth 端点：refresh() ok → token 文件 0600 落新值）。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT } from '../../../src/engine/dispatch/kimi-token.ts'
import { wireKimiTokenFace, type KimiRefreshExec } from '../../../src/assembly/serve/kimi-token/kimi-token-face.ts'

/** 夹具 token（fake- 前缀低熵——scan-repo-secrets PLACEHOLDER 豁免；真 token 永不入仓） */
const FAKE_TOKEN = 'fake-access-token-face-e2e'

interface Call { file: string; args: readonly string[]; opts: { env: Record<string, string>; timeout: number } }

function capturingExec(outcome: 'ok' | 'exit' | 'timeout' = 'ok'): { exec: KimiRefreshExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: KimiRefreshExec = async (file, args, opts) => {
    calls.push({ file, args, opts })
    if (outcome === 'exit') throw Object.assign(new Error('non-zero'), { code: 1 })
    if (outcome === 'timeout') throw Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' })
    return { stdout: 'ok：token 文件已写', stderr: '' }
  }
  return { exec, calls }
}

const BASE_ENV = { PATH: process.env['PATH'] ?? '/usr/bin', HOME: '/tmp/fake-home', STUDIO_KIMI_TOKEN_FILE: '/tmp/fake-secrets/kimi-access-token', NODE_OPTIONS: '--require evil', KIMI_API_KEY: 'fake-should-not-pass' }

describe('kimi-on-dsh §4 serve 注入面 wireKimiTokenFace', () => {
  it('装配契约：argv=[--once,--timeout-ms,10000]；超时 40s；env 收口（token 路径同源＋重试 2 次；无关键不透）；ok 映射；日志零 token', async () => {
    const { exec, calls } = capturingExec()
    const logs: string[] = []
    const deps = wireKimiTokenFace({ exec, env: BASE_ENV, log: (l) => logs.push(l) })
    expect(deps.tokenFile).toBe('/tmp/fake-secrets/kimi-access-token')
    expect(deps.maxAgeMs).toBe(KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT)
    expect(deps.refresh).toBeDefined()
    expect(await deps.refresh?.()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe(process.execPath)
    expect(calls[0]?.args[0]).toContain(join('scripts', 'ops', 'kimi-token-refresh.mjs')) // 缺省=仓内刷新器
    expect(calls[0]?.args.slice(1)).toEqual(['--once', '--timeout-ms', '10000'])
    expect(calls[0]?.opts.timeout).toBe(40_000)
    const env = calls[0]?.opts.env ?? {}
    expect(env['STUDIO_KIMI_TOKEN_FILE']).toBe('/tmp/fake-secrets/kimi-access-token') // 与 daemon 读值同路径源
    expect(env['KIMI_REFRESH_MAX_ATTEMPTS']).toBe('2')
    expect(env['HOME']).toBe('/tmp/fake-home')
    expect(env['NODE_OPTIONS']).toBeUndefined() // deny-by-default：daemon env 不整体继承
    expect(env['KIMI_API_KEY']).toBeUndefined()
    expect(logs.some((l) => l.includes('已刷新'))).toBe(true)
    expect(logs.join('\n').includes('token 文件已写')).toBe(false) // 子进程 stdout 不回显
    expect(logs.join('\n')).not.toContain('/tmp/fake-secrets') // 路径也不进日志
  })

  it('凭据覆盖透传：KIMI_CREDENTIALS_FILE / KIMI_CODE_OAUTH_HOST / KIMI_OAUTH_HOST 进子进程 env', async () => {
    const { exec, calls } = capturingExec()
    const deps = wireKimiTokenFace({ exec, env: { ...BASE_ENV, KIMI_CREDENTIALS_FILE: '/tmp/fake-creds.json', KIMI_CODE_OAUTH_HOST: 'http://127.0.0.1:1' } })
    await deps.refresh?.()
    const env = calls[0]?.opts.env ?? {}
    expect(env['KIMI_CREDENTIALS_FILE']).toBe('/tmp/fake-creds.json')
    expect(env['KIMI_CODE_OAUTH_HOST']).toBe('http://127.0.0.1:1')
    expect(env['KIMI_OAUTH_HOST']).toBeUndefined()
  })

  it('吞错映射：非零退出 → {ok:false}＋exit=1；超时（killed）→ timeout；均不抛', async () => {
    const exit = capturingExec('exit')
    const logs: string[] = []
    const d1 = wireKimiTokenFace({ exec: exit.exec, env: BASE_ENV, log: (l) => logs.push(l) })
    expect(await d1.refresh?.()).toEqual({ ok: false })
    const killed = capturingExec('timeout')
    const d2 = wireKimiTokenFace({ exec: killed.exec, env: BASE_ENV, log: (l) => logs.push(l) })
    expect(await d2.refresh?.()).toEqual({ ok: false })
    expect(logs.some((l) => l.includes('exit=1'))).toBe(true)
    expect(logs.some((l) => l.includes('timeout'))).toBe(true)
  })

  it('串行化：并发 refresh 排队不并发（refresh_token 轮换竞态防护）', async () => {
    const order: string[] = []
    let n = 0
    let release: (() => void) | undefined
    const exec: KimiRefreshExec = () => {
      const i = n++
      order.push(`start${String(i)}`)
      if (i === 0) return new Promise((resolve) => { release = () => { order.push('end0'); resolve({ stdout: '', stderr: '' }) } })
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const deps = wireKimiTokenFace({ exec, env: BASE_ENV })
    const p1 = deps.refresh?.() ?? Promise.resolve({ ok: true })
    const p2 = deps.refresh?.() ?? Promise.resolve({ ok: true })
    await new Promise((r) => setImmediate(r))
    expect(order).toEqual(['start0']) // 第二次未启动
    release?.()
    expect(await Promise.all([p1, p2])).toEqual([{ ok: true }, { ok: true }])
    expect(order).toEqual(['start0', 'end0', 'start1'])
  })

  it('端到端（真子进程＋假 OAuth 端点）：refresh() ok → token 文件 0600 落新值；credentials 轮换回写', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kimi-face-e2e-'))
    try {
      const credFile = join(root, 'kimi-code.json')
      writeFileSync(credFile, `${JSON.stringify({ access_token: 'fake-access-old', refresh_token: 'fake-refresh-old', expires_at: 1, expires_in: 900, scope: 'coding:all' }, null, 2)}\n`, { mode: 0o600 })
      const tokenFile = join(root, 'secrets', 'kimi-access-token')
      const server = http.createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => { raw += String(c) })
        req.on('end', () => {
          const form = new URLSearchParams(raw)
          if (form.get('refresh_token') !== 'fake-refresh-old' || form.get('grant_type') !== 'refresh_token') {
            res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_grant' })); return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ access_token: FAKE_TOKEN, refresh_token: 'fake-refresh-rotated', expires_in: 900 }))
        })
      })
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
        })
      })
      const logs: string[] = []
      try {
        const deps = wireKimiTokenFace({ env: { PATH: process.env['PATH'] ?? '/usr/bin', HOME: root, STUDIO_KIMI_TOKEN_FILE: tokenFile, KIMI_CREDENTIALS_FILE: credFile, KIMI_OAUTH_HOST: `http://127.0.0.1:${String(port)}` }, log: (l) => logs.push(l) })
        expect(await deps.refresh?.()).toEqual({ ok: true })
      } finally { server.close() }
      expect(readFileSync(tokenFile, 'utf8')).toBe(`${FAKE_TOKEN}\n`)
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(credFile, 'utf8')).refresh_token).toBe('fake-refresh-rotated')
      expect(logs.join('\n').includes(FAKE_TOKEN)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 20_000)
})
