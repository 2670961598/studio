/**
 * 字段面（读+provision 写）—— 状态集 + 自定义属性集（docs/30 §6 ②⑥）。
 *
 * schema()：基础维（端口固有字段）+ state 枚举（真源=平台状态集，名字序稳定）+
 *   自定义属性（真源=平台属性集）。Taiga 属性类型 → 端口类型映射：
 *   text/url→string、number→int、date→date、multiline/richtext→text
 *
 * provision()（onboard 写面三件之一，2026-10-19 落地）：
 *   - 幂等基线 = docs/30 §6「全部资源先 GET 按名找、找到即 diff-复用，缺则建」；
 *     重名直接 POST 是 400（真机证据 P81/P84：Duplicated name / Already exists one
 *     with the same name）——判重必须在客户端做，不靠平台报错兜底
 *   - 状态集：map.states 逐名比对现有集，缺则 POST /{statuses} {project, name}
 *     （真机 201，P80；多余未知字段平台静默忽略）
 *   - 自定义属性：map.fields 的**平台名**逐名比对，缺则 POST /{attributes}
 *     {project, name, type}（type 参数生效，P83）；同名已存在则类型相容即复用
 *     （enum 归一为 string 比对——Taiga 属性无枚举约束，落 text）；类型冲突显式报错
 *     不静默（attribute-type-mismatch）
 *   - **值写入与 provision 无关**：FieldProvisionMap 不携值；单据上的值写入走
 *     issues.setField/create 的专用值端点（docs/32 §七修正正解：先 GET 值对象取其
 *     自身 version，再 PATCH {attributes_values, version}——见 context.patchAttrValues）
 *   - stateFlow **不落平台**：Taiga 无转换矩阵（docs/30 §3.1 C5），转换闸由框架
 *     guard 全责（§6 守闸补偿——禁止平台侧手配，本就无处置）；map 里的 stateFlow
 *     仅供框架侧消费，本面不校验不安装
 *   - provision 完成后作废实例缓存（invalidateMeta），schema() 立即反映新档
 */
import type { FieldProvisionMap, FieldSchema } from '@studio-next/contract'
import type { TaigaContext } from './transport/context.ts'
import { ENTITY_DESCRIPTORS, entityDescriptor } from './transport/entities.ts'
import type { TaigaEntity } from './transport/entities.ts'
import { TaigaPlatformError } from './transport/errors.ts'
import { asArray, asObject, reqString } from './transport/shape.ts'
import type { PortFieldType } from './fieldmap.ts'
import { PORT_TYPES } from './fieldmap.ts'

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

/** 端口字段类型 → Taiga 属性建档类型（enum 无平台约束，落 text） */
function portTypeToTaiga(t: PortFieldType): string {
  if (t === 'int') return 'number'
  if (t === 'date') return 'date'
  if (t === 'text') return 'multiline'
  return 'text' // string / enum
}

/** 类型相容比对口径：enum 归一为 string（保证 enum 重入 provision 幂等） */
function canonicalType(t: PortFieldType): PortFieldType {
  return t === 'enum' ? 'string' : t
}

function isPlainStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => typeof x === 'string' && x.trim() !== '')
}

function isPortTypeRecord(v: unknown): v is Record<string, PortFieldType> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => (PORT_TYPES as readonly string[]).includes(x as string))
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
}

function isStringArrayRecord(v: unknown): v is Record<string, string[]> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => isStringArray(x))
}

/** 类型状态流形状：type id →「状态→string[]」（DEV-43） */
function isTypeFlowsRecord(v: unknown): v is Record<string, Record<string, string[]>> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => isStringArrayRecord(x))
}

/** 实体档案形状：entity → {states: string[]}（DEV-43） */
function isEntitiesRecord(v: unknown): v is Record<string, { states: string[] }> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.entries(v).every(([k, x]) => {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
    if (!(k in ENTITY_DESCRIPTORS)) return false // 值域闸（docs/51 W-7：枚举在平台侧 provision）
    return isStringArray((x as { states?: unknown }).states)
  })
}

/** provision 映射形状校验（与 localplatform isProvisionMap 同口径 + 类型枚举校验；factory.ts 出厂态根治三步共用=单一来源） */
export function validateProvisionMap(map: FieldProvisionMap): void {
  if (typeof map !== 'object' || map === null) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision 映射必须是对象（fields/states/stateFlow）')
  }
  if (!isPlainStringRecord(map.fields)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision.fields 必须是「业务字段名→平台属性名」且值非空')
  }
  if (map.types !== undefined && !isPortTypeRecord(map.types)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', `provision.types 值必须属于 ${PORT_TYPES.join('|')}`)
  }
  if (!isStringArray(map.states)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision.states 必须是非空字符串数组')
  }
  if (map.stateFlow !== undefined && !isStringArrayRecord(map.stateFlow)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision.stateFlow 必须是「状态→string[]」')
  }
  if (map.typeInbox !== undefined && !isPlainStringRecord(map.typeInbox)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision.typeInbox 必须是「类型 id→收件状态名」且值非空（DEV-43）')
  }
  if (map.typeFlows !== undefined && !isTypeFlowsRecord(map.typeFlows)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', 'provision.typeFlows 必须是「类型 id→{状态→string[]}」（DEV-43）')
  }
  if (map.entities !== undefined && !isEntitiesRecord(map.entities)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-provision-map', `provision.entities 必须是「实体→{states}」且实体∈${(Object.keys(ENTITY_DESCRIPTORS) as TaigaEntity[]).join('|')}（DEV-43，docs/51 W-7 值域闸）`)
  }
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

