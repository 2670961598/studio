/**
 * shared —— ledger 拆件共享件（自 ledger.ts 原样搬出，零行为变更）
 *
 * 只放**跨 face 复用**的纯函数与结果形状：canonicalJson（记录级幂等比对）、parseJsonArray /
 * parseJsonValue（JSON 列解析闸）、errorMessage（消息文本化）。不持连接/状态——db 由
 * openLedger 唯一持有，face 工厂按需接收同一句柄（避免双源）。
 */
import { configInvalid } from '@studio-next/contract'

/** appendEvent 结果：appended=false 表示命中幂等规则（同 id 全列一致的重复入账被跳过） */
export interface AppendResult {
  id: string
  appended: boolean
}

/**
 * canonical JSON（递归按键排序，丢弃 undefined 值）：记录级内容比对用——键序无关，
 * 同内容恒同字节串。events 走 sameEvent 手工全列比对（v1 既有面），五张新表的
 * 同 id 幂等规则走本比对（canonicalJson(rowToX(existing)) === canonicalJson(parsed)）。
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

/** JSON 字符串数组列（skills / functions / lanes）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
export function parseJsonArray(raw: string, subcause: string): string[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    configInvalid(subcause, `列不是 JSON 字符串数组：${raw}`)
  }
  return parsed as string[]
}

/** 任意 JSON 值列（jobs.payload）解析：坏列 → CONFIG_INVALID（库已坏，如实报） */
export function parseJsonValue(raw: string, subcause: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    configInvalid(subcause, `payload 列不是合法 JSON：${raw}（${errorMessage(err)}）`)
  }
}

/** 错误消息文本化（内联用；与 rebuild.ts 同风格） */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
