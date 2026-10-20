/**
 * hrsync —— 人事同步器相位尾消化器 + 三面执行体（DEV-48，docs/52-§9.2/§六/§七）
 *
 * 规格依据（实现单引用）：
 *   - docs/52-§9.2 队列语义：apply 段只入队（哨兵票 @hr:<batchId>——§5.2/§9.1 张力
 *     取位：apply 零平台 IO），**每拍落账相位尾**（docs/17-§2 相位 7 之后）消化
 *     maxHrSyncPerTick 条：补单（人事对账单，D7 自动开）→ personnel_events 挂账
 *     （确定性 id，重试不双写）→ 三面执行（ensure-shape 收敛）→ complete/fail。
 *   - docs/52-§9.2 失败语义：failHrSync 重试；attempts 达限 → failed 终态 + ESCALATE
 *     （note 前缀 `HRSYNC;FAIL;`，D2 家族）——**不自动开 bug 单**（对账单即人工入口）。
 *     断电恢复：启动期 resetStaleHrSyncApplying（serve 装配侧调，不在 drain 内）。
 *   - docs/52-§六.3/§七.4 幂等纪律：执行器=**目标态收敛**（ensure-shape）——已在位/
 *     已建号/同值皆 no-op 成功；跨批次重放多执行不坏。
 *   - docs/52-§十二：出站脱敏——last_error/事件 note/日志全过 redactOutbound（装配侧
 *     绑定已知秘密名单的闭包注入）；store 原样落列（库内不持秘密名单）。
 *
 * 分层（宪法 docs/20-§十五）：本目录不经 daemon→matrix 边——MatrixHrFace 为**结构
 * 同形接口**（matrix 包 hr-face.ts 的 MatrixHrTarget 字段面），装配期（serve.ts）注入
 * matrix.createMatrixHrFace 产物（matrixSource 工厂注入先例）。Taiga 面真实现见
 * taiga-face.ts（daemon→taiga 合法边）。
 */

import { createHash, randomBytes } from 'node:crypto'
import type { CompanySnapshot, EventRecord, IssueRecord } from '@studio-next/contract'
import type { FlowPlatform } from '@studio-next/contract'
import type { HrSyncPayload, HrSyncTaskRecord, Ledger } from '@studio-next/store'
import { diffPeople, hrOpKey, platformsFor, renderPeopleDiff, type PeopleChange } from '@studio-next/core'

/** 哨兵票前缀（apply 段入队；补单后回写真单号——hr_sync_log.ticket 可 UPDATE） */
export const HR_TICKET_SENTINEL = '@hr:'

/** 人事对账单的 kv 键（batchId→票号；跨重启幂等——daemon_kv 持久） */
const batchTicketKey = (batchId: string): string => `hr.batch.${batchId}`
/** 批摘要的 kv 键（apply 段写入；ORG_UPGRADE note 消费） */
const batchSummaryKey = (batchId: string): string => `hr.batch.${batchId}.summary`
/** Matrix 随机密码的 kv 键（D6：密码 daemon_kv 持有，重试复用同口令） */
const matrixPasswordKey = (username: string): string => `hr.matrix.pass.${username}`

/** personnel_events 确定性 id：同变动（person+kind+field+prev+next）恒同 id——重试/
 *  跨面（taiga/matrix/ledger 三任务同人同变动）幂等收敛到同一条事实账行。 */
export function personnelEventIdOf(c: PeopleChange): string {
  return `HRE-${createHash('sha256').update(`${c.personId}|${c.kind}|${c.field}|${c.prev ?? ''}|${c.next ?? ''}`).digest('hex').slice(0, 16)}`
}

// ————————————————————————— 三面接口（结构类型） —————————————————————————

/** Taiga 执行面（真实现 taiga-face.ts；测试注入替身） */
export interface TaigaHrFace {
  /** 成员在位+账号已建（邀请令牌注册闭环；已在位/已建号收敛 created=false） */
  ensureMember(args: { username: string; roleSlug: string; displayName?: string }): Promise<{ membershipId: number; created: boolean }>
  /** 角色对齐（升/降；成员不在位=调用方时序错误，如实抛） */
  ensureRole(args: { username: string; roleSlug: string }): Promise<void>
  /** 成员移除（退；不在位=目标态已达成 no-op） */
  removeMember(args: { username: string }): Promise<void>
}

