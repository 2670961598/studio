/**
 * 出站脱敏测试（DEV-48，docs/52-§十二 + AGENTS 纪律 6）：已知秘密值替换（长度降序防截尾）/ 短值不动 /
 * 形状兜底（Bearer/赋值对/独立长串）/ 已知值与形状的合成顺序 / 明确不扫面（短 ULID、中文正文）。
 */
import { describe, expect, it } from 'vitest'
import { findSecretShaped, redactKnownSecrets, redactOutbound } from '../src/secrets.ts'

describe('redactKnownSecrets：已知值替换', () => {
  it('命中值→<redacted:N>（N=原长，不回内容）；多处全换', () => {
    expect(redactKnownSecrets('密码 s3cret-value 错误', ['s3cret-value'])).toBe('密码 <redacted:12> 错误')
    expect(redactKnownSecrets('a=x1b2c3d4e5 b=x1b2c3d4e5', ['x1b2c3d4e5'])).toBe('a=<redacted:10> b=<redacted:10>')
  })

  it('长度降序替换（短前缀不截断长值尾巴）', () => {
    const text = 'token=abcdefabcdef tail'
    const out = redactKnownSecrets(text, ['abcdefabcdef', 'abcdef'])
    expect(out).toBe('token=<redacted:12> tail')
  })

  it('短值（<6）不进名单（误伤面大于收益）；未出现值零动作', () => {
    expect(redactKnownSecrets('abc abc', ['abc'])).toBe('abc abc')
    expect(redactKnownSecrets('正文无秘密', ['totally-absent'])).toBe('正文无秘密')
  })

  it('名单去重', () => {
    expect(redactKnownSecrets('k=zzzz9999x', ['zzzz9999x', 'zzzz9999x'])).toBe('k=<redacted:9>')
  })
})

describe('findSecretShaped：形状检测（观测面）', () => {
  it('Bearer 头命中', () => {
    expect(findSecretShaped('Authorization: Bearer abcdef1234567890')).toEqual([{ kind: 'bearer', at: 'Authorization: '.length }])
  })

  it('赋值对命中（password/secret/shared_secret/token/mac…）', () => {
    expect(findSecretShaped('password: "hunter2hunter2"').map((f) => f.kind)).toContain('assignment')
    expect(findSecretShaped('shared_secret=abcd1234efgh5678').map((f) => f.kind)).toContain('assignment')
  })

  it('独立长串（≥32 base62/_-）命中；26 位 ULID 不命中', () => {
    expect(findSecretShaped('jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9qqq').some((f) => f.kind === 'long-token')).toBe(true)
    expect(findSecretShaped('01ARZ3NDEKTSV4RRFFQ69G5FAV').length).toBe(0)
  })

  it('普通中文正文零命中', () => {
    expect(findSecretShaped('任务完成：taiga 入：P-1→member（created=false）')).toEqual([])
  })
})

describe('redactOutbound：总闸（先已知值、后形状兜底）', () => {
  it('赋值对只换值段（键名保留——诊断价值）', () => {
    const out = redactOutbound('platform said: password=hunter2hunter2 denied')
    expect(out).toBe('platform said: password=<redacted:14> denied')
  })

  it('Bearer 尾替换、前缀保留', () => {
    const out = redactOutbound('Authorization: Bearer abcdef1234567890XYZ')
    expect(out).toBe('Authorization: Bearer <redacted:19>')
  })

  it('独立长串全替换', () => {
    const out = redactOutbound('响应含 aaaabbbbccccddddeeeeffffgggg1234')
    expect(out).toBe('响应含 <redacted:32>')
  })

  it('已知值先换（形状扫描不再看到原值）', () => {
    const known = 'qwertyuiopasdfghjklzxcvbnm1234' // 30 位
    const out = redactOutbound('secret=' + known + '!', [known])
    expect(out).toBe('secret=<redacted:30>!')
    expect(out.includes(known)).toBe(false)
  })

  it('普通错误消息零改写（不误伤）', () => {
    const msg = 'CONFIG_INVALID：hrMatrixRooms 缺 company= 项（docs/52-§7.2）'
    expect(redactOutbound(msg)).toBe(msg)
  })
})
