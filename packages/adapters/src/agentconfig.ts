/**
 * agent.yaml 装载与注册表接线 —— executor 注册的配置面（docs/17-§4，docs/18-§1.2）
 *
 * 依据：
 *   - docs/17-§4：框架 config home 的 agent.yaml 是「executor 注册与人事档案」：
 *     `executors:` 段按名登记 default/version/cmd/capabilities/patches/plugins。
 *   - docs/16-§二：YAML 解析用 yaml@2（带行号 AST——错误定位「文件:行」依赖它，
 *     本文件 parse 失败时把行号带进 CONFIG_INVALID detail）。
 *   - docs/17-§2：调度零 `if executor`——配置装载只产出数据（注册表 + 能力声明），
 *     不产出分支。
 *   - docs/17-§9 / contract errors.ts：配置错误统一走 CONFIG_INVALID 两级分类。
 *
 * 口径（本文件自拟、随实现冻结；与 docs 示例的出入只记录不擅改，见头注末段）：
 *   - 能力声明**以适配器代码为准**（四家文件头注「能力声明即契约」）：agent.yaml 的
 *     capabilities 是镜像，wireRegistry 逐字段比对，配置与代码不一致 →
 *     CONFIG_INVALID/agentconfig/cap-drift 明报（拒绝用配置伪造能力）。
 *     「配置可覆盖能力」的替代语义未获文档授权——拟稿待批点，见汇报。
 *   - cmd 是配置的**覆盖注入**位：config 有 cmd 则注入适配器工厂（测试假 CLI / 本机
 *     路径改道），无 cmd 用适配器缺省命令（17-§6 各家 launch 命令）。
 *   - version / patches / plugins 属「人事档案」字段：解析进记录但注册表不消费——
 *     version 的运行时核实归 detect()（18-§一 launch 前必跑），patches/plugins 归
 *     L5 工具层（17-§5 executor 能力声明+插件 manifest）。patches 值形状文档未定义
 *     （17-§4 示例原样省略号），按 unknown 透传不解释。
 *   - capabilities 各键**可部分提供**（只比对提供的字段）；agents_md 词汇=contract
 *     冻结枚举（native/user_level/append_system_prompt）。
 *   - 缺 executors 段 / 空段 / yaml 语法错 / 形状错 → CONFIG_INVALID 明报（subcause
 *     分别 missing-section / no-executors / parse / shape）。
 *   - 注册序=agent.yaml 书写序（yaml@2 保序）——pick 无 default 存活时的确定性回退序。
 *   - 未知 executor 名（配置有而代码无）→ CONFIG_INVALID/agentconfig/unknown-executor：
 *     先写适配器再登记（18-§1.2），不存在「配置声明式注册」的旁路。
 *
 * 文档疑点（只记录，不改文档）：
 *   - docs/17-§4 示例里 dsh 的 `session_resume: true` 与 dsh 适配器声明（false，v0
 *     不支持续跑）不一致；示例词汇 `agents_md: "dsh_home"` 不在 contract 冻结枚举内。
 *     本文件按 contract 词汇校验——按文档示例字面书写的 agent.yaml 会 CONFIG_INVALID，
 *     孰为准待批示（呈批前以 contract 为标尺，AGENTS.md §四「契约不随便动」）。
 */
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'
import type { ExecutorAdapter, ExecutorCapabilities, ExecutorFamily } from '@studio-next/contract'
import { ClaudeAdapter } from './claude.ts'
import { CodexAdapter } from './codex.ts'
import { DshAdapter } from './dsh.ts'
import { KimiAdapter } from './kimi.ts'
import type { ExecutorRegistry } from './registry.ts'

// ---------------------------------------------------------------------------
// zod schema（17-§4 agent.yaml 口径；capabilities 词汇=contract 冻结枚举）
// ---------------------------------------------------------------------------

const agentsMdChannelSchema = z.enum(['native', 'user_level', 'append_system_prompt'])

