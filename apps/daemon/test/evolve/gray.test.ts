/**
 * gray —— 灰度观察窗测试集（src/evolve/gray.ts：开窗/检查/自动回滚/关窗 + cutover 接线 + CLI 链）
 *
 * 依据（实现单引用）：
 *   - docs/20-§四（三级晋升原文）：「gray ──灰度零事故+制作人过目──▶ release」——灰度期
 *     不设日历、只看零事故+证据。观察窗=「零事故」的机化（v0 文件类资产收窄语义，
 *     src/evolve/gray.ts 头注冻结候选）。
 *   - docs/20-§九：一切改进走候选制品管线（…→灰度→切权→复盘）——四刀至此收齐。
 *   - packages/store ledger：kvGet/kvSet（观察窗记录）/queryEvents（信号源，company+since）/
 *     transitionCandidate（promoted→retired 乐观锁）/appendEvent。
 *   - src/evolve/cutover.ts：切权先例——备份锚 `<目标>.bak-<候选id>`（回滚物理基础）+ 接线面
 *     （切权成功默认开窗，--no-gray 跳过）。
 *
 * 覆盖面（实现单口径 14+）：
 *   - **开窗**：登记形状（kv+状态字段）/参数校验（windowMs/maxIncidents）/候选不在库拒/
 *     非 promoted 拒；
 *   - **接线**：cutover 后 kv 在（缺省窗 24h·阈值 1）/ --no-gray（gray:false）跳过；
 *   - **检查与自动回滚直证**：守夜 hold（无事故事件）/阈值触发回滚（ESCALATE 注入→
 *     备份逐字节恢复+retired+note=gray-rollback 事件）/CIRCUIT_BREAK 同计数/窗前事故不计/
 *     窗平安到期关窗/无窗候选拒/回滚后再 check 幂等；
 *   - **手动面**：closeGrayWindow 关窗（幂等）/备份缺失 fail-closed（窗保持 open 不假装回滚）；
 *   - **纯逻辑**：judgeGrayWindow 三态+边界（阈值=、到期=、双满足回滚优先）/countIncidents
 *     （双端闭、RESUME 不计）/splitBackupPath 反解与坏路径拒；
 *   - **CLI 链**：真 bin 进程端到端——查窗/--check 平安到期关窗/--check 触发回滚/
 *     --close 手动关窗（幂等）/无窗候选 exit 1/用法错误面（缺 --db/--candidate/库不存在/
 *     --check+--close 互斥）。
 *
 * 手法纪律：同 cutover.test.ts——tmp 目录造伪生产树（不碰仓内真冻结面）；确定性候选语料
 * （insertCandidate 直插）；事件注入走 appendEvent（store 写面）；真子进程等 exit 事件一次
 * 定局（crash-injection 先例）；只 import 不改他包。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import type { CandidateRow, Ledger } from '@studio-next/store'
import type { ClassifiedError, EventRecord } from '@studio-next/contract'
import { renderCutoverLines, runCutover } from '../../src/evolve/cutover.ts'
import type { CutoverOptions } from '../../src/evolve/cutover.ts'
import {
  DEFAULT_GRAY_MAX_INCIDENTS,
  DEFAULT_GRAY_WINDOW_MS,
  checkGrayWindow,
  closeGrayWindow,
  countIncidents,
  judgeGrayWindow,
  openGrayWindow,
  readGrayWindow,
  splitBackupPath,
} from '../../src/evolve/gray.ts'

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-gray-test-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 测试基建（cutover.test.ts 同款手法） —————————————————————————

/** 内容字节 sha256（`sha256:<hex>` 前缀形） */
function hashOf(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
}

const OLD_BODY = 'agent prompt v1（在产内容）\n'
const NEW_BODY = 'agent prompt v2（切权新内容）\n'
const ASSET = 'prompts/agent.md'
const COMPANY = 'demo-corp'
const T0 = 1_700_000_000_000

/** 伪生产树语料（tmp 下）：prompts/agent.md + 邻居 */
function seedProduction(name: string, body = OLD_BODY): string {
  const dir = path.join(root, name)
  mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  writeFileSync(path.join(dir, ASSET), body, 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'other.md'), '非资产邻居（不应被动）\n', 'utf8')
  return dir
}

/** 新内容文件（cutover --file 语义面） */
function newFile(name: string, body = NEW_BODY): string {
  const p = path.join(root, `${name}.new.md`)
  writeFileSync(p, body, 'utf8')
  return p
}

