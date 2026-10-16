/**
 * YouTrack 适配器错误类型 —— 端口错误语义（docs/25-§一.4 / §3.2）
 *
 * 本实现一切对外抛错都是 YouTrackPlatformError（端口不抛裸字符串），其 category
 * 必须能映射进两级错误分类的冻结枚举（docs/17-§9，定义在 contract/kernel）。
 *
 * HTTP → 两级分类映射表（v0 定稿，本表是适配器与 core 的处置契约）：
 *   | 来源                        | category        | subcause                 | 理由 |
 *   |-----------------------------|-----------------|--------------------------|------|
 *   | fetch 抛错（连不上/DNS 断） | EXTERNAL_REJECT | network-error            | 平台侧不可达，可重试；不是调用方输入错 |
 *   | 响应不是合法 JSON           | CONFIG_INVALID  | unexpected-response      | 代理/网关劫持或 baseUrl 指错——我方部署配置问题 |
 *   | 响应 JSON 形状不符 zod 模型 | CONFIG_INVALID  | unexpected-response-shape| 适配器与实例版本漂移——视为配置/版本不匹配 |
 *   | 400                         | CONFIG_INVALID  | bad-request              | 平台拒收我方请求（查询语法/值形状）——入参翻译问题 |
 *   | 401 / 403                   | CONFIG_INVALID  | auth-rejected            | token 失效或权限不足——凭据是配置 |
 *   | 404                         | EXTERNAL_REJECT | not-found                | 目标不存在（上游再包装为 issue-not-found 等） |
 *   | 409                         | EXTERNAL_REJECT | conflict                 | 平台侧并发冲突 |
 *   | 429                         | EXTERNAL_REJECT | rate-limited             | 平台限流 |
 *   | 其余 4xx                    | CONFIG_INVALID  | client-error             | 兜底：按我方请求问题上报 |
 *   | 5xx                         | EXTERNAL_REJECT | server-error             | 平台侧故障 |
 *   | 业务校验（本层主动拦截）     | CONFIG_INVALID  | 见各 subcause            | 未映射字段/坏游标/非法值等调用方输入错 |
 *
 * v0 不做超时与重试（依赖注入的 fetch 自带语义透传）；升级路径：signal 超时 +
 * 幂等方法幂等重试，登记进 16-§二 后再动。
 */
import type { ErrorCategory } from '@studio-next/contract'

export class YouTrackPlatformError extends Error {
  readonly category: ErrorCategory
  readonly subcause: string

  constructor(category: ErrorCategory, subcause: string, message: string) {
    super(message)
    this.name = 'YouTrackPlatformError'
    this.category = category
    this.subcause = subcause
  }
}
