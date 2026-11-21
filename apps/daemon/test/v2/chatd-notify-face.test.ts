/**
 * chatd-notify-face 测试（M5 尾收口，plan/09-…-2026-11-21.md §二#3）
 *
 * 覆盖（判例=chatd-mention-source.test.ts 同款纪律；matrix 广播面软失败契约刀B-6）：
 *   - 消息形状：send → transport.sendMessage 一条纯文本（roomId/senderId 直通；body=
 *     formatChatdNotification 无 markdown 形；mentions/幂等键恒不携带——无重试面，内容
 *     哈希键会吞并同文异事件通知）；report.sent 逐角色点名；
 *   - 角色折叠：alert/overview/dept 三逻辑角色共投配置房**恰一条**；显式 targets.room
 *     直投该房（同房并入同一条）；空角色零发送零报告（matrix 面 roles 空循环同语义）；
 *   - 软失败：WB_TIMEOUT/WB_UNAVAILABLE（transport）/WB_INVALID_ARGUMENT unauthenticated
 *     （config）/非 WB_*（unknown）→ send 永不抛出、failed 入报告、日志带 [chatd-notify]
 *     前缀与分类（不炸主循环——relay 刀B-6 契约第一道）；
 *   - 密钥纪律：token 随请求上帧（鉴权面），但日志/failed.reason 永不含 token 值；
 *   - 配置面：notifyChatdRoomId 非空/senderId 工号样式/孤儿 senderId/与 matrix 及
 *     matrixChannels 互斥/chatdSocket 复用与缺省推导——解析即拒（CONFIG_INVALID）。
 *
 * 边界：不触 matrix 路径（daemon 本体零 matrix import 不变）；mock transport，零真 socket。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Notification } from '@studio-next/contract'
import { createChatdNotifyFace, formatChatdNotification, type ChatdNotifyTransportPort } from '../../src/assembly/serve/chatd-notify-face.ts'
import { parseDaemonConfig } from '../../src/assembly/serve/config.ts'

// ————————————————————————— fake transport（内存态；只记录 sendMessage） —————————————————————————

const wbError = (code: string, message: string): Error => Object.assign(new Error(message), { code })

type SendCall = { roomId: string; senderId: string; body: string; mentions?: readonly string[]; idempotencyKey?: string; token?: string }

class FakeNotifyChatd {
  readonly sends: SendCall[] = []
  /** 旋钮：置值后每次 sendMessage 抛该错误（软失败测试） */
  failWith: Error | undefined

  implementsPort(): ChatdNotifyTransportPort {
    return {
      sendMessage: async (input): Promise<{ seq: number; roomSeq: number; messageId: string; replayed: boolean }> => {
        if (this.failWith !== undefined) throw this.failWith
        this.sends.push({ ...input })
        return { seq: this.sends.length, roomSeq: this.sends.length, messageId: `msg-${String(this.sends.length)}`, replayed: false }
      },
    }
  }
}

function fixture(options: { token?: string; roomId?: string; senderId?: string } = {}): {
  chatd: FakeNotifyChatd
  logs: string[]
  face: ReturnType<typeof createChatdNotifyFace>
} {
  const chatd = new FakeNotifyChatd()
  const logs: string[] = []
  const face = createChatdNotifyFace({
    socketPath: '/tmp/sn-test-chat.sock',
    roomId: options.roomId ?? 'room-notify-1',
    senderId: options.senderId ?? 'PRIME-0',
    transport: chatd.implementsPort(),
    ...(options.token !== undefined ? { token: options.token } : {}),
    log: (line) => logs.push(line),
  })
  return { chatd, logs, face }
}

const NOTICE: Notification = {
  kind: 'gate',
  title: '单据被拒',
  body: 'LOCAL-1 验收不过：REPORT 缺失',
  from: 'daemon@demo',
  links: [{ label: '面板', url: 'http://127.0.0.1:8789/demo' }],
}

// ————————————————————————— 消息形状 —————————————————————————

