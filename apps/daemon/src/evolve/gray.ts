/**
 * gray —— 进化链灰度观察窗（进化链四刀之四收官：沙箱→切权→**灰度**→复盘）
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§四（三级晋升原文）：「gray ──灰度零事故+制作人过目──▶ release」——灰度期
 *     **不设日历、只看零事故+证据**。本文件把「零事故」机化为可检查的观察窗：窗内监控
 *     台账事故信号，超阈值自动回滚；窗平安度过即灰度完成（gray 结束=可请求制作人过目）。
 *   - docs/20-§九：一切改进走候选制品管线（观测→提案→沙箱→三态闸门→灰度→切权→复盘）——
 *     本文件是链上「灰度」环节的 daemon 落点（四刀至此收齐）。
 *   - docs/17-§三进化行 / cutover.ts 头注：切权是「合法授权的改动可以上生产」的唯一受控
 *     路径；本文件是切权后的**守夜面**——上产不是终点，零事故度过观察窗才是。
 *
 * **v0 灰度语义拟稿（头注冻结候选——文件类资产收窄）**：
 *   文件类资产的灰度=**切权后观察窗**——窗内监控台账事故信号（ESCALATE/CIRCUIT_BREAK
 *   新增），超阈值自动回滚备份并 retired 收口；窗平安度过则灰度完成（gray 结束=可请求
 *   制作人过目）。（候选影子双跑属 F3-04 shadow 语义，文件资产 v0 不适用——头注声明
 *   此收窄。）
 *
 * 与切权的接线（结构性，cutover.ts 尾部一行）：
 *   - **开窗是切权的默认后缀**：runCutover 成功即 openGrayWindow（生产写已完成且复核过，
 *     开窗只是 kv 登记，无生产面）；`--no-gray` 旗标跳过（gray:false）。
 *   - 开窗失败**不回滚切权**（生产写已成立，回滚它才是事故）——如实上报进结果面；
 *     重跑 cutover（promoted 幂等）即重试开窗。
 *   - 备份锚 `<目标>.bak-<候选id>`（cutover ⑥ 定名，保留不清理）是回滚的物理基础——
 *     checkGrayWindow 从备份路径反解目标（剥 `.bak-<候选id>` 后缀，无 root 依赖）。
 *
 * 事故信号口径（收窄声明，拟稿待批）：
 *   - 信号源=窗内（ts ∈ [openedAt, now]，双端闭）**同 company** 的 ESCALATE/CIRCUIT_BREAK
 *     事件（20-§十一卡单链：断路器 N=3 开 bug 单、持续报错升级电路——ESCALATE/CIRCUIT_BREAK
 *     是台账里「出事了」的机器留痕面；postmortem.ts BREAKER_EVENT_NAMES 同款集合）。
 *   - **归因收窄**：事件无结构化资产引用（资产只出现在自由文本 note 里），v0 不做 note
 *     模糊匹配（脆弱面）——窗内同 company 的事故信号**全集**都算本窗的事故（保守面：
 *     零事故是严格判据，宁可误回滚不漏事故；资产级归因归真单刀）。
 *   - RESUME（断路恢复）**不计数**：恢复不是事故，回滚判据只有事故信号。
 *   - 阈值缺省 1（DEFAULT_GRAY_MAX_INCIDENTS）：零事故语义下任何一条信号即破窗。
 *   - 窗长缺省 24h（DEFAULT_GRAY_WINDOW_MS，拟稿）：「不设日历」指晋升判据不看日历——
 *     观察窗本身须有界（否则「窗平安度过」不可判定）；窗长是 automation 参数非晋升判据。
 *
 * 自动回滚面（阈值触发，失败面如实枚举——任一失败窗保持 open，可重进幂等收口）：
 *   ① 备份锚点在（回滚物理基础；缺失即拒，不假装回滚）；
 *   ② 事件预构+预检（形状红前移到触碰生产文件之前——cutover ⑩ 同款先例）；
 *   ③ 字节级恢复：copyFileSync(备份→目标) + 读回复核 hash 一致（fail-closed）；
 *   ④ 状态迁移 promoted→retired（core 判边+store 乐观锁；已在 retired=幂等跳过——
 *      事件落账失败后重进面的重试路径；evolution.ts「promoted→retired=退役/回滚」正用）；
 *   ⑤ SCHEMA_EVOLVE 事件落账（note=gray-rollback，含候选/资产/信号数/阈值/备份→目标/
 *      hash 对）+ kv 关窗（status=rolled）。恢复/迁移先于事件（cutover 镜像序）；
 *      事件失败则文件已回+状态已 retired 而窗仍 open——重进 check 即幂等收口
 *      （恢复幂等/迁移跳过/事件重落/关窗）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **事件名 SCHEMA_EVOLVE**（回滚事件的台账名）：与 cutover 同枚举同留痕面（回滚=
 *      生产资产变更的逆操作，留痕面不豁免）；cutover.ts 头注已上报的 ORG_UPGRADE 贴合度
 *      疑点在此同源。
 *   - **events.issue 哨兵 '-'** / **level 缺省 9** / **actor='daemon'** / **dept=
 *      'departments/工程部'**：cutover/evolve-guard/postmortem 同款拟稿档（无单号语境
 *      哨兵、生产资产变更的制作人对面最高档）。
 *   - **kv 键形 `gray:<候选id>`**：daemon_kv 表（store v4 吸收面）——观察窗是 daemon 状态
 *      非台账事实（窗记录可重建：重跑 cutover 即重开窗），落 kv 不落 events。
 *   - **窗记录生命周期**：关窗/回滚后 kv 记录**保留**（closed/rolled 状态+收口时刻+理由
 *      ——「查窗」的历史档案面），不删除；重切权（promoted 幂等 cutover）重开窗=覆盖
 *      旧记录（重切权即新的观察期）。
 *   - **到期关窗不落事件**：平安到期是「无事发生」，kv 收口即证据；落 HEARTBEAT 类噪声
 *      归真单刀再议。
 *
 * 后续刀（本刀不做，头注声明）：
 *   - **观察窗驱动接 daemon tick**（每拍自动 check 全部 open 窗）：归真单刀——本刀交付
 *     check 面（checkGrayWindow）+CLI（studio-next gray）。
 *   - 事故信号资产级归因 / shadow 双跑对比（F3-04，公司面候选）/ 制作人过目流（证据包
 *     组装）——各归其刀。
 *   - supervisor 看护（回滚后重启加载）归运维刀（v0 只提示）。
 *
 * 纯逻辑判定与 IO 分离（可测性）：judgeGrayWindow（窗判定：roll-back/close/hold 三态纯
 * 函数）与 countIncidents（信号计数纯函数）零 IO；checkGrayWindow 是 IO 壳（kv 读写/
 * events 查询/fs 恢复）。零新依赖（node:fs/node:crypto 直用）；id 生成走注入面（缺省
 * makeUlid，测试确定性替身）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { configInvalid, validateEventRecord } from '@studio-next/contract'
import type { EventRecord } from '@studio-next/contract'
import { transitionCandidate as coreTransition } from '@studio-next/core'
import type { CandidateRecord } from '@studio-next/core'
import type { CandidateRow, Ledger } from '@studio-next/store'
import { makeUlid } from '../engine/id.ts'

// ————————————————————————— 常量面 —————————————————————————

/** 观察窗 kv 键前缀（daemon_kv 表；完整键 `gray:<候选id>`——头注拟稿点） */
export const GRAY_KV_PREFIX = 'gray:'

