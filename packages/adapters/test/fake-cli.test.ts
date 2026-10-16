/**
 * fake CLI harness 冒烟测试 —— 证明假 CLI 本身可用（适配器 spawn 测试的地基）
 *
 * 覆盖：FAKE_FIXTURE 回放逐字节一致 / FAKE_EXIT 反映非零退出码 / FAKE_HANG 挂起且可被
 * SIGTERM 终止。不测流归一化（那是 streams.test.ts 的事）。
 */
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const dshFixture = fileURLToPath(new URL('./fixtures/dsh/turn-completed.ndjson', import.meta.url))

function runWith(extraEnv: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [fakeCli], {
    env: { ...process.env, ...extraEnv },
  })
}

describe('fake CLI harness（docs/18-§1.3）', () => {
  it('FAKE_FIXTURE：stdout 与 fixture 内容逐字节一致，退出码 0', async () => {
    const { stdout, stderr } = await runWith({ FAKE_FIXTURE: dshFixture })
    expect(stdout).toBe(readFileSync(dshFixture, 'utf8'))
    expect(stderr).toBe('')
  })

  it('FAKE_EXIT=3：退出码如实反映', async () => {
    await expect(runWith({ FAKE_FIXTURE: dshFixture, FAKE_EXIT: '3' })).rejects.toMatchObject({
      code: 3,
      stdout: readFileSync(dshFixture, 'utf8'),
    })
  })

  it('FAKE_HANG=1：挂起不退出，SIGTERM 可终止', async () => {
    const child = spawn(process.execPath, [fakeCli], {
      env: { ...process.env, FAKE_FIXTURE: dshFixture, FAKE_HANG: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined
    child.on('close', (code, signal) => {
      closed = { code, signal }
    })

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()

    child.kill('SIGTERM')
    await new Promise((resolve) => child.on('close', resolve))
    expect(closed).toEqual({ code: null, signal: 'SIGTERM' })
  }, 8000)
})
