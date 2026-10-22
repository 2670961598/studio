/**
 * 拆单物化件（130-P2，studio-dev-173；提案 §6.2.2/§6.2.3-R2/§6.5.2——studio-dev-130
 * 制作人 2026-10-22 全批）——批示:拆单＋子单清单 → daemon 单点物化子单＋父单立案收口。
 *
 * 房屋模式（提案 §6.2.2「意图→daemon 单点建单」——mention/定时岗/webhook/data-change
 * 四消费件同款，105-刀A A-2 形态）：本文件=消费 handler 工厂，零引擎内部状态持有；
 * engine.ts 只在相位 2 前置装配 tick 作用域依赖（20-§十五.三.3「先拆再增」）。
 *
 * 物化语义（提案 §6.2.2）：
 *   - 子单=issues.create({ …, type:'task', parent })——type=task 无 T:task（W-9 保留词）
 *     无 typeInbox 键 → 恒落 L0 执行轨（docs/18-§2.1.1 解析序）；**不传 initialState**
 *     （新单起走五态链，物化单与 mention 唤醒单同径）；
 *   - 幂等=清单 dedupKey（提案冻结格式 父单号#序号）落 PATROL note `intent=split:<键>`
 *     → patrolKeys（append-only 不释放，sentinel/events-index 既有面零改）——同键重投
 *     恰一次（spike S6 判负线=双建）；拍内重复靠 splitSeen（PATROL 本拍落账下拍才进
 *     索引，双屋檐与意图消费同法）；
 *   - lane 经 setField 建单后补（IssueCreate 无 lane 维，docs/25-§3.2 契约现状）；失败
 *     明报不回滚——键已花在建单（先不可逆动作后记账，重投窗口不双建），泳道回退缺省
 *     既有语义，漂移可见不静默。
 *
 * 父单立案收口（提案 §6.2.3 裁决 R2——弃 R1「停车场态」与 R3「挪用 WAIT_APPROVAL」）：
 *   - 短持定人：setField(parent,'assignee',leader)——leader=快照 departments 按父单
 *     dept 匹配（path 全量+末段名双候选，dependencies.ts 同法）；解析不到=明报拒收，
 *     **不回退 defaultPersonId**（回退会把立案派错人——mention 未知工号同款纪律）；
 *   - **零状态迁移**：待批→已派发走标准链（decide 5b approved→passGates→executeDispatch
 *     启动 leader 工位）——R1 否决理由（已派发静默>stallAfterMs=STALL 误报）与 R3 否决
 *     理由（WAIT_APPROVAL 语义挪用）都因绕链而起；本件只定「派给谁＋带什么料」；
 *   - 立案回执评论（提案 §6.5.2 产出形态）：拆单回执＋候选清单建议面＋立案任务说明
 *     （交付物=批准的需求定义＋拆单结构；收割走四要件 docs/17-§6）。署名=批示人四
 *     身份位（回执是指示人动作的留痕，daemon 不伪造身份，docs/17-§7 署名纪律）；
 *   - 独立幂等键 split:<父>#file——子单与立案解耦：leader 未解析/评论署名缺料等失败
 *     可整条重投单独补收口（子单键已花=恰一次不重建）。
 */
import type { DeptNode, FlowPlatform, IssueRecord, PersonRef, SignedBody, TicketId } from '@studio-next/contract'
import { signedBody } from '@studio-next/gateway'
import type { EventRecord } from '@studio-next/contract'
import { DEFAULT_FLOW_TABLE, flowAnchors, resolveTicketFlow, type FlowTable } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { parseSplitDirective, splitChildDescription, splitChildKey, splitFilingKey, type SplitChildSpec } from './directive.ts'
import { renderSuggestionComment, suggestAssignees, type SuggestContext } from './suggest.ts'
import { noteSafe } from '../intents/taxonomy.ts'

/** 拆单指令（已过 P0 归一层角色校验的入参——本域不做角色判断，三刀缝 §3） */
export interface SplitDirectiveInput {
  /** 父单号（提案单——子单 parent 链之源） */
  parent: TicketId
  /** 批示人（P0 已验：∈{ticket.dept leader, PRIME-0, 制作人}；回执评论署名人） */
  author: string
  /** 批示评论正文（批示行＋```split 围栏清单——parseSplitDirective 解析） */
  body: string
}