/** Matrix 执行面（matrix 包 MatrixHrTarget 同形结构契约——两侧字段面一致即兼容） */
export interface MatrixHrFace {
  ensureAccount(args: { username: string; displayName: string; password: string }): Promise<{ userId: string; created: boolean }>
  ensureMembership(args: { userId: string; roomAlias: string }): Promise<void>
  ensurePowerLevel(args: { userId: string; roomAlias: string; level: number }): Promise<void>
  kickFromRoom(args: { userId: string; roomAlias: string; reason?: string }): Promise<void>
}

/** 房间别名解析（装配注入：公司房+部门房；v0 部门缺映射=只动公司房） */
export interface HrRoomAliases {
  company: string
  aliasForDept(dept: string): string | undefined
}

// ————————————————————————— 消化器 —————————————————————————

/** drain 一拍汇报（相位 7 扩段观测面；TickReport.phases.account.hrSync） */
export interface HrSyncTickReport {
  claimed: number
  done: number
  /** fail 未达限（回 pending 下一拍重试） */
  retried: number
  /** 达限终态（已落 ESCALATE） */
  failed: number
  /** 本拍新开人事对账单数（哨兵→真票） */
  ticketsOpened: number
  eventsAppended: number
}

export interface HrSyncDeps {
  ledger: Ledger
  /** 开单面（对账单；结构化最小面——FlowPlatform.issues） */
  platform: Pick<FlowPlatform, 'issues'>
  clock: () => number
  makeId: (ts: number) => string
  log: (line: string) => void
  config: {
    company: string
    deptFallback: string
    /** 每拍消化上限（§9.2 maxHrSyncPerTick） */
    maxPerTick: number
    /** 重试上限（§9.2；达限 failed 终态+ESCALATE） */
    retryLimit: number
    /** personnel_events.approver（事实账批准人=执行体系署名） */
    approver: string
  }
  faces: {
    taiga?: TaigaHrFace
    matrix?: MatrixHrFace
    rooms?: HrRoomAliases
    /** 等级→Taiga 角色 slug（装配映射注入；缺省单层 'member'） */
    taigaRoleOf?: (level: number) => string
  }
  /** 出站脱敏闭包（redactOutbound 绑定已知秘密名单；装配注入） */
  redact: (text: string) => string
}

/** 一条任务从 payload 重建的变动（执行体消费的最小形状） */
function changeOf(task: HrSyncTaskRecord): PeopleChange {
  const p: HrSyncPayload | undefined = task.payload
  return { personId: task.person_id, kind: task.kind as PeopleChange['kind'], field: p?.field ?? '*', prev: p?.prev ?? null, next: p?.next ?? null }
}

/** 目标态关键字段（apply 段入队时快照进 payload——执行器不回查目录） */
function targetOf(task: HrSyncTaskRecord): { login?: string; name?: string; level?: number; dept?: string; status?: string } {
  const p = task.payload
  if (p === undefined) return {}
  return {
    ...(p.login !== undefined ? { login: p.login } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.level !== undefined ? { level: p.level } : {}),
    ...(p.dept !== undefined ? { dept: p.dept } : {}),
    ...(p.status !== undefined ? { status: p.status } : {}),
  }
}

/** Matrix power_level 取值（v0 单层：成员 0/停用 -1——matrix 包 matrixLevelFor 同语义重声明，不越边） */
function matrixLevelFor(status: string | undefined): number {
  return status === 'paused' ? -1 : 0
}

/**
 * 三面执行体（§六/§七 映射表；platformsFor 的任务侧分派）。
 * 全部 ensure-shape：任何已达成态再执行=no-op 成功（幂等收敛，§13 风险4）。
 */
