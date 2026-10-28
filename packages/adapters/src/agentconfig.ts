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
 *   - version / patches / plugins 属「人事档案」字段：解析进记录，version 的运行时核实归
 *     detect()（18-§一 launch 前必跑），plugins 归 L5 工具层（17-§5 executor 能力声明+
 *     插件 manifest）。patches 值形状文档未定义（17-§4 示例原样省略号）——按 unknown
 *     透传不解释；**唯一例外**（132-§6.1 单A，studio-dev-168）：dsh 家工厂消费
 *     `agent-default-model` 声明注入 ResultStats.model（dshModelFromPatches——家族专属
 *     消费，cmd 同位先例；generic 层仍不解释，其余家不读）。
 *   - capabilities 各键**可部分提供**（只比对提供的字段）；agents_md 词汇=contract
 *     冻结枚举（native/user_level/append_system_prompt）。
 *   - 缺 executors 段 / 空段 / yaml 语法错 / 形状错 → CONFIG_INVALID 明报（subcause
 *     分别 missing-section / no-executors / parse / shape）。
 *   - 注册序=agent.yaml 书写序（yaml@2 保序）——pick 无 default 存活时的确定性回退序。
 *   - 未知 executor 名（配置有而代码无）→ CONFIG_INVALID/agentconfig/unknown-executor：
 *     先写适配器再登记（18-§1.2），不存在「配置声明式注册」的旁路。
 *   - judge 注册位（studio-dev-160 §6.3/§6.5，红队 1——单 164）：`<family>-judge`
 *     （如 `dsh-judge`）=micro-judge 判断调用的专用 executor 位——按家族工厂解析
 *     （judgeAwareResolver），能力镜像同家族比对；**不得标 default**（判断位不是
 *     派工泳道，双 default 之外的第二道语义闸，wireRegistry 拒收）。
 *
 * 文档疑点（只记录，不改文档）：
 *   - docs/17-§4 示例里 dsh 的 `session_resume: true` 与 dsh 适配器声明（false，v0
 *     不支持续跑）不一致；示例词汇 `agents_md: "dsh_home"` 不在 contract 冻结枚举内。
 *     本文件按 contract 词汇校验——按文档示例字面书写的 agent.yaml 会 CONFIG_INVALID，
 *     孰为准待批示（呈批前以 contract 为标尺，AGENTS.md §四「契约不随便动」）。
 *
 * seatbelt 必填化（IMPL-07-08；v2/15 §一 SEC-FC-05 前半；plan/02 §五-8 接口耦合）：
 *   - `BUILTIN_FACTORIES` 的第三参 seatbelt（SeatbeltPlan）在类型上**必填**——家族工厂不再
 *     有「不圈定」的缺省。公共解析面（builtinResolver / judgeAwareResolver /
 *     tierAwareResolver / registerBuiltins）省略即绑定 read-only 最严档
 *     （seatbelt.ts DEFAULT_SEATBELT_PLAN：写域零放行）；放宽只能显式
 *     tier:'workspace-write'＋绝对路径根＋authorization 留痕——缺一构造期 CONFIG_INVALID。
 *   - 运行时兜底同向：JS 调用方省略第三参=read-only，**不存在**「不传=全权」路径（档位
 *     守门唯一=seatbelt.ts resolveSeatbeltGrant；非法档/未授权放宽一律拒收）。
 *   - 接线面：dsh 家唯一有 seatbelt 端子（dsh.ts DshSeatbeltOptions，profile 随派发参数化）；
 *     claude/codex/kimi 无端子——**显式放宽一律拒收**（不在无端子家族上盖「已放宽」章），
 *     read-only 缺省的实际拦截缺失按 seatbelt.ts 头注 PRB-04 前置声明登记（未证，不冒充
 *     已封死）；补齐归 G-PORT-WS 接线腿。
 *   - **接口耦合**：本面签名变更的派发域调用方随动归 IMPL-07-09（串行 07-08→07-09）——
 *     本单不改 daemon/派发面，daemon 现有 `judgeAwareResolver(tierAwareResolver())` 组合
 *     仍零改动可编译，只是派工缺省圈定从「不圈定」翻成 read-only。
 */
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'
import type { ExecutorAdapter, ExecutorCapabilities, ExecutorFamily } from '@studio-next/contract'
import { ClaudeAdapter } from './claude.ts'
import { CodexAdapter } from './codex.ts'
import { DshAdapter } from './dsh.ts'
import type { DshAdapterOptions, DshSeatbeltOptions } from './dsh.ts'
import { KimiAdapter } from './kimi.ts'
import { DEFAULT_SEATBELT_PLAN, resolveSeatbeltGrant } from './seatbelt.ts'
import type { SeatbeltGrant, SeatbeltPlan } from './seatbelt.ts'
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

