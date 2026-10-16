/**
 * trim —— 超长裁剪器（docs/17-§5 裁剪优先级行 / 01-C2-09）
 *
 * 规格依据（实现单引用）：
 *   - 17-§5：永不裁=红线/证据契约/验收口径/署名；先裁 L3 做过的事（留最近 N 单+画像数字）。
 *   - C2-09 裁剪阶梯：L3 做过的事（留最近 N 单+画像）→ L4 教训 top-k 减半 → L1 战役降一句；
 *     验收=「输出裁剪清单且不丢红线与验收口径」。
 *
 * 【拟稿待批】
 *   - 「永不裁」的实现机制=裁剪**只经由构建器显式声明的 trim 区**（work_history/lessons/campaign），
 *     区外内容结构性不可裁（红线/验收口径/署名/画像数字都不在任何 trim 区——由 layers.ts 构建侧保证）；
 *     protected 标记为声明性第二道防线：L0/L2 恒无 trim 区 → 永不被触。
 *   - 裁完三阶仍超预算 → withinBudget=false 如实上报，**宁可超长不裁红线**（C2-09 末级
 *     「L3 自述与 L5 长文档转按需检索」是检索机制不是文本裁剪，不在本刀范围）。
 *   - L4 含显式 lessons trim 区例外（C2-09 冻结了教训减半）：protected 层只有声明过的区可动。
 *   - keepRecentN 默认 3（docs 开放问题：「做过的事」保留 N 的数据试算未做，拟稿默认 3）。
 *   - 行序=旧→新（layers.ts 拟稿）：保留最近 N 单=保留区末 N 个非空行。
 *
 * 纯函数纪律：不改入参（返回新数组/新层对象）；同输入恒同输出；零 IO。
 */
import {
  layerFingerprint,
  trimMarkerBegin,
  trimMarkerEnd,
  type LayerId,
  type PromptLayer,
  type TrimmableKind,
} from './layers.ts'

/** 「做过的事」保留最近 N 单的默认值（拟稿，见文件头注） */
export const DEFAULT_KEEP_RECENT_N = 3

export interface TrimOptions {
  /** L3 做过的事保留最近 N 单（默认 3） */
  keepRecentN?: number
}

/** 裁剪规则枚举（C2-09 阶梯；裁剪清单的 rule 字段） */
export type TrimRule =
  | 'L3_WORK_HISTORY_KEEP_RECENT_N'
  | 'L4_LESSONS_HALVE'
  | 'L1_CAMPAIGN_ONE_LINE'

/** 裁剪清单条目（C2-09 验收：输出裁剪清单） */
export interface TrimCut {
  layer: LayerId
  rule: TrimRule
  /** 裁前区內行数 */
  totalLines: number
  /** 裁后区內行数 */
  keptLines: number
  /** 净减字符数（含标记间正文） */
  removedChars: number
}

/** 裁剪结果：新层集（原层不动）+ 裁剪清单 + 是否达标 */
export interface TrimResult {
  layers: PromptLayer[]
  cuts: TrimCut[]
  totalChars: number
  budgetChars: number
  /** 三阶裁完仍超预算=false（如实上报，不裁红线硬凑） */
  withinBudget: boolean
}

/** 区内保留策略（作用于非空行数组，返回保留子集） */
type KeepPolicy = (lines: readonly string[]) => string[]

/** 替换层正文中一个 trim 区的正文（标记保留、区外逐字节不动）；无该区或无可裁=null */
function cutRegion(
  content: string,
  kind: TrimmableKind,
  keep: KeepPolicy,
): { content: string; keptLines: string[]; totalLines: number; removedChars: number } | null {
  const begin = trimMarkerBegin(kind)
  const end = trimMarkerEnd(kind)
  const bi = content.indexOf(begin)
  if (bi === -1) return null
  const bodyStart = bi + begin.length
  const ei = content.indexOf(end, bodyStart)
  if (ei === -1) return null
  const body = content.slice(bodyStart, ei)
  const nonBlank = body.split('\n').filter((l) => l.trim() !== '')
  if (nonBlank.length === 0) return null
  const kept = keep(nonBlank)
  if (kept.length >= nonBlank.length) return null // 无可裁（策略保全部）
  const newBody = kept.length === 0 ? '\n' : `\n${kept.join('\n')}\n`
  const removedChars = body.length - newBody.length
  return {
    content: content.slice(0, bodyStart) + newBody + content.slice(ei),
    keptLines: kept,
    totalLines: nonBlank.length,
    removedChars,
  }
}

