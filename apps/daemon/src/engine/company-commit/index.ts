/**
 * company-commit · 挂单 commit 编排出口（MIG-05 / IMPL-05-06，LANE-E）
 *
 * 【定位】公司 git 目录（DOM-01：组织/人事/岗位/章程文本/公司定义）的**运行期唯一写入
 * 路径**＝daemon 的挂单 commit。一次组织变更单→恰一个 commit；message 引单号与组织面记录
 * 引用（REC-LIFE-07..11 / REC-AUTH-01）；失败不留半 commit。
 *
 * 【依据】
 *   - plan/05 IMPL-05-06（验收：组织变更→挂单单 commit、`git log` 逐单；旁路写被拒）
 *   - docs/v2/05 §三 DOM-01＋通则 1/2（一域一条权威写入路径；无互认围栏只允许独占交接）
 *   - docs/v2/06 §五.1（配置只表拟任，不产生任命/离职/结清——**已提交≠已生效**）
 *   - docs/v2/11 §〇.4-4（同对象同版本只允许一次成功迁移；重复提交返回既有结果、零第二
 *     副作用）、§〇.4-5（幂等键须含公司标识并可映射回五元组——本单以单号＋内容摘要作
 *     特化键）、§3.2 组织侧记录族
 *   - docs/v2/14 §二（PORT-REG 备注「DOM-01 挂单 commit 由 daemon」）与 §1.1（「只产候选，
 *     『已提交』≠『已生效』」）
 *
 * 【与 PORT-REG 的写路径边界（判据面，不靠注释自律）】
 *   1. 端口面：`packages/contract/src/ports/reg.ts` 的 `submitRevision / registerApproval /
 *      activateAuthority / fenceWriter` 语义**不在本模块**——本模块不判定授权、不登记批准、
 *      不激活代次、不宣称围栏（围栏＝目标未证）。它只回答一个问题：
 *      「已决定的组织变更，怎样**唯一、原子、可复核**地落成公司目录的一次 commit」。
 *   2. 组合顺序：先由判定面（PORT-REG/PORT-AUTH 实现）登记决定与记录 → 再把记录所指的
 *      目录变更交本模块挂单。两组写入**不是同一事务**（记录在 DOM-03 台账、目录在 DOM-01
 *      git）：本模块失败时定义面回滚为零变更，判定面须按「提交未成立」处理；
 *      两阶段之间的原子性＝**缺口（未证）**，不得宣称恰好一次（登记见回报）。
 *   3. 本模块只写公司目录：不 import 也不调用 store/gateway/平台/面板/适配器包
 *      （e2e 以静态 import 扫描机械背书），不写 `.git/` 内部文件，不写信任锚
 *      （`.studio-next/` 在禁写面）。
 *   4. 挂单 commit **不**证明记录已落表、不证明授权成立、不证明变更已生效；它只证明
 *      「这些目录字节在某时刻被 daemon 以该单号提交」。证据消费方须自行对账记录面。
 *
 * 【并发】进程内按公司目录串行（同一目录同时只允许一个挂单在飞行中）；提交前再读 HEAD，
 * 与前置 HEAD 不一致即拒（别人插了 commit＝可能旁路）——跨进程互斥/围栏未证，见 bypass.ts
 * 头注「诚实边界」。
 */
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { assertSoleWriter, findOrderCommit } from './bypass.ts'
import { commitInvalid, commitRejected, errText, isClassified } from './errors.ts'
import {
  assertCompanyWorkTreeRoot,
  changedPathsOfCommit,
  createCommit,
  headCommit,
  isWorktreeNoise,
  messageOfCommit,
  readLog,
  stagePaths,
  stagedPaths,
  statusEntries,
  unstagePaths,
} from './git.ts'
import {
  assertNoSymlinkEscape,
  assertWritableCompanyPath,
  orderDigest,
  orderPaths,
  parseCommitMessage,
  parseOrgChangeOrder,
  parseOrgChangeOrderJson,
  renderCommitMessage,
} from './order.ts'
import { applyOps, restoreSnapshots, snapshotPaths } from './workspace.ts'
import type { PathSnapshot } from './workspace.ts'
import type { CommitEvidence, GitStatusEntry, OrgChangeOrder, SoleWriterAudit } from './types.ts'