describe('消息形状（纯文本一条；结构同形 NotifyBroadcastFace）', () => {
  it('alert → 恰一条 sendMessage：roomId/senderId 直通、body 为无 markdown 纯文本、无 mentions/幂等键；sent 逐角色点名', async () => {
    const f = fixture({ token: 'tok-face-1' })
    const report = await f.face.send(NOTICE, { alert: true })
    expect(f.chatd.sends).toHaveLength(1)
    const send = f.chatd.sends[0]
    if (send === undefined) throw new Error('未发生 sendMessage')
    expect(send.roomId).toBe('room-notify-1')
    expect(send.senderId).toBe('PRIME-0')
    expect(send.body).toBe(['[gate] 单据被拒', 'LOCAL-1 验收不过：REPORT 缺失', '- 面板: http://127.0.0.1:8789/demo', '—— daemon@demo'].join('\n'))
    expect(send.body).not.toContain('**') // chatd 纯文本渲染面：markdown 记号只会成字面噪音
    expect('mentions' in send).toBe(false) // 通知非唤醒：不产 wake
    expect('idempotencyKey' in send).toBe(false) // 幂等决策：无重试面；内容哈希键会吞并同文异事件通知
    expect(send.token).toBe('tok-face-1') // 鉴权随请求上帧（服务端 params.token 常时比较）
    expect(report).toEqual({ sent: ['alert'], failed: [] })
  })

  it('senderId 显式配置直通（如 AGENT-2）', async () => {
    const f = fixture({ senderId: 'AGENT-2' })
    await f.face.send(NOTICE, { overview: true })
    expect(f.chatd.sends[0]?.senderId).toBe('AGENT-2')
  })

  it('三逻辑角色折叠为同房恰一条（sent 仍逐角色点名——惊动计量 byRole 口径不漂移）', async () => {
    const f = fixture()
    const report = await f.face.send(NOTICE, { alert: true, overview: true, dept: 'departments/研发部' })
    expect(f.chatd.sends).toHaveLength(1)
    expect(report.sent).toEqual(['alert', 'overview', 'dept:departments/研发部'])
    expect(report.failed).toEqual([])
  })

  it('显式 targets.room 直投该房（不做解析）；与逻辑角色同房=并入同一条、异房=各自一条', async () => {
    const same = fixture()
    const r1 = await same.face.send(NOTICE, { alert: true, room: 'room-notify-1' })
    expect(same.chatd.sends).toHaveLength(1)
    expect(r1.sent).toEqual(['alert', 'room'])

    const other = fixture()
    const r2 = await other.face.send(NOTICE, { alert: true, room: 'room-dm-7' })
    expect(other.chatd.sends.map((s) => s.roomId)).toEqual(['room-notify-1', 'room-dm-7'])
    expect(r2.sent).toEqual(['alert', 'room'])

    const only = fixture()
    const r3 = await only.face.send(NOTICE, { room: 'room-dm-7' })
    expect(only.chatd.sends.map((s) => s.roomId)).toEqual(['room-dm-7'])
    expect(r3.sent).toEqual(['room'])
  })

  it('空角色（无 alert/overview/dept/room）→ 零发送零报告（matrix 面 roles 空循环同语义）', async () => {
    const f = fixture()
    const report = await f.face.send(NOTICE, {})
    expect(f.chatd.sends).toHaveLength(0)
    expect(report).toEqual({ sent: [], failed: [] })
  })

  it('格式化纯函数：空 kind/title 折叠、links 空 url 跳过、无 from 尾行省略', () => {
    expect(formatChatdNotification({ kind: '', title: '', body: '正文' })).toBe('正文')
    expect(formatChatdNotification({ kind: 'k', title: 't', body: 'b', links: [{ label: '', url: ' ' }] })).toBe('[k] t\nb')
    expect(formatChatdNotification({ kind: 'k', title: 't', body: 'b', from: '' })).toBe('[k] t\nb')
  })
})

// ————————————————————————— 软失败（send 永不抛——刀B-6 第一道） —————————————————————————

