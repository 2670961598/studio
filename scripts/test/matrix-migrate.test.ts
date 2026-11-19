/**
 * matrix-migrate.test —— task-137 M4 聊天自研切换·Matrix→chatd 迁移工具链测试
 *（node:test；fixture 驱动；仓内零 host 路径/零生产写入——快照与工作目录全在 mkdtemp）
 *
 * 覆盖（docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M4 验收面「0 漏/0 重复」）：
 *   A) fixture 房/消息迁移：4 房（含无名房回落/同名房消歧/空房哨兵）、6 可迁消息、
 *      4 不可迁登记（encrypted/attachment/edit/empty-body）——报告逐项断言
 *   B) actor 映射：显式（@mapped.bot→chief）/启发式 localpart（@lead→lead）/
 *      兜底 MXID 逐字（@weird#user…，脏 localpart 不猜）三规则齐验
 *   C) 对账 0 差异：diff --db exit 0（记账层 A+结构层 B+事件层 C 全过）
 *   D) 幂等复跑：同工作目录重跑（chatd 重启 hydrate 同一 SQLite）——L3 标签预检
 *      （≤200/房窗口）+ L2 idempotencyKey replay（>200 窗口外）双路径：205 消息房
 *      复跑 preexisting=200+6 + replayed=5、sent=0、总量不变
 *   E) gap 检出：导出增事件（export-unaccounted，0 漏口径）→ exit 1；报告掺假事件
 *      （missed+plan-foreign）→ exit 1；diffExportVsChatd 纯函数负对照
 *      （duplicate/sender-mismatch/time-range-mismatch/unexpected）
 *   F) socket 在线对账：对 hydrate 起来的 chatd 走 Transport v1 --socket --token diff exit 0
 *   G) 真实 Matrix 导出（env 门 MATRIX_REAL_EXPORT=1 + MATRIX_HOMESERVER/MATRIX_BOT_USER/
 *      MATRIX_BOT_PASSWORD）：导出→manifest 完整性自证→迁移→对账 0 diff→复跑幂等。
 *      默认 skip（快照不随仓分发；路径/凭据全 env，不入仓）
 *
 * 运行：node --experimental-strip-types --test scripts/test/matrix-migrate.test.ts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseMatrixExport } from '../matrix-export.ts'
import { buildActorMap, buildRoomPlans, parseTag, startTempChatd } from '../matrix-to-chatd-migrate.ts'
import { diffExportVsChatd, loadMigrateReport, readChatdDb } from '../matrix-to-chatd-diff.ts'

const HERE = import.meta.dirname
const MIGRATE = path.join(HERE, '..', 'matrix-to-chatd-migrate.ts')
const DIFF = path.join(HERE, '..', 'matrix-to-chatd-diff.ts')
const EXPORT_CLI = path.join(HERE, '..', 'matrix-export.ts')
const FIXTURE = path.join(HERE, 'fixtures', 'matrix-migrate', 'matrix-export.json')
const ACTORS = path.join(HERE, 'fixtures', 'matrix-migrate', 'actors.json')

const workdirs: string[] = []
test.after(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mx-migrate-test-'))
  workdirs.push(dir)
  return dir
}

interface RunResult { status: number; stdout: string }
function run(cli: string, args: readonly string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, ['--experimental-strip-types', cli, ...args], { encoding: 'utf8' }) }
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

/* ------------------------------------------------------------------ */

