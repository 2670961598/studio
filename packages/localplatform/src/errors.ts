/**
 * LocalPlatform 错误类型 —— 端口错误语义（docs/25-§一.4）
 *
 * 本实现一切对外抛错都是 LocalPlatformError（端口不抛裸字符串），其 category
 * 必须能映射进两级错误分类的冻结枚举（docs/17-§9，定义在 contract/kernel）。
 * 本实现的映射约定：
 *   - EXTERNAL_REJECT ：平台侧拒绝——单据不存在 / kb 文档不存在
 *   - CONFIG_INVALID  ：调用方输入不合法——未知字段 / 字段值类型错 / setField 改 state /
 *                       游标无法解释 / kb 路径越界 / 链接自指 / 落盘文件损坏
 */
import type { ErrorCategory } from '@studio-next/contract'

export class LocalPlatformError extends Error {
  readonly category: ErrorCategory
  readonly subcause: string

  constructor(category: ErrorCategory, subcause: string, message: string) {
    super(message)
    this.name = 'LocalPlatformError'
    this.category = category
    this.subcause = subcause
  }
}
