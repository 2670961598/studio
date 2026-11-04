#!/usr/bin/env node
/**
 * release-lib —— 发布控制面纯逻辑（studio-dev-719：校验/绑定/摘要/记录渲染；零 IO、零 spawn）
 *
 * 依据：/tmp/719-construction-brief.md §2（CLI 契约冻结面/exit codes/三形状/绑定规则/gatesDigest 口径）、
 * /tmp/autonomy-impl-plan-2026-11-04.md §二-719；docs/90-§七（发布控制面）。
 *
 * 边界：本件不 spawn、不读写文件、不碰 deploy.mjs/daemon/契约；只做形状校验+绑定判定+文本渲染。
 * CLI 入口=`release.mjs`（spawn deploy.mjs CLI；不 import deploy）。
 */
import { createHash } from 'node:crypto'

/** exit codes（与 deploy.mjs 0/1/2/3/4 衔接；5=记录/tag 面失败） */
export const EXIT = Object.freeze({ ok: 0, usage: 1, approval: 2, deploy: 3, health: 4, record: 5 })

/** 三形状 schema 标识（写进 JSON；schema 文件同目录） */
export const SCHEMA = Object.freeze({
  request: 'studio-next/release-request/v1',
  approval: 'studio-next/release-approval/v1',
  record: 'studio-next/release-record/v1',
})

/** 版本号形状（宽松但确定：字母数字 . _ -，≤120；不强制 semver 以满足 v-test 演练） */
export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

