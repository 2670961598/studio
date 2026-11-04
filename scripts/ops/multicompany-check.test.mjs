/** multicompy-check.test —— 787 多公司配置校验（node:test；fixtures 真文件，零网络） */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { checkCompany, parseFlatYaml, parseRegistryYaml } from './multicompany-check.mjs'
import { checkCompanySeatbeltWriteRoots } from '../../apps/daemon/src/assembly/serve/config.ts'

const HERE = import.meta.dirname
const CLI = path.join(HERE, 'multicompany-check.mjs')
const roots = []
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function tempRoot() { const d = mkdtempSync(path.join(tmpdir(), 'sn-multicompany-check-')); roots.push(d); return d }
function run(args, env = {}) {
  try { return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }), stderr: '' } }
  catch (err) { return { status: typeof err.status === 'number' ? err.status : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') } }
}

function goodCompany(workRoot, slug = 'demo', port = 8793) {
  const root = path.join(workRoot, slug)
  const companyDir = path.join(root, 'company')
  for (const d of [companyDir, path.join(root, 'credentials'), path.join(root, 'ops'), path.join(root, '.AIWS')]) mkdirSync(d, { recursive: true })
  writeFileSync(path.join(companyDir, 'daemon.yaml'), [
    `db: "${path.join(root, 'var', 'ledger.sqlite')}"`,
    'platform: localfile',
    `company: "${slug}"`,
    `companyDir: "${companyDir}"`,
    `rootDir: "${path.join(root, 'var')}"`,
    `apiPort: ${String(port)}`,
    'tickMs: 1000',
    'maxInflight: 4',
    'jobs: false',
    'seatbeltTier: workspace-write',
    `seatbeltWriteRoots: '${JSON.stringify([path.join(root, '.AIWS'), path.join(companyDir, 'workspaces'), path.join(process.env.HOME ?? '/tmp', '.dsh'), '/private/tmp', '/private/var/folders'])}'`,
    `seatbeltAuthorization: '制作人批准（测试夹具）'`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(path.join(root, 'credentials', 'daemon.env'), 'TAIGA_PASSWORD=fixture-not-a-secret\n', { encoding: 'utf8', mode: 0o600 })
  chmodSync(path.join(root, 'credentials', 'daemon.env'), 0o600)
  writeFileSync(path.join(root, 'ops', 'start.sh'), '#!/bin/bash\nexit 0\n', { encoding: 'utf8', mode: 0o700 })
  // v4：嵌套布局探测标记（dirname(companyDir)/daemon.yaml 存在→companyRoot=dirname(companyDir)）
  writeFileSync(path.join(root, 'daemon.yaml'), '# nested marker\n', 'utf8')
  return { slug, root, companyDir }
}

function writeGuardian(dir, slug, envFile, extraEnv = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `guardian-${slug}.json`), JSON.stringify({
    daemon: { command: ['/bin/true'], cwd: '/tmp', envFile, env: { PATH: '/usr/bin:/bin', ...extraEnv } },
    health: { url: 'http://127.0.0.1:8793/healthz' }, paths: { logDir: '/tmp' },
  }, null, 2) + '\n', 'utf8')
}

function writeRegistry(workRoot, companies) {
  const lines = ['companies:']
  for (const c of companies) {
    lines.push(`  - slug: ${c.slug}`)
    lines.push(`    level: 3`)
    lines.push(`    root: ${c.root}`)
    lines.push(`    company_dir: ${c.companyDir}`)
    lines.push(`    api_port: ${String(c.apiPort ?? 8793)}`)
    lines.push(`    panel_port: null`)
    lines.push(`    guardian_label: ${c.label ?? `io.studionext.${c.slug}`}`)
    lines.push(`    status: ${c.status ?? 'active'}`)
  }
  const file = path.join(workRoot, 'registry.yaml')
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
  return file
}

test('PASS：每公司 seatbelt 本公司根、daemon.env 0600、guardian envFile、label/port 唯一', () => {
  const workRoot = tempRoot(); const guardianDir = path.join(workRoot, 'guardian-conf')
  const c = goodCompany(workRoot, 'demo', 8793)
  writeGuardian(guardianDir, 'demo', path.join(c.root, 'credentials', 'daemon.env'))
  const registry = writeRegistry(workRoot, [{ ...c, apiPort: 8793 }])
  const r = run(['--registry', registry, '--work-root', workRoot, '--guardian-dir', guardianDir, '--strict-paths', '--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.stdout).ok, true)
})

test('违例：maxInflight>4 / 全局 .AIWS 写根 / inline secret / envFile 0644 / 端口重复', () => {
  const workRoot = tempRoot(); const guardianDir = path.join(workRoot, 'guardian-conf')
  const c = goodCompany(workRoot, 'demo', 8793)
  const envFile = path.join(c.root, 'credentials', 'daemon.env')
  writeGuardian(guardianDir, 'demo', envFile, { TAIGA_PASSWORD: 'inline-leak' })
  chmodSync(envFile, 0o644)
  const daemon = path.join(c.companyDir, 'daemon.yaml')
  let text = readFileSync(daemon, 'utf8')
  text = text.replace('maxInflight: 4', 'maxInflight: 50')
  symlinkSync('/usr/local', path.join(c.root, 'link'))
  text = text.replace(/seatbeltWriteRoots: '.*'/, `seatbeltWriteRoots: '${JSON.stringify([path.join(c.root, 'link')])}'`)
  writeFileSync(daemon, text, 'utf8')
  // 第二家公司与 demo 端口/label 冲突
  const c2 = goodCompany(workRoot, 'demo2', 8793)
  writeGuardian(guardianDir, 'demo2', path.join(c2.root, 'credentials', 'daemon.env'))
  const registry = writeRegistry(workRoot, [{ ...c, apiPort: 8793 }, { ...c2, apiPort: 8793, label: 'io.studionext.demo' }])
  const r = run(['--registry', registry, '--work-root', workRoot, '--guardian-dir', guardianDir, '--strict-paths', '--json'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const rules = JSON.parse(r.stdout).violations.map((v) => v.rule)
  for (const expected of ['capacity/maxInflight', 'seatbelt/root-whitelist', 'credentials/inline-secret', 'credentials/mode', 'registry/duplicate-port', 'registry/duplicate-label']) {
    assert.ok(rules.includes(expected), `缺 ${expected}：${rules.join(',')}`)
  }
})

test('parseRegistryYaml/parseFlatYaml/checkCompany 纯面', () => {
  assert.deepEqual(parseRegistryYaml('companies:\n  - slug: a\n    api_port: 8793\n').map((c) => c.slug), ['a'])
  assert.deepEqual(parseFlatYaml('company: demo\nmaxInflight: 4\n').maxInflight, '4')
  const workRoot = tempRoot(); const c = goodCompany(workRoot, 'demo', 8793); const guardianDir = path.join(workRoot, 'gc')
  writeGuardian(guardianDir, 'demo', path.join(c.root, 'credentials', 'daemon.env'))
  assert.deepEqual(checkCompany({ company: { slug: 'demo', root: c.root, company_dir: c.companyDir, api_port: 8793, guardian_label: 'io.studionext.demo', status: 'active' }, workRoot, guardianDir, strictPaths: true }), [])
  // synthetic（非 /tmp 基础设施白名单）公司树：全局 .AIWS/兄弟公司/segment 过宽 → 同源校验拒
  const synthetic = checkCompanySeatbeltWriteRoots(
    { tier: 'workspace-write', authorization: 'x', writeRoots: ['/srv/787-work/.AIWS', '/srv/787-work/other/.AIWS', '/srv/787-work/demo/company/docs/.AIWS', '/srv/787-work/demo/x/workspaces/y'] },
    '/srv/787-work/demo/company',
  )
  assert.deepEqual(synthetic.map((v) => v.reason), ['cross-company', 'cross-company', 'not-whitelisted', 'not-whitelisted'])
})

test('F1/F2：symlink 越界（link→/etc）与 segment 过宽（docs/.AIWS、x/workspaces/y）→ 同源校验拒', () => {
  const workRoot = tempRoot(); const guardianDir = path.join(workRoot, 'guardian-conf')
  const c = goodCompany(workRoot, 'demo', 8793)
  writeGuardian(guardianDir, 'demo', path.join(c.root, 'credentials', 'daemon.env'))
  // link→/etc（真实 symlink）
  symlinkSync('/etc', path.join(c.root, 'link'))
  const daemon = path.join(c.companyDir, 'daemon.yaml')
  const original = readFileSync(daemon, 'utf8')
  // CLI 面：symlink→/etc 越界（真实 symlink；realpath 诊断可见）
  writeFileSync(daemon, original.replace(/seatbeltWriteRoots: '.*'/, `seatbeltWriteRoots: '${JSON.stringify([path.join(c.root, 'link', '.AIWS')])}'`), 'utf8')
  const registry = writeRegistry(workRoot, [{ ...c, apiPort: 8793 }])
  const r = run(['--registry', registry, '--work-root', workRoot, '--guardian-dir', guardianDir, '--strict-paths', '--json'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const parsedOut = JSON.parse(r.stdout)
  assert.ok(parsedOut.violations.some((v) => v.rule === 'seatbelt/root-whitelist'), `缺 seatbelt 违例：${parsedOut.violations.map((v) => v.rule).join(',')}`)
  assert.ok(parsedOut.violations.some((v) => String(v.problem).includes('realpath=')), '错误应含 realpath')
  // F2 segment 过宽：与 daemon 启动面同一函数（synthetic 非 infra 公司树）
  const segment = checkCompanySeatbeltWriteRoots(
    { tier: 'workspace-write', authorization: 'x', writeRoots: ['/srv/787-work/demo/company/docs/.AIWS', '/srv/787-work/demo/x/workspaces/y'] },
    '/srv/787-work/demo/company',
  )
  assert.deepEqual(segment.map((v) => v.reason), ['not-whitelisted', 'not-whitelisted'])
})

test('v4：扁平布局（profit）— companyDir 本身=公司根：合法 <companyDir>/.AIWS 通过；全局 <WORKROOT>/.AIWS 拒', () => {
  const workRoot = tempRoot(); const guardianDir = path.join(workRoot, 'guardian-conf')
  const root = path.join(workRoot, 'studio-profit')
  for (const d of [root, path.join(root, 'credentials'), path.join(root, 'ops'), path.join(root, '.AIWS')]) mkdirSync(d, { recursive: true })
  const daemon = path.join(root, 'daemon.yaml')
  const writeYaml = (roots) => writeFileSync(daemon, [
    `db: "${path.join(root, 'var', 'ledger.sqlite')}"`, 'platform: localfile', 'company: studio-profit', `companyDir: "${root}"`,
    `rootDir: "${path.join(root, 'var')}"`, 'apiPort: 8792', 'maxInflight: 4', 'jobs: false', 'seatbeltTier: workspace-write',
    `seatbeltWriteRoots: '${JSON.stringify(roots)}'`, "seatbeltAuthorization: 'producer approved'",
  ].join('\n') + '\n', 'utf8')
  writeYaml([path.join(root, '.AIWS')])
  writeFileSync(path.join(root, 'credentials', 'daemon.env'), 'TAIGA_PASSWORD=fixture\n', { mode: 0o600 }); chmodSync(path.join(root, 'credentials', 'daemon.env'), 0o600)
  writeFileSync(path.join(root, 'ops', 'start.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o700 })
  writeGuardian(guardianDir, 'studio-profit', path.join(root, 'credentials', 'daemon.env'))
  const registry = writeRegistry(workRoot, [{ slug: 'studio-profit', root, companyDir: root, apiPort: 8792, label: 'io.studionext.profit' }])
  const ok = run(['--registry', registry, '--work-root', workRoot, '--guardian-dir', guardianDir, '--strict-paths', '--json'])
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  // profit 旧全局根：<WORKROOT>/.AIWS → cross-company 拒
  writeYaml([path.join(workRoot, '.AIWS')])
  const bad = run(['--registry', registry, '--work-root', workRoot, '--guardian-dir', guardianDir, '--strict-paths', '--json'])
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.ok(JSON.parse(bad.stdout).violations.some((v) => v.rule === 'seatbelt/cross-company'), bad.stdout)
})
