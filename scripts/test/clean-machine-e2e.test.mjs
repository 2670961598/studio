/** clean-machine-e2e.test —— M5-4b E2E 器参数/布局/断言纯函数（node:test；零真流程——真 E2E 手工跑，见 --help 步骤） */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import {
  BACKUP_ARTIFACT_PREFIXES,
  DAEMON_YAML_ALLOWED_KEYS,
  UNIX_SOCKET_BUDGET,
  e2eLayout,
  evaluateBackupSummary,
  evaluateStatusRows,
  extractLastJson,
  parseArgs,
  parseFlatYamlKeys,
  renderMinimalDaemonYaml,
  scanReadyLine,
  socketBudgetFor,
  usageText,
  validateDistPath,
} from '../ops/clean-machine-e2e.mjs'

const roots = []
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function tempRoot() {
  const d = mkdtempSync(path.join(tmpdir(), 'sn-clean-e2e-test-'))
  roots.push(d)
  return d
}

/* ---------------- 参数 ---------------- */

test('parseArgs：--dist 两形必填可缺（缺=校验面报）；--keep/--node/--slug/--port/--json/--help；未知即抛', () => {
  assert.deepEqual(parseArgs([]), { dist: '', keep: false, node: process.execPath, slug: 'clean-e2e-corp', port: 0, json: false, help: false })
  assert.deepEqual(parseArgs(['--dist', '/tmp/a.tgz', '--keep']), { dist: '/tmp/a.tgz', keep: true, node: process.execPath, slug: 'clean-e2e-corp', port: 0, json: false, help: false })
  assert.equal(parseArgs(['--dist=/tmp/a.tgz']).dist, '/tmp/a.tgz')
  assert.equal(parseArgs(['--node', '/opt/node']).node, '/opt/node')
  assert.equal(parseArgs(['--slug=acme']).slug, 'acme')
  assert.equal(parseArgs(['--port', '9788']).port, 9788)
  assert.equal(parseArgs(['--json', '--help']).help, true)
  assert.throws(() => parseArgs(['--dist']), /缺值/)
  assert.throws(() => parseArgs(['--dist', '--keep']), /缺值/)
  assert.throws(() => parseArgs(['--wat']), /未知参数/)
  assert.throws(() => parseArgs(['--port', '0']), /端口号/)
  assert.throws(() => parseArgs(['--port', '99999']), /端口号/)
  assert.throws(() => parseArgs(['--port', 'abc']), /端口号/)
  assert.throws(() => parseArgs(['--slug', 'Bad Slug']), /slug/)
})

test('validateDistPath：缺参/后缀/不存在/非常规文件逐条报', () => {
  assert.deepEqual(validateDistPath(''), ['缺少 --dist <tarball>（pack-dist 产物 .tgz）'])
  assert.ok(validateDistPath('/tmp/a.zip').some((i) => i.includes('.tgz')))
  assert.ok(validateDistPath('/tmp/nope.tgz').some((i) => i.includes('不存在')))
  const root = tempRoot()
  const tgz = path.join(root, 'x.tgz')
  writeFileSync(tgz, 'data')
  assert.deepEqual(validateDistPath(tgz), [])
  assert.ok(validateDistPath(root).some((i) => i.includes('非常规文件')))
})

test('usageText：手工步骤面（pack-dist→解包→create→daemon.yaml→run→端点→备份→SIGTERM→重启）', () => {
  const text = usageText()
  for (const needle of ['--dist <tgz>', 'pack-dist.mjs', 'company-2-level', 'jobs: false', 'stack run', 'platform-backup.sh --skip-docker', 'kill -TERM', 'READY']) {
    assert.ok(text.includes(needle), needle)
  }
})

/* ---------------- 布局 ---------------- */

