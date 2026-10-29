/**
 * assembly/api/readers —— API 只读投影读取器（公司快照投影；零库零平台）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（API-01..09 只读族：GET 全走只读投影；「API 进程零库零平台」；
 *     people 默认只出聚合；finance 三源缺一=unknown 段不补 0；reports 只出清单；
 *     跨公司读写同一解析规则）；
 *   - docs/v2/08 §4.1（未知不显示为零/空/绿——缺源一律 503，不以 0/空列表冒充）；
 *   - docs/v2/15 §三 SEC-WD-01（读面公司维隔离）、§五 SEC-RD-01（readScope/caller 随读）；
 *   - docs/v2/16 §三 api 行 / plan/05 IMPL-06-06（装配注入 readers；api 包不造第二读源）。
 *
 * 供给面（本件只做「公司快照 → API 视图」的投影，不新增端口/记录类）：
 *   - company/org/people/projects ＝ 公司快照投影（`CompanySnapshot`，daemon 内存对象）；
 *   - issues/finance/reports/agentCard ＝ **undefined**：零库前提下本进程没有单据投影、
 *     财务三源、报表根与名片定义——读源未命中由路由映射 **503**（`view-unavailable`），
 *     **不补 0、不补空数组、不给绿**（NEG-MON-01 同判据）。
 *
 * 公司维校验（SEC-WD-01）：每个读取器先比 `rc.readScope.company` 与快照 slug；不一致
 * ＝根本不给投影（返回 undefined→503），不服务、不泄漏别家行。路由层另有 403 前置闸，
 * 两层同向 fail-closed（读源不假设调用方已校验）。
 *
 * 边界：
 *   - 只读：本文件零写面、零 IO、零库句柄（不 import store/localplatform/taiga/matrix）；
 *   - `obs` 列入装配契约＝读面同源 PORT-OBS（v2/14 §四）：本件只校其只读子口在场
 *     （缺方法＝装配错误，JS 调用面同拒）；当前投影取自公司快照，时钟/标识在本读取器
 *     没有消费点（财务窗口/名片有效期实现时由此取时——未实现前如实 503）；
 *   - 组织关系（DeptRelation 的 to/type/protocol）**不入投影**：API 视图槽是字符串数组，
 *     编码未在 v2/14 定义——不猜、不造第二语义源，登记为缺口（仅出部门平面事实）。
 */
import { configInvalid } from '@studio-next/contract'
import type { CompanySnapshot, ReadContext } from '@studio-next/contract'
import type {
  ApiCompanyView,
  ApiOrgDepartmentView,
  ApiOrgView,
  ApiPeopleGroup,
  ApiPeopleView,
  ApiProjectView,
  ApiReadSources,
} from '@studio-next/api'
import type { ApiObservationReadFace } from './inject.ts'

/** 有读源的只读面（启动行证据；顺序与端点族一致） */
export const API_READ_FACE_SERVED = ['company', 'org', 'people', 'projects'] as const

/**
 * 缺口只读面（**显式**：本进程无源，路由 503；不以 0/空冒充）。
 * 启动行逐项打印——「哪几个面没源」是可直接读出的数字，不是靠人记得住的纪律。
 */
export const API_READ_FACE_GAPS = ['issues', 'finance', 'reports', 'agentCard'] as const

/** 缺口原因（逐面一行，进启动日志与测试断言；无秘密值） */
export const API_READ_FACE_GAP_REASONS: Readonly<Record<(typeof API_READ_FACE_GAPS)[number], string>> = Object.freeze({
  issues: '零库：无单据投影源',
  finance: '财务三源（预算/事件/月报）未接，unknown 不补 0',
  reports: '报表根未供给',
  agentCard: '公司定义名片未供给（版本/有效期不伪造）',
})

/** PORT-OBS 只读四方法（读面同源端口的在场校验；写槽 reportFault 不在内） */
const OBS_READ_METHODS = ['snapshot', 'clock', 'newId', 'health'] as const

/** 读面同源端口在场闸（装配期一次；缺方法＝半面启动，拒） */
function assertReadFace(obs: ApiObservationReadFace): void {
  for (const method of OBS_READ_METHODS) {
    if (typeof obs[method] !== 'function') {
      configInvalid(
        'api/readers:obs-shape',
        `读面同源 PORT-OBS 缺只读方法 ${method}（API 读取器不接受无读面端口的装配；v2/14 §四）`,
      )
    }
  }
}

/**
 * 公司维比对（slug 或 companyId 任一命中即同维）。
 * 装配面以快照 slug 为唯一公司维锚：V2 公司身份表落位前 companyId 与 slug 同值（装配侧
 * 以 `config.company` 两侧同填），故此处两槽都按 slug 比对。
 */
function sameCompany(rc: ReadContext, slug: string): boolean {
  const scope = rc.readScope.company
  return scope.slug === slug || scope.companyId === slug
}

