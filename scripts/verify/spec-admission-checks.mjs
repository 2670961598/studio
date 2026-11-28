/**
 * spec-admission-checks.mjs —— 规范效力/实现状态/部署准入/迁移模式校验器（纯模块，零第三方依赖）
 *
 * 拆分依据：docs/17-§5.1 SG-3（真拆保持单件 ≤600 行）；由 scripts/verify/spec-admission.mjs 装配调用。
 * 部署指纹闭环校验拆至 ./spec-admission-fingerprints.mjs。
 */

import fs from 'node:fs'
import path from 'node:path'
import { COMMIT_RE, resolveRepoPath, TREE_RE, verifyFingerprints } from './spec-admission-fingerprints.mjs'

export { verifyFingerprints }

export const SPEC_STATUSES = new Set(['final', 'draft', 'partial', 'open'])
export const DEPLOY_ELIGIBILITIES = new Set(['eligible', 'conditional', 'blocked'])
export const IMPL_STATES = new Set(['implemented', 'partial', 'not_implemented'])
export const MIGRATION_MODES = new Set(['legacy', 'shadow', 'enforce'])
export const REQUIRED_CHECKLIST_CATEGORIES = [
  'commit',
  'node',
  'cli',
  'schema',
  'contract',
  'config',
  'health',
  'smoke',
]
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0
export const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

export function addViolation(violations, code, target, detail) {
  violations.push({ code, severity: 'error', target, detail })
}

export function validateSpecTable(specTable, root, checkFiles, violations) {
  const rel = 'spec-registry.json'
  const byId = new Map()
  if (!Array.isArray(specTable.entries) || specTable.entries.length === 0) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'entries 必须为非空数组')
    return byId
  }
  for (let i = 0; i < specTable.entries.length; i += 1) {
    const e = specTable.entries[i]
    const loc = `${rel}#entries[${i}]`
    if (!isRecord(e)) {
      addViolation(violations, 'SCHEMA_INVALID', loc, '条目必须为对象')
      continue
    }
    const idOrLoc = e.id ?? loc
    if (!isNonEmptyStr(e.id)) addViolation(violations, 'SCHEMA_INVALID', loc, '缺少非空 id')
    if (!isNonEmptyStr(e.title)) addViolation(violations, 'SCHEMA_INVALID', idOrLoc, '缺少非空 title')
    if (!SPEC_STATUSES.has(e.status)) {
      addViolation(violations, 'SCHEMA_INVALID', idOrLoc, `非法 status：${String(e.status)}（允许 final|draft|partial|open）`)
    }
    if (!DEPLOY_ELIGIBILITIES.has(e.deployEligibility)) {
      addViolation(violations, 'SCHEMA_INVALID', idOrLoc, `非法 deployEligibility：${String(e.deployEligibility)}（允许 eligible|conditional|blocked）`)
    }
    if (!isNonEmptyStr(e.authorityDoc)) {
      addViolation(violations, 'SCHEMA_INVALID', idOrLoc, '缺少非空 authorityDoc')
    } else if (checkFiles) {
      const docAbs = resolveRepoPath(root, e.authorityDoc)
      if (docAbs === null || !fs.existsSync(docAbs)) {
        addViolation(violations, 'THREE_TABLE_MISMATCH', idOrLoc, `authorityDoc 不存在或路径非法：${e.authorityDoc}`)
      }
    }
    if (!isNonEmptyStr(e.authoritySection)) addViolation(violations, 'SCHEMA_INVALID', idOrLoc, '缺少非空 authoritySection')
    if (isNonEmptyStr(e.id)) {
      if (byId.has(e.id)) addViolation(violations, 'THREE_TABLE_MISMATCH', e.id, `spec-registry 存在重复 id：${e.id}`)
      else byId.set(e.id, e)
    }
    const vtag = typeof e.versionTag === 'string' ? e.versionTag.toLowerCase() : ''
    if (e.status === 'final' && vtag.includes('draft')) {
      addViolation(violations, 'SPEC_FINAL_DRAFT_CONFLICT', idOrLoc, `status=final 与 versionTag=${e.versionTag} 冲突`)
    }
    if (e.status === 'draft' && vtag.includes('final')) {
      addViolation(violations, 'SPEC_FINAL_DRAFT_CONFLICT', idOrLoc, `status=draft 与 versionTag=${e.versionTag} 冲突`)
    }
    if ((e.status === 'draft' || e.status === 'partial' || e.status === 'open') && e.deployEligibility === 'eligible') {
      addViolation(violations, 'SPEC_FINAL_DRAFT_CONFLICT', idOrLoc, `status=${e.status} 不得直接标 deployEligibility=eligible（须为 conditional 或 blocked）`)
    }
    const isRecordsSpec = /DOM-05|RECORDS/i.test(`${e.id ?? ''} ${e.authoritySection ?? ''}`)
    if (e.authorityRole !== undefined && e.authorityRole !== 'projection' && isRecordsSpec) {
      addViolation(violations, 'RECORDS_AUTHORITY_CONFLICT', idOrLoc, `records/DOM-05 authorityRole=${String(e.authorityRole)} 与 v2/05 §三 DOM-05（projection）冲突`)
    }
    if (isRecordsSpec && e.authorityRole === undefined) {
      addViolation(violations, 'RECORDS_AUTHORITY_CONFLICT', idOrLoc, 'records/DOM-05 规范条目必须显式声明 authorityRole=projection')
    }
  }
  return byId
}

