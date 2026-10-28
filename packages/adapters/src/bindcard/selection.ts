/**
 * bindcard/selection —— 执行器选择链登记＋派发解析（NEG-RUN-05 代偿校验；IMPL-07-05）
 *
 * 依据：
 *   - v2/07 §一「执行器选择链」：单据指定＞岗位绑定＞默认（默认＝DSH）；**选择不是授权**
 *     （选择只回答「这单由哪家跑」，权与禁配另判 v2/03/04）；异源独立性由单据指定支持。
 *   - v2/17 NEG-RUN-05（07 §一）：**无登记选择链直连非主绑定执行器**——放行路径必须不存在；
 *     GAP-V2-04（派生树登记网关＋执行器选择链未建）建成前**以代偿校验拒**。
 *   - v2/12 §一 BIND-DSH-01（DSH＝主绑定/默认）；§2.1 备选 CLI 契约四条（换宿主＝新段）。
 *   - v2/09 ENU-88 执行器值集（contract `records/asset.ts` 投影消费，不复制字面量）。
 *   - plan/05 IMPL-07-05（NEG-RUN-05）；plan/02 §五-8 接口耦合（本件不改 daemon）。
 *
 * 能力边界（不冒充机制保证）：
 *   - 真正的**派生树登记网关**未建（GAP-V2-04）：本件是**代偿校验**——只拦「经本解析器」的
 *     派发路径；绕过本解析器直调适配器的路径本件看不到（无路径可拦，如实登记，不称机制保证）。
 *   - 登记是证据面不是授权面：解析产物 `authorization:'not-granted-here'` 恒非「已授权」，
 *     不提供任何 granted 布尔位（选择≠授权，v2/07 §一）。
 *   - 主绑定（DSH）走缺省链，不需要登记（默认就是选择结果）；**非主绑定执行器**必须有登记链。
 */
import type { ClassifiedError, ExecutorFamily, Result } from '@studio-next/contract'
import type { Executor } from '../../../contract/src/records/asset.ts'
import { EXECUTOR_VALUES, ExecutorSchema } from '../../../contract/src/records/asset.ts'
import { configErr, deepFreeze, okResult } from './types.ts'

/** 主绑定执行器（v2/07 §一 默认＝DSH；v2/12 主绑定 BIND-DSH-01） */
export const PRIMARY_BINDING_EXECUTOR: ExecutorFamily = 'dsh'

/** 选择来源（v2/07 §一：单据指定＞岗位绑定＞默认；'default' 由主绑定缺省链承担，不登记） */
export const SELECTION_SOURCES = ['ticket', 'position'] as const
export type SelectionSource = (typeof SELECTION_SOURCES)[number]

/** 选择链登记条目（证据面；不是授权） */
export interface SelectionChainEntry {
  /** 单据号（单据指定＝最高优先；空单号不可登记——选择链必须落在具体单上） */
  readonly ticket: string
  /** 被选执行器（非主绑定才需要登记；登记主绑定也合法但无额外效力） */
  readonly executor: Executor
  readonly source: SelectionSource
  /** 岗位绑定引用（source='position' 时必填；具名岗位/任职引用） */
  readonly positionRef?: string
  /** 登记人（具名位置/决定记录；不得匿名） */
  readonly registeredBy: string
  /** 登记依据（不得空） */
  readonly reason: string
}

/** 选择链账本（不可变；登记返回新账本） */
export interface SelectionChain {
  readonly entries: readonly SelectionChainEntry[]
}

/** 空链账本 */
export const EMPTY_SELECTION_CHAIN: SelectionChain = Object.freeze({
  entries: Object.freeze([]) as readonly SelectionChainEntry[],
})

/** 解析结果（选择结果＋「授权不在此」标记） */
export interface DispatchSelection {
  readonly executor: ExecutorFamily
  readonly chainId: string
  readonly source: 'ticket' | 'position' | 'default'
  /** 选择不是授权：恒 'not-granted-here'（授权只有 v2/03 四态） */
  readonly authorization: 'not-granted-here'
  readonly note: string
}

/** 派发请求（只含选择所需信息；权与禁配不在此面） */
export interface DispatchRequest {
  readonly ticket: string
  readonly executor: string
}

function isExecutor(value: string): value is Executor {
  return (EXECUTOR_VALUES as readonly string[]).includes(value)
}

/**
 * 登记选择链（单据指定/岗位绑定）：
 *   - 单号非空、执行器为 ENU-88 值、来源合法、登记人具名、依据非空——缺一项拒收；
 *   - source='position' 必填 positionRef（岗位绑定须可解析到岗位/任职引用）；
 *   - 同（单号,执行器）重复登记：内容相同＝幂等返回原账本；内容不同＝拒收（选择链不得自相矛盾）。
 */
