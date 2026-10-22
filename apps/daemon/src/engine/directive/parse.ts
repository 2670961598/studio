/**
 * parse —— 批示词表 v1 行式解析（studio-dev-171，130-§6.1.2 定稿 / docs/18-§2.5）。
 *
 * 批准信号的载体=网关既有 comment 动作词＋结构化批示行（GATEWAY_ACTIONS 零增删）。
 * 本件是纯函数解析核，冻结面（docs/18-§2.5，2026-10 定稿）：
 *   - 词表 v1 四词：批准/打回/拆单/搁置（130-§9 批示项⑤）；
 *   - 行式=行首「批示:」（半角冒号）＋动词＋（空格/制表/全角空格/行尾）；
 *   - 打回理由=同行动词后文本，必填（空理由=畸形拒）；
 *   - 一评论体恰容一批示行（署名行/正文不算）；多行/越界动词/全角冒号/动词粘字
 *     =畸形（fail-closed 可观测，不静默吞）。
 */

/** 词表 v1（冻结，130-§9 批示项⑤；events-index 站立派生同源消费） */
export const DIRECTIVE_VERBS = ['批准', '打回', '拆单', '搁置'] as const
export type DirectiveVerb = (typeof DIRECTIVE_VERBS)[number]

const PREFIX = '批示:'
const SEPARATORS = new Set([' ', '\t', '　'])

export type DirectiveParse =
  /** 无批示行（自由言论——不消费、不落事件） */
  | { kind: 'none' }
  /** 恰一行合法批示：text=动词后行内文本（打回=理由；其余动词=容留尾注） */
  | { kind: 'directive'; verb: DirectiveVerb; text: string }
  /** 畸形（多行/越界动词/全角冒号/动词粘字/打回空理由）——fail-closed 拒＋可观测 */
  | { kind: 'malformed'; why: string }

/**
 * 解析评论体（纯函数）。词表 v1 冻结四动词；动词后必须紧跟空白或行尾
 * （「批示:批准了」=粘字畸形——防手滑半句变批示）；打回理由必填。
 */
export function parseDirectiveComment(body: string): DirectiveParse {
  let found: { verb: DirectiveVerb; text: string } | undefined
  for (const raw of body.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith(PREFIX)) {
      if (found !== undefined) return { kind: 'malformed', why: 'multiple-lines' }
      const rest = line.slice(PREFIX.length)
      const verb = DIRECTIVE_VERBS.find((v) => rest.startsWith(v))
      if (verb === undefined) return { kind: 'malformed', why: 'unknown-verb' }
      const after = rest.slice(verb.length)
      if (after !== '' && !SEPARATORS.has(after[0] ?? '')) return { kind: 'malformed', why: 'verb-glued' }
      found = { verb, text: after.trim() }
    } else if (line.startsWith('批示：')) {
      // 全角冒号变体：可观测畸形（fail-closed 不静默——批示意图明确只是形态错）
      return { kind: 'malformed', why: 'fullwidth-colon' }
    }
  }
  if (found === undefined) return { kind: 'none' }
  if (found.verb === '打回' && found.text === '') return { kind: 'malformed', why: 'reject-no-reason' }
  return { kind: 'directive', verb: found.verb, text: found.text }
}
