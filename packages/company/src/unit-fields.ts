/**
 * 一级单元字段级承载（GAP-V2-17；docs/v2/10 §4.3 SCH-ORG-01、docs/v2/06 §5.2/§5.3）。
 *
 * 本件是 `org-config.yaml` 的**结构闸**（validator 接线），不是投影：只判字段形状与引用
 * 完整性，不产出组织事实；域重叠/单元缺位等结构语义仍由纯投影（projection/units.ts）
 * 给出。拆分依据：validator.ts 已 >600 行（MIG-05 拆分母，只减不增），故规则体落本件，
 * validator 只留一行 spread＋一行调用。
 *
 * 字段（SCH-ORG-01；`unitCount`/`units[]` 可选——缺省=N=1 隐式单元）：
 *   - `unitCount`：整数 ≥1，缺省 1；声明 `units[]` 时必须等于 `units.length`。
 *     只声明 `unitCount>1` 而无 `units[]`＝无法表达各单元域→拒（不猜不补）。
 *   - `units[]`：`unitId`（非空、唯一）/`domain`（非空 token 数组、单元内不重、跨单元不重叠）/
 *     `headRef`（工号或 null；非 null 须在 people 索引）/`vacancyState`（`staffed`|`head-vacant`，
 *     值集 ENU-140）/`reviewAt`（ISO 8601；`head-vacant` 时必填——空编静默=违规）。
 *   - N=1 且 `headRef:null`、`vacancyState` 缺省＝单人退化默认形态（最高宰相直管，不是空编）。
 */
import { z } from 'zod'
import type { DirectoryIssue } from '@studio-next/contract'
import { ISO_8601_RE } from './iso8601.ts'
import { lineOfPath } from './multifile.ts'

/** 单元空编态（ENU-140；只增不改义；值集单一实现 src/unit-vocab.ts）。 */
export { UNIT_VACANCY_STATES } from './unit-vocab.ts'
export type { UnitVacancyState } from './unit-vocab.ts'
import { UNIT_VACANCY_STATES } from './unit-vocab.ts'

/** `units[]` 条目形状（strictObject：未知键拒收，与 departments/people 同纪律）。 */
export const OrgUnitSchema = z.strictObject({
  unitId: z.string().min(1),
  domain: z.array(z.string().min(1)).min(1),
  headRef: z.string().min(1).nullable(),
  vacancyState: z.enum(UNIT_VACANCY_STATES).optional(),
  reviewAt: z
    .string()
    .min(1)
    .refine((s) => ISO_8601_RE.test(s), { message: 'reviewAt 须为 ISO 8601（日期或带时区偏移的日期时刻）' })
    .nullable()
    .optional(),
})

/** 挂在 OrgConfigSchema 上的字段（spread 接线；validator 不复制形状）。 */
export const UNIT_FIELDS = {
  /** N 一级单元数量（≥1，默认 1；声明 units[] 时必须等于其长度） */
  unitCount: z.number().int().min(1).optional(),
  /** 一级单元声明（缺省=N=1 隐式单元；显式空数组=拒，不猜默认 1） */
  units: z.array(OrgUnitSchema).optional(),
} as const

/** 交叉规则输入（只取本件需要的已解析面；不 import OrgConfig 值，避免运行时环）。 */
export interface UnitFieldSubject {
  unitCount?: number | undefined
  units?: ReadonlyArray<z.infer<typeof OrgUnitSchema>> | undefined
  people: ReadonlyArray<{ id: string }>
}

const ORG_CONFIG_FILE = 'org-config.yaml'

function issue(
  _doc: Parameters<typeof lineOfPath>[0],
  _lc: Parameters<typeof lineOfPath>[1],
  line: number,
  rule: string,
  fix: string,
): DirectoryIssue {
  return { file: ORG_CONFIG_FILE, line, rule, fix }
}

/**
 * 单元字段交叉规则（结构合法≠内容同款；这里只判 docs/v2/10 §4.3 明写的字段约束）。
 * 行号定位沿 lineOfPath（与其它 org-config 规则同口径）。
 */
