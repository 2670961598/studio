/**
 * 两级错误分类 schema（docs/17-§9 冻结枚举；docs/25-§二 kernel.ClassifiedError）
 *
 * 纪律：**枚举本体以 ports/kernel.ts 的 ErrorCategory 类型为准，本文件不重复定义**——
 * 此处的运行时数组只是该类型的投影，靠下方编译期护栏保证与 kernel 同步（增删即编译红）。
 * subcause 非空校验：两级分类的「子因」是机器可比对键，空串等同丢失分类（17-§9 每类带处置语义，
 * 处置路由依赖 category×subcause 二元组）。
 */
import { z } from 'zod'
import type { ClassifiedError, ErrorCategory } from '../ports/kernel.ts'

/**
 * kernel.ErrorCategory 的运行时投影（11 类，17-§9）。
 * `satisfies readonly ErrorCategory[]`：多列/拼错任一成员 → 编译红。
 */
export const ERROR_CATEGORIES = [
  'GATE_FAIL',
  'WORKER_DEAD',
  'QA_BACK',
  'STALL',
  'NO_LANE',
  'DISPATCH_FAIL',
  'MERGE_CONFLICT',
  'LLM_FAIL',
  'CONFIG_INVALID',
  'EVOLVE_REJECT',
  'EXTERNAL_REJECT',
] as const satisfies readonly ErrorCategory[]

/**
 * 编译期穷尽护栏：kernel.ErrorCategory 增删成员而上面数组未跟 → 下行赋值类型红
 * （Exclude 非 never 时，true 不再可赋值）。枚举本体始终以 kernel.ts 为准。
 */
export type ErrorCategoryProjectionComplete = Exclude<ErrorCategory, (typeof ERROR_CATEGORIES)[number]> extends never
  ? true
  : { missing: Exclude<ErrorCategory, (typeof ERROR_CATEGORIES)[number]> }
export const ERROR_CATEGORIES_COMPLETE: ErrorCategoryProjectionComplete = true

/** category 通道（枚举本体=kernel.ErrorCategory，此处仅 zod 化） */
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES)

/** ClassifiedError 形状（17-§9 两级分类；subcause 非空，detail 可选补充） */
export const ClassifiedErrorSchema = z.strictObject({
  category: ErrorCategorySchema,
  subcause: z.string().min(1),
  detail: z.string().optional(),
})

/**
 * 契约 subject 的统一抛错通道：不合法即抛 ClassifiedError 形状的 Error
 * （runner 对ThrownShape 宽松匹配 category/subcause——CASES.md err 期望通道）。
 */
export function configInvalid(subcause: string, detail?: string): never {
  const err = new Error(`CONFIG_INVALID/${subcause}${detail === undefined ? '' : `：${detail}`}`) as Error & ClassifiedError
  err.category = 'CONFIG_INVALID'
  err.subcause = subcause
  if (detail !== undefined) err.detail = detail
  throw err
}
