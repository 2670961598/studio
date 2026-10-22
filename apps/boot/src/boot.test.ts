/**
 * boot 组合根测试（105-刀A A-3；studio-dev-105 提案 §6.3 判负线⑦/S5/S9）
 *
 * 覆盖面：
 *   1. 依赖方向守护（S9/判负线⑦）：daemon src 零 @studio-next/matrix import（静态扫描），
 *      组合根同时 import 两包——25-§一.2 的受准例外只落在 boot
 *   2. 装配链：daemon.yaml matrix 键组 + env 密码 → login → createMentionSource →
 *      runServe opts.matrixSource 注入（serve 注入面捕获契约，不真跑主循环）
 *   3. fail-fast：matrix 开而缺密码 env/缺 homeserver/缺 bot 账号/roles 形态坏 →
 *      CONFIG_INVALID 明报（不静默降级）
 *   4. 形状契约守护（S5）：matrix MentionPayload 过 daemon checkMentionPayload——
 *      两包互不 import，源侧 payload 形状与引擎消费面由组合根钉死不漂移
 *   5. matrix: false 透传 runServe（不带 matrixSource——开关面与装配面一致）
 *
 * 网络面全假（注入 fake fetch 回放预造 JSON，不真实联网——同 packages/matrix 测试纪律）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { InvokeSource } from '@studio-next/contract'
import { checkMentionPayload } from '@studio-next/daemon/engine'
import { parseDaemonConfig, type MatrixRoomFace, type MatrixRoomFaceContext, type ServeResult } from '@studio-next/daemon/serve'
import type { FetchLike, MentionPayload } from '@studio-next/matrix'
import {
  assembleMatrixProvisionFace,
  assembleMatrixSource,
  bootServe,
  DEFAULT_PRODUCER_MXID,
  loadDeptSlugs,
  parseMatrixRoles,
  MATRIX_BOT_PASSWORD_ENV,
} from './boot.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

/** matrix 键组 daemon.yaml（扁平子集；其余键走缺省） */
function matrixYaml(overrides: Record<string, string> = {}): string {
  return [
    `db: ${path.join(root, 'ledger.sqlite')}`,
    `rootDir: ${path.join(root, 'work')}`,
    'matrix: true',
    'matrixHomeserverUrl: http://127.0.0.1:18008',
    'matrixUserId: @demo-bot:studio.local',
    ...Object.entries(overrides).map(([k, v]) => `${k}: ${v}`),
  ].join('\n')
}

/** fake fetch：默认备 login 响应，可续队（回放纪律——不真实联网） */
function fakeFetchWithLogin(calls: { url: string; body?: string }[]): {
  enqueue: (status: number, body: unknown) => void
  fetch: FetchLike
} {
  const queue: { ok: boolean; status: number; json: () => Promise<unknown> }[] = [
    {
      ok: true,
      status: 200,
      json: async () => ({ user_id: '@demo-bot:studio.local', access_token: 'tok-boot', device_id: 'DEV' }),
    },
  ]
  return {
    enqueue: (status, body) => {
      queue.push({ ok: status < 400, status, json: async () => body })
    },
    fetch: (url, init) => {
      calls.push({ url: String(url), ...(init.body !== undefined ? { body: init.body } : {}) })
      const next = queue.shift()
      if (next === undefined) return Promise.reject(new Error('fake fetch: 队列空'))
      return Promise.resolve(next)
    },
  }
}

const ENV: Record<string, string | undefined> = { [MATRIX_BOT_PASSWORD_ENV]: 'bot-pw' }

/** serve 注入面的契约记录（不真跑主循环） */
type ServeSpy = (
  configPath: string,
  opts?: { matrixSource?: () => InvokeSource; matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace },
) => Promise<ServeResult>

