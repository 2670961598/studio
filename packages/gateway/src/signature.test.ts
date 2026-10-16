/**
 * 署名注入测试 —— [公司·部门·岗位·级别] 冻结格式 + SignedBody v1.2 形状（17-§7、25-§3.2）
 */
import { describe, expect, test } from 'vitest'
import { composeSignature, signedBody } from './signature.ts'
import type { SignatureContext } from './signature.ts'

const CTX: SignatureContext = { company: '指尖游戏', dept: '平台部', role: '工程师', level: 3 }

describe('composeSignature', () => {
  test('格式冻结：[公司·部门·岗位·级别]，中点分隔，级别数字直写', () => {
    expect(composeSignature(CTX)).toBe('[指尖游戏·平台部·工程师·3]')
  })

  test('四段全填充：中点恰三个', () => {
    const sig = composeSignature(CTX)
    expect(sig.startsWith('[')).toBe(true)
    expect(sig.endsWith(']')).toBe(true)
    expect(sig.split('·')).toHaveLength(4)
  })

  test('空字段抛 CONFIG_INVALID/gw-signature-*（公司/部门/岗位任一为空）', () => {
    expect(() => composeSignature({ ...CTX, company: '' })).toThrowError(/CONFIG_INVALID\/gw-signature-empty-field/)
    expect(() => composeSignature({ ...CTX, dept: '' })).toThrowError(/CONFIG_INVALID\/gw-signature-empty-field/)
    expect(() => composeSignature({ ...CTX, role: '' })).toThrowError(/CONFIG_INVALID\/gw-signature-empty-field/)
  })

  test('级别非法抛 CONFIG_INVALID/gw-signature-bad-level（0/负/小数/NaN）', () => {
    for (const level of [0, -1, 1.5, Number.NaN]) {
      expect(() => composeSignature({ ...CTX, level })).toThrowError(/CONFIG_INVALID\/gw-signature-bad-level/)
    }
  })
})

describe('signedBody（contract v1.2：author=工号）', () => {
  test('返回三字段：author/body 原文/signature 落款（正文不改写）', () => {
    const sb = signedBody(CTX, 'P-001', '证据已落盘：REPORT.md')
    expect(sb).toEqual({ author: 'P-001', body: '证据已落盘：REPORT.md', signature: '[指尖游戏·平台部·工程师·3]' })
  })

  test('空工号抛 CONFIG_INVALID/gw-signature-empty-author；空正文放行（正文语义归上层）', () => {
    expect(() => signedBody(CTX, '', 'x')).toThrowError(/CONFIG_INVALID\/gw-signature-empty-author/)
    expect(signedBody(CTX, 'P-001', '').body).toBe('')
  })
})
