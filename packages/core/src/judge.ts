/**
 * judge —— micro-judge 原语·纯判定面：词表结构 + 三道闸 parseJudgeVerdict
 *
 * 依据（studio-dev-160 提案 §6.1，制作人 2026-10-22 全批——docs/49 落档；单 164=§6.7 单A）：
 *   - micro-judge = 框架组装结构化上下文 → 低档小模型**只回一个 JSON 对象** `{操作,参数}`
 *     （词表由调用方冻结）→ 框架侧三道闸校验 → 采纳或降级机械规则。判断调用**零产出/
 *     零凭据/零生命周期**（不进收割契约——docs/17-§6 micro-judge 注记）。
 *   - 三道闸（§6.1 输出侧，本文件全部机制化）：
 *       闸① 严格 JSON 闸：输出必须能被 JSON.parse 解析为单一对象 `{op: string,
 *           params: object}`——前后缀噪声（markdown 围栏/解说文字）拒收；
 *       闸② op 枚举闸：op 必须 ∈ 调用方冻结词表（模型无词表扩展权）；
 *       闸③ params 域闸：未知键拒绝 + 每键过域约束（enum 值必须 ∈ 上下文候选集
 *           ——候选集语义细化，不是任意枚举；string 非空串；string-list 全非空串）。
 *   - 三闸任一失败 → ClassifiedError（category=LLM_FAIL，subcause=judge/*）——
 *     处置语义分叉：**立即降级机械规则，不重试**（17-§9 LLM_FAIL 处置语义的 judge 消费，
 *     上层调用库按 fallback 原因落 JUDGE_FALLBACK 事件）。
 *   - 词表语义白名单（§8-S10）：判断语义=选择/排序/过滤，白名单外语义（delegate/
 *     assign/create/update/close/priority…）**注册即拒**——防 site 注册时混入未过审语义
 *     （判断调用是决策辅助不是决策本体，越权语义结构性挡在词表层）。
 *
 * 纯函数纪律：本模块零 IO（createHash 同 models.ts 指纹同款确定性用法）；时钟/随机
 * 全不在场；同输入恒同输出（可进契约 mj 域——cases.json C-mj-001..006）。
 * IO 面（合成 brief/一次性工作区/三帽落账/JUDGE_* 事件/超时杀）归 daemon engine/judge/
 * （判断调用库，单 164）；本文件只回答「这段输出按这个词表算不算合法裁决」。
 */
import { createHash } from 'node:crypto'
import type { ClassifiedError } from '@studio-next/contract'

// ————————————————————————— 词表结构（调用方冻结面） —————————————————————————

/**
 * 单个参数键的域约束（闸③ 的判定依据）：
 *   - enum：值必须 ∈ values——values 是**本次调用的上下文候选集**（语义细化面：
 *     候选=框架从状态组装的真实对象，不是模型自由发挥的枚举）；
 *   - string：任意非空串（如搜索词/摘要键——无候选集的开放参数）；
 *   - string-list：非空串数组（如排序键清单/多选清单）。
 * strict 语义：域之外的键值形态（number/boolean/嵌套对象）一律拒收——判断输出是
 * 机器消费面，宽松解析=把类型错误留给下游爆炸。
 */
export type JudgeParamDomain =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'string' }
  | { readonly kind: 'string-list' }

/** 词表操作项：op + 参数键域表（键集即闸③ 的严格键集） */
export interface JudgeOpSpec {
  readonly op: string
  readonly params: Readonly<Record<string, JudgeParamDomain>>
}

/** 判断词表：一址一组、注册时冻结（指纹进 JUDGE_OK 事件可观测） */
export interface JudgeVocab {
  readonly ops: readonly JudgeOpSpec[]
}

/** 合法裁决（三闸全过后的采纳面；params 值形态由词表域定） */
export interface JudgeOpVerdict {
  readonly op: string
  readonly params: Readonly<Record<string, string | readonly string[]>>
}

// ————————————————————————— 语义白名单（注册闸，§8-S10） —————————————————————————

/**
 * 判断操作语义白名单（§6.1 示例集冻结）：选择（pick）/排序（order）/截前（front）/
 * 追加（append）/收集（collect）/跳过（skip）——选择·排序·过滤语义。
 * 白名单只增不减，增项走批示（词表=判断力的边界，边界改动是治理动作不是代码动作）。
 */
export const JUDGE_OP_SEMANTIC_WHITELIST: readonly string[] = [
  'pick',
  'order',
  'front',
  'append',
  'collect',
  'skip',
]

