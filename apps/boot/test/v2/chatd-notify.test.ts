/**
 * chatd 通知面组合根接线测试（M5 尾收口，plan/09-…-2026-11-21.md §二#3）
 *
 * 覆盖（判例=chatd-mention.test.ts 同款装配纪律）：
 *   - 默认 inert：daemon.yaml 不写 notifyChatdRoomId → runServe opts.notifyBroadcast
 *     undefined、零工厂调用（fail-closed 现状不回归——缺键=面关零行为）；
 *   - 注入形态：notifyChatdRoomId（matrix: false）→ bootServe 注入 opts.notifyBroadcast
 *     （结构同形 NotifyBroadcastFace）；**零 matrix 登录**（env 无 MATRIX_BOT_PASSWORD、
 *     fetch 即炸）；工厂收 socketPath（companyDir 缺省推导）/roomId/senderId（缺省
 *     PRIME-0）/token（env WORKBENCH_CHATD_TOKEN）/超时（复用 mention 键组缺省
 *     5000/10000）；日志明示装配行与 socket/roomId/senderId/超时，**永不落 token 值**；
 *   - 与 chatd 唤醒源共存：mentionSource: chatd + notifyChatdRoomId → chatdSource 与
 *     notifyBroadcast 同时注入（同 socket 双面——唤醒/通知互不挤占）；
 *   - 互斥先炸：notifyChatdRoomId + matrix: true / matrixChannels: true → parse 面
 *     CONFIG_INVALID，serve 未被调（notify 出口单一）；
 *   - 装配面全假网：assembleChatdNotifyFace + mock transport → face.send 走一条
 *     sendMessage（纯文本体）；开关面不一致（无 notifyChatdRoomId 被调）→ CONFIG_INVALID。
 *
 * 边界：boot 不 import @studio-next/workbench-transport（依赖图无该边）——mock 与类型
 * 全部经 '@studio-next/daemon/serve' 再出口面消费；vi.mock 包真实现（行为零漂移，只记录
 * 装配面递给面工厂的 options）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Notification } from '@studio-next/contract'
import {
  createChatdNotifyFace,
  parseDaemonConfig,
  DEFAULT_CHATD_NOTIFY_SENDER_ID,
  type ChatdNotifyTransportPort,
  type ChatdSourceFactory,
  type NotifyBroadcastFace,
} from '@studio-next/daemon/serve'
import { assembleChatdNotifyFace, bootServe, DEFAULT_MENTION_CONNECT_TIMEOUT_MS, DEFAULT_MENTION_REQUEST_TIMEOUT_MS, WORKBENCH_CHATD_TOKEN_ENV } from '../../src/boot.ts'

// 旁听面：包住真 createChatdNotifyFace——实现零漂移，只记录 boot 装配面递给面工厂的 options
vi.mock('@studio-next/daemon/serve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@studio-next/daemon/serve')>()
  return { ...actual, createChatdNotifyFace: vi.fn(actual.createChatdNotifyFace) }
})

// ————————————————————————— mock transport（内存态；只记录 sendMessage） —————————————————————————

type NotifySendCall = { roomId: string; senderId: string; body: string; token?: string }

class FakeNotifyChatd implements ChatdNotifyTransportPort {
  readonly sends: NotifySendCall[] = []

  async sendMessage(input: { roomId: string; senderId: string; body: string; token?: string }): Promise<{ seq: number; roomSeq: number; messageId: string; replayed: boolean }> {
    this.sends.push({ ...input })
    return { seq: this.sends.length, roomSeq: this.sends.length, messageId: `m-${String(this.sends.length)}`, replayed: false }
  }
}

// ————————————————————————— 夹具 —————————————————————————

const roots: string[] = []

/** 面工厂旁听面（vi.mock 包真实现后的 spy 引用——断言 boot 递给工厂的 options） */
const notifyFaceFactorySpy = vi.mocked(createChatdNotifyFace)

