/**
 * prompt-assembly —— daemon 侧默认装配器（docs/17-§5 装配管线的 daemon 接线）
 *
 * 依据：
 *   - docs/17-§5：六层装配 → AGENTS.md + 任务书；分层指纹记账（C2-08 冻结式）。
 *     prompt 包纯逻辑零盘 IO（「落盘归 daemon」）——本文件即 daemon 侧落盘者：
 *     buildLayers(sources) → assembleAgentsMd + renderTaskBrief → 写盘（engine 调用）。
 *   - docs/04-§六 B5：AGENTS.md 落点通道优先用户级；按 adapter 能力声明路由（engine 侧）：
 *     native=workspace 根（原生发现通道）；user_level/append=bridge 插件通道——每任务
 *     指令临时文件（workspace 外，<rootDir>/tmp/instructions/<单号>.md，0600），launch env
 *     STUDIO_NEXT_INSTRUCTIONS 指向它、由 dsh 宿主插件 studio-next-bridge 消费注入系统
 *     提示 persona 前缀段（docs/25-§3.1 v1.5 裁决#1；清理策略=保留至收割完成再删）。
 *   - 署名 [公司·部门·岗位·级别] 由网关注入（17-§7）——v0 无网关，本装配器代拼（拟稿，
 *     真网关接线后改为透传网关注入值）。
 *
 * v0 边界（诚实标注）：
 *   - 续跑版已接线（129-E 单E，studio-dev-184，F1-15/17-§5）：装配入参带 resume 三元组
 *     时出**续跑版**（renderTaskBrief kind='resume'——上次 summary.json 前情摘要注入）；
 *     resume 判据=resume 意图消费（engine/intents/relay-resume.ts——work_records 断点
 *     解析），sidecar 读取=resolveResumePlan（同文件）。不带 resume=首版（既有行为）。
 *   - 同类教训 top-k（L4 lessons）v0 传空——知识库检索面未接线。
 *   - 冻结验收命令（L4 acceptance）来自 daemon 配置常量注入，任务书粒度的验收冻结
 *     （单据验收命令字段）归真单刀。
 *
 * 出口义务（IMPL-06-12，治 L3N-01；docs/v2/15 §4.5、docs/v2/16 §三 prompt 行、
 * docs/80-§11.2.1「内部供给」面、docs/audit-DSF/L3-N-细节层-逐文件B-DSF.md L3N-01）：
 *   daemon 追加的「单据读面」节（含单据正文/评论——最高频凭据误贴面）在 prompt 包闸外，
 *   故**成品 brief.text** 在返回/落盘前由 daemon 统一过 `redactKnown`（只换已知秘密值、
 *   不做形状兜底；提示词/任务书是内部供给面，示例文本必须原样可见）。无扫描通道的出口
 *   逐条登记缺口（`AssembleDispatchOutput.exitScan.gaps`，不静默放行、不冒充已扫描）；
 *   AGENTS.md 出口本单无扫描通道（prompt 包秘密边界未落位），同样登记缺口。
 */
import path from 'node:path'
import type {
  CompanySnapshot,
  ExecutorCapabilities,
  IssueRecord,
  PersonRef,
  SummarySidecar,
} from '@studio-next/contract'
import {
  assembleAgentsMd,
  buildLayers,
  renderTaskBrief,
  type AssembleResult,
  type BriefRenderResult,
} from '@studio-next/prompt'
import { renderReadViewSection } from './read-tiers.ts'
import type { TicketReadView } from './read-tiers.ts'

/** 装配入参（engine 派发相位组装；一切内容参数注入） */
export interface AssembleDispatchInput {
  issue: IssueRecord
  attempt: number
  /** 派工对象（issue.assignee 在公司目录 people 索引中的档案；缺省回退快照首位） */
  person: PersonRef
  adapterName: string
  adapterVersion: string
  capabilities: ExecutorCapabilities
  workspace: string
  briefPath: string
  /** AGENTS.md 落点（engine 按通道能力路由：native=workspace 根；user_level/append=bridge 每任务指令临时文件） */
  agentsTarget: string
  /** AGENTS.md 通道说明（随任务书注入；channel 与 target 同 TaskBrief.AGENTS_MD） */
  agentsChannel: { channel: 'native' | 'user_level' | 'append_system_prompt'; target: string }
  /**
   * 单据读面视图（17-§7 读面分级：engine 按岗选档 createView 构造后注入——装配期
   * 选择非运行期闸）。消费面：任务书追加「单据读面」节（三档同源）+ Blind 档边界
   * 声明入 L4 scope（持久通道抗 compact）。
   */
  readView: TicketReadView
  /**
   * 续跑上下文（129-E 单E，F1-15/17-§5 续跑版）：在场=任务书出续跑版（前情摘要注入
   * 上次 summary.json）；缺省=首版（既有行为零变更）。三元组=engine 侧断点解析产物
   * （resolveResumePlan——work_records 最后一条带 session 工时单），executor 不可续时
   * engine 不注入（降级为新派，F1-15）。note=续跑缘由（202-P1：策划验收打回理由
   * 前情注入行；缺省无行）。
   */
  resume?: {
    sessionId: string
    summaryPath: string
    /** 上次 summary.json 内容（SummarySidecar 形状，contract schemas/report.ts） */
    summary: SummarySidecar
    /** 续跑缘由（202-P1 打回理由前情注入；缺省无行） */
    note?: string
  }
}

