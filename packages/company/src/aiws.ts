/**
 * aiws —— .AIWS 员工工作区树正式化（DEV-28；docs/43-§五 冻结 spec v1.1 + §十9 根归属定案）
 *
 * 职责（自 git-import.ts 迁出并升级——建树只是第一步，本模块补齐 §五 全语义）：
 *   1. **建树同构**：`.AIWS/<部门路径>/<工号>/` 镜像 org-config 组织结构；部门文件夹先建
 *      （无人部门也有），员工文件夹挂其 dept.path 下；幂等（重复 ensure 零新建零归档）。
 *   2. **per-company 根守卫（§十9 不并树）**：根目录归属标记 `.studio-next.json`
 *      （slug + claimed_at，daemon 自管）——首建写标记；同 slug 放行；异 slug
 *      CONFIG_INVALID fail-closed（两家公司共用一根=并树，结构性拒绝，不靠约定）；
 *      无标记的既有树（DEV-27 mkdir-only 产物）收养补标记。
 *   3. **增量同步（随人事热重载，§五「建司即建+人事变树变」）**：org 快照 vs 磁盘树 diff——
 *      新部门/新员工 → mkdir；消失的员工/部门目录 → **改名归档不删**（内容原样保留，
 *      `<名>.archived-<时间戳>`，撞名加序号）；复职 → 新建空目录，归档仍在。
 *   4. **家保留（结构性）**：同步只管理到工号目录本身——person 目录**内部**永不下探
 *      （员工在自己文件夹里做任意事，docs/43-§五）；关单工位 `tickets/<单号>/att<N>/`
 *      在 person 目录内部，本模块因此永不触碰（原位归档语义归 engine recycle 相位）。
 *
 * 排除面（.AIWS 不进指纹与监听）单源表见 init.ts `SCAN_EXCLUDED_NAMES`。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'

/** 根归属标记文件名（.AIWS 根下；daemon 自管面——与信任锚目录 .studio-next/ 同命名域） */
const OWNER_MARKER = '.studio-next.json'

/** 归档名后缀（`<名>.archived-<epoch-ms>[-<序号>]`——匹配者不再二动、不算活） */
const ARCHIVED_RE = /\.archived-\d+(-\d+)?$/

export interface AiwsEnsureOptions {
  /**
   * 公司 slug——给出即启用 per-company 根守卫（§十9 不并树）：异 slug 拒、无标记收养。
   * 缺省不读写标记（旧调用面行为兼容）；正式链路（serve/git-import/create）恒给出。
   */
  slug?: string
  /** 归档时间戳注入（缺省墙钟；serve 侧注 daemon clock，测试注确定性） */
  now?: () => Date
}

export interface AiwsTreeResult {
  /** .AIWS 根（入参回显） */
  root: string
  /** 工号目录清单（rel posix，入参 people 序——同构镜像锚） */
  personDirs: string[]
  /** 本次新建的部门/工号目录数（幂等观测：重复 ensure 恒 0） */
  created: number
  /** 本次归档（改名未删）的目录清单（rel posix——离司/下线面，内容原样） */
  archived: string[]
}

/** 归档落点名：`<abs>.archived-<stamp>`，撞名追加序号（同毫秒多次归档不覆盖） */
function archiveTarget(abs: string, stamp: number): string {
  let target = `${abs}.archived-${stamp}`
  let n = 2
  while (existsSync(target)) {
    target = `${abs}.archived-${stamp}-${n}`
    n += 1
  }
  return target
}

/**
 * 建树+增量同步（幂等可重入；serve 启动与热重载拍边界、git-import/create 建司同口）。
 *
 * 活路径 = 部门路径 ∪ `<person.dept>/<person.id>`（rel posix）；结构层 = 活路径的真前缀。
 * 目录判定：活/含活 → 保留（结构层下探找离司项）；非活且非已归档 → 整树改名归档。
 * 文件（标记/README 等结构层散件）不动——结构管理只针对目录。
 */
