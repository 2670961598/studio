/**
 * company-commit · git 原语（MIG-05 / IMPL-05-06；argv 直跑，无 shell、无网络）
 *
 * 依据：docs/v2/05 §三 DOM-01（公司 git 目录＝组织面权威；挂单 commit 是唯一写入路径）、
 *       docs/v2/16 §二（git 走 CLI 不碰仓内部格式——本模块不写 `.git/` 任何文件，
 *       只经 `git add/commit/log/status` 标准原语）。
 *
 * 纪律：
 *   - **argv 数组直跑**（`execFile`，无 shell）：路径/单号永不经字符串拼接进 shell；
 *   - 只读面（log/status/rev-parse）失败不静默：读不到就当作「前置缺失」拒写，
 *     不把「读失败」当「无旁路」（宁拒勿默许）；
 *   - 提交签名：`-c commit.gpgsign=false`（daemon 机器提交不依赖宿主 GPG 配置；
 *     不注入框架作者身份——署名用 git 默认配置，与 init/import 同口径）；
 *   - **不用 `--no-verify`**：宿主预提交钩子（围栏/校验）有权否决挂单——否决即回滚。
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { commitInvalid, commitRejected } from './errors.ts'
import type { GitCommit, GitStatusEntry } from './types.ts'

interface GitRun {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** git 输出采集上限（16MB——公司目录历史/状态输出量级内，超限＝病态面如实红） */
const GIT_MAX_BUFFER = 16 * 1024 * 1024

/** 单条命令执行（零 shell；cwd=公司目录） */
function execGit(cwd: string, args: readonly string[]): Promise<GitRun> {
  return new Promise<GitRun>((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        // 不刷新可选索引锁（只读命令不扰动工作树；add/commit 自带必要锁）
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        const rawCode = error === null ? null : (error as { code?: unknown }).code
        const code = rawCode === null ? (error === null ? 0 : 1) : typeof rawCode === 'number' ? rawCode : 1
        const errText = typeof stderr === 'string' ? stderr : ''
        const fallback = error !== null && errText.trim() === '' ? error.message : ''
        resolve({ code, stdout: typeof stdout === 'string' ? stdout : '', stderr: errText !== '' ? errText : fallback })
      },
    )
  })
}

/** 只读命令：非零即拒（读失败不得被读成「无旁路」） */
async function readGit(cwd: string, args: readonly string[], subcause: string): Promise<string> {
  const result = await execGit(cwd, args)
  if (result.code !== 0) commitRejected(subcause, `git ${args.join(' ')} 失败（code=${result.code}）：${result.stderr.trim()}`)
  return result.stdout
}

/** 工作树根（realpath；非工作树＝null） */
export async function gitWorkTreeRoot(dir: string): Promise<string | null> {
  const result = await execGit(dir, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) return null
  const top = result.stdout.trim()
  if (top === '') return null
  try {
    return await realpath(top)
  } catch {
    return path.resolve(top)
  }
}

/** HEAD 全哈希（无提交＝null；不把空仓当错误——由编排层决定是否拒） */
export async function headCommit(dir: string): Promise<string | null> {
  const result = await execGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (result.code !== 0) return null
  const head = result.stdout.trim()
  return head === '' ? null : head
}

/** 历史 commit（新→旧；无提交＝空数组） */
export async function readLog(dir: string): Promise<readonly GitCommit[]> {
  const result = await execGit(dir, ['log', '--no-color', '--format=%H%x1f%aI%x1f%an%x1f%B%x1e'])
  if (result.code !== 0) {
    // 空仓（unborn HEAD）＝零历史；其余失败＝读面失效，拒写（不静默）
    if (result.stderr.includes('does not have any commits yet') || result.stderr.includes('unknown revision')) return []
    commitRejected('company-commit/git-log-failed', `读 commit 历史失败：${result.stderr.trim()}`)
  }
  const commits: GitCommit[] = []
  for (const chunk of result.stdout.split('\u001e')) {
    const record = chunk.replace(/^\n+/, '')
    if (record === '') continue
    const fields = record.split('\u001f')
    if (fields.length < 4) continue
    const hash = fields[0] ?? ''
    const at = fields[1] ?? ''
    const author = fields[2] ?? ''
    const message = fields.slice(3).join('\u001f')
    if (hash === '') continue
    commits.push({ hash, at, author, message })
  }
  return commits
}