test('e2eLayout：备份三面同构（company/platform/ledger.sqlite 同根）＋chatd 面在公司 git 目录 var/workbench', () => {
  const l = e2eLayout('/tmp/e2e', 'acme')
  assert.equal(l.companyRoot, path.join('/tmp/e2e', 'acme'))
  assert.equal(l.companyDir, path.join(l.companyRoot, 'company'))
  assert.equal(l.platformDir, path.join(l.companyRoot, 'platform'))
  assert.equal(l.ledgerPath, path.join(l.companyRoot, 'ledger.sqlite'))
  assert.equal(l.configPath, path.join(l.companyRoot, 'var', 'daemon.yaml'))
  assert.equal(l.chatdDb, path.join(l.companyDir, 'var', 'workbench', 'chat.db'))
  assert.equal(l.chatdToken, path.join(l.companyDir, 'var', 'workbench', 'chatd.token'))
  assert.equal(l.tree, path.join('/tmp/e2e', 'tree'))
  assert.equal(l.home, path.join('/tmp/e2e', 'home'))
  assert.equal(l.backupDir, path.join('/tmp/e2e', 'backups'))
})

/* ---------------- daemon.yaml ---------------- */

test('renderMinimalDaemonYaml：键集恰为允许面、jobs: false 落、路径带引号壳、apiPort 钉', () => {
  const text = renderMinimalDaemonYaml({ dbPath: '/tmp/e2e/acme/ledger.sqlite', slug: 'acme', companyDir: '/tmp/e2e/acme/company', rootDir: '/tmp/e2e/acme', platformDir: '/tmp/e2e/acme/platform', apiPort: 9788 })
  assert.deepEqual(parseFlatYamlKeys(text), [...DAEMON_YAML_ALLOWED_KEYS])
  assert.ok(/^jobs: false$/m.test(text))
  assert.ok(/^apiPort: 9788$/m.test(text))
  assert.ok(text.includes('platform: localfile'))
  assert.ok(text.includes(`db: ${JSON.stringify('/tmp/e2e/acme/ledger.sqlite')}`))
  assert.ok(text.includes('装配与端点')) // 限制注释（不验真实派工）
})

test('parseFlatYamlKeys：跳过注释/空行；# 行内注释行不误收', () => {
  assert.deepEqual(parseFlatYamlKeys('# 头注\n\na: 1\nb: "x y"\n  # 缩进注释\n#jobs: true\njobs: false\n'), ['a', 'b', 'jobs'])
})

/* ---------------- READY 扫描 ---------------- */

test('scanReadyLine：READY 双 pid / chatd=off / 无 READY / 噪声中命中', () => {
  assert.deepEqual(scanReadyLine('plan…\nREADY daemon=123 chatd=456\n后继行'), { daemonPid: 123, chatdPid: 456 })
  assert.deepEqual(scanReadyLine('READY daemon=7 chatd=off'), { daemonPid: 7, chatdPid: null })
  assert.equal(scanReadyLine('NOT READY daemon=1 chatd=2'), null)
  assert.equal(scanReadyLine('READY daemon=abc chatd=2'), null)
  assert.equal(scanReadyLine(''), null)
})

/* ---------------- stack status 判定 ---------------- */

function statusJson(states) {
  return { command: 'stack status', rows: ['daemon', 'chatd', 'panel'].map((id) => ({ id, target: `${id}-t`, state: states[id] ?? 'up', detail: '' })), failed: 0, skipped: 0 }
}

test('evaluateStatusRows：daemon∧chatd up＝ok（panel down=run 面预期不判负）', () => {
  const v = evaluateStatusRows(statusJson({ panel: 'down' }))
  assert.equal(v.ok, true)
  assert.ok(v.reason.includes('panel=down'))
})

test('evaluateStatusRows：daemon/chatd 非 up＝不 ok；chatd skipped 同罪（给了 --company-dir 还 skip=探针缩水）', () => {
  assert.equal(evaluateStatusRows(statusJson({ daemon: 'down' })).ok, false)
  assert.equal(evaluateStatusRows(statusJson({ chatd: 'down' })).ok, false)
  const skipped = evaluateStatusRows(statusJson({ chatd: 'skipped' }))
  assert.equal(skipped.ok, false)
})

