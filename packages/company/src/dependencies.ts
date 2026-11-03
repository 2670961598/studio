/**
 * dependencies —— 依赖清单与插件绑定引擎（DEV-26）＋V2 资产依赖面（IMPL-05-02）
 *
 * 规范依据：docs/43-§四「依赖清单与插件绑定：员工的行为面」（v1.1 主特性）、§十-5/6/7/8
 * （spike 定稿增补）、docs/51-契约 D（D-1..D-4）与 C-7；V2 面引 v2/06 §3.4（必备资产二选一/
 * 装载报告）、§3.5（传播≠授权）、§4.5（plugins/ 四条约束）与 v2/10 §4.4/§4.5。
 *
 * 语义总纲（与 spike／docs/44 §v1.1 判定面逐条对齐，证据面不回退）：
 *   1. dependencies.yaml：when:{attr,is} → plugins[{name,version}]，strictObject 未知键拒收；
 *      绑定域=档案已知键封闭枚举（role/dept/level/skills/executor/status——51-C-7）；
 *   2. version 只收 `^x.y(.z)` 与 `x.y[.z]`（缺 patch 归 .0；^0.x 锁 minor、^0.0 锁 patch）；
 *      多绑定命中同一插件=约束并集，无解=conflict 如实上报、不装错版本（51-D-1/D-2）；
 *   3. 安装目标=注入的隔离插件根，本引擎无缺省值（结构上不可能写用户 ~/.dsh）；
 *   4. 可见面=registry.json＋install-log.jsonl＋confirm 确认位（拒=只出计划零落盘）；
 *   5. 缺源双面：默认 missing 进报告不阻断；failOnMissing=true 为导入侧 fail-fast（51-D-3）；
 *   6. 热重载：指纹=sha256(dependencies.yaml 原文‖排序启用集投影)，变→重算+补装，不变→零动作，
 *      启用集收缩不卸载（registry=追加事实）——docs/43-§十-8；
 *   7. V2 资产依赖面（本单新增）：版本并集判定 `resolveVersionUnion`＋必备资产判定
 *      `judgeRequiredAssets`；资产清单/装载报告在 assets/（loader.ts），定义包导入在 assets/import.ts。
 *
 * v1 边界（诚实标注，归后续单）：插件 hash 内容寻址比对、卸载语义、npm/registry 外部源落位
 * （PluginSource 接口已留位）；V2 SCH-DEP-01 声明面待 MIG-06 端口接线。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import type {
  RequiredAssetDecision,
  RequiredAssetPolicy,
  RequiredAssetUnavailable,
} from './assets/types.ts'

// 解析/绑定/版本面拆至 dependencies/parse.ts（docs/20-§十五.三；原文件余量 ≥50，行为零漂移）。
// 公开面用 `export *` 再出口，packages/company/src/index.ts 与既有导入面零改行。
export * from './dependencies/parse.ts'
export * from './dependencies/plan.ts'
import { planPluginInstalls, type PluginInstallAction, type PluginInstallItem, type PluginPlanSource } from './dependencies/plan.ts'
import {
  DEPENDENCIES_FILE,
  demandedPlugins,
  enabledPluginsFor,
  parseVersionSpec,
  readDependencies,
  satisfiesSpec,
  type CompanyDependencies,
  type PersonAttrs,
  type PluginRef,
  parseDependencies,
} from './dependencies/parse.ts'

// ————————————————————————— 5. 安装执行面（隔离根落位+registry+log+confirm——docs/43-§四） —————————————————————————

/** 外部源接口（docs/43-§十-7：公司包 plugins/ 优先，按序询问；npm/registry 源落位归后续单） */
export interface PluginSource {
  /** 源标签（registry/log/报告留痕——「从哪来」对制作人可见） */
  source: string
  resolve(name: string): Promise<string | null>
}

/** registry.json 条目（隔离根登记面——安装=落位+登记） */
export interface RegistryEntry {
  name: string
  version: string
  source: 'company-package' | 'external'
  installedAt: string
  by: string
}

/** registry.json 全形（追加事实——docs/43-§十-8：启用集收缩不卸载） */
interface PluginRegistry {
  schema: 'studio-next/plugin-registry@1'
  installed: RegistryEntry[]
}

