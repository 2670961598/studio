/**
 * studio-next-bridge —— dsh 宿主插件：Studio Next 指令注入桥（AGENTS.md 注入通道插件化）
 *
 * 制作人 2026-10-19 批准的 dsh 三件套之一（docs/25-§3.1 v1.5 裁决#1）：
 * 「AGENTS.md 注入走 dsh 插件」——本包即该插件的可分发件（dsh.bundle 声明见
 * package.json + cordis.patch.yml）。
 *
 * 通道事实（真机依据）：
 *   - dsh 无「注入指令文件」的 env 通道：DSH_AGENTS_MD / DSH_APPEND_SYSTEM_PROMPT_FILE 在
 *     全配置面零命中（docs/31-A1 证伪）；真实扩展面是 systemPrompt 服务（docs/31-§3.6 /
 *     docs/34-§3.2「提示词」行）：personaPrefix/personaSuffix 配置位 + 程序化 section 注册
 *     （装机源码 dsh-system-prompt：section({name, order, text})，order 取
 *     getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')——与 dsh-persona 插件同款用法）。
 *   - agent 生命周期钩子 agent/created（docs/34-§3.2「Agent 生命周期」行，B1 真机实证）：
 *     载荷 {agent, source}，agent.ctx 是该 agent 的 scoped 上下文——「per-agent 注册走
 *     agent.ctx」（dsh-system-prompt 源码注释原文）。
 *
 * 注入语义：本插件在 agent 创建时读 env `STUDIO_NEXT_INSTRUCTIONS` 指向的文件全文，
 * 以系统提示 persona 前缀段（order=DEPLOYMENT_PERSONA_PREFIX、name 唯一——不与
 * dsh-system-prompt 自有 persona 段撞名）注册进该 agent 的 scoped 层。等价于「AGENTS.md
 * 挂上系统提示」，且对进程内每个 agent（含 subagent）各注入一次，覆盖面与原生发现通道
 * （launch cwd 向上扫 AGENTS.md>CLAUDE.md，P-07 实证）同构；两通道可并存不冲突。
 * env 注入方=daemon（dsh 适配器 agentsMdEnv：user_level/append 通道 → STUDIO_NEXT_
 * INSTRUCTIONS=target，docs/25-§3.1 v1.5#1）；本插件只消费不生产。
 *
 * 装载（docs/34-§3.1 两路径）：
 *   - bundle：dsh plugin --profile <p> add <本包路径>（dsh.bundle.patch 声明）
 *   - overlay：dsh --profile <p> --patch <包根>/cordis.patch.yml（运行时，冒烟用）
 *
 * 零依赖纪律：仅 node 内置；不导出 cordis Config schema（loader 对无 schema 插件直通
 * raw config——B2 探针实证 docs/34-§3.1）。可擦除 TS：dsh 宿主经 Node ≥23.6 原生
 * type-stripping 直接加载本文件（真机实证：feature/dsh-triple 冒烟，2026-10-19）。
 * 诊断输出走 stderr（stdout 是 headless --json 的 NDJSON 通道，不可污染——B1 同款纪律）。
 */
import { readFile } from 'node:fs/promises'

/** cordis 插件名（装载条目 id 同名） */
export const name = 'studio-next-bridge'

/** 依赖服务：systemPrompt（dsh-system-prompt 暴露的提示词注册表——loader 先备齐再 apply） */
export const inject = ['systemPrompt']

/** 指令文件路径的 env 变量名（daemon 侧 agentsMdEnv 注入；可经 config 覆盖） */
export const DEFAULT_INSTRUCTIONS_ENV = 'STUDIO_NEXT_INSTRUCTIONS'

/** 注入段的注册名（唯一——避开 dsh-system-prompt 自有 persona 段名，撞名=注册失败响亮报错） */
export const SECTION_NAME = 'studio-next:instructions'

/** 注入段的官方放置位（与 dsh-persona 同位：persona 前缀） */
export const SECTION_PLACEMENT = 'DEPLOYMENT_PERSONA_PREFIX'

// ---------------------------------------------------------------------------
// 结构化最小宿主面（cordis/dsh 服务面的本包本地投影——零依赖纪律：不 import 外部包）
// ---------------------------------------------------------------------------

/** 插件 config（cordis raw config 直通——见文件头注） */
export interface BridgeConfig {
  /** 指令文件路径的 env 变量名（默认 STUDIO_NEXT_INSTRUCTIONS） */
  instructionsEnv?: string
  /** 注入段注册名（默认 studio-next:instructions） */
  sectionName?: string
  /** 注入失败（env 未设/文件不可读/空文件）时：true=抛错拦截 agent 创建；默认 false=stderr 警告降级 */
  required?: boolean
}

/** dsh systemPrompt 服务的 section 面（装机源码 dsh-system-prompt/lib/index.js 同形） */
export interface SystemPromptLike {
  section(spec: { name: string; order: number; text: string }): unknown
  /** 官方放置位名 → 数值排序位（DEPLOYMENT_PERSONA_PREFIX 等） */
  getSectionOrder(placement: string): number
}

/** agent/created 载荷里的 agent 面（ReactLoopAgent 的本包投影：id + scoped ctx） */
export interface AgentLike {
  readonly id?: string
  readonly ctx?: AgentContextLike
}