/** 事故信号事件名集（窗内计数面；postmortem BREAKER_EVENT_NAMES 同款；RESUME 不计——头注收窄） */
export const INCIDENT_EVENT_NAMES = ['ESCALATE', 'CIRCUIT_BREAK'] as const

/** 窗长缺省 24h（拟稿——头注「窗长缺省」段） */
export const DEFAULT_GRAY_WINDOW_MS = 24 * 60 * 60 * 1000

/** 阈值缺省 1 条（零事故语义：任何一条事故信号即破窗——头注「阈值缺省」段） */
export const DEFAULT_GRAY_MAX_INCIDENTS = 1

/** 观察窗 kv 键（`gray:<候选id>`） */
export function grayKvKey(candidateId: string): string {
  return `${GRAY_KV_PREFIX}${candidateId}`
}

// ————————————————————————— 窗状态（kv 序列化面） —————————————————————————

/** 观察窗状态（kv `gray:<候选id>` 的 JSON 值形状；收口后记录保留——头注拟稿点） */
export interface GrayWindowState {
  candidateId: string
  assetPath: string
  /** events.company（开窗时记录——信号查询的路由键+回滚事件的台账键） */
  company: string
  /** 开窗时刻（epoch ms；信号计数窗起点，闭端） */
  openedAt: number
  windowMs: number
  maxIncidents: number
  status: 'open' | 'closed' | 'rolled'
  closedAt: number | null
  reason: string | null
}