/** 安装选项：pluginRoot 必填且无缺省值——结构上不可能写用户 ~/.dsh（docs/43-§四） */
export interface PluginInstallOptions {
  companyDir: string
  /** 隔离插件根（daemon 注入 var/plugins 或测试注入 tmp）——引擎无缺省值 */
  pluginRoot: string
  persons: readonly PersonAttrs[]
  deps?: CompanyDependencies
  /** 外部源（按序询问，公司包 plugins/ 优先） */
  externalSources?: PluginSource[]
  /** 确认位：拒装（返回 false）→ 只出计划零落盘 */
  confirm?: (plan: { company: string; planned: PluginInstallItem[] }) => Promise<boolean> | boolean
  /** 缺源严格面：true=缺源即抛（导入侧 fail-fast）；缺省=missing 进报告不阻断（docs/43-§十-7） */
  failOnMissing?: boolean
  /** 登记人（registry/log 留痕；缺省 producer） */
  by?: string
  now?(): Date
}

/** 安装报告（能力声明面：装了什么/缺什么/冲突什么，对制作人可见） */
export interface PluginInstallReport {
  company: string
  items: PluginInstallItem[]
  confirmed: boolean
  /** 安装清单日志落点（install-log.jsonl——审计面） */
  logFile: string
}

const REGISTRY_FILE = 'registry.json'
const INSTALL_LOG_FILE = 'install-log.jsonl'

/** 读隔离根 registry（无文件=空登记——首装面） */
async function readRegistry(pluginRoot: string): Promise<PluginRegistry> {
  const file = path.join(path.resolve(pluginRoot), REGISTRY_FILE)
  if (!existsSync(file)) return { schema: 'studio-next/plugin-registry@1', installed: [] }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as PluginRegistry
    if (parsed.installed === undefined || !Array.isArray(parsed.installed)) {
      configInvalid('deps/registry-invalid', `registry.json installed 段不合法：${file}`)
    }
    return parsed
  } catch (err) {
    if (err instanceof Error && 'category' in err) throw err
    configInvalid('deps/registry-invalid', `registry.json 解析失败（${file}）：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 追加安装清单日志（install-log.jsonl——对制作人可见；无依赖清单也留一行空报告，审计面完整） */
async function appendInstallLog(pluginRoot: string, entry: InstallLogEntry): Promise<void> {
  await mkdir(path.resolve(pluginRoot), { recursive: true })
  await appendFile(path.join(path.resolve(pluginRoot), INSTALL_LOG_FILE), `${JSON.stringify(entry)}\n`, 'utf8')
}

/** 读插件包 package.json 的版本（外部源宽松面：name/version 不齐 → null 跳过询问下一源） */
async function readPluginPackageVersion(dir: string): Promise<string | null> {
  const pkgFile = path.join(dir, 'package.json')
  if (!existsSync(pkgFile)) return null
  try {
    const pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as { name?: unknown; version?: unknown }
    if (typeof pkg.name !== 'string' || pkg.name === '' || typeof pkg.version !== 'string' || pkg.version === '') return null
    return pkg.version
  } catch {
    return null
  }
}

/**
 * 公司包 plugins/<name>/ 源解析（51-D-4 形态闸）：package.json name/version + `dsh.bundle`
 * 声明 + 所指 patch 在位，不符即包不合法；无目录 → null（归 missing/外部源）。
 */
async function resolvePackagePlugin(companyDir: string, name: string): Promise<{ dir: string; version: string } | null> {
  const dir = path.join(path.resolve(companyDir), 'plugins', name)
  if (!existsSync(dir)) return null
  const pkgFile = path.join(dir, 'package.json')
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as Record<string, unknown>
  } catch (err) {
    configInvalid('deps/plugin-package-invalid', `公司包 plugins/${name}/package.json 解析失败（docs/51-D-4 dsh 插件形态）：${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof pkg['name'] !== 'string' || pkg['name'] === '' || typeof pkg['version'] !== 'string' || pkg['version'] === '') {
    configInvalid('deps/plugin-package-invalid', `公司包 plugins/${name}/package.json 须有非空 name/version（docs/51-D-4 dsh 插件形态）`)
  }
  const dsh = pkg['dsh']
  const bundle = typeof dsh === 'object' && dsh !== null ? (dsh as Record<string, unknown>)['bundle'] : undefined
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    configInvalid('deps/plugin-package-invalid', `公司包 plugins/${name}/package.json 缺 dsh.bundle 声明——dsh 插件形态不合法（profile 层入场券，docs/51-D-4 / docs/34-§3.1）`)
  }
  const patch = (bundle as Record<string, unknown>)['patch']
  if (typeof patch === 'string' && patch !== '' && !existsSync(path.join(dir, patch))) {
    configInvalid('deps/plugin-package-invalid', `公司包 plugins/${name}/ 的 dsh.bundle.patch 所指文件不在位：${patch}（docs/51-D-4）`)
  }
  return { dir, version: pkg['version'] as string }
}