/** 物化依赖（engine tick 作用域注入——结构化窄面，零引擎内部状态持有） */
export interface SplitMaterializerDeps {
  platform: FlowPlatform
  ledger: Ledger
  syncMirror: (issue: IssueRecord) => void
  makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  tickEvents: EventRecord[]
  config: { company: string; actor: string; deptFallback: string; flows?: FlowTable }
  people: readonly PersonRef[]
  /** 部门索引（快照注入；缺省不注入=立案收口面关闭——leader 不可解析即明报） */
  departments?: readonly DeptNode[] | undefined
  errors: string[]
  onMutation: () => void
  /** 跨拍幂等索引（buildEventIndex.patrolKeys——PATROL note intent= 键全集，append-only） */
  patrolKeys: ReadonlySet<string>
  /** 拍内幂等集（本拍已物化键——PATROL 落账与索引可见之间的窗口屋檐） */
  splitSeen: Set<string>
}

/** 按父单部门解析部长（DeptNode.leader——docs/04-§二；path 全量+末段名双候选） */
function resolveLeader(departments: readonly DeptNode[] | undefined, dept: string | undefined, fallback: string): { leader: string; dept: string } | undefined {
  if (departments === undefined || departments.length === 0) return undefined
  const want = (dept !== undefined && dept.trim() !== '' ? dept : fallback).trim()
  const tail = want.split('/').at(-1) ?? want
  const hit = departments.find((d) => d.path === want) ?? departments.find((d) => d.name === tail)
  return hit === undefined ? undefined : { leader: hit.leader, dept: hit.path }
}

/** 建议面上下文（快照/镜像/队列读数一次性快照——打分纯函数零查账） */
function buildSuggestContext(deps: SplitMaterializerDeps): SuggestContext {
  const table = deps.config.flows ?? DEFAULT_FLOW_TABLE
  const inflightTitles = new Map<string, readonly string[]>()
  for (const m of deps.ledger.listTicketMirrors()) {
    // 在途=派发→复验锚点间（dispatched/evidenceReady/verified）：与等级/类型无关的
    // 「正背着活」读数——镜像 level 经 evtLevel 钳 1..9（store 记录面），锚点名在
    // L0/L1/L2 同名（flows.ts DEFAULT_STATES），钳后查表不失真
    const flow = resolveTicketFlow(table, m.type, m.level)
    if (flow === undefined) continue
    const a = flowAnchors(flow)
    if (m.state !== a.dispatched && m.state !== a.evidenceReady && m.state !== a.verified) continue
    if (m.assignee === undefined) continue
    const list = inflightTitles.get(m.assignee) ?? []
    inflightTitles.set(m.assignee, [...list, m.issue])
  }
  const queueDepth = new Map<string, number>()
  for (const row of deps.ledger.listTodoQueue(deps.config.company)) {
    queueDepth.set(row.person, (queueDepth.get(row.person) ?? 0) + 1)
  }
  return { people: deps.people, inflightTitles, queueDepth, siblingAssignees: [] }
}

/** 立案回执评论正文（R2 交付物面＋建议面——批示人可读、leader 可照单验收） */
function renderFilingComment(parent: IssueRecord, children: ReadonlyArray<{ id: TicketId; seq: number; spec: SplitChildSpec }>, suggestLines: readonly string[]): string {
  const lines = [
    `【拆单回执】父单 ${parent.id}「${parent.title}」已物化 ${String(children.length)} 子单（幂等键=${parent.id}#<序号>，同键重投恰一次）：`,
    ...children.map((c) => `- #${String(c.seq)} ${c.spec.title} → ${c.id}（assignee=${c.spec.assignee}，dedupKey=${parent.id}#${String(c.seq)}）`),
    '',
    ...suggestLines,
    '',
    '【立案任务（父单立案制，提案 §6.2.3 R2）】本单由部长短持：',
    '1. 交付物=批准的需求定义＋拆单结构（上表即拆单结构——验收子单六字段与提案 §6.4.1 交接字段集的一致性）；',
    '2. 写立案 REPORT（子单清单＋验收结论）落工位 deliverables；',
    '3. 收割走四要件（终态 completed＋输出非空＋REPORT 落盘＋闸门 exit=0，docs/17-§6）→证据就绪→复验→已交付归档；',
    '4. 子单进度经 parent 链在部长视图聚合；拆错走声明边重开（final 态 from 边已许）。',
  ]
  return lines.join('\n')
}

/** 回执评论署名体（批示人四身份位——缺 role=署名不可组，返回 undefined 走响亮降级） */
function filingSignedBody(deps: SplitMaterializerDeps, author: string, body: string): SignedBody | undefined {
  const person = deps.people.find((p) => p.id === author)
  if (person === undefined) return undefined
  if (person.role === undefined || person.role === '') return undefined
  try {
    return signedBody({ company: deps.config.company, dept: person.dept, role: person.role, level: person.level }, person.id, body)
  } catch {
    return undefined // gateway 署名形状闸（gw-signature-*）——异常不炸物化，评论降级明报
  }
}