/** executor 条目：全部键可选（`dsh: {}` = 用适配器缺省命令与声明，合法） */
const executorEntrySchema = z.strictObject({
  default: z.boolean().optional(),
  version: z.string().min(1).optional(),
  cmd: z.array(z.string().min(1)).min(1).optional(),
  /** 能力镜像：部分提供即可，逐字段与适配器声明比对（漂移明报，见文件头注） */
  capabilities: z
    .strictObject({
      budget_cap: z.boolean().optional(),
      cancel_turn: z.boolean().optional(),
      session_resume: z.boolean().optional(),
      agents_md: agentsMdChannelSchema.optional(),
      cost_native: z.boolean().optional(),
    })
    .optional(),
  /** patches 值形状文档未定义（17-§4 示例省略号）——透传不解释（拟稿） */
  patches: z.record(z.string().min(1), z.unknown()).optional(),
  plugins: z.array(z.string().min(1)).optional(),
})

/** agent.yaml 根：只认 executors: 段（models/gateway/ports/companies 是独立文件，17-§4） */
const agentConfigSchema = z.strictObject({
  executors: z.record(z.string().min(1), executorEntrySchema),
})

// ---------------------------------------------------------------------------
// 装载产物类型（ExecutorRegistration 的消费面投影，docs/25-§3.1）
// ---------------------------------------------------------------------------

/** 单个 executor 的登记记录（name 来自 yaml 键；capabilities 为部分镜像） */
export interface AgentExecutorConfig {
  readonly name: string
  readonly default: boolean
  readonly version: string | undefined
  readonly cmd: readonly string[] | undefined
  readonly capabilities: Partial<ExecutorCapabilities>
  readonly patches: Readonly<Record<string, unknown>> | undefined
  readonly plugins: readonly string[] | undefined
}

/** agent.yaml 装载产物：executors 按书写序（注册序的来源） */
export interface AgentConfig {
  readonly executors: readonly AgentExecutorConfig[]
}

/**
 * 装载 agent.yaml 文本 → AgentConfig。
 * 四态明报（CONFIG_INVALID）：yaml 语法错（parse，带行号）/ 缺 executors 段
 * （missing-section）/ 形状不合（shape，带 zod 路径）/ 空段（no-executors）。
 */
export function loadAgentConfig(text: string): AgentConfig {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    configInvalid('agentconfig/parse', `agent.yaml 语法错误：${yamlErrDetail(e)}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    configInvalid(
      'agentconfig/shape',
      `根节点必须是映射（executors: 段），实际是 ${Array.isArray(raw) ? '数组' : typeof raw}`,
    )
  }
  if (!Object.hasOwn(raw, 'executors')) {
    configInvalid(
      'agentconfig/missing-section',
      '缺 executors: 段——agent.yaml 的唯一职责是 executor 注册与人事档案（docs/17-§4）',
    )
  }
  const parsed = agentConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.length > 0 ? `${i.path.map(String).join('.')}: ` : ''}${i.message}`)
      .join('；')
    configInvalid('agentconfig/shape', `agent.yaml 形状不合：${issues}`)
  }
  const executors = Object.entries(parsed.data.executors).map(([name, entry]) => ({
    name,
    default: entry.default === true,
    version: entry.version ?? undefined,
    cmd: entry.cmd ?? undefined,
    capabilities: (entry.capabilities ?? {}) as Partial<ExecutorCapabilities>,
    patches: entry.patches ?? undefined,
    plugins: entry.plugins ?? undefined,
  }))
  if (executors.length === 0) {
    configInvalid('agentconfig/no-executors', 'executors: 为空——注册零个 executor 的配置不可用')
  }
  return { executors }
}

// ---------------------------------------------------------------------------
// 注册表接线（wireRegistry）与四家内置捷径（registerBuiltins）
// ---------------------------------------------------------------------------

/** 适配器工厂：cmd 为配置覆盖位（undefined=适配器缺省命令，17-§6） */
export type AdapterFactory = (cmd: readonly string[] | undefined) => ExecutorAdapter

/** 名 → 适配器工厂的解析器（配置有而代码无时返回 undefined，wireRegistry 明报） */
export type AdapterResolver = (name: string) => AdapterFactory | undefined

/**
 * 按 AgentConfig 把适配器工厂接进注册表（cmd 覆盖注入；注册序=书写序）。
 * 未知 executor 名 / 能力漂移 / 注册表拒收（重名、双 default）→ CONFIG_INVALID 明报。
 * 返回传入的 registry（链式便利）。
 */
