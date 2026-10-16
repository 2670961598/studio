/**
 * layers —— L0-L5 分层模型、定界标记与分层指纹（docs/17-§5，需求 C2-06/C2-08/C2-11）
 *
 * 规格依据（实现单引用）：
 *   - 17-§5 装配管线全图：L0 框架 → L1 公司 → L2 组织 → L3 个人 → L4 项目 → L5 工具。
 *   - C2-06：六层定序、不可混淆定界标记；验收口径=「六层顺序断言；层内无他层标记」。
 *   - C2-08：分层指纹 `W-<fwk>/co.<rev>/org.<rev>/p.<工号>.<rev>/t.<单号>.<att>/ex.<adapter>@<ver>`，
 *     各层 rev=内容 sha8；验收=只改某人档案，重派同单仅 person 段变。
 *   - C2-11：组装确定性——稳定层前置易变层后置；同输入同 bytes。
 *   - C2-12：档案事实段零 LLM 机械归集（「做过的事」一单一行，结构化可截断）。
 *
 * 【拟升 contract】LayerSource / PromptLayer / TrimmableRegion / LayerId——
 *   本刀放 prompt 包内定义（contract 未冻结装配协议），升包走进化管线（F3-01）。
 *
 * 【拟稿待批】
 *   - W 段语义：C2-08 写「W-<fwk>」且「各层 rev=内容 sha8」——两句话并读时 W 段取框架
 *     版本号（L0 随发版，版本即内容锚）而非 L0 内容 sha8；<rev>=sha8 只落在 co/org/p 三段。
 *     t 段按冻结式为 `<单号>.<att>` 无内容 rev：L4 内容变化而单号次数不变时 t 段不变
 *     （含裁剪后——信息损失疑点已记录，不改格式，批示后定）。
 *   - 「做过的事」行序=旧→新，「保留最近 N 单」即保留末 N 行（docs 未明说行序）。
 *   - L0/L2/L4 标记 protected（红线/证据契约｜署名｜验收口径所在层，任务书口径）；
 *     裁剪结构性只动显式 trim 区（见 trim.ts），protected=声明性防线（区外永不裁）。
 *
 * 纯函数纪律：同输入恒同输出；零盘 IO（config home / 公司目录内容一律参数注入）；零时间/随机内取。
 * sha8 用 node:crypto（纯计算，非盘 IO）；确定性由内容唯一决定。
 */
import { createHash } from 'node:crypto'
import type { AttemptNo, CompanySnapshot, PersonRef, TicketId } from '@studio-next/contract'
import type { ExecutorCapabilities } from '@studio-next/contract'
import { sanitizeUntrusted } from './sanitize.ts'

// ---------------------------------------------------------------------------
// 层标识与定界标记（C2-06：不可混淆定界标记）
// ---------------------------------------------------------------------------

export type LayerId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

/** 六层冻结顺序（C2-06；稳定层前置易变层后置，C2-11 prompt cache 友好） */
export const LAYER_ORDER: readonly LayerId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const

export function layerMarkerBegin(id: LayerId): string {
  return `<!-- LAYER:${id}:BEGIN -->`
}

export function layerMarkerEnd(id: LayerId): string {
  return `<!-- LAYER:${id}:END -->`
}

/** 任何层定界标记（输入内容走私定界标记=结构性破坏，构建时拒收） */
const ANY_LAYER_MARKER = /<!--\s*LAYER:L\d:(?:BEGIN|END)/

/** 任何 trim 区标记（同理：trim 区只能由构建器声明，不许内容自带） */
const ANY_TRIM_MARKER = /<!--\s*studio:trim:/

// ---------------------------------------------------------------------------
// trim 区（C2-09 裁剪阶梯的结构基础：可裁内容=显式声明的区，区外结构性不可裁）
// ---------------------------------------------------------------------------

export type TrimmableKind = 'work_history' | 'lessons' | 'campaign'