/**
 * 拆单物化 handler 工厂：消费单条指令（解析→逐子物化→父单立案收口）。
 * 原子性：解析失败/父单不可用=整条拒收（零物化不留半拆）；物化后失败（lane/评论/署名）
 * =明报不回滚（键已花，重投恰一次，漂移可见）。
 */
export function createSplitMaterializer(deps: SplitMaterializerDeps): (directive: SplitDirectiveInput) => Promise<void> {
  return async (directive: SplitDirectiveInput): Promise<void> => {
    const err = (msg: string): void => {
      deps.errors.push(`拆单消费：${msg}`)
    }
    // 父单亲查（平台权威态）：不存在=拒收——不猜（fail-closed）
    let parent: IssueRecord
    try {
      parent = await deps.platform.issues.get(directive.parent)
    } catch (e) {
      err(`父单 ${directive.parent} 亲查失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // 终态拒收：已交付父单再拆单=对归档单隐式重开——明报拒收（复活走平台声明边，
    // docs/49 复活令口径；不在拆单面绕状态机）
    const parentFlow = resolveTicketFlow(deps.config.flows ?? DEFAULT_FLOW_TABLE, parent.type ?? 'task', parent.level ?? 0)
    if (parentFlow !== undefined && parent.state === flowAnchors(parentFlow).delivered) {
      err(`父单 ${directive.parent} 已终态（${parent.state}）——拒收（复活走平台声明边，不在拆单面隐式重开）`)
      return
    }
    // 解析（纯）：失败=整条拒收＋建议面预挂（部长抄改即重投——缺 assignee 时给候选清单）
    const parsed = parseSplitDirective(directive.body)
    const suggestCtx = buildSuggestContext(deps)
    if (!parsed.ok) {
      err(`父单 ${directive.parent} 清单解析失败：${parsed.reason}——整条拒收（零物化）`)
      // 缺点将专用建议面：解析失败也可能只是缺人——挂建议评论帮部长抄改（幂等：评论不
      // 入幂等键域，失败重投会再挂=可见冗余，可接受；「恰一次」契约只司建单）
      if (parsed.reason.includes('assignee')) {
        await attachSuggestionOnly(deps, directive, suggestCtx)
      }
      return
    }
    const children = parsed.children
    // 子单 assignee 全员人事校验（fail-closed 无 defaultPersonId 兜底——错人比不派更糟）
    for (let i = 0; i < children.length; i += 1) {
      const c = children[i]
      if (c !== undefined && !deps.people.some((p) => p.id === c.assignee)) {
        err(`父单 ${directive.parent} 子单 #${String(i + 1)} assignee=${c.assignee} 不在人事索引——整条拒收（明报不静默，mention 未知工号同款纪律）`)
        return
      }
    }
    // —— 逐子物化（键=split:<父>#<序号>；命中即跳过=幂等，重投窗口不双建） ——
    const materialized: Array<{ id: TicketId; seq: number; spec: SplitChildSpec }> = []
    for (let seq = 1; seq <= children.length; seq += 1) {
      const spec = children[seq - 1]
      if (spec === undefined) continue
      const key = splitChildKey(directive.parent, seq)
      if (deps.patrolKeys.has(key) || deps.splitSeen.has(key)) {
        continue
      }
      try {
        const created = await deps.platform.issues.create({
          title: spec.title,
          description: splitChildDescription(directive.parent, seq, spec),
          type: 'task',
          ...(parent.dept !== undefined ? { dept: parent.dept } : {}),
          ...(spec.level !== undefined ? { level: spec.level } : { level: 0 }),
          assignee: spec.assignee,
          parent: directive.parent,
        })
        deps.syncMirror(created)
        // 键只在建单成功后落（先不可逆动作后记账）——S6 判负线（双建）的结构性防线
        deps.splitSeen.add(key)
        deps.makeEvent('PATROL', created, 1, deps.tickEvents, {
          note: `intent=${noteSafe(key)};parent=${noteSafe(directive.parent)};assignee=${noteSafe(spec.assignee)};title=${noteSafe(spec.title)};dedup=${noteSafe(`${directive.parent}#${String(seq)}`)};来源=批示:拆单（${noteSafe(directive.author)}）`,
        })
        if (spec.lane !== undefined) {
          try {
            await deps.platform.issues.setField(created.id, 'lane', spec.lane)
          } catch (e) {
            err(`子单 ${created.id} 泳道 ${spec.lane} 补写失败（回退缺省泳道，漂移可见不静默）：${e instanceof Error ? e.message : String(e)}`)
          }
        }
        deps.onMutation()
        materialized.push({ id: created.id, seq, spec })
      } catch (e) {
        err(`子单 #${String(seq)}「${spec.title}」物化失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // —— 父单立案收口（独立键 split:<父>#file；与子单解耦可单独重投补收） ——
    await fileParent(deps, directive, parent, children, materialized, suggestCtx)
  }
}

/** 父单立案收口本体（leader 定人＋立案回执评论＋PATROL 收口键） */
async function fileParent(
  deps: SplitMaterializerDeps,
  directive: SplitDirectiveInput,
  parent: IssueRecord,
  children: readonly SplitChildSpec[],
  materialized: ReadonlyArray<{ id: TicketId; seq: number; spec: SplitChildSpec }>,
  suggestCtx: SuggestContext,
): Promise<void> {
  const fkey = splitFilingKey(directive.parent)
  if (deps.patrolKeys.has(fkey) || deps.splitSeen.has(fkey)) {
    return
  }
  // leader 解析（缺部门索引=面关闭明报——不兜底派错人）
  const resolved = resolveLeader(deps.departments, parent.dept, deps.config.deptFallback)
  if (resolved === undefined) {
    deps.errors.push(`拆单消费：父单 ${directive.parent} 立案收口失败——部门索引缺 ${parent.dept ?? deps.config.deptFallback} 或未注入 departments（leader 不可解析，不兜底 defaultPersonId）；子单已物化键不回滚，修复后整条重投只补收口`)
    return
  }
  // 建议面（§6.5.2：批示:拆单时附候选清单＋打分理由——集中派工入装配）
  const suggestLines: string[] = []
  const siblings = children.map((c) => c.assignee)
  for (let i = 0; i < children.length; i += 1) {
    const c = children[i]
    if (c === undefined) continue
    const suggestions = suggestAssignees(c, { ...suggestCtx, siblingAssignees: siblings })
    suggestLines.push(renderSuggestionComment(c.title, suggestions))
  }
  // 短持定人（assignee=leader）——状态零迁移：待批→已派发走标准链（decide 5b→executeDispatch）
  try {
    await deps.platform.issues.setField(directive.parent, 'assignee', resolved.leader)
  } catch (e) {
    deps.errors.push(`拆单消费：父单 ${directive.parent} 立案定人失败（setField assignee=${resolved.leader}）：${e instanceof Error ? e.message : String(e)}`)
    return
  }
  // 立案回执评论（署名=批示人；缺料=响亮降级：明报跳过，收口照走——评论是留痕面非闸门）
  const body = renderFilingComment(parent, materialized.length > 0 ? materialized : children.map((c, i) => ({ id: `（幂等命中未重建）`, seq: i + 1, spec: c })), suggestLines)
  const signed = filingSignedBody(deps, directive.author, body)
  if (signed === undefined) {
    deps.errors.push(`拆单消费：父单 ${directive.parent} 立案回执评论署名不可组（批示人 ${directive.author} 不在人事索引或缺 role）——评论跳过，收口其余照走（响亮降级不静默）`)
  } else {
    try {
      await deps.platform.comments.add(directive.parent, signed)
    } catch (e) {
      deps.errors.push(`拆单消费：父单 ${directive.parent} 立案回执评论写入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 收口留痕（键=split:<父>#file；父单镜像随定人刷新）
  deps.splitSeen.add(fkey)
  const refreshed = await deps.platform.issues.get(directive.parent)
  deps.syncMirror(refreshed)
  deps.makeEvent('PATROL', refreshed, 1, deps.tickEvents, {
    note: `intent=${noteSafe(fkey)};children=${String(children.length)};leader=${noteSafe(resolved.leader)};dept=${noteSafe(resolved.dept)};来源=批示:拆单（${noteSafe(directive.author)}）`,
  })
  deps.onMutation()
}

/** 解析失败时的建议面预挂（缺点将的抄改材料——评论不入幂等键域） */
async function attachSuggestionOnly(deps: SplitMaterializerDeps, directive: SplitDirectiveInput, suggestCtx: SuggestContext): Promise<void> {
  // 解析失败拿不到逐子单结构——按正文行内的 title 线索给全员排序清单（粗粒度但有抄改价值）
  const excerpt = directive.body.replace(/\s+/g, ' ').trim().slice(0, 60)
  const suggestions = suggestAssignees({ title: excerpt }, suggestCtx)
  const signed = filingSignedBody(deps, directive.author, `【拆单清单退回】${directive.parent} 的子单清单解析失败（缺点将等），原因见事件 errors。部长补全 assignee 后重投批示即物化。\n\n${renderSuggestionComment(excerpt, suggestions)}`)
  if (signed === undefined) return
  try {
    await deps.platform.comments.add(directive.parent, signed)
  } catch (e) {
    deps.errors.push(`拆单消费：父单 ${directive.parent} 建议评论写入失败：${e instanceof Error ? e.message : String(e)}`)
  }
}
