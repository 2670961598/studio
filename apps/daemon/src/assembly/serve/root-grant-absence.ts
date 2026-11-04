/**
 * serve/root-grant-absence —— 根授予无锚「显式声明」配置面（studio-dev-707；#648 方案 c）
 *
 * 依据：docs/v2/03 §3.1.1（无锚公司与引导态；studio-dev-648/707）、docs/v2/15 §7.3（SEC-ROOT-02
 * 无锚装配态）、docs/v2/17 NEG-ORG-09a–d、docs/17-§2（无锚声明面）。
 *
 * 声明面＝daemon.yaml 三个扁平键（v0 只收扁平 `key: value`；与 #508 `reloadAnchorAbsence*`
 * **不同对象、不同键**——信任锚 ≠ 根授予，不得混用/互相代证）：
 *   recordRootGrantAbsenceDeclaredBy: <声明人：制作人/授权代理人>   # 出现即声明无锚
 *   recordRootGrantAbsenceReason:    <原因>                          # 必填
 *   recordRootGrantAbsenceUntil:     <YYYY-MM-DD>                    # 必填；UTC 零点到期
 *
 * 纪律（fail-closed，一律 CONFIG_INVALID 明报不猜）：
 *   - 三键必须**成对**（缺任一 → 拒；只给部分＝未声明，不得静默放行）；
 *   - 声明人/原因非空、声明人 ≤200 字；
 *   - Until 必须是真日历日（YYYY-MM-DD）；已过期（< 今日 UTC）→ 拒；
 *   - 声明只在 companyDir 给定时生效（无公司目录＝无消费面）；
 *   - 声明本身不是授予/外部事实：本件只解析配置；与真实 rootGrant/已落库 REC-AUTH-01 的
 *     冲突判定在启动状态机（root-grant-absence-state.ts）做，同样 CONFIG_INVALID 拒启。
 */
import { configInvalid } from '@studio-next/contract'

/** 声明人长度上限（防把整段说明塞进台账单行字段） */
export const ROOT_GRANT_ABSENCE_DECLARED_BY_MAX = 200

/** 到期前告警窗口（天；docs/v2/03 §3.1.1「有期限」） */
export const ROOT_GRANT_ABSENCE_WARN_DAYS = 14

/** daemon.yaml 三键原文（coerceServeConfig 循环内收集，循环后一次收口） */
export interface RootGrantAbsenceRaw {
  declaredBy?: string
  reason?: string
  until?: string
}

/** 解析后的无锚声明（口径版本随 docs/v2/03 §3.1.1 冻结；改字段=改文档） */
export interface RootGrantAbsenceDeclaration {
  readonly declaredBy: string
  readonly reason: string
  /** YYYY-MM-DD（UTC 零点到期） */
  readonly until: string
}

/** YYYY-MM-DD 且为真日历日（UTC 口径；闰年合法） */
export function isValidIsoDateUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
}

/** 当日 UTC 零点（ms；now 注入便于确定性测试） */
export function utcDayStart(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Until → UTC 零点 ms（调用方先验 isValidIsoDateUtc） */
export function untilDayStart(until: string): number {
  const [yearText, monthText, dayText] = until.split('-')
  return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))
}

/** 到期状态：expired（<今日 UTC）/ expiring（≤14 天）/ active */
export function rootGrantAbsenceUntilStatus(
  until: string,
  now: number,
): 'active' | 'expiring' | 'expired' {
  const today = utcDayStart(now)
  const end = untilDayStart(until)
  if (end < today) return 'expired'
  if (end - today <= ROOT_GRANT_ABSENCE_WARN_DAYS * 24 * 60 * 60 * 1000) return 'expiring'
  return 'active'
}

/**
 * 三键 → 装配声明。undefined＝未声明（无锚仍拒，fail-closed 保持）。
 * 任一非法＝CONFIG_INVALID（构造期拒启；错误只报键名/原因，不回显敏感值）。
 */
export function coerceRootGrantAbsenceDeclaration(
  raw: RootGrantAbsenceRaw,
  ctx: { readonly companyDir: string | undefined; readonly now?: () => number },
): RootGrantAbsenceDeclaration | undefined {
  const declaredBy = (raw.declaredBy ?? '').trim()
  const reason = (raw.reason ?? '').trim()
  const until = (raw.until ?? '').trim()
  const anyPresent = declaredBy !== '' || reason !== '' || until !== ''
  if (!anyPresent) return undefined
  const missing: string[] = []
  if (declaredBy === '') missing.push('recordRootGrantAbsenceDeclaredBy')
  if (reason === '') missing.push('recordRootGrantAbsenceReason')
  if (until === '') missing.push('recordRootGrantAbsenceUntil')
  if (missing.length > 0) {
    throw configInvalid(
      'serve/root-grant-absence:incomplete',
      `daemon.yaml：无锚声明三键必须成对（缺 ${missing.join('/')}）——只给部分＝未声明，不得静默放行（docs/v2/03 §3.1.1）`,
    )
  }
  if (declaredBy.length > ROOT_GRANT_ABSENCE_DECLARED_BY_MAX) {
    throw configInvalid(
      'serve/root-grant-absence:declared-by-too-long',
      `daemon.yaml：recordRootGrantAbsenceDeclaredBy 超长（${String(declaredBy.length)} > ${String(ROOT_GRANT_ABSENCE_DECLARED_BY_MAX)}）`,
    )
  }
  if (!isValidIsoDateUtc(until)) {
    throw configInvalid(
      'serve/root-grant-absence:until-invalid',
      'daemon.yaml：recordRootGrantAbsenceUntil 须为真日历日 YYYY-MM-DD（UTC 口径；拒绝非日期/不存在的日期）',
    )
  }
  const now = ctx.now?.() ?? Date.now()
  if (rootGrantAbsenceUntilStatus(until, now) === 'expired') {
    throw configInvalid(
      'serve/root-grant-absence:until-expired',
      `daemon.yaml：recordRootGrantAbsenceUntil 已过期（${until} < 今日 UTC）——无锚声明不得无限期降级/静默续期（docs/v2/03 §3.1.1）`,
    )
  }
  if (ctx.companyDir === undefined) {
    throw configInvalid(
      'serve/root-grant-absence:no-company-dir',
      'daemon.yaml：无锚声明只在 companyDir 给定时生效（无公司目录＝无消费面）',
    )
  }
  return { declaredBy, reason, until }
}