/** 确定性候选语料（diff_hash 缺省=新内容 sha256——授权匹配键） */
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

/** 确定性 ULID 序列（合法 26 字符 Crockford；跨 run 唯一） */
let ulidSeq = 0
function seqUlid(): string {
  ulidSeq += 1
  return `01ARZ3NDEKTSV4RRFFQ69G${String(ulidSeq).padStart(4, '0')}`
}

/** cutover 链入参速造（clock 缺省确定性 T0——开窗 openedAt 同源；idFactory=序列 ULID） */
function cutoverOpts(file: string, prod: string, gray?: boolean): CutoverOptions {
  return {
    newFilePath: file,
    assetRoot: prod,
    company: COMPANY,
    clock: () => T0,
    idFactory: () => seqUlid(),
    ...(gray === undefined ? {} : { gray }),
  }
}

/** 事故事件注入（信号源面：ESCALATE/CIRCUIT_BREAK；company 必与窗一致才计数） */
function injectIncident(ledger: Ledger, name: 'ESCALATE' | 'CIRCUIT_BREAK', ts: number, company = COMPANY): void {
  ledger.appendEvent({
    id: seqUlid(),
    ts,
    company,
    issue: 'DEMO-1',
    event: name,
    actor: 'daemon',
    attempt: 1,
    level: 1,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: `事故信号注入（测试面：${name}）`,
  })
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

// ————————————————————————— 纯逻辑面（零 IO 直测） —————————————————————————

describe('纯逻辑：judge / count / split（零 IO）', () => {
  it('judge 三态与边界：阈值=（闭）→ roll-back；到期=（闭）→ close；双满足回滚优先；否则 hold', () => {
    const win = { openedAt: T0, windowMs: 1000, maxIncidents: 2 }
    expect(judgeGrayWindow(win, T0 + 500, 2).action).toBe('roll-back') // incidents==max（闭端）
    expect(judgeGrayWindow(win, T0 + 500, 3).action).toBe('roll-back') // 超阈
    expect(judgeGrayWindow(win, T0 + 1000, 1).action).toBe('close') // 到期==（闭端）且未破阈
    expect(judgeGrayWindow(win, T0 + 2000, 0).action).toBe('close') // 过期平安
    expect(judgeGrayWindow(win, T0 + 1000, 2).action).toBe('roll-back') // 同拍既破阈又到期——回滚优先（保守面）
    expect(judgeGrayWindow(win, T0 + 500, 1).action).toBe('hold') // 守夜中
  })

  it('count：ts 双端闭区间；ESCALATE/CIRCUIT_BREAK 计、RESUME/其他不计；company 过滤在查询面', () => {
    const mk = (event: EventRecord['event'], ts: number): EventRecord => ({
      id: seqUlid(), ts, company: COMPANY, issue: '-', event,
      actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 },
    })
    const events = [mk('ESCALATE', T0), mk('CIRCUIT_BREAK', T0 + 1000), mk('RESUME', T0 + 500), mk('HEARTBEAT', T0 + 100)]
    expect(countIncidents(events, T0, T0 + 1000)).toBe(2) // 双端闭：ts==since 与 ts==until 都计
    expect(countIncidents(events, T0 + 1, T0 + 999)).toBe(0) // 端外不计；RESUME（断路恢复）不计——恢复不是事故
    expect(countIncidents(events, T0, T0 + 500)).toBe(1)
  })

  it('splitBackupPath 反解：.bak-<候选id> 后缀剥出目标+候选；坏路径（无后缀/空前缀）拒', () => {
    expect(splitBackupPath('/prod/prompts/agent.md.bak-cand-1')).toEqual({ targetPath: '/prod/prompts/agent.md', candidateId: 'cand-1' })
    expectRejected(() => splitBackupPath('/prod/prompts/agent.md'), 'daemon/gray:bad-backup-path')
    expectRejected(() => splitBackupPath('/prod/.bak-'), 'daemon/gray:bad-backup-path')
  })
})

// ————————————————————————— 开窗面 —————————————————————————

