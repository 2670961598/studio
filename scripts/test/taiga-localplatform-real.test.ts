/**
 * taiga-localplatform-real.test —— task-134 M2 单子自研切换·真实快照迁移演练测试
 *（node:test；快照经环境变量注入路径，仓内零 host 路径/零网络/零生产写入）
 *
 * 覆盖（docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M2 验收面）：
 *   A) 全量轻校验（只读整本快照）：计数 1554 单/584 评论/6978 history、contentSha256
 *      完整性自证（parseTaigaSnapshot 内建，不符=UsageError）、ref/idDisplay 唯一且
 *      studio-dev-N 形、状态分布、severity/priority 全缺=null 如实、parent=0 如实
 *   B) planHash 稳定性：dry-run 两次同哈希、零落盘（根不创建）
 *   C) 抽样真迁（确定性子集快照，重建 manifest+contentSha256——与导出器同算法）：
 *      迁移→真实对账 0 gap（exit 0）→幂等重跑（written=0、树哈希不变）→负对照
 *      （改 1 单→对账 exit 1）→恢复（exit 0）
 *   D) M2 阻断项修复回归：issues.list() 可见外源 id（前缀盲区已修）；混树上建单
 *      LOCAL-N=max+1 不撞号；transition/field-set 后 updated 前进（末事件 ts 口径）
 *   E) 双跑对账原型：0 drift（exit 0）；篡改→drift 检出（exit 1）→恢复
 *   F) 计时统计（load/plan/apply/diff/dualrun——runbook M2 证据同源）
 *
 * 运行：TAIGA_REAL_SNAPSHOT=<taiga-export-*.json 绝对路径> node --test
 *       scripts/test/taiga-localplatform-real.test.ts
 * 未设环境变量=整文件 skip（快照不随仓分发；路径不入仓——AGENTS §五.6）。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseTaigaSnapshot, statusDistributionOf } from '../taiga-snapshot.ts'
import { migrateCli } from '../taiga-localplatform-migrate.ts'
import { diffCli } from '../taiga-localplatform-diff.ts'
import { dualrunCli } from '../taiga-localplatform-dualrun.ts'
import { createLocalPlatform } from '../../packages/localplatform/src/index.ts'

const SNAPSHOT = process.env['TAIGA_REAL_SNAPSHOT'] ?? ''
const skip = SNAPSHOT === '' || !existsSync(SNAPSHOT)
const HERE = import.meta.dirname
const MIGRATE = path.join(HERE, '..', 'taiga-localplatform-migrate.ts')
const DIFF = path.join(HERE, '..', 'taiga-localplatform-diff.ts')
const DUALRUN = path.join(HERE, '..', 'taiga-localplatform-dualrun.ts')

const roots: string[] = []
test.after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function tempRoot(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(d)
  return d
}

interface RunResult { status: number; stdout: string }
function run(cli: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }) }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? '') }
  }
}

function lastJson(stdout: string): Record<string, unknown> {
  const end = stdout.lastIndexOf('}')
  assert.ok(end > 0, `stdout 应含 JSON：${stdout.slice(0, 200)}`)
  return JSON.parse(stdout.slice(0, end + 1)) as Record<string, unknown>
}

/** 平台树指纹：文件名+内容 全量哈希（幂等验证用——树级字节不变；M1 同法） */
function treeHash(root: string): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.push(`${path.relative(root, full)}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`)
    }
  }
  walk(root)
  return createHash('sha256').update(files.join('\n')).digest('hex')
}

/**
 * 确定性抽样子集快照：从原始导出 JSON 重建（保留逐字段原形），manifest 计数按子集
 * 重算、contentSha256 按导出器同算法重算（sha256(JSON.stringify(除 manifest 外内容))）。
 * 抽样覆盖：全部状态各取前若干 + 全部带评论单（截 20）+ 带泳道单（截 12）+ 等距普通单。
 */
