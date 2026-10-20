/**
 * crash-injection —— 崩溃注入五点回归集（F3-11；16-§四 v0.10 验收件「崩溃注入五点全绿」）
 *
 * 规格依据（实现单引用）：
 *   - docs/02-需求-框架面.md F3-11：崩溃注入+幂等恢复——五点各 kill 一次；
 *     prepare→execute→receipt，**恢复先查 receipt**（验收口径「五点全绿方可切权」）。
 *   - docs/02 F1-01 验收：5 个 kill 点崩溃注入后**重放同拍零重复动作**。
 *   - docs/17-§2 主循环七相位（每拍幂等、状态外置进程可死可接手）；20-§五 T4（崩溃注入
 *     五点=进 gray 的闸）；五不变律#1 状态外置。
 *   - 五点冻结表（文档源+17-§2 七相位推演双源定稿）见 src/crash-points.ts 头注——
 *     F3-11 需求原文只给一句，五点清单以冻结表为唯一权威。
 *
 * 手法（每点一测）：
 *   spawn 真 serve 进程（demo fake 栈 + tmp 库）→ SN_CRASH_POINT=<点名> 在注入点
 *   process.kill(SIGKILL) **自杀**（硬杀——验证非优雅死，child exit signal=SIGKILL）→
 *   同库同目录重启 serve（干净 env，钩子归零）→ 恢复断言：无半派发残留 / 无双派发 /
 *   事件不重不漏 / 游标与拍序续用 / 在途单处理有据 → 该单可继续走完终态（机制允许处）。
 *
 * 诚实边界（如实降级与冻结，不上滤镜）：
 *   - fake 平台随进程失忆（单据/活动流在 serve 进程内存）——重启后的等价工作再驱动由
 *     「重挂欠账岗」承载（票号 T-1 重建=真实平台单据存续的模拟面；见 test/crash-points.ts
 *     头注）。重挂补偿的是 fake 的失忆，判重仍全以台账事件（receipt）为准。
 *   - ③ harvest-verdict：DISPATCH 有账、GATE_PASS 无账的孤儿在途——R-B 已转正（docs/38-§2
 *     「在途接管收口」：serve 启动例行接管 work_records running，崩溃注入测试语义转正为
 *     生产面）：重启即收口 interrupted（接管≠收割——四要件无据不判 GATE_FAIL）、不双派发
 *     （attempt 派生+意图键去重）、新 attempt 走完终态、预算沿用 adopt 不双落。活体
 *     WORKER_DEAD 检测（wall/budget/心跳/僵尸）仍归后续刀（R-C 面）。
 *   - ④ heartbeat-write：「tick 汇总事件」v0 形态=零动作拍 HEARTBEAT（事件随动作即时
 *     append，无批量汇总落账面）——如实降级为「重启后无害」断言：心跳不重、拍序/游标
 *     续用、库完整。
 */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { budgetView, foldBudgets } from '@studio-next/core'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  killSurvivors,
  newCaseRoot,
  seedDueJob,
  spawnServe,
  tickSeqs,
  writeServeConfig,
} from './crash-points.ts'

/** 等待上限：单 serve 阶段 20s（waitFor 缺省）+ 用例级 90s 兜底 */
const CASE_TIMEOUT_MS = 90_000

const caseDirs: string[] = []

afterAll(async () => {
  killSurvivors()
  await Promise.all(caseDirs.map((d) => rm(d, { recursive: true, force: true })))
})

// ————————————————————————— 断言小件 —————————————————————————

function dbOf(dir: string): Ledger {
  return openLedger(path.join(dir, 'ledger.sqlite'))
}