async function executeHrTask(
  task: HrSyncTaskRecord,
  deps: HrSyncDeps,
  passwordFor: (username: string) => string,
): Promise<string> {
  const t = targetOf(task)
  const rooms = deps.faces.rooms
  const deptAlias = rooms !== undefined && t.dept !== undefined ? rooms.aliasForDept(t.dept) : undefined
  const aliases = rooms !== undefined ? [rooms.company, ...(deptAlias !== undefined ? [deptAlias] : [])] : []
  if (task.platform === 'taiga') {
    if (deps.faces.taiga === undefined) throw new Error('Taiga 面未装配（hrSync: true 需 platform 绑定 taiga）')
    const role = deps.faces.taigaRoleOf?.(t.level ?? 1) ?? 'member'
    const username = t.login ?? task.person_id
    if (task.kind === '入') {
      const r = await deps.faces.taiga.ensureMember({ username, roleSlug: role, ...(t.name !== undefined ? { displayName: t.name } : {}) })
      return `taiga 入：${username}→${role}（created=${String(r.created)}）`
    }
    if (task.kind === '升' || task.kind === '降') {
      await deps.faces.taiga.ensureRole({ username, roleSlug: role })
      return `taiga ${task.kind}：${username}→${role}`
    }
    if (task.kind === '退') {
      await deps.faces.taiga.removeMember({ username })
      return `taiga 退：${username} 成员移除（账号保留）`
    }
    return `taiga ${task.kind}：无动作（platformsFor 不会为该 kind 产 taiga 任务——入队面漂移，如实跳过）`
  }
  if (task.platform === 'matrix') {
    const mx = deps.faces.matrix
    if (mx === undefined || rooms === undefined) throw new Error('Matrix 面未装配（hrMatrix: true 需装配期工厂注入——serve hrMatrixFace）')
    const username = t.login ?? task.person_id
    if (task.kind === '入') {
      const password = passwordFor(username)
      const acc = await mx.ensureAccount({ username, displayName: t.name ?? username, password })
      for (const alias of aliases) await mx.ensureMembership({ userId: acc.userId, roomAlias: alias })
      return `matrix 入：@${username} 建号（created=${String(acc.created)}）+ 入房 ${aliases.length} 间`
    }
    if (task.kind === '升' || task.kind === '降') {
      const level = matrixLevelFor(t.status ?? 'active')
      for (const alias of aliases) await mx.ensurePowerLevel({ userId: `@${username}`, roomAlias: alias, level })
      return `matrix ${task.kind}：@${username} power=${String(level)}（${aliases.length} 间）`
    }
    if (task.kind === '调') {
      if (deptAlias === undefined) return 'matrix 调：部门房未映射（v0 只公司房——no-op）'
      await mx.ensureMembership({ userId: `@${username}`, roomAlias: deptAlias })
      return `matrix 调：@${username} 重挂 ${deptAlias}（旧房不退——历史可回看，§7.2）`
    }
    if (task.kind === '停' || task.kind === '复') {
      const level = matrixLevelFor(task.kind === '停' ? 'paused' : 'active')
      for (const alias of aliases) await mx.ensurePowerLevel({ userId: `@${username}`, roomAlias: alias, level })
      return `matrix ${task.kind}：@${username} power=${String(level)}（${aliases.length} 间）`
    }
    if (task.kind === '退') {
      for (const alias of aliases) await mx.kickFromRoom({ userId: `@${username}`, roomAlias: alias, reason: 'hr 退场（kick 非 ban——可复邀，D4）' })
      return `matrix 退：@${username} 踢出 ${aliases.length} 间`
    }
    return `matrix ${task.kind}：无动作（platformsFor 不会为该 kind 产 matrix 任务——入队面漂移，如实跳过）`
  }
  // ledger 面（people.status 写面——syncCompany 镜像不动 status，§5.2）
  const status = task.kind === '入' || task.kind === '复' ? 'active' : task.kind === '停' ? 'paused' : 'retired'
  if (!deps.ledger.setPersonStatus(task.person_id, status)) {
    throw new Error(`people 无 ${task.person_id} 行（入队前置 syncCompany 应已建行——时序漂移如实失败）`)
  }
  return `ledger：${task.person_id}.status→${status}`
}

/**
 * 建人事同步消化器（相位尾 drain；docs/52-§9.2）。
 * 返回面即 EngineDeps.hrSync 的消费形状（engine.ts 相位 7 尾调用）。
 */