function buildSubsetSnapshot(sourcePath: string, outPath: string): { ids: string[]; comments: number; history: number } {
  const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown> & {
    stories: Array<Record<string, unknown> & { idDisplay: string; comments?: unknown[]; history?: unknown[]; status?: { name?: string }; customAttributes?: Record<string, unknown> }>
    manifest: Record<string, unknown>
  }
  const chosen = new Set<string>()
  const byStatus = new Map<string, typeof parsed.stories>()
  for (const row of parsed.stories) {
    const key = String(row.status?.name ?? '')
    const list = byStatus.get(key) ?? []
    list.push(row)
    byStatus.set(key, list)
  }
  for (const rows of byStatus.values()) rows.slice(0, 6).forEach((r) => chosen.add(r.idDisplay))
  parsed.stories.filter((r) => (r.comments?.length ?? 0) > 0).slice(0, 20).forEach((r) => chosen.add(r.idDisplay))
  parsed.stories.filter((r) => (r.customAttributes?.['泳道'] ?? null) !== null).slice(0, 12).forEach((r) => chosen.add(r.idDisplay))
  parsed.stories.filter((r) => r.description !== undefined && String(r.description ?? '') !== '').slice(0, 8).forEach((r) => chosen.add(r.idDisplay))
  parsed.stories.filter((_, i) => i % 97 === 0).slice(0, 15).forEach((r) => chosen.add(r.idDisplay))
  const subset = parsed.stories.filter((r) => chosen.has(r.idDisplay))
  const comments = subset.reduce((s, r) => s + (r.comments?.length ?? 0), 0)
  const history = subset.reduce((s, r) => s + (r.history?.length ?? 0), 0)
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'manifest') continue
    content[key] = value
  }
  content['stories'] = subset
  const contentSha256 = createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
  const manifest = {
    ...(parsed.manifest as Record<string, unknown>),
    projectTotalStories: subset.length,
    exportedStories: subset.length,
    commentTotal: comments,
    historyTotal: history,
    contentSha256,
  }
  writeFileSync(outPath, `${JSON.stringify({ ...content, manifest }, null, 2)}\n`, 'utf8')
  return { ids: subset.map((r) => r.idDisplay), comments, history }
}

/* ------------------------------------------------------------------ */

test('A) 全量轻校验：计数/哈希自证/唯一性/分布/缺位如实（只读整本）', { skip: skip || undefined }, () => {
  const t0 = performance.now()
  const snap = parseTaigaSnapshot(JSON.parse(readFileSync(SNAPSHOT, 'utf8')), path.basename(SNAPSHOT))
  const loadMs = Math.round(performance.now() - t0)
  assert.equal(snap.rows.length, 1554, 'stories=1554')
  assert.equal(snap.manifest.exportedStories, 1554)
  assert.equal(snap.rows.reduce((s, r) => s + r.comments.length, 0), 584, 'comments=584')
  assert.equal(snap.rows.reduce((s, r) => s + r.history.length, 0), 6978, 'history=6978')
  assert.equal(snap.rowsDropped, 0, '无重复 idDisplay')
  const refs = snap.rows.map((r) => r.ref)
  assert.equal(new Set(refs).size, refs.length, 'ref 唯一')
  assert.ok(snap.rows.every((r) => /^studio-dev-\d+$/.test(r.id)), 'idDisplay 全部 studio-dev-N 形')
  assert.ok(snap.rows.every((r) => r.modifiedIso >= r.createdIso), 'modified>=created')
  assert.deepEqual(statusDistributionOf(snap.rows.map((r) => r.statusName)).map((s) => `${s.state}:${String(s.count)}`).sort(), ['Archived:98', '已交付:1446', '新单:10'])
  assert.equal(snap.rows.filter((r) => r.severity === null).length, 1554, 'severity 全缺=null 如实')
  assert.equal(snap.rows.filter((r) => r.priority === null).length, 1554, 'priority 全缺=null 如实')
  assert.equal(snap.rows.filter((r) => r.parent !== null).length, 0, 'parent=0 如实（不伪造父子）')
  console.log(`[real] 全量轻校验 load=${String(loadMs)}ms rows=1554 comments=584 history=6978`)
})

test('B) dry-run：planHash 稳定 + 零落盘', { skip: skip || undefined }, () => {
  const dir = tempRoot('lp-real-test-dry-')
  const root = path.join(dir, 'platform')
  const r1 = run(MIGRATE, ['--snapshot', SNAPSHOT, '--dry-run', '--root', root])
  const r2 = run(MIGRATE, ['--snapshot', SNAPSHOT, '--dry-run', '--root', root])
  assert.equal(r1.status, 0)
  const s1 = lastJson(r1.stdout)
  const s2 = lastJson(r2.stdout)
  assert.equal(s1['planHash'], s2['planHash'], '两次 dry-run planHash 一致')
  assert.equal(s1['issues'], 1554)
  assert.equal(s1['comments'], 584)
  assert.equal(existsSync(root), false, 'dry-run 不得创建平台根')
})

