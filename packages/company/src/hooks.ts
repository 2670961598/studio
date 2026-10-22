/**
 * hooks —— org-config 事件钩子声明段（129-§6.1① / §6.3 P0-A，studio-dev-178 单C）。
 *
 * 自 validator.ts 拆出（20-§十五.三.3 尺寸门「先拆再增」，groups.ts/state-hygiene.ts
 * 同款先例）：结构闸（OrgHooksSchema）/内容引用闸（hooksCrossRules）/快照装载
 * （toHooks）三位一体，validator 经同源 import 消费。
 *
 * 值域纪律（129-A 同款）：routes 的**类型键**值域（人事事件七值 入/调/升/降/停/复/退）
 * 归引擎路由闸 fail-closed——company 不依赖 core、不复制 HR_EVENT_KINDS（单一冻结源
 * 不双写）；这里只做形状闸（键值均非空串）与**目标工号在册**悬空检（leader/members
 * 悬空双检同族——错派比拒收危害大，装载面先挡悬空目标）。
 */
import type { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { DirectoryIssue, OrgHooksDecl } from '@studio-next/contract'
import type { OrgConfig } from './validator.ts'
import { lineOfPath } from './multifile.ts'

/** org-config 文件名（DirectoryIssue 指认面——与 validator.ts 同一事实） */
const ORG_CONFIG_FILE = 'org-config.yaml'

/**
 * 数据变更路由表形状（org-config `hooks.data_change.routes`）：`变更类型: 工号` 映射
 * （YAML 自然嵌套形——与 daemon.yaml 扁平 `入=HR-1` 分号对分野：org-config 是规范位）。
 * 类型键值域不在此收（引擎路由闸「未命中明报拒收」——129-A）；空表无意义=zod 拒
 * （声明 hooks 而不配路由=意图面结构性哑火，装载面明报）。
 */
const DataChangeRoutesSchema = z.record(z.string().min(1), z.string().min(1)).refine((r) => Object.keys(r).length > 0, {
  message: 'hooks.data_change.routes 须至少一条 `变更类型: 工号`（空路由表=声明即哑火；不配 hooks 段=不启用）',
})

/**
 * 成本警戒缺省路由形状（org-config `hooks.cost_threshold`，129-§6.3 P0-B——
 * studio-dev-181 单 129-D）：target=缺省指派工号（route 档位动作归 cost_guard——
 * 132 段，此处不管）；lane=处置单泳道落位。两键均可选（target 缺=引擎明报拒收
 * fail-closed——缺省路由表没配等于警戒面哑火，装载面放行让引擎侧报错指认投放）。
 */
const CostThresholdHooksSchema = z.strictObject({
  target: z.string().min(1).optional(),
  lane: z.string().min(1).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: 'hooks.cost_threshold 须至少一键 target/lane（空段=声明即哑火；不配 hooks 段=不启用）',
})

/** org-config `hooks:` 段结构闸（v0 开 data_change=129-C／cost_threshold=129-D；后续 hook 面走提案流扩段） */
export const OrgHooksSchema = z.strictObject({
  data_change: z.strictObject({ routes: DataChangeRoutesSchema }).optional(),
  cost_threshold: CostThresholdHooksSchema.optional(),
})

/**
 * 钩子声明引用完整性（129-C）：data_change.routes 目标工号须在 people 索引——
 * 悬空即装载失败（引擎侧路由闸还有第二道「目标不在人事索引」拒收，此为第一道
 * 指认到行的早失败面）。cost_threshold.target 同族悬空检（129-D——错派比拒收危害大）。
 */
export function hooksCrossRules(
  doc: ReturnType<typeof parseDocument>,
  lc: LineCounter,
  org: OrgConfig,
  peopleIds: Set<string>,
): DirectoryIssue[] {
  const out: DirectoryIssue[] = []
  const routes = org.hooks?.data_change?.routes
  if (routes !== undefined) {
    for (const [kind, person] of Object.entries(routes)) {
      if (!peopleIds.has(person)) {
        out.push({
          file: ORG_CONFIG_FILE,
          line: lineOfPath(doc, lc, ['hooks', 'data_change', 'routes', kind]),
          rule: 'org-config/dangling-ref',
          fix: `hooks.data_change.routes 的 ${kind}→${person} 目标工号不在 people 索引中（悬空引用双检——联动单指派宁拒不错派）`,
        })
      }
    }
  }
  const costTarget = org.hooks?.cost_threshold?.target
  if (costTarget !== undefined && !peopleIds.has(costTarget)) {
    out.push({
      file: ORG_CONFIG_FILE,
      line: lineOfPath(doc, lc, ['hooks', 'cost_threshold', 'target']),
      rule: 'org-config/dangling-ref',
      fix: `hooks.cost_threshold.target 的 ${costTarget} 目标工号不在 people 索引中（悬空引用双检——警戒处置单指派宁拒不错派）`,
    })
  }
  return out
}

/**
 * 钩子声明装载：org-config hooks 段 → snapshot.hooks（Record 键序=YAML 声明序——
 * 只读映射不重排；可选键不落显式 undefined，groups/workflows 同款扩法）。
 */
export function toHooks(hooks: NonNullable<OrgConfig['hooks']>): OrgHooksDecl {
  return {
    ...(hooks.data_change !== undefined ? { data_change: { routes: { ...hooks.data_change.routes } } } : {}),
    ...(hooks.cost_threshold !== undefined
      ? {
          cost_threshold: {
            ...(hooks.cost_threshold.target !== undefined ? { target: hooks.cost_threshold.target } : {}),
            ...(hooks.cost_threshold.lane !== undefined ? { lane: hooks.cost_threshold.lane } : {}),
          },
        }
      : {}),
  }
}
