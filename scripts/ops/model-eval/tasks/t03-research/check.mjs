/**
 * t03-research —— 三份材料 → 本周平台风险 Top3：确定性判分
 *
 * 口径（docs/quality/model-eval.md §2）：report.md 存在；关键数字命中 ≥3（required）；
 * 出处标记 ≥3 处且覆盖 ≥2 个来源（required）；编号风险 ≥3 条（required）；fixtures 未改（required）；
 * 字数 400-600（±10% 容差，附加项）；「建议关注」小节（附加项）；无多余文件（附加项）。
 * 风险取舍与排序这类主观面交给 rubric + LLM 裁判。
 */
import { join } from 'node:path'
import {
  countEffectiveChars, finish, fixturesUnchanged, keyFactsHit, listFiles, listItems, normalizeCtx,
  readTextIfExists, sectionOf, stripMd,
} from '../../lib/check-utils.mjs'

export const rubric = [
  '- 风险识别与排序（4 分）：抓住材料指向的主要风险（mid 档单源 + opencode-go 额度见底；GATE_FAIL 上升且 verify:v2 重复失败；STALL 集中于 S2 泳道 / loopLag 峰值；high 档成本占比），严重度排序有依据，不把阈内项当风险。',
  '- 事实与出处（3 分）：每条风险都有材料里的具体数字，且出处标记指向正确的来源（不张冠李戴）；无编造数字。',
  '- 影响面与可用性（2 分）：影响面具体（哪档、哪泳道、哪类任务），高管一眼能看懂。',
  '- 形式约束（1 分）：400-600 字、编号三条、建议关注只写观察项不写处置。',
].join('\n')

/** 三份材料里的关键数字（报告至少命中 3 个；比对时忽略空白与 markdown 强调符）。 */
export const KEY_FACTS = ['92.4', '3.1', '12.40', '19.80', '17 次', '61%']

export async function check(ctx) {
  const { dir, fixturesSource } = normalizeCtx(ctx)
  const raw = readTextIfExists(join(dir, 'report.md'))
  const text = stripMd(raw ?? '')
  const chars = countEffectiveChars(text)
  const facts = keyFactsHit(KEY_FACTS, text)
  const markers = [...text.matchAll(/[［\[]\s*([ABC])\s*[］\]]/g)].map((m) => m[1])
  const sources = new Set(markers)
  const adviceRaw = sectionOf(raw, /建议/)
  const body = adviceRaw === '' ? text : stripMd(raw.slice(0, raw.indexOf(adviceRaw)))
  const numbered = (body.match(/^\s*\d+[.、)）]\s*\S/gm) ?? []).length
  const topMarkers = (body.match(/(?:Top|风险)\s*[1-3１-３一二三]/gi) ?? []).length
  const topItems = Math.max(numbered, topMarkers)
  const advice = stripMd(adviceRaw)
  const extras = listFiles(dir).filter((f) => !f.startsWith('fixtures/'))

  return finish([
    { id: 'report-exists', ok: typeof raw === 'string' && raw.trim() !== '', detail: 'report.md 非空' },
    { id: 'key-facts', ok: facts.hit.length >= 3, detail: `关键数字命中 ${facts.hit.length}/${facts.total}：${facts.hit.join(', ') || '无'}` },
    { id: 'citations', ok: markers.length >= 3 && sources.size >= 2, detail: `出处标记 ${markers.length} 处（≥3），来源 ${sources.size} 个（≥2）：${[...sources].join('') || '无'}` },
    { id: 'top3', ok: topItems >= 3, detail: `编号风险条目 ${topItems}（≥3）` },
    { id: 'fixtures-unchanged', ...fixturesUnchanged(dir, fixturesSource) },
    { id: 'length-range', ok: chars >= 360 && chars <= 660, detail: `有效字符 ${chars}（目标 400-600，容差 360-660）`, required: false },
    { id: 'advice-section', ok: advice !== '' && listItems(advice) >= 2, detail: `「建议关注」${advice === '' ? '缺' : `条目 ${listItems(advice)}`}（≥2）`, required: false },
    { id: 'no-extra-files', ok: extras.every((f) => f === 'report.md'), detail: `工位根文件：${extras.join(', ') || '无'}`, required: false },
  ])
}
