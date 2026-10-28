/**
 * company-commit · 唯一写入者审计（旁路写检测；MIG-05 / IMPL-05-06）
 *
 * 依据：docs/v2/05 §三 DOM-01（公司 git 目录唯一写入者＝daemon 挂单 commit）、§三通则 1
 *       （同一事实域同一时刻只有一条权威写入路径；其余只读，镜像不得静默升权威）；
 *       docs/v2/15 §一（fail-closed 取向：可疑写面一律拒，不静默放行）。
 *
 * 机制（不靠自律，靠可机械复核的证据）：
 *   1. **挂单标记**：只有 message 带 `StudioNext-Order-Id` trailer 的 commit 才算 daemon
 *      挂单；标记由本模块唯一生成（owner 面），外部写入无法凭空获得历史一致性。
 *   2. **基线采纳**：公司目录历史里本模块首次写入前的一切 commit 视为**既有基线**
 *      （init/import/create 的引导写——它们先于运行期挂单，不属旁路）；首次挂单把当时
 *      HEAD 记为基线证据（`CommitEvidence.baseline`），此后**最早挂单 commit 的父提交**
 *      即基线，不再漂移。
 *   3. **旁路判定**：比最早挂单 commit 更新的、又没有挂单标记的 commit ＝旁路写；
 *      工作树脏（有未提交改动/未跟踪文件）＝未挂单写。二者都在 apply 前拒写并审计。
 *
 * 诚实边界（缺口登记，不静默）：
 *   - 只看**当前分支 HEAD 可达历史**：其他分支/已重写历史（rebase/filter）不在此扫描；
 *   - `.gitignore` 忽略的未跟踪文件不可见（`git status` 语义）；本模块不扫工作树全树；
 *   - 跨进程互斥/围栏（fencing）机制＝**目标（未证）**：本模块只做进程内串行（index.ts）＋
 *     提交前 HEAD 竞移检测，不宣称已冻结其他写入者（docs/v2/05 §三通则 2）。
 */
import { realpath } from 'node:fs/promises'
import { commitRejected } from './errors.ts'
import { gitWorkTreeRoot, headCommit, isWorktreeNoise, readLog, statusEntries } from './git.ts'
import { parseCommitMessage } from './order.ts'
import type { BypassFinding, GitCommit, OwnedCommit, SoleWriterAudit } from './types.ts'

/** 是否有挂单标记 */
function isOwned(commit: GitCommit): boolean {
  return parseCommitMessage(commit.message).orderId !== null
}

/** 从历史里抽 daemon 挂单 commit（新→旧） */
export function listOwnedCommits(commits: readonly GitCommit[]): readonly OwnedCommit[] {
  const owned: OwnedCommit[] = []
  for (const commit of commits) {
    const parsed = parseCommitMessage(commit.message)
    if (parsed.orderId === null) continue
    owned.push({ hash: commit.hash, orderId: parsed.orderId, digest: parsed.digest })
  }
  return owned
}

/** 按单号查既有挂单（幂等重放面；新→旧取第一条——同号多提交＝历史被破坏，取最新可见者） */
export function findOrderCommit(commits: readonly GitCommit[], orderId: string): OwnedCommit | null {
  for (const commit of commits) {
    const parsed = parseCommitMessage(commit.message)
    if (parsed.orderId === orderId) return { hash: commit.hash, orderId, digest: parsed.digest }
  }
  return null
}

