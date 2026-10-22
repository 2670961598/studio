/**
 * dsh 适配器 judge 派发面 seatbelt 选项测试 —— studio-dev-160 §6.3（§8-S2 红队 2，
 * 制作人 2026-10-22 全批，单 164）：无工具只读沙箱 profile + 一次性工作区。
 *
 * 覆盖（launch 的 profile 侧产物——spawnHeadless 在 execa 前落 profile，产物面不依赖
 * 子进程结果，嵌套沙箱环境同样可断言；流/env 注入面归 dsh.test.ts 既有覆盖）：
 *   - writeRootsOverride：给定后 task.workspace/extraWriteRoots/dshHomeRedirect 全不
 *     并入——profile 写域**只含覆写根**（workspace 只读=judge 档），且 dshHomeRedirect
 *     仍产生 DSH_HOME 重定向目录（mkdir 面）；
 *   - profileDir：profile 落指定目录（工作区外——配合一次性工作区「调用毕目录空」
 *     断言面），缺省仍落 workspace/.seatbelt/（既有行为不变，对照面）；
 *   - 对照：无 writeRootsOverride 时写域含 workspace+dshHomeRedirect（既有语义）。
 */
import { mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { TaskBrief } from '@studio-next/contract'
import { DshAdapter } from '../src/dsh.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const workdir = mkdtempSync(join(tmpdir(), 'dsh-judge-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function makeBrief(workspace: string): TaskBrief {
  mkdirSync(workspace, { recursive: true })
  const briefPath = join(workspace, 'brief.md')
  writeFileSync(briefPath, '判断任务：从候选中选一个，只回 JSON', 'utf8')
  return {
    ticket: 'MJ-1',
    attempt: 1,
    briefPath,
    workspace,
    AGENTS_MD: { channel: 'native', target: join(workspace, 'AGENTS.md') },
  }
}

/** judge 档 seatbelt 选项（与 daemon engine/judge/invoke.ts dshJudgeAdapterFactory 同形） */
function judgeSeatbelt(dirs: { dshHome: string; profileDir: string }) {
  return {
    mode: 'auto' as const,
    dshHomeRedirect: dirs.dshHome,
    writeRootsOverride: [dirs.dshHome],
    profileDir: dirs.profileDir,
    rpcEndpoints: [],
  }
}

describe('judge 派发面 seatbelt 选项（§8-S2：无工具只读沙箱+一次性工作区）', () => {
  it('writeRootsOverride：写域只含覆写根——workspace 不入写域（只读档）；profile 落 profileDir（工作区外）', async () => {
    const callRoot = mkdtempSync(join(workdir, 'call-'))
    const workspace = join(callRoot, 'workspace')
    const dshHome = join(callRoot, 'dsh-home')
    const profileDir = join(callRoot, 'profile') // 工作区外（一次性树内旁位）
    const adapter = new DshAdapter([process.execPath, fakeCli], { seatbelt: judgeSeatbelt({ dshHome, profileDir }) })
    const handle = await adapter.launch(makeBrief(workspace))
    try {
      // profile 落指定目录且仅一份
      expect(existsSync(profileDir)).toBe(true)
      const profiles = readdirSync(profileDir).filter((f) => f.endsWith('.sbpl'))
      expect(profiles.length).toBe(1)
      const text = readFileSync(join(profileDir, profiles[0]!), 'utf8')
      // 写域断言：dshHome 在（subpath 形式进文）、workspace 不在（只读档）
      expect(text).toContain(dshHome)
      expect(text).not.toContain(workspace)
      // DSH_HOME 重定向目录已建（dsh boot 必写面归写域内）
      expect(existsSync(dshHome)).toBe(true)
      // 工作区无 .seatbelt（profileDir 已移出——缺省会落这里，见对照面）
      expect(existsSync(join(workspace, '.seatbelt'))).toBe(false)
    } finally {
      await adapter.kill(handle, 100).catch(() => undefined)
      rmSync(callRoot, { recursive: true, force: true })
    }
  })

  it('对照·缺省写域：无 override 时 workspace+dshHomeRedirect 都进写域，profile 落 workspace/.seatbelt（既有行为不变）', async () => {
    const workspace = mkdtempSync(join(workdir, 'ws-default-'))
    const dshHome = join(workspace, '.dsh-home')
    const adapter = new DshAdapter([process.execPath, fakeCli], {
      seatbelt: { mode: 'auto', dshHomeRedirect: dshHome },
    })
    const handle = await adapter.launch(makeBrief(workspace))
    try {
      const seatbeltDir = join(workspace, '.seatbelt')
      expect(existsSync(seatbeltDir)).toBe(true)
      const profiles = readdirSync(seatbeltDir).filter((f) => f.endsWith('.sbpl'))
      expect(profiles.length).toBe(1)
      const text = readFileSync(join(seatbeltDir, profiles[0]!), 'utf8')
      expect(text).toContain(workspace)
      expect(text).toContain(dshHome)
    } finally {
      await adapter.kill(handle, 100).catch(() => undefined)
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
