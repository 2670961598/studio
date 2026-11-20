/**
 * chatd @唤醒源组合根接线测试（M4-1 接线收口，team task-136）
 *
 * 覆盖（提案 docs/plan/07-…-2026-11-19.md §5.4/§5.5；boot 组合根装配纪律）：
 *   - 默认 inert：daemon.yaml 不写 mentionSource（缺省 matrix）→ runServe opts 零 chatd
 *     注入、日志零 chatd 行（缺省路径零漂移直证）；
 *   - chatd 形态：mentionSource: chatd → bootServe 注入 chatdSource 工厂（ctx.actors 由
 *     runServe 在快照在场处供给）；**零 matrix 登录**（chatd-only 形态零 MATRIX_BOT_PASSWORD
 *     依赖——env 不给密码、fetch 注入即炸）；
 *   - 互斥先炸：mentionSource: chatd + matrix: true → parse 面 CONFIG_INVALID，serve 未被调；
 *   - 装配面全假网：assembleChatdSource + mock transport 走 start→emit→stop 一条链
 *     （env WORKBENCH_CHATD_TOKEN → transport 请求附参；日志只报 socket/有无 token，不报值）；
 *   - 传输超时加固（P1）：源工厂收 connectTimeoutMs/requestTimeoutMs——缺省 5000/10000
 *     （boot 装配面 DEFAULT_MENTION_* 单一源）、daemon.yaml 两键正整数直通；非法值 parse
 *     面拒启（0/负/非整数——事件循环偶发停顿下首轮 poll connect timeout 的加固面）。
 *
 * 边界：boot 不 import @studio-next/workbench-transport（依赖图无该边）——mock 与类型全部
 * 经 '@studio-next/daemon/serve' 再出口面消费（M4-1 结构性保证的直证）；超时参数断言同样
 * 经该再出口面旁听（vi.mock 包真实现——行为零漂移，只记录源工厂收到的 options）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvokeIntent, InvokeSource } from '@studio-next/contract'
import {
  createChatdMentionSource,
  parseDaemonConfig,
  type ChatdSourceFactory,
  type ChatdTransportPort,
} from '@studio-next/daemon/serve'
import { assembleChatdSource, bootServe, DEFAULT_MENTION_CONNECT_TIMEOUT_MS, DEFAULT_MENTION_REQUEST_TIMEOUT_MS, WORKBENCH_CHATD_TOKEN_ENV } from '../../src/boot.ts'

// 旁听面（P1 超时加固断言用）：包住真 createChatdMentionSource——实现零漂移，只记录
// boot 装配面递给源工厂的 options（transport 注入/超时参数同形直证；仍零直连 transport 包）。
vi.mock('@studio-next/daemon/serve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@studio-next/daemon/serve')>()
  return { ...actual, createChatdMentionSource: vi.fn(actual.createChatdMentionSource) }
})

// ————————————————————————— mock transport（内存态；单 actor 最小链） —————————————————————————

/** 端口结果元素形（经 daemon/serve 再出口的端口面推导——不直连 workbench-transport、不另立第二形） */
type ChatdMessage = Awaited<ReturnType<ChatdTransportPort['listMessages']>>['items'][number]
type ChatdClaimedWake = Awaited<ReturnType<ChatdTransportPort['claimWakes']>>['wakes'][number]

interface FakeWake {
  wakeId: string
  actorId: string
  roomId: string
  sourceSeq: number
  status: 'pending' | 'claimed' | 'acked'
}

/** 内存 chatd（boot 侧最小面：send 造 wake；inbox/claim/ack/list/listRooms/close） */
class FakeChatd implements ChatdTransportPort {
  readonly calls: { method: string; input: unknown }[] = []
  readonly wakes: FakeWake[] = []
  closed = false
  private seq = 0
  private readonly messages: ChatdMessage[] = []

  send(body: string, mentions: readonly string[]): void {
    this.seq += 1
    this.messages.push({ seq: this.seq, roomSeq: this.seq, roomId: 'room-1', senderId: 'PRIME-0', body, mentions: [...mentions], createdAt: Date.now() })
    for (const actorId of [...new Set(mentions)]) {
      this.wakes.push({ wakeId: `wake-${String(this.wakes.length + 1)}`, actorId, roomId: 'room-1', sourceSeq: this.seq, status: 'pending' })
    }
  }

  async inbox(input: { actorId: string; roomIds?: readonly string[]; token?: string }): Promise<{ actorId: string; unread: number; mentions: number; pendingWakeIds: string[]; rooms: [] }> {
    this.calls.push({ method: 'inbox', input })
    const pending = this.wakes.filter((w) => w.actorId === input.actorId && w.status !== 'acked')
    return { actorId: input.actorId, unread: 0, mentions: pending.length, pendingWakeIds: pending.map((w) => w.wakeId), rooms: [] }
  }

