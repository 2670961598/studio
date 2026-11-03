/**
 * repo-validate/input-render —— CLI 输入物化（路径/git-url/tarball）与人读/JSON 渲染
 *
 * 依据（实现单引用）：docs/51-§七 CLI 契约（输入形态/退出码语义/输出契约）；
 *   docs/17-§2/§6（相位与收割判据零变更——本件只做输入物化与渲染）；
 *   docs/20-§十五.三（600 行阈：repo-validate.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只搬输入物化与渲染纯步；判定入口（validateCompanyRepo）仍在 repo-validate.ts。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { ORG_CONFIG_FILE, TARBALL_RE, type RepoValidateResult } from './model.ts'

// ————————————————————————— 7. CLI 面：输入物化（路径 / git-url / tarball） —————————————————————————

/** 判定器自身错误（退出码 2 面：路径不存在/网络失败/解包失败——与「不合法」exit 1 严格区分） */
export class RepoInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoInputError'
  }
}

export type RepoInputKind = 'path' | 'git-url' | 'tarball'

export interface MaterializedRepoInput {
  kind: RepoInputKind
  /** 物化后的仓库目录（路径通道=原目录；git-url=克隆产物；tarball=解包产物） */
  dir: string
  cleanup: () => Promise<void>
}

function looksLikeGitUrl(input: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input)) return true // https:// / file:// / ssh://
  if (input.startsWith('git@')) return true // git@host:path
  return /^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/.test(input) // scp 形态 host:path
}

/**
 * 输入物化：目录→直用；tarball（.tar/.tar.gz/.tgz/…）→系统 tar 解包（条目先消毒：拒绝对
 * 路径与 .. 段）；git-url→simple-git 克隆到暂存。失败抛 RepoInputError（CLI 层 exit 2）。
 */
export async function materializeCompanyRepoInput(input: string): Promise<MaterializedRepoInput> {
  const trimmed = input.trim()
  if (trimmed === '') throw new RepoInputError('输入为空（用法：studio-next company validate <git-url|路径|tarball> [--json] [--allow-extra]）')

  let st: Awaited<ReturnType<typeof stat>> | undefined
  try {
    st = await stat(trimmed)
  } catch {
    st = undefined
  }
  if (st?.isDirectory() === true) {
    return { kind: 'path', dir: path.resolve(trimmed), cleanup: async () => undefined }
  }
  if (st?.isFile() === true && TARBALL_RE.test(trimmed)) {
    return extractTarball(trimmed)
  }
  if (st !== undefined) {
    throw new RepoInputError(`输入是文件但不是 tarball 形态（.tar/.tar.gz/.tgz）：${trimmed}`)
  }
  if (looksLikeGitUrl(trimmed)) {
    const staging = await mkdtemp(path.join(tmpdir(), 'studio-next-validate-'))
    const cloneDir = path.join(staging, 'src')
    try {
      await simpleGit().clone(trimmed, cloneDir)
    } catch (err) {
      await rm(staging, { recursive: true, force: true })
      throw new RepoInputError(`git 克隆失败（网络/权限/仓库不存在）：${err instanceof Error ? err.message : String(err)}`)
    }
    return { kind: 'git-url', dir: cloneDir, cleanup: async () => rm(staging, { recursive: true, force: true }) }
  }
  throw new RepoInputError(`路径不存在且不是 git-url：${trimmed}`)
}

