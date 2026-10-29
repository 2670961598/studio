/**
 * ops-runtime —— serve 装配面：PORT-OPS 进 ServeRuntime（OPS 补形 A）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.8（PORT-OPS）/§1.6（PORT-HIST 唯一记录写口）、
 *     docs/v2/11 §六 REC-WORK-18、docs/49「OPS 补形 A」；
 *   - docs/v2/16 §三 daemon 行（serve 装配面）；docs/17-§2（主循环相位不改）。
 *
 * 断言面：
 *   ① buildServeRuntime 返回 `ops`（emergencyStop/circuitBreak 装配面存在）；
 *   ② 经 runtime.ops 落 REC-WORK-18 记录到 PORT-HIST（真台账可回读）；
 *   ③ runServe 只持有装配面、不自动触发 emergencyStop（停机文件协议行为不变）——
 *      以源码静态断言钉住「本文件零 ops.emergencyStop/circuitBreak 调用」；
 *   ④ 装配/停机不回归（runtime.stop 收口）。
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallContext, EmergencyStopRequest } from '@studio-next/contract'
import { createHistFace, openLedger, type Ledger } from '@studio-next/store'
import {
  buildServeRuntime,
  DEFAULT_SERVE_CONFIG,
  DEMO_SNAPSHOT,
  type ServeConfig,
  type ServeRuntime,
} from '../../../src/assembly/serve.ts'

const AT = '2026-11-01T00:00:00.000Z'
const CLOCK_MS = Date.parse(AT)
const DUE = '2026-11-02T00:00:00.000Z'

let root = ''
let ledger: Ledger
let runtime: ServeRuntime
let logs: string[] = []

function configOf(): ServeConfig {
  return {
    ...DEFAULT_SERVE_CONFIG,
    db: path.join(root, 'ledger.db'),
    company: 'demo',
    rootDir: path.join(root, 'run'),
    reloadWatch: false,
    jobs: false,
    matrix: false,
    fileWatch: false,
  }
}

function opsContext(): CallContext {
  return {
    company: { companyId: 'company-demo', slug: 'demo' },
    caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
    authority: [],
    signature: { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
  }
}

function stopRequest(): EmergencyStopRequest {
  return {
    authorization: { poweredBy: 'decision', decisionRef: 'REC-DEC-01' },
    reason: '现场最小止损（装配面验证）',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: {
      preset: true,
      boundaryRef: 'boundary-1',
      boundaryRecordRef: { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' },
      permittedActions: ['停止对外写入'],
    },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [{ refId: 'evidence-1', refVersion: '1.0.0' }],
    notified: [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }],
    review: { reviewerRef: 'audit-1', due: DUE },
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-v2-ops-runtime-'))
  ledger = openLedger(configOf().db)
  logs = []
  runtime = buildServeRuntime(configOf(), ledger, DEMO_SNAPSHOT, {
    log: (line) => logs.push(line),
    clock: () => CLOCK_MS,
  })
})

afterAll(async () => {
  try {
    await runtime.stop()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

describe('buildServeRuntime：PORT-OPS 装配面存在且接到 PORT-HIST', () => {
  it('ServeRuntime.ops 两方法齐备（OperationsPort 的 control 实现）；装配日志显式', () => {
    expect(typeof runtime.ops.emergencyStop).toBe('function')
    expect(typeof runtime.ops.circuitBreak).toBe('function')
    expect(logs.some((line) => line.includes('PORT-OPS 落口已装配') && line.includes('PORT-HIST'))).toBe(true)
  })

  it('经 runtime.ops.emergencyStop 落库：REC-WORK-18 记录可经同一台账回读（信封/producer/生效槽）', () => {
    const outcome = runtime.ops.emergencyStop(stopRequest(), opsContext())
    if (outcome.kind !== 'ok') throw new Error(`预期 Ok，收到 ${outcome.error.category}/${outcome.error.subcause}`)
    // 台账句柄由 runtime 装配持有（outbound 受闸 Proxy 透传 db）——测试用原句柄读同库
    const hist = createHistFace(ledger.db)
    const record = hist.get(outcome.value.recordId)
    expect(record).toBeDefined()
    expect(record?.recordType).toBe('REC-WORK-18')
    expect(record?.companyRef).toBe('demo')
    expect(record?.producedAt).toBe(AT)
    expect(record?.producer.decidedBy).toBe('ctl:ops')
    expect(record?.producer.writtenBy).toBe('daemon:assembly/ops')
    const payload = record?.payload as { actions_taken?: unknown; notified?: unknown }
    expect(payload.actions_taken).toEqual(['停止对外写入'])
    expect(payload.notified).toEqual([{ refId: 'G9.internal-boss', refVersion: '1.0.0' }])
  })

  it('runServe 只持有装配面、不自动触发 emergencyStop（源码零调用；文件协议停机路径不变）', () => {
    const runSource = readFileSync(fileURLToPath(new URL('../../../src/assembly/serve/run.ts', import.meta.url)), 'utf8')
    expect(runSource).not.toContain('ops.emergencyStop')
    expect(runSource).not.toContain('ops.circuitBreak')
    expect(runSource).toContain('void ops')
  })
})
