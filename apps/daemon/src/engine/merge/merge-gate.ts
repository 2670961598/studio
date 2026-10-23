/**
 * merge-gate —— 合并跑闸门（202-P2，studio-dev-232，docs/17-§2 相位 5 先门禁后 MERGE）
 *
 * 闸门三面（R1 引擎亲跑；docs/17-§6 收割四要件口径不动——提交核验折进要件 4 面）：
 *   1. 回执落盘（要件 3）：工位根 merge-REPORT.md 存在且非空；
 *   2. 门禁命令（要件 4 之命令面）：repo 内跑 MergeRunDeps.gateCommand（缺省
 *      `bun run test`）exit 0——引擎亲跑，不信 worker 自报；
 *   3. 合并提交存在性核验（要件 4 之提交面）：目标分支可解析 ∧ reviewTip（派发时
 *      rev-parse HEAD 摄下的工位 HEAD）是目标分支祖先 ∧ 目标分支 tip 双亲（真合并
 *      提交，非 fast-forward 假形/未动）。
 *
 * 要件 4（exit0）= 命令面 ∧ 提交面（两绿才算门禁绿——判负线「dev 不得出现未过门禁
 * 提交」的结构保证：MERGE 事件严格后于本闸门绿面）。
 *
 * IO 全经 MergeGitPort / MergeGateCommandPort 注入（default-deps.ts 出 spawn 版；
 * 测试出 fake）——本件纯编排。
 */

/** git 端口（合并跑闸门所需四原语；真实现=default-deps.ts，测试=fake） */
export interface MergeGitPort {
  /** 工位 repo 当前 HEAD（派发时摄下=reviewTip）；失败=undefined */
  revParseHead(repoDir: string): Promise<string | undefined>
  /** 分支 tip sha（本地分支）；失败=undefined */
  branchTip(repoDir: string, branch: string): Promise<string | undefined>
  /** ancestor 是否 descendant 祖先（merge-base --is-ancestor） */
  isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean>
  /** 分支 tip 的父提交数（真合并提交=2） */
  tipParentCount(repoDir: string, branch: string): Promise<number>
  /** daemon 代推（R2）：push 目标分支到 origin；结果如实入 note（不阻断迁移） */
  push(repoDir: string, branch: string): Promise<{ ok: boolean; note: string }>
}

/** 门禁命令端口（R1 引擎亲跑）：repo 内执行冻结门禁命令 */
export interface MergeGateCommandPort {
  run(repoDir: string): Promise<{ code: number; note: string }>
}

/** 合并闸门结果（四要件判定输入；note 摘要进事件留痕） */
export interface MergeGateResult {
  /** 要件 3：回执存在且非空 */
  receiptExists: boolean
  /** 要件 4：门禁命令 exit 0 ∧ 合并提交核验过（两面都绿） */
  exit0: boolean
  /** 命令面明细：exit code（未跑=-1） */
  exitCode: number
  /** 提交面明细：目标分支 tip sha（核验过=合并提交 sha） */
  mergeSha: string | undefined
  /** 摘要（缺项清单/核验明细——事件 note 用） */
  note: string
}

/** 回执非空检查（要件 3；文件缺失/空=红——不代写不补收，docs/17-§6 同口径） */
export function receiptNonEmpty(receiptPath: string, exists: (p: string) => boolean, sizeOf: (p: string) => number): boolean {
  return exists(receiptPath) && sizeOf(receiptPath) > 0
}

/**
 * 跑合并闸门（编排面：命令面+提交面；回执存在性由调用方查——引擎侧文件系统直查）。
 * 出口永不抛（git 失败=核验不过+note 如实——失败面照走 GATE_FAIL 不炸拍）。
 */
export async function runMergeGate(d: {
  git: MergeGitPort
  gate: MergeGateCommandPort
  repoDir: string
  reviewTip: string
  targetBranch: string
}): Promise<{ exit0: boolean; exitCode: number; mergeSha: string | undefined; note: string }> {
  try {
    return await runMergeGateInner(d)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exit0: false, exitCode: -1, mergeSha: undefined, note: `合并闸门异常（${msg}）——按红脸收口` }
  }
}

/** 实际编排（runMergeGate 的 try 体；端口抛错=核验不过+note 如实——失败面照走 GATE_FAIL 不炸拍） */
async function runMergeGateInner(d: {
  git: MergeGitPort
  gate: MergeGateCommandPort
  repoDir: string
  reviewTip: string
  targetBranch: string
}): Promise<{ exit0: boolean; exitCode: number; mergeSha: string | undefined; note: string }> {
  const tip = await d.git.branchTip(d.repoDir, d.targetBranch)
  let commitOk = false
  let commitNote = '提交核验未过'
  if (tip === undefined) {
    commitNote = `目标分支 ${d.targetBranch} 不可解析`
  } else {
    const parents = await d.git.tipParentCount(d.repoDir, d.targetBranch)
    if (parents < 2) {
      commitNote = `目标分支 tip 为 ${parents} 亲（非真合并提交——未合入或 fast-forward 形）`
    } else {
      const anc = await d.git.isAncestor(d.repoDir, d.reviewTip, tip)
      if (anc) {
        commitOk = true
        commitNote = `merge-base 祖先核验过（reviewTip=${d.reviewTip.slice(0, 12)}∈${d.targetBranch}）`
      } else {
        commitNote = `reviewTip=${d.reviewTip.slice(0, 12)} 非 ${d.targetBranch} 祖先（合入提交缺位）`
      }
    }
  }
  const cmd = await d.gate.run(d.repoDir)
  const exit0 = cmd.code === 0 && commitOk
  const note = `门禁 exit=${cmd.code}${cmd.note !== '' ? `（${cmd.note}）` : ''}；${commitNote}`
  return { exit0, exitCode: cmd.code, mergeSha: commitOk ? tip : undefined, note }
}
