/**
 * taiga-localplatform.test —— task-131 M1 单子自研切换预演测试（node:test；真实仓内数据件，零网络零生产）
 *
 * 覆盖（plan/06-自研单子与聊天室切换-2026-11-19.md §二 M1 验收面）：
 *   1) 真实 Phase0 10 单迁移→对账 0 gap（exit 0）
 *   2) 幂等：重跑零新增（树字节不变、planHash 稳定、written=0）
 *   3) dry-run 零落盘（根目录不创建），planHash 与实跑一致
 *   4) 状态映射与 packages/localplatform/src/binding.ts 口径一致：
 *      平台态逐字保留；mapState→Ok(unverified, workStates=[])——映射表是部署工件，
 *      本迁移不伪造映射行；对账码（STATE_MAP 冻结表）与 Phase0 期望表独立重现；
 *      漂移（1495 已交付→已派发）显式披露不算 gap
 *   5) 评论/父子链（合成导出）：comments.add/links.link 经平台 API；逐字回读；
 *      children=显式链接∪parent 字段；活动流含 commented 条目
 *   6) fail-closed：树内计划外单→拒写（exit 1、零写入）；平台态被改→对账 exit 1 显式 gap
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mapState } from '../../packages/localplatform/src/binding.ts'
import { createLocalPlatform } from '../../packages/localplatform/src/index.ts'
import { STATE_MAP, stateRowOf } from '../workbench-issues-migrate.ts'
import { DEFAULT_EXPORT, DEFAULT_EXPECTATIONS, loadExpectations, loadPhase0Export } from '../workbench-issues-rehearse.ts'
import { migrateCli } from '../taiga-localplatform-migrate.ts'
import { diffCli } from '../taiga-localplatform-diff.ts'

const HERE = import.meta.dirname
const MIGRATE = path.join(HERE, '..', 'taiga-localplatform-migrate.ts')
const DIFF = path.join(HERE, '..', 'taiga-localplatform-diff.ts')

const roots: string[] = []
test.after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function tempRoot(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(d)
  return d
}
/** 演练残留探测：跑前/跑后 /tmp 下 lp-migrate-sandbox*（脚本默认根）不得增加 */
const leakCount = (): number => readdirSync(tmpdir()).filter((n) => n.startsWith('lp-migrate-sandbox')).length

interface RunResult { status: number; stdout: string; stderr: string }
function run(cli: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

/** 平台树指纹：文件名+内容 全量哈希（幂等验证用——树级字节不变） */
function treeHash(root: string): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      if (existsSync(path.join(full))) {
        if (statSync(full).isDirectory()) walk(full)
        else files.push(`${path.relative(root, full)}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`)
      }
    }
  }
  walk(root)
  return createHash('sha256').update(files.join('\n')).digest('hex')
}

const loadExport = () => loadPhase0Export(DEFAULT_EXPORT)
const loadExp = () => loadExpectations(DEFAULT_EXPECTATIONS)

test('真实 Phase0 10 单：迁移→对账 0 gap（exit 0）', async () => {
  const leaksBefore = leakCount()
  const root = path.join(tempRoot('lp-migrate-test-real-'), 'platform')
  const planOut = path.join(path.dirname(root), 'plan.json')

  const mig = await migrateCli(['--root', root, '--out', planOut])
  assert.equal(mig.code, 0, `迁移应 exit 0，stdout=${mig.stdout}`)
  const summary = JSON.parse(mig.stdout) as { written: number; skipped: number; issues: number; blocking: boolean; planHash: string }
  assert.equal(summary.issues, 10)
  assert.equal(summary.written, 10)
  assert.equal(summary.skipped, 0)
  assert.equal(summary.blocking, false)
  assert.match(summary.planHash, /^sha256:[0-9a-f]{64}$/)

  // 树形态：10 单事件流 + 活动流 + provision；ID 逐字保留
  const issueFiles = readdirSync(path.join(root, 'issues')).filter((n) => n.endsWith('.jsonl')).sort()
  assert.deepEqual(
    issueFiles.map((n) => n.replace('.jsonl', '')),
    Array.from({ length: 10 }, (_, i) => `studio-dev-${String(1486 + i)}`),
  )
  assert.ok(existsSync(path.join(root, 'activity.jsonl')), '活动流应落盘')
  assert.ok(existsSync(path.join(root, 'meta', 'fields.json')), 'provision 应落盘')
  // --out 计划件：pretty JSON、含 planHash 与逐单明细
  const plan = JSON.parse(readFileSync(planOut, 'utf8')) as { meta: { planHash: string }; issues: unknown[] }
  assert.equal(plan.meta.planHash, summary.planHash)
  assert.equal(plan.issues.length, 10)

  // 对账：0 gap exit 0
  const diff = await diffCli(['--root', root])
  assert.equal(diff.code, 0, `对账应 exit 0，stdout=${diff.stdout}`)
  const report = JSON.parse(diff.stdout.slice(0, diff.stdout.lastIndexOf('}') + 1)) as {
    ok: boolean
    counts: { source: number; platform: number; matched: number }
    gaps: unknown[]
  }
  assert.equal(report.ok, true)
  assert.deepEqual(report.counts, { source: 10, platform: 10, matched: 10, commentsSource: 0, commentsPlatform: 0, linksSource: 0, linksPlatform: 0 })
  assert.equal(report.gaps.length, 0)

  // CLI 直跑等价（子进程路径）
  const cliRun = run(MIGRATE, ['--dry-run', '--root', path.join(tempRoot('lp-migrate-test-cli-'), 'p')])
  assert.equal(cliRun.status, 0)
  assert.equal(leakCount(), leaksBefore, '脚本默认根 /tmp/lp-migrate-sandbox 不得被测试触碰')
})