  async claimWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string; token?: string }): Promise<{ claimed: string[]; alreadyClaimed: string[]; wakes: ChatdClaimedWake[]; replayed: boolean }> {
    this.calls.push({ method: 'claimWakes', input })
    const wakes: ChatdClaimedWake[] = []
    for (const id of input.wakeIds) {
      const w = this.wakes.find((x) => x.wakeId === id)
      if (w !== undefined && w.status === 'pending') {
        w.status = 'claimed'
        wakes.push({ wakeId: w.wakeId, actorId: w.actorId, roomId: w.roomId, sourceSeq: w.sourceSeq, cause: 'mention', status: w.status, claimedBy: null, claimedUntil: Date.now() + 30_000, createdAt: 0, ackedAt: null })
      }
    }
    return { claimed: [...input.wakeIds], alreadyClaimed: [], wakes, replayed: false }
  }

  async ackWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string; token?: string }): Promise<{ acked: string[]; alreadyAcked: string[]; replayed: boolean }> {
    this.calls.push({ method: 'ackWakes', input })
    const acked: string[] = []
    for (const id of input.wakeIds) {
      const w = this.wakes.find((x) => x.wakeId === id)
      if (w !== undefined && w.status !== 'acked') {
        w.status = 'acked'
        acked.push(id)
      }
    }
    return { acked, alreadyAcked: [], replayed: false }
  }

  async listMessages(input: { roomId: string; limit?: number }): Promise<{ items: ChatdMessage[]; nextCursor: null; hasMore: boolean }> {
    this.calls.push({ method: 'listMessages', input })
    return { items: this.messages.filter((m) => m.roomId === input.roomId), nextCursor: null, hasMore: false }
  }

  async listRooms(): Promise<readonly { roomId: string; kind: 'broadcast'; name: string; memberIds: string[]; headRoomSeq: number }[]> {
    this.calls.push({ method: 'listRooms', input: {} })
    return [{ roomId: 'room-1', kind: 'broadcast', name: '大厅', memberIds: ['PRIME-0', 'AGENT-1'], headRoomSeq: this.seq }]
  }

  close(): void {
    this.closed = true
  }
}

// ————————————————————————— 夹具 —————————————————————————

const roots: string[] = []

/** 源工厂旁听面（vi.mock 包真实现后的 spy 引用——断言 boot 递给工厂的 options） */
const chatdSourceFactorySpy = vi.mocked(createChatdMentionSource)