describe('开窗：登记与前置闸', () => {
  it('登记形状：kv gray:<候选id> 在、字段齐（assetPath/company/openedAt/窗长/阈值/状态 open）', () => {
    const ledger = openLedger(path.join(root, 'open-shape.sqlite'))
    seedCandidate(ledger, 'cand-open1', 'promoted')
    const state = openGrayWindow(ledger, {
      candidateId: 'cand-open1', assetPath: ASSET, company: COMPANY,
      windowMs: 5000, maxIncidents: 3, clock: () => T0,
    })
    expect(state).toEqual({
      candidateId: 'cand-open1', assetPath: ASSET, company: COMPANY,
      openedAt: T0, windowMs: 5000, maxIncidents: 3, status: 'open', closedAt: null, reason: null,
    })
    // kv 读面回查（不只内存对象——store 是事实源）
    expect(readGrayWindow(ledger, 'cand-open1')).toEqual(state)
    ledger.close()
  })

  it('缺省档：windowMs=24h、maxIncidents=1（零事故语义拟稿档）', () => {
    const ledger = openLedger(path.join(root, 'open-defaults.sqlite'))
    seedCandidate(ledger, 'cand-open2', 'promoted')
    const state = openGrayWindow(ledger, { candidateId: 'cand-open2', assetPath: ASSET, company: COMPANY, clock: () => T0 })
    expect(state.windowMs).toBe(DEFAULT_GRAY_WINDOW_MS)
    expect(state.maxIncidents).toBe(DEFAULT_GRAY_MAX_INCIDENTS)
    ledger.close()
  })

  it('参数校验：windowMs/maxIncidents 非正整数即拒（fail-closed）', () => {
    const ledger = openLedger(path.join(root, 'open-badargs.sqlite'))
    seedCandidate(ledger, 'cand-open3', 'promoted')
    expectRejected(
      () => openGrayWindow(ledger, { candidateId: 'cand-open3', assetPath: ASSET, company: COMPANY, windowMs: 0 }),
      'daemon/gray:bad-window-ms',
    )
    expectRejected(
      () => openGrayWindow(ledger, { candidateId: 'cand-open3', assetPath: ASSET, company: COMPANY, maxIncidents: 0 }),
      'daemon/gray:bad-max-incidents',
    )
    expect(readGrayWindow(ledger, 'cand-open3')).toBeNull() // 拒后无半开窗
    ledger.close()
  })

  it('候选不在库拒：candidate-unknown（无候选即无窗）', () => {
    const ledger = openLedger(path.join(root, 'open-unknown.sqlite'))
    expectRejected(
      () => openGrayWindow(ledger, { candidateId: 'no-such-cand', assetPath: ASSET, company: COMPANY }),
      'daemon/gray:candidate-unknown',
    )
    ledger.close()
  })

  it('非 promoted 拒：status-not-promoted（窗=切权后守夜，approved 未上产无窗可开）', () => {
    const ledger = openLedger(path.join(root, 'open-status.sqlite'))
    seedCandidate(ledger, 'cand-open4', 'approved')
    expectRejected(
      () => openGrayWindow(ledger, { candidateId: 'cand-open4', assetPath: ASSET, company: COMPANY }),
      'daemon/gray:status-not-promoted',
    )
    ledger.close()
  })
})

// ————————————————————————— cutover 接线（开窗=切权默认后缀） —————————————————————————

describe('cutover 接线：切权成功默认开窗，--no-gray 跳过', () => {
  it('切权后 kv 在：窗 open、缺省窗长/阈值、assetPath/company 同源；result.grayOpened=true；打印面有开窗行', () => {
    const prod = seedProduction('wire-default')
    const ledger = openLedger(path.join(root, 'wire-default.sqlite'))
    seedCandidate(ledger, 'cand-wire1', 'approved')
    const result = runCutover(ledger, 'cand-wire1', cutoverOpts(newFile('wire-default'), prod))

    expect(result.grayOpened).toBe(true)
    expect(result.grayError).toBeNull()
    const state = readGrayWindow(ledger, 'cand-wire1')
    expect(state).not.toBeNull()
    expect(state?.status).toBe('open')
    expect(state?.assetPath).toBe(ASSET)
    expect(state?.company).toBe(COMPANY)
    expect(state?.openedAt).toBe(T0) // 与切权事件同源时钟
    expect(state?.windowMs).toBe(DEFAULT_GRAY_WINDOW_MS)
    expect(state?.maxIncidents).toBe(DEFAULT_GRAY_MAX_INCIDENTS)
    const lines = renderCutoverLines(result, ledger.getCandidate('cand-wire1') as CandidateRow)
    expect(lines.some((l) => l.includes('灰度观察窗') && l.includes('已开窗'))).toBe(true)
    ledger.close()
  })

  it('gray:false（--no-gray）跳过：kv 无键、result.grayOpened=false、打印面声明跳过', () => {
    const prod = seedProduction('wire-nogray')
    const ledger = openLedger(path.join(root, 'wire-nogray.sqlite'))
    seedCandidate(ledger, 'cand-wire2', 'approved')
    const result = runCutover(ledger, 'cand-wire2', cutoverOpts(newFile('wire-nogray'), prod, false))
    expect(result.grayOpened).toBe(false)
    expect(readGrayWindow(ledger, 'cand-wire2')).toBeNull()
    const lines = renderCutoverLines(result, ledger.getCandidate('cand-wire2') as CandidateRow)
    expect(lines.some((l) => l.includes('跳过（--no-gray）'))).toBe(true)
    ledger.close()
  })
})

