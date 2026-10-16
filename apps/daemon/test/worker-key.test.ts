/**
 * worker-key 单测 —— 签发形状/文件通道（0600）/轮换/吊销/时效（17-§7 daemon 侧闭环的件级断言）
 *
 * 覆盖面（实现单验收口径）：
 *   - 签发：scope=GATEWAY_ACTIONS 六动词全集、ticket 绑定、nonce 注入唯一、TTL 缺省/自定义
 *     （exp 差）、过期边界（now===exp 即拒）
 *   - 文件通道：路径 `<workspace>/.studio-next/wkey`、内容 `STUDIO_TOOLS_WKEY=<token>` 一行、
 *     权限 0600（目录 0700）、readWorkerKeyFile 剥前缀/裸 token 兼容/缺文件 fail-closed
 *   - 吊销：revoke 后 verify → 'revoked'（先于过期/重放判定）；ticket 吊销是终局（吊销后
 *     再签的同 ticket key 出生即死——冻结面行为锚定）；重派轮换=非终局撤离（删文件不吊销），
 *     两 attempt token 不同（nonce 链干净）
 *   - nonce 单次有效现行语义锚定（同 token 二次 verify → 'replay'——gateway/wkey.ts 头注疑点）
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import {
  mintWorkerKey,
  readWorkerKeyFile,
  removeWorkerKeyFile,
  workerKeyFilePath,
  workerKeyGuidance,
  writeWorkerKeyFile,
  WORKER_WKEY_DIR,
  WORKER_WKEY_ENV_KEY,
  WORKER_WKEY_FILENAME,
  WORKER_WKEY_TTL_DEFAULT,
} from '../src/worker-key.ts'

const SECRET = new Uint8Array(32).fill(9)
const SIG_CTX = { company: 'Wkey 单测公司', dept: 'departments/工程部', role: 'worker', level: 2 }

let root = ''
let now = 1_800_000_000_000

/** 全局唯一 nonce 源（authority 的 seenNonces 全局去重——各用例不得自带独立闭包，否则跨用例撞 nonce-1 重放） */
const nextNonce = nonceSeq()

/** 签发/吊销机构（verify 面绑 CONTROL_TICKET——daemon 侧形态；断言直接走 authority.verify） */
const gateway = createGateway({ secret: SECRET, clock: (): number => now, ticket: CONTROL_TICKET, ctx: SIG_CTX, author: 'daemon' })

/** 非空 nonce 序列（确定性注入：一 mint 一 nonce） */
function nonceSeq(): () => string {
  let n = 0
  return (): string => {
    n += 1
    return `nonce-${n}`
  }
}

function verifyToken(token: string, ticket: string, action: (typeof GATEWAY_ACTIONS)[number] = 'comment') {
  return gateway.authority.verify(token, { now, ticket, action })
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-worker-key-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('签发形状（mintWorkerKey）', () => {
  it('token 可验：ticket 绑定正确、scope=GATEWAY_ACTIONS 六动词全集', () => {
    const minted = mintWorkerKey(gateway, { ticket: 'T-1', makeNonce: nextNonce })
    const v = verifyToken(minted.token, 'T-1')
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.claims.ticket).toBe('T-1')
      expect(v.claims.scope).toEqual([...GATEWAY_ACTIONS])
      expect(v.claims.scope).toHaveLength(6)
      expect(v.claims.nonce).toBe(minted.nonce)
    }
  })

  it('TTL 缺省 24h；自定义 ttl 反映在 exp（签发时刻 + ttl 到期时刻）', () => {
    const def = mintWorkerKey(gateway, { ticket: 'T-2', makeNonce: nextNonce })
    const oneHour = mintWorkerKey(gateway, { ticket: 'T-2', ttl: '1h', makeNonce: nextNonce })
    const vd = verifyToken(def.token, 'T-2')
    const v1 = verifyToken(oneHour.token, 'T-2')
    expect(WORKER_WKEY_TTL_DEFAULT).toBe('24h')
    if (vd.ok) expect(vd.claims.exp).toBe(now + 24 * 3_600_000)
    if (v1.ok) expect(v1.claims.exp).toBe(now + 3_600_000)
  })

  it('过期边界：now >= exp 即拒（fail-closed；TTL 只是签发输入，token 内不存原串）', () => {
    const minted = mintWorkerKey(gateway, { ticket: 'T-3', ttl: '1s', makeNonce: nextNonce })
    now += 1_000
    const v = verifyToken(minted.token, 'T-3')
    expect(v).toEqual({ ok: false, reason: 'expired' })
    now -= 1_000
  })

  it('nonce 唯一性：不同 nonce → 不同 token；同 token 二次过闸 = replay（现行语义锚定）', () => {
    const a = mintWorkerKey(gateway, { ticket: 'T-4', makeNonce: nextNonce })
    const b = mintWorkerKey(gateway, { ticket: 'T-4', makeNonce: nextNonce })
    expect(a.token).not.toBe(b.token)
    expect(verifyToken(a.token, 'T-4').ok).toBe(true)
    expect(verifyToken(a.token, 'T-4')).toEqual({ ok: false, reason: 'replay' })
  })
})

