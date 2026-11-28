/**
 * spec-admission-fingerprints.mjs —— 部署指纹闭合校验器（GOV-01 / task-160）
 *
 * 零第三方依赖（仅 Node 标准库 + git CLI；git 不可用或非 git 仓库时 fail-closed）。
 * 校验范围：
 *   1) commit / treeDigest / rollbackCommit 与 git rev-parse 闭环（含 currentDeployments 对齐）；
 *   2) contractArtifacts / lockfile / nodeRuntime / storeSchema（缺失或漂移一律 FAIL）；
 *   3) cliAdapters（blocked/未批准执行器如 agy 不得标为 production）；
 *   4) configDigest（productionYamlModified=false 与实际 yaml sha256 + git 跟踪 yaml 状态一致）。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const COMMIT_RE = /^[0-9a-f]{7,40}$/i
export const TREE_RE = /^[0-9a-f]{40}$/i
export const SHA256_RE = /^[0-9a-f]{64}$/

const CLI_ADAPTER_STATUSES = new Set([
  'production',
  'production-fallback',
  'registered-disabled',
  'experimental',
  'disabled',
])
const PRODUCTION_ADAPTER_STATUSES = new Set(['production', 'production-fallback'])

const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const sha256File = (abs) => createHash('sha256').update(fs.readFileSync(abs)).digest('hex')

function addViolation(violations, code, target, detail) {
  violations.push({ code, severity: 'error', target, detail })
}

/** 解析相对仓库路径并禁止绝对路径或向上穿越出仓根。 */
export function resolveRepoPath(root, relPath) {
  if (!isNonEmptyStr(relPath) || path.isAbsolute(relPath)) return null
  const rootAbs = path.resolve(root)
  const targetAbs = path.resolve(rootAbs, relPath)
  if (targetAbs === rootAbs || targetAbs.startsWith(`${rootAbs}${path.sep}`)) {
    return targetAbs
  }
  return null
}

function runGit(root, args) {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (res.error) {
    return { ok: false, unavailable: true, detail: `git 执行失败：${res.error.message}` }
  }
  if (res.status !== 0) {
    const stderr = String(res.stderr ?? '').trim()
    return { ok: false, unavailable: false, detail: stderr || `git exit ${res.status}` }
  }
  return { ok: true, stdout: String(res.stdout ?? '').trim() }
}

function resolveGitObject(root, rev, type) {
  return runGit(root, ['rev-parse', '--verify', '--quiet', `${rev}^{${type}}`])
}

