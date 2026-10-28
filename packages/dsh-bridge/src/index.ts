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
 * ── 路径消费二选一声明（IMPL-06-11；v2/13-§1.6-5；v2/16-§三 dsh-bridge 行）────────
 * 选择 **①数据面**：本包把插件入口的包内相对路径写进自己的 `package.json#dsh.entry`
 * （值 `src/index.ts`，与 `main`/`exports["."]` 同指一处），消费方（daemon）**只读该
 * 文件**、按包根解析后把路径交给 dsh 装载器——**不 import 本包任何模块**，因此
 * **不新增 `["daemon","dsh-bridge"]` 包边**，冻结的「仓内零模块入边」不破（层位表
 * scripts/guards/boundary-rules.mjs 的 dsh-bridge 行注释；v2/13-§3.3「仓内零模块入边」；
 * allowedPackageEdges 无本包任何边）。
 *
 * 选择①的理由：
 *   1. 加边＝判据类资产修订（v2/13-§3.5 新包四边登记：层位/出入边/manifest 一致/双绿；
 *      机械源修订纪律 v2/13-§3.1；plan/02-§七-3），须提案流＋制作人批（20-§九/§十五）
 *      ——不在本单权限内。
 *   2. 现状 daemon 以 4 级相对路径推导（apps/daemon/src/engine/instructions-store.ts:72
 *      `BRIDGE_SRC_REL`）＝「布局即接口」：包内移动或仓外部署即漂移（§1.6-5 判负项）。
 *      数据面把「入口在哪」收回包自己的清单——声明与被声明物同处一地、零推断。
 *   3. 与 dist 切换同向：§1.6-1 首条可证链以本包为起点；切 dist 时 `entry` 与
 *      `exports["."]` 同步改指 dist 产物，消费方零改动。
 *   4. `dsh` 段本就是 dsh 宿主清单命名空间（既有 `dsh.bundle.patch` 在此）；宿主只读
 *      `dsh.bundle`/`dsh.profile`、不校验未知键（装机源码 dsh-plugin-manager 0.2.0-rc.2
 *      唯一读点 `manifest.dsh?.bundle?.patch`）——`entry` 是同段新键，不改宿主语义。
 *
 * 失败面（对齐 v2/11-§0.4-6 通道）：缺 `dsh` 段/缺 `entry`＝`bridge/entry-missing`；
 * 顶层或段/键坏形（非对象/非字符串/空白/绝对路径/盘符/`..`/`.` 段/空段/反斜杠）＝
 * `bridge/entry-invalid`；两者 `category=rejected_precondition`，并答满「副作用可能/
 * 可否重试/对账入口/责任位置」四问。**明确拒绝，不静默回退**到 exports 或旧路径推断
 * （回退＝把配置错误伪装成成功，I 族同精神）。
 *
 * 已被否决：②提案加边 `["daemon","dsh-bridge"]`（v2/13-§3.5 四边登记＝manifest＋
 * 方向表＋层位/基线＋双绿）——本单不触发、不登记；若后续改选②，按提案流登记后实施。
 * 消费侧切换（daemon 的 `BRIDGE_SRC_REL` → 读本包 `package.json#dsh.entry`）领土属
 * daemon 面，**不在本单**：本单只交付声明＋解析口径（`resolveBridgeEntry`）＋自检测试，
 * 不以「已声明」冒充「已切换」。
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
// 路径消费（数据面①）：package.json#dsh.entry 的解析口径（纯函数，零 IO）
// ---------------------------------------------------------------------------

/** dsh 宿主清单段名（`package.json#dsh`；既有的 `dsh.bundle.patch` 亦在此段） */
export const DSH_MANIFEST_FIELD = 'dsh'

/** 段内入口键（数据面声明位；值＝插件入口的包内相对路径） */
export const DSH_ENTRY_FIELD = 'entry'

/**
 * 入口解析失败面（v2/11-§0.4-6 四问齐备；分类只镜像、不新增）。
 * 零依赖纪律下就地镜像 ENU-58 的单个取值，不 import contract（本包零包边）。
 */
export interface BridgeEntryFailure {
  /** 失败分类（值集唯一主表 v2/09 ENU-58；本件只镜像 `rejected_precondition` 一枚） */
  readonly category: 'rejected_precondition'
  /** 稳定子因码（缺声明位 vs 声明坏形——诊断与对账必须可区分，不合并成一句「无效」） */
  readonly code: 'bridge/entry-missing' | 'bridge/entry-invalid'
  /** 人读说明（含观测值摘要；不打印整份清单） */
  readonly detail: string
  /** 副作用可能：纯解析零副作用（消费方据此不重放、不补偿） */
  readonly sideEffects: 'none'
  /** 可否重试：补正清单后重跑即可（非瞬时故障，无自动重试） */
  readonly retriable: 'after-fix'
  /** 对账入口：去本包 `package.json` 的 `dsh.entry` 与 `main`/`exports["."]` 核对 */
  readonly reconcile: string
  /** 责任位置：声明方＝本包清单；消费方只读不推断 */
  readonly responsibility: string
}

