/**
 * cutover —— 进化链切权执行器测试集（src/evolve/cutover.ts：runCutover 受控上产 + CLI 链）
 *
 * 依据（实现单引用）：
 *   - docs/20-§九：一切改进走候选制品管线（…→灰度→**切权**→复盘）——切权=approved/promoted
 *     候选真实应用到生产资产的本刀环节（灰度=四刀之四，supervisor 看护归运维刀——头注声明）。
 *   - docs/02 F3-01（统一入口禁旁路）+ 16-§四 v0.10「无 candidate id 的生产改动判负」：
 *     双闸=状态前置 + core assertChangeAuthorized 写前复跑（evolve-guard 观察模式的受控对偶）。
 *   - packages/core evolution.ts：approved→promoted 机器边（transitionCandidate 单一状态机）；
 *     promoted→retired=退役/回滚（事件落账失败面的收口迁移用，合法边）。
 *   - packages/store ledger：getCandidate/transitionCandidate（乐观锁）/appendEvent/queryEvents。
 *
 * 覆盖面（实现单口径 16+）：
 *   - **双闸前置**：状态不对拒（draft/gated）／未授权拒（hash 不匹配→evolve/unauthorized
 *     原报文含 nearMisses）／retired 吊销近似命中仍拒／候选不在库／新文件不可读／路径逃逸；
 *   - **备份-写-复核-迁移全链**：approved→promoted（备份命名+内容、目标新字节、状态迁移、
 *     事件落账回查 deep-equal、结果形状）／promoted 重切权（免迁移幂等）／新资产面（无锚）；
 *   - **失败回滚**：备份失败（写未开始原样）／写失败（tmp 位预置目录注入——原文件逐字节
 *     恢复+备份保留）／复核不符（afterWrite 探针注入）／迁移乐观锁丢失／事件落账失败
 *     （收口迁移 promoted→retired——不留孤悬 promoted）；
 *   - **CLI 链**：真 bin 进程端到端（exit 0+store 回查）／--no-restart 抑制提示／判负红
 *     exit 1／用法错误面；
 *   - **备份清理策略**：成功后锚点保留；同候选重切权重写同名单锚（回滚锚点语义，拟稿）。
 *
 * 手法纪律：tmp 目录造「伪生产资产」（不碰仓内真冻结三件套——冻结面改动必须走人手批示，
 * 本套全部语料在 os.tmpdir() 下）；失败注入沿 crash-points 先例（预置目录 / afterWrite 探针
 * ——生产路径不传探针）；确定性候选语料（insertCandidate 直插，promoted 重切权场景 diff_hash
 * 定位用裸 SQL 改列——e2e 同款 seeding 手法）；真子进程等 exit 事件一次定局（crash-injection
 * 先例）；只 import 不改他包。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import type { CandidateRow, Ledger } from '@studio-next/store'
import type { ClassifiedError } from '@studio-next/contract'
import { runCutover } from '../../src/evolve/cutover.ts'
import type { CutoverOptions, CutoverProbes } from '../../src/evolve/cutover.ts'

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-cutover-test-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 测试基建 —————————————————————————

/** 内容字节 sha256（`sha256:<hex>` 前缀形——cutover 判负闸消费的 diff_hash 口径） */
function hashOf(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
}

/** 生产树全文件 sha256 快照（「逐字节一致」断言面：相对路径 → 内容哈希；目录不入图） */
function treeSnapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string, rel: string): void => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) out.set(r, createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir, '')
  return out
}

const OLD_BODY = 'agent prompt v1（在产内容）\n'
const NEW_BODY = 'agent prompt v2（切权新内容）\n'
const ASSET = 'prompts/agent.md'

/** 伪生产树语料（tmp 下——不碰仓内真冻结文件）：prompts/agent.md + 邻居 */
function seedProduction(name: string, body = OLD_BODY): string {
  const dir = path.join(root, name)
  mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  writeFileSync(path.join(dir, ASSET), body, 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'other.md'), '非资产邻居（不应被动）\n', 'utf8')
  return dir
}

/** 新内容文件（--file 语义面） */
function newFile(name: string, body = NEW_BODY): string {
  const p = path.join(root, `${name}.new.md`)
  writeFileSync(p, body, 'utf8')
  return p
}

