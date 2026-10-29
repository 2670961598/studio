/**
 * 组织纯投影 · 表 A′ 保留权力归属面（NEG-ORG-02；MIG-05 补强）
 *
 * 依据：docs/v2/03 §2.3（表 A′ 唯一主表：每行权力必有显式归属；禁止任何权力悬空或塞回可选
 * 容器）、§8（强制失败出口：权力悬空/塞入可选容器＝结构违规，判负）、docs/v2/06 §5.3（包内
 * 章程可引用、不得另立副本或改写归属）、docs/v2/17 §4.1 NEG-ORG-02。
 *
 * 本件职责（纯函数、零 IO）：
 *   - 输入边界收口：`powerOwners` 是**行号→归属引用**的逐行声明（不复制表 A′ 正文）；
 *   - 12 行逐行显式：缺行/重复行/越界行/空归属/可选容器/悬空引用 → blocking issue（投影
 *     status='blocked'）；
 *   - 归属引用解析到**已声明对象表**（单元/部门/人员；外部老板为树外根、最高宰相为结构位置），
 *     解析不到＝悬空——不猜、不回落、不默认放行。
 *
 * 缺省（未声明 powerOwners）＝未声明，不猜 12 行、不阻断（保持旧输入兼容）。已声明则整表
 * 逐行校验：本投影不提供「部分声明」的合法形态。
 */
import { ISSUE_CODES, projectionIssue } from './issues.ts'
import type {
  OrganizationProjectionInput,
  PowerOwnerKind,
  PowerOwnershipProjection,
  ProjectedPowerOwner,
  ProjectionIssue,
} from './types.ts'

/** 表 A′ 行数（行号 1..12；本常量是行数，不是表 A′ 正文副本）。 */
export const POWER_OWNER_ROW_COUNT = 12

/** 外部老板归属引用（组织树之外的根；v2/03 §2.1-3——恒存在，不是悬空）。 */
export const POWER_OWNER_EXTERNAL_BOSS = 'external-boss'

/** 最高宰相归属引用（内部老板＝结构位置；缺位由空编/老板缺席面单独处置，不使归属悬空）。 */
export const POWER_OWNER_SUPREME_MINISTER = 'supreme-minister'

/** 归属解析可用的已声明对象表（投影输入边界；不用运行记录冒充）。 */
export interface PowerOwnerRefs {
  unitIds: ReadonlySet<string>
  departmentPaths: ReadonlySet<string>
  personIds: ReadonlySet<string>
}

interface OwnerResolution {
  kind: PowerOwnerKind
  resolved: boolean
}

