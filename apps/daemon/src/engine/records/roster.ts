/**
 * engine/records/roster —— 公司目录名册端口（任职/授权链派生的唯一事实源）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表；本件供相位 0 启动装载／
 *     人事变更、相位 3 派发前权源、相位 4 收割）；
 *   - docs/v2/11 §3.1（REC-LIFE-01 任命五条件／幂等四元组、REC-LIFE-04 出工必引生效任命）、
 *     §2.2（REC-AUTH-01 授予边：目的/对象/范围含不可为边界/期限/退出）、§十五-2（跨记录不变量）；
 *   - docs/v2/05 §四 PORT-HR（人事事实唯一事实源＝公司目录，daemon 只做镜像投影）；
 *   - docs/04-§二／docs/52（people/departments 镜像口径：people 五字段＋扩展列、departments 全列）。
 *
 * 纪律（「自填即拒」的机制面，v2/11 §七 独立性）：
 *   - 本件**只读**目录镜像（`ledger.listPeople()/listDepartments()` 注入），不接收任何调用方给的
 *     任职/授权事实：写面入参只有「时刻」与「工号」，事实一律由此处派生——调用方没有可填的字段；
 *   - 目录缺件（无在岗、无部门、无主管、自指汇报）＝**派生失败**，写面按 `record-prereq-missing`
 *     拒写，不用缺省值补造（缺省值会把「不知道」写成「事实」）；
 *   - 名册是**镜像投影**（docs/17-§3）：权威源＝公司目录 people/departments 与其 config.yaml。
 */
import type { DepartmentRecord, PersonRecord } from '@studio-next/store'

/** 在岗状态字面（people.status 空＝未登记状态——按「在岗」处理并如实记入证明边界） */
export const ROSTER_ON_DUTY_STATUSES = ['active'] as const

/**
 * 外部老板标识（框架常量，非调用方可填）：公司目录 charter.md 第四条「制作人保留权力」——
 * 根授予（REC-AUTH-01 grant_class=root_delegation）只能由该外部主体签发（v2/11 §2.2/§十五-2）。
 * 本常量只承载**身份引用**，不承载任何密钥值（v2/15 §七：秘密值不入库/日志）。
 */
export const EXTERNAL_OWNER = {
  refId: 'external-owner:producer',
  refVersion: '1.0.0',
  label: '制作人',
} as const

/** 名册人员（目录镜像五字段＋扩展列；person_id 即工号） */
export interface RosterPerson {
  readonly id: string
  readonly name: string
  readonly login: string
  readonly level: number
  readonly dept: string
  readonly role?: string
  /** people.status；缺省＝未登记（不做「非在岗」推定，见 isOnDuty） */
  readonly status?: string
}

/** 名册部门（departments 全列镜像） */
export interface RosterDept {
  readonly path: string
  readonly leader: string
  readonly functions: readonly string[]
  readonly lanes: readonly string[]
  readonly parentPath?: string
}

/** 名册快照（一次派生取一份；不跨拍缓存——目录变更即下一拍生效） */
export interface CompanyRoster {
  readonly people: readonly RosterPerson[]
  readonly departments: readonly RosterDept[]
}

/** 名册端口：只读函数（装配面注入 `ledger` 读取；测试注入内存快照） */
export interface RosterPort {
  roster(): CompanyRoster
}

/** store 行 → 名册（缺必填列即抛——镜像坏行不得当事实用） */
export function rosterOf(people: readonly PersonRecord[], departments: readonly DepartmentRecord[]): CompanyRoster {
  return {
    people: people.map((row) => ({
      id: row.person_id,
      name: row.name,
      login: row.login,
      level: row.level,
      dept: row.dept,
      ...(row.role !== undefined ? { role: row.role } : {}),
      ...(row.status !== undefined ? { status: row.status } : {}),
    })),
    departments: departments.map((row) => ({
      path: row.path,
      leader: row.leader,
      functions: row.functions,
      lanes: row.lanes,
      ...(row.parent_path !== undefined ? { parentPath: row.parent_path } : {}),
    })),
  }
}

/** 在岗判定：status 未登记按在岗（如实记入证明边界），显式非 active 一律非在岗 */
export function isOnDuty(person: RosterPerson): boolean {
  if (person.status === undefined || person.status === '') return true
  return (ROSTER_ON_DUTY_STATUSES as readonly string[]).includes(person.status)
}

/** 工号取人（缺＝undefined，不造人） */
export function personOf(roster: CompanyRoster, personId: string): RosterPerson | undefined {
  return roster.people.find((person) => person.id === personId)
}

/** 部门 path 取部门（缺＝undefined） */
export function deptOf(roster: CompanyRoster, path: string): RosterDept | undefined {
  return roster.departments.find((dept) => dept.path === path)
}

/** 根部门（parent 缺省或 null；L3 公司通常 1–2 个一级单元） */
export function rootDeptsOf(roster: CompanyRoster): RosterDept[] {
  return roster.departments.filter((dept) => dept.parentPath === undefined || dept.parentPath === '')
}

/**
 * 顶位（最高宰相）裁决：根部门主管中等级最高者；等级并列时取职能含「管理」的部门主管
 * （docs/04-§二 编制口径；公司目录不镜像 reports_to，故裁决规则在此显式登记——缺口见 plan §6-2）。
 * 仍并列（两主管部门同等级且都含「管理」）＝无法裁决，返回 undefined → 写面拒写（不猜）。
 */
export function topPersonOf(roster: CompanyRoster): RosterPerson | undefined {
  const candidates = rootDeptsOf(roster)
    .map((dept) => ({ dept, person: personOf(roster, dept.leader) }))
    .filter((row): row is { dept: RosterDept; person: RosterPerson } => row.person !== undefined)
  if (candidates.length === 0) return undefined
  const rank = (row: { dept: RosterDept; person: RosterPerson }): number =>
    row.person.level * 10 + (row.dept.functions.includes('管理') ? 1 : 0)
  const sorted = [...candidates].sort((a, b) => rank(b) - rank(a))
  const [first, second] = sorted
  if (first === undefined) return undefined
  if (second !== undefined && rank(first) === rank(second)) return undefined
  return first.person
}

/** 位置键（position_ref.refId 派生）：<部门 path>/<岗位名>；岗位名取 person.role，缺省＝'成员' */
export function positionRefIdOf(person: RosterPerson): string {
  const role = person.role !== undefined && person.role !== '' ? person.role : '成员'
  return `position:${person.dept}:${role}`
}

/** 人员引用（ObjectRef；「ID＋版本」，初始类型版本 1.0.0） */
export function personObjectRef(personId: string): { refId: string; refVersion: string } {
  return { refId: `person:${personId}`, refVersion: '1.0.0' }
}

