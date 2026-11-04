/**
 * serve/reports-commit —— 报表产出挂单 commit 面（studio-dev-705；docs/17-§2 / docs/43-§十一）
 *
 * 缺口（实测）：output-account（engine/jobs/output-account.ts）与 harvest-recon 把收割产物复制/补收到
 * `<companyDir>/reports/…`，但**运行期从未触发挂单 commit**——公司 git 目录 198 件报表长期未跟踪。
 *
 * 本件（拍边界 commit face，范围收敛）：
 *   - 只处理 `reports/` 前缀的脏路径（新增/修改/删除），**不触碰**其它路径（org-config 等）；
 *   - 写前审计：工作树根校验（assertCompanyWorkTreeRoot）＋索引既有暂存必须为空（防把他人暂存带入）；
 *   - 暂存后复检：staged 必须 ⊆ reports/（否则回滚索引并 blocked）；
 *   - commit 失败＝回滚索引（unstage）并如实返回 error（不吞、不重试写历史）；成功返回 commit hash；
 *   - 幂等/低噪：无 reports 脏路径=clean；同一状态只在状态切换时打日志（由调用方负责节流）。
 *
 * 边界：本件不产生报表、不改输出路径、不碰公司目录其它文件；companyDir 缺省（demo）=disabled 零行为。
 */
import {
  assertCompanyWorkTreeRoot,
  createCommit,
  isWorktreeNoise,
  stagePaths,
  stagedPaths,
  statusEntries,
  unstagePaths,
} from '../../engine/company-commit/git.ts'

/** 报表产出目录前缀（docs/04-§三 落点约定） */
const REPORTS_PREFIX = 'reports/'

export interface ReportsCommitDeps {
  /** 公司目录（git 工作树根）；undefined=demo/无公司面=disabled */
  readonly companyDir?: string
  readonly log: (line: string) => void
  /** 时钟（commit message 时间锚；缺省 Date.now） */
  readonly now?: () => number
}

export interface ReportsCommitResult {
  readonly status: 'committed' | 'clean' | 'disabled' | 'blocked' | 'error'
  /** 本次 commit hash（status=committed） */
  readonly commit?: string
  /** 本次纳入的 reports 脏路径数 */
  readonly staged: number
  /** 非 reports 脏路径数（只观测，不提交） */
  readonly otherDirty: number
  readonly reason?: string
}

/** 构造报表挂单 commit 面（幂等；调用方应 fire-and-forget + 自身节流/日志切换） */
export function createReportsCommitFace(deps: ReportsCommitDeps): { commitPending(): Promise<ReportsCommitResult> } {
  const now = deps.now ?? ((): number => Date.now())
  let inFlight = false
  return {
    async commitPending(): Promise<ReportsCommitResult> {
      if (deps.companyDir === undefined) return { status: 'disabled', staged: 0, otherDirty: 0 }
      if (inFlight) return { status: 'clean', staged: 0, otherDirty: 0, reason: 'in-flight' }
      inFlight = true
      const dir = deps.companyDir
      let reportPaths: string[] = []
      try {
        await assertCompanyWorkTreeRoot(dir)
        // 索引既有暂存必须为空（daemon 唯一写者；有暂存=别的流程半途，交由人工/对应流程处置）
        const preStaged = await stagedPaths(dir)
        if (preStaged.length > 0) {
          return { status: 'blocked', staged: 0, otherDirty: 0, reason: `index-not-empty(${String(preStaged.length)})` }
        }
        const entries = (await statusEntries(dir)).filter((entry) => !isWorktreeNoise(entry.path))
        reportPaths = [...new Set(entries.filter((entry) => entry.path.startsWith(REPORTS_PREFIX)).map((entry) => entry.path))]
        const otherDirty = entries.filter((entry) => !entry.path.startsWith(REPORTS_PREFIX)).length
        if (reportPaths.length === 0) return { status: 'clean', staged: 0, otherDirty }
        await stagePaths(dir, reportPaths)
        const staged = await stagedPaths(dir)
        const outside = staged.filter((path) => !path.startsWith(REPORTS_PREFIX))
        if (outside.length > 0) {
          await unstagePaths(dir, reportPaths)
          return { status: 'blocked', staged: 0, otherDirty, reason: `staged-outside-reports(${String(outside.length)})` }
        }
        const commit = await createCommit(
          dir,
          `reports: 收敛报表产出（${String(reportPaths.length)} 件；${new Date(now()).toISOString()}）`,
        )
        deps.log(`[serve] 公司目录报表挂单 commit：${commit.slice(0, 12)}（${String(reportPaths.length)} 件；其它脏路径 ${String(otherDirty)} 未纳入）`)
        return { status: 'committed', commit, staged: reportPaths.length, otherDirty }
      } catch (err) {
        // commit 前置/提交失败：尽力回滚本次暂存（不把半成品索引留给后续流程）
        if (reportPaths.length > 0) {
          try {
            await unstagePaths(dir, reportPaths)
          } catch {
            /* 回滚失败由 blocked/error 如实上报，不掩盖原错误 */
          }
        }
        const reason = err instanceof Error ? err.message : String(err)
        deps.log(`[serve] 公司目录报表挂单 commit 失败（不重试、不回滚已成立历史）：${reason}`)
        return { status: 'error', staged: 0, otherDirty: 0, reason }
      } finally {
        inFlight = false
      }
    },
  }
}
