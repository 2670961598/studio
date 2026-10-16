/**
 * prompt-assembly —— daemon 侧默认装配器（docs/17-§5 装配管线的 daemon 接线）
 *
 * 依据：
 *   - docs/17-§5：六层装配 → AGENTS.md + 任务书；分层指纹记账（C2-08 冻结式）。
 *     prompt 包纯逻辑零盘 IO（「落盘归 daemon」）——本文件即 daemon 侧落盘者：
 *     buildLayers(sources) → assembleAgentsMd + renderTaskBrief → 写盘（engine 调用）。
 *   - docs/04-§六 B5：AGENTS.md 落点通道优先用户级；v0 demo 按 adapter 能力声明走
 *     workspace 根（native 通道），用户级通道落点注入归后续刀（拟稿）。
 *   - 署名 [公司·部门·岗位·级别] 由网关注入（17-§7）——v0 无网关，本装配器代拼（拟稿，
 *     真网关接线后改为透传网关注入值）。
 *
 * v0 边界（诚实标注）：
 *   - 任务书只出**首版**（renderTaskBrief kind='first'）；续跑版（上次 summary.json 前情
 *     注入，17-§5）归 v0.5 真单刀（engine 侧 resume 判据与 sidecar 读取待接线）。
 *   - 同类教训 top-k（L4 lessons）v0 传空——知识库检索面未接线。
 *   - 冻结验收命令（L4 acceptance）来自 daemon 配置常量注入，任务书粒度的验收冻结
 *     （单据验收命令字段）归真单刀。
 */
import type {
  CompanySnapshot,
  ExecutorCapabilities,
  IssueRecord,
  PersonRef,
} from '@studio-next/contract'
import {
  assembleAgentsMd,
  buildLayers,
  renderTaskBrief,
  type AssembleResult,
  type BriefRenderResult,
} from '@studio-next/prompt'

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
  /** AGENTS.md 落点（按 adapter 通道决定：native=workspace 根；其余通道归适配器注入） */
  agentsTarget: string
  /** AGENTS.md 通道说明（随任务书注入；channel 与 target 同 TaskBrief.AGENTS_MD） */
  agentsChannel: { channel: 'native' | 'user_level' | 'append_system_prompt'; target: string }
}

/** 装配产物：AGENTS.md 组装结果（含分层指纹/字节清单）+ 任务书渲染结果（含 TaskBrief） */
export interface AssembleDispatchOutput {
  agentsMd: AssembleResult
  brief: BriefRenderResult
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

/** 默认装配器：六源 → buildLayers → assembleAgentsMd + renderTaskBrief('first')（首版） */
export function createDefaultAssembler(ctx: AssemblerContext): PromptAssembler {
  return (input: AssembleDispatchInput): AssembleDispatchOutput => {
    const person = input.person
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
      },
      {
        kind: 'L5-tool',
        adapter: input.adapterName,
        version: input.adapterVersion,
        capabilities: input.capabilities,
      },
    ])
    const agentsMd = assembleAgentsMd(layers)
    const brief = renderTaskBrief('first', {
      ticket: input.issue.id,
      attempt: input.attempt,
      workspace: input.workspace,
      briefPath: input.briefPath,
      agentsChannel: input.agentsChannel,
      acceptance: ctx.acceptance,
      docRefs: ctx.docRefs,
      objective: input.issue.title,
    })
    return { agentsMd, brief }
  }
}