function verifyGitCommitsAndTrees(deployTable, fp, root, violations) {
  const gitCheck = runGit(root, ['rev-parse', '--git-dir'])
  const gitAvailable = gitCheck.ok
  if (!gitAvailable) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'deployment-admission.json#fingerprints',
      `git 不可用或目标目录非 git 仓库，无法校验 commit/tree 与 yaml 变更（fail-closed）：${gitCheck.detail}`,
    )
  }

  let resolvedFwCommit = null
  let resolvedFwRollback = null

  if (isNonEmptyStr(fp.frameworkCommit) && COMMIT_RE.test(fp.frameworkCommit) && gitAvailable) {
    const rev = resolveGitObject(root, fp.frameworkCommit, 'commit')
    if (!rev.ok || !rev.stdout.toLowerCase().startsWith(fp.frameworkCommit.toLowerCase())) {
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        'fingerprints.frameworkCommit',
        `frameworkCommit 无法通过 git rev-parse 校验：${fp.frameworkCommit}（${rev.detail ?? 'mismatch'}）`,
      )
    } else {
      resolvedFwCommit = rev.stdout.toLowerCase()
    }
  }

  if (!isNonEmptyStr(fp.treeDigest) || !TREE_RE.test(fp.treeDigest)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.treeDigest',
      `缺少或非法的 fingerprints.treeDigest（须为 40 位 hex）：${String(fp.treeDigest)}`,
    )
  } else if (gitAvailable && resolvedFwCommit !== null) {
    const tree = resolveGitObject(root, resolvedFwCommit, 'tree')
    if (!tree.ok || tree.stdout.toLowerCase() !== fp.treeDigest.toLowerCase()) {
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        'fingerprints.treeDigest',
        `treeDigest 与 git rev-parse ${resolvedFwCommit}^{tree} 不一致：登记=${fp.treeDigest} 实际=${tree.ok ? tree.stdout : tree.detail}`,
      )
    }
  }

  if (!isNonEmptyStr(fp.rollbackCommit) || !COMMIT_RE.test(fp.rollbackCommit)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.rollbackCommit',
      `缺少或非法的 fingerprints.rollbackCommit：${String(fp.rollbackCommit)}`,
    )
  } else if (gitAvailable) {
    const rb = resolveGitObject(root, fp.rollbackCommit, 'commit')
    if (!rb.ok || !rb.stdout.toLowerCase().startsWith(fp.rollbackCommit.toLowerCase())) {
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        'fingerprints.rollbackCommit',
        `rollbackCommit 无法通过 git rev-parse 校验：${fp.rollbackCommit}`,
      )
    } else {
      resolvedFwRollback = rb.stdout.toLowerCase()
    }
  }

  if (!Array.isArray(deployTable.currentDeployments)) return gitAvailable

  let foundTargetProfile = false
  for (const d of deployTable.currentDeployments) {
    if (!isRecord(d) || !isNonEmptyStr(d.company)) continue
    let resolvedDepCommit = null
    let resolvedDepRollback = null

    if (isNonEmptyStr(d.deployedCommit) && COMMIT_RE.test(d.deployedCommit) && gitAvailable) {
      const rev = resolveGitObject(root, d.deployedCommit, 'commit')
      if (!rev.ok || !rev.stdout.toLowerCase().startsWith(d.deployedCommit.toLowerCase())) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.deployedCommit`,
          `deployedCommit 无法通过 git rev-parse 校验：${d.deployedCommit}`,
        )
      } else {
        resolvedDepCommit = rev.stdout.toLowerCase()
      }
    }

    if (!isNonEmptyStr(d.treeDigest) || !TREE_RE.test(d.treeDigest)) {
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        `currentDeployments.${d.company}.treeDigest`,
        `缺少或非法的部署 treeDigest（须为 40 位 hex）：${String(d.treeDigest)}`,
      )
    } else if (gitAvailable && resolvedDepCommit !== null) {
      const tree = resolveGitObject(root, resolvedDepCommit, 'tree')
      if (!tree.ok || tree.stdout.toLowerCase() !== d.treeDigest.toLowerCase()) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.treeDigest`,
          `部署 treeDigest 与 git rev-parse ${resolvedDepCommit}^{tree} 不一致：登记=${d.treeDigest} 实际=${tree.ok ? tree.stdout : tree.detail}`,
        )
      }
    }

    if (isNonEmptyStr(d.rollbackCommit) && COMMIT_RE.test(d.rollbackCommit) && gitAvailable) {
      const rb = resolveGitObject(root, d.rollbackCommit, 'commit')
      if (!rb.ok || !rb.stdout.toLowerCase().startsWith(d.rollbackCommit.toLowerCase())) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.rollbackCommit`,
          `部署 rollbackCommit 无法通过 git rev-parse 校验：${d.rollbackCommit}`,
        )
      } else {
        resolvedDepRollback = rb.stdout.toLowerCase()
      }
    }

    if (d.company === deployTable.targetProfile) {
      foundTargetProfile = true
      const commitMatches =
        resolvedDepCommit !== null && resolvedFwCommit !== null
          ? resolvedDepCommit === resolvedFwCommit
          : isNonEmptyStr(d.deployedCommit) &&
            isNonEmptyStr(fp.frameworkCommit) &&
            d.deployedCommit.toLowerCase() === fp.frameworkCommit.toLowerCase()
      if (!commitMatches) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.deployedCommit`,
          `当前部署 commit（${String(d.deployedCommit)}）与 fingerprints.frameworkCommit（${String(fp.frameworkCommit)}）不一致`,
        )
      }
      if (
        isNonEmptyStr(d.treeDigest) &&
        isNonEmptyStr(fp.treeDigest) &&
        d.treeDigest.toLowerCase() !== fp.treeDigest.toLowerCase()
      ) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.treeDigest`,
          `当前部署 treeDigest（${d.treeDigest}）与 fingerprints.treeDigest（${fp.treeDigest}）不一致`,
        )
      }
      if (resolvedDepRollback !== null && resolvedFwRollback !== null && resolvedDepRollback !== resolvedFwRollback) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          `currentDeployments.${d.company}.rollbackCommit`,
          `当前部署 rollbackCommit（${d.rollbackCommit}）与 fingerprints.rollbackCommit（${fp.rollbackCommit}）不一致`,
        )
      }
    }
  }

  if (isNonEmptyStr(deployTable.targetProfile) && !foundTargetProfile) {
    addViolation(
      violations,
      'THREE_TABLE_MISMATCH',
      deployTable.targetProfile,
      `targetProfile=${deployTable.targetProfile} 未在 currentDeployments 中登记`,
    )
  }
  return gitAvailable
}

function verifyContractAndLockfile(fp, root, violations) {
  if (!isRecord(fp.contractArtifacts) || !isNonEmptyStr(fp.contractArtifacts.indexFile)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.contractArtifacts',
      '缺少必需的 contractArtifacts 指纹对象或 indexFile（fail-closed）',
    )
  } else {
    const ca = fp.contractArtifacts
    const abs = resolveRepoPath(root, ca.indexFile)
    if (abs === null || !fs.existsSync(abs)) {
      addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', ca.indexFile, '契约工件索引文件缺失或路径非法')
    } else {
      const actualSha = sha256File(abs)
      if (!SHA256_RE.test(String(ca.indexSha256 ?? '')) || actualSha !== ca.indexSha256) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          ca.indexFile,
          `契约索引 sha256 不一致：登记=${String(ca.indexSha256)} 实际=${actualSha}`,
        )
      }
      try {
        const idx = JSON.parse(fs.readFileSync(abs, 'utf8'))
        if (!Number.isInteger(ca.schemaCount) || idx.schemaCount !== ca.schemaCount) {
          addViolation(
            violations,
            'DEPLOY_FINGERPRINT_MISMATCH',
            ca.indexFile,
            `schemaCount 缺失或不一致：登记=${String(ca.schemaCount)} 实际=${String(idx.schemaCount)}`,
          )
        }
        if (!Number.isInteger(ca.areaCount) || idx.areaCount !== ca.areaCount) {
          addViolation(
            violations,
            'DEPLOY_FINGERPRINT_MISMATCH',
            ca.indexFile,
            `areaCount 缺失或不一致：登记=${String(ca.areaCount)} 实际=${String(idx.areaCount)}`,
          )
        }
      } catch (err) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          ca.indexFile,
          `解析失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  if (!isRecord(fp.lockfile) || !isNonEmptyStr(fp.lockfile.file)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.lockfile',
      '缺少必需的 lockfile 指纹对象或 file（fail-closed）',
    )
  } else {
    const abs = resolveRepoPath(root, fp.lockfile.file)
    if (abs === null || !fs.existsSync(abs)) {
      addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', fp.lockfile.file, '依赖锁文件缺失或路径非法')
    } else {
      const actualSha = sha256File(abs)
      if (!SHA256_RE.test(String(fp.lockfile.sha256 ?? '')) || actualSha !== fp.lockfile.sha256) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          fp.lockfile.file,
          `锁文件 sha256 不一致：登记=${String(fp.lockfile.sha256)} 实际=${actualSha}`,
        )
      }
    }
  }
}

