/**
 * serve/notify-face —— notify 广播面 serve 装配腿（105-刀B，studio-dev-219）
 *
 * 自 runtime.ts 先拆再增（20-§十五.三；本件随 kimi-on-dsh 施工顺带拆出——runtime 600 行阈
 * 零余量，加注入面前必须腾位）：**原段零漂移迁出**——只搬移、不改装配序与行为。
 * 面注入=开（boot 注入 notifyBroadcast 时装配三件套：拍边界事件中继+cost 警戒 IM 出口+
 * 惊动计量 PATROL），缺省=零装配零行为（v0 出口保留——面板第一落点语义不变）。
 * 装配体三件套在 assembly/notify/notify.ts（头注即设计依据）。
 */
import type { Ledger } from '@studio-next/store'
import type { NotifyBroadcastFace } from '../../../engine/notify/broadcast.ts'
import type { EngineConfig } from '../../../engine/engine.ts'
import type { OutboundWiring } from '../../outbound-gate/wire.ts'
import { wireNotifyAssembly, type WiredNotify } from '../../notify/notify.ts'

/** 装配入参（runtime 装配缝裁出——与原 runtime.ts 内联段同参面） */
export interface WireServeNotifyArgs {
  /** 广播面（boot 注入 createMatrixBroadcastFace 产物；缺省=不装配零行为） */
  face: NotifyBroadcastFace | undefined
  /** 出站闸（通知出口 wrapper：Notification 过闸后中继） */
  outbound: OutboundWiring
  company: string
  /** 公司目录根（report 落位脱敏锚） */
  companyDir: string | undefined
  engineConfig: EngineConfig
  ledger: Ledger
  clock: () => number
  /** cost 警戒 target→部门解析（people 索引——装配时快照，同原段） */
  people: readonly { id: string; dept: string }[]
  log: (line: string) => void
}

/** 装配产物：包装面（conversation 装配复用）＋三件套（未注入 face=双 undefined 零行为）。 */
export interface WiredServeNotify {
  /** 出站闸包装后的广播面（wireServeConversation 的 notify 入参；未注入=undefined） */
  face: NotifyBroadcastFace | undefined
  /** 三件套装配产物（relayEvents/costNoticeOutlet；未注入=undefined） */
  wired: WiredNotify | undefined
}

/** 装配腿：face 缺省=零装配零行为；有面=wrap 过闸→三件套装配→启动留痕一行。 */
export function wireServeNotify(args: WireServeNotifyArgs): WiredServeNotify {
  if (args.face === undefined) return { face: undefined, wired: undefined }
  const face = args.outbound.wrapNotifyFace(args.face)
  const wired = wireNotifyAssembly({
    face,
    company: args.company,
    companyDir: args.companyDir,
    heartbeatIssue: args.engineConfig.heartbeatIssue,
    actor: args.engineConfig.actor,
    deptFallback: args.engineConfig.deptFallback,
    ledger: args.ledger,
    clock: args.clock,
    people: args.people,
    log: args.log,
  })
  args.log('[serve] notify 广播面已装配：事件中继（拍边界）+cost 警戒即时出口+惊动计量（105-刀B，studio-dev-219）——matrix 挂=IM 副本缺失，面板仍第一落点')
  return { face, wired }
}
