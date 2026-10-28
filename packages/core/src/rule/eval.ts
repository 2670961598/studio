/**
 * rule/eval —— 结构化表达式树的**求值**（两阶段求值的后半；静态检查已在 expr.ts 完成）
 *
 * 依据：
 *   - v2/10 §6.2 RULE-06（and/or/not 三值传播、量词真值、短路只免求值不免检查；比较禁链式；
 *     除法必须声明结果标度与舍入；步数口径「每求值一个节点＋1、每迭代一个列表元素＋1、
 *     被短路/未求值子树不计、模式匹配按自动机转移计」；**墙钟不是语义——超时/超限只能记
 *     refused，不得记 false**）；
 *   - v2/10 §6.2 RULE-05（缺失/空值/未知五形态；unknown 不是可序列化值，不得折算为 0/空/
 *     假；方向表由 rule-engine 的 `resolvePolicyDirection` 承担）；
 *   - v2/10 §6.3（`if` 条件 unknown → 结果 unknown 且**不求值任何分支**；模式匹配受限子集与
 *     三项档内固定限额）；
 *   - v2/10 §八码表：E-RULE-007（eval：除零/溢出/标度超限/空列表聚合）、E-RULE-008
 *     （limit：节点/深度/列表/字符串/求值步数超限）、E-RULE-009（limit：模式超限或越出
 *     受限子集）。**超限一律走 EvalHalt → 上层记 refused**，不是 false。
 *
 * 零 IO、无宿主读取：求值不读时间/时区/环境/随机/网络/文件/模型；同 state 同输入恒同结果
 * 与同步数（RULE-08）。
 */

import type { Diagnostic, DeterminismBlock, FixedLimits, LimitsApplied, PatternModel } from '../spec.ts'
import { makeDiagnostic } from '../spec.ts'
import type { BinaryOperator, InputNode, RuleExpr, UnaryOperator } from './expr.ts'
import { literalValueOf } from './expr.ts'
import { matchRestrictedPattern } from './pattern.ts'
import type { EvalValue, RuleValue } from './value.ts'
import {
  NULL_VALUE,
  UNKNOWN_VALUE,
  addDecimal,
  compareDecimal,
  decimalSignificantDigits,
  decimalToInt,
  divideDecimal,
  multiplyDecimal,
  ruleValueEquals,
} from './value.ts'

/** 求值限额（生效值由 rule-engine 的 min(档内, 调用侧) 合并后传入） */
export interface EvalLimits {
  readonly applied: LimitsApplied
  readonly fixed: FixedLimits
  readonly patternModel: PatternModel
  readonly determinism: DeterminismBlock
}

/** 求值状态（可变：步数与诊断累积；表＝输入绑定结果，含缺省填入值） */
export interface EvalState {
  readonly limits: EvalLimits
  readonly table: ReadonlyMap<string, EvalValue>
  steps: number
  readonly diagnostics: Diagnostic[]
  /** 可选轨迹（RULE-07：trace 不进交换工件、截断必标；null＝不采集） */
  readonly trace: string[] | null
}

/**
 * 求值中止（refused 的内部载体）：携带**单条**封闭码诊断；不跨出本包（rule-engine 捕获
 * 后落 refused 结果）。不用 false/异常值冒充中止——RULE-06/RULE-07。
 */
export class EvalHalt extends Error {
  readonly diagnostic: Diagnostic

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.messageKey)
    this.diagnostic = diagnostic
  }
}

function halt(code: 'E-RULE-007' | 'E-RULE-008' | 'E-RULE-009', messageKey: string, args: readonly (string | number | boolean)[] = []): never {
  throw new EvalHalt(makeDiagnostic(code, '', messageKey, args))
}

function isBool(value: EvalValue): value is RuleValue & { readonly kind: 'Bool'; readonly value: boolean } {
  return typeof value !== 'symbol' && value.kind === 'Bool'
}

function charge(state: EvalState): void {
  state.steps += 1
  if (state.steps > state.limits.applied.maxEvalSteps) {
    halt('E-RULE-008', 'rule/limit-steps', [state.steps, state.limits.applied.maxEvalSteps])
  }
}