export function unitCrossRules(
  doc: Parameters<typeof lineOfPath>[0],
  lc: Parameters<typeof lineOfPath>[1],
  org: UnitFieldSubject,
): DirectoryIssue[] {
  const out: DirectoryIssue[] = []
  const units = org.units
  if (units === undefined) {
    if (org.unitCount !== undefined && org.unitCount !== 1) {
      out.push(
        issue(
          doc,
          lc,
          lineOfPath(doc, lc, ['unitCount']),
          'org-config/unit-count-mismatch',
          `unitCount=${org.unitCount} 但未声明 units[]——N>1 必须逐单元给出 unitId/domain（不猜不补）`,
        ),
      )
    }
    return out
  }
  if (units.length === 0) {
    out.push(
      issue(
        doc,
        lc,
        lineOfPath(doc, lc, ['units']),
        'org-config/unit-count-mismatch',
        'units 显式声明为空——一级单元 N≥1（默认 1；空声明不猜成默认 1）',
      ),
    )
    return out
  }
  if (org.unitCount !== undefined && org.unitCount !== units.length) {
    out.push(
      issue(
        doc,
        lc,
        lineOfPath(doc, lc, ['unitCount']),
        'org-config/unit-count-mismatch',
        `unitCount=${org.unitCount} 与 units.length=${units.length} 不符——两口径必须相等`,
      ),
    )
  }

  const peopleIds = new Set(org.people.map((p) => p.id))
  const seenUnitIds = new Set<string>()
  const domainOwner = new Map<string, string>()
  units.forEach((unit, i) => {
    if (seenUnitIds.has(unit.unitId)) {
      out.push(
        issue(doc, lc, lineOfPath(doc, lc, ['units', i, 'unitId']), 'org-config/unit-id-duplicate', `unitId ${unit.unitId} 重复——单元身份不唯一`),
      )
    }
    seenUnitIds.add(unit.unitId)

    const seenDomains = new Set<string>()
    unit.domain.forEach((token, j) => {
      if (seenDomains.has(token)) {
        out.push(
          issue(doc, lc, lineOfPath(doc, lc, ['units', i, 'domain', j]), 'org-config/unit-domain-overlap', `单元 ${unit.unitId} 的 domain 内重复 ${token}——域划分不唯一`),
        )
      }
      seenDomains.add(token)
      const owner = domainOwner.get(token)
      if (owner !== undefined && owner !== unit.unitId) {
        out.push(
          issue(
            doc,
            lc,
            lineOfPath(doc, lc, ['units', i, 'domain', j]),
            'org-config/unit-domain-overlap',
            `域 ${token} 同时属于 ${owner} 与 ${unit.unitId}——N 单元域不得重叠（v2/03 §八）`,
          ),
        )
      } else {
        domainOwner.set(token, unit.unitId)
      }
    })

    if (unit.headRef !== null && !peopleIds.has(unit.headRef)) {
      out.push(
        issue(
          doc,
          lc,
          lineOfPath(doc, lc, ['units', i, 'headRef']),
          'org-config/unit-head-unresolved',
          `单元 ${unit.unitId} 的 headRef=${unit.headRef} 不在 people 索引（悬空）——不得冒充在编`,
        ),
      )
    }
    const vacancyState = unit.vacancyState ?? 'staffed'
    if (vacancyState === 'staffed' && unit.headRef === null) {
      // 唯一例外：N=1 且 vacancyState 缺省＝单人退化默认形态（不是「在编」声明）
      if (!(units.length === 1 && unit.vacancyState === undefined)) {
        out.push(
          issue(
            doc,
            lc,
            lineOfPath(doc, lc, ['units', i, 'vacancyState']),
            'org-config/unit-head-state-conflict',
            `单元 ${unit.unitId} 声明 staffed 但无 headRef——在编声明缺在位者，不得默认放行`,
          ),
        )
      }
    }
    if (vacancyState === 'head-vacant' && unit.headRef !== null) {
      out.push(
        issue(
          doc,
          lc,
          lineOfPath(doc, lc, ['units', i, 'vacancyState']),
          'org-config/unit-head-state-conflict',
          `单元 ${unit.unitId} 同时声明 headRef=${unit.headRef} 与 vacancyState=head-vacant——空编态与在编态互斥`,
        ),
      )
    }
    if (vacancyState === 'head-vacant' && (unit.reviewAt === undefined || unit.reviewAt === null)) {
      out.push(
        issue(
          doc,
          lc,
          lineOfPath(doc, lc, ['units', i, 'reviewAt']),
          'org-config/unit-vacancy-without-review',
          `单元 ${unit.unitId} 空编未登记复审期限（reviewAt）——空编静默=违规（v2/03 §八）`,
        ),
      )
    }
  })
  return out
}