/** 解析结果二分：成功只携包内相对路径，失败只携失败面——无「回退值」第三态 */
export type BridgeEntryResolution =
  | { readonly ok: true; readonly entryRel: string }
  | { readonly ok: false; readonly failure: BridgeEntryFailure }

/**
 * 解析 `package.json#dsh.entry`（纯函数，零 IO；manifest＝JSON.parse 后的对象，读文件归
 * 消费方——数据面只读不 import）。成功返回**归一后的包内相对路径**：去 `./` 前缀、分隔
 * 符保持声明形态（POSIX 正斜杠）；消费方以 `path.resolve(<包根>, entryRel)` 取绝对路径
 * 并自行核对存在性/可读性。失败＝**明确拒绝**（不静默回退）：
 *   - 缺 `dsh` 段 / 缺 `entry` → `bridge/entry-missing`
 *   - 顶层非对象 / `dsh` 非对象 / `entry` 非字符串 / 空白 / 绝对路径 / 盘符 / `..`、
 *     `.`、空段 / 反斜杠 / NUL → `bridge/entry-invalid`
 */
export function resolveBridgeEntry(manifest: unknown): BridgeEntryResolution {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return refuse('bridge/entry-invalid', `package.json 顶层不是对象（观测 ${observed(manifest)}）`)
  }
  const dsh = (manifest as Record<string, unknown>)[DSH_MANIFEST_FIELD]
  if (dsh === undefined) {
    return refuse(
      'bridge/entry-missing',
      `缺 package.json#${DSH_MANIFEST_FIELD} 段（数据面声明位不存在）`,
    )
  }
  if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) {
    return refuse(
      'bridge/entry-invalid',
      `${DSH_MANIFEST_FIELD} 段不是对象（观测 ${observed(dsh)}）`,
    )
  }
  const raw = (dsh as Record<string, unknown>)[DSH_ENTRY_FIELD]
  if (raw === undefined) {
    return refuse(
      'bridge/entry-missing',
      `缺 package.json#${DSH_MANIFEST_FIELD}.${DSH_ENTRY_FIELD}（入口声明位不存在）`,
    )
  }
  if (typeof raw !== 'string') {
    return refuse(
      'bridge/entry-invalid',
      `${DSH_MANIFEST_FIELD}.${DSH_ENTRY_FIELD} 不是字符串（观测 ${observed(raw)}）`,
    )
  }
  const entryRel = normalizeEntryPath(raw)
  if (entryRel === undefined) {
    return refuse(
      'bridge/entry-invalid',
      `${DSH_MANIFEST_FIELD}.${DSH_ENTRY_FIELD} 坏形（观测 ${JSON.stringify(raw)}；只收包内 POSIX 相对路径）`,
    )
  }
  return { ok: true, entryRel }
}

/** 拒绝面构造（两类失败只有 code/detail 不同——四问在此写一次，杜绝各写各的） */
function refuse(code: BridgeEntryFailure['code'], detail: string): BridgeEntryResolution {
  return {
    ok: false,
    failure: {
      category: 'rejected_precondition',
      code,
      detail,
      sideEffects: 'none',
      retriable: 'after-fix',
      reconcile: `去本包 package.json 的 ${DSH_MANIFEST_FIELD}.${DSH_ENTRY_FIELD}（与 main/exports["."] 同指一处）核对后重跑消费方`,
      responsibility: 'dsh-bridge 包清单（声明方）；消费方只读不推断',
    },
  }
}

/**
 * 入口路径归一与静态形态校验（不触盘）：只收包内 POSIX 相对路径——去单个 `./` 前缀
 * （仓内 `main` 用裸路径、`exports`/`dsh.bundle.patch` 用 `./` 前缀，两种写法同解）。
 * 返回 undefined＝坏形，由调用方转 `bridge/entry-invalid`。
 */
function normalizeEntryPath(raw: string): string | undefined {
  if (raw.trim() === '' || raw.includes('\0') || raw.includes('\\')) return undefined
  const trimmed = raw.startsWith('./') ? raw.slice(2) : raw
  if (trimmed === '' || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return undefined
  const segments = trimmed.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return undefined
  return trimmed
}

/** 观测值摘要（诊断用；不 dump 大对象、不回显整份清单） */
function observed(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array(${String(v.length)})`
  return typeof v
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
