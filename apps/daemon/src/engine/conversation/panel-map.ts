/**
 * engine/conversation/panel-map —— 面板 Port 的行映射纯函数（studio-dev-654a）
 *
 * 依据：docs/21-§七.1（落盘 msg/clear schema；seq 不落盘、由适配器按有效行文件序合成）、
 * docs/21-§七.4（面板 Port 映射表）、docs/v2/14-§8.1（装配入口/中继失败面）。
 *
 * 为什么要有本件：store 是单一事实源（engine），面板 Port 在 panel 包（assembly 侧适配）；
 * 「哪些行可见 / seq 如何合成 / 来源归一」必须单点定义，适配器与中继共用，避免两处各写一份
 * （反屎山：不重复实现、不按 eventId 前缀猜来源——source 是显式字段）。
 *
 * 边界：零 IO 零依赖（只吃 RawRecord[]）；system 旁白只在 store 审计，不进面板读面。
 */
import type { ConversationSource, RawRecord } from './store-types.ts'

/** 面板可见行（msg role≠system 或 clear；文件序=append 顺序） */
export type PanelVisibleRow = Extract<RawRecord, { kind: 'msg' | 'clear' }>

/** 面板可见行＋合成 seq（同一工号从 1 起单调；append-only 稳定） */
export interface PanelSeqRow {
  readonly seq: number
  readonly row: PanelVisibleRow
}

/** 可见行过滤＋seq 合成（单点口径：docs/21-§七.1） */
export function panelVisibleRows(records: readonly RawRecord[]): PanelSeqRow[] {
  const rows: PanelSeqRow[] = []
  let seq = 0
  for (const record of records) {
    if (record.kind === 'clear') {
      seq += 1
      rows.push({ seq, row: record })
      continue
    }
    if (record.kind === 'msg' && record.role !== 'system') {
      seq += 1
      rows.push({ seq, row: record })
    }
  }
  return rows
}

/** 行来源（缺省 matrix；source 是显式字段，不按事件 id 猜） */
export function panelSourceOf(row: PanelVisibleRow): ConversationSource {
  return row.source ?? 'matrix'
}

/** 面板写/矩阵写的来源归一（面板 Port 写=producer；矩阵入站=matrix） */
export function panelOriginOf(row: PanelVisibleRow): { readonly source: ConversationSource; readonly producer: boolean } {
  const source = panelSourceOf(row)
  return { source, producer: row.kind === 'msg' && row.role === 'producer' }
}