function verifyEvidencePaths(specId, kind, items, root, checkFiles, violations) {
  let validCount = 0
  for (const raw of items) {
    if (!isNonEmptyStr(raw)) {
      addViolation(violations, 'SCHEMA_INVALID', specId, `evidence.${kind} 含非字符串或空项`)
      continue
    }
    const abs = resolveRepoPath(root, raw)
    if (abs === null) {
      addViolation(violations, 'IMPL_STATUS_CONFLICT', specId, `evidence.${kind} 路径非法（禁止绝对路径或越界）：${raw}`)
      continue
    }
    if (!checkFiles) {
      validCount += 1
      continue
    }
    if (!fs.existsSync(abs)) {
      addViolation(violations, 'IMPL_STATUS_CONFLICT', specId, `evidence.${kind} 路径不存在（禁止伪证据）：${raw}`)
      continue
    }
    const stat = fs.statSync(abs)
    const expectsDir = raw.endsWith('/')
    if (expectsDir && !stat.isDirectory()) {
      addViolation(violations, 'IMPL_STATUS_CONFLICT', specId, `evidence.${kind} 声明为目录但实际非目录：${raw}`)
      continue
    }
    if (!expectsDir && !stat.isFile() && !stat.isDirectory()) {
      addViolation(violations, 'IMPL_STATUS_CONFLICT', specId, `evidence.${kind} 路径既非文件也非目录：${raw}`)
      continue
    }
    validCount += 1
  }
  return validCount
}