function serveStub(
  seen: { path?: string; opts?: { matrixSource?: () => InvokeSource; matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace } }[],
): ServeSpy {
  return async (configPath, opts) => {
    seen.push({ ...(configPath !== undefined ? { path: configPath } : {}), ...(opts !== undefined ? { opts } : {}) })
    return { ticks: 0, stopReason: 'stop-request' }
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sn-boot-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 依赖方向守护（S9/判负线⑦） —————————————————————————

describe('依赖方向守护（25-§一.2；105-刀A 判负线⑦）', () => {
  it('daemon src 零 @studio-next/matrix import（静态扫描全目录树）', () => {
    const daemonSrc = path.resolve(import.meta.dirname, '../../daemon/src')
    const offenders: string[] = []
    // 只匹配 import 语句（from/import()/require 三形）——注释里提及包名是纪律文档本身，不算违规
    const importRe = /(?:from\s+|import\s*\(|require\s*\(\s*)['"]@studio-next\/matrix/
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(full)
        else if (entry.name.endsWith('.ts') && importRe.test(readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(daemonSrc, full))
        }
      }
    }
    scan(daemonSrc)
    expect(offenders).toEqual([]) // daemon 本体零 matrix import——违者此断言红
  })

  it('组合根本体同时 import 两包（受准例外只落在 boot——boot.ts import 即证明面）', () => {
    const bootSrc = readFileSync(path.join(import.meta.dirname, 'boot.ts'), 'utf8')
    expect(bootSrc).toContain(`from '@studio-next/daemon/serve'`)
    expect(bootSrc).toContain(`from '@studio-next/matrix'`)
  })

  it('boot 测试文件所在目录外无他人 import boot 包（组合根不被反向依赖）', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const bootDir = path.join(repoRoot, 'apps/boot')
    const offenders: string[] = []
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(full)
        else if (entry.name.endsWith('.ts') && !full.startsWith(bootDir) && readFileSync(full, 'utf8').includes('@studio-next/boot')) {
          offenders.push(path.relative(repoRoot, full))
        }
      }
    }
    scan(repoRoot)
    expect(offenders).toEqual([])
  })
})

// ————————————————————————— 4. 形状契约守护（S5） —————————————————————————

describe('MentionPayload ↔ MentionIntentPayload 形状契约（S5：两包互不 import，由组合根钉死）', () => {
  it('matrix 源侧 payload 过 daemon checkMentionPayload（字段全兼容，无丢失）', () => {
    const payload: MentionPayload = {
      target: 'AGENT-1',
      mention: '@AGENT-1',
      text: '修复登录 bug 后汇报',
      eventId: '$evt-1',
      sender: '@producer:studio.local',
      room: '!room-1:studio.local',
      channel: 'slug-大厅',
    }
    const checked = checkMentionPayload(payload)
    expect(typeof checked).toBe('object') // 字符串=形状不符
    if (typeof checked !== 'string') {
      expect(checked.target).toBe('AGENT-1')
      expect(checked.mention).toBe('@AGENT-1')
      expect(checked.eventId).toBe('$evt-1')
      expect(checked.room).toBe('!room-1:studio.local')
      expect(checked.channel).toBe('slug-大厅')
      expect(checked.sender).toBe('@producer:studio.local')
    }
  })

  it('畸形 payload（eventId 非字符串）被 daemon 校验面拒收——组合根不救形', () => {
    const bad = { target: 'AGENT-1', mention: '@x', text: 't', eventId: 42, sender: 's', room: 'r' }
    expect(typeof checkMentionPayload(bad)).toBe('string')
  })
})

// ————————————————————————— 2/3/5. 装配链 + fail-fast + 透传 —————————————————————————

describe('parseMatrixRoles（③混合语义源侧配置面）', () => {
  it('宰相=PRIME-0;制作人=PRODUCER-0 → 映射表', () => {
    expect(parseMatrixRoles('宰相=PRIME-0;制作人=PRODUCER-0')).toEqual({
      宰相: 'PRIME-0',
      制作人: 'PRODUCER-0',
    })
  })

  it('缺省/空白 → undefined；空段剔除', () => {
    expect(parseMatrixRoles(undefined)).toBeUndefined()
    expect(parseMatrixRoles('  ')).toBeUndefined()
    expect(parseMatrixRoles(';;宰相=PRIME-0;;')).toEqual({ 宰相: 'PRIME-0' })
  })

  it('坏形态（无 = / 空=值）→ CONFIG_INVALID 明报', () => {
    expect(() => parseMatrixRoles('宰相PRIME-0')).toThrow('CONFIG_INVALID')
    expect(() => parseMatrixRoles('=PRIME-0')).toThrow('CONFIG_INVALID')
    expect(() => parseMatrixRoles('宰相=')).toThrow('CONFIG_INVALID')
  })
})

