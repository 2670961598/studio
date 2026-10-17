/**
 * postmortem —— 复盘单与案例库雏形（进化链四刀之二；20-§十一「事故」链 + 20-§九管线尾位）
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§十一：事故全链「发现→止血→复盘（挂复盘单）→案例库；**复盘不追责，追流程**」
 *     ——本文件是链上「复盘→案例库」两环的执行面（发现/止血归主循环断路器与看护，已有面）。
 *   - docs/20-§九：一切改进走候选制品管线（观测→提案→沙箱→三态闸门→灰度→切权→**复盘**）
 *     ——复盘是进化管线尾位；切权后的事（事故归档、判据沉淀）从本面流入案例库/判据/规程三类出口。
 *   - docs/17-§3：事件枚举冻结 v1 含 POSTMORTEM（25 类之一）——本刀让它有实体（写面+语义）。
 *   - docs/04-§二：公司目录 `docs/` = 规范/知识/案例——案例库目录约定 `<公司>/docs/casebook/`
 *     的落点（复盘是公司运营产物，归公司目录）。
 *   - docs/05-§二：工作知识（SOP/案例库/历史教训）载体=YouTrack Articles——v0 先落 git 目录
 *     （本雏形），kb 化/派工自动注入归后续刀。
 *   - packages/contract events.ts：POSTMORTEM 走 EventRecordSchema 全列校验（appendEvent
 *     唯一写口前置闸）；packages/store ledger.appendEvent / queryEvents——落账与断路器
 *     历史回查的正式面。
 *
 * 「不追责」的机制化（本刀核心纪律，结构保证而非自律）：
 *   - **输入形状无责任人字段**：PostmortemInput 的字段集冻结为内容七件（单号/摘要/时间线/
 *     根因/止血/预防/结论），没有任何 actor-of-blame 位——TS 编译期即无此面；
 *   - **渲染器内置追责哨兵**：assertNoBlameHeading 扫描产出 markdown 的标题行，出现
 *     「责任人/责任方/blame」类标题即 CONFIG_INVALID 拒出（防未来渲染器漂移加节、防输入
 *     文本经 markdown 注入标题）——双保险都在机制层，不靠写模板的人自觉；
 *   - 根因只分三类：**流程缺口 / 环境因素 / 判据失误**——分类学本身就是「追流程」的形状。
 *
 * 形态对齐先例（src/sandbox.ts 四刀之首）：
 *   - 纯渲染函数（renderXxx，零 IO）+ CLI 链（runXxxChain，ledger+fs 编排）分层；
 *   - fail-closed 分类：输入形状坏 → CONFIG_INVALID（fail-fast 上抛，调用方 bug 不静默）；
 *   - 链面语义归本文件，bin.ts 只做薄壳（参数解析+打印+退出码）。
 *
 * 案例库目录约定（定夺说明，头注冻结）：
 *   - **复盘是公司运营产物 → 公司目录**：`<company>/docs/casebook/<date>-<slug>.md`
 *     （04-§二 docs/=规范/知识/案例；git 历史=组织变迁史，案例演进可追）。
 *   - **v0 框架级演示 → 仓内 `docs/casebook/` 雏形**：本仓 docs/casebook/ 承载框架自身
 *     事故的自举案例（吃自己狗粮）；daemon 服务真公司时写公司目录同构子路径
 *     （--casebook 指根即可，目录约定由 CASEBOOK_DIR_NAME 单一常量收口）。
 *   - 条目结构对齐 20-§十一：**现象→根因→解法→预防** 四节（renderCasebookEntry 字段映射）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **输入形状拟升 contract**：PostmortemInput 七件套（含根因三分类/预防三出口枚举）
 *     本刀定义在 daemon；稳定后升 packages/contract schemas（与 events/candidates 同款
 *     zod 冻结面）——升包前 daemon 侧 parsePostmortemInput 是唯一校验源。
 *   - **追责哨兵词表**（POSTMORTEM_BLAME_MARKERS）：责任人/责任方/追责对象/blame——
 *     v0 词表冻结拟稿；扩词表=改判据，走批示。
 *   - **CLI --input 实为必填**：实现单写 `[--input]` 可选，但复盘正文不可虚构（纪律 5
 *     不伪造）——缺 --input 拒执行（用法错误），不给「空模板充数」的旁路。
 *   - **事件缺省档**：actor='daemon'（ENGINE_CONFIG_DEFAULTS 同款）、dept='departments/工程部'
 *     （deptFallback 同款）、level=9（复盘=质量红线机制，制作人触点——最高档拟稿）、
 *     attempt=1（复盘动作首次）、tokens={input:0}（无计量事件显式零桶——events.ts 头注口径）。
 *   - **note=案例条目约定相对路径**（`docs/casebook/<file>`）而非绝对路径：可移植（台账
 *     可重建到异机；纪律 6 仓库/单据不进本机路径），fs 写入根由 --casebook 独立给出。
 *   - **同日重跑覆盖同名条目文件**：目录 git 历史保版本演进（04-§二「git 历史=组织变迁史」），
 *     每跑一次新落一条 POSTMORTEM 事件（append-only，重跑=新复盘档案不覆盖旧账）。
 *   - **案例文件=条目+完整复盘附录**：检索面（四节条目）在前、审计面（完整模板）在后，
 *     单文件自包含；note 指向该文件即同时挂到两面。
 *
 * 后续刀（本刀不做，头注声明）：案例库 kb 化（YouTrack Articles + kb-search 检索 + 派工
 *   自动注入同类教训，05-§二）、预防措施三类出口的落地跟踪（进判据=SCHEMA_EVOLVE/制作人
 *   亲批、进规程=提案单）、复盘单在 YouTrack 侧的自动挂单（当前 --issue 是既有复盘单号，
 *   CLI 不代建单——只落单不派工精神）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import type { EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from './id.ts'

// ————————————————————————— 输入形状（拟升 contract，头注拟稿点） —————————————————————————

/** 根因三分类（20-§十一「追流程」的形状：无责任人位，只有流程位） */
export const ROOT_CAUSE_KINDS = ['process-gap', 'environment', 'criteria-miss'] as const
export type RootCauseKind = (typeof ROOT_CAUSE_KINDS)[number]

