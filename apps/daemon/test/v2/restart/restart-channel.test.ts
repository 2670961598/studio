/**
 * restart-channel —— 受权重启控制通道 S1 单测（studio-dev-504）
 *
 * 覆盖：#497 plan §4.6 文件面/结构面/授权面/组织面/重放面 + §10.1 接口；
 * 负向 N1–N7 与 N6 provenance 两形；拒绝留痕走 `SCHEMA_EVOLVE;RESTART;` 过渡口径（C-1）。
 * 不碰生产：全部 tmp 根 + 临时台账。
 */
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  consumeRestartRequest,
  effectiveDrainTimeoutMs,
  inspectRestartRequest,
  loadRestartAuthorizations,
  readRestartResult,
  rejectRestartRequest,
  RESTART_LAST_SEEN_KV_KEY,
  RESTART_REQUEST_CONSUMED_FILE,
  RESTART_REQUEST_FILE,
  restartDirOf,
  restartNote,
  validateRestartAuthorization,
  writeRestartRequest,
  type RestartAuthorization,
  type RestartOrgSnapshot,
  type RestartRequest,
} from '../../../src/control/restart/channel.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

let root = ''
let ledger: Ledger
const NOW = 1_793_000_000_000

const auth: RestartAuthorization = {
  ref: 'sha256:approved-ref-504',
  approver: 'AGENT-1',
  approverRole: '工程部长',
  issuedAt: NOW - 60_000,
  expiresAt: NOW + 3_600_000,
  scope: 'daemon-restart',
  text: '制作人 2026-11-03 令：授权受权重启（测试）',
}

const org: RestartOrgSnapshot = {
  people: [
    { id: 'AGENT-1', level: 2, dept: 'departments/工程部', status: 'active', role: '工程部长' },
    { id: 'ENG-1', level: 1, dept: 'departments/工程部', status: 'active' },
  ],
  departments: [{ path: 'departments/工程部', parent: null, leader: 'AGENT-1' }],
  companyLevel: 2,
}

function validRequest(over: Partial<RestartRequest> = {}): RestartRequest {
  return {
    id: makeUlid(NOW),
    requestedAt: NOW,
    reason: '制作人令：受权重启验证',
    authorizationRef: auth.ref,
    actor: { personId: 'AGENT-1', role: '工程部长', level: 2 },
    ...over,
  }
}

function check(request: RestartRequest, over: Partial<Parameters<typeof validateRestartAuthorization>[0]> = {}) {
  return validateRestartAuthorization({
    request,
    authorizations: [auth],
    org,
    now: NOW,
    usedRefs: new Set(),
    extraAuthorizers: new Set(),
    ...over,
  })
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-restart-channel-'))
  ledger = openLedger(path.join(root, 'ledger.sqlite'))
})

afterAll(() => {
  ledger.close()
  chmodSync(path.join(root, 'control'), 0o700)
  rmSync(root, { recursive: true, force: true })
})