/** agent scoped 上下文（systemPrompt 代理 + effect 生命周期登记） */
export interface AgentContextLike {
  readonly systemPrompt?: SystemPromptLike
  effect(fn: () => unknown, label?: string): unknown
}

/** 插件 ctx 的最小面（本插件只用一个事件钩子） */
export interface PluginContextLike {
  on(event: 'agent/created', listener: (payload: { agent?: AgentLike }) => void | Promise<void>): unknown
}

// ---------------------------------------------------------------------------
// 纯逻辑（单测面）：config 归一 + 指令解析
// ---------------------------------------------------------------------------

/** 指令解析结果（四态：unset / unreadable / empty / injected） */
export interface ResolvedInstructions {
  readonly status: 'unset' | 'unreadable' | 'empty' | 'injected'
  /** 注入文本（仅 status=injected） */
  readonly text?: string
  /** env 指到的文件路径（除 unset 外都有——诊断/证据用） */
  readonly source?: string
  /** 失败原因（unreadable 时） */
  readonly detail?: string
}

/** cordis raw config（unknown）→ BridgeConfig：非字符串/空串字段一概丢弃回缺省 */
export function resolveBridgeConfig(raw: unknown): BridgeConfig {
  if (raw === null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const instructionsEnv = nonEmptyString(r['instructionsEnv'])
  const sectionName = nonEmptyString(r['sectionName'])
  const required = r['required'] === true
  return {
    ...(instructionsEnv !== undefined ? { instructionsEnv } : {}),
    ...(sectionName !== undefined ? { sectionName } : {}),
    ...(required ? { required } : {}),
  }
}

/**
 * 指令解析：env（点名变量）→ 文件路径 → 全文。env 与读文件均注入以便纯逻辑单测；
 * apply() 传 process.env 与 node:fs/promises 缺省实现。
 *   - 变量未设/值为空白 → unset（未注入=未配置，非故障）
 *   - 文件读失败 → unreadable（带原因）
 *   - 文件全空白 → empty（注入空串无意义，明示）
 *   - 其余 → injected（text=文件全文，字节如实不裁不拼）
 */
export async function readInstructions(
  env: Record<string, string | undefined>,
  config: BridgeConfig,
  readTextFile: (path: string) => Promise<string> = (p) => readFile(p, 'utf8'),
): Promise<ResolvedInstructions> {
  const varName = config.instructionsEnv ?? DEFAULT_INSTRUCTIONS_ENV
  const path = env[varName]
  if (path === undefined || path.trim() === '') return { status: 'unset' }
  let text: string
  try {
    text = await readTextFile(path)
  } catch (e) {
    return { status: 'unreadable', source: path, detail: errMsg(e) }
  }
  if (text.trim() === '') return { status: 'empty', source: path }
  return { status: 'injected', text, source: path }
}

// ---------------------------------------------------------------------------
// 插件入口（cordis 装载面：name/inject/apply）
// ---------------------------------------------------------------------------

/**
 * 插件 apply：注册 agent/created 监听；每个 agent 创建时读指令文件并注入 persona 前缀段。
 * agent/created 是 serial 事件（dsh-agent 源码：await serial）——首步提示词组装前必然完成。
 * 返回 ctx.on 的销毁器（cordis 装载约定）。
 */
export function apply(ctx: PluginContextLike, config?: unknown): unknown {
  const cfg = resolveBridgeConfig(config)
  return ctx.on('agent/created', async ({ agent }) => {
    const target = agent?.ctx
    const systemPrompt = target?.systemPrompt
    if (target === undefined || systemPrompt === undefined) {
      // 宿主形态不符（缺 systemPrompt 服务/agent 无 scoped ctx）——如实明报，不静默吞
      fail(cfg, `agent 上下文缺 systemPrompt 服务（agent=${agent?.id ?? '?'}），注入跳过`)
      return
    }
    const resolved = await readInstructions(process.env, cfg)
    if (resolved.status !== 'injected') {
      fail(
        cfg,
        `指令未注入（status=${resolved.status}${resolved.source !== undefined ? ` source=${resolved.source}` : ''}${resolved.detail !== undefined ? ` detail=${resolved.detail}` : ''}）`,
      )
      return
    }
    const sectionName = cfg.sectionName ?? SECTION_NAME
    const text = resolved.text ?? ''
    target.effect(
      () =>
        systemPrompt.section({
          name: sectionName,
          order: systemPrompt.getSectionOrder(SECTION_PLACEMENT),
          text,
        }),
      'studio-next-bridge.section()',
    )
    note(
      `injected ${String(text.length)} chars from ${resolved.source ?? '?'} as section "${sectionName}" (agent=${agent?.id ?? '?'})`,
    )
  })
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 诊断输出走 stderr（stdout 是 headless --json 的 NDJSON 通道——不可污染，B1 同款纪律） */
function note(message: string): void {
  process.stderr.write(`[studio-next-bridge] ${message}\n`)
}

/** 失败面：required=true 抛错拦截 agent 创建（serial 监听器的 reject 会上抛响亮报错）；否则降级警告 */
function fail(cfg: BridgeConfig, message: string): void {
  if (cfg.required === true) {
    throw new Error(`studio-next-bridge: ${message}——required=true，agent 创建被拦截`)
  }
  note(`WARN ${message}（required 默认 false，降级继续）`)
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
