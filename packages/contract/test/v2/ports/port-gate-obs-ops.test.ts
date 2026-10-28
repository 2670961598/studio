/**
 * port-gate-obs-ops.test.ts —— V2 ports 分区 gate/obs/ops 三件＋导出面收口（MIG-03 / IMPL-03-04）
 *
 * 依据：plan/05 IMPL-03-04、plan/03 §四 MIG-03、docs/v2/14 §1.8（GATE/OBS/OPS 签名）/
 *       §二（端口-文件映射单点表·F5 唯一源）/§四（对外 API 只读面）、docs/v2/05 §四
 *       （13 端口职责）、docs/v2/08 §4.1/§4.4（六态与读面写面隔离）、
 *       docs/v2/11 REC-OBS-01/02、REC-WORK-18、docs/v2/09 ENU-52/57/59/119/120/121/122。
 *
 * 本文件＋同目录 `port-signatures-gate-obs-ops.ts` 合计只证五件事（不冒充业务覆盖）：
 *   1. gate/obs/ops 三模块可导入，`PORT_*` 常量与 v2/14 §二 映射一致；
 *   2. 13 端口映射完整 13/13（模块常量＝映射表＝`ports/index.ts` 导出值，三面一致）；
 *   3. `ports/index.ts` 收口后 `PORT_VERSION` 仍为 `v0`，v0 旧导出未删（兼容期）；
 *   4. 关键拒绝条件由**类型**承载（`@ts-expect-error` 钉死：消息当承诺/发送≠接受/
 *      监控改事实/未知补 0/迁移候选当激活/新权源/comment 借道——放行即类型门红）；
 *   5. 最小合法值可构造、三端口方法签名可调用（编译期，桩对象不执行端口逻辑）。
 *
 * 类型级钉面（第 4/5 件）落在非 `.test.ts` 辅助件，只对 `typecheck:v2` 负责
 * （两者都在 `tsconfig.v2.json` include 内）；本文件运行期断言只读常量与导入面，
 * 不伪造端口实现。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PORT_VERSION } from '../../../src/index.ts'
import * as authPort from '../../../src/ports/auth.ts'
import * as defPort from '../../../src/ports/def.ts'
import * as evdPort from '../../../src/ports/evd.ts'
import * as execPort from '../../../src/ports/exec.ts'
import * as gatePort from '../../../src/ports/gate.ts'
import * as histPort from '../../../src/ports/hist.ts'
import * as hrPort from '../../../src/ports/hr.ts'
import * as obsPort from '../../../src/ports/obs.ts'
import * as opsPort from '../../../src/ports/ops.ts'
import * as portsIndex from '../../../src/ports/index.ts'
import * as regPort from '../../../src/ports/reg.ts'
import * as trustPort from '../../../src/ports/trust.ts'
import * as workPort from '../../../src/ports/work.ts'
import * as wsPort from '../../../src/ports/ws.ts'

import {
  compileOnlyGateObsOpsSurface,
  pinRejectedShapes,
} from './port-signatures-gate-obs-ops.ts'

const PORTS_DIR = new URL('../../../src/ports/', import.meta.url)

/**
 * v2/14 §二 端口-文件映射单点表（13 行；本文件不复制到 src——单一源是 v2/14 §二
 * 与各模块 `PORT_*` 常量，测试只做机械比对）。
 */
const PORT_FILE_MAP = [
  ['PORT-DEF', 'def.ts', defPort.PORT_DEF],
  ['PORT-REG', 'reg.ts', regPort.PORT_REG],
  ['PORT-AUTH', 'auth.ts', authPort.PORT_AUTH],
  ['PORT-HR', 'hr.ts', hrPort.PORT_HR],
  ['PORT-WORK', 'work.ts', workPort.PORT_WORK],
  ['PORT-EXEC', 'exec.ts', execPort.PORT_EXEC],
  ['PORT-WS', 'ws.ts', wsPort.PORT_WS],
  ['PORT-EVD', 'evd.ts', evdPort.PORT_EVD],
  ['PORT-HIST', 'hist.ts', histPort.PORT_HIST],
  ['PORT-TRUST', 'trust.ts', trustPort.PORT_TRUST],
  ['PORT-GATE', 'gate.ts', gatePort.PORT_GATE],
  ['PORT-OBS', 'obs.ts', obsPort.PORT_OBS],
  ['PORT-OPS', 'ops.ts', opsPort.PORT_OPS],
] as const

/** 目录平铺名额上限（docs/v2/14 §二 目录预算：阈=25（B4/v2/16）；ports 现 22，余量留提案流） */
const MAX_PORTS_FILES = 25