/** 预防措施三类出口：进案例库 / 进判据 / 进规程（20-§十一案例库 + 20-§九判据宪法内核） */
export const PREVENTION_OUTLETS = ['casebook', 'criteria', 'protocol'] as const
export type PreventionOutlet = (typeof PREVENTION_OUTLETS)[number]

/** 时间线条目（事件引用：台账回查键=事件 ULID；手工条目 event 填描述性名也允许——如「人工发现」） */
export interface PostmortemTimelineEntry {
  /** epoch ms */
  ts: number
  /** 事件名（台账事件名或手工描述短语） */
  event: string
  /** 事件 ULID（台账回查键；手工条目填占位描述（如 manual） */
  id: string
  /** 一句话经过 */
  note: string
  /** 来源标注：ledger=断路器关联自动引入 / manual=复盘人手写（渲染面徽标；缺省 manual） */
  origin?: 'ledger' | 'manual'
}

/** 单条根因：分类 + 描述（分类枚举见 ROOT_CAUSE_KINDS） */
export interface PostmortemRootCause {
  kind: RootCauseKind
  summary: string
}

/** 单条预防措施：描述 + 三类出口（出口枚举见 PREVENTION_OUTLETS） */
export interface PostmortemPrevention {
  summary: string
  outlet: PreventionOutlet
}

/** 复盘输入七件套（模板渲染的全部内容源；**无责任人字段**——结构即纪律，见头注） */
export interface PostmortemInput {
  /** 复盘单号（挂复盘单——20-§十一；台账事件 issue 列同值） */
  issue: string
  /** 事故摘要（现象）——一句话 */
  summary: string
  /** 事故发生时刻（epoch ms） */
  incidentAt: number
  /** 事故发现时刻（epoch ms） */
  detectedAt: number
  /** 时间线（事件引用；CLI 链会自动并入断路器历史——见 collectBreakerTimeline） */
  timeline: readonly PostmortemTimelineEntry[]
  /** 根因（分三类；至少一条——无根因的复盘=没复盘，fail-closed 拒） */
  rootCauses: readonly PostmortemRootCause[]
  /** 止血记录（已采取的即时措施） */
  containment: string
  /** 预防措施（每条映射三类出口；至少一条——无预防的复盘=白复盘） */
  preventions: readonly PostmortemPrevention[]
  /** 复盘结论 */
  conclusion: string
}

// ————————————————————————— 追责哨兵（不追责的机制化，头注） —————————————————————————