function byOrder(a: EventRecord, b: EventRecord): number {
  return a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** 单据侧事件名序列（ts/id 全序——跨进程混写后仍稳定） */
function namesOf(ledger: Ledger, issue: string): string[] {
  return ledger
    .queryEvents({ issue })
    .slice()
    .sort(byOrder)
    .map((e) => e.event)
}

/** 某单全部事件中某名的条数 */
function countOf(ledger: Ledger, issue: string, name: EventRecord['event']): number {
  return ledger.queryEvents({ issue }).filter((e) => e.event === name).length
}

/** DISPATCH 的 attempt 序列（attempt=DISPATCH 计数+1，事件派生——F3-11「先查 receipt」） */
function dispatchAttempts(ledger: Ledger, issue: string): number[] {
  return ledger
    .queryEvents({ issue })
    .filter((e) => e.event === 'DISPATCH')
    .sort(byOrder)
    .map((e) => e.attempt)
}

/** 硬杀后恢复不变量：全局事件 id 唯一（不重不漏）+ SQLite 完整（状态外置——五不变律#1） */
function assertInvariants(ledger: Ledger): void {
  const events = ledger.queryEvents()
  const ids = events.map((e) => e.id)
  expect(new Set(ids).size).toBe(ids.length)
  const row = ledger.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
  expect(row.integrity_check).toBe('ok')
}

/** issue 档折叠预算视图（16-§三 reserve/settle/refusal 三行流） */
function issueBudget(ledger: Ledger, issue: string): { reserved: number; settled: number; refused: number } {
  return budgetView(foldBudgets(ledger.queryBudgets({ scope_kind: 'issue', scope_id: issue })), 'issue', issue)
}

/** 幂等复查样本（恢复后空拍重放前后比对——「零重复动作」） */
interface Sample {
  patrol: number
  dispatch: number
  gatePass: number
  qaPass: number
  merge: number
  close: number
  reserveRows: number
  settleRows: number
  workRows: number
}

function sampleOf(ledger: Ledger, issue: string): Sample {
  const budgets = ledger.queryBudgets({ scope_kind: 'issue', scope_id: issue })
  return {
    patrol: countOf(ledger, issue, 'PATROL'),
    dispatch: countOf(ledger, issue, 'DISPATCH'),
    gatePass: countOf(ledger, issue, 'GATE_PASS'),
    qaPass: countOf(ledger, issue, 'QA_PASS'),
    merge: countOf(ledger, issue, 'MERGE'),
    close: countOf(ledger, issue, 'CLOSE'),
    reserveRows: budgets.filter((b) => b.kind === 'reserve').length,
    settleRows: budgets.filter((b) => b.kind === 'settle').length,
    workRows: ledger.listWorkRecords({ issue }).length,
  }
}

/** 工位路径（rootDir/workspaces/<单号>/att<N>） */
function workspaceOf(dir: string, attempt: number): string {
  return path.join(dir, 'workspaces', 'T-1', `att${attempt}`)
}

/** 断言非优雅死：自杀 SIGKILL（code null + signal SIGKILL——不是优雅停的 exit 0） */
function assertHardKill(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
  expect(exit.code).toBeNull()
  expect(exit.signal).toBe('SIGKILL')
}

// ————————————————————————— 五点回归 —————————————————————————

describe('崩溃注入五点回归集（F3-11：五点各 kill 一次，重启恢复先查 receipt）', () => {
  it(
    '① dispatch-reserved：reserve 落账后 launch 前硬杀 → 重启同单重派 attempt 不漂、预算 adopt 不双落、走完终态',
    async () => {
      const dir = await newCaseRoot('k1')
      caseDirs.push(dir)
      seedDueJob(dir) // 欠账岗：serve#1 启动即触发（工作源）
      const config = writeServeConfig(dir, { tickMs: 300 })

      // —— 崩溃：dispatch 相位（reserve 双行已落账、launch 前）自杀 ——
      const p1 = spawnServe(config, 'dispatch-reserved')
      const exit1 = await p1.exited()
      assertHardKill(exit1)

      // 命中点直证（prepare 完成缝）：PATROL 已落、reserve 双行已落；DISPATCH/在途工位无账
      const post1 = dbOf(dir)
      expect(countOf(post1, 'T-1', 'PATROL')).toBe(1)
      expect(countOf(post1, 'T-1', 'DISPATCH')).toBe(0)
      expect(post1.listWorkRecords({ issue: 'T-1' })).toHaveLength(0)
      const reserve1 = post1.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' }).filter((b) => b.kind === 'reserve')
      expect(reserve1).toHaveLength(1)
      expect(existsSync(path.join(workspaceOf(dir, 1), 'brief.md'))).toBe(true) // 装配已落盘（装配先于预算闸）
      expect(existsSync(path.join(workspaceOf(dir, 1), 'REPORT.md'))).toBe(false) // launch 未跑（命中 launch 前）
      const crashSeq = Number(post1.kvGet('tick.seq'))
      expect(crashSeq).toBeGreaterThanOrEqual(1)
      post1.close()

      // —— 恢复：同库同目录重启（重挂欠账岗=真实平台单据存续的模拟面）——
      seedDueJob(dir)
      const p2 = spawnServe(config)
      const idxClose = await p2.waitFor(/recycled=1/, { what: '恢复链走完（CLOSE）' })
      // 幂等复查（F1-01「重放同拍零重复动作」）：终态后再跑两空拍（重放面），停机后验序列不变
      const idxBeat1 = await p2.waitFor(/\[heartbeat\]/, { from: idxClose, what: 'CLOSE 后空拍①' })
      await p2.waitFor(/\[heartbeat\]/, { from: idxBeat1, what: 'CLOSE 后空拍②（重放）' })
      p2.child.kill('SIGINT')
      const exit2 = await p2.exited()
      expect(exit2.code).toBe(0) // 重启进程优雅停面完好
      expect(p2.stderr()).toBe('')

      // —— 恢复断言：receipt 判重（DISPATCH 无账 → 重派 attempt=1 不漂；预算沿用不双落）——
      const ledger = dbOf(dir)
      assertInvariants(ledger)
      expect(namesOf(ledger, 'T-1')).toEqual([
        'PATROL',
        'PATROL',
        'DISPATCH',
        'GATE_PASS',
        'QA_PASS',
        'MERGE',
        'CLOSE',
      ]) // 两空拍重放后序列原样——零重复动作
      expect(dispatchAttempts(ledger, 'T-1')).toEqual([1]) // 崩溃拍无回执 → 重派仍 attempt=1（半派发不留 residue）
      const work = ledger.listWorkRecords({ issue: 'T-1' }).sort(byOrder)
      expect(work).toHaveLength(1) // 在途工位不双写（崩溃拍没落在途账）
      expect(work[0]?.status).toBe('done')
      const budgets = ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' })
      expect(budgets.filter((b) => b.kind === 'reserve')).toHaveLength(1) // adopt 沿用崩溃拍的未结预留——不双落
      expect(budgets.filter((b) => b.kind === 'settle')).toHaveLength(1)
      expect(issueBudget(ledger, 'T-1')).toEqual({ reserved: 0, settled: 0.01, refused: 0 })

      // 拍序/游标续用（状态外置）：重启首拍=崩溃拍+1；游标已持久化非空
      const seqs = tickSeqs(p2.stdout())
      expect(Math.min(...seqs)).toBe(crashSeq + 1)
      expect(ledger.kvGet('tick.seq')).toBe(String(Math.max(...seqs)))
      expect(ledger.kvGet('activity.cursor')).not.toBeNull()
      expect(ledger.kvGet('activity.cursor')).not.toBe('')

      // 幂等复查终值：重放两拍后样本与序列一致（上方 namesOf 已锁——此处锁行数面）
      const final = sampleOf(ledger, 'T-1')
      expect(final).toEqual({
        patrol: 2,
        dispatch: 1,
        gatePass: 1,
        qaPass: 1,
        merge: 1,
        close: 1,
        reserveRows: 1,
        settleRows: 1,
        workRows: 1,
      })
      ledger.close()
    },
    CASE_TIMEOUT_MS,
  )

  it(
    '② dispatch-launched：launch 后在途落账前硬杀 → 孤儿产物无害、重启重派单工位收口、走完终态',
    async () => {
      const dir = await newCaseRoot('k2')
      caseDirs.push(dir)
      seedDueJob(dir)
      const config = writeServeConfig(dir, { tickMs: 300 })

      // —— 崩溃：launch 已返回（fake worker 已落产物）、work_records 在途落账前 ——
      const p1 = spawnServe(config, 'dispatch-launched')
      const exit1 = await p1.exited()
      assertHardKill(exit1)

      // 命中点直证（execute 无回执缝）：launch 产物（REPORT 孤儿）已落盘，但台账全无 execute 痕迹
      const post1 = dbOf(dir)
      expect(countOf(post1, 'T-1', 'PATROL')).toBe(1)
      expect(countOf(post1, 'T-1', 'DISPATCH')).toBe(0)
      expect(post1.listWorkRecords({ issue: 'T-1' })).toHaveLength(0)
      expect(existsSync(path.join(workspaceOf(dir, 1), 'REPORT.md'))).toBe(true) // launch 后直证（worker 已跑）
      const crashSeq = Number(post1.kvGet('tick.seq'))
      post1.close()

      // —— 恢复：同库同目录重启 → 同单重派（重挂欠账岗驱动）——
      seedDueJob(dir)
      const p2 = spawnServe(config)
      await p2.waitFor(/recycled=1/, { what: '恢复链走完（CLOSE）' })
      await p2.waitFor(/\[heartbeat\]/, { what: 'CLOSE 后空拍' })
      p2.child.kill('SIGINT')
      const exit2 = await p2.exited()
      expect(exit2.code).toBe(0)

      // —— 恢复断言：孤儿产物被重派覆盖收编，账面与①同形（无 execute 回执=可安全重执行）——
      const ledger = dbOf(dir)
      assertInvariants(ledger)
      expect(dispatchAttempts(ledger, 'T-1')).toEqual([1])
      const work = ledger.listWorkRecords({ issue: 'T-1' }).sort(byOrder)
      expect(work).toHaveLength(1)
      expect(work[0]?.status).toBe('done')
      expect(work[0]?.report_ref).toMatch(/att1\/REPORT\.md$/) // 孤儿产物收编为该 attempt 证据
      expect(existsSync(work[0]?.report_ref ?? '')).toBe(true)
      expect(issueBudget(ledger, 'T-1')).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
      const seqs = tickSeqs(p2.stdout())
      expect(Math.min(...seqs)).toBe(crashSeq + 1)
      ledger.close()
    },
    CASE_TIMEOUT_MS,
  )

  it(
    '③ harvest-verdict：收割判定后 GATE_PASS 落账前硬杀 → 不双派发、孤儿在途启动例行接管收口、新 attempt 走完终态',
    async () => {
      const dir = await newCaseRoot('k3')
      caseDirs.push(dir)
      seedDueJob(dir)
      const config = writeServeConfig(dir, { tickMs: 300 })

      // —— 崩溃：四要件判定完成、任何收割写账（迁移/收口/GATE_PASS）之前 ——
      const p1 = spawnServe(config, 'harvest-verdict')
      const exit1 = await p1.exited()
      assertHardKill(exit1)

      // 命中点直证（receipt 缺失缝）：DISPATCH 有账、GATE_PASS 无账、在途工位留 running
      const post1 = dbOf(dir)
      expect(dispatchAttempts(post1, 'T-1')).toEqual([1])
      expect(countOf(post1, 'T-1', 'GATE_PASS')).toBe(0)
      const orphan = post1.listWorkRecords({ issue: 'T-1' })
      expect(orphan).toHaveLength(1)
      expect(orphan[0]?.status).toBe('running')
      expect(orphan[0]?.ended_at).toBeUndefined()
      const reserve1 = post1.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' }).filter((b) => b.kind === 'reserve')
      expect(reserve1).toHaveLength(1) // 预留未结（收割未成功——失败/中断路径不结算）
      const crashSeq = Number(post1.kvGet('tick.seq'))
      post1.close()

      // —— 恢复：重启 + 新触发驱动（新意图键≠旧键——崩溃拍的意图已消费，PATROL 留痕不重放）——
      seedDueJob(dir)
      const p2 = spawnServe(config)
      await p2.waitFor(/在途接管（R-B）：1 条/, { what: '启动例行接管（R-B）：前命孤儿 running 工位收口' })
      await p2.waitFor(/dispatched=1/, { what: '崩溃单重派（新 attempt）' })
      await p2.waitFor(/recycled=1/, { what: '恢复链走完（CLOSE）' })
      await p2.waitFor(/\[heartbeat\]/, { what: 'CLOSE 后空拍' })
      p2.child.kill('SIGINT')
      const exit2 = await p2.exited()
      expect(exit2.code).toBe(0)

      // —— 恢复断言（v0 冻结现状——不上滤镜）——
      const ledger = dbOf(dir)
      assertInvariants(ledger)
      expect(dispatchAttempts(ledger, 'T-1')).toEqual([1, 2]) // attempt 事件派生不漂：旧账 1 + 新派 2
      expect(countOf(ledger, 'T-1', 'PATROL')).toBe(2) // 两次触发各留痕一次（意图级幂等）
      expect(countOf(ledger, 'T-1', 'GATE_PASS')).toBe(1) // 仅新 attempt 收割成功
      expect(countOf(ledger, 'T-1', 'CLOSE')).toBe(1) // 该单经新 attempt 走完终态
      const work = ledger.listWorkRecords({ issue: 'T-1' }).sort(byOrder)
      expect(work).toHaveLength(2)
      expect(work[0]?.status).toBe('interrupted') // 【R-B 转正】serve 启动例行接管：前命孤儿收口 interrupted（接管≠收割——四要件无据不判）
      expect(work[0]?.ended_at).not.toBeUndefined()
      expect(work[1]?.status).toBe('done')
      expect(work[1]?.attempt).toBe(2)
      const budgets = ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' })
      expect(budgets.filter((b) => b.kind === 'reserve')).toHaveLength(1) // 新 attempt adopt 沿用孤儿预留——不双落
      expect(budgets.filter((b) => b.kind === 'settle')).toHaveLength(1)
      expect(issueBudget(ledger, 'T-1')).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
      const seqs = tickSeqs(p2.stdout())
      expect(Math.min(...seqs)).toBe(crashSeq + 1)
      ledger.close()
    },
    CASE_TIMEOUT_MS,
  )

  it(
    '④ heartbeat-write：零动作拍心跳写入前硬杀 → 重启无害（心跳不重、拍序/游标续用、库完整）【如实降级面】',
    async () => {
      const dir = await newCaseRoot('k4')
      caseDirs.push(dir)
      const config = writeServeConfig(dir, { tickMs: 200, jobs: false }) // 无工作源：首拍即零动作拍

      // —— 崩溃：相位 7 落账/心跳（HEARTBEAT 事件写入前）——
      const p1 = spawnServe(config, 'heartbeat-write')
      const exit1 = await p1.exited()
      assertHardKill(exit1)

      // 命中点直证：拍序/游标已持久化（tick 首 kv 写），但心跳事件未落（events 全空）
      const post1 = dbOf(dir)
      expect(post1.queryEvents()).toHaveLength(0)
      expect(post1.kvGet('tick.seq')).toBe('1')
      expect(post1.kvGet('activity.cursor')).toBe('') // 空串=游标 null 持久形态
      post1.close()

      // —— 恢复：重启跑数拍后优雅停 ——
      const p2 = spawnServe(config)
      await p2.waitFor(/tick#4/, { what: '重启后连跑 3+ 拍' })
      p2.child.kill('SIGINT')
      const exit2 = await p2.exited()
      expect(exit2.code).toBe(0)

      // —— 恢复断言（降级面：心跳缝无实质可恢复状态——断言「重启后无害」）——
      const ledger = dbOf(dir)
      assertInvariants(ledger)
      const seqs = tickSeqs(p2.stdout())
      expect(Math.min(...seqs)).toBe(2) // 拍序续用：重启首拍=2（非重置为 1）
      expect(ledger.kvGet('tick.seq')).toBe(String(Math.max(...seqs)))
      const events = ledger.queryEvents()
      expect(events.every((e) => e.event === 'HEARTBEAT')).toBe(true) // 除心跳外零事件（不重不漏）
      expect(events.filter((e) => e.event === 'HEARTBEAT')).toHaveLength(seqs.length) // 每拍恰一条（被杀拍不回填、不双写）
      expect(ledger.kvGet('activity.cursor')).toBe('')
      ledger.close()
    },
    CASE_TIMEOUT_MS,
  )

  it(
    '⑤ shutdown-drain：SIGINT 停机 drain 中途硬杀 → 已收口账面存活、重启同单 attempt 递进走完终态',
    async () => {
      const dir = await newCaseRoot('k5')
      caseDirs.push(dir)
      seedDueJob(dir)
      const config = writeServeConfig(dir, { tickMs: 2000 }) // 长拍距：收割拍日志后留足 SIGINT 反应窗

      // —— 停机中崩溃：等收割拍（READY 信号=harvest 日志行，adapters kill 测试竞态教训）→ SIGINT
      //    → 优雅停路径（停源→drain→关账）中途 dispose 内自杀 ——
      const p1 = spawnServe(config, 'shutdown-drain')
      await p1.waitFor(/harvest=1\//, { what: '收割拍（GATE_PASS）' })
      p1.child.kill('SIGINT')
      const exit1 = await p1.exited()
      assertHardKill(exit1) // 非优雅死：停机中途被硬杀（不是优雅停 exit 0）

      // 命中点直证：收割回执已落（GATE_PASS+收口 done+settle 冲销），台账未经优雅关账
      const post1 = dbOf(dir)
      expect(dispatchAttempts(post1, 'T-1')).toEqual([1])
      expect(countOf(post1, 'T-1', 'GATE_PASS')).toBe(1)
      const work1 = post1.listWorkRecords({ issue: 'T-1' })
      expect(work1).toHaveLength(1)
      expect(work1[0]?.status).toBe('done')
      expect(post1.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' }).filter((b) => b.kind === 'settle')).toHaveLength(1)
      const crashSeq = Number(post1.kvGet('tick.seq'))
      post1.close()

      // —— 恢复：重启（GATE_PASS 回执已释放意图键）→ 同单重派 attempt=2 走完整链 ——
      seedDueJob(dir)
      const p2 = spawnServe(config)
      await p2.waitFor(/recycled=1/, { what: '恢复链走完（CLOSE）' })
      await p2.waitFor(/\[heartbeat\]/, { what: 'CLOSE 后空拍' })
      p2.child.kill('SIGINT')
      const exit2 = await p2.exited()
      expect(exit2.code).toBe(0) // 重启进程优雅停面完好（drain 崩溃不留停机损伤）

      // —— 恢复断言：receipt 在账 → attempt 递进（不重签 attempt=1）；两程各自结算 ——
      const ledger = dbOf(dir)
      assertInvariants(ledger)
      expect(dispatchAttempts(ledger, 'T-1')).toEqual([1, 2]) // 查 receipt：旧 DISPATCH 计 1 → 新派 attempt=2
      expect(countOf(ledger, 'T-1', 'GATE_PASS')).toBe(2)
      expect(countOf(ledger, 'T-1', 'MERGE')).toBe(1)
      expect(countOf(ledger, 'T-1', 'CLOSE')).toBe(1)
      expect(countOf(ledger, 'T-1', 'QA_PASS')).toBeGreaterThanOrEqual(1) // SIGINT 落点可能在收割后 1-2 拍间浮动
      expect(countOf(ledger, 'T-1', 'PATROL')).toBe(2)
      const work = ledger.listWorkRecords({ issue: 'T-1' }).sort(byOrder)
      expect(work).toHaveLength(2)
      expect(work.map((w) => w.status)).toEqual(['done', 'done']) // 停机崩溃不丢已收口账（在途单已 drain 完成面）
      const budgets = ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' })
      expect(budgets.filter((b) => b.kind === 'reserve')).toHaveLength(2) // 第二程无未结预留 → 新 reserve（与 ①②③ adopt 面相异）
      expect(budgets.filter((b) => b.kind === 'settle')).toHaveLength(2)
      expect(issueBudget(ledger, 'T-1')).toEqual({ reserved: 0, settled: 0.02, refused: 0 })
      const seqs = tickSeqs(p2.stdout())
      expect(Math.min(...seqs)).toBe(crashSeq + 1)
      ledger.close()
    },
    CASE_TIMEOUT_MS,
  )
})