/**
 * 确定性候选语料（insertCandidate 直插——store 写面）。diff_hash 缺省=新内容 sha256
 * （授权匹配键——「approved 的就是这份新内容」）；可覆写成任意值造未授权面。
 */
function seedCandidate(
  ledger: Ledger,
  id: string,
  status: CandidateRow['status'],
  opts: { diffHash?: string; assetPath?: string } = {},
): string {
  ledger.insertCandidate({
    id,
    asset_type: 'prompt',
    asset_path: opts.assetPath ?? ASSET,
    version: 'v2',
    diff_hash: opts.diffHash ?? hashOf(NEW_BODY),
    blast_radius: 'isolated',
    verification: { sandboxPass: true, blastRadiusOk: true },
    parent_id: null,
    status,
    created_at: Date.now(),
  })
  return id
}

/** 确定性 ULID 序列（合法 26 字符 Crockford：22 前缀 + 4 位序号；跨 run 唯一——同库多事件不撞 id） */
let ulidSeq = 0
function seqUlid(): string {
  ulidSeq += 1
  return `01ARZ3NDEKTSV4RRFFQ69G${String(ulidSeq).padStart(4, '0')}`
}

/** 链入参速造（company/clock 确定性；idFactory 缺省=序列 ULID，可覆写定值造 id 冲突面；probes=失败注入探针面） */
function optsOf(file: string, prod: string, probes?: CutoverProbes, idFactory?: (ts: number) => string): CutoverOptions {
  return {
    newFilePath: file,
    assetRoot: prod,
    company: 'demo-corp',
    clock: () => 1_700_000_000_000,
    idFactory: idFactory ?? (() => seqUlid()),
    ...(probes === undefined ? {} : { probes }),
  }
}

/** ClassifiedError 断言捕手（category/subcause 如实） */
function expectRejected(fn: () => unknown, subcause: string): Error & ClassifiedError {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const e = caught as Error & ClassifiedError
  expect(e.category).toBe('CONFIG_INVALID')
  expect(e.subcause).toBe(subcause)
  return e
}

// ————————————————————————— 双闸前置（任一红即拒——写未开始即无半改态） —————————————————————————

