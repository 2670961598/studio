/**
 * rule/expr —— 结构化表达式树与**静态类型检查**（两阶段求值的前半：typecheck）
 *
 * 依据：
 *   - v2/10 §6.2 RULE-03（表达式为结构化树：类型显式字面量／输入引用／绑定变量／一元
 *     二元运算／条件／量词／存在性谓词；**未知构造与未知算子一律拒绝，不得降级为文本**；
 *     禁止自定义函数、递归、宏、模板展开、动态字段名、动态类型转换、宿主调用、正则
 *     替换、注释节点）；
 *   - v2/10 §6.2 RULE-04（封闭类型系统、无隐式转换、显式转换白名单只有 dec(Int)/
 *     int(Dec)、不存在向 Str 的通用转换；**静态检查先于求值且覆盖全部子树**——被短路的
 *     子树类型错误仍在检查期拒绝）；
 *   - v2/10 §6.2 RULE-02（inputDecl 逐字段声明；路径静态可解析——解析不到 E-RULE-004）；
 *   - v2/10 §6.3（`if` 条件 unknown 时两分支仍受全子树静态检查；比较禁止链式）；
 *   - v2/10 §八码表：E-RULE-001（parse：未知节点/非法字面量/禁用构造）、E-RULE-002
 *     （parse：算子/量词构造不在本档）、E-RULE-003（typecheck：类型不匹配/隐式转换/
 *     跨词表跨版本比较）、E-RULE-004（typecheck：路径不可解析；缺省与容忍声明冲突）、
 *     W-RULE-002（typecheck：`defaultOf` 对声明缺省显式赋值）。
 *
 * 本件只做静态面：零 IO、无宿主读取；**不求值**（求值在 rule/eval.ts，两阶段不得合并）。
 */

import type { Diagnostic, InputDecl, InputFieldDecl, RuleProfileSpec, RuleType } from '../spec.ts'
import { isJsonPointer, makeDiagnostic, ruleTypeEquals, ruleTypeName, scalarFamilyToRuleType } from '../spec.ts'
import type { RuleValue } from './value.ts'
import { parseLiteral } from './value.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、表达式树（RULE-03 封闭节点集）
// ─────────────────────────────────────────────────────────────────────────────

/** 一元算子（关闭集合；未知算子名＝E-RULE-001，档未声明＝E-RULE-002） */
export const UNARY_OPERATORS = ['not', 'present', 'absent', 'isNull', 'neg', 'dec', 'int'] as const

/** 一元算子名（本实现的语法面；档的算子全集由档声明，见 RULE-06） */
export type UnaryOperator = (typeof UNARY_OPERATORS)[number]

/** 二元算子（关闭集合；`div` 的 Dec 面必须显式声明结果标度——RULE-06） */
export const BINARY_OPERATORS = ['and', 'or', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'in'] as const

/** 二元算子名 */
export type BinaryOperator = (typeof BINARY_OPERATORS)[number]

/** 存在性谓词真值面（§6.3 真值表：present/absent/isNull 三谓词；absent 只覆盖成员不存在） */
export type ExistenceOperator = 'present' | 'absent' | 'isNull'

/** 条件分支（`if` 条件 unknown 时结果为 unknown 且不求值任何分支——§6.3） */
export interface ConditionalNode {
  readonly node: 'conditional'
  readonly test: RuleExpr
  readonly whenTrue: RuleExpr
  readonly whenFalse: RuleExpr
}

/** 量词（forall/exists 沿三值传播；空列表：forall=true、exists=false） */
export interface QuantifierNode {
  readonly node: 'quantifier'
  readonly quant: 'forall' | 'exists'
  readonly binding: { readonly name: string; readonly type: RuleType }
  readonly over: RuleExpr
  readonly body: RuleExpr
}

/** 模式匹配（受限子集；编译与限额在求值阶段判——E-RULE-009） */
export interface MatchNode {
  readonly node: 'match'
  readonly subject: RuleExpr
  readonly pattern: string
}

/** 类型显式字面量（List/Rec 不可作字面量——E-RULE-001） */
export interface LiteralNode {
  readonly node: 'literal'
  readonly type: RuleType
  readonly value: string | number | boolean
}

/** 输入引用（路径是 JSON Pointer；静态可解析性由 inputDecl 判——E-RULE-004） */
export interface InputNode {
  readonly node: 'input'
  readonly path: string
}

