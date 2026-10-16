/**
 * 动作词校验测试 —— 冻结格式/fail-closed/中文判定（17-§7、24-§二）
 */
import { describe, expect, test } from 'vitest'
import { isFreeformChinese, parseAction } from './actions.ts'

describe('parseAction 结构化路径', () => {
  test('合法：行首 @action + 白名单动词 + JSON 对象', () => {
    expect(parseAction('@action comment {"body":"完成"}')).toEqual({ ok: true, action: 'comment', args: { body: '完成' } })
    expect(parseAction('@action heartbeat {}')).toEqual({ ok: true, action: 'heartbeat', args: {} })
    expect(parseAction('@action kb-search {"q":"部署手册","limit":5}')).toEqual({
      ok: true,
      action: 'kb-search',
      args: { q: '部署手册', limit: 5 },
    })
  })

  test('六个白名单动词全部可解析（GATEWAY_ACTIONS 全量对齐）', () => {
    for (const verb of ['comment', 'heartbeat', 'article', 'kb-search', 'evidence-write', 'budget-query']) {
      expect(parseAction(`@action ${verb} {}`)).toEqual({ ok: true, action: verb, args: {} })
    }
  })

  test('未知动词拒：不猜、不修复（含大小写变体与相近词）', () => {
    expect(parseAction('@action transition {}')).toEqual({ ok: false, reason: 'unknown-verb' })
    expect(parseAction('@action Comment {}')).toEqual({ ok: false, reason: 'unknown-verb' })
    expect(parseAction('@action comments {}')).toEqual({ ok: false, reason: 'unknown-verb' })
    expect(parseAction('@action sudo {}')).toEqual({ ok: false, reason: 'unknown-verb' })
  })

  test('状态推进类动词永不在白名单（transition/update-state 拒）', () => {
    expect(parseAction('@action transition {"to":"Done"}').ok).toBe(false)
    expect(parseAction('@action update-state {"state":"QA"}').ok).toBe(false)
  })

  test('坏 JSON 拒（不完整/尾逗号/单引号）', () => {
    expect(parseAction('@action comment {body}')).toEqual({ ok: false, reason: 'bad-json' })
    expect(parseAction('@action comment {"a":1,}')).toEqual({ ok: false, reason: 'bad-json' })
    expect(parseAction("@action comment {'a':1}")).toEqual({ ok: false, reason: 'bad-json' })
  })

  test('JSON 非对象拒（数组/null/字符串/数字）', () => {
    expect(parseAction('@action comment [1,2]')).toEqual({ ok: false, reason: 'bad-args' })
    expect(parseAction('@action comment null')).toEqual({ ok: false, reason: 'bad-args' })
    expect(parseAction('@action comment "hi"')).toEqual({ ok: false, reason: 'bad-args' })
    expect(parseAction('@action comment 42')).toEqual({ ok: false, reason: 'bad-args' })
  })

  test('格式残缺拒：缺 JSON 段/缺动词/非行首/空串', () => {
    expect(parseAction('@action comment')).toEqual({ ok: false, reason: 'bad-format' })
    expect(parseAction('@action')).toEqual({ ok: false, reason: 'bad-format' })
    expect(parseAction('  @action comment {}')).toEqual({ ok: false, reason: 'not-an-action' })
    // 非行首指令=自由文本；含中文 → 按设计走回退标记（指令必须在行首才被认）
    expect(parseAction('前置文字 @action comment {}')).toEqual({ ok: false, reason: 'not-an-action', needsLlmFallback: true })
    expect(parseAction('leading words @action comment {}')).toEqual({ ok: false, reason: 'not-an-action' })
    expect(parseAction('')).toEqual({ ok: false, reason: 'not-an-action' })
  })

  test('首行为准：指令占首行，后续正文行不影响解析', () => {
    const text = '@action comment {"body":"hi"}\n这是第二行正文'
    expect(parseAction(text)).toEqual({ ok: true, action: 'comment', args: { body: 'hi' } })
    // 第二行才是指令 → 整体非行首，不认
    const secondLine = parseAction('正文\n@action comment {}')
    expect(!secondLine.ok && secondLine.reason).toBe('not-an-action')
  })

  test('JSON 内空格/嵌套/数组值合法', () => {
    expect(parseAction('@action evidence-write  { "path" : "a/b.md" , "tags" : [ "x" , "y" ] , "meta" : { "k" : 1 } }')).toEqual({
      ok: true,
      action: 'evidence-write',
      args: { path: 'a/b.md', tags: ['x', 'y'], meta: { k: 1 } },
    })
  })
})

describe('isFreeformChinese 判定', () => {
  test('含 CJK 表意字符即真（纯中文/中英混排/带扩展字）', () => {
    expect(isFreeformChinese('把这一单转给质检')).toBe(true)
    expect(isFreeformChinese('mixed 中英 mix')).toBe(true)
    expect(isFreeformChinese('㐀扩展A')).toBe(true)
  })

  test('纯英文/数字/标点/日文假名（非表意）为假', () => {
    expect(isFreeformChinese('')).toBe(false)
    expect(isFreeformChinese('plain english text')).toBe(false)
    expect(isFreeformChinese('1234 !!! ???')).toBe(false)
    expect(isFreeformChinese('カタカナ')).toBe(false) // 假名不算表意（拟稿口径）
  })

  test('中文自由批示 → not-an-action + needsLlmFallback 标记（只标记不解析）', () => {
    const r = parseAction('请把结果记录到知识库，并把这一单标记完成')
    expect(r).toEqual({ ok: false, reason: 'not-an-action', needsLlmFallback: true })
  })

  test('试图结构化但坏了（行首 @action 却动词/JSON 非法且含中文）→ 纯拒不走中文回退', () => {
    expect(parseAction('@action 评论 {}')).toEqual({ ok: false, reason: 'unknown-verb' })
    expect(parseAction('@action comment {"正文"}')).toEqual({ ok: false, reason: 'bad-json' })
    expect(parseAction('@action 评论')).toEqual({ ok: false, reason: 'bad-format' }) // 残缺+中文也不回退
    const r = parseAction('@action comment {body}')
    expect(r).toEqual({ ok: false, reason: 'bad-json' })
    expect('needsLlmFallback' in r && r.needsLlmFallback).toBeFalsy()
  })
})
