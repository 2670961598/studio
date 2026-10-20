/**
 * dependencies —— 依赖清单与插件绑定引擎（DEV-26 正式化）
 *
 * 规范依据（冻结，2026-10-20 制作人批准）：
 *   - docs/43-§四「依赖清单与插件绑定：员工的行为面」（v1.1 新增主特性）
 *   - docs/43-§十-5/6/7/8（spike 反馈定稿增补）
 *   - 判定 normative 标尺：docs/51-契约 D（D-1..D-4）与 C-7
 *   - spike 原型与 22 用例证据：StudioNext-spike 仓 packages/company（docs/44-§v1.1
 *     机制二，判定通过）
 *
 * 语义总纲（与 spike 逐条对齐——docs/44 §v1.1 判定表的证据面不回退）：
 *   1. dependencies.yaml：属性值 → dsh 插件映射（when:{attr,is} → plugins[{name,version}]）；
 *      strictObject 未知键一律拒收（docs/43-§四）；
 *   2. 绑定域=档案已知键封闭枚举（role/dept/level/skills/executor/status，未知拒收——
 *      docs/43-§十-5 / 51-C-7）；dept 匹配=path 全量+末段名双候选，skills 逐元素，
 *      level 字符串化（docs/43-§十-5）——「属性面=档案正文自由字典」与「行为面=已知键
 *      绑定」的边界由此定清；
 *   3. version 只收 `^x.y(.z)`（caret）与 `x.y[.z]`（精确）两形态，缺 patch 归一 .0；
 *      `^0.x` 锁 minor、`^0.0` 锁 patch；多绑定命中同一插件=约束并集，源版本须满足
 *      全部约束，无解=conflict 如实上报、**不装错版本**（docs/43-§十-6 / 51-D-1/D-2）；
 *   4. 安装目标=注入的**隔离插件根目录**——本引擎无缺省值，结构上不可能写用户 ~/.dsh
 *      （docs/43-§四；测试/daemon 各自注入 tmp/var 根）；
 *   5. 可见面：registry.json 登记 + install-log.jsonl 追加 + confirm 确认位（回调
 *      拒=false → 只出计划零落盘）——docs/43-§四「安装动作对制作人可见、可确认」；
 *   6. 缺源双面：默认 missing 进安装报告如实可见、不阻断导入（依赖清单同时是能力
 *      声明的同源数据）；failOnMissing=true 为导入侧 fail-fast 严格面（docs/43-§十-7 /
 *      51-D-3）；源=公司包内 plugins/ 目录优先，外部源按序询问（PluginSource 接口，
 *      npm/registry 源落位归正式后续单）；
 *   7. 热重载：配置指纹=sha256(dependencies.yaml 原文 ‖ 排序后启用集投影)，变化 →
 *      插件集重算+增量补装；不变 → 零动作幂等；启用集收缩**不卸载**（registry=追加
 *      事实，卸载语义归正式后续单）——docs/43-§十-8。
 *
 * 相对 spike 原型的正式化增量（主仓纪律倒逼，决策/执行语义零改动）：
 *   - 安装决策拆出零 IO 纯面 `planPluginInstalls`（输入=依赖+人员+已装快照+源快照）——
 *     对齐 validator.ts「零 IO 可进契约」的 house style（docs/08 纯逻辑纪律），契约
 *     deps 域经 `depsSubject` 消费（分工同 dir 域：契约断言语义，company 单测断言
 *     位置与 IO 细节）；
 *   - 公司包 plugins/ 源按 51-D-4 收紧 dsh 插件形态闸：package.json name/version +
 *     `dsh.bundle` 声明 + 所指 patch 文件在位（docs/34-§3.1「dsh.bundle 是 profile 层
 *     入场券」）；spike 只查 name/version（docs/44 v0 边界注记）。外部源保持宽松
 *     （注入方责任面，不合法即跳过询问下一源）。
 *
 * v1 边界（诚实标注，归后续单）：
 *   - 插件 hash 内容寻址比对（docs/43-§四「内容寻址」→ manifest 层 hash）；
 *   - 卸载语义（docs/43-§十-8：registry=追加事实）；npm/registry 外部源落位
 *     （docs/43-§十-7：PluginSource 接口已留位）。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'

// ————————————————————————— 1. dependencies.yaml schema（strictObject——docs/43-§四） —————————————————————————

/** 属性名=人事档案已知键封闭枚举（docs/43-§十-5 / 51-C-7；01-C2 人事档案索引键；开放扩展归后续单） */
const PERSON_ATTRS = ['role', 'dept', 'level', 'skills', 'executor', 'status'] as const
export type PersonAttrName = (typeof PERSON_ATTRS)[number]