export function createHrSyncDigester(deps: HrSyncDeps): { drain(): Promise<HrSyncTickReport> } {
  function makeEvent(event: 'ORG_UPGRADE' | 'ESCALATE', issue: string, note: string): EventRecord {
    const ts = deps.clock()
    return {
      id: deps.makeId(ts),
      ts,
      company: deps.config.company,
      issue,
      event,
      actor: 'daemon',
      attempt: 1,
      level: 1,
      dept: deps.config.deptFallback,
      tokens: { input: 0 },
      note,
    }
  }

  /** Matrix 口令（D6 随机生成→daemon_kv 持久；重试/跨面复用同口令） */
  function passwordFor(username: string): string {
    const existing = deps.ledger.kvGet(matrixPasswordKey(username))
    if (existing !== null) return existing
    const password = randomBytes(18).toString('base64url')
    deps.ledger.kvSet(matrixPasswordKey(username), password)
    return password
  }

  /** 哨兵票 → 人事对账单（kv 幂等跨重启；首开落 ORG_UPGRADE——挂账单，§5.2 步8） */
  async function ensureTicket(task: HrSyncTaskRecord, opened: { count: number; events: EventRecord[] }): Promise<string> {
    if (!task.ticket.startsWith(HR_TICKET_SENTINEL)) return task.ticket
    const batchId = task.ticket.slice(HR_TICKET_SENTINEL.length)
    const existing = deps.ledger.kvGet(batchTicketKey(batchId))
    if (existing !== null) return existing
    const summary = deps.ledger.kvGet(batchSummaryKey(batchId)) ?? '摘要缺（apply 段未留——观测面缺口，如实呈现）'
    const created: IssueRecord = await deps.platform.issues.create({
      title: `[人事对账] ${batchId}`,
      description: `DEV-48 人事同步批次 ${batchId}：${summary}\n（自动补开——D7；任务明细见 hr_sync_log，事实账见 personnel_events）`,
      type: 'hr',
      dept: deps.config.deptFallback,
      // 不定级不派工：对账单是人工入口（bug 单同款先例——NOOP_UNKNOWN_FLOW 待人定级）
    })
    deps.ledger.kvSet(batchTicketKey(batchId), created.id)
    opened.count += 1
    const evt = makeEvent('ORG_UPGRADE', created.id, deps.redact(`HRSYNC;batch=${batchId};${summary}`))
    deps.ledger.appendEvent(evt)
    opened.events.push(evt)
    deps.log(`[hr-sync] 人事对账单 ${created.id} 已开（batch=${batchId}：${summary}）`)
    return created.id
  }

  /** personnel_events 挂账（确定性 id 幂等——同变动重试/跨面不双写）。
   *  ts 取任务行业务时（批次入队 ts）：同 id 幂等比对含全列，ts 若取执行时钟则重试拍
   *  必因 ts 漂移判「同 id 异内容」而拒——事实账记业务时，不记执行时。 */
  function appendFact(task: HrSyncTaskRecord, ticket: string): void {
    const c = changeOf(task)
    deps.ledger.appendPersonnelEvent({
      id: personnelEventIdOf(c),
      ts: task.ts,
      person_id: task.person_id,
      type: task.kind,
      ...(c.prev !== null ? { prev: c.prev } : {}),
      ...(c.next !== null ? { next: c.next } : {}),
      ticket,
      approver: deps.config.approver,
    })
  }

  async function drain(): Promise<HrSyncTickReport> {
    const report: HrSyncTickReport = { claimed: 0, done: 0, retried: 0, failed: 0, ticketsOpened: 0, eventsAppended: 0 }
    const pending = deps.ledger.listHrSyncPending(deps.config.maxPerTick)
    for (const task of pending) {
      const claimed = deps.ledger.claimHrSync(task.id, deps.clock())
      if (!claimed) continue // 并发/前拍残留——下一拍自然收敛
      report.claimed += 1
      const opened: { count: number; events: EventRecord[] } = { count: 0, events: [] }
      try {
        const ticket = await ensureTicket(task, opened)
        report.ticketsOpened += opened.count
        report.eventsAppended += opened.events.length
        appendFact(task, ticket)
        const detail = await executeHrTask(task, deps, passwordFor)
        deps.ledger.completeHrSync(task.id, deps.clock())
        report.done += 1
        deps.log(`[hr-sync] ${task.platform} ${task.kind} ${task.person_id} ✓ ${detail}（${ticket}）`)
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        const safe = deps.redact(raw)
        const status = deps.ledger.failHrSync(task.id, safe, { now: deps.clock(), retryLimit: deps.config.retryLimit })
        if (status === 'failed') {
          // 达限终态：ESCALATE（HRSYNC;FAIL; 前缀——D2 家族；不自动开 bug 单，§9.2）
          const evt = makeEvent('ESCALATE', task.ticket.startsWith(HR_TICKET_SENTINEL) ? '-' : task.ticket, `HRSYNC;FAIL;task=${task.id};${task.platform};${task.kind};${task.person_id};尝试=${String(task.attempts + 1)}：${safe}`)
          deps.ledger.appendEvent(evt)
          report.eventsAppended += 1
          report.failed += 1
          deps.log(`[hr-sync] 任务 ${task.id} 达限转 failed（ESCALATE ${evt.id}）：${safe}`)
        } else {
          report.retried += 1
          deps.log(`[hr-sync] 任务 ${task.id} 失败回队重试（${String(task.attempts + 1)}/${String(deps.config.retryLimit)}）：${safe}`)
        }
      }
    }
    return report
  }

  return { drain }
}