afterEach(() => {
  notifyFaceFactorySpy.mockClear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** fake 栈 daemon.yaml（零外部依赖；parse 面走 daemon 同一条解析链） */
function writeYaml(lines: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-boot-chatd-notify-'))
  roots.push(root)
  const yamlPath = path.join(root, 'daemon.yaml')
  writeFileSync(
    yamlPath,
    [
      `db: ${JSON.stringify(path.join(root, 'ledger.sqlite'))}`,
      'platform: fake',
      'company: demo',
      `rootDir: ${JSON.stringify(path.join(root, 'var'))}`,
      ...lines,
    ].join('\n'),
    'utf8',
  )
  return yamlPath
}

const noNetworkFetch = (): Promise<never> =>
  Promise.reject(new Error('fetch 不应被调用（chatd notify 形态零 matrix 登录/零网络）'))

const NOTICE: Notification = { kind: 'gate', title: '单据被拒', body: 'LOCAL-1 验收不过', from: 'daemon@demo' }

// ————————————————————————— bootServe 接线面 —————————————————————————

describe('bootServe：chatd 通知面接线', () => {
  it('默认（不写 notifyChatdRoomId）→ opts.notifyBroadcast undefined、零工厂调用（fail-closed 现状不回归）', async () => {
    const yamlPath = writeYaml([])
    const seen: { path?: string; opts?: { chatdSource?: ChatdSourceFactory; notifyBroadcast?: NotifyBroadcastFace } }[] = []
    const logs: string[] = []
    const result = await bootServe({
      configPath: yamlPath,
      env: {},
      serve: async (configPath, opts) => {
        seen.push({ path: configPath, ...(opts !== undefined ? { opts } : {}) })
        return { ticks: 0, stopReason: 'stop-request' }
      },
      log: (line) => logs.push(line),
    })
    expect(result.stopReason).toBe('stop-request')
    expect(seen[0]?.opts).toBeUndefined() // 早退透传：matrix/channel/notify 面均未装配
    expect(notifyFaceFactorySpy).not.toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain('chatd notify 面已装配')
  })

  it('notifyChatdRoomId（matrix: false）→ 注入 opts.notifyBroadcast；零 matrix 登录；工厂收推导 socket/缺省 senderId/token/超时；日志不落 token 值', async () => {
    const companyDir = mkdtempSync(path.join(tmpdir(), 'sn-boot-chatd-notify-co-'))
    roots.push(companyDir)
    const yamlPath = writeYaml(['notifyChatdRoomId: "room-9"', `companyDir: ${JSON.stringify(companyDir)}`])
    const seen: { path?: string; opts?: { notifyBroadcast?: NotifyBroadcastFace; matrixSource?: unknown } }[] = []
    const logs: string[] = []
    await bootServe({
      configPath: yamlPath,
      env: { [WORKBENCH_CHATD_TOKEN_ENV]: 'test-token-boot-notify' }, // 不给 MATRIX_BOT_PASSWORD：零 matrix 依赖
      fetch: noNetworkFetch,
      serve: async (configPath, opts) => {
        seen.push({ path: configPath, ...(opts !== undefined ? { opts } : {}) })
        return { ticks: 0, stopReason: 'stop-request' }
      },
      log: (line) => logs.push(line),
    })
    const face = seen[0]?.opts?.notifyBroadcast
    if (face === undefined) throw new Error('runServe 未收到 notifyBroadcast')
    expect(typeof face.send).toBe('function') // 结构同形 NotifyBroadcastFace（不测 send 行为——真 transport 惰性，行为面归装配面用例）
    expect(seen[0]?.opts?.matrixSource).toBeUndefined()
    expect(DEFAULT_CHATD_NOTIFY_SENDER_ID).toBe('PRIME-0')
    expect(notifyFaceFactorySpy).toHaveBeenCalledTimes(1)
    expect(notifyFaceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: path.join(companyDir, 'var/workbench/chat.sock'), // 缺省 socket 推导（notify 交叉面）
        roomId: 'room-9',
        senderId: DEFAULT_CHATD_NOTIFY_SENDER_ID, // 未写 notifyChatdSenderId → 缺省 PRIME-0
        token: 'test-token-boot-notify',
        connectTimeoutMs: DEFAULT_MENTION_CONNECT_TIMEOUT_MS, // 复用 mention 键组缺省（同 socket 单一源）
        requestTimeoutMs: DEFAULT_MENTION_REQUEST_TIMEOUT_MS,
      }),
    )
    const joined = logs.join('\n')
    expect(joined).toContain('chatd notify 面已装配')
    expect(joined).toContain('roomId=room-9')
    expect(joined).toContain(`senderId=${DEFAULT_CHATD_NOTIFY_SENDER_ID}`)
    expect(joined).toContain(`connectTimeoutMs=${String(DEFAULT_MENTION_CONNECT_TIMEOUT_MS)}`)
    expect(joined).toContain('token env 供给')
    expect(joined).not.toContain('test-token-boot-notify') // token 值永不入日志（红名单）
  })

  it('notifyChatdSenderId 显式直通；mentionConnectTimeoutMs/mentionRequestTimeoutMs 复用直通', async () => {
    const yamlPath = writeYaml([
      'notifyChatdRoomId: "room-9"',
      'notifyChatdSenderId: "AGENT-2"',
      `chatdSocket: ${JSON.stringify(path.join(tmpdir(), 'notify-tmo.sock'))}`,
      'mentionConnectTimeoutMs: 8000',
      'mentionRequestTimeoutMs: 20000',
    ])
    const logs: string[] = []
    await bootServe({
      configPath: yamlPath,
      env: {},
      serve: async () => ({ ticks: 0, stopReason: 'stop-request' }),
      log: (line) => logs.push(line),
    })
    expect(notifyFaceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-9', senderId: 'AGENT-2', connectTimeoutMs: 8000, requestTimeoutMs: 20000 }),
    )
    const joined = logs.join('\n')
    expect(joined).toContain('senderId=AGENT-2')
    expect(joined).toContain('connectTimeoutMs=8000')
    expect(joined).toContain('token 未设') // env 不给 token → 明示 ALLOW_NO_AUTH 面（不拒启）
  })

  it('与 chatd 唤醒源共存：mentionSource: chatd + notifyChatdRoomId → chatdSource 与 notifyBroadcast 同时注入（同 socket 双面）', async () => {
    const companyDir = mkdtempSync(path.join(tmpdir(), 'sn-boot-chatd-both-'))
    roots.push(companyDir)
    const yamlPath = writeYaml(['mentionSource: chatd', 'notifyChatdRoomId: "room-9"', `companyDir: ${JSON.stringify(companyDir)}`])
    const seen: { opts?: { chatdSource?: ChatdSourceFactory; notifyBroadcast?: NotifyBroadcastFace } }[] = []
    await bootServe({
      configPath: yamlPath,
      env: { [WORKBENCH_CHATD_TOKEN_ENV]: 'tok-both-1' },
      fetch: noNetworkFetch,
      serve: async (_configPath, opts) => {
        seen.push(opts !== undefined ? { opts } : {})
        return { ticks: 0, stopReason: 'stop-request' }
      },
      log: () => {},
    })
    expect(seen[0]?.opts?.chatdSource).toBeDefined() // 唤醒源工厂在（mention 源已推导 socket → notify 面复用）
    expect(seen[0]?.opts?.notifyBroadcast).toBeDefined()
    expect(notifyFaceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ socketPath: path.join(companyDir, 'var/workbench/chat.sock'), roomId: 'room-9' }),
    )
  })

  it('互斥先炸：notifyChatdRoomId + matrix: true / matrixChannels: true → parse 面 CONFIG_INVALID，serve 未被调', async () => {
    const cases: readonly (readonly string[])[] = [
      ['notifyChatdRoomId: "room-9"', 'matrix: true', 'matrixHomeserverUrl: http://127.0.0.1:18008', 'matrixUserId: @bot:studio.local'],
      ['notifyChatdRoomId: "room-9"', 'matrixChannels: true', 'matrixDeptMap: "/tmp/dept.json"'],
    ]
    for (const lines of cases) {
      const yamlPath = writeYaml(lines)
      let served = 0
      await expect(
        bootServe({
          configPath: yamlPath,
          env: {},
          serve: async () => {
            served += 1
            return { ticks: 0, stopReason: 'stop-request' }
          },
        }),
      ).rejects.toThrow(/CONFIG_INVALID：notifyChatdRoomId 与 matrix/)
      expect(served).toBe(0)
    }
  })
})