export function validateImplTable(implTable, specById, root, checkFiles, violations) {
  const rel = 'implementation-registry.json'
  const bySpecId = new Map()
  if (!Array.isArray(implTable.entries) || implTable.entries.length === 0) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'entries 必须为非空数组')
    return bySpecId
  }
  for (let i = 0; i < implTable.entries.length; i += 1) {
    const e = implTable.entries[i]
    const loc = `${rel}#entries[${i}]`
    if (!isRecord(e)) {
      addViolation(violations, 'SCHEMA_INVALID', loc, '条目必须为对象')
      continue
    }
    if (!isNonEmptyStr(e.specId)) {
      addViolation(violations, 'SCHEMA_INVALID', loc, '缺少非空 specId')
      continue
    }
    if (!IMPL_STATES.has(e.state)) {
      addViolation(violations, 'SCHEMA_INVALID', e.specId, `非法 state：${String(e.state)}（允许 implemented|partial|not_implemented）`)
    }
    if (!isRecord(e.evidence)) {
      addViolation(violations, 'SCHEMA_INVALID', e.specId, '缺少 evidence 对象')
    } else {
      const { commits, files, tests, note } = e.evidence
      if (!Array.isArray(commits) || !Array.isArray(files) || !Array.isArray(tests)) {
        addViolation(violations, 'SCHEMA_INVALID', e.specId, 'evidence.commits/files/tests 必须为数组')
      } else {
        let validCommits = 0
        for (const c of commits) {
          if (!isNonEmptyStr(c) || !COMMIT_RE.test(c)) {
            addViolation(violations, 'SCHEMA_INVALID', e.specId, `evidence.commits 含非法 commit：${String(c)}`)
          } else validCommits += 1
        }
        const checkEvidenceReal = e.state === 'implemented' || e.state === 'partial'
        const validFiles = checkEvidenceReal ? verifyEvidencePaths(e.specId, 'files', files, root, checkFiles, violations) : files.length
        const validTests = checkEvidenceReal ? verifyEvidencePaths(e.specId, 'tests', tests, root, checkFiles, violations) : tests.length
        if (e.state === 'implemented' && validCommits + validFiles + validTests === 0) {
          addViolation(violations, 'IMPL_STATUS_CONFLICT', e.specId, 'state=implemented 但有效 commits/files/tests 证据数为 0（无真实证据不得宣称已落）')
        }
      }
      if (!isNonEmptyStr(note)) addViolation(violations, 'SCHEMA_INVALID', e.specId, 'evidence.note 必须为非空字符串')
    }
    if (bySpecId.has(e.specId)) {
      const prev = bySpecId.get(e.specId)
      const code = prev.state !== e.state ? 'IMPL_STATUS_CONFLICT' : 'THREE_TABLE_MISMATCH'
      addViolation(violations, code, e.specId, `implementation-registry 重复登记 ${e.specId}（${prev.state} vs ${e.state}）`)
    } else {
      bySpecId.set(e.specId, e)
    }
    const spec = specById.get(e.specId)
    if (spec === undefined) {
      addViolation(violations, 'THREE_TABLE_MISMATCH', e.specId, `implementation-registry 引用未知 specId：${e.specId}`)
      continue
    }
    if (e.state === 'implemented' && spec.status === 'open') {
      addViolation(violations, 'IMPL_STATUS_CONFLICT', e.specId, 'spec.status=open（未决）但 impl 宣称 state=implemented')
    }
    if (spec.authorityRole === 'projection') {
      if (e.recordsAuthorityModel !== 'projection-of-dom03') {
        addViolation(violations, 'RECORDS_AUTHORITY_CONFLICT', e.specId, `records 实现条目 recordsAuthorityModel=${String(e.recordsAuthorityModel)}，须为 projection-of-dom03`)
      }
    } else if (e.recordsAuthorityModel !== undefined && e.recordsAuthorityModel !== 'projection-of-dom03') {
      addViolation(violations, 'RECORDS_AUTHORITY_CONFLICT', e.specId, `recordsAuthorityModel=${String(e.recordsAuthorityModel)} 声明非法权威模型`)
    }
  }
  for (const id of specById.keys()) {
    if (!bySpecId.has(id)) {
      addViolation(violations, 'THREE_TABLE_MISMATCH', id, `spec-registry 条目 ${id} 在 implementation-registry 缺失对应行`)
    }
  }
  return bySpecId
}