/**
 * 追责标题哨兵词表（v0 冻结拟稿，头注拟稿点）：标题行含任一标记即拒出。
 * 只扫**标题行**（/^#+\s/）——正文提及「不追责」原则句（blockquote）不受影响。
 */
export const POSTMORTEM_BLAME_MARKERS = ['责任人', '责任方', '追责对象', 'blame'] as const

/** 标题行提取（markdown ATX 标题：行首 # 串 + 空格） */
function headingLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^#+\s/.test(line))
    .map((line) => line.trim())
}

/**
 * 追责哨兵（双保险的机制层）：markdown 标题行含哨兵词 → CONFIG_INVALID。
 * 输入文本经 markdown 注入标题（summary 里夹 `\n## 责任人\n`）在此如实拒——
 * 渲染器出口统一过哨兵，不信任任何拼进模板的字符串。
 */
export function assertNoBlameHeading(markdown: string): void {
  for (const heading of headingLines(markdown)) {
    const lower = heading.toLowerCase()
    for (const marker of POSTMORTEM_BLAME_MARKERS) {
      if (heading.includes(marker) || lower.includes(marker.toLowerCase())) {
        configInvalid(
          'daemon/postmortem:blame-heading',
          `复盘产物标题行含追责面字段「${heading}」（复盘不追责，追流程——20-§十一；模板无责任人字段，此为结构保证）`,
        )
      }
    }
  }
}

// ————————————————————————— 输入解析（fail-fast 形状闸；拟升 contract 的校验源） —————————————————————————

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 必填字符串闸（fieldPath=诊断路径标签，如 `timeline.0.note`——subcause 面给全路径） */
function reqString(obj: Record<string, unknown>, key: string, fieldPath?: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') {
    configInvalid(`daemon/postmortem:input:${fieldPath ?? key}`, `${fieldPath ?? key} 须为非空字符串`)
  }
  return v
}

/** 必填整数闸（epoch ms；fieldPath 同 reqString） */
function reqNumber(obj: Record<string, unknown>, key: string, fieldPath?: string): number {
  const v = obj[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    configInvalid(`daemon/postmortem:input:${fieldPath ?? key}`, `${fieldPath ?? key} 须为非负整数（epoch ms）`)
  }
  return v
}

/**
 * 解析复盘输入（unknown → PostmortemInput）：逐字段 fail-fast（CONFIG_INVALID，subcause
 * 带字段名——人话修法）。枚举外值（根因分类/预防出口）如实拒；根因与预防至少各一条。
 */