test('幂等：重跑零新增（树字节不变、planHash 稳定、written=0）', async () => {
  const root = path.join(tempRoot('lp-migrate-test-idem-'), 'platform')
  const first = await migrateCli(['--root', root])
  assert.equal(first.code, 0)
  const before = treeHash(root)
  const firstSummary = JSON.parse(first.stdout) as { planHash: string; written: number }

  const second = await migrateCli(['--root', root])
  assert.equal(second.code, 0)
  const secondSummary = JSON.parse(second.stdout) as { planHash: string; written: number; skipped: number; blocking: boolean }
  assert.equal(secondSummary.written, 0, '重跑不得再写任何单')
  assert.equal(secondSummary.skipped, 10)
  assert.equal(secondSummary.blocking, false)
  assert.equal(secondSummary.planHash, firstSummary.planHash, 'planHash 必须稳定（只由源数据决定）')
  assert.equal(treeHash(root), before, '平台树必须字节不变')

  const third = await migrateCli(['--root', root])
  assert.equal((JSON.parse(third.stdout) as { written: number }).written, 0)
  const diff = await diffCli(['--root', root])
  assert.equal(diff.code, 0, '幂等重跑后对账仍 0 gap')
})

test('dry-run：零落盘（根不创建），planHash 与实跑一致', async () => {
  const dir = tempRoot('lp-migrate-test-dry-')
  const root = path.join(dir, 'platform')
  const dry = await migrateCli(['--dry-run', '--root', root])
  assert.equal(dry.code, 0)
  assert.equal(existsSync(root), false, 'dry-run 不得创建平台根')
  const drySummary = JSON.parse(dry.stdout) as { dryRun: boolean; planHash: string; issues: number }
  assert.equal(drySummary.dryRun, true)
  assert.equal(drySummary.issues, 10)

  // 同源实跑（另一根）→ planHash 相同（计划只由源数据决定的可验证断言）
  const realRoot = path.join(dir, 'platform-real')
  const real = await migrateCli(['--root', realRoot])
  assert.equal(real.code, 0)
  const realSummary = JSON.parse(real.stdout) as { planHash: string }
  assert.equal(drySummary.planHash, realSummary.planHash)
  assert.equal(existsSync(root), false, '实跑也不得触碰 dry-run 指过的根')
})

