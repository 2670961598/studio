/**
 * workspace-tree —— 常驻角色工作目录树（studio-dev-723；计划编号 725；docs/90-§八）
 *
 * 定位（制作人 2026-11-04 批）：`<companyRoot>/workspaces`（与 `company/` 平级、**不进 git**）。
 * 「工作结果是缓存/状态，公司定义是规范」：架构/设计/依赖进 git（company/），运行缓存进
 * workspaces/（非权威、可重建）。与 `.AIWS` 分工：`.AIWS`=单次执行证据沙盒（tickets/att<N>，
 * 归档不删），workspaces=常驻角色家（agent.md/memory.md/docs/work）。
 *
 * 结构：`workspaces/<dept path>/<reportsTo 链…>/<personId>/{agent.md,memory.md,docs/,work/}`
 *   - 组员目录是组长子目录；根目录归属标记 `.studio-next.json`（slug）；异 slug fail-closed；
 *   - 幂等：重复 ensure 零新建/零归档；新增文件（agent.md/memory.md）只在缺省时写，绝不覆盖；
 *   - 增量：离司/下线人员的**整目录改名归档不删**（`<名>.archived-<epoch-ms>[-n]`），内容原样；
 *   - 家保留：本模块只建结构与管理到 person 目录本身；person 目录内部（docs/work/memory）永不下探清理；
 *   - 路径逃逸守卫：部门/工号段拒绝空段/`.`/`..`/斜杠/反斜杠（fail-closed，不猜）。
 *
 * 边界：不写 secrets/证据/台账；不进公司 git；不回写 company/；不做 prompt 注入（归 726/727）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'

/** 工作目录树根目录名（与 company/ 平级） */
export const WORKSPACES_DIR = 'workspaces'
/** 根归属标记（daemon 自管面；与 .AIWS 同命名域） */
const OWNER_MARKER = '.studio-next.json'
const ARCHIVED_RE = /\.archived-\d+(-\d+)?$/

export interface WorkspacePerson {
  readonly id: string
  readonly dept: string
  /** 汇报线（上级工号；缺省/null=部门根，取部门 leader 作父若不等于本人） */
  readonly reportsTo?: string | null
  readonly name?: string
  readonly role?: string
}

export interface WorkspaceDepartment {
  readonly path: string
  readonly leader: string
}

export interface WorkspaceEnsureOptions {
  /** 公司 slug——给出即启用根归属守卫；异 slug 拒（不并树） */
  readonly slug?: string
  /** 归档/标记时间（缺省墙钟；测试注确定性） */
  readonly now?: () => Date
}

export interface WorkspaceTreeResult {
  readonly root: string
  /** 工号目录（rel posix；按输入 people 序） */
  readonly personDirs: string[]
  /** 本次新建目录数（幂等观测：重复 ensure 恒 0） */
  readonly created: number
  /** 本次归档（改名未删）目录清单（rel posix） */
  readonly archived: string[]
}

/** 单段路径守卫（拒绝空/点段/分隔符/盘符；不猜） */
function safeSegment(segment: string, what: string): string {
  if (segment === '' || segment === '.' || segment === '..' || /[\\/]/.test(segment) || /^[A-Za-z]:/.test(segment)) {
    configInvalid('workspace-tree/unsafe-segment', `${what} 非法路径段（空/. /../分隔符/盘符均拒）：${JSON.stringify(segment)}`)
  }
  return segment
}

/** 多段相对路径守卫（部门 path：`departments/研发部`） */
function safeRelPath(rel: string, what: string): string[] {
  if (rel === '' || path.isAbsolute(rel)) configInvalid('workspace-tree/unsafe-path', `${what} 须为相对路径：${rel}`)
  return rel.split('/').map((segment) => safeSegment(segment, what))
}

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
 * 归档候选扫描：结构层目录 + 「角色家」目录（直接含 agent.md 的目录）。
 * 家内部 docs/work 等普通子目录**不是候选**（家内部永不下探清理）；但家内嵌套的组长/组员
 * 家（含 agent.md）要递归找到，才能在离司时整树归档。
 */
function listDirs(root: string): string[] {
  const out: string[] = []
  const walk = (abs: string, rel: string, insideHome: boolean): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (ARCHIVED_RE.test(entry.name) || entry.name.startsWith('.')) continue
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      const childAbs = path.join(abs, entry.name)
      const isHome = existsSync(path.join(childAbs, 'agent.md'))
      if (isHome) {
        out.push(childRel)
        walk(childAbs, childRel, true)
        continue
      }
      if (!insideHome) {
        out.push(childRel)
        walk(childAbs, childRel, false)
        continue
      }
      // 家内部：只递归找嵌套的角色家；docs/work 等普通内部目录不扫描/不归档
      walk(childAbs, childRel, true)
    }
  }
  walk(root, '', false)
  return out
}

function writeIfAbsent(file: string, content: string): void {
  if (!existsSync(file)) writeFileSync(file, content, 'utf8')
}

function agentTemplate(person: WorkspacePerson, parent: string | null): string {
  return [
    `# ${person.id} · ${person.name ?? person.id}`,
    '',
    `- 工号：${person.id}`,
    `- 部门：${person.dept}`,
    `- 汇报：${parent ?? '（部门根）'}`,
    `- 岗位：${person.role ?? '（未声明）'}`,
    '',
    '> 常驻角色家（workspaces；非权威缓存，架构/设计/依赖以 company/ git 为准）。',
    '> 本文件由 daemon 初始化，可被角色维护；memory.md 记录长期记忆。',
    '',
  ].join('\n')
}