/** 版本约束两种形态（docs/43-§十-6 / 51-D-1：`^x.y`（caret）与 `x.y[.z]`（精确——缺 patch 按 .0）） */
const VERSION_SPEC_RE = /^(?:\^?)(\d+)\.(\d+)(?:\.(\d+))?$/
const VersionSpecSchema = z.string().min(1).refine((s) => VERSION_SPEC_RE.test(s.trim()), {
  message: 'version 须形如 ^1.2（caret）或 2.0.1 / 1.2（精确——缺 patch 按 .0），docs/43-§十-6',
})

/** 插件引用（strictObject：未知键拒收） */
const PluginRefSchema = z.strictObject({
  name: z.string().min(1),
  version: VersionSpecSchema,
})

/** 绑定条目：when（属性=值）→ plugins（至少一个） */
const BindingSchema = z.strictObject({
  when: z.strictObject({
    attr: z.enum(PERSON_ATTRS),
    is: z.string().min(1),
  }),
  plugins: z.array(PluginRefSchema).min(1),
})

/** dependencies.yaml 全形（strictObject 顶层——未知字段一律拒收） */
export const DependenciesSchema = z.strictObject({
  schema: z.literal('studio-next/dependencies@1'),
  bindings: z.array(BindingSchema).min(1),
})

export type PluginRef = z.infer<typeof PluginRefSchema>
export type DependencyBinding = z.infer<typeof BindingSchema>
export type CompanyDependencies = z.infer<typeof DependenciesSchema>

/** 依赖清单在公司目录的固定落点 */
export const DEPENDENCIES_FILE = 'dependencies.yaml'

/** 解析 dependencies.yaml（YAML 语法/结构错误 → CONFIG_INVALID deps/*，带 zod 定位） */
export function parseDependencies(src: string): CompanyDependencies {
  let raw: unknown
  try {
    raw = parseYaml(src)
  } catch (err) {
    configInvalid('deps/yaml-syntax', `dependencies.yaml YAML 语法错误：${err instanceof Error ? err.message : String(err)}`)
  }
  const parsed = DependenciesSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n')
    configInvalid('deps/invalid', `dependencies.yaml 结构不合法（strictObject——未知字段拒收）：\n${issues}`)
  }
  return parsed.data
}

/**
 * 非抛解析面（DEV-32 公司仓库判定器消费）：YAML 语法/结构错误不抛 CONFIG_INVALID，
 * 返回逐条 `{path, message}` issue——判定器把 C-7（when.attr 枚举域）/D-1（version 形态）/
 * B-5（dependencies.yaml 逐文件 schema）违规定位到键路径。schema 仍走 DependenciesSchema
 * 单源（与 parseDependencies 同表——判定面唯一事实源不变）。
 */
export interface DepsParseIssue {
  path: string
  message: string
}

export function safeParseDependencies(
  src: string,
): { ok: true; data: CompanyDependencies } | { ok: false; issues: DepsParseIssue[] } {
  let raw: unknown
  try {
    raw = parseYaml(src)
  } catch (err) {
    return { ok: false, issues: [{ path: '(root)', message: `YAML 语法错误：${err instanceof Error ? err.message : String(err)}` }] }
  }
  const parsed = DependenciesSchema.safeParse(raw)
  if (parsed.success) return { ok: true, data: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.filter((p) => typeof p === 'string' || typeof p === 'number').join('.') || '(root)',
      message: i.message,
    })),
  }
}

/** 读公司目录的依赖清单（在装插件前调；缺失 → null=无绑定面，空报告语义——依赖清单是可选契约文件） */
export async function readDependencies(companyDir: string): Promise<CompanyDependencies | null> {
  const file = path.join(path.resolve(companyDir), DEPENDENCIES_FILE)
  if (!existsSync(file)) return null
  return parseDependencies(await readFile(file, 'utf8'))
}

