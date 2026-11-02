/**
 * dsh 内层沙箱透传（DSH_PERMISSION_MODE）测试 —— 11-01 轨7 装备令
 *
 * 依据（防未来漂移的机制注记；随包代码事实已复核）：
 *   - 外层 seatbelt（seatbelt.ts，daemon 派发面）圈住整个 worker 进程树；macOS 内核拒绝
 *     嵌套 sandbox_apply（EPERM——seatbelt.ts 头注同源事实），worker 内 dsh 的 bash 工具
 *     再申请内层沙箱=死（11-01 起 26+ 份 REPORT 实证）。装备令语义＝隔离责任归外层工位
 *     seatbelt 全权圈禁，内层 dsh 沙箱不得叠加。
 *   - 透传唯一有效通道=worker env：@deepseek-ai/dsh-bash-sandbox 构造器
 *     `this.mode = ctx.sandboxPolicy.defaultMode`（lib/index.js——无视插件自身 config：
 *     11-01 headless profile 的 `bash-sandbox: mode: danger-full-access` patch 从未生效即
 *     此因）；而 @deepseek-ai/dsh-sandbox-policy 的 mode=`process.env.DSH_PERMISSION_MODE
 *     ?? 'workspace-write'`（随包 dsh-base/cordis.patch.yml）。danger-full-access 分支不做
 *     内层 apply（bash-sandbox execute 早退），外层 seatbelt 成为唯一圈禁者。
 *   - 边界：只在外层 seatbelt **实际包装 argv** 时注入；无外层圈禁的调用面不注入（保持
 *     dsh 缺省 workspace-write——不把无圈禁路径也放开）。
 *
 * 测试面：vi.mock 注入假 execa 截获 launch 的 (cmd, argv, options)——不真跑 dsh、不起
 * sandbox-exec：注入决策本身确定性直证，不依赖宿主是否嵌套沙箱环境（与 seatbelt.test.ts
 * 的真机环境自适应面互补）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskBrief } from '@studio-next/contract'
import { DshAdapter } from '../src/dsh.ts'
import { SEATBELT_BIN } from '../src/seatbelt.ts'

interface CapturedCall {
  cmd: string
  args: readonly string[]
  opts: { env: Record<string, string>; extendEnv?: boolean; cwd?: string }
}

/** 假 execa 截获面（vi.hoisted：mock 工厂外置变量须在模块加载前就绪） */
const captured = vi.hoisted(() => ({ calls: [] as CapturedCall[] }))

