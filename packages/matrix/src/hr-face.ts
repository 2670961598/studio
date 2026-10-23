/**
 * hr-face —— 人事同步器的 Matrix 执行面（DEV-48，docs/52-§7.1-§7.4）
 *
 * 规格依据（实现单引用）：
 *   - docs/52-§7.1 建号：Synapse shared-secret 注册（21A-§2.3：GET nonce → HMAC-SHA1 →
 *     POST）+ displayname 设置；密码随机生成归 daemon 装配侧（D6：密码 daemon_kv 持有，
 *     本面只收口令入参）。
 *   - docs/52-§7.2 房间权限：入=公司房+部门房邀请入房 + power_level（等级映射，v0 单层
 *     缺省）；调=部门房重挂（旧房不退——历史可回看，§7.2 表注）；停=禁言（power_level
 *     降 -1）；复=恢复；退=kick（D4：kick 非 ban——可复邀）。
 *   - docs/52-§7.4 幂等纪律（对齐 §6.3）：**client 薄网络层、ensure-shape 业务幂等归本面**
 *     ——注册冲突≈已建号、M_FORBIDDEN 邀请≈已在房、power_level 同值不写：任何任务
 *     重放/跨批次重跑都收敛到同一目标态，多执行不坏。
 *   - docs/52-§13 风险5：Synapse 本机未部署——协议形状按 21A 实现与单测（fake fetch）钉死，
 *     真机联调归部署切片（v0 边界，§15）。
 *
 * 对 daemon 的暴露形状：daemon 侧定义结构同形接口（apps/daemon engine/hrsync faces.ts）
 * ——**daemon 不 import 本包**（分层宪法 daemon→matrix 非法边）；装配期（serve.ts）注入
 * 本面实例（matrixSource 同款工厂注入先例）。本面接口字段=两仓的结构契约。
 */

import type { MatrixClient } from './client.ts'

/** daemon 侧同形接口（结构类型——字段名/方法签名两侧一致即兼容） */
export interface MatrixHrTarget {
  /** 建号（或已建号收敛）+ displayname；返回 userId 与是否本调用真建（观测面） */
  ensureAccount(args: { username: string; displayName: string; password: string }): Promise<{ userId: string; created: boolean }>
  /** 邀请入房 + 确保说话权（power_level=默认成员档；重复调用收敛 no-op） */
  ensureMembership(args: { userId: string; roomAlias: string }): Promise<void>
  /** 调整 power_level（升/降/停/复的目标态写面；同值不写） */
  ensurePowerLevel(args: { userId: string; roomAlias: string; level: number }): Promise<void>
  /** 踢出房间（退场；kick 非 ban——D4） */
  kickFromRoom(args: { userId: string; roomAlias: string; reason?: string }): Promise<void>
}

/** 错误文本是否「用户已存在/冲突」形（ensure-shape 收敛判据；Synapse 报 M_USER_IN_USE） */
function isUserExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('M_USER_IN_USE') || msg.includes('User ID already taken')
}

/** 错误文本是否「已在房/已被邀请」形（invite 的 M_FORBIDDEN≈目标态已达成） */
function isAlreadyInRoomError(err: unknown): boolean {
  return isForbiddenError(err)
}

/** 错误文本是否 M_FORBIDDEN 形（真机另一定式：bot 代改他人 profile 403——能力边界） */
function isForbiddenError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('M_FORBIDDEN')
}

/** 别名规范化：裸名（#dept-eng 形缺服务器后缀时）不补——装配侧配置须写全限定别名（#name:server） */
function fullAlias(alias: string): string {
  return alias.startsWith('#') ? alias : `#${alias}`
}

/** 用户 localpart → 全限定 userId（@user:server 形；server 后缀从操作 bot 的 userId 截取） */
function userIdOf(username: string, serverUserId: string): string {
  if (username.startsWith('@')) return username
  const server = serverUserId.includes(':') ? serverUserId.slice(serverUserId.indexOf(':') + 1) : 'localhost'
  return `@${username}:${server}`
}

export interface MatrixHrFaceOptions {
  client: MatrixClient
  /** registration_shared_secret（21A-§2.1 配置键；密钥永不入库/日志——§十二） */
  sharedSecret: string
  /** 缺省 power_level（成员档=0；v0 单层缺省——§7.2 表注） */
  memberPowerLevel?: number
}

/**
 * Matrix 人事执行面装配。client 须已完成 login（bot/gateway 账号——21A-§2.2 网关 bot
 * 一个管理账号代发；server 后缀从 client.userId 截取，userId 推导不另配置）。
 */
export function createMatrixHrFace(opts: MatrixHrFaceOptions): MatrixHrTarget {
  const memberLevel = opts.memberPowerLevel ?? 0
  return {
    async ensureAccount({ username, displayName, password }) {
      let userId: string
      let created = false
      try {
        // 先试注册（新号主路径）；冲突（M_USER_IN_USE）≈已建号——ensure-shape 收敛
        const reg = await opts.client.registerWithSharedSecret({ username, password, sharedSecret: opts.sharedSecret })
        userId = reg.userId
        created = true
        // displayname 以注册响应的一次性会话（本人身份）设置——真机实证（Synapse 1.163，
        // studio-dev-217 部署切片）：client API 禁 bot 代改他人 profile（403 M_FORBIDDEN
        // "Cannot set another user's displayname"）；设毕即 logout——身份锚账号不残留凭据
        await opts.client.setDisplayName(userId, displayName, reg.accessToken)
        await opts.client.logout(reg.accessToken)
      } catch (err) {
        if (!isUserExistsError(err)) throw err
        userId = userIdOf(username, opts.client.userId ?? '@:localhost')
        // 已建号路径：displayname 幂等校验（同值零写）；异值时 bot 无代改权——尽力试写，
        // M_FORBIDDEN 视为能力边界收敛（改名的运维通道=服务端 admin API，部署剧本收口）
        try {
          const cur = await opts.client.getDisplayName(userId)
          if (cur !== displayName) await opts.client.setDisplayName(userId, displayName)
        } catch (err2) {
          if (!isForbiddenError(err2)) throw err2
        }
      }
      return { userId, created }
    },

    async ensureMembership({ userId, roomAlias }) {
      const roomId = await opts.client.resolveAlias(fullAlias(roomAlias))
      try {
        await opts.client.invite(roomId, userId)
      } catch (err) {
        if (!isAlreadyInRoomError(err)) throw err // M_FORBIDDEN≈已在房/已受邀——收敛
      }
      await opts.client.setPowerLevel(roomId, userId, memberLevel) // get→改→put；同值写无害（幂等）
    },

    async ensurePowerLevel({ userId, roomAlias, level }) {
      const roomId = await opts.client.resolveAlias(fullAlias(roomAlias))
      const current = await opts.client.getPowerLevels(roomId)
      if (current.users[userId] === level) return // 同值不写（幂等收敛；省一次 state 写）
      await opts.client.setPowerLevel(roomId, userId, level)
    },

    async kickFromRoom({ userId, roomAlias, reason }) {
      const roomId = await opts.client.resolveAlias(fullAlias(roomAlias))
      await opts.client.kick(roomId, userId, reason)
    },
  }
}

/** 停/复的 power_level 取值（供 daemon faces 映射表消费；与装配缺省同源） */
export function matrixLevelFor(status: 'active' | 'paused', memberLevel = 0, mutedLevel = -1): number {
  return status === 'paused' ? mutedLevel : memberLevel
}
