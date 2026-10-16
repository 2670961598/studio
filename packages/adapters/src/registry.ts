/**
 * executor 注册表 —— agent.yaml 驱动注册 + 能力路由（docs/17-§2 / §4，docs/18-§1.2）
 *
 * 依据：
 *   - docs/17-§2：调度**零 `if executor`**——只读能力声明。本注册表是这条纪律的机制落点：
 *     pick/pickAll 只比对 capabilities 字段与 default 旗标，任何路径都不出现 executor 名单
 *     硬编码（新增第五家适配器无需改本文件——注册即路由，路由只认能力不认名）。
 *   - docs/17-§4：agent.yaml 是 executor 注册与人事档案；本文件只管「注册后的内存表」，
 *     配置装载见 agentconfig.ts（loadAgentConfig + wireRegistry）。
 *   - docs/25-§3.1：ExecutorAdapter 端口（name + capabilities + 六原语）；
 *     ExecutorRegistration 是 agent.yaml 的类型面（实例归框架 config home）。
 *   - docs/17-§9：配置类错误走 CONFIG_INVALID 两级分类（subcause 机器可比对）。
 *
 * 口径（本文件自拟、随实现冻结，疑点走批示）：
 *   - 同名重注册拒收（CONFIG_INVALID/executor/dup-register）——注册表是事实源，
 *     后写覆盖先写等于静默改配置；唯一写入者纪律（AGENTS.md §五-4）的内存面。
 *   - default 至多一个（第二个 default 注册拒收，CONFIG_INVALID/executor/dup-default）——
 *     多默认使 pick 的结果不确定。
 *   - pick() 返回**单选**：存活者中 default 优先（default 也要过能力过滤，不满足时不越权），
 *     无 default 存活时取注册序首位（确定性回退，不随机）；无存活者返回 undefined。
 *     pickAll() 返回**存活全集**（注册序）。两者共用同一过滤谓词。
 *   - 布尔过滤项语义=**能力真值相等**（sessionResume:true 要求声明 true；sessionResume:false
 *     要求声明 false——「要一个不支持续跑的家」同样是合法查询）。缺省=不过滤。
 *   - resolve() 查无此名抛 CONFIG_INVALID（指名道姓的引用落空=配置坏，明报不静默降级）；
 *     pick() 无存活者返回 undefined（能力查询无解是**结果**不是配置错误——派发侧决策
 *     降级新派/明报，docs/17-§2）。两者语义不对称是有意设计。
 *   - 注册序=调用序（wireRegistry 下=agent.yaml 书写序）；list()/pickAll() 稳定按注册序。
 */
import { configInvalid } from '@studio-next/contract'
import type { ExecutorAdapter, ExecutorCapabilities } from '@studio-next/contract'

/** register() 选项：default 旗标（agent.yaml `default: true` 的内存面，至多一个） */
export interface RegisterOptions {
  default?: boolean
}

/**
 * 能力路由查询（docs/17-§2「只读能力声明」的查询面）。
 * 每一项：缺省=不过滤；给定=要求 capabilities 对应字段**真值相等**。
 * agentsMdChannel 对应 capabilities.agents_md 通道词汇（contract 冻结枚举）。
 */
export interface PickOptions {
  sessionResume?: boolean
  budgetCap?: boolean
  cancelTurn?: boolean
  costNative?: boolean
  agentsMdChannel?: ExecutorCapabilities['agents_md']
}

/** list() 条目快照：面板/监控用的只读投影（适配器本体经 resolve(name) 取得） */
export interface RegistryEntry {
  readonly name: string
  readonly capabilities: ExecutorCapabilities
  readonly default: boolean
}

/** executor 注册表（createRegistry() 构造；daemon 单线程内使用，v0 不做并发保护） */
export interface ExecutorRegistry {
  /** 登记适配器；同名重注册 / 第二个 default → CONFIG_INVALID 明报 */
  register(adapter: ExecutorAdapter, opts?: RegisterOptions): void
  /** 按名取适配器；查无此名 → CONFIG_INVALID（指名引用落空=配置坏，不静默） */
  resolve(name: string): ExecutorAdapter
  /** 全量条目快照（注册序稳定） */
  list(): readonly RegistryEntry[]
  /** 单选：存活者中 default 优先，无 default 存活取注册序首位；无存活者 undefined */
  pick(opts?: PickOptions): ExecutorAdapter | undefined
  /** 全集：全部存活者（注册序）；空数组=该能力组合无解 */
  pickAll(opts?: PickOptions): readonly ExecutorAdapter[]
  /** 当前 default 名（未设 default 时 undefined） */
  defaultName(): string | undefined
}

/** 内部条目：default 旗标与适配器同放一处（list() 快照由此投影） */
interface InternalEntry {
  readonly adapter: ExecutorAdapter
  readonly isDefault: boolean
}

/**
 * 能力过滤谓词（pick/pickAll 共用；**零 executor 名单硬编码**——只读能力声明）：
 * 每个给定的过滤项要求 capabilities 对应字段真值相等；缺省项不过滤。
 */
function matchesCaps(c: ExecutorCapabilities, o: PickOptions): boolean {
  return (
    (o.sessionResume === undefined || c.session_resume === o.sessionResume) &&
    (o.budgetCap === undefined || c.budget_cap === o.budgetCap) &&
    (o.cancelTurn === undefined || c.cancel_turn === o.cancelTurn) &&
    (o.costNative === undefined || c.cost_native === o.costNative) &&
    (o.agentsMdChannel === undefined || c.agents_md === o.agentsMdChannel)
  )
}

/** 构造空注册表 */
export function createRegistry(): ExecutorRegistry {
  const entries: InternalEntry[] = []

  return {
    register(adapter, opts = {}) {
      if (entries.some((e) => e.adapter.name === adapter.name)) {
        configInvalid(
          'executor/dup-register',
          `同名重注册拒收：${adapter.name} 已在册（注册表是事实源，改配置请走配置装载，不后写覆盖）`,
        )
      }
      const isDefault = opts.default === true
      if (isDefault && entries.some((e) => e.isDefault)) {
        const holder = entries.find((e) => e.isDefault)?.adapter.name ?? '?'
        configInvalid(
          'executor/dup-default',
          `第二个 default 拒收：${holder} 已是 default，${adapter.name} 不得再标（多默认使 pick 结果不确定）`,
        )
      }
      entries.push({ adapter, isDefault })
    },

    resolve(name) {
      const entry = entries.find((e) => e.adapter.name === name)
      if (entry === undefined) {
        configInvalid(
          'executor/unknown',
          `未注册的 executor：${name}（配置引用了不存在的名字——查 agent.yaml 与注册表装载）`,
        )
      }
      return entry.adapter
    },

    list() {
      return entries.map((e) => ({
        name: e.adapter.name,
        capabilities: e.adapter.capabilities,
        default: e.isDefault,
      }))
    },

    pick(opts = {}) {
      // default 优先——但 default 同样要过能力过滤（不满足能力要求的 default 不越权）；
      // 其余取注册序首位存活者（确定性回退）
      const def = entries.find((e) => e.isDefault)
      if (def !== undefined && matchesCaps(def.adapter.capabilities, opts)) {
        return def.adapter
      }
      return entries.find((e) => matchesCaps(e.adapter.capabilities, opts))?.adapter
    },

    pickAll(opts = {}) {
      return entries.filter((e) => matchesCaps(e.adapter.capabilities, opts)).map((e) => e.adapter)
    },

    defaultName() {
      return entries.find((e) => e.isDefault)?.adapter.name
    },
  }
}