describe('assembleMatrixSource（登录 + 源构造）', () => {
  it('login 请求带 bot 账号+env 密码；源 name=matrix（键组全量进 source 配置）', async () => {
    const calls: { url: string; body?: string }[] = []
    const ff = fakeFetchWithLogin(calls)
    const config = parseDaemonConfig(
      matrixYaml({
        matrixRooms: '!a:lo;!b:lo',
        matrixRoles: '宰相=PRIME-0',
        matrixPollMs: '5000',
        matrixSyncTimeoutMs: '30000',
      }),
    )
    const asm = await assembleMatrixSource(config, ENV, { fetch: ff.fetch })
    expect(asm.source.name).toBe('matrix')
    expect(calls[0]?.url).toBe('http://127.0.0.1:18008/_matrix/client/v3/login')
    const loginBody: { identifier?: { user?: string }; password?: string } = JSON.parse(calls[0]?.body ?? '{}')
    expect(loginBody.identifier?.user).toBe('@demo-bot:studio.local')
    expect(loginBody.password).toBe('bot-pw') // 密码只经 env→请求体，不入配置/日志
  })

  it('matrix: false 调装配 → CONFIG_INVALID（开关面与装配面不一致明报）', async () => {
    const config = parseDaemonConfig(matrixYaml().replace('matrix: true', 'matrix: false'))
    await expect(assembleMatrixSource(config, ENV)).rejects.toThrow('CONFIG_INVALID')
  })

  it('缺 env 密码 → CONFIG_INVALID（密码红名单：永不入 yaml，21A D5）', async () => {
    const config = parseDaemonConfig(matrixYaml())
    await expect(assembleMatrixSource(config, {})).rejects.toThrow(MATRIX_BOT_PASSWORD_ENV)
  })

  it('直接构造面缺 homeserver/userId → CONFIG_INVALID（parse 面交叉校验的兜底）', async () => {
    // 基座走 matrix: false 解析（绕开 parse 面交叉校验——模拟直接构造 ServeConfig 的测试面），
    // 再翻 matrix: true 且键缺席（destructure-out 保 exactOptionalPropertyTypes 干净）
    const baseText = matrixYaml()
      .replace('matrix: true', 'matrix: false')
      .replace('\nmatrixHomeserverUrl: http://127.0.0.1:18008', '')
      .replace('\nmatrixUserId: @demo-bot:studio.local', '')
    const base = parseDaemonConfig(baseText)
    const { matrixHomeserverUrl: _h, matrixUserId: _u, ...bare } = base
    const cfg = { ...bare, matrix: true }
    await expect(assembleMatrixSource(cfg, ENV)).rejects.toThrow('matrixHomeserverUrl')
    const withHome = { ...base, matrix: true, matrixHomeserverUrl: 'http://127.0.0.1:18008' }
    const { matrixUserId: _u2, ...noUser } = withHome
    await expect(assembleMatrixSource(noUser, ENV)).rejects.toThrow('matrixUserId')
  })
})

describe('bootServe（组合根接线：config → 装配 → runServe opts）', () => {
  it('matrix: true → login 一次 + runServe 收到可用的 matrixSource 工厂', async () => {
    const calls: { url: string; body?: string }[] = []
    const ff = fakeFetchWithLogin(calls)
    const yamlPath = path.join(root, 'boot-on.yaml')
    await writeFile(yamlPath, matrixYaml({ matrixRoles: '宰相=PRIME-0' }), 'utf8')
    const seen: { path?: string; opts?: { matrixSource?: () => InvokeSource } }[] = []
    const result = await bootServe({
      configPath: yamlPath,
      env: ENV,
      fetch: ff.fetch,
      serve: serveStub(seen),
    })
    expect(result.stopReason).toBe('stop-request')
    expect(seen[0]?.path).toBe(yamlPath)
    const factory = seen[0]?.opts?.matrixSource
    if (factory === undefined) throw new Error('runServe 未收到 matrixSource 工厂')
    const source = factory()
    expect(source.name).toBe('matrix')
    expect(typeof source.start).toBe('function')
    expect(typeof source.stop).toBe('function')
    expect(calls).toHaveLength(1) // 恰一次 login；源构造零网络（start 前无 sync）
  })

  it('matrix: false → 透传 runServe 且不带 matrixSource（开关面一致）', async () => {
    const yamlPath = path.join(root, 'boot-off.yaml')
    await writeFile(yamlPath, matrixYaml().replace('matrix: true', 'matrix: false'), 'utf8')
    const seen: { path?: string; opts?: { matrixSource?: () => InvokeSource } }[] = []
    await bootServe({ configPath: yamlPath, env: ENV, serve: serveStub(seen) })
    expect(seen[0]?.opts?.matrixSource).toBeUndefined()
  })

  it('daemon.yaml 缺 matrix 必配键 → parse 面先炸（boot 未到登录步）', async () => {
    const yamlPath = path.join(root, 'boot-bad.yaml')
    await writeFile(yamlPath, matrixYaml().replace('matrixUserId: @demo-bot:studio.local', ''), 'utf8')
    const seen: unknown[] = []
    await expect(
      bootServe({
        configPath: yamlPath,
        env: ENV,
        serve: async (...args) => {
          seen.push(args)
          return { ticks: 0, stopReason: 'signal' }
        },
      }),
    ).rejects.toThrow('matrix: true 缺必配键')
    expect(seen).toEqual([]) // 未到 serve——配置面先 fail-fast
  })
})