export function parsePostmortemInput(v: unknown): PostmortemInput {
  if (!isPlainObject(v)) {
    configInvalid('daemon/postmortem:input:not-object', '复盘输入须为 JSON 对象')
  }
  const issue = reqString(v, 'issue')
  const summary = reqString(v, 'summary')
  const incidentAt = reqNumber(v, 'incidentAt')
  const detectedAt = reqNumber(v, 'detectedAt')
  const containment = reqString(v, 'containment')
  const conclusion = reqString(v, 'conclusion')

  if (!Array.isArray(v['timeline'])) {
    configInvalid('daemon/postmortem:input:timeline', 'timeline 须为数组（事件引用条目）')
  }
  const timeline: PostmortemTimelineEntry[] = []
  for (const [i, item] of (v['timeline'] as unknown[]).entries()) {
    if (!isPlainObject(item)) {
      configInvalid(`daemon/postmortem:input:timeline.${i}`, `timeline[${i}] 须为对象`)
    }
    const entry: PostmortemTimelineEntry = {
      ts: reqNumber(item, 'ts', `timeline.${i}.ts`),
      event: reqString(item, 'event', `timeline.${i}.event`),
      id: reqString(item, 'id', `timeline.${i}.id`),
      note: reqString(item, 'note', `timeline.${i}.note`),
    }
    const origin = item['origin']
    if (origin !== undefined && origin !== 'ledger' && origin !== 'manual') {
      configInvalid(`daemon/postmortem:input:timeline.${i}.origin`, `origin=${String(origin)} 须为 'ledger'|'manual'`)
    }
    if (origin !== undefined) entry.origin = origin
    timeline.push(entry)
  }

  if (!Array.isArray(v['rootCauses']) || (v['rootCauses'] as unknown[]).length === 0) {
    configInvalid('daemon/postmortem:input:rootCauses', 'rootCauses 须为非空数组（无根因的复盘=没复盘，fail-closed）')
  }
  const rootCauses: PostmortemRootCause[] = []
  for (const [i, item] of (v['rootCauses'] as unknown[]).entries()) {
    if (!isPlainObject(item)) {
      configInvalid(`daemon/postmortem:input:rootCauses.${i}`, `rootCauses[${i}] 须为对象`)
    }
    const kind = item['kind']
    if (!(ROOT_CAUSE_KINDS as readonly string[]).includes(String(kind))) {
      configInvalid(
        `daemon/postmortem:input:rootCauses.${i}.kind`,
        `根因分类 kind=${String(kind)} 须为 ${ROOT_CAUSE_KINDS.join('/')}（流程缺口/环境因素/判据失误——追流程的分类学）`,
      )
    }
    rootCauses.push({ kind: kind as RootCauseKind, summary: reqString(item, 'summary') })
  }

  if (!Array.isArray(v['preventions']) || (v['preventions'] as unknown[]).length === 0) {
    configInvalid('daemon/postmortem:input:preventions', 'preventions 须为非空数组（无预防的复盘=白复盘，fail-closed）')
  }
  const preventions: PostmortemPrevention[] = []
  for (const [i, item] of (v['preventions'] as unknown[]).entries()) {
    if (!isPlainObject(item)) {
      configInvalid(`daemon/postmortem:input:preventions.${i}`, `preventions[${i}] 须为对象`)
    }
    const outlet = item['outlet']
    if (!(PREVENTION_OUTLETS as readonly string[]).includes(String(outlet))) {
      configInvalid(
        `daemon/postmortem:input:preventions.${i}.outlet`,
        `预防出口 outlet=${String(outlet)} 须为 ${PREVENTION_OUTLETS.join('/')}（进案例库/进判据/进规程）`,
      )
    }
    preventions.push({ summary: reqString(item, 'summary'), outlet: outlet as PreventionOutlet })
  }

  const input: PostmortemInput = {
    issue,
    summary,
    incidentAt,
    detectedAt,
    timeline,
    rootCauses,
    containment,
    preventions,
    conclusion,
  }
  // 哨兵前置：输入文本先过一遍追责标题注入面（渲染出口还有第二道——双保险）
  assertNoBlameHeading([summary, containment, conclusion].join('\n') + '\n' + input.timeline.map((e) => e.note).join('\n') + '\n' + input.rootCauses.map((r) => r.summary).join('\n') + '\n' + input.preventions.map((p) => p.summary).join('\n'))
  return input
}

// ————————————————————————— 渲染：复盘模板（纯函数，零 IO） —————————————————————————

/** epoch ms → ISO 8601 UTC（模板时刻口径：台账 ts 同源时区，免本地时区歧义） */
function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 根因分类 → 中文标签（模板/条目统一映射，单一口径源） */
export const ROOT_CAUSE_LABELS: Readonly<Record<RootCauseKind, string>> = {
  'process-gap': '流程缺口',
  environment: '环境因素',
  'criteria-miss': '判据失误',
}

/** 预防出口 → 中文标签（同上单一口径源） */
export const PREVENTION_OUTLET_LABELS: Readonly<Record<PreventionOutlet, string>> = {
  casebook: '进案例库',
  criteria: '进判据',
  protocol: '进规程',
}

/** 模板七节的固定节名（形状冻结面——测试断言模板形状的基准） */
export const POSTMORTEM_TEMPLATE_SECTIONS = [
  '事故摘要（现象）',
  '时间线（事件引用）',
  '根因',
  '止血记录',
  '预防措施',
  '复盘结论',
] as const

/** 时间线一行：`- [ISO] **EVENT** \`id\`（来源）— note` */
function timelineLine(entry: PostmortemTimelineEntry): string {
  const origin = entry.origin === 'ledger' ? '台账自动引入' : '复盘手写'
  return `- [${iso(entry.ts)}] **${entry.event}** \`${entry.id}\`（${origin}）—— ${entry.note}`
}

/**
 * 渲染复盘模板（markdown，纯函数）：
 * 单号 / 事故摘要（现象）/ 时间线（事件引用）/ 根因（三分类小节，固定骨架）/ 止血记录 /
 * 预防措施（每条带三类出口标签）/ 复盘结论。
 *
 * 不追责机制化（头注）：骨架无「责任人」节——根因节只含 流程缺口/环境因素/判据失误 三个
 * 小节（固定渲染，空类占位「（无）」——固定骨架优于动态骨架：形状可断言）；出口统一过
 * assertNoBlameHeading 哨兵（输入注入的追责标题在此拦下）。
 */