/**
 * 适配器工厂：cmd 为配置覆盖位（undefined=适配器缺省命令，17-§6）；patches 为该家
 * agent.yaml patches 段透传（132-§6.1 单A·studio-dev-168——dsh 家消费
 * `agent-default-model` 声明注入 ResultStats.model，见 dshModelFromPatches；其余家忽略）。
 * 第二参可选：少参工厂字面量（既有测试/调用点）类型兼容零改动。
 *
 * seatbelt 不在此签名上：圈定计划由**解析器绑定**（builtinResolver 第二参 /
 * judgeAwareResolver、tierAwareResolver 的 seatbelt 参数）——本类型的工厂一律已带计划
 * （省略=read-only 最严，见文件头注「seatbelt 必填化」）；直接构造适配器绕过工厂
 * （`new DshAdapter(cmd)` 无 opts）不属注册面，判例见 dsh.ts。
 */
export type AdapterFactory = (
  cmd: readonly string[] | undefined,
  patches?: Readonly<Record<string, unknown>>,
) => ExecutorAdapter

/** 名 → 适配器工厂的解析器（配置有而代码无时返回 undefined，wireRegistry 明报） */
export type AdapterResolver = (name: string) => AdapterFactory | undefined

/**
 * 按 AgentConfig 把适配器工厂接进注册表（cmd 覆盖注入；注册序=书写序）。
 * 未知 executor 名 / 能力漂移 / 注册表拒收（重名、双 default）→ CONFIG_INVALID 明报。
 * 返回传入的 registry（链式便利）。
 *
 * seatbelt：由 resolver 在解析期绑定（内置面见 builtinResolver 第二参 / 两个感知解析器的
 * seatbelt 参数）；本函数不再另开一个 seatbelt 入参——圈定决策只有一个入口，避免
 * 「resolver 一套、wireRegistry 一套」的双写面。daemon 现有
 * `judgeAwareResolver(tierAwareResolver())` 组合因此零改动，只是缺省圈定翻成 read-only。
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
    if (rec.default && isJudgeExecutorName(rec.name)) {
      configInvalid(
        'agentconfig/judge-default',
        `${rec.name} 是 judge 注册位（<family>-judge），不得标 default——判断位是 micro-judge 专用派发面，不是任务派工泳道（studio-dev-160 §6.3）`,
      )
    }
    // cmd 覆盖注入（无 cmd=适配器缺省命令）+ patches 透传（家族工厂自决消费，本层不解释）
    const adapter = factory(rec.cmd, rec.patches)
    checkCapabilityDrift(rec, adapter.capabilities)
    registry.register(adapter, { default: rec.default })
  }
  return registry
}

/**
 * registerBuiltins 的单项覆盖：cmd 改道（测试假 CLI/本机路径）+ default 旗标改写
 * ＋ **seatbelt 派工圈定授权**（省略=read-only 最严；放宽须显式 workspace-write＋绝对
 * 路径根＋authorization 留痕——构造期校验见 seatbelt.ts resolveSeatbeltGrant）。
 */
export interface BuiltinOverride {
  cmd?: readonly string[] | undefined
  default?: boolean | undefined
  seatbelt?: SeatbeltGrant | undefined
}

/** 四家内置覆盖表：只覆盖给出的家，其余走缺省（dsh 为 default；seatbelt=read-only） */
export type BuiltinOverrides = Partial<Record<ExecutorFamily, BuiltinOverride>>

/**
 * 四家内置注册捷径：dsh（default）/ claude / codex / kimi 一行接入
 * （`registerBuiltins(createRegistry())`）。cmd/default/seatbelt 可按家覆盖。
 * 未给 seatbelt 的家绑 read-only 最严档（**不传=不圈定的旧全权缺省已删除**）。
 * 注册表已有同名 → CONFIG_INVALID（registry 拒收，不后写覆盖）。
 */
