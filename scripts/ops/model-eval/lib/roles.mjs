/**
 * roles.mjs —— 档位/角色权重表（纯常量；口径见 docs/quality/model-eval.md §3、§7）
 *
 * 三档角色沿用平台现行分档（docs/quality/tier-executors.md）：
 *   mid     主力 worker：执行任务书 / 修码 / 工具链（重 t02、t05）
 *   high    verifier / 综合 / 决策（重 t03、t04、t06）
 *   patrol  巡检岗：读材料 → REPORT，成本敏感（重 t01，按 token 量扣分）
 * 未列任务缺省权重 1。
 */
export const ROLE_WEIGHTS = Object.freeze({
  mid: Object.freeze({ t01: 1, t02: 2, t03: 1, t04: 1, t05: 2, t06: 1 }),
  high: Object.freeze({ t01: 1, t02: 1, t03: 2, t04: 2, t05: 1, t06: 2 }),
  patrol: Object.freeze({ t01: 2, t02: 0.5, t03: 1, t04: 1, t05: 1.5, t06: 1.5 }),
})

export const ROLE_LABELS = Object.freeze({
  mid: 'mid 档（主力 worker：执行任务书 / 修码 / 工具链）',
  high: 'high 档（verifier / 综合 / 决策）',
  patrol: 'patrol 档（巡检岗：读材料 → REPORT，成本敏感）',
})

/** 任务集全集（按 id；三档权重表的键并集，顺序固定）。 */
export const ALL_TASKS = Object.freeze([...new Set(Object.values(ROLE_WEIGHTS).flatMap((w) => Object.keys(w)))].sort())

/** 裁判分在格分里的占比（其余为确定性分）。 */
export const JUDGE_WEIGHT = 0.3

/** 覆盖率下限：跑到的任务占比低于此值的模型不进推荐。 */
export const COVERAGE_MIN = 0.6

/** patrol 档成本惩罚系数：扣 0.05 × (该模型总 tokens / 矩阵最大 tokens)。 */
export const COST_PENALTY = 0.05
