/**
 * dependencies/plan —— 安装决策纯面（零 IO：missing/conflict/satisfied/install/replace）
 *
 * 依据（实现单引用）：docs/43-§四/§十-6/§十-7（安装决策/约束并集/缺源双面）；docs/51-契约
 *   D-1..D-3；docs/08（纯逻辑纪律）；docs/17-§2/§6（相位与收割判据零变更）；
 *   docs/20-§十五.三（600 行阈：dependencies.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件零 IO、零落盘；安装执行/热重载仍在 dependencies.ts。
 */
import {
  demandedPlugins,
  parseVersionSpec,
  satisfiesSpec,
  type CompanyDependencies,
  type PersonAttrs,
} from './parse.ts'

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

/** 安装决策（纯函数）：missing=无源；conflict=源版本不满足全部约束（不装错）；satisfied=幂等；install/replace=装/换 */
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