export function registerBuiltins(
  registry: ExecutorRegistry,
  overrides: BuiltinOverrides = {},
): ExecutorRegistry {
  for (const name of BUILTIN_ORDER) {
    const o = overrides[name]
    // 档位解析=构造期守门：非法档/未授权放宽在此抛（不等到 launch 才败）
    const plan = resolveSeatbeltGrant(o?.seatbelt)
    registry.register(BUILTIN_FACTORIES[name](o?.cmd, undefined, plan), {
      default: o?.default ?? name === 'dsh', // dsh 缺省 default（docs/17-§6 默认主力）
    })
  }
  return registry
}

/** 内置注册序：dsh 首位（default）——与 docs/18-§1.2 文件列举序一致 */
const BUILTIN_ORDER: readonly ExecutorFamily[] = ['dsh', 'claude', 'codex', 'kimi']

/**
 * 家族工厂（内部面）：第三参 seatbelt（圈定计划）**类型上必填**——SEC-FC-05 的接口耦合
 * 点，家族工厂不再有「不圈定」缺省。类型必填保证每个调用点给出圈定决策；运行时仍兜底
 * （JS 调用方省略第三参=read-only 最严，见各条目 `seatbelt ?? DEFAULT_SEATBELT_PLAN`）。
 */
type BuiltinFactory = (
  cmd: readonly string[] | undefined,
  patches: Readonly<Record<string, unknown>> | undefined,
  seatbelt: SeatbeltPlan,
) => ExecutorAdapter

/** 四家工厂表（cmd=undefined 时各自落缺省命令，17-§6；seatbelt 计划=构造期已解析） */
const BUILTIN_FACTORIES: Readonly<Record<ExecutorFamily, BuiltinFactory>> = {
  dsh: (cmd, patches, seatbelt) => {
    const plan = seatbelt ?? DEFAULT_SEATBELT_PLAN
    const model = dshModelFromPatches(patches)
    return new DshAdapter(cmd, dshAdapterOptions(plan, model))
  },
  // 三家无 seatbelt 端子（dsh.ts 才有 argv 包线）：显式放宽拒收，read-only 缺省照过——
  // 实际圈定缺失按 seatbelt.ts 头注 PRB-04 前置登记（未证），不在无端子家族上盖已放宽章
  claude: (cmd, _patches, seatbelt) => {
    assertSeatbeltTerminal('claude', seatbelt ?? DEFAULT_SEATBELT_PLAN)
    return new ClaudeAdapter(cmd)
  },
  codex: (cmd, _patches, seatbelt) => {
    assertSeatbeltTerminal('codex', seatbelt ?? DEFAULT_SEATBELT_PLAN)
    return new CodexAdapter(cmd)
  },
  kimi: (cmd, _patches, seatbelt) => {
    assertSeatbeltTerminal('kimi', seatbelt ?? DEFAULT_SEATBELT_PLAN)
    return new KimiAdapter(cmd)
  },
}

/**
 * dsh 家 patches['agent-default-model'] 声明解析（132-§6.1 单A·C3，studio-dev-168）：
 * dsh 无 `--model` 旗标，模型=profile `agent-default-model` 插件配置（provider+model，
 * docs/31-§2 表）——机器级 profile patch 是 dsh 侧事实，daemon 直读机器全局态与
 * per-company 隔离纪律相抵（docs/31-§5-5）；agent.yaml 的 patches 段是部署对该 patch
 * 的**声明镜像**（「capabilities 是镜像」同构——配置声明既有事实，非新增第三事实源）。
 * 形状照录 profile patch 条目：`{config: {provider, model}}`（两非空串且不含 `/`——
 * 归一形 `provider/model` 无歧义）；返回归一形字符串；缺该键=undefined（未声明=无从
 * 可知，ResultStats.model 如实缺席）；键在而形状坏 → CONFIG_INVALID 明报（不静默不猜）。
 * generic 层「patches 透传不解释」纪律维持——本解析是 dsh 家族工厂的家族专属消费
 * （cmd 家族专属消费的同位先例），其余家不读 patches。
 */
export function dshModelFromPatches(patches: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (patches === undefined || !Object.hasOwn(patches, 'agent-default-model')) return undefined
  const entry = patches['agent-default-model']
  const detail = (why: string): never =>
    configInvalid(
      'agentconfig/dsh-model-patch',
      `executors.dsh.patches['agent-default-model'] ${why}——形状须为 {config: {provider, model}}（profile patch 条目的声明镜像，132-§6.1 单A）`,
    )
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    detail(`形状不合（收到 ${Array.isArray(entry) ? '数组' : typeof entry}）`)
  }
  const config = (entry as Record<string, unknown>)['config']
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    detail('缺 config 映射段')
  }
  const c = config as Record<string, unknown>
  const provider = c['provider']
  const model = c['model']
  if (typeof provider !== 'string' || provider === '') detail('config.provider 须为非空字符串')
  if (typeof model !== 'string' || model === '') detail('config.model 须为非空字符串')
  const p = provider as string
  const m = model as string
  if (p.includes('/') || m.includes('/')) {
    detail(`provider/model 不得含 '/'（归一形 ${JSON.stringify(`${p}/${m}`)} 有歧义）`)
  }
  return `${p}/${m}`
}