/** 分组计数（键排序稳定输出——同一快照两次请求字节一致） */
function groupCounts(values: readonly string[], numeric: boolean): ApiPeopleGroup[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const keys = [...counts.keys()]
  keys.sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }))
}

/** 部门父子关系（悬空/成环如实入 warnings：不静默补链、不隐藏） */
function orgWarnings(departments: CompanySnapshot['departments']): string[] {
  const warnings: string[] = []
  const paths = new Set(departments.map((dept) => dept.path))
  const dangling = departments.filter((dept) => dept.parent !== null && !paths.has(dept.parent))
  if (dangling.length > 0) {
    warnings.push(
      `悬空父引用（parent 不在部门集，不补链）：${dangling.map((dept) => `${dept.path}→${String(dept.parent)}`).join('、')}`,
    )
  }
  // 从根（parent=null 或悬空父）按子边可达集；不可达＝成环（或挂在环下）
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const dept of departments) {
    if (dept.parent === null || !paths.has(dept.parent)) {
      roots.push(dept.path)
      continue
    }
    const siblings = children.get(dept.parent)
    if (siblings === undefined) children.set(dept.parent, [dept.path])
    else siblings.push(dept.path)
  }
  const reachable = new Set<string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const path = pending.pop()
    if (path === undefined || reachable.has(path)) continue
    reachable.add(path)
    for (const child of children.get(path) ?? []) pending.push(child)
  }
  const unreachable = departments.filter((dept) => !reachable.has(dept.path)).map((dept) => dept.path)
  if (unreachable.length > 0) {
    warnings.push(`parent 链成环（从根不可达，不补链）：${unreachable.join('、')}`)
  }
  return warnings
}

/**
 * 装配 API 只读投影读取器（`createApiApp` 的 `readers` 槽；八件齐全）。
 *
 * @param snapshot 本进程挂载公司的完整快照（daemon 唯一写入者的内存投影；只读消费）
 * @param obs      PORT-OBS 只读子口（读面同源端口；在场校验见 `assertReadFace`）
 */
export function buildApiReaders(snapshot: CompanySnapshot, obs: ApiObservationReadFace): ApiReadSources {
  assertReadFace(obs)
  const slug = snapshot.slug
  const depts = snapshot.departments
  const people = snapshot.people
  // 部门人数按快照人员 dept 聚合（无人员级明细出口——API-03 只出聚合）
  const headcount = new Map<string, number>()
  for (const person of people) headcount.set(person.dept, (headcount.get(person.dept) ?? 0) + 1)

  const readers: ApiReadSources = {
    company(rc: ReadContext): ApiCompanyView | undefined {
      if (!sameCompany(rc, slug)) return undefined
      return {
        // companyId 取挂载公司维自身（API 层已校验两槽同维；不另造公司身份）
        companyId: rc.readScope.company.companyId,
        slug,
        name: snapshot.name,
        platform: snapshot.platform.platform,
      }
    },

    org(rc: ReadContext): ApiOrgView | undefined {
      if (!sameCompany(rc, slug)) return undefined
      const departments: ApiOrgDepartmentView[] = depts.map((dept) => ({
        path: dept.path,
        name: dept.name,
        ...(dept.parent !== null ? { parent: dept.parent } : {}),
        headcount: headcount.get(dept.path) ?? 0,
      }))
      return { company: slug, departments, warnings: orgWarnings(depts) }
    },

    people(rc: ReadContext): ApiPeopleView | undefined {
      if (!sameCompany(rc, slug)) return undefined
      return {
        company: slug,
        total: people.length,
        byDepartment: groupCounts(
          people.map((person) => person.dept),
          false,
        ),
        byLevel: groupCounts(
          people.map((person) => String(person.level)),
          true,
        ),
        // status 未携带＝active 缺省语义（contract PersonRef 注：DEV-48 同款扩法）
        byStatus: groupCounts(
          people.map((person) => person.status ?? 'active'),
          false,
        ),
      }
    },

    projects(rc: ReadContext): readonly ApiProjectView[] | undefined {
      if (!sameCompany(rc, slug)) return undefined
      // 公司=项目（docs/30 §6 ③：taiga 项目 slug 即公司；单公司部署恒一张项目卡）。
      // totalIssues/byState 属单据投影——零库未接，**不补 0/空数组**（槽位直接不出现）。
      return [
        {
          company: slug,
          projectId: slug,
          name: snapshot.name,
          platform: snapshot.platform.platform,
        },
      ]
    },

    // —— 以下四面本进程无源：undefined→路由 503（`view-unavailable`），不补 0/空/绿 ——
    issues(): undefined {
      return undefined
    },

    finance(): undefined {
      return undefined
    },

    reports(): undefined {
      return undefined
    },

    agentCard(): undefined {
      return undefined
    },
  }
  return Object.freeze(readers)
}