describe('双闸前置：状态闸 + 判负闸写前复跑', () => {
  it('状态不对拒（draft）：生产树不变、无备份无事件、状态不动', () => {
    const prod = seedProduction('gate-draft')
    const ledger = openLedger(path.join(root, 'gate-draft.sqlite'))
    seedCandidate(ledger, 'cand-draft', 'draft')
    const before = treeSnapshot(prod)
    const err = expectRejected(() => runCutover(ledger, 'cand-draft', optsOf(newFile('gate-draft'), prod)), 'daemon/cutover:status-not-authorizing')
    expect(err.message).toContain('draft')
    expect(err.message).toContain('approved')
    expect(treeSnapshot(prod)).toEqual(before)
    expect(ledger.queryEvents()).toEqual([])
    expect(ledger.getCandidate('cand-draft')?.status).toBe('draft')
    ledger.close()
  })

  it('状态不对拒（gated——闸门未决不得切权，F3-01 禁旁路）', () => {
    const prod = seedProduction('gate-gated')
    const ledger = openLedger(path.join(root, 'gate-gated.sqlite'))
    seedCandidate(ledger, 'cand-gated', 'gated')
    const before = treeSnapshot(prod)
    expectRejected(() => runCutover(ledger, 'cand-gated', optsOf(newFile('gate-gated'), prod)), 'daemon/cutover:status-not-authorizing')
    expect(treeSnapshot(prod)).toEqual(before)
    expect(ledger.getCandidate('cand-gated')?.status).toBe('gated')
    ledger.close()
  })

  it('未授权拒（hash 不匹配）：evolve/unauthorized 原报文上抛（判负闸对面不裹）、树不变、无备份锚点', () => {
    const prod = seedProduction('gate-unauth')
    const ledger = openLedger(path.join(root, 'gate-unauth.sqlite'))
    seedCandidate(ledger, 'cand-wrong-hash', 'approved', { diffHash: 'sha256:0000not-the-new-content' })
    const before = treeSnapshot(prod)
    const err = expectRejected(() => runCutover(ledger, 'cand-wrong-hash', optsOf(newFile('gate-unauth'), prod)), 'evolve/unauthorized')
    expect(err.message).toContain('无 candidate id 的生产改动判负')
    expect(err.message).toContain('hash-mismatch') // nearMisses 诊断原文如实带出
    expect(treeSnapshot(prod)).toEqual(before)
    expect(existsSync(path.join(prod, `${ASSET}.bak-cand-wrong-hash`))).toBe(false) // 判负在备份前——无锚点残留
    expect(ledger.queryEvents()).toEqual([])
    expect(ledger.getCandidate('cand-wrong-hash')?.status).toBe('approved')
    ledger.close()
  })

  it('retired 吊销近似命中仍拒（status-not-authorizing nearMiss）：同资产 retired 候选持有正确 hash 也不放行', () => {
    const prod = seedProduction('gate-retired')
    const ledger = openLedger(path.join(root, 'gate-retired.sqlite'))
    seedCandidate(ledger, 'cand-live', 'approved', { diffHash: 'sha256:1111another-old-content' })
    seedCandidate(ledger, 'cand-revoked', 'retired') // 正确新 hash、但已吊销（终态）
    const before = treeSnapshot(prod)
    const err = expectRejected(() => runCutover(ledger, 'cand-live', optsOf(newFile('gate-retired'), prod)), 'evolve/unauthorized')
    expect(err.message).toContain('cand-revoked[retired/status-not-authorizing]') // 吊销匹配仍拒——授权态只有 approved|promoted
    expect(treeSnapshot(prod)).toEqual(before)
    ledger.close()
  })

  it('候选不在库：candidate-unknown', () => {
    const prod = seedProduction('gate-unknown')
    const ledger = openLedger(path.join(root, 'gate-unknown.sqlite'))
    expectRejected(() => runCutover(ledger, 'no-such-cand', optsOf(newFile('gate-unknown'), prod)), 'daemon/cutover:candidate-unknown')
    ledger.close()
  })

  it('新文件不可读：source-unreadable（写未开始）', () => {
    const prod = seedProduction('gate-unreadable')
    const ledger = openLedger(path.join(root, 'gate-unreadable.sqlite'))
    seedCandidate(ledger, 'cand-ok1', 'approved')
    expectRejected(() => runCutover(ledger, 'cand-ok1', optsOf(path.join(root, 'no-such.new.md'), prod)), 'daemon/cutover:source-unreadable')
    expect(ledger.getCandidate('cand-ok1')?.status).toBe('approved')
    ledger.close()
  })

  it('路径逃逸拒：asset_path resolve 出资产根即拒（写域 containment），根外无写入', () => {
    const prod = seedProduction('gate-escape')
    const ledger = openLedger(path.join(root, 'gate-escape.sqlite'))
    seedCandidate(ledger, 'cand-escape', 'approved', { assetPath: '../outside-escape.md' })
    expectRejected(() => runCutover(ledger, 'cand-escape', optsOf(newFile('gate-escape'), prod)), 'daemon/cutover:path-escape')
    expect(existsSync(path.join(root, 'outside-escape.md'))).toBe(false) // 根外零写入（结构性）
    ledger.close()
  })
})

// ————————————————————————— 全链：备份-写-复核-迁移-落账 —————————————————————————

