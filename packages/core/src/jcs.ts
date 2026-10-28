/**
 * jcs —— RFC 8785（JCS）范围内的 canonical 序列化 ＋ SHA-256 摘要（VEC-01..08 可复算）
 *
 * 依据（MIG-03 / IMPL-03-07）：
 *   - v2/10 §二（ENC-01..08）：规范化身份 `canonicalizationId=studio-next.jcs` ＋
 *     `canonicalizationVersion=1`（两字段线上形态）；输入前置（ENC-02）；序列化规则
 *     （ENC-03：键按**未转义字符串的 UTF-16 code units** 字典序递归排序、数组保序、
 *     无空白、逐码点最小转义且仅三种写法）；数值域（ENC-04：只允许安全整数，
 *     decimal/超界整数一律字符串承载）；同一性口径（ENC-05：摘要只证规范字节一致）；
 *     确定性（ENC-06）；验证门（ENC-07）；摘要结构（ENC-08）；
 *   - v2/10 §七 公布向量 VEC-01..08（期望规范文本与 SHA-256 逐条照录；VEC-06 输入与
 *     期望文本取自 RFC 8785 §3.2.3 官方键集，U+FB33 必须是预组合字符）；
 *   - v2/10 §八 诊断码：E-ENC-001（structure）／E-ENC-002（parse）／E-ENC-003
 *     （typecheck）／E-ENC-005（structure）。码集封闭，本件不造码、不跨相位复用
 *     （相位由 spec.ts 的 `DIAGNOSTIC_CODE_PHASES` 单点决定）。
 *
 * 边界与纪律：
 *   - **零 IO**：只有 `node:crypto` 的确定性哈希计算（同 models.ts/judge.ts 先例），
 *     不碰文件/网络/子进程；不注入时间戳、路径、主机名、环境值或采集时刻（ENC-03）。
 *   - **域化**：本实现只接受 §2.4 数值域（安全整数）。含指数记法/小数点/超安全整数
 *     的数值字面量按 §2.7 负向判据拒收（E-ENC-003），**不得**先转双精度再序列化。
 *     附录 B 的 IEEE-754 样例属域外输入，不构成本实现的失败（§2.7-2）。
 *   - **版本状态**：`studio-next.jcs@1` 当前＝`vectors-published`（ENC-06/ENU-92）。
 *     本实现通过 VEC-01..08 只证「实现侧复算一致」，**不得**据此声明 `supported`、
 *     不得声称跨实现可比性已成立（§七三点判读①；声明归 v2/17 验证执行）。
 *   - 输入侧的「无多余空白」按 VEC-10 负向组执行：本实现把**字符串外的空白**一律视为
 *     多余空白拒收（E-ENC-002）。理由是 §2.2 的 I-JSON 前置＋§2.3「不输出任何多余
 *     空白」；规范形态本身不含空白，摘要输入的交换形态应与规范形态同构。拒绝而非
 *     静默删除，避免「输入不同、摘要相同」掩盖词法差异（ENC-05）。
 */
import { createHash } from 'node:crypto'
import type { Diagnostic, DigestFace, EncDiagnosticCode } from './spec.ts'
import { makeDiagnostic } from './spec.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、规范化身份与版本状态（ENC-01/ENC-06；ENU-92）
// ─────────────────────────────────────────────────────────────────────────────

/** 规范化规则身份（§2.1：线上恒为两字段，单字段斜杠形态按未知身份拒收） */
export const CANONICALIZATION_ID = 'studio-next.jcs' as const

/** 规范化规则版本（§2.1：实质变动必须发新版本，不得原地改版） */
export const CANONICALIZATION_VERSION = 1 as const

/** 版本轴（§5.1：canonical 规则挂 `record-format` 轴，是轴下子版本，不新增轴） */
export const CANONICALIZATION_AXIS = 'record-format' as const

/**
 * 版本状态（ENU-92）：`vectors-published`＝期望值已公布、实现未运行。
 * 本实现运行后状态**不自动升格**；`supported` 判定归 v2/17 §二.6 的验证执行。
 */
export const CANONICALIZATION_STATUS = 'vectors-published' as const

// ─────────────────────────────────────────────────────────────────────────────
// 二、JSON 值域与结果面
// ─────────────────────────────────────────────────────────────────────────────

/** 可规范化的 JSON 值（对象/数组递归；数值只承载安全整数——decimal 用字符串，ENC-04） */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue }

/** 结果面：成功携值/文本，失败携封闭码诊断（不抛异常，调用方按结果分支） */
export type JcsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

