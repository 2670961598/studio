/**
 * 持久对话配置面测试（studio-dev-646 Phase 1，docs/21-§七.6）
 *
 * 覆盖：五键解析/缺省目录推导；conversation ⇒ matrix + producer + rooms 交叉校验；
 * 缺省岗位样式、窗口/字数预算边界明报（fail-closed 不猜）。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDaemonConfig } from '../../../src/assembly/serve.ts'

const BASE = [
  'db: ./var/ledger.sqlite',
  'company: studio-dev',
  'rootDir: ./var',
  'platform: fake',
  'matrix: true',
  'matrixHomeserverUrl: http://127.0.0.1:8008',
  'matrixUserId: "@bot:localhost"',
  'matrixProducerMxid: "@producer:localhost"',
  'conversation: true',
  "conversationRooms: '!dm:localhost;!dm2:localhost'",
].join('\n')

describe('conversation 配置面', () => {
  it('合法配置：房间列表解析、缺省目录=<rootDir>/conversations、窗口缺省 12/6000/2000/12000', () => {
    const cfg = parseDaemonConfig(BASE)
    expect(cfg.conversation).toBe(true)
    expect(cfg.conversationRooms).toEqual(['!dm:localhost', '!dm2:localhost'])
    expect(cfg.conversationDir).toBe(path.join('./var', 'conversations'))
    expect(cfg.conversationDefaultPerson).toBe('PRIME-0')
    expect(cfg.conversationWindow).toBe(12)
    expect(cfg.conversationMaxChars).toBe(6000)
    expect(cfg.conversationMaxMessageChars).toBe(2000)
    expect(cfg.conversationReplyMaxChars).toBe(12000)
  })

  it('显式窗口/预算覆盖生效', () => {
    const cfg = parseDaemonConfig(`${BASE}\nconversationWindow: 6\nconversationMaxChars: 3000\nconversationMaxMessageChars: 800\nconversationReplyMaxChars: 9000\nconversationDir: /tmp/conv`)
    expect(cfg.conversationWindow).toBe(6)
    expect(cfg.conversationMaxChars).toBe(3000)
    expect(cfg.conversationMaxMessageChars).toBe(800)
    expect(cfg.conversationReplyMaxChars).toBe(9000)
    expect(cfg.conversationDir).toBe('/tmp/conv')
  })

  it('conversation: false（缺省）→ 不校验其余键、行为零变', () => {
    const cfg = parseDaemonConfig(BASE.replace('conversation: true', 'conversation: false'))
    expect(cfg.conversation).toBe(false)
    expect(cfg.conversationDir).toBeUndefined()
  })

  it('conversation: true 缺 matrix → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(BASE.replace('matrix: true', 'matrix: false'))).toThrow(/matrix: true/)
  })

  it('缺 conversationRooms / matrixProducerMxid → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(BASE.replace(/conversationRooms:.*\n?/, ''))).toThrow(/conversationRooms/)
    expect(() => parseDaemonConfig(BASE.replace(/matrixProducerMxid:.*\n?/, ''))).toThrow(/matrixProducerMxid/)
  })

  it('房间非 room_id / 缺省岗位样式坏 / 单条预算大于总预算 → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(BASE.replace("'!dm:localhost;!dm2:localhost'", "'hall'"))).toThrow(/room_id/)
    expect(() => parseDaemonConfig(`${BASE}\nconversationDefaultPerson: prime`)).toThrow(/工号样式/)
    expect(() => parseDaemonConfig(`${BASE}\nconversationMaxChars: 1000\nconversationMaxMessageChars: 2000`)).toThrow(/不得大于/)
  })
})