export function renderPostmortemTemplate(input: PostmortemInput): string {
  const byKind = (kind: RootCauseKind): string[] => input.rootCauses.filter((r) => r.kind === kind).map((r) => `- ${r.summary}`)
  const timeline = input.timeline.length === 0 ? '- （无事件引用——事故未留台账痕迹，时间线空如实呈现）' : input.timeline.map(timelineLine).join('\n')
  const preventionLines = input.preventions.map((p) => `- [${PREVENTION_OUTLET_LABELS[p.outlet]}] ${p.summary}`).join('\n')

  const markdown = `# 复盘单：${input.issue}

> 复盘不追责，追流程（docs/20-§十一）——本单无「责任人」字段；根因只记 流程缺口 / 环境因素 / 判据失误。

- 事故时刻：${iso(input.incidentAt)}
- 发现时刻：${iso(input.detectedAt)}

## 事故摘要（现象）

${input.summary}

## 时间线（事件引用）

${timeline}

## 根因

### 流程缺口（process-gap）

${byKind('process-gap').length === 0 ? '- （无）' : byKind('process-gap').join('\n')}

### 环境因素（environment）

${byKind('environment').length === 0 ? '- （无）' : byKind('environment').join('\n')}

### 判据失误（criteria-miss）

${byKind('criteria-miss').length === 0 ? '- （无）' : byKind('criteria-miss').join('\n')}

## 止血记录

${input.containment}

## 预防措施

${preventionLines}

## 复盘结论

${input.conclusion}
`
  assertNoBlameHeading(markdown)
  return markdown
}

// ————————————————————————— 渲染：案例条目（字段映射 现象→根因→解法→预防） —————————————————————————

/** 案例条目四节的固定节名（20-§十一 案例库结构——对齐旧系统知识库同名结构） */
export const CASEBOOK_ENTRY_SECTIONS = ['现象', '根因', '解法', '预防'] as const

/**
 * 渲染案例条目（markdown，纯函数）：从复盘输入导出——字段映射：
 *   现象 ← summary｜根因 ← rootCauses（按三分类标签）｜解法 ← containment（+conclusion）｜
 *   预防 ← preventions（按三出口标签）。
 * 头部元信息：日期/复盘单号/条目路径约定（台账 POSTMORTEM 事件的 note 即指向本条目文件）。
 */
export function renderCasebookEntry(input: PostmortemInput, date: string): string {
  const rootCauseLines = input.rootCauses.map((r) => `- [${ROOT_CAUSE_LABELS[r.kind]}] ${r.summary}`).join('\n')
  const preventionLines = input.preventions.map((p) => `- [${PREVENTION_OUTLET_LABELS[p.outlet]}] ${p.summary}`).join('\n')
  const markdown = `# ${date} 复盘案例（复盘单 ${input.issue}）

- 日期：${date}
- 复盘单号：${input.issue}
- 条目路径约定：${CASEBOOK_DIR_NAME}/<date>-<slug>.md（docs/20-§十一 案例库；docs/04-§二 公司目录 docs/=规范/知识/案例）
- 台账留痕：POSTMORTEM 事件（events.note=本条目路径）

## 现象

${input.summary}

## 根因

${rootCauseLines}

## 解法

${input.containment}

（复盘结论：${input.conclusion}）

## 预防

${preventionLines}
`
  assertNoBlameHeading(markdown)
  return markdown
}

// ————————————————————————— 案例库目录约定（单一常量收口，头注定夺说明） —————————————————————————

/** 案例库目录名（公司目录内相对公司根；框架级演示=仓内同构路径） */
export const CASEBOOK_DIR_NAME = 'docs/casebook'

/** 条目文件名形状：`<YYYY-MM-DD>-<slug>.md`（slug=字母/数字/中日文/连字符，非空、无路径分隔） */
export const CASEBOOK_FILE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[\p{L}\p{N}][\p{L}\p{N}-]*\.md$/u

/** 日期形状闸（YYYY-MM-DD——月 01-12 / 日 01-31 形状面；历法精确校验非本刀面） */
const DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/