test('A+B) fixture 迁移：房映射/消息/actor 三规则/不可迁登记', () => {
  const wd = tempDir()
  const result = run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd])
  assert.equal(result.status, 0, `迁移应 exit 0：${result.stdout.slice(-400)}`)
  const summary = lastJson(result.stdout)
  assert.equal(summary['mode'], 'temp')
  assert.deepEqual(summary['rooms'], { created: 4, reused: 0 })
  assert.deepEqual(summary['messages'], { planned: 6, sent: 6, replayed: 0, preexisting: 0 })
  assert.deepEqual(summary['skipped'], { encrypted: 1, edit: 1, attachment: 1, 'empty-body': 1 })
  assert.equal(summary['unmappedVerbatimActors'], 1)

  const report = JSON.parse(readFileSync(path.join(wd, 'migrate-report.json'), 'utf8')) as Record<string, unknown>
  const actorMap = report['actorMap'] as Record<string, { actor: string; rule: string }>
  assert.equal(actorMap['@mapped.bot:localhost']?.actor, 'chief')
  assert.equal(actorMap['@mapped.bot:localhost']?.rule, 'explicit')
  assert.equal(actorMap['@lead:localhost']?.actor, 'lead')
  assert.equal(actorMap['@lead:localhost']?.rule, 'heuristic-localpart')
  assert.equal(actorMap['@weird#user:localhost']?.rule, 'verbatim-mxid')
  assert.equal(actorMap['@weird#user:localhost']?.actor, '@weird#user:localhost')

  const rooms = report['rooms'] as { matrixRoomId: string; chatdName: string; topic: string | null; memberCount: number; planned: number; skipped: number }[]
  // 撞名消歧=按 roomId 排序先到先得：!roomDupName 字典序在前得裸名，!roomOps 得 #hash8 后缀（确定性=复跑/对账一致）
  const opsRoom = rooms.find((r) => r.matrixRoomId === '!roomOps:localhost')
  assert.ok(opsRoom !== undefined, 'ops 房应在报告')
  assert.match(opsRoom.chatdName, /^ops-值班 #[0-9a-f]{8}$/, '撞名房以 #hash8 消歧')
  assert.equal(opsRoom.topic, '值班与告警同步', 'topic 落报告（chatd v1 无 topic 字段——协议缺口登记）')
  assert.equal(opsRoom.planned, 4)
  assert.equal(opsRoom.skipped, 4)
  assert.ok(opsRoom.memberCount >= 4, '成员集=发送者∪mention 目标∪导出成员')
  const dupRoom = rooms.find((r) => r.matrixRoomId === '!roomDupName:localhost')
  assert.ok(dupRoom !== undefined && dupRoom.chatdName === 'ops-值班', '字典序在前的撞名房保留裸名')
  const noName = rooms.find((r) => r.chatdName === '!roomNoName:localhost')
  assert.ok(noName !== undefined, '无名房回落 roomId')
  const empty = rooms.find((r) => r.chatdName === '空房-哨兵')
  assert.ok(empty !== undefined && empty.planned === 0, '空房仍建（房清单迁移）')

  // 纯函数面：buildActorMap/buildRoomPlans 同源断言（同导出同计划）
  const exported = parseMatrixExport(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  const mxids = ['@lead:localhost', '@dev1:localhost', '@weird#user:localhost', '@mapped.bot:localhost']
  const plans = buildRoomPlans(exported, buildActorMap(mxids, { '@mapped.bot:localhost': 'chief' }))
  assert.equal(plans.length, 4)
  const ops = plans.find((p) => p.matrixRoomId === '!roomOps:localhost')
  assert.ok(ops !== undefined)
  assert.equal(ops.planned.length, 4)
  assert.ok(ops.memberActors.includes('chief') && ops.memberActors.includes('@weird#user:localhost'), 'mention 目标与脏 localpart 发送者都在成员集（chatd 约束）')
  assert.ok(ops.planned[0]?.taggedBody.startsWith('[mx:$ev1@1793729277199] '), '溯源标签=eventId+ts')
})