// ————————————————————————— 检查面：守夜/回滚/关窗/幂等 —————————————————————————

describe('检查面：判定三态与自动回滚直证', () => {
  /** 语料速造：切权（真实备份锚+promoted+开窗，clock=T0）→ 返回三件套 */
  function cutOver(name: string, candId: string, windowMs?: number): { prod: string; ledger: Ledger; backup: string } {
    const prod = seedProduction(name)
    const ledger = openLedger(path.join(root, `${name}.sqlite`))
    seedCandidate(ledger, candId, 'approved')
    runCutover(ledger, candId, cutoverOpts(newFile(name), prod))
    if (windowMs !== undefined) {
      openGrayWindow(ledger, { candidateId: candId, assetPath: ASSET, company: COMPANY, windowMs, clock: () => T0 })
    }
    return { prod, ledger, backup: path.join(prod, `${ASSET}.bak-${candId}`) }
  }

  it('守夜 hold：窗内无事故信号（切权事件非事故不自触发）→ 无动作、kv 仍 open', () => {
    const { prod, ledger, backup } = cutOver('chk-hold', 'cand-h1')
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 })
    expect(result.rolled).toBe(false)
    expect(result.done).toBe(false)
    expect(result.incidents).toBe(0)
    expect(result.reason).toContain('watching')
    expect(readGrayWindow(ledger, 'cand-h1')?.status).toBe('open')
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY) // 生产面未动
    ledger.close()
  })

  it('阈值触发自动回滚（ESCALATE 注入）：备份逐字节恢复+复核、promoted→retired、note=gray-rollback 事件、kv rolled、锚点保留', () => {
    const { prod, ledger, backup } = cutOver('chk-roll', 'cand-r1')
    injectIncident(ledger, 'ESCALATE', T0 + 500) // 窗内事故信号 1 条 ≥ 阈值 1
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000, idFactory: () => seqUlid() })

    expect(result.rolled).toBe(true)
    expect(result.done).toBe(true)
    expect(result.incidents).toBe(1)
    expect(result.reason).toContain('incident-threshold')
    // 回滚直证：目标恢复旧内容（字节级）、备份锚点保留（物理基础不因已用而删）
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY)
    expect(existsSync(backup)).toBe(true)
    expect(readFileSync(backup, 'utf8')).toBe(OLD_BODY)
    // 状态收口：promoted→retired（合法机器边「退役/回滚」）
    expect(ledger.getCandidate('cand-r1')?.status).toBe('retired')
    // 事件落账回查 deep-equal：SCHEMA_EVOLVE、note=gray-rollback、含候选/资产/阈值/锚点
    const events = ledger.queryEvents()
    expect(events).toHaveLength(3) // 切权 SCHEMA_EVOLVE + 注入的事故信号 ESCALATE + 回滚事件
    const rollbackEvent = events.find((e) => e.note !== null && e.note.includes('gray-rollback'))
    expect(rollbackEvent).toBeDefined()
    expect(rollbackEvent).toEqual(result.event)
    expect(rollbackEvent?.event).toBe('SCHEMA_EVOLVE')
    expect(rollbackEvent?.note).toContain('cand-r1')
    expect(rollbackEvent?.note).toContain(ASSET)
    expect(rollbackEvent?.note).toContain(backup)
    // kv 收口：rolled + 理由
    const state = readGrayWindow(ledger, 'cand-r1')
    expect(state?.status).toBe('rolled')
    expect(state?.closedAt).toBe(T0 + 1000)
    expect(state?.reason).toContain('incident-threshold')
    ledger.close()
  })

  it('CIRCUIT_BREAK 同计数（信号源=两事件名并集，非只 ESCALATE）', () => {
    const { ledger, backup } = cutOver('chk-cb', 'cand-r2')
    injectIncident(ledger, 'CIRCUIT_BREAK', T0 + 200)
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 })
    expect(result.rolled).toBe(true)
    expect(result.incidents).toBe(1)
    expect(ledger.getCandidate('cand-r2')?.status).toBe('retired')
    ledger.close()
  })

  it('窗前事故不计：ts<openedAt 的 ESCALATE（开窗前的旧账）不触发回滚', () => {
    const { ledger, backup } = cutOver('chk-before', 'cand-r3')
    injectIncident(ledger, 'ESCALATE', T0 - 1000) // 开窗前 1 秒的旧事故事件
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 })
    expect(result.rolled).toBe(false)
    expect(result.done).toBe(false) // 守夜继续——窗只对窗内信号负责
    expect(ledger.getCandidate('cand-r3')?.status).toBe('promoted')
    ledger.close()
  })

  it('他 company 事故不计：信号查询 company 路由（窗是单公司守夜面）', () => {
    const { ledger, backup } = cutOver('chk-company', 'cand-r4')
    injectIncident(ledger, 'ESCALATE', T0 + 500, 'other-corp')
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 })
    expect(result.rolled).toBe(false)
    expect(result.incidents).toBe(0)
    ledger.close()
  })

  it('窗平安到期关窗：到期（闭端）且信号<阈值 → {rolled:false, done:true}+kv closed、无回滚事件、文件不动', () => {
    const { prod, ledger, backup } = cutOver('chk-expire', 'cand-e1', 1000)
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 }) // now==openedAt+windowMs（闭端）
    expect(result.rolled).toBe(false)
    expect(result.done).toBe(true)
    expect(result.reason).toContain('window-expired')
    expect(readGrayWindow(ledger, 'cand-e1')?.status).toBe('closed')
    expect(readGrayWindow(ledger, 'cand-e1')?.closedAt).toBe(T0 + 1000)
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY) // 平安=不动生产面
    expect(ledger.getCandidate('cand-e1')?.status).toBe('promoted') // 不 retired——灰度完成非回滚
    const events = ledger.queryEvents()
    expect(events.filter((e) => e.note?.includes('gray-rollback'))).toHaveLength(0) // 到期关窗不落事件（kv 收口即证据，头注拟稿）
    ledger.close()
  })

  it('无窗候选拒：no-window（fail-closed——无窗候选不检查）', () => {
    const prod = seedProduction('chk-nowin')
    const ledger = openLedger(path.join(root, 'chk-nowin.sqlite'))
    seedCandidate(ledger, 'cand-nowin', 'promoted') // 候选在库但无窗（如 --no-gray 切权）
    const err = expectRejected(
      () => checkGrayWindow(ledger, path.join(prod, `${ASSET}.bak-cand-nowin`), { clock: () => T0 }),
      'daemon/gray:no-window',
    )
    expect(err.message).toContain('无灰度观察窗')
    ledger.close()
  })

  it('回滚后再 check 幂等：{rolled:false, done:true}（本次无动作）、无新事件、文件与状态不动', () => {
    const { prod, ledger, backup } = cutOver('chk-idem', 'cand-i1')
    injectIncident(ledger, 'ESCALATE', T0 + 500)
    const first = checkGrayWindow(ledger, backup, { clock: () => T0 + 1000, idFactory: () => seqUlid() })
    expect(first.rolled).toBe(true)
    const eventsAfterRoll = ledger.queryEvents().length

    const second = checkGrayWindow(ledger, backup, { clock: () => T0 + 2000, idFactory: () => seqUlid() })
    expect(second.rolled).toBe(false) // 本次没有再回滚（幂等面：rolled 指本次动作）
    expect(second.done).toBe(true)
    expect(second.reason).toContain('window-already-rolled')
    expect(second.event).toBeNull()
    expect(ledger.queryEvents()).toHaveLength(eventsAfterRoll) // 无新事件
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 文件不动
    expect(ledger.getCandidate('cand-i1')?.status).toBe('retired') // 状态不动
    ledger.close()
  })

  it('备份缺失 fail-closed：backup-missing 拒、窗保持 open（待人工处置）、文件不动、无事件', () => {
    const { prod, ledger, backup } = cutOver('chk-nobak', 'cand-n1')
    injectIncident(ledger, 'ESCALATE', T0 + 500)
    rmSync(backup) // 回滚物理基础被撤
    const err = expectRejected(() => checkGrayWindow(ledger, backup, { clock: () => T0 + 1000 }), 'daemon/gray:backup-missing')
    expect(err.message).toContain('不冒充回滚')
    expect(readGrayWindow(ledger, 'cand-n1')?.status).toBe('open') // 窗保持 open——危险未解除守夜不撤
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY)
    expect(ledger.getCandidate('cand-n1')?.status).toBe('promoted')
    expect(ledger.queryEvents().filter((e) => e.note?.includes('gray-rollback'))).toHaveLength(0)
    ledger.close()
  })
})