/** 开窗入参（cutover 接线组装；测试直调同面） */
export interface GrayOpenOptions {
  candidateId: string
  assetPath: string
  company: string
  /** 窗长（缺省 DEFAULT_GRAY_WINDOW_MS——24h 拟稿档） */
  windowMs?: number
  /** 事故阈值（缺省 DEFAULT_GRAY_MAX_INCIDENTS——1 拟稿档） */
  maxIncidents?: number
  /** 时钟注入面（缺省 Date.now；openedAt 取自此） */
  clock?: () => number
}

/**
 * 开窗（登记观察窗）：候选必须在库且 status='promoted'（窗是切权后物件——approved 未上产
 * 无窗可开，fail-closed）。重切权重开窗=覆盖旧记录（新的观察期，头注拟稿点）。同步 kv upsert。
 */
export function openGrayWindow(ledger: Ledger, opts: GrayOpenOptions): GrayWindowState {
  const windowMs = opts.windowMs ?? DEFAULT_GRAY_WINDOW_MS
  const maxIncidents = opts.maxIncidents ?? DEFAULT_GRAY_MAX_INCIDENTS
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    configInvalid('daemon/gray:bad-window-ms', `windowMs 取值非法：${String(windowMs)}（须为正整数毫秒——窗须有界否则「平安度过」不可判定）`)
  }
  if (!Number.isInteger(maxIncidents) || maxIncidents < 1) {
    configInvalid('daemon/gray:bad-max-incidents', `maxIncidents 取值非法：${String(maxIncidents)}（须为 ≥1 整数——零事故语义下阈值至少 1）`)
  }
  const row = ledger.getCandidate(opts.candidateId)
  if (row === undefined) {
    configInvalid('daemon/gray:candidate-unknown', `候选 ${opts.candidateId} 不在库（观察窗挂在候选上——无候选即无窗）`)
  }
  if (row.status !== 'promoted') {
    configInvalid(
      'daemon/gray:status-not-promoted',
      `候选 ${opts.candidateId} 状态 ${row.status} 非 promoted（观察窗=切权后守夜——先 runCutover 上产，窗由切权默认后缀自动开）`,
    )
  }
  const state: GrayWindowState = {
    candidateId: opts.candidateId,
    assetPath: opts.assetPath,
    company: opts.company,
    openedAt: (opts.clock ?? Date.now)(),
    windowMs,
    maxIncidents,
    status: 'open',
    closedAt: null,
    reason: null,
  }
  ledger.kvSet(grayKvKey(opts.candidateId), JSON.stringify(state))
  return state
}

/** 查窗（读面）：无窗=null；kv 值坏（非 JSON/形状红）fail-closed 拒——不冒充无窗 */
export function readGrayWindow(ledger: Ledger, candidateId: string): GrayWindowState | null {
  const raw = ledger.kvGet(grayKvKey(candidateId))
  if (raw === null) return null
  return parseWindowState(candidateId, raw)
}

/** kv 值 → 窗状态（形状闸 fail-closed：坏值是 bug/损坏面，不是「无窗」） */
function parseWindowState(candidateId: string, raw: string): GrayWindowState {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    configInvalid('daemon/gray:bad-state', `观察窗 kv 值非合法 JSON（候选 ${candidateId}）：${raw.slice(0, 120)}`)
  }
  const s = parsed as Partial<GrayWindowState>
  if (
    s.candidateId !== candidateId ||
    typeof s.assetPath !== 'string' ||
    typeof s.company !== 'string' ||
    !Number.isInteger(s.openedAt) ||
    !Number.isInteger(s.windowMs) ||
    !Number.isInteger(s.maxIncidents) ||
    (s.status !== 'open' && s.status !== 'closed' && s.status !== 'rolled') ||
    (s.closedAt !== null && !Number.isInteger(s.closedAt)) ||
    (s.reason !== null && typeof s.reason !== 'string')
  ) {
    configInvalid('daemon/gray:bad-state', `观察窗 kv 值形状红（候选 ${candidateId}）：${raw.slice(0, 160)}`)
  }
  return { ...(s as GrayWindowState), candidateId }
}

