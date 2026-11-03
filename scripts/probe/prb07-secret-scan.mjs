#!/usr/bin/env node
/**
 * prb07-secret-scan.mjs —— PRB-07「秘密不进上下文」探针腿（组件级，可重复执行）
 *
 * 依据：docs/v2/12 §5.3 PRB-07；docs/v2/15 §4.1/§4.5；docs/v2/11 §2.2。
 * 边界：本脚本只跑仓内**真实模块**（core PRM 生成器 + gateway 凭据目录），
 *       不启 daemon、不写生产面、不发网络；投影尚未接线到运行时，因此结论只到
 *       组件级，不升为「投影防线成立」（v2/12 §0.5-3）。
 *
 * 用法（bun）：
 *   STUDIO_PROBE_SECRET=<injected> mise exec -- bun scripts/probe/prb07-secret-scan.mjs --repo <repo>
 *
 * 输出：逐项 KEY=VALUE（不含探针秘密值本体），由 run-pb246.mjs 原样归档。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--repo') out.repo = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const repo = path.resolve(args.repo ?? process.cwd())
const secretValue = process.env.STUDIO_PROBE_SECRET ?? ''
if (secretValue === '') {
  console.error('PROBE_SECRET_MISSING：STUDIO_PROBE_SECRET 未注入，探针拒绝运行（不伪造）')
  process.exit(2)
}

const load = async (rel) => import(pathToFileURL(path.join(repo, rel)).href)
const { compileProjection, projectionGate } = await load('packages/core/src/prm/compile-projection.ts')
const { createCredentialCatalog } = await load('packages/gateway/src/catalog.ts')

const baseInput = {
  companyId: 'company:probe',
  workRef: 'work:pb-2-prb-07',
  planRef: 'plan:probe-v1',
  grantRefs: ['grant:probe-1'],
  capabilityRefs: ['cap:tool-a'],
  secretTypes: ['per_task_shortlived'],
  host: { hostKind: 'dsh', version: '0.2.1-rc.5', bindingRef: 'binding:probe' },
  validityFrom: '2026-11-03T00:00:00Z',
  validityUntil: '2026-11-04T00:00:00Z',
  deployment: {
    carriedSegments: ['authority', 'tools', 'sandbox', 'approval', 'evidence'],
    sandbox: { mode: 'workspace-write', rootRef: 'root:probe' },
    approvalTemplateRef: 'approval:probe',
    evidenceSinkRef: 'sink:probe',
  },
}

function walk(node, needle, at = '$') {
  const hits = []
  if (typeof node === 'string') {
    if (node.includes(needle)) hits.push(at)
    return hits
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => hits.push(...walk(v, needle, `${at}[${i}]`)))
    return hits
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) hits.push(...walk(v, needle, `${at}.${k}`))
  }
  return hits
}

// ① 合法类别路径：投影只应出现类别引用，不应出现探针秘密值本体
const legit = compileProjection(baseInput)
console.log(`CASE=legit-category RESULT=${legit.kind}`)
if (legit.kind === 'ok') {
  const json = JSON.stringify(legit.value)
  console.log(`LEGIT_CONTAINS_SECRET=${json.includes(secretValue) ? 1 : 0}`)
  console.log(`LEGIT_SANDBOX_SOURCE_REFS=${JSON.stringify(legit.value.segments.sandbox.sourceRefs)}`)
  console.log(`LEGIT_GATE_LAUNCHABLE=${projectionGate(legit.value).launchable ? 1 : 0}`)
  console.log(`LEGIT_DIGEST=${legit.value.digest}`)
}

// ② 负向：把值形态字符串塞进 secretTypes（输入纪律绕过）——生成器是否原样带入？
const injected = compileProjection({ ...baseInput, secretTypes: [secretValue] })
console.log(`CASE=injected-value RESULT=${injected.kind}`)
if (injected.kind === 'ok') {
  const hits = walk(injected.value, secretValue)
  console.log(`INJECTED_VALUE_PRESENT=${hits.length > 0 ? 1 : 0}`)
  console.log(`INJECTED_VALUE_PATHS=${JSON.stringify(hits)}`)
} else {
  console.log(`INJECTED_REJECT_SUBCAUSE=${injected.error.subcause}`)
}

// ③ 凭据目录：合法登记只产逻辑引用；值形态字段/未知值键一律拒
const catalog = createCredentialCatalog({ clock: () => Date.parse('2026-11-03T00:00:00Z') })
const rootDraft = {
  secretId: 'SEC-PRB-ROOT',
  secretType: 'per_task_shortlived',
  credentialClass: 'root',
  logicalReference: 'cred-root@probe',
  boundGrant: { recordId: 'rec:probe-root', refVersion: '1.0.0' },
  permittedOperations: ['read'],
  validWindow: { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' },
  exposureScope: 'probe-only',
  valueProvider: { type: 'env-ref', name: 'STUDIO_PROBE_SECRET' },
}
const registered = catalog.register(rootDraft)
console.log(`CATALOG_REGISTER_RESULT=${registered.kind}`)
if (registered.kind === 'ok') {
  const rowsJson = JSON.stringify(catalog.rows())
  console.log(`CATALOG_ROWS_CONTAINS_SECRET=${rowsJson.includes(secretValue) ? 1 : 0}`)
  const supplied = catalog.supply('SEC-PRB-ROOT', { seconds: 60 })
  console.log(`CATALOG_SUPPLY_RESULT=${supplied.kind}`)
  if (supplied.kind === 'ok') {
    console.log(`HANDLE_KEYS=${JSON.stringify(Object.keys(supplied.value).sort())}`)
    console.log(`HANDLE_HAS_VALUE_FIELD=${Object.prototype.hasOwnProperty.call(supplied.value, 'value') ? 1 : 0}`)
    console.log(`HANDLE_CONTAINS_SECRET=${JSON.stringify(supplied.value).includes(secretValue) ? 1 : 0}`)
  }
}

const valueRefDraft = { ...rootDraft, secretId: 'SEC-PRB-VALUE', logicalReference: secretValue }
const valueRef = catalog.register(valueRefDraft)
console.log(`CATALOG_VALUE_REF_RESULT=${valueRef.kind}`)
if (valueRef.kind === 'err') console.log(`CATALOG_VALUE_REF_SUBCAUSE=${valueRef.error.subcause}`)

const valueKeyDraft = { ...rootDraft, secretId: 'SEC-PRB-KEY', rawValue: secretValue }
const valueKey = catalog.register(valueKeyDraft)
console.log(`CATALOG_VALUE_KEY_RESULT=${valueKey.kind}`)
if (valueKey.kind === 'err') console.log(`CATALOG_VALUE_KEY_SUBCAUSE=${valueKey.error.subcause}`)

// ④ 说明：探针秘密值只存在于进程 env 与注入对象内；本脚本不打印其本体。
//    日志级独立扫描由 run-pb246.mjs 对原始输出再做一遍（发现即标 LEAK 并脱敏）。
console.log('SELF_SCAN_NOTE=probe-value-never-printed-by-this-script')
