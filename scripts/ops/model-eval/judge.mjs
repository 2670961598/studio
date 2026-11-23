/**
 * judge.mjs —— LLM 裁判的 prompt 构造与作答解析（纯函数；发起调用由 evaluate.mjs 经注入的 exec）
 *
 * 口径（docs/quality/model-eval.md §3）：裁判固定为独立于被测的模型（缺省 glm/GLM-5.4），
 * 按 0-10 评分依据打分并给理由；只输出一行 JSON。裁判失败不阻塞——该格 judgeScore=null，
 * 汇总时该格按确定性分计。裁判与被测同模型时行上标 judgeSelf=true（不独立，读报告时降权）。
 */

export const MAX_ARTIFACTS = 8
export const MAX_ARTIFACT_BYTES = 6_000
export const MAX_PROMPT_BYTES = 3_000
export const MAX_REASON_CHARS = 160

function clip(text, max) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}\n…（截断，共 ${s.length} 字符）` : s
}

/** artifacts: [{ path, content }]。 */
export function buildJudgePrompt({ taskId, taskPrompt, rubric, artifacts = [] }) {
  const blocks = artifacts
    .slice(0, MAX_ARTIFACTS)
    .map((a) => `### ${a.path}\n\`\`\`\n${clip(a.content, MAX_ARTIFACT_BYTES)}\n\`\`\``)
    .join('\n\n')
  return [
    `你是任务 ${taskId} 的裁判，给被测模型的产物打「业务质量」分。只输出一行 JSON，不要输出其它内容：`,
    '{"score": <0-10 的整数>, "reason": "<不超过 120 字的中文理由>"}',
    '',
    '评分依据（满分 10 分）：',
    rubric,
    '',
    '评分纪律：',
    '- 只评业务质量：结论是否正确、证据是否引用材料、动作是否可执行、是否遵守任务约束。',
    '- 产物明显错误或不可用 ≤3 分；有缺陷但可用 4-7 分；完整正确且可直接采用 ≥8 分。',
    '- 不因写作风格、措辞偏好加减分；不确定时给中分并写明疑点。',
    '- 不要调用任何工具，不要读写文件，直接作答。',
    '',
    '【任务说明（节选）】',
    clip(taskPrompt, MAX_PROMPT_BYTES),
    '',
    '【被测模型的产物】',
    blocks === '' ? '（无产物）' : blocks,
  ].join('\n')
}

function toScore(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(10, Math.max(0, Math.round(n)))
}

/** 找 start 处 '{' 配平的 '}' 下标（跳过 JSON 字符串内部与转义）；找不到 → -1。 */
function matchBrace(s, start) {
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 一段文本若是带数值 score 的顶层 JSON 对象 → {score, reason}；否则 null。 */
function scoreOf(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
  const score = toScore(obj.score)
  if (score === null) return null
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, MAX_REASON_CHARS) : ''
  return { score, reason }
}

/**
 * 解析裁判作答：取文本里第一个带数值 score 的**顶层** JSON 对象 {score, reason}（分数四舍五入并夹到 0-10）。
 * 先整段解析（可带 ``` 围栏），失败再按花括号配平逐个起点试——理由里带花括号不误伤；
 * 整体可解析却没有 score 的（如嵌套对象）视为不合作答，不往里挖。解析不出 → null（调用方记 judgeError=parse，不阻塞）。
 */
export function parseJudgeAnswer(text) {
  const s = String(text ?? '')
  const whole = scoreOf(s.replace(/^\s*```(?:json)?\s*\n?|\n?```\s*$/g, '').trim())
  if (whole !== null) return whole
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue
    const end = matchBrace(s, i)
    if (end === -1) continue
    const r = scoreOf(s.slice(i, end + 1))
    if (r !== null) return r
    const parsed = safeObject(s.slice(i, end + 1))
    if (parsed) i = end // 已是一个合法对象但没 score：跳过整体，不挖嵌套
  }
  return null
}

function safeObject(text) {
  try {
    const obj = JSON.parse(text)
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj)
  } catch {
    return false
  }
}
