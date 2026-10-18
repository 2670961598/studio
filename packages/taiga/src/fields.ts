/**
 * 字段面（读）—— 状态集 + 自定义属性集的真实反射（docs/30 §6 ⑤⑥ 的读面）。
 *
 * schema()：基础维（端口固有字段）+ state 枚举（真源=平台状态集，名字序稳定）+
 *   自定义属性（真源=平台属性集）。Taiga 属性类型 → 端口类型映射：
 *   text/url→string、number→int、date→date、multiline/richtext→text
 *
 * provision()：**本切片显式未实现**（写面本轮只做 issues+comments，任务书边界）。
 *   落地路径已定：docs/30 §6 ②⑥（POST /{entity}-statuses、POST /{entity}-
 *   custom-attributes，幂等基线=先 GET 按名找、找到即复用）——onboard 切片实施。
 */
import type { FieldSchema } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { notImplemented } from './errors.ts'

const BASE_SCHEMA: readonly FieldSchema[] = [
  { name: 'title', type: 'string' },
  { name: 'description', type: 'text' },
  { name: 'state', type: 'string' }, // 下方以真源枚举覆盖
  { name: 'assignee', type: 'string' },
]

function attrTypeToPort(t: string): FieldSchema['type'] {
  if (t === 'number') return 'int'
  if (t === 'date') return 'date'
  if (t === 'multiline' || t === 'richtext') return 'text'
  return 'string' // text / url / 未知
}

export async function fieldSchema(ctx: TaigaContext): Promise<FieldSchema[]> {
  const statuses = await ctx.statuses()
  const attributes = await ctx.attributes()
  const out: FieldSchema[] = []
  for (const base of BASE_SCHEMA) {
    if (base.name === 'state') {
      out.push({ name: 'state', type: 'enum', values: [...statuses].sort((a, b) => a.id - b.id).map((s) => s.name) })
    } else {
      out.push({ ...base })
    }
  }
  for (const attr of [...attributes].sort((a, b) => a.id - b.id)) {
    out.push({ name: attr.name, type: attrTypeToPort(attr.type) })
  }
  return out
}

export async function provisionFields(_map: unknown): Promise<void> {
  throw notImplemented(
    'provision',
    '写面本切片只做 issues+comments；落地路径=docs/30 §6 ②⑥（状态集/自定义属性按名幂等建）',
  )
}