export function trimMarkerBegin(kind: TrimmableKind): string {
  return `<!-- studio:trim:${kind}:begin -->`
}

export function trimMarkerEnd(kind: TrimmableKind): string {
  return `<!-- studio:trim:${kind}:end -->`
}

/** trim 区元数据（构建时声明；裁剪器只动区內行） */
export interface TrimmableRegion {
  kind: TrimmableKind
  /** 区內非空行数 */
  lines: number
}

// ---------------------------------------------------------------------------
// 分层指纹（C2-08 冻结式）
// ---------------------------------------------------------------------------

/** 内容 sha8（C2-08：各层 rev=内容 sha8；sha256 前 8 位十六进制） */
export function sha8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8)
}

/**
 * 单层指纹段（C2-08 冻结式逐段落字）：
 *   L0 → W-<fwk>｜L1 → co.<sha8>｜L2 → org.<sha8>｜L3 → p.<工号>.<sha8>
 *   L4 → t.<单号>.<att>｜L5 → ex.<adapter>@<ver>
 * identity：L0=框架版本｜L3=工号｜L4=`<单号>.<att>`｜L5=`<adapter>@<ver>`；L1/L2 空串。
 */
export function layerFingerprint(id: LayerId, identity: string, content: string): string {
  switch (id) {
    case 'L0':
      return `W-${identity}`
    case 'L1':
      return `co.${sha8(content)}`
    case 'L2':
      return `org.${sha8(content)}`
    case 'L3':
      return `p.${identity}.${sha8(content)}`
    case 'L4':
      return `t.${identity}`
    case 'L5':
      return `ex.${identity}`
  }
}

/** 六段按冻结序拼接为完整分层指纹（assemble 用） */
export function combinedFingerprint(layers: readonly PromptLayer[]): string {
  return layers.map((l) => l.fingerprint).join('/')
}

// ---------------------------------------------------------------------------
// 分层内容源（【拟升 contract】；一切内容参数注入，不读盘）
// ---------------------------------------------------------------------------

/** L0 框架：基本法/红线/证据契约/工具规范（config home prompts 文本注入，随发版） */
export interface L0FrameworkSource {
  kind: 'L0-framework'
  /** 框架版本号（W 段锚；拟稿见文件头注） */
  fwkVersion: string
  /** config home prompts 全文（注入，不读盘） */
  frameworkPrompts: string
}

/** L1 公司提示词段（templates/.../prompts/company.md 的节；可标不可信） */
export type CompanySectionKind = 'mission' | 'direction' | 'campaign' | 'identity'

export interface CompanyPromptSection {
  kind: CompanySectionKind
  /** 该节正文行（一节一行数组，机械可裁的战役节=一票/一句一行） */
  lines: string[]
  /** 网页可编辑内容 → 组装时按不可信隔离（C2-10） */
  untrusted?: boolean
}

/** L1 公司：使命/方向/战役（CompanySnapshot + prompts/company.md 文本） */
export interface L1CompanySource {
  kind: 'L1-company'
  snapshot: CompanySnapshot
  sections: CompanyPromptSection[]
}

/** L2 组织：部门 config 文本（主管/职能/泳道/relations）+ 署名 */
export interface L2OrgSource {
  kind: 'L2-org'
  /** 部门 config 文本（公司 git 目录 daemon 唯一写入 → 受信） */
  deptConfig: string
  /** 本单署名行（[公司·部门·岗位·级别]；由网关注入，17-§7） */
  signature?: string
}

/** L3 人事档案事实段六节（C2-04 固定六节的摘要源） */
export type PersonSectionKind =
  | 'position' // 定位
  | 'duties' // 职责
  | 'work_history' // 做过的事（一单一行，旧→新；唯一可裁节）
  | 'skills' // 技能本体
  | 'profile' // 表现画像（数字；永不裁）
  | 'self_narrative' // 自述（本人写；注入标「自述」，不参与派工匹配，C2-12）

