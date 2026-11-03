/**
 * repo-validate/layer-extras —— 判定器增补面（共享核未覆盖的 docs/51 值域/交叉引用）
 *
 * 依据（实现单引用）：docs/51-§三/§四（B/C 组值域与交叉引用）；docs/17-§2/§6（相位与收割
 *   判据零变更——本件只做内容判定）；docs/20-§十五.三（600 行阈：repo-validate.ts 拆件后
 *   原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只搬 layerExtras 纯函数；共享核映射（mapSharedIssue）与判定入口仍在 repo-validate.ts。
 */
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml'
import { lineOfPath } from '../multifile.ts'
import { DOCS51_SLUG_RE, ID_SEGMENT_RE, ORG_CONFIG_FILE, SEMVER_RE, type RepoViolation } from './model.ts'

/** 判定器增补面：共享核未覆盖的 docs/51 值域/交叉引用（slug/version/dist/唯一性/C-4 锚定/C-5/C-6/B-6） */
export function layerExtras(files: Record<string, string>, orgSrc: string, charterRef: string): RepoViolation[] {
  // 索引本位检查（形状/唯一性/值域/锚定）只依赖 org-config 可解析——不挂全局面成败：
  // 共享核先行指认结构/交叉问题，增补面照常补位（B-3 形状不因 C-4 先发而被吞）
  const lc = new LineCounter()
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(orgSrc, { lineCounter: lc })
  } catch {
    return [] // YAML 语法崩坏已由共享核 B-1 指认——增补面无从挂点
  }
  const raw = doc.toJS()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [] // 同上：结构面已指认
  const out: RepoViolation[] = []
  const lineAt = (keyPath: (string | number)[]): number => lineOfPath(doc, lc, keyPath)
  const company = ((raw as Record<string, unknown>)['company'] ?? {}) as Record<string, unknown>

  // B-1 slug 语法域（docs/51 小写正则；R4：判定器按规范正则收，严于 init 通道）
  const slug = typeof company['slug'] === 'string' ? company['slug'] : ''
  if (!DOCS51_SLUG_RE.test(slug)) {
    out.push({
      rule: 'B-1', file: ORG_CONFIG_FILE, location: `L${lineAt(['company', 'slug'])}`,
      problem: `company.slug="${slug}" 不在 slug 语法域（^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$——小写字母/数字/连字符，3-64 字符，两端不断字）`,
      fix: '改为全小写连字符 slug（例：demo-corp）',
    })
  }
  // R5 version：在场必须 semver 三元组
  if (company['version'] !== undefined && (typeof company['version'] !== 'string' || !SEMVER_RE.test(company['version']))) {
    out.push({
      rule: 'B-1', file: ORG_CONFIG_FILE, location: `L${lineAt(['company', 'version'])}`,
      problem: `company.version=${JSON.stringify(company['version'])} 不是 semver 三元组（x.y.z）`,
      fix: '改为形如 1.0.0 的 semver（迁移期可缺省该键）',
    })
  }
  // B-1 level_distribution：值=非负整数（docs/51-§三）
  const dist = (company['level_distribution'] ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(dist)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      out.push({
        rule: 'B-1', file: ORG_CONFIG_FILE, location: `company.level_distribution.${k}`,
        problem: `level_distribution["${k}"]=${JSON.stringify(v)}（值须为非负整数）`,
        fix: '改为非负整数（该档人数）',
      })
    }
  }

  const departments = Array.isArray(raw['departments']) ? (raw['departments'] as Record<string, unknown>[]) : []
  const people = Array.isArray(raw['people']) ? (raw['people'] as Record<string, unknown>[]) : []
  const jobs = Array.isArray(raw['jobs']) ? (raw['jobs'] as Record<string, unknown>[]) : []
  const deptPaths = new Set(departments.map((d) => String(d['path'] ?? '')))

  // B-3 工号：形状 + 全司唯一
  const seenIds = new Map<string, number>()
  people.forEach((p, i) => {
    const id = typeof p['id'] === 'string' ? p['id'] : ''
    if (!ID_SEGMENT_RE.test(id)) {
      out.push({
        rule: 'B-3', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'id'])}`,
        problem: `people[${i}].id="${id}" 不在工号语法形状域（字母/数字/连字符段，两端不断字——R3：大小写随全司惯例）`,
        fix: '改为 AGENT-1 形态工号',
      })
    }
    const first = seenIds.get(id)
    if (first !== undefined) {
      out.push({
        rule: 'B-3', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'id'])}`,
        problem: `工号 ${id} 重复（全司唯一；首见 people[${first}]）`,
        fix: `改 people[${i}].id 为未用工号`,
      })
    } else {
      seenIds.set(id, i)
    }
  })

  // B-4 jobs id 全司唯一
  const seenJobs = new Map<string, number>()
  jobs.forEach((j, i) => {
    const id = typeof j['id'] === 'string' ? j['id'] : ''
    const first = seenJobs.get(id)
    if (first !== undefined) {
      out.push({
        rule: 'B-4', file: ORG_CONFIG_FILE, location: `L${lineAt(['jobs', i, 'id'])}`,
        problem: `jobs[${i}].id="${id}" 重复（全司唯一；首见 jobs[${first}]）`,
        fix: '定时岗 id 改为全司唯一串',
      })
    } else {
      seenJobs.set(id, i)
    }
  })

  // C-4 file 路径锚定：在场必须恰为 <dept>/people/<工号>.md（docs/51-§三 B-3/C-4）
  people.forEach((p, i) => {
    if (p['file'] === undefined) return // 缺省由共享核推导（M2.2-②）
    const dept = String(p['dept'] ?? '')
    const id = String(p['id'] ?? '')
    if (p['file'] !== `${dept}/people/${id}.md`) {
      out.push({
        rule: 'C-4', file: ORG_CONFIG_FILE, location: `L${lineAt(['people', i, 'file'])}`,
        problem: `people[${i}].file=${JSON.stringify(p['file'])} 与锚定位 ${dept}/people/${id}.md 不一致`,
        fix: `改为 ${dept}/people/${id}.md（或删 file 键走缺省推导）`,
      })
    }
  })

  // C-6 parent：悬空（不在 departments[].path 索引）或成环（链走不终于 null）
  departments.forEach((d, i) => {
    const parent = d['parent']
    if (parent === null || parent === undefined) return
    const parentPath = String(parent)
    if (!deptPaths.has(parentPath)) {
      out.push({
        rule: 'C-6', file: ORG_CONFIG_FILE, location: `L${lineAt(['departments', i, 'parent'])}`,
        problem: `departments[${i}].parent="${parentPath}" 悬空（不在 departments[].path 索引）`,
        fix: '改为已登记部门 path，或 null（根部门）',
      })
      return
    }
    const visited = new Set<string>([String(d['path'] ?? '')])
    let cursor: unknown = parent
    while (typeof cursor === 'string') {
      if (visited.has(cursor)) {
        out.push({
          rule: 'C-6', file: ORG_CONFIG_FILE, location: `L${lineAt(['departments', i, 'parent'])}`,
          problem: `departments[${i}].parent 链成环（${[...visited, cursor].join(' → ')}）`,
          fix: '部门树 parent 链必须终于 null（根部门）——断环',
        })
        return
      }
      visited.add(cursor)
      const node = departments.find((x) => String(x['path'] ?? '') === cursor)
      if (node === undefined) break // 悬空由上方单检指认
      cursor = node['parent']
    }
  })

  // C-5 双清单互检：org-config jobs ↔ 部门 config jobs（双向）
  const rootDept = departments.find((d) => d['parent'] === null) ?? departments[0]
  const orgJobIds = new Set(jobs.map((j) => String(j['id'] ?? '')))
  const configJobs = new Map<string, string[]>()
  for (const d of departments) {
    const p = String(d['path'] ?? '')
    const src = files[`${p}/config.yaml`]
    if (src === undefined) continue // dept/dangling 由共享核指认（A-2）
    try {
      const parsed = parseYaml(src) as Record<string, unknown>
      if (Array.isArray(parsed['jobs'])) {
        configJobs.set(p, parsed['jobs'].filter((x): x is string => typeof x === 'string'))
      }
    } catch {
      continue // dept config YAML 语法错由共享核指认
    }
  }
  for (const j of jobs) {
    const id = String(j['id'] ?? '')
    const dept = typeof j['dept'] === 'string' ? j['dept'] : String(rootDept?.['path'] ?? '')
    const list = configJobs.get(dept)
    if (list === undefined || !list.includes(id)) {
      out.push({
        rule: 'C-5', file: `${dept}/config.yaml`, location: 'jobs',
        problem: `org-config jobs 岗位 "${id}" 挂靠 ${dept}，但其部门 config jobs 清单未收录（${list === undefined ? '清单缺失' : `现清单 [${list.join(', ')}]`}）`,
        fix: `在 ${dept}/config.yaml jobs 清单补 "${id}"（双清单必须一致）`,
      })
    }
  }
  for (const [dept, list] of configJobs) {
    for (const id of list) {
      if (!orgJobIds.has(id)) {
        out.push({
          rule: 'C-5', file: `${dept}/config.yaml`, location: 'jobs',
          problem: `部门 config jobs 清单含 "${id}"，但 org-config.yaml jobs 段无此岗`,
          fix: `补 org-config jobs 段该岗，或从 ${dept}/config.yaml 清单移除`,
        })
      }
    }
  }

  // B-6 charter 与 prompts/ 非空文本
  const charterSrc = files[charterRef]
  if (charterSrc !== undefined && charterSrc.trim() === '') {
    out.push({
      rule: 'B-6', file: charterRef, location: 'L1',
      problem: `章程文件 ${charterRef} 为空（charter 与 prompts/ 须非空文本）`,
      fix: '补章程正文（空文件不算章程）',
    })
  }
  for (const [rel, src] of Object.entries(files)) {
    if (rel.startsWith('prompts/') && src.trim() === '') {
      out.push({
        rule: 'B-6', file: rel, location: 'L1',
        problem: `prompts/ 片段 ${rel} 为空文件`,
        fix: '补提示词片段正文或删除该文件',
      })
    }
  }
  return out
}