export function wireRegistry(
  registry: ExecutorRegistry,
  config: AgentConfig,
  resolver: AdapterResolver,
): ExecutorRegistry {
  for (const rec of config.executors) {
    const factory = resolver(rec.name)
    if (factory === undefined) {
      configInvalid(
        'agentconfig/unknown-executor',
        `配置有而代码无：${rec.name}（agent.yaml 登记了不存在适配器的 executor——先写适配器再登记，docs/18-§1.2）`,
      )
    }
    const adapter = factory(rec.cmd) // cmd 覆盖注入（无 cmd=适配器缺省命令）
    checkCapabilityDrift(rec, adapter.capabilities)
    registry.register(adapter, { default: rec.default })
  }
  return registry
}

/** registerBuiltins 的单项覆盖：cmd 改道（测试假 CLI/本机路径）+ default 旗标改写 */
export interface BuiltinOverride {
  cmd?: readonly string[] | undefined
  default?: boolean | undefined
}

/** 四家内置覆盖表：只覆盖给出的家，其余走缺省（dsh 为 default） */
export type BuiltinOverrides = Partial<Record<ExecutorFamily, BuiltinOverride>>

/**
 * 四家内置注册捷径：dsh（default）/ claude / codex / kimi 一行接入
 * （`registerBuiltins(createRegistry())`）。cmd/default 可按家覆盖。
 * 注册表已有同名 → CONFIG_INVALID（registry 拒收，不后写覆盖）。
 */
export function registerBuiltins(
  registry: ExecutorRegistry,
  overrides: BuiltinOverrides = {},
): ExecutorRegistry {
  for (const name of BUILTIN_ORDER) {
    const o = overrides[name]
    registry.register(BUILTIN_FACTORIES[name](o?.cmd), {
      default: o?.default ?? name === 'dsh', // dsh 缺省 default（docs/17-§6 默认主力）
    })
  }
  return registry
}

/** 内置注册序：dsh 首位（default）——与 docs/18-§1.2 文件列举序一致 */
const BUILTIN_ORDER: readonly ExecutorFamily[] = ['dsh', 'claude', 'codex', 'kimi']

/** 四家工厂表（cmd=undefined 时各自落缺省命令，17-§6） */
const BUILTIN_FACTORIES: Readonly<Record<ExecutorFamily, AdapterFactory>> = {
  dsh: (cmd) => new DshAdapter(cmd),
  claude: (cmd) => new ClaudeAdapter(cmd),
  codex: (cmd) => new CodexAdapter(cmd),
  kimi: (cmd) => new KimiAdapter(cmd),
}

/**
 * 内置解析器：四家名 → 工厂；未知名 undefined（wireRegistry 明报）。
 * daemon 装载 agent.yaml 时作为缺省 resolver 传入；注入自定义家可包一层。
 */
export function builtinResolver(name: string): AdapterFactory | undefined {
  return Object.hasOwn(BUILTIN_FACTORIES, name)
    ? (BUILTIN_FACTORIES[name as ExecutorFamily] as AdapterFactory)
    : undefined
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/**
 * 能力镜像逐字段比对（能力以适配器代码为准，头注口径）：配置提供的每个能力字段必须与
 * 适配器声明真值相等，否则 CONFIG_INVALID/agentconfig/cap-drift（拒绝配置伪造能力）。
 */
function checkCapabilityDrift(rec: AgentExecutorConfig, actual: ExecutorCapabilities): void {
  const FIELDS = [
    'budget_cap',
    'cancel_turn',
    'session_resume',
    'agents_md',
    'cost_native',
  ] as const satisfies readonly (keyof ExecutorCapabilities)[]
  for (const f of FIELDS) {
    const declared = rec.capabilities[f]
    if (declared !== undefined && declared !== actual[f]) {
      configInvalid(
        'agentconfig/cap-drift',
        `${rec.name}.capabilities.${f}：配置=${String(declared)} 代码=${String(actual[f])}——能力声明以适配器代码为准，配置漂移明报`,
      )
    }
  }
}

/** yaml@2 语法错误行号提取（docs/16-§二：错误定位「文件:行」依赖 yaml 带行号 AST） */
function yamlErrDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const pos = (e as { linePos?: unknown }).linePos
  const first = Array.isArray(pos) ? pos[0] : undefined
  const line =
    typeof first === 'object' && first !== null && typeof (first as { line?: unknown }).line === 'number'
      ? (first as { line: number }).line
      : undefined
  return line !== undefined ? `第 ${line} 行起：${msg}` : msg
}