/** 绑定变量引用（量词引入；未声明变量＝E-RULE-001） */
export interface BindingNode {
  readonly node: 'binding'
  readonly name: string
}

/** `defaultOf`（对声明缺省显式赋值；必产生 W-RULE-002；用于未声明缺省＝E-RULE-004） */
export interface DefaultOfNode {
  readonly node: 'defaultOf'
  readonly path: string
}

/** 一元运算 */
export interface UnaryNode {
  readonly node: 'unary'
  readonly op: UnaryOperator
  readonly operand: RuleExpr
}

/** 二元运算（`scale` 仅 `div` 的 Dec 面必填——除法必须声明结果标度与舍入） */
export interface BinaryNode {
  readonly node: 'binary'
  readonly op: BinaryOperator
  readonly left: RuleExpr
  readonly right: RuleExpr
  readonly scale?: number
}

/** 表达式树（RULE-03 封闭节点集；无注释节点、无宏、无宿主调用） */
export type RuleExpr =
  | LiteralNode
  | InputNode
  | BindingNode
  | DefaultOfNode
  | UnaryNode
  | BinaryNode
  | ConditionalNode
  | QuantifierNode
  | MatchNode

const NODE_KINDS = [
  'literal',
  'input',
  'binding',
  'defaultOf',
  'unary',
  'binary',
  'conditional',
  'quantifier',
  'match',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// 二、静态检查（typecheck 相位）
// ─────────────────────────────────────────────────────────────────────────────

/** 静态检查上下文（档＋输入声明；不求值、不持状态） */
export interface StaticContext {
  readonly profile: RuleProfileSpec
  readonly inputDecl: InputDecl
}

/** 静态检查结果：类型（失败时为占位 Bool）＋诊断＋被引用输入路径 */
export interface StaticResult {
  readonly diagnostics: readonly Diagnostic[]
  readonly type: RuleType
  readonly failed: boolean
  readonly referencedPaths: readonly string[]
}

interface TypeState {
  readonly context: StaticContext
  readonly diagnostics: Diagnostic[]
  readonly referenced: Set<string>
  failed: boolean
}

const BOOL_TYPE: RuleType = { kind: 'Bool' }

function error(state: TypeState, code: 'E-RULE-001' | 'E-RULE-002' | 'E-RULE-003' | 'E-RULE-004', location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): void {
  state.failed = true
  state.diagnostics.push(makeDiagnostic(code, location, messageKey, args))
}

function warn(state: TypeState, location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): void {
  state.diagnostics.push(makeDiagnostic('W-RULE-002', location, messageKey, args))
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function isNumeric(type: RuleType): boolean {
  return type.kind === 'Int' || type.kind === 'Dec'
}

/** 声明缺省 → 求值面值（与 inputDecl 的 `default` 同源；合法性由 inputDecl 校验承担） */
function declaredField(state: TypeState, path: string, location: string): InputFieldDecl | null {
  const field = state.context.inputDecl.fields.find((entry) => entry.path === path)
  if (field === undefined) {
    error(state, 'E-RULE-004', location, 'rule/path-unresolvable', [path])
    return null
  }
  return field
}

function fieldType(field: InputFieldDecl): RuleType {
  return typeof field.type === 'string' ? scalarFamilyToRuleType(field.type) : field.type
}

function declaredOperator(state: TypeState, operator: string, location: string): void {
  if (!state.context.profile.operators.includes(operator)) {
    error(state, 'E-RULE-002', location, 'rule/operator-undeclared', [operator])
  }
}

function mismatch(state: TypeState, location: string, left: RuleType, right: RuleType): void {
  if (left.kind === 'Enum' && right.kind === 'Enum') {
    // 跨词表/跨版本比较＝类型错误（RULE-04）；不得按码值字符串降级比较
    error(state, 'E-RULE-003', location, 'rule/type/cross-vocab', [ruleTypeName(left), ruleTypeName(right)])
    return
  }
  if (isNumeric(left) && isNumeric(right)) {
    error(state, 'E-RULE-003', location, 'rule/type/no-implicit-conversion', [ruleTypeName(left), ruleTypeName(right)])
    return
  }
  error(state, 'E-RULE-003', location, 'rule/type/mismatch', [ruleTypeName(left), ruleTypeName(right)])
}

function requireKind(state: TypeState, location: string, actual: RuleType, expected: RuleType['kind']): void {
  if (actual.kind !== expected) {
    error(state, 'E-RULE-003', location, 'rule/type/mismatch', [ruleTypeName(actual), expected])
  }
}

/** 类型形状解析（无诊断；ENU-94 九型；非法返回 null——由调用方落 E-RULE-001） */
export function parseRuleTypeShape(raw: unknown): RuleType | null {
  const record = asRecord(raw)
  if (record === null) return null
  const kind = record['kind']
  switch (kind) {
    case 'Bool':
    case 'Int':
    case 'Dec':
    case 'Str':
    case 'Ts':
    case 'Dur':
      return { kind }
    case 'Enum': {
      const vocab = record['vocab']
      const vocabVersion = record['vocabVersion']
      return typeof vocab === 'string' && typeof vocabVersion === 'string' ? { kind: 'Enum', vocab, vocabVersion } : null
    }
    case 'List': {
      const element = parseRuleTypeShape(record['element'])
      return element === null ? null : { kind: 'List', element }
    }
    case 'Rec': {
      const name = record['name']
      return typeof name === 'string' ? { kind: 'Rec', name } : null
    }
    default:
      return null
  }
}

function readRuleType(raw: unknown, state: TypeState, location: string): RuleType {
  const parsed = parseRuleTypeShape(raw)
  if (parsed === null) {
    error(state, 'E-RULE-001', location, 'rule/type-shape')
    return BOOL_TYPE
  }
  return parsed
}

function checkNode(raw: unknown, state: TypeState, location: string, bindings: ReadonlyMap<string, RuleType>): RuleType {
  const record = asRecord(raw)
  if (record === null) {
    error(state, 'E-RULE-001', location, 'rule/node-shape')
    return BOOL_TYPE
  }
  const node = record['node']
  if (typeof node !== 'string' || !(NODE_KINDS as readonly string[]).includes(node)) {
    // 未知构造（如 call/macro/regex-replace）一律拒绝，不得降级为文本（RULE-03）
    error(state, 'E-RULE-001', location, 'rule/unknown-node', [String(node)])
    return BOOL_TYPE
  }
  switch (node) {
    case 'literal': {
      const type = readRuleType(record['type'], state, `${location}/type`)
      const parsed = parseLiteral(type, record['value'])
      if (!parsed.ok) {
        error(state, 'E-RULE-001', location, 'rule/illegal-literal', [parsed.detail])
        return type
      }
      return type
    }
    case 'input': {
      const path = record['path']
      if (typeof path !== 'string' || !isJsonPointer(path)) {
        error(state, 'E-RULE-004', location, 'rule/path-unresolvable', [String(path)])
        return BOOL_TYPE
      }
      const field = declaredField(state, path, location)
      if (field === null) return BOOL_TYPE
      state.referenced.add(path)
      return fieldType(field)
    }
    case 'binding': {
      const name = record['name']
      if (typeof name !== 'string' || !bindings.has(name)) {
        error(state, 'E-RULE-001', location, 'rule/unknown-binding', [String(name)])
        return BOOL_TYPE
      }
      return bindings.get(name) as RuleType
    }
    case 'defaultOf': {
      const path = record['path']
      if (typeof path !== 'string' || !isJsonPointer(path)) {
        error(state, 'E-RULE-004', location, 'rule/path-unresolvable', [String(path)])
        return BOOL_TYPE
      }
      const field = declaredField(state, path, location)
      if (field === null) return BOOL_TYPE
      if (field.default === undefined) {
        // NEG-RULE-05：defaultOf 用于未声明缺省＝类型错误（缺省声明冲突面）
        error(state, 'E-RULE-004', location, 'rule/defaultof-conflict', [path])
        return BOOL_TYPE
      }
      state.referenced.add(path)
      warn(state, location, 'rule/defaultof-declared', [path])
      return fieldType(field)
    }
    case 'unary':
      return checkUnary(record, state, location, bindings)
    case 'binary':
      return checkBinary(record, state, location, bindings)
    case 'conditional': {
      const testType = checkNode(record['test'], state, `${location}/test`, bindings)
      requireKind(state, `${location}/test`, testType, 'Bool')
      // 两分支都检查（RULE-04：短路不得掩盖错误分支；§6.3 if-unknown 亦同）
      const trueType = checkNode(record['whenTrue'], state, `${location}/whenTrue`, bindings)
      const falseType = checkNode(record['whenFalse'], state, `${location}/whenFalse`, bindings)
      if (!ruleTypeEquals(trueType, falseType)) mismatch(state, location, trueType, falseType)
      return trueType
    }
    case 'quantifier':
      return checkQuantifier(record, state, location, bindings)
    case 'match': {
      declaredOperator(state, 'match', location)
      const subjectType = checkNode(record['subject'], state, `${location}/subject`, bindings)
      requireKind(state, `${location}/subject`, subjectType, 'Str')
      if (typeof record['pattern'] !== 'string') {
        error(state, 'E-RULE-001', location, 'rule/pattern-shape')
      }
      return BOOL_TYPE
    }
  }
  return BOOL_TYPE
}

function checkUnary(record: Record<string, unknown>, state: TypeState, location: string, bindings: ReadonlyMap<string, RuleType>): RuleType {
  const op = record['op']
  if (typeof op !== 'string' || !(UNARY_OPERATORS as readonly string[]).includes(op)) {
    error(state, 'E-RULE-001', location, 'rule/unknown-operator', [String(op)])
    return BOOL_TYPE
  }
  declaredOperator(state, op, location)
  const operand = record['operand']
  if (op === 'present' || op === 'absent' || op === 'isNull') {
    // 存在性谓词只对输入成员有意义（§6.3 真值表以成员存在/不存在/null 为三态）
    const operandRecord = asRecord(operand)
    if (operandRecord === null || operandRecord['node'] !== 'input') {
      error(state, 'E-RULE-001', location, 'rule/existence-operand')
      checkNode(operand, state, `${location}/operand`, bindings)
      return BOOL_TYPE
    }
    checkNode(operand, state, `${location}/operand`, bindings)
    return BOOL_TYPE
  }
  const operandType = checkNode(operand, state, `${location}/operand`, bindings)
  switch (op) {
    case 'not':
      requireKind(state, `${location}/operand`, operandType, 'Bool')
      return BOOL_TYPE
    case 'neg':
      if (!isNumeric(operandType)) {
        error(state, 'E-RULE-003', `${location}/operand`, 'rule/type/mismatch', [ruleTypeName(operandType), 'Int|Dec'])
        return operandType
      }
      return operandType
    case 'dec':
      // ENU-95 白名单：只有 dec(Int)
      requireKind(state, `${location}/operand`, operandType, 'Int')
      return { kind: 'Dec' }
    case 'int':
      // ENU-95 白名单：只有 int(Dec)（小数部非零即错误，非舍入）
      requireKind(state, `${location}/operand`, operandType, 'Dec')
      return { kind: 'Int' }
    default:
      return BOOL_TYPE
  }
}

function checkBinary(record: Record<string, unknown>, state: TypeState, location: string, bindings: ReadonlyMap<string, RuleType>): RuleType {
  const op = record['op']
  if (typeof op !== 'string' || !(BINARY_OPERATORS as readonly string[]).includes(op)) {
    error(state, 'E-RULE-001', location, 'rule/unknown-operator', [String(op)])
    return BOOL_TYPE
  }
  declaredOperator(state, op, location)
  // 左右子树都检查（含 and/or 的短路面）——静态检查覆盖全部子树
  const left = checkNode(record['left'], state, `${location}/left`, bindings)
  const right = checkNode(record['right'], state, `${location}/right`, bindings)
  switch (op) {
    case 'and':
    case 'or':
      requireKind(state, `${location}/left`, left, 'Bool')
      requireKind(state, `${location}/right`, right, 'Bool')
      return BOOL_TYPE
    case 'eq':
    case 'ne':
      if (!ruleTypeEquals(left, right)) mismatch(state, location, left, right)
      if (left.kind === 'List' || left.kind === 'Rec') {
        error(state, 'E-RULE-003', location, 'rule/type/equality', [ruleTypeName(left)])
      }
      return BOOL_TYPE
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge': {
      if (!ruleTypeEquals(left, right)) {
        mismatch(state, location, left, right)
        return BOOL_TYPE
      }
      // 比较禁止链式：二元树里若一侧是 Bool（上一比较的结果）即类型错误
      if (left.kind === 'Bool' || left.kind === 'List' || left.kind === 'Rec') {
        error(state, 'E-RULE-003', location, 'rule/type/ordering', [ruleTypeName(left)])
      }
      return BOOL_TYPE
    }
    case 'add':
    case 'sub':
    case 'mul':
      if (!isNumeric(left) || !isNumeric(right) || !ruleTypeEquals(left, right)) {
        mismatch(state, location, left, right)
        return BOOL_TYPE
      }
      return left
    case 'div': {
      if (!isNumeric(left) || !isNumeric(right) || !ruleTypeEquals(left, right)) {
        mismatch(state, location, left, right)
        return BOOL_TYPE
      }
      if (left.kind === 'Dec') {
        // RULE-06：除法必须声明结果标度与舍入（舍入取档 determinism.decimalContext）
        const scale = record['scale']
        if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0) {
          error(state, 'E-RULE-001', location, 'rule/div-scale-missing')
        }
        return { kind: 'Dec' }
      }
      return { kind: 'Int' }
    }
    case 'in': {
      if (right.kind !== 'List') {
        requireKind(state, `${location}/right`, right, 'List')
        return BOOL_TYPE
      }
      if (!ruleTypeEquals(left, right.element)) mismatch(state, location, left, right.element)
      return BOOL_TYPE
    }
    default:
      return BOOL_TYPE
  }
}