test('C) 对账 0 差异（--db 全量口径 exit 0）', () => {
  const wd = tempDir()
  const migrated = run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd])
  assert.equal(migrated.status, 0)
  const diffed = run(DIFF, ['--export', FIXTURE, '--report', path.join(wd, 'migrate-report.json'), '--db', path.join(wd, 'chatd.sqlite'), '--quiet'])
  assert.equal(diffed.status, 0, `对账应 exit 0：${diffed.stdout.slice(-400)}`)
  const summary = lastJson(diffed.stdout)
  assert.equal(summary['ok'], true)
  assert.deepEqual(summary['gapKinds'], [])
  assert.equal(summary['tagged'], 6)
  assert.equal(summary['foreign'], 0)
})

test('D) 幂等复跑：L3 预检 + L2 replay（205 消息房跨 200 窗口）', () => {
  const wd = tempDir()
  // fixture + 205 消息大房（超出协议 messages.list 200 条窗口——窗口外仅 L2 idempotencyKey 可证）
  const bigExport = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rooms: Record<string, unknown> }
  const messages = Array.from({ length: 205 }, (_, i) => ({ eventId: `$big${String(i)}`, type: 'm.room.message', ts: 1794200000000 + i, sender: '@lead:localhost', body: `bulk ${String(i)}`, msgtype: 'm.text', mentions: [] }))
  bigExport.rooms['!roomBig:localhost'] = { name: 'bulk-大房', topic: null, canonicalAlias: null, members: ['@lead:localhost'], messages }
  const bigPath = path.join(wd, 'big-export.json')
  writeFileSync(bigPath, JSON.stringify(bigExport, null, 2))

  const first = run(MIGRATE, ['--export', bigPath, '--workdir', wd])
  assert.equal(first.status, 0, `首跑应 exit 0：${first.stdout.slice(-400)}`)
  const firstSummary = lastJson(first.stdout)
  assert.deepEqual(firstSummary['messages'], { planned: 211, sent: 211, replayed: 0, preexisting: 0 })

  // 复跑=chatd 在同一 SQLite 上重启（hydrate）→ 标签预检 200+6 条 + 窗口外 5 条走 idempotencyKey replay
  const second = run(MIGRATE, ['--export', bigPath, '--workdir', wd])
  assert.equal(second.status, 0, `复跑应 exit 0：${second.stdout.slice(-400)}`)
  const secondSummary = lastJson(second.stdout)
  assert.deepEqual(secondSummary['rooms'], { created: 0, reused: 5 })
  assert.deepEqual(secondSummary['messages'], { planned: 211, sent: 0, replayed: 5, preexisting: 206 })

  const diffed = run(DIFF, ['--export', bigPath, '--report', path.join(wd, 'migrate-report.json'), '--db', path.join(wd, 'chatd.sqlite'), '--quiet'])
  assert.equal(diffed.status, 0, `复跑后仍 0 差异：${diffed.stdout.slice(-400)}`)
  assert.equal((lastJson(diffed.stdout) as { tagged: number })['tagged'], 211)
})

test('E) gap 检出：导出增事件（0 漏口径）→ exit 1', () => {
  const wd = tempDir()
  assert.equal(run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd]).status, 0)
  const tampered = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rooms: Record<string, { messages: unknown[] }> }
  tampered.rooms['!roomNoName:localhost']?.messages.push({ eventId: '$ghost-added', type: 'm.room.message', ts: 1794010000000, sender: '@lead:localhost', body: '导出后新增（未迁移）', msgtype: 'm.text', mentions: [] })
  const tamperedPath = path.join(wd, 'tampered-export.json')
  writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2))
  const diffed = run(DIFF, ['--export', tamperedPath, '--report', path.join(wd, 'migrate-report.json'), '--db', path.join(wd, 'chatd.sqlite'), '--quiet'])
  assert.equal(diffed.status, 1, '导出事件未迁移未登记=漏，应 exit 1')
  assert.equal((lastJson(diffed.stdout) as { gaps: number })['gaps'], 1)
  assert.ok((lastJson(diffed.stdout) as { gapKinds: string[] })['gapKinds'].includes('export-unaccounted'))
})