export interface PersonFactSection {
  kind: PersonSectionKind
  /** 事实段行（零 LLM 机械归集；work_history 一单一行，旧→新） */
  lines: string[]
  /** 档案页=网页可编辑 → 按不可信隔离（C2-10；由调用方标） */
  untrusted?: boolean
}

/** L3 个人：PersonRef + 人事档案事实段文本 */
export interface L3PersonSource {
  kind: 'L3-person'
  person: PersonRef
  sections: PersonFactSection[]
}

/** L4 项目：任务书要素 + 冻结验收 + 同类教训 top-k */
export interface L4TaskSource {
  kind: 'L4-task'
  ticket: TicketId
  attempt: AttemptNo
  /** 目标（一句话） */
  objective: string
  /** 冻结验收口径（验收命令，一命令一行；冻结后禁改，永不裁） */
  acceptance: string[]
  /** 文档章节引用（纪律 1：实现单必须引用设计文档章节号） */
  docRefs: string[]
  /** 同类教训 top-k（一票一行，排名序；超长时可减半，C2-09） */
  lessons: string[]
  /** 范围边界（可选） */
  scope?: string[]
}

/** L5 工具：executor 能力声明序列化 + 插件 manifest 摘要 */
export interface L5ToolSource {
  kind: 'L5-tool'
  adapter: string
  version: string
  capabilities: ExecutorCapabilities
  /** 插件 manifest 摘要行（可选） */
  plugins?: string[]
}

/** 六层内容源联合（L0-L5 定序见 LAYER_ORDER） */
export type LayerSource =
  | L0FrameworkSource
  | L1CompanySource
  | L2OrgSource
  | L3PersonSource
  | L4TaskSource
  | L5ToolSource

// ---------------------------------------------------------------------------
// 层记录（每层 {id, content, source, fingerprint}——任务书口径 + 裁剪/隔离元数据）
// ---------------------------------------------------------------------------

