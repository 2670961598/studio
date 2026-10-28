/**
 * company-commit · 订单校验、路径闸、内容摘要与 commit message（MIG-05 / IMPL-05-06）
 *
 * 依据：
 *   - plan/05 IMPL-05-06（一次组织变更单＝一个 commit；message 引单号/记录 id）
 *   - docs/v2/05 §三 DOM-01（公司 git 目录唯一权威；唯一写入者＝daemon 挂单 commit）
 *   - docs/v2/06 §五.1（配置只表**拟任**：本模块只落「已决定变更的目录形态」，不决定、
 *     不宣称任命生效；决定者/依据在记录本体）
 *   - docs/v2/11 §〇.4-4（同单重放返回既有结果、零第二副作用）／§3.2 REC-LIFE-07..11
 *     ／§2.2 REC-AUTH-01（记录引用族唯一主表在 v2/09，本文件只**引用**类型名）
 *
 * 三层闸（任一不过＝拒写，绝不半落）：
 *   ① 订单形状闸：单号/摘要/决定者/决定时间/记录引用/操作集，形状不合即 CONFIG_INVALID；
 *   ② 路径闸（**只写公司目录组织面**）：绝对路径、`..`、反斜杠、控制字符、`.git/`、
 *      `.studio-next/`（信任锚）与组织面白名单外路径一律拒；符号链接穿越另经 lstat 拒；
 *   ③ 家族闸：记录引用只收组织面六族（REC-LIFE-07..11 / REC-AUTH-01）——扩族＝提案/另单，
 *      不得在本模块悄悄放宽（防「顺手把工作单当组织记录提交」）。
 *
 * 摘要与 message：摘要是**订单内容摘要**（按路径规范排序后的 ops 逐字节哈希），不是
 * 记录摘要、不替代记录；message 只留痕（单号/摘要/记录引用/决定位置），不承载决定语义。
 */
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { commitInvalid } from './errors.ts'
import type { OrgChangeOp, OrgChangeOrder } from './types.ts'

// ───────────────────────── 冻结常量（改动＝判据类资产修订，走提案） ─────────────────────────

/** 单号：字母数字起，允许 `._:-`；长度 2..80（禁空白/换行——进 git trailer 不被折断） */
const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/

/** 单行文本（摘要/决定者）：无控制字符、无换行，长度上限由 pattern 尾部约束 */
const SINGLE_LINE_SUMMARY_RE = /^[^\u0000-\u001f\u007f]{1,200}$/
const SINGLE_LINE_ACTOR_RE = /^[^\u0000-\u001f\u007f]{1,120}$/

/** ISO 8601（带时区；`Z` 或 `±hh:mm`——双时间轴归记录信封，本字段只作 message 留痕） */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

/** 记录引用：`<REC 类型>#<记录 id>`（id 形状不锁死——记录 id 唯一主表在 v2/09） */
const RECORD_REF_RE = /^(REC-LIFE-(?:0[7-9]|1[01])|REC-AUTH-01)#[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/

/** 组织面记录家族白名单（plan/05 IMPL-05-06 覆盖范围；扩族＝提案/另单） */
export const ORDER_RECORD_FAMILIES = ['REC-LIFE-07', 'REC-LIFE-08', 'REC-LIFE-09', 'REC-LIFE-10', 'REC-LIFE-11', 'REC-AUTH-01'] as const

/** 可写的整文件（DOM-01 组织面「公司定义」入口；其余定义件不在本单可写面） */
const WRITABLE_EXACT_FILES: readonly string[] = ['org-config.yaml']

/** 可写前缀（组织与人事面：部门配置/人事档案/部门下属文件） */
const WRITABLE_PREFIXES: readonly string[] = ['departments/']

/**
 * 永不可写前缀（机制保证非自律）：
 *   - `.git/`：git 内部格式归 git CLI，不许当普通文件写；
 *   - `.studio-next/`：校验戳与信任锚（trust.json）**不在组织变更单可写面**——
 *     安全面 fail-closed 归 v2/15/IMPL-05-07，防止组织单顺手改信任锚。
 */
const FORBIDDEN_PREFIXES: readonly string[] = ['.git/', '.studio-next/']

/** 单次订单操作上限（防一次变更吞掉整树；超限＝拆单，不是调大阈值） */
const MAX_OPS = 200

/** 单文件内容上限（字符；4M ≈ 4MB UTF-8 上限内——公司定义件无此体量，超限＝误用面） */
const MAX_CONTENT_CHARS = 4_000_000

