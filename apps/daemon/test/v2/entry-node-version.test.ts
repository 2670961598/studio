/**
 * entry-node-version —— NEG-ENG-04（入口 Node 版本 fail-fast）实现侧验收
 *
 * 依据（实现单必引章节号——AGENTS §五.1）：
 *   - docs/v2/13 §八-2 未证项「启动期版本 fail-fast：进程入口读 `process.versions.node`/
 *     `features.typescript` 与期望比对，不满足拒绝启动」；§八-3「engines.node 收紧后的
 *     跨版本验证」；§1.1 TOOL-05（`engines` 只是声明性提示，Bun 实测可绕过——真闸＝
 *     mise 锁版＋启动 fail-fast＋验收三项）；
 *   - docs/v2/17 §4.4 NEG-ENG-04「Node 版本不符启动 → 入口拒绝启动（V4）」；
 *   - 版本唯一源 `.mise.toml`（node=24.21.0）；根 `package.json` engines.node=">=24"。
 *
 * 断言面两层（拒绝启动＝exit 非零且**不进装配**，不是打印警告继续跑）：
 *   ① 纯函数 `assertNodeVersion(version)`（apps/daemon/src/index.ts 导出）——旧版/坏串/
 *      新版三态＋边界（23.9.9 拒、24.0.0 放行=只按主版本判、含预发布后缀）；
 *   ② 真入口（V4）：`node --import <夹具> apps/daemon/src/index.ts …`——夹具改写
 *      `process.versions.node` 后跑真进程：旧版/坏串 → exit 1、stderr 给出
 *      `CONFIG_INVALID/daemon/node-version`、stdout 无 usage、stderr 无「启动失败」
 *      （＝未读取配置、未装配）；新版 → `--help` 照常 exit 0（fail-fast 不误杀正常启动）；
 *   ③ 版本门槛与 `.mise.toml`／根 `engines.node` 机械对齐（不靠注释自称）。
 *
 * 证据通道（NEG-ENG-05 纪律）：只用仓内 `.ts` 夹具＋真进程 spawn；不用 eval/stdin 形态。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNodeVersion, MIN_NODE_MAJOR, nodeMajorOf } from '../../src/index.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ENTRY = 'apps/daemon/src/index.ts'
const FAKE_PRELOAD = pathToFileURL(fileURLToPath(new URL('./fixtures/fake-node-version.ts', import.meta.url))).href
const FAKE_ENV = 'STUDIO_NEXT_FAKE_NODE_VERSION'

interface EntryRun {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * 跑真入口（cwd=仓根，与 `bun run daemon` 同形）；fakeVersion 给定时前置夹具改写版本串。
 * `node` 走 PATH（门禁口径 `mise exec -- …` 下即 24.21.0——与 .mise 锁版一致）。
 */