// ───────────────────────── 出口面（唯一编排入口 + 只读审计） ─────────────────────────

/**
 * 组织变更挂单：{@link OrgChangeOrder} → 公司目录一次 commit。
 *
 * 前置（任一不满足即拒，零写入）：
 *   ① 订单形状/路径/记录家族过闸（CONFIG_INVALID）；
 *   ② 公司目录是该 git 工作树根、有 commit 基线；
 *   ③ 唯一写入者审计零发现（无旁路 commit、工作树无未挂单改动）。
 *
 * 结果三态见 {@link CommitEvidence.status}：`committed`（本次恰一个 commit）／`replayed`
 * （同单号同摘要：返回既有 commit，**零新副作用**）／`unchanged`（字节无变化：不造空 commit）。
 */
export async function applyOrgChangeOrder(companyDir: string, orderInput: unknown, options: { readonly onAudit?: (audit: SoleWriterAudit) => void } = {}): Promise<CommitEvidence> {
  const order = parseOrgChangeOrder(orderInput)
  for (const op of order.ops) assertWritableCompanyPath(op.path)
  const dir = await resolveCompanyDir(companyDir)
  for (const op of order.ops) await assertNoSymlinkEscape(dir, op.path)
  return withDirLock(dir, () => commitOrder(dir, order, options.onAudit))
}

/** 只读巡检：旁路写审计报告（零写；不因发现而抛错——由调用方决定拒/报） */
export { inspectSoleWriter, renderSoleWriterAudit } from './bypass.ts'

/**
 * 只读巡检的抛错版：发现旁路写/前置缺失即 EXTERNAL_REJECT
 * （`company-commit/sole-writer-violation`）。apply 内部同用此闸。
 */
export { assertSoleWriter }

export { parseOrgChangeOrder, parseOrgChangeOrderJson, renderCommitMessage, orderDigest, orderPaths, assertWritableCompanyPath }
export { ORDER_RECORD_FAMILIES, ORDER_TRAILERS, WRITER_SIGNATURE } from './order.ts'
export * from './types.ts'

// ───────────────────────── 编排内核 ─────────────────────────

