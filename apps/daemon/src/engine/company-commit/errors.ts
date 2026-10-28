/**
 * company-commit · 错误通道（MIG-05 / IMPL-05-06）
 *
 * 依据：docs/v2/11 §〇.4-6（调用失败语义：类别/可否重试/副作用可能/对账入口）与
 *       docs/17-§9 两级分类（Category×Subcause 唯一词表，运行时投影在
 *       `@studio-next/contract` 的 schemas/errors.ts）。
 *
 * 两条通道（互不混用——混用即把「订单不合法」误报成「外部拒写」）：
 *   - CONFIG_INVALID：**订单/路径/仓库前置**不合法（形状、幂等键冲突、无 git、脏树等
 *     调用方输入与前置面）——重试无意义，须改输入；
 *   - EXTERNAL_REJECT：**运行期写入被拒**（旁路写在场、HEAD 竞移、提交失败/回滚不完整）
 *     ——不得当作成功；副作用可能已在场，调用方须按证据对账。
 *
 * 本模块不新增错误枚举、不复述 Category 词表：category 直接取自 contract 的类型面。
 */
import type { ClassifiedError, ErrorCategory } from '@studio-next/contract'

/** 构造一条两级分类 Error（与 contract 的 configInvalid 同手法，category 可指定） */
function classified(category: ErrorCategory, subcause: string, detail?: string): never {
  const err = new Error(`${category}/${subcause}${detail === undefined ? '' : `：${detail}`}`) as Error & ClassifiedError
  err.category = category
  err.subcause = subcause
  if (detail !== undefined) err.detail = detail
  throw err
}

/** 输入/前置不合法（CONFIG_INVALID）：订单形状、路径越界、幂等键冲突、仓库前置缺失 */
export function commitInvalid(subcause: string, detail?: string): never {
  return classified('CONFIG_INVALID', subcause, detail)
}

/** 运行期写入被拒（EXTERNAL_REJECT）：旁路写、HEAD 竞移、提交失败、回滚不完整 */
export function commitRejected(subcause: string, detail?: string): never {
  return classified('EXTERNAL_REJECT', subcause, detail)
}

/** 是否已是两级分类错误（保留原始 category/subcause，不二次包装） */
export function isClassified(err: unknown): err is Error & ClassifiedError {
  if (!(err instanceof Error)) return false
  const candidate = err as Partial<ClassifiedError>
  return typeof candidate.category === 'string' && typeof candidate.subcause === 'string' && candidate.subcause.length > 0
}

/** 错误文本（跨 catch 面统一；不吞栈：detail 只补一句可读上下文） */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