/** 记录引用上限 */
const MAX_RECORD_REFS = 32

/** 路径长度上限（macOS/Linux 常见 1024 字节文件名上限内留余量） */
const MAX_PATH_LENGTH = 240

/** commit message trailer 键（本模块唯一写者标记；旁路检测按此判「是否 daemon 挂单」） */
export const ORDER_TRAILERS = {
  orderId: 'StudioNext-Order-Id',
  digest: 'StudioNext-Order-Digest',
  authority: 'StudioNext-Authority',
  writer: 'StudioNext-Writer',
  records: 'StudioNext-Records',
} as const

/** 唯一写入者署名（写进 message；不是决定者——决定者在订单 decidedBy） */
export const WRITER_SIGNATURE = 'studio-next-daemon'

// ───────────────────────── 订单解析（形状闸） ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON 文本 → 订单（`--order <file>` 通道；坏 JSON＝CONFIG_INVALID，不猜默认值） */
export function parseOrgChangeOrderJson(text: string): OrgChangeOrder {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    commitInvalid('company-commit/order-json', `订单文件不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
  }
  return parseOrgChangeOrder(parsed)
}

/**
 * 未知输入 → 订单（逐字段校验，任一不合即 CONFIG_INVALID；不做「缺省补全」——
 * 缺省补全＝替决定者补写依据，违反 v2/11 §〇.2-2）。
 */
export function parseOrgChangeOrder(input: unknown): OrgChangeOrder {
  if (!isRecord(input)) commitInvalid('company-commit/order-shape', '订单必须是对象（OrganChangeOrder 形状）')
  const orderId = requireText(input, 'orderId', 'company-commit/order-id')
  if (!ORDER_ID_RE.test(orderId)) {
    commitInvalid('company-commit/order-id', `单号须形如 ORG-2026-0007（字母数字起、允许 ._: -、2..80 字符），实得 ${JSON.stringify(orderId)}`)
  }
  const summary = requireText(input, 'summary', 'company-commit/order-summary')
  if (!SINGLE_LINE_SUMMARY_RE.test(summary)) {
    commitInvalid('company-commit/order-summary', `摘要须为单行文本（1..200 字符、无控制字符），实得 ${JSON.stringify(summary)}`)
  }
  const decidedBy = requireText(input, 'decidedBy', 'company-commit/order-decided-by')
  if (!SINGLE_LINE_ACTOR_RE.test(decidedBy)) {
    commitInvalid('company-commit/order-decided-by', `决定者须具名单行文本（1..120 字符；禁 daemon/框架/系统冒充——v2/11 §〇.2-1），实得 ${JSON.stringify(decidedBy)}`)
  }
  const decidedAt = requireText(input, 'decidedAt', 'company-commit/order-decided-at')
  if (!ISO_8601_RE.test(decidedAt) || Number.isNaN(Date.parse(decidedAt))) {
    commitInvalid('company-commit/order-decided-at', `决定时间须为 ISO 8601（带时区），实得 ${JSON.stringify(decidedAt)}`)
  }
  const recordRefs = parseRecordRefs(input['recordRefs'])
  const ops = parseOps(input['ops'])
  return { orderId, summary, decidedBy, decidedAt, recordRefs, ops }
}

function requireText(source: Record<string, unknown>, key: string, subcause: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value === '') commitInvalid(subcause, `字段 ${key} 必填且为非空字符串`)
  return value
}

function parseRecordRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    commitInvalid('company-commit/order-record-refs', 'recordRefs 必填且 ≥1（commit message 必须能引到组织面记录）')
  }
  if (value.length > MAX_RECORD_REFS) {
    commitInvalid('company-commit/order-record-refs', `recordRefs 上限 ${MAX_RECORD_REFS} 条（超限＝拆单）`)
  }
  const refs: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !RECORD_REF_RE.test(entry)) {
      commitInvalid(
        'company-commit/order-record-family',
        `记录引用须形如 REC-LIFE-08#org-event-0001，家族限 ${ORDER_RECORD_FAMILIES.join('、')}；实得 ${JSON.stringify(entry)}`,
      )
    }
    if (refs.includes(entry)) continue // 同一记录重复引用＝同一决定，去重不拒
    refs.push(entry)
  }
  return refs
}

