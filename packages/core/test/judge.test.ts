/**
 * judge 纯判定面测试 —— studio-dev-160 §6.1（制作人 2026-10-22 全批，docs/49）：
 *  - 词表注册闸：白名单/近黑名单/空词表/重复 op/陷阱 enum/候选集重复；
 *  - 指纹：同词表恒同指纹、书写序不参与、词表变则指纹变；
 *  - 三道闸 parseJudgeVerdict：三正例全过 + 每闸每支路负例（bad-json 五形态/
 *    op 越词表/键集不恰等/域约束四形态）；
 *  - 契约 mj 域（C-mj-001..008）runCases 全绿 + 防恒反证（改坏期望必红）。
 * 纯函数纪律：零 IO 零时钟——同输入恒同输出（指纹断言即回归锚）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import { runCases } from '@studio-next/contract'
import manifest from '../../contract/cases.json'
import {
  JUDGE_OP_SEMANTIC_NEAR_BLACKLIST,
  JUDGE_OP_SEMANTIC_WHITELIST,
  judgeVocabFingerprint,
  parseJudgeVerdict,
  assertJudgeVocab,
  type JudgeVocab,
} from '../src/judge.ts'

// —— 语料 ——————————————————————————————————————————————

/** 标准词表：pick(enum)/order(string-list)/front(string) 三操作三域形 */
const VOCAB: JudgeVocab = {
  ops: [
    { op: 'pick', params: { candidate: { kind: 'enum', values: ['a', 'b', 'c'] } } },
    { op: 'order', params: { keys: { kind: 'string-list' } } },
    { op: 'front', params: { keyword: { kind: 'string' } } },
  ],
}