/** 解析 argv（`--flag value` 与 `--flag=value`；已知布尔旗标=--json/--dry-run/--push/--help） */
export function parseFlags(argv) {
  const args = argv.slice(2)
  const flags = {}
  const positionals = []
  const booleans = new Set(['json', 'dry-run', 'push', 'help', 'no-record', 'no-tag'])
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 2) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
        continue
      }
      const name = arg.slice(2)
      if (booleans.has(name)) {
        flags[name] = true
        continue
      }
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${name} 缺值`)
      flags[name] = value
      i += 1
    } else {
      positionals.push(arg)
    }
  }
  return { flags, positionals }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** 十六进制/任何非空摘要串（gatesDigest 由执行者按口径采集；不在此重算） */
function isDigestLike(value) {
  return nonEmpty(value) && /^[A-Za-z0-9._:+/=-]{8,512}$/.test(value)
}

/** ISO 时间可解析 */
function isIsoTime(value) {
  if (!nonEmpty(value)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

/** schema 登记键集（additionalProperties=false；手写校验与 schema 同宽，775/C3-4） */
const REQUEST_KEYS = new Set(['schema', 'version', 'targetCommit', 'tree', 'previousCommit', 'gatesDigest', 'createdAt', 'requestedBy', 'notes'])
const APPROVAL_KEYS = new Set(['schema', 'version', 'targetCommit', 'tree', 'gatesDigest', 'approver', 'approvedAt', 'expiresAt', 'commentRef'])

/** 多余字段（schema 与手写校验同宽：未登记键即拒） */
function extraKeys(raw, allowed) {
  return Object.keys(raw).filter((key) => !allowed.has(key))
}

/** 校验 request 形状（返回错误数组；[]=通过） */
export function validateRequest(raw) {
  const errors = []
  if (typeof raw !== 'object' || raw === null) return ['request 不是对象']
  const r = raw
  const extras = extraKeys(r, REQUEST_KEYS)
  if (extras.length > 0) errors.push(`request 含未登记字段（schema additionalProperties=false）：${extras.join('/')}`)
  if (r.schema !== SCHEMA.request) errors.push(`schema 须为 ${SCHEMA.request}`)
  if (!nonEmpty(r.version) || !VERSION_RE.test(r.version)) errors.push('version 形状非法')
  if (!nonEmpty(r.targetCommit)) errors.push('targetCommit 缺失')
  if (!nonEmpty(r.tree)) errors.push('tree 缺失')
  if (r.previousCommit !== null && !nonEmpty(r.previousCommit)) errors.push('previousCommit 须为字符串或 null')
  if (!isDigestLike(r.gatesDigest)) errors.push('gatesDigest 缺失/形状非法')
  if (!isIsoTime(r.createdAt)) errors.push('createdAt 非 ISO 时间')
  if (!nonEmpty(r.requestedBy)) errors.push('requestedBy 缺失')
  return errors
}

/** 校验 approval 形状 */
export function validateApproval(raw) {
  const errors = []
  if (typeof raw !== 'object' || raw === null) return ['approval 不是对象']
  const a = raw
  const extras = extraKeys(a, APPROVAL_KEYS)
  if (extras.length > 0) errors.push(`approval 含未登记字段（schema additionalProperties=false）：${extras.join('/')}`)
  if (a.schema !== SCHEMA.approval) errors.push(`schema 须为 ${SCHEMA.approval}`)
  if (!nonEmpty(a.version) || !VERSION_RE.test(a.version)) errors.push('version 形状非法')
  if (!nonEmpty(a.targetCommit)) errors.push('targetCommit 缺失')
  if (!nonEmpty(a.tree)) errors.push('tree 缺失')
  if (!isDigestLike(a.gatesDigest)) errors.push('gatesDigest 缺失/形状非法')
  if (!nonEmpty(a.approver)) errors.push('approver 缺失')
  if (!isIsoTime(a.approvedAt)) errors.push('approvedAt 非 ISO 时间')
  if (!isIsoTime(a.expiresAt)) errors.push('expiresAt 非 ISO 时间')
  if (!nonEmpty(a.commentRef)) errors.push('commentRef 缺失（审批出处引用）')
  return errors
}

/**
 * 绑定校验（request↔approval 全等 version/targetCommit/tree/gatesDigest；批准未过期；
 * 775/C3：approvedAt 时间纪律纳入工具——不得早于 request.createdAt、不得晚于当前时间
 * 超过 5min 时钟偏差；多余字段按 schema additionalProperties=false 拒）。
 * 返回 {ok:true} 或 {ok:false,status:2,reason:'approval-missing'|'binding-mismatch'|
 * 'approval-expired'|'approval-time-invalid',detail}
 */
export function checkBinding(request, approval, now) {
  const requestErrors = validateRequest(request)
  if (requestErrors.length > 0) return { ok: false, status: EXIT.approval, reason: 'approval-missing', detail: `request 非法：${requestErrors.join('；')}` }
  const approvalErrors = validateApproval(approval)
  if (approvalErrors.length > 0) return { ok: false, status: EXIT.approval, reason: 'approval-missing', detail: `approval 非法：${approvalErrors.join('；')}` }
  const r = request
  const a = approval
  const mismatches = []
  if (a.version !== r.version) mismatches.push('version')
  if (a.targetCommit !== r.targetCommit) mismatches.push('targetCommit')
  if (a.tree !== r.tree) mismatches.push('tree')
  if (a.gatesDigest !== r.gatesDigest) mismatches.push('gatesDigest')
  if (mismatches.length > 0) {
    return { ok: false, status: EXIT.approval, reason: 'binding-mismatch', detail: `approval 绑定不符：${mismatches.join('/')}` }
  }
  if (Date.parse(a.expiresAt) <= now) {
    return { ok: false, status: EXIT.approval, reason: 'approval-expired', detail: `approval 已过期（expiresAt=${a.expiresAt}）` }
  }
  // 775/C3：时间纪律由工具执行（模板原为「人工纪律」缺口）
  const approvedAt = Date.parse(a.approvedAt)
  const createdAt = Date.parse(r.createdAt)
  const nowMs = Number.isFinite(now) ? now : Date.now()
  const skewMs = 5 * 60_000
  if (approvedAt < createdAt) {
    return { ok: false, status: EXIT.approval, reason: 'approval-time-invalid', detail: `approvedAt（${a.approvedAt}）早于 request.createdAt（${r.createdAt}）` }
  }
  if (approvedAt > nowMs + skewMs) {
    return { ok: false, status: EXIT.approval, reason: 'approval-time-invalid', detail: `approvedAt（${a.approvedAt}）晚于当前时间超过 5min 时钟偏差` }
  }
  return { ok: true }
}

/**
 * gatesDigest 口径（施工书 §2）：sha256(`verify:v2@<commit>:` + verify 输出最后一条 PASS 行)。
 * 只接收执行者采集的真实输出文本；不伪造（空/无 PASS 行→抛）。
 */
export function computeGatesDigest(commit, verifyOutput) {
  if (!nonEmpty(commit)) throw new Error('computeGatesDigest：commit 缺失')
  const lines = String(verifyOutput ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const passLines = lines.filter((line) => line.includes('PASS'))
  const last = passLines.length > 0 ? passLines[passLines.length - 1] : lines[lines.length - 1]
  if (!nonEmpty(last)) throw new Error('computeGatesDigest：verify 输出为空（gatesDigest 必须来自真实命令输出）')
  return createHash('sha256').update(`verify:v2@${commit}:${last}`, 'utf8').digest('hex')
}

/** 构造 request 对象（plan/request 共用） */
export function buildRequest(input) {
  return {
    schema: SCHEMA.request,
    version: input.version,
    targetCommit: input.targetCommit,
    tree: input.tree,
    previousCommit: input.previousCommit ?? null,
    gatesDigest: input.gatesDigest,
    createdAt: input.createdAt,
    requestedBy: input.requestedBy,
    ...(input.notes !== undefined && input.notes !== '' ? { notes: input.notes } : {}),
  }
}

/** release 记录 Markdown（docs/releases/<version>.md；JSON 置入代码块便于机器读） */
export function renderReleaseRecord(input) {
  const record = {
    schema: SCHEMA.record,
    version: input.version,
    commit: input.commit,
    tree: input.tree,
    previousCommit: input.previousCommit ?? null,
    gatesDigest: input.gatesDigest,
    requestRef: input.requestRef ?? null,
    approvalRef: input.approvalRef ?? null,
    approver: input.approver,
    releasedAt: input.releasedAt,
    deploy: input.deploy ?? null,
    pushed: false,
    ...(input.rollback === true ? { type: 'rollback', rolledBackTo: input.rolledBackTo } : {}),
  }
  return [
    `# release ${input.version}`,
    '',
    `- commit: \`${input.commit}\``,
    `- tree: \`${input.tree}\``,
    `- previous: ${input.previousCommit === null ? '（无）' : `\`${input.previousCommit}\``}`,
    `- gatesDigest: \`${input.gatesDigest}\``,
    `- approver: ${input.approver}`,
    `- releasedAt: ${input.releasedAt}`,
    `- request/approval: ${input.requestRef ?? '-'} / ${input.approvalRef ?? '-'}`,
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
    '',
  ].join('\n')
}

/** 回滚记录 Markdown（docs/releases/rollback-<to>.md） */
export function renderRollbackRecord(input) {
  const record = {
    schema: SCHEMA.record,
    type: 'rollback',
    version: input.version ?? null,
    fromCommit: input.fromCommit ?? null,
    rolledBackTo: input.rolledBackTo,
    tree: input.tree,
    rolledBackAt: input.rolledBackAt,
    deploy: input.deploy ?? null,
  }
  return [
    `# rollback → ${input.rolledBackTo}`,
    '',
    `- from: ${input.fromCommit === null ? '（未知）' : `\`${input.fromCommit}\``}`,
    `- rolledBackTo: \`${input.rolledBackTo}\``,
    `- tree: \`${input.tree}\``,
    `- rolledBackAt: ${input.rolledBackAt}`,
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
    '',
  ].join('\n')
}

/** version 是否合法（CLI 面统一） */
export function isValidVersion(version) {
  return nonEmpty(version) && VERSION_RE.test(version)
}

/** tag 名（annotated tag；前缀 v 由 version 自带；不额外拼接） */
export function tagNameOf(version) {
  return version
}
