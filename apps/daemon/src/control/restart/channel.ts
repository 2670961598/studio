/**
 * control/restart/channel —— 受权重启控制通道（studio-dev-504 S1；studio-dev-555 去重）
 *
 * 依据（实现单引用）：#497 plan §4.6（控制通道/授权链/反伪造反重放）与 §10.1（接口签名）；
 *   docs/17-§2（拍边界纪律——控制面请求在 tick 收口后消费）；docs/17-§3（事件枚举冻结：
 *   新增 RESTART_* 属契约面，未批前只以 SCHEMA_EVOLVE 事件 + note 前缀
 *   `SCHEMA_EVOLVE;RESTART;` 过渡，C-1 硬边界——本文件不新增契约名）；docs/43-§五②
 *   （worker 写域不含 control/，防伪造靠写域+owner/mode/lstat 而非读面保密）；
 *   docs/v2/15 §二 SEC-SIG-01/§五 SEC-RD-02（同进程信封闸，不冒充独立验签）。
 *
 * 文件协议（**三通道单源**：`control/channel/protocol.ts` + `channel/file-io.ts`；studio-dev-555
 *   消除了 #504 的第 3 套并行实现与第 7 处 sha256/平行原子写）：
 *   CLI/高层：写请求（通用通道原子写口）→ <rootDir>/control/restart.request.json（0600）
 *   daemon：inspectRestartRequest（lstat/owner/mode/size → 严格 schema）→ 授权面
 *           validateRestartAuthorization（预登记 ref/期限/一次性/组织相对谓词）
 *           → writeRestartResult 回执；consume 改名 .consume（live 面清空）
 *   本件只留 restart 薄语义：形状/schema/授权谓词/留痕；文件 IO 与错误分类归通用 helper。
 *
 * 纪律：
 *   - 未知字段/坏 JSON/符号链接/硬链接/宽权限/owner 不符一律 fail-closed，不改运行态；
 *   - **权限错/IO 错 ≠ 不存在**（studio-dev-555 要求④）：lstat/read 分类后 fail-closed 拒绝
 *     （reason=control-io-error + 回执/事件留痕），不再静默当 absent（低危 fail-open 收口）；
 *   - 拒绝也要留痕（serve 编排落 SCHEMA_EVOLVE;RESTART;phase=rejected），不落授权原文；
 *   - 授权 ref 只在检查点提交后 burn（burn-at-commit），draining 中途崩溃仍可用一次。
 */