// ————————————————————————— 2. 员工属性与绑定求值（docs/43-§十-5：绑定域与匹配面） —————————————————————————

/** 员工档案已知键投影（org-config.yaml people 段；01-C2 索引键——绑定只认这些键） */
export interface PersonAttrs {
  id: string
  dept: string
  level: number
  role?: string
  skills?: string[]
  executor?: string
  status?: string
}

/** 从 org-config.yaml 源文抽取员工属性面（people 段逐人 id/dept/level/role/skills/executor/status） */
export function extractPersonAttrs(orgConfigSrc: string): PersonAttrs[] {
  let raw: unknown
  try {
    raw = parseYaml(orgConfigSrc)
  } catch {
    configInvalid('deps/yaml-syntax', 'org-config.yaml YAML 语法错误（extractPersonAttrs）')
  }
  const people = (raw as { people?: unknown })['people']
  if (!Array.isArray(people)) return []
  const out: PersonAttrs[] = []
  for (const p of people) {
    if (typeof p !== 'object' || p === null) continue
    const rec = p as Record<string, unknown>
    const id = rec['id']
    const dept = rec['dept']
    const level = rec['level']
    if (typeof id !== 'string' || typeof dept !== 'string' || typeof level !== 'number') continue
    const attrs: PersonAttrs = { id, dept, level }
    if (typeof rec['role'] === 'string') attrs.role = rec['role']
    if (Array.isArray(rec['skills'])) attrs.skills = rec['skills'].filter((s): s is string => typeof s === 'string')
    if (typeof rec['executor'] === 'string') attrs.executor = rec['executor']
    if (typeof rec['status'] === 'string') attrs.status = rec['status']
    out.push(attrs)
  }
  return out
}

/**
 * 属性候选值（docs/43-§十-5：绑定域匹配面）：
 *   dept=path 全量+末段名双候选（`is: 研发部` 是部门名而 person.dept 是 path——两形态都收）；
 *   skills=逐元素；level=字符串化；role/executor/status=单值。
 */
export function attributeCandidates(person: PersonAttrs): Partial<Record<PersonAttrName, string[]>> {
  const out: Partial<Record<PersonAttrName, string[]>> = {}
  if (person.role !== undefined) out.role = [person.role]
  out.dept = person.dept.includes('/') ? [person.dept, person.dept.split('/').at(-1) ?? person.dept] : [person.dept]
  out.level = [String(person.level)]
  if (person.skills !== undefined) out.skills = [...person.skills]
  if (person.executor !== undefined) out.executor = [person.executor]
  if (person.status !== undefined) out.status = [person.status]
  return out
}

/** 单条绑定对单人是否命中（when.attr 的候选值含 when.is 即命中） */
export function bindingHits(person: PersonAttrs, binding: DependencyBinding): boolean {
  const candidates = attributeCandidates(person)[binding.when.attr]
  return candidates !== undefined && candidates.includes(binding.when.is)
}

