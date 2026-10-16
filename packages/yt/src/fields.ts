/**
 * 字段面 —— customFieldSettings admin API（薄壳，docs/23-§一 / N10 工作面）
 *
 * v0 口径（任务定调「薄壳+TODO」，缺口明报不静默）：
 *   - schema()：内建（title/description）+ 当前绑定映射的平台字段名（类型取声明）
 *     ∪ 实例 live 字段（GET /api/admin/customFieldSettings/customFields，
 *     presentation 粗映射 enum/int/string——精确类型建模留 TODO）
 *   - provision(map)：运行时校验 + **实例内热换绑**（后续读写即刻用新映射）；
 *     平台侧真正建字段/挂字段/bundle provisioning（N10 onboard 工作面）**未做**，
 *     是显式缺口——独立单落地，本方法不谎报平台已 provision
 */
import { z } from 'zod'
import type { FieldProvisionMap, FieldSchema } from '@studio-next/contract'
import type { FieldTranslator } from './fieldmap.ts'
import type { YtHttpClient } from './http.ts'

const adminFieldSchema = z.looseObject({
  name: z.string().optional(),
  fieldType: z.looseObject({ presentation: z.string().optional() }).optional(),
})

/** fieldType.presentation → FieldSchema.type 粗映射（v0） */
function presentationToType(presentation: string | undefined): FieldSchema['type'] {
  const p = presentation ?? ''
  if (p.includes('enum') || p.includes('bundle') || p.includes('state')) return 'enum'
  if (p.includes('integer') || p.includes('int')) return 'int'
  return 'string'
}

export async function fieldSchema(http: YtHttpClient, tr: FieldTranslator): Promise<FieldSchema[]> {
  const out: FieldSchema[] = [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'text' },
  ]
  const names = new Set(out.map((f) => f.name))
  for (const [business, platform] of Object.entries(tr.snapshot().fields)) {
    if (!names.has(platform)) {
      out.push({ name: platform, type: tr.typeOf(business) })
      names.add(platform)
    }
  }
  const live = await http.request(z.array(adminFieldSchema), {
    method: 'GET',
    path: '/api/admin/customFieldSettings/customFields',
    query: { fields: 'name,fieldType(presentation)', $top: '100', $skip: '0' },
  })
  for (const f of live) {
    if (f.name !== undefined && !names.has(f.name)) {
      out.push({ name: f.name, type: presentationToType(f.fieldType?.presentation) })
      names.add(f.name)
    }
  }
  return out
}

/**
 * TODO(独立单)：平台侧字段 provisioning——按 FieldProvisionMap 建/挂 customField、
 * state bundle 加值（值只增不删，N5）走 N10 onboard 工作面；v0 仅热换绑实例内映射。
 */
export function provisionFields(tr: FieldTranslator, map: FieldProvisionMap): void {
  tr.rebind(map)
}
