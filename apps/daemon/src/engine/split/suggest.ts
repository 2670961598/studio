/**
 * 拆单候选打分件（130-P2，studio-dev-173；提案 §6.5.2——studio-dev-130 制作人
 * 2026-10-22 全批）——「让刚好做相关事的人一起做」的**建议面**，纯函数零 IO 零随机。
 *
 * 候选打分三因子（v1=排序清单＋理由给部长，**决定权在部长**——跑通优先，不做自动
 * 派工 AI）＋集中派工原则（制作人 2026-10-22 组织律：相关任务集中同一人、禁随机
 * 抢单——本件只产建议，点将仍由部长批示，§4.5）：
 *   - F1 技能匹配：people.skills × 子单标题/验收口径/文档锚关键词（快照未载 skills
 *     时降档用 role/dept 文本，不炸不静默）；
 *   - F2 在途主题相近度：与该人当前在途单（镜像 state∈{dispatched,evidenceReady,
 *     verified} 锚点集）标题关键词重叠——集中派工主因子（在做相关事的人加分）；
 *   - F3 负载：todo_queue 深度＋在途数（人闸读数代理，129-§6.2-R3）——轻者优先；
 *   - B1 集中派工加分：同清单内已被点将的人对剩余子单加分（同主题连续交付）。
 *
 * 确定性纪律：score 降序、并列按工号升序——**零随机**（禁随机抢单的算法面：同输入
 * 恒同序，无抢单抽签语义）；理由逐人中文短句（评论可读，部长抄改即派）。
 */
import type { PersonRef } from '@studio-next/contract'

/** 打分上下文（全由调用方注入快照/镜像/队列读数——本件不查账） */
export interface SuggestContext {
  /** 人事索引（engine.people——快照注入） */
  people: readonly PersonRef[]
  /** 在途单索引：工号 → 标题列表（镜像派生：assignee=人 且 state 在派发-复验锚点间） */
  inflightTitles: ReadonlyMap<string, readonly string[]>
  /** todo_queue 深度：工号 → 行数（129 投影读面） */
  queueDepth: ReadonlyMap<string, number>
  /** 同清单内已被点将的工号（集中派工加分面——剩余子单的候选对这些工号加分） */
  siblingAssignees: readonly string[]
}

/** 单人打分产出：工号/总分/逐因子分与理由 */
export interface CandidateSuggestion {
  personId: string
  score: number
  reasons: string[]
}

/** 关键词切分：中英混排取词——拉丁字母数字段 + CJK 逐字（主题相近度用粗粒度重叠即可，v1 不引分词） */
function keywords(text: string): Set<string> {
  const out = new Set<string>()
  for (const latin of text.toLowerCase().matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
    if (latin[0] !== undefined) out.add(latin[0])
  }
  for (const cjk of text.matchAll(/[\u4e00-\u9fff]/g)) {
    if (cjk[0] !== undefined) out.add(cjk[0])
  }
  return out
}

/** 集合重叠计数（a∩b） */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0
  for (const k of a) if (b.has(k)) n += 1
  return n
}

/**
 * 单子单候选打分：全员参与排序（部长要全景，不只前三——面板/评论再裁显示窗）。
 *
 * 分值（整数，可解释）：
 *   F1 技能 ×2/命中 + role/dept 文本命中 ×1（降档面）｜F2 在途重叠 ×3/单（主因子）
 *   ｜F3 负载 −(队列深度×2 + 在途数)｜B1 集中派工 +6/同清单已点将
 * 权重拟稿（plan §9）：F2>B1>F1>F3——「恰好做过/在做相关事」压倒一切，组织律次之。
 */
