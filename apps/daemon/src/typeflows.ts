/**
 * workflows 声明 → 引擎流表（DEV-43，docs/18-§2.1.1；契约面=contract TicketWorkflows）。
 *
 * 职责单一：把 org-config `workflows.types[]` 翻译成 core FlowTable 的 `T:<type>` 键。
 * W-1..W-9 已在公司判定器过闸（调用序=loadCompanyDirectory 先于本函数）——此处只翻译
 * 不校验；未声明/空 types 返回 undefined（serve 据此不注入 flows——引擎走
 * DEFAULT_FLOW_TABLE，现状行为字节不变，D9）。
 *
 * 合并序（D13 冻结）：注入表构造序=DEFAULT_FLOW_TABLE（L 键基底）→（后续刀：org-config
 * `yt.flows` 覆盖 L 键——今日不接，接了也只动 L 键区）→ T 键永远最上。与查表优先级
 * （resolveTicketFlow：T 优先、L 回退）正交——两序各自冻结互不牵连。
 */
import type { TicketWorkflows, WorkflowTypeDecl } from '@studio-next/contract'
import { typeFlowKey, type FlowTable, type StateFlow } from '@studio-next/core'

/** 单类型声明 → StateFlow（裸翻译；锚点 inbox→fresh、evidence→evidenceReady 端口语义对位） */
function typeToFlow(t: WorkflowTypeDecl): StateFlow {
  const finals = t.states.filter((s) => s.final === true).map((s) => s.name)
  return {
    mainline: t.states.map((s) => s.name),
    ...(finals.length > 0 ? { finalStates: finals } : {}),
    ...(t.edges !== undefined ? { typeEdges: t.edges } : {}),
    anchors: {
      fresh: t.anchors.inbox,
      dispatched: t.anchors.dispatched,
      evidenceReady: t.anchors.evidence,
      verified: t.anchors.verified,
      delivered: t.anchors.delivered,
      // 无审批环哨兵（NO_APPROVAL_ANCHOR=''）：decide 5a/5b 构造性不命中（successors
      // 只含非空声明名，空串永不入列、永不相等）——「无待批位」零状态机改动即安全
      approval: t.anchors.approval ?? '',
    },
  }
}

/**
 * workflows → T 键流表（只有 T 键；调用方与基底表合并）。空声明 → undefined（D9：
 * 不注入，字节不变）。保留词 bug/task 在判定器已拦（W-9）——此处不重复闸，翻译面单层。
 */
export function flowsFromWorkflows(workflows: TicketWorkflows | undefined): FlowTable | undefined {
  if (workflows === undefined || workflows.types.length === 0) return undefined
  const table: FlowTable = {}
  for (const t of workflows.types) {
    const key = typeFlowKey(t.id)
    if (key === '') continue // 防御：空 id 判定器已拦（W-1），此处不产键不炸
    table[key] = typeToFlow(t)
  }
  return Object.keys(table).length > 0 ? table : undefined
}
