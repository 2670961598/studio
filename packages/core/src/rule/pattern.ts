/**
 * rule/pattern —— 受限模式子集的形式化匹配（v2/10 §6.3 patternModel；线性时间自动机口径）
 *
 * 依据：
 *   - v2/10 §6.3「模式匹配受限子集」：字面字符、字符类（含范围/取反）、`.`（默认不含
 *     换行）、锚 `^$`、量词 `?*+{m,n}`（m,n≤1000）、分组与选择、`\d\w\s` 及取反；
 *     **禁止**反向引用、环视、原子组、条件组、递归、占有量词、内联模式开关、`\b` 类
 *     零宽断言与代码插值；
 *   - 同节「实现可用任何算法，但接受/拒绝结果必须与线性时间自动机完全一致，不得以
 *     『超时保护』代替模型一致」——本实现直接用 Thompson NFA 模拟：每输入码点做一次
 *     状态集推进，**无回溯**，接受/拒绝即自动机语义；步数＝自动机转移数（可数、确定，
 *     不是墙钟）。
 *   - v2/10 §6.3 三项档内固定限额：`maxPatternInputCodepoints`、`maxPatternSteps`、
 *     `maxQuantifierNesting`；patternModel.maxQuantifierBound ≤1000；
 *   - v2/10 §八：超出受限子集或模式超限 → E-RULE-009（phase=limit）；码义单点，
 *     本件只产**原因串**，诊断由 rule-engine 造（不在此复制码表）。
 *   - docs/v2/17 NEG-ENG-03（ReDoS 面：外部输入正则长输入 → 超时/拒，E-RULE-009 联动）。
 *
 * 零 IO、零宿主读取：不含时间/随机/环境；同 pattern×同输入恒同结果与同步数。
 */

/** 匹配器输入限额（来自档 patternModel ＋ 档内固定三项；调用方只传生效值） */
export interface PatternLimits {
  readonly maxPatternInputCodepoints: number
  readonly maxPatternSteps: number
  readonly maxQuantifierNesting: number
  readonly maxQuantifierBound: number
  readonly caseSensitive: boolean
}

/**
 * 拒绝原因（本件内部原因串；映射 E-RULE-009 单一码由 rule-engine 承担）：
 *   - `syntax`：模式本身不符合受限子集（禁用构造、非法转义、括号/类不闭合）；
 *   - `bound-exceeded`：量词界超过 patternModel.maxQuantifierBound；
 *   - `nesting-exceeded`：量词嵌套层数超过档内固定；
 *   - `input-too-long`：主题码点数超过 maxPatternInputCodepoints；
 *   - `steps-exceeded`：自动机转移数超过 maxPatternSteps（求值中止，不是 false）。
 */
export type PatternRejection =
  | 'syntax'
  | 'bound-exceeded'
  | 'nesting-exceeded'
  | 'input-too-long'
  | 'steps-exceeded'

/** 匹配结果：成功给 matched＋steps；拒绝给原因＋已走步数（超限记 refused 面由上层定） */
export type PatternResult =
  | { readonly ok: true; readonly matched: boolean; readonly steps: number }
  | { readonly ok: false; readonly reason: PatternRejection; readonly detail: string; readonly steps: number }

// ─────────────────────────────────────────────────────────────────────────────
// 一、语法树（受限子集）
// ─────────────────────────────────────────────────────────────────────────────

type CharTest = (codepoint: number) => boolean

type PatternNode =
  | { readonly kind: 'empty' }
  | { readonly kind: 'char'; readonly test: CharTest; readonly label: string }
  | { readonly kind: 'seq'; readonly items: readonly PatternNode[] }
  | { readonly kind: 'alt'; readonly options: readonly PatternNode[] }
  | { readonly kind: 'repeat'; readonly node: PatternNode; readonly min: number; readonly max: number | null }
  | { readonly kind: 'assert'; readonly at: 'start' | 'end' }