describe('全链：approved→promoted 受控上产', () => {
  it('全链成功：备份命名+内容、目标新字节、复核、状态迁移、事件落账、结果形状', () => {
    const prod = seedProduction('chain-full')
    const ledger = openLedger(path.join(root, 'chain-full.sqlite'))
    seedCandidate(ledger, 'cand-full', 'approved')
    const result = runCutover(ledger, 'cand-full', optsOf(newFile('chain-full'), prod))

    // 目标=新内容；备份锚点=旧内容、命名 <目标>.bak-<候选id>
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY)
    const bak = path.join(prod, `${ASSET}.bak-cand-full`)
    expect(existsSync(bak)).toBe(true)
    expect(readFileSync(bak, 'utf8')).toBe(OLD_BODY)
    // 状态迁移 + 无 tmp 残留
    expect(ledger.getCandidate('cand-full')?.status).toBe('promoted')
    expect(existsSync(path.join(prod, `${ASSET}.tmp-cand-full`))).toBe(false)
    // 结果形状
    expect(result.candidateId).toBe('cand-full')
    expect(result.targetPath).toBe(path.join(prod, ASSET))
    expect(result.backupPath).toBe(bak)
    expect(result.oldHash).toBe(hashOf(OLD_BODY))
    expect(result.newHash).toBe(hashOf(NEW_BODY))
    expect(result.migrated).toBe(true)
    expect(result.restart).toBe(true) // 缺省=打印重启提示（v0 只提示不实际重启）
    expect(result.event.event).toBe('SCHEMA_EVOLVE')
    // 邻居不动
    expect(readFileSync(path.join(prod, 'prompts/other.md'), 'utf8')).toBe('非资产邻居（不应被动）\n')
    ledger.close()
  })

  it('事件落账回查 deep-equal：SCHEMA_EVOLVE／note 携候选+资产+旧新 hash+锚点／tokens 零桶／issue 哨兵', () => {
    const prod = seedProduction('chain-event')
    const ledger = openLedger(path.join(root, 'chain-event.sqlite'))
    seedCandidate(ledger, 'cand-event', 'approved')
    const result = runCutover(ledger, 'cand-event', optsOf(newFile('chain-event'), prod))
    const events = ledger.queryEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(result.event) // store 读面回查（不只内存对象）
    expect(result.event.issue).toBe('-') // 哨兵拟稿口径（evolve-guard 同源）
    expect(result.event.tokens).toEqual({ input: 0 }) // 无计量显式零桶
    expect(result.event.note).toContain('cand-event')
    expect(result.event.note).toContain(ASSET)
    expect(result.event.note).toContain(result.oldHash ?? '')
    expect(result.event.note).toContain(result.newHash)
    expect(result.event.note).toContain('.bak-cand-event')
    ledger.close()
  })

  it('promoted 重切权：免迁移（幂等）、备份重写为当下旧内容、事件照落、状态不动', () => {
    const prod = seedProduction('chain-re', 're-v1\n')
    const ledger = openLedger(path.join(root, 'chain-re.sqlite'))
    seedCandidate(ledger, 'cand-re', 'promoted')
    const v2Body = 're-v2（重切权内容）\n'
    const v2File = path.join(root, 'chain-re.new.md')
    writeFileSync(v2File, v2Body, 'utf8')
    // 场景=在产漂移后复位：promoted 候选的 diff_hash 已是新内容（裸 SQL 定位语料——e2e 同款 seeding 手法）
    ledger.db.prepare('UPDATE candidates SET diff_hash = ? WHERE id = ?').run(hashOf(v2Body), 'cand-re')
    const result = runCutover(ledger, 'cand-re', optsOf(v2File, prod))
    expect(result.migrated).toBe(false)
    expect(ledger.getCandidate('cand-re')?.status).toBe('promoted')
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(v2Body)
    expect(readFileSync(path.join(prod, `${ASSET}.bak-cand-re`), 'utf8')).toBe('re-v1\n') // 锚=当下旧内容
    expect(ledger.queryEvents()).toHaveLength(1) // 重切权也留痕（不豁免）
    ledger.close()
  })

  it('新资产面：目标原不存在 → 无备份锚（backupPath/oldHash null）、文件创建、note 载「新资产」', () => {
    const prod = path.join(root, 'chain-newasset')
    mkdirSync(path.join(prod, 'prompts'), { recursive: true })
    const ledger = openLedger(path.join(root, 'chain-newasset.sqlite'))
    seedCandidate(ledger, 'cand-new', 'approved', { assetPath: 'prompts/brand-new.md' })
    const result = runCutover(ledger, 'cand-new', optsOf(newFile('chain-newasset'), prod))
    expect(existsSync(path.join(prod, 'prompts/brand-new.md'))).toBe(true)
    expect(readFileSync(path.join(prod, 'prompts/brand-new.md'), 'utf8')).toBe(NEW_BODY)
    expect(result.backupPath).toBeNull()
    expect(result.oldHash).toBeNull()
    expect(result.event.note).toContain('新资产')
    expect(ledger.getCandidate('cand-new')?.status).toBe('promoted')
    ledger.close()
  })

  it('备份清理策略（拟稿面）：成功后锚点保留不自动清理；同候选重切权重写同名单锚', () => {
    const prod = seedProduction('chain-retain')
    const ledger = openLedger(path.join(root, 'chain-retain.sqlite'))
    seedCandidate(ledger, 'cand-retain', 'approved')
    runCutover(ledger, 'cand-retain', optsOf(newFile('chain-retain'), prod))
    const bak = path.join(prod, `${ASSET}.bak-cand-retain`)
    expect(existsSync(bak)).toBe(true) // 保留=回滚锚点
    // 重切权（promoted，同内容）：锚重写为第一次切权后的内容
    const result2 = runCutover(ledger, 'cand-retain', optsOf(newFile('chain-retain'), prod))
    expect(readFileSync(bak, 'utf8')).toBe(NEW_BODY)
    expect(result2.migrated).toBe(false)
    expect(ledger.queryEvents()).toHaveLength(2)
    ledger.close()
  })
})