/**
 * 内置解析器：四家名 → 工厂；未知名 undefined（wireRegistry 明报）。
 * daemon 装载 agent.yaml 时作为缺省 resolver 传入；注入自定义家可包一层。
 *
 * seatbelt（第二参，SEC-FC-05）：派工圈定授权——**省略=read-only 最严**（绑定
 * DEFAULT_SEATBELT_PLAN，写域零放行；「不传=不圈定」的全权缺省已删除）；放宽须显式
 * `{tier:'workspace-write', writeRoots:[绝对路径…], authorization:'…'}`，非法档/未授权
 * 放宽在**解析期**即 CONFIG_INVALID（构造期守门，不等到 launch 才败）。
 */
export function builtinResolver(name: string, seatbelt?: SeatbeltGrant): AdapterFactory | undefined {
  const family = builtinFamilyOf(name)
  if (family === undefined) return undefined
  if (seatbelt === undefined) return BUILTIN_DEFAULT_FACTORIES[family]
  const plan = resolveSeatbeltGrant(seatbelt)
  return (cmd, patches) => BUILTIN_FACTORIES[family](cmd, patches, plan)
}

/** 内置家族名判定（=BUILTIN_FACTORIES 键；未知名 undefined 不静默） */
function builtinFamilyOf(name: string): ExecutorFamily | undefined {
  return Object.hasOwn(BUILTIN_FACTORIES, name) ? (name as ExecutorFamily) : undefined
}

/**
 * 缺省绑定（read-only 最严）：公共面省略 seatbelt 时返回的工厂——每家**单例**（同一
 * 解析器两次调用返回同一函数对象，解析面可比较、零隐藏状态）。
 */
const BUILTIN_DEFAULT_FACTORIES: Readonly<Record<ExecutorFamily, AdapterFactory>> = {
  dsh: (cmd, patches) => BUILTIN_FACTORIES.dsh(cmd, patches, DEFAULT_SEATBELT_PLAN),
  claude: (cmd, patches) => BUILTIN_FACTORIES.claude(cmd, patches, DEFAULT_SEATBELT_PLAN),
  codex: (cmd, patches) => BUILTIN_FACTORIES.codex(cmd, patches, DEFAULT_SEATBELT_PLAN),
  kimi: (cmd, patches) => BUILTIN_FACTORIES.kimi(cmd, patches, DEFAULT_SEATBELT_PLAN),
}

// ---------------------------------------------------------------------------
// judge 注册位（studio-dev-160 §6.3/§6.5，红队 1——单 164）：`<family>-judge`
// ---------------------------------------------------------------------------

/** judge 注册位后缀（`dsh-judge` 一类——家族名 + 本后缀） */
export const JUDGE_EXECUTOR_SUFFIX = '-judge'

/** 判定名是否 judge 注册位 */
export function isJudgeExecutorName(name: string): boolean {
  return judgeFamilyOf(name) !== undefined
}

/**
 * judge 注册位 → 家族名（`dsh-judge`→`dsh`）；非 judge 形态或家族不存在 → undefined。
 * 家族表=BUILTIN_FACTORIES 键（四家）——未配置家族的 judge 位由 resolver 明报，不静默。
 */
export function judgeFamilyOf(name: string): ExecutorFamily | undefined {
  if (!name.endsWith(JUDGE_EXECUTOR_SUFFIX)) return undefined
  const family = name.slice(0, -JUDGE_EXECUTOR_SUFFIX.length)
  return Object.hasOwn(BUILTIN_FACTORIES, family) ? (family as ExecutorFamily) : undefined
}

/**
 * 同族适配器**改名注册**（judge 位专用）：Object.create 原型链挂名——家族适配器本体
 * 零侵入（dsh.ts 行基线不动）。方法经原型链委托到本尊实例（`this.*` 读写直达；TS
 * `private` 是擦除型关键字、无 #品牌校验，委托安全）；`name` 不可写重遮蔽。
 * 为什么必须改名：注册表以 adapter.name 为键去重（registry.register 同名拒收），
 * judge 位与本尊是同族**两个注册实例**（不同 cmd=不同模型档），不改名即撞键。
 */
