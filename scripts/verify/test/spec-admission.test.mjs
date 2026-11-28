/**
 * spec-admission.test.mjs —— 规范效力与部署准入门禁自测（GOV-01 / task-160）
 *
 * 覆盖：
 *   1) 合法合成样本 PASS + 本仓真实样本 PASS；
 *   2) 三类矛盾各 FAIL（records 权威矛盾、final/draft 冲突、已落/未落矛盾，表级＋文档级）；
 *   3) 部署指纹闭环（commit/tree 与 git rev-parse、git 不可用 fail-closed、configDigest/yaml sha、
 *      contract/lockfile/schema/Node 缺失或漂移、agy.status=production 联动）；
 *   4) 伪证据（SPEC-HR-GATE / partial 指向不存在文件或错误目录声明 FAIL）；
 *   5) enforce 前置绕过（通用/暂缓豁免不可替代具名 enforcementApproval；有批准 PASS、无批准 FAIL）；
 *   6) 软链入口绕过（经 /tmp 软链调用且缺表必须 exit 1 + MISSING_TABLE，不得 exit 0 零输出）；
 *   7) 豁免过期与缺字段、三表不一致、缺表/非法 JSON、CLI `--json` 输出校验。
 *
 * 零第三方依赖（node:test + node:assert/strict）；禁 skip/only/todo/retry。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { runSpecAdmission } from '../spec-admission.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const SCRIPT = path.resolve(import.meta.dirname, '..', 'spec-admission.mjs')
const tempRoots = []

after(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

function writeJson(root, rel, data) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function writeText(root, rel, text) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text, 'utf8')
}

function gitIn(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

/** 构造最小合法合成仓（真实临时 git 仓 + 四表 + 桩文档 + 闭环指纹），支持 mutate 注入缺陷。 */
function makeValidFixture(mutate, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-admission-'))
  tempRoots.push(root)

  const indexContent = JSON.stringify({ schemaCount: 74, areaCount: 13 }, null, 2)
  const lockContent = 'lockfile-fixture-v1\n'
  const yamlContent = 'mode: shadow\nversion: 1\n'
  writeText(root, 'packages/contract/artifacts/index.json', indexContent)
  writeText(root, 'bun.lock', lockContent)
  writeJson(root, 'package.json', { name: 'fixture', engines: { node: '>=24' } })
  writeText(root, 'packages/store/src/mig.ts', 'export const MIGS = [{ version: 16 }, { version: 17 }]\n')
  writeText(root, 'ops/config.example.yaml', yamlContent)
  writeText(root, 'docs/spec-a.md', '# Spec A\n')
  writeText(root, 'docs/runbook.md', '# Runbook\n')
  writeText(root, 'docs/evidence.md', '# Evidence\n')
  writeText(root, 'apps/hr-gate.ts', 'export const ok = true\n')

  let rollbackCommit = '8c4d719de90f4edd9b31d1cf9426d6cfab1b2e38'
  let deployedCommit = 'ffb8c63967c26e185054c5b1f5450f0c74eff8d0'
  let treeDigest = '4732b40f370480a7abb315181f00163700ed8262'
  if (opts.initGit !== false) {
    gitIn(root, ['init', '-q'])
    gitIn(root, ['add', 'docs/spec-a.md'])
    gitIn(root, ['commit', '-q', '-m', 'base'])
    rollbackCommit = gitIn(root, ['rev-parse', 'HEAD'])
    gitIn(root, ['add', '.'])
    gitIn(root, ['commit', '-q', '-m', 'deploy-ready'])
    deployedCommit = gitIn(root, ['rev-parse', 'HEAD'])
    treeDigest = gitIn(root, ['rev-parse', `${deployedCommit}^{tree}`])
  }

  const tables = {
    spec: {
      schemaVersion: '1.0.0',
      updatedAt: '2026-11-28',
      entries: [
        {
          id: 'SPEC-RECORDS',
          title: 'DOM-05 records 为事件投影',
          status: 'final',
          versionTag: 'v2.1-final',
          authorityDoc: 'docs/spec-a.md',
          authoritySection: 'v2/05 §三 DOM-05',
          authorityRole: 'projection',
          deployEligibility: 'eligible',
        },
        {
          id: 'SPEC-HR-GATE',
          title: '任职闸门',
          status: 'final',
          versionTag: 'v2.1-final',
          authorityDoc: 'docs/spec-a.md',
          authoritySection: 'v2/02 §3.4',
          deployEligibility: 'eligible',
        },
        {
          id: 'SPEC-PARTIAL',
          title: 'V2 权责链（部分实现）',
          status: 'partial',
          versionTag: 'v2.1-final',
          authorityDoc: 'docs/spec-a.md',
          authoritySection: 'v2/11 §十五',
          deployEligibility: 'conditional',
        },
        {
          id: 'SPEC-ENU-88-AGY',
          title: '未认证执行器 agy（禁用）',
          status: 'final',
          versionTag: 'v2.1-final',
          authorityDoc: 'docs/spec-a.md',
          authoritySection: 'v2/09 ENU-88',
          deployEligibility: 'blocked',
        },
      ],
    },
    impl: {
      schemaVersion: '1.0.0',
      updatedAt: '2026-11-28',
      entries: [
        {
          specId: 'SPEC-RECORDS',
          state: 'implemented',
          recordsAuthorityModel: 'projection-of-dom03',
          evidence: { commits: [deployedCommit], files: ['docs/spec-a.md'], tests: [], note: '已落投影模型' },
        },
        {
          specId: 'SPEC-HR-GATE',
          state: 'implemented',
          evidence: { commits: [deployedCommit], files: ['apps/hr-gate.ts'], tests: ['docs/'], note: '任职闸门已落' },
        },
        {
          specId: 'SPEC-PARTIAL',
          state: 'partial',
          evidence: { commits: [deployedCommit], files: ['docs/spec-a.md'], tests: [], note: 'shadow 观察中' },
        },
        {
          specId: 'SPEC-ENU-88-AGY',
          state: 'not_implemented',
          evidence: { commits: [], files: [], tests: [], note: '未认证禁启' },
        },
      ],
    },
    deploy: {
      schemaVersion: '1.0.0',
      updatedAt: '2026-11-28',
      targetProfile: 'studio-dev',
      requiredSpecIds: ['SPEC-RECORDS', 'SPEC-HR-GATE', 'SPEC-PARTIAL'],
      fingerprints: {
        frameworkCommit: deployedCommit,
        treeDigest,
        rollbackCommit,
        nodeRuntime: { enginesRange: '>=24', productionObserved: 'v26.13.1' },
        cliAdapters: {
          dsh: { version: '0.2.0-rc.2', status: 'production' },
          kimi: { status: 'production-fallback' },
          agy: { specId: 'SPEC-ENU-88-AGY', status: 'registered-disabled', policy: '禁开生产（SPEC-ENU-88-AGY）' },
        },
        storeSchema: { currentVersion: 17, latestMigrationFile: 'packages/store/src/mig.ts' },
        contractArtifacts: {
          indexFile: 'packages/contract/artifacts/index.json',
          indexSha256: sha256(indexContent),
          schemaCount: 74,
          areaCount: 13,
        },
        lockfile: { file: 'bun.lock', sha256: sha256(lockContent) },
        configDigest: {
          policy: 'external-config-home-not-in-repo',
          productionYamlModified: false,
          yamlDigests: [{ file: 'ops/config.example.yaml', sha256: sha256(yamlContent) }],
        },
      },
      checklist: ['commit', 'node', 'cli', 'schema', 'contract', 'config', 'health', 'smoke'].map((cat, idx) => ({
        id: `CHK-${idx + 1}`,
        category: cat,
        machineCheckable: idx < 6,
        passCriteria: `${cat} ok`,
      })),
      currentDeployments: [
        {
          company: 'studio-dev',
          status: 'active',
          deployedCommit,
          treeDigest,
          rollbackCommit,
          deployedAt: '2026-11-28T09:50:00Z',
          runbookDoc: 'docs/runbook.md',
          evidenceDoc: 'docs/evidence.md',
        },
      ],
      exemptions: [
        {
          id: 'EXM-1',
          specId: 'SPEC-PARTIAL',
          reason: '暂缓 V2 enforce，先以 shadow 观察过渡',
          approver: 'producer',
          approvedAt: '2026-11-28',
          expiresAt: '2026-12-31',
        },
      ],
    },
    mig: {
      schemaVersion: '1.0.0',
      updatedAt: '2026-11-28',
      productionYamlModified: false,
      companies: [
        {
          company: 'studio-dev',
          surfaces: [
            { surface: 'v2-records', mode: 'shadow', specIds: ['SPEC-RECORDS', 'SPEC-PARTIAL'] },
            {
              surface: 'core-projection',
              mode: 'enforce',
              enforcementApproval: { ticket: 'task-158', approvedBy: 'producer', approvedAt: '2026-11-17' },
              specIds: ['SPEC-RECORDS', 'SPEC-HR-GATE'],
            },
          ],
        },
      ],
    },
  }

  if (typeof mutate === 'function') mutate(tables, root, { deployedCommit, rollbackCommit, treeDigest })

  if (tables.spec !== null) writeJson(root, 'docs/quality/governance/spec-registry.json', tables.spec)
  if (tables.impl !== null) writeJson(root, 'docs/quality/governance/implementation-registry.json', tables.impl)
  if (tables.deploy !== null) writeJson(root, 'docs/quality/governance/deployment-admission.json', tables.deploy)
  if (tables.mig !== null) writeJson(root, 'docs/quality/governance/migration-modes.json', tables.mig)

  return root
}