/** 日期（epoch ms）→ YYYY-MM-DD（UTC——台账 ts 同源时区） */
export function casebookDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 条目文件名组装与闸：date 形状（YYYY-MM-DD）+ slug 卫生（首字符字母/数字、仅字母/数字/
 * 连字符、非空）→ `<date>-<slug>.md`。坏形状如实拒（CONFIG_INVALID）。
 */
export function casebookEntryFileName(date: string, slug: string): string {
  if (!DATE_RE.test(date)) {
    configInvalid('daemon/postmortem:casebook:bad-date', `date=${date} 须为 YYYY-MM-DD 形状`)
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug)) {
    configInvalid('daemon/postmortem:casebook:bad-slug', `slug=${slug} 须为字母/数字/中日文/连字符（首字符非连字符，无路径分隔）`)
  }
  const name = `${date}-${slug}.md`
  if (!CASEBOOK_FILE_RE.test(name)) {
    configInvalid('daemon/postmortem:casebook:bad-name', `组装出的条目名不合规：${name}`)
  }
  return name
}

/** 相对约定路径（台账 note 的取值口径：`docs/casebook/<file>`——可移植，不带本机路径） */
export function casebookEntryRelPath(fileName: string): string {
  return `${CASEBOOK_DIR_NAME}/${fileName}`
}

// ————————————————————————— 断路器关联（时间线自动引入，20-§十一卡单链） —————————————————————————

/** 断路关联事件名集：该单的这些历史自动进时间线（实现单口径：CIRCUIT_BREAK / ESCALATE） */
export const BREAKER_EVENT_NAMES = ['CIRCUIT_BREAK', 'ESCALATE'] as const

/**
 * 断路器历史回查（该单的 CIRCUIT_BREAK/ESCALATE 事件 → 时间线条目，ts 升序）：
 * 主循环熔断落 ESCALATE（note 前缀 CIRCUIT_BREAK）、断路升级电路同名面——两种都收。
 * origin='ledger'（渲染面徽标「台账自动引入」）。
 */
export function collectBreakerTimeline(ledger: Ledger, issue: string): PostmortemTimelineEntry[] {
  return ledger
    .queryEvents({ issue })
    .filter((e) => (BREAKER_EVENT_NAMES as readonly string[]).includes(e.event))
    .map((e) => ({ ts: e.ts, event: e.event, id: e.id, note: e.note ?? '（无 note）', origin: 'ledger' as const }))
}

/**
 * 时间线归并：台账自动条目 + 手写条目去重（同事件 id 只留一条，台账面优先）后按 ts 升序
 * （同 ts 按 id 字典序稳定）。事故叙事顺序=时间顺序，不按来源分段。
 */
