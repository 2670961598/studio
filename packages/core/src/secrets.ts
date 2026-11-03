/**
 * secrets —— 出站内容密钥扫描/脱敏纯函数（DEV-48；docs/52-§十二 + AGENTS 纪律 6
 * 「密钥永不入库；出站内容过密钥扫描」）
 *
 * 出站点（接线在 daemon：hr-sync 执行体 last_error/note、RELOAD note 扩段、serve 日志）：
 *   - 已知秘密值替换：装配期收集的运行时凭据（taigaAuth 密码/token、Matrix
 *     registration_shared_secret 等）→ `<redacted:N>`（N=原长，长度提示不回内容）；
 *   - 形状兜底：结构化凭据模式（Bearer 头、password/secret/token/mac 赋值对、
 *     独立长随机串）——捕获未知来源的泄漏（错误消息回显平台响应体是真实风险面）。
 *
 * 明确不扫的面：API 请求体（合法携带凭据——认证头/注册表单）；这里只管**出站文本**
 * （台账 note、last_error、日志行、REPORT）。
 *
 * 纯函数纪律：零 IO；knowns 只做值比对，不落任何持久层。
 */

/** 替换标记形（长度提示便于排查「多长的东西被拦」，不回内容） */
const REDACT_MARK = (len: number): string => `<redacted:${String(len)}>`

/** 已知秘密值集合中长度达标的值（短值不替换——误伤面大于收益） */
const MIN_KNOWN_LENGTH = 6

/**
 * 已知秘密值脱敏：text 中出现的每个已知值 → <redacted:N>。
 * 长度降序替换（长值先行——防短前缀截断长值后残留尾巴）。
 */
export function redactKnownSecrets(text: string, knowns: readonly string[]): string {
  const sorted = [...new Set(knowns.filter((s) => s.length >= MIN_KNOWN_LENGTH))].sort((a, b) => b.length - a.length)
  let out = text
  for (const s of sorted) {
    if (!out.includes(s)) continue
    out = out.split(s).join(REDACT_MARK(s.length))
  }
  return out
}

/** 形状检测命中（观测面：测试/报告用；替换形不回内容） */
export interface SecretShapeFinding {
  /** 命中模式名 */
  kind: 'bearer' | 'assignment' | 'long-token'
  /** 命中文本在原文中的起始偏移（替换后失效——只对原文有意义） */
  at: number
}

/** Bearer 头：Authorization: Bearer <token> */
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g
/** 赋值对：password/secret/token/mac/api_key[:=] 值（JSON/YAML/URL query/CLI 形）。
 *  值段负前瞻排除本模块替换标记 <redacted:N>——已知值先换后，形状兜底不得二次改写
 * （否则长度提示被覆盖：`<redacted:30>`→`<redacted:14>`，观测面失真）。 */
const ASSIGNMENT_RE = /\b(?:password|passwd|secret|shared_secret|token|mac|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["']?(?!<redacted:)[^\s"'&,;}]{8,}/gi
/** 独立长随机串：≥32 位 base62/-/_ 连续段（JWT/密钥/hex64 常见形；ULID 26 位不触发） */
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g

/**
 * 完整性引用（integrity digest）：40/64 位纯 hex 摘要（git sha / sha256 证据哈希）。
 * 它不是自由文本承载位，而是证据链的完整性引用（与台账 `payload_hash` 同性质）；
 * 缺省仍落 long-token 形态兜底（保守），**仅证据导出面**可显式排除——否则归档时
 * 证据哈希会被抹成 `<redacted:N>`，毁掉证据链（docs/v2/15 §4.4 出站闸 × v2/08 证据对象）。
 */
const INTEGRITY_DIGEST_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

/** 是否完整性引用形（纯 40/64 位 hex，大小写不敏感） */
export function isIntegrityDigest(value: string): boolean {
  return INTEGRITY_DIGEST_RE.test(value)
}

/** 形状检测选项（增量开关；缺省行为与原调用逐字一致） */
export interface SecretShapeOptions {
  /**
   * 排除完整性引用（40/64 hex）的 long-token 命中——只有明确知道该面携带证据哈希的
   * 装配点（证据导出）才可开；普通出站面保持保守兜底（收口面不放宽）。
   */
  readonly excludeIntegrityDigests?: boolean
}

/** 形状检测（不修改；诊断/测试断言用） */
export function findSecretShaped(text: string, options: SecretShapeOptions = {}): SecretShapeFinding[] {
  const out: SecretShapeFinding[] = []
  for (const m of text.matchAll(BEARER_RE)) out.push({ kind: 'bearer', at: m.index ?? 0 })
  for (const m of text.matchAll(ASSIGNMENT_RE)) out.push({ kind: 'assignment', at: m.index ?? 0 })
  for (const m of text.matchAll(LONG_TOKEN_RE)) {
    if (options.excludeIntegrityDigests === true && isIntegrityDigest(m[0])) continue
    out.push({ kind: 'long-token', at: m.index ?? 0 })
  }
  return out
}

/**
 * 出站脱敏总闸（任务书「出站内容过密钥扫描」的机械面）：
 * 先已知值替换、后形状兜底（赋值对值段、Bearer 尾、独立长串 → <redacted:N>）。
 * 使用方：daemon hr-sync 执行体（last_error/note）、serve 装配（日志行）。
 */
export function redactOutbound(
  text: string,
  knowns: readonly string[] = [],
  options: SecretShapeOptions = {},
): string {
  let out = redactKnownSecrets(text, knowns)
  out = out.replace(BEARER_RE, (m) => m.replace(/[A-Za-z0-9._~+/=-]{12,}$/, (tok) => REDACT_MARK(tok.length)))
  out = out.replace(ASSIGNMENT_RE, (m) => {
    // 保留键名与分隔符，只换值段（诊断价值：知道是什么类型的键泄漏）
    const lead = m.match(/^[^:=]*[:=]\s*["']?/)
    const head = lead !== null ? lead[0] : ''
    const tail = m.slice(head.length)
    return head + REDACT_MARK(tail.length)
  })
  out = out.replace(LONG_TOKEN_RE, (tok) =>
    options.excludeIntegrityDigests === true && isIntegrityDigest(tok) ? tok : REDACT_MARK(tok.length),
  )
  return out
}
