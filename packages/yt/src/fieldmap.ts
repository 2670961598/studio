/**
 * 字段映射层 —— 业务字段名 ↔ 平台 customField 名翻译（docs/23-§二）
 *
 * 公司目录声明 FieldProvisionMap（业务名→平台名），适配器只认端口语义：
 *   - IssueRecord / IssueQuery / IssueCreate / setField 用的都是**业务字段名**，
 *     进出 YouTrack 前后都经本层翻译；未映射字段显式报错（CONFIG_INVALID），不静默丢
 *   - 内建翻译（不经 map）：title↔summary、description↔description（YouTrack 内建字段）
 *   - state 映射**构造时必须给出**（IssueRecord.state 必填、transition 写它——没有映射无法工作）
 *   - assignee 是 person 字段：值形状 {login}（写）／取 login（读），与声明类型无关
 *   - parent 不是 customField：YouTrack 语义=Subtask 链接（见 links.ts）
 *
 * 值编码表（写方向，业务值 → YouTrack customField value）：
 *   | 业务类型（map.types，缺省 string）| 值形状                          |
 *   |----------------------------------|---------------------------------|
 *   | string / text / date             | 原样字符串                       |
 *   | int                              | 整数（非整数 → CONFIG_INVALID）  |
 *   | enum                             | { name: 值 }（名字寻址，N11）    |
 *   | （业务名 assignee，任何声明类型） | { login: 值 }                    |
 *   | （业务名 state，任何声明类型）    | { name: 值 }——transition 专用    |
 * 读方向宽容：value 是 {name}/{login} 对象取其串，否则原样返回（level 再数值化）。
 */
import type { FieldProvisionMap } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'

export type FieldTypeName = NonNullable<FieldProvisionMap['types']>[string]

/** 内建翻译：不经 provision map 的固定业务字段 → YouTrack 内建属性 */
const BUILTIN_FIELDS: ReadonlySet<string> = new Set(['title', 'description'])

/** 记录维业务名（IssueRecord/IssueCreate/IssueQuery 的可翻译面） */
const KNOWN_RECORD_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'state',
  'type',
  'dept',
  'level',
  'assignee',
  'parent',
  'lane',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** 运行时校验 provision 形状（外部输入路径也要拦下）+ 语义约束 */
export function validateProvision(map: FieldProvisionMap): void {
  if (!isPlainObject(map)) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'provision 必须是对象')
  }
  const fields = map['fields']
  if (!isPlainObject(fields)) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'provision.fields 必须是 业务名→平台名 对象')
  }
  for (const [biz, plat] of Object.entries(fields)) {
    if (typeof plat !== 'string' || plat.trim() === '') {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', `字段 ${biz} 的平台名必须是非空字符串`)
    }
  }
  if (fields['state'] === undefined) {
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'missing-state-mapping',
      'provision.fields.state 必须映射到平台状态字段（IssueRecord.state 必填、transition 写它）',
    )
  }
  if (map['types'] !== undefined) {
    if (!isPlainObject(map['types'])) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'provision.types 必须是 业务名→类型 对象')
    }
    const allowed: readonly string[] = ['string', 'int', 'enum', 'date', 'text']
    for (const [biz, t] of Object.entries(map['types'])) {
      if (!allowed.includes(String(t))) {
        throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', `字段 ${biz} 的类型必须是 ${allowed.join('|')}`)
      }
    }
  }
  if (!isStringArray(map['states'])) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'provision.states 必须是字符串数组')
  }
  if (!isPlainObject(map['stateFlow'])) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'provision.stateFlow 必须是 对象')
  }
  for (const value of Object.values(map['stateFlow'])) {
    if (!isStringArray(value)) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-provision', 'stateFlow 的每项值必须是字符串数组')
    }
  }
}

/**
 * 字段翻译器 —— 构造时由 FieldProvisionMap 绑定公司作用域（docs/25-§3.2）；
 * fields.provision() 可整体换绑（热替换，见 fields.ts）。
 */
export class FieldTranslator {
  private fields: Record<string, string>
  private types: Record<string, FieldTypeName>
  /** 流程状态全集（按流序；首元素=流程初态，建单落位依据，见 IssueCreate.initialState） */
  private states: readonly string[]