test('evaluateStatusRows：panel 行缺席（探测面缩水）＝不 ok；非对象＝不 ok', () => {
  const shrunk = statusJson({})
  shrunk.rows = shrunk.rows.filter((r) => r.id !== 'panel')
  assert.equal(evaluateStatusRows(shrunk).ok, false)
  assert.equal(evaluateStatusRows(null).ok, false)
  assert.equal(evaluateStatusRows({ rows: 'nope' }).ok, false)
})

/* ---------------- 备份 SUMMARY 判定 ---------------- */

function summaryJson(over = {}) {
  return { ok: true, ts: 't', backupDir: '/b', docker: { skipped: true, reason: 'explicit-skip', sections: ['taiga', 'matrix', 'matrix-config'] }, chatd: { backed: 1, skipped: 0 }, core: { backed: 3, skipped: 0 }, retentionDeleted: 0, durationMs: 1, ...over }
}

test('evaluateBackupSummary：ok＋docker skipped＋core=3＋chatd≥1＝ok', () => {
  const v = evaluateBackupSummary(summaryJson())
  assert.equal(v.ok, true)
  assert.ok(v.reason.includes('core=3'))
})

test('evaluateBackupSummary：ok=false／docker 未 skip／core≠3／chatd=0 逐面拒', () => {
  assert.equal(evaluateBackupSummary(summaryJson({ ok: false })).ok, false)
  assert.equal(evaluateBackupSummary(summaryJson({ docker: { skipped: false } })).ok, false)
  assert.equal(evaluateBackupSummary(summaryJson({ core: { backed: 2, skipped: 1 } })).ok, false)
  assert.equal(evaluateBackupSummary(summaryJson({ chatd: { backed: 0, skipped: 1 } })).ok, false)
  assert.equal(evaluateBackupSummary(null).ok, false)
})

test('BACKUP_ARTIFACT_PREFIXES：core 三面＋chatd 恰四类（platform-backup.sh 产物面）', () => {
  assert.deepEqual([...BACKUP_ARTIFACT_PREFIXES], ['core-platform-', 'core-ledger-', 'core-company-', 'chatd-'])
})

/* ---------------- 输出尾部 JSON 提取 ---------------- */

test('extractLastJson：pretty 多行对象（stack status --json）整块取；内缩进行不误当头', () => {
  const pretty = '标题行\n{\n  "rows": [\n    { "id": "daemon", "state": "up" }\n  ],\n  "failed": 0\n}\n'
  const parsed = extractLastJson(pretty)
  assert.equal(parsed.failed, 0)
  assert.equal(parsed.rows[0].id, 'daemon')
})

test('extractLastJson：单行 JSON（SUMMARY 尾行）与噪声后尾块；不可解析=null', () => {
  assert.equal(extractLastJson('进度行\n{"ok":true,"core":{"backed":3}}').ok, true)
  assert.equal(extractLastJson('{"a":1}').a, 1)
  assert.equal(extractLastJson(''), null)
  assert.equal(extractLastJson('纯文本无 JSON'), null)
  assert.equal(extractLastJson('碎块 {"a":'), null)
})

/* ---------------- socket 长度预算 ---------------- */

test('socketBudgetFor：/tmp 短基过预算；/var/folders 长基超限（macOS sun_path=104 判例）', () => {
  const short = socketBudgetFor('/tmp', 'clean-e2e-corp')
  assert.equal(short.ok, true)
  assert.ok(short.len <= UNIX_SOCKET_BUDGET)
  const long = socketBudgetFor('/var/folders/gz/ys8vlc1951xgg1v1_7tmnrlc0000gn/T', 'clean-e2e-corp')
  assert.equal(long.ok, false)
  assert.ok(long.len > UNIX_SOCKET_BUDGET)
})
