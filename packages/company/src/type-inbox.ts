/**
 * yt.typeInbox 内容规则（130-P1，studio-dev-172；studio-dev-130 §6.1.2 类型收件态直落面）。
 * 独立规则模块（state-hygiene.ts 同纪律：validator.ts 尺寸基线只减不增——规则体拆出，
 * validator 只留接线行）。
 *
 *   - TI-1 形状：`Record<非空 type, 非空收件态>`（键值均非空字符串）
 *   - TI-2 值域：收件态 ∈（yt.states ?? 缺省五态）∪ 全部 workflows 类型声明态
 *     （含 entity 类型桶）——落位态必须已声明，否则 localfile provision/Taiga 建单
 *     落未知态（fail-closed：无处声明=拒收，公司须先在 yt.states 或类型声明中落位）
 *   - TI-3 保留词：键禁 bug/task（W-9 同源——task=定时岗单物化 type，劫持其收件态
 *     会让岗单落 L0 流表外态 NOOP_UNKNOWN_STATE 永滞；bug=断路器自动开单同险）
 *
 * 缺省五态与 git-import deriveFieldProvision 的 DEFAULT_STATES 双胞胎（company 包内
 * 两处同构，mainlineFwd 同纪律——测试锁定同构，不引跨模块常量依赖）。
 */
import type { LineCounter } from 'yaml'
import { parseDocument } from 'yaml'
import type { DirectoryIssue } from '@studio-next/contract'
import type { OrgConfig } from './validator.ts'
import { lineOfPath } from './multifile.ts'

const ORG_CONFIG_FILE = 'org-config.yaml'

const TYPEINBOX_DEFAULT_STATES: readonly string[] = ['新单', '已派发', '证据就绪', '复验通过', '已交付']

/** 类型收件态内容规则（validator.ts issues 面拼装；yt.typeInbox 缺省=无键零规则） */
export function typeInboxRules(doc: ReturnType<typeof parseDocument>, lc: LineCounter, org: OrgConfig): DirectoryIssue[] {
  const yt = org.yt
  const raw = yt?.['typeInbox']
  if (raw === undefined) return []
  const out: DirectoryIssue[] = []
  const push = (path: (string | number)[], rule: string, fix: string): void => {
    out.push({ file: ORG_CONFIG_FILE, line: lineOfPath(doc, lc, ['yt', 'typeInbox', ...path]), rule: `org-config/${rule}`, fix })
  }
  // TI-1：形状（plain record 且键值均非空字符串）
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push([], 'typeinbox-bad-shape', 'yt.typeInbox 须为「类型: 收件态」record（键值均非空字符串——130-P1，studio-dev-172；建单落位第二优先级，IssueCreate.initialState 解析序）')
    return out
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  const badShape = entries.some(([k, v]) => k.length === 0 || typeof v !== 'string' || v.length === 0)
  if (entries.length === 0 || badShape) {
    push([], 'typeinbox-bad-shape', 'yt.typeInbox 须为「类型: 收件态」record（键值均非空字符串；空 record 不声明即面关——130-P1，studio-dev-172）')
    return out
  }
  // TI-3：保留词（W-9 同源）
  for (const k of entries.map(([k]) => k)) {
    if (k === 'bug' || k === 'task') {
      push([k], 'typeinbox-reserved-key', `yt.typeInbox 键 ${k} 是系统保留词（bug=断路器自动开单·task=定时岗单物化 type——docs/51 W-9 同源）：劫持其收件态会让保留词单落流表外态 NOOP_UNKNOWN_STATE 永滞`)
    }
  }
  // TI-2：值域（yt.states ?? 缺省五态）∪ workflows 全类型声明态（entity 桶同收——
  // 收件态是绑定实体上的状态名，落位面不分顶层/实体桶）
  const ytStates = yt?.['states']
  const declared = new Set<string>(
    Array.isArray(ytStates) && ytStates.every((s) => typeof s === 'string') ? (ytStates as string[]) : TYPEINBOX_DEFAULT_STATES,
  )
  for (const t of org.workflows?.types ?? []) {
    for (const s of t.states) declared.add(typeof s === 'string' ? s : s.name)
  }
  for (const [k, v] of entries) {
    if (!declared.has(v as string)) {
      push([k], 'typeinbox-unknown-state', `yt.typeInbox.${k}=${v} 不在声明态全集内（yt.states/缺省五态 ∪ workflows 类型声明态）——收件态必须先声明再落位（localfile provision/Taiga 建单 fail-closed；130-P1，studio-dev-172）`)
    }
  }
  return out
}