afterEach(() => {
  vi.useRealTimers()
  chatdSourceFactorySpy.mockClear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** fake 栈 daemon.yaml（零外部依赖；parse 面走 daemon 同一条解析链）→ 解析产物 */
function parseYaml(lines: readonly string[]): ReturnType<typeof parseDaemonConfig> {
  return parseDaemonConfig(readFileSync(writeYaml(lines), 'utf8'))
}

/** fake 栈 daemon.yaml（零外部依赖；parse 面走 daemon 同一条解析链） */
function writeYaml(lines: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-boot-chatd-'))
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
  Promise.reject(new Error('fetch 不应被调用（chatd-only 形态零 matrix 登录/零网络）'))

// ————————————————————————— bootServe 接线面 —————————————————————————

describe('bootServe：chatd 唤起源接线', () => {
  it('默认（不写 mentionSource）→ runServe opts 零 chatd 注入、日志零 chatd 行（缺省路径零漂移）', async () => {
    const yamlPath = writeYaml([])
    const seen: { path?: string; opts?: { chatdSource?: ChatdSourceFactory; matrixSource?: () => InvokeSource } }[] = []
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
    expect(seen[0]?.opts?.chatdSource).toBeUndefined()
    expect(seen[0]?.opts?.matrixSource).toBeUndefined()
    expect(logs.filter((l) => l.includes('chatd'))).toEqual([])
  })

  it('mentionSource: chatd → 注入 chatdSource 工厂；零 matrix 登录（env 无 bot 密码、fetch 即炸）', async () => {
    const companyDir = mkdtempSync(path.join(tmpdir(), 'sn-boot-chatd-co-'))
    roots.push(companyDir)
    const yamlPath = writeYaml([`mentionSource: chatd\ncompanyDir: ${JSON.stringify(companyDir)}`])
    const seen: { path?: string; opts?: { chatdSource?: ChatdSourceFactory; matrixSource?: () => InvokeSource } }[] = []
    const logs: string[] = []
    await bootServe({
      configPath: yamlPath,
      env: { [WORKBENCH_CHATD_TOKEN_ENV]: 'tok-boot-1' }, // 不给 MATRIX_BOT_PASSWORD：chatd-only 形态零依赖
      fetch: noNetworkFetch,
      serve: async (configPath, opts) => {
        seen.push({ path: configPath, ...(opts !== undefined ? { opts } : {}) })
        return { ticks: 0, stopReason: 'stop-request' }
      },
      log: (line) => logs.push(line),
    })
    const factory = seen[0]?.opts?.chatdSource
    if (factory === undefined) throw new Error('runServe 未收到 chatdSource 工厂')
    expect(seen[0]?.opts?.matrixSource).toBeUndefined()
    const source = factory({ actors: ['AGENT-1', 'HR-1'] }) // ctx.actors=roster 在册工号（快照在场处供给）
    expect(source.name).toBe('chatd')
    expect(typeof source.start).toBe('function')
    expect(typeof source.stop).toBe('function')
    const joined = logs.join('\n')
    expect(joined).toContain(path.join(companyDir, 'var/workbench/chat.sock')) // 缺省 socket 推导进日志（可观测）
    expect(joined).toContain('token env 供给')
    expect(joined).not.toContain('tok-boot-1') // token 值永不入日志（红名单）
    // P1 超时加固：bootServe 装配路径同样显式递超时（缺省 5000/10000）——源工厂旁听直证
    expect(chatdSourceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ connectTimeoutMs: DEFAULT_MENTION_CONNECT_TIMEOUT_MS, requestTimeoutMs: DEFAULT_MENTION_REQUEST_TIMEOUT_MS }),
    )
    expect(joined).toContain(`connectTimeoutMs=${String(DEFAULT_MENTION_CONNECT_TIMEOUT_MS)}`)
    expect(joined).toContain(`requestTimeoutMs=${String(DEFAULT_MENTION_REQUEST_TIMEOUT_MS)}`)
  })

  it('mentionSource: chatd + matrix: true → 互斥先炸（parse 面 CONFIG_INVALID，serve 未被调）', async () => {
    const yamlPath = writeYaml([
      'mentionSource: chatd',
      'matrix: true',
      'matrixHomeserverUrl: http://127.0.0.1:18008',
      'matrixUserId: @demo-bot:studio.local',
    ])
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
    ).rejects.toThrow(/CONFIG_INVALID：mentionSource: chatd 与 matrix: true 互斥/)
    expect(served).toBe(0)
  })
})

// ————————————————————————— 装配面（全假网：mock transport 走一条链） —————————————————————————

describe('assembleChatdSource：装配面全假网', () => {
  it('开关面不一致 → CONFIG_INVALID（mentionSource: matrix 下被调即明报）', () => {
    const config = parseDaemonConfig(readFileSync(writeYaml([]), 'utf8')) // 缺省 mentionSource=matrix
    expect(config.mentionSource).toBe('matrix')
    expect(() => assembleChatdSource(config, {})).toThrow(
      /CONFIG_INVALID：assembleChatdSource 在 mentionSource ≠ chatd 下被调用/,
    )
  })

  it('mock transport：start→emit→stop 一条链；env token → transport 请求附参；日志不落 token 值', async () => {
    vi.useFakeTimers()
    const chatd = new FakeChatd()
    const logs: string[] = []
    const emitted: InvokeIntent[] = []
    const yamlPath = writeYaml([
      'mentionSource: chatd',
      `chatdSocket: ${JSON.stringify(path.join(tmpdir(), 'chat.sock'))}`,
      'mentionPollMs: 100',
    ])
    const config = parseDaemonConfig(readFileSync(yamlPath, 'utf8'))
    expect(config.mentionPollMs).toBe(100) // mentionPollMs 键组直通源节奏
    expect(config.mentionConnectTimeoutMs).toBeUndefined() // 不写=undefined：缺省归 boot 装配面
    expect(config.mentionRequestTimeoutMs).toBeUndefined()
    const factory = assembleChatdSource(config, { [WORKBENCH_CHATD_TOKEN_ENV]: 'tok-asm-1' }, {
      transport: chatd,
      log: (line) => logs.push(line),
    })
    const source: InvokeSource = factory({ actors: ['AGENT-1'] })
    // P1 超时加固：注入 transport 的形态下，源工厂 options 仍同形收 connectTimeoutMs/
    // requestTimeoutMs（缺省 5000/10000——不因 transport 注入而丢参）
    expect(chatdSourceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: chatd,
        connectTimeoutMs: DEFAULT_MENTION_CONNECT_TIMEOUT_MS,
        requestTimeoutMs: DEFAULT_MENTION_REQUEST_TIMEOUT_MS,
      }),
    )
    source.start((intent) => emitted.push(intent))
    await vi.advanceTimersByTimeAsync(0) // 首拉建基线（启动前 pending 不唤起——防重放）
    chatd.send('@AGENT-1 干活', ['AGENT-1'])
    await vi.advanceTimersByTimeAsync(100)
    expect(emitted.length).toBe(1)
    expect(emitted[0]).toMatchObject({ kind: 'mention', company: 'demo', source: 'chatd', dedupKey: 'wake:wake-1' })
    const inbox = chatd.calls.find((c) => c.method === 'inbox')
    expect((inbox?.input as { token?: string }).token).toBe('tok-asm-1') // env WORKBENCH_CHATD_TOKEN → 请求附参
    expect(chatd.wakes[0]?.status).toBe('acked') // claim→emit→ack 收口
    source.stop()
    expect(chatd.closed).toBe(true) // stop 关 transport（幂等）
    const joined = logs.join('\n')
    expect(joined).toContain('[chatd]')
    expect(joined).not.toContain('tok-asm-1') // token 值永不入日志（红名单）
  })
})