const MAX_DEPTH = 512

function encDiagnostic(
  code: EncDiagnosticCode,
  location: string,
  messageKey: string,
  messageArgs: readonly (string | number | boolean)[] = [],
): Diagnostic {
  return makeDiagnostic(code, location, messageKey, messageArgs)
}

function failure(code: EncDiagnosticCode, location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): JcsResult<never> {
  return { ok: false, diagnostics: [encDiagnostic(code, location, messageKey, args)] }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、严格 I-JSON 解析（ENC-02；VEC-09/10 负向组的输入侧）
// ─────────────────────────────────────────────────────────────────────────────

/** 内部解析中止（携带单条封闭码诊断；不跨模块暴露） */
class ParseHalt extends Error {
  readonly diagnostic: Diagnostic

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.messageKey)
    this.diagnostic = diagnostic
  }
}

interface ParseState {
  readonly text: string
  readonly diagnostics: Diagnostic[]
  pos: number
}

const HEX4 = /^[0-9A-Fa-f]{4}$/

function halt(code: EncDiagnosticCode, location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): never {
  throw new ParseHalt(encDiagnostic(code, location, messageKey, args))
}

function rejectWhitespace(state: ParseState, location: string): void {
  const ch = state.text[state.pos]
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
    halt('E-ENC-002', location, 'enc/whitespace', [state.pos])
  }
}

function parseString(state: ParseState, location: string): string {
  const text = state.text
  if (text[state.pos] !== '"') halt('E-ENC-002', location, 'enc/string-open')
  state.pos += 1
  let out = ''
  for (;;) {
    const ch = text[state.pos]
    if (ch === undefined) halt('E-ENC-002', location, 'enc/string-unterminated')
    const code = text.charCodeAt(state.pos)
    if (code === 0x22) {
      state.pos += 1
      return out
    }
    if (code === 0x5c) {
      const esc = text[state.pos + 1]
      state.pos += 2
      switch (esc) {
        case '"':
          out += '"'
          break
        case '\\':
          out += '\\'
          break
        case '/':
          out += '/'
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        case 'n':
          out += '\n'
          break
        case 'r':
          out += '\r'
          break
        case 't':
          out += '\t'
          break
        case 'u': {
          const hex = text.slice(state.pos, state.pos + 4)
          if (!HEX4.test(hex)) halt('E-ENC-002', location, 'enc/escape-invalid', ['\\u'])
          out += String.fromCharCode(Number.parseInt(hex, 16))
          state.pos += 4
          break
        }
        default:
          // 非法转义形态（含 \x、\0、大写 U 等）＝输入前置违反（§2.2 → E-ENC-002）
          halt('E-ENC-002', location, 'enc/escape-invalid', [String(esc ?? '')])
      }
      continue
    }
    if (code < 0x20) halt('E-ENC-002', location, 'enc/raw-control')
    out += ch
    state.pos += 1
  }
}

/** lone surrogate（DEC-02：字符串必须是合法 Unicode 标量序列；拒未配对代理码点） */
function assertScalarString(value: string, location: string): void {
  for (const unit of value) {
    const cp = unit.codePointAt(0)
    if (cp !== undefined && cp >= 0xd800 && cp <= 0xdfff) {
      halt('E-ENC-002', location, 'enc/lone-surrogate', [cp])
    }
  }
}

function parseNumber(state: ParseState, location: string): number {
  const text = state.text
  const start = state.pos
  if (text[state.pos] === '-') state.pos += 1
  const first = text[state.pos]
  if (first === undefined) halt('E-ENC-002', location, 'enc/number-truncated')
  if (first === '0') {
    state.pos += 1
    const next = text[state.pos]
    if (next !== undefined && next >= '0' && next <= '9') {
      halt('E-ENC-002', location, 'enc/number-leading-zero')
    }
  } else if (first >= '1' && first <= '9') {
    while (text[state.pos] !== undefined && text[state.pos]! >= '0' && text[state.pos]! <= '9') state.pos += 1
  } else {
    halt('E-ENC-002', location, 'enc/number-invalid')
  }
  const next = text[state.pos]
  if (next === '.' || next === 'e' || next === 'E') {
    // §2.4/§2.7：小数与指数记法属域外数值字面量（decimal 应以字符串承载）
    halt('E-ENC-003', location, 'enc/number-outside-domain', [text.slice(start, state.pos + 1)])
  }
  const literal = text.slice(start, state.pos)
  const value = Number(literal)
  if (!Number.isSafeInteger(value)) {
    halt('E-ENC-003', location, 'enc/integer-unsafe', [literal])
  }
  return value
}