/** 断言抛错并返回（category+subcause 双断言——错误面即契约面） */
function expectThrow(fn: () => unknown, category: string, subcause: string): Error & ClassifiedError {
  try {
    fn()
  } catch (err) {
    const e = err as Error & ClassifiedError
    expect(e.category).toBe(category)
    expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error('expected throw')
}

// —— 词表注册闸（CONFIG_INVALID：配置类错误不静默） ——————————————

describe('词表注册闸 assertJudgeVocab（§6.1 注册期，配置错拒收）', () => {
  it('标准词表过闸', () => {
    expect(() => assertJudgeVocab(VOCAB)).not.toThrow()
  })

  it('白名单只增不减的冻结值互证（§8-S10：pick/order/front/append/collect/skip）', () => {
    expect([...JUDGE_OP_SEMANTIC_WHITELIST]).toEqual(['pick', 'order', 'front', 'append', 'collect', 'skip'])
    expect([...JUDGE_OP_SEMANTIC_NEAR_BLACKLIST]).toEqual(['delegate', 'assign', 'create', 'update', 'close', 'priority'])
  })

  it('空词表拒收（judge/vocab-empty）', () => {
    expectThrow(() => assertJudgeVocab({ ops: [] }), 'CONFIG_INVALID', 'judge/vocab-empty')
  })

  it('重复 op 拒收（judge/vocab-dup-op）', () => {
    const v: JudgeVocab = { ops: [VOCAB.ops[0]!, { ...VOCAB.ops[0]! }] }
    expectThrow(() => assertJudgeVocab(v), 'CONFIG_INVALID', 'judge/vocab-dup-op')
  })

  it('近黑名单语义明确拒收（judge/vocab-op-out-of-scope——delegate 是越权不是拼写错）', () => {
    expectThrow(
      () => assertJudgeVocab({ ops: [{ op: 'delegate', params: {} }] }),
      'CONFIG_INVALID',
      'judge/vocab-op-out-of-scope',
    )
  })

  it('白名单外普通名拒收（judge/vocab-op-unapproved）', () => {
    expectThrow(() => assertJudgeVocab({ ops: [{ op: 'evaluate', params: {} }] }), 'CONFIG_INVALID', 'judge/vocab-op-unapproved')
  })

  it('空候选集 enum 拒收（judge/vocab-enum-empty——恒拒陷阱词表）', () => {
    const v: JudgeVocab = { ops: [{ op: 'pick', params: { c: { kind: 'enum', values: [] } } }] }
    expectThrow(() => assertJudgeVocab(v), 'CONFIG_INVALID', 'judge/vocab-enum-empty')
  })

  it('候选集重复值拒收（judge/vocab-enum-dup）', () => {
    const v: JudgeVocab = { ops: [{ op: 'pick', params: { c: { kind: 'enum', values: ['a', 'a'] } } }] }
    expectThrow(() => assertJudgeVocab(v), 'CONFIG_INVALID', 'judge/vocab-enum-dup')
  })
})

// —— 词表指纹（可观测锚：site 改注册在台账面对账） ——————————————————

describe('词表指纹 judgeVocabFingerprint', () => {
  it('同词表恒同指纹（sha8）；书写序不参与（canonical 化）', () => {
    expect(judgeVocabFingerprint(VOCAB)).toBe(judgeVocabFingerprint(VOCAB))
    const reordered: JudgeVocab = {
      ops: [VOCAB.ops[2]!, VOCAB.ops[0]!, VOCAB.ops[1]!],
    }
    expect(judgeVocabFingerprint(reordered)).toBe(judgeVocabFingerprint(VOCAB))
  })

  it('词表内容变则指纹变（候选集增项=新判断面）', () => {
    const mutated: JudgeVocab = {
      ops: [{ op: 'pick', params: { candidate: { kind: 'enum', values: ['a', 'b', 'c', 'd'] } } }],
    }
    expect(judgeVocabFingerprint(mutated)).not.toBe(judgeVocabFingerprint({ ops: [VOCAB.ops[0]!] }))
  })
})

// —— 三道闸 parseJudgeVerdict（LLM_FAIL judge/*：立即降级不重试） ——————

describe('三道闸 parseJudgeVerdict', () => {
  it('闸② ③ 全过的正例：pick(enum)/order(string-list)/front(string) 各一', () => {
    expect(parseJudgeVerdict('{"op":"pick","params":{"candidate":"b"}}', VOCAB)).toEqual({
      op: 'pick',
      params: { candidate: 'b' },
    })
    expect(parseJudgeVerdict('{"op":"order","params":{"keys":["x","y"]}}', VOCAB)).toEqual({
      op: 'order',
      params: { keys: ['x', 'y'] },
    })
    expect(parseJudgeVerdict('{"op":"front","params":{"keyword":"预算"}}', VOCAB)).toEqual({
      op: 'front',
      params: { keyword: '预算' },
    })
  })

  it('闸① 前后缀噪声拒收：markdown 围栏+解说（judge/bad-json）', () => {
    expectThrow(() => parseJudgeVerdict('```json\n{"op":"pick","params":{"candidate":"a"}}\n```', VOCAB), 'LLM_FAIL', 'judge/bad-json')
    expectThrow(() => parseJudgeVerdict('我认为 {"op":"pick","params":{"candidate":"a"}} 最佳', VOCAB), 'LLM_FAIL', 'judge/bad-json')
  })

  it('闸① 顶层未知键拒收（judge/bad-json——不抢救额外键）', () => {
    expectThrow(() => parseJudgeVerdict('{"op":"pick","params":{"candidate":"a"},"why":"因为"}', VOCAB), 'LLM_FAIL', 'judge/bad-json')
  })

  it('闸① 形态负例：数组/缺 params/op 非串（judge/bad-json）', () => {
    expectThrow(() => parseJudgeVerdict('[{"op":"pick"}]', VOCAB), 'LLM_FAIL', 'judge/bad-json')
    expectThrow(() => parseJudgeVerdict('{"op":"pick"}', VOCAB), 'LLM_FAIL', 'judge/bad-json')
    expectThrow(() => parseJudgeVerdict('{"op":"","params":{}}', VOCAB), 'LLM_FAIL', 'judge/bad-json')
  })

  it('闸② op 越词表拒收（judge/op-not-in-vocab——模型无词表扩展权）', () => {
    expectThrow(() => parseJudgeVerdict('{"op":"delete","params":{}}', VOCAB), 'LLM_FAIL', 'judge/op-not-in-vocab')
  })

  it('闸③ 未知参数键拒收（judge/params-domain）', () => {
    expectThrow(
      () => parseJudgeVerdict('{"op":"pick","params":{"candidate":"a","extra":"x"}}', VOCAB),
      'LLM_FAIL',
      'judge/params-domain',
    )
  })

  it('闸③ 键集不恰等：缺键=半成品裁决拒收（judge/params-domain）', () => {
    expectThrow(() => parseJudgeVerdict('{"op":"pick","params":{}}', VOCAB), 'LLM_FAIL', 'judge/params-domain')
  })

  it('闸③ 域约束负例：enum 越候选集/string 空串/string-list 混入空串（judge/params-domain）', () => {
    expectThrow(() => parseJudgeVerdict('{"op":"pick","params":{"candidate":"z"}}', VOCAB), 'LLM_FAIL', 'judge/params-domain')
    expectThrow(() => parseJudgeVerdict('{"op":"front","params":{"keyword":""}}', VOCAB), 'LLM_FAIL', 'judge/params-domain')
    expectThrow(() => parseJudgeVerdict('{"op":"order","params":{"keys":["x",""]}}', VOCAB), 'LLM_FAIL', 'judge/params-domain')
  })
})

// —— 契约面：mj 域（三格式 cases.json——规格标尺唯一源） ————————————

/** mj 域 subject：契约 case 的 input {raw, vocab} → parseJudgeVerdict */
function mjSubject(input: { raw: string; vocab: JudgeVocab }): { op: string; params: Record<string, unknown> } {
  return parseJudgeVerdict(input.raw, input.vocab)
}

describe('契约语料（mj 域，C-mj-001..008）', () => {
  it('全绿（8 条：三正例+五负例）', async () => {
    const r = await runCases(manifest, { mj: mjSubject }, { domains: ['mj'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(8)
    expect(r.passed).toBe(8)
  })

  it('防恒反证：改坏 C-mj-001 期望值必红（期望面真被校验——合法键面内改值，清单仍过 schema）', async () => {
    const bad = structuredClone(manifest) as {
      version: number
      cases: { id: string; expected: { out: { op: string; params: Record<string, unknown> } } }[]
    }
    const target = bad.cases.find((c) => c.id === 'C-mj-001')!
    target.expected.out.params.target = 'KT-999' // 期望面改坏：真产出 KT-102 ≠ 改后期望
    const r = await runCases(bad, { mj: mjSubject }, { domains: ['mj'] })
    expect(r.passed).toBe(7)
    expect(r.failed[0]?.id).toBe('C-mj-001')
  })
})
