/**
 * company-commit e2e 夹具 —— **真 git 临时仓库**（MIG-05 / IMPL-05-06，LANE-E）
 *
 * 依据：plan/05 IMPL-05-06（「临时 git 仓库（真 git init/commit/log）」冻结验收口径）；
 *       plan/04 §1.9.4（一次红即红：夹具不做重试、不吞退出码）；AGENTS §五.3（证据断言）。
 *
 * 纪律：
 *   - 只在 `os.tmpdir()` 下建仓（`mkdtemp`），**不写真实用户目录**；测试结束整根删除；
 *   - git 身份/配置**隔离**：HOME 指向临时根、`GIT_CONFIG_NOSYSTEM=1`，故宿主
 *     `~/.gitconfig`（签名/钩子/换行）不参与——仓库内再显式落 user/hooksPath/autocrlf；
 *   - 所有 git 调用是 argv 直跑（无 shell），失败即抛（不把非零退出当空输出）。
 *
 * 本文件不是测试件（无 `.test.ts` 后缀）：只提供夹具，不产生用例。
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ClassifiedError } from '@studio-next/contract'
import type { OrgChangeOp, OrgChangeOrder } from '../../../../src/engine/company-commit/index.ts'

/** 临时仓库句柄（root＝隔离 HOME；dir＝公司目录＝工作树根） */
export interface TestRepo {
  readonly root: string
  readonly dir: string
  readonly baseHead: string
}

/** git 执行结果（夹具内部按退出码判定，不静默） */
export interface GitRun {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** 基线组织面（org-config + 部门 + 章程/信任锚：路径闸的反面夹具） */
const BASE_ORG_CONFIG = [
  'company:',
  '  name: 测试公司',
  '  slug: test-corp',
  '  level: 2',
  'departments:',
  '  - name: 旧部',
  '    path: departments/old',
  'people: []',
  '',
].join('\n')

const BASE_DEPT_CONFIG = ['name: 旧部', 'leader: A0001', 'lanes: []', ''].join('\n')

/**
 * 唯一身份/配置面（防宿主污染）：HOME/XDG 隔离 + 无系统配置 + 固定作者。
 * 注意：本夹具只把 cwd 当作「某临时仓库工作树根」，HOME 取其父目录（root）。
 */
function envFor(dir: string): NodeJS.ProcessEnv {
  const root = path.dirname(dir)
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, '.xdg'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Runner',
    GIT_AUTHOR_EMAIL: 'test@studio-next.invalid',
    GIT_COMMITTER_NAME: 'Test Runner',
    GIT_COMMITTER_EMAIL: 'test@studio-next.invalid',
  }
}

