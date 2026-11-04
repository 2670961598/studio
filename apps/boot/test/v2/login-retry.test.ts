/**
 * 774 —— matrix 登录有限退避重试（依赖链故障不触发 crash-loop 刹车）
 *
 * 背景（2026-11-04 23:00 事故）：USB I/O error → Docker/Synapse 全挂 → daemon Matrix 登录 500
 * 「Problem storing device」→ 进程 exit 1 ×5 → guardian crash-loop-brake 15min → daemon 停 ~16min。
 * 本用例钉死：网络/超时/429/5xx 有限重试；4xx/CONFIG_INVALID 立即抛（fail-closed 不变）。
 */
import { describe, expect, it } from 'vitest'
import { isTransientMatrixLoginError, loginWithRetry } from '../../src/boot.ts'

function fakeClient(errors: readonly unknown[]) {
  const calls: string[] = []
  let index = 0
  return {
    calls,
    client: {
      async login(userId: string): Promise<{ userId: string; accessToken: string }> {
        calls.push(userId)
        const error = errors[index]
        index += 1
        if (error !== undefined) throw error
        return { userId, accessToken: 'tok' }
      },
    },
  }
}

const noSleep = () => Promise.resolve()

describe('isTransientMatrixLoginError（274 分级）', () => {
  it('网络/超时/429/5xx = 瞬态（重试）', () => {
    for (const message of [
      'matrix api 500 POST /_matrix/client/v3/login M_UNKNOWN: Problem storing device',
      'matrix api 502 POST /_matrix/client/v3/login',
      'matrix api 429 POST /_matrix/client/v3/login M_LIMIT_EXCEEDED',
      'fetch failed',
      'The operation was aborted due to timeout',
      'connect ECONNREFUSED 127.0.0.1:8008',
    ]) {
      expect(isTransientMatrixLoginError(new Error(message)), message).toBe(true)
    }
  })

  it('4xx 凭据/权限错误与 CONFIG_INVALID 不重试（fail-closed 不变）', () => {
    for (const message of [
      'matrix api 403 POST /_matrix/client/v3/login M_FORBIDDEN: Invalid password',
      'matrix api 401 POST /_matrix/client/v3/login M_UNKNOWN_TOKEN',
      'CONFIG_INVALID：matrix: true 需配 matrixHomeserverUrl',
    ]) {
      expect(isTransientMatrixLoginError(new Error(message)), message).toBe(false)
    }
    expect(isTransientMatrixLoginError(undefined)).toBe(false)
  })
})

describe('loginWithRetry（有限退避；不无限重试）', () => {
  it('5xx 两次后成功 → 第 3 次成功，重试 2 次', async () => {
    const { calls, client } = fakeClient([
      new Error('matrix api 500 POST /_matrix/client/v3/login M_UNKNOWN: Problem storing device'),
      new Error('matrix api 503 POST /_matrix/client/v3/login'),
      undefined,
    ])
    let sleeps = 0
    const result = await loginWithRetry(client, '@bot:studio.local', 'pw', {
      attempts: 3,
      delayMs: 30_000,
      sleep: () => {
        sleeps += 1
        return Promise.resolve()
      },
    })
    expect(result.userId).toBe('@bot:studio.local')
    expect(calls).toHaveLength(3)
    expect(sleeps).toBe(2)
  })

  it('网络错误（fetch failed）同样重试', async () => {
    const { calls, client } = fakeClient([new Error('fetch failed'), undefined])
    const result = await loginWithRetry(client, '@bot:studio.local', 'pw', { attempts: 3, delayMs: 0, sleep: noSleep })
    expect(result.accessToken).toBe('tok')
    expect(calls).toHaveLength(2)
  })

  it('全部瞬态失败 → 尝试 3 次后抛出（不是无限重试，也不直接首败退出）', async () => {
    const { calls, client } = fakeClient([
      new Error('matrix api 500 POST /_matrix/client/v3/login'),
      new Error('matrix api 500 POST /_matrix/client/v3/login'),
      new Error('matrix api 500 POST /_matrix/client/v3/login'),
      undefined,
    ])
    await expect(loginWithRetry(client, '@bot:studio.local', 'pw', { attempts: 3, delayMs: 0, sleep: noSleep })).rejects.toThrow(/matrix api 500/)
    expect(calls).toHaveLength(3)
  })

  it('4xx（密码错误）立即抛出：只尝试 1 次', async () => {
    const { calls, client } = fakeClient([
      new Error('matrix api 403 POST /_matrix/client/v3/login M_FORBIDDEN: Invalid password'),
      undefined,
    ])
    await expect(loginWithRetry(client, '@bot:studio.local', 'pw', { attempts: 3, delayMs: 0, sleep: noSleep })).rejects.toThrow(/403/)
    expect(calls).toHaveLength(1)
  })

  it('CONFIG_INVALID 立即抛出：不重试（fail-closed 不变）', async () => {
    const { calls, client } = fakeClient([new Error('CONFIG_INVALID：matrix: true 需 env MATRIX_BOT_PASSWORD'), undefined])
    await expect(loginWithRetry(client, '@bot:studio.local', 'pw', { attempts: 3, delayMs: 0, sleep: noSleep })).rejects.toThrow(/CONFIG_INVALID/)
    expect(calls).toHaveLength(1)
  })

  it('退避日志可见（每次重试一条）', async () => {
    const lines: string[] = []
    const { client } = fakeClient([new Error('matrix api 500 POST /login'), undefined])
    await loginWithRetry(client, '@bot:studio.local', 'pw', { attempts: 3, delayMs: 0, sleep: noSleep, log: (line) => lines.push(line) })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('瞬态失败（1/3）')
  })
})