// ————————————————————————— 纯逻辑判定面（零 IO） —————————————————————————

/**
 * 信号计数（纯）：事件集中 ts ∈ [since, until]（双端闭）的事故信号条数。
 * RESUME 不计（恢复不是事故）；事件名集合见 INCIDENT_EVENT_NAMES。
 */
export function countIncidents(events: readonly EventRecord[], since: number, until: number): number {
  return events.filter(
    (e) => (INCIDENT_EVENT_NAMES as readonly string[]).includes(e.event) && e.ts >= since && e.ts <= until,
  ).length
}

/** 窗判定（纯，judge 三态）：阈值优先于到期（同拍既破阈又到期——回滚优先，保守面） */
export type GrayVerdict =
  | { action: 'roll-back'; reason: string }
  | { action: 'close'; reason: string }
  | { action: 'hold'; reason: string }

/** 窗判定（纯）：incidents ≥ 阈值 → roll-back；否则到期（now ≥ openedAt+windowMs，闭端）→ close；否则 hold */
export function judgeGrayWindow(
  state: Pick<GrayWindowState, 'openedAt' | 'windowMs' | 'maxIncidents'>,
  now: number,
  incidents: number,
): GrayVerdict {
  if (incidents >= state.maxIncidents) {
    return {
      action: 'roll-back',
      reason: `incident-threshold（窗内事故信号 ${incidents} 条 ≥ 阈值 ${state.maxIncidents}——零事故破窗，自动回滚）`,
    }
  }
  if (now >= state.openedAt + state.windowMs) {
    return {
      action: 'close',
      reason: `window-expired（窗平安度过：事故信号 ${incidents} 条 < 阈值 ${state.maxIncidents}——灰度完成，可请求制作人过目）`,
    }
  }
  return {
    action: 'hold',
    reason: `watching（窗内事故信号 ${incidents} 条 < 阈值 ${state.maxIncidents}，窗未到期——继续守夜）`,
  }
}

// ————————————————————————— 检查与自动回滚（IO 壳） —————————————————————————

/** check 入参（daemon tick / CLI 手动查共用面；全部注入面缺省档） */
export interface GrayCheckOptions {
  /** 时钟注入面（缺省 Date.now；now/事件 ts 取自此） */
  clock?: () => number
  /** ULID 工厂注入面（缺省 makeUlid；测试确定性替身） */
  idFactory?: (ts: number) => string
  /** events.actor（缺省 'daemon'——cutover 同款拟稿档） */
  actor?: string
  /** events.dept（缺省 'departments/工程部'——deptFallback 同款拟稿档） */
  dept?: string
  /** events.level（缺省 9——生产资产变更=制作人对面，cutover 同款拟稿档） */
  level?: number
  /** events.issue 哨兵（缺省 '-'——cutover/evolve-guard 同款拟稿口径） */
  issue?: string
}

/** check 结果（判定+动作面；测试断言面——回滚后 store 读面回查应与各字段一致） */
export interface GrayCheckResult {
  candidateId: string
  assetPath: string
  /** 本次 check 是否执行了自动回滚（窗已收口后的幂等再 check=false——本次无动作） */
  rolled: boolean
  /** 窗是否已收口（closed/rolled/本次收口=true；open 守夜中=false） */
  done: boolean
  reason: string
  /** 窗内事故信号条数（本次计数） */
  incidents: number
  /** 回滚落账的 SCHEMA_EVOLVE 事件（未回滚=null） */
  event: EventRecord | null
  /** 回滚恢复的目标绝对路径（未回滚=null） */
  targetPath: string | null
}

/**
 * 备份路径反解（cutover ⑥ 定名的逆）：`<目标>.bak-<候选id>` → 目标 + 候选 id。
 * 回滚不依赖 root——锚点路径自携带定位（同目录约定，rename/copy 同文件系统面的正用）。
 */