describe('S1 文件面：写/读/消费（原子协议）', () => {
  it('合法请求：写→读回深等，control 面 0700 / 文件 0600', () => {
    const request = validRequest()
    writeRestartRequest(root, request)
    const inspected = inspectRestartRequest(root, process.getuid === undefined ? {} : { expectedUid: process.getuid() })
    expect(inspected.kind).toBe('ok')
    if (inspected.kind === 'ok') expect(inspected.request).toEqual(request)
    expect(restartDirOf(root)).toBe(path.join(root, 'restart'))
  })

  it('消费请求：原子改名 .consume，live 面清空；重复消费 false 不炸', () => {
    expect(consumeRestartRequest(root)).toBe(true)
    expect(inspectRestartRequest(root).kind).toBe('absent')
    expect(consumeRestartRequest(root)).toBe(false)
  })

  it('N7 坏 JSON → bad-json（不崩、不当授权）', () => {
    writeFileSync(path.join(root, 'control', RESTART_REQUEST_FILE), '{oops', { encoding: 'utf8', mode: 0o600 })
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('bad-json')
  })

  it('N7 未知字段 → unknown-field（strict schema）', () => {
    const request = { ...validRequest(), extra: true }
    writeFileSync(path.join(root, 'control', RESTART_REQUEST_FILE), JSON.stringify(request), { encoding: 'utf8', mode: 0o600 })
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('unknown-field')
  })

  it('N1 缺 authorizationRef → auth-ref-missing', () => {
    const { authorizationRef: _dropped, ...rest } = validRequest()
    writeFileSync(path.join(root, 'control', RESTART_REQUEST_FILE), JSON.stringify(rest), { encoding: 'utf8', mode: 0o600 })
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('auth-ref-missing')
  })

  it('id 非 ULID → id-invalid', () => {
    writeFileSync(path.join(root, 'control', RESTART_REQUEST_FILE), JSON.stringify(validRequest({ id: 'not-a-ulid' })), {
      encoding: 'utf8',
      mode: 0o600,
    })
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('id-invalid')
  })

  it('N6 符号链接 → control-file-provenance', () => {
    unlinkSync(path.join(root, 'control', RESTART_REQUEST_FILE))
    const target = path.join(root, 'request-target.json')
    writeFileSync(target, JSON.stringify(validRequest()), { encoding: 'utf8', mode: 0o600 })
    symlinkSync(target, path.join(root, 'control', RESTART_REQUEST_FILE))
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('control-file-provenance')
    unlinkSync(path.join(root, 'control', RESTART_REQUEST_FILE))
  })

  it('N6 硬链接 → control-file-provenance（nlink>1）', () => {
    const target = path.join(root, 'hardlink-target.json')
    writeFileSync(target, JSON.stringify(validRequest()), { encoding: 'utf8', mode: 0o600 })
    linkSync(target, path.join(root, 'control', RESTART_REQUEST_FILE))
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('control-file-provenance')
    unlinkSync(path.join(root, 'control', RESTART_REQUEST_FILE))
    unlinkSync(target)
  })

  it('N6 control 目录宽权限 0777 → control-file-provenance', () => {
    writeRestartRequest(root, validRequest())
    chmodSync(path.join(root, 'control'), 0o777)
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('control-file-provenance')
    chmodSync(path.join(root, 'control'), 0o700)
  })

  it('owner 不符（expectedUid 错配）→ control-file-provenance', () => {
    writeRestartRequest(root, validRequest())
    const inspected = inspectRestartRequest(root, { expectedUid: (process.getuid?.() ?? 0) + 1 })
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('control-file-provenance')
  })

  it('文件超 8192B → control-file-provenance', () => {
    writeFileSync(path.join(root, 'control', RESTART_REQUEST_FILE), 'x'.repeat(8193), { encoding: 'utf8', mode: 0o600 })
    const inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('control-file-provenance')
  })

  it('drainTimeoutMs 越界（<5000/>1800000）→ timeout-invalid；合法值可读', () => {
    writeFileSync(
      path.join(root, 'control', RESTART_REQUEST_FILE),
      JSON.stringify(validRequest({ id: makeUlid(NOW + 1), drainTimeoutMs: 1 })),
      { encoding: 'utf8', mode: 0o600 },
    )
    let inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('rejected')
    if (inspected.kind === 'rejected') expect(inspected.reason).toBe('timeout-invalid')
    writeRestartRequest(root, validRequest({ id: makeUlid(NOW + 2), drainTimeoutMs: 5000 }))
    inspected = inspectRestartRequest(root)
    expect(inspected.kind).toBe('ok')
    if (inspected.kind === 'ok') expect(inspected.request.drainTimeoutMs).toBe(5000)
  })
})