function checkQuantifier(record: Record<string, unknown>, state: TypeState, location: string, bindings: ReadonlyMap<string, RuleType>): RuleType {
  const quant = record['quant']
  if (quant !== 'forall' && quant !== 'exists') {
    error(state, 'E-RULE-001', location, 'rule/unknown-operator', [String(quant)])
    return BOOL_TYPE
  }
  declaredOperator(state, quant, location)
  const over = checkNode(record['over'], state, `${location}/over`, bindings)
  const declaration = asRecord(record['binding'])
  if (declaration === null || typeof declaration['name'] !== 'string') {
    error(state, 'E-RULE-001', location, 'rule/binding-shape')
    return BOOL_TYPE
  }
  const bindingType = readRuleType(declaration['type'], state, `${location}/binding/type`)
  if (over.kind !== 'List') {
    requireKind(state, `${location}/over`, over, 'List')
  } else if (!ruleTypeEquals(over.element, bindingType)) {
    mismatch(state, `${location}/binding/type`, over.element, bindingType)
  }
  const scoped = new Map(bindings)
  scoped.set(declaration['name'], bindingType)
  const bodyType = checkNode(record['body'], state, `${location}/body`, scoped)
  requireKind(state, `${location}/body`, bodyType, 'Bool')
  return BOOL_TYPE
}

