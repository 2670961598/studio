/**
 * t01-ticket-report —— 巡检任务书闭环：确定性判分
 *
 * 口径（docs/quality/model-eval.md §2）：验收命令 exit 0；REPORT 有效字符 ≥300；含巡检日期与
 * 任务编号；结论/证据/下一步三小节；证据 ≥3 条；关键事实命中 ≥3；结论须为「告警」（材料里
 * loopLag p90、停滞计数、low 档可用源三项越阈）；plan.md 为计划表格；fixtures 只读未改。
 * rubric 供 LLM 裁判评「报告质量」。
 */
import { join } from 'node:path'
import {
  countEffectiveChars, finish, fixturesUnchanged, hasHeading, keyFactsHit, listItems, normalizeCtx,
  readTextIfExists, sectionOf, stripMd,
} from '../../lib/check-utils.mjs'

export const rubric = [
  '- 结论正确性（4 分）：按任务书阈值判为「告警」，点明三项越阈（loopLag p90 4120ms ≥ 3000ms；STALL+JOB_STALE=4 > 2；low 档可用源 0），且未把 GATE_FAIL（3 ≤ 5，阈内）误判为越阈。',
  '- 证据与可追溯（3 分）：每条证据引用材料中的具体数字/编号（p90、事件 job 号、冷却剩余分钟等），无编造；阈内指标也列出。',
  '- 下一步可执行性（2 分）：每个越阈项都有对应处置（冷却到期复核、停滞单重派/升级、lag 根因排查），含负责 role 与验收口径，且与 plan.md 一致。',
  '- 形式约束（1 分）：巡检日期、任务编号、三小节、字数、验收行齐备。',
].join('\n')

/** 材料里的关键事实（报告至少命中 3 个）。 */
export const KEY_FACTS = ['4120', '9800', 'JOB_STALE', 'GATE_FAIL', 'GLM-5.3-Flash', '212', 'D-123', 'D-116']

export async function check(ctx) {
  const { dir, fixturesSource, run } = normalizeCtx(ctx)
  const report = readTextIfExists(join(dir, 'REPORT.md'))
  const plan = readTextIfExists(join(dir, 'deliverables/plan.md'))
  const acc = run('test -s REPORT.md && test -s deliverables/plan.md', { timeoutMs: 10_000 })
  const text = stripMd(report ?? '')
  const conclusion = stripMd(sectionOf(report, /结论/))
  const evidence = stripMd(sectionOf(report, /证据/))
  const next = stripMd(sectionOf(report, /下一步/))
  const facts = keyFactsHit(KEY_FACTS, text)
  const evidenceItems = Math.max(listItems(evidence), (text.match(/证据\s*[#第]?\s*[1-9１-９]/g) ?? []).length)
  const planLines = (plan ?? '').split('\n').filter((l) => /^\s*\|/.test(l))
  const planHeader = planLines[0] ?? ''
  const planRows = Math.max(0, planLines.length - 2)
  const chars = countEffectiveChars(text)
  const dateOk = /2026-11-23|11[-/月]23/.test(text)
  const sectionsOk = hasHeading(report, '结论') && hasHeading(report, '证据') && hasHeading(report, '下一步')
  const alarm = /告警|越阈|超标|异常/.test(conclusion)
  const claimsNormal = /(结论[:：]?\s*正常|整体正常|一切正常|状态[:：]?\s*正常|无告警|未越阈)/.test(conclusion)

  return finish([
    { id: 'accept-cmd', ok: acc.code === 0, detail: `test -s REPORT.md && test -s deliverables/plan.md → exit=${acc.code ?? acc.signal ?? '?'}` },
    { id: 'report-length', ok: chars >= 300, detail: `REPORT 有效字符 ${chars}（≥300）` },
    { id: 'report-date', ok: dateOk && /(日期|巡检日)/.test(text), detail: `日期值 ${dateOk ? '2026-11-23 ✓' : '缺/错'}；关键词「日期」${/(日期|巡检日)/.test(text) ? '✓' : '缺'}` },
    { id: 'task-id', ok: text.includes('P-117'), detail: '任务编号 P-117' },
    { id: 'sections', ok: sectionsOk, detail: '二级小节 结论 / 证据 / 下一步' },
    { id: 'evidence-count', ok: evidenceItems >= 3, detail: `证据条数 ${evidenceItems}（≥3）` },
    { id: 'facts-hit', ok: facts.hit.length >= 3, detail: `关键事实命中 ${facts.hit.length}/${facts.total}：${facts.hit.join(', ') || '无'}` },
    { id: 'conclusion-alarm', ok: alarm && !claimsNormal, detail: `结论小节：告警=${alarm}，称正常=${claimsNormal}` },
    { id: 'plan-table', ok: /事项/.test(planHeader) && /验收/.test(planHeader) && planRows >= 2, detail: `plan.md 表头含 事项/验收=${/事项/.test(planHeader) && /验收/.test(planHeader)}，数据行 ${planRows}（≥2）` },
    { id: 'fixtures-unchanged', ...fixturesUnchanged(dir, fixturesSource) },
    { id: 'accept-line', ok: /验收[:：]\s*\**\s*(通过|未通过)/.test(report ?? ''), detail: 'REPORT 末尾验收行', required: false },
    { id: 'next-steps', ok: listItems(next) >= 2, detail: `下一步条目 ${listItems(next)}（≥2）`, required: false },
  ])
}
