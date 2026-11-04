/**
 * engine/conversation/relay-state —— 面板→Matrix 中继游标的运行期状态（studio-dev-654a）
 *
 * 依据：docs/21-§七.4（中继游标语义）／docs/v2/14-§8.1（失败面）。
 *
 * 位置：`<companyDir>/var/conversations/.relay-state.json`（运行期状态：不进公司 git 契约包、
 * 不入 Taiga、不写台账）。结构：
 *   `{v:1, persons:{<工号>:{relayedSeq:number, dispatchedSeq?:number|null}}}`
 * — `dispatchedSeq` 字段位**预留**（后续派单单再用；本单只读写 relayedSeq，遇到既有 dispatchedSeq
 *   原样保留，不覆盖）。
 *
 * 纪律：原子写（tmp+rename）；读失败/坏形状=从空状态起并记日志（不猜、不炸主循环）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const RELAY_STATE_VERSION = 1

export interface RelayPersonCursor {
  /** 已成功中继回 Matrix 的最大合成 seq（0=尚未中继） */
  readonly relayedSeq: number
  /** 预留：派单游标（studio-dev-654b；本单不写语义，遇到时原样保留） */
  readonly dispatchedSeq?: number | null
}

export interface RelayState {
  readonly v: typeof RELAY_STATE_VERSION
  readonly persons: Record<string, RelayPersonCursor>
}

export function emptyRelayState(): RelayState {
  return { v: RELAY_STATE_VERSION, persons: {} }
}

/** 读取状态文件；不存在/坏 JSON/坏形状→空状态（不抛——中继下一拍重试） */
export function loadRelayState(file: string, log?: (line: string) => void): RelayState {
  if (!existsSync(file)) return emptyRelayState()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error('非对象')
    const raw = parsed as { v?: unknown; persons?: unknown }
    if (raw.v !== RELAY_STATE_VERSION || typeof raw.persons !== 'object' || raw.persons === null) {
      throw new Error('v/persons 形状不符')
    }
    const persons: Record<string, RelayPersonCursor> = {}
    for (const [person, value] of Object.entries(raw.persons as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const cursor = value as { relayedSeq?: unknown; dispatchedSeq?: unknown }
      const relayedSeq = typeof cursor.relayedSeq === 'number' && Number.isInteger(cursor.relayedSeq) && cursor.relayedSeq >= 0 ? cursor.relayedSeq : undefined
      if (relayedSeq === undefined) continue
      persons[person] = {
        relayedSeq,
        ...(typeof cursor.dispatchedSeq === 'number' || cursor.dispatchedSeq === null
          ? { dispatchedSeq: cursor.dispatchedSeq as number | null }
          : {}),
      }
    }
    return { v: RELAY_STATE_VERSION, persons }
  } catch (err) {
    log?.(`[conversation] 中继游标状态不可读（从空状态起，不猜）：${file}：${err instanceof Error ? err.message : String(err)}`)
    return emptyRelayState()
  }
}

/** 原子写状态（tmp+rename；父目录自动建） */
export function saveRelayState(file: string, state: RelayState): void {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp-${String(process.pid)}`
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    renameSync(tmp, file)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // 清理失败不掩盖原错误
    }
    throw err
  }
}

/** 取某工号已中继游标（缺省 0） */
export function relayedSeqOf(state: RelayState, person: string): number {
  return state.persons[person]?.relayedSeq ?? 0
}

/** 取某工号已派单游标（缺省 0；与 relayedSeq 独立） */
export function dispatchedSeqOf(state: RelayState, person: string): number {
  const value = state.persons[person]?.dispatchedSeq
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

/** 推进某工号已派单游标（保留既有 relayedSeq，不覆盖；两路游标独立） */
export function withDispatchedSeq(state: RelayState, person: string, dispatchedSeq: number): RelayState {
  const current = state.persons[person]
  return {
    v: RELAY_STATE_VERSION,
    persons: {
      ...state.persons,
      [person]: {
        ...(current?.relayedSeq !== undefined ? { relayedSeq: current.relayedSeq } : { relayedSeq: 0 }),
        dispatchedSeq,
      },
    },
  }
}

/** 推进某工号已中继游标（保留既有 dispatchedSeq 字段位，不覆盖） */
export function withRelayedSeq(state: RelayState, person: string, relayedSeq: number): RelayState {
  const current = state.persons[person]
  return {
    v: RELAY_STATE_VERSION,
    persons: {
      ...state.persons,
      [person]: {
        ...(current?.dispatchedSeq !== undefined ? { dispatchedSeq: current.dispatchedSeq } : {}),
        relayedSeq,
      },
    },
  }
}


/**
 * 游标状态存储（B 中继 + C 派单共用一个状态文件）：每次 update 都**读-改-写**最新文件，
 * 两路各自推进自己的字段互不覆盖（单线程顺序调用；tmp+rename 原子写）。
 */
export interface RelayStateStore {
  relayedSeq(person: string): number
  dispatchedSeq(person: string): number
  /** 是否已有显式 dispatchedSeq（**存在性**判定：0 也算已初始化；缺省/null=未初始化→需 bootstrap） */
  hasDispatchedSeq(person: string): boolean
  updateRelayed(person: string, seq: number): void
  updateDispatched(person: string, seq: number): void
}

export function createRelayStateStore(file: string, log?: (line: string) => void): RelayStateStore {
  return {
    relayedSeq(person: string): number {
      return relayedSeqOf(loadRelayState(file, log), person)
    },
    dispatchedSeq(person: string): number {
      return dispatchedSeqOf(loadRelayState(file, log), person)
    },
    hasDispatchedSeq(person: string): boolean {
      const cursor = loadRelayState(file, log).persons[person]
      return cursor !== undefined && typeof cursor.dispatchedSeq === 'number'
    },
    updateRelayed(person: string, seq: number): void {
      saveRelayState(file, withRelayedSeq(loadRelayState(file, log), person, seq))
    },
    updateDispatched(person: string, seq: number): void {
      saveRelayState(file, withDispatchedSeq(loadRelayState(file, log), person, seq))
    },
  }
}