import path from 'node:path'
import type { Stats } from 'node:fs'
import type { EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../../engine/tools/id.ts'
import { lstatOutcome, readTextOutcome, type FsProblem } from '../channel/file-io.ts'
import { controlDirOf } from '../channel/paths.ts'
import { defineControlChannel } from '../channel/protocol.ts'

const RESTART_REQUEST_FILE = 'restart.request.json'
const RESTART_RESULT_FILE = 'restart.result.json'
const RESTART_REQUEST_CONSUMED_FILE = `${RESTART_REQUEST_FILE}.consume`
/** 请求幂等位（同 id 不二次执行；跨重启读回） */
export const RESTART_LAST_SEEN_KV_KEY = 'restart.lastSeenId'
/** 一次性授权 burn 位（成功检查点后写；值=requestId） */
export const RESTART_USED_KV_PREFIX = 'restart.used.'
/** 检查点/退出标记目录（<rootDir>/restart；非 control 写域——daemon 专属） */
const RESTART_DIR = 'restart'

/** 触发方（组织相对谓词的输入；level/role 只作审计，不做放行依据） */
export interface RestartActor {
  personId: string
  role: string
  level: number
}

/** 受权重启请求（strict schema；未知字段拒） */
export interface RestartRequest {
  id: string
  requestedAt: number
  reason: string
  authorizationRef: string
  actor: RestartActor
  /** 请求可收紧 drain 期限（只能 min(配置,请求)，下限 5000/上限 1800000） */
  drainTimeoutMs?: number
  /** 运维选项：进入 draining 即停唤起源（缺省 false——源只 ingest，派发闸已关） */
  stopSources?: boolean
}

/** 回执（daemon 写；CLI 按 id 匹配——旧回执不误读） */
export interface RestartResult {
  id: string
  ok: boolean
  accepted: boolean
  state: 'accepted' | 'draining' | 'checkpointing' | 'rejected' | 'done'
  reason?: string
  detail?: string
}

/** 部署面预登记授权条目（daemon.yaml 指向的 0600 文件或内联 JSON 数组） */
export interface RestartAuthorization {
  ref: string
  approver: string
  approverRole: string
  issuedAt: number
  expiresAt: number
  scope: 'daemon-restart'
  text: string
}

/** 拒绝理由（机器可比对；note/回执同源） */
export type RestartReject =
  | 'control-file-provenance'
  | 'control-io-error'
  | 'bad-json'
  | 'unknown-field'
  | 'id-invalid'
  | 'auth-ref-missing'
  | 'auth-ref-unknown'
  | 'auth-expired'
  | 'auth-replayed'
  | 'actor-unknown'
  | 'actor-not-authorized'
  | 'timeout-invalid'
  | 'already-draining'

/** 请求文件检查三态（absent=无 live 请求；rejected 带机读理由） */
export type RestartInspection =
  | { kind: 'absent' }
  | { kind: 'ok'; request: RestartRequest; file: string }
  | { kind: 'rejected'; reason: RestartReject; detail: string; file: string }

/** 组织快照（授权谓词的唯一输入；取自公司目录装载，不读请求自述等级） */
export interface RestartOrgSnapshot {
  people: readonly { id: string; level: number; dept: string; status?: string; role?: string }[]
  departments: readonly { path: string; parent: string | null; leader: string | null }[]
  companyLevel: number
}

export interface RestartAuthorizationInput {
  request: RestartRequest
  authorizations: readonly RestartAuthorization[]
  org: RestartOrgSnapshot
  now: number
  usedRefs: ReadonlySet<string>
  extraAuthorizers: ReadonlySet<string>
}

/** 公司快照 → 授权谓词输入（level 取名册；leader 取部门表——不读请求自述等级） */
export function toRestartOrgSnapshot(snapshot: {
  people: readonly { id: string; level: number; dept: string; status?: string; role?: string }[]
  departments: readonly { path: string; parent: string | null; leader: string }[]
  level: number
}): RestartOrgSnapshot {
  return {
    people: snapshot.people,
    departments: snapshot.departments.map((d) => ({ path: d.path, parent: d.parent, leader: d.leader })),
    companyLevel: snapshot.level,
  }
}

/** 检查点目录（<rootDir>/restart） */
export function restartDirOf(rootDir: string): string {
  return path.join(rootDir, RESTART_DIR)
}

/**
 * 重启通道（三通道通用协议实例）：请求/回执均 0600（含授权 ref 与 actor 面——比 stop/reload 严）。
 * 请求写面**不再**单独导出（studio-dev-555 要求③：原写请求函数全仓仅测试引用 → 收口到通用
 * 协议，stop/reload 的生产 CLI 已覆盖同一实现；消费/读回执同理，只剩内部调用）。
 */
const RESTART_CHANNEL = defineControlChannel<RestartRequest, RestartResult>({
  files: { request: RESTART_REQUEST_FILE, result: RESTART_RESULT_FILE, consumed: RESTART_REQUEST_CONSUMED_FILE },
  requestMode: 0o600,
  resultMode: 0o600,
  decodeResult: (raw) => ({
    id: raw['id'] as string,
    ok: raw['ok'] === true,
    accepted: raw['accepted'] === true,
    state: (raw['state'] ?? 'rejected') as RestartResult['state'],
    ...(typeof raw['reason'] === 'string' ? { reason: raw['reason'] } : {}),
    ...(typeof raw['detail'] === 'string' ? { detail: raw['detail'] } : {}),
  }),
})

/** 单行 note 值清洗（不落换行/分号；长度有界——审计可读且不破坏 note 结构） */
function noteValue(value: string, max = 240): string {
  const flat = value.replace(/[\r\n;]+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 重启事件 note（C-1 过渡口径）：事件名恒 SCHEMA_EVOLVE（契约冻结面不动），
 * note 以 `SCHEMA_EVOLVE;RESTART;` 开头 + phase/字段。
 */
export function restartNote(phase: string, fields: readonly (readonly [string, string | number | boolean])[] = []): string {
  const parts = fields.map(([k, v]) => `${k}=${noteValue(String(v))}`)
  return `SCHEMA_EVOLVE;RESTART;phase=${phase}${parts.length > 0 ? `;${parts.join(';')}` : ''}`
}

/** 治理面事件名（重启留痕只碰既有冻结名；C-1：不新增 RESTART_* 契约名） */
export type RestartGovernanceEvent = 'SCHEMA_EVOLVE' | 'DAILY_ALARM' | 'ESCALATE'

/** 落一条治理面事件（append-only；actor=system:daemon + onBehalfOf 走 note authorizer） */
export function appendDaemonEvent(
  ledger: Ledger,
  args: {
    event: RestartGovernanceEvent
    company: string
    level: number
    dept: string
    note: string
    now: number
    actor?: string
    /** 预生成事件 id（检查点需在 append 前引用同一 id；缺省现铸） */
    eventId?: string
  },
): EventRecord {
  const event: EventRecord = {
    id: args.eventId ?? makeUlid(args.now),
    ts: args.now,
    company: args.company,
    issue: '-',
    event: args.event,
    actor: args.actor ?? 'system:daemon',
    attempt: 1,
    level: Math.min(9, Math.max(1, Math.trunc(args.level))),
    dept: args.dept,
    tokens: { input: 0 },
    note: args.note,
  }
  ledger.appendEvent(event)
  return event
}

/** 落一条重启事件（C-1 过渡口径：event=SCHEMA_EVOLVE，note 以 `SCHEMA_EVOLVE;RESTART;` 起） */
export function appendRestartEvent(
  ledger: Ledger,
  args: {
    company: string
    level: number
    dept: string
    note: string
    now: number
    actor?: string
    /** 预生成事件 id（检查点需在 append 前引用同一 id；缺省现铸） */
    eventId?: string
  },
): EventRecord {
  return appendDaemonEvent(ledger, { ...args, event: 'SCHEMA_EVOLVE' })
}

// ————————————————————————— 文件面 —————————————————————————

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
const MAX_REQUEST_BYTES = 8192
const REQUEST_FIELDS = new Set(['id', 'requestedAt', 'reason', 'authorizationRef', 'actor', 'drainTimeoutMs', 'stopSources'])
const ACTOR_FIELDS = new Set(['personId', 'role', 'level'])

function uidOf(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1
}

function modeOf(mode: number): number {
  return mode & 0o777
}

function rejected(reason: RestartReject, detail: string, file: string): RestartInspection {
  return { kind: 'rejected', reason, detail, file }
}

/** 权限/IO 面描述（fail-closed 拒绝留痕用；不含敏感原文） */
function problemDetail(problem: FsProblem): string {
  return `${problem.errorClass}/${problem.code}：${problem.message}`
}

/**
 * 读请求并做文件面 provenance 闸（N6）：control/ 目录 0700+owner；请求 lstat 普通文件
 * （拒符号链接/硬链接歧义）、owner==daemon uid、非 group/other 可写、size≤8192。
 *
 * 错误分类（studio-dev-555 要求④）：lstat/read 的**权限错与 IO 错一律 fail-closed 拒绝**
 * （reason=control-io-error）；只有 ENOENT/ENOTDIR 才是「无 live 请求」（absent）。
 */
export function inspectRestartRequest(rootDir: string, opts?: { expectedUid?: number }): RestartInspection {
  const controlDir = controlDirOf(rootDir)
  const file = RESTART_CHANNEL.requestFileOf(rootDir)
  const dirOutcome = lstatOutcome(controlDir)
  if (dirOutcome.kind === 'absent') return { kind: 'absent' } // control 目录未建=无请求（不是拒绝；CLI 首次写会 0700 建）
  if (dirOutcome.kind === 'problem') return rejected('control-io-error', `control 目录不可访问（${problemDetail(dirOutcome.problem)}）`, file)
  const dirStat = dirOutcome.stat
  const expectedUid = opts?.expectedUid ?? uidOf()
  if (!dirStat.isDirectory()) return rejected('control-file-provenance', 'control 不是目录', file)
  if (dirStat.uid !== expectedUid) return rejected('control-file-provenance', `control owner=${dirStat.uid} 非 daemon uid=${expectedUid}`, file)
  if (modeOf(dirStat.mode) !== 0o700) return rejected('control-file-provenance', `control mode=${modeOf(dirStat.mode).toString(8)} 非 0700`, file)

  const fileOutcome = lstatOutcome(file)
  if (fileOutcome.kind === 'absent') return { kind: 'absent' }
  if (fileOutcome.kind === 'problem') return rejected('control-io-error', `请求文件 lstat 失败（${problemDetail(fileOutcome.problem)}）`, file)
  const stat = fileOutcome.stat
  if (stat.isSymbolicLink()) return rejected('control-file-provenance', '请求文件是符号链接（拒）', file)
  if (!stat.isFile()) return rejected('control-file-provenance', '请求文件不是普通文件（拒）', file)
  if (stat.nlink > 1) return rejected('control-file-provenance', `请求文件存在硬链接（nlink=${stat.nlink}）`, file)
  if (stat.uid !== expectedUid) return rejected('control-file-provenance', `请求 owner=${stat.uid} 非 daemon uid=${expectedUid}`, file)
  if ((stat.mode & 0o022) !== 0) return rejected('control-file-provenance', `请求文件 group/other 可写（mode=${modeOf(stat.mode).toString(8)}）`, file)
  if (stat.size > MAX_REQUEST_BYTES) return rejected('control-file-provenance', `请求文件 ${stat.size}B > ${MAX_REQUEST_BYTES}B`, file)

  const read = readTextOutcome(file)
  if (read.kind === 'absent') return { kind: 'absent' } // 检查与读取之间被消费（拍内竞态，非拒绝）
  if (read.kind === 'problem') return rejected('control-io-error', `请求文件不可读（${problemDetail(read.problem)}）`, file)
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return rejected('bad-json', '请求文件不是合法 JSON', file)
  }
  const checked = validateRequestShape(parsed)
  if (!checked.ok) return rejected(checked.reason, checked.detail, file)
  return { kind: 'ok', request: checked.request, file }
}

function validateRequestShape(value: unknown): { ok: true; request: RestartRequest } | { ok: false; reason: RestartReject; detail: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'bad-json', detail: '请求不是 JSON 对象' }
  }
  const raw = value as Record<string, unknown>
  const unknown = Object.keys(raw).filter((k) => !REQUEST_FIELDS.has(k))
  if (unknown.length > 0) return { ok: false, reason: 'unknown-field', detail: `未知字段：${unknown.join(',')}` }
  const id = raw['id']
  if (typeof id !== 'string' || !ULID_RE.test(id)) return { ok: false, reason: 'id-invalid', detail: 'id 须为 26 位 ULID' }
  const requestedAt = raw['requestedAt']
  if (typeof requestedAt !== 'number' || !Number.isSafeInteger(requestedAt) || requestedAt <= 0) {
    return { ok: false, reason: 'bad-json', detail: 'requestedAt 须为正整数 epoch ms' }
  }
  const reason = raw['reason']
  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 500) {
    return { ok: false, reason: 'bad-json', detail: 'reason 须为 1..500 字非空串' }
  }
  const authRef = raw['authorizationRef']
  if (typeof authRef !== 'string' || authRef.trim() === '') {
    return { ok: false, reason: 'auth-ref-missing', detail: '缺 authorizationRef（无授权不重启）' }
  }
  const actorRaw = raw['actor']
  if (typeof actorRaw !== 'object' || actorRaw === null || Array.isArray(actorRaw)) {
    return { ok: false, reason: 'bad-json', detail: 'actor 须为对象' }
  }
  const actorObj = actorRaw as Record<string, unknown>
  const actorUnknown = Object.keys(actorObj).filter((k) => !ACTOR_FIELDS.has(k))
  if (actorUnknown.length > 0) return { ok: false, reason: 'unknown-field', detail: `actor 未知字段：${actorUnknown.join(',')}` }
  const personId = actorObj['personId']
  const role = actorObj['role']
  const level = actorObj['level']
  if (typeof personId !== 'string' || personId.trim() === '') return { ok: false, reason: 'bad-json', detail: 'actor.personId 须为非空串' }
  if (typeof role !== 'string') return { ok: false, reason: 'bad-json', detail: 'actor.role 须为字符串' }
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9) {
    return { ok: false, reason: 'bad-json', detail: 'actor.level 须为 1..9 整数' }
  }
  let drainTimeoutMs: number | undefined
  if (raw['drainTimeoutMs'] !== undefined) {
    const t = raw['drainTimeoutMs']
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 5_000 || t > 1_800_000) {
      return { ok: false, reason: 'timeout-invalid', detail: 'drainTimeoutMs 须为 5000..1800000 整数（请求只能收紧）' }
    }
    drainTimeoutMs = t
  }
  let stopSources: boolean | undefined
  if (raw['stopSources'] !== undefined) {
    if (typeof raw['stopSources'] !== 'boolean') return { ok: false, reason: 'bad-json', detail: 'stopSources 须为布尔' }
    stopSources = raw['stopSources']
  }
  return {
    ok: true,
    request: {
      id,
      requestedAt,
      reason,
      authorizationRef: authRef,
      actor: { personId, role, level },
      ...(drainTimeoutMs !== undefined ? { drainTimeoutMs } : {}),
      ...(stopSources !== undefined ? { stopSources } : {}),
    },
  }
}

