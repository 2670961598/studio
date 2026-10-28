/**
 * trust —— 制作人侧信任锚（DEV-27 正式化；docs/44 §二 条款2/4 设计的正式落法）
 *
 * 来源：spike/spec-v1 分支 cbae8c2（docs/44 双轮 1490/1490 验证过的实现）→
 * v1.1 spike 原型（docs/44-§v1.1 机制一验证面，18 用例）→
 * 本文件（DEV-27 主仓正式化）——语义零改动：
 *   - **锚落点**：<公司目录>/.studio-next/trust.json——daemon 自管目录（与 .git 同类，
 *     不是公司包分发件的一部分）。内容指纹与变更监听一律排除 .studio-next/ 下的锚文件
 *     （锚内记录指纹、指纹覆盖锚=自指，机制上必须隔离——docs/44 §四-2 机制发现）。
 *   - **import 落锚 trust:false**：导入的公司目录默认不可信——等制作人显式 approve。
 *   - **approve（制作人显式动作）**：trust→true + 落内容指纹 + 谁/何时留痕（history 追加）。
 *   - **re-approve**：指纹漂移被拦下后的重新批准（重算指纹 + 新 history 条目）。
 *   - **内容指纹算法**：per-file sha256(utf8) hex；总指纹=sorted(`path:hash`) 行串的
 *     sha256（`sha256:` 前缀形）。
 *
 * v1.1 增量（git-url 导入流用——docs/43-§一「升级=同一导入流」+ §十-2 升级四点）：
 *   - **upgrade 再导入**：内容更新后重落锚——trust 回 false（新内容=未批准面，fail-closed），
 *     history 追加新的 import 条目（升级也是一次导入；留痕链不断）。
 *   - **upgrade 落锚入口**：reseedTrustAnchorOnUpgrade（v1 无此形态）。
 *
 * v0 边界（诚实标注，沿 docs/44）：
 *   - 锚文件本体无签名无加密——防「公司包内容漂移」不防「制作人物理改锚文件」（威胁模型外）。
 *   - history 无上限增长——截断策略归后续单。
 *
 * v2 安全面（MIG-05 / IMPL-05-07；docs/v2/15 §一 SEC-FC-03；v2/17 NEG-SEC-04 前腿）：
 *   **坏锚≠无锚**。旧实现把「坏 JSON / 形状不符」折成 `null`（=无锚），而消费侧（如
 *   hot-reload）把 `null` 当 `if (anchor !== null)` 的跳过闸——坏锚因此等价于「闸关」，
 *   叠加热重载自动应用即「被约束者可单方改约束」路径。本版改为 fail-closed：
 *     - 无锚（文件不存在）＝`null`（init 通道「无锚=受信」语义不变；无锚与坏锚分开）；
 *     - 坏锚（不可读/坏 JSON/形状不符）＝抛 `TrustAnchorError`（不返回 null、不回落无锚）；
 *     - `inspectTrustAnchor` 提供**不抛**的判别式三态（absent/valid/invalid），供热重载
 *       应用门做「锚在场且校验过」前置与 ESCALATE（SEC-FC-03 后半归 IMPL-07-07）。
 *   外部 API 兼容：`readTrustAnchor`/`trustStateOf` 签名与返回类型不变（坏锚时抛错而非
 *   返回 null，属错误面收紧）；写入/批准/撤销通道因同读锚也一并 fail-closed。旧测试只登记
 *   不修改（触及面登记见本单 REPORT）。
 *
 *   形状闸（`parseTrustAnchor`，纯函数）：schema/slug/trust/fingerprint/history 逐项验型，
 *   history 条目 action/by/at 必填且 action 封闭四值——「像锚」不再算锚。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 锚目录/文件（相对公司目录根；daemon 自管——分发仓封闭内容集不含它，自带即拒收 docs/43-§十-3） */
export const TRUST_DIR = '.studio-next'
export const TRUST_FILE = '.studio-next/trust.json'

