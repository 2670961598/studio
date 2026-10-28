/**
 * port-smoke.test.ts —— V2 ports 分区类型级冒烟（MIG-03 / IMPL-03-03）
 *
 * 依据：plan/05 IMPL-03-03、plan/03 §四 MIG-03、docs/v2/14 §一（PORT- 13 签名）/
 *       §二（端口-文件映射单点表）、docs/v2/05 §四（13 端口职责）、docs/v2/09 §一-11。
 *
 * 本文件只证三件事（不冒充业务覆盖）：
 *   1. 十个新端口模块可导入，`PORT_*` 常量与 v2/14 §二 的 13 个端口名对应；
 *   2. `PORT_VERSION` 仍为 `v0`（experimental 声明未被本单改动）；
 *   3. 各端口签名可被最小合法值调用（编译期检查）。签名调用面在
 *      `port-signatures-core.ts` / `port-signatures-rest.ts` 两件（各 ≤600 行），
 *      本文件只断言其存在，不在测试运行时执行（端口无实现，不伪造运行）。
 *
 * 03-04 预留：gate.ts / obs.ts / ops.ts 尚未建件（本单只做业务端口十件）；
 * 端口名集合仍按 v2/14 §二 断言 13 个，含三件预留，防「新增第 14 端口」。
 */
import { describe, expect, it } from 'vitest'
import { PORT_VERSION } from '../../../src/index.ts'

import * as defPort from '../../../src/ports/def.ts'
import * as regPort from '../../../src/ports/reg.ts'
import * as authPort from '../../../src/ports/auth.ts'
import * as hrPort from '../../../src/ports/hr.ts'
import * as workPort from '../../../src/ports/work.ts'
import * as execPort from '../../../src/ports/exec.ts'
import * as wsPort from '../../../src/ports/ws.ts'
import * as evdPort from '../../../src/ports/evd.ts'
import * as histPort from '../../../src/ports/hist.ts'
import * as trustPort from '../../../src/ports/trust.ts'

import { compileOnlyCorePortSurface } from './port-signatures-core.ts'
import { compileOnlyRestPortSurface } from './port-signatures-rest.ts'

/** v2/14 §二 端口-文件映射（唯一源；本文件不复制到 src —— 03-04 收口再定导出面） */
const PORT_FILE_MAP = [
  ['PORT-DEF', 'def.ts'],
  ['PORT-REG', 'reg.ts'],
  ['PORT-AUTH', 'auth.ts'],
  ['PORT-HR', 'hr.ts'],
  ['PORT-WORK', 'work.ts'],
  ['PORT-EXEC', 'exec.ts'],
  ['PORT-WS', 'ws.ts'],
  ['PORT-EVD', 'evd.ts'],
  ['PORT-HIST', 'hist.ts'],
  ['PORT-TRUST', 'trust.ts'],
  ['PORT-GATE', 'gate.ts'],
  ['PORT-OBS', 'obs.ts'],
  ['PORT-OPS', 'ops.ts'],
] as const

const NEW_PORT_MODULES = [
  { expected: 'PORT-DEF', actual: defPort.PORT_DEF },
  { expected: 'PORT-REG', actual: regPort.PORT_REG },
  { expected: 'PORT-AUTH', actual: authPort.PORT_AUTH },
  { expected: 'PORT-HR', actual: hrPort.PORT_HR },
  { expected: 'PORT-WORK', actual: workPort.PORT_WORK },
  { expected: 'PORT-EXEC', actual: execPort.PORT_EXEC },
  { expected: 'PORT-WS', actual: wsPort.PORT_WS },
  { expected: 'PORT-EVD', actual: evdPort.PORT_EVD },
  { expected: 'PORT-HIST', actual: histPort.PORT_HIST },
  { expected: 'PORT-TRUST', actual: trustPort.PORT_TRUST },
] as const

describe('V2 ports 分区冒烟（IMPL-03-03）', () => {
  it('PORT_VERSION 仍为 v0（experimental 声明未动）', () => {
    expect(PORT_VERSION).toBe('v0')
  })

  it('端口名集合与 v2/14 §二一致：13 个名字（含 gate/obs/ops 预留）', () => {
    const ids = PORT_FILE_MAP.map(([id]) => id)
    const files = PORT_FILE_MAP.map(([, file]) => file)
    expect(ids).toHaveLength(13)
    expect(new Set(ids).size).toBe(13)
    expect(new Set(files).size).toBe(13)
    for (const file of files) {
      expect(file.endsWith('.ts')).toBe(true)
    }
    expect(ids).toEqual([
      'PORT-DEF',
      'PORT-REG',
      'PORT-AUTH',
      'PORT-HR',
      'PORT-WORK',
      'PORT-EXEC',
      'PORT-WS',
      'PORT-EVD',
      'PORT-HIST',
      'PORT-TRUST',
      'PORT-GATE',
      'PORT-OBS',
      'PORT-OPS',
    ])
    expect(ids).toContain('PORT-GATE')
    expect(ids).toContain('PORT-OBS')
    expect(ids).toContain('PORT-OPS')
  })

  it('十个新端口模块可导入，PORT_* 常量与映射一致', () => {
    expect(NEW_PORT_MODULES).toHaveLength(10)
    for (const entry of NEW_PORT_MODULES) {
      expect(entry.actual).toBe(entry.expected)
    }
    const newIds = NEW_PORT_MODULES.map((entry) => entry.expected)
    const mappedIds = PORT_FILE_MAP.map(([id]) => id)
    for (const id of newIds) {
      expect(mappedIds).toContain(id)
    }
  })

  it('类型级调用面可编译（只检查桩函数存在，不执行端口调用）', () => {
    expect(typeof compileOnlyCorePortSurface).toBe('function')
    expect(typeof compileOnlyRestPortSurface).toBe('function')
  })
})