/**
 * POST 400 读回验证吸收（studio-dev-126 T3，B 轴幂等收口）：provision 的建档 POST
 * 在并发 TOCTOU 窗口（两写者同拍 GET 判重 miss → 都 POST → 后到者吃 400 重名拒收）
 * 收敛为**幂等成功**而非误报 CONFIG_INVALID。判据零文案耦合——真机实测重名 400 文案
 * 至少两种（statuses=「Duplicated name」/attributes=「Already exists one with the
 * same name.」，docs/32-§九 S3-②），只认 http.ts mapStatusToError 的 400 统一归口
 * （CONFIG_INVALID×bad-request）+ **读回在场**；读回不在场=真 400（体形状坏等），
 * 原错误如实再抛——吸收面只吃「并发窗口已收敛」这一件事，不吞真错。
 */
async function postOrAbsorbDuplicate(
  ctx: TaigaContext,
  path: string,
  body: Record<string, unknown>,
  existsAfter: () => Promise<boolean>,
): Promise<void> {
  try {
    await ctx.client.request({ method: 'POST', path, body })
  } catch (err) {
    if (!(err instanceof TaigaPlatformError)) throw err
    if (err.category !== 'CONFIG_INVALID' || err.subcause !== 'bad-request') throw err
    if (!(await existsAfter())) throw err
  }
}

export async function provisionFields(ctx: TaigaContext, map: FieldProvisionMap): Promise<void> {
  validateProvisionMap(map)
  ctx.invalidateMeta() // 判重前作废缓存：以平台现值为准（上次 provision/他人改动都要看见）
  const projectId = await ctx.project()

  // —— 状态集：先 GET 按名找，缺则建（docs/30 §6 幂等基线）——
  const haveStatus = new Set((await ctx.statuses()).map((s) => s.name))
  for (const name of map.states) {
    if (haveStatus.has(name)) continue
    await postOrAbsorbDuplicate(ctx, `/${ctx.desc.statuses}`, { project: projectId, name }, async () => {
      ctx.invalidateMeta() // 读回必须真源：判重缓存可能正落后于并发写者
      return (await ctx.statuses()).some((s) => s.name === name)
    })
    haveStatus.add(name)
  }

  // —— 实体档案状态集（DEV-43，docs/18-§2.1.1）：entity 映射类型的状态建到对应实体
  //    工作流（多实体档案面；值域闸已在 validateProvisionMap——W-7）。判重同幂等基线：
  //    GET /{statuses}?project 按名找，缺则 POST。绑定实体的档案走同一端点（缓存由
  //    末尾 invalidateMeta 统一作废）。typeInbox/typeFlows 不落平台（Taiga 无转换矩阵，
  //    与 stateFlow 同口径——框架 guard 消费）。
  for (const [entity, profile] of Object.entries(map.entities ?? {})) {
    const d = entityDescriptor(entity as TaigaEntity)
    const res = await ctx.client.request({ method: 'GET', path: `/${d.statuses}`, query: { project: String(projectId) } })
    const have = new Set(
      asArray(res.json, d.statuses).map((x) => reqString(asObject(x, d.statuses), 'name', d.statuses)),
    )
    for (const name of profile.states) {
      if (have.has(name)) continue
      await postOrAbsorbDuplicate(ctx, `/${d.statuses}`, { project: projectId, name }, async () => {
        // 实体状态集无实例缓存（逐次真读，factory statusListOf 同源）——直接重 GET
        const r = await ctx.client.request({ method: 'GET', path: `/${d.statuses}`, query: { project: String(projectId) } })
        return asArray(r.json, d.statuses).some((x) => reqString(asObject(x, d.statuses), 'name', d.statuses) === name)
      })
      have.add(name)
    }
  }

  // —— 自定义属性：平台名判重，缺则建；同名类型相容即复用 ——
  const haveAttr = new Map((await ctx.attributes()).map((a) => [a.name, a] as const))
  for (const [business, platform] of Object.entries(map.fields)) {
    const wanted = map.types?.[business] ?? 'string'
    const existing = haveAttr.get(platform)
    if (existing !== undefined) {
      if (attrTypeToPort(existing.type) !== canonicalType(wanted)) {
        throw new TaigaPlatformError(
          'CONFIG_INVALID',
          'attribute-type-mismatch',
          `自定义属性「${platform}」已存在但类型不符：平台 ${existing.type}（端口 ${attrTypeToPort(existing.type)}）≠ 声明 ${wanted}；值只增不删，请改映射名或先人工处置旧档`,
        )
      }
      continue
    }
    await postOrAbsorbDuplicate(ctx, `/${ctx.desc.attributes}`, { project: projectId, name: platform, type: portTypeToTaiga(wanted) }, async () => {
      ctx.invalidateMeta() // 读回必须真源（同 states 位理由）
      return (await ctx.attributes()).some((a) => a.name === platform)
    })
    haveAttr.set(platform, { id: -1, name: platform, type: portTypeToTaiga(wanted) }) // 本轮判重（幂等：同名映射两业务字段只建一次）
  }

  ctx.invalidateMeta() // 建档后作废缓存：schema() 立即反映新档
}