/**
 * 近黑名单（报错提效面，非第二闸）：这些名字是**任务执行/编排语义**，与判断语义相斥
 * ——命中时给「这是越权语义不是拼写错误」的明确错误（区别于白名单外的普通未过审名）。
 */
export const JUDGE_OP_SEMANTIC_NEAR_BLACKLIST: readonly string[] = [
  'delegate',
  'assign',
  'create',
  'update',
  'close',
  'priority',
]

/**
 * 词表注册闸（site 注册时调用，CONFIG_INVALID 拒坏词表——配置类错误不静默）：
 *   - op 必须 ∈ 语义白名单（近黑名单命中给越权语义明确错误）；
 *   - op 去重（重复=词表自相矛盾）；ops 非空；
 *   - enum 域 values 非空且去重（空候选集的 enum=闸③ 恒拒的陷阱词表）；
 *   - 参数键去重（对象键天然去重，显式校验防手构对象绕过）。
 */
export function assertJudgeVocab(vocab: JudgeVocab): void {
  if (vocab.ops.length === 0) {
    configInvalidJudge('judge/vocab-empty', '词表 ops 为空——判断调用必须有至少一个冻结操作')
  }
  const seen = new Set<string>()
  for (const spec of vocab.ops) {
    if (seen.has(spec.op)) {
      configInvalidJudge('judge/vocab-dup-op', `词表操作重复：${spec.op}`)
    }
    seen.add(spec.op)
    if (!JUDGE_OP_SEMANTIC_WHITELIST.includes(spec.op)) {
      if (JUDGE_OP_SEMANTIC_NEAR_BLACKLIST.includes(spec.op)) {
        configInvalidJudge(
          'judge/vocab-op-out-of-scope',
          `操作 ${spec.op} 是任务执行/编排语义（delegate/assign/create/update/close/priority 一类），` +
            '不是判断语义（选择/排序/过滤）——micro-judge 是决策辅助不是决策本体（studio-dev-160 §6.1）',
        )
      }
      configInvalidJudge(
        'judge/vocab-op-unapproved',
        `操作 ${spec.op} 不在判断语义白名单（${JUDGE_OP_SEMANTIC_WHITELIST.join('/')}）——白名单只增不减，增项走批示`,
      )
    }
    for (const [key, domain] of Object.entries(spec.params)) {
      if (domain.kind === 'enum') {
        if (domain.values.length === 0) {
          configInvalidJudge('judge/vocab-enum-empty', `参数 ${spec.op}.${key} 是 enum 域但候选集为空——闸③ 将恒拒（陷阱词表）`)
        }
        if (new Set(domain.values).size !== domain.values.length) {
          configInvalidJudge('judge/vocab-enum-dup', `参数 ${spec.op}.${key} 的 enum 候选集有重复值`)
        }
      }
    }
  }
}

/**
 * 词表指纹（sha8 canonical-JSON——models.ts fingerprint 同款）：**语义同词表恒同指纹**，
 * 进 JUDGE_OK 事件 note——词表变更（site 改注册）在台账面可对账。
 * canonical 口径：对象键排序递归（canonicalize）+ **ops 数组按条目 canonical 串排序**
 * （op 书写序是声明面细节，不参与语义）；enum 候选值**序参与**（改候选序=改词表——
 * 语义上首候选常是机械规则缺省位，动序即动语义）。
 */
export function judgeVocabFingerprint(vocab: JudgeVocab): string {
  const opsCanonical = vocab.ops
    .map((spec) => JSON.stringify(canonicalize(spec)))
    .sort()
  return createHash('sha256').update(JSON.stringify({ ops: opsCanonical }), 'utf8').digest('hex').slice(0, 8)
}

/** canonical 化（键排序递归——models.ts 同款；结构与值决定指纹，书写序不参与） */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonicalize(x)]),
    )
  }
  return v
}

// ————————————————————————— 三道闸：parseJudgeVerdict —————————————————————————

/**
 * 三道闸裁决解析（契约 mj 域 subject 的本体，C-mj-001..006）。
 *
 * 闸①（judge/bad-json）：JSON.parse 失败 / 非纯对象 / 顶层未知键 / 缺 op 或 params /
 *   op 非串 / params 非对象——**前后缀噪声拒收**（围栏/解说文字都算坏 JSON，不抢救：
 *   判断输出是机器消费面，宽松解析=把噪声留给下游）。
 * 闸②（judge/op-not-in-vocab）：op ∉ 词表——模型无词表扩展权（§6.1）。
 * 闸③（judge/params-domain）：params 键集必须**恰等**词表键集（未知键=模型造键，
 *   缺键=半成品裁决，都拒）；每键值过域约束（enum ∈ 候选集 / string 非空 /
 *   string-list 全非空串）。
 *
 * 失败抛 ClassifiedError（category=LLM_FAIL，subcause=judge/*）——上层**不重试**，
 * 立即降级机械规则（17-§9 LLM_FAIL 处置分叉；JUDGE_FALLBACK 原因枚举见 judge-gates.ts）。
 */
