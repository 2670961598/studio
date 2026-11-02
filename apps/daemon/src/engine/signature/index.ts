/**
 * engine/signature —— 写署名构造（SEC-FC-06 / SEC-SIG-01）
 *
 * 从 engine.ts 原样析出（行数基线棘轮「先拆再增」：studio-dev-504 需在引擎内接
 * draining 闸，engine.ts 已顶冻结基线 1998 行）。语义零漂移；engine.ts 仍再出口
 * 同名类型/函数，既有导入路径不变。
 *
 * 边界：只做「三值署名」的构造期校验，零 IO/零状态；actor 只是通道位，审计断言归
 * IMPL-07-10。`onBehalfOf` 指向可还原的工号/决定记录引用。
 */

/**
 * 署名草稿（三值：person/control/system）：`onBehalfOf`、`decisionRef` 在草稿面允许缺省
 * ——**唯一目的**是让构造期校验有缝可拒（缺省即非法），而不是缺省放行。
 */
export type EngineSignatureDraft =
  | { readonly actorKind: 'person'; readonly actorRef: string; readonly onBehalfOf?: string }
  | { readonly actorKind: 'control'; readonly actorRef: string; readonly decisionRef?: string; readonly onBehalfOf?: string }
  | { readonly actorKind: 'system'; readonly actorRef: string; readonly onBehalfOf?: string }

/** 构造期校验后的写署名（与 contract `Signature` 同形：system 的 onBehalfOf 必填） */
export type EngineSignature = EngineSignatureDraft &
  (
    | { readonly actorKind: 'person' }
    | { readonly actorKind: 'control'; readonly decisionRef: string }
    | { readonly actorKind: 'system'; readonly onBehalfOf: string }
  )

/**
 * 署名构造层校验（SEC-FC-06；docs/v2/15 §二 SEC-SIG-01）：system 缺 `onBehalfOf`（空白＝缺）、
 * control 缺 `decisionRef`、actorRef 空白、actorKind 未知 → **构造期抛错**（不降级、不补缺省）。
 * `onBehalfOf` 指向可还原的工号/决定记录引用；actorRef 只是通道位（审计断言归 IMPL-07-10）。
 */
export function constructEngineSignature(draft: EngineSignatureDraft): EngineSignature {
  const d = (draft ?? {}) as { actorKind?: unknown; actorRef?: unknown; onBehalfOf?: unknown; decisionRef?: unknown }
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const actorRef = text(d.actorRef)
  if (actorRef === '') throw new Error('SIGNATURE_INVALID：actorRef 空白——署名回不到任何主体')
  const onBehalfOf = text(d.onBehalfOf)
  const withOnBehalf = onBehalfOf === '' ? {} : { onBehalfOf }
  switch (d.actorKind) {
    case 'person':
      return { actorKind: 'person', actorRef, ...withOnBehalf }
    case 'control': {
      const decisionRef = text(d.decisionRef)
      if (decisionRef === '') throw new Error('SIGNATURE_INVALID：control 署名缺 decisionRef（SEC-SIG-01）——控制面位置须可还原决定记录')
      return { actorKind: 'control', actorRef, decisionRef, ...withOnBehalf }
    }
    case 'system': {
      if (onBehalfOf === '') throw new Error(`SIGNATURE_INVALID：system 署名必须携 onBehalfOf（SEC-FC-06/SEC-SIG-01）——actor=${actorRef} 不可充当最终署名`)
      return { actorKind: 'system', actorRef, onBehalfOf }
    }
    default:
      throw new Error(`SIGNATURE_INVALID：未知署名主体 ${String(d.actorKind)}（只收 person|control|system）`)
  }
}