function renameExecutor(adapter: ExecutorAdapter, name: string): ExecutorAdapter {
  return Object.create(adapter, { name: { value: name } })
}

/**
 * judge 感知解析器：四家名走 base（缺省 builtinResolver）；`<family>-judge` 走该家族
 * 工厂并以 judge 名注册（判断调用复用家族适配器——cmd 即配置层绑定位：低档模型/
 * 无工具档由 agent.yaml 的 cmd 数组声明，17-§4「cmd=配置覆盖注入位」）。daemon 装载
 * agent.yaml 时包在 builtinResolver 外即可让 judge 位注册成功。
 *
 * seatbelt（第二参，SEC-FC-05）：judge 位工厂同样**必带**圈定计划——省略=read-only
 * 最严；本解析器只对 judge 位行使该计划，四家名仍走 base（base 的圈定授权归 base 自己；
 * 缺省 base=builtinResolver 时把 seatbelt 一并下传，两层面同源）。judge 的**实际调用**
 * 走 judge/invoke.ts 的 dshJudgeAdapterFactory（workspace 只读档、写域=一次性 DSH_HOME），
 * 不消费本层注册实例的 seatbelt 选项——本层只保证注册期不缺省全权。
 */
export function judgeAwareResolver(base?: AdapterResolver, seatbelt?: SeatbeltGrant): AdapterResolver {
  const plan = resolveSeatbeltGrant(seatbelt)
  const resolveBase: AdapterResolver = base ?? ((name: string) => builtinResolver(name, seatbelt))
  return (name: string): AdapterFactory | undefined => {
    const judgeFamily = judgeFamilyOf(name)
    if (judgeFamily !== undefined) {
      const familyFactory = BUILTIN_FACTORIES[judgeFamily]
      return (cmd: readonly string[] | undefined): ExecutorAdapter =>
        renameExecutor(familyFactory(cmd, undefined, plan), name)
    }
    return resolveBase(name)
  }
}


// ---------------------------------------------------------------------------
// 模型档注册位（studio-dev-196，制作人 2026-10-22 三档定调：大/中/小）：`<family>-<tier>`
// ---------------------------------------------------------------------------

/**
 * 模型档位后缀（`dsh-low`/`dsh-mid`/`dsh-high` 一类——家族名 + 档位后缀）。
 * 档位枚举与 contract `ModelTier['tier']` 同源（high/mid/low，docs/17-§4 三档冻结）。
 */
export const MODEL_TIER_SUFFIXES = ['-high', '-mid', '-low'] as const

/** 模型档注册位的档位名（=后缀去连线；contract ModelTier.tier 的镜像枚举） */
export type ModelTierSuffix = 'high' | 'mid' | 'low'

/** 判定名是否模型档注册位 */
export function isModelTierExecutorName(name: string): boolean {
  return tierOfExecutorName(name) !== undefined
}

/**
 * 模型档注册位 → {family, tier}（`dsh-high`→{family:'dsh', tier:'high'}）；非档位形态
 * 或家族不存在 → undefined。裸家族名（`dsh`）不是档位——undefined（现役语义不变）。
 * 家族表=BUILTIN_FACTORIES 键（四家）——未配置家族的档位由 resolver 明报，不静默。
 */
export function tierOfExecutorName(name: string): { family: ExecutorFamily; tier: ModelTierSuffix } | undefined {
  for (const suffix of MODEL_TIER_SUFFIXES) {
    if (!name.endsWith(suffix)) continue
    const family = name.slice(0, -suffix.length)
    if (family === '') return undefined // 裸 `-high` 一类：无家族前缀，非档位名
    return Object.hasOwn(BUILTIN_FACTORIES, family)
      ? { family: family as ExecutorFamily, tier: suffix.slice(1) as ModelTierSuffix }
      : undefined
  }
  return undefined
}

/** 家族名 + 档位 → 注册位名（`('dsh','high')`→`dsh-high`；tierOfExecutorName 的反函数） */
export function tierExecutorName(family: string, tier: ModelTierSuffix): string {
  return `${family}-${tier}`
}

