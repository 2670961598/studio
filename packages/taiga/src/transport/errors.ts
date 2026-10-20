/**
 * TaigaPlatform 错误类型 —— 端口错误语义（docs/25-§3.2：标准形状 kernel.ClassifiedError）
 *
 * 本实现一切对外抛错都是 TaigaPlatformError（category 必须可映射两级错误分类冻结枚举，
 * docs/17-§9）。映射约定（与 yt/localplatform 同表）：
 *   - EXTERNAL_REJECT ：平台侧拒绝——单据/文档不存在(404)、并发冲突(409)、限流(429)、
 *                       平台故障(5xx)、网络不可达
 *   - CONFIG_INVALID  ：调用方输入或配置不合法——坏请求(400)、认证被拒(401/403)、
 *                       坏游标、未映射字段、未知状态、响应形状漂移、显式未实现面
 */
import type { ErrorCategory } from '@studio-next/contract'

export class TaigaPlatformError extends Error {
  readonly category: ErrorCategory
  readonly subcause: string

  constructor(category: ErrorCategory, subcause: string, message: string) {
    super(message)
    this.name = 'TaigaPlatformError'
    this.category = category
    this.subcause = subcause
  }
}

/** 显式未实现面（骨架统一口径，对齐 yt guards 先例：明报不静默） */
export function notImplemented(face: string, reason: string): TaigaPlatformError {
  return new TaigaPlatformError(
    'CONFIG_INVALID',
    `taiga-${face}-not-implemented`,
    `Taiga 适配器 ${face} 面本切片未实现：${reason}`,
  )
}
