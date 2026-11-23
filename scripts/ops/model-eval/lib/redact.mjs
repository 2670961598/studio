/**
 * redact.mjs —— 文本脱敏（纯函数）：报告/日志里绝不出现凭据值。
 *
 * 两条线：① 调用方显式给出的秘密值（如 kimi token）整段替换为 <redacted>；
 *        ② 形态兜底——JWT、sk-/gh*_ 前缀 token、Bearer 头、「id.secret」型 key、
 *           高熵长串（大小写+数字混合、无路径分隔符）一律打码
 *           （provider 错误消息偶尔回显请求头，宁可多打不可漏打；路径不受影响）。
 */

const SHAPE_RULES = [
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, tag: '<redacted:jwt>' },
  { re: /\b(?:sk|ghp|gho|ghu|ghs|ghr|ghv|xox[baprs])[-_][A-Za-z0-9]{16,}\b/g, tag: '<redacted:token>' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, tag: 'Bearer <redacted>' },
  { re: /\b[0-9a-f]{32}\.[A-Za-z0-9]{8,}\b/g, tag: '<redacted:key>' },
  {
    re: /\b(?=[A-Za-z0-9+=._-]{48,}\b)(?=[A-Za-z0-9+=._-]*[a-z])(?=[A-Za-z0-9+=._-]*[A-Z])(?=[A-Za-z0-9+=._-]*\d)[A-Za-z0-9+=._-]{48,}\b/g,
    tag: '<redacted:blob>',
  },
]

/** 单行化 + 截断（错误消息进报告前先过这一道）。 */
export function squash(text, max = 240) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 脱敏：先替换显式秘密值（长度 ≥4 才处理，避免空串/短串误伤），再过形态规则。
 * 返回新字符串；不改入参。
 */
export function redact(text, secrets = []) {
  let s = String(text ?? '')
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue
    s = s.split(secret).join('<redacted>')
  }
  for (const rule of SHAPE_RULES) s = s.replace(rule.re, rule.tag)
  return s
}

/** 取文本尾部若干字符（stderr 尾巴进报告用）。 */
export function tail(text, max = 2_000) {
  const s = String(text ?? '')
  return s.length > max ? `…${s.slice(-max)}` : s
}