// ————————————————————————— 失败回滚（不留半改态） —————————————————————————

describe('失败回滚：写中途失败 → 原文件逐字节恢复 + 如实报', () => {
  it('备份失败（锚点位预置目录注入）：写未开始——原文件原样、无 tmp、无事件、状态不动', () => {
    const prod = seedProduction('rb-backup')
    const ledger = openLedger(path.join(root, 'rb-backup.sqlite'))
    seedCandidate(ledger, 'cand-rb1', 'approved')
    const injectedDir = path.join(prod, `${ASSET}.bak-cand-rb1`)
    mkdirSync(injectedDir, { recursive: true }) // copyFileSync 落不进目录位 → 备份失败注入
    try {
      const before = treeSnapshot(prod)
      const err = expectRejected(() => runCutover(ledger, 'cand-rb1', optsOf(newFile('rb-backup'), prod)), 'daemon/cutover:backup-failed')
      expect(err.message).toContain('写未开始')
      expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 原文件原样（无半改态）
      expect(existsSync(path.join(prod, `${ASSET}.tmp-cand-rb1`))).toBe(false)
      expect(ledger.queryEvents()).toEqual([])
      expect(ledger.getCandidate('cand-rb1')?.status).toBe('approved')
    } finally {
      rmSync(injectedDir, { recursive: true, force: true })
    }
    ledger.close()
  })

  it('写失败（tmp 位预置目录注入）：原文件逐字节恢复、备份锚已建并保留、无事件无迁移', () => {
    const prod = seedProduction('rb-write')
    const ledger = openLedger(path.join(root, 'rb-write.sqlite'))
    seedCandidate(ledger, 'cand-rb2', 'approved')
    const injectedDir = path.join(prod, `${ASSET}.tmp-cand-rb2`)
    mkdirSync(injectedDir, { recursive: true }) // writeFileSync 落不进目录位 → 写失败注入（备份已完成）
    try {
      const err = expectRejected(() => runCutover(ledger, 'cand-rb2', optsOf(newFile('rb-write'), prod)), 'daemon/cutover:write-failed')
      expect(err.message).toContain('已回滚')
      expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 原文件逐字节恢复（回滚直证）
      expect(readFileSync(path.join(prod, `${ASSET}.bak-cand-rb2`), 'utf8')).toBe(OLD_BODY) // 锚已建+保留（本例语义面——备份先于写）
      expect(existsSync(path.join(prod, `${ASSET}.tmp-cand-rb2`))).toBe(true) // 注入位仍在（是我们预置的目录，非链残留）
      expect(ledger.queryEvents()).toEqual([])
      expect(ledger.getCandidate('cand-rb2')?.status).toBe('approved')
    } finally {
      rmSync(injectedDir, { recursive: true, force: true })
    }
    ledger.close()
  })

  it('复核不符（afterWrite 探针改写目标）：verify-mismatch → 原文件逐字节恢复、锚保留、无事件', () => {
    const prod = seedProduction('rb-verify')
    const ledger = openLedger(path.join(root, 'rb-verify.sqlite'))
    seedCandidate(ledger, 'cand-rb3', 'approved')
    const err = expectRejected(
      () =>
        runCutover(ledger, 'cand-rb3', optsOf(newFile('rb-verify'), prod, {
          afterWrite: () => writeFileSync(path.join(prod, ASSET), 'corrupted-by-probe\n', 'utf8'),
        })),
      'daemon/cutover:verify-mismatch',
    )
    expect(err.message).toContain('读回 hash')
    expect(err.message).toContain('逐字节恢复')
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 回滚直证：探针污染被恢复
    expect(readFileSync(path.join(prod, `${ASSET}.bak-cand-rb3`), 'utf8')).toBe(OLD_BODY)
    expect(ledger.queryEvents()).toEqual([])
    expect(ledger.getCandidate('cand-rb3')?.status).toBe('approved')
    ledger.close()
  })

  it('迁移乐观锁丢失（afterWrite 探针并发吊销候选）：transition-lost → 文件回滚、状态=外部所致 retired', () => {
    const prod = seedProduction('rb-lock')
    const ledger = openLedger(path.join(root, 'rb-lock.sqlite'))
    seedCandidate(ledger, 'cand-rb4', 'approved')
    const err = expectRejected(
      () =>
        runCutover(ledger, 'cand-rb4', optsOf(newFile('rb-lock'), prod, {
          afterWrite: () => {
            // 写后迁移前的并发面：候选被吊销（approved→retired 合法机器边）
            ledger.transitionCandidate('cand-rb4', 'approved', 'retired')
          },
        })),
      'daemon/cutover:transition-lost',
    )
    expect(err.message).toContain('乐观锁')
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 文件已回滚（不留半改态）
    expect(ledger.getCandidate('cand-rb4')?.status).toBe('retired') // 外部吊销所致（如实呈现）
    expect(ledger.queryEvents()).toEqual([])
    ledger.close()
  })

  it('事件落账失败（同 id 异内容预置注入）：event-append-failed → 文件回滚 + 追记 promoted→retired 收口迁移（合法边，不留孤悬 promoted）', () => {
    const prod = seedProduction('rb-event')
    const ledger = openLedger(path.join(root, 'rb-event.sqlite'))
    seedCandidate(ledger, 'cand-rb5', 'approved')
    // 预占事件 id（确定性 idFactory）且内容不同 → appendEvent 抛 duplicate-id
    ledger.appendEvent({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: 1,
      company: 'demo-corp',
      issue: '-',
      event: 'SCHEMA_EVOLVE',
      actor: 'daemon',
      attempt: 1,
      level: 1,
      dept: 'departments/工程部',
      tokens: { input: 0 },
      note: '预占位（异内容——触发 duplicate-id 注入）',
    })
    const err = expectRejected(
      () => runCutover(ledger, 'cand-rb5', optsOf(newFile('rb-event'), prod, undefined, () => '01ARZ3NDEKTSV4RRFFQ69G5FAV')),
      'daemon/cutover:event-append-failed',
    )
    expect(err.message).toContain('promoted→retired 收口迁移') // 事件失败面的状态收口（如实报）
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 文件回滚
    expect(ledger.getCandidate('cand-rb5')?.status).toBe('retired') // 不留孤悬 promoted
    expect(ledger.queryEvents()).toHaveLength(1) // 只有预置事件——切权事件未落（失败如实）
    ledger.close()
  })
})