/** 原子写回执（daemon 侧，0600；CLI 按 id 匹配） */
export function writeRestartResult(rootDir: string, result: RestartResult): void {
  RESTART_CHANNEL.writeResult(rootDir, result)
}

// ————————————————————————— 部署面授权预登记 —————————————————————————

function parseAuthorizationEntries(value: unknown): RestartAuthorization[] {
  if (!Array.isArray(value)) throw new Error('CONFIG_INVALID：重启授权须为 JSON 数组')
  return value.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条不是对象`)
    }
    const e = entry as Record<string, unknown>
    const allowed = new Set(['ref', 'approver', 'approverRole', 'issuedAt', 'expiresAt', 'scope', 'text'])
    const unknown = Object.keys(e).filter((k) => !allowed.has(k))
    if (unknown.length > 0) throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条未知字段：${unknown.join(',')}`)
    const ref = e['ref']
    const approver = e['approver']
    const approverRole = e['approverRole']
    const issuedAt = e['issuedAt']
    const expiresAt = e['expiresAt']
    const scope = e['scope']
    const text = e['text']
    if (typeof ref !== 'string' || ref.trim() === '') throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 ref 空`)
    if (typeof approver !== 'string' || approver.trim() === '') throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 approver 空`)
    if (typeof approverRole !== 'string') throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 approverRole 非串`)
    if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt)) throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 issuedAt 非整数`)
    if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 expiresAt 非整数`)
    if (expiresAt <= issuedAt) throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 expiresAt 须晚于 issuedAt`)
    if (scope !== 'daemon-restart') throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 scope 须为 daemon-restart`)
    if (typeof text !== 'string' || text.trim() === '') throw new Error(`CONFIG_INVALID：重启授权第 ${i + 1} 条 text 空（授权原文必填）`)
    return { ref, approver, approverRole, issuedAt, expiresAt, scope, text }
  })
}

/**
 * 装载部署面预登记授权（file 优先，其次 inline；二选一由 config 校验）。
 * 文件面：0600、owner==daemon uid、普通文件、≤64KiB（与请求同纪律，fail-closed）。
 */
export function loadRestartAuthorizations(source: {
  file?: string
  inline?: string
  expectedUid?: number
}): RestartAuthorization[] {
  if (source.file !== undefined) {
    const stat = lstatSyncOf(source.file)
    const expectedUid = source.expectedUid ?? uidOf()
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('CONFIG_INVALID：重启授权文件须为普通文件（拒符号链接）')
    if (stat.uid !== expectedUid) throw new Error(`CONFIG_INVALID：重启授权文件 owner=${stat.uid} 非 daemon uid=${expectedUid}`)
    if ((stat.mode & 0o077) !== 0) throw new Error('CONFIG_INVALID：重启授权文件须 0600（group/other 无权限）')
    if (stat.size > 65_536) throw new Error('CONFIG_INVALID：重启授权文件 >64KiB')
    return parseAuthorizationEntries(JSON.parse(readFileSyncText(source.file)))
  }
  if (source.inline !== undefined) return parseAuthorizationEntries(JSON.parse(source.inline))
  throw new Error('CONFIG_INVALID：restartEnabled=true 须配 restartAuthorizationFile 或 restartAuthorizations')
}

/** 部署面文件 lstat（失败即抛——装载期 fail-closed，不静默降级为「无授权」） */
function lstatSyncOf(file: string): Stats {
  const outcome = lstatOutcome(file)
  if (outcome.kind === 'ok') return outcome.stat
  const why = outcome.kind === 'absent' ? '不存在' : problemDetail(outcome.problem)
  throw new Error(`CONFIG_INVALID：授权文件不可用（${why}）`)
}

/** 部署面文件读取（失败即抛——装载期 fail-closed） */
function readFileSyncText(file: string): string {
  const outcome = readTextOutcome(file)
  if (outcome.kind === 'ok') return outcome.text
  const why = outcome.kind === 'absent' ? '不存在' : problemDetail(outcome.problem)
  throw new Error(`CONFIG_INVALID：授权文件不可读（${why}）`)
}

// ————————————————————————— 授权与组织谓词（纯函数） —————————————————————————

/**
 * 授权链校验（fail-closed，顺序即语义）：
 *   1. ref 必须在预登记表（否则 auth-ref-unknown）；
 *   2. scope/期限（now ∈ [issuedAt, expiresAt]）；
 *   3. 一次性（usedRefs 命中=auth-replayed）；
 *   4. actor 在册且 active（actor-unknown）；
 *   5. 组织相对谓词：部门主管/一级单元首长/公司最高负责人 = 部门 leader；
 *      绝对等级只作下界（>=min(companyLevel,8)）或显式白名单（actor-not-authorized）。
 * 不冒充独立验签：只自称「部署面授权 + 同进程信封闸」（SEC-SIG-02/SEC-RD-02）。
 */
export function validateRestartAuthorization(
  args: RestartAuthorizationInput,
): { ok: true; authorization: RestartAuthorization } | { ok: false; reason: RestartReject; detail: string } {
  const { request, authorizations, org, now, usedRefs, extraAuthorizers } = args
  const auth = authorizations.find((a) => a.ref === request.authorizationRef)
  if (auth === undefined) return { ok: false, reason: 'auth-ref-unknown', detail: 'authorizationRef 未命中部署面预登记' }
  if (auth.scope !== 'daemon-restart') return { ok: false, reason: 'auth-ref-unknown', detail: '授权 scope 非 daemon-restart' }
  if (!(now >= auth.issuedAt && now <= auth.expiresAt)) return { ok: false, reason: 'auth-expired', detail: `授权不在有效期（now=${now}，[${auth.issuedAt},${auth.expiresAt}]）` }
  if (usedRefs.has(auth.ref)) return { ok: false, reason: 'auth-replayed', detail: '授权 ref 已消费（一次性）' }

  const person = org.people.find((p) => p.id === request.actor.personId)
  if (person === undefined) return { ok: false, reason: 'actor-unknown', detail: `actor ${request.actor.personId} 不在公司名册` }
  if (person.status !== undefined && person.status !== 'active') {
    return { ok: false, reason: 'actor-unknown', detail: `actor ${person.id} 状态 ${person.status} 非 active` }
  }
  // 组织相对谓词（C-2 已批）：部门 leader 覆盖「部门主管/一级单元首长/公司最高负责人」三形；
  // 不硬编码 level>=8（3 级公司全员会被拒——#497 §3 冲突登记的根因）。
  const led = org.departments.filter((d) => d.leader === person.id)
  const isLeader = led.length > 0
  const levelFloorOk = person.level >= Math.min(org.companyLevel, 8) || extraAuthorizers.has(person.id)
  if (!isLeader) return { ok: false, reason: 'actor-not-authorized', detail: `actor ${person.id} 非部门 leader（组织相对谓词）` }
  if (!levelFloorOk) {
    return { ok: false, reason: 'actor-not-authorized', detail: `actor ${person.id} level=${person.level} < min(companyLevel,8)=${Math.min(org.companyLevel, 8)} 且不在白名单` }
  }
  // 组织面完整性：leader 指向的部门须在快照内（快照自洽防御，不改变放行语义）
  if (led.some((d) => d.path.trim() === '')) return { ok: false, reason: 'actor-not-authorized', detail: '部门 leader 记录 path 空' }
  return { ok: true, authorization: auth }
}

/** 计算请求期限（只能收紧：min(配置, 请求)，业务缺省 180s；越界已在 schema 拒） */
export function effectiveDrainTimeoutMs(configDefault: number, request?: number): number {
  return request === undefined ? configDefault : Math.min(configDefault, request)
}

/**
 * 拒绝收口（回执→事件→消费请求）：拒绝不改运行态，但**必须留痕**（宁多勿漏）。
 * 事件失败不阻断回执/消费；调用方负责 kv lastSeen 去重位（防重复拒绝噪音）。
 */
export function rejectRestartRequest(
  ledger: Ledger,
  args: {
    rootDir: string
    company: string
    level: number
    dept: string
    id: string
    reason: RestartReject
    detail: string
    actorId?: string
    file: string
    now: number
  },
): void {
  writeRestartResult(args.rootDir, { id: args.id, ok: false, accepted: false, state: 'rejected', reason: args.reason, detail: args.detail })
  try {
    appendRestartEvent(ledger, {
      company: args.company,
      level: args.level,
      dept: args.dept,
      now: args.now,
      note: restartNote('rejected', [
        ['reason', args.reason],
        ['actor', args.actorId ?? 'unknown'],
        ['request_id', args.id],
        ['file', path.basename(args.file)],
      ]),
    })
  } catch {
    // 台账不可写：回执仍落（CLI 可见），事件缺口由日志/回执如实承担
  }
  RESTART_CHANNEL.consumeRequest(args.rootDir)
}

/** 事件署名元数据（level/dept 取名册；未知人回退首部门/公司 slug——事件必填面不空） */
export function eventMetaOf(
  snapshot: { people: readonly { id: string; level: number; dept: string }[]; departments: readonly { path: string }[] },
  personId: string | undefined,
  fallback: string,
): { level: number; dept: string } {
  const person = personId === undefined ? undefined : snapshot.people.find((p) => p.id === personId)
  return { level: person?.level ?? 1, dept: person?.dept ?? snapshot.departments[0]?.path ?? fallback }
}