test('状态映射与 binding.ts 口径一致（逐字保留/未映射=观察/期望表独立重现/漂移显式）', async () => {
  const exported = loadExport()
  const exp = loadExp()
  const root = path.join(tempRoot('lp-migrate-test-binding-'), 'platform')
  const mig = await migrateCli(['--root', root])
  assert.equal(mig.code, 0)

  // 1) 平台态逐字：每单平台 state === 源 state（中文平台态字符串，不翻译）
  const platform = createLocalPlatform(root, { now: () => new Date(0).toISOString() })
  const liveStates = new Set<string>()
  for (const row of exported.rows) {
    const rec = await platform.issues.get(row.issue)
    assert.equal(rec.state, row.state, `${row.issue} 平台态必须逐字保留`)
    liveStates.add(row.state)
  }

  // 2) binding.ts 判决：Ok + unverified + workStates 空（映射表是部署工件——STATE_MAPPINGS 空，
  //    迁移不得伪造映射行）；platformState 逐字回传
  for (const state of liveStates) {
    const verdict = mapState(state)
    assert.equal(verdict.kind, 'ok', `mapState("${state}") 必须是 Ok——未映射是观察事实不是失败`)
    if (verdict.kind === 'ok') {
      assert.equal(verdict.value.platformState, state)
      assert.deepEqual(verdict.value.workStates, [])
      assert.equal(verdict.value.verification, 'unverified')
      assert.equal(verdict.value.unmappedBehavior, 'observe-unmapped')
    }
  }

  // 3) 对账码（STATE_MAP 冻结表）与 Phase0 期望表独立重现：非漂移行 desired=planned；漂移=1495 一行
  let liveMatched = 0
  const drifted: string[] = []
  for (const m of exp.mapping) {
    const row = exported.rows.find((r) => r.issue === m.externalRef)
    assert.ok(row !== undefined, `期望表行 ${m.externalRef} 应在导出内`)
    const code = stateRowOf(row.state)?.to ?? null
    assert.equal(stateRowOf(m.originalState)?.to, m.desiredStateCode, `STATE_MAP 必须独立重现期望表（${m.externalRef}）`)
    if (row.state === m.originalState) {
      liveMatched += 1
      assert.equal(code, m.desiredStateCode)
    } else {
      drifted.push(row.issue)
    }
  }
  assert.equal(liveMatched, 9, '非漂移行 9 张必须码一致')
  assert.deepEqual(drifted, ['studio-dev-1495'], '漂移恰为 1495（已交付→已派发）')

  // 4) 漂移在对账报告里显式披露（不算 gap）
  const diff = await diffCli(['--root', root])
  assert.equal(diff.code, 0, '漂移披露不得拦停 0-gap')
  const report = JSON.parse(diff.stdout.slice(0, diff.stdout.lastIndexOf('}') + 1)) as {
    ok: boolean
    gaps: unknown[]
    drift: { issue: string; snapshotDesiredCode: number; platformCode: number }[]
  }
  assert.equal(report.ok, true)
  assert.equal(report.gaps.length, 0)
  assert.equal(report.drift.length, 1)
  assert.equal(report.drift[0]?.issue, 'studio-dev-1495')
  assert.equal(report.drift[0]?.snapshotDesiredCode, 6)
  assert.equal(report.drift[0]?.platformCode, 3)

  // 5) provision 覆盖全部平台态（create/transition 合法性前提）
  const provision = JSON.parse(readFileSync(path.join(root, 'meta', 'fields.json'), 'utf8')) as { provision: { states: string[] } }
  for (const state of liveStates) assert.ok(provision.provision.states.includes(state), `provision.states 应含 "${state}"`)
  // 迁移态全部在 STATE_MAP 冻结表（源可映射）
  for (const state of liveStates) assert.ok(STATE_MAP.some((r) => r.from === state))
})

test('评论/父子链（合成导出）：平台 API 写入、逐字回读、children/活动流正确', async () => {
  const dir = tempRoot('lp-migrate-test-family-')
  const exported = loadExport()
  // 合成：1489 为父（1490、1488 挂它）；1490 带两条评论（多行正文）；1489 带一条
  const rows = exported.rows.map((row) => ({ ...row, comments: [] as typeof row.comments }))
  const withParent = (issue: string, parent: string | null): void => {
    const row = rows.find((r) => r.issue === issue)
    if (row !== undefined) row.parent = parent
  }
  withParent('studio-dev-1490', 'studio-dev-1489')
  withParent('studio-dev-1488', 'studio-dev-1489')
  const byIssue = new Map(rows.map((r) => [r.issue, r]))
  const c1490 = byIssue.get('studio-dev-1490')
  const c1489 = byIssue.get('studio-dev-1489')
  assert.ok(c1490 !== undefined && c1489 !== undefined)
  c1490.comments = [
    { id: 'tc-1', author: 'OPS-1', body: '首条评论\n第二行逐字保留', replyTo: null, createdAt: 1794848705000 },
    { id: 'tc-2', author: 'PRIME-0', body: '回复类评论（无 replyTo 锚——本迁移逐字保 body 不伪造锚）', replyTo: null, createdAt: 1794848706000 },
  ]
  c1489.comments = [{ id: 'tc-3', author: 'OPS-2', body: '父单评论', replyTo: null, createdAt: 1794848707000 }]
  const syntheticPath = path.join(dir, 'ticket-export-family.json')
  writeFileSync(syntheticPath, JSON.stringify({ schema: exported.schema, rows }, null, 2))

  const root = path.join(dir, 'platform')
  const mig = await migrateCli(['--export', syntheticPath, '--root', root])
  assert.equal(mig.code, 0, `合成导出迁移应 exit 0：${mig.stdout}`)
  const summary = JSON.parse(mig.stdout) as { comments: number; links: number; gapCount: number; blocking: boolean }
  assert.equal(summary.comments, 3)
  assert.equal(summary.links, 2)
  assert.equal(summary.blocking, false)
  // 计划内 gap 恰为 3 条全局不迁披露（合成父均在导出集内——无 parent-missing）
  assert.equal(summary.gapCount, 3)

  // 评论逐字回读（author/body/created 全保）
  const platform = createLocalPlatform(root, { now: () => new Date(0).toISOString() })
  const comments = await platform.comments.list('studio-dev-1490')
  assert.equal(comments.length, 2)
  assert.equal(comments[0]?.author, 'OPS-1')
  assert.equal(comments[0]?.body, '首条评论\n第二行逐字保留')
  assert.equal(comments[0]?.created, new Date(1794848705000).toISOString())
  assert.equal(comments[1]?.author, 'PRIME-0')

  // 父子：children=显式链接∪parent 字段（两子全见）
  const children = await platform.links.children('studio-dev-1489')
  assert.deepEqual([...children].sort(), ['studio-dev-1488', 'studio-dev-1490'])
  const meta = readFileSync(path.join(root, 'meta', 'links.jsonl'), 'utf8')
  assert.equal(meta.trim().split('\n').length, 2, '显式链接应恰好 2 条')

  // 活动流：created 10 + commented 3；评论活动带 actor
  const activity = readFileSync(path.join(root, 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; issue?: string })
  assert.equal(activity.filter((a) => a.kind === 'created').length, 10)
  const commented = activity.filter((a) => a.kind === 'commented')
  assert.equal(commented.length, 3)

  // 对账 0 gap（评论/父子面全对）
  const diff = await diffCli(['--export', syntheticPath, '--root', root])
  assert.equal(diff.code, 0, `合成导出对账应 0 gap：${diff.stdout.slice(-600)}`)
  const report = JSON.parse(diff.stdout.slice(0, diff.stdout.lastIndexOf('}') + 1)) as { ok: boolean; counts: { commentsSource: number; commentsPlatform: number; linksSource: number; linksPlatform: number } }
  assert.equal(report.ok, true)
  assert.deepEqual(report.counts.commentsSource, 3)
  assert.deepEqual(report.counts.commentsPlatform, 3)
  assert.equal(report.counts.linksSource, 2)
  assert.equal(report.counts.linksPlatform, 2)
})