function parseValue(state: ParseState, location: string, depth: number): JsonValue {
  if (depth > MAX_DEPTH) halt('E-ENC-002', location, 'enc/depth-exceeded', [MAX_DEPTH])
  rejectWhitespace(state, location)
  const ch = state.text[state.pos]
  if (ch === undefined) halt('E-ENC-002', location, 'enc/value-missing')
  if (ch === '{') return parseObject(state, location, depth)
  if (ch === '[') return parseArray(state, location, depth)
  if (ch === '"') {
    const value = parseString(state, location)
    assertScalarString(value, location)
    return value
  }
  if (ch === 't') {
    if (state.text.slice(state.pos, state.pos + 4) !== 'true') halt('E-ENC-002', location, 'enc/literal-invalid')
    state.pos += 4
    return true
  }
  if (ch === 'f') {
    if (state.text.slice(state.pos, state.pos + 5) !== 'false') halt('E-ENC-002', location, 'enc/literal-invalid')
    state.pos += 5
    return false
  }
  if (ch === 'n') {
    if (state.text.slice(state.pos, state.pos + 4) !== 'null') halt('E-ENC-002', location, 'enc/literal-invalid')
    state.pos += 4
    return null
  }
  if (ch === 'N' || ch === 'I') {
    // NaN/Infinity 不是 I-JSON（§2.2/E-ENC-002），也不是可字符串化的合法值
    halt('E-ENC-002', location, 'enc/nan-infinity')
  }
  if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber(state, location)
  halt('E-ENC-002', location, 'enc/unexpected-token', [ch])
}

function parseObject(state: ParseState, location: string, depth: number): JsonValue {
  state.pos += 1
  const out: Record<string, JsonValue> = {}
  const seen = new Set<string>()
  rejectWhitespace(state, location)
  if (state.text[state.pos] === '}') {
    state.pos += 1
    return out
  }
  for (;;) {
    rejectWhitespace(state, location)
    if (state.text[state.pos] !== '"') halt('E-ENC-002', location, 'enc/member-name')
    const key = parseString(state, location)
    assertScalarString(key, location)
    const keyLocation = `${location}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
    if (seen.has(key)) {
      // §2.2：同一对象内成员名不得重复——解析阶段即拒，不得「后者覆盖前者」
      halt('E-ENC-002', keyLocation, 'enc/duplicate-member', [key])
    }
    seen.add(key)
    rejectWhitespace(state, keyLocation)
    if (state.text[state.pos] !== ':') halt('E-ENC-002', keyLocation, 'enc/member-colon')
    state.pos += 1
    out[key] = parseValue(state, keyLocation, depth + 1)
    rejectWhitespace(state, location)
    const ch = state.text[state.pos]
    if (ch === ',') {
      state.pos += 1
      rejectWhitespace(state, location)
      if (state.text[state.pos] === '}') halt('E-ENC-002', location, 'enc/trailing-comma')
      continue
    }
    if (ch === '}') {
      state.pos += 1
      return out
    }
    halt('E-ENC-002', location, 'enc/object-close')
  }
}

function parseArray(state: ParseState, location: string, depth: number): JsonValue {
  state.pos += 1
  const out: JsonValue[] = []
  rejectWhitespace(state, location)
  if (state.text[state.pos] === ']') {
    state.pos += 1
    return out
  }
  for (;;) {
    const itemLocation = `${location}/${out.length}`
    out.push(parseValue(state, itemLocation, depth + 1))
    rejectWhitespace(state, location)
    const ch = state.text[state.pos]
    if (ch === ',') {
      state.pos += 1
      rejectWhitespace(state, location)
      if (state.text[state.pos] === ']') halt('E-ENC-002', location, 'enc/trailing-comma')
      continue
    }
    if (ch === ']') {
      state.pos += 1
      return out
    }
    halt('E-ENC-002', location, 'enc/array-close')
  }
}

/**
 * 严格 I-JSON 解析（ENC-02）：BOM、重复成员名、lone surrogate、NaN/Infinity、
 * 字符串外空白、注释与尾随分隔符、域外数值字面量一律拒收。
 */
export function parseIJson(text: string): JcsResult<JsonValue> {
  const state: ParseState = { text, diagnostics: [], pos: 0 }
  if (text.startsWith('\uFEFF')) return failure('E-ENC-002', '', 'enc/bom')
  try {
    if (text.length === 0) halt('E-ENC-002', '', 'enc/value-missing')
    const value = parseValue(state, '', 0)
    if (state.pos !== text.length) {
      rejectWhitespace(state, '')
      halt('E-ENC-002', '', 'enc/trailing-content', [state.text.slice(state.pos, state.pos + 8)])
    }
    return { ok: true, value }
  } catch (error) {
    if (error instanceof ParseHalt) return { ok: false, diagnostics: [error.diagnostic] }
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、canonical 序列化（ENC-03/ENC-04）
// ─────────────────────────────────────────────────────────────────────────────

const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
}

function encodeString(value: string): string {
  let out = '"'
  for (const unit of value) {
    const cp = unit.codePointAt(0)
    if (cp === undefined) continue
    if (cp >= 0xd800 && cp <= 0xdfff) {
      // canonicalizeJson 的输入侧已校验；此处防御未配对代理码点（拒收不是替换）
      throw new ParseHalt(encDiagnostic('E-ENC-002', '', 'enc/lone-surrogate', [cp]))
    }
    if (cp === 0x22) {
      out += '\\"'
    } else if (cp === 0x5c) {
      out += '\\\\'
    } else if (cp <= 0x1f) {
      const short = SHORT_ESCAPES[cp]
      // §2.3：五种必须用两字符短转义；其余 U+0000–001F 用**小写** \u00xx
      out += short ?? `\\u${cp.toString(16).padStart(4, '0')}`
    } else {
      out += unit
    }
  }
  return `${out}"`
}

/** JS 数值 → 规范文本（ENC-04：安全整数最短十进制；-0 归一为 0；域外值拒收） */
function encodeNumber(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new ParseHalt(encDiagnostic('E-ENC-002', '', 'enc/nan-infinity'))
  }
  if (!Number.isSafeInteger(value)) {
    throw new ParseHalt(encDiagnostic('E-ENC-003', '', 'enc/integer-unsafe', [String(value)]))
  }
  if (Object.is(value, -0)) return '0'
  return String(value)
}

