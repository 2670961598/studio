/**
 * 字段面 —— meta/fields.json 落盘（schema + provision）。
 *
 * LocalFile 是契约靶子（docs/23-§一）：provision 只负责把公司的字段映射/状态流
 * 持久化到盘上（供查阅、迁移、契约测试），不做平台侧执行——真正的闸是 daemon
 * state-diff 第一道 + YouTrack 侧 JS guard 第二道（docs/18-§二.2）。
 *
 * 端口缺口注记（只记录不改 contract）：FieldProvisionMap 不携带字段类型，
 * 故 provision 后的字段在 schema() 里只能标 'string'（升级：map 加类型描述）。
 */
import type { FieldProvisionMap, FieldSchema } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'
import { isPlainObject, readJson, writeJson } from './fsutil.ts'
import { fieldsPath } from './layout.ts'

interface FieldsFile {
  provision?: FieldProvisionMap | null
}

/** 基础字段（单据记录的固有维度，IssueRecord 的可派生面） */
const BASE_SCHEMA: readonly FieldSchema[] = [
  { name: 'title', type: 'string' },
  { name: 'description', type: 'text' },
  { name: 'type', type: 'string' },
  { name: 'dept', type: 'string' },
  { name: 'level', type: 'int' },
  { name: 'assignee', type: 'string' },
  { name: 'parent', type: 'string' },
  { name: 'lane', type: 'string' },
]

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isStringArrayRecord(v: unknown): v is Record<string, string[]> {
  return isPlainObject(v) && Object.values(v).every((x) => isStringArray(x))
}

/** 类型状态流形状：type id →「状态→string[]」（DEV-43） */
function isTypeFlowsRecord(v: unknown): v is Record<string, Record<string, string[]>> {
  return isPlainObject(v) && Object.values(v).every((x) => isStringArrayRecord(x))
}

export function isProvisionMap(v: unknown): v is FieldProvisionMap {
  if (!isPlainObject(v)) return false
  const fields = v['fields']
  if (!isPlainObject(fields)) return false
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') return false
  }
  if (!isStringArray(v['states'])) return false
  const flow = v['stateFlow']
  if (!isPlainObject(flow)) return false
  for (const value of Object.values(flow)) {
    if (!isStringArray(value)) return false
  }
  // DEV-43 可选段（docs/18-§2.1.1）：typeInbox/typeFlows/entities——在场才校形状
  const typeInbox = v['typeInbox']
  if (typeInbox !== undefined && typeInbox !== null) {
    if (!isPlainObject(typeInbox)) return false
    for (const value of Object.values(typeInbox)) {
      if (typeof value !== 'string') return false
    }
  }
  if (v['typeFlows'] !== undefined && v['typeFlows'] !== null && !isTypeFlowsRecord(v['typeFlows'])) return false
  const entities = v['entities']
  if (entities !== undefined && entities !== null) {
    if (!isPlainObject(entities)) return false
    for (const value of Object.values(entities)) {
      if (!isPlainObject(value) || !isStringArray(value['states'])) return false
    }
  }
  return true
}

/** 读当前 provision（未 provision 返回 null） */
export function readProvision(root: string): FieldProvisionMap | null {
  const file = readJson<FieldsFile>(fieldsPath(root), {})
  return isProvisionMap(file.provision) ? file.provision : null
}

/** provision 落盘：业务字段名 → 平台字段名 + 状态集 + 状态流（整体替换） */
export function provisionFields(root: string, map: FieldProvisionMap): void {
  if (!isProvisionMap(map)) {
    throw new LocalPlatformError('CONFIG_INVALID', 'bad-provision', 'provision 映射结构不合法（fields/states/stateFlow）')
  }
  writeJson(fieldsPath(root), { provision: map })
}

/** schema()：基础字段 + provision 声明的平台侧字段名（类型未知，统一标 string） */
export function fieldSchema(root: string): FieldSchema[] {
  const out: FieldSchema[] = BASE_SCHEMA.map((f) => ({ ...f }))
  const prov = readProvision(root)
  if (prov !== null) {
    for (const platName of Object.values(prov.fields)) {
      if (!out.some((f) => f.name === platName)) out.push({ name: platName, type: 'string' })
    }
  }
  return out
}
