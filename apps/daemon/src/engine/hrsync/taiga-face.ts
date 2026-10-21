/**
 * taiga-face —— Taiga 执行面真实现（DEV-48，docs/52-§六.1/§六.2/§六.4）
 *
 * 规格依据（实现单引用）：
 *   - docs/52-§6.1 入场链：POST /memberships 发邀请 → **邀请令牌不落 API 响应**（console/
 *     邮件日志，§13 风险1）→ 轮询读日志抓 token（findInviteToken）→ POST /auth/register
 *     建号绑定身份（docs/32 §二④ 实测）。S0 真机验证延后（§15 边界）——协议形状单测钉死。
 *   - docs/52-§6.2 语义表：入=邀请+注册+角色；升/降=角色调整；退=成员移除（账号保留）；
 *     调/停/复=无 Taiga 动作（platformsFor 已挡，不到本面）。
 *   - docs/52-§6.4 idempotent 纪律：membership 在位=已邀请（不重发）；token 注册冲突≈
 *     已建号；不在位移除=目标态已达成——**ensure-shape 收敛**（§6.3 同款）。
 *   - studio-dev-126 T5 写通纪律：本面任何成员集变更（邀请/注册激活/移除）后立即
 *     `ctx.invalidateMembers()`——同实例缓存（by_slug 内嵌成员，N11）不过夜；否则
 *     长驻 daemon 的 issues 读面（usernameById 归属名）与写面（idByUsername 派派单）
 *     在下一拍还看旧成员集（hr-sync 建号后派单 unknown-user 假红）。
 *
 * 边界（分层宪法 docs/20-§十五）：daemon→taiga 合法边（boundary-rules 允许）——与
 * matrix 面（daemon 侧结构同形接口、装配期注入）形成对照：taiga 无需该舞步。
 */

import {
  findInviteToken,
  findMembershipByUsername,
  inviteMember,
  registerWithInviteToken,
  removeMembership,
  patchMembershipRole,
  buildContext,
} from '@studio-next/taiga'
import type { FetchLike } from '@studio-next/taiga'
import type { TaigaHrFace } from './hrsync.ts'

/**
 * Taiga 上下文的最小结构面（TaigaContext 未从包出口——buildContext 返回形）：
 * daemon 侧只消费 memberships 端点族，故用 buildContext 的返回形状收窄重声明
 * （`ReturnType` 取形，零重复声明；与 matrix 结构同形注入同一装配纪律）。
 */
export type TaigaHrContext = ReturnType<typeof buildContext>

/** 邀请令牌抓取面（装配注入：docker logs 文件 tail / 邮件日志读取——§6.1 tokenSource） */
export interface InviteLogSource {
  /** 读当前日志文本（调用方保证窗口——轮询窗口内最新 token 即目标令牌） */
  read(): Promise<string>
  /** 轮询次数上限（找不到令牌=任务失败回队，§9.2 重试语义） */
  polls: number
  /** 轮询间隔毫秒 */
  intervalMs: number
}

export interface TaigaHrFaceOptions {
  context: TaigaHrContext
  /** auth/register 公开端点直连（不吃 context 的 JWT 面） */
  baseUrl: string
  inviteLog: InviteLogSource
  /** 注册端点 fetch 注入（测试回放；缺省全局 fetch——与 context 的 fetch 各自独立） */
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
}

/** 日志轮询抓令牌（polls×intervalMs 窗口内找不到 → EXTERNAL_REJECT 如实失败） */
async function pollInviteToken(opts: TaigaHrFaceOptions): Promise<string> {
  for (let i = 0; i < Math.max(1, opts.inviteLog.polls); i++) {
    if (i > 0) await (opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(opts.inviteLog.intervalMs)
    const token = findInviteToken(await opts.inviteLog.read())
    if (token !== null) return token
  }
  throw new Error(`邀请令牌在 ${String(opts.inviteLog.polls)}×${String(opts.inviteLog.intervalMs)}ms 窗口内未见于日志（§13 风险1——tokenSource 配置/时延如实失败，任务回队重试）`)
}

export function createTaigaHrFace(opts: TaigaHrFaceOptions): TaigaHrFace {
  return {
    async ensureMember({ username, roleSlug, displayName }) {
      const existing = await findMembershipByUsername(opts.context, username)
      if (existing !== undefined && existing.isActive) {
        return { membershipId: existing.id, created: false } // 已在位（且已激活）=目标态
      }
      if (existing === undefined) {
        await inviteMember(opts.context, { username, roleSlug })
        opts.context.invalidateMembers() // T5 写通：邀请行入列——成员集已变
      }
      // 在位未激活（邀请已发、注册未完成）或新发邀请：抓令牌走注册闭环
      const token = await pollInviteToken(opts)
      try {
        await registerWithInviteToken({
          baseUrl: opts.baseUrl,
          token,
          username,
          password: `sn-${token.slice(0, 12)}`, // 口令派生自一次性令牌：确定性（重试同口令）且不额外持密
          ...(displayName !== undefined ? { fullName: displayName } : {}),
          ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
        })
        opts.context.invalidateMembers() // T5 写通：注册激活成员位（公开端点不走 ctx，但成员集真变了）
        return { membershipId: existing?.id ?? 0, created: true }
      } catch (err) {
        // 注册冲突≈账号已建（此前批次已注册、membership 尚未激活回显）——ensure-shape 收敛
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('register-rejected') || msg.includes('400')) {
          const after = await findMembershipByUsername(opts.context, username)
          return { membershipId: after?.id ?? existing?.id ?? 0, created: false }
        }
        throw err
      }
    },

    async ensureRole({ username, roleSlug }) {
      const m = await findMembershipByUsername(opts.context, username)
      if (m === undefined) throw new Error(`Taiga 成员 ${username} 不在位（升/降前提=成员存在——时序漂移如实失败）`)
      if (m.roleSlug === roleSlug) return // 同角色=目标态（幂等收敛，省一次 PATCH）
      await patchMembershipRole(opts.context, m.id, roleSlug)
    },

    async removeMember({ username }) {
      const m = await findMembershipByUsername(opts.context, username)
      if (m === undefined) return // 已移除=目标态
      await removeMembership(opts.context, m.id)
      opts.context.invalidateMembers() // T5 写通：移除后成员集真变（停位不再占席）
    },
  }
}
