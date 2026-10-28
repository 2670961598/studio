/**
 * rule/value —— 求值值域与精确十进制（v2/10 §1.1 decimal 行、§1.5、§6.2 RULE-04/06）
 *
 * 依据：
 *   - v2/10 §6.2 RULE-04（ENU-94 封闭类型集九型：Bool/Int/Dec(s)/Str/Ts/Dur/Enum/List/Rec；
 *     **无隐式转换**；显式转换白名单只有 dec(Int)/int(Dec)，ENU-95）；
 *   - v2/10 §2.4/§1.1（decimal 以字符串承载、不补零不去尾零；integer 域 ±(2^53−1)）；
 *   - v2/10 §1.5（精确十进制：有理数表示、有效数字 ≤34、标度 ≤9、舍入 half-even 缺省，
 *     保守方向 floor/ceiling——值集 ENU-105）；
 *   - v2/10 §八 E-RULE-007（除零、溢出、标度超限——码义单点，本件只返回失败原因）。
 *
 * 本件零 IO、无宿主读取：不含时间/随机/环境；同值恒同结果。
 */

import type { DecimalRounding, RuleType } from '../spec.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、值域（ENU-94 九型 ＋ 求值域的 unknown/null 两态）
// ─────────────────────────────────────────────────────────────────────────────

/** Bool 值 */
export interface BoolValue {
  readonly kind: 'Bool'
  readonly value: boolean
}

/** Int 值（安全整数；越界由运算处判 E-RULE-007） */
export interface IntValue {
  readonly kind: 'Int'
  readonly value: number
}

/**
 * Dec 值（十进制有理数：`units / 10^scale`；标度是词法组成，不归一——§2.5/ENC-05）。
 * 标度上限由限额 maxScale 判（§1.5 标度 ≤9；36 位有效数字上限由 maxSignificantDigits 判）。
 */
export interface DecValue {
  readonly kind: 'Dec'
  readonly units: bigint
  readonly scale: number
}

/** Str/Ts/Dur 值（Ts/Dur 在规范化与比较阶段只当字符串，不解析、不改时区——§2.4） */
export interface TextValue {
  readonly kind: 'Str' | 'Ts' | 'Dur'
  readonly value: string
}

/** Enum 值（vocab＋version＋code 三元组的解引用面；跨词表/跨版本比较＝类型错误） */
export interface EnumValue {
  readonly kind: 'Enum'
  readonly vocab: string
  readonly vocabVersion: string
  readonly code: string
}

/** List 值（保序、不排序不去重；元素类型随声明锁定） */
export interface ListValue {
  readonly kind: 'List'
  readonly element: RuleType
  readonly items: readonly RuleValue[]
}

/** Rec 值（封闭成员集；成员类型由 JSON 形状承载——RULE-02 参数位缺口见 spec.ts） */
export interface RecValue {
  readonly kind: 'Rec'
  readonly name: string
  readonly fields: Readonly<Record<string, RuleValue>>
}

/** 求值值（九型落地） */
export type RuleValue = BoolValue | IntValue | DecValue | TextValue | EnumValue | ListValue | RecValue

/** 输入不足（RULE-05/§1.4：未知不是可序列化值；不得折算为 0/空/绿/未发生） */
export const UNKNOWN_VALUE = Symbol('studio-next.rule.unknown')

/** JSON `null`（`nullable=true` 字段的明确声明；与「成员不存在」不同——§1.4） */
export const NULL_VALUE = Symbol('studio-next.rule.null')

/** 求值面值（值 ∪ unknown ∪ null） */
export type EvalValue = RuleValue | typeof UNKNOWN_VALUE | typeof NULL_VALUE

/** 值 → 显示名（诊断 messageArgs 用） */
export function valueKind(value: EvalValue): string {
  return typeof value === 'symbol' ? (value === UNKNOWN_VALUE ? 'unknown' : 'null') : value.kind
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、decimal 词法与精确运算（§1.1/§1.5，ENU-105 舍入）
// ─────────────────────────────────────────────────────────────────────────────

const DECIMAL_RE = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/

/** 十进制字符串 → Dec（`-0`/`0.0` 保词法：units=0 但 scale 保留）；非法返回 null */
export function parseDecimal(text: string): DecValue | null {
  const match = DECIMAL_RE.exec(text)
  if (match === null) return null
  const [, sign, integer, fraction] = match
  if (integer === undefined) return null
  const scale = fraction === undefined ? 0 : fraction.length
  const digits = `${integer}${fraction ?? ''}`
  const magnitude = BigInt(digits)
  return { kind: 'Dec', units: sign === '-' ? -magnitude : magnitude, scale }
}

/** Dec → 最短词法（不补零、不去尾零；标度原样——§2.5 词法同一性） */
export function formatDecimal(value: DecValue): string {
  const negative = value.units < 0n
  const digits = (negative ? -value.units : value.units).toString()
  if (value.scale === 0) return `${negative ? '-' : ''}${digits}`
  const padded = digits.padStart(value.scale + 1, '0')
  const split = padded.length - value.scale
  return `${negative ? '-' : ''}${padded.slice(0, split)}.${padded.slice(split)}`
}

/** 十进制有效数字位数（去掉符号与小数点后前导零；用于 maxSignificantDigits 判） */
export function decimalSignificantDigits(value: DecValue): number {
  const digits = (value.units < 0n ? -value.units : value.units).toString()
  const trimmed = digits.replace(/^0+/, '')
  return trimmed.length === 0 ? 1 : trimmed.length
}

function align(left: DecValue, right: DecValue): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale)
  const leftUnits = left.units * 10n ** BigInt(scale - left.scale)
  const rightUnits = right.units * 10n ** BigInt(scale - right.scale)
  return [leftUnits, rightUnits, scale]
}