/** 装配产物：AGENTS.md 组装结果（含分层指纹/字节清单）+ 任务书渲染结果（含 TaskBrief） */
export interface AssembleDispatchOutput {
  agentsMd: AssembleResult
  brief: BriefRenderResult
  /**
   * 出口扫描台账（IMPL-06-12 出口义务；docs/v2/15 §4.5）：
   *   - scanned：已过 `redactKnown` 的成品文本位（仅有扫描通道时记；不得冒充）
   *   - gaps：无扫描通道的出口登记码（逐条登记，不静默放行）——
   *     · `brief.text:no-scan-channel`：未注入 redactKnown（成品任务书未过已知值脱敏）；
   *     · `agentsMd.text:no-scan-channel`：持久指令出口不在本单扫描范围（prompt 包
   *       秘密边界未落位；本单只承担成品 brief.text 出口义务）。
   */
  exitScan: {
    readonly scanned: readonly string[]
    readonly gaps: readonly string[]
  }
}

/** 装配器端口（engine deps 注入点；默认实现见 createDefaultAssembler） */
export type PromptAssembler = (input: AssembleDispatchInput) => AssembleDispatchOutput

/** 默认装配器上下文（公司级静态内容源；快照来自 packages/company 挂载） */
export interface AssemblerContext {
  fwkVersion: string
  /** L0 框架提示词全文（config home prompts 注入；v0 由 serve 配置常量给） */
  frameworkPrompts: string
  snapshot: CompanySnapshot
  /** 冻结验收命令（一命令一行；冻结后禁改） */
  acceptance: string[]
  /** 文档章节引用（纪律 1：文档先行） */
  docRefs: string[]
  /** 同类教训 top-k（v0 空） */
  lessons?: string[]
  /**
   * 出口扫描通道（IMPL-06-12；docs/80-§11.2.1「内部供给」面）：`redactKnown` 是
   * KnownSecretSet.redactKnown 的结构子集——只把**已知秘密值**替换为 `<redacted:N>`，
   * **不做形状兜底**（提示词/任务书是内部供给面：`password=…` 一类示例/夹具文本必须
   * 原样可见，走 redactOutbound 会连教学文本一起毁掉）。装配期接线：
   * `assembly/hrsync/assemble.ts` 的 `createRedactors(knownSecrets).redactKnown`。
   * 缺省=无扫描通道：成品出口在 AssembleDispatchOutput.exitScan.gaps 登记缺口
   * （不静默放行、不冒充已扫描）。
   */
  redactKnown?: (text: string) => string
  /**
   * 出口扫描台账日志面（可选）：只报出口名/缺口码，**绝不回显秘密值**。缺省不落日志——
   * 缺口登记恒在输出 exitScan 中，不依赖日志面。
   */
  log?: (line: string) => void
}

/** 部门正文（L2 deptConfig）：快照 DeptNode → 受信文本（公司 git 目录 daemon 唯一写入） */
function deptConfigText(snapshot: CompanySnapshot, deptPath: string | undefined): string {
  const dept =
    (deptPath !== undefined ? snapshot.departments.find((d) => d.path === deptPath) : undefined) ??
    snapshot.departments[0]
  if (dept === undefined) return `# 部门（快照无部门——单部门公司兜底文本）`
  const relations = dept.relations.length > 0 ? dept.relations.map((r) => `${r.type}→${r.to}`).join('、') : '无'
  return [
    `- 部门：${dept.name}（${dept.path}｜层级 ${dept.level}｜主管 ${dept.leader}）`,
    `- 职能：${dept.functions.join('、')}`,
    `- 泳道：${dept.lanes.join('、')}`,
    `- 跨部门关系：${relations}`,
  ].join('\n')
}

/** v0 署名代拼（拟稿：真网关注入后此处改透传，17-§7） */
function signatureOf(snapshot: CompanySnapshot, person: PersonRef): string {
  return `[${snapshot.name}·${person.dept}·${person.name}·${person.level}]`
}

/** 默认装配器：六源 → buildLayers → assembleAgentsMd + renderTaskBrief（首版/续跑版——
 * input.resume 在场切续跑版，129-E studio-dev-184；prompt 包两模板既有实现零改） */