export function parseJudgeVerdict(raw: string, vocab: JudgeVocab): JudgeOpVerdict {
  // —— 闸①：严格 JSON 闸
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch (e) {
    throw judgeLlmFail('judge/bad-json', `JSON.parse 失败：${e instanceof Error ? e.message : String(e)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw judgeLlmFail('judge/bad-json', `输出必须是单一 JSON 对象，实际是 ${Array.isArray(parsed) ? '数组' : typeof parsed}`)
  }
  const obj = parsed as Record<string, unknown>
  const allowedKeys = new Set(['op', 'params'])
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw judgeLlmFail('judge/bad-json', `顶层未知键 ${key}——只接受 {op, params}（前后缀噪声/额外键一律拒收）`)
    }
  }
  if (typeof obj['op'] !== 'string' || obj['op'] === '') {
    throw judgeLlmFail('judge/bad-json', 'op 必须是非空字符串')
  }
  if (typeof obj['params'] !== 'object' || obj['params'] === null || Array.isArray(obj['params'])) {
    throw judgeLlmFail('judge/bad-json', 'params 必须是对象')
  }

  // —— 闸②：op 枚举闸（词表由调用方冻结，模型无扩展权）
  const spec = vocab.ops.find((s) => s.op === obj['op'])
  if (spec === undefined) {
    throw judgeLlmFail(
      'judge/op-not-in-vocab',
      `op "${obj['op']}" 不在冻结词表（${vocab.ops.map((s) => s.op).join('/')}）——模型无词表扩展权`,
    )
  }

  // —— 闸③：params 域闸（严格键集 + 逐键域约束）
  const inParams = obj['params'] as Record<string, unknown>
  const specKeys = Object.keys(spec.params)
  for (const key of Object.keys(inParams)) {
    if (!(key in spec.params)) {
      throw judgeLlmFail('judge/params-domain', `参数键 ${key} 不在词表（${spec.op} 只接受 ${specKeys.join('/') || '无参数'}）——模型无词表扩展权`)
    }
  }
  const outParams: Record<string, string | readonly string[]> = {}
  for (const [key, domain] of Object.entries(spec.params)) {
    const value = inParams[key]
    if (value === undefined) {
      throw judgeLlmFail('judge/params-domain', `参数键 ${key} 缺失——键集必须恰等词表键集（半成品裁决拒收）`)
    }
    if (domain.kind === 'enum') {
      if (typeof value !== 'string' || !domain.values.includes(value)) {
        throw judgeLlmFail(
          'judge/params-domain',
          `参数 ${key} 必须是候选集内字符串（${domain.values.join('/')}），实际：${safeShow(value)}`,
        )
      }
      outParams[key] = value
    } else if (domain.kind === 'string') {
      if (typeof value !== 'string' || value === '') {
        throw judgeLlmFail('judge/params-domain', `参数 ${key} 必须是非空字符串，实际：${safeShow(value)}`)
      }
      outParams[key] = value
    } else {
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || x === '')) {
        throw judgeLlmFail('judge/params-domain', `参数 ${key} 必须是非空字符串数组，实际：${safeShow(value)}`)
      }
      outParams[key] = value as readonly string[]
    }
  }
  return { op: spec.op, params: outParams }
}

/** 展示用值形态（错误 detail 的防炸兜底——循环引用等极端值落 String 截断） */
function safeShow(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s.length > 80 ? `${s.slice(0, 80)}…` : s
  } catch {
    return String(v)
  }
}

// ————————————————————————— 错误构造（本文件私有） —————————————————————————

/**
 * judge 域 CONFIG_INVALID 构造（词表注册闸用——配置类错误与合同包 configInvalid 同形，
 * 独立小函数避免 core→contract 的运行时依赖扩散到类型面之外）。
 */
function configInvalidJudge(subcause: string, detail: string): never {
  const err = new Error(`CONFIG_INVALID/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'CONFIG_INVALID'
  err.subcause = subcause
  err.detail = detail
  throw err
}

/** judge 域 LLM_FAIL 构造（三道闸失败通道——处置分叉=立即降级不重试，17-§9） */
function judgeLlmFail(subcause: string, detail: string): Error & ClassifiedError {
  const err = new Error(`LLM_FAIL/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'LLM_FAIL'
  err.subcause = subcause
  err.detail = detail
  return err
}