export function splitBackupPath(backupPath: string): { targetPath: string; candidateId: string } {
  const marker = '.bak-'
  const idx = backupPath.lastIndexOf(marker)
  const candidateId = idx >= 0 ? backupPath.slice(idx + marker.length) : ''
  if (idx <= 0 || candidateId === '') {
    configInvalid(
      'daemon/gray:bad-backup-path',
      `备份路径不带 .bak-<候选id> 后缀（cutover 备份锚定名约定——回滚的物理基础）：${backupPath}`,
    )
  }
  return { targetPath: backupPath.slice(0, idx), candidateId }
}

/**
 * checkGrayWindow——观察窗检查（daemon tick 归真单刀；CLI `gray --check` 手动面）：
 *   1. 无窗拒（fail-closed：无窗候选不检查）；
 *   2. 窗已收口（closed/rolled）→ 幂等无动作返回 {done:true}（回滚后再 check 幂等面）；
 *   3. 计数窗内事故信号（同 company、ts ∈ [openedAt, now]）→ judgeGrayWindow 三态；
 *   4. roll-back → 自动回滚（头注①-⑤；任一失败窗保持 open 如实抛）；
 *   5. close → kv 关窗（closed）；hold → 无写返回。
 * 同步函数——kv+events+fs 全同步面（cutover 同款）。
 */
export function checkGrayWindow(ledger: Ledger, backupPath: string, opts: GrayCheckOptions = {}): GrayCheckResult {
  const clock = opts.clock ?? Date.now
  const resolved = path.resolve(backupPath)
  const { targetPath, candidateId } = splitBackupPath(resolved)

  const state = readGrayWindow(ledger, candidateId)
  if (state === null) {
    configInvalid(
      'daemon/gray:no-window',
      `候选 ${candidateId} 无灰度观察窗（kv ${grayKvKey(candidateId)} 缺——无窗候选不检查；窗由 cutover 默认后缀开，先切权或核对候选 id）`,
    )
  }
  if (state.status !== 'open') {
    const what = state.status === 'rolled' ? '已回滚收口' : '已平安关窗'
    return {
      candidateId,
      assetPath: state.assetPath,
      rolled: false,
      done: true,
      reason: `window-already-${state.status}（窗${what}——再 check 幂等无动作；收口记录：${state.reason ?? '（无）'}）`,
      incidents: 0,
      event: null,
      targetPath: null,
    }
  }

  const now = clock()
  const incidents = countIncidents(ledger.queryEvents({ company: state.company, since: state.openedAt }), state.openedAt, now)
  const verdict = judgeGrayWindow(state, now, incidents)

  if (verdict.action === 'hold') {
    return { candidateId, assetPath: state.assetPath, rolled: false, done: false, reason: verdict.reason, incidents, event: null, targetPath: null }
  }
  if (verdict.action === 'close') {
    const closed: GrayWindowState = { ...state, status: 'closed', closedAt: now, reason: verdict.reason }
    ledger.kvSet(grayKvKey(candidateId), JSON.stringify(closed))
    return { candidateId, assetPath: state.assetPath, rolled: false, done: true, reason: verdict.reason, incidents, event: null, targetPath: null }
  }

  const event = performGrayRollback(ledger, state, targetPath, resolved, incidents, opts, now)
  return { candidateId, assetPath: state.assetPath, rolled: true, done: true, reason: verdict.reason, incidents, event, targetPath }
}

/** 目标是否为现存常规文件（不可 stat = 不存在——回滚物理基础检查面） */
function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** 字节 sha256（`sha256:<hex>` 前缀形——cutover/evolve-guard 同款口径） */
function sha256(data: Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/** store 行 → core 记录（verification unknown 收窄——cutover/evolve-guard 同款） */
function toCoreRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    asset_type: row.asset_type,
    asset_path: row.asset_path,
    version: row.version,
    diff_hash: row.diff_hash,
    blast_radius: row.blast_radius,
    verification: row.verification as CandidateRecord['verification'],
    parent_id: row.parent_id,
    status: row.status,
  }
}

/**
 * 自动回滚执行体（头注①-⑤，顺序冻结；任一失败窗保持 open 抛 CONFIG_INVALID——重进
 * checkGrayWindow 即幂等收口：恢复幂等/retired 跳过迁移/事件重落/关窗）。返回落账事件。
 */
