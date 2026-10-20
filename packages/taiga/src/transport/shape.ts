/**
 * 手写窄校验 —— 零 npm 依赖的响应形状守卫（本包零新依赖纪律：不引 zod）。
 *
 * 各面自带 parse 函数（只校验适配器消费的字段，未建模字段透传丢弃），
 * 形状漂移统一抛 CONFIG_INVALID/unexpected-response-shape（版本漂移要明报，
 * 对齐 yt 的 zod 拦截面）。证据形状：docs/32 真机探针 + /tmp/taiga-probe 实录。
 */
import { TaigaPlatformError } from './errors.ts'

export type Raw = Record<string, unknown>

function fail(ctx: string, detail: string): never {
  throw new TaigaPlatformError('CONFIG_INVALID', 'unexpected-response-shape', `响应形状漂移（${ctx}）：${detail}`)
}

export function asObject(v: unknown, ctx: string): Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(ctx, '期望对象')
  return v as Raw
}

export function asArray(v: unknown, ctx: string): unknown[] {
  if (!Array.isArray(v)) fail(ctx, '期望数组')
  return v
}

export function reqString(o: Raw, k: string, ctx: string): string {
  const v = o[k]
  if (typeof v !== 'string') fail(ctx, `${k} 应为 string`)
  return v
}

export function optString(o: Raw, k: string): string | undefined {
  const v = o[k]
  return typeof v === 'string' ? v : undefined
}

/** Taiga 可空字符串（如 description: null）→ undefined */
export function optStringNull(o: Raw, k: string): string | undefined {
  const v = o[k]
  return typeof v === 'string' ? v : undefined
}

export function reqNumber(o: Raw, k: string, ctx: string): number {
  const v = o[k]
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(ctx, `${k} 应为 number`)
  return v
}

export function optNumber(o: Raw, k: string): number | undefined {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function optBoolean(o: Raw, k: string): boolean | undefined {
  const v = o[k]
  return typeof v === 'boolean' ? v : undefined
}

/** 可空 number（assigned_to: null 等）→ undefined */
export function optNumberNull(o: Raw, k: string): number | undefined {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function reqObject(o: Raw, k: string, ctx: string): Raw {
  return asObject(o[k], `${ctx}.${k}`)
}

export function optObject(o: Raw, k: string): Raw | undefined {
  const v = o[k]
  if (v === undefined || v === null) return undefined
  return asObject(v, k)
}

/** custom_attributes_values: null | {attrId: string|number} */
export function optAttrValues(o: Raw, k: string): Record<string, string> | undefined {
  const v = o[k]
  if (v === undefined || v === null) return undefined
  const obj = asObject(v, k)
  const out: Record<string, string> = {}
  for (const [attrId, value] of Object.entries(obj)) {
    out[attrId] = typeof value === 'string' ? value : String(value)
  }
  return out
}