async function commitOrder(dir: string, order: OrgChangeOrder, onAudit: ((audit: SoleWriterAudit) => void) | undefined): Promise<CommitEvidence> {
  // 前置一：公司目录必须**自己就是**工作树根（防把上级仓库当公司目录提交）
  await assertCompanyWorkTreeRoot(dir)
  const digest = orderDigest(order)
  const paths = orderPaths(order)
  const message = renderCommitMessage(order)
  const audit = await assertSoleWriter(dir)
  if (onAudit !== undefined) onAudit(audit)
  const replay = findOrderCommit(await readLog(dir), order.orderId)
  if (replay !== null) return replayEvidence(dir, order, replay.hash, replay.digest, digest, paths, audit)
  const expectedHead = audit.head
  if (expectedHead === null) commitInvalid('company-commit/no-baseline', '仓库无 commit 基线——先完成 init/create 首提（空仓不挂单，避免无父提交的孤立写）')
  const snapshots = await snapshotPaths(dir, paths)
  let commit: string | null = null
  let committed: readonly string[] = []
  try {
    await applyOps(dir, order.ops)
    // 噪声（.DS_Store 家族）不是组织面写：与审计同口径剔除，不得因它拒掉整单
    const entries = (await statusEntries(dir)).filter((entry) => !isWorktreeNoise(entry.path))
    const declared = new Set(paths)
    const stray = entries.filter((entry) => !declared.has(entry.path))
    if (stray.length > 0) {
      commitRejected('company-commit/stray-change', `写后工作树出现订单外改动（拒提交并回滚）：${describeStatus(stray)}`)
    }
    if (entries.length === 0) {
      // 字节无变化：不造空 commit（空提交＝伪造「有变更」的证据），也不留任何快照残留
      return {
        status: 'unchanged',
        orderId: order.orderId,
        commit: null,
        message,
        digest,
        paths: [],
        recordRefs: order.recordRefs,
        previousHead: expectedHead,
        baseline: audit.ownedCommits === 0 ? expectedHead : null,
        verified: true,
      }
    }
    committed = entries.map((entry) => entry.path).sort()
    await stagePaths(dir, paths)
    const staged = await stagedPaths(dir)
    const outsideOrder = staged.filter((entry) => !declared.has(entry))
    if (outsideOrder.length > 0) {
      commitRejected('company-commit/stray-staged', `暂存区出现订单外路径（拒提交并回滚）：${outsideOrder.join('、')}`)
    }
    const headBefore = await headCommit(dir)
    if (headBefore !== expectedHead) {
      commitRejected('company-commit/head-moved', `写期间 HEAD 已变（前置 ${expectedHead.slice(0, 12)}→现在 ${(headBefore ?? '空').slice(0, 12)}）：疑似并发/旁路写，拒提交并回滚`)
    }
    commit = await createCommit(dir, message)
  } catch (err) {
    const rollback = await rollbackOrder(dir, snapshots, paths)
    if (!rollback.ok) {
      commitRejected('company-commit/rollback-incomplete', `挂单失败（${errText(err)}）；回滚不完整：${rollback.detail}——须人工对账工作树`)
    }
    if (isClassified(err)) throw err
    commitRejected('company-commit/apply-failed', `挂单失败且已回滚（HEAD 未变）：${errText(err)}`)
  }
  if (commit === null) commitRejected('company-commit/apply-failed', '内部缺陷：提交分支未产出 commit 哈希')
  const verified = await verifyCommit(dir, commit, message, order, committed)
  if (!verified.ok) {
    // commit 已产生：不再回滚（回滚已完成提交＝改写历史），如实上报并交对账
    commitRejected('company-commit/commit-verify-failed', `commit ${commit.slice(0, 12)} 已产生但回读校验失败：${verified.detail}——须人工对账，不得宣称挂单成功`)
  }
  return {
    status: 'committed',
    orderId: order.orderId,
    commit,
    message,
    digest,
    paths: committed,
    recordRefs: order.recordRefs,
    previousHead: expectedHead,
    baseline: audit.ownedCommits === 0 ? expectedHead : null,
    verified: true,
  }
}

/** 同单号重放：摘要一致＝返回既有结果（零新副作用）；不一致＝拒（同号不同内容＝伪造/漂移） */
async function replayEvidence(
  dir: string,
  order: OrgChangeOrder,
  commit: string,
  previousDigest: string | null,
  digest: string,
  paths: readonly string[],
  audit: SoleWriterAudit,
): Promise<CommitEvidence> {
  if (previousDigest !== `sha256:${digest}`) {
    commitInvalid(
      'company-commit/order-id-reused',
      `单号 ${order.orderId} 已有挂单 commit ${commit.slice(0, 12)}，但内容摘要不同（既有 ${previousDigest ?? '无摘要'}，本次 sha256:${digest}）——同号不同内容拒重放`,
    )
  }
  const actualMessage = await messageOfCommit(dir, commit)
  const trailers = parseCommitMessage(actualMessage)
  if (trailers.orderId !== order.orderId) {
    commitInvalid('company-commit/order-id-reused', `既有挂单 commit ${commit.slice(0, 12)} 的 trailer 单号与检索结果不一致（实得 ${trailers.orderId ?? '无'}）——历史被破坏，拒重放`)
  }
  if (!sameSet(trailers.records, order.recordRefs)) {
    commitInvalid(
      'company-commit/order-id-reused',
      `单号 ${order.orderId} 既有挂单 commit ${commit.slice(0, 12)} 的记录引用与本次不同（既有 ${trailers.records.join('、') || '无'}；本次 ${order.recordRefs.join('、')}）——同号不同记录引用＝证据链漂移，拒重放`,
    )
  }
  const replayedPaths = await changedPathsOfCommit(dir, commit)
  const outsideOrder = replayedPaths.filter((entry) => !paths.includes(entry))
  if (outsideOrder.length > 0) {
    commitInvalid('company-commit/order-id-reused', `既有挂单 commit ${commit.slice(0, 12)} 改了订单外路径（${outsideOrder.join('、')}）——单号冲突，拒重放`)
  }
  return {
    status: 'replayed',
    orderId: order.orderId,
    commit,
    // 重放证据里的 message 是**既有 commit 的原文**（不是本次重算的文本——证据须指向已发生的事实）
    message: actualMessage,
    digest,
    paths: replayedPaths,
    recordRefs: order.recordRefs,
    previousHead: audit.head,
    baseline: null,
    verified: true,
  }
}

