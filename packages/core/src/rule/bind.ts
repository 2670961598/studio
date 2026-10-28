/**
 * rule/bind —— 输入绑定（inputBinding 相位）：缺省、容忍、必需缺失与值域校验
 *
 * 依据：
 *   - v2/10 §6.2 RULE-02（inputDecl 逐字段：path/type/required/nullable/absenceTolerant/default；
 *     `absenceTolerant` 缺省 false、必须逐字段声明、不得整组放行）；
 *   - v2/10 §6.2 RULE-05（缺失/空值/未知五形态；缺省在方向表之前生效；同一字段同时声明
 *     缺省与 `absenceTolerant=true`＝声明期拒收——由 rule-engine 的声明校验承担）；
 *   - v2/10 §6.3 相位修正（必需输入缺失与容忍字段实际缺失只能在输入到达后判定→独立
 *     inputBinding 相位）；§八码表：E-RULE-005（必需输入缺失）、E-RULE-006（可选字段未
 *     声明容忍且实际缺失，被当作未知使用）、E-RULE-003（值域/类型不符）、E-RULE-008
 *     （文本/列表限额）、E-RULE-004（缺省声明冲突）、W-RULE-002（缺省显式生效）；
 *   - docs/plan/04 §1.3 NEG-RULE-02/03（必需缺失→inputBinding 拒绝；未声明容忍的可选
 *     缺失被当 unknown 使用→拒绝）。
 *
 * 零 IO：输入是值不是句柄（调用方已把 JSON 值传入）；不读时钟/环境/文件。
 */

import type { Diagnostic, InputDecl, InputFieldDecl, LimitsApplied, RuleType } from '../spec.ts'
import { makeDiagnostic, parseJsonPointer, scalarFamilyToRuleType } from '../spec.ts'
import type { EvalValue } from './value.ts'
import { NULL_VALUE, jsonToRuleValue } from './value.ts'

/** 绑定结果（失败即为 inputBinding 拒绝面：调用方记 refused，不进入求值） */
export interface BindResult {
  readonly ok: boolean
  readonly table: ReadonlyMap<string, EvalValue>
  readonly diagnostics: readonly Diagnostic[]
}

/** 声明字段 → 求值类型（标量族走映射；显式类型原样） */
export function resolveFieldType(field: InputFieldDecl): RuleType {
  return typeof field.type === 'string' ? scalarFamilyToRuleType(field.type) : field.type
}

interface Resolved {
  readonly present: boolean
  readonly value: unknown
}

/** JSON Pointer 取值（数组下标须为规范十进制；中途 null/缺成员＝不存在） */
function resolvePointer(inputs: unknown, path: string): Resolved {
  const segments = parseJsonPointer(path)
  if (segments === null) return { present: false, value: undefined }
  let current: unknown = inputs
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return { present: false, value: undefined }
      const index = Number(segment)
      if (index >= current.length) return { present: false, value: undefined }
      current = current[index]
      continue
    }
    if (current === null || typeof current !== 'object') return { present: false, value: undefined }
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return { present: false, value: undefined }
    current = record[segment]
  }
  return { present: true, value: current }
}

function codepointLength(text: string): number {
  return [...text].length
}

/**
 * 绑定输入：
 *   - `required` 缺失 → E-RULE-005（哪怕规则未引用该字段——必需输入是前置条件）；
 *   - 可选字段缺省且**被表达式引用**且未声明 `absenceTolerant` → E-RULE-006；
 *   - 声明缺省且实际缺失 → 填入缺省并产生 W-RULE-002（缺省在方向表之前生效）；
 *   - 容忍字段缺失 → 不填表，求值期读作 unknown（RULE-05：unknown 不是可序列化值）。
 */
export function bindInputs(
  inputDecl: InputDecl,
  inputs: unknown,
  referencedPaths: readonly string[],
  limits: LimitsApplied,
): BindResult {
  const diagnostics: Diagnostic[] = []
  const table = new Map<string, EvalValue>()
  const referenced = new Set(referencedPaths)
  for (const field of inputDecl.fields) {
    const type = resolveFieldType(field)
    const resolved = resolvePointer(inputs, field.path)
    if (!resolved.present) {
      if (field.required) {
        diagnostics.push(makeDiagnostic('E-RULE-005', field.path, 'rule/required-missing', [field.path]))
        continue
      }
      if (field.default !== undefined) {
        if (field.default === null) {
          if (!field.nullable) {
            diagnostics.push(makeDiagnostic('E-RULE-004', field.path, 'rule/default-null-not-nullable', [field.path]))
            continue
          }
          table.set(field.path, NULL_VALUE)
        } else {
          const converted = jsonToRuleValue(type, field.default)
          if (!converted.ok) {
            diagnostics.push(makeDiagnostic('E-RULE-004', field.path, 'rule/default-type', [field.path, converted.detail]))
            continue
          }
          table.set(field.path, converted.value)
        }
        diagnostics.push(makeDiagnostic('W-RULE-002', field.path, 'rule/default-applied', [field.path]))
        continue
      }
      if (referenced.has(field.path) && !field.absenceTolerant) {
        // NEG-RULE-03：未声明容忍的可选缺失被当 unknown 使用＝拒绝，不得静默放行
        diagnostics.push(makeDiagnostic('E-RULE-006', field.path, 'rule/optional-missing', [field.path]))
      }
      continue
    }
    if (resolved.value === null) {
      if (!field.nullable) {
        diagnostics.push(makeDiagnostic('E-RULE-003', field.path, 'rule/bind/null-not-nullable', [field.path]))
        continue
      }
      table.set(field.path, NULL_VALUE)
      continue
    }
    const converted = jsonToRuleValue(type, resolved.value)
    if (!converted.ok) {
      diagnostics.push(makeDiagnostic('E-RULE-003', field.path, 'rule/bind/type', [field.path, converted.reason, converted.detail]))
      continue
    }
    const value = converted.value
    if (value.kind === 'Str' || value.kind === 'Ts' || value.kind === 'Dur') {
      const length = codepointLength(value.value)
      if (length > limits.maxTextCodepoints) {
        diagnostics.push(makeDiagnostic('E-RULE-008', field.path, 'rule/limit-text', [length, limits.maxTextCodepoints]))
        continue
      }
    }
    if (value.kind === 'List' && value.items.length > limits.maxListItems) {
      diagnostics.push(makeDiagnostic('E-RULE-008', field.path, 'rule/limit-list', [value.items.length, limits.maxListItems]))
      continue
    }
    table.set(field.path, value)
  }
  const ok = !diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  return { ok, table, diagnostics }
}
