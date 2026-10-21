/**
 * 两级错误分类 schema（docs/17-§9 冻结枚举；docs/25-§二 kernel.ClassifiedError）
 * ＋ executor 域失败码冻结词表 EXECUTOR_ERROR_CODES（v1.7，docs/25-§3.1 末裁决）
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

// —— StreamEvent.turn_end.errorCode 冻结词表（v1.7，2026-10-21——studio-dev-102 P2） ——

/**
 * executor 域失败码冻结词表（docs/25-§3.1 末「errorCode 词表冻结裁决」，制作人
 * 2026-10-21 全批）。落位本文件（kernel.ts 守纯类型纪律）：与 ERROR_CATEGORIES 同为
 * 错误分类运行时词表——并轨语义 errorCode = **subcause 的受冻结值域**（executor 域），
 * 非第三路由键；断路器「错误签名」（17-§6）消费的仍是 category×subcause。
 * 已产码收编（不臆造）：
 *   - AUTH / MISSING_CREDENTIAL：v1.5 dsh 先行两码（docs/31-§7 P-04/A4）
 *   - EXTERNAL_RATE_LIMIT：daemon fake（DEV-46 注入面）已产值的既成收编
 *     （studio-dev-102 E7 词表漂移——上游外部服务限速失败，429 同型）
 * 词表只增不改，加码走批示（照 kind 词表纪律）；词表外值=实现缺陷，消费方校验拒收。
 * errorCode→ErrorCategory 映射降为 docs 附表（docs/25 附录 A：无守卫无负测不进契约），
 * 首消费方接线时随批示定稿。
 */
export const EXECUTOR_ERROR_CODES = [
  'AUTH',
  'MISSING_CREDENTIAL',
  'EXTERNAL_RATE_LIMIT',
] as const

/** 冻结词表成员类型（turn_end.errorCode 字段保持 string：executor 喂回的运行时数据，靠词表判定把关） */
export type ExecutorErrorCode = (typeof EXECUTOR_ERROR_CODES)[number]

/** errorCode 词表判定：越界=实现缺陷，消费方校验据此拒收（红绿负测见 test/schemas.test.ts） */
export function isExecutorErrorCode(v: string): v is ExecutorErrorCode {
  return (EXECUTOR_ERROR_CODES as readonly string[]).includes(v)
}