/** 单人启用集：命中绑定的插件去重（首见为代表——并集约束归 demandedPlugins） */
export function enabledPluginsFor(person: PersonAttrs, deps: CompanyDependencies): PluginRef[] {
  const byName = new Map<string, PluginRef>()
  for (const binding of deps.bindings) {
    if (!bindingHits(person, binding)) continue
    for (const ref of binding.plugins) {
      if (!byName.has(ref.name)) byName.set(ref.name, ref) // 首见为代表
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * 全员需求汇总（docs/43-§十-6：多绑定命中同一插件=约束并集）：
 * 插件名 → 全部命中约束的 version 原文列表（去重、保序）。
 */
export function demandedPlugins(deps: CompanyDependencies, persons: readonly PersonAttrs[]): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const person of persons) {
    for (const binding of deps.bindings) {
      if (!bindingHits(person, binding)) continue
      for (const ref of binding.plugins) {
        const list = byName.get(ref.name) ?? []
        if (!list.includes(ref.version)) list.push(ref.version)
        byName.set(ref.name, list)
      }
    }
  }
  return byName
}

// ————————————————————————— 3. 最小语义化版本（docs/43-§十-6 / 51-D-1：两形态，无 ~>/>=/通配） —————————————————————————

/** 解析后的版本约束：kind=caret（^x.y——含 ^0.x 锁 minor / ^0.0 锁 patch）或 exact（精确） */
export interface VersionSpec {
  kind: 'caret' | 'exact'
  major: number
  minor: number
  patch: number
}

/** 解析版本约束原文（两形态之外 → null；schema 层已挡，此处防御性二验） */
export function parseVersionSpec(src: string): VersionSpec | null {
  const m = VERSION_SPEC_RE.exec(src.trim())
  if (m === null) return null
  return {
    kind: src.trim().startsWith('^') ? 'caret' : 'exact',
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
  }
}

/** 精确版本原文解析（「1.2」归一 1.2.0——缺 patch 按 .0；非精确形态 → null） */
export function parsePlainVersion(src: string): VersionSpec | null {
  const spec = parseVersionSpec(src)
  return spec !== null && spec.kind === 'exact' ? spec : null
}

/**
 * 版本判定：exact=三元组等值；caret=同 major 下界闭开区间，且
 * `^0.x` 锁 minor（0.x 内不许跨 minor）、`^0.0` 锁 patch（docs/43-§十-6 标准 caret 表）。
 */
export function satisfiesSpec(spec: VersionSpec, version: string): boolean {
  const v = parsePlainVersion(version)
  if (v === null) return false
  if (spec.kind === 'exact') return spec.major === v.major && spec.minor === v.minor && spec.patch === v.patch
  if (spec.major > 0) {
    return v.major === spec.major && (v.minor > spec.minor || (v.minor === spec.minor && v.patch >= spec.patch))
  }
  if (spec.minor > 0) return v.major === 0 && v.minor === spec.minor && v.patch >= spec.patch
  return v.major === 0 && v.minor === 0 && v.patch === spec.patch
}

// ————————————————————————— 4. 安装决策纯面（零 IO——契约 deps 域消费；docs/08 纯逻辑纪律） —————————————————————————

/** 源快照条目（plan 面注入；IO 面由 installCompanyPlugins 解析公司包 plugins/ 与外部源后组装） */
export interface PluginPlanSource {
  origin: 'package' | 'external'
  version: string
}

/** planPluginInstalls 入参（全快照，零 IO） */
export interface PluginPlanInput {
  deps: CompanyDependencies
  persons: readonly PersonAttrs[]
  /** 已装面快照：插件名 → 版本（registry.json 投影） */
  installed: Record<string, string>
  /** 可得源快照：插件名 → 源版本（公司包 plugins/ 优先解析后的投影；无键=缺源） */
  sources: Record<string, PluginPlanSource>
}

/** 安装动作（决策面输出：install/replace/satisfied/conflict/missing；confirm 拒装的执行面改写为 skipped） */
export type PluginInstallAction = 'install' | 'replace' | 'satisfied' | 'conflict' | 'missing' | 'skipped'

/** 单插件安装判定（决策与执行共形——执行面回填 installedVersion） */
export interface PluginInstallItem {
  name: string
  /** 命中约束并集原文（docs/43-§十-6） */
  required: string[]
  origin: 'package' | 'external' | 'none'
  action: PluginInstallAction
  sourceVersion?: string
  installedVersion?: string
  detail: string
}

/**
 * 安装决策（纯函数）：全员需求汇总 → 逐插件动作判定——
 *   missing=无源（docs/43-§十-7 默认面）；conflict=源版本不满足全部约束（51-D-2 不装错）；
 *   satisfied=已装版本满足全部约束（幂等零动作）；install/replace=装/换（docs/43-§四）。
 * 与 IO 无关：installCompanyPlugins 组装真实源快照后委托本函数——决策唯一实现，语义与
 * spike 决策循环逐条等价（docs/44-§v1.1 机制二判定面）。
 */
export function planPluginInstalls(input: PluginPlanInput): PluginInstallItem[] {
  const demanded = demandedPlugins(input.deps, input.persons)
  const planned: PluginInstallItem[] = []
  for (const [name, required] of [...demanded.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const source = input.sources[name]
    if (source === undefined) {
      planned.push({
        name,
        required,
        origin: 'none',
        action: 'missing',
        detail: '缺源：公司包 plugins/ 无此插件且无外部源（PluginSource 接口已留位——docs/43-§十-7）',
      })
      continue
    }
    const specs = required.map(parseVersionSpec)
    const allValid = specs.every((s) => s !== null)
    const sourceOk = allValid && specs.every((s) => s !== null && satisfiesSpec(s, source.version))
    if (!sourceOk) {
      const currentVersion = input.installed[name]
      planned.push({
        name,
        required,
        origin: source.origin,
        action: 'conflict',
        sourceVersion: source.version,
        ...(currentVersion !== undefined ? { installedVersion: currentVersion } : {}),
        detail: `源版本 ${source.version} 不满足约束 ${required.join('、')}——不装错版本，如实上报（约束并集语义 docs/43-§十-6）`,
      })
      continue
    }
    const current = input.installed[name]
    if (current !== undefined && allValid && specs.every((s) => s !== null && satisfiesSpec(s, current))) {
      planned.push({
        name,
        required,
        origin: source.origin,
        action: 'satisfied',
        sourceVersion: source.version,
        installedVersion: current,
        detail: `已装 ${current} 满足全部约束——零动作`,
      })
      continue
    }
    planned.push({
      name,
      required,
      origin: source.origin,
      action: current === undefined ? 'install' : 'replace',
      sourceVersion: source.version,
      ...(current !== undefined ? { installedVersion: current } : {}),
      detail:
        current === undefined
          ? `从${source.origin === 'package' ? '公司包 plugins/' : '外部源'}安装 ${source.version}`
          : `已装 ${current} 不合约束，替换为 ${source.version}`,
    })
  }
  return planned
}

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
 * 公司包 plugins/<name>/ 源解析（51-D-4 形态闸——正式版收紧）：
 * 目录在位即要求合法 dsh 插件形态：package.json 的 name/version 齐备 + `dsh.bundle`
 * 声明（profile 层入场券，docs/34-§3.1）+ 所指 patch 文件在位；不符 → CONFIG_INVALID
 * （公司包内代码唯一例外=dsh 插件——docs/43-§四，形态不合法即包不合法）。无目录 →
 * null（缺源面归 missing/外部源）。spike 只查 name/version（docs/44 v0 边界注记）。
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
 * 依赖清单安装（docs/43-§四「框架替他安装」；安装=落位+登记——插件目录整体复制进隔离根，
 * dsh 侧 profile patch 指向隔离根即装载，insert 条目随插件 cordis.patch.yml 旅行：
 * docs/34-§3.1 两种装法的本地相对路径形态）。
 *
 * 无依赖清单 → 空报告（能力声明语义：无绑定面=零安装，仍留日志一行）。
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

/**
 * 配置指纹（docs/43-§十-8）：sha256(dependencies.yaml 原文 ‖ 排序后启用集投影)——
 * deps 内容与命中面任一变化都翻转指纹；排序保证投影与遍历序无关。
 */
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
 * 热重载同步：读 deps 原文与全员启用集 → 算指纹；与隔离根状态文件比对——
 * 指纹不变 → 零动作（不补装、不写状态、不出安装日志）；变化 → 重算+增量补装
 * （satisfied/install/replace/missing/conflict 全语义复用安装面）并落新状态。
 * 启用集收缩时已装插件保留（registry=追加事实，卸载语义归后续单——docs/43-§十-8）。
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
 * deps 域契约 subject：case 输入按键路由到引擎纯面——
 *   {parse: string} → parseDependencies；{enabled: {person, deps}} → enabledPluginsFor；
 *   {demanded: {deps, persons}} → demandedPlugins 投影；{satisfies: {pairs}} → 版本判定表；
 *   {plan: PluginPlanInput} → planPluginInstalls；{fingerprint: {deps, enabled}} → 指纹三态。
 * 安装执行面（隔离根落位/registry/log/confirm/failOnMissing/热重载）由 company 单测
 * dependencies.test.ts 承载——分工同 dir 域（CASES.md：契约断言语义，行号定位归单测）。
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