function parseOps(value: unknown): readonly OrgChangeOp[] {
  if (!Array.isArray(value) || value.length === 0) {
    commitInvalid('company-commit/order-ops', 'ops 必填且 ≥1（空单不提交——禁止空 commit 冒充组织变更）')
  }
  if (value.length > MAX_OPS) commitInvalid('company-commit/order-ops', `ops 上限 ${MAX_OPS} 条（超限＝拆单）`)
  const ops: OrgChangeOp[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) commitInvalid('company-commit/order-op-shape', '每个操作必须是对象')
    const kind = entry['kind']
    const rawPath = entry['path']
    if (typeof rawPath !== 'string') commitInvalid('company-commit/order-op-shape', '操作 path 必填且为字符串')
    const filePath = assertWritableCompanyPath(rawPath)
    if (seen.has(filePath)) commitInvalid('company-commit/order-duplicate-path', `同一订单内路径重复：${filePath}（一个文件一单只允许一个操作）`)
    seen.add(filePath)
    if (kind === 'upsert-file') {
      const content = entry['content']
      if (typeof content !== 'string') commitInvalid('company-commit/order-op-shape', `upsert-file 的 content 必填且为字符串：${filePath}`)
      if (content.length > MAX_CONTENT_CHARS) {
        commitInvalid('company-commit/order-content-size', `文件内容超上限 ${MAX_CONTENT_CHARS} 字符：${filePath}`)
      }
      ops.push({ kind: 'upsert-file', path: filePath, content })
      continue
    }
    if (kind === 'delete-file') {
      ops.push({ kind: 'delete-file', path: filePath })
      continue
    }
    commitInvalid('company-commit/order-op-shape', `未知操作 kind=${JSON.stringify(kind)}（只收 upsert-file/delete-file）`)
  }
  return ops
}

// ───────────────────────── 路径闸（只写公司目录组织面） ─────────────────────────

/**
 * 公司目录相对路径闸：返回规范化 posix 路径；不合即 CONFIG_INVALID。
 * 纯函数（零 IO）——符号链接穿越由 {@link assertNoSymlinkEscape} 另经 lstat 拒。
 */
export function assertWritableCompanyPath(rawPath: string): string {
  if (rawPath === '' || rawPath.trim() !== rawPath) {
    commitInvalid('company-commit/order-path', `路径不得为空或含首尾空白：${JSON.stringify(rawPath)}`)
  }
  if (rawPath.length > MAX_PATH_LENGTH) commitInvalid('company-commit/order-path', `路径超长（>${MAX_PATH_LENGTH}）：${rawPath}`)
  if (rawPath.includes('\\')) commitInvalid('company-commit/order-path', `路径只收 posix 分隔符（禁反斜杠）：${rawPath}`)
  if (/[\u0000-\u001f\u007f]/.test(rawPath)) commitInvalid('company-commit/order-path', `路径含控制字符：${JSON.stringify(rawPath)}`)
  if (path.posix.isAbsolute(rawPath)) commitInvalid('company-commit/order-path', `路径不得为绝对路径（只许公司目录内相对路径）：${rawPath}`)
  const segments = rawPath.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      commitInvalid('company-commit/order-path', `路径不得含空段/./..（越界与歧义一律拒）：${rawPath}`)
    }
  }
  const normalized = segments.join('/')
  if (normalized !== rawPath) commitInvalid('company-commit/order-path', `路径未规范化：${rawPath}`)
  for (const forbidden of FORBIDDEN_PREFIXES) {
    if (normalized === forbidden.slice(0, -1) || normalized.startsWith(forbidden)) {
      commitInvalid('company-commit/order-forbidden-path', `路径在禁写面（${forbidden}）：${normalized}——信任锚/git 内部不归组织变更单`)
    }
  }
  const exact = WRITABLE_EXACT_FILES.includes(normalized)
  const prefixed = WRITABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length)
  if (!exact && !prefixed) {
    commitInvalid(
      'company-commit/order-path-outside-face',
      `路径不在组织面可写白名单（${[...WRITABLE_EXACT_FILES, ...WRITABLE_PREFIXES].join('、')}）：${normalized}——章程/定义包/报告等各自归属另单`,
    )
  }
  return normalized
}

/**
 * 符号链接穿越闸：路径链上任一已存在段为符号链接即拒（写入会跟随链接跑到公司目录外）。
 * 只做 lstat，不改任何东西；缺段＝该段之后不可能存在，提前收束。
 *
 * 诚实边界：这是**写前检查**——检查与写入之间链接被替换的 TOCTOU 窗口未消（跨写者围栏
 * ＝目标未证，v2/05 §三通则 2）；单进程写者＋提交前 HEAD 竞移检测下风险面收窄但不必宣称已封死。
 */