function chargeMany(state: EvalState, amount: number): void {
  state.steps += amount
  if (state.steps > state.limits.applied.maxEvalSteps) {
    halt('E-RULE-008', 'rule/limit-steps', [state.steps, state.limits.applied.maxEvalSteps])
  }
}

function assertTextLimit(state: EvalState, text: string): void {
  const codepoints = [...text].length
  if (codepoints > state.limits.applied.maxTextCodepoints) {
    halt('E-RULE-008', 'rule/limit-text', [codepoints, state.limits.applied.maxTextCodepoints])
  }
}

function assertDecimalLimits(state: EvalState, value: RuleValue & { readonly kind: 'Dec' }): RuleValue {
  if (value.scale > state.limits.applied.maxScale) {
    halt('E-RULE-007', 'rule/scale-limit', [value.scale, state.limits.applied.maxScale])
  }
  const digits = decimalSignificantDigits(value)
  if (digits > state.limits.applied.maxSignificantDigits) {
    halt('E-RULE-007', 'rule/precision-limit', [digits, state.limits.applied.maxSignificantDigits])
  }
  return value
}

function assertSafeInt(value: number): RuleValue {
  if (!Number.isSafeInteger(value)) halt('E-RULE-007', 'rule/int-overflow', [String(value)])
  return { kind: 'Int', value }
}

function existence(state: EvalState, operand: InputNode, op: UnaryOperator): EvalValue {
  const present = state.table.has(operand.path)
  const value = state.table.get(operand.path)
  if (op === 'present') return { kind: 'Bool', value: present }
  if (op === 'absent') return { kind: 'Bool', value: !present }
  return { kind: 'Bool', value: present && value === NULL_VALUE }
}

function evalUnary(expr: Extract<RuleExpr, { readonly node: 'unary' }>, state: EvalState, bindings: ReadonlyMap<string, RuleValue>): EvalValue {
  if (expr.op === 'present' || expr.op === 'absent' || expr.op === 'isNull') {
    return existence(state, expr.operand as InputNode, expr.op)
  }
  const operand = evaluateExpression(expr.operand, state, bindings)
  if (operand === UNKNOWN_VALUE || operand === NULL_VALUE) return UNKNOWN_VALUE
  switch (expr.op) {
    case 'not':
      return isBool(operand) ? { kind: 'Bool', value: !operand.value } : UNKNOWN_VALUE
    case 'neg':
      if (operand.kind === 'Int') return assertSafeInt(-operand.value)
      if (operand.kind === 'Dec') return { kind: 'Dec', units: -operand.units, scale: operand.scale }
      return UNKNOWN_VALUE
    case 'dec':
      // ENU-95 白名单 dec(Int)；其余类型在静态期已拒，运行时防御为 unknown
      return operand.kind === 'Int' ? { kind: 'Dec', units: BigInt(operand.value), scale: 0 } : UNKNOWN_VALUE
    case 'int': {
      if (operand.kind !== 'Dec') return UNKNOWN_VALUE
      const converted = decimalToInt(operand)
      if (converted === null) halt('E-RULE-007', 'rule/int-fraction', [String(operand.units), operand.scale])
      return { kind: 'Int', value: converted }
    }
    default:
      return UNKNOWN_VALUE
  }
}

function compareOrdered(left: RuleValue, right: RuleValue): number | null {
  if (left.kind !== right.kind) return null
  switch (left.kind) {
    case 'Int':
      return right.kind === 'Int' ? (left.value === right.value ? 0 : left.value < right.value ? -1 : 1) : null
    case 'Dec':
      return right.kind === 'Dec' ? compareDecimal(left, right) : null
    case 'Str':
    case 'Ts':
    case 'Dur':
      if (right.kind !== left.kind) return null
      return left.value === right.value ? 0 : left.value < right.value ? -1 : 1
    default:
      return null
  }
}