// ————————————————————————— 手动关窗 —————————————————————————

describe('手动关窗：closeGrayWindow（幂等，关窗不回滚）', () => {
  it('open → closed（manual-close 理由留 kv）；已关再关=幂等无动作；关窗后 check 幂等 done', () => {
    const prod = seedProduction('close-1')
    const ledger = openLedger(path.join(root, 'close-1.sqlite'))
    seedCandidate(ledger, 'cand-c1', 'approved')
    runCutover(ledger, 'cand-c1', cutoverOpts(newFile('close-1'), prod))
    const backup = path.join(prod, `${ASSET}.bak-cand-c1`)

    const first = closeGrayWindow(ledger, 'cand-c1', { clock: () => T0 + 100 })
    expect(first.changed).toBe(true)
    expect(first.state.status).toBe('closed')
    expect(first.state.reason).toContain('manual-close')
    expect(readGrayWindow(ledger, 'cand-c1')?.status).toBe('closed')

    const again = closeGrayWindow(ledger, 'cand-c1', { clock: () => T0 + 200 })
    expect(again.changed).toBe(false) // 幂等
    expect(again.state.closedAt).toBe(T0 + 100) // 收口时刻不重写

    // 关窗后 check：幂等 done、无动作、生产面不动
    const result = checkGrayWindow(ledger, backup, { clock: () => T0 + 300 })
    expect(result.rolled).toBe(false)
    expect(result.done).toBe(true)
    expect(result.reason).toContain('window-already-closed')
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(NEW_BODY)
    expect(ledger.getCandidate('cand-c1')?.status).toBe('promoted') // 关窗不回滚——面分离
    ledger.close()
  })

  it('无窗候选关窗拒：no-window', () => {
    const ledger = openLedger(path.join(root, 'close-2.sqlite'))
    seedCandidate(ledger, 'cand-c2', 'promoted')
    expectRejected(() => closeGrayWindow(ledger, 'cand-c2'), 'daemon/gray:no-window')
    ledger.close()
  })
})

