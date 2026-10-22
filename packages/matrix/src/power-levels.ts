/**
 * power-levels —— 频道 PL 基线（DEV-20 §5.3 照录）＋频道规格类型＋同值判据。
 * 自 provision.ts 拆出（20-§十五.三.3 尺寸门「先拆再增」；130-P3 接线时腾位——
 * 逐字搬迁零行为漂移，provision 经同源 import 消费）。
 */

// ————————————————————————— 频道规格与 PL 基线（DEV-20 §5.3 照录） —————————————————————————

/** 八类地图的频道类别（130 §6.7.1 行键） */
export type ChannelKind = 'overview' | 'hall' | 'alert' | 'dept' | 'group' | 'xfunc' | 'ticket'

/** PL 基线三列（DEV-20 §5.3 表列）：大厅/告警列、部门频道列、单据房间列 */
export type PowerLevelColumn = 'hall' | 'dept' | 'ticket'

/** m.room.power_levels 目标快照（全量覆盖体；users/events 键=MXID/事件类型） */
export interface PowerLevelsContent {
  users_default: number
  users: Record<string, number>
  events_default: number
  state_default: number
  invite: number
  kick: number
  ban: number
  redact: number
  events: Record<string, number>
}

/** state_default=100 挡住的结构性事件全集（DEV-20 §5.3 events 行展开为 Matrix 事件类型全名） */
const STRUCTURAL_EVENTS: readonly string[] = [
  'm.room.name',
  'm.room.canonical_alias',
  'm.room.power_levels',
  'm.room.history_visibility',
  'm.room.tombstone',
  'm.room.encryption', // E2EE 恒不启用（21A-§5.7）——PL100 挡
  'm.room.server_acl',
  'm.space.child',
]

/**
 * PL 基线目标快照（DEV-20 §5.3 照录）。列差异：
 *   hall（大厅/告警/总览/跨部门）：redact=100，无 50 槽
 *   dept（部门频道/组群）：redact=50＋users[moderator]=50（部门主管/组长——21-§三:24 撤回处置面）
 *   ticket（单据房间）：redact=100，无 50 槽
 */
export function powerLevelTarget(
  column: PowerLevelColumn,
  ids: { botMxid: string; producerMxid: string; moderatorMxid?: string },
): PowerLevelsContent {
  const users: Record<string, number> = { [ids.botMxid]: 100, [ids.producerMxid]: 100 }
  if (column === 'dept' && ids.moderatorMxid !== undefined) users[ids.moderatorMxid] = 50
  const events: Record<string, number> = {}
  for (const t of STRUCTURAL_EVENTS) events[t] = 100
  return {
    users_default: 0,
    users,
    events_default: 0,
    state_default: 100,
    invite: 100,
    kick: 100,
    ban: 100,
    redact: column === 'dept' ? 50 : 100,
    events,
  }
}

/** 规划产物的一房规格（ensure 的幂等目标态） */
export interface ChannelSpec {
  kind: ChannelKind
  /** 全别名 #localpart:server */
  alias: string
  /** 房间显示名（CJK 入显示名——alias 全 ASCII，DEV-20 §5.1） */
  name: string
  /** 成员 MXID 清单（不含 bot=creator/admin；含 producer=神号全知）——稳定序 */
  members: readonly string[]
  /** 部门频道列的 50 槽占位者（部门主管/组长）MXID；其他列 undefined */
  moderatorMxid?: string
  power: PowerLevelColumn
  /** 父空间子项排序键（稳定序→m.space.child 内容稳定→重跑零写） */
  order: number
}

/** 公司频道地图规划（纯函数：快照+配置 → 目标态清单；problems=软失败落报告不炸） */
export interface ChannelMapPlan {
  space: { alias: string; name: string }
  channels: readonly ChannelSpec[]
  problems: readonly string[]
}

/** 深比较（PL/visibility/space-child 同值判据——只比可 JSON 化的普通值） */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/**
 * PL 现状 vs 目标快照一致性判据（§5.4「全量覆盖」的省写面）：目标键集∪基线键集上
 * 逐键深比较——目标之外的**额外 users 条目**也算漂移（手工提权即被下拍覆盖收回，
 * 单写者收口——防历史漂移的口径）。未知键（基线键集外）不参与比较（前向兼容）。
 */
export function powerLevelsMatch(current: Record<string, unknown>, target: PowerLevelsContent): boolean {
  const cur = current as Partial<PowerLevelsContent> & Record<string, unknown>
  if (cur.users_default !== target.users_default) return false
  if (cur.events_default !== target.events_default) return false
  if (cur.state_default !== target.state_default) return false
  if (cur.invite !== target.invite) return false
  if (cur.kick !== target.kick) return false
  if (cur.ban !== target.ban) return false
  if (cur.redact !== target.redact) return false
  const curUsers = (typeof cur.users === 'object' && cur.users !== null ? cur.users : {}) as Record<string, unknown>
  if (!jsonEqual(curUsers, target.users)) return false
  const curEvents = (typeof cur.events === 'object' && cur.events !== null ? cur.events : {}) as Record<string, unknown>
  // 只比较目标 events 键集（服务器/客户端可能注入其他事件门槛——不属本基线管辖面）
  for (const [k, v] of Object.entries(target.events)) {
    if (curEvents[k] !== v) return false
  }
  return true
}