test('fail-closed：计划外单拒写（零写入）；平台态漂移→对账 exit 1', async () => {
  const dir = tempRoot('lp-migrate-test-fail-')
  const root = path.join(dir, 'platform')
  assert.equal((await migrateCli(['--root', root])).code, 0)

  // 1) 树内计划外单（LOCAL-1）→ 拒写：零写入、exit 1、树不变
  writeFileSync(path.join(root, 'issues', 'LOCAL-1.jsonl'), `${JSON.stringify({ type: 'created', ts: '2026-01-01T00:00:00.000Z', state: 'open', input: { title: 'foreign' } })}\n`)
  const before = treeHash(root)
  const refused = await migrateCli(['--root', root])
  assert.equal(refused.code, 1, '计划外单必须 exit 1')
  const refSummary = JSON.parse(refused.stdout) as { blocking: boolean; written: number; skipped: number; gaps: { kind: string }[] }
  assert.equal(refSummary.blocking, true)
  assert.equal(refSummary.written, 0)
  assert.ok(refSummary.gaps.some((g) => g.kind === 'extra-ticket'))
  assert.equal(treeHash(root), before, '拒写必须零写入（树字节不变）')

  // 2) 对该树对账：extra-ticket 显式 gap → exit 1
  const diffForeign = await diffCli(['--root', root])
  assert.equal(diffForeign.code, 1)
  const foreignReport = JSON.parse(diffForeign.stdout.slice(0, diffForeign.stdout.lastIndexOf('}') + 1)) as { ok: boolean; gaps: { kind: string }[] }
  assert.equal(foreignReport.ok, false)
  assert.ok(foreignReport.gaps.some((g) => g.kind === 'extra-ticket'))

  // 3) 平台态漂移（transition 改态）→ 对账 exit 1 + state-mismatch/updated-mismatch 显式
  rmSync(path.join(root, 'issues', 'LOCAL-1.jsonl'))
  const platform = createLocalPlatform(root, { now: () => new Date(0).toISOString() })
  await platform.issues.transition('studio-dev-1486', '已派发')
  const diffTampered = await diffCli(['--root', root])
  assert.equal(diffTampered.code, 1, '平台态漂移必须 exit 1')
  const tampered = JSON.parse(diffTampered.stdout.slice(0, diffTampered.stdout.lastIndexOf('}') + 1)) as { ok: boolean; gaps: { kind: string; issue: string | null }[] }
  assert.equal(tampered.ok, false)
  assert.ok(
    tampered.gaps.some((g) => (g.kind === 'state-mismatch' || g.kind === 'updated-mismatch') && g.issue === 'studio-dev-1486'),
    `应显式 state/updated gap：${JSON.stringify(tampered.gaps)}`,
  )
})
