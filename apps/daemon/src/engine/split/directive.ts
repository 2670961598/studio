/**
 * 拆单批示解析件（130-P2，studio-dev-173；提案 §6.1.2/§6.2.2——studio-dev-130 制作人
 * 2026-10-22 全批）——批示:拆单评论正文 → 结构化子单清单（纯函数，零 IO 零时钟）。
 *
 * 边界（三刀缝，§3 of 本单 plan.md）：
 *   - 批示**行**词表与批示人角色校验归 130-P0（studio-dev-171 归一层）；本文件收
 *     「已过校验的评论正文」，只认批示行做**定位锚**（其后找清单块），不做角色判断。
 *   - 本文件只产结构不落单——物化本体在 materialize.ts（意图→daemon 单点建单，
 *     提案 §6.2.2 房屋模式，mention/定时岗/webhook/data-change 四消费件同款）。
 *
 * 语法（提案 §6.2.2「结构化子单清单」冻结面）：
 *   - 批示行=`批示:拆单`（行首，trim 后前缀匹配——P0 词表 `批示:批准｜批示:打回｜
 *     批示:拆单｜批示:搁置` 之一，本文件只找拆单行）；
 *   - 清单=批示行后**首个 info 为 `split` 的围栏代码块**，内容=单 JSON 对象
 *     `{ "children": [ {…}, … ] }`。围栏 info 用 `split` 而非 `json`：不与随手贴的
 *     JSON 片段误撞（评论内容按不可信输入对待，21-§三 同纪律）；
 *   - 子单六字段（提案 §6.2.2）：title（必填非空）/assignee（必填——禁随机抢单，
 *     plan §4.5：缺点将=整条拒收＋建议评论，不回退 defaultPersonId）/level（可选
 *     int 0-9，缺省 0=L0 执行轨）/lane（可选——IssueCreate 无 lane 维，建单后
 *     setField 补，docs/25-§3.2 契约现状）/acceptance（可选，验收口径）/docs
 *     （可选，文档锚）；
 *   - strict：未知键/坏 JSON/空清单 → 拒收（fail-closed，不静默丢字段）。
 *
 * 幂等键（提案 §6.2.2 冻结格式 `父单号#序号`）：
 *   - 序号=清单内 1 起位次（位次即键——改中段条目重投不改旧键语义，修单走平台改单
 *     或新指令，不隐式重物化）；
 *   - 物化侧落 PATROL note `intent=split:<父>#<序号>`（前缀 `split:` 与意图键
 *     `source|kind|company|dedup` 字符集不相交——patrolKeys 无撞键）。
 */
import type { TicketId } from '@studio-next/contract'

/** 子单清单条目（解析产物——六字段全收窄，未知键拒收） */
export interface SplitChildSpec {
  title: string
  assignee: string
  level?: number
  lane?: string
  acceptance?: string
  docs?: string
}

/** 解析结果：过=清单；不过=拒收原因（整条拒收，原子——不留半拆） */
export type SplitParseResult = { ok: true; children: SplitChildSpec[] } | { ok: false; reason: string }

/** 批示行锚（P0 词表冻结面之一——只认全等行首词，不收变体） */
const SPLIT_DIRECTIVE_LINE = '批示:拆单'

/** 围栏块 info 标记（清单块唯一识别面） */
const SPLIT_FENCE_INFO = 'split'

/**
 * 定位批示行：正文任一行 trim 后以 `批示:拆单` 开头即命中（P0 已保证词表权威性；
 * 本层只找锚不判权）。返回首个命中行号，未命中=undefined。
 */
function findDirectiveLine(lines: readonly string[]): number | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim().startsWith(SPLIT_DIRECTIVE_LINE) === true) return i
  }
  return undefined
}

/**
 * 提取批示行后的首个 `split` 围栏块内容：```split 开栏 → ``` 闭栏（闭栏行 trim 后
 * 全等 ```）。无闭栏=不完整=拒收（fail-closed，不让截断评论进物化）。
 */
function extractSplitFence(lines: readonly string[], from: number): string | undefined {
  let open = -1
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (open < 0) {
      // 开栏：```split（info 段全等——`split foo` 不认，防借用）
      if (line.trim() === '```' + SPLIT_FENCE_INFO) open = i
    } else if (line.trim() === '```') {
      return lines.slice(open + 1, i).join('\n')
    }
  }
  return undefined
}

/**
 * 解析批示:拆单正文 → 子单清单（纯）。逐字段校验口径：
 *   - title/assignee：非空字符串（trim 后非空；原样保留不 trim 值本体）；
 *   - level：整数且 0..9（docs/04-§二 九级体系；越界=打字错误，拒收不猜）；
 *   - lane/acceptance/docs：字符串（lane/lane trim 后非空——空泳道无意义）；
 *   - 未知键：拒收（strict——漏字段名打错成静默丢弃是最危险的半拆）。
 */