export function suggestAssignees(child: { title: string; acceptance?: string; docs?: string }, ctx: SuggestContext): CandidateSuggestion[] {
  const titleKeys = keywords(child.title)
  // F1 用全文键集（标题+验收口径+文档锚——§6.5.2「单据域/类型关键词」的题面全集）
  const textKeys = keywords(`${child.title} ${child.acceptance ?? ''} ${child.docs ?? ''}`)
  const siblings = new Set(ctx.siblingAssignees)
  const out: CandidateSuggestion[] = []
  for (const person of ctx.people) {
    if (person.status !== undefined && person.status !== 'active') continue // 停/退不进候选（v0 不锁枚举：非 active 即排除）
    const reasons: string[] = []
    let score = 0

    // F1 技能匹配（§6.5.2 因子 1）
    const skills = person.skills ?? []
    let skillHits = 0
    for (const skill of skills) {
      const s = skill.toLowerCase()
      if (s !== '' && textKeys.has(s)) skillHits += 1
    }
    if (skillHits > 0) {
      score += skillHits * 2
      reasons.push(`技能匹配：${skills.join('/')} 命中子单关键词 ×${String(skillHits)}`)
    } else if (skills.length > 0) {
      reasons.push(`技能面（${skills.join('/')}）未见直接命中`)
    }
    // F1 降档：role/dept 文本与标题重叠（skills 未载时的兜底信号，弱权重）
    const roleKeys = keywords(`${person.role ?? ''} ${person.dept}`)
    const roleHits = overlap(roleKeys, titleKeys)
    if (roleHits > 0) {
      score += roleHits
      reasons.push(`岗位/部门文本与子单重叠 ×${String(roleHits)}`)
    }

    // F2 在途主题相近度（§6.5.2 因子 2——集中派工主因子）
    const titles = ctx.inflightTitles.get(person.id) ?? []
    let bestOverlap = 0
    for (const t of titles) bestOverlap = Math.max(bestOverlap, overlap(keywords(t), titleKeys))
    if (titles.length > 0) {
      if (bestOverlap > 0) {
        score += bestOverlap * 3
        reasons.push(`在途主题相近：当前在途 ${String(titles.length)} 单中最近关键词重叠 ×${String(bestOverlap)}`)
      } else {
        reasons.push(`在途 ${String(titles.length)} 单与子单主题不重叠`)
      }
    }

    // F3 负载（§6.5.2 因子 3）：队列深度 ×2 + 在途数——轻者优先（负分）
    const depth = ctx.queueDepth.get(person.id) ?? 0
    score -= depth * 2 + titles.length
    reasons.push(`负载：todo 队列 ${String(depth)} 行 ×2 ＋在途 ${String(titles.length)} 单（负分 ${String(depth * 2 + titles.length)}）`)

    // B1 集中派工加分（组织律：相关任务集中同一人——同清单已点将者对剩余子单加分）
    if (siblings.has(person.id)) {
      score += 6
      reasons.push('集中派工：同清单其他子单已点将此人（相关任务集中同一人，组织律 2026-10-22）')
    }

    out.push({ personId: person.id, score, reasons })
  }
  out.sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.personId < b.personId ? -1 : 1)))
  return out
}

/**
 * 建议面评论文本（§6.5.2 产出形态：排序清单＋打分理由——部长抄改即派）。
 * 头 5 名进正文（全景在事件/面板；评论窗口有界，docs/21-§三 有界对话同纪律）。
 */
export function renderSuggestionComment(childTitle: string, suggestions: readonly CandidateSuggestion[]): string {
  const head = suggestions.slice(0, 5)
  const lines = [`【候选清单＋打分理由】子单「${childTitle}」——决定权在部长（v1 不做自动派工，抄改即派）：`]
  if (head.length === 0) {
    lines.push('（人事索引无 active 成员——无法建议）')
    return lines.join('\n')
  }
  for (let i = 0; i < head.length; i += 1) {
    const s = head[i]
    if (s === undefined) continue
    lines.push(`${String(i + 1)}. ${s.personId}（${String(s.score)} 分）——${s.reasons.join('；')}`)
  }
  if (suggestions.length > head.length) lines.push(`…另有 ${String(suggestions.length - head.length)} 人全景见台账`)
  return lines.join('\n')
}