/** commit 首行摘要（审计人读面；截断 80 字符） */
function subjectOf(commit: GitCommit): string {
  const first = commit.message.split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

/**
 * 只读审计：当前分支历史 + 工作树状态 → 唯一写入者报告。
 * **零写**（不 add/commit/checkout），可在任何时刻调用（CLI 巡检/apply 前置）。
 */
export async function inspectSoleWriter(companyDir: string): Promise<SoleWriterAudit> {
  const root = await gitWorkTreeRoot(companyDir)
  if (root === null) {
    return {
      companyDir,
      head: null,
      baseline: null,
      lastOwnedCommit: null,
      ownedCommits: 0,
      scannedCommits: 0,
      findings: [{ kind: 'not-a-worktree', detail: `不是 git 工作树：${companyDir}`, commit: null, path: null }],
      soleWriter: false,
    }
  }
  const findings: BypassFinding[] = []
  const actual = await realpath(companyDir).catch(() => companyDir)
  if (actual !== root) {
    findings.push({ kind: 'not-a-worktree', detail: `公司目录不是工作树根（toplevel=${root}）：${actual}——审计只在公司目录根成立`, commit: null, path: null })
  }
  const head = await headCommit(companyDir)
  const commits = await readLog(companyDir)
  if (head === null) {
    findings.push({ kind: 'no-baseline', detail: '仓库无任何 commit（挂单需要基线——先完成 init/create 首提）', commit: null, path: null })
  }
  let newestOwnedIndex = -1
  let earliestOwnedIndex = -1
  for (let index = 0; index < commits.length; index += 1) {
    if (!isOwned(commits[index] as GitCommit)) continue
    if (newestOwnedIndex === -1) newestOwnedIndex = index
    earliestOwnedIndex = index
  }
  let baseline: string | null = null
  if (earliestOwnedIndex >= 0) {
    baseline = commits[earliestOwnedIndex + 1]?.hash ?? null
  } else {
    baseline = head // 首单将采纳当前 HEAD 为基线（尚未发生，报告面显式标注「待采纳」）
  }
  if (earliestOwnedIndex > 0) {
    // 比最早挂单 commit 更新的、无挂单标记者＝旁路写（新→旧顺序取历史区间）
    for (let index = 0; index < earliestOwnedIndex; index += 1) {
      const commit = commits[index]
      if (commit === undefined || isOwned(commit)) continue
      findings.push({
        kind: 'unattributed-commit',
        detail: `非 daemon 挂单 commit ${commit.hash.slice(0, 12)}（${commit.author}）：${subjectOf(commit)}`,
        commit: commit.hash,
        path: null,
      })
    }
  }
  for (const entry of await statusEntries(companyDir)) {
    if (isWorktreeNoise(entry.path)) continue
    findings.push({ kind: 'dirty-worktree', detail: `工作树未挂单改动（${entry.status.trim() || '??'}）：${entry.path}`, commit: null, path: entry.path })
  }
  return {
    companyDir,
    head,
    baseline,
    lastOwnedCommit: newestOwnedIndex >= 0 ? (commits[newestOwnedIndex]?.hash ?? null) : null,
    ownedCommits: commits.filter(isOwned).length,
    scannedCommits: commits.length,
    findings,
    soleWriter: findings.length === 0,
  }
}

/** 审计报告人读面（CLI/日志出口；错误面走 detail 摘要） */
export function renderSoleWriterAudit(audit: SoleWriterAudit): string {
  const lines = [
    `公司目录：${audit.companyDir}`,
    `HEAD：${audit.head ?? '（空仓）'}｜扫描 ${audit.scannedCommits} commit｜挂单 ${audit.ownedCommits} 次`,
    `基线：${audit.baseline ?? '（无父提交/无历史）'}`,
    `唯一写入者：${audit.soleWriter ? '是（未发现旁路写）' : '否（发现旁路写）'}`,
  ]
  for (const finding of audit.findings) lines.push(`  - [${finding.kind}] ${finding.detail}`)
  return lines.join('\n')
}

/**
 * apply 前置：发现旁路写即拒（把审计证据塞进 detail——调用方不必再解析报告对象）。
 * 拒写而不是「先合并再提交」：旁路写意味着权威写入路径之外已经动过公司目录，
 * 此时任何自动修复都在替旁路背书（v2/05 §三通则 1）。
 */
export async function assertSoleWriter(companyDir: string): Promise<SoleWriterAudit> {
  const audit = await inspectSoleWriter(companyDir)
  if (audit.findings.length > 0) {
    const detail = audit.findings.map((finding) => `[${finding.kind}] ${finding.detail}`).join('；')
    commitRejected('company-commit/sole-writer-violation', `发现 ${audit.findings.length} 项旁路写/前置缺失，拒挂单：${detail}`)
  }
  return audit
}