describe('V2 ports 分区 gate/obs/ops＋导出面收口（IMPL-03-04）', () => {
  it('PORT_VERSION 仍为 v0（收口不动 experimental 声明）', () => {
    expect(PORT_VERSION).toBe('v0')
    expect(portsIndex.PORT_VERSION).toBe('v0')
  })

  it('13 端口映射完整 13/13：端口名＝模块常量＝映射表文件，三面一致', () => {
    expect(PORT_FILE_MAP).toHaveLength(13)
    const ids = PORT_FILE_MAP.map(([id]) => id)
    const files = PORT_FILE_MAP.map(([, file]) => file)
    expect(new Set(ids).size).toBe(13)
    expect(new Set(files).size).toBe(13)
    for (const [id, file, constant] of PORT_FILE_MAP) {
      expect(constant).toBe(id)
      expect(file.endsWith('.ts')).toBe(true)
    }
  })

  it('13 端口模块文件实际落位，目录平铺名额 ≤25', () => {
    const dirFiles = readdirSync(fileURLToPath(PORTS_DIR))
    for (const [, file] of PORT_FILE_MAP) {
      expect(dirFiles).toContain(file)
    }
    expect(dirFiles.length).toBeLessThanOrEqual(MAX_PORTS_FILES)
  })

  it('ports/index.ts 导出 13 个 PORT_* 常量（无第 14 端口），且旧导出保留', () => {
    // PORT_VERSION／PortGrade 是导出面声明，不是端口名：按「PORT_ + 端口短名」筛
    const portConsts = Object.keys(portsIndex).filter(
      (key) => /^PORT_[A-Z]+$/.test(key) && key !== 'PORT_VERSION',
    )
    expect(portConsts).toHaveLength(13)
    expect(portConsts.sort()).toEqual(PORT_FILE_MAP.map(([id]) => id.replace('-', '_')).sort())

    // v0 兼容期：invoke/notifier 等旧件的值导出不删（退役归 MIG-06）
    for (const legacy of ['EXTERNAL_AI_TOOLS', 'GATEWAY_ACTIONS', 'PLATFORM_ACTIVITY_KINDS']) {
      expect(Object.keys(portsIndex)).toContain(legacy)
    }
  })

  it('三件各自只声明一个 PORT_* 常量（不新增第 14 端口）', () => {
    expect(gatePort.PORT_GATE).toBe('PORT-GATE')
    expect(obsPort.PORT_OBS).toBe('PORT-OBS')
    expect(opsPort.PORT_OPS).toBe('PORT-OPS')
    for (const mod of [gatePort, obsPort, opsPort]) {
      expect(Object.keys(mod).filter((key) => /^PORT_[A-Z]+$/.test(key))).toHaveLength(1)
    }
  })

  it('gate 出口面：凭证三档 ENU-120 与工具面两档 ENU-121（第三级显式不存在）', () => {
    expect(gatePort.API_CREDENTIAL_TIERS).toEqual(['public', 'partner', 'signed'])
    expect(gatePort.API_TOOL_SCOPES).toEqual(['read_only', 'intake_comment'])
    expect(gatePort.API_TOOL_SCOPES).not.toContain('dispatch')
    expect(gatePort.API_TOOL_SCOPES).not.toContain('harvest')
  })

  it('obs 六态 6/6（ENU-52）与故障类别 7 项（ENU-59）', () => {
    expect(obsPort.PROJECTION_STATES).toEqual([
      'observed',
      'derived',
      'unknown',
      'stale',
      'conflicted',
      'gapped',
    ])
    expect(obsPort.PROJECTION_FAULT_KINDS).toHaveLength(7)
    expect(obsPort.PROJECTION_FAULT_KINDS).toContain('stale_view')
  })

  it('ops 供能单向 PORT-AUTH 与控制面词族 6 动词（ENU-119）', () => {
    expect(opsPort.OPS_AUTHORITY_SOURCE).toBe('PORT-AUTH')
    expect(opsPort.CONTROL_PLANE_ACTIONS).toHaveLength(6)
    for (const action of opsPort.CONTROL_PLANE_ACTIONS) {
      expect(action.startsWith('ctl-')).toBe(true)
    }
    expect(opsPort.CONTROL_PLANE_ACTIONS).not.toContain('comment')
  })

  it('v0 旧件头注带退役注记且正文面未改（MIG-06 删除）', () => {
    const invokeSrc = readFileSync(new URL('invoke.ts', PORTS_DIR), 'utf8')
    const notifierSrc = readFileSync(new URL('notifier.ts', PORTS_DIR), 'utf8')
    for (const src of [invokeSrc, notifierSrc]) {
      expect(src).toContain('MIG-06')
      expect(src).toContain('退役')
    }
    expect(invokeSrc).toContain('export interface InvokeSource')
    expect(invokeSrc).toContain("kind: 'ticket' | 'mention' | 'schedule'")
    expect(notifierSrc).toContain('export interface Notifier')
    expect(notifierSrc).toContain('EXTERNAL_AI_TOOLS')
  })

  it('类型级调用面可编译（三端口桩对象，不执行端口调用）', () => {
    expect(typeof compileOnlyGateObsOpsSurface).toBe('function')
    expect(typeof pinRejectedShapes).toBe('function')
  })
})

// 编译期钉面在 `port-signatures-gate-obs-ops.ts`（非 .test.ts，不进 vitest 收集，
// 只由 `typecheck:v2` 编译）：最小合法值＋三端口方法签名可调用＋关键拒绝条件
// `@ts-expect-error` 钉死。本文件只断言其存在，不在运行期执行端口调用。