/**
 * 建树 + 增量同步（幂等可重入；daemon 启动/热重载调用）。
 * 抛错＝调用方 apply/启动失败（fail-closed，不留半树）。
 */
export function ensureWorkspaceTree(
  workspacesRoot: string,
  departments: readonly WorkspaceDepartment[],
  people: readonly WorkspacePerson[],
  opts: WorkspaceEnsureOptions = {},
): WorkspaceTreeResult {
  const now = opts.now ?? ((): Date => new Date())
  mkdirSync(workspacesRoot, { recursive: true })

  // 根归属守卫
  if (opts.slug !== undefined) {
    const markerPath = path.join(workspacesRoot, OWNER_MARKER)
    if (existsSync(markerPath)) {
      let owner: { slug?: unknown } | null = null
      try {
        owner = JSON.parse(readFileSync(markerPath, 'utf8')) as { slug?: unknown }
      } catch {
        configInvalid('workspace-tree/owner-marker', `根归属标记不可解析（${markerPath}）——fail-closed`)
      }
      if (owner === null || typeof owner !== 'object' || typeof owner.slug !== 'string') {
        configInvalid('workspace-tree/owner-marker', `根归属标记缺 slug（${markerPath}）——fail-closed`)
      }
      if (owner.slug !== opts.slug) {
        configInvalid('workspace-tree/root-owned', `工作目录树已被 ${String(owner.slug)} 占用（${workspacesRoot}），本司 slug=${opts.slug}——不并树`)
      }
    } else {
      writeFileSync(markerPath, `${JSON.stringify({ slug: opts.slug, kind: 'workspaces', claimed_at: now().toISOString() }, null, 2)}\n`, 'utf8')
    }
  }

  const deptLeader = new Map<string, string>()
  for (const dept of departments) {
    safeRelPath(dept.path, '部门 path')
    deptLeader.set(dept.path, dept.leader)
  }
  const personById = new Map(people.map((person) => [person.id, person]))

  /** 汇报链（同部门内向上；跨部门/缺失/成环→部门 leader/根；恒有界） */
  const parentOf = (person: WorkspacePerson): string | null => {
    const seen = new Set<string>([person.id])
    let current = person
    for (;;) {
      const declared = current.reportsTo ?? null
      const candidate = declared !== null ? personById.get(declared) : undefined
      if (candidate !== undefined && candidate.dept === person.dept && !seen.has(candidate.id)) {
        return candidate.id
      }
      const leader = deptLeader.get(person.dept)
      if (leader !== undefined && leader !== person.id && personById.get(leader)?.dept === person.dept) {
        return leader
      }
      return null
    }
  }

  const relOf = (person: WorkspacePerson): string => {
    const segments = safeRelPath(person.dept, '部门 path')
    const chain: string[] = []
    const seen = new Set<string>()
    let cursor: WorkspacePerson | undefined = person
    while (cursor !== undefined) {
      if (seen.has(cursor.id)) break
      seen.add(cursor.id)
      chain.unshift(cursor.id)
      const parentId = parentOf(cursor)
      cursor = parentId !== null ? personById.get(parentId) : undefined
    }
    for (const segment of chain) safeSegment(segment, '工号')
    return [...segments, ...chain].join('/')
  }

  const personDirs: string[] = []
  const live = new Set<string>()
  let created = 0
  const ensureDir = (rel: string): void => {
    const abs = path.join(workspacesRoot, ...rel.split('/'))
    if (!existsSync(abs)) created += 1
    mkdirSync(abs, { recursive: true })
  }
  for (const person of people) {
    const rel = relOf(person)
    ensureDir(rel)
    personDirs.push(rel)
    // 结构层（部门路径/祖先链）登记为 live——归档时不得整树误归档
    let prefix = ''
    for (const segment of rel.split('/')) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      live.add(prefix)
    }
    const abs = path.join(workspacesRoot, ...rel.split('/'))
    const parentId = parentOf(person)
    writeIfAbsent(path.join(abs, 'agent.md'), agentTemplate(person, parentId))
    writeIfAbsent(path.join(abs, 'memory.md'), `# memory · ${person.id}\n\n> 长期记忆（常驻家；变更建议走审计）。\n`)
    for (const dir of ['docs', 'work']) mkdirSync(path.join(abs, dir), { recursive: true })
  }

  // 归档：非 live 且非 live 前缀的目录整树改名（不删）；按深度升序先处理父目录
  const archived: string[] = []
  const stale = listDirs(workspacesRoot)
    .filter((rel) => !live.has(rel) && ![...live].some((item) => item.startsWith(`${rel}/`)))
    .sort((a, b) => a.split('/').length - b.split('/').length)
  const archivedSet = new Set<string>()
  const stamp = now().getTime()
  for (const rel of stale) {
    if ([...archivedSet].some((done) => rel.startsWith(`${done}/`))) continue
    const abs = path.join(workspacesRoot, ...rel.split('/'))
    const target = archiveTarget(abs, stamp)
    renameSync(abs, target)
    archivedSet.add(rel)
    archived.push(rel)
  }
  return { root: workspacesRoot, personDirs, created, archived }
}
