/**
 * dsh 适配器 AGENTS.md 通道 env 注入测试 —— 独立测试套件（docs/18-§1.3）
 *
 * v1.5 三件套之一（docs/25-§3.1 v1.5#1 裁决；docs/31-A1/§5-5）：user_level /
 * append_system_prompt 两通道注 STUDIO_NEXT_INSTRUCTIONS=<target>（由 packages/
 * dsh-bridge studio-next-bridge 插件消费——插件面测试归 dsh-bridge 包，本套只断言
 * env 注入）；native → 不注入（真机原生发现：launch cwd 向上扫 AGENTS.md，P-07 实证）。
 *
 * F-1 环境串扰回归钉（studio-dev-186；规格源 studio-dev-128 审计 §5/§8-横切2）：
 * worker 会话 env 自带 STUDIO_NEXT_INSTRUCTIONS 时，「adapter 未注入」不得被宿主串扰
 * 等价成「变量已存在」——旧基线 spawnHeadless 裸传 {...process.env} 即此缺陷（att3 基线
 * c21bb1e 实证 1 failed；env -u 后绿，因果闭合）。现行 env 基座=filterWorkerEnv 白名单
 * （DEV-33b，docs/43-附录A-1 deny-by-default，该键不在收录集）→ native 时键整体缺席，
 * 即审计方案 B「adapter 是该变量的唯一写入者」的强化形；本套以 withFakeEnv 主动污染
 * 宿主 env 把免疫钉成套件内确定性事实（门禁/会话环境跑恒定，白名单回退收录该键即红）。
 *
 * 自 dsh.test.ts 拆出（BC-S2 先拆再增——分层宪法 20-§十五.三.3，studio-dev-186）；
 * 白名单本体的负断言见 dsh-env-whitelist.test.ts。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { StreamEvent, TaskBrief } from '@studio-next/contract'
import { DshAdapter } from '../src/dsh.ts'

/** 每用例独立的临时工作区根（launch 的 cwd 必须真实存在） */
const workdir = mkdtempSync(join(tmpdir(), 'dsh-agents-md-channel-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

/** 任务书全文（launch 的任务串来源——argv 注入断言用；单行、无换行，便于整行回显断言） */
const BRIEF_TEXT = 'TASK: 回声任务——按任务书全文回 PROBE-OK'

interface BriefOverrides {
  AGENTS_MD?: TaskBrief['AGENTS_MD']
  briefPath?: string
}

function makeBrief(o: BriefOverrides = {}): TaskBrief {
  const briefPath = o.briefPath ?? join(workdir, 'brief.md')
  // P0 起 launch 读任务书全文作任务串——缺省任务书由测试侧落盘（真实装配管线的等价物）
  if (o.briefPath === undefined) writeFileSync(briefPath, BRIEF_TEXT)
  return {
    ticket: 'TEST-1',
    attempt: 1,
    briefPath,
    workspace: workdir,
    AGENTS_MD: o.AGENTS_MD ?? { channel: 'native', target: join(workdir, 'AGENTS.md') },
  }
}

/**
 * 临时注入 env 旋钮到 process.env（适配器 spawn 时展开），结束还原。
 * FAKE_* 键自动迁入 DSH 命名空间（FAKE_X → DSH_FAKE_X）：dsh 适配器 spawn env 已收封闭
 * 允许集（docs/43-附录A-1），宿主 FAKE_* 到不了 dsh 位子进程——fake CLI 在入口把
 * DSH_FAKE_* 折算回 FAKE_*（见 fake-cli.mjs 头注）。非 FAKE_ 键（含本套的通道变量污染）
 * 原样注入——正是 F-1 钉所需：模拟 worker 会话宿主 env。
 */
async function withFakeEnv(kvs: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const injected: Record<string, string> = {}
  for (const [k, v] of Object.entries(kvs)) {
    injected[k.startsWith('FAKE_') ? `DSH_${k}` : k] = v
  }
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(injected)) {
    saved.set(k, process.env[k])
    process.env[k] = v
  }
  try {
    await fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('AGENTS.md 通道 env 注入（v1.5 三件套之一：插件通道——STUDIO_NEXT_INSTRUCTIONS 由 packages/dsh-bridge studio-next-bridge 消费；docs/31-A1/§5-5 裁决 docs/25-§3.1 v1.5#1）', () => {
  // cmd 注入 node -e 回显目标 env：值经 stdout 以 log 事件回流断言
  const echoAdapter = (varName: string): DshAdapter =>
    new DshAdapter([
      process.execPath,
      '-e',
      `process.stdout.write(process.env.${varName} ?? '<unset>')`,
    ])

  it('user_level 通道 → STUDIO_NEXT_INSTRUCTIONS=target 透传', async () => {
    const target = join(workdir, 'agents-user-level.md')
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('append_system_prompt 通道 → STUDIO_NEXT_INSTRUCTIONS=target 透传（dsh 无 append 专道，两通道汇一）', async () => {
    const target = join(workdir, 'agents-append.md')
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'append_system_prompt', target } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    expect(collected).toStrictEqual([{ type: 'log', text: target }])
  })

  it('native 通道 → 不注入通道变量（真机原生发现：launch cwd 向上扫 AGENTS.md，P-07 实证）', async () => {
    const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
    const h = await adapter.launch(
      makeBrief({ AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') } }),
    )
    const collected: StreamEvent[] = []
    for await (const ev of adapter.stream(h)) collected.push(ev)
    // 无换行残行回流为 log：'<unset>' 证明未注入
    expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
  })

  // F-1 负向钉：宿主已设通道变量 + native → 键整体缺席（白名单回退收录该键即红——
  // 防「DEV-33b 修好又漂走」；同污染下正向钉证注入值胜出，唯一写入者两方向闭环）
  it('宿主 env 串扰免疫（F-1 钉·负向）：宿主已设 STUDIO_NEXT_INSTRUCTIONS + native 通道 → 仍 <unset>（唯一写入者语义）', async () => {
    await withFakeEnv(
      { STUDIO_NEXT_INSTRUCTIONS: 'host-session-pollution-should-not-leak' },
      async () => {
        const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
        const h = await adapter.launch(
          makeBrief({ AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') } }),
        )
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
      },
    )
  })

  it('宿主 env 串扰免疫（F-1 钉·正向）：宿主已设 STUDIO_NEXT_INSTRUCTIONS + user_level 通道 → 注入值胜出（唯一写入者两方向闭环）', async () => {
    const target = join(workdir, 'agents-user-level.md')
    await withFakeEnv(
      { STUDIO_NEXT_INSTRUCTIONS: 'host-session-pollution-should-not-leak' },
      async () => {
        const adapter = echoAdapter('STUDIO_NEXT_INSTRUCTIONS')
        const h = await adapter.launch(makeBrief({ AGENTS_MD: { channel: 'user_level', target } }))
        const collected: StreamEvent[] = []
        for await (const ev of adapter.stream(h)) collected.push(ev)
        expect(collected).toStrictEqual([{ type: 'log', text: target }])
      },
    )
  })

  it('证伪变量已移除：DSH_AGENTS_MD / DSH_APPEND_SYSTEM_PROMPT_FILE 全通道零注入', async () => {
    for (const channel of ['user_level', 'append_system_prompt'] as const) {
      const adapter = echoAdapter('DSH_AGENTS_MD')
      const h = await adapter.launch(
        makeBrief({ AGENTS_MD: { channel, target: join(workdir, 'agents-x.md') } }),
      )
      const collected: StreamEvent[] = []
      for await (const ev of adapter.stream(h)) collected.push(ev)
      expect(collected).toStrictEqual([{ type: 'log', text: '<unset>' }])
    }
  })
})
