/**
 * dependencies/parse —— dependencies.yaml schema/解析、员工属性绑定、版本约束与版本并集
 *
 * 依据（实现单引用）：docs/43-§四/§十-5/6（依赖清单与插件绑定、绑定域封闭枚举、两形态版本）；
 *   docs/51-契约 D（D-1..D-4）与 C-7；docs/17-§2/§6（相位与收割判据零变更——本件只做解析/
 *   纯求值）；docs/20-§十五.三（600 行阈：dependencies.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件零 IO 副作用（readDependencies 只读一个契约文件）；安装执行/热重载/资产判定仍在
 *   dependencies.ts。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
 * 非抛解析面（DEV-32 公司仓库判定器消费）：返回逐条 `{path, message}` issue（不抛
 * CONFIG_INVALID），判定器据此把 C-7/D-1/B-5 违规定位到键路径；schema 仍单源。
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

/** 属性候选值（docs/43-§十-5）：dept=path 全量+末段名双候选；skills 逐元素；其余单值 */
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

/** 全员需求汇总（docs/43-§十-6）：插件名 → 全部命中约束原文（去重保序——约束并集输入） */
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

/** 版本判定：exact=三项等值；caret=同 major 下界闭开区间，^0.x 锁 minor、^0.0 锁 patch（51-D-1） */
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

export interface VersionUnionResolution {
  ok: boolean
  satisfying: string[]
  conflict?: string
}

/** 版本并集：任一约束无解/无候选即 conflict 如实上报（不装错版本——51-D-1/D-2） */
export function resolveVersionUnion(specs: readonly string[], available: readonly string[]): VersionUnionResolution {
  const parsed = specs.map(parseVersionSpec)
  const invalid = specs.filter((_, index) => parsed[index] === null)
  if (invalid.length > 0) return { ok: false, satisfying: [], conflict: `版本约束形态不支持：${invalid.join('、')}` }
  const satisfying = [...new Set(available)]
    .filter((version) => parsed.every((spec) => spec !== null && satisfiesSpec(spec, version)))
    .sort(compareVersions)
  return satisfying.length > 0
    ? { ok: true, satisfying }
    : { ok: false, satisfying: [], conflict: `无候选满足全部约束 ${specs.join('、')}（候选：${available.join('、') || '无'}）` }
}

function compareVersions(a: string, b: string): number {
  const pa = parsePlainVersion(a)
  const pb = parsePlainVersion(b)
  if (pa === null || pb === null) return a < b ? -1 : a > b ? 1 : 0
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch
}

/**
 * 必备资产判定（v2/06 §3.4）：缺则二选一，无第三态。缺省拒绝（fail-closed）；降级须接收方
 * 部署者具名选择并留痕（actor/note 非空），否则拒——禁止静默降级、禁止默认可用。
 */
