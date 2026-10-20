/**
 * hrsync —— 人事变动分类器纯函数（DEV-48，docs/52-§5.1；docs/17-§3 值域口径）
 *
 * 规格依据（实现单引用）：
 *   - docs/52-§5.1 分类器表：输入=前后两份 CompanySnapshot（serve apply 段在替换持有者
 *     之前可同时拿到）+ 台账 people 镜像状态索引（入/复判别的第三方事实源——快照只有
 *     prev/next，无「上一 lifecycle」），主键=工号（C1-02：工号=文件名=永不变主键）。
 *   - docs/52-§5.1 分类规则：新 id 且台账无此工号=入；新 id 且台账 status∈{retired,paused}
 *     =复（复职）；id 消失=退；level 升/降=升/降；dept 变=调；status active↔paused=停/复；
 *     name/role 等描述类=调；同人无字段变=无事件（正文变更只 RELOAD 不进人事流——§13 风险3）。
 *   - docs/52-§5.4：复合变动拆条（一人数维同变 → 多事件行；personnel_events 复合拆行同族）。
 *   - docs/52-§11：op_key 幂等键 = person+kind+字段维度（本实现再并 prev/next 目标值维——
 *     「升 L2→L3」与回退后再次「升 L2→L3」是两次不同变动；跨批次重放安全由执行器
 *     目标态收敛语义保证，不靠 op_key 跨生命周期）。
 *   - docs/17-§3：personnel_events.type 值域 入/调/升/降/停/复/退（v0 不锁枚举）——
 *     HR_EVENT_KINDS 为本仓单一冻结源（store records / daemon 执行体同引）。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - 「新 id 出现」的判别基=台账 people 镜像（ledger 现值，非 prev 快照）：台账有行且
 *     status∈{retired,paused} → 复（曾入册后离岗，目录侧 id 删了又回来=复职语义）；
 *     台账无行 → 入。ledgerStatus 未注入时退化为 prev 快照判别（单测/无台账语境）。
 *   - 快照 status 缺省语义=active（active|paused|retired 模板口径，v0 不锁）；
 *     prev.active→next.retired 按「退」分类（retired 目标态=退出在册）。
 *   - 「入/退」各产一条汇总事件（field='*'，next/prev=「level N；dept X」渲染），
 *     不按字段拆条（入职无逐维 prev；§5.1 表内入/退即单行事件）。
 *   - kind→执行平台集（platformsFor）为 daemon 三面执行体的映射单一源（§六/§七语义）：
 *     ledger 面只出现在 status 迁移类（入/停/复/退）——level/dept 镜像列由 apply 段
 *     syncCompany 直覆（§5.2 步4），不走任务队列。
 *
 * 纯函数纪律：零 IO、零时钟/随机内取；输入只读，输出新构。
 */

import type { CompanySnapshot } from '@studio-next/contract'

// ————————————————————————— 值域与类型 —————————————————————————

/** 人事事件七值（docs/17-§3 值域口径 v0 不锁；本模块为单一冻结源） */
export const HR_EVENT_KINDS = ['入', '调', '升', '降', '停', '复', '退'] as const
export type HrEventKind = (typeof HR_EVENT_KINDS)[number]

/** 同步执行平台三面（docs/52-§四.1：Taiga/Matrix/台账） */
export type HrSyncPlatform = 'taiga' | 'matrix' | 'ledger'

/** 一条人事变动（复合变动拆条后的原子单元） */
export interface PeopleChange {
  personId: string
  kind: HrEventKind
  /** 变动字段维（level/dept/status/name/login/role；入/退汇总事件='*'） */
  field: string
  /** 前值（入=null；渲染标量文本——复合维不进单条） */
  prev: string | null
  /** 后值（退=null） */
  next: string | null
}

/** 分类器产物 */
export interface PeopleDiffResult {
  /** 变动全量（拆条后；人序=next 快照序，退场者按 prev 序殿后——稳定可测） */
  changes: PeopleChange[]
  /** 两侧都在且零字段变的人数（观测面：正文噪音过滤后的真无事件数） */
  unchanged: number
  before: number
  after: number
}

/** 入/复判别的台账状态索引（person_id → status；缺行=无此人——people 镜像现值） */
export type LedgerStatusIndex = ReadonlyMap<string, string>

// ————————————————————————— 分类器 —————————————————————————

/** status 缺省语义=active（§5.1 模板口径；未携带=活跃在册） */
function statusOf(p: { status?: string }): string {
  return p.status ?? 'active'
}

/** 入/退汇总渲染（§5.1 表：入 prev=∅ next=level/dept；退对偶） */
function summarize(p: { level: number; dept: string }): string {
  return `level ${String(p.level)}；dept ${p.dept}`
}