/** Dec 加减（结果标度＝max(左,右)） */
export function addDecimal(left: DecValue, right: DecValue, subtract: boolean): DecValue {
  const [leftUnits, rightUnits, scale] = align(left, right)
  return { kind: 'Dec', units: subtract ? leftUnits - rightUnits : leftUnits + rightUnits, scale }
}

/** Dec 乘（结果标度＝左＋右；超 maxScale 由调用方判 E-RULE-007） */
export function multiplyDecimal(left: DecValue, right: DecValue): DecValue {
  return { kind: 'Dec', units: left.units * right.units, scale: left.scale + right.scale }
}

/** Dec 比较（对齐后比 units；返回 -1/0/1） */
export function compareDecimal(left: DecValue, right: DecValue): number {
  const [leftUnits, rightUnits] = align(left, right)
  return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1
}

/** Dec 相等（对齐后 units 相等；`1.20` 与 `1.2` 数值相等——ENC-05 数值同一性面） */
export function decimalEquals(left: DecValue, right: DecValue): boolean {
  return compareDecimal(left, right) === 0
}

/** Dec → Int（`int(Dec)` 白名单：小数部非零即错误，不舍入——ENU-95/RULE-04） */
export function decimalToInt(value: DecValue): number | null {
  if (value.scale === 0) return Number.isSafeInteger(Number(value.units)) ? Number(value.units) : null
  const divisor = 10n ** BigInt(value.scale)
  if (value.units % divisor !== 0n) return null
  const int = value.units / divisor
  const asNumber = Number(int)
  return Number.isSafeInteger(asNumber) ? asNumber : null
}

/** 四舍五入商（ENU-105；den>0，符号归一后按 half-even/floor/ceiling 取整） */
export function divideRounded(numerator: bigint, denominator: bigint, rounding: DecimalRounding): bigint {
  if (denominator === 0n) throw new RangeError('division by zero')
  const negative = numerator < 0n !== denominator < 0n
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  const quotient = absNumerator / absDenominator
  const remainder = absNumerator % absDenominator
  let magnitude = quotient
  if (remainder !== 0n) {
    if (rounding === 'floor') {
      magnitude = negative ? quotient + 1n : quotient
    } else if (rounding === 'ceiling') {
      magnitude = negative ? quotient : quotient + 1n
    } else {
      const twice = remainder * 2n
      if (twice > absDenominator) magnitude = quotient + 1n
      else if (twice === absDenominator && quotient % 2n !== 0n) magnitude = quotient + 1n
    }
  }
  return negative ? -magnitude : magnitude
}

/**
 * Dec 除法（`a / b` 在声明标度 scale 上取值并按 rounding 舍入——RULE-06「除法必须声明
 * 结果标度与舍入」）。除零返回 null（由调用方判 E-RULE-007，不产近似值）。
 */