function runCli(args, scriptPath = SCRIPT) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    }
  }
}

test('合法合成样本 PASS（含未过期豁免、目录证据与全量闭环指纹）', () => {
  const root = makeValidFixture()
  const res = runSpecAdmission(root, { now: '2026-11-28' })
  assert.equal(res.ok, true, JSON.stringify(res.violations, null, 2))
  assert.equal(res.summary.specs, 4)
  assert.equal(res.summary.activeExemptions, 1)
})

test('本仓真实四表与文档自检 PASS（CLI --json 结构校验）', () => {
  const run = runCli(['--root', REPO_ROOT, '--now', '2026-11-28', '--json'])
  assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`)
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.asOfDate, '2026-11-28')
  assert.ok(payload.summary.specs >= 14)
  assert.equal(payload.summary.specs, payload.summary.implementations)
  assert.ok(payload.summary.checkedDocs >= 3)
  assert.deepEqual(payload.violations, [])
})

test('矛盾一/二/三（表级+文档级）：records 权威、final/draft、已落/未落均 FAIL', () => {
  const r1 = runSpecAdmission(
    makeValidFixture((t) => {
      t.spec.entries[0].authorityRole = 'fourth-source-of-truth'
      t.impl.entries[0].recordsAuthorityModel = 'authoritative-source'
      t.spec.entries[1].versionTag = 'v2.1-draft'
      t.spec.entries[2].deployEligibility = 'eligible'
      t.impl.entries[0].evidence = { commits: [], files: [], tests: [], note: '口头宣称已落' }
      t.impl.entries.push({ specId: 'SPEC-PARTIAL', state: 'not_implemented', evidence: { commits: [], files: [], tests: [], note: '冲突重复行' } })
    }),
    { now: '2026-11-28' },
  )
  assert.equal(r1.ok, false)
  const codes = new Set(r1.violations.map((v) => v.code))
  assert.ok(codes.has('RECORDS_AUTHORITY_CONFLICT'))
  assert.ok(codes.has('SPEC_FINAL_DRAFT_CONFLICT'))
  assert.ok(codes.has('IMPL_STATUS_CONFLICT'))

  const rDocs = runSpecAdmission(
    makeValidFixture((_, root) => {
      writeText(root, 'docs/17-整体技术设计.md', '重构口径＝`records` 为事实源、`events` 保留为可重建投影。\n')
      writeText(
        root,
        'docs/v2/09-技术细节-总纲与工程决策·主表总册.md',
        '# V2·09\n> 版本：v2.1-final\n> 状态：final\n\n## 四、版本表\n| v2/00 | 总纲 | — | draft | 注 |\n\n## 五、决策总表\n',
      )
      writeText(root, 'docs/quality/model-routing.md', '## 9. 实现状态\n已落：\n- A\n未落（需下一刀）：\n1. A\n')
    }),
    { now: '2026-11-28' },
  )
  assert.equal(rDocs.ok, false)
  const docCodes = new Set(rDocs.violations.map((v) => v.code))
  assert.ok(docCodes.has('DOC_RECORDS_AUTHORITY_CONFLICT'))
  assert.ok(docCodes.has('DOC_FINAL_DRAFT_CONFLICT'))
  assert.ok(docCodes.has('DOC_IMPL_STATE_CONFLICT'))
})

test('必修1a：commit/tree 指纹与 git rev-parse 闭环 + git 不可用 fail-closed', () => {
  const commitDiverge = makeValidFixture((t, _, g) => {
    t.deploy.currentDeployments[0].deployedCommit = g.rollbackCommit
  })
  const r1 = runSpecAdmission(commitDiverge, { now: '2026-11-28' })
  assert.equal(r1.ok, false)
  assert.ok(r1.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH'))

  const treeDrift = makeValidFixture((t) => {
    t.deploy.currentDeployments[0].treeDigest = '0'.repeat(40)
    t.deploy.fingerprints.treeDigest = '0'.repeat(40)
  })
  const r2 = runSpecAdmission(treeDrift, { now: '2026-11-28' })
  assert.equal(r2.ok, false)
  assert.ok(r2.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH' && v.target.includes('treeDigest')))

  const nonGitRoot = makeValidFixture(undefined, { initGit: false })
  const r3 = runSpecAdmission(nonGitRoot, { now: '2026-11-28' })
  assert.equal(r3.ok, false)
  assert.ok(r3.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH' && v.detail.includes('git')))
})

test('必修1b：configDigest.productionYamlModified 与实际 yaml sha 一致性', () => {
  const flagTrue = makeValidFixture((t) => {
    t.deploy.fingerprints.configDigest.productionYamlModified = true
  })
  const r1 = runSpecAdmission(flagTrue, { now: '2026-11-28' })
  assert.equal(r1.ok, false)
  assert.ok(r1.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH'))
  assert.ok(r1.violations.some((v) => v.code === 'THREE_TABLE_MISMATCH'))

  const yamlEdited = makeValidFixture((_, root) => {
    writeText(root, 'ops/config.example.yaml', 'mode: enforce\nversion: 2\n')
  })
  const r2 = runSpecAdmission(yamlEdited, { now: '2026-11-28' })
  assert.equal(r2.ok, false)
  assert.ok(r2.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH' && v.target === 'ops/config.example.yaml'))
})

test('必修1c：contract/lockfile/schema/Node 指纹缺失或漂移均 FAIL', () => {
  for (const key of ['contractArtifacts', 'lockfile', 'storeSchema', 'nodeRuntime', 'cliAdapters', 'configDigest']) {
    const root = makeValidFixture((t) => {
      delete t.deploy.fingerprints[key]
    })
    const res = runSpecAdmission(root, { now: '2026-11-28' })
    assert.equal(res.ok, false, `deleting fingerprints.${key} must fail`)
    assert.ok(res.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH'), `missing code for ${key}`)
  }

  const olderSchema = makeValidFixture((t) => {
    t.deploy.fingerprints.storeSchema.currentVersion = 16
  })
  const rOld = runSpecAdmission(olderSchema, { now: '2026-11-28' })
  assert.equal(rOld.ok, false)
  assert.ok(rOld.violations.some((v) => v.code === 'DEPLOY_FINGERPRINT_MISMATCH'))
})

test('必修1d：agy.status=production 未批准 FAIL；经批准且解封 PASS', () => {
  const blockedAgy = makeValidFixture((t) => {
    t.deploy.fingerprints.cliAdapters.agy.status = 'production'
  })
  const r1 = runSpecAdmission(blockedAgy, { now: '2026-11-28' })
  assert.equal(r1.ok, false)
  assert.ok(r1.violations.some((v) => v.code === 'BLOCKED_SPEC_ADMITTED'))

  const approvedAgy = makeValidFixture((t, _, g) => {
    const spec = t.spec.entries.find((e) => e.id === 'SPEC-ENU-88-AGY')
    spec.deployEligibility = 'eligible'
    const impl = t.impl.entries.find((e) => e.specId === 'SPEC-ENU-88-AGY')
    impl.state = 'implemented'
    impl.evidence = { commits: [g.deployedCommit], files: ['docs/spec-a.md'], tests: [], note: '认证通过' }
    t.deploy.requiredSpecIds.push('SPEC-ENU-88-AGY')
    t.deploy.fingerprints.cliAdapters.agy.status = 'production'
  })
  const r2 = runSpecAdmission(approvedAgy, { now: '2026-11-28' })
  assert.equal(r2.ok, true, JSON.stringify(r2.violations, null, 2))
})

test('必修2：伪证据校验（SPEC-HR-GATE / partial 证据改不存在文件必须 FAIL）', () => {
  const fakeHr = makeValidFixture((t) => {
    const hr = t.impl.entries.find((e) => e.specId === 'SPEC-HR-GATE')
    hr.evidence = { commits: [], files: ['docs/__GOV01_DEFINITELY_MISSING__.md'], tests: [], note: '伪造文件证据' }
  })
  const r1 = runSpecAdmission(fakeHr, { now: '2026-11-28' })
  assert.equal(r1.ok, false)
  assert.ok(r1.violations.some((v) => v.code === 'IMPL_STATUS_CONFLICT' && v.target === 'SPEC-HR-GATE'))

  const fakePartialAndWrongDir = makeValidFixture((t) => {
    const p = t.impl.entries.find((e) => e.specId === 'SPEC-PARTIAL')
    p.evidence.files = ['docs/not-found.md', 'docs/spec-a.md/']
  })
  const r2 = runSpecAdmission(fakePartialAndWrongDir, { now: '2026-11-28' })
  assert.equal(r2.ok, false)
  assert.equal(r2.violations.filter((v) => v.code === 'IMPL_STATUS_CONFLICT' && v.target === 'SPEC-PARTIAL').length, 2)
})

test('必修3：enforce 前置绕过阻断（暂缓豁免不可放行；无具名批准 FAIL，有批准 PASS）', () => {
  const withoutApproval = makeValidFixture((t) => {
    t.mig.companies[0].surfaces.find((s) => s.surface === 'v2-records').mode = 'enforce'
  })
  const r1 = runSpecAdmission(withoutApproval, { now: '2026-11-28' })
  assert.equal(r1.ok, false)
  assert.ok(r1.violations.some((v) => v.code === 'ENFORCE_UNMET_PREREQ'))

  const withApproval = makeValidFixture((t) => {
    const surf = t.mig.companies[0].surfaces.find((s) => s.surface === 'v2-records')
    surf.mode = 'enforce'
    surf.enforcementApproval = { ticket: 'FIX-05', approvedBy: 'producer', approvedAt: '2026-11-28' }
  })
  const r2 = runSpecAdmission(withApproval, { now: '2026-11-28' })
  assert.equal(r2.ok, true, JSON.stringify(r2.violations, null, 2))

  const expiredApproval = makeValidFixture((t) => {
    const surf = t.mig.companies[0].surfaces.find((s) => s.surface === 'v2-records')
    surf.mode = 'enforce'
    surf.enforcementApproval = { ticket: 'FIX-05', approvedBy: 'producer', approvedAt: '2026-11-28', expiresAt: '2026-11-20' }
  })
  const r3 = runSpecAdmission(expiredApproval, { now: '2026-11-28' })
  assert.equal(r3.ok, false)
  assert.ok(r3.violations.some((v) => v.code === 'ENFORCE_UNMET_PREREQ'))
})

test('必修4：软链入口调用（/tmp 软链 + 缺表必须 exit 1 且报 MISSING_TABLE）', () => {
  const missingRoot = makeValidFixture((t) => {
    t.deploy = null
  })
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-admission-link-'))
  tempRoots.push(linkDir)
  const symlinkPath = path.join(linkDir, 'spec-admission-symlink.mjs')
  fs.symlinkSync(SCRIPT, symlinkPath)

  const run = runCli(['--root', missingRoot, '--now', '2026-11-28', '--json'], symlinkPath)
  assert.equal(run.status, 1, `expected exit 1, got ${run.status}; stdout=${run.stdout}; stderr=${run.stderr}`)
  assert.ok(run.stdout.trim().length > 0, 'symlink CLI output must not be empty')
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.ok, false)
  assert.ok(payload.violations.some((v) => v.code === 'MISSING_TABLE'))
})

test('豁免过期/缺字段、三表不一致、缺表/非法 JSON、checklist 缺类均 FAIL', () => {
  const expired = runSpecAdmission(makeValidFixture(), { now: '2027-01-01' })
  assert.equal(expired.ok, false)
  assert.ok(expired.violations.some((v) => v.code === 'EXEMPTION_EXPIRED'))
  assert.ok(expired.violations.some((v) => v.code === 'UNAPPROVED_ADMISSION_OPEN_PARTIAL'))

  const badExm = runSpecAdmission(
    makeValidFixture((t) => {
      t.deploy.exemptions[0].approver = ''
      t.deploy.exemptions[0].reason = ''
      t.deploy.requiredSpecIds.push('SPEC-ENU-88-AGY')
      t.deploy.checklist = t.deploy.checklist.filter((c) => c.category !== 'smoke')
    }),
    { now: '2026-11-28' },
  )
  const codes = new Set(badExm.violations.map((v) => v.code))
  assert.ok(codes.has('EXEMPTION_INVALID'))
  assert.ok(codes.has('BLOCKED_SPEC_ADMITTED'))
  assert.ok(codes.has('DEPLOY_CHECKLIST_INCOMPLETE'))

  const mismatch = runSpecAdmission(
    makeValidFixture((t) => {
      t.impl.entries = t.impl.entries.filter((e) => e.specId !== 'SPEC-ENU-88-AGY')
      t.impl.entries.push({ specId: 'SPEC-GHOST', state: 'partial', evidence: { commits: [], files: [], tests: [], note: '孤儿' } })
      t.spec.entries[0].authorityDoc = 'docs/does-not-exist.md'
      t.deploy.requiredSpecIds.push('SPEC-UNKNOWN')
    }),
    { now: '2026-11-28' },
  )
  assert.ok(mismatch.violations.filter((v) => v.code === 'THREE_TABLE_MISMATCH').length >= 4)

  const badJsonRoot = makeValidFixture()
  writeText(badJsonRoot, 'docs/quality/governance/spec-registry.json', '{ broken json')
  const rBad = runSpecAdmission(badJsonRoot, { now: '2026-11-28' })
  assert.equal(rBad.ok, false)
  assert.ok(rBad.violations.some((v) => v.code === 'INVALID_JSON'))
})