export function validateExemptions(exemptions, specById, asOfDate, violations) {
  const activeBySpecId = new Map()
  const seenIds = new Set()
  if (!Array.isArray(exemptions)) {
    addViolation(violations, 'SCHEMA_INVALID', 'deployment-admission.json#exemptions', 'exemptions 必须为数组')
    return activeBySpecId
  }
  for (let i = 0; i < exemptions.length; i += 1) {
    const ex = exemptions[i]
    const loc = `exemptions[${i}]`
    if (!isRecord(ex)) {
      addViolation(violations, 'EXEMPTION_INVALID', loc, '豁免条目必须为对象')
      continue
    }
    const label = isNonEmptyStr(ex.id) ? ex.id : loc
    if (!isNonEmptyStr(ex.id)) addViolation(violations, 'EXEMPTION_INVALID', loc, '缺少非空 id')
    else if (seenIds.has(ex.id)) addViolation(violations, 'THREE_TABLE_MISMATCH', ex.id, `豁免 id 重复：${ex.id}`)
    else seenIds.add(ex.id)

    if (!isNonEmptyStr(ex.specId)) {
      addViolation(violations, 'EXEMPTION_INVALID', label, '缺少非空 specId')
      continue
    }
    if (!specById.has(ex.specId)) addViolation(violations, 'THREE_TABLE_MISMATCH', label, `豁免引用未知 specId：${ex.specId}`)
    let valid = true
    if (!isNonEmptyStr(ex.reason)) {
      addViolation(violations, 'EXEMPTION_INVALID', label, '缺少非空 reason（豁免原因）')
      valid = false
    }
    if (!isNonEmptyStr(ex.approver)) {
      addViolation(violations, 'EXEMPTION_INVALID', label, '缺少非空 approver（批准人）')
      valid = false
    }
    if (!isNonEmptyStr(ex.approvedAt) || !ISO_DATE_RE.test(ex.approvedAt)) {
      addViolation(violations, 'EXEMPTION_INVALID', label, '缺少合法 approvedAt（YYYY-MM-DD）')
      valid = false
    }
    if (!isNonEmptyStr(ex.expiresAt) || !ISO_DATE_RE.test(ex.expiresAt)) {
      addViolation(violations, 'EXEMPTION_INVALID', label, '缺少合法 expiresAt（YYYY-MM-DD）')
      valid = false
    } else if (ex.expiresAt < asOfDate) {
      addViolation(violations, 'EXEMPTION_EXPIRED', label, `豁免已过期：specId=${ex.specId} expiresAt=${ex.expiresAt} < asOf=${asOfDate}`)
      valid = false
    }
    if (valid && !activeBySpecId.has(ex.specId)) activeBySpecId.set(ex.specId, ex)
  }
  return activeBySpecId
}