export function mergeTimeline(auto: readonly PostmortemTimelineEntry[], manual: readonly PostmortemTimelineEntry[]): PostmortemTimelineEntry[] {
  const byId = new Map<string, PostmortemTimelineEntry>()
  for (const entry of [...auto, ...manual]) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ————————————————————————— CLI 链（渲染模板→写案例库文件→落 POSTMORTEM 事件） —————————————————————————

/** CLI 链入参（bin.ts postmortem 子命令组装；测试直调同面） */
export interface PostmortemChainOptions {
  /** 复盘输入（已过 parsePostmortemInput 的形状；链内哨兵再过一遍——幂等闸） */
  input: PostmortemInput
  /** 案例库根目录（fs 面：条目写到此目录下；约定面恒为 CASEBOOK_DIR_NAME，见头注定夺说明） */
  casebookRoot: string
  /** 条目 slug（缺省=复盘单号——单号本身即唯一检索键） */
  slug?: string
  /** 条目日期 YYYY-MM-DD（缺省=今天，clock() 取） */
  date?: string
  /** 公司 slug（events.company——台账路由键，必填不猜） */
  company: string
  /** events.actor（缺省 'daemon'——ENGINE_CONFIG_DEFAULTS 同款拟稿档） */
  actor?: string
  /** events.dept（缺省 'departments/工程部'——deptFallback 同款拟稿档） */
  dept?: string
  /** events.level（缺省 9——复盘=质量红线制作人触点，最高档拟稿） */
  level?: number
  /** 时钟注入面（缺省 Date.now；事件 ts/缺省日期取自此） */
  clock?: () => number
  /** ULID 工厂注入面（缺省 makeUlid；测试确定性替身） */
  idFactory?: (ts: number) => string
}

/** CLI 链结果（bin.ts 打印面；测试断言面） */
export interface PostmortemChainResult {
  /** 落账的 POSTMORTEM 事件（store 读面回查应 deep-equal） */
  event: EventRecord
  /** 案例条目文件绝对路径 */
  filePath: string
  /** 台账 note 所载约定相对路径（docs/casebook/<file>——可移植口径） */
  relPath: string
  /** 断路器关联自动引入的时间线条数（渲染进模板时间线节的 ledger 面条目数） */
  autoTimelineCount: number
  /** 归并后的完整输入（时间线=自动+手写；模板渲染源——回查面） */
  mergedInput: PostmortemInput
  /** 写盘内容字节数（events.size 同值） */
  bytes: number
}

/**
 * 复盘链（一条命令归档一起事故）：
 *   ① 断路器关联：collectBreakerTimeline 回查该单 CIRCUIT_BREAK/ESCALATE 历史 →
 *      mergeTimeline 并入手写时间线（去重、ts 升序）；
 *   ② 渲染：renderCasebookEntry（四节条目）+ renderPostmortemTemplate（七节完整复盘）；
 *   ③ 写案例库文件：`<casebookRoot>/<date>-<slug>.md` = 条目（检索面）+ 分隔线 + 完整复盘
 *      （审计面）——单文件自包含（头注拟稿点）；
 *   ④ 落 POSTMORTEM 事件：note=条目约定相对路径、size=文件字节、payload_hash=文件内容
 *      sha256（证据三件套：路径+体量+内容指纹）、tokens={input:0}（无计量显式零桶）。
 * 链内失败如实抛（CONFIG_INVALID 分类），bin.ts 捕获 exit 1。渲染出口的追责哨兵在
 * renderXxx 内部（第二道）；本链入参已过 parse（第一道）——双保险都在机制层。
 */
export function runPostmortemChain(ledger: Ledger, opts: PostmortemChainOptions): PostmortemChainResult {
  const clock = opts.clock ?? Date.now
  const makeId = opts.idFactory ?? makeUlid

  // ① 断路器关联 + 时间线归并
  const auto = collectBreakerTimeline(ledger, opts.input.issue)
  const merged: PostmortemInput = { ...opts.input, timeline: mergeTimeline(auto, opts.input.timeline) }

  // ② 渲染（出口哨兵在内）
  const date = opts.date ?? casebookDate(clock())
  const slug = opts.slug ?? opts.input.issue
  const fileName = casebookEntryFileName(date, slug)
  const entry = renderCasebookEntry(merged, date)
  const template = renderPostmortemTemplate(merged)
  const content = `${entry}\n---\n\n${template}`

  // ③ 写案例库文件（目录递归建；同日重跑覆盖=git 历史保版本，头注拟稿点）
  const filePath = path.join(opts.casebookRoot, fileName)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  const bytes = Buffer.byteLength(content, 'utf8')
  const relPath = casebookEntryRelPath(fileName)

  // ④ 落 POSTMORTEM 事件（appendEvent 唯一写口——contract 闸前置）
  const ts = clock()
  const event: EventRecord = {
    id: makeId(ts),
    ts,
    company: opts.company,
    issue: merged.issue,
    event: 'POSTMORTEM',
    actor: opts.actor ?? 'daemon',
    attempt: 1,
    level: opts.level ?? 9,
    dept: opts.dept ?? 'departments/工程部',
    tokens: { input: 0 },
    size: bytes,
    payload_hash: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
    note: relPath,
  }
  ledger.appendEvent(event)

  return { event, filePath, relPath, autoTimelineCount: auto.length, mergedInput: merged, bytes }
}

/** 链结果打印面（bin.ts 用：一行归档+明细行，日志即证据摘要） */
export function renderPostmortemLines(result: PostmortemChainResult): string[] {
  return [
    `[postmortem] 复盘单 ${result.event.issue} 归档完成（20-§十一：发现→止血→复盘→案例库；复盘不追责，追流程）`,
    `[postmortem] 断路器关联：自动引入 ${String(result.autoTimelineCount)} 条（CIRCUIT_BREAK/ESCALATE 台账回查）｜时间线共 ${String(result.mergedInput.timeline.length)} 条`,
    `[postmortem] 案例条目：${result.filePath}（${String(result.bytes)} 字节；条目+完整复盘自包含）`,
    `[postmortem] 台账留痕：POSTMORTEM 事件 ${result.event.id}｜note=${result.relPath}｜payload_hash=${result.event.payload_hash}`,
  ]
}