describe('S1 授权链：ref/期限/一次性/组织相对谓词（N2–N5）', () => {
  it('合法：ref 命中+有效期内+组织 leader → ok', () => {
    const verdict = check(validRequest())
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.authorization.ref).toBe(auth.ref)
  })

  it('N2 伪造 ref → auth-ref-unknown（不 burn、不进 draining 由调用方保证）', () => {
    const verdict = check(validRequest({ authorizationRef: 'sha256:forged' }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('auth-ref-unknown')
  })

  it('N3 过期授权 → auth-expired', () => {
    const verdict = check(validRequest(), { now: auth.expiresAt + 1 })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('auth-expired')
  })

  it('N4 越级 actor（非 leader 的执行岗）→ actor-not-authorized', () => {
    const verdict = check(validRequest({ actor: { personId: 'ENG-1', role: '执行', level: 1 } }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('actor-not-authorized')
  })

  it('N5 重放：usedRefs 命中 → auth-replayed', () => {
    const verdict = check(validRequest(), { usedRefs: new Set([auth.ref]) })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('auth-replayed')
  })

  it('actor 不在册/非 active → actor-unknown', () => {
    const unknown = check(validRequest({ actor: { personId: 'GHOST', role: 'x', level: 2 } }))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toBe('actor-unknown')
    const retiredOrg: RestartOrgSnapshot = { ...org, people: [{ ...org.people[0]!, status: 'retired' }] }
    const retired = check(validRequest(), { org: retiredOrg })
    expect(retired.ok).toBe(false)
    if (!retired.ok) expect(retired.reason).toBe('actor-unknown')
  })

  it('组织相对谓词不硬编码 level>=8：3 级公司 leader（level 3）放行', () => {
    const org3: RestartOrgSnapshot = {
      people: [{ id: 'ENG-0', level: 3, dept: 'departments/研发部', status: 'active' }],
      departments: [{ path: 'departments/研发部', parent: null, leader: 'ENG-0' }],
      companyLevel: 3,
    }
    const verdict = check(validRequest({ actor: { personId: 'ENG-0', role: '研发部长', level: 3 } }), { org: org3 })
    expect(verdict.ok).toBe(true)
  })

  it('下限：leader 但 level < min(companyLevel,8) 且不在白名单 → 拒；白名单可放行', () => {
    const lowOrg: RestartOrgSnapshot = { ...org, people: [{ ...org.people[0]!, level: 1 }], companyLevel: 5 }
    const denied = check(validRequest(), { org: lowOrg })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.reason).toBe('actor-not-authorized')
    const allowed = check(validRequest(), { org: lowOrg, extraAuthorizers: new Set(['AGENT-1']) })
    expect(allowed.ok).toBe(true)
  })

  it('授权装载：file/inline 二选一；坏 JSON/空数组成员启动即拒', () => {
    expect(loadRestartAuthorizations({ inline: JSON.stringify([auth]) })).toEqual([auth])
    expect(() => loadRestartAuthorizations({ inline: '[]' })).not.toThrow()
    expect(() => loadRestartAuthorizations({ inline: '{bad' })).toThrow()
    expect(() => loadRestartAuthorizations({ inline: JSON.stringify([{ ...auth, scope: 'other' }]) })).toThrow(/scope/)
    expect(() => loadRestartAuthorizations({})).toThrow(/restartAuthorizationFile|restartAuthorizations/)
  })
})

describe('S1 拒绝留痕/期限/事件 note（C-1 过渡口径）', () => {
  it('rejectRestartRequest：回执+事件 note 前缀+请求消费（拒绝不改运行态）', () => {
    writeRestartRequest(root, validRequest({ id: makeUlid(NOW + 3) }))
    const requestId = inspectRestartRequest(root)
    expect(requestId.kind).toBe('ok')
    rejectRestartRequest(ledger, {
      rootDir: root,
      company: 'demo',
      level: 2,
      dept: 'departments/工程部',
      id: makeUlid(NOW + 3),
      reason: 'actor-not-authorized',
      detail: '测试拒绝',
      actorId: 'ENG-1',
      file: path.join(root, 'control', RESTART_REQUEST_FILE),
      now: NOW,
    })
    const result = readRestartResult(root)
    expect(result?.ok).toBe(false)
    expect(result?.state).toBe('rejected')
    const event = ledger.queryEvents().find((e) => (e.note ?? '').startsWith('SCHEMA_EVOLVE;RESTART;phase=rejected'))
    expect(event).toBeDefined()
    expect(event?.event).toBe('SCHEMA_EVOLVE')
    expect(event?.note).toContain('reason=actor-not-authorized')
    expect(inspectRestartRequest(root).kind).toBe('absent')
    expect(RESTART_REQUEST_CONSUMED_FILE).toContain('restart.request.json')
  })

  it('restartNote：单行、前缀恒定、分号/换行被清洗', () => {
    const note = restartNote('started', [
      ['reason', 'a;b\nc'],
      ['authorizer', 'AGENT-1'],
    ])
    expect(note.startsWith('SCHEMA_EVOLVE;RESTART;phase=started;')).toBe(true)
    expect(note).not.toContain('\n')
    expect(note.split(';').filter((p) => p === 'b')).toHaveLength(0)
  })

  it('effectiveDrainTimeoutMs：请求只能收紧（min），缺省=配置', () => {
    expect(effectiveDrainTimeoutMs(180_000)).toBe(180_000)
    expect(effectiveDrainTimeoutMs(180_000, 120_000)).toBe(120_000)
    expect(effectiveDrainTimeoutMs(60_000, 120_000)).toBe(60_000)
  })

  it('去重位键名冻结（跨重启读回）', () => {
    ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, 'seen-id')
    expect(ledger.kvGet(RESTART_LAST_SEEN_KV_KEY)).toBe('seen-id')
  })
})
