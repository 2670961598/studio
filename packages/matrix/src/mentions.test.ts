/**
 * mentions.ts 单测：@唤醒解析（防误报、中英文混合、空消息、去重、提取投影）
 * 纯函数直测，零 IO（docs/21-§四 有界对话纪律的防误报口径全部落 case）
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_ID_PATTERN,
  extractRoomMessages,
  parseMentions,
  stripNonConversational,
  type MatrixRoomMessage,
} from './mentions.ts'

const COMPANY = 'acme'

function msg(overrides: Partial<MatrixRoomMessage> = {}): MatrixRoomMessage {
  return {
    eventId: '$e1',
    roomId: '!dept-1:localhost',
    sender: '@producer:localhost',
    msgtype: 'm.text',
    body: '',
    ...overrides,
  }
}

function targets(intents: ReturnType<typeof parseMentions>): string[] {
  return intents.map((i) => (i.payload as { target: string }).target)
}

describe('parseMentions · 基本识别', () => {
  it('纯 @工号 唤起：kind/company/source/payload 全字段', () => {
    const intents = parseMentions(msg({ body: '@AGENT-3 看下 STUDIO-100 的阻塞' }), { company: COMPANY })
    expect(intents).toHaveLength(1)
    const i = intents[0]
    if (i === undefined) throw new Error('unreachable')
    expect(i.kind).toBe('mention')
    expect(i.company).toBe(COMPANY)
    expect(i.source).toBe('matrix')
    expect(i.ticket).toBeUndefined()
    expect(i.payload).toEqual({
      target: 'AGENT-3',
      mention: '@AGENT-3',
      text: '@AGENT-3 看下 STUDIO-100 的阻塞',
      eventId: '$e1',
      sender: '@producer:localhost',
      room: '!dept-1:localhost',
      channel: '!dept-1:localhost',
    })
  })

  it('@角色词 经映射表唤起（@宰相）', () => {
    const intents = parseMentions(msg({ body: '@宰相 请落单' }), {
      company: COMPANY,
      roles: { 宰相: 'PRIME-0', 制作人: 'PRODUCER-0' },
    })
    expect(targets(intents)).toEqual(['PRIME-0'])
    const p = intents[0]?.payload as { mention: string }
    expect(p.mention).toBe('@宰相')
  })

  it('@角色词 与 @工号 同现 → 按出现顺序各一条', () => {
    const intents = parseMentions(msg({ body: '@宰相 和 @AGENT-3 对齐一下' }), {
      company: COMPANY,
      roles: { 宰相: 'PRIME-0' },
    })
    expect(targets(intents)).toEqual(['PRIME-0', 'AGENT-3'])
  })

  it('完整 MXID（@AGENT-3:localhost）按工号段识别', () => {
    const intents = parseMentions(msg({ body: 'cc @AGENT-4:localhost' }), { company: COMPANY })
    expect(targets(intents)).toEqual(['AGENT-4'])
  })

  it('roomAlias 存在时 channel 用别名，room 保持 room_id', () => {
    const intents = parseMentions(
      msg({ body: '@AGENT-3 到大厅', roomAlias: '#acme-大厅:localhost' }),
      { company: COMPANY },
    )
    const p = intents[0]?.payload as { room: string; channel: string }
    expect(p.room).toBe('!dept-1:localhost')
    expect(p.channel).toBe('#acme-大厅:localhost')
  })

  it('多个不同对象 → 多条；同一对象重复 @ → 去重为一条（一次@一人）', () => {
    expect(
      targets(parseMentions(msg({ body: '@AGENT-3 @AGENT-4 @AGENT-3' }), { company: COMPANY })),
    ).toEqual(['AGENT-3', 'AGENT-4'])
  })
})

describe('parseMentions · 防误报', () => {
  it('围栏代码块内的 @ 不唤起', () => {
    const body = '看这段\n```\n@AGENT-3 do something\n```\n谢谢'
    expect(parseMentions(msg({ body }), { company: COMPANY })).toEqual([])
  })

  it('未闭合围栏（开头 ``` 后全部视为代码）也不唤起', () => {
    const body = '```\n@AGENT-3'
    expect(parseMentions(msg({ body }), { company: COMPANY })).toEqual([])
  })

  it('引用行内的 @ 不唤起（含 Matrix 回复 fallback）', () => {
    const body = '> <@AGENT-3:localhost> 原来的问题\n收到，另请 @AGENT-4 复核'
    const intents = parseMentions(msg({ body }), { company: COMPANY })
    expect(targets(intents)).toEqual(['AGENT-4'])
  })

  it('纯引用（整条都是引用行）不唤起', () => {
    expect(parseMentions(msg({ body: '> @AGENT-3 帮我' }), { company: COMPANY })).toEqual([])
  })

  it('行内代码内的 @ 不唤起', () => {
    expect(parseMentions(msg({ body: '跑 `@AGENT-3 --dry-run` 试试' }), { company: COMPANY })).toEqual([])
  })

  it('词中缀 @（邮箱/账号）不唤起', () => {
    expect(parseMentions(msg({ body: '发到 user@AGENT-3 邮箱' }), { company: COMPANY })).toEqual([])
  })

  it('小写工号不匹配默认样式；未配置的角色词不唤起', () => {
    expect(parseMentions(msg({ body: '@agent-3 @皇帝' }), { company: COMPANY })).toEqual([])
  })

  it('msgtype 非 m.text（m.notice/m.image/未标）只有 m.text 与未标可唤起', () => {
    expect(parseMentions(msg({ body: '@AGENT-3', msgtype: 'm.notice' }), { company: COMPANY })).toEqual([])
    expect(parseMentions(msg({ body: '@AGENT-3', msgtype: 'm.image' }), { company: COMPANY })).toEqual([])
    // 未标 msgtype 的裸 body：视为 m.text，可唤起
    const bare: MatrixRoomMessage = {
      eventId: '$bare',
      roomId: '!dept-1:localhost',
      sender: '@producer:localhost',
      body: '@AGENT-3',
    }
    expect(targets(parseMentions(bare, { company: COMPANY }))).toEqual(['AGENT-3'])
  })
})

describe('parseMentions · 非唤醒与边界', () => {
  it('空消息 / 纯空白 不唤起', () => {
    expect(parseMentions(msg({ body: '' }), { company: COMPANY })).toEqual([])
    expect(parseMentions(msg({ body: '  \n\t ' }), { company: COMPANY })).toEqual([])
  })

  it('普通中英文消息不唤起', () => {
    expect(parseMentions(msg({ body: '今天发布顺利 thanks all' }), { company: COMPANY })).toEqual([])
    expect(parseMentions(msg({ body: 'no mention here, just @ small talk' }), { company: COMPANY })).toEqual([])
  })

  it('中英文混合中 @工号 正常唤起（@ 紧贴前文汉字）', () => {
    const intents = parseMentions(msg({ body: '请@AGENT-3 review PR，截止今晚' }), { company: COMPANY })
    expect(targets(intents)).toEqual(['AGENT-3'])
  })

  it('agentIdPattern 可覆盖默认样式', () => {
    const intents = parseMentions(msg({ body: 'hey @bot-9 上线' }), {
      company: COMPANY,
      agentIdPattern: /^bot-\d+$/,
    })
    expect(targets(intents)).toEqual(['bot-9'])
  })

  it('默认工号样式要求至少一个连字符段（@NOTE 类大写词不误报）', () => {
    expect(DEFAULT_AGENT_ID_PATTERN.test('AGENT-3')).toBe(true)
    expect(DEFAULT_AGENT_ID_PATTERN.test('NOTE')).toBe(false)
    expect(parseMentions(msg({ body: 'see @NOTE above' }), { company: COMPANY })).toEqual([])
  })
})

describe('stripNonConversational', () => {
  it('剔除围栏与引用行，保留正文行', () => {
    const out = stripNonConversational('> 引用\n正文 A\n```\ncode\n```\n正文 B')
    expect(out).toBe('正文 A\n正文 B')
  })
})

describe('extractRoomMessages', () => {
  it('只投影 type=m.room.message 且字段合法的事件', () => {
    const sync = {
      next_batch: 't2',
      rooms: {
        join: {
          '!dept:localhost': {
            timeline: {
              events: [
                { type: 'm.room.member', event_id: '$x1', sender: '@a:localhost', content: { membership: 'join' } },
                { type: 'm.room.message', event_id: '$m1', sender: '@a:localhost', content: { msgtype: 'm.text', body: 'hi' } },
                { type: 'm.room.message', event_id: '$m2', sender: '@a:localhost', content: { body: 42 } }, // body 非字符串
                { type: 'm.room.message', sender: '@a:localhost', content: { body: 'no id' } }, // 缺 event_id
                'not-an-object',
              ],
            },
          },
          '!hall:localhost': { timeline: { events: [{ type: 'm.room.message', event_id: '$m3', sender: '@b:localhost', content: { body: '@AGENT-3 来' } }] } },
          '!empty:localhost': {},
        },
      },
    }
    const messages = extractRoomMessages(sync)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ eventId: '$m1', roomId: '!dept:localhost', sender: '@a:localhost', msgtype: 'm.text', body: 'hi' })
    expect(messages[1]).toEqual({ eventId: '$m3', roomId: '!hall:localhost', sender: '@b:localhost', body: '@AGENT-3 来' })
  })

  it('无 rooms.join 时返回空数组', () => {
    expect(extractRoomMessages({ next_batch: 't1' })).toEqual([])
    expect(extractRoomMessages({})).toEqual([])
  })
})

describe('dedupKey 源侧设置（105-刀A A-1，21A-§5.10 勘误后口径）', () => {
  it('每条 mention 意图 dedupKey=eventId', () => {
    const intents = parseMentions(msg({ body: '@AGENT-3 看', eventId: '$wake-1' }), { company: COMPANY })
    expect(intents).toHaveLength(1)
    expect(intents[0]?.dedupKey).toBe('$wake-1')
  })

  it('同一消息多目标：多条意图同 dedupKey（引擎幂等键按一次@一人折叠——契约面留痕）', () => {
    const intents = parseMentions(msg({ body: '@AGENT-3 @WORKER-2 都看下', eventId: '$wake-2' }), { company: COMPANY })
    expect(targets(intents)).toEqual(['AGENT-3', 'WORKER-2'])
    expect(new Set(intents.map((i) => i.dedupKey))).toEqual(new Set(['$wake-2']))
  })
})

describe('parseMentions · m.mentions.user_ids 互补路（105-刀A A-4，F2/F3）', () => {
  it('正文无 @ 词元但 user_ids 列工号 → 仍唤起（pill 点选场景）', () => {
    const intents = parseMentions(
      msg({ body: '请确认 X 的方案', mentions: { userIds: ['@agent-3:localhost'] } }),
      { company: COMPANY },
    )
    expect(targets(intents)).toEqual(['AGENT-3'])
    const p = intents[0]?.payload as { mention: string }
    expect(p.mention).toBe('@AGENT-3')
  })

  it('user_ids 命中 bot（selfUserId）与发送者本人 → 不算唤醒', () => {
    const intents = parseMentions(
      msg({
        sender: '@producer:localhost',
        mentions: { userIds: ['@bot:localhost', '@producer:localhost', '@agent-3:localhost'] },
      }),
      { company: COMPANY, selfUserId: '@bot:localhost' },
    )
    expect(targets(intents)).toEqual(['AGENT-3'])
  })

  it('user_ids 与正文词元命中同一目标 → 去重为一条；两路不同目标 → 各一条', () => {
    const both = parseMentions(
      msg({ body: '@AGENT-3 复核', mentions: { userIds: ['@agent-3:localhost', '@worker-2:localhost'] } }),
      { company: COMPANY },
    )
    expect(targets(both)).toEqual(['AGENT-3', 'WORKER-2'])
  })

  it('user_ids 的 MXID localpart 大写化后过同一工号样式：非工号形状不唤起', () => {
    const intents = parseMentions(
      msg({ mentions: { userIds: ['@randomperson:localhost', '@agent-3:localhost'] } }),
      { company: COMPANY },
    )
    expect(targets(intents)).toEqual(['AGENT-3'])
  })

  it('user_ids 走 roles 样式同样适用（agentIdPattern 覆盖样式后 pill 路同步生效）', () => {
    const intents = parseMentions(
      msg({ mentions: { userIds: ['@dev7:localhost'] } }),
      { company: COMPANY, agentIdPattern: /^dev\d+$/ },
    )
    expect(targets(intents)).toEqual(['dev7'])
  })

  it('msgtype 非 m.text 时 user_ids 路同样关闭（m.notice 一律空）', () => {
    const intents = parseMentions(
      msg({ msgtype: 'm.notice', mentions: { userIds: ['@agent-3:localhost'] } }),
      { company: COMPANY },
    )
    expect(intents).toEqual([])
  })
})

describe('extractRoomMessages · m.mentions 投影', () => {
  it('content.m.mentions.user_ids 投影为 mentions.userIds；形状不符整段丢弃（不猜）', () => {
    const sync = {
      next_batch: 't2',
      rooms: {
        join: {
          '!dept:localhost': {
            timeline: {
              events: [
                {
                  type: 'm.room.message', event_id: '$m1', sender: '@a:localhost',
                  content: { msgtype: 'm.text', body: 'hi', 'm.mentions': { user_ids: ['@agent-3:localhost'] } },
                },
                {
                  type: 'm.room.message', event_id: '$m2', sender: '@a:localhost',
                  content: { msgtype: 'm.text', body: 'yo', 'm.mentions': { user_ids: 'not-array' } },
                },
                {
                  type: 'm.room.message', event_id: '$m3', sender: '@a:localhost',
                  content: { msgtype: 'm.text', body: 'zz', 'm.mentions': 'garbage' },
                },
              ],
            },
          },
        },
      },
    }
    const messages = extractRoomMessages(sync)
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      eventId: '$m1', roomId: '!dept:localhost', sender: '@a:localhost',
      msgtype: 'm.text', body: 'hi', mentions: { userIds: ['@agent-3:localhost'] },
    })
    expect(messages[1]?.mentions).toBeUndefined()
    expect(messages[2]?.mentions).toBeUndefined()
  })
})