function performGrayRollback(
  ledger: Ledger,
  state: GrayWindowState,
  targetPath: string,
  backupPath: string,
  incidents: number,
  opts: GrayCheckOptions,
  now: number,
): EventRecord {
  // —— ① 备份锚点在（回滚物理基础；缺失即拒不假装——窗保持 open 待人工处置） ——
  if (!isRegularFile(backupPath)) {
    configInvalid(
      'daemon/gray:backup-missing',
      `备份锚点缺失：${backupPath}（回滚无物理基础——人工核对生产文件状态，窗保持 open 待处置；如实拒不冒充回滚）`,
    )
  }

  // —— ② 事件预构+预检（形状红前移到触碰生产文件之前——cutover ⑩ 先例） ——
  const event: EventRecord = {
    id: (opts.idFactory ?? makeUlid)(now),
    ts: now,
    company: state.company,
    issue: opts.issue ?? '-',
    event: 'SCHEMA_EVOLVE',
    actor: opts.actor ?? 'daemon',
    attempt: 1,
    level: opts.level ?? 9,
    dept: opts.dept ?? 'departments/工程部',
    tokens: { input: 0 },
    note:
      `GRAY_ROLLBACK 灰度自动回滚（note=gray-rollback）：候选 ${state.candidateId}（${state.assetPath}）` +
      `窗内事故信号 ${incidents} 条 ≥ 阈值 ${state.maxIncidents}` +
      `｜备份逐字节恢复 ${backupPath} → ${targetPath}｜复核=读回 hash 一致` +
      `｜状态 promoted→retired（合法机器边「退役/回滚」；daemon 需重启加载——v0 只提示）`,
  }
  const precheck = validateEventRecord(event)
  if (!precheck.ok) {
    configInvalid(
      'daemon/gray:event-invalid',
      `SCHEMA_EVOLVE 事件形状预检不过（生产文件未触碰，无半改态）：${precheck.issues.map((i) => `${i.path}: ${i.message}`).join('；')}`,
    )
  }

  // —— ③ 字节级恢复 + 复核（读回 hash 必须等于备份 hash——fail-closed） ——
  copyFileSync(backupPath, targetPath)
  const restoredHash = sha256(readFileSync(targetPath))
  const backupHash = sha256(readFileSync(backupPath))
  if (restoredHash !== backupHash) {
    configInvalid(
      'daemon/gray:restore-verify-mismatch',
      `回滚复核不符：${targetPath} 读回 ${restoredHash} ≠ 备份 ${backupHash}（fail-closed——人工核对目标与备份 ${backupPath}，窗保持 open 待处置）`,
    )
  }

  // —— ④ 状态迁移 promoted→retired（core 判边+store 乐观锁；retired=幂等跳过） ——
  const row = ledger.getCandidate(state.candidateId)
  if (row === undefined) {
    configInvalid('daemon/gray:candidate-unknown', `候选 ${state.candidateId} 不在库（回滚收口面回查失败——人工核对台账，窗保持 open）`)
  }
  if (row.status === 'promoted') {
    const next = coreTransition(toCoreRecord(row), 'retired')
    if (!ledger.transitionCandidate(row.id, 'promoted', next.status)) {
      configInvalid(
        'daemon/gray:transition-lost',
        `候选 ${row.id} promoted→retired 乐观锁落库失败（并发面——人工核对台账；窗保持 open，重进 check 幂等收口）`,
      )
    }
  } else if (row.status !== 'retired') {
    configInvalid(
      'daemon/gray:status-unexpected',
      `候选 ${row.id} 状态 ${row.status} 非预期（灰度回滚收口面只认 promoted→retired / retired 幂等两态——人工核对台账）`,
    )
  }

  // —— ⑤ 事件落账 + kv 关窗（rolled） ——
  ledger.appendEvent(event)
  const rolled: GrayWindowState = {
    ...state,
    status: 'rolled',
    closedAt: now,
    reason: `incident-threshold（窗内事故信号 ${incidents} ≥ 阈值 ${state.maxIncidents}——已自动回滚收口，事件 ${event.id}）`,
  }
  ledger.kvSet(grayKvKey(state.candidateId), JSON.stringify(rolled))
  return event
}

// ————————————————————————— 手动关窗 —————————————————————————