function runEntry(args: readonly string[], fakeVersion?: string): EntryRun {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (fakeVersion === undefined) delete env[FAKE_ENV]
  else env[FAKE_ENV] = fakeVersion
  const preload = fakeVersion === undefined ? [] : ['--import', FAKE_PRELOAD]
  const proc = spawnSync('node', [...preload, ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env,
  })
  return { status: proc.status ?? -1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' }
}

interface VersionRefusal {
  readonly message: string
  readonly category?: string | undefined
  readonly subcause?: string | undefined
  readonly detail?: string | undefined
}

/** 取断言函数拒绝（未拒＝测试自身判负） */
function versionRefusalOf(version: string): VersionRefusal {
  try {
    assertNodeVersion(version)
  } catch (err) {
    const failure = err as Error & { category?: string; subcause?: string; detail?: string }
    return { message: failure.message, category: failure.category, subcause: failure.subcause, detail: failure.detail }
  }
  throw new Error(`预期版本 ${JSON.stringify(version)} 被拒，实际通过——fail-fast 未生效（NEG-ENG-04 判负）`)
}

/** 拒绝面共同断言：CONFIG_INVALID + daemon/node-version + 文案含版本串与最低主版本 */
function expectVersionRefusal(version: string): VersionRefusal {
  const refusal = versionRefusalOf(version)
  expect(refusal.category).toBe('CONFIG_INVALID')
  expect(refusal.subcause).toBe('daemon/node-version')
  expect(refusal.message.startsWith('CONFIG_INVALID/daemon/node-version：')).toBe(true)
  expect(refusal.message).toContain(`>=${MIN_NODE_MAJOR}`)
  return refusal
}

describe('NEG-ENG-04 · assertNodeVersion（纯函数三态）', () => {
  it('旧版本：20.19.0 / 23.9.9 拒（主版本 < 24），文案给实际版本与最低要求', () => {
    for (const old of ['20.19.0', '23.9.9']) {
      const refusal = expectVersionRefusal(old)
      expect(refusal.message).toContain(old)
      expect(refusal.message).toContain(`最低要求 ${MIN_NODE_MAJOR}`)
      expect(refusal.message).toContain('拒绝启动')
    }
  })

  it('坏串：空串／少段／非数字／带 v 前缀 一律不可解析→拒（不猜版本、不放行）', () => {
    for (const bad of ['', '24', '24.21', 'twenty-four', 'v24.21.0', '24.x.0']) {
      const refusal = expectVersionRefusal(bad)
      expect(refusal.message).toContain('无法解析 Node 版本')
      expect(refusal.message).toContain(JSON.stringify(bad))
      expect(refusal.detail).toContain('无法解析')
    }
  })

  it('新版本：24.0.0（边界，只按主版本判）/ 24.21.0（.mise 锁版）/ 25.6.1 / 26.3.0 放行', () => {
    expect(assertNodeVersion('24.0.0')).toBe(24)
    expect(assertNodeVersion('24.21.0')).toBe(24)
    expect(assertNodeVersion('25.6.1')).toBe(25)
    expect(assertNodeVersion('26.3.0')).toBe(26)
  })

  it('预发布/带后缀形态：24.21.0-rc.1 主版本可判→放行；nodeMajorOf 与断言一致', () => {
    expect(assertNodeVersion('24.21.0-rc.1')).toBe(24)
    expect(nodeMajorOf('24.21.0-rc.1')).toBe(24)
    expect(nodeMajorOf('twenty-four')).toBeUndefined()
  })

  it('门槛机械对齐 .mise.toml 与根 engines.node（不靠注释自称）', () => {
    const mise = readFileSync(join(REPO_ROOT, '.mise.toml'), 'utf8')
    const miseNode = /^\s*node\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m.exec(mise)
    expect(miseNode?.[1]).toBe(String(MIN_NODE_MAJOR))
    const engines = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    const enginesMajor = /(\d+)/.exec(engines.engines?.node ?? '')
    expect(enginesMajor?.[1]).toBe(String(MIN_NODE_MAJOR))
  })
})

describe('NEG-ENG-04 · 真入口 fail-fast（V4：真进程 + 前置夹具，不改生产分支）', () => {
  it('旧版本启动：exit 1 + CONFIG_INVALID/daemon/node-version，且不进装配（无 usage/无启动失败）', () => {
    const run = runEntry(['--config', 'does-not-exist.yaml'], '20.19.0')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('CONFIG_INVALID/daemon/node-version')
    expect(run.stderr).toContain('20.19.0')
    expect(run.stderr).toContain(`最低要求 ${MIN_NODE_MAJOR}`)
    expect(run.stderr).toContain('拒绝启动')
    // 未进 main：既不打印入口 usage，也不进入 runServe 的配置失败分支
    expect(run.stdout).toBe('')
    expect(run.stderr).not.toContain('启动失败')
  })

  it('坏版本串启动：exit 1 + 不可解析拒（明确错误，不静默放行）', () => {
    const run = runEntry(['--config', 'does-not-exist.yaml'], 'twenty-four')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('CONFIG_INVALID/daemon/node-version')
    expect(run.stderr).toContain('无法解析 Node 版本')
    expect(run.stderr).toContain('"twenty-four"')
    expect(run.stdout).toBe('')
  })

  it('新版本启动：--help 照常 exit 0（fail-fast 不误杀；前置夹具注入 25.6.1）', () => {
    const run = runEntry(['--help'], '25.6.1')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('用法')
    expect(run.stdout).toContain('无 --config 时本入口只打印本段用法')
    expect(run.stderr).not.toContain('node-version')
  })

  it('当前运行时（真实版本）启动：--help 照常 exit 0（无夹具路径同为正例）', () => {
    const run = runEntry(['--help'])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('用法')
  })
})