// ————————————————————————— CLI 面：真 bin 进程 —————————————————————————

describe('CLI 面：studio-next cutover --db --candidate --file（真 bin 进程端到端）', () => {
  function runBin(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args], { encoding: 'utf8' })
      let out = ''
      let err = ''
      child.stdout?.on('data', (d: string) => {
        out += d
      })
      child.stderr?.on('data', (d: string) => {
        err += d
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        resolve({ code, out, err })
      })
    })
  }

  it('一条命令切权：approved 候选 → exit 0、明细行、store 回查 promoted+事件、生产文件已换、锚点在', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-cutover.sqlite')
    const prod = seedProduction('cli-prod')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-1', 'approved')
    ledger.close()

    const result = await runBin([
      'cutover',
      '--db', dbPath,
      '--candidate', 'cli-cand-1',
      '--file', newFile('cli-cutover'),
      '--company', 'demo-corp',
      '--root', prod,
    ])
    expect(result.code).toBe(0)
    expect(result.out).toContain('切权上产完成')
    expect(result.out).toContain('approved→promoted（core 判边+store 乐观锁）')
    expect(result.out).toContain('SCHEMA_EVOLVE')
    expect(result.out).toContain('daemon 需重启加载') // restart 缺省=提示（v0 不实际重启——诚实边界）
    expect(result.out).toContain('候选 cli-cand-1 切权完成')

    // 台账视角回查（不只 stdout——store 是事实源）
    const reopened = openLedger(dbPath)
    expect(reopened.getCandidate('cli-cand-1')?.status).toBe('promoted')
    const events = reopened.queryEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('SCHEMA_EVOLVE')
    expect(events[0]?.company).toBe('demo-corp')
    expect(events[0]?.note).toContain('cli-cand-1')
    reopened.close()
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY)
    expect(readFileSync(path.join(prod, `${ASSET}.bak-cli-cand-1`), 'utf8')).toBe(OLD_BODY)
  })

  it('--no-restart 抑制重启提示行（v0 恒不实际重启——两态都不重启，只控提示）', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-norestart.sqlite')
    const prod = seedProduction('cli-prod2')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-2', 'approved')
    ledger.close()
    const result = await runBin([
      'cutover', '--db', dbPath, '--candidate', 'cli-cand-2',
      '--file', newFile('cli-norestart'), '--company', 'demo-corp', '--root', prod, '--no-restart',
    ])
    expect(result.code).toBe(0)
    expect(result.out).not.toContain('需重启加载')
    const reopened = openLedger(dbPath)
    expect(reopened.getCandidate('cli-cand-2')?.status).toBe('promoted')
    reopened.close()
  })

  it('判负红走 CLI 面：hash 不匹配 → exit 1、判负报文、生产树不变', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-red.sqlite')
    const prod = seedProduction('cli-prod3')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-red', 'approved', { diffHash: 'sha256:2222not-matching' })
    ledger.close()
    const before = treeSnapshot(prod)
    const result = await runBin([
      'cutover', '--db', dbPath, '--candidate', 'cli-cand-red',
      '--file', newFile('cli-red'), '--company', 'demo-corp', '--root', prod,
    ])
    expect(result.code).toBe(1)
    expect(result.err).toContain('cutover 失败')
    expect(result.err).toContain('无 candidate id 的生产改动判负')
    expect(treeSnapshot(prod)).toEqual(before)
  })

  it('用法错误面：缺 --file／缺 --company／库不存在（不代建库）／--level 非法 → 均 exit 1', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-usage.sqlite')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-3', 'approved')
    ledger.close()
    const noFile = await runBin(['cutover', '--db', dbPath, '--candidate', 'cli-cand-3', '--company', 'demo-corp'])
    expect(noFile.code).toBe(1)
    expect(noFile.err).toContain('缺少 --file')
    const noCompany = await runBin(['cutover', '--db', dbPath, '--candidate', 'cli-cand-3', '--file', newFile('cli-usage')])
    expect(noCompany.code).toBe(1)
    expect(noCompany.err).toContain('缺少 --company')
    const noDb = await runBin(['cutover', '--db', path.join(root, 'no-such-cutover.sqlite'), '--candidate', 'x', '--file', newFile('cli-usage'), '--company', 'demo-corp'])
    expect(noDb.code).toBe(1)
    expect(noDb.err).toContain('库不存在')
    expect(existsSync(path.join(root, 'no-such-cutover.sqlite'))).toBe(false) // 写面不代建库
    const badLevel = await runBin(['cutover', '--db', dbPath, '--candidate', 'cli-cand-3', '--file', newFile('cli-usage'), '--company', 'demo-corp', '--level', '99'])
    expect(badLevel.code).toBe(1)
    expect(badLevel.err).toContain('--level 取值非法')
  })
})