vi.mock('execa', () => ({
  execa: (cmd: string, args: readonly string[], opts: CapturedCall['opts']) => {
    captured.calls.push({ cmd, args, opts })
    // 假 Subprocess：launch 只读 pid 与 then（落定观察器）；stdout/kill 补齐形状
    const settled = Promise.resolve({ exitCode: 0 })
    return {
      pid: 4242,
      stdout: (async function* (): AsyncGenerator<string> {})(),
      kill: (): boolean => true,
      then: (
        onFulfilled?: (v: { exitCode: number }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => settled.then(onFulfilled, onRejected),
    }
  },
}))

const workdir = mkdtempSync(join(tmpdir(), 'dsh-permission-mode-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

let seq = 0

function makeBrief(): TaskBrief {
  seq += 1
  const ws = mkdtempSync(join(workdir, `ws-${String(seq)}-`))
  const briefPath = join(ws, 'brief.md')
  writeFileSync(briefPath, 'TASK: 内层沙箱透传探针', 'utf8')
  return {
    ticket: `PERM-${String(seq)}`,
    attempt: 1,
    briefPath,
    workspace: ws,
    AGENTS_MD: { channel: 'native', target: join(ws, 'AGENTS.md') },
  }
}

beforeEach(() => {
  captured.calls.length = 0
})

/** 跑一次 launch 并取回 execa 调用（假 execa：不起真进程） */
async function launchCaptured(adapter: DshAdapter): Promise<CapturedCall> {
  await adapter.launch(makeBrief())
  expect(captured.calls).toHaveLength(1)
  const call = captured.calls[0]
  if (call === undefined) throw new Error('假 execa 未截获 launch 调用')
  return call
}

describe('外层 seatbelt 实际生效 → 注入 DSH_PERMISSION_MODE=danger-full-access（内层不叠加 apply）', () => {
  it('mode=auto：argv 经 sandbox-exec 包装，env 注入 danger-full-access，并压过宿主残留值', async () => {
    // 宿主残留值：白名单（DSH_ 前缀）会透传——显式注入位必须压过它（否则外层圈禁时内层仍 workspace-write）
    const saved = process.env.DSH_PERMISSION_MODE
    process.env.DSH_PERMISSION_MODE = 'workspace-write'
    try {
      const cmd = ['dsh', '--profile', 'headless', '--json']
      const adapter = new DshAdapter(cmd, { seatbelt: { mode: 'auto' } })
      const call = await launchCaptured(adapter)
      // 注入前提直证：argv 确已由 sandbox-exec 包装（sandbox-exec -f <profile> -- <dsh argv…>）
      expect(call.cmd).toBe(SEATBELT_BIN)
      expect(call.args[0]).toBe('-f')
      expect(call.args[1]).toMatch(/worker-[0-9a-f-]{36}\.sbpl$/)
      expect(call.args[2]).toBe('--')
      expect(call.args.slice(3)).toStrictEqual([...cmd, '--', 'TASK: 内层沙箱透传探针'])
      // 透传本体：内层 dsh 沙箱不 apply（外层 seatbelt 是唯一圈禁者）
      expect(call.opts.env.DSH_PERMISSION_MODE).toBe('danger-full-access')
      // 既有红线不受影响：遥测仍禁、白名单仍 deny-by-default（extendEnv:false）
      expect(call.opts.env.DSH_TELEMETRY_MODE).toBe('DISABLED')
      expect(call.opts.extendEnv).toBe(false)
    } finally {
      if (saved === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = saved
    }
  })

  it('resumeWithSession 同落法（同 spawnHeadless）：外层生效时同样注入', async () => {
    const call = await (async () => {
      const adapter = new DshAdapter(['dsh', '--json'], { seatbelt: { mode: 'auto' } })
      await adapter.resumeWithSession(makeBrief(), 'session-2d65719e-2aa4-416a-af42-4a612026e671')
      const c = captured.calls[0]
      if (c === undefined) throw new Error('假 execa 未截获 resumeWithSession 调用')
      return c
    })()
    expect(call.cmd).toBe(SEATBELT_BIN)
    expect(call.args).toContain('--session-id')
    expect(call.opts.env.DSH_PERMISSION_MODE).toBe('danger-full-access')
  })
})

describe('外层 seatbelt 未配置/未生效 → 不注入（不把无圈禁路径放开，保持 dsh 缺省 workspace-write）', () => {
  it('缺省（无 opts.seatbelt）：cmd 不被包装、env 无 DSH_PERMISSION_MODE', async () => {
    const saved = process.env.DSH_PERMISSION_MODE
    delete process.env.DSH_PERMISSION_MODE
    try {
      const call = await launchCaptured(new DshAdapter(['dsh', '--json']))
      expect(call.cmd).toBe('dsh') // 无 sandbox-exec 包装=外层未圈定
      expect(call.args[0]).toBe('--json')
      expect(Object.hasOwn(call.opts.env, 'DSH_PERMISSION_MODE')).toBe(false)
    } finally {
      if (saved === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = saved
    }
  })

  it("mode='off'（显式关闭）：同缺省——不包装不注入", async () => {
    const saved = process.env.DSH_PERMISSION_MODE
    delete process.env.DSH_PERMISSION_MODE
    try {
      const call = await launchCaptured(new DshAdapter(['dsh', '--json'], { seatbelt: { mode: 'off' } }))
      expect(call.cmd).toBe('dsh')
      expect(Object.hasOwn(call.opts.env, 'DSH_PERMISSION_MODE')).toBe(false)
    } finally {
      if (saved === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = saved
    }
  })
})
