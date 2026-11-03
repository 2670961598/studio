/**
 * dsh/helpers —— dsh 适配器纯辅助（credentials 闸/AGENTS.md env 映射/任务串读取/usage 归并/错误归一）
 *
 * 依据（实现单引用）：docs/25-§二（credentials 短命按单凭据）、docs/25-§3.1 v1.5#1（AGENTS.md
 *   插件通道）、docs/31-§3.2（usage 只认 step_end，四桶真值直录）、docs/31-A1（旧变量已证伪）；
 *   docs/17-§6（tokens 有/成本无价目表折算——本件不改判据）；docs/20-§十五.三（dsh.ts 拆件，
 *   原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只放纯函数（无 spawn/无状态）；launch/stream/kill 生命周期仍在 dsh.ts。
 */
import { readFile } from 'node:fs/promises'
import type { StreamEvent, TaskBrief, TokenCounts } from '@studio-next/contract'
import { assertCredentialKeys } from './basics.ts'

export function checkedCredentials(creds: TaskBrief['credentials']): Record<string, string> {
  if (creds === undefined) return {}
  assertCredentialKeys(creds)
  return { ...creds }
}

/**
 * AGENTS.md 通道 env 映射——插件通道（2026-10-19 三件套之一落地，docs/25-§3.1 v1.5 裁决#1）：
 * user_level / append_system_prompt 两通道改注 `STUDIO_NEXT_INSTRUCTIONS=<target>`，由
 * studio-next-bridge 宿主插件（packages/dsh-bridge）在 agent 创建时读文件注入系统提示
 * persona 前缀段（docs/31-§5-5 真方案：真机无任何 DSH_* 注入 env——旧变量
 * DSH_AGENTS_MD / DSH_APPEND_SYSTEM_PROMPT_FILE 全配置面零命中，已证伪移除 docs/31-A1）。
 * 前提：插件已挂载（per-company profile patch insert 条目或 --patch overlay）——未挂载时
 * 该 env 无消费者（无害空注，注入不发生）。dsh 侧两通道在此汇成一个注入面（无 append 专道）。
 * native → 不注入（与真机原生发现吻合：launch cwd 向上扫 AGENTS.md>CLAUDE.md，P-07 实证）。
 * target 落点由 L5 装配决定、适配器只透传（docs/25-§二 TaskBrief 注释；docs/04-§六）。
 */
export function agentsMdEnv(a: TaskBrief['AGENTS_MD']): Record<string, string> {
  switch (a.channel) {
    case 'native':
      return {}
    case 'user_level':
    case 'append_system_prompt':
      return { STUDIO_NEXT_INSTRUCTIONS: a.target }
  }
}

/**
 * 任务串读取：briefPath 全文即任务文本（字节如实，不裁不拼——dsh headless 单位置参数）。
 * 不可读 → 抛错（装配管线缺件，launch 前置失败如实上报，不静默传空）。
 */
export async function readTaskText(briefPath: string): Promise<string> {
  try {
    return await readFile(briefPath, 'utf8')
  } catch (e) {
    throw new Error(`dsh: 任务书不可读（briefPath=${briefPath}）：${errMsg(e)}`)
  }
}

/**
 * usage 账目归并：只认 step_end usage 求和（docs/31-§3.2：真机 turn_end 恒无 usage，
 * 旧 turn_end 兜底分支已删）；四桶直译（132-§6.1 单A）——cache_read/cache_creation
 * 各自求和，**任一 step_end 携带该桶才落键**（真值直录，不编造 0 桶；判负线⑤：真机流
 * 含 cacheWriteTokens 时 cache_creation 不得归零/丢失）。无任何 step usage → 零账
 * （kill 面/预运行失败面，不编造）。写侧一律新键——本函数与 toUsageDsh 均不产 `cached`。
 */
export function aggregateUsage(events: readonly StreamEvent[]): TokenCounts {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheCreation = 0
  let seen = false
  let seenRead = false
  let seenCreation = false
  for (const e of events) {
    if (e.type === 'step_end' && e.usage !== undefined) {
      seen = true
      input += e.usage.input
      output += e.usage.output
      if (e.usage.cache_read !== undefined) {
        seenRead = true
        cacheRead += e.usage.cache_read
      }
      if (e.usage.cache_creation !== undefined) {
        seenCreation = true
        cacheCreation += e.usage.cache_creation
      }
    }
  }
  if (!seen) return { input: 0, output: 0 }
  return {
    input,
    output,
    ...(seenRead ? { cache_read: cacheRead } : {}),
    ...(seenCreation ? { cache_creation: cacheCreation } : {}),
  }
}

/** ENOENT 判定（未安装）：execa reject:false 下 spawn 失败挂在 result.cause（实测 9.6.1→10.1 同形） */
export function isENOENT(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | undefined)?.code
  return code === 'ENOENT' || asError(cause).message.includes('ENOENT')
}

export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

export function errMsg(e: unknown): string {
  const msg = asError(e).message
  return msg === '' ? String(e) : msg
}