// ————————————————————————— 装配面（全假网：mock transport 走一条链） —————————————————————————

describe('assembleChatdNotifyFace：装配面全假网', () => {
  it('开关面不一致 → CONFIG_INVALID（notifyChatdRoomId 未配下被调即明报）', () => {
    const config = parseDaemonConfig(readFileSync(writeYaml([]), 'utf8')) // 缺省无 notify 键
    expect(config.notifyChatdRoomId).toBeUndefined()
    expect(() => assembleChatdNotifyFace(config, {})).toThrow(
      /CONFIG_INVALID：assembleChatdNotifyFace 在 notifyChatdRoomId 未配/,
    )
  })

  it('mock transport：face.send 一条 sendMessage（纯文本体/senderId/token 附参）；日志不落 token 值', async () => {
    const chatd = new FakeNotifyChatd()
    const logs: string[] = []
    const yamlPath = writeYaml(['notifyChatdRoomId: "room-9"', `chatdSocket: ${JSON.stringify(path.join(tmpdir(), 'notify-asm.sock'))}`])
    const config = parseDaemonConfig(readFileSync(yamlPath, 'utf8'))
    const face = assembleChatdNotifyFace(config, { [WORKBENCH_CHATD_TOKEN_ENV]: 'test-token-asm-notify' }, {
      transport: chatd,
      log: (line) => logs.push(line),
    })
    const report = await face.send(NOTICE, { alert: true, dept: 'departments/研发部' })
    expect(report).toEqual({ sent: ['alert', 'dept:departments/研发部'], failed: [] })
    expect(chatd.sends).toHaveLength(1) // 三逻辑角色折叠同房恰一条
    expect(chatd.sends[0]).toMatchObject({ roomId: 'room-9', senderId: 'PRIME-0', token: 'test-token-asm-notify' })
    expect(chatd.sends[0]?.body).toBe(['[gate] 单据被拒', 'LOCAL-1 验收不过', '—— daemon@demo'].join('\n')) // 纯文本体
    expect(notifyFaceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ transport: chatd, connectTimeoutMs: DEFAULT_MENTION_CONNECT_TIMEOUT_MS, requestTimeoutMs: DEFAULT_MENTION_REQUEST_TIMEOUT_MS }),
    )
    const joined = logs.join('\n')
    expect(joined).toContain('chatd notify 面已装配')
    expect(joined).not.toContain('test-token-asm-notify') // token 值永不入日志（红名单）
  })
})