/** 对指定层执行一次区裁并联动指纹（不可变：返回新层） */
function applyCut(
  layer: PromptLayer,
  kind: TrimmableKind,
  rule: TrimRule,
  keep: KeepPolicy,
): { layer: PromptLayer; cut: TrimCut } | null {
  if (!layer.trimmables.some((r) => r.kind === kind)) return null
  const r = cutRegion(layer.content, kind, keep)
  if (r === null) return null
  const content = r.content
  return {
    layer: {
      ...layer,
      content,
      fingerprint: layerFingerprint(layer.id, layer.identity, content),
      trimmables: layer.trimmables.map((t) =>
        t.kind === kind ? { kind: t.kind, lines: r.keptLines.length } : t,
      ),
    },
    cut: {
      layer: layer.id,
      rule,
      totalLines: r.totalLines,
      keptLines: r.keptLines.length,
      removedChars: r.removedChars,
    },
  }
}

const totalCharsOf = (layers: readonly PromptLayer[]): number =>
  layers.reduce((n, l) => n + l.content.length, 0)

/**
 * 超长裁剪（C2-09 阶梯）：
 *   预算内=零裁剪直通；超预算依次执行——
 *     ① L3 做过的事 → 保留最近 N 单（keepRecentN；画像数字在区外，结构性保留）
 *     ② L4 同类教训 top-k → 减半（保排名前 ⌈k/2⌉）
 *     ③ L1 战役 → 降一句（保首个非空行）
 *   每阶后达标即停；三阶后仍超=withinBudget:false 如实上报（永不裁红线硬凑）。
 */
export function trimLayers(
  layers: readonly PromptLayer[],
  budgetChars: number,
  opts?: TrimOptions,
): TrimResult {
  const keepN = Math.max(0, opts?.keepRecentN ?? DEFAULT_KEEP_RECENT_N)
  let current = layers.map((l) => l) // 新数组，层对象不可变替换
  const cuts: TrimCut[] = []
  const over = (): boolean => totalCharsOf(current) > budgetChars

  if (over()) {
    // ① L3 做过的事：留最近 N 单（旧→新序 → 末 N 行；N=0=全裁——slice(-0) 陷阱须显式分流）
    const l3 = current.find((l) => l.id === 'L3')
    if (l3 !== undefined) {
      const r = applyCut(l3, 'work_history', 'L3_WORK_HISTORY_KEEP_RECENT_N', (lines) =>
        keepN === 0 ? [] : lines.slice(-keepN),
      )
      if (r !== null) {
        current = current.map((l) => (l.id === 'L3' ? r.layer : l))
        cuts.push(r.cut)
      }
    }
  }
  if (over()) {
    // ② L4 教训 top-k：减半（排名序 → 保前 ⌈k/2⌉）
    const l4 = current.find((l) => l.id === 'L4')
    if (l4 !== undefined) {
      const r = applyCut(l4, 'lessons', 'L4_LESSONS_HALVE', (lines) =>
        lines.slice(0, Math.ceil(lines.length / 2)),
      )
      if (r !== null) {
        current = current.map((l) => (l.id === 'L4' ? r.layer : l))
        cuts.push(r.cut)
      }
    }
  }
  if (over()) {
    // ③ L1 战役：降一句（保首个非空行）
    const l1 = current.find((l) => l.id === 'L1')
    if (l1 !== undefined) {
      const first = (lines: readonly string[]): string[] => {
        const f = lines.find((l) => l.trim() !== '')
        return f === undefined ? [] : [f]
      }
      const r = applyCut(l1, 'campaign', 'L1_CAMPAIGN_ONE_LINE', first)
      if (r !== null) {
        current = current.map((l) => (l.id === 'L1' ? r.layer : l))
        cuts.push(r.cut)
      }
    }
  }
  return {
    layers: current,
    cuts,
    totalChars: totalCharsOf(current),
    budgetChars,
    withinBudget: totalCharsOf(current) <= budgetChars,
  }
}