export function validateDeploymentTable(deployTable, specById, implBySpecId, root, asOfDate, opts, violations) {
  const rel = 'deployment-admission.json'
  if (!isNonEmptyStr(deployTable.targetProfile)) addViolation(violations, 'SCHEMA_INVALID', rel, '缺少非空 targetProfile')
  const activeExemptions = validateExemptions(deployTable.exemptions, specById, asOfDate, violations)

  if (!Array.isArray(deployTable.requiredSpecIds) || deployTable.requiredSpecIds.length === 0) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'requiredSpecIds 必须为非空数组')
  } else {
    const seenReq = new Set()
    for (const specId of deployTable.requiredSpecIds) {
      if (!isNonEmptyStr(specId)) {
        addViolation(violations, 'SCHEMA_INVALID', rel, 'requiredSpecIds 含非字符串/空项')
        continue
      }
      if (seenReq.has(specId)) {
        addViolation(violations, 'THREE_TABLE_MISMATCH', specId, `requiredSpecIds 重复：${specId}`)
        continue
      }
      seenReq.add(specId)
      const spec = specById.get(specId)
      const impl = implBySpecId.get(specId)
      if (spec === undefined) {
        addViolation(violations, 'THREE_TABLE_MISMATCH', specId, `deployment-admission requiredSpecIds 引用未知 specId：${specId}`)
        continue
      }
      if (spec.deployEligibility === 'blocked') {
        addViolation(violations, 'BLOCKED_SPEC_ADMITTED', specId, `deployEligibility=blocked 的条目禁止进入部署准入面：${specId}`)
        continue
      }
      const needsExemption =
        spec.status === 'open' ||
        spec.status === 'partial' ||
        spec.status === 'draft' ||
        spec.deployEligibility === 'conditional' ||
        (impl !== undefined && impl.state !== 'implemented')
      if (needsExemption && !activeExemptions.has(specId)) {
        addViolation(
          violations,
          'UNAPPROVED_ADMISSION_OPEN_PARTIAL',
          specId,
          `spec.status=${spec.status}/impl.state=${impl?.state ?? 'missing'}/eligibility=${spec.deployEligibility} 出现在部署准入面但无有效未过期豁免（fail-closed）`,
        )
      }
    }
  }

  if (!Array.isArray(deployTable.checklist)) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'checklist 必须为数组')
  } else {
    const cats = new Set()
    const ids = new Set()
    for (let i = 0; i < deployTable.checklist.length; i += 1) {
      const c = deployTable.checklist[i]
      if (!isRecord(c) || !isNonEmptyStr(c.id) || !isNonEmptyStr(c.category) || !isNonEmptyStr(c.passCriteria)) {
        addViolation(violations, 'SCHEMA_INVALID', `${rel}#checklist[${i}]`, 'checklist 项须含非空 id/category/passCriteria')
        continue
      }
      if (ids.has(c.id)) addViolation(violations, 'THREE_TABLE_MISMATCH', c.id, `checklist id 重复：${c.id}`)
      ids.add(c.id)
      cats.add(c.category)
    }
    const missingCats = REQUIRED_CHECKLIST_CATEGORIES.filter((cat) => !cats.has(cat))
    if (missingCats.length > 0) {
      addViolation(violations, 'DEPLOY_CHECKLIST_INCOMPLETE', rel, `部署准入 checklist 缺少类别：${missingCats.join(', ')}`)
    }
  }

  const deployedCompanies = new Set()
  if (!Array.isArray(deployTable.currentDeployments) || deployTable.currentDeployments.length === 0) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'currentDeployments 必须为非空数组')
  } else {
    for (let i = 0; i < deployTable.currentDeployments.length; i += 1) {
      const d = deployTable.currentDeployments[i]
      const loc = `${rel}#currentDeployments[${i}]`
      if (!isRecord(d) || !isNonEmptyStr(d.company)) {
        addViolation(violations, 'SCHEMA_INVALID', loc, '部署记录必须含非空 company')
        continue
      }
      deployedCompanies.add(d.company)
      if (!isNonEmptyStr(d.deployedCommit) || !COMMIT_RE.test(d.deployedCommit)) {
        addViolation(violations, 'SCHEMA_INVALID', d.company, `deployedCommit 格式非法：${String(d.deployedCommit)}`)
      }
      if (!isNonEmptyStr(d.rollbackCommit) || !COMMIT_RE.test(d.rollbackCommit)) {
        addViolation(violations, 'SCHEMA_INVALID', d.company, `rollbackCommit 格式非法：${String(d.rollbackCommit)}`)
      }
      if (d.treeDigest !== undefined && (!isNonEmptyStr(d.treeDigest) || !TREE_RE.test(d.treeDigest))) {
        addViolation(violations, 'SCHEMA_INVALID', d.company, `treeDigest 格式非法：${String(d.treeDigest)}`)
      }
      if (opts.checkFiles && isNonEmptyStr(d.runbookDoc)) {
        const rbAbs = resolveRepoPath(root, d.runbookDoc)
        if (rbAbs === null || !fs.existsSync(rbAbs)) {
          addViolation(violations, 'THREE_TABLE_MISMATCH', d.company, `runbookDoc 不存在或路径非法：${d.runbookDoc}`)
        }
      }
      if (opts.checkFiles && isNonEmptyStr(d.evidenceDoc)) {
        const evAbs = resolveRepoPath(root, d.evidenceDoc)
        if (evAbs === null || !fs.existsSync(evAbs)) {
          addViolation(violations, 'THREE_TABLE_MISMATCH', d.company, `evidenceDoc 不存在或路径非法：${d.evidenceDoc}`)
        }
      }
    }
  }

  const fp = deployTable.fingerprints
  if (!isRecord(fp)) {
    addViolation(violations, 'SCHEMA_INVALID', rel, '缺少 fingerprints 对象')
  } else {
    if (!isNonEmptyStr(fp.frameworkCommit) || !COMMIT_RE.test(fp.frameworkCommit)) {
      addViolation(violations, 'SCHEMA_INVALID', `${rel}#fingerprints`, `frameworkCommit 非法：${String(fp.frameworkCommit)}`)
    }
    if (!opts.skipFingerprints) {
      verifyFingerprints(deployTable, specById, implBySpecId, activeExemptions, root, violations)
    }
  }

  return { activeExemptions, deployedCompanies }
}