// ————————————————————————— 传输超时加固（P1：事件循环偶发停顿 → 首轮 poll connect timeout） —————————————————————————

describe('assembleChatdSource：传输超时参数（mentionConnectTimeoutMs/mentionRequestTimeoutMs）', () => {
  it('缺省 5000/10000：不写两键 → boot 装配面显式递源工厂（自建 transport 面生效）；日志明示有效值', () => {
    const logs: string[] = []
    const config = parseYaml([
      'mentionSource: chatd',
      `chatdSocket: ${JSON.stringify(path.join(tmpdir(), 'chat-tmo.sock'))}`,
    ])
    expect(DEFAULT_MENTION_CONNECT_TIMEOUT_MS).toBe(5000) // 缺省单一源冻结（P1 加固口径）
    expect(DEFAULT_MENTION_REQUEST_TIMEOUT_MS).toBe(10000)
    const factory = assembleChatdSource(config, {}, { log: (line) => logs.push(line) })
    const source = factory({ actors: ['AGENT-1'] })
    expect(source.name).toBe('chatd') // 真工厂行为不破（旁听只记录 options）
    const seen = chatdSourceFactorySpy.mock.calls.at(-1)?.[0]
    expect(seen).toMatchObject({ connectTimeoutMs: 5000, requestTimeoutMs: 10000 })
    expect(seen?.transport).toBeUndefined() // 未注入 transport → 源内自建 WorkbenchTransport 收超时
    const joined = logs.join('\n')
    expect(joined).toContain('connectTimeoutMs=5000')
    expect(joined).toContain('requestTimeoutMs=10000')
    source.stop()
  })

  it('config 覆盖：mentionConnectTimeoutMs/mentionRequestTimeoutMs 正整数直通源工厂与日志', () => {
    const logs: string[] = []
    const config = parseYaml([
      'mentionSource: chatd',
      `chatdSocket: ${JSON.stringify(path.join(tmpdir(), 'chat-tmo2.sock'))}`,
      'mentionConnectTimeoutMs: 8000',
      'mentionRequestTimeoutMs: 20000',
    ])
    expect(config.mentionConnectTimeoutMs).toBe(8000) // parse 面直通（正整数毫秒）
    expect(config.mentionRequestTimeoutMs).toBe(20000)
    const factory = assembleChatdSource(config, {}, { log: (line) => logs.push(line) })
    factory({ actors: ['AGENT-1'] }).stop()
    expect(chatdSourceFactorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ connectTimeoutMs: 8000, requestTimeoutMs: 20000 }),
    )
    const joined = logs.join('\n')
    expect(joined).toContain('connectTimeoutMs=8000')
    expect(joined).toContain('requestTimeoutMs=20000')
  })

  it('非法值 → parseDaemonConfig 拒启（0=非正整数；1.5=数值面明报；-5=扁平 YAML 层即拒）', () => {
    for (const key of ['mentionConnectTimeoutMs', 'mentionRequestTimeoutMs'] as const) {
      expect(() => parseYaml(['mentionSource: chatd', `${key}: 0`])).toThrow(
        new RegExp(`${key} 须为正整数毫秒`),
      )
      expect(() => parseYaml(['mentionSource: chatd', `${key}: 1.5`])).toThrow(
        new RegExp(`${key} 须为非负数`),
      )
      expect(() => parseYaml(['mentionSource: chatd', `${key}: -5`])).toThrow(/嵌套\/列表值/) // 负值在扁平 YAML 语法层先拒（fail-closed 同归拒启）
    }
  })
})