/**
 * 静态类型检查入口（两阶段的前半）：覆盖全部子树、返回根类型与诊断。
 * 失败即不得求值——`evaluateExpression` 只接受本函数产出类型后的树（类型层＋运行层双闸）。
 */
export function typecheckExpression(expression: unknown, context: StaticContext): StaticResult {
  const state: TypeState = { context, diagnostics: [], referenced: new Set(), failed: false }
  const type = checkNode(expression, state, '', new Map())
  return {
    diagnostics: state.diagnostics,
    type,
    failed: state.failed,
    referencedPaths: [...state.referenced].sort(),
  }
}

/** 表达式形状（节点数与深度；用于 limitsApplied.maxNodes/maxDepth 判——E-RULE-008） */
export function expressionShape(expression: RuleExpr): { readonly nodes: number; readonly depth: number } {
  let nodes = 0
  let depth = 0
  const visit = (expr: RuleExpr, level: number): void => {
    nodes += 1
    depth = Math.max(depth, level)
    switch (expr.node) {
      case 'unary':
        visit(expr.operand, level + 1)
        return
      case 'binary':
        visit(expr.left, level + 1)
        visit(expr.right, level + 1)
        return
      case 'conditional':
        visit(expr.test, level + 1)
        visit(expr.whenTrue, level + 1)
        visit(expr.whenFalse, level + 1)
        return
      case 'quantifier':
        visit(expr.over, level + 1)
        visit(expr.body, level + 1)
        return
      case 'match':
        visit(expr.subject, level + 1)
        return
      default:
        return
    }
  }
  visit(expression, 1)
  return { nodes, depth }
}

/** 字面量值（静态检查已收窄；供求值/测试取用） */
export function literalValueOf(node: LiteralNode): RuleValue | null {
  const parsed = parseLiteral(node.type, node.value)
  return parsed.ok ? parsed.value : null
}
