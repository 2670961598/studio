/**
 * classify.mjs —— 评测台行 → 基准失败分类（纯函数，零 IO）
 *
 * 输入：评测台 report.json（schema `model-eval/v1`）的 rows[] 一行。
 * 输出：基准口径的类别与归属——
 *   cls    类别名（见 CLASSES）
 *   side   'sample'   有效样本（OK / TASK_FAIL）：进能力均值
 *          'model'    模型侧失败：计 0 分进能力均值（SAFETY_REFUSAL / BUDGET / BUDGET:timeout）
 *          'facility' 设施侧失败：不进均值，重试 ≤ k，单列（PROVIDER_ERROR:* / LIMIT:timeout）
 *          'harness'  评测台自身故障：不进均值，必须修后重跑
 *          'unknown'  归不了类：不进均值，须人工看 logs 归类
 *   score  能力分（确定性分 det）；非 sample/model 为 null
 *   detail 短说明（评测台已 redact，这里只截短；不含密钥）
 *   triage true=须人工复核归因
 *
 * 依据：docs/quality/benchmark-business-eval.md §5.3（失败分类与中性处理）。
 */
import { squash } from '../../lib/redact.mjs'

export const CLASSES = Object.freeze([
  'OK', 'TASK_FAIL', 'SAFETY_REFUSAL', 'BUDGET', 'BUDGET:timeout', 'LIMIT:timeout',
  'PROVIDER_ERROR:quota', 'PROVIDER_ERROR:rate_limit', 'PROVIDER_ERROR:server',
  'PROVIDER_ERROR:network', 'PROVIDER_ERROR:auth', 'PROVIDER_ERROR:bad_request',
  'HARNESS_BUG', 'UNKNOWN',
])

/** 评测台 errorClass → 基准设施侧类别（lib/errors.mjs 类目表）。 */
const PROVIDER_CLASSES = new Map([
  ['quota', 'PROVIDER_ERROR:quota'],
  ['rate_limit', 'PROVIDER_ERROR:rate_limit'],
  ['server', 'PROVIDER_ERROR:server'],
  ['network', 'PROVIDER_ERROR:network'],
  ['auth', 'PROVIDER_ERROR:auth'],
])

const SIDES = Object.freeze({
  OK: 'sample', TASK_FAIL: 'sample', SAFETY_REFUSAL: 'model', BUDGET: 'model', 'BUDGET:timeout': 'model',
  'LIMIT:timeout': 'facility', HARNESS_BUG: 'harness', UNKNOWN: 'unknown',
})

/** 类别 → 归属（PROVIDER_ERROR:* 一律 facility）。 */
export function sideOf(cls) {
  if (SIDES[cls] !== undefined) return SIDES[cls]
  if (String(cls).startsWith('PROVIDER_ERROR:')) return 'facility'
  return 'unknown'
}

function out(cls, score, detail, triage = false) {
  return { cls, side: sideOf(cls), score, detail: detail === null || detail === undefined ? null : squash(detail, 160), triage }
}

/**
 * 单行分类。缺行/坏行不抛：落 HARNESS_BUG 或 UNKNOWN（宁可标「不明」不冒认）。
 */
export function classifyRow(row) {
  const r = row ?? {}
  if (typeof r !== 'object' || Array.isArray(r)) return out('HARNESS_BUG', null, 'rows[] 元素不是对象')
  const ec = r.errorClass ?? null
  if (r.status === 'completed') {
    if (r.checkError) return out('HARNESS_BUG', null, `判分脚本异常：${String(r.checkError)}`)
    if (!Array.isArray(r.checks) || r.checks.length === 0) return out('HARNESS_BUG', null, '无检查项（report 结构坏）')
    if (typeof r.deterministicScore !== 'number' || Number.isNaN(r.deterministicScore)) {
      return out('HARNESS_BUG', null, 'deterministicScore 非数值')
    }
    if (r.deterministicPass === true) return out('OK', r.deterministicScore, null)
    const failed = Array.isArray(r.failedChecks) ? r.failedChecks.join(', ') : String(r.failedChecks)
    return out('TASK_FAIL', r.deterministicScore, `未过：${failed}`)
  }
  if (ec === 'refusal' || ec === 'blocked') return out('SAFETY_REFUSAL', 0, r.reason ?? `errorClass=${ec}`)
  if (ec === 'max_tokens') return out('BUDGET', 0, r.reason ?? '达 max tokens')
  if (ec === 'timeout') return out('LIMIT:timeout', null, r.reason ?? '超时（待重试）')
  if (PROVIDER_CLASSES.has(ec)) return out(PROVIDER_CLASSES.get(ec), null, r.reason ?? `errorClass=${ec}`)
  if (ec === 'bad_request') {
    return out('PROVIDER_ERROR:bad_request', null, `${r.reason ?? ''}（需人工归类：若为上下文超限则属模型侧）`, true)
  }
  if (ec === 'harness') return out('HARNESS_BUG', null, r.reason ?? '评测台自身故障')
  return out('UNKNOWN', null, `errorClass=${String(ec)}${r.reason ? `；${r.reason}` : ''}`, true)
}