export function parseSplitDirective(body: string): SplitParseResult {
  const lines = body.split('\n')
  const directiveAt = findDirectiveLine(lines)
  if (directiveAt === undefined) return { ok: false, reason: `未找到批示行「${SPLIT_DIRECTIVE_LINE}」` }
  const fenced = extractSplitFence(lines, directiveAt + 1)
  if (fenced === undefined) return { ok: false, reason: `批示行后无完整 \`\`\`${SPLIT_FENCE_INFO} 围栏清单块` }
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced)
  } catch (err) {
    return { ok: false, reason: `清单块 JSON 解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: '清单块须为 JSON 对象 {"children":[…]}' }
  const children = (parsed as Record<string, unknown>)['children']
  if (!Array.isArray(children) || children.length === 0) return { ok: false, reason: 'children 缺失或为空数组（拆单至少一子单）' }
  const out: SplitChildSpec[] = []
  for (let i = 0; i < children.length; i += 1) {
    const raw = children[i]
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: `children[${i}] 非对象` }
    const rec = raw as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (key !== 'title' && key !== 'assignee' && key !== 'level' && key !== 'lane' && key !== 'acceptance' && key !== 'docs') {
        return { ok: false, reason: `children[${i}].${key} 不是清单字段（封闭集：title/assignee/level/lane/acceptance/docs）` }
      }
    }
    const title = rec['title']
    if (typeof title !== 'string' || title.trim() === '') return { ok: false, reason: `children[${i}].title 缺失或为空（必填）` }
    const assignee = rec['assignee']
    if (typeof assignee !== 'string' || assignee.trim() === '') {
      return { ok: false, reason: `children[${i}].assignee 缺失或为空（必填——禁随机抢单：无点将不物化，取建议评论抄改后重投）` }
    }
    const level = rec['level']
    if (level !== undefined && (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 9)) {
      return { ok: false, reason: `children[${i}].level 须为 0..9 整数（收到 ${String(level)}）` }
    }
    const lane = rec['lane']
    if (lane !== undefined && (typeof lane !== 'string' || lane.trim() === '')) return { ok: false, reason: `children[${i}].lane 须为非空字符串` }
    const acceptance = rec['acceptance']
    if (acceptance !== undefined && typeof acceptance !== 'string') return { ok: false, reason: `children[${i}].acceptance 须为字符串` }
    const docs = rec['docs']
    if (docs !== undefined && typeof docs !== 'string') return { ok: false, reason: `children[${i}].docs 须为字符串` }
    out.push({
      title,
      assignee,
      ...(level !== undefined ? { level } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(acceptance !== undefined ? { acceptance } : {}),
      ...(docs !== undefined ? { docs } : {}),
    })
  }
  return { ok: true, children: out }
}

/**
 * 子单幂等键（提案 §6.2.2 冻结格式 `父单号#序号`，PATROL 前缀 `split:`）。
 * 序号 1 起（清单位次）。父单号/序号经 NoteSafe 由调用方保证（本函数纯拼）。
 */
export function splitChildKey(parent: TicketId, seq: number): string {
  return `split:${parent}#${seq}`
}

/** 父单立案收口幂等键（与子单键同域：`split:` 前缀＋#file 槽——同父同收口恰一次，子单与立案解耦可单独重试） */
export function splitFilingKey(parent: TicketId): string {
  return `split:${parent}#file`
}

/**
 * 子单 description 装配体——子单自含任务语义（提案 §6.4.1 交接字段集：验收口径/文档锚
 * 必填进单；缺省项如实标「未指定」不静默吞）。父单溯源＋幂等键入正文（人可查、可对账）。
 */
export function splitChildDescription(parent: TicketId, seq: number, child: SplitChildSpec): string {
  const lines = [
    `拆单子单（父单 ${parent}，序号 #${String(seq)}，dedupKey=${parent}#${String(seq)}——同键重投恰一次）。`,
    '',
    `## 验收口径`,
    child.acceptance !== undefined && child.acceptance.trim() !== '' ? child.acceptance : '未指定（补全后开工——验收口径冻结进单，章程第三条）',
    '',
    `## 文档锚`,
    child.docs !== undefined && child.docs.trim() !== '' ? child.docs : '未指定',
    '',
    `## 点将`,
    `- assignee：${child.assignee}`,
    `- level：${child.level !== undefined ? String(child.level) : '0（缺省=L0 执行轨）'}`,
    `- lane：${child.lane !== undefined ? child.lane : '未指定（派发时回退缺省泳道）'}`,
  ]
  return lines.join('\n')
}