/**
 * 模型档感知解析器：四家名走 base（缺省 builtinResolver）；`<family>-<tier>` 走该家族
 * 工厂并以档位名注册（studio-dev-196：档位是**全功能派工位**——同家族不同档=不同 cmd
 * `--patch` overlay 绑定不同 agent-default-model，17-§4「cmd=配置覆盖注入位」）。
 *
 * 与 judgeAwareResolver 的语义差（勿混）：**patches 透传**——档位的
 * `patches['agent-default-model']` 是模型留痕镜像（132-§6.1 单A，ResultStats.model 注入
 * 源），resolve 时必须连同 cmd 一起交给家族工厂；judge 位不透传（判断位镜像无意义）。
 * 档位**可标 default**（`dsh-mid: default` 即缺省主力位——档位是派工泳道，与 judge 位
 * 「不得标 default」相反；wireRegistry 无档位特设闸，配置自证）。
 *
 * seatbelt（第二参，SEC-FC-05）：档位位工厂同样**必带**圈定计划（省略=read-only 最严）；
 * 与 judge 解析器同构——计划只作用于档位位，四家名走 base（缺省 base=builtinResolver
 * 时下传 seatbelt，两层面同源）。
 */
export function tierAwareResolver(base?: AdapterResolver, seatbelt?: SeatbeltGrant): AdapterResolver {
  const plan = resolveSeatbeltGrant(seatbelt)
  const resolveBase: AdapterResolver = base ?? ((name: string) => builtinResolver(name, seatbelt))
  return (name: string): AdapterFactory | undefined => {
    const tierFamily = tierOfExecutorName(name)
    if (tierFamily !== undefined) {
      const familyFactory = BUILTIN_FACTORIES[tierFamily.family]
      return (cmd: readonly string[] | undefined, patches?: Readonly<Record<string, unknown>>): ExecutorAdapter =>
        renameExecutor(familyFactory(cmd, patches, plan), name)
    }
    return resolveBase(name)
  }
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/**
 * dsh 家 seatbelt 选项（构造期固定；IMPL-07-08 SEC-FC-05 缺省翻转的落点）：
 *   - plan.tier=read-only ⇒ `writeRootsOverride: []`（写域零放行——连 dshHomeRedirect 也
 *     不白名单：read-only 档不白名单 scratch，dsh boot 要写=派发方显式放宽，不静默给）
 *   - plan.tier=workspace-write ⇒ `writeRootsOverride: plan.writeRoots`（显式绝对路径根；
 *     authorization 已由 resolveSeatbeltGrant 校验——留痕落账归派发域 IMPL-07-09）
 * writeRootsOverride **恒给**：dsh 缺省会把 task.workspace/extraWriteRoots/dshHomeRedirect
 * 隐式并入写域——缺省最严不允许隐式加根；切片式覆写把「写域根从哪来」收回到本计划一处。
 */
function dshAdapterOptions(plan: SeatbeltPlan, model: string | undefined): DshAdapterOptions {
  const seatbelt: DshSeatbeltOptions = {
    mode: 'auto',
    writeRootsOverride: [...plan.writeRoots],
    ...(plan.dshHomeRedirect !== undefined ? { dshHomeRedirect: plan.dshHomeRedirect } : {}),
    ...(plan.profileDir !== undefined ? { profileDir: plan.profileDir } : {}),
    ...(plan.rpcEndpoints !== undefined ? { rpcEndpoints: plan.rpcEndpoints } : {}),
    ...(plan.outboundTcp !== undefined ? { outboundTcp: plan.outboundTcp } : {}),
  }
  return model !== undefined ? { seatbelt, model } : { seatbelt }
}

/**
 * 无 seatbelt 端子的家族（claude/codex/kimi——argv 包线只在 dsh.ts 接）：**显式放宽一律
 * 拒收**。没有端子就没有 profile 可落，声称「已放宽到 workspace-write」=假证据（比缺省
 * 更坏）；read-only 缺省照过，但实际圈定缺失按 seatbelt.ts 头注 PRB-04 前置声明登记
 * （未证，不冒充已封死）——端子补齐归 G-PORT-WS 接线腿。
 */
function assertSeatbeltTerminal(family: ExecutorFamily, plan: SeatbeltPlan): void {
  if (plan.tier === 'read-only') return
  configInvalid(
    'agentconfig/seatbelt-unenforceable',
    `executors.${family}: 该家适配器无 seatbelt 端子（唯一端子=dsh.ts 的 DshSeatbeltOptions）——显式放宽 workspace-write 无法执行，构造期拒收（不在无端子家族上盖「已放宽」章；端子补齐归 G-PORT-WS）`,
  )
}

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