/** 信任锚 schema 版本 */
const TRUST_SCHEMA = 'studio-next/trust@1'

/** 留痕条目（谁/何时/干了什么——「升级受信=显式动作留痕」的落字） */
export interface TrustHistoryEntry {
  action: 'import' | 'approve' | 're-approve' | 'revoke'
  /** 动作人（制作人标识；CLI 传入） */
  by: string
  /** ISO 8601 时刻 */
  at: string
  /** 本条目落锚时的内容指纹（import/approve/re-approve 时有；revoke 沿用旧值） */
  fingerprint?: string
  note?: string
}

/** 信任锚（<公司目录>/.studio-next/trust.json 的形状） */
export interface TrustAnchor {
  schema: 'studio-next/trust@1'
  /** org-config company.slug（错家锚文件不认——docs/43-§十-2「slug 同家」判据） */
  slug: string
  /** 受信位：false=导入未批准（untrusted 渲染）；true=制作人已批准 */
  trust: boolean
  /** 批准时的内容指纹（sha256: 前缀形；null=从未批准） */
  fingerprint: string | null
  history: TrustHistoryEntry[]
}

/** 排除锚目录后的文件映射（指纹与漂移比对只看公司内容——锚文件自指隔离） */
export function excludeAnchorFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) {
    if (rel === TRUST_FILE || rel.startsWith(`${TRUST_DIR}/`)) continue
    out[rel] = text
  }
  return out
}

/**
 * 内容指纹：per-file sha256(hex) → sorted `path:hash` 行串 → sha256（`sha256:` 前缀形）。
 * 与 daemon hot-reload fingerprintDirectory 同规则、独立实现（规则一致由测试互证——docs/44 §二）。
 */
export function contentFingerprint(files: Record<string, string>): string {
  const lines: string[] = []
  for (const rel of Object.keys(files).sort()) {
    lines.push(`${rel}:${createHash('sha256').update(files[rel] ?? '', 'utf8').digest('hex')}`)
  }
  return `sha256:${createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')}`
}

function anchorPath(companyDir: string): string {
  return path.join(companyDir, TRUST_FILE)
}

/** 坏锚原因（与「无锚」分开：无锚=文件不存在；坏锚=文件在场但不可用）。 */
export type TrustAnchorErrorReason = 'unreadable' | 'json' | 'shape'

const TRUST_HISTORY_ACTIONS: readonly TrustHistoryEntry['action'][] = ['import', 'approve', 're-approve', 'revoke']

/**
 * 坏锚错误（fail-closed；docs/v2/15 §一 SEC-FC-03）。
 * 消费方不得 catch 后继续按「无锚」处理——无锚与坏锚是两类事实：
 *   - 无锚：`readTrustAnchor` 返回 null（仅 init 通道受信，装配层显式声明）；
 *   - 坏锚：本错误上抛（热重载应用门须拒自动应用＋ESCALATE，重复出现拒启——IMPL-07-07）。
 */
export class TrustAnchorError extends Error {
  readonly reason: TrustAnchorErrorReason
  readonly file: string | null