function verifyNodeAndSchema(fp, root, violations) {
  if (!isRecord(fp.nodeRuntime) || !isNonEmptyStr(fp.nodeRuntime.enginesRange)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.nodeRuntime',
      '缺少必需的 nodeRuntime 指纹对象或 enginesRange（fail-closed）',
    )
  } else {
    const pkgAbs = path.join(root, 'package.json')
    if (!fs.existsSync(pkgAbs)) {
      addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', 'package.json', '缺少 package.json，无法校验 Node engines（fail-closed）')
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgAbs, 'utf8'))
        const actual = pkg.engines?.node
        if (actual !== fp.nodeRuntime.enginesRange) {
          addViolation(
            violations,
            'DEPLOY_FINGERPRINT_MISMATCH',
            'package.json#engines.node',
            `Node engines 不一致：登记=${fp.nodeRuntime.enginesRange} 实际=${String(actual)}`,
          )
        }
      } catch (err) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          'package.json',
          `解析失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    const miseAbs = path.join(root, '.mise.toml')
    if (isNonEmptyStr(fp.nodeRuntime.toolchainPinned) && fs.existsSync(miseAbs)) {
      const miseText = fs.readFileSync(miseAbs, 'utf8')
      const m = miseText.match(/^\s*node\s*=\s*"([^"]+)"/m)
      if (!m || m[1] !== fp.nodeRuntime.toolchainPinned) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          '.mise.toml#node',
          `工具链 Node 版本不一致：登记=${fp.nodeRuntime.toolchainPinned} 实际=${m ? m[1] : 'missing'}`,
        )
      }
    }
  }

  if (
    !isRecord(fp.storeSchema) ||
    !isNonEmptyStr(fp.storeSchema.latestMigrationFile) ||
    !Number.isInteger(fp.storeSchema.currentVersion)
  ) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.storeSchema',
      '缺少必需的 storeSchema 指纹对象或字段（fail-closed）',
    )
  } else {
    const migAbs = resolveRepoPath(root, fp.storeSchema.latestMigrationFile)
    if (migAbs === null || !fs.existsSync(migAbs)) {
      addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', fp.storeSchema.latestMigrationFile, 'store 最新迁移文件缺失或路径非法')
    } else {
      const text = fs.readFileSync(migAbs, 'utf8')
      const versions = [...text.matchAll(/\bversion\s*:\s*(\d+)\b/g)].map((m) => Number(m[1]))
      const latest = versions.length > 0 ? Math.max(...versions) : null
      if (latest === null || latest !== fp.storeSchema.currentVersion) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          fp.storeSchema.latestMigrationFile,
          `迁移文件最新版本（${String(latest)}）与登记 currentVersion（${String(fp.storeSchema.currentVersion)}）不一致`,
        )
      }
    }
  }
}

function collectLinkedSpecIds(adapterName, cfg, specById) {
  const linked = new Set()
  if (isNonEmptyStr(cfg.specId)) linked.add(cfg.specId)
  if (isNonEmptyStr(cfg.policy)) {
    for (const m of cfg.policy.matchAll(/\bSPEC-[A-Z0-9-]+\b/g)) {
      if (specById.has(m[0])) linked.add(m[0])
    }
  }
  const token = adapterName.toUpperCase()
  for (const id of specById.keys()) {
    if (id.split('-').includes(token)) linked.add(id)
  }
  return linked
}

function verifyCliAdapters(deployTable, fp, specById, implBySpecId, activeExemptions, violations) {
  if (!isRecord(fp.cliAdapters) || Object.keys(fp.cliAdapters).length === 0) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.cliAdapters',
      '缺少必需的 cliAdapters 指纹对象（fail-closed）',
    )
    return
  }
  const requiredSet = new Set(Array.isArray(deployTable.requiredSpecIds) ? deployTable.requiredSpecIds : [])
  for (const [name, cfg] of Object.entries(fp.cliAdapters)) {
    const target = `fingerprints.cliAdapters.${name}`
    if (!isRecord(cfg) || !CLI_ADAPTER_STATUSES.has(cfg.status)) {
      addViolation(
        violations,
        'SCHEMA_INVALID',
        target,
        `cliAdapters.${name}.status 非法：${String(cfg?.status)}`,
      )
      continue
    }
    if (isNonEmptyStr(cfg.specId) && !specById.has(cfg.specId)) {
      addViolation(violations, 'THREE_TABLE_MISMATCH', target, `cliAdapters.${name} 引用未知 specId：${cfg.specId}`)
      continue
    }
    if (!PRODUCTION_ADAPTER_STATUSES.has(cfg.status)) continue

    const linked = collectLinkedSpecIds(name, cfg, specById)
    if (name === 'agy' && linked.size === 0) {
      addViolation(
        violations,
        'BLOCKED_SPEC_ADMITTED',
        target,
        '执行器 agy 标为生产态但缺少关联准入规范（fail-closed）',
      )
      continue
    }
    for (const specId of linked) {
      const spec = specById.get(specId)
      const impl = implBySpecId.get(specId)
      if (!spec) continue
      if (spec.deployEligibility === 'blocked') {
        addViolation(
          violations,
          'BLOCKED_SPEC_ADMITTED',
          target,
          `执行器 ${name} 标为 ${cfg.status}，但关联规范 ${specId} 为 deployEligibility=blocked（未批准不得生产）`,
        )
        continue
      }
      if (!requiredSet.has(specId)) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          target,
          `执行器 ${name} 标为 ${cfg.status}，但关联规范 ${specId} 未进入 requiredSpecIds 准入面`,
        )
      }
      const ready = spec.status === 'final' && spec.deployEligibility === 'eligible' && impl?.state === 'implemented'
      if (!ready && !activeExemptions.has(specId)) {
        addViolation(
          violations,
          'UNAPPROVED_ADMISSION_OPEN_PARTIAL',
          target,
          `执行器 ${name} 标为 ${cfg.status}，但关联规范 ${specId} 未就绪且无有效具名豁免`,
        )
      }
    }
  }
}

function verifyConfigDigest(fp, root, gitAvailable, violations) {
  if (!isRecord(fp.configDigest)) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.configDigest',
      '缺少必需的 configDigest 指纹对象（fail-closed）',
    )
    return
  }
  if (fp.configDigest.productionYamlModified !== false) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.configDigest.productionYamlModified',
      `configDigest.productionYamlModified 必须为 false，实际=${String(fp.configDigest.productionYamlModified)}`,
    )
  }
  const digests = fp.configDigest.yamlDigests
  if (!Array.isArray(digests) || digests.length === 0) {
    addViolation(
      violations,
      'DEPLOY_FINGERPRINT_MISMATCH',
      'fingerprints.configDigest.yamlDigests',
      '缺少必需的 configDigest.yamlDigests（无法校验 yaml sha256 一致性，fail-closed）',
    )
  } else {
    for (let i = 0; i < digests.length; i += 1) {
      const item = digests[i]
      const loc = `fingerprints.configDigest.yamlDigests[${i}]`
      if (!isRecord(item) || !isNonEmptyStr(item.file) || !SHA256_RE.test(String(item.sha256 ?? ''))) {
        addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', loc, 'yamlDigests 项必须含非空 file 与 64 位 sha256')
        continue
      }
      const abs = resolveRepoPath(root, item.file)
      if (abs === null || !fs.existsSync(abs)) {
        addViolation(violations, 'DEPLOY_FINGERPRINT_MISMATCH', item.file, `登记的 yaml 配置文件不存在或路径非法：${item.file}`)
        continue
      }
      const actualSha = sha256File(abs)
      if (actualSha !== item.sha256) {
        addViolation(
          violations,
          'DEPLOY_FINGERPRINT_MISMATCH',
          item.file,
          `yaml 指纹漂移（与 productionYamlModified=false 冲突）：登记=${item.sha256} 实际=${actualSha}`,
        )
      }
    }
  }
  if (gitAvailable) {
    const st = runGit(root, ['status', '--porcelain', '--untracked-files=no', '--', '*.yaml', '*.yml'])
    if (!st.ok) {
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        'fingerprints.configDigest',
        `无法检查仓内 yaml 改动状态（fail-closed）：${st.detail}`,
      )
    } else if (st.stdout.length > 0) {
      const changed = st.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('; ')
      addViolation(
        violations,
        'DEPLOY_FINGERPRINT_MISMATCH',
        'fingerprints.configDigest',
        `检测到跟踪 yaml 文件存在未提交修改（与 productionYamlModified=false 冲突）：${changed}`,
      )
    }
  }
}

export function verifyFingerprints(deployTable, specById, implBySpecId, activeExemptions, root, violations) {
  const fp = deployTable.fingerprints
  const gitAvailable = verifyGitCommitsAndTrees(deployTable, fp, root, violations)
  verifyContractAndLockfile(fp, root, violations)
  verifyNodeAndSchema(fp, root, violations)
  verifyCliAdapters(deployTable, fp, specById, implBySpecId, activeExemptions, violations)
  verifyConfigDigest(fp, root, gitAvailable, violations)
}