test('E) gap 检出：报告掺假事件（missed+plan-foreign）→ exit 1', () => {
  const wd = tempDir()
  assert.equal(run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd]).status, 0)
  const report = JSON.parse(readFileSync(path.join(wd, 'migrate-report.json'), 'utf8')) as { messages: { eventId: string; roomId: string; chatdRoomId: string; actor: string; ts: number; status: string; messageId: string | null }[] }
  report.messages.push({ eventId: '$ghost-in-report', roomId: '!roomOps:localhost', chatdRoomId: report.messages[0]?.chatdRoomId ?? '', actor: 'lead', ts: 1, status: 'sent', messageId: null })
  const tamperedReport = path.join(wd, 'tampered-report.json')
  writeFileSync(tamperedReport, JSON.stringify(report, null, 2))
  const diffed = run(DIFF, ['--export', FIXTURE, '--report', tamperedReport, '--db', path.join(wd, 'chatd.sqlite'), '--quiet'])
  assert.equal(diffed.status, 1)
  const kinds = (lastJson(diffed.stdout) as { gapKinds: string[] })['gapKinds']
  assert.ok(kinds.includes('plan-foreign') && kinds.includes('missed'), `应含 plan-foreign+missed：${JSON.stringify(kinds)}`)
})

test('E) diff 纯函数负对照：duplicate/sender/time/unexpected 全检出', () => {
  const wd = tempDir()
  assert.equal(run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd]).status, 0)
  const report = loadMigrateReport(path.join(wd, 'migrate-report.json'))
  const live = readChatdDb(path.join(wd, 'chatd.sqlite'))
  const exported = parseMatrixExport(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  const opsRoom = report.rooms.find((r) => r.matrixRoomId === '!roomOps:localhost')
  assert.ok(opsRoom !== undefined)
  const opsBodies = live.messages.filter((m) => m.chatdRoomId === opsRoom.chatdRoomId).map((m) => m.body)
  const ev1Body = opsBodies.find((b) => parseTag(b)?.eventId === '$ev1')
  assert.ok(ev1Body !== undefined)
  const driftLive = {
    rooms: live.rooms,
    messages: [
      // 摘除原 $ev2（换下方时间漂移版本），其余原样
      ...live.messages.filter((m) => !(m.chatdRoomId === opsRoom.chatdRoomId && parseTag(m.body)?.eventId === '$ev2')),
      { chatdRoomId: opsRoom.chatdRoomId, body: ev1Body, senderId: 'lead' }, // $ev1 二次出现 → duplicate
      { chatdRoomId: opsRoom.chatdRoomId, body: '[mx:$ev2@999] 时间被篡改', senderId: 'lead' }, // 唯一副本 ts 漂移 → time-range-mismatch
      { chatdRoomId: opsRoom.chatdRoomId, body: '[mx:$ev3@1793729500000] 发送者被篡改', senderId: 'intruder' }, // → sender-mismatch
      { chatdRoomId: opsRoom.chatdRoomId, body: '[mx:$unknown@1] 计划外标签', senderId: 'lead' }, // → unexpected
    ],
    cappedRooms: new Set<string>(),
  }
  const diff = diffExportVsChatd(exported, report, driftLive, 'db')
  assert.equal(diff.ok, false)
  const kinds = new Set(diff.gaps.map((g) => g.kind))
  assert.ok(kinds.has('duplicate'), `应检出 duplicate：${JSON.stringify([...kinds])}`)
  assert.ok(kinds.has('time-range-mismatch'), `应检出 time-range-mismatch：${JSON.stringify([...kinds])}`)
  assert.ok(kinds.has('sender-mismatch'), '应检出 sender-mismatch')
  assert.ok(kinds.has('unexpected'), '应检出 unexpected（计划外标签）')
})