async function extractTarball(tarPath: string): Promise<MaterializedRepoInput> {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-next-tar-'))
  const fail = async (reason: string): Promise<never> => {
    await rm(dir, { recursive: true, force: true })
    throw new RepoInputError(reason)
  }
  const list = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' })
  if (list.status !== 0) return fail(`tarball 无法读取（${(list.stderr ?? '').trim() || `tar -tf 退出码 ${list.status}`}）`)
  for (const rawEntry of list.stdout.split('\n')) {
    const entry = rawEntry.trim()
    if (entry === '') continue
    const normalized = entry.replace(/^\.\//, '')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      return fail(`tarball 条目不安全（${entry}——绝对路径或 .. 逃逸段，拒解包）`)
    }
  }
  const extract = spawnSync('tar', ['-xf', tarPath, '-C', dir], { encoding: 'utf8' })
  if (extract.status !== 0) return fail(`tarball 解包失败（${(extract.stderr ?? '').trim() || `tar -xf 退出码 ${extract.status}`}）`)
  // 常见形态：单根目录包裹（foo-1.0/…）→ 下探；org-config 在根则直用
  if (!existsSync(path.join(dir, ORG_CONFIG_FILE))) {
    const top = await readdir(dir, { withFileTypes: true })
    const only = top.length === 1 ? top[0] : undefined
    if (only !== undefined && only.isDirectory() && existsSync(path.join(dir, only.name, ORG_CONFIG_FILE))) {
      return { kind: 'tarball', dir: path.join(dir, only.name), cleanup: async () => rm(dir, { recursive: true, force: true }) }
    }
  }
  return { kind: 'tarball', dir, cleanup: async () => rm(dir, { recursive: true, force: true }) }
}

// ————————————————————————— 8. 渲染面（人读 + JSON；apps/daemon bin 消费） —————————————————————————

/** 人读输出（PASS=摘要+可初始化；FAIL=逐条违规——不许只说校验失败） */
export function renderRepoValidation(result: RepoValidateResult, input?: string): string {
  const lines: string[] = []
  const head = input !== undefined ? `（输入：${input}）` : ''
  if (result.ok) {
    const s = result.summary
    lines.push(`PASS${head}`)
    if (s !== undefined) {
      lines.push(`  ${s.name}（slug=${s.slug}，${s.level} 级公司，platform=${s.platform}）`)
      lines.push(`  部门 ${s.departments} · 人数 ${s.people} · jobs ${s.jobs} · 插件 ${s.plugins}（仓内）`)
      lines.push(`  能力面：${s.capabilityMissing.length === 0 ? '齐备' : `缺失 ${s.capabilityMissing.map((m) => `${m.name}（需求 ${m.required.join('|')}，无仓内源）`).join('；')}`}`)
    }
    if (result.exempted.length > 0) lines.push(`  豁免（--allow-extra）：${result.exempted.join('、')}`)
    lines.push('可初始化（company add 前置=validate PASS——docs/51-§七）')
  } else {
    lines.push(`FAIL${head} ${result.violations.length} 条违规（docs/51 五契约；退出码 1）`)
    for (const v of result.violations) {
      const alias = v.alias !== undefined ? `（${v.alias}）` : ''
      lines.push(`  [${v.rule}]${alias} ${v.file} @ ${v.location}：${v.problem}；修法：${v.fix}`)
    }
    if (result.exempted.length > 0) lines.push(`  豁免（--allow-extra）：${result.exempted.join('、')}`)
  }
  for (const warn of result.warnings) {
    lines.push(`  警示 [${warn.rule}] ${warn.file} @ ${warn.location}：${warn.problem}`)
  }
  return lines.join('\n')
}

/** JSON 输出（--json；结构=RepoValidateResult 投影，违规逐条四元组+via/alias） */
export function repoValidationJson(result: RepoValidateResult, input?: string): string {
  return JSON.stringify(
    {
      ok: result.ok,
      face: result.face,
      ...(input !== undefined ? { input } : {}),
      violations: result.violations.map((v) => ({
        rule: v.rule,
        file: v.file,
        location: v.location,
        problem: v.problem,
        fix: v.fix,
        ...(v.via !== undefined ? { via: v.via } : {}),
        ...(v.alias !== undefined ? { alias: v.alias } : {}),
      })),
      warnings: result.warnings,
      exempted: result.exempted,
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
    },
    null,
    2,
  )
}