export function divideDecimal(left: DecValue, right: DecValue, scale: number, rounding: DecimalRounding): DecValue | null {
  if (right.units === 0n) return null
  // (au/10^as) / (bu/10^bs) = au*10^bs / (bu*10^as)；在目标标度 s 上：ru = round(au*10^(bs+s) / (bu*10^as))
  const exponent = right.scale + scale - left.scale
  const numerator = exponent >= 0 ? left.units * 10n ** BigInt(exponent) : left.units
  const denominator = exponent >= 0 ? right.units : right.units * 10n ** BigInt(-exponent)
  return { kind: 'Dec', units: divideRounded(numerator, denominator, rounding), scale }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、字面量与 JSON 输入的收窄（RULE-02/04；ENU-94/95）
// ─────────────────────────────────────────────────────────────────────────────

/** 收窄失败原因：类型不符 / 域外数值（decimal 以 JSON 数值承载、整数超安全域等） */
export type ValueErrorReason = 'type' | 'domain'

/** 收窄结果 */
export type ValueResult =
  | { readonly ok: true; readonly value: RuleValue }
  | { readonly ok: false; readonly reason: ValueErrorReason; readonly detail: string }

function bad(reason: ValueErrorReason, detail: string): ValueResult {
  return { ok: false, reason, detail }
}

/** 逐类型收窄一个 JSON 值（`type` 由 inputDecl 或字面量类型声明锁定） */
export function jsonToRuleValue(type: RuleType, json: unknown): ValueResult {
  switch (type.kind) {
    case 'Bool':
      return typeof json === 'boolean' ? { ok: true, value: { kind: 'Bool', value: json } } : bad('type', 'Bool')
    case 'Int':
      return typeof json === 'number' && Number.isSafeInteger(json)
        ? { ok: true, value: { kind: 'Int', value: json } }
        : bad(typeof json === 'number' ? 'domain' : 'type', 'Int')
    case 'Dec': {
      // §2.4：decimal 以字符串承载；JSON 数值形态＝域外（不得先转双精度）
      if (typeof json !== 'string') return bad('domain', 'Dec 必须以字符串承载（§2.4）')
      const value = parseDecimal(json)
      return value === null ? bad('domain', 'Dec 词法') : { ok: true, value }
    }
    case 'Str':
    case 'Ts':
    case 'Dur':
      return typeof json === 'string'
        ? { ok: true, value: { kind: type.kind, value: json } }
        : bad('type', type.kind)
    case 'Enum':
      return typeof json === 'string'
        ? { ok: true, value: { kind: 'Enum', vocab: type.vocab, vocabVersion: type.vocabVersion, code: json } }
        : bad('type', 'Enum')
    case 'List': {
      if (!Array.isArray(json)) return bad('type', 'List')
      const items: RuleValue[] = []
      for (const entry of json) {
        const converted = jsonToRuleValue(type.element, entry)
        if (!converted.ok) return converted
        items.push(converted.value)
      }
      return { ok: true, value: { kind: 'List', element: type.element, items } }
    }
    case 'Rec': {
      // `Rec(json)` 是本实现对「JSON 形状」的承载类型（RULE-02 缺参数位的缺口注见 spec.ts）；
      // 其成员按 JSON 自足收窄：对象→Rec、数组→List、字符串→Str、布尔→Bool、整数→Int。
      if (type.name !== 'json') return bad('type', `Rec(${type.name})`)
      if (json === null) return bad('type', 'Rec(json)')
      if (Array.isArray(json)) {
        const items: RuleValue[] = []
        for (const entry of json) {
          const converted = jsonToRuleValue(type, entry)
          if (!converted.ok) return converted
          items.push(converted.value)
        }
        return { ok: true, value: { kind: 'List', element: type, items } }
      }
      if (typeof json === 'string') return { ok: true, value: { kind: 'Str', value: json } }
      if (typeof json === 'boolean') return { ok: true, value: { kind: 'Bool', value: json } }
      if (typeof json === 'number') {
        return Number.isSafeInteger(json)
          ? { ok: true, value: { kind: 'Int', value: json } }
          : bad('domain', 'Rec(json) 数值不在整数域')
      }
      if (typeof json !== 'object') return bad('type', 'Rec(json)')
      const fields: Record<string, RuleValue> = {}
      for (const [key, member] of Object.entries(json as Record<string, unknown>)) {
        const converted = jsonToRuleValue(type, member)
        if (!converted.ok) return converted
        fields[key] = converted.value
      }
      return { ok: true, value: { kind: 'Rec', name: 'json', fields } }
    }
  }
}

/** 字面量收窄（RULE-03：类型显式的字面量；List/Rec 不可作字面量——E-RULE-001 面） */
export function parseLiteral(type: RuleType, raw: unknown): ValueResult {
  if (type.kind === 'List' || type.kind === 'Rec') return bad('type', 'literal-kind')
  if (type.kind === 'Str' || type.kind === 'Ts' || type.kind === 'Dur') {
    return typeof raw === 'string' ? { ok: true, value: { kind: type.kind, value: raw } } : bad('type', type.kind)
  }
  return jsonToRuleValue(type, raw)
}

/** 值相等（同型前提由静态检查保证；Dec 按数值、Enum 按 vocab+version+code） */
export function ruleValueEquals(left: RuleValue, right: RuleValue): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case 'Bool':
      return right.kind === 'Bool' && left.value === right.value
    case 'Int':
      return right.kind === 'Int' && left.value === right.value
    case 'Dec':
      return right.kind === 'Dec' && decimalEquals(left, right)
    case 'Str':
    case 'Ts':
    case 'Dur':
      return right.kind === left.kind && left.value === right.value
    case 'Enum':
      return (
        right.kind === 'Enum' &&
        left.vocab === right.vocab &&
        left.vocabVersion === right.vocabVersion &&
        left.code === right.code
      )
    case 'List':
      return (
        right.kind === 'List' &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => {
          const other = right.items[index]
          return other !== undefined && ruleValueEquals(item, other)
        })
      )
    case 'Rec':
      return (
        right.kind === 'Rec' &&
        left.name === right.name &&
        Object.keys(left.fields).length === Object.keys(right.fields).length &&
        Object.entries(left.fields).every(([key, value]) => {
          const other = right.fields[key]
          return other !== undefined && ruleValueEquals(value, other)
        })
      )
  }
}