export function registerSelection(
  chain: SelectionChain,
  entry: SelectionChainEntry,
): Result<SelectionChain, ClassifiedError> {
  if (entry.ticket.trim() === '') {
    return configErr('dispatch/selection-invalid', '选择链登记缺单号：选择必须落在具体单上（无登记链的直连＝NEG-RUN-05）')
  }
  if (!isExecutor(entry.executor)) {
    return configErr(
      'dispatch/executor-unknown',
      `未知执行器 ${JSON.stringify(entry.executor)}（值集 ENU-88：${EXECUTOR_VALUES.join('|')}）`,
    )
  }
  if (!(SELECTION_SOURCES as readonly string[]).includes(entry.source)) {
    return configErr('dispatch/selection-invalid', `未知选择来源 ${JSON.stringify(entry.source)}（只收 ticket|position；default 属主绑定缺省链）`)
  }
  if (entry.registeredBy.trim() === '' || entry.reason.trim() === '') {
    return configErr('dispatch/selection-invalid', '选择链登记须具名登记人＋依据（无主登记＝不可审计）')
  }
  if (entry.source === 'position' && (entry.positionRef === undefined || entry.positionRef.trim() === '')) {
    return configErr('dispatch/selection-invalid', 'source=position 须给 positionRef（岗位绑定必须可解析到岗位/任职引用）')
  }
  const existing = chain.entries.find((e) => e.ticket === entry.ticket && e.executor === entry.executor)
  if (existing !== undefined) {
    const same =
      existing.source === entry.source &&
      existing.positionRef === entry.positionRef &&
      existing.registeredBy === entry.registeredBy &&
      existing.reason === entry.reason
    if (same) return okResult(chain)
    return configErr(
      'dispatch/selection-conflict',
      `同单同执行器已有不同登记（${entry.ticket} → ${entry.executor}）：选择链不得自相矛盾，改判须新决定`,
    )
  }
  const next = Object.freeze({
    entries: Object.freeze([...chain.entries, deepFreeze({ ...entry })]),
  })
  return okResult(next)
}

/**
 * 派发解析（NEG-RUN-05 代偿校验的唯一放行点）：
 *   1. 执行器不在 ENU-88 → dispatch/executor-unknown；
 *   2. 主绑定（DSH）→ 缺省链放行（source='default'，chainId='default:primary'）；
 *   3. **非主绑定执行器**必须在该单有登记链：
 *      - 无任何该单登记 → dispatch/selection-unregistered（未登记选择链直连被拒——NEG-RUN-05）；
 *      - 该单登记指向别家 → dispatch/selection-mismatch（登记链说的不是它）；
 *      - 命中 → 放行，chainId 记来源（ticket/position），authorization 恒 'not-granted-here'。
 * 纯函数：不读盘、不调适配器、不启动任何进程（本件不派工，只判选择链）。
 */
export function resolveDispatchTarget(
  chain: SelectionChain,
  request: DispatchRequest,
): Result<DispatchSelection, ClassifiedError> {
  const parsed = ExecutorSchema.safeParse(request.executor)
  if (!parsed.success) {
    return configErr(
      'dispatch/executor-unknown',
      `未知执行器 ${JSON.stringify(request.executor)}（值集 ENU-88：${EXECUTOR_VALUES.join('|')}）——不得以拼写/别名为未登记执行器开路`,
    )
  }
  const executor = parsed.data
  if (executor === PRIMARY_BINDING_EXECUTOR) {
    return okResult(
      deepFreeze({
        executor,
        chainId: 'default:primary',
        source: 'default' as const,
        authorization: 'not-granted-here' as const,
        note: '主绑定缺省链（v2/07 §一 默认＝DSH）：选择结果不是授权，权与禁配另判 v2/03/04',
      }),
    )
  }
  const forTicket = chain.entries.filter((e) => e.ticket === request.ticket)
  if (forTicket.length === 0) {
    return configErr(
      'dispatch/selection-unregistered',
      `单据 ${JSON.stringify(request.ticket)} 无选择链却要求直连非主绑定执行器 ${executor}——未登记选择链直连被拒（NEG-RUN-05；派生树登记网关 GAP-V2-04 未建前以本代偿校验拒）`,
    )
  }
  const hit = forTicket.find((e) => e.executor === executor)
  if (hit === undefined) {
    const registered = forTicket.map((e) => e.executor).join('|')
    return configErr(
      'dispatch/selection-mismatch',
      `单据 ${JSON.stringify(request.ticket)} 的选择链登记为 ${registered}，请求 ${executor}——登记链说的不是它（不得绕登记改派）`,
    )
  }
  return okResult(
    deepFreeze({
      executor,
      chainId: `${hit.source}:${hit.ticket}`,
      source: hit.source,
      authorization: 'not-granted-here' as const,
      note: '登记链只证明选择来源（单据指定/岗位绑定），不构成授权；异源独立性由此支持但不由此保证',
    }),
  )
}