describe('文件通道（writeWorkerKeyFile / readWorkerKeyFile / removeWorkerKeyFile）', () => {
  it('launch 前写：路径 <workspace>/.studio-next/wkey，内容一行 STUDIO_TOOLS_WKEY=<token>，权限 0600（目录 0700）', () => {
    const workspace = path.join(root, 'ws-a')
    const minted = mintWorkerKey(gateway, { ticket: 'T-10', makeNonce: nextNonce })
    const filePath = writeWorkerKeyFile(workspace, minted.token)
    expect(filePath).toBe(path.join(workspace, WORKER_WKEY_DIR, WORKER_WKEY_FILENAME))
    expect(existsSync(filePath)).toBe(true)
    // 权限精确断言（chmodSync 强制——不受进程 umask 影响）
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(statSync(path.join(workspace, WORKER_WKEY_DIR)).mode & 0o777).toBe(0o700)
    // 内容：env 赋值形态一行（studio-tools 宿主直注键名对齐）
    expect(readWorkerKeyFile(workspace)).toBe(minted.token)
  })

  it('readWorkerKeyFile：裸 token 行兼容；缺文件/空文件 → undefined（fail-closed 不猜）', () => {
    const bare = path.join(root, 'ws-bare')
    const minted = mintWorkerKey(gateway, { ticket: 'T-11', makeNonce: nextNonce })
    const filePath = writeWorkerKeyFile(bare, minted.token)
    writeFileSync(filePath, `${minted.token}\n`, 'utf8') // 覆写为裸 token 形态
    expect(readWorkerKeyFile(bare)).toBe(minted.token)
    expect(readWorkerKeyFile(path.join(root, 'ws-missing'))).toBeUndefined()
    const empty = path.join(root, 'ws-empty')
    writeWorkerKeyFile(empty, minted.token)
    writeFileSync(workerKeyFilePath(empty), '\n  \n', 'utf8')
    expect(readWorkerKeyFile(empty)).toBeUndefined()
  })

  it('removeWorkerKeyFile：删后文件消失；再删幂等不抛', () => {
    const workspace = path.join(root, 'ws-rm')
    const filePath = writeWorkerKeyFile(workspace, mintWorkerKey(gateway, { ticket: 'T-12', makeNonce: nextNonce }).token)
    expect(existsSync(filePath)).toBe(true)
    removeWorkerKeyFile(filePath)
    expect(existsSync(filePath)).toBe(false)
    expect(() => removeWorkerKeyFile(filePath)).not.toThrow()
  })

  it('任务书指引行：指到文件路径与 env 键名（一句话——「怎么调」归 MCP schema）', () => {
    const workspace = path.join(root, 'ws-guide')
    const line = workerKeyGuidance(workspace)
    expect(line).toContain(workerKeyFilePath(workspace))
    expect(line).toContain(WORKER_WKEY_ENV_KEY)
    expect(line).toContain('studio-wkey')
    expect(line).not.toContain('\n')
  })
})

describe('吊销与轮换（17-§7「关单即吊销」「一 attempt 一 key」）', () => {
  it('revoke(ticket)：同单全部 key 立即失效（先于过期/重放判定）', () => {
    const a = mintWorkerKey(gateway, { ticket: 'T-20', makeNonce: nextNonce })
    const b = mintWorkerKey(gateway, { ticket: 'T-20', makeNonce: nextNonce })
    gateway.revoke('T-20')
    expect(verifyToken(a.token, 'T-20')).toEqual({ ok: false, reason: 'revoked' })
    expect(verifyToken(b.token, 'T-20')).toEqual({ ok: false, reason: 'revoked' })
    // 幂等：重复吊销不复活
    gateway.revoke('T-20')
    expect(verifyToken(a.token, 'T-20')).toEqual({ ok: false, reason: 'revoked' })
  })

  it('重派轮换（非终局撤离）：旧 attempt 凭据文件删除、不吊销 ticket——新 key（新 nonce 新 token）照常可用，nonce 链干净', () => {
    const attempt1 = mintWorkerKey(gateway, { ticket: 'T-21', makeNonce: nextNonce })
    removeWorkerKeyFile(path.join(root, 'rot-att1', '.studio-next', 'wkey')) // 撤离面=文件删除（幂等，此处验证不抛）
    const attempt2 = mintWorkerKey(gateway, { ticket: 'T-21', makeNonce: nextNonce })
    expect(attempt2.token).not.toBe(attempt1.token)
    expect(attempt2.nonce).not.toBe(attempt1.nonce)
    // 非终局撤离不吊销：旧 key 在 TTL 内仍可验（失效兜底=TTL+nonce 单次——「吊销粒度裁决」）
    expect(verifyToken(attempt1.token, 'T-21').ok).toBe(true)
    expect(verifyToken(attempt2.token, 'T-21').ok).toBe(true)
  })

  it('ticket 吊销是终局（冻结面行为锚定）：吊销后再签的同 ticket key 出生即死——engine 不在 GATE_FAIL 吊销的机制依据', () => {
    const before = mintWorkerKey(gateway, { ticket: 'T-22', makeNonce: nextNonce })
    expect(verifyToken(before.token, 'T-22').ok).toBe(true)
    gateway.revoke('T-22')
    const after = mintWorkerKey(gateway, { ticket: 'T-22', makeNonce: nextNonce })
    expect(verifyToken(after.token, 'T-22')).toEqual({ ok: false, reason: 'revoked' })
  })

  it('单号绑定：异单 token 过不了本单的闸（ticket-mismatch）', () => {
    const other = mintWorkerKey(gateway, { ticket: 'T-30', makeNonce: nextNonce })
    expect(verifyToken(other.token, 'T-31')).toEqual({ ok: false, reason: 'ticket-mismatch' })
  })
})