test('C+D+E) 抽样真迁全链：迁移→0 gap→幂等→负对照→恢复；list 可见/建单不撞号；双跑 0 drift', { skip: skip || undefined }, async () => {
  const dir = tempRoot('lp-real-test-sample-')
  const subsetPath = path.join(dir, 'taiga-export-subset.json')
  const subset = buildSubsetSnapshot(SNAPSHOT, subsetPath)
  assert.ok(subset.ids.length >= 40, `子集应覆盖足够面（得到 ${String(subset.ids.length)}）`)
  console.log(`[real] 抽样子集：${String(subset.ids.length)} 单 / 评论 ${String(subset.comments)} / history ${String(subset.history)}`)
  const root = path.join(dir, 'platform')

  // C1) 真写：exit 0、written=子集数、审计旁注落盘
  const tApply0 = performance.now()
  const mig = run(MIGRATE, ['--snapshot', subsetPath, '--root', root])
  const applyMs = Math.round(performance.now() - tApply0)
  assert.equal(mig.status, 0, `抽样迁移应 exit 0：${mig.stdout.slice(-800)}`)
  const ms = lastJson(mig.stdout)
  assert.equal(ms['written'], subset.ids.length)
  assert.equal(ms['skipped'], 0)
  assert.equal(ms['comments'], subset.comments)
  assert.equal(existsSync(path.join(root, 'migration-audit', 'taiga-localplatform-migration.json')), true, '审计旁注应落盘')
  const audit = JSON.parse(readFileSync(path.join(root, 'migration-audit', 'taiga-localplatform-migration.json'), 'utf8')) as { counts: { historyNotes: number }; planHash: string }
  assert.equal(audit.counts.historyNotes, subset.history, '审计旁注 history 摘要计数')
  assert.ok(typeof audit.planHash === 'string' && audit.planHash.startsWith('sha256:'), '审计旁注回填 planHash')

  // C2) 真实对账 0 gap
  const tDiff0 = performance.now()
  const diff = run(DIFF, ['--snapshot', subsetPath, '--root', root])
  const diffMs = Math.round(performance.now() - tDiff0)
  assert.equal(diff.status, 0, `抽样对账应 0 gap：${diff.stdout.slice(-800)}`)
  const dr = lastJson(diff.stdout)
  assert.equal(dr['ok'], true)
  assert.deepEqual((dr['counts'] as Record<string, unknown>)['commentsSource'], subset.comments)
  assert.equal((dr['counts'] as Record<string, unknown>)['idsUnique'], true)
  const dist = dr['statusDistribution'] as { source: unknown[]; platform: unknown[] }
  assert.deepEqual(dist.source, dist.platform, '状态分布源=平台')

  // C3) 幂等：written=0、树哈希不变
  const before = treeHash(root)
  const mig2 = run(MIGRATE, ['--snapshot', subsetPath, '--root', root])
  assert.equal(mig2.status, 0)
  const ms2 = lastJson(mig2.stdout)
  assert.equal(ms2['written'], 0)
  assert.equal(ms2['skipped'], subset.ids.length)
  assert.equal(treeHash(root), before, '幂等重跑树字节不变')

  // C4) 负对照：改 1 单 → 对账 exit 1 显式 gap → 恢复 exit 0
  const victim = subset.ids.find((id) => !existsSync(path.join(root, 'issues', `${id}.comments.md`))) ?? subset.ids[0]
  assert.ok(victim !== undefined)
  const victimFile = path.join(root, 'issues', `${victim}.jsonl`)
  const backup = readFileSync(victimFile, 'utf8')
  writeFileSync(victimFile, `${backup}{"type":"field-set","ts":"2026-11-19T00:00:00.000Z","field":"title","value":"负对照篡改"}\n`)
  const tampered = run(DIFF, ['--snapshot', subsetPath, '--root', root])
  assert.equal(tampered.status, 1, '负对照应 exit 1')
  const tr = lastJson(tampered.stdout)
  const gaps = tr['gaps'] as Array<{ issue: string }>
  assert.ok(gaps.some((g) => g.issue === victim), '负对照 gap 应指向被改单')
  writeFileSync(victimFile, backup)
  assert.equal(run(DIFF, ['--snapshot', subsetPath, '--root', root]).status, 0, '恢复后应 0 gap')

  // D1) list() 可见外源 id（M2 前缀盲区修复回归）。时钟钉在快照后一日——D3 验证
  // transition 后 updated 前进需要事件 ts 晚于源末事件（迁移单 updated≈2026-11-18）
  const p = createLocalPlatform(root, { now: () => new Date('2026-11-20T00:00:00.000Z').toISOString() })
  const listed = await p.issues.list({})
  assert.equal(listed.length, subset.ids.length, 'list({}) 应见全部外源 id')
  assert.ok(listed.every((r) => /^studio-dev-\d+$/.test(r.id)))

  // E) 双跑对账：0 drift；篡改→drift 检出→恢复（在 D2/D3 树突变之前跑——顺序即语义）
  const tDual0 = performance.now()
  const dual = run(DUALRUN, ['--snapshot', subsetPath, '--root', root])
  const dualMs = Math.round(performance.now() - tDual0)
  assert.equal(dual.status, 0, `双跑应 0 drift：${dual.stdout.slice(-600)}`)
  const drr = lastJson(dual.stdout)
  assert.equal(drr['ok'], true)
  assert.deepEqual((drr['counts'] as Record<string, unknown>)['shared'], subset.ids.length)
  assert.ok(String(drr['cursor']).endsWith('Z'), '游标为 UTC ISO')
  // 篡改评论面（负对照第二维）：追加一条计划外评论 → dualrun 检出 comments 漂移
  const withComments = subset.ids.find((id) => existsSync(path.join(root, 'issues', `${id}.comments.md`)))
  if (withComments !== undefined) {
    const cfile = path.join(root, 'issues', `${withComments}.comments.md`)
    const cbackup = readFileSync(cfile, 'utf8')
    writeFileSync(cfile, `${cbackup}<!-- comment {"id":"c-999999","created":"2026-11-19T00:00:00.000Z","author":"tamper"} -->\n负对照追加评论\n— tamper（负对照）\n<!-- /comment c-999999 -->\n`)
    const dt = run(DUALRUN, ['--snapshot', subsetPath, '--root', root])
    assert.equal(dt.status, 1, '评论篡改应检出 drift')
    const dtd = lastJson(dt.stdout)
    const drifts = dtd['drift'] as Array<{ issue: string; kind: string }>
    assert.ok(drifts.some((g) => g.issue === withComments), 'drift 应指向被改评论的单')
    writeFileSync(cfile, cbackup)
    assert.equal(run(DUALRUN, ['--snapshot', subsetPath, '--root', root]).status, 0, '恢复后 0 drift')
  }

  // D2) 混树建单不撞号：手放 LOCAL-3 后 create→LOCAL-4（max LOCAL+1）
  writeFileSync(path.join(root, 'issues', 'LOCAL-3.jsonl'), `${JSON.stringify({ type: 'created', ts: '2026-11-19T00:00:00.000Z', state: '新单', input: { title: '既有本地单 LOCAL-3' } })}\n`)
  const created = await p.issues.create({ title: '混树建单' })
  assert.equal(created.id, 'LOCAL-4', '建单自增号=全树 LOCAL-N max+1')

  // D3) updated=末事件 ts（transition/field-set 前进——M2 口径修正回归）
  const lane = listed.find((r) => r.lane !== undefined)
  if (lane !== undefined) {
    const before = await p.issues.get(lane.id)
    await p.issues.transition(lane.id, '新单')
    const after = await p.issues.get(lane.id)
    assert.ok(after.updated >= before.updated, 'transition 后 updated 前进')
  }

  // F) 计时统计（与 runbook M2 证据同源）
  console.log(`[real] 抽样全链计时：migrate=${String(applyMs)}ms diff=${String(diffMs)}ms dualrun=${String(dualMs)}ms（${String(subset.ids.length)} 单）`)
})