class PatternSyntax extends Error {
  readonly reason: PatternRejection

  constructor(reason: PatternRejection, detail: string) {
    super(detail)
    this.reason = reason
  }
}

const DIGIT: CharTest = (cp) => cp >= 0x30 && cp <= 0x39
const WORD: CharTest = (cp) => DIGIT(cp) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || cp === 0x5f
const SPACE: CharTest = (cp) => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x0b || cp === 0x0c
const negate = (test: CharTest): CharTest => (cp) => !test(cp)
/** `.`（§6.3：默认不含换行——\n/\r 不在匹配面内） */
const ANY_EXCEPT_LINEBREAK: CharTest = (cp) => cp !== 0x0a && cp !== 0x0d

/** 大小写折叠（caseSensitive=false 时；按码点单值折叠，不做多码点展开——钉版确定性） */
function fold(codepoint: number): number {
  const text = String.fromCodePoint(codepoint).toLowerCase()
  return text.length === 1 ? text.codePointAt(0) ?? codepoint : codepoint
}

function literalTest(codepoint: number, caseSensitive: boolean): CharTest {
  if (caseSensitive) return (cp) => cp === codepoint
  const folded = fold(codepoint)
  return (cp) => cp === codepoint || fold(cp) === folded
}

function rangeTest(from: number, to: number, caseSensitive: boolean): CharTest {
  if (caseSensitive) return (cp) => cp >= from && cp <= to
  const lowFrom = fold(from)
  const lowTo = fold(to)
  return (cp) => {
    if (cp >= from && cp <= to) return true
    const lowered = fold(cp)
    return lowered >= lowFrom && lowered <= lowTo
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  f: 0x0c,
  v: 0x0b,
  '0': 0x00,
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、解析（递归下降；禁用构造即拒）
// ─────────────────────────────────────────────────────────────────────────────

interface ParseState {
  readonly source: string
  pos: number
  readonly caseSensitive: boolean
  readonly maxBound: number
}

function fail(reason: PatternRejection, detail: string): never {
  throw new PatternSyntax(reason, detail)
}

function readEscape(state: ParseState): { test: CharTest; label: string } {
  const ch = state.source[state.pos]
  state.pos += 1
  if (ch === undefined) fail('syntax', 'escape at end')
  if (ch === 'd') return { test: DIGIT, label: '\\d' }
  if (ch === 'D') return { test: negate(DIGIT), label: '\\D' }
  if (ch === 'w') return { test: WORD, label: '\\w' }
  if (ch === 'W') return { test: negate(WORD), label: '\\W' }
  if (ch === 's') return { test: SPACE, label: '\\s' }
  if (ch === 'S') return { test: negate(SPACE), label: '\\S' }
  if (ch === 'b' || ch === 'B') fail('syntax', 'zero-width assertion')
  if (ch >= '1' && ch <= '9') fail('syntax', 'backreference')
  if (ch === 'x' || ch === 'u' || ch === 'c' || ch === 'p' || ch === 'P' || ch === 'k') {
    fail('syntax', `unsupported escape \\${ch}`)
  }
  const simple = SIMPLE_ESCAPES[ch]
  const codepoint = simple ?? ch.codePointAt(0)
  if (codepoint === undefined) fail('syntax', 'escape decode')
  return { test: literalTest(codepoint, state.caseSensitive), label: `\\${ch}` }
}

function parseClass(state: ParseState): PatternNode {
  // 进入时 source[pos] === '['
  state.pos += 1
  let negated = false
  if (state.source[state.pos] === '^') {
    negated = true
    state.pos += 1
  }
  const tests: CharTest[] = []
  let first = true
  for (;;) {
    const ch = state.source[state.pos]
    if (ch === undefined) fail('syntax', 'class unterminated')
    if (ch === ']' && !first) {
      state.pos += 1
      break
    }
    first = false
    if (ch === '[') fail('syntax', 'nested class')
    if (ch === '\\') {
      const esc = readEscape(state)
      tests.push(esc.test)
      continue
    }
    const from = state.source.codePointAt(state.pos) ?? 0
    state.pos += from > 0xffff ? 2 : 1
    if (state.source[state.pos] === '-' && state.source[state.pos + 1] !== ']' && state.source[state.pos + 1] !== undefined) {
      state.pos += 1
      if (state.source[state.pos] === '\\') fail('syntax', 'class range escape')
      const to = state.source.codePointAt(state.pos)
      if (to === undefined) fail('syntax', 'class range')
      state.pos += to > 0xffff ? 2 : 1
      if (to < from) fail('syntax', 'class range order')
      tests.push(rangeTest(from, to, state.caseSensitive))
    } else {
      tests.push(literalTest(from, state.caseSensitive))
    }
  }
  const body: CharTest = (cp) => tests.some((test) => test(cp))
  return { kind: 'char', test: negated ? negate(body) : body, label: '[…]' }
}

function parseQuantifier(state: ParseState): { min: number; max: number | null } | null {
  const ch = state.source[state.pos]
  if (ch === '?') {
    state.pos += 1
    return { min: 0, max: 1 }
  }
  if (ch === '*') {
    state.pos += 1
    return { min: 0, max: null }
  }
  if (ch === '+') {
    state.pos += 1
    return { min: 1, max: null }
  }
  if (ch !== '{') return null
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(state.source.slice(state.pos))
  if (match === null) fail('syntax', 'quantifier form')
  const [, minText, maxText] = match
  if (minText === undefined) fail('syntax', 'quantifier form')
  state.pos += match[0].length
  const min = Number(minText)
  const max = maxText === undefined ? min : maxText === '' ? null : Number(maxText)
  if (max !== null && max < min) fail('syntax', 'quantifier order')
  if (min > state.maxBound || (max !== null && max > state.maxBound)) {
    fail('bound-exceeded', `quantifier bound > ${state.maxBound}`)
  }
  return { min, max }
}

function parseAtom(state: ParseState): PatternNode {
  const ch = state.source[state.pos]
  if (ch === undefined) return { kind: 'empty' }
  if (ch === '(') {
    if (state.source[state.pos + 1] === '?') fail('syntax', 'group construct (lookaround/inline flags)')
    state.pos += 1
    const inner = parseAlternation(state)
    if (state.source[state.pos] !== ')') fail('syntax', 'group unterminated')
    state.pos += 1
    return inner
  }
  if (ch === '[') return parseClass(state)
  if (ch === '.') {
    state.pos += 1
    return { kind: 'char', test: ANY_EXCEPT_LINEBREAK, label: '.' }
  }
  if (ch === '\\') {
    state.pos += 1
    const esc = readEscape(state)
    return { kind: 'char', test: esc.test, label: esc.label }
  }
  if (ch === '^' || ch === '$') {
    state.pos += 1
    return { kind: 'assert', at: ch === '^' ? 'start' : 'end' }
  }
  if (ch === ')' || ch === '|') return { kind: 'empty' }
  const codepoint = state.source.codePointAt(state.pos)
  if (codepoint === undefined) fail('syntax', 'literal decode')
  // 代理对：把 UTF-16 两单元作为一个码点消费（码点序匹配，不是码元序）
  state.pos += codepoint > 0xffff ? 2 : 1
  return { kind: 'char', test: literalTest(codepoint, state.caseSensitive), label: String.fromCodePoint(codepoint) }
}

function parseSequence(state: ParseState): PatternNode {
  const items: PatternNode[] = []
  for (;;) {
    const ch = state.source[state.pos]
    if (ch === undefined || ch === '|' || ch === ')') break
    const atom = parseAtom(state)
    const quantifier = parseQuantifier(state)
    if (quantifier === null) {
      items.push(atom)
      continue
    }
    const next = state.source[state.pos]
    if (next === '+' || next === '?') fail('syntax', 'possessive/lazy quantifier')
    items.push({ kind: 'repeat', node: atom, min: quantifier.min, max: quantifier.max })
  }
  return items.length === 1 ? items[0]! : { kind: 'seq', items }
}

function parseAlternation(state: ParseState): PatternNode {
  const options: PatternNode[] = []
  for (;;) {
    options.push(parseSequence(state))
    if (state.source[state.pos] !== '|') break
    state.pos += 1
  }
  return options.length === 1 ? options[0]! : { kind: 'alt', options }
}

/** 量词嵌套层数（§6.3 maxQuantifierNesting：一条根到叶的链上 repeat 节点数） */
function repeatNesting(node: PatternNode): number {
  switch (node.kind) {
    case 'repeat':
      return 1 + repeatNesting(node.node)
    case 'seq':
      return node.items.reduce((depth, item) => Math.max(depth, repeatNesting(item)), 0)
    case 'alt':
      return node.options.reduce((depth, option) => Math.max(depth, repeatNesting(option)), 0)
    default:
      return 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、NFA 编译与模拟（Thompson；无回溯）
// ─────────────────────────────────────────────────────────────────────────────

type Transition =
  | { readonly kind: 'char'; readonly test: CharTest; readonly to: number }
  | { readonly kind: 'eps'; readonly to: number; readonly at?: 'start' | 'end' }

interface Nfa {
  readonly transitions: Transition[][]
  readonly start: number
  readonly accept: number
}

function compile(node: PatternNode): Nfa {
  const transitions: Transition[][] = []
  const alloc = (): number => {
    transitions.push([])
    return transitions.length - 1
  }
  const connect = (from: number, transition: Transition): void => {
    transitions[from]!.push(transition)
  }
  /** 编译 node 为片段，返回 [entry, exit]（exit 无出边，由上层接线） */
  const build = (current: PatternNode): readonly [number, number] => {
    switch (current.kind) {
      case 'empty': {
        const entry = alloc()
        const exit = alloc()
        connect(entry, { kind: 'eps', to: exit })
        return [entry, exit]
      }
      case 'char': {
        const entry = alloc()
        const exit = alloc()
        connect(entry, { kind: 'char', test: current.test, to: exit })
        return [entry, exit]
      }
      case 'assert': {
        const entry = alloc()
        const exit = alloc()
        connect(entry, { kind: 'eps', to: exit, at: current.at })
        return [entry, exit]
      }
      case 'seq': {
        const entry = alloc()
        let tail = entry
        for (const item of current.items) {
          const [itemEntry, itemExit] = build(item)
          connect(tail, { kind: 'eps', to: itemEntry })
          tail = itemExit
        }
        return [entry, tail]
      }
      case 'alt': {
        const entry = alloc()
        const exit = alloc()
        for (const option of current.options) {
          const [optionEntry, optionExit] = build(option)
          connect(entry, { kind: 'eps', to: optionEntry })
          connect(optionExit, { kind: 'eps', to: exit })
        }
        return [entry, exit]
      }
      case 'repeat': {
        const entry = alloc()
        let tail = entry
        for (let i = 0; i < current.min; i += 1) {
          const [copyEntry, copyExit] = build(current.node)
          connect(tail, { kind: 'eps', to: copyEntry })
          tail = copyExit
        }
        if (current.max === null) {
          // star：loop entry → body → loop entry；loop entry → exit
          const loop = alloc()
          const exit = alloc()
          connect(tail, { kind: 'eps', to: loop })
          const [bodyEntry, bodyExit] = build(current.node)
          connect(loop, { kind: 'eps', to: bodyEntry })
          connect(bodyExit, { kind: 'eps', to: loop })
          connect(loop, { kind: 'eps', to: exit })
          return [entry, exit]
        }
        const optional = current.max - current.min
        const exit = alloc()
        let optionalTail = tail
        for (let i = 0; i < optional; i += 1) {
          const [copyEntry, copyExit] = build(current.node)
          connect(optionalTail, { kind: 'eps', to: copyEntry })
          connect(optionalTail, { kind: 'eps', to: exit })
          optionalTail = copyExit
        }
        connect(optionalTail, { kind: 'eps', to: exit })
        return [entry, exit]
      }
    }
  }
  const [start, accept] = build(node)
  return { transitions, start, accept }
}

class StepHalt extends Error {}

/** ε-闭包（含位置断言）；每走一条转移计一步，超档即中止 */
function closure(nfa: Nfa, seeds: readonly number[], position: number, length: number, counter: { steps: number; max: number }): number[] {
  const seen = new Set<number>()
  const stack = [...seeds]
  while (stack.length > 0) {
    const state = stack.pop()!
    if (seen.has(state)) continue
    seen.add(state)
    for (const transition of nfa.transitions[state]!) {
      if (transition.kind !== 'eps') continue
      counter.steps += 1
      if (counter.steps > counter.max) throw new StepHalt()
      if (transition.at === 'start' && position !== 0) continue
      if (transition.at === 'end' && position !== length) continue
      if (!seen.has(transition.to)) stack.push(transition.to)
    }
  }
  return [...seen]
}

/**
 * 受限子集匹配（整串锚定 full-match）：返回 matched＋自动机转移数。
 * 拒绝面（syntax/bound/nesting/input-too-long/steps-exceeded）不是 `false`——上层必须
 * 记 refused（v2/10 RULE-06：超时/超限不得记 false）。
 */
export function matchRestrictedPattern(pattern: string, subject: string, limits: PatternLimits): PatternResult {
  const codepoints = [...subject].map((unit) => unit.codePointAt(0) ?? 0)
  if (codepoints.length > limits.maxPatternInputCodepoints) {
    return { ok: false, reason: 'input-too-long', detail: `${codepoints.length} > ${limits.maxPatternInputCodepoints}`, steps: 0 }
  }
  const state: ParseState = {
    source: pattern,
    pos: 0,
    caseSensitive: limits.caseSensitive,
    maxBound: limits.maxQuantifierBound,
  }
  let ast: PatternNode
  try {
    ast = parseAlternation(state)
    if (state.pos !== pattern.length) fail('syntax', 'trailing pattern content')
  } catch (error) {
    if (error instanceof PatternSyntax) return { ok: false, reason: error.reason, detail: error.message, steps: 0 }
    throw error
  }
  const nesting = repeatNesting(ast)
  if (nesting > limits.maxQuantifierNesting) {
    return { ok: false, reason: 'nesting-exceeded', detail: `${nesting} > ${limits.maxQuantifierNesting}`, steps: 0 }
  }
  const nfa = compile(ast)
  const counter = { steps: 0, max: limits.maxPatternSteps }
  try {
    let current = closure(nfa, [nfa.start], 0, codepoints.length, counter)
    for (let index = 0; index < codepoints.length; index += 1) {
      const codepoint = codepoints[index]!
      const next: number[] = []
      for (const stateIndex of current) {
        for (const transition of nfa.transitions[stateIndex]!) {
          if (transition.kind !== 'char') continue
          counter.steps += 1
          if (counter.steps > counter.max) throw new StepHalt()
          if (transition.test(codepoint)) next.push(transition.to)
        }
      }
      if (next.length === 0) {
        current = []
        break
      }
      current = closure(nfa, next, index + 1, codepoints.length, counter)
    }
    const matched = current.includes(nfa.accept)
    return { ok: true, matched, steps: counter.steps }
  } catch (error) {
    if (error instanceof StepHalt) return { ok: false, reason: 'steps-exceeded', detail: `${counter.max}`, steps: counter.steps }
    throw error
  }
}