/** 输入已解析件 → 表 A′ 归属投影（校验失败只产 issue，不静默丢弃声明行）。 */
export function buildPowerOwnership(
  input: OrganizationProjectionInput,
  refs: PowerOwnerRefs,
  issues: ProjectionIssue[],
): PowerOwnershipProjection {
  const declared: unknown = input.org.powerOwners
  const base = {
    tableRef: 'v2/03 §2.3',
    rule: 'explicit-per-row-no-optional-container',
  } as const
  if (declared === undefined) return { ...base, source: 'undeclared', rows: [] }

  const rows: ProjectedPowerOwner[] = []
  if (!Array.isArray(declared)) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.powerOwnerOptionalContainer,
        'power-owner:(shape)',
        'powerOwners 不是逐行显式列表（整表被塞入单一可选容器）——表 A′ 12 行须逐行声明（v2/03 §2.3；NEG-ORG-02）',
      ),
    )
    return { ...base, source: 'declared', rows }
  }

  const seenRows = new Set<number>()
  for (const entry of declared as readonly unknown[]) {
    const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
    const row = record !== null ? record.row : undefined
    if (typeof row !== 'number' || !Number.isInteger(row) || row < 1 || row > POWER_OWNER_ROW_COUNT) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.powerOwnerRowInvalid,
          'power-owner:(shape)',
          `表 A′ 归属条目行号=${String(row)} 不在 1..${POWER_OWNER_ROW_COUNT}（或缺 row 字段）——逐行显式声明才可判归属（NEG-ORG-02）`,
        ),
      )
      continue
    }
    if (seenRows.has(row)) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.powerOwnerRowInvalid,
          `power-owner:${row}`,
          `表 A′ 第 ${row} 行重复声明归属——一行一归属，不得以多值覆盖（NEG-ORG-02）`,
        ),
      )
      continue
    }
    seenRows.add(row)

    const ownerRef = record !== null ? record.ownerRef : undefined
    if (typeof ownerRef !== 'string') {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.powerOwnerOptionalContainer,
          `power-owner:${row}`,
          `表 A′ 第 ${row} 行归属不是具名引用（非字符串：被塞入可选容器）——归属须逐行显式具名，不得留可选形态（NEG-ORG-02）`,
        ),
      )
      continue
    }
    const normalized = ownerRef.trim()
    if (normalized === '') {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.powerOwnerOptionalContainer,
          `power-owner:${row}`,
          `表 A′ 第 ${row} 行为空 owner（空归属）——每行权力必有显式归属，悬空即结构违规（NEG-ORG-02）`,
        ),
      )
      continue
    }

    const resolution = resolveOwnerRef(normalized, refs)
    if (!resolution.resolved) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.powerOwnerUnresolved,
          `power-owner:${row}`,
          `表 A′ 第 ${row} 行归属引用 ${normalized} 无法解析到已声明对象（${unresolvedDetail(resolution.kind)}）——权力悬空＝结构违规判负（v2/03 §2.3/§八；NEG-ORG-02）`,
        ),
      )
    }
    rows.push({ row, ownerRef: normalized, resolved: resolution.resolved, kind: resolution.kind })
  }

  const missing: number[] = []
  for (let row = 1; row <= POWER_OWNER_ROW_COUNT; row++) {
    if (!seenRows.has(row)) missing.push(row)
  }
  if (missing.length > 0) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.powerOwnersIncomplete,
        'power-owner:(missing)',
        `表 A′ 12 行须逐行显式归属；缺失行：${missing.join('/')}——不得悬空或塞回可选容器（v2/03 §2.3/§八；NEG-ORG-02）`,
      ),
    )
  }

  rows.sort((left, right) => left.row - right.row)
  return { ...base, source: 'declared', rows }
}

/** 归属引用解析（闭式文法；外部老板/最高宰相为结构位置，其余须落在已声明对象表内）。 */
function resolveOwnerRef(ownerRef: string, refs: PowerOwnerRefs): OwnerResolution {
  if (ownerRef === POWER_OWNER_EXTERNAL_BOSS) return { kind: 'external-boss', resolved: true }
  if (ownerRef === POWER_OWNER_SUPREME_MINISTER) return { kind: 'supreme-minister', resolved: true }
  const scoped = splitScopedRef(ownerRef)
  if (scoped === null) return { kind: 'unknown-form', resolved: false }
  if (scoped.prefix === 'unit') return { kind: 'unit', resolved: refs.unitIds.has(scoped.value) }
  if (scoped.prefix === 'department') return { kind: 'department', resolved: refs.departmentPaths.has(scoped.value) }
  if (scoped.prefix === 'person') return { kind: 'person', resolved: refs.personIds.has(scoped.value) }
  return { kind: 'unknown-form', resolved: false }
}

function splitScopedRef(ownerRef: string): { prefix: string; value: string } | null {
  const separator = ownerRef.indexOf(':')
  if (separator <= 0 || separator === ownerRef.length - 1) return null
  return { prefix: ownerRef.slice(0, separator), value: ownerRef.slice(separator + 1).trim() }
}

function unresolvedDetail(kind: PowerOwnerKind): string {
  if (kind === 'unit') return 'unitId 不在已声明一级单元'
  if (kind === 'department') return '部门 path 不在组织对象表'
  if (kind === 'person') return '工号不在 people 索引'
  return '不属于闭式归属文法 external-boss/supreme-minister/unit:/department:/person:'
}