describe('软失败分类（不炸主循环；面板仍 critical 第一落点）', () => {
  it('WB_UNAVAILABLE → 分类=transport：resolve 不抛、failed 入报告、日志带 [chatd-notify] 前缀', async () => {
    const f = fixture()
    f.chatd.failWith = wbError('WB_UNAVAILABLE', 'socket closed')
    const report = await f.face.send(NOTICE, { alert: true })
    expect(report.sent).toEqual([])
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.target).toBe('alert')
    expect(report.failed[0]?.reason).toContain('分类=transport')
    expect(report.failed[0]?.reason).toContain('WB_UNAVAILABLE')
    const line = f.logs.find((l) => l.startsWith('[chatd-notify]'))
    expect(line).toBeDefined()
    expect(line).toContain('分类=transport')
    expect(line).toContain('room=room-notify-1')
  })

  it('WB_INVALID_ARGUMENT unauthenticated → 分类=config（明报 token 供给面，不拒启不炸循环）', async () => {
    const f = fixture({ token: 'tok-wrong-1' })
    f.chatd.failWith = wbError('WB_INVALID_ARGUMENT', 'unauthenticated: token invalid')
    const report = await f.face.send(NOTICE, { overview: true })
    expect(report.failed[0]?.reason).toContain('分类=config')
    expect(report.failed[0]?.reason).toContain('WORKBENCH_CHATD_TOKEN')
  })

  it('非 WB_* 错误 → 分类=unknown 同走软失败面（resolve 不抛）', async () => {
    const f = fixture()
    f.chatd.failWith = new Error('boom-plain')
    const report = await f.face.send(NOTICE, { alert: true, room: 'room-dm-7' })
    expect(report.sent).toEqual([])
    expect(report.failed.map((x) => x.target)).toEqual(['alert', 'room'])
    expect(report.failed.every((x) => x.reason.includes('分类=unknown'))).toBe(true)
  })

  it('部分房间失败不阻其余（逐房隔离——matrix 面同款逐频道隔离语义）', async () => {
    const f = fixture()
    let n = 0
    const chatd = f.chatd
    const port: ChatdNotifyTransportPort = {
      sendMessage: async (input) => {
        n += 1
        chatd.sends.push({ ...input })
        if (input.roomId === 'room-notify-1') throw wbError('WB_TIMEOUT', 'request timeout')
        return { seq: n, roomSeq: n, messageId: `m-${String(n)}`, replayed: false }
      },
    }
    const logs: string[] = []
    const face = createChatdNotifyFace({ socketPath: '/tmp/x.sock', roomId: 'room-notify-1', senderId: 'PRIME-0', transport: port, log: (l) => logs.push(l) })
    const report = await face.send(NOTICE, { alert: true, room: 'room-dm-7' })
    expect(report.sent).toEqual(['room'])
    expect(report.failed.map((x) => x.target)).toEqual(['alert'])
  })
})

// ————————————————————————— 密钥纪律 —————————————————————————

describe('token 不落日志/报告（红名单——值仅随请求附参）', () => {
  it('失败面日志与 failed.reason 均不含 token 值；请求上帧仍携带', async () => {
    const token = 'sekrit-tok-do-not-log'
    const f = fixture({ token })
    f.chatd.failWith = wbError('WB_UNAVAILABLE', `socket closed (${token})`) // 错误消息被服务端回显时也不得透传面放大
    const report = await f.face.send(NOTICE, { alert: true })
    const joined = [...f.logs, ...report.failed.map((x) => x.reason)].join('\n')
    expect(joined).not.toContain('sekrit-tok-do-not-log')
    expect(joined).toContain('[chatd-notify]')
  })

  it('未配 token → 请求不携 token 键（chatd ALLOW_NO_AUTH 面合法）', async () => {
    const f = fixture()
    await f.face.send(NOTICE, { alert: true })
    expect('token' in (f.chatd.sends[0] ?? {})).toBe(false)
  })
})