function evalArithmetic(op: BinaryOperator, left: RuleValue, right: RuleValue, expr: Extract<RuleExpr, { readonly node: 'binary' }>, state: EvalState): EvalValue {
  if (left.kind === 'Int' && right.kind === 'Int') {
    switch (op) {
      case 'add':
        return assertSafeInt(left.value + right.value)
      case 'sub':
        return assertSafeInt(left.value - right.value)
      case 'mul':
        return assertSafeInt(left.value * right.value)
      case 'div': {
        if (right.value === 0) halt('E-RULE-007', 'rule/div-zero')
        if (left.value % right.value !== 0) halt('E-RULE-007', 'rule/div-inexact', [left.value, right.value])
        return assertSafeInt(left.value / right.value)
      }
      default:
        return UNKNOWN_VALUE
    }
  }
  if (left.kind === 'Dec' && right.kind === 'Dec') {
    switch (op) {
      case 'add':
        return assertDecimalLimits(state, addDecimal(left, right, false))
      case 'sub':
        return assertDecimalLimits(state, addDecimal(left, right, true))
      case 'mul':
        return assertDecimalLimits(state, multiplyDecimal(left, right))
      case 'div': {
        const scale = expr.scale
        if (scale === undefined) halt('E-RULE-007', 'rule/div-scale-missing')
        const result = divideDecimal(left, right, scale, state.limits.determinism.decimalContext.rounding)
        if (result === null) halt('E-RULE-007', 'rule/div-zero')
        return assertDecimalLimits(state, result)
      }
      default:
        return UNKNOWN_VALUE
    }
  }
  return UNKNOWN_VALUE
}

function evalBinary(expr: Extract<RuleExpr, { readonly node: 'binary' }>, state: EvalState, bindings: ReadonlyMap<string, RuleValue>): EvalValue {
  if (expr.op === 'and' || expr.op === 'or') {
    const left = evaluateExpression(expr.left, state, bindings)
    const leftTruth = isBool(left) ? left.value : null
    // 短路只免求值、不免静态检查（RULE-04/RULE-06）
    if (expr.op === 'and' && leftTruth === false) return { kind: 'Bool', value: false }
    if (expr.op === 'or' && leftTruth === true) return { kind: 'Bool', value: true }
    const right = evaluateExpression(expr.right, state, bindings)
    const rightTruth = isBool(right) ? right.value : null
    if (expr.op === 'and') {
      if (rightTruth === false) return { kind: 'Bool', value: false }
      if (leftTruth === true && rightTruth === true) return { kind: 'Bool', value: true }
      return UNKNOWN_VALUE
    }
    if (rightTruth === true) return { kind: 'Bool', value: true }
    if (leftTruth === false && rightTruth === false) return { kind: 'Bool', value: false }
    return UNKNOWN_VALUE
  }
  const left = evaluateExpression(expr.left, state, bindings)
  const right = evaluateExpression(expr.right, state, bindings)
  if (expr.op === 'in') {
    if (left === UNKNOWN_VALUE || right === UNKNOWN_VALUE || left === NULL_VALUE || right === NULL_VALUE) return UNKNOWN_VALUE
    if (right.kind !== 'List') return UNKNOWN_VALUE
    if (right.items.length > state.limits.applied.maxListItems) {
      halt('E-RULE-008', 'rule/limit-list', [right.items.length, state.limits.applied.maxListItems])
    }
    let matched = false
    for (const item of right.items) {
      charge(state)
      if (ruleValueEquals(left, item)) {
        matched = true
        break
      }
    }
    return { kind: 'Bool', value: matched }
  }
  if (left === UNKNOWN_VALUE || right === UNKNOWN_VALUE || left === NULL_VALUE || right === NULL_VALUE) {
    return UNKNOWN_VALUE
  }
  switch (expr.op) {
    case 'eq':
      return { kind: 'Bool', value: ruleValueEquals(left, right) }
    case 'ne':
      return { kind: 'Bool', value: !ruleValueEquals(left, right) }
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge': {
      const order = compareOrdered(left, right)
      if (order === null) return UNKNOWN_VALUE
      const value = expr.op === 'lt' ? order < 0 : expr.op === 'le' ? order <= 0 : expr.op === 'gt' ? order > 0 : order >= 0
      return { kind: 'Bool', value }
    }
    default:
      return evalArithmetic(expr.op, left, right, expr, state)
  }
}

