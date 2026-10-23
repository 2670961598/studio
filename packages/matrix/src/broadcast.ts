/**
 * broadcast —— notify 广播面（105-刀B-1/-2/-6，studio-dev-219）
 *
 * daemon 侧结构同形接口（apps/daemon/src/engine/notify/broadcast.ts 的
 * NotifyBroadcastFace）的 Matrix 实现：**逻辑频道角色**（alert/overview/dept）→
 * 房间 alias（`#<slug>-alert` 等，130-P3 八类地图命名）→ resolveAlias → room_id →
 * notifier 发送。落位 apps/boot 组合根装配（daemon 本体零 matrix import，docs/25-§一.2）。
 *
 * 语义（105 提案 §5.4 刀B-2 级别→频道路由 + 219 任务书冻结口径）：
 *   - alert    → `#<slug>-alert`（告警，全员）
 *   - overview → `#<slug>-overview`（制作人总览，低噪只读——发送侧保证只投摘要件）
 *   - dept     → `#<slug>-<deptSlug>`（部门频道；部门 path 无 deptSlugs 映射=软失败，
 *                不阻其余频道——与 provision 部门房供给 problems 同语义）
 *
 * 失败面契约（刀B-6 回退）：**逐频道隔离**——任一频道解析/发送失败只记入 report.failed，
 *   不抛出、不阻其余频道；面板（:8789，读 events 台账）始终是 critical 第一落点，
 *   matrix 挂只意味着 IM 副本缺失（docs/19-§六冻结序不变）。alias 解析缓存进程内存，
 *   发送失败时失效重解析一次（频道重建/别名重指的自愈面）。
 *
 * channel=room_id 对外语义冻结（docs/25-§3.4 裁决 4）：本面在 notifier 之前做
 * alias→room_id 解析，属于实现自由（「alias 解析归实现自由」），不动 Notifier 端口。
 */
import type { Notification } from '@studio-next/contract'
import { MatrixClient } from './client.ts'
import { formatNotification } from './format.ts'
import { serverNameOf } from './provision.ts'

/** 逻辑频道角色（daemon 侧路由表的输出面——daemon 不知道 alias/slug，只说角色） */
export interface BroadcastTargets {
  /** `#<slug>-alert` 告警频道（全员） */
  alert?: boolean
  /** `#<slug>-overview` 制作人总览（低噪只读——只投摘要件） */
  overview?: boolean
  /** 部门频道（值=部门 path，如 `departments/研发部`；映射缺失=软失败） */
  dept?: string
}

/** 单频道失败（观测面：逐条落日志/PATROL 计量；不抛出） */
export interface BroadcastFailure {
  target: string
  reason: string
}

/** 广播报告：sent=成功频道角色名列表（alert/overview/dept:<path>）；failed=逐频道失败 */
export interface BroadcastReport {
  sent: readonly string[]
  failed: readonly BroadcastFailure[]
}

export interface BroadcastFaceOptions {
  client: MatrixClient
  /** 公司 slug（频道别名前缀，daemon.yaml company——130-P3 命名面） */
  slug: string
  /** 部门 path → ASCII slug（daemon.yaml matrixDeptMap JSON 装载产物，boot 侧持有） */
  deptSlugs: Readonly<Record<string, string>>
  /** bot MXID（登录返回的规范形——alias 服务器段从中推导，serverNameOf 同源） */
  botMxid: string
  log?: (line: string) => void
}

/**
 * 频道角色 → alias 全形（`#<slug>-<deptSlug>`——130-P3 §6.7.1 命名；纯函数导出，
 * 测试/装配面同引用）。部门映射缺失返回 undefined（软失败面）。
 */
export function targetAlias(target: string, opts: { slug: string; deptSlugs: Readonly<Record<string, string>>; serverName: string }): string | undefined {
  if (target === 'alert') return `#${opts.slug}-alert:${opts.serverName}`
  if (target === 'overview') return `#${opts.slug}-overview:${opts.serverName}`
  const dept = target.startsWith('dept:') ? target.slice('dept:'.length) : target
  const deptSlug = opts.deptSlugs[dept]
  return deptSlug === undefined ? undefined : `#${opts.slug}-${deptSlug}:${opts.serverName}`
}

/**
 * Matrix 广播面工厂：send(message, targets) → 逐角色解析 alias → sendMessage。
 * never throws（逐频道失败入 report.failed——刀B-6 回退语义；把异常抛回 daemon 只会把
 * 沟通面故障升级成主循环噪音）。
 */
export function createMatrixBroadcastFace(opts: BroadcastFaceOptions): {
  send(message: Notification, targets: BroadcastTargets): Promise<BroadcastReport>
} {
  const log = opts.log ?? ((): void => {})
  const serverName = serverNameOf(opts.botMxid)
  const aliasCache = new Map<string, string>()

  const resolve = async (alias: string): Promise<string> => {
    const cached = aliasCache.get(alias)
    if (cached !== undefined) return cached
    const roomId = await opts.client.resolveAlias(alias)
    aliasCache.set(alias, roomId)
    return roomId
  }

  const sendToOne = async (target: string, message: Notification): Promise<{ ok: true; target: string } | { ok: false; target: string; reason: string }> => {
    const alias = targetAlias(target, { slug: opts.slug, deptSlugs: opts.deptSlugs, serverName })
    if (alias === undefined) {
      return { ok: false, target, reason: `部门 ${target} 无 deptSlugs 映射（daemon.yaml matrixDeptMap）——部门频道跳过` }
    }
    let roomId: string
    try {
      roomId = await resolve(alias)
    } catch (err) {
      return { ok: false, target, reason: `alias 解析失败（${alias}）：${err instanceof Error ? err.message : String(err)}` }
    }
    try {
      await opts.client.sendMessage(roomId, formatNotification(message))
      return { ok: true, target }
    } catch (err) {
      // 缓存失效重解析一次（频道重建/别名重指自愈面），再败=软失败入报告
      aliasCache.delete(alias)
      try {
        const retried = await resolve(alias)
        await opts.client.sendMessage(retried, formatNotification(message))
        return { ok: true, target }
      } catch (err2) {
        return { ok: false, target, reason: `发送失败（${alias}→${roomId}）：${err2 instanceof Error ? err2.message : String(err2)}` }
      }
    }
  }

  return {
    async send(message: Notification, targets: BroadcastTargets): Promise<BroadcastReport> {
      const roles: string[] = []
      if (targets.alert === true) roles.push('alert')
      if (targets.overview === true) roles.push('overview')
      if (targets.dept !== undefined && targets.dept !== '') roles.push(`dept:${targets.dept}`)
      const sent: string[] = []
      const failed: BroadcastFailure[] = []
      for (const role of roles) {
        const r = await sendToOne(role, message)
        if (r.ok) sent.push(role)
        else {
          failed.push({ target: role, reason: r.reason })
          log(`[matrix-broadcast] ${role} 软失败（不阻其余频道；面板仍是第一落点——刀B-6）：${r.reason}`)
        }
      }
      return { sent, failed }
    },
  }
}