/** 回读校验（commit 已产生后的诚实校验面）：message 单号/摘要/记录引用 + 改动路径集合 */
async function verifyCommit(
  dir: string,
  commit: string,
  message: string,
  order: OrgChangeOrder,
  expectedPaths: readonly string[],
): Promise<{ readonly ok: boolean; readonly detail: string }> {
  const notes: string[] = []
  const actualMessage = await messageOfCommit(dir, commit)
  if (normalizeMessage(actualMessage) !== normalizeMessage(message)) {
    notes.push('commit message 与写入面不一致（可能被钩子/配置改写）')
  }
  const trailers = parseCommitMessage(actualMessage)
  if (trailers.orderId !== order.orderId) notes.push(`trailer 单号缺失/不符（期望 ${order.orderId}，实得 ${trailers.orderId ?? '无'}）`)
  if (trailers.digest !== `sha256:${orderDigest(order)}`) notes.push(`trailer 摘要缺失/不符（实得 ${trailers.digest ?? '无'}）`)
  const missingRefs = order.recordRefs.filter((ref) => !trailers.records.includes(ref))
  if (missingRefs.length > 0) notes.push(`trailer 记录引用缺失：${missingRefs.join('、')}`)
  const actualPaths = await changedPathsOfCommit(dir, commit)
  if (!sameSet(actualPaths, expectedPaths)) {
    notes.push(`改动路径不符（期望 ${expectedPaths.join('、') || '无'}；实得 ${actualPaths.join('、') || '无'}）`)
  }
  return { ok: notes.length === 0, detail: notes.join('；') }
}

// ───────────────────────── 回滚 ─────────────────────────

/** 撤暂存 → 快照复原 → 残留断言（任何一步失败都如实并入 detail，不宣称已回滚） */
async function rollbackOrder(
  dir: string,
  snapshots: readonly PathSnapshot[],
  paths: readonly string[],
): Promise<{ readonly ok: boolean; readonly detail: string }> {
  const notes: string[] = []
  try {
    await unstagePaths(dir, paths)
  } catch (err) {
    notes.push(`撤暂存失败：${errText(err)}`)
  }
  try {
    await restoreSnapshots(dir, snapshots)
  } catch (err) {
    notes.push(`快照复原失败：${errText(err)}`)
  }
  try {
    const residual = (await statusEntries(dir)).filter((entry) => paths.includes(entry.path))
    if (residual.length > 0) notes.push(`残留改动：${describeStatus(residual)}`)
  } catch (err) {
    notes.push(`残留断言失败：${errText(err)}`)
  }
  return { ok: notes.length === 0, detail: notes.length === 0 ? '零残留' : notes.join('；') }
}

// ───────────────────────── 小件 ─────────────────────────

async function resolveCompanyDir(input: string): Promise<string> {
  const resolved = path.resolve(input)
  const info = await stat(resolved).catch(() => null)
  if (info === null || !info.isDirectory()) commitInvalid('company-commit/not-directory', `公司目录不存在或不是目录：${resolved}`)
  return realpath(resolved)
}

function describeStatus(entries: readonly GitStatusEntry[]): string {
  return entries.map((entry) => `${entry.status.trim() || '??'} ${entry.path}`).join('、')
}

/** message 归一（git commit 的 cleanup 面：行尾空白/首尾空行不参与相等判定） */
function normalizeMessage(message: string): string {
  return message
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((entry, index) => entry === b[index])
}

// 进程内串行（同公司目录同时只允许一个挂单在飞行中；跨进程围栏未证）
const DIR_LOCKS = new Map<string, Promise<void>>()

async function withDirLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const previous = DIR_LOCKS.get(dir) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  DIR_LOCKS.set(
    dir,
    previous.then(
      () => current,
      () => current,
    ),
  )
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
  }
}
