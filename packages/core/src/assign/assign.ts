// ▸ 落仓路径：packages/core/src/assign/assign.ts（新文件，全文照抄）
// ▸ 导出面：packages/core/src/index.ts 追加一行（见 edit-packages-core-src-index.ts.md）

/**
 * assign —— 自动派工分配器（纯函数；轨2 R1 登记项①，studio-dev-345；重生单原 336）
 *
 * 需求源：docs/optimizer/track2-org-design.md R1 登记项①（2026-11-01）——「自动派工
 * 分配器（round-robin/负载最小者——立单免指定 assignee）」；痛点：交付全压 ENG-1。
 *
 * 规则三件套（票面冻结）：在途最小者优先 / 同级轮转 / 并发帽。
 *   1. 部门过滤：dept 全等（跨部门不兜底——错人比不派更糟）；
 *   2. 在职过滤：status undefined=active（契约注释）；paused/retired 不派；
 *   3. 排除面（775/C2）：按工号/岗位排除候选（发布岗不得自动派工）——排除后空集=all-excluded；缺省不排除。
 *   4. 并发帽：inflight < limit；limit = overrides[人] ?? defaultLimit ?? 1，<1 视同 1
 *      （fail-closed；与人闸 personLimitFor 同公式——分配器与人闸共用一套帽）；
 *   5. 在途最小者优先：取过滤后 inflight 最小者的并列集；
 *   6. 同级轮转：并列集序 (level DESC, id ASC)——确定性（同输入必同输出，golden 可
 *      回放）；「同级」=等在途并列集（登记解释：轮转不绕开负载更轻者），游标
 *      cursor 在并列集内取位 tieSet[cursor % |tieSet|]。
 *
 * 游标前进时机归调用面（daemon 只在派发执行点成功写回后 +1 落 daemon_kv——落账
 * 纪律：决策不写账）；本函数无状态、无 IO、无时钟，纯计算可回放（core 纪律）。
 *
 * 失败闭集（fail-closed，调用面顺延不丢单）：no-people | dept-empty | no-active |
 * all-at-cap。失败永不回退「缺省人」——那正是本单要治的恒压病灶。
 *
 * 落位：core/src/assign/ 子目录（根平面已满 25 件阈 BC-S1，ring/ 先例）。
 */
import type { PersonRef } from '@studio-next/contract'

/** 并发帽来源（与人闸同源：daemon 侧 personLimits 直传；字段缺省=兜底 1） */
export interface AssignLimits {
  /** 按人覆盖表（daemon.yaml personInflightOverrides 解析产物） */
  overrides?: Readonly<Record<string, number>>
  /** 每人缺省帽（daemon.yaml maxInflightPerPerson；未配=1 串行） */
  defaultLimit?: number
}

/** 失败码闭集：no-people（索引空）| dept-empty（部门无人）| no-active（无在职）| all-at-cap（全在帽）| all-excluded（全员被排除） */
export type AssignFailCode = 'no-people' | 'dept-empty' | 'no-active' | 'all-at-cap' | 'all-excluded'

export type AssignPickResult =
  | { ok: true; personId: string; nextCursor: number; tieCount: number }
  | { ok: false; code: AssignFailCode }

/**
 * 派工排除面（studio-dev-775/C2）：按工号或岗位排除候选——发布岗 REL-1 不得被自动派工
 * 选中（其写盘+dsh 能力可绕过 719 审批执行原始 deploy/tag/push）。
 * 语义：在 dept/在职过滤后、并发帽之前排除；排除后空集=all-excluded（fail-closed 顺延，
 * 不回退缺省人）。缺省不传=行为零变。
 */
export interface AssignExclude {
  /** 排除的工号（org-config people[].id） */
  people?: readonly string[]
  /** 排除的岗位名（org-config people[].role；精确匹配） */
  roles?: readonly string[]
}

/** 选人入参（全显式：时刻/状态都经参——纯函数回放面） */
export interface AssignPickInput {
  /** 目标部门 path（与 PersonRef.dept 全等比对；单据无 dept 由调用面回退 deptFallback） */
  dept: string
  /** 人事索引快照（daemon 热替换后的当前名册） */
  people: readonly PersonRef[]
  /** 在工计数（daemon 口径=内存 Inflight+本拍已排队派发，与人闸快照同源） */
  inflightByPerson: Readonly<Record<string, number>>
  limits: AssignLimits
  /** 轮转游标（持久位=daemon_kv；缺省 0；非整数/负数视同 0——fail-closed 不猜） */
  cursor?: number
  /** 排除面（775/C2；缺省不排除=行为零变） */
  exclude?: AssignExclude
}

/** 单人并发帽：overrides[人] ?? defaultLimit ?? 1，向下取整，<1 视同 1（与人闸同口径） */
export function assignLimitOf(person: string, limits: AssignLimits): number {
  const raw = limits.overrides?.[person] ?? limits.defaultLimit ?? 1
  const n = Math.floor(raw)
  return n >= 1 ? n : 1
}

/**
 * 自动选人（纯函数）。成功返回选人工号+下一游标（cursor+1——仅成功前进，落账时机
 * 归调用面）+并列集大小（观测面）；失败返回闭集码之一，永不部分成功。
 */
export function pickAssignee(input: AssignPickInput): AssignPickResult {
  const { dept, people, inflightByPerson, limits } = input
  if (people.length === 0) return { ok: false, code: 'no-people' }
  const inDept = people.filter((p) => p.dept === dept)
  if (inDept.length === 0) return { ok: false, code: 'dept-empty' }
  const active = inDept.filter((p) => p.status === undefined || p.status === 'active')
  if (active.length === 0) return { ok: false, code: 'no-active' }
  // 775/C2 排除面：在 dept/在职过滤后、并发帽前剔除（排除后空集=fail-closed 顺延）
  const excludePeople = new Set(input.exclude?.people ?? [])
  const excludeRoles = new Set(input.exclude?.roles ?? [])
  const dispatchable = active.filter(
    (p) => !excludePeople.has(p.id) && !(p.role !== undefined && excludeRoles.has(p.role)),
  )
  if (dispatchable.length === 0) return { ok: false, code: 'all-excluded' }
  const underCap = dispatchable.filter((p) => (inflightByPerson[p.id] ?? 0) < assignLimitOf(p.id, limits))
  if (underCap.length === 0) return { ok: false, code: 'all-at-cap' }
  // 在途最小者优先：先取最小在工数，再收并列集（轮转只发生在并列者之间）
  const minInflight = Math.min(...underCap.map((p) => inflightByPerson[p.id] ?? 0))
  const tieSet = underCap
    .filter((p) => (inflightByPerson[p.id] ?? 0) === minInflight)
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const cursorRaw = input.cursor ?? 0
  const cursor = Number.isInteger(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0
  const picked = tieSet[cursor % tieSet.length]
  if (picked === undefined) return { ok: false, code: 'no-people' } // 不可达护栏（tieSet 非空）
  return { ok: true, personId: picked.id, nextCursor: cursor + 1, tieCount: tieSet.length }
}