export function createDefaultAssembler(ctx: AssemblerContext): PromptAssembler {
  return (input: AssembleDispatchInput): AssembleDispatchOutput => {
    const person = input.person
    // 读面分级消费面之一（17-§7）：Blind 档的防污染边界声明 + 产出物路径入 L4 scope——
    // L4 是 AGENTS.md 持久层（抗 auto-compact），任务书可能被压缩而边界必须长存；
    // 生成者正文/评论结构性不入（Blind 视图无此数据——结构保证，read-tiers.ts 头注）
    const blindScope =
      input.readView.tier === 'blind'
        ? [
            '读面=Blind（17-§7 验证岗防生成者上下文污染）：单据正文与评论对本任务一概不可见——verify 的是证据不是叙事，完成判定只依据冻结验收命令与产出物路径',
            ...(input.readView.artifacts ?? []).map((p) => `产出物路径：\`${p}\``),
          ]
        : undefined
    const layers = buildLayers([
      {
        kind: 'L0-framework',
        fwkVersion: ctx.fwkVersion,
        frameworkPrompts: ctx.frameworkPrompts,
      },
      { kind: 'L1-company', snapshot: ctx.snapshot, sections: [] },
      {
        kind: 'L2-org',
        deptConfig: deptConfigText(ctx.snapshot, person.dept ?? input.issue.dept),
        signature: signatureOf(ctx.snapshot, person),
      },
      {
        kind: 'L3-person',
        person,
        sections: [{ kind: 'position', lines: [`${person.name}（login ${person.login}｜等级 ${person.level}｜部门 ${person.dept}）`] }],
      },
      {
        kind: 'L4-task',
        ticket: input.issue.id,
        attempt: input.attempt,
        objective: input.issue.title,
        acceptance: ctx.acceptance,
        docRefs: ctx.docRefs,
        lessons: ctx.lessons ?? [],
        ...(blindScope !== undefined ? { scope: blindScope } : {}),
      },
      {
        kind: 'L5-tool',
        adapter: input.adapterName,
        version: input.adapterVersion,
        capabilities: input.capabilities,
      },
    ])
    const agentsMd = assembleAgentsMd(layers)
    // 任务书两版（129-E 续跑版接线，17-§5）：resume 在场=续跑版（前情摘要注入）；
    // 缺省=首版。kind 与 ctx.resume 同源传入——renderTaskBrief('resume') 缺 resume
    // 会 throw（prompt 包契约「不静默降级为首版」，此处恒满足）
    const briefKind = input.resume !== undefined ? 'resume' : 'first'
    const brief = renderTaskBrief(briefKind, {
      ticket: input.issue.id,
      attempt: input.attempt,
      workspace: input.workspace,
      briefPath: input.briefPath,
      agentsChannel: input.agentsChannel,
      acceptance: ctx.acceptance,
      docRefs: ctx.docRefs,
      objective: input.issue.title,
      ...(input.resume !== undefined ? { resume: input.resume } : {}),
    })
    // 读面分级消费面之二（17-§7）：任务书追加「单据读面」节——任务书是 per-attempt
    // 操作面（wkey 指引行同款落点裁决，AGENTS.md 是六层组装产物追加破层纯净度，
    // read-tiers.ts 头注）；三档各自的全量/摘要/最小面在此呈现
    const withView: BriefRenderResult = {
      ...brief,
      text: `${brief.text}${renderReadViewSection(input.readView)}`,
    }
    // 出口义务（IMPL-06-12；头注与 docs/v2/15 §4.5）：成品 brief.text（已含 daemon
    // 追加的读面节——正文/评论是最高频凭据误贴面，L3N-01）统一过 redactKnown；
    // 无扫描通道=显式缺口登记（不静默放行、不冒充已扫描）。AGENTS.md 是六层组装
    // 产物，本单无扫描通道（prompt 包秘密边界未落位）——同样登记缺口。
    const scanned: string[] = []
    const gaps: string[] = []
    let text = withView.text
    if (ctx.redactKnown !== undefined) {
      text = ctx.redactKnown(text)
      scanned.push('brief.text')
    } else {
      gaps.push('brief.text:no-scan-channel')
    }
    gaps.push('agentsMd.text:no-scan-channel')
    const exitScan: AssembleDispatchOutput['exitScan'] = { scanned, gaps }
    // 日志面只报出口名/缺口码（绝不回显秘密值）；缺省不落日志，缺口登记恒在 exitScan
    ctx.log?.(
      `[prompt-assembly] 出口扫描：已扫描 ${scanned.length > 0 ? scanned.join('、') : '无'}；` +
        `缺口 ${gaps.length > 0 ? gaps.join('、') : '无'}（登记不静默）`,
    )
    return { agentsMd, brief: { ...withView, text }, exitScan }
  }
}

/**
 * .AIWS 工位路径（docs/43-§五，DEV-28）：`<aiwsRoot>/<部门路径>/<工号>/tickets/<单号>/att<N>`
 * ——部门路径逐段展开（person.dept 是 '/' 分隔路径串）；派工对象的家+tickets+attempt。
 * 纯函数（serve 日志与测试断言同源；engine 内 executeDispatch 消费）。自 engine.ts
 * 抽件——20-§十五「先拆再增」，workspace 落点属装配关注。
 */
export function aiwsWorkspaceOf(
  aiwsRoot: string,
  person: { dept: string; id: string },
  ticket: string,
  attempt: number,
): string {
  return path.join(aiwsRoot, ...person.dept.split('/'), person.id, 'tickets', ticket, `att${attempt}`)
}
