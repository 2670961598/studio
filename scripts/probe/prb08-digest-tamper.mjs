#!/usr/bin/env node
/**
 * prb08-digest-tamper.mjs —— PRB-08「投影摘要/签名校验 fail-closed」可执行腿
 *
 * 依据：docs/v2/12 §1.6/§5.3 PRB-08；docs/v2/15 SEC-SIG-04。
 * 边界：本脚本只验证**摘要复算能检出单字节篡改**（生成器自带能力）；签名/验签通道
 *       （SEC-SIG-04）未建，投影无加载器/启动器，故「篡改一字节→拒载＋不 spawn」
 *       整行仍不可执行——本脚本输出只作 PRB-08 的「已取到腿」，不构成整行通过。
 *
 * 用法（bun）：
 *   mise exec -- bun scripts/probe/prb08-digest-tamper.mjs --repo <repo>
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') out.repo = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const repo = path.resolve(args.repo ?? process.cwd())
const { compileProjection, projectionDigest, projectionGate } = await import(
  pathToFileURL(path.join(repo, 'packages/core/src/prm/compile-projection.ts')).href
)

const input = {
  companyId: 'company:probe',
  workRef: 'work:pb-2-prb-08',
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

const built = compileProjection(input)
console.log(`CASE=build RESULT=${built.kind}`)
if (built.kind === 'err') {
  console.log(`BUILD_SUBCAUSE=${built.error.subcause}`)
  process.exit(1)
}

const projection = built.value
console.log(`ORIGINAL_DIGEST=${projection.digest}`)
console.log(`ORIGINAL_GATE_LAUNCHABLE=${projectionGate(projection).launchable ? 1 : 0}`)

// 单字节篡改：只改 identity.sourceRefs[0] 的一个字符（company:probe -> company:probf）
const tampered = JSON.parse(JSON.stringify(projection))
const ref = tampered.segments.identity.sourceRefs[0]
const last = ref.slice(-1)
const mutated = ref.slice(0, -1) + (last === 'e' ? 'f' : 'e')
tampered.segments.identity.sourceRefs[0] = mutated
console.log(`TAMPER_FIELD=segments.identity.sourceRefs[0]`)
console.log(`TAMPER_BEFORE=${ref}`)
console.log(`TAMPER_AFTER=${mutated}`)

const recomputed = projectionDigest(tampered)
console.log(`TAMPERED_DIGEST_RESULT=${recomputed.kind}`)
if (recomputed.kind === 'ok') {
  console.log(`TAMPERED_DIGEST=${recomputed.value}`)
  console.log(`DIGEST_MATCH=${recomputed.value === projection.digest ? 1 : 0}`)
}
console.log(`TAMPERED_GATE_LAUNCHABLE=${projectionGate(tampered).launchable ? 1 : 0}`)
console.log('SIGNATURE_VERIFIER_INVOKED=0（SEC-SIG-04 通道未建；本脚本不伪造验签）')
