/**
 * panel/authority —— 面板 authority 块（根授予无锚投影只读解析；studio-dev-707 段2）
 *
 * 依据：docs/v2/03 §3.1.1（无锚三态）、docs/v2/15 §7.3、docs/17-§2（无锚声明面）。
 *
 * 边界：只读 daemon_kv 投影 JSON；缺失/坏 JSON/坏 state→unknown+unavailable（不补 0、不显示绿）；
 * 不新增端点、不写事实源。从 views.ts 拆出（20-§十五.三 先拆后增：views 606>600 阈）。
 */
/** 根授予无锚三态（docs/v2/03 §3.1.1；面板只读；unknown=kv 缺失/坏 JSON，不显示绿） */
export type SnapshotAuthorityState = 'anchored' | 'unanchored-declared' | 'unanchored-undeclared' | 'unknown'

/** 面板 authority 块（studio-dev-707 段2；形状与 daemon `records.authority.view` 对齐；仅加法字段） */
export interface SnapshotAuthority {
  readonly state: SnapshotAuthorityState
  /** true=kv 缺失/坏 JSON（面板显示 unknown，不补 0/不显示绿） */
  readonly unavailable: boolean
  readonly declaration:
    | { readonly by: string; readonly reason: string; readonly until: string; readonly untilSoon: boolean }
    | null
  readonly rootGrant: { readonly expectedRecordId: string | null; readonly present: boolean; readonly count: number }
  readonly refusals: {
    readonly lastBoot: { readonly at: number | null; readonly counts: Readonly<Record<string, number>> }
    readonly total: Readonly<Record<string, number>>
  }
  readonly levelClaim: { readonly configured: number | null; readonly structural: string }
  readonly notice: string
  /** 不可用时的原因（不泄露敏感内容） */
  readonly reason?: string
}

/** 缺省 unknown 块（kv 缺失/坏 JSON；不伪造全绿） */
function unknownAuthority(reason: string): SnapshotAuthority {
  return {
    state: 'unknown',
    unavailable: true,
    declaration: null,
    rootGrant: { expectedRecordId: null, present: false, count: 0 },
    refusals: { lastBoot: { at: null, counts: {} }, total: {} },
    levelClaim: { configured: null, structural: 'CL2-unmet' },
    notice: '面板未取得 authority 投影（daemon 未启动/投影未写/坏 JSON）——不显示为绿',
    reason,
  }
}

/**
 * 读 daemon_kv `records.authority.view`（向后兼容：旧/测试 ledger 无 kvGet 面→null；读异常→null）。
 * 不写、不猜；null 由 buildAuthorityBlock 映射为 unknown（不显示绿）。
 */
export function readAuthorityRaw(ledger: unknown): string | null {
  const target = ledger as { kvGet?: (key: string) => string | null }
  if (typeof target.kvGet !== 'function') return null
  try {
    return target.kvGet('records.authority.view')
  } catch {
    return null
  }
}

const AUTHORITY_STATES: readonly SnapshotAuthorityState[] = ['anchored', 'unanchored-declared', 'unanchored-undeclared']

/** 只读解析 daemon_kv `records.authority.view`（纯函数；坏数据→unknown，不补 0/不显示绿） */
export function buildAuthorityBlock(raw: string | null): SnapshotAuthority {
  if (raw === null || raw === '') return unknownAuthority('kv-missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return unknownAuthority('kv-bad-json')
  }
  if (typeof parsed !== 'object' || parsed === null) return unknownAuthority('kv-not-object')
  const view = parsed as {
    state?: unknown
    declaration?: unknown
    rootGrant?: unknown
    refusals?: unknown
    levelClaim?: unknown
    notice?: unknown
  }
  if (typeof view.state !== 'string' || !(AUTHORITY_STATES as readonly string[]).includes(view.state)) {
    return unknownAuthority('kv-bad-state')
  }
  const declaration = ((): SnapshotAuthority['declaration'] => {
    if (typeof view.declaration !== 'object' || view.declaration === null) return null
    const d = view.declaration as { by?: unknown; reason?: unknown; until?: unknown; untilSoon?: unknown }
    if (typeof d.by !== 'string' || typeof d.until !== 'string') return null
    return {
      by: d.by,
      reason: typeof d.reason === 'string' ? d.reason : '',
      until: d.until,
      untilSoon: d.untilSoon === true,
    }
  })()
  const rootGrant = ((): SnapshotAuthority['rootGrant'] => {
    const raw = (typeof view.rootGrant === 'object' && view.rootGrant !== null ? view.rootGrant : {}) as {
      expectedRecordId?: unknown
      present?: unknown
      count?: unknown
    }
    return {
      expectedRecordId: typeof raw.expectedRecordId === 'string' ? raw.expectedRecordId : null,
      present: raw.present === true,
      count: typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count >= 0 ? raw.count : 0,
    }
  })()
  const refusals = ((): SnapshotAuthority['refusals'] => {
    const raw = (typeof view.refusals === 'object' && view.refusals !== null ? view.refusals : {}) as {
      lastBoot?: unknown
      total?: unknown
    }
    const readCounts = (value: unknown): Record<string, number> => {
      const out: Record<string, number> = {}
      if (typeof value === 'object' && value !== null) {
        for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
          if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out[key] = n
        }
      }
      return out
    }
    const lastBootRaw = (typeof raw.lastBoot === 'object' && raw.lastBoot !== null ? raw.lastBoot : {}) as {
      at?: unknown
      counts?: unknown
    }
    return {
      lastBoot: {
        at: typeof lastBootRaw.at === 'number' && Number.isFinite(lastBootRaw.at) ? lastBootRaw.at : null,
        counts: readCounts(lastBootRaw.counts),
      },
      total: readCounts(raw.total),
    }
  })()
  const levelClaim = ((): SnapshotAuthority['levelClaim'] => {
    const raw = (typeof view.levelClaim === 'object' && view.levelClaim !== null ? view.levelClaim : {}) as {
      configured?: unknown
      structural?: unknown
    }
    return {
      configured: typeof raw.configured === 'number' ? raw.configured : null,
      structural: typeof raw.structural === 'string' ? raw.structural : 'CL2-unmet',
    }
  })()
  return {
    state: view.state as SnapshotAuthorityState,
    unavailable: false,
    declaration,
    rootGrant,
    refusals,
    levelClaim,
    notice: typeof view.notice === 'string' ? view.notice : '含 G8 双角色拒写残余（ENG-0，另单）；声明不是授予',
  }
}
