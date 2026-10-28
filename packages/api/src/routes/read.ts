/**
 * packages/api/src/routes/read.ts —— 只读族共用装载器（公司维隔离＋读上下文＋白名单面）
 *
 * 依据：docs/v2/14 §四（读面同源 PORT-OBS 投影/只读台账视图；?company= 读写同一解析
 * 规则）；docs/v2/15 §五 SEC-RD-01（readScope/caller 随读必带）、§三 SEC-WD-01（跨
 * 公司读隔离）。
 *
 * 纪律：
 *   - 先过公司维闸，再调读源；读源返回别的公司维＝503（不服务、不泄漏别家数据）。
 *   - 读源形状坏（必填槽缺失/类型错）＝503 view-shape-invalid——不猜、不补默认值。
 *   - 本件只做装载/公司维校验，不做字段序列化（白名单投影在各端点文件里逐字段显式构造）。
 */
import type { CompanyRef, ReadContext } from '@studio-next/contract'
import type { ApiHttpContext } from '../http.ts'
import {
  checkViewCompany,
  companyMatches,
  readContextFor,
  sourceCompanyMismatch,
  viewUnavailable,
} from '../http.ts'
import type { ApiRouteDeps } from '../types.ts'

/** 单视图装载结果（失败已带响应） */
export type ScopedViewResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response }

/** 带公司维的单视图装载（undefined→503；公司维不符/缺失→503；读源抛错→走 onError 500） */
export function loadScopedView<T extends { readonly company: string }>(
  c: ApiHttpContext,
  deps: Pick<ApiRouteDeps, 'company'>,
  view: string,
  fields: readonly [string, ...string[]],
  purpose: string,
  load: (rc: ReadContext) => T | undefined,
): ScopedViewResult<T> {
  const loaded = load(readContextFor(deps, fields, purpose))
  if (loaded === undefined) return { ok: false, response: viewUnavailable(c, view, '读源未提供该视图投影') }
  const check = checkViewCompany(loaded.company, deps.company)
  if (check !== 'ok') return { ok: false, response: sourceCompanyMismatch(c, view, check) }
  return { ok: true, value: loaded }
}

/** 集合行公司维过滤：只保留同维行（缺公司维/别家行一律丢弃——fail-closed 不过滤成空响应） */
export function scopeRows<T>(rows: readonly T[], mounted: CompanyRef): T[] {
  return rows.filter((row) => {
    if (typeof row !== 'object' || row === null) return false
    const company = (row as { readonly company?: unknown }).company
    return companyMatches(company, mounted)
  })
}

/** 数组槽守卫（读源形状坏＝503，不把非数组当空数组静默吞掉） */
export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}