function encodeValue(value: unknown, location: string, depth: number, stack: readonly object[]): string {
  if (depth > MAX_DEPTH) throw new ParseHalt(encDiagnostic('E-ENC-002', location, 'enc/depth-exceeded', [MAX_DEPTH]))
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return encodeNumber(value)
  if (typeof value === 'string') return encodeString(value)
  if (Array.isArray(value)) {
    if (stack.includes(value)) throw new ParseHalt(encDiagnostic('E-ENC-002', location, 'enc/cyclic-value'))
    const items = value.map((item, index) => encodeValue(item, `${location}/${index}`, depth + 1, [...stack, value]))
    return `[${items.join(',')}]`
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new ParseHalt(encDiagnostic('E-ENC-002', location, 'enc/non-json-value', [Object.prototype.toString.call(value)]))
    }
    if (stack.includes(value)) throw new ParseHalt(encDiagnostic('E-ENC-002', location, 'enc/cyclic-value'))
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    // RFC 8785 §3.2.3 / §2.3：按**未转义字符串**的 UTF-16 code units 字典序（JS 默认字符串序）
    keys.sort()
    const members = keys.map((key) => {
      const memberLocation = `${location}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      return `${encodeString(key)}:${encodeValue(record[key], memberLocation, depth + 1, [...stack, value])}`
    })
    return `{${members.join(',')}}`
  }
  // undefined/function/symbol/bigint —— 不是 JSON 值
  throw new ParseHalt(encDiagnostic('E-ENC-002', location, 'enc/non-json-value', [typeof value]))
}

/** 规范化一个已解析的 JSON 值（纯函数；同值必同文本，ENC-06） */
export function canonicalizeJson(value: unknown): JcsResult<string> {
  try {
    return { ok: true, value: encodeValue(value, '', 0, []) }
  } catch (error) {
    if (error instanceof ParseHalt) return { ok: false, diagnostics: [error.diagnostic] }
    throw error
  }
}

/** 严格解析后规范化（VEC 输入文本 → 期望规范文本） */
export function canonicalizeJsonText(text: string): JcsResult<string> {
  const parsed = parseIJson(text)
  if (!parsed.ok) return parsed
  return canonicalizeJson(parsed.value)
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、SHA-256 与摘要结构（ENC-08）
// ─────────────────────────────────────────────────────────────────────────────

/** UTF-8 编码（无 BOM；摘要以字节为准） */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** SHA-256 小写十六进制（纯计算：node:crypto 哈希，非盘 IO） */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 字节摘要（kind=byte：证明两次传输字节一致，不得携带规范化身份） */
export function byteDigestOfBytes(bytes: Uint8Array): DigestFace {
  return { algorithm: 'sha-256', value: sha256Hex(bytes), kind: 'byte' }
}

/** 字节摘要（字符串按 UTF-8 无 BOM 计字节） */
export function byteDigestOfText(text: string): DigestFace {
  return byteDigestOfBytes(utf8Bytes(text))
}

/** 语义摘要（kind=semantic：对规范 UTF-8 字节；携带规范化身份两字段） */
export function semanticDigestOfCanonicalText(canonicalText: string): DigestFace {
  return {
    algorithm: 'sha-256',
    value: sha256Hex(utf8Bytes(canonicalText)),
    kind: 'semantic',
    canonicalizationId: CANONICALIZATION_ID,
    canonicalizationVersion: CANONICALIZATION_VERSION,
  }
}

/** 语义摘要（值 → 规范文本 → 规范字节）；域外值按 E-ENC-002/003 拒收 */
export function semanticDigestOfJson(value: unknown): JcsResult<DigestFace> {
  const canonical = canonicalizeJson(value)
  if (!canonical.ok) return canonical
  return { ok: true, value: semanticDigestOfCanonicalText(canonical.value) }
}

/** 语义摘要（输入文本 → 严格解析 → 规范文本 → 规范字节） */
export function semanticDigestOfText(text: string): JcsResult<DigestFace> {
  const canonical = canonicalizeJsonText(text)
  if (!canonical.ok) return canonical
  return { ok: true, value: semanticDigestOfCanonicalText(canonical.value) }
}

/**
 * 摘要结构校验（ENC-08）：
 *   - `algorithm` 必须是 `sha-256`、`value` 64 位小写十六进制；
 *   - `kind=semantic` 必带规范化身份两字段且必须是当前身份；
 *   - `kind=byte` 出现任一规范化身份字段即拒收（byteDigest 不得冒充 semanticDigest）；
 *   - 未知 canonicalizationId/Version 拒收，不按最近已知版本重算（E-ENC-001）。
 */
export function validateDigestFace(face: unknown): readonly Diagnostic[] {
  if (face === null || typeof face !== 'object') return [encDiagnostic('E-ENC-001', '', 'enc/digest-not-object')]
  const record = face as Record<string, unknown>
  const diagnostics: Diagnostic[] = []
  if (record['algorithm'] !== 'sha-256') {
    diagnostics.push(encDiagnostic('E-ENC-001', '/algorithm', 'enc/digest-algorithm', [String(record['algorithm'])]))
  }
  if (typeof record['value'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['value'])) {
    diagnostics.push(encDiagnostic('E-ENC-001', '/value', 'enc/digest-value'))
  }
  const kind = record['kind']
  const hasIdentity = record['canonicalizationId'] !== undefined || record['canonicalizationVersion'] !== undefined
  if (kind === 'semantic') {
    if (record['canonicalizationId'] !== CANONICALIZATION_ID || record['canonicalizationVersion'] !== CANONICALIZATION_VERSION) {
      diagnostics.push(encDiagnostic('E-ENC-001', '/canonicalizationId', 'enc/unknown-canonicalization', [String(record['canonicalizationId']), String(record['canonicalizationVersion'])]))
    }
  } else if (kind === 'byte') {
    if (hasIdentity) diagnostics.push(encDiagnostic('E-ENC-001', '/kind', 'enc/byte-digest-identity'))
  } else {
    diagnostics.push(encDiagnostic('E-ENC-001', '/kind', 'enc/digest-kind', [String(kind)]))
  }
  return diagnostics
}

/**
 * 规范文本形态校验（§2.3/§2.7）：
 *   ① 严格解析必须通过（E-ENC-002）；② 不得出现大写十六进制 `\u00XX` 等非法转义形态
 *   （E-ENC-005）；③ 文本必须等于其规范形式（排序/空白/数字形态任一偏离即非规范）。
 */
export function validateCanonicalText(text: string): readonly Diagnostic[] {
  const canonical = canonicalizeJsonText(text)
  if (!canonical.ok) return canonical.diagnostics
  if (canonical.value !== text) {
    return [encDiagnostic('E-ENC-005', '', 'enc/not-canonical', [canonical.value.slice(0, 32)])]
  }
  return []
}