/** 同人逐字段比对（复合变动拆条；序=status→level→dept→name→login→role，稳定可测） */
function diffPerson(prev: { name: string; login: string; level: number; dept: string; status?: string; role?: string },
                    next: { name: string; login: string; level: number; dept: string; status?: string; role?: string },
                    personId: string): PeopleChange[] {
  const out: PeopleChange[] = []
  // —— status（停/复/退；§5.1 active↔paused 行 + retired 目标态归退）——
  const ps = statusOf(prev)
  const ns = statusOf(next)
  if (ps !== ns) {
    if (ns === 'paused' && ps === 'active') out.push({ personId, kind: '停', field: 'status', prev: ps, next: ns })
    else if (ns === 'active' && ps === 'paused') out.push({ personId, kind: '复', field: 'status', prev: ps, next: ns })
    else if (ns === 'active' && ps === 'retired') out.push({ personId, kind: '复', field: 'status', prev: ps, next: ns })
    else if (ns === 'retired') out.push({ personId, kind: '退', field: 'status', prev: ps, next: ns })
    else if (ns === 'paused' && ps === 'retired') out.push({ personId, kind: '复', field: 'status', prev: ps, next: ns })
    else out.push({ personId, kind: '调', field: 'status', prev: ps, next: ns }) // 未知态迁移如实分类为调（值域 v0 不锁，不猜专名）
  }
  // —— level（升/降）——
  if (prev.level !== next.level) {
    out.push({ personId, kind: next.level > prev.level ? '升' : '降', field: 'level', prev: String(prev.level), next: String(next.level) })
  }
  // —— dept（调）——
  if (prev.dept !== next.dept) out.push({ personId, kind: '调', field: 'dept', prev: prev.dept, next: next.dept })
  // —— name/login/role（描述类=调，§5.1）——
  if (prev.name !== next.name) out.push({ personId, kind: '调', field: 'name', prev: prev.name, next: next.name })
  if (prev.login !== next.login) out.push({ personId, kind: '调', field: 'login', prev: prev.login, next: next.login })
  if ((prev.role ?? '') !== (next.role ?? '')) {
    out.push({ personId, kind: '调', field: 'role', prev: prev.role ?? null, next: next.role ?? null })
  }
  return out
}

/**
 * peopleDiff 分类器（docs/52-§5.1）：前后快照逐人逐字段比对。
 * ledgerStatus 未注入时入/复判别退化用 prev 快照 id 集（单测/无台账语境）。
 */
export function diffPeople(prev: CompanySnapshot, next: CompanySnapshot, ledgerStatus?: LedgerStatusIndex): PeopleDiffResult {
  const prevById = new Map(prev.people.map((p) => [p.id, p] as const))
  const nextById = new Map(next.people.map((p) => [p.id, p] as const))
  const changes: PeopleChange[] = []
  let unchanged = 0
  // —— next 侧（入/复 + 同人比对；人序=next 快照序）——
  for (const p of next.people) {
    const before = prevById.get(p.id)
    if (before === undefined) {
      // 新 id：判别基=台账 people 镜像现值（§5.1 表「people 表」列；复职=曾入册后回岗）
      const ledger = ledgerStatus?.get(p.id)
      if (ledger !== undefined && (ledger === 'retired' || ledger === 'paused')) {
        changes.push({ personId: p.id, kind: '复', field: '*', prev: ledger, next: statusOf(p) })
      } else {
        changes.push({ personId: p.id, kind: '入', field: '*', prev: null, next: summarize(p) })
      }
      continue
    }
    const diffs = diffPerson(before, p, p.id)
    if (diffs.length === 0) unchanged += 1
    else changes.push(...diffs)
  }
  // —— prev 侧独有（退；人序=prev 快照序殿后）——
  for (const p of prev.people) {
    if (!nextById.has(p.id)) changes.push({ personId: p.id, kind: '退', field: '*', prev: summarize(p), next: null })
  }
  return { changes, unchanged, before: prev.people.length, after: next.people.length }
}

// ————————————————————————— 幂等键与渲染 —————————————————————————

/**
 * op_key（docs/52-§11：person+kind+字段维度；本实现并 prev/next 目标值维）。
 * 同变动重放同键；不同批次同目标的变动靠执行器目标态收敛语义安全。
 */
export function hrOpKey(c: PeopleChange, platform: HrSyncPlatform): string {
  return `${c.personId}|${c.kind}|${platform}|${c.field}|${c.prev ?? ''}|${c.next ?? ''}`
}

/** 变动渲染（personnel_events prev/next 标量文本同形；入/退已由 summarize 承载） */
export function renderChange(c: PeopleChange): string {
  return c.field === '*' ? `${c.personId} ${c.kind}（${c.prev ?? '∅'}→${c.next ?? '∅'}）`
    : `${c.personId}.${c.field} ${c.prev ?? '∅'}→${c.next ?? '∅'}（${c.kind}）`
}

/** diff 摘要渲染（RELOAD note 扩段/ORG_UPGRADE note 用；「入+1；退-1；调×2」形） */
export function renderPeopleDiff(diff: PeopleDiffResult): string {
  const counts = new Map<HrEventKind, number>()
  for (const c of diff.changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
  if (counts.size === 0) return '无人事变动'
  return [...HR_EVENT_KINDS].filter((k) => counts.has(k)).map((k) => `${k}${String(counts.get(k))}`).join('；')
}

/**
 * 变动 → 执行平台集（docs/52-§六/§七 三面语义的映射单一源）：
 *   - 入：Taiga 邀请建号+角色 / Matrix 建号+进房+权限 / 台账 setPersonStatus(active)
 *   - 升/降：Taiga 角色 / Matrix power_level（台账镜像列由 syncCompany 直覆——不走队列）
 *   - 调（dept）：Matrix 部门房重挂（Taiga 无部门语义——§6.2；台账镜像列同上）
 *   - 调（name/role/login 等描述维）：无平台任务（Taiga/Matrix 无对应动作面；
 *     personnel_events 挂账照走——事件事实与平台投影分离）
 *   - 停/复：Matrix 禁言/恢复 / 台账 setPersonStatus（Taiga 无成员停用面——§6.2）
 *   - 退：Taiga 移除成员 / Matrix kick（D4：可复邀）/ 台账 setPersonStatus(retired)
 */
export function platformsFor(c: PeopleChange): HrSyncPlatform[] {
  switch (c.kind) {
    case '入':
    case '退':
      return ['taiga', 'matrix', 'ledger']
    case '升':
    case '降':
      return ['taiga', 'matrix']
    case '调':
      return c.field === 'dept' ? ['matrix'] : []
    case '停':
    case '复':
      return ['matrix', 'ledger']
  }
}
