/**
 * employment —— 任职闸门的**判定面**类型与纯判据（studio-dev-550；docs/v2/02 §三/§3.4）
 *
 * 规格依据：
 *   - docs/v2/02 §三（任职六状态状态机）＋§3.3-1（授权冻结即工作侧权门失效）＋§3.4
 *     （**非在岗态不得发起出工**——本件把该「目标（未证）」收口成 core 判定面）；
 *   - docs/v2/11 §14.2（迁移边与触发者：任职事实只能由 REC-LIFE-02 依决定作出）；
 *   - docs/v2/14 PORT-HR；docs/v2/17 GAP-V2-06 / NEG-REC-02（代偿面收敛）；
 *   - docs/17-§2 相位 3 派发（「发起出工」的机器面）。
 *
 * 分工（三层，互不越界）：
 *   1. **事实面**＝daemon `engine/hr-gate/employment-gate.ts`：读公司目录人事索引、
 *      归一六状态、落台账留痕（只读事实，不写迁移）；
 *   2. **判定面**＝本件：`employmentAllowsDispatch`（只有 in-service 放行；**缺证≠在岗**，
 *      missing/conflict/unknown 一律拒）；
 *   3. **决策面**＝`decide.ts`：HOLD_NOT_IN_SERVICE（先于并发四闸的资格硬拒）。
 *
 * 纯函数纪律：零 IO、零时钟；同输入同输出。类型随本件导出（decide.ts 只 import 形状）。
 */

/**
 * 任职闸门事实状态（判定面五值）：只有 `in-service` 放行；其余四值都是**拒**——
 * missing=事实缺失（查无工号/未携 status）、conflict=同工号多行事实不一致、
 * unknown=值不可归一（不猜测）、not-in-service=显式非在岗（candidate/suspended/paused/
 * handover/settling/retired，v2/02 §3.1 六状态除 active 外）。
 */
export type EmploymentGateState = 'in-service' | 'not-in-service' | 'missing' | 'conflict' | 'unknown'

/** 任职闸门事实快照（daemon 采集 → core 判定；观测字段不参与判定） */
export interface EmploymentGateSnapshot {
  /** 判定面：只有 in-service 放行 */
  state: EmploymentGateState
  /** 派发对象工号（观测/留痕；缺证时可为空） */
  personId?: string
  /** 事实源原始状态值（active/paused/suspended/...；缺失时为空） */
  status?: string
  /** 事实源标签（company-directory=公司目录人事索引） */
  source?: string
  /** 如实说明（缺失/冲突/未知的细节；观测面，不参与判定） */
  detail?: string
}

/**
 * 任职闸门判据（core 唯一用法）：`undefined`＝旧调用面不带闸（放行，字节不变）；
 * 提供快照时**只有 in-service 放行**（fail-closed：不可证在岗即拒）。
 */
export function employmentAllowsDispatch(snapshot: EmploymentGateSnapshot | undefined): boolean {
  return snapshot === undefined || snapshot.state === 'in-service'
}