// ————————————————————————— 130-P3：matrixChannels 频道供给面装配 —————————————————————————

/** channels 键组 daemon.yaml（matrix: false=只开供给的合法灰度形态） */
function channelsYaml(overrides: Record<string, string> = {}): string {
  return [
    `db: ${path.join(root, 'ledger-ch.sqlite')}`,
    `rootDir: ${path.join(root, 'work-ch')}`,
    'matrix: false',
    'matrixChannels: true',
    'matrixHomeserverUrl: http://127.0.0.1:18008',
    'matrixUserId: @demo-bot:studio.local',
    `matrixDeptMap: ${deptMapPath}`,
    ...Object.entries(overrides).map(([k, v]) => `${k}: ${v}`),
  ].join('\n')
}

let deptMapPath = ''

beforeAll(async () => {
  deptMapPath = path.join(root, 'dept-map.json')
  await writeFile(deptMapPath, JSON.stringify({ 'departments/工程部': 'eng' }), 'utf8')
})

describe('loadDeptSlugs（DEV-20 D6 部门映射装载）', () => {
  it('合法 JSON：扁平 path→slug 全量装载', () => {
    expect(loadDeptSlugs(deptMapPath)).toEqual({ 'departments/工程部': 'eng' })
  })

  it('路径缺席/空串 → CONFIG_INVALID（必配面）', () => {
    expect(() => loadDeptSlugs(undefined)).toThrow('matrixDeptMap')
    expect(() => loadDeptSlugs('')).toThrow('matrixDeptMap')
  })

  it('文件读不到 / 非 JSON / 非对象 / 坏 slug / 空对象 → CONFIG_INVALID 逐面明报', async () => {
    expect(() => loadDeptSlugs(path.join(root, 'nope.json'))).toThrow('文件读不到')
    const badJson = path.join(root, 'dept-map-bad.json')
    await writeFile(badJson, '{not json', 'utf8')
    expect(() => loadDeptSlugs(badJson)).toThrow('非 JSON')
    const notObj = path.join(root, 'dept-map-arr.json')
    await writeFile(notObj, JSON.stringify(['a']), 'utf8')
    expect(() => loadDeptSlugs(notObj)).toThrow('扁平对象')
    const badSlug = path.join(root, 'dept-map-slug.json')
    await writeFile(badSlug, JSON.stringify({ 'departments/工程部': '工程' }), 'utf8')
    expect(() => loadDeptSlugs(badSlug)).toThrow('小写 ASCII')
    const empty = path.join(root, 'dept-map-empty.json')
    await writeFile(empty, JSON.stringify({}), 'utf8')
    expect(() => loadDeptSlugs(empty)).toThrow('空对象')
  })
})

describe('assembleMatrixProvisionFace（登录 + 供给面工厂）', () => {
  it('matrixChannels: false 调装配 → CONFIG_INVALID（开关面与装配面不一致明报）', async () => {
    const config = parseDaemonConfig(channelsYaml().replace('matrixChannels: true', 'matrixChannels: false'))
    await expect(assembleMatrixProvisionFace(config, ENV)).rejects.toThrow('CONFIG_INVALID')
  })

  it('缺 env 密码 → CONFIG_INVALID 且点名 matrixChannels 开关（红名单同 matrix 源）', async () => {
    const config = parseDaemonConfig(channelsYaml())
    await expect(assembleMatrixProvisionFace(config, {})).rejects.toThrow('matrixChannels')
  })

  it('合法：login 一次 → 工厂(ctx) 产三面（ensureCompanyChannels/onDispatched/onClosed）', async () => {
    const calls: { url: string; body?: string }[] = []
    const ff = fakeFetchWithLogin(calls)
    const config = parseDaemonConfig(channelsYaml({ matrixProducerMxid: '@producer:studio.local' }))
    const logs: string[] = []
    const factory = await assembleMatrixProvisionFace(config, ENV, { fetch: ff.fetch, log: (l) => logs.push(l) })
    expect(calls).toHaveLength(1) // 恰一次 login
    const face = factory({ snapshot: () => demoSnapshot() })
    expect(typeof face.ensureCompanyChannels).toBe('function')
    expect(typeof face.onDispatched).toBe('function')
    expect(typeof face.onClosed).toBe('function')
    expect(logs.some((l) => l.includes('频道供给面已装配'))).toBe(true)
  })
})

