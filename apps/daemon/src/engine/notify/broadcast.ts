/**
 * notify 广播端口（daemon 侧结构同形接口）—— 105-刀B-1/-2（studio-dev-219）
 *
 * daemon 只认本接口，Matrix 实现在 packages/matrix（createMatrixBroadcastFace）、
 * 由 apps/boot 组合根装配注入（runServe/buildServeRuntime opts.notifyBroadcast）——
 * daemon 本体零 @studio-next/matrix import（docs/25-§一.2 依赖方向冻结，MatrixRoomFace
 * 同款纪律）。targets 是**逻辑频道角色**：daemon 不知道 alias/slug/deptMap，只声明
 * 「这条通知去告警频道/制作人总览/某部门频道」——角色→房间的解析归装配面。
 *
 * 失败面契约（刀B-6）：send 永不抛出——逐频道软失败入 report.failed（面板（:8789，
 * 读 events 台账）始终是 critical 第一落点，docs/19-§六冻结序不变；matrix 挂只意味着
 * IM 副本缺失+日志留痕，不升级成主循环错误）。
 */
import type { Notification } from '@studio-next/contract'

/** 逻辑频道角色（与 matrix 包 BroadcastTargets 结构同形——鸭子类型，零 import 面） */
export interface NotifyBroadcastTargets {
  /** `#<slug>-alert` 告警频道（全员） */
  alert?: boolean
  /** `#<slug>-overview` 制作人总览（低噪只读——只投摘要件） */
  overview?: boolean
  /** 部门频道（值=部门 path，如 `departments/研发部`） */
  dept?: string
}

/** 单频道软失败（观测面：relay 落日志+计量） */
export interface NotifySendFailure {
  target: string
  reason: string
}

/** 广播报告（sent=成功角色名，形如 'alert'/'overview'/'dept:<path>'） */
export interface NotifySendReport {
  sent: readonly string[]
  failed: readonly NotifySendFailure[]
}

/** notify 广播面（boot 注入 createMatrixBroadcastFace 产物；未注入=面关零行为） */
export interface NotifyBroadcastFace {
  send(message: Notification, targets: NotifyBroadcastTargets): Promise<NotifySendReport>
}
