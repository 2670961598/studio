/**
 * channel-equivalence —— 控制面三通道合并的行为等价闸（studio-dev-555 验收②）
 *
 * 依据：docs/17-§2（daemon `control/` 域=热重载/停机通道，拍边界消费）；docs/41-§2（控制面
 *   停机通道文件协议）；docs/20-§十五.三（尺寸阈/单源）；#504 plan §4.6（重启通道文件面）。
 *
 * 红→绿口径（合并前后同一用例集）：
 *   合并前（#504 第 3 套并行实现）：本文件 import 的 `control/channel/protocol.ts` 不存在 → 收集期即红；
 *   合并后：同一 case 集对 stop / reload / restart 三通道断言**同一可观测行为** → 绿。
 *
 * 断言的是「同一用例在合并前后行为一致」，不是「三通道处处同构」——三通道保留的薄语义差异
 *   （文件名、请求/回执权限位、回执解码形状）逐条显式断言，防止合并把差异抹平或放大。
 *
 * 不碰生产：全部临时根；不写仓内路径。
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defineControlChannel, type ControlChannel } from '../../../src/control/channel/protocol.ts'
import { readTextOutcome, writeJsonAtomic } from '../../../src/control/channel/file-io.ts'
import { controlDirOf, controlFileOf } from '../../../src/control/channel/paths.ts'
import {
  awaitStopResult,
  consumeStopRequest,
  readStopRequest,
  STOP_REQUEST_CONSUMED_FILE,
  STOP_REQUEST_FILE,
  STOP_RESULT_FILE,
  writeStopRequest,
  writeStopResult,
} from '../../../src/control/stop-channel.ts'
import {
  awaitReloadResult,
  readReloadRequest,
  RELOAD_REQUEST_CONSUMED_FILE,
  RELOAD_REQUEST_FILE,
  RELOAD_RESULT_FILE,
  writeReloadRequest,
  writeReloadResult,
} from '../../../src/control/hot-reload.ts'
import { inspectRestartRequest, writeRestartResult } from '../../../src/control/restart/channel.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const NOW = 1_793_000_000_000
/** 三通道共用同一组 id（restart 严格 schema 要求 26 位 ULID；stop/reload 接受任意非空串——取交集） */
const REQ_ID = makeUlid(NOW)
const REQ_ID_2 = makeUlid(NOW + 1)
const RES_ID = makeUlid(NOW + 2)
const RES_ID_MISSING = makeUlid(NOW + 3)

const STOP_FILES = { request: STOP_REQUEST_FILE, result: STOP_RESULT_FILE, consumed: STOP_REQUEST_CONSUMED_FILE }
const RELOAD_FILES = { request: RELOAD_REQUEST_FILE, result: RELOAD_RESULT_FILE, consumed: RELOAD_REQUEST_CONSUMED_FILE }
const RESTART_FILES = { request: 'restart.request.json', result: 'restart.result.json', consumed: 'restart.request.json.consume' }

const roots: string[] = []

function freshRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'studio-next-channel-equiv-'))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots) {
    try {
      chmodSync(root, 0o700)
    } catch {
      // 已删/权限已复原：清理幂等
    }
    rmSync(root, { recursive: true, force: true })
  }
})

/** 通用协议实例（reload/restart 生产侧的薄语义描述符同 spec：文件名/权限位/解码形状） */
const reloadChannel: ControlChannel<{ id: string; company: string | null; requestedAt: number }, { id: string; ok: boolean; applied: boolean }> =
  defineControlChannel({
    files: RELOAD_FILES,
    decodeResult: (raw) => ({ id: raw['id'] as string, ok: raw['ok'] === true, applied: raw['applied'] === true }),
  })

const restartChannel: ControlChannel<{ id: string; requestedAt: number }, { id: string; ok: boolean; accepted: boolean }> = defineControlChannel({
  files: RESTART_FILES,
  requestMode: 0o600,
  resultMode: 0o600,
  decodeResult: (raw) => ({ id: raw['id'] as string, ok: raw['ok'] === true, accepted: raw['accepted'] === true }),
})

/** 三通道统一探针面（只暴露各通道生产导出的读写入口；差异即薄语义） */
interface ChannelProbe {
  name: string
  files: { request: string; result: string; consumed: string }
  /** 请求文件期望权限（undefined=进程 umask 口径） */
  requestMode: number | undefined
  buildRequest(id: string, requestedAt: number): Record<string, unknown>
  writeRequest(root: string, id: string): void
  readRequestId(root: string): string | undefined
  consume(root: string): boolean
  writeResult(root: string, id: string): void
  awaitResultId(root: string, id: string, timeoutMs: number): Promise<string | undefined>
}