test('F) socket 在线对账（Transport v1 + token）', async () => {
  const wd = tempDir()
  assert.equal(run(MIGRATE, ['--export', FIXTURE, '--actors', ACTORS, '--workdir', wd]).status, 0)
  const handle = await startTempChatd(wd) // 同一 SQLite 上重启（hydrate）；token 落 wd/chatd.token
  try {
    const token = readFileSync(path.join(wd, 'chatd.token'), 'utf8').trim()
    const diffed = run(DIFF, ['--export', FIXTURE, '--report', path.join(wd, 'migrate-report.json'), '--socket', handle.socketPath, '--token', token, '--quiet'])
    assert.equal(diffed.status, 0, `socket 对账应 exit 0：${diffed.stdout.slice(-400)}`)
    assert.equal((lastJson(diffed.stdout) as { tagged: number })['tagged'], 6)
  } finally {
    await handle.stop()
  }
})

/* 防呆：fixture 存在性（缺失=测试资产损坏，fail loud） */
test('fixture 资产在位', () => {
  assert.ok(existsSync(FIXTURE) && existsSync(ACTORS))
})

/* ------------------------------------------------------------------ */
/* G) 真实 Matrix 导出（env 门，默认 skip——AGENTS §五.6 路径/凭据不入仓） */
/* ------------------------------------------------------------------ */

const REAL = process.env['MATRIX_REAL_EXPORT'] === '1'
const REAL_SKIP_REASON = '未设 MATRIX_REAL_EXPORT=1（真实导出 env 门，默认 skip）'
test('G) 真实 Matrix 导出→迁移→对账（env 门）', { skip: REAL ? false : REAL_SKIP_REASON }, async () => {
  const homeserver = process.env['MATRIX_HOMESERVER'] ?? ''
  const user = process.env['MATRIX_BOT_USER'] ?? ''
  const password = process.env['MATRIX_BOT_PASSWORD'] ?? ''
  assert.ok(homeserver !== '' && user !== '' && password !== '', '需 MATRIX_HOMESERVER/MATRIX_BOT_USER/MATRIX_BOT_PASSWORD')
  const wd = tempDir()
  const exportPath = path.join(wd, 'real-export.json')
  const manifestPath = `${exportPath}.manifest.json`
  const exported = run(EXPORT_CLI, ['--homeserver', homeserver, '--user', user, '--out', exportPath, '--manifest', manifestPath])
  assert.equal(exported.status, 0, `真实导出应 exit 0：${exported.stdout.slice(-400)}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { roomCount: number; messageCount: number; exportSha256: string; timeRange: { minTs: number | null; maxTs: number | null } }
  assert.ok(manifest.roomCount > 0 && manifest.messageCount >= 0)
  assert.ok(manifest.timeRange.minTs !== null && manifest.timeRange.maxTs !== null)
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(manifest.exportSha256))
  // manifest sha256 自证（与导出器同算法重算）
  const { createHash } = await import('node:crypto')
  const recomputed = `sha256:${createHash('sha256').update(readFileSync(exportPath, 'utf8'), 'utf8').digest('hex')}`
  assert.equal(recomputed, manifest.exportSha256, 'manifest.exportSha256 应与导出文件重算一致')

  const run1 = path.join(wd, 'run1')
  const migrated = run(MIGRATE, ['--export', exportPath, '--workdir', run1])
  assert.equal(migrated.status, 0, `真实迁移应 exit 0：${migrated.stdout.slice(-400)}`)
  const diffed = run(DIFF, ['--export', exportPath, '--report', path.join(run1, 'migrate-report.json'), '--db', path.join(run1, 'chatd.sqlite'), '--quiet'])
  assert.equal(diffed.status, 0, `真实对账应 0 差异：${diffed.stdout.slice(-400)}`)
  const remigrated = run(MIGRATE, ['--export', exportPath, '--workdir', run1])
  assert.equal(remigrated.status, 0)
  const second = lastJson(remigrated.stdout) as { messages: { sent: number } }
  assert.equal(second.messages.sent, 0, '复跑零新增（幂等）')
})
