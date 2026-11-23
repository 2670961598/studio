/**
 * t06-longctx —— 约 30KB 材料 + 末尾提问：确定性判分
 *
 * 关键事实只在材料中部（S12–S14）；首尾放有同类干扰项（别的档位 / 别的波次 / 被否决的提案）。
 * 六个事实项各一条 required 检查；依据章节与 7 行格式为附加项。
 * 行解析：认 `Q1 拍板人：值` 前缀行（加粗/全角冒号归一）；前缀缺失时退回整段 Q1～Q3 文本（只做正向匹配）。
 */
import { join } from 'node:path'
import { finish, fixturesUnchanged, normalizeCtx, readTextIfExists } from '../../lib/check-utils.mjs'

export const rubric = [
  '- 事实正确（8 分）：Q1 拍板人=宰相执行·叶；Q1 条件=verify:v2 连续 3 天全绿 且 low 档 5h 耗尽率 < 5%（两条同时满足）；Q2 根因=seatbelt 写根未 realpath（/tmp 与 /private/tmp 不一致）；Q2 措施=FIX-17；Q3 上限=8；Q3 处理=先合并子目录，仍超限再拆工位。六项各占分；混入别的档位 / 别的波次 / 被否决提案的说法该项不得分。',
  '- 依据正确（1 分）：依据章节 Q1=S12；Q2=S13；Q3=S14。',
  '- 形式合规（1 分）：answer.md 只含规定的 7 行，行前缀原样。',
].join('\n')

const FIELDS = [
  { q: 1, label: '拍板人' }, { q: 1, label: '(?:生效)?条件' },
  { q: 2, label: '根因' }, { q: 2, label: '措施' },
  { q: 3, label: '上限' }, { q: 3, label: '处理' },
]

/** 按行前缀取字段值；找不到则退回整段 Qn 文本。返回 { value, exact }。 */
export function parseAnswer(raw) {
  const lines = String(raw ?? '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/\*\*/g, '').replace(/__/g, '').trim())
  const isBoundary = (l) => /^(?:>\s*)?Q[1-3]\b/.test(l) || /^依据/.test(l)
  const block = (q) => {
    const start = lines.findIndex((l) => new RegExp(`^Q${q}\\b`).test(l))
    if (start === -1) return ''
    const out = [lines[start].replace(new RegExp(`^Q${q}\\s*[:：]?\\s*`), '')]
    for (const l of lines.slice(start + 1)) {
      if (isBoundary(l)) break
      out.push(l)
    }
    return out.join('\n')
  }
  const fields = FIELDS.map(({ q, label }) => {
    const re = new RegExp(`^Q${q}\\s*${label}\\s*[:：]?\\s*(.*)$`)
    const idx = lines.findIndex((l) => re.test(l))
    if (idx === -1) return { q, label, value: block(q), exact: false }
    const out = [re.exec(lines[idx])[1]]
    for (const l of lines.slice(idx + 1)) {
      if (isBoundary(l) || FIELDS.some(({ q: qq, label: ll }) => new RegExp(`^Q${qq}\\s*${ll}\\s*[:：]?\\s*(.*)$`).test(l))) break
      out.push(l)
    }
    return { q, label, value: out.join('\n'), exact: true }
  })
  const citeLine = lines.find((l) => /^依据(?:章节)?\s*[:：]/.test(l)) ?? ''
  const cite = (q) => {
    const m = new RegExp(`Q${q}\\s*[==:：]\\s*(S\\s*\\d{1,2}|§\\s*[\\p{L}]+)`, 'u').exec(citeLine.replace(/\s+/g, ''))
    return m === null ? null : m[1].replace(/\s+/g, '').toUpperCase()
  }
  return { lines, fields, citations: { 1: cite(1), 2: cite(2), 3: cite(3) }, hasCiteLine: citeLine !== '' }
}

const has = (re, text) => re.test(String(text ?? '').replace(/\s+/g, ''))

export async function check(ctx) {
  const { dir, fixturesSource } = normalizeCtx(ctx)
  const raw = readTextIfExists(join(dir, 'answer.md'))
  const a = parseAnswer(raw ?? '') // 缺文件时各字段为空，逐项判负而不抛
  const f = (q, label) => a.fields.find((x) => x.q === q && x.label.replace('(?:生效)?', '') === label)
  const q1p = f(1, '拍板人'), q1c = f(1, '条件'), q2r = f(2, '根因'), q2m = f(2, '措施'), q3l = f(3, '上限'), q3h = f(3, '处理')

  const q1pOk = has(/叶|宰相执行/, q1p.value) && !(q1p.exact && has(/制作人(拍板|亲自)|由制作人定/, q1p.value))
  const q1cOk = has(/(?<![\d.])(?:3|三)天/u, q1c.value) && has(/5%/, q1c.value)
  const q2rOk = has(/realpath|符号链接|软链|\/private\/tmp/i, q2r.value)
  const q2mOk = has(/FIX-?17/i, q2m.value)
  const q3lOk = has(/(?<![\d.])8(?![\d.%])/u, q3l.value) && !has(/上限(?:为|是|:|=|调整到|提到|改为)?(12|4)(?![\d.%])/u, q3l.value)
  const q3hOk = has(/合并/, q3h.value) && has(/拆/, q3h.value)
  const citeOk = a.citations[1] === 'S12' && a.citations[2] === 'S13' && a.citations[3] === 'S14'
  const nonEmpty = a.lines.filter((l) => l !== '')
  const fmtOk = a.fields.every((x) => x.exact) && a.hasCiteLine && nonEmpty.length <= 7
  const show = (x) => (x.exact ? x.value : `（未按前缀行作答，取整段）${x.value.slice(0, 80)}`)

  return finish([
    { id: 'answer-exists', ok: raw !== null && raw.trim() !== '', detail: raw === null ? '缺 answer.md' : `answer.md ${raw.length} 字符` },
    { id: 'q1-person', ok: q1pOk, detail: `${show(q1p)}｜期望：宰相执行·叶（不是制作人）` },
    { id: 'q1-condition', ok: q1cOk, detail: `${show(q1c)}｜期望：verify:v2 连续 3 天全绿 且 low 档 5h 耗尽率 < 5%` },
    { id: 'q2-rootcause', ok: q2rOk, detail: `${show(q2r)}｜期望：seatbelt 写根未 realpath（/tmp 与 /private/tmp 不一致）` },
    { id: 'q2-fix', ok: q2mOk, detail: `${show(q2m)}｜期望：FIX-17` },
    { id: 'q3-limit', ok: q3lOk, detail: `${show(q3l)}｜期望：8（不是早期的 4，也不是被否决的 12）` },
    { id: 'q3-handling', ok: q3hOk, detail: `${show(q3h)}｜期望：先合并子目录，仍超限再拆工位` },
    { id: 'fixtures-unchanged', ...(await fixturesUnchanged(dir, fixturesSource)) },
    { id: 'citations', ok: citeOk, detail: `依据章节 ${JSON.stringify(a.citations)}｜期望 Q1=S12；Q2=S13；Q3=S14`, required: false },
    { id: 'format-lines', ok: fmtOk, detail: fmtOk ? '7 行前缀齐全' : `前缀行 ${a.fields.filter((x) => x.exact).length}/6，非空行 ${nonEmpty.length}（含依据行 ${a.hasCiteLine ? '有' : '无'}）`, required: false },
  ])
}
