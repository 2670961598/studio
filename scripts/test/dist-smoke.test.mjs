/** dist-smoke.test —— M5-3a 烟测器参数/路径校验与 doctor 判定纯函数（node:test；零真解包） */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { ALLOWED_FAIL_IDS, REQUIRED_PASS_IDS, companyLayout, evaluateDoctorResult, parseArgs, usageText, validateTarballPath } from '../ops/dist-smoke.mjs'

const roots = []
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function tempRoot() {
  const d = mkdtempSync(path.join(tmpdir(), 'sn-dist-smoke-test-'))
  roots.push(d)
  return d
}

/* ---------------- 参数 ---------------- */

test('parseArgs：位置参数=tarball；--keep/--node 两形/--json/--help；未知即抛', () => {
  assert.deepEqual(parseArgs(['/tmp/a.tgz']), { tarball: '/tmp/a.tgz', keep: false, node: process.execPath, json: false, help: false })
  assert.deepEqual(parseArgs(['/tmp/a.tgz', '--keep', '--node', '/usr/local/bin/node']), { tarball: '/tmp/a.tgz', keep: true, node: '/usr/local/bin/node', json: false, help: false })
  assert.equal(parseArgs(['--node=/opt/node']).node, '/opt/node')
  assert.equal(parseArgs(['--help']).help, true)
  assert.throws(() => parseArgs(['--node']), /缺值/)
  assert.throws(() => parseArgs(['--wat']), /未知参数/)
  assert.throws(() => parseArgs(['/tmp/a.tgz', 'extra.tgz']), /多余的位置参数/)
  assert.ok(usageText().includes('<tarball.tgz>'))
})

/* ---------------- 路径校验 ---------------- */

test('validateTarballPath：缺参/后缀/不存在/非常规文件逐条报', () => {
  assert.deepEqual(validateTarballPath(''), ['缺少 <tarball> 位置参数'])
  assert.ok(validateTarballPath('/tmp/nope.tgz').some((i) => i.includes('不存在')))
  assert.ok(validateTarballPath('/tmp/a.zip').some((i) => i.includes('.tgz')))
  const root = tempRoot()
  const tgz = path.join(root, 'x.tgz')
  writeFileSync(tgz, 'data')
  assert.deepEqual(validateTarballPath(tgz), [])
  assert.ok(validateTarballPath(root).some((i) => i.includes('非常规文件')))
  assert.ok(statSync(tgz).isFile())
})

test('companyLayout：<work>/<slug> 公司目录＋<work>/var/daemon.yaml 配置位', () => {
  const layout = companyLayout('/tmp/co', 'smoke-corp')
  assert.equal(layout.companyDir, path.join('/tmp/co', 'smoke-corp'))
  assert.equal(layout.configPath, path.join('/tmp/co', 'var', 'daemon.yaml'))
})

/* ---------------- doctor 判定 ---------------- */

function doctorJson(states) {
  return { command: 'stack doctor', checks: REQUIRED_PASS_IDS.concat(ALLOWED_FAIL_IDS).map((id) => ({ id, name: id, ok: states[id] ?? true, detail: '', hint: undefined })), pass: true, failed: 0 }
}

test('evaluateDoctorResult：五项必绿全过（含 chatd 红）＝ok', () => {
  const verdict = evaluateDoctorResult(doctorJson({ 'chatd-perms': false }))
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.redIds, ['chatd-perms'])
  assert.deepEqual(verdict.missingIds, [])
  assert.deepEqual(verdict.extraRedIds, [])
})

test('evaluateDoctorResult：任一必绿项红＝不 ok', () => {
  for (const id of REQUIRED_PASS_IDS) {
    const verdict = evaluateDoctorResult(doctorJson({ [id]: false }))
    assert.equal(verdict.ok, false, id)
    assert.ok(verdict.extraRedIds.includes(id), id)
  }
})

test('evaluateDoctorResult：必绿 id 缺席（体检面缩水）＝不 ok 且点名缺失', () => {
  const full = doctorJson({})
  const shrunk = { ...full, checks: full.checks.filter((c) => c.id !== 'daemon-yaml') }
  const verdict = evaluateDoctorResult(shrunk)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.missingIds, ['daemon-yaml'])
})

test('evaluateDoctorResult：允许面之外的未知红项＝不 ok；非对象输入＝不 ok', () => {
  const withGhost = { ...doctorJson({}), checks: [...doctorJson({}).checks, { id: 'ghost', name: 'ghost', ok: false, detail: '', hint: undefined }] }
  const verdict = evaluateDoctorResult(withGhost)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.extraRedIds, ['ghost'])
  assert.equal(evaluateDoctorResult(null).ok, false)
  assert.equal(evaluateDoctorResult({ checks: 'nope' }).ok, false)
  assert.ok(evaluateDoctorResult({ checks: [] }).missingIds.length === REQUIRED_PASS_IDS.length)
})

test('REQUIRED/ALLOWED 集合恰为 doctor 六项的分划（M5-1 §7.3 面）', () => {
  assert.deepEqual([...REQUIRED_PASS_IDS].sort(), ['backup-dir', 'company-dir', 'daemon-yaml', 'disk-free', 'node'])
  assert.deepEqual(ALLOWED_FAIL_IDS, ['chatd-perms'])
  assert.equal(REQUIRED_PASS_IDS.length + ALLOWED_FAIL_IDS.length, 6)
})