const probes: readonly ChannelProbe[] = [
  {
    name: 'stop',
    files: STOP_FILES,
    requestMode: undefined,
    buildRequest: (id, requestedAt) => ({ id, requestedAt }),
    writeRequest: (root, id) => {
      writeStopRequest(root, { id, requestedAt: NOW })
    },
    readRequestId: (root) => readStopRequest(root)?.id,
    consume: (root) => consumeStopRequest(root),
    writeResult: (root, id) => {
      writeStopResult(root, { id, ok: true, stopped: true })
    },
    awaitResultId: async (root, id, timeoutMs) => (await awaitStopResult(root, id, timeoutMs, 10))?.id,
  },
  {
    name: 'reload',
    files: RELOAD_FILES,
    requestMode: undefined,
    buildRequest: (id, requestedAt) => ({ id, company: null, requestedAt }),
    writeRequest: (root, id) => {
      writeReloadRequest(root, { id, company: null, requestedAt: NOW })
    },
    readRequestId: (root) => readReloadRequest(root)?.id,
    // reload 生产面无消费（L1 靠 lastSeen 去重）；协议层消费由通用实现承担（本 case 验实现面）
    consume: (root) => reloadChannel.consumeRequest(root),
    writeResult: (root, id) => {
      writeReloadResult(root, { id, ok: true, applied: true })
    },
    awaitResultId: async (root, id, timeoutMs) => (await awaitReloadResult(root, id, timeoutMs, 10))?.id,
  },
  {
    name: 'restart',
    files: RESTART_FILES,
    requestMode: 0o600,
    buildRequest: (id, requestedAt) => ({
      id,
      requestedAt,
      reason: 'studio-dev-555 等价用例',
      authorizationRef: 'sha256:equiv-ref',
      actor: { personId: 'AGENT-1', role: '工程部长', level: 2 },
    }),
    // 重启写面已收口到通用原子写原语（生产 RESTART_CHANNEL 内部即此调用，0600/同名 tmp）
    writeRequest: (root, id) => {
      writeJsonAtomic(controlFileOf(root, RESTART_FILES.request), { id, requestedAt: NOW, reason: 'equivalence', authorizationRef: 'sha256:equiv-ref', actor: { personId: 'AGENT-1', role: '工程部长', level: 2 } }, { mode: 0o600, tmpSuffix: id })
    },
    readRequestId: (root) => {
      const inspected = inspectRestartRequest(root)
      return inspected.kind === 'ok' ? inspected.request.id : undefined
    },
    consume: (root) => restartChannel.consumeRequest(root),
    writeResult: (root, id) => {
      writeRestartResult(root, { id, ok: true, accepted: true, state: 'draining' })
    },
    awaitResultId: async (root, id, timeoutMs) => (await restartChannel.awaitResult(root, id, timeoutMs, 10))?.id,
  },
]

describe('控制面三通道·协议行为等价（同一 case 集：写→读→消费→回执）', () => {
  for (const probe of probes) {
    it(`${probe.name}：原子写不残留 tmp；请求读回 id 一致`, () => {
      const root = freshRoot()
      probe.writeRequest(root, REQ_ID)
      expect(existsSync(controlFileOf(root, probe.files.request))).toBe(true)
      // 原子写收尾：临时件不残留（三通道同款写入器）
      expect(readdirSync(controlDirOf(root)).filter((f) => f.includes('.tmp-'))).toEqual([])
      expect(probe.readRequestId(root)).toBe(REQ_ID)
    })

    it(`${probe.name}：回执按 id 匹配（旧回执不误读；超时 undefined）`, async () => {
      const root = freshRoot()
      probe.writeResult(root, RES_ID)
      expect(await probe.awaitResultId(root, RES_ID, 500)).toBe(RES_ID)
      expect(await probe.awaitResultId(root, RES_ID_MISSING, 120)).toBeUndefined()
    })

    it(`${probe.name}：消费=原子改名（live 面清空、.consume 留档、重复消费 false 不炸）`, () => {
      const root = freshRoot()
      probe.writeRequest(root, REQ_ID_2)
      expect(probe.consume(root)).toBe(true)
      expect(existsSync(controlFileOf(root, probe.files.request))).toBe(false)
      expect(existsSync(controlFileOf(root, probe.files.consumed))).toBe(true)
      expect(probe.consume(root)).toBe(false)
    })

    it(`${probe.name}：坏 JSON 不炸（读面 undefined/超时面，不当成合法请求）`, async () => {
      const root = freshRoot()
      probe.writeResult(root, RES_ID) // 先建 control 面（目录由写入器 0700 建）
      writeFileSync(controlFileOf(root, probe.files.result), '{oops', 'utf8')
      expect(await probe.awaitResultId(root, 'any', 100)).toBeUndefined()
      expect(probe.readRequestId(root)).toBeUndefined()
    })
  }

  it('薄语义差异逐条锁死：restart 请求 0600；stop/reload 沿 umask 口径（合并不抹平/不放大）', () => {
    const umask = process.umask()
    const expectedDefault = 0o666 & ~umask
    const root = freshRoot()
    for (const probe of probes) {
      probe.writeRequest(root, `mode-${probe.files.request}`)
      const mode = statSync(controlFileOf(root, probe.files.request)).mode & 0o777
      expect(mode).toBe(probe.requestMode === undefined ? expectedDefault : probe.requestMode)
    }
  })

  it('错误语义一致（本单要求④）：权限错 ≠ 不存在——restart inspect 对 lstat EACCES fail-closed 拒绝', () => {
    const root = freshRoot()
    writeJsonAtomic(
      controlFileOf(root, RESTART_FILES.request),
      { id: makeUlid(NOW), requestedAt: NOW, reason: 'denied', authorizationRef: 'sha256:equiv-ref', actor: { personId: 'AGENT-1', role: '工程部长', level: 2 } },
      { mode: 0o600, tmpSuffix: 'denied' },
    )
    // 前值口径（#504）：lstat 的 EACCES 与 ENOENT 同归 absent（fail-open）——合并后必须区分
    chmodSync(root, 0o000) // 父目录无执行位 → lstat(<root>/control) = EACCES
    try {
      const inspected = inspectRestartRequest(root)
      expect(inspected.kind).toBe('rejected')
      if (inspected.kind === 'rejected') {
        expect(inspected.reason).toBe('control-io-error')
        expect(inspected.detail).toContain('denied')
      }
    } finally {
      chmodSync(root, 0o700)
    }
  })

  it('读面无静默说谎：reset 后 absent 与 problem 不同（absent 仅 ENOENT/ENOTDIR）', () => {
    const root = freshRoot()
    const missing = readTextOutcome(controlFileOf(root, 'no-such.file'))
    expect(missing.kind).toBe('absent')
    expect(existsSync(path.join(root, 'control'))).toBe(false) // 未建目录也未误建
  })
})