function validateEnforcementApproval(approval, company, surface, asOfDate, violations) {
  const target = `${company}:${surface}:enforcementApproval`
  if (!isRecord(approval)) {
    addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, 'mode=enforce 必须具备该面的具名批准 enforcementApproval（{ticket,approvedBy,approvedAt}）；通用/暂缓豁免不得替代')
    return false
  }
  let valid = true
  if (!isNonEmptyStr(approval.ticket)) {
    addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, 'enforcementApproval 缺少非空 ticket')
    valid = false
  }
  if (!isNonEmptyStr(approval.approvedBy)) {
    addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, 'enforcementApproval 缺少非空 approvedBy')
    valid = false
  }
  if (!isNonEmptyStr(approval.approvedAt) || !ISO_DATE_RE.test(approval.approvedAt)) {
    addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, 'enforcementApproval 缺少合法 approvedAt（YYYY-MM-DD）')
    valid = false
  }
  if (approval.surface !== undefined && approval.surface !== surface) {
    addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, `enforcementApproval.surface=${String(approval.surface)} 与当前面 ${surface} 不一致`)
    valid = false
  }
  if (approval.expiresAt !== undefined) {
    if (!isNonEmptyStr(approval.expiresAt) || !ISO_DATE_RE.test(approval.expiresAt)) {
      addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, 'enforcementApproval.expiresAt 格式非法（须为 YYYY-MM-DD）')
      valid = false
    } else if (approval.expiresAt < asOfDate) {
      addViolation(violations, 'EXEMPTION_EXPIRED', target, `enforcementApproval 已过期：${approval.expiresAt} < ${asOfDate}`)
      addViolation(violations, 'ENFORCE_UNMET_PREREQ', target, `mode=enforce 的具名批准已过期（expiresAt=${approval.expiresAt}）`)
      valid = false
    }
  }
  return valid
}

export function validateMigrationTable(migTable, specById, implBySpecId, deployedCompanies, deployTable, asOfDate, violations) {
  const rel = 'migration-modes.json'
  if (migTable.productionYamlModified !== false) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'productionYamlModified 必须为 false（本表只读治理登记，禁改生产 yaml）')
  }
  const depYamlMod = deployTable?.fingerprints?.configDigest?.productionYamlModified
  if (depYamlMod !== undefined && depYamlMod !== migTable.productionYamlModified) {
    addViolation(violations, 'THREE_TABLE_MISMATCH', rel, `migration-modes.productionYamlModified（${String(migTable.productionYamlModified)}）与 deployment-admission.configDigest.productionYamlModified（${String(depYamlMod)}）不一致`)
  }
  if (!Array.isArray(migTable.companies) || migTable.companies.length === 0) {
    addViolation(violations, 'SCHEMA_INVALID', rel, 'companies 必须为非空数组')
    return
  }
  const seenCompanies = new Set()
  for (let i = 0; i < migTable.companies.length; i += 1) {
    const c = migTable.companies[i]
    const loc = `${rel}#companies[${i}]`
    if (!isRecord(c) || !isNonEmptyStr(c.company)) {
      addViolation(violations, 'SCHEMA_INVALID', loc, 'company 必须为非空字符串')
      continue
    }
    if (seenCompanies.has(c.company)) addViolation(violations, 'THREE_TABLE_MISMATCH', c.company, `migration-modes 存在重复公司：${c.company}`)
    seenCompanies.add(c.company)
    if (deployedCompanies.size > 0 && !deployedCompanies.has(c.company)) {
      addViolation(violations, 'THREE_TABLE_MISMATCH', c.company, `migration-modes 公司 ${c.company} 在 deployment-admission.currentDeployments 缺失`)
    }
    if (!Array.isArray(c.surfaces) || c.surfaces.length === 0) {
      addViolation(violations, 'SCHEMA_INVALID', c.company, 'surfaces 必须为非空数组')
      continue
    }
    const seenSurfaces = new Set()
    for (const s of c.surfaces) {
      if (!isRecord(s) || !isNonEmptyStr(s.surface)) {
        addViolation(violations, 'SCHEMA_INVALID', c.company, 'surface 条目必须含非空 surface 名')
        continue
      }
      const surfLoc = `${c.company}:${s.surface}`
      if (seenSurfaces.has(s.surface)) addViolation(violations, 'THREE_TABLE_MISMATCH', surfLoc, `重复 surface：${s.surface}`)
      seenSurfaces.add(s.surface)
      if (!MIGRATION_MODES.has(s.mode)) {
        addViolation(violations, 'SCHEMA_INVALID', surfLoc, `非法 mode：${String(s.mode)}（允许 legacy|shadow|enforce）`)
        continue
      }
      if (!Array.isArray(s.specIds) || s.specIds.length === 0) {
        addViolation(violations, 'SCHEMA_INVALID', surfLoc, 'surface.specIds 必须为非空数组')
        continue
      }
      const hasNamedApproval =
        s.mode === 'enforce' ? validateEnforcementApproval(s.enforcementApproval, c.company, s.surface, asOfDate, violations) : false
      for (const specId of s.specIds) {
        const spec = specById.get(specId)
        const impl = implBySpecId.get(specId)
        if (spec === undefined) {
          addViolation(violations, 'THREE_TABLE_MISMATCH', surfLoc, `surface 引用未知 specId：${specId}`)
          continue
        }
        if (s.mode !== 'enforce') continue
        const specLoc = `${surfLoc}:${specId}`
        if (spec.deployEligibility === 'blocked') {
          addViolation(violations, 'BLOCKED_SPEC_ADMITTED', specLoc, `mode=enforce 禁止包含 deployEligibility=blocked 规范：${specId}`)
        } else if (impl === undefined || spec.status === 'open' || impl.state === 'not_implemented') {
          addViolation(violations, 'ENFORCE_UNMET_PREREQ', specLoc, `mode=enforce 但 ${specId} 为 open/not_implemented 或缺少实现行（spec=${spec.status}, impl=${impl?.state ?? 'missing'}）`)
        } else if (!(spec.status === 'final' && impl.state === 'implemented') && !hasNamedApproval) {
          addViolation(violations, 'ENFORCE_UNMET_PREREQ', specLoc, `mode=enforce 但 ${specId} 尚未满足 final+implemented（spec=${spec.status}, impl=${impl.state}）且无该面的具名 enforcementApproval`)
        }
      }
    }
  }
  const targetProfile = deployTable?.targetProfile ?? ''
  if (isNonEmptyStr(targetProfile) && !seenCompanies.has(targetProfile)) {
    addViolation(violations, 'THREE_TABLE_MISMATCH', targetProfile, `deployment-admission targetProfile=${targetProfile} 未在 migration-modes 登记`)
  }
}