// ————————————————————————— CLI 面：真 bin 进程 —————————————————————————

describe('CLI 面：studio-next gray --db --candidate [--check|--close]（真 bin 进程端到端）', () => {
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

  it('查窗（缺省动作）：exit 0、窗状态行（open 守夜）、阈值行、备份锚点行', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-query.sqlite')
    const prod = seedProduction('cli-q')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g1', 'approved')
    runCutover(ledger, 'cli-g1', cutoverOpts(newFile('cli-q'), prod))
    ledger.close()

    const result = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g1', '--root', prod])
    expect(result.code).toBe(0)
    expect(result.out).toContain('观察窗状态：open（守夜中）')
    expect(result.out).toContain('阈值=1 条事故信号')
    expect(result.out).toContain(`备份锚点（回滚物理基础）：${path.join(prod, `${ASSET}.bak-cli-g1`)}`)
    expect(result.out).toContain('剩余守夜')
  })

  it('--check 平安到期关窗：窗长 1ms 的窗已过期 → exit 0、灰度完成面、kv closed、无回滚', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-expire.sqlite')
    const prod = seedProduction('cli-x')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g2', 'approved')
    runCutover(ledger, 'cli-g2', cutoverOpts(newFile('cli-x'), prod))
    openGrayWindow(ledger, { candidateId: 'cli-g2', assetPath: ASSET, company: COMPANY, windowMs: 1, clock: () => Date.now() - 10 }) // 已过期
    ledger.close()

    const result = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g2', '--root', prod, '--check'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('灰度检查完成：窗已收口（平安）')
    expect(result.out).toContain('可请求制作人过目')
    const reopened = openLedger(dbPath)
    expect(readGrayWindow(reopened, 'cli-g2')?.status).toBe('closed')
    expect(reopened.getCandidate('cli-g2')?.status).toBe('promoted')
    reopened.close()
  })

  it('--check 触发自动回滚端到端：事故事件注入 → exit 0（回滚=合法判定非命令错误）、store 回查 retired+事件、文件逐字节恢复', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-roll.sqlite')
    const prod = seedProduction('cli-r')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g3', 'approved')
    runCutover(ledger, 'cli-g3', { ...cutoverOpts(newFile('cli-r'), prod), clock: () => Date.now(), idFactory: () => seqUlid() }) // 真时钟开窗
    injectIncident(ledger, 'CIRCUIT_BREAK', Date.now())
    ledger.close()

    const result = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g3', '--root', prod, '--check'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('已自动回滚')
    expect(result.out).toContain('note=gray-rollback')
    expect(result.out).toContain('promoted→retired')

    const reopened = openLedger(dbPath)
    expect(readFileSync(path.join(prod, ASSET), 'utf8')).toBe(OLD_BODY) // 回滚直证
    expect(readFileSync(path.join(prod, `${ASSET}.bak-cli-g3`), 'utf8')).toBe(OLD_BODY) // 锚点保留
    expect(reopened.getCandidate('cli-g3')?.status).toBe('retired')
    expect(readGrayWindow(reopened, 'cli-g3')?.status).toBe('rolled')
    const rollbackEvents = reopened.queryEvents().filter((e) => e.note?.includes('gray-rollback'))
    expect(rollbackEvents).toHaveLength(1)
    reopened.close()
  })

  it('--close 手动关窗（幂等）：首跑 exit 0 收口、再跑 exit 0 幂等无动作', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-close.sqlite')
    const prod = seedProduction('cli-c')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g4', 'approved')
    runCutover(ledger, 'cli-g4', cutoverOpts(newFile('cli-c'), prod))
    ledger.close()

    const first = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g4', '--root', prod, '--close'])
    expect(first.code).toBe(0)
    expect(first.out).toContain('已手动关窗')
    const reopened = openLedger(dbPath)
    expect(readGrayWindow(reopened, 'cli-g4')?.status).toBe('closed')
    reopened.close()

    const again = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g4', '--root', prod, '--close'])
    expect(again.code).toBe(0)
    expect(again.out).toContain('幂等无动作')
  })

  it('无窗候选：查窗/检查均 exit 1、无窗报文', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-nowin.sqlite')
    const prod = seedProduction('cli-nw')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g5', 'approved') // 无窗（未切权开窗）
    ledger.close()

    const query = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g5', '--root', prod])
    expect(query.code).toBe(1)
    expect(query.err).toContain('无灰度观察窗')
    const check = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g5', '--root', prod, '--check'])
    expect(check.code).toBe(1)
    expect(check.err).toContain('无灰度观察窗')
  })

  it('用法错误面：缺 --db／缺 --candidate／库不存在（不代建库）／--check+--close 互斥 → 均 exit 1', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-usage.sqlite')
    const prod = seedProduction('cli-u')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-g6', 'promoted')
    ledger.close()

    const noDb = await runBin(['gray', '--candidate', 'cli-g6'])
    expect(noDb.code).toBe(1)
    expect(noDb.err).toContain('缺少 --db')
    const noCand = await runBin(['gray', '--db', dbPath])
    expect(noCand.code).toBe(1)
    expect(noCand.err).toContain('缺少 --candidate')
    const noDbFile = await runBin(['gray', '--db', path.join(root, 'no-such-gray.sqlite'), '--candidate', 'x'])
    expect(noDbFile.code).toBe(1)
    expect(noDbFile.err).toContain('库不存在')
    expect(existsSync(path.join(root, 'no-such-gray.sqlite'))).toBe(false) // 写面不代建库
    const bothFlags = await runBin(['gray', '--db', dbPath, '--candidate', 'cli-g6', '--root', prod, '--check', '--close'])
    expect(bothFlags.code).toBe(1)
    expect(bothFlags.err).toContain('互斥')
  })
})