// ————————————————————————— apply 段入队面（serve 装配消费） —————————————————————————

/** apply 段入队产物（serve apply 闭包返回给 hot-reload 的扩段；note 观测面消费） */
export interface HrEnqueueResult {
  /** 批次号（ULID；无变动=null） */
  batchId: string | null
  /** 变动摘要（renderPeopleDiff——RELOAD note 扩段） */
  summary: string
  /** 实际新建任务行数（幂等命中不计） */
  enqueued: number
}

/**
 * apply 段入队（serve 装配注入 apply 闭包；docs/52-§5.2 步2-3 + §9.1）：
 * diffPeople 分类 → platformsFor 展开（taiga/matrix/ledger 三面各一行）→ enqueueHrSync
 * （op_key 幂等）→ 摘要落 kv（ORG_UPGRADE note 消费）。**零平台 IO**（不开单不建号——
 * 补单与执行归相位尾消化器）。level/dept/name 镜像列由后续 syncCompany 直覆（步4）。
 */
export function enqueueHrBatch(
  ledger: Ledger,
  args: {
    prev: CompanySnapshot
    next: CompanySnapshot
    company: string
    batchId: string
    ts: number
  },
): HrEnqueueResult {
  // 入/复判别基=台账 people 镜像现值（§5.1「people 表」列——syncCompany 前的现值）
  const ledgerStatus = new Map<string, string>()
  for (const row of ledger.listPeople()) {
    if (row.status !== undefined) ledgerStatus.set(row.person_id, row.status)
  }
  const diff = diffPeople(args.prev, args.next, ledgerStatus)
  const summary = renderPeopleDiff(diff)
  if (diff.changes.length === 0) return { batchId: null, summary, enqueued: 0 }
  const nextById = new Map(args.next.people.map((p) => [p.id, p] as const))
  let enqueued = 0
  for (const change of diff.changes) {
    for (const platform of platformsFor(change)) {
      const target = nextById.get(change.personId)
      const payload: HrSyncPayload = {
        field: change.field,
        prev: change.prev,
        next: change.next,
        ...(target?.login !== undefined ? { login: target.login } : {}),
        ...(target?.name !== undefined ? { name: target.name } : {}),
        ...(target?.level !== undefined ? { level: target.level } : {}),
        ...(target?.dept !== undefined ? { dept: target.dept } : {}),
        ...(target?.status !== undefined ? { status: target.status } : {}),
      }
      const id = `${args.batchId}-${platform}-${change.personId}-${change.field}-${String(enqueued + 1).padStart(3, '0')}`
      const r = ledger.enqueueHrSync({
        id,
        ts: args.ts,
        company: args.company,
        person_id: change.personId,
        kind: change.kind,
        platform,
        op_key: hrOpKey(change, platform),
        ticket: `${HR_TICKET_SENTINEL}${args.batchId}`,
        status: 'pending',
        attempts: 0,
        payload,
        updated: args.ts,
      })
      if (r.enqueued) enqueued += 1
    }
  }
  if (enqueued > 0) ledger.kvSet(batchSummaryKey(args.batchId), summary)
  return { batchId: args.batchId, summary, enqueued }
}
