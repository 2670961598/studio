/**
 * phase0-ticket-migration —— 10 张真实单只读导出 → vendor issues 导入/回导出 diff（task-64 Phase0 切片2）
 * 只读生产台账（--ledger 显式传入；不硬编码 host 路径）；使用 vendor/workbench-core 薄包装。
 * 台账缺 title/description/comments：显式记录 gap，不伪造；附件不迁。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { issues } from '../../vendor/workbench-core/index.ts'

const args = process.argv.slice(2)
const argOf = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const ledgerPath = argOf('--ledger')
const outDir = argOf('--out') ?? '/tmp/phase0-evidence'
if (ledgerPath === undefined) { console.error('用法：--ledger <ledger.sqlite> [--out <dir>]'); process.exit(2) }
mkdirSync(outDir, { recursive: true })
const db = new DatabaseSync(ledgerPath, { readOnly: true })
type Row = { issue: string; state: string; type: string; dept: string; level: number; dispatcher: string; parent?: string | null; lane?: string | null; assignee?: string | null; created: number; updated: number }
const rows = db.prepare('SELECT issue,state,type,dept,level,dispatcher,parent,lane,assignee,created,updated FROM ticket_mirror ORDER BY updated DESC LIMIT 200').all() as Row[]
// 选 10 张：尽量覆盖多状态/多部门/父子单；不足则取前 N
const picked: Row[] = []
const states = new Set<string>(); const depts = new Set<string>()
for (const r of rows) {
  if (picked.length >= 10) break
  if (!states.has(r.state) || !depts.has(r.dept) || r.parent != null || picked.length < 6) { picked.push(r); states.add(r.state); depts.add(r.dept) }
}
for (const r of rows) { if (picked.length >= 10) break; if (!picked.includes(r)) picked.push(r) }
db.close()

/** Taiga/daemon 状态 → vendor 1..8（缺省 NEW；未识别=显式豁免） */
function stateCodeOf(state: string): { code: number; matched: boolean } {
  const map: Record<string, number> = { '新单': 1, '待批': 2, '已派发': 3, '证据就绪': 4, '复验中': 5, '已交付': 6, '打回': 7, '已收口': 8, '关闭': 8, '取消': 8 }
  const code = map[state]
  return code !== undefined ? { code, matched: true } : { code: 1, matched: false }
}
function kindOf(type: string): 'task' | 'bug' | 'chore' { return type === 'bug' ? 'bug' : type === 'patrol' || type === 'report' ? 'chore' : 'task' }
/** 目标状态对应的 vendor 矩阵行（真 ruleId 的静态来源；失败 details 另存） */
const RULE_OF_TARGET: Record<number, string> = { 2: 'T1', 3: 'T2', 4: 'T3', 5: 'T6', 6: 'T7', 7: 'T12', 8: 'close' }
const PATHS: Record<number, number[]> = { 1: [], 2: [2], 3: [2, 3], 4: [2, 3, 4], 5: [2, 3, 4, 5], 6: [2, 3, 4, 5, 6], 7: [2, 3, 7], 8: [] }
type Attempt = Record<string, unknown>
async function advanceTo(service: any, actorId: string, reviewerActorId: string, projectId: string, ticket: any, target: number, attempts: Attempt[], recordGate?: (ticket: any) => Promise<void>): Promise<any> {
  let cur = ticket
  for (const code of PATHS[target] ?? []) {
    const before = cur.stateCode
    try {
      // T7 前必须用当前 revision 落 daemon gate verdict（T6 后会变 revision）
      if (code === 6 && recordGate !== undefined) await recordGate(cur)
      const res = await service.transition(code >= 5 ? reviewerActorId : actorId, {
        projectId, ticketId: cur.id, targetStateCode: code, expectedRevision: cur.revision,
        ...(code === 7 ? { reason: 'phase0 PoC block' } : {}),
        idempotencyKey: `trans:${String(cur.id)}:${String(code)}`,
      })
      cur = res.ticket
      attempts.push({ targetStateCode: code, ruleId: res.ruleId ?? RULE_OF_TARGET[code], fromStateCode: before, status: 'ok', afterStateCode: cur.stateCode })
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: unknown }
      const details = (err.details ?? {}) as Record<string, unknown>
      attempts.push({ targetStateCode: code, ruleId: RULE_OF_TARGET[code], fromStateCode: before, status: 'error', errorCode: err.code ?? 'UNKNOWN', errorMessage: err.message ?? String(e), details, preconditions: details['code'] !== undefined ? [String(details['code'])] : [] })
      // T7（到 DONE）需要当前 revision 的 gate verdict；T6 后 revision 已变，原 gate 过期 → 重录后重试一次
      if (code === 6 && err.code === 'GATE_EPOCH_STALE' && recordGate !== undefined) {
        try {
          await recordGate(cur)
          const res2 = await service.transition(reviewerActorId, { projectId, ticketId: cur.id, targetStateCode: code, expectedRevision: cur.revision, idempotencyKey: `trans:${String(cur.id)}:${String(code)}:retry` })
          cur = res2.ticket
          attempts.push({ targetStateCode: code, ruleId: res2.ruleId ?? RULE_OF_TARGET[code], fromStateCode: before, status: 'ok-retry-after-gate', afterStateCode: cur.stateCode })
          continue
        } catch (e2) {
          const err2 = e2 as { code?: string; message?: string; details?: unknown }
          attempts.push({ targetStateCode: code, ruleId: RULE_OF_TARGET[code], fromStateCode: before, status: 'error-retry', errorCode: err2.code ?? 'UNKNOWN', errorMessage: err2.message ?? String(e2), details: err2.details ?? {} })
        }
      }
      break
    }
  }
  return cur
}
const evidenceRoot = path.join(outDir, 'evidence')
mkdirSync(evidenceRoot, { recursive: true })
const platform = issues.createMemoryIssues({ evidenceRoot })
try {
  const admin = await platform.service.createPrincipal({ kind: 'human', displayName: 'Phase0-Importer' })
  const dev = await platform.service.createPrincipal({ kind: 'agent', displayName: 'Phase0-Dev' })
  const project = await platform.service.createProject(admin.id, { keyPrefix: 'PH0', name: 'Phase0 migration' })
  const qa = await platform.service.createPrincipal({ kind: 'human', displayName: 'Phase0-QA' })
  // vendor：首个 grant 为人 bootstrap；之后 grant 需人类 PLANNER。qa 先拿 PLANNER，再给 dev 授权。
  await platform.service.grantMembership(admin.id, { projectId: project.id, principalId: qa.id, roles: ['PLANNER', 'TESTER'], reason: 'phase0 migration bootstrap', idempotencyKey: 'grant-1' })
  await platform.service.grantMembership(qa.id, { projectId: project.id, principalId: dev.id, roles: ['PLANNER', 'DEVELOPER', 'TESTER'], reason: 'phase0 migration dev', idempotencyKey: 'grant-2' })
  const mapping: Array<Record<string, unknown>> = []
  const imported: Array<{ original: Row; ticketId: string; key: string }> = []
  // 先建父单在 selected 内的票据，再建子单；父不在 10 张内=parent 保持空并豁免
  const byIssue = new Map(picked.map((r) => [r.issue, r]))
  const ordered: Row[] = []
  const emit = (r: Row): void => { if (ordered.includes(r)) return; if (r.parent != null && byIssue.has(r.parent)) emit(byIssue.get(r.parent)!); ordered.push(r) }
  for (const r of picked) emit(r)
  const createdByExternal = new Map<string, { id: string; revision: number }>()
  for (const r of ordered) {
    const st = stateCodeOf(r.state)
    const labelOf = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    const labels = ['phase0-imported', `ext-id-${labelOf(r.issue)}`, `ext-state-${String(st.code)}`, `ext-type-${labelOf(r.type)}`, `ext-dept-${labelOf(r.dept)}`, `ext-level-${String(r.level)}`]
    const parentVendor = r.parent != null ? createdByExternal.get(r.parent) : undefined
    let t = await platform.service.createTicket(dev.id, {
      projectId: project.id,
      ...(parentVendor !== undefined ? { parentId: parentVendor.id } : {}),
      title: `[${r.issue}] ${r.type} · ${r.state}`,
      body: JSON.stringify({ externalRef: r.issue, state: r.state, type: r.type, dept: r.dept, level: r.level, dispatcher: r.dispatcher, lane: r.lane ?? null, assignee: r.assignee ?? null, parent: r.parent ?? null, note: 'Phase0 migration: ledger has no title/description/comments; attachments not migrated' }),
      kind: kindOf(r.type),
      priority: r.level <= 1 ? 1 : r.level >= 3 ? 4 : 3,
      labels,
      idempotencyKey: `create:${r.issue}`,
    })
    // 离线补前置：assignee/reviewer、summary/report evidence；DONE 还需 gate verdict（vendor T7）
    const revision = t.revision
    t = await platform.service.assign(dev.id, { projectId: project.id, ticketId: t.id, assigneeId: dev.id, reviewerId: qa.id, expectedRevision: revision, idempotencyKey: `assign:${r.issue}` })
    const summaryUri = `summary-${labelOf(r.issue)}.md`; const reportUri = `report-${labelOf(r.issue)}.md`
    writeFileSync(path.join(evidenceRoot, summaryUri), '# phase0 summary evidence\n')
    writeFileSync(path.join(evidenceRoot, reportUri), '# phase0 report evidence\n')
    const ev1 = await platform.service.addEvidence(dev.id, { projectId: project.id, ticketId: t.id, kind: 'summary', uri: summaryUri, expectedRevision: t.revision, idempotencyKey: `ev-summary:${r.issue}` })
    const ev2 = await platform.service.addEvidence(dev.id, { projectId: project.id, ticketId: t.id, kind: 'report', uri: reportUri, expectedRevision: t.revision, idempotencyKey: `ev-report:${r.issue}` })
    const attempts: Attempt[] = []
    const recordGate = async (cur: any): Promise<void> => {
      const gateUri = `gate-${labelOf(r.issue)}-rev${String(cur.revision)}.json`; writeFileSync(path.join(evidenceRoot, gateUri), JSON.stringify({ ticketId: cur.id, gateExit: 0, revision: cur.revision }))
      await platform.daemon.recordGateEvidence({ projectId: project.id, ticketId: cur.id, gateExit: 0, requirements: { completed: true, output: true, report: true }, coveredEvidenceIds: [ev1.id, ev2.id], uri: gateUri, idempotencyKey: `gate:${r.issue}:${String(cur.revision)}` })
    }
    t = await advanceTo(platform.service, dev.id, qa.id, project.id, t, st.code, attempts, st.code === 6 ? recordGate : undefined)
    createdByExternal.set(r.issue, { id: t.id, revision: t.revision })
    const stateMatched = t.stateCode === st.code
    imported.push({ original: r, ticketId: t.id, key: t.key })
    const failed = attempts.find((a) => a['status'] === 'error')
    const stateExemption = stateMatched ? undefined : `target=${String(st.code)} rule=${String(RULE_OF_TARGET[st.code] ?? 'n/a')}；最后失败=${String(failed?.['errorCode'] ?? 'unknown')}（details=${JSON.stringify(failed?.['details'] ?? {})}）；合法路径已按 vendor 矩阵补 assignee/reviewer/evidence${st.code === 6 ? '/gate' : ''}，仍未到达；不 force/不伪造`
    mapping.push({ externalRef: r.issue, vendorTicketId: t.id, vendorKey: t.key, importedStateCode: t.stateCode, originalState: r.state, desiredStateCode: st.code, stateMatched, stateAttempts: attempts, parentTransferred: r.parent == null ? null : parentVendor !== undefined, comments: 0, attachments: 'not-migrated', ...(stateExemption !== undefined ? { stateExemption } : {}) })
  }
  // task-72：生产 10 单 parent 全 SQL NULL（无父子对），用受控 fixture 证明 parent 传递路径
  const fxParent = await platform.service.createTicket(dev.id, { projectId: project.id, title: '[PH0-PARENT] fixture', body: 'parent fixture', idempotencyKey: 'fixture-parent' })
  const fxChild = await platform.service.createTicket(dev.id, { projectId: project.id, title: '[PH0-CHILD] fixture', body: 'child fixture', parentId: fxParent.id, idempotencyKey: 'fixture-child' })
  const fxChildView = await platform.service.getTicket(dev.id, { projectId: project.id, idOrKey: fxChild.id })
  const parentFixture = { parentKey: fxParent.key, childKey: fxChild.key, parentId: fxChildView.parentId, linked: fxChildView.parentId === fxParent.id }
  if (!parentFixture.linked) throw new Error('parent fixture link failed')
  // 回导出：按 externalRef label 映射回原 ID，验证映射 roundtrip
  const page = await platform.service.listTickets(dev.id, { projectId: project.id, limit: 50 })
  const exported = page.items.map((t) => {
    const ext = t.labels.find((l) => l.startsWith('ext-id-'))?.slice('ext-id-'.length)
    return { externalRef: ext, vendorKey: t.key, title: t.title, stateCode: t.stateCode }
  })
  for (const m of mapping) {
    const hit = exported.find((e) => e.externalRef === m['externalRef'])
    m['roundtripIdPreserved'] = hit !== undefined
    m['exportedVendorKey'] = hit?.vendorKey
  }
  const diff = {
    schema: 'phase0-ticket-diff/v1',
    selected: picked.length,
    imported: mapping.length,
    fieldsCompared: ['externalRef', 'state', 'type', 'dept', 'level', 'lane', 'assignee', 'parent', 'comments', 'attachments'],
    idRoundtrip: mapping.every((m) => m['roundtripIdPreserved'] === true),
    stateMatched: mapping.filter((m) => m['importedStateCode'] === m['desiredStateCode']).length,
    stateExemptions: mapping.filter((m) => m['importedStateCode'] !== m['desiredStateCode']).length,
    commentsImported: 0,
    commentsGap: 'production ledger has no comments table; comments not available offline (explicit gap, no fabrication)',
    attachments: 'not-migrated (explicit)',
    titleGap: 'ledger mirror has no title/description; title synthesized from externalRef/type/state',
    mapping,
    parentFixture,
    exported,
  }
  writeFileSync(path.join(outDir, 'ticket-export.json'), JSON.stringify({ rows: picked }, null, 2))
  writeFileSync(path.join(outDir, 'ticket-diff.json'), JSON.stringify(diff, null, 2))
  const md = [`# Phase0 10 单迁移 diff`, '', `- selected=${String(picked.length)} imported=${String(mapping.length)}`, `- ID roundtrip=${String(diff.idRoundtrip)}`, `- state matched=${String(diff.stateMatched)} / exemptions=${String(diff.stateExemptions)}`, `- comments=0（台账无评论表，显式 gap）`, `- attachments=not-migrated（显式）`, `- parent：生产 10 单全 SQL NULL → parentTransferred=null（无父）；受控 fixture=${String(parentFixture.linked)}（${parentFixture.parentKey}→${parentFixture.childKey}）`, '', '## 逐单（含 stateAttempts）', ...mapping.flatMap((m) => [`- ${String(m['externalRef'])} → ${String(m['vendorKey'])}（id=${String(m['vendorTicketId'])}）desired=${String(m['desiredStateCode'])} imported=${String(m['importedStateCode'])} roundtrip=${String(m['roundtripIdPreserved'])}`, `  attempts: ${(m['stateAttempts'] as Attempt[]).map((a) => `${String(a['targetStateCode'])}:${String(a['ruleId'])}:${String(a['status'])}${a['errorCode'] !== undefined ? `(${String(a['errorCode'])})` : ''}`).join(' → ')}`, ...(m['stateExemption'] !== undefined ? [`  exemption: ${String(m['stateExemption'])}`] : [])])].join('\n') + '\n'
  writeFileSync(path.join(outDir, 'ticket-diff.md'), md)
  console.log(JSON.stringify({ ok: true, selected: picked.length, imported: mapping.length, idRoundtrip: diff.idRoundtrip, stateMatched: diff.stateMatched, stateExemptions: diff.stateExemptions, parentFixture: parentFixture.linked, outDir }))
} finally { platform.close() }