  constructor(reason: TrustAnchorErrorReason, detail: string, options?: { file?: string; cause?: unknown }) {
    const suffix = options?.file !== undefined ? `（${options.file}）` : ''
    super(
      `信任锚不可用（${reason}）：${detail}${suffix}——坏锚≠无锚，不得当作「无锚」放行（docs/v2/15 §一 SEC-FC-03）`,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    )
    this.name = 'TrustAnchorError'
    this.reason = reason
    this.file = options?.file ?? null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 锚形状闸（纯函数，零 IO）：形状不符 → 抛 `TrustAnchorError('shape')`；合法 → TrustAnchor。
 * 这是「像锚」与「是锚」的分界：逐项验型，不做默许补位。
 */
export function parseTrustAnchor(raw: unknown, file?: string): TrustAnchor {
  const fail = (detail: string): never => {
    throw new TrustAnchorError('shape', detail, file !== undefined ? { file } : {})
  }
  if (!isRecord(raw)) fail('锚内容须为 JSON 对象（当前非对象/数组/null）')
  const record = raw as Record<string, unknown>
  if (record.schema !== TRUST_SCHEMA) fail(`schema 须为 ${TRUST_SCHEMA}（当前 ${JSON.stringify(record.schema)}）`)
  if (typeof record.slug !== 'string') fail(`slug 须为字符串（当前 ${typeof record.slug}）`)
  if (typeof record.trust !== 'boolean') fail(`trust 须为布尔（当前 ${typeof record.trust}）`)
  if (!('fingerprint' in record) || (record.fingerprint !== null && typeof record.fingerprint !== 'string')) {
    fail('fingerprint 须在场且为字符串或 null')
  }
  if (!Array.isArray(record.history)) fail('history 须为数组')
  const history: TrustHistoryEntry[] = []
  const rawHistory = record.history as unknown[]
  for (let index = 0; index < rawHistory.length; index++) {
    const item = rawHistory[index]
    if (!isRecord(item)) fail(`history[${index}] 须为对象`)
    const entry = item as Record<string, unknown>
    if (typeof entry.action !== 'string' || !TRUST_HISTORY_ACTIONS.includes(entry.action as TrustHistoryEntry['action'])) {
      fail(`history[${index}].action 须为 ${TRUST_HISTORY_ACTIONS.join('|')} 之一（当前 ${JSON.stringify(entry.action)}）`)
    }
    if (typeof entry.by !== 'string') fail(`history[${index}].by 须为字符串`)
    if (typeof entry.at !== 'string') fail(`history[${index}].at 须为字符串`)
    if ('fingerprint' in entry && entry.fingerprint !== undefined && typeof entry.fingerprint !== 'string') {
      fail(`history[${index}].fingerprint 须为字符串（在场时）`)
    }
    if ('note' in entry && entry.note !== undefined && typeof entry.note !== 'string') {
      fail(`history[${index}].note 须为字符串（在场时）`)
    }
    history.push({
      action: entry.action as TrustHistoryEntry['action'],
      by: entry.by as string,
      at: entry.at as string,
      ...(entry.fingerprint !== undefined ? { fingerprint: entry.fingerprint as string } : {}),
      ...(entry.note !== undefined ? { note: entry.note as string } : {}),
    })
  }
  return {
    schema: TRUST_SCHEMA,
    slug: record.slug as string,
    trust: record.trust as boolean,
    fingerprint: (record.fingerprint ?? null) as string | null,
    history,
  }
}

/**
 * 读锚（fail-closed）：**文件不存在＝null（无锚）**；文件在场但不可读/坏 JSON/形状不符＝
 * 抛 `TrustAnchorError`（坏锚），绝不折回 null。调用方若需三态判别用 `inspectTrustAnchor`。
 */
export function readTrustAnchor(companyDir: string): TrustAnchor | null {
  const target = anchorPath(companyDir)
  let text: string
  try {
    text = readFileSync(target, 'utf8')
  } catch (error) {
    // ENOENT＝无锚（合法装配态）；权限/目录等其它读错误＝坏锚（fail-closed，不得折算成无锚）
    if (isErrno(error, 'ENOENT')) return null
    throw new TrustAnchorError('unreadable', '锚文件存在但读取失败', { file: target, cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new TrustAnchorError('json', '锚文件不是合法 JSON', { file: target, cause: error })
  }
  return parseTrustAnchor(parsed, target)
}

/** errno 判别（不依赖 NodeJS 命名空间类型；错误面形状取 code 字段）。 */
function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

/** 锚三态判别（不抛的读面：absent/valid/invalid 分开——供热重载应用门与审计面判读）。 */
export type TrustAnchorInspection =
  | { kind: 'absent' }
  | { kind: 'valid'; anchor: TrustAnchor }
  | { kind: 'invalid'; error: TrustAnchorError }

/**
 * 三态读锚：无锚（absent）与坏锚（invalid）**分开**且不互相冒充；坏锚不抛给调用方，
 * 但错误对象原样携带（reason/file），应用门可据此拒自动应用＋ESCALATE。
 * 注：非 TrustAnchorError 的意外错误仍上抛（不掩盖程序缺陷）。
 */
export function inspectTrustAnchor(companyDir: string): TrustAnchorInspection {
  try {
    const anchor = readTrustAnchor(companyDir)
    return anchor === null ? { kind: 'absent' } : { kind: 'valid', anchor }
  } catch (error) {
    if (error instanceof TrustAnchorError) return { kind: 'invalid', error }
    throw error
  }
}

/** 写锚（原子写 tmp+rename；目录递归建，0700——锚是制作人侧私产） */
export function writeTrustAnchor(companyDir: string, anchor: TrustAnchor): void {
  mkdirSync(path.join(companyDir, TRUST_DIR), { recursive: true, mode: 0o700 })
  const target = anchorPath(companyDir)
  const tmp = `${target}.tmp-${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(anchor, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/**
 * import 落锚：trust=false + 导入内容指纹 + 留痕（导入管线调用——docs/43-§一）。
 * files=排除锚目录后的公司内容文件映射（导入管线内部处理）。
 */
export function seedTrustAnchor(
  companyDir: string,
  slug: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug,
    trust: false,
    fingerprint,
    history: [{ action: 'import', by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) }],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * upgrade 再导入落锚（v1.1 增量；docs/43-§十-2）：内容已更新 → trust 回 false
 * （新内容=未批准面，fail-closed——同 docs/44 §四-5 的漂移语义）+ 新指纹 + history
 * 追加 import 条目。无前锚（不应是 upgrade 通道，防御）→ 等价 seed。
 */
export function reseedTrustAnchorOnUpgrade(
  companyDir: string,
  slug: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const prev = readTrustAnchor(companyDir)
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug,
    trust: false,
    fingerprint,
    history: [
      ...(prev?.history ?? []),
      { action: 'import', by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * approve / re-approve（制作人显式动作）：重算内容指纹 → trust=true → 留痕。
 *   - 已批准且指纹相同 → 幂等返回（不追加重复 history）
 *   - 历史上批准过（含 revoke 后再批准、批准面指纹已变）→ action='re-approve'
 */
export function approveCompanyDirectory(
  companyDir: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const prev = readTrustAnchor(companyDir)
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  if (prev !== null && prev.trust && prev.fingerprint === fingerprint) return prev
  const everApproved =
    prev !== null && prev.history.some((h) => h.action === 'approve' || h.action === 're-approve')
  const action: TrustHistoryEntry['action'] = everApproved ? 're-approve' : 'approve'
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug: prev?.slug ?? '',
    trust: true,
    fingerprint,
    history: [
      ...(prev?.history ?? []),
      { action, by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * revoke（漂移降级）：trust→false + 留痕（指纹沿旧值——revoke 记录的是「从哪个批准面跌落」）。
 */
export function revokeTrust(companyDir: string, entry: { by: string; at: string; note?: string }): TrustAnchor | null {
  const prev = readTrustAnchor(companyDir)
  if (prev === null || !prev.trust) return prev
  const anchor: TrustAnchor = {
    ...prev,
    trust: false,
    history: [
      ...prev.history,
      { action: 'revoke', by: entry.by, at: entry.at, ...(prev.fingerprint !== null ? { fingerprint: prev.fingerprint } : {}), ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * 装配层消费位：公司目录信任态（无锚=init 通道受信；有锚看 trust 位）。
 * **坏锚 fail-closed**：读锚抛 `TrustAnchorError` 时不在此吞掉——否则坏锚会经本函数被折算成
 * 「无锚→trusted=true」，正是 SEC-FC-03 禁止的放宽路径（见头注）。
 */
export function trustStateOf(companyDir: string): { trusted: boolean; anchor: TrustAnchor | null } {
  const anchor = readTrustAnchor(companyDir)
  return { trusted: anchor === null ? true : anchor.trust, anchor }
}