/** argv 直跑 git（无 shell；cwd=公司目录） */
export async function gitRaw(repo: Pick<TestRepo, 'dir'>, args: readonly string[]): Promise<GitRun> {
  return new Promise<GitRun>((resolve) => {
    execFile('git', [...args], { cwd: repo.dir, env: envFor(repo.dir), maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const rawCode = error === null ? null : (error as { code?: unknown }).code
      const code = rawCode === null ? (error === null ? 0 : 1) : typeof rawCode === 'number' ? rawCode : 1
      resolve({ code, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' })
    })
  })
}

/** git 成功输出（trim；非零＝抛并把 stderr 带上——夹具失败要看得见原因） */
export async function gitOut(repo: Pick<TestRepo, 'dir'>, args: readonly string[]): Promise<string> {
  const result = await gitRaw(repo, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} 失败（code=${result.code}）：${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** 建临时公司仓库：真 init + 落基线文件 + 真首提；返回基线 HEAD */
export async function makeRepo(): Promise<TestRepo> {
  const root = await mkdtemp(path.join(tmpdir(), 'sn-company-commit-'))
  const dir = path.join(root, 'company')
  await mkdir(path.join(dir, 'departments', 'old'), { recursive: true })
  await mkdir(path.join(dir, '.studio-next'), { recursive: true })
  await writeFile(path.join(dir, 'org-config.yaml'), BASE_ORG_CONFIG, 'utf8')
  await writeFile(path.join(dir, 'departments', 'old', 'config.yaml'), BASE_DEPT_CONFIG, 'utf8')
  await writeFile(path.join(dir, 'charter.md'), '# 测试章程（软外围）\n', 'utf8')
  await writeFile(path.join(dir, 'README.md'), '# 测试公司\n', 'utf8')
  await writeFile(path.join(dir, '.studio-next', 'trust.json'), '{"trust":false}\n', 'utf8')
  // 部分写入失败夹具：中间段是**普通文件**（不是目录），第二条 upsert 无法建父目录
  await writeFile(path.join(dir, 'departments', 'blocker'), 'blocker\n', 'utf8')
  await gitOut({ dir }, ['init', '-b', 'main'])
  await gitOut({ dir }, ['config', 'user.name', 'Test Runner'])
  await gitOut({ dir }, ['config', 'user.email', 'test@studio-next.invalid'])
  await gitOut({ dir }, ['config', 'commit.gpgsign', 'false'])
  await gitOut({ dir }, ['config', 'core.autocrlf', 'false'])
  await gitOut({ dir }, ['config', 'core.hooksPath', path.join(dir, '.git', 'hooks')])
  await gitOut({ dir }, ['add', '-A'])
  await gitOut({ dir }, ['commit', '-m', 'init: 测试基线公司目录（夹具）'])
  return { root, dir, baseHead: await gitOut({ dir }, ['rev-parse', 'HEAD']) }
}

/** 清理仓库根（整根删除；失败不吞——用 force 只针对已不存在面） */
export async function cleanupRepo(repo: TestRepo): Promise<void> {
  await rm(repo.root, { recursive: true, force: true })
}

/** commit 数（`rev-list --count HEAD`） */
export async function commitCount(repo: TestRepo): Promise<number> {
  return Number.parseInt(await gitOut(repo, ['rev-list', '--count', 'HEAD']), 10)
}

/** HEAD 全哈希 */
export async function headOf(repo: TestRepo): Promise<string> {
  return gitOut(repo, ['rev-parse', 'HEAD'])
}

/**
 * 工作树状态（`--porcelain` 原文，只剥行尾换行——**保留状态列前的空格**：
 * ` M path`（工作树改动）与 `M  path`（已暂存）是不同事实，trim 掉会把两态混为一谈）。
 * 空串＝干净。
 */
export async function statusPorcelain(repo: TestRepo): Promise<string> {
  const out = await gitRaw(repo, ['status', '--porcelain', '--untracked-files=all'])
  if (out.code !== 0) throw new Error(`git status 失败（code=${out.code}）：${out.stderr.trim()}`)
  return out.stdout.replace(/\n+$/u, '')
}

/** 指定 commit 改动路径（排序） */
export async function commitPaths(repo: TestRepo, hash: string): Promise<readonly string[]> {
  const out = await gitRaw(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', hash])
  if (out.code !== 0) throw new Error(`diff-tree 失败：${out.stderr.trim()}`)
  return out.stdout
    .split('\u0000')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .sort()
}

/** commit message 原文（`%B`，不 trim——trailer 断言要逐行看） */
export async function messageOf(repo: TestRepo, hash: string): Promise<string> {
  return gitOut(repo, ['log', '-1', '--format=%B', hash])
}

/** `git show <hash>:<path>` 原文（字节保真断言用；不 trim） */
export async function fileOfCommit(repo: TestRepo, hash: string, relPath: string): Promise<string> {
  const out = await gitRaw(repo, ['show', `${hash}:${relPath}`])
  if (out.code !== 0) throw new Error(`git show 失败：${out.stderr.trim()}`)
  return out.stdout
}

/** 旁路写：直接改文件 + 直接 commit（**不经 company-commit**——无挂单 trailer） */
export async function bypassCommit(repo: TestRepo, relPath: string, content: string, message: string): Promise<string> {
  const absolute = path.join(repo.dir, relPath)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
  await gitOut(repo, ['add', '-A'])
  await gitOut(repo, ['commit', '-m', message])
  return gitOut(repo, ['rev-parse', 'HEAD'])
}

/** 覆盖默认值的订单工厂（显式字段逐个 ??，避免 undefined 传播进校验面） */
export interface OrderOverrides {
  readonly orderId?: string
  readonly summary?: string
  readonly decidedBy?: string
  readonly decidedAt?: string
  readonly recordRefs?: readonly string[]
  readonly ops?: readonly OrgChangeOp[]
}

/** 组织变更单夹具（单号固定，便于 `git log --grep` 断言） */
export function makeOrder(overrides: OrderOverrides = {}): OrgChangeOrder {
  return {
    orderId: overrides.orderId ?? 'ORG-2026-0007',
    summary: overrides.summary ?? '一级单元 N 由 1 调 2：设立平台单元（REC-LIFE-08）',
    decidedBy: overrides.decidedBy ?? '最高宰相（测试夹具）',
    decidedAt: overrides.decidedAt ?? '2026-11-01T09:30:00+08:00',
    recordRefs: overrides.recordRefs ?? ['REC-LIFE-08#org-event-0001', 'REC-LIFE-09#continuity-0002'],
    ops: overrides.ops ?? [
      { kind: 'upsert-file', path: 'org-config.yaml', content: BASE_ORG_CONFIG.replace('level: 2', 'level: 3') },
      { kind: 'upsert-file', path: 'departments/platform/config.yaml', content: 'name: 平台部\nleader: A0002\nlanes: []\n' },
      { kind: 'delete-file', path: 'departments/old/config.yaml' },
    ],
  }
}

/** 承诺被拒的断言助手：取回 rejection（不吞类型；category/subcause 逐项断言） */
export async function rejectionOf(work: Promise<unknown>): Promise<Error & Partial<ClassifiedError>> {
  try {
    await work
  } catch (err) {
    if (err instanceof Error) return err as Error & Partial<ClassifiedError>
    throw new Error(`非 Error 拒绝：${String(err)}`)
  }
  throw new Error('期望被拒，但调用成功了')
}