export function ensureAiwsTree(
  aiwsRoot: string,
  departments: readonly { path: string }[],
  people: readonly { id: string; dept: string }[],
  opts?: AiwsEnsureOptions,
): AiwsTreeResult {
  const now = opts?.now ?? ((): Date => new Date())
  mkdirSync(aiwsRoot, { recursive: true })

  // —— per-company 根守卫（§十9）：标记先行——异家根拒收，无标记树收养补记 ——
  if (opts?.slug !== undefined) {
    const markerPath = path.join(aiwsRoot, OWNER_MARKER)
    if (existsSync(markerPath)) {
      let owner: { slug?: unknown } | null = null
      try {
        owner = JSON.parse(readFileSync(markerPath, 'utf8')) as { slug?: unknown }
      } catch {
        configInvalid('aiws/owner-marker', `根归属标记不可解析（${markerPath}）——无法判定归属，fail-closed`)
      }
      if (owner === null || typeof owner !== 'object' || typeof owner.slug !== 'string') {
        configInvalid('aiws/owner-marker', `根归属标记缺 slug 字段（${markerPath}）——无法判定归属，fail-closed`)
      }
      if (owner.slug !== opts.slug) {
        configInvalid(
          'aiws/root-owned',
          `.AIWS 根已被 ${String(owner.slug)} 占用（${aiwsRoot}），本司 slug=${opts.slug}——per-company 不并树（docs/43-§十9）`,
        )
      }
    } else {
      writeFileSync(markerPath, `${JSON.stringify({ slug: opts.slug, claimed_at: now().toISOString() }, null, 2)}\n`, 'utf8')
    }
  }

  // —— 建树（同构 mkdir；created=实际新建数——幂等观测） ——
  const personDirs: string[] = []
  const liveAll = new Set<string>() // 部门路径 ∪ 工号目录（rel posix）
  const personDirSet = new Set<string>() // 工号目录（下探禁区=家内部）
  let created = 0
  for (const dept of departments) {
    if (dept.path === '') continue
    const abs = path.join(aiwsRoot, ...dept.path.split('/'))
    if (!existsSync(abs)) created += 1
    mkdirSync(abs, { recursive: true })
    liveAll.add(dept.path)
  }
  for (const person of people) {
    const rel = [...person.dept.split('/'), person.id].join('/')
    const abs = path.join(aiwsRoot, ...rel.split('/'))
    if (!existsSync(abs)) created += 1
    mkdirSync(abs, { recursive: true })
    personDirs.push(rel)
    personDirSet.add(rel)
    liveAll.add(rel)
    // person.dept 可能不是 departments 里的部门（校验面保证属于，此处不依赖）：其路径本身即活结构
    liveAll.add(person.dept)
  }

  // —— 增量同步：非活目录改名归档（不删）；家内部（person 目录之下）永不下探 ——
  const archived: string[] = []
  /** childRel 是活路径，或是某活路径的真前缀（内含活物 → 必须保留并下探） */
  const isLiveOrPrefix = (childRel: string): boolean => {
    if (liveAll.has(childRel)) return true
    for (const live of liveAll) {
      if (live.startsWith(`${childRel}/`)) return true
    }
    return false
  }
  const walk = (abs: string, rel: string): void => {
    const entries = readdirSync(abs, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (!entry.isDirectory() || ARCHIVED_RE.test(entry.name)) continue
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (!isLiveOrPrefix(childRel)) {
        renameSync(path.join(abs, entry.name), archiveTarget(path.join(abs, entry.name), now().getTime()))
        archived.push(childRel)
        continue
      }
      if (!personDirSet.has(childRel)) walk(path.join(abs, entry.name), childRel) // 工号目录=家，不下探
    }
  }
  walk(aiwsRoot, '')

  return { root: aiwsRoot, personDirs, created, archived }
}