export async function assertNoSymlinkEscape(companyDir: string, rawPath: string): Promise<void> {
  const filePath = assertWritableCompanyPath(rawPath)
  const segments = filePath.split('/')
  let current = companyDir
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === undefined) break
    current = path.join(current, segment)
    let info
    try {
      info = await lstat(current)
    } catch {
      return // 该段不存在：其后不可能存在，写入将由 apply 建目录/建文件
    }
    if (info.isSymbolicLink()) {
      commitInvalid('company-commit/symlink-path', `路径链含符号链接（拒穿越到公司目录外）：${segments.slice(0, index + 1).join('/')}`)
    }
    if (index < segments.length - 1 && !info.isDirectory()) {
      return // 中间段是文件：写入必然失败，由 apply 面如实报 EISDIR/ENOTDIR
    }
  }
}

// ───────────────────────── 内容摘要与 commit message ─────────────────────────

/**
 * 订单内容摘要（canonical：按路径排序后的 ops 逐字节入哈希）。
 * 用途：①同单号重放判定「同内容→返回既有结果／不同内容→拒」；②message 留痕供对账。
 * 不含 decidedBy/decidedAt/summary——同号换摘要＝换叙述不换事实，不应被当作新变更。
 */
export function orderDigest(order: OrgChangeOrder): string {
  const sorted = [...order.ops].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const hasher = createHash('sha256')
  for (const op of sorted) {
    if (op.kind === 'upsert-file') {
      hasher.update(`upsert\u0000${op.path}\u0000`)
      hasher.update(op.content)
      hasher.update('\u0000')
    } else {
      hasher.update(`delete\u0000${op.path}\u0000`)
    }
  }
  return hasher.digest('hex')
}

/** 订单路径集（排序，用于证据与 message） */
export function orderPaths(order: OrgChangeOrder): readonly string[] {
  return [...order.ops.map((op) => op.path)].sort()
}

/** commit message（首行引单号；尾部 trailer 引记录引用/摘要/署名——git log 逐单可查） */
export function renderCommitMessage(order: OrgChangeOrder): string {
  const paths = orderPaths(order)
  const digest = orderDigest(order)
  const shown = paths.slice(0, 12)
  const pathLine = shown.length === paths.length ? shown.join('、') : `${shown.join('、')}…（共 ${paths.length} 条）`
  return [
    `org-change(${order.orderId}): ${order.summary}`,
    '',
    `决定位置：${order.decidedBy}`,
    `决定时间：${order.decidedAt}`,
    `变更路径：${pathLine}`,
    '',
    `${ORDER_TRAILERS.orderId}: ${order.orderId}`,
    `${ORDER_TRAILERS.digest}: sha256:${digest}`,
    `${ORDER_TRAILERS.authority}: DOM-01`,
    `${ORDER_TRAILERS.writer}: ${WRITER_SIGNATURE}`,
    `${ORDER_TRAILERS.records}: ${order.recordRefs.join(', ')}`,
  ].join('\n')
}

/** 解析后的 message 面（只读；旁路判定按 orderId 是否存在） */
export interface ParsedCommitMessage {
  readonly orderId: string | null
  readonly digest: string | null
  readonly authority: string | null
  readonly records: readonly string[]
}

const TRAILER_LINE_RE = new RegExp(`^(${Object.values(ORDER_TRAILERS).join('|')}):[ \\t]*(.*)$`)

/** 从任意 commit message 抽 trailer（无 trailer＝非 daemon 挂单 commit） */
export function parseCommitMessage(message: string): ParsedCommitMessage {
  let orderId: string | null = null
  let digest: string | null = null
  let authority: string | null = null
  let records: readonly string[] = []
  for (const line of message.split('\n')) {
    const match = TRAILER_LINE_RE.exec(line)
    if (match === null) continue
    const key = match[1]
    const value = (match[2] ?? '').trim()
    if (key === ORDER_TRAILERS.orderId) orderId = value === '' ? null : value
    else if (key === ORDER_TRAILERS.digest) digest = value === '' ? null : value
    else if (key === ORDER_TRAILERS.authority) authority = value === '' ? null : value
    else if (key === ORDER_TRAILERS.records) {
      records = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
    }
  }
  return { orderId, digest, authority, records }
}