export interface PromptLayer {
  id: LayerId
  /** 渲染后层正文（不含层定界标记——由 assemble 包裹；含本层 trim 区标记） */
  content: string
  /** 内容源登记（C2-07：答得出谁改/依据哪单） */
  source: string
  /** 指纹段身份：L0=fwkVersion｜L3=工号｜L4=`<单号>.<att>`｜L5=`<adapter>@<ver>`；L1/L2='' */
  identity: string
  /** 单层指纹段（C2-08 冻结式；裁剪后由 trim 重算） */
  fingerprint: string
  /** 含永不裁内容（L0 红线/证据契约｜L2 署名｜L4 验收口径）——声明性防线 */
  protected: boolean
  /** 本层命令形态行剥离数（不可信隔离；assemble 汇总，daemon 记事件） */
  sanitized: number
  /** 显式可裁区（裁剪器结构性只动这里；L0/L2 恒空） */
  trimmables: TrimmableRegion[]
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

/** 输入内容拒收走私标记（定界/trim 标记只能由构建器生成——C2-06 结构性保证） */
function assertNoSmuggledMarkers(text: string, where: string): void {
  if (ANY_LAYER_MARKER.test(text)) {
    throw new Error(`prompt/layers: 输入内容走私层定界标记（${where}）——拒收（C2-06 层内无他层标记）`)
  }
  if (ANY_TRIM_MARKER.test(text)) {
    throw new Error(`prompt/layers: 输入内容走私 trim 区标记（${where}）——拒收（trim 区只能由构建器声明）`)
  }
}

/** 普通节渲染：受信=原样；不可信=消毒（剥离命令形态行+引用块包裹+非指令声明） */
function renderSection(title: string, lines: readonly string[], untrusted: boolean | undefined): {
  text: string
  sanitized: number
} {
  const body = lines.join('\n')
  assertNoSmuggledMarkers(body, title)
  if (untrusted === true) {
    const s = sanitizeUntrusted(body)
    return { text: `## ${title}\n${s.text}`, sanitized: s.stripped }
  }
  return { text: `## ${title}\n${body}`, sanitized: 0 }
}

/** 可裁节渲染：先消毒（如标不可信）再入 trim 区；区內行=非空行 */
function renderTrimmableSection(
  title: string,
  kind: TrimmableKind,
  lines: readonly string[],
  untrusted: boolean | undefined,
): { text: string; sanitized: number; region: TrimmableRegion } {
  const body = lines.join('\n')
  assertNoSmuggledMarkers(body, title)
  const inner =
    untrusted === true ? sanitizeUntrusted(body) : { text: body, stripped: 0 }
  const regionLines = inner.text
    .split('\n')
    .filter((l) => l.trim() !== '').length
  const text = [
    `## ${title}`,
    trimMarkerBegin(kind),
    inner.text,
    trimMarkerEnd(kind),
  ].join('\n')
  return { text, sanitized: inner.stripped, region: { kind, lines: regionLines } }
}

function buildL0(src: L0FrameworkSource): PromptLayer {
  assertNoSmuggledMarkers(src.frameworkPrompts, 'L0.frameworkPrompts')
  const content = [
    '# L0 · 框架（基本法/红线/证据契约/工具规范——随发版维护，永不裁）',
    src.frameworkPrompts,
  ].join('\n')
  return {
    id: 'L0',
    content,
    source: `config-home/prompts@fwk-${src.fwkVersion}`,
    identity: src.fwkVersion,
    fingerprint: layerFingerprint('L0', src.fwkVersion, content),
    protected: true,
    sanitized: 0,
    trimmables: [],
  }
}

const COMPANY_SECTION_TITLES: Readonly<Record<CompanySectionKind, string>> = {
  mission: '使命',
  direction: '当前方向',
  campaign: '战役',
  identity: '公司身份提示（署名规则）',
}

function buildL1(src: L1CompanySource): PromptLayer {
  const snap = src.snapshot
  const head = [
    `# L1 · 公司（${snap.name}｜${snap.slug}｜等级 ${snap.level}）`,
    `- 章程引用：${snap.charter}`,
  ].join('\n')
  const parts: string[] = [head]
  const trimmables: TrimmableRegion[] = []
  let sanitized = 0
  // 定序渲染（mission → direction → campaign → identity），输入乱序不出错（C2-11 确定性）
  for (const kind of ['mission', 'direction', 'campaign', 'identity'] as const) {
    const matches = src.sections.filter((s) => s.kind === kind)
    if (matches.length > 1) throw new Error(`prompt/layers: L1 节重复（${kind}）——拒收`)
    if (matches.length === 0) continue
    const section = matches[0]!
    if (kind === 'campaign') {
      // 战役=唯一可裁节（C2-09：超长时降一句）
      const r = renderTrimmableSection(COMPANY_SECTION_TITLES[kind], 'campaign', section.lines, section.untrusted)
      parts.push(r.text)
      trimmables.push(r.region)
      sanitized += r.sanitized
    } else {
      const r = renderSection(COMPANY_SECTION_TITLES[kind], section.lines, section.untrusted)
      parts.push(r.text)
      sanitized += r.sanitized
    }
  }
  const content = parts.join('\n')
  return {
    id: 'L1',
    content,
    source: `<${snap.slug}>/prompts/company.md + org-config`,
    identity: '',
    fingerprint: layerFingerprint('L1', '', content),
    protected: false,
    sanitized,
    trimmables,
  }
}

function buildL2(src: L2OrgSource): PromptLayer {
  assertNoSmuggledMarkers(src.deptConfig, 'L2.deptConfig')
  const parts = [
    '# L2 · 组织（部门/岗位/汇报线/署名——署名永不裁）',
    src.deptConfig,
    '## 署名（永不裁）',
    '- 署名格式 [公司·部门·岗位·级别]，由框架网关注入——worker 不得自拼、不得漏带、不得伪造',
  ]
  if (src.signature !== undefined) {
    assertNoSmuggledMarkers(src.signature, 'L2.signature')
    parts.push(`- 本单署名：${src.signature}`)
  }
  const content = parts.join('\n')
  return {
    id: 'L2',
    content,
    source: 'departments/**/config.yaml + 网关署名注入',
    identity: '',
    fingerprint: layerFingerprint('L2', '', content),
    protected: true, // 署名所在层（任务书口径）
    sanitized: 0,
    trimmables: [],
  }
}

const PERSON_SECTION_TITLES: Readonly<Record<PersonSectionKind, string>> = {
  position: '定位',
  duties: '职责',
  work_history: '做过的事（旧→新；超长时保留最近 N 单）',
  skills: '技能本体',
  profile: '表现画像（数字；永不裁）',
  self_narrative: '自述（本人写；不参与派工匹配与绩效，C2-12）',
}

function buildL3(src: L3PersonSource): PromptLayer {
  const p = src.person
  const head = `# L3 · 个人（${p.name}｜工号 ${p.id}｜等级 ${p.level}｜部门 ${p.dept}）`
  const parts: string[] = [head]
  const trimmables: TrimmableRegion[] = []
  let sanitized = 0
  const ORDER: readonly PersonSectionKind[] = [
    'position',
    'duties',
    'work_history',
    'skills',
    'profile',
    'self_narrative',
  ]
  for (const kind of ORDER) {
    const matches = src.sections.filter((s) => s.kind === kind)
    if (matches.length > 1) throw new Error(`prompt/layers: L3 节重复（${kind}）——拒收`)
    if (matches.length === 0) continue
    const section = matches[0]!
    if (kind === 'work_history') {
      // 做过的事=唯一可裁节（C2-09：留最近 N 单+画像数字；画像在区外结构性保留）
      const r = renderTrimmableSection(PERSON_SECTION_TITLES[kind], 'work_history', section.lines, section.untrusted)
      parts.push(r.text)
      trimmables.push(r.region)
      sanitized += r.sanitized
    } else {
      const r = renderSection(PERSON_SECTION_TITLES[kind], section.lines, section.untrusted)
      parts.push(r.text)
      sanitized += r.sanitized
    }
  }
  const content = parts.join('\n')
  return {
    id: 'L3',
    content,
    source: `people/${p.id}.md 事实段摘要`,
    identity: p.id,
    fingerprint: layerFingerprint('L3', p.id, content),
    protected: false,
    sanitized,
    trimmables,
  }
}

function buildL4(src: L4TaskSource): PromptLayer {
  if (src.acceptance.length === 0) {
    throw new Error('prompt/layers: L4 验收口径为空——无验收不派工（纪律 3：无证据=无完成）')
  }
  if (src.docRefs.length === 0) {
    throw new Error('prompt/layers: L4 文档章节引用为空——实现单必须引用设计文档章节号（纪律 1：文档先行）')
  }
  for (const line of [...src.acceptance, ...src.docRefs, ...src.lessons, ...(src.scope ?? [])]) {
    assertNoSmuggledMarkers(line, 'L4')
  }
  assertNoSmuggledMarkers(src.objective, 'L4.objective')
  const parts = [
    `# L4 · 项目（${src.ticket}｜第 ${src.attempt} 次尝试）`,
    '## 目标',
    src.objective,
    '## 验收口径（冻结；冻结后禁改——验收命令以此为准，永不裁）',
    '```bash',
    src.acceptance.join('\n'),
    '```',
    '## 文档章节引用（文档先行：实现与文档冲突时停手改文档）',
    src.docRefs.map((r) => `- ${r}`).join('\n'),
  ]
  const trimmables: TrimmableRegion[] = []
  if (src.lessons.length > 0) {
    // 同类教训 top-k=可裁节（C2-09：超长时减半——区外验收口径结构性不动）
    const r = renderTrimmableSection('同类教训 top-k（一票一行，排名序；超长时减半）', 'lessons', src.lessons, undefined)
    parts.push(r.text)
    trimmables.push(r.region)
  }
  if (src.scope !== undefined && src.scope.length > 0) {
    parts.push(`## 范围\n${src.scope.map((s) => `- ${s}`).join('\n')}`)
  }
  const content = parts.join('\n')
  return {
    id: 'L4',
    content,
    source: `任务书要素 + 冻结验收 + 教训 top-k（${src.ticket}.${src.attempt}）`,
    identity: `${src.ticket}.${src.attempt}`,
    fingerprint: layerFingerprint('L4', `${src.ticket}.${src.attempt}`, content),
    protected: true, // 验收口径所在层（任务书口径；教训区=显式 trim 区例外，C2-09）
    sanitized: 0,
    trimmables,
  }
}

/** ExecutorCapabilities 序列化（固定键序——同能力同 bytes，C2-11） */
export function serializeCapabilities(c: ExecutorCapabilities): string {
  return JSON.stringify({
    budget_cap: c.budget_cap,
    cancel_turn: c.cancel_turn,
    session_resume: c.session_resume,
    agents_md: c.agents_md,
    cost_native: c.cost_native,
  })
}

function buildL5(src: L5ToolSource): PromptLayer {
  const caps = serializeCapabilities(src.capabilities)
  assertNoSmuggledMarkers(caps, 'L5.capabilities')
  const parts = [
    `# L5 · 工具（executor 能力声明）`,
    `- executor：${src.adapter}@${src.version}`,
    '- 能力声明（ExecutorCapabilities，固定键序序列化）：',
    '```json',
    caps,
    '```',
  ]
  if (src.plugins !== undefined && src.plugins.length > 0) {
    for (const p of src.plugins) assertNoSmuggledMarkers(p, 'L5.plugins')
    parts.push(`- 插件 manifest：${src.plugins.join('、')}`)
  }
  const content = parts.join('\n')
  return {
    id: 'L5',
    content,
    source: `adapters/${src.adapter}@${src.version} 能力声明 + 插件 manifest`,
    identity: `${src.adapter}@${src.version}`,
    fingerprint: layerFingerprint('L5', `${src.adapter}@${src.version}`, content),
    protected: false,
    sanitized: 0,
    trimmables: [],
  }
}

/** 单源→单层（kind→id 固定映射） */
export function buildLayer(src: LayerSource): PromptLayer {
  switch (src.kind) {
    case 'L0-framework':
      return buildL0(src)
    case 'L1-company':
      return buildL1(src)
    case 'L2-org':
      return buildL2(src)
    case 'L3-person':
      return buildL3(src)
    case 'L4-task':
      return buildL4(src)
    case 'L5-tool':
      return buildL5(src)
  }
}

/** 六层齐且序（C2-06 验收：六层顺序断言）——不齐/乱序/重复即 throw */
export function assertLayerSequence(layers: readonly PromptLayer[]): void {
  if (layers.length !== LAYER_ORDER.length) {
    throw new Error(
      `prompt/layers: 层数 ${layers.length}≠6——六层齐且序（C2-06）：${LAYER_ORDER.join('→')}`,
    )
  }
  layers.forEach((layer, i) => {
    if (layer.id !== LAYER_ORDER[i]) {
      throw new Error(
        `prompt/layers: 第 ${i} 层是 ${layer.id}，期望 ${LAYER_ORDER[i]}——六层顺序断言（C2-06）`,
      )
    }
  })
}

/** 六源按冻结序构建六层（源序必须已是 L0→L5；同输入同 bytes） */
export function buildLayers(sources: readonly LayerSource[]): PromptLayer[] {
  if (sources.length !== LAYER_ORDER.length) {
    throw new Error(`prompt/layers: 内容源 ${sources.length} 份≠6——六层齐且序（C2-06）`)
  }
  const layers = sources.map(buildLayer)
  assertLayerSequence(layers)
  return layers
}