// ————————————————————————— 配置面（解析即拒——CONFIG_INVALID fail-closed） —————————————————————————

const TMP = mkdtempSync(path.join(tmpdir(), 'sn-chatd-notify-cfg-'))
const BASE = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('notifyChatdRoomId/notifyChatdSenderId（解析与交叉面）', () => {
  it('缺省零漂移：两键不写=undefined（面关零行为，现状不回归）', () => {
    const cfg = parseDaemonConfig(BASE)
    expect(cfg.notifyChatdRoomId).toBeUndefined()
    expect(cfg.notifyChatdSenderId).toBeUndefined()
  })

  it('roomId 直通＋senderId 直通；mention 源已推导 socket 则复用', () => {
    const sock = path.join(TMP, 'chat.sock')
    const cfg = parseDaemonConfig(
      [BASE, 'mentionSource: chatd', `chatdSocket: ${JSON.stringify(sock)}`, 'notifyChatdRoomId: "room-9"', 'notifyChatdSenderId: "AGENT-2"'].join('\n'),
    )
    expect(cfg.notifyChatdRoomId).toBe('room-9')
    expect(cfg.notifyChatdSenderId).toBe('AGENT-2')
    expect(cfg.chatdSocket).toBe(sock)
  })

  it('mention 源未开（缺省 matrix）＋companyDir → chatdSocket 缺省推导（同款生产约定路径）', () => {
    const companyDir = path.join(TMP, 'company-b')
    const cfg = parseDaemonConfig([BASE, `companyDir: ${JSON.stringify(companyDir)}`, 'notifyChatdRoomId: "room-9"'].join('\n'))
    expect(cfg.chatdSocket).toBe(path.join(path.resolve(companyDir), 'var/workbench/chat.sock'))
  })

  it('roomId 空字符串 → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(`${BASE}\nnotifyChatdRoomId: ""`)).toThrow(/notifyChatdRoomId 须为非空字符串/)
  })

  it('senderId 非工号样式 → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(`${BASE}\nnotifyChatdRoomId: "room-9"\nnotifyChatdSenderId: "bot"`)).toThrow(/notifyChatdSenderId 须为工号样式/)
  })

  it('孤儿 senderId（无 roomId）→ CONFIG_INVALID（成对键：键在场即被消费）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nnotifyChatdSenderId: "PRIME-0"`)).toThrow(/notifyChatdSenderId 单独在场缺 notifyChatdRoomId/)
  })

  it('与 matrixChannels: true 互斥 → CONFIG_INVALID（notify 出口单一——双开=双写）', () => {
    const text = [
      BASE,
      'notifyChatdRoomId: "room-9"',
      `chatdSocket: ${JSON.stringify(path.join(TMP, 'chat.sock'))}`,
      'matrixChannels: true',
      `matrixDeptMap: ${JSON.stringify(path.join(TMP, 'dept.json'))}`,
      `companyDir: ${JSON.stringify(TMP)}`,
    ].join('\n')
    expect(() => parseDaemonConfig(text)).toThrow(/notifyChatdRoomId 与 matrixChannels: true 互斥/)
  })

  it('与 matrix: true 互斥 → CONFIG_INVALID（键在场不被消费=配置漂移）', () => {
    const text = [
      BASE,
      'notifyChatdRoomId: "room-9"',
      `chatdSocket: ${JSON.stringify(path.join(TMP, 'chat.sock'))}`,
      'matrix: true',
      'matrixHomeserverUrl: http://127.0.0.1:8008',
      'matrixUserId: @bot:studio.local',
    ].join('\n')
    expect(() => parseDaemonConfig(text)).toThrow(/notifyChatdRoomId 与 matrix: true 互斥/)
  })

  it('缺 chatdSocket 又无 companyDir → CONFIG_INVALID（不猜 cwd 相对路径）', () => {
    expect(() => parseDaemonConfig(`${BASE}\nnotifyChatdRoomId: "room-9"`)).toThrow(/缺 chatdSocket 且无 companyDir/)
  })
})
