/**
 * cases.json 清单与用例格式 schema（docs/25-§二 / F2-14）
 * 格式规范见同包 CASES.md（冻结面：稳定 id / 恰一 out|err / `__NULL__` 哨兵 / 子集匹配语义）。
 * 本文件是清单自身的机器校验——契约数据先过契约，防止格式漂移。
 */
import { z } from 'zod'

/** 用例期望：恰一 out|err（refine 强制互斥） */
const ExpectedSchema = z
  .union([
    z.strictObject({ out: z.unknown() }),
    z.strictObject({ err: z.strictObject({ category: z.string(), subcause: z.string().optional() }) }),
  ])
  .refine((v) => Object.keys(v).length === 1, { message: 'expected 必须恰含 out 或 err 之一' })

/** 单条用例（v1：input 内联；未来大语料可走 file 指针，schema 预留） */
export const CaseEntrySchema = z.object({
  /** 稳定 id：C-<域>-<序号>（P2 默认值，docs/25-§七）；一经合入永不复用永不改义 */
  id: z.string().regex(/^C-[a-z]+-\d{3}$/, 'id 形如 C-dir-001（域缩写+三位零填充）'),
  domain: z.string().min(1),
  /** 依据文档章节号（20-§二 依据链的最小单位） */
  docs: z.string().min(1),
  title: z.string().min(1),
  input: z.unknown(),
  expected: ExpectedSchema,
})

/** cases.json 清单（v1） */
export const CaseManifestSchema = z.object({
  version: z.literal(1),
  cases: z.array(CaseEntrySchema).min(1),
})

export type CaseEntry = z.infer<typeof CaseEntrySchema>
export type CaseManifest = z.infer<typeof CaseManifestSchema>