/** 公司快照夹具（供给面 ctx.snapshot 消费形——含 groups/role/status 可选面） */
function demoSnapshot() {
  return {
    slug: 'demo-corp',
    name: '演示公司',
    level: 2,
    charter: 'charter.md',
    platform: { platform: 'localfile' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people: [
      { id: 'AGENT-1', name: '工程师', login: 'agent-1', level: 2, dept: 'departments/工程部', role: '工程师' },
    ],
    jobs: [],
    groups: [{ id: 'core', dept: 'departments/工程部', name: '工程部-核心组', leader: 'AGENT-1', members: ['AGENT-1'] }],
  }
}

describe('bootServe：channels-only 形态（matrix: false + matrixChannels: true）', () => {
  it('runServe 收 matrixRoomFace、无 matrixSource；login 恰一次；制作人缺省神号', async () => {
    const calls: { url: string; body?: string }[] = []
    const ff = fakeFetchWithLogin(calls)
    const yamlPath = path.join(root, 'boot-ch.yaml')
    await writeFile(yamlPath, channelsYaml(), 'utf8')
    const seen: { path?: string; opts?: { matrixSource?: () => InvokeSource; matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace } }[] = []
    const logs: string[] = []
    await bootServe({ configPath: yamlPath, env: ENV, fetch: ff.fetch, serve: serveStub(seen), log: (l) => logs.push(l) })
    expect(seen[0]?.opts?.matrixSource).toBeUndefined() // 只开供给不开唤醒源
    const factory = seen[0]?.opts?.matrixRoomFace
    if (factory === undefined) throw new Error('runServe 未收到 matrixRoomFace 工厂')
    const face: MatrixRoomFace = factory({ snapshot: () => demoSnapshot() })
    expect(typeof face.ensureCompanyChannels).toBe('function')
    expect(calls).toHaveLength(1) // 恰一次 login——供给面与源共用 bot 登录面
    expect(logs.some((l) => l.includes('频道供给面已装配') && l.includes(`制作人 ${DEFAULT_PRODUCER_MXID}`))).toBe(true)
  })

  it('daemon.yaml 缺 matrixDeptMap → parse 面先炸（交叉校验在 daemon 收口）', async () => {
    const yamlPath = path.join(root, 'boot-ch-bad.yaml')
    await writeFile(
      yamlPath,
      channelsYaml().replace(new RegExp(`^matrixDeptMap: .*$`, 'm'), ''),
      'utf8',
    )
    const seen: unknown[] = []
    await expect(
      bootServe({
        configPath: yamlPath,
        env: ENV,
        serve: async (...args) => {
          seen.push(args)
          return { ticks: 0, stopReason: 'signal' }
        },
      }),
    ).rejects.toThrow('matrixChannels: true 缺必配键')
    expect(seen).toEqual([])
  })
})

describe('bootServe：双开形态（matrix: true + matrixChannels: true）', () => {
  it('两面齐注入且 login 恰一次（同一 bot 账号共用登录——双设备面不成立）', async () => {
    const calls: { url: string; body?: string }[] = []
    const ff = fakeFetchWithLogin(calls)
    const yamlPath = path.join(root, 'boot-dual.yaml')
    await writeFile(yamlPath, channelsYaml().replace('matrix: false', 'matrix: true'), 'utf8')
    const seen: { path?: string; opts?: { matrixSource?: () => InvokeSource; matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace } }[] = []
    await bootServe({ configPath: yamlPath, env: ENV, fetch: ff.fetch, serve: serveStub(seen) })
    expect(seen[0]?.opts?.matrixSource).toBeDefined()
    expect(seen[0]?.opts?.matrixRoomFace).toBeDefined()
    expect(calls).toHaveLength(1) // 双开共用一次登录（token 只留进程内存）
  })
})