  constructor(map: FieldProvisionMap) {
    validateProvision(map)
    this.fields = { ...map.fields }
    this.types = { ...(map.types ?? {}) }
    this.states = [...map.states]
  }

  /** 换绑（provision 用）：整体替换映射与类型 */
  rebind(map: FieldProvisionMap): void {
    validateProvision(map)
    this.fields = { ...map.fields }
    this.types = { ...(map.types ?? {}) }
    this.states = [...map.states]
  }

  /** 流程初态（provision states[0]；空 states → undefined=无声明，建单保持平台默认态） */
  initialState(): string | undefined {
    return this.states[0]
  }

  /** 当前绑定快照（fields.schema() 用；stateFlow 不参与翻译，恒空——见头注） */
  snapshot(): FieldProvisionMap {
    return {
      fields: { ...this.fields },
      types: { ...this.types },
      states: [...this.states],
      stateFlow: {},
    }
  }

  /** 业务名 → 平台 customField 名；内建字段（title/description）不查表，state 必在表 */
  toPlatform(business: string): string {
    const plat = this.fields[business]
    if (plat === undefined) {
      if (BUILTIN_FIELDS.has(business)) {
        throw new YouTrackPlatformError('CONFIG_INVALID', 'unmapped-field', `${business} 是内建字段，不走 customField 翻译`)
      }
      throw new YouTrackPlatformError(
        'CONFIG_INVALID',
        'unmapped-field',
        `业务字段 ${business} 未在 FieldProvisionMap.fields 声明平台映射`,
      )
    }
    return plat
  }

  /** 读路径：issue JSON 的 customFields 里按平台名取原始值 */
  static readCustomField(
    customFields: ReadonlyArray<{ name?: unknown; value?: unknown }> | undefined,
    platformName: string,
  ): { found: boolean; value?: unknown } {
    if (customFields === undefined) return { found: false }
    for (const cf of customFields) {
      if (cf['name'] === platformName) return { found: true, value: cf['value'] }
    }
    return { found: false }
  }

  /** 声明类型（缺省 string） */
  typeOf(business: string): FieldTypeName {
    return this.types[business] ?? 'string'
  }

  /**
   * 业务字段是否可写经 customField：
   * 记录维已知字段按映射判定；公司自定额外字段（如 rank）映射了也可写；
   * title/description 内建、parent 走链接、state 只经 transition。
   */
  canWriteCustomField(business: string): boolean {
    if (business === 'state') return false
    if (business === 'parent') return false
    if (BUILTIN_FIELDS.has(business)) return false
    if (KNOWN_RECORD_FIELDS.has(business)) return this.fields[business] !== undefined
    return this.fields[business] !== undefined
  }

  /** 写方向编码：业务值 → YouTrack customField value（表见头注） */
  encodeValue(business: string, value: unknown): unknown {
    if (business === 'assignee') {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-field-value', `assignee 必须是非空字符串（工号）`)
      }
      return { login: value }
    }
    const type = this.typeOf(business)
    if (type === 'int' || business === 'level') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-field-value', `${business} 必须是整数`)
      }
      return value
    }
    if (type === 'enum' || business === 'state') {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-field-value', `${business} 枚举值必须是非空字符串`)
      }
      return { name: value }
    }
    // string / text / date
    if (typeof value !== 'string') {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-field-value', `${business} 必须是字符串`)
    }
    return value
  }

  /** 读方向解码（宽容）：{name}/{login} 对象取串，否则原样；level 数值化 */
  decodeValue(business: string, raw: unknown): unknown {
    let v: unknown = raw
    if (isPlainObject(raw)) {
      if (typeof raw['name'] === 'string') v = raw['name']
      else if (typeof raw['login'] === 'string') v = raw['login']
      else v = undefined // 空对象/未建模形状（如空 person）
    }
    if (business === 'level') {
      if (typeof v === 'number' && Number.isInteger(v)) return v
      if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v)
      return undefined
    }
    return typeof v === 'string' ? v : undefined
  }
}
