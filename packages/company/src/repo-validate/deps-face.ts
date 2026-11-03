/**
 * repo-validate/deps-face —— D 组依赖面（D-1..D-4：dependencies.yaml + plugins/* 形态）
 *
 * 依据（实现单引用）：docs/51-§五 D 组；docs/17-§2/§6（相位与收割判据零变更——本件只做
 *   依赖判定）；docs/20-§十五.三（600 行阈：repo-validate.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只搬 depsFace 纯函数；判定入口与结果汇总仍在 repo-validate.ts。
 */
import {
  extractPersonAttrs,
  parsePlainVersion,
  planPluginInstalls,
  safeParseDependencies,
  type CompanyDependencies,
  type PluginInstallItem,
} from '../dependencies.ts'
import { DEPENDENCIES_FILE, type RepoValidateSummary, type RepoViolation } from './model.ts'

// ————————————————————————— 5. D 组（依赖面） —————————————————————————

export interface DepsFace {
  violations: RepoViolation[]
  conflicts: RepoValidateSummary['conflicts']
  capabilityMissing: RepoValidateSummary['capabilityMissing']
  deps: CompanyDependencies | null
}

export function depsFace(
  files: Record<string, string>,
  pluginEntries: readonly string[],
  orgSrcForPersons: string,
): DepsFace {
  const violations: RepoViolation[] = []
  const conflicts: RepoValidateSummary['conflicts'] = []
  const capabilityMissing: RepoValidateSummary['capabilityMissing'] = []

  // D-4：plugins/* 逐目录形态检查（不限于被绑定者——入仓插件必须个个成型）
  for (const name of pluginEntries) {
    const base = `plugins/${name}`
    const d4 = (location: string, problem: string, fix: string): void => {
      violations.push({ rule: 'D-4', file: base, location, problem, fix })
    }
    const pkgSrc = files[`${base}/package.json`]
    if (pkgSrc === undefined) {
      d4('package.json', '插件目录缺 package.json（dsh 插件形态——docs/34-§3.1）', `补 ${base}/package.json（name/version/main/dsh.bundle）或整目录移出 plugins/`)
      continue
    }
    let pkg: unknown
    try {
      pkg = JSON.parse(pkgSrc)
    } catch (err) {
      d4('package.json', `package.json 不是合法 JSON（${err instanceof Error ? err.message : String(err)}）`, '修 JSON 语法')
      continue
    }
    if (pkg === null || typeof pkg !== 'object') {
      d4('package.json', 'package.json 顶层须为对象', '改为 {"name","version","main","dsh.bundle"} 形态')
      continue
    }
    const rec = pkg as Record<string, unknown>
    if (typeof rec['name'] !== 'string' || rec['name'] === '') d4('package.json:name', '缺 name（非空串）', `补 "name"（约定=插件目录名 ${name}）`)
    if (typeof rec['version'] !== 'string' || parsePlainVersion(String(rec['version'])) === null) {
      d4('package.json:version', `version=${JSON.stringify(rec['version'])} 不是精确 x.y.z 版本`, '改为形如 1.0.0')
    }
    const dshRef = rec['dsh']
    const bundle = dshRef !== null && typeof dshRef === 'object' ? (dshRef as Record<string, unknown>)['bundle'] : undefined
    const patchRef = bundle !== null && typeof bundle === 'object' ? (bundle as Record<string, unknown>)['patch'] : undefined
    if (typeof patchRef !== 'string' || patchRef === '') {
      d4('package.json:dsh.bundle.patch', '缺 dsh.bundle.patch（字符串，指向仓内 patch 文件——嵌套 dsh.bundle 形态）', '补 "dsh": {"bundle": {"patch": "<file>.patch.yml"}} 并落盘该文件')
    } else {
      const patchRel = `${base}/${patchRef.replace(/^\.\//, '')}`
      if (files[patchRel] === undefined) d4(patchRel, 'dsh.bundle.patch 所指 patch 文件不在仓内', `补 ${patchRel}（含 insert 条目与 name: ./src/<入口>）`)
    }
  }

  // B-5/C-7/D-1/D-2/D-3：dependencies.yaml（可选件——缺场零绑定面，B-5 不违规）
  const depsSrc = files[DEPENDENCIES_FILE]
  if (depsSrc === undefined) return { violations, conflicts, capabilityMissing, deps: null }
  const parsed = safeParseDependencies(depsSrc)
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      const isAttr = issue.path.endsWith('.when.attr')
      const isVersion = issue.path.endsWith('.version')
      violations.push({
        rule: isAttr ? 'C-7' : isVersion ? 'D-1' : 'B-5',
        file: DEPENDENCIES_FILE,
        location: issue.path,
        problem: isAttr
          ? `when.attr 非法（${issue.message}——绑定域只收 role/dept/level/skills/executor/status）`
          : isVersion
            ? `version 约束非法（${issue.message}——只收 ^x.y(.z) 与精确两形态）`
            : `dependencies.yaml schema 违规（${issue.message}）`,
        fix: isAttr
          ? '改 when.attr 为六属性之一（role/dept/level/skills/executor/status）'
          : isVersion
            ? '改 version 为 ^1.2.3 或 1.2.3 形态（无 ~/>=/通配/*）'
            : '按 schema 修正 dependencies.yaml（strictObject——未知字段拒收）',
        via: `deps/invalid:${issue.path}`,
      })
    }
    return { violations, conflicts, capabilityMissing, deps: null }
  }

  // D-2 冲突警示 / D-3 能力缺失面（planPluginInstalls 决策面——installed 空=全新装视角；
  // org 面未过时传空串——persons 留空，B/C 组已先行指认，此处不重复报）
  const persons = orgSrcForPersons.trim() === '' ? [] : extractPersonAttrs(orgSrcForPersons)
  const sources: Record<string, { origin: 'package'; version: string }> = {}
  for (const name of pluginEntries) {
    const pkgSrc = files[`plugins/${name}/package.json`]
    if (pkgSrc === undefined) continue
    try {
      const pkg = JSON.parse(pkgSrc) as Record<string, unknown>
      if (typeof pkg['version'] === 'string') sources[name] = { origin: 'package', version: pkg['version'] }
    } catch {
      // D-4 已指认
    }
  }
  const items: PluginInstallItem[] = planPluginInstalls({ deps: parsed.data, persons, installed: {}, sources })
  for (const item of items) {
    if (item.action === 'conflict') conflicts.push({ name: item.name, required: item.required, detail: item.detail })
    else if (item.action === 'missing') capabilityMissing.push({ name: item.name, required: item.required, detail: item.detail })
  }
  return { violations, conflicts, capabilityMissing, deps: parsed.data }
}