function evalQuantifier(expr: Extract<RuleExpr, { readonly node: 'quantifier' }>, state: EvalState, bindings: ReadonlyMap<string, RuleValue>): EvalValue {
  const over = evaluateExpression(expr.over, state, bindings)
  if (over === UNKNOWN_VALUE || over === NULL_VALUE || over.kind !== 'List') return UNKNOWN_VALUE
  if (over.items.length > state.limits.applied.maxListItems) {
    halt('E-RULE-008', 'rule/limit-list', [over.items.length, state.limits.applied.maxListItems])
  }
  let sawUnknown = false
  for (const item of over.items) {
    charge(state)
    const scoped = new Map(bindings)
    scoped.set(expr.binding.name, item)
    const body = evaluateExpression(expr.body, state, scoped)
    const truth = isBool(body) ? body.value : null
    if (truth === null) {
      sawUnknown = true
      continue
    }
    if (expr.quant === 'forall' && truth === false) return { kind: 'Bool', value: false }
    if (expr.quant === 'exists' && truth === true) return { kind: 'Bool', value: true }
  }
  if (sawUnknown) return UNKNOWN_VALUE
  // 空列表：forall=true、exists=false（量词真值沿 v1·76 §6.7 口径）
  return { kind: 'Bool', value: expr.quant === 'forall' }
}

function evalMatch(expr: Extract<RuleExpr, { readonly node: 'match' }>, state: EvalState, bindings: ReadonlyMap<string, RuleValue>): EvalValue {
  const subject = evaluateExpression(expr.subject, state, bindings)
  if (subject === UNKNOWN_VALUE || subject === NULL_VALUE || subject.kind !== 'Str') return UNKNOWN_VALUE
  const result = matchRestrictedPattern(expr.pattern, subject.value, {
    maxPatternInputCodepoints: state.limits.fixed.maxPatternInputCodepoints,
    maxPatternSteps: state.limits.fixed.maxPatternSteps,
    maxQuantifierNesting: state.limits.fixed.maxQuantifierNesting,
    maxQuantifierBound: state.limits.patternModel.maxQuantifierBound,
    caseSensitive: state.limits.patternModel.caseSensitive,
  })
  chargeMany(state, result.steps)
  if (!result.ok) {
    halt('E-RULE-009', `rule/pattern-${result.reason}`, [result.detail])
  }
  return { kind: 'Bool', value: result.matched }
}

/** 求值入口（只在静态检查通过后调用；`bindings` 为量词引入的绑定环境） */
export function evaluateExpression(expr: RuleExpr, state: EvalState, bindings: ReadonlyMap<string, RuleValue> = new Map()): EvalValue {
  charge(state)
  state.trace?.push(expr.node)
  switch (expr.node) {
    case 'literal': {
      const value = literalValueOf(expr)
      if (value === null) halt('E-RULE-007', 'rule/literal-invalid')
      if (value.kind === 'Str' || value.kind === 'Ts' || value.kind === 'Dur') assertTextLimit(state, value.value)
      return value
    }
    case 'input':
      return state.table.get(expr.path) ?? UNKNOWN_VALUE
    case 'binding': {
      const value = bindings.get(expr.name)
      return value ?? UNKNOWN_VALUE
    }
    case 'defaultOf':
      return state.table.get(expr.path) ?? UNKNOWN_VALUE
    case 'unary':
      return evalUnary(expr, state, bindings)
    case 'binary':
      return evalBinary(expr, state, bindings)
    case 'conditional': {
      const test = evaluateExpression(expr.test, state, bindings)
      if (!isBool(test)) return UNKNOWN_VALUE // if 条件 unknown → unknown，且两分支都不求值（§6.3）
      return evaluateExpression(test.value ? expr.whenTrue : expr.whenFalse, state, bindings)
    }
    case 'quantifier':
      return evalQuantifier(expr, state, bindings)
    case 'match':
      return evalMatch(expr, state, bindings)
  }
}
