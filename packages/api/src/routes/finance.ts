/**
 * API-06 GET /v1/finance —— 财务三源摘要（预算／事件／月报）
 *
 * 依据：docs/v2/14 §四（信息面；finance 三源缺一=unknown 段不补 0）；docs/v2/15
 * §三 SEC-WD-01（跨公司读隔离）；docs/v2/08 §4.1（未知不显示为零/空/绿）。
 *
 * 行为：三源（budget/events/monthly）逐段列示。读源缺某源＝该段 unknown，**没有 value
 * 槽**（不补 0）；unknown/stale/conflicted/gapped 段若携 value＝wiring 形状错，503
 * 不服务（不给「未知但有个数」留口）。金额为 0 只在 observed/derived 时合法。
 */
import { Hono } from 'hono'
import { PROJECTION_STATES } from '@studio-next/contract'
import type { ProjectionState } from '@studio-next/contract'
import type { ApiEnv, ApiFinanceSegment, ApiFinanceSource, ApiFinanceView, ApiRouteDeps } from '../types.ts'
import { FINANCE_SOURCES } from '../types.ts'
import { isFiniteNumber, isNonEmptyString, nowIso, resolveCompanyDimension, viewShapeInvalid } from '../http.ts'
import { asArray, loadScopedView } from './read.ts'

/** 有数值槽的两态（与 PORT-OBS `MetricReading` 同判据） */
function stateHasValue(state: ProjectionState): boolean {
  return state === 'observed' || state === 'derived'
}

type PickedSegment =
  | { readonly ok: true; readonly source: ApiFinanceSource; readonly segment: ApiFinanceSegment }
  | { readonly ok: false; readonly detail: string }

/** 单账段白名单投影＋未知不补 0 判据 */
function pickSegment(value: unknown): PickedSegment {
  if (typeof value !== 'object' || value === null) return { ok: false, detail: '账段须为对象' }
  const row = value as Record<string, unknown>
  const source = row['source']
  if (typeof source !== 'string' || !(FINANCE_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, detail: `账段 source 非法：${String(source)}（只收 ${FINANCE_SOURCES.join('/')}）` }
  }
  const state = row['state']
  if (typeof state !== 'string' || !(PROJECTION_STATES as readonly string[]).includes(state)) {
    return { ok: false, detail: `账段 state 非法：${String(state)}` }
  }
  const typedState = state as ProjectionState
  const rawValue = row['value']
  const unit = row['unit']
  const stateNote = row['stateNote']
  const lastTrustedCursor = row['lastTrustedCursor']

  if (stateHasValue(typedState)) {
    if (!isFiniteNumber(rawValue)) {
      return { ok: false, detail: `${source}: ${typedState} 段必须携有限数值（observed/derived 无值＝形状错）` }
    }
    return {
      ok: true,
      source: source as ApiFinanceSource,
      segment: {
        source: source as ApiFinanceSource,
        state: typedState,
        value: rawValue,
        ...(isNonEmptyString(unit) ? { unit } : {}),
        ...(isNonEmptyString(stateNote) ? { stateNote } : {}),
        ...(isNonEmptyString(lastTrustedCursor) ? { lastTrustedCursor } : {}),
      },
    }
  }

  // 未知四态：不得携 value（未知不补 0；也不留「未知但有个数」的口）
  if (rawValue !== undefined) {
    return { ok: false, detail: `${source}: ${typedState} 段不得携 value（未知不显示为零/数）` }
  }
  return {
    ok: true,
    source: source as ApiFinanceSource,
    segment: {
      source: source as ApiFinanceSource,
      state: typedState,
      ...(isNonEmptyString(unit) ? { unit } : {}),
      ...(isNonEmptyString(stateNote) ? { stateNote } : {}),
      ...(isNonEmptyString(lastTrustedCursor) ? { lastTrustedCursor } : {}),
    },
  }
}

/** 缺源段（unknown，无 value 槽——不补 0） */
function missingSegment(source: ApiFinanceSource): ApiFinanceSegment {
  return { source, state: 'unknown', stateNote: '源缺失：unknown（不补 0）' }
}

export function createFinanceRoute(deps: ApiRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.get('/v1/finance', (c) => {
    const resolved = resolveCompanyDimension(c, deps)
    if (!resolved.ok) return resolved.response

    const loaded = loadScopedView(
      c,
      deps,
      'finance',
      ['finance.summary'],
      'external-api-finance',
      (rc) => deps.readers.finance(rc),
    )
    if (!loaded.ok) return loaded.response
    const view = loaded.value

    if (!isNonEmptyString(view.currency)) return viewShapeInvalid(c, 'finance', 'currency 须为非空字符串')
    if (typeof view.window !== 'object' || view.window === null) {
      return viewShapeInvalid(c, 'finance', 'window 须为 {from,to}')
    }
    const window = view.window as { readonly from?: unknown; readonly to?: unknown }
    if (!isNonEmptyString(window.from) || !isNonEmptyString(window.to)) {
      return viewShapeInvalid(c, 'finance', 'window.from/to 须为非空字符串')
    }
    const rawSegments = asArray(view.segments)
    if (rawSegments === undefined) return viewShapeInvalid(c, 'finance', 'segments 须为数组')

    const bySource = new Map<ApiFinanceSource, ApiFinanceSegment>()
    for (const row of rawSegments) {
      const picked = pickSegment(row)
      if (!picked.ok) return viewShapeInvalid(c, 'finance', picked.detail)
      if (bySource.has(picked.source)) {
        return viewShapeInvalid(c, 'finance', `账段 source 重复：${picked.source}`)
      }
      bySource.set(picked.source, picked.segment)
    }

    // 三源恒列示：缺源＝unknown 段（无 value），不补 0
    const segments = FINANCE_SOURCES.map((source) => bySource.get(source) ?? missingSegment(source))
    const finance: ApiFinanceView = {
      company: deps.company.slug,
      currency: view.currency,
      window: { from: window.from, to: window.to },
      segments,
    }
    return c.json({ ok: true, finance, generatedAt: nowIso(deps), readOnly: true })
  })

  return app
}