export function scanDocContradictions(root, violations) {
  const checkedDocs = []
  const doc09 = 'docs/v2/09-技术细节-总纲与工程决策·主表总册.md'
  const abs09 = path.join(root, doc09)
  if (fs.existsSync(abs09)) {
    checkedDocs.push(doc09)
    const text = fs.readFileSync(abs09, 'utf8')
    const head = text.split('\n').slice(0, 20).join('\n')
    const verSec = text.split('\n## 四、')[1]?.split('\n## 五、')[0] ?? ''
    if (/v2\.1-final|状态：\*?\*?final/.test(head) && /\|\s*draft\s*\|/.test(verSec) && !/失效区间注记|历史快照/.test(verSec)) {
      addViolation(violations, 'DOC_FINAL_DRAFT_CONFLICT', doc09, '卷头宣称 final，但 §四版本表仍含 draft 行且缺少「失效区间注记/历史快照」声明')
    }
  }

  const doc17 = 'docs/17-整体技术设计.md'
  const abs17 = path.join(root, doc17)
  if (fs.existsSync(abs17)) {
    checkedDocs.push(doc17)
    const lines = fs.readFileSync(abs17, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (/`?records`?\s*为事实源/.test(lines[i]) && !/失效注记|已废弃|DOM-05/.test(lines[i])) {
        addViolation(violations, 'DOC_RECORDS_AUTHORITY_CONFLICT', `${doc17}:${i + 1}`, '仍宣称「records 为事实源」且无指向 v2/05 §三 DOM-05 的失效注记')
      }
    }
  }

  const docMr = 'docs/quality/model-routing.md'
  const absMr = path.join(root, docMr)
  if (fs.existsSync(absMr)) {
    checkedDocs.push(docMr)
    const text = fs.readFileSync(absMr, 'utf8')
    if (/^已落：/m.test(text) && /^未落（/m.test(text) && !/历史切片失效区间|失效区间注记/.test(text)) {
      addViolation(violations, 'DOC_IMPL_STATE_CONFLICT', docMr, '同文档同时含「已落：」与早期切片「未落（」清单且无「历史切片失效区间/失效区间注记」')
    }
  }
  return checkedDocs
}