/** 手动关窗结果：changed=false 即窗已收口（幂等面——CLI 打印「无动作」） */
export interface GrayCloseOperation {
  state: GrayWindowState
  changed: boolean
}

/**
 * 手动关窗（CLI `gray --close`）：open → closed（收口时刻+理由留 kv）。窗已收口=幂等返回
 * 原状态无动作（关窗不回滚——回滚只由事故阈值触发，面分离）。
 */
export function closeGrayWindow(ledger: Ledger, candidateId: string, opts: { clock?: () => number; reason?: string } = {}): GrayCloseOperation {
  const state = readGrayWindow(ledger, candidateId)
  if (state === null) {
    configInvalid(
      'daemon/gray:no-window',
      `候选 ${candidateId} 无灰度观察窗（kv ${grayKvKey(candidateId)} 缺——无窗候选无窗可关；先 cutover 开窗或核对候选 id）`,
    )
  }
  if (state.status !== 'open') return { state, changed: false }
  const closed: GrayWindowState = {
    ...state,
    status: 'closed',
    closedAt: (opts.clock ?? Date.now)(),
    reason: opts.reason ?? 'manual-close（手动关窗——CLI --close；窗平安提前收口）',
  }
  ledger.kvSet(grayKvKey(candidateId), JSON.stringify(closed))
  return { state: closed, changed: true }
}

// ————————————————————————— CLI 链打印面 —————————————————————————

function iso(ts: number): string {
  return new Date(ts).toISOString()
}

/** 查窗打印面（bin.ts `gray` 缺省动作用：窗状态+参数+锚点；now 取调用方时钟） */
export function renderGrayStatusLines(state: GrayWindowState, backupPath: string, now: number): string[] {
  const statusText = state.status === 'open' ? 'open（守夜中）' : state.status === 'closed' ? 'closed（平安关窗）' : 'rolled（已回滚收口）'
  const lines = [
    `[gray] 候选 ${state.candidateId}（${state.assetPath} · company=${state.company}）——观察窗状态：${statusText}`,
    `[gray] 窗：openedAt=${iso(state.openedAt)} · windowMs=${String(state.windowMs)}（至 ${iso(state.openedAt + state.windowMs)}） · 阈值=${String(state.maxIncidents)} 条事故信号（ESCALATE/CIRCUIT_BREAK）`,
    `[gray] 备份锚点（回滚物理基础）：${backupPath}`,
  ]
  if (state.status === 'open') {
    lines.push(
      `[gray] 剩余守夜 ${String(Math.max(0, state.openedAt + state.windowMs - now))}ms——到期无事故即灰度完成=可请求制作人过目（20-§四）；手动检查：studio-next gray --check`,
    )
  } else if (state.closedAt !== null) {
    lines.push(`[gray] 收口：${iso(state.closedAt)}｜${state.reason ?? '（无理由记录）'}`)
  }
  return lines
}

/** check 打印面（bin.ts `gray --check` 用：判定行+动作明细行；回滚即证据摘要） */
export function renderGrayCheckLines(result: GrayCheckResult): string[] {
  const head =
    result.rolled
      ? '**已自动回滚**（事故阈值破窗）'
      : result.done
        ? '窗已收口（幂等无动作）'
        : '守夜中（无动作）'
  const lines = [
    `[gray] 候选 ${result.candidateId}（${result.assetPath}）——check：${head}`,
    `[gray] 事故信号：${String(result.incidents)} 条（ESCALATE/CIRCUIT_BREAK，窗内同 company 计数）｜判定：${result.reason}`,
  ]
  if (result.rolled && result.event !== null && result.targetPath !== null) {
    lines.push(
      `[gray] 备份逐字节恢复 → ${result.targetPath}｜复核=读回 hash 一致｜状态 promoted→retired｜台账留痕：SCHEMA_EVOLVE ${result.event.id}（note=gray-rollback）`,
    )
    lines.push(
      '[gray] 回滚后处置：daemon 需重启加载回滚后的资产（v0 只提示——supervisor 看护归运维刀）；原内容重提走 fork 新子代候选（retired 终态不复活）',
    )
  }
  if (!result.rolled && result.done) {
    lines.push('[gray] 灰度完成面：窗平安收口=可请求制作人过目（20-§四「灰度零事故+制作人过目」）')
  }
  return lines
}