/** 安装日志行（install-log.jsonl 追加——对制作人可见的安装清单） */
interface InstallLogEntry {
  at: string
  company: string
  summary: string
  confirmed: boolean
  items: { name: string; action: PluginInstallAction; required: string[]; origin: PluginInstallItem['origin'] }[]
}

/**
 * 依赖清单安装（docs/43-§四「框架替他安装」；安装=落位+登记）：插件目录整体复制进隔离根，
 * dsh 侧 profile patch 指向隔离根即装载，insert 条目随插件 cordis.patch.yml 旅行。
 * 无依赖清单 → 空报告（无绑定面=零安装，仍留日志一行）。
 */
export async function installCompanyPlugins(opts: PluginInstallOptions): Promise<PluginInstallReport> {
  const by = opts.by ?? 'producer'
  const now = opts.now ?? ((): Date => new Date())
  const at = now().toISOString()
  const companyDir = path.resolve(opts.companyDir)
  const pluginRoot = path.resolve(opts.pluginRoot) // 必填注入——无缺省值，绝不写 ~/.dsh
  const logFile = path.join(pluginRoot, INSTALL_LOG_FILE)
  const company = path.basename(companyDir)
  const deps = opts.deps ?? (await readDependencies(companyDir))

  if (deps === null) {
    const items: PluginInstallItem[] = []
    await appendInstallLog(pluginRoot, { at, company, summary: 'no-dependencies', confirmed: true, items })
    return { company, items, confirmed: true, logFile }
  }

  // 源快照组装（IO）：公司包 plugins/ 优先（51-D-4 形态闸）→ 外部源按序（docs/43-§十-7）
  const registry = await readRegistry(pluginRoot)
  const installed: Record<string, string> = {}
  for (const entry of registry.installed) installed[entry.name] = entry.version
  const demanded = demandedPlugins(deps, opts.persons)
  const sources: Record<string, PluginPlanSource> = {}
  const sourceDirs = new Map<string, string>()
  for (const name of [...demanded.keys()].sort()) {
    const pkg = await resolvePackagePlugin(companyDir, name)
    if (pkg !== null) {
      sources[name] = { origin: 'package', version: pkg.version }
      sourceDirs.set(name, pkg.dir)
      continue
    }
    for (const src of opts.externalSources ?? []) {
      const dir = await src.resolve(name)
      if (dir === null || !existsSync(dir)) continue
      const version = await readPluginPackageVersion(dir)
      if (version === null) continue
      sources[name] = { origin: 'external', version }
      sourceDirs.set(name, dir)
      break
    }
  }

  // 决策（纯面唯一实现）+ 缺源严格面（fail-fast 在任何落盘之前）
  const items = planPluginInstalls({ deps, persons: opts.persons, installed, sources })
  if (opts.failOnMissing === true) {
    const missing = items.filter((i) => i.action === 'missing')
    if (missing.length > 0) {
      configInvalid(
        'deps/plugin-missing',
        `插件 ${missing.map((m) => `${m.name}（约束 ${m.required.join('、')}）`).join('、')} 在公司包 plugins/ 与外部源均不可得——failOnMissing=true 拒绝导入`,
      )
    }
  }

  // 确认位：拒装=只出计划零落盘（docs/43-§四「安装动作对制作人可见、可确认」）
  const confirmed = opts.confirm === undefined ? true : await opts.confirm({ company, planned: items })
  const executed = confirmed
    ? items
    : items.map((i) =>
        i.action === 'install' || i.action === 'replace'
          ? { ...i, action: 'skipped' as const, detail: `${i.detail}——confirm 拒装，只出计划不落盘` }
          : i,
      )

  if (confirmed) {
    await mkdir(pluginRoot, { recursive: true })
    for (const item of items) {
      if (item.action !== 'install' && item.action !== 'replace') continue
      const sourceDir = sourceDirs.get(item.name)
      const source = sources[item.name]
      if (sourceDir === undefined || source === undefined) continue
      const target = path.join(pluginRoot, item.name)
      if (existsSync(target)) await rm(target, { recursive: true, force: true })
      await cp(sourceDir, target, { recursive: true })
      const entry: RegistryEntry = {
        name: item.name,
        version: source.version,
        source: source.origin === 'external' ? 'external' : 'company-package',
        installedAt: at,
        by,
      }
      registry.installed = [...registry.installed.filter((e) => e.name !== item.name), entry] // 追加事实（同名换版=换登记）
      item.installedVersion = source.version // 执行面回填（报告即落位后事实）
    }
    await writeFile(path.join(pluginRoot, REGISTRY_FILE), `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  }

  const counts: Record<string, number> = {}
  for (const item of executed) counts[item.action] = (counts[item.action] ?? 0) + 1
  const countsSummary = Object.entries(counts).map(([k, n]) => `${k}:${n}`).join(' ') || 'noop'
  const summary = confirmed ? countsSummary : `${countsSummary} confirm=false` // 日志摘要明示拒装（spike 断言面）
  await appendInstallLog(pluginRoot, {
    at,
    company,
    summary,
    confirmed,
    items: executed.map((i) => ({ name: i.name, action: i.action, required: i.required, origin: i.origin })),
  })

  return { company, items: executed, confirmed, logFile }
}

// ————————————————————————— 6. 热重载（docs/43-§十-8：指纹变化→重算+补装；不卸载） —————————————————————————

/** 隔离根状态文件（指纹+启用集投影——热重载幂等判据） */
export const PLUGIN_STATE_FILE = 'plugin-state.json'

/** plugin-state.json 全形 */
export interface PluginState {
  schema: 'studio-next/plugin-state@1'
  company: string
  fingerprint: string
  enabled: Record<string, PluginRef[]>
}

/** 配置指纹（docs/43-§十-8）：sha256(dependencies.yaml 原文 ‖ 排序启用集投影)；排序保证与遍历序无关 */
export function pluginSetFingerprint(depsSrc: string, enabled: Record<string, PluginRef[]>): string {
  const projection = Object.keys(enabled)
    .sort()
    .map((name) => `${name}@${(enabled[name] ?? []).map((p) => p.version).sort().join('|')}`)
    .join(';')
  return createHash('sha256').update(`${depsSrc}\u0000${projection}`).digest('hex')
}

/** 热重载同步结果 */
export interface PluginReloadResult {
  /** 指纹是否变化（false=零动作幂等——docs/43-§四「插件增删随公司配置热重载」） */
  changed: boolean
  fingerprint: string
  enabled: Record<string, PluginRef[]>
  install?: PluginInstallReport
}

/**
 * 热重载同步：指纹不变 → 零动作（不补装/不写状态/不出日志）；变化 → 重算+增量补装
 * 并落新状态；启用集收缩保留已装（registry=追加事实，卸载归后续单——docs/43-§十-8）。
 */
export async function syncCompanyPlugins(opts: {
  companyDir: string
  pluginRoot: string
  persons: readonly PersonAttrs[]
  now?(): Date
}): Promise<PluginReloadResult> {
  const companyDir = path.resolve(opts.companyDir)
  const depsFile = path.join(companyDir, DEPENDENCIES_FILE)
  const depsSrc = existsSync(depsFile) ? await readFile(depsFile, 'utf8') : ''
  const deps = depsSrc === '' ? null : parseDependencies(depsSrc)
  const enabled: Record<string, PluginRef[]> = {}
  for (const person of opts.persons) enabled[person.id] = enabledPluginsFor(person, deps ?? { schema: 'studio-next/dependencies@1', bindings: [] })
  const fingerprint = pluginSetFingerprint(depsSrc, enabled)

  const stateFile = path.join(path.resolve(opts.pluginRoot), PLUGIN_STATE_FILE)
  if (existsSync(stateFile)) {
    let prev: PluginState
    try {
      prev = JSON.parse(await readFile(stateFile, 'utf8')) as PluginState
    } catch (err) {
      configInvalid('deps/state-invalid', `plugin-state.json 解析失败（${stateFile}）：${err instanceof Error ? err.message : String(err)}`)
    }
    if (prev.fingerprint === fingerprint) {
      return { changed: false, fingerprint, enabled }
    }
  }

  const install = await installCompanyPlugins({ ...opts, companyDir, ...(deps !== null ? { deps } : {}) })
  const state: PluginState = { schema: 'studio-next/plugin-state@1', company: path.basename(companyDir), fingerprint, enabled }
  await mkdir(path.resolve(opts.pluginRoot), { recursive: true })
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return { changed: true, fingerprint, enabled, install }
}

/** 隔离根下的登记面速读（测试/面板消费：当前装了什么） */
export async function listInstalledPlugins(pluginRoot: string): Promise<RegistryEntry[]> {
  return (await readRegistry(pluginRoot)).installed
}

/** 隔离根内容枚举（断言面：全部产物（插件目录/registry/log/state）都在注入根内——绝不落用户 ~/.dsh 的结构直证） */
export async function listPluginRootEntries(pluginRoot: string): Promise<string[]> {
  if (!existsSync(pluginRoot)) return []
  return (await readdir(pluginRoot)).sort()
}

// ————————————————————————— 7. 契约 subject（deps 域——CASES.md 域分工同 dir：契约断言语义，IO 面单测承载） —————————————————————————

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * deps 域契约 subject：case 输入按键路由到引擎纯面（parse/enabled/demanded/satisfies/plan/fingerprint）；
 * 安装执行面由 company 单测 dependencies.test.ts 承载（CASES.md：契约断言语义，行号定位归单测）。
 */
export function depsSubject(input: unknown): unknown {
  const i = asRecord(input)
  if (i === null) {
    configInvalid('deps/contract-bad-input', 'deps 域 case 的 input 须为对象（parse/enabled/demanded/satisfies/plan/fingerprint 之一）')
  }
  if (typeof i['parse'] === 'string') return parseDependencies(i['parse'])

  const enabled = asRecord(i['enabled'])
  if (enabled !== null) {
    return enabledPluginsFor(enabled['person'] as PersonAttrs, enabled['deps'] as CompanyDependencies)
  }

  const demanded = asRecord(i['demanded'])
  if (demanded !== null) {
    return [...demandedPlugins(demanded['deps'] as CompanyDependencies, (demanded['persons'] ?? []) as PersonAttrs[]).entries()]
      .map(([name, required]) => ({ name, required }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  const satisfies = asRecord(i['satisfies'])
  if (satisfies !== null && Array.isArray(satisfies['pairs'])) {
    return (satisfies['pairs'] as { spec: string; version: string }[]).map(({ spec, version }) => {
      const parsed = parseVersionSpec(spec)
      return { spec, version, ok: parsed !== null && satisfiesSpec(parsed, version) }
    })
  }

  const plan = asRecord(i['plan'])
  if (plan !== null) {
    return planPluginInstalls({
      deps: plan['deps'] as CompanyDependencies,
      persons: (plan['persons'] ?? []) as PersonAttrs[],
      installed: (plan['installed'] ?? {}) as Record<string, string>,
      sources: (plan['sources'] ?? {}) as Record<string, PluginPlanSource>,
    })
  }

  const fingerprint = asRecord(i['fingerprint'])
  if (fingerprint !== null && Array.isArray(fingerprint['deps']) && Array.isArray(fingerprint['enabled'])) {
    const depsPair = fingerprint['deps'] as string[]
    const enabledPair = fingerprint['enabled'] as Record<string, PluginRef[]>[]
    const [depsA = '', depsB = ''] = depsPair
    const [enabledA = {}, enabledB = {}] = enabledPair
    return {
      unchanged: pluginSetFingerprint(depsA, enabledA) === pluginSetFingerprint(depsA, enabledA),
      depsChangedFlips: pluginSetFingerprint(depsA, enabledA) !== pluginSetFingerprint(depsB, enabledA),
      enabledChangedFlips: pluginSetFingerprint(depsA, enabledA) !== pluginSetFingerprint(depsA, enabledB),
    }
  }

  configInvalid('deps/contract-bad-input', 'deps 域 case 的 input 未命中任何路由键（parse/enabled/demanded/satisfies/plan/fingerprint）')
}

// ————————————————————————— 8. V2 资产依赖面（IMPL-05-02；v2/06 §3.4 必备资产二选一） —————————————————————————

export type { RequiredAssetDecision, RequiredAssetPolicy, RequiredAssetUnavailable } from './assets/types.ts'

/**
 * 必备资产判定（v2/06 §3.4）：缺则二选一，无第三态。缺省拒绝（fail-closed）；降级须接收方
 * 部署者具名选择并留痕（actor/note 非空），否则拒——禁止静默降级、禁止默认可用。
 */
export function judgeRequiredAssets(
  unavailable: readonly RequiredAssetUnavailable[],
  options: { policy?: RequiredAssetPolicy; decision?: { actor: string; note: string } } = {},
): RequiredAssetDecision {
  const policy = options.policy ?? 'refuse'
  if (unavailable.length === 0) return { policy, outcome: 'none', unavailable: [] }
  if (policy === 'refuse') return { policy, outcome: 'refused', unavailable: [...unavailable] }
  const decision = options.decision
  if (decision === undefined || decision.actor.trim() === '' || decision.note.trim() === '') {
    configInvalid('assets/degrade-decision-required', '必备资产不可用时降级装载须具名选择并留痕（actor/note 非空——v2/06 §3.4）；禁止静默降级')
  }
  return { policy, outcome: 'degraded', unavailable: [...unavailable], decision }
}
