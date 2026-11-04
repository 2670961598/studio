/**
 * 报表产出挂单 commit 面单测（studio-dev-705；docs/17-§2 / docs/43-§十一）
 *
 * 覆盖：reports/ 脏路径收敛为一次 commit（其它脏路径不纳入）、幂等 clean、索引非空 blocked、
 * 删除收敛、非 git 目录/无目录安全返回（error/disabled，不抛）；真实 git 临时仓驱动。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReportsCommitFace } from '../../../src/assembly/serve/reports-commit.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-reports-commit-'))
  dirs.push(dir)
  return dir
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function makeRepo(): string {
  const dir = tempDir()
  git(dir, ['init', '--quiet'])
  git(dir, ['config', 'user.email', 'daemon@localhost'])
  git(dir, ['config', 'user.name', 'StudioNext daemon'])
  writeFileSync(path.join(dir, '.gitignore'), '*.DS_Store\n', 'utf8')
  mkdirSync(path.join(dir, 'reports', '研发部'), { recursive: true })
  writeFileSync(path.join(dir, 'org-config.yaml'), 'company: acme\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '--quiet', '-m', 'baseline'])
  return dir
}

function logs(): { lines: string[] } {
  const lines: string[] = []
  return { lines }
}

describe('报表产出挂单 commit（reports/ 前缀收敛）', () => {
  it('reports/ 脏路径 → 一次 commit；其它脏路径不纳入；再次调用 clean', async () => {
    const dir = makeRepo()
    const sink = logs()
    const face = createReportsCommitFace({ companyDir: dir, log: (line) => sink.lines.push(line), now: () => 1_790_000_000_000 })
    writeFileSync(path.join(dir, 'reports', '研发部', '2026-11-04-report-a.md'), 'A\n', 'utf8')
    writeFileSync(path.join(dir, 'reports', '研发部', '2026-11-04-report-a.md.summary.json'), '{}\n', 'utf8')
    const first = await face.commitPending()
    expect(first.status).toBe('committed')
    expect(first.staged).toBe(2)
    // 新报表 + org-config 脏改动：只收 reports（otherDirty 观测不纳入）
    writeFileSync(path.join(dir, 'reports', '研发部', '2026-11-04-report-b.md'), 'B\n', 'utf8')
    writeFileSync(path.join(dir, 'org-config.yaml'), 'company: acme\nchanged: true\n', 'utf8')
    const result = await face.commitPending()
    expect(result.status).toBe('committed')
    expect(result.staged).toBe(1)
    expect(result.otherDirty).toBe(1)
    expect(String(result.commit)).toMatch(/^[0-9a-f]{40}$/)
    expect(git(dir, ['log', '-1', '--format=%s'])).toContain('reports: 收敛报表产出')
    expect(git(dir, ['status', '--porcelain', '--', 'reports'])).toBe('')
    expect(git(dir, ['status', '--porcelain', '--', 'org-config.yaml'])).toContain('org-config.yaml')
    // 幂等：无 reports 脏路径 → clean（otherDirty 仍 1）
    const again = await face.commitPending()
    expect(again.status).toBe('clean')
    expect(again.otherDirty).toBe(1)
  })

  it('索引已有暂存 → blocked（不把他人半成品带入）；commit 数不增', async () => {
    const dir = makeRepo()
    const sink = logs()
    const before = git(dir, ['rev-list', '--count', 'HEAD'])
    writeFileSync(path.join(dir, 'reports', '研发部', 'x.md'), 'x\n', 'utf8')
    writeFileSync(path.join(dir, 'other.txt'), 'o\n', 'utf8')
    git(dir, ['add', 'other.txt'])
    const face = createReportsCommitFace({ companyDir: dir, log: (line) => sink.lines.push(line) })
    const result = await face.commitPending()
    expect(result.status).toBe('blocked')
    expect(result.reason).toContain('index-not-empty')
    expect(git(dir, ['rev-list', '--count', 'HEAD'])).toBe(before)
    expect(git(dir, ['status', '--porcelain', '-uall', '--', 'reports'])).toContain('x.md')
  })

  it('删除收敛：reports 文件删除被 commit；无目录=disabled；非 git 目录=error（不抛）', async () => {
    const dir = makeRepo()
    const sink = logs()
    writeFileSync(path.join(dir, 'reports', '研发部', 'y.md'), 'y\n', 'utf8')
    const face = createReportsCommitFace({ companyDir: dir, log: (line) => sink.lines.push(line) })
    expect((await face.commitPending()).status).toBe('committed')
    rmSync(path.join(dir, 'reports', '研发部', 'y.md'))
    const del = await face.commitPending()
    expect(del.status).toBe('committed')
    expect(git(dir, ['status', '--porcelain', '--', 'reports'])).toBe('')
    const disabled = createReportsCommitFace({ log: () => {} })
    expect((await disabled.commitPending()).status).toBe('disabled')
    const notRepo = tempDir()
    const broken = createReportsCommitFace({ companyDir: notRepo, log: () => {} })
    expect((await broken.commitPending()).status).toBe('error')
  })
})