/** 指定 commit 的 message（回读校验用；读失败＝拒） */
export async function messageOfCommit(dir: string, hash: string): Promise<string> {
  return readGit(dir, ['log', '-1', '--no-color', '--format=%B', hash], 'company-commit/git-show-failed')
}

/** 指定 commit 改动的文件（去重排序；回读校验用） */
export async function changedPathsOfCommit(dir: string, hash: string): Promise<readonly string[]> {
  const out = await readGit(dir, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', hash], 'company-commit/git-show-failed')
  return out
    .split('\u0000')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .sort()
}

/**
 * 工作树噪声（Finder 垃圾）：既非组织面写、也不构成旁路证据。
 * 单点表——审计（bypass）与提交前脏树判定（index）共用，避免两处口径漂移。
 */
export const WORKTREE_NOISE = ['.DS_Store'] as const

/** 路径是否噪声（只看 basename） */
export function isWorktreeNoise(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath
  return (WORKTREE_NOISE as readonly string[]).includes(base)
}

/** 工作树状态条目（含未跟踪；`--no-renames` 免重命名双路径解析） */
export async function statusEntries(dir: string): Promise<readonly GitStatusEntry[]> {
  const out = await readGit(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], 'company-commit/git-status-failed')
  const entries: GitStatusEntry[] = []
  for (const chunk of out.split('\u0000')) {
    if (chunk.length < 4) continue
    const status = chunk.slice(0, 2)
    const entryPath = chunk.slice(3)
    if (entryPath === '') continue
    entries.push({ status, path: entryPath })
  }
  return entries
}

/** 已暂存路径（`git diff --cached --name-only`） */
export async function stagedPaths(dir: string): Promise<readonly string[]> {
  const out = await readGit(dir, ['diff', '--cached', '--name-only', '-z'], 'company-commit/git-diff-failed')
  return out
    .split('\u0000')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .sort()
}

/**
 * 暂存指定路径（`-A`：新增/修改/删除统一入索引）。
 * `-c core.autocrlf=false`：**写入字节即索引字节**（挂单证据要求目录形态可逐字节复核，
 * 不被宿主换行转换规则悄悄改写；`.gitattributes` 的 eol 规则仍优先）。
 */
export async function stagePaths(dir: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const result = await execGit(dir, ['-c', 'core.autocrlf=false', 'add', '-A', '--', ...paths])
  if (result.code !== 0) commitRejected('company-commit/git-add-failed', `git add 失败（code=${result.code}）：${result.stderr.trim()}`)
}

/** 取消暂存（回滚面；尽力而为——失败由回滚后状态校验如实上报） */
export async function unstagePaths(dir: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  await execGit(dir, ['reset', '--quiet', '--', ...paths])
}

/** 建 commit（返回 HEAD 全哈希；钩子/配置否决＝抛出，由编排层回滚） */
export async function createCommit(dir: string, message: string): Promise<string> {
  const result = await execGit(dir, ['-c', 'commit.gpgsign=false', '-c', 'commit.verbose=false', 'commit', '--quiet', '-m', message])
  if (result.code !== 0) {
    commitRejected('company-commit/git-commit-failed', `git commit 被拒（code=${result.code}）：${result.stderr.trim()}`)
  }
  const head = await headCommit(dir)
  if (head === null) commitRejected('company-commit/git-commit-failed', 'git commit 退出 0 但 HEAD 仍为空——拒绝当作成功')
  return head
}

/**
 * 公司目录必须是**该 git 工作树的根**（防把上级仓库/别的仓库当公司目录提交）。
 * 返回 realpath；不合即 CONFIG_INVALID。
 */
export async function assertCompanyWorkTreeRoot(dir: string): Promise<string> {
  const root = await gitWorkTreeRoot(dir)
  if (root === null) commitInvalid('company-commit/not-a-worktree', `公司目录不是 git 工作树（先 company create/add 或 git init）：${dir}`)
  const actual = await realpath(dir)
  if (actual !== root) {
    commitInvalid('company-commit/worktree-root-mismatch', `公司目录须为工作树根（防误提交上级仓库）：dir=${actual}，toplevel=${root}`)
  }
  return actual
}
