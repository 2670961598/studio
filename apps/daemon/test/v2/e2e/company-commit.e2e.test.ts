/**
 * company-commit e2e —— MIG-05 / IMPL-05-06「挂单 commit·公司目录运行期唯一写者」（LANE-E）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-05-06 冻结验收：临时 git 仓库（**真 git init/commit/log**）——
 *     组织变更→单 commit；同单重放幂等不重复 commit；旁路写被拒；commit message 含单号/
 *     记录引用；失败回滚；`verify:v2` 绿。
 *   - docs/v2/05 §三 DOM-01（公司 git 目录唯一权威；唯一写入者＝daemon 挂单 commit）
 *     ＋§三通则 1（一域一条权威写入路径）。
 *   - docs/v2/06 §五.1（配置只表拟任：挂单只落已定变更的目录形态，不宣告任命生效）。
 *   - docs/v2/11 §〇.4-4（同对象同版本只允许一次成功迁移；重复提交返回既有结果、零第二
 *     副作用）、§〇.4-5（幂等键含公司标识）、§3.2 REC-LIFE-07..11 ／§2.2 REC-AUTH-01。
 *   - docs/v2/14 §二（PORT-REG 备注「DOM-01 挂单 commit 由 daemon」）＋§1.1「已提交≠已生效」。
 *
 * 断言纪律：全部走**真 git 仓库 + 真 git 命令**（夹具不做 mock、不重试）；仓库建在
 * `os.tmpdir()`，结束整根删除——不碰真实用户目录、不 git commit 本仓。
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { applyOrgChangeOrder, inspectSoleWriter } from '../../../src/engine/company-commit/index.ts'
import { cmdCompanyOrgCommit } from '../../../src/cli/company.ts'
import {
  bypassCommit,
  cleanupRepo,
  commitCount,
  commitPaths,
  fileOfCommit,
  gitOut,
  headOf,
  makeOrder,
  makeRepo,
  messageOf,
  rejectionOf,
  statusPorcelain,
} from './fixtures/company-commit-repo.ts'
import type { TestRepo } from './fixtures/company-commit-repo.ts'

const ORG_CONFIG = 'org-config.yaml'
const OLD_DEPT = 'departments/old/config.yaml'
const PLATFORM_DEPT = 'departments/platform/config.yaml'

/** 测试内临时仓库（afterAll 整根删除；失败也不留在磁盘） */
const repos: TestRepo[] = []
async function trackRepo(): Promise<TestRepo> {
  const repo = await makeRepo()
  repos.push(repo)
  return repo
}

afterAll(async () => {
  for (const repo of repos) await cleanupRepo(repo)
  repos.length = 0
})

function orgConfigPath(repo: TestRepo): string {
  return path.join(repo.dir, ORG_CONFIG)
}

describe('组织变更 → 单 commit（plan/05 IMPL-05-06 冻结口径）', () => {
  it('一次组织变更单＝一个 commit：log 恰 +1、改动集=订单路径、message 引单号与记录引用', async () => {
    const repo = await trackRepo()
    const before = await commitCount(repo)
    const newOrgConfig = 'company:\n  name: 测试公司\n  slug: test-corp\n  level: 3\npeople: []\n'
    const order = makeOrder({
      ops: [
        { kind: 'upsert-file', path: ORG_CONFIG, content: newOrgConfig },
        { kind: 'upsert-file', path: PLATFORM_DEPT, content: 'name: 平台部\nleader: A0002\nlanes: []\n' },
        { kind: 'delete-file', path: OLD_DEPT },
      ],
    })

    const evidence = await applyOrgChangeOrder(repo.dir, order)
    expect(evidence.status).toBe('committed')
    expect(evidence.commit).not.toBeNull()
    const commit = evidence.commit ?? ''
    expect(evidence.verified).toBe(true)
    expect(evidence.previousHead).toBe(repo.baseHead)
    expect(evidence.baseline).toBe(repo.baseHead) // 首单采纳既有 HEAD 为基线
    expect(evidence.digest).toMatch(/^[0-9a-f]{64}$/)

    // 一个 commit（不是两个、不是零个）
    expect(await commitCount(repo)).toBe(before + 1)
    expect(await headOf(repo)).toBe(commit)

    // 改动集＝订单路径（含删除），且证据与 git 事实一致
    const expectedPaths = [OLD_DEPT, PLATFORM_DEPT, ORG_CONFIG].sort()
    expect(await commitPaths(repo, commit)).toEqual(expectedPaths)
    expect([...evidence.paths].sort()).toEqual(expectedPaths)

    // message：单号 + 记录引用 + 摘要 + 权威域 + 写者署名（git log 逐单可查）
    const message = await messageOf(repo, commit)
    expect(message).toContain(`org-change(${order.orderId}): ${order.summary}`)
    expect(message).toContain(`StudioNext-Order-Id: ${order.orderId}`)
    expect(message).toMatch(/StudioNext-Order-Digest: sha256:[0-9a-f]{64}/)
    expect(message).toContain('StudioNext-Authority: DOM-01')
    expect(message).toContain('StudioNext-Writer: studio-next-daemon')
    for (const ref of order.recordRefs) expect(message).toContain(ref)
    // git log 逐单检索：单号恰命中这一个 commit；全历史挂单 commit 恰一个
    expect(await gitOut(repo, ['log', '--format=%H', '--fixed-strings', `--grep=${order.orderId}`])).toBe(commit)
    expect((await gitOut(repo, ['log', '--format=%H', '--fixed-strings', '--grep=StudioNext-Order-Id'])).split('\n')).toHaveLength(1)

    // 目录形态：写入内容逐字节入库（`git show` 原文比对），删除生效，工作树干净
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(newOrgConfig)
    expect(await fileOfCommit(repo, commit, ORG_CONFIG)).toBe(newOrgConfig)
    expect(existsSync(path.join(repo.dir, PLATFORM_DEPT))).toBe(true)
    expect(existsSync(path.join(repo.dir, OLD_DEPT))).toBe(false)
    expect(await statusPorcelain(repo)).toBe('')
  })

  it('订单外/禁写面/越界路径一律拒：零 commit、零落盘、信任锚不可被组织单改写', async () => {
    const repo = await trackRepo()
    const before = await commitCount(repo)
    const baseOrg = await readFile(orgConfigPath(repo), 'utf8')
    const baseTrust = await readFile(path.join(repo.dir, '.studio-next', 'trust.json'), 'utf8')
    const absoluteEscape = path.join(repo.root, 'abs-escape.yaml')
    const cases: ReadonlyArray<readonly [ReturnType<typeof makeOrder>, string]> = [
      [makeOrder({ ops: [{ kind: 'upsert-file', path: absoluteEscape, content: 'x\n' }] }), 'company-commit/order-path'],
      [makeOrder({ ops: [{ kind: 'upsert-file', path: '../outside.yaml', content: 'x\n' }] }), 'company-commit/order-path'],
      [makeOrder({ ops: [{ kind: 'upsert-file', path: '.studio-next/trust.json', content: '{"trust":true}\n' }] }), 'company-commit/order-forbidden-path'],
      [makeOrder({ ops: [{ kind: 'upsert-file', path: 'charter.md', content: '# 改章程\n' }] }), 'company-commit/order-path-outside-face'],
    ]
    for (const [order, subcause] of cases) {
      const err = await rejectionOf(applyOrgChangeOrder(repo.dir, order))
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe(subcause)
    }
    expect(await commitCount(repo)).toBe(before)
    expect(existsSync(absoluteEscape)).toBe(false)
    expect(existsSync(path.join(repo.root, 'outside.yaml'))).toBe(false)
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(baseOrg)
    expect(await readFile(path.join(repo.dir, '.studio-next', 'trust.json'), 'utf8')).toBe(baseTrust)
    expect(await statusPorcelain(repo)).toBe('')
  })

  it('符号链接穿越被拒：公司目录外目标文件不产生，零 commit', async () => {
    const repo = await trackRepo()
    const outside = path.join(repo.root, 'outside-target')
    await mkdir(outside, { recursive: true })
    await symlink(outside, path.join(repo.dir, 'departments', 'link'), 'dir')
    const order = makeOrder({ ops: [{ kind: 'upsert-file', path: 'departments/link/config.yaml', content: 'name: 越界\n' }] })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, order))
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe('company-commit/symlink-path')
    expect(existsSync(path.join(outside, 'config.yaml'))).toBe(false)
    expect(await commitCount(repo)).toBe(1)
  })

  it('公司目录不是工作树根/不是仓库：拒（不误提交上级仓库）', async () => {
    const repo = await trackRepo()
    const nested = await rejectionOf(applyOrgChangeOrder(path.join(repo.dir, 'departments'), makeOrder()))
    expect(nested.subcause).toBe('company-commit/worktree-root-mismatch')
    // 只读审计面同口径：嵌套目录不得被报成「唯一写入者 OK」
    const nestedAudit = await inspectSoleWriter(path.join(repo.dir, 'departments'))
    expect(nestedAudit.soleWriter).toBe(false)
    expect(nestedAudit.findings.some((finding) => finding.kind === 'not-a-worktree')).toBe(true)

    const plainRoot = await mkdtemp(path.join(tmpdir(), 'sn-company-commit-plain-'))
    const plain = path.join(plainRoot, 'plain')
    await mkdir(plain, { recursive: true })
    try {
      const notRepo = await rejectionOf(applyOrgChangeOrder(plain, makeOrder()))
      expect(notRepo.category).toBe('CONFIG_INVALID')
      expect(notRepo.subcause).toBe('company-commit/not-a-worktree')
    } finally {
      await rm(plainRoot, { recursive: true, force: true })
    }
    expect(await commitCount(repo)).toBe(1)
  })
})

describe('同单重放幂等（docs/v2/11 §〇.4-4：返回既有结果、零第二副作用）', () => {
  it('同单同内容重放：返回既有 commit，零新 commit、零新副作用', async () => {
    const repo = await trackRepo()
    const first = await applyOrgChangeOrder(repo.dir, makeOrder())
    const countAfterFirst = await commitCount(repo)
    expect(countAfterFirst).toBe(2)

    const second = await applyOrgChangeOrder(repo.dir, makeOrder())
    expect(second.status).toBe('replayed')
    expect(second.commit).toBe(first.commit)
    expect(await commitCount(repo)).toBe(countAfterFirst)
    expect(await headOf(repo)).toBe(first.commit)

    // 经 JSON 序列化（CLI 通道同形输入）重放：仍返回既有 commit
    const viaJson: unknown = JSON.parse(JSON.stringify(makeOrder()))
    const third = await applyOrgChangeOrder(repo.dir, viaJson)
    expect(third.status).toBe('replayed')
    expect(third.commit).toBe(first.commit)
    expect(await commitCount(repo)).toBe(countAfterFirst)
  })

  it('同单号不同内容：拒重放（order-id-reused），既有 commit 与工作树都不被改写', async () => {
    const repo = await trackRepo()
    const first = await applyOrgChangeOrder(repo.dir, makeOrder())
    const committedOrg = await readFile(orgConfigPath(repo), 'utf8')
    const variant = makeOrder({ ops: [{ kind: 'upsert-file', path: ORG_CONFIG, content: 'company:\n  name: 同号不同内容\n' }] })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, variant))
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe('company-commit/order-id-reused')
    expect(await commitCount(repo)).toBe(2)
    expect(await headOf(repo)).toBe(first.commit)
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(committedOrg)
    expect(await statusPorcelain(repo)).toBe('')
  })

  it('同单同内容但记录引用不同：拒重放（证据链漂移，trailer 记录不一致）', async () => {
    const repo = await trackRepo()
    const first = await applyOrgChangeOrder(repo.dir, makeOrder())
    const drifted = makeOrder({ recordRefs: ['REC-LIFE-08#org-event-9999'] })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, drifted))
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe('company-commit/order-id-reused')
    expect(await commitCount(repo)).toBe(2)
    expect(await headOf(repo)).toBe(first.commit)
  })

  it('并发同单（进程内串行）：恰一个 commit，另一路返回既有结果', async () => {
    const repo = await trackRepo()
    const order = makeOrder()
    const [left, right] = await Promise.all([applyOrgChangeOrder(repo.dir, order), applyOrgChangeOrder(repo.dir, order)])
    expect([left.status, right.status].sort()).toEqual(['committed', 'replayed'])
    expect(left.commit).toBe(right.commit)
    expect(await commitCount(repo)).toBe(2)
  })
})

describe('旁路写被拒（daemon 唯一写入者断言）', () => {
  it('旁路 commit（无挂单 trailer）：审计发现＋挂单被拒，零新 commit', async () => {
    const repo = await trackRepo()
    await applyOrgChangeOrder(repo.dir, makeOrder({ orderId: 'ORG-2026-0001' }))
    const bypassHash = await bypassCommit(repo, ORG_CONFIG, 'company:\n  name: 旁路改\n', 'bypass: 直接改公司目录（非 daemon 挂单）')
    const countAfterBypass = await commitCount(repo)

    const audit = await inspectSoleWriter(repo.dir)
    expect(audit.soleWriter).toBe(false)
    expect(audit.findings.some((finding) => finding.kind === 'unattributed-commit' && finding.commit === bypassHash)).toBe(true)

    const next = makeOrder({ orderId: 'ORG-2026-0002', ops: [{ kind: 'upsert-file', path: ORG_CONFIG, content: 'company:\n  name: 第二单\n' }] })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, next))
    expect(err.category).toBe('EXTERNAL_REJECT')
    expect(err.subcause).toBe('company-commit/sole-writer-violation')
    expect(err.message).toContain(bypassHash.slice(0, 12))
    expect(await commitCount(repo)).toBe(countAfterBypass)
    expect(await headOf(repo)).toBe(bypassHash)
    // 拒写发生在任何落盘之前：旁路内容未被第二单覆盖
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe('company:\n  name: 旁路改\n')
  })

  it('旁路未提交写（脏工作树）：挂单被拒且不覆盖旁路改动', async () => {
    const repo = await trackRepo()
    const dirty = 'company:\n  name: 未挂单手改\n'
    await writeFile(orgConfigPath(repo), dirty, 'utf8')
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, makeOrder()))
    expect(err.category).toBe('EXTERNAL_REJECT')
    expect(err.subcause).toBe('company-commit/sole-writer-violation')
    expect(await commitCount(repo)).toBe(1)
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(dirty)
    expect(await statusPorcelain(repo)).toBe(' M org-config.yaml')
  })
})

describe('失败回滚（不留半 commit）', () => {
  it('提交被 pre-commit 钩子否决：HEAD 不变、文件逐字节复原、工作树零残留', async () => {
    const repo = await trackRepo()
    const hook = path.join(repo.dir, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, '#!/bin/sh\nexit 1\n', 'utf8')
    await chmod(hook, 0o755)
    const baseOrg = await readFile(orgConfigPath(repo), 'utf8')
    const order = makeOrder({
      orderId: 'ORG-2026-0100',
      ops: [
        { kind: 'upsert-file', path: ORG_CONFIG, content: 'company:\n  name: 钩子拒绝\n' },
        { kind: 'upsert-file', path: PLATFORM_DEPT, content: 'name: 平台部\n' },
      ],
    })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, order))
    expect(err.category).toBe('EXTERNAL_REJECT')
    expect(err.subcause).toBe('company-commit/git-commit-failed')

    expect(await commitCount(repo)).toBe(1)
    expect(await headOf(repo)).toBe(repo.baseHead)
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(baseOrg)
    expect(existsSync(path.join(repo.dir, PLATFORM_DEPT))).toBe(false)
    expect(existsSync(path.join(repo.dir, 'departments', 'platform'))).toBe(false) // 本单新建空目录已清理
    expect(await statusPorcelain(repo)).toBe('')
    expect(await gitOut(repo, ['log', '--format=%H', '--fixed-strings', '--grep=ORG-2026-0100'])).toBe('')
  })

  it('部分写入失败（中间段是普通文件）：先写入者一并复原、零 commit', async () => {
    const repo = await trackRepo()
    const baseOrg = await readFile(orgConfigPath(repo), 'utf8')
    const order = makeOrder({
      orderId: 'ORG-2026-0101',
      ops: [
        { kind: 'upsert-file', path: ORG_CONFIG, content: 'company:\n  name: 部分失败\n' },
        { kind: 'upsert-file', path: 'departments/blocker/config.yaml', content: 'name: 不可建\n' },
      ],
    })
    const err = await rejectionOf(applyOrgChangeOrder(repo.dir, order))
    expect(err.category).toBe('EXTERNAL_REJECT')
    expect(err.subcause).toBe('company-commit/apply-failed')
    expect(await commitCount(repo)).toBe(1)
    expect(await headOf(repo)).toBe(repo.baseHead)
    expect(await readFile(orgConfigPath(repo), 'utf8')).toBe(baseOrg)
    expect(existsSync(path.join(repo.dir, 'departments', 'blocker', 'config.yaml'))).toBe(false)
    expect(existsSync(path.join(repo.dir, 'departments', 'blocker'))).toBe(true) // 原有普通文件不动
    expect(await statusPorcelain(repo)).toBe('')
  })
})

describe('挂点与静态边界', () => {
  it('CLI 函数入口 cmdCompanyOrgCommit：JSON 证据 exit 0；--audit 旁路 exit 1；坏单 exit 1', async () => {
    const repo = await trackRepo()
    const ordersDir = path.join(repo.root, 'orders')
    await mkdir(ordersDir, { recursive: true })
    const orderFile = path.join(ordersDir, 'org-change.json')
    const order = makeOrder({ orderId: 'ORG-2026-0200' })
    await writeFile(orderFile, JSON.stringify(order, null, 2), 'utf8')
    const logged: string[] = []
    const errored: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: Parameters<typeof console.log>) => {
      logged.push(args.map((entry) => String(entry)).join(' '))
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: Parameters<typeof console.error>) => {
      errored.push(args.map((entry) => String(entry)).join(' '))
    })
    try {
      expect(await cmdCompanyOrgCommit([repo.dir, '--order', orderFile, '--json'])).toBe(0)
      const committed = JSON.parse(logged.join('\n')) as { ok: boolean; evidence: { status: string; commit: string; orderId: string } }
      expect(committed.ok).toBe(true)
      expect(committed.evidence.status).toBe('committed')
      expect(committed.evidence.orderId).toBe(order.orderId)
      expect(await commitCount(repo)).toBe(2)

      logged.length = 0
      expect(await cmdCompanyOrgCommit([repo.dir, '--audit', '--json'])).toBe(0)
      const clean = JSON.parse(logged.join('\n')) as { ok: boolean; audit: { soleWriter: boolean; ownedCommits: number } }
      expect(clean.ok).toBe(true)
      expect(clean.audit.ownedCommits).toBe(1)

      await bypassCommit(repo, ORG_CONFIG, 'company:\n  name: 旁路\n', 'bypass: 巡检面')
      logged.length = 0
      expect(await cmdCompanyOrgCommit([repo.dir, '--audit', '--json'])).toBe(1)
      const dirty = JSON.parse(logged.join('\n')) as { ok: boolean; audit: { soleWriter: boolean } }
      expect(dirty.ok).toBe(false)
      expect(dirty.audit.soleWriter).toBe(false)

      const badOrderFile = path.join(ordersDir, 'bad.json')
      await writeFile(badOrderFile, JSON.stringify({ orderId: 'BAD ID', summary: 'x' }), 'utf8')
      const beforeBad = await commitCount(repo)
      expect(await cmdCompanyOrgCommit([repo.dir, '--order', badOrderFile])).toBe(1)
      expect(errored.join('\n')).toContain('CONFIG_INVALID/company-commit/order-id')
      expect(await commitCount(repo)).toBe(beforeBad)
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('源件 import 面封闭：不引 store/gateway/平台/面板/适配器（只写公司目录的静态背书）', async () => {
    const moduleDir = fileURLToPath(new URL('../../../src/engine/company-commit/', import.meta.url))
    const allowed = new Set(['node:child_process', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:path', '@studio-next/contract'])
    const files = (await readdir(moduleDir)).filter((entry) => entry.endsWith('.ts')).sort()
    expect(files.length).toBeGreaterThanOrEqual(6)
    const sources: string[] = []
    for (const file of files) {
      const source = await readFile(path.join(moduleDir, file), 'utf8')
      sources.push(source)
      for (const spec of importSpecsOf(source)) {
        if (spec.startsWith('./')) {
          expect(spec.endsWith('.ts')).toBe(true) // 相对 import 带 .ts（Node 原生执行纪律）
          continue
        }
        expect(allowed.has(spec)).toBe(true)
      }
    }
    const joined = sources.join('\n')
    for (const forbidden of [
      '@studio-next/store',
      '@studio-next/gateway',
      '@studio-next/localplatform',
      '@studio-next/panel',
      '@studio-next/api',
      '@studio-next/adapters',
      '@studio-next/yt',
      '@studio-next/taiga',
      'node:sqlite',
      'simple-git',
    ]) {
      expect(joined.includes(forbidden)).toBe(false)
    }
  })
})

/** 顶层 import/export 说明符（只认行首语句——注释里的示例不算依赖） */
function importSpecsOf(source: string): readonly string[] {
  const specs: string[] = []
  for (const pattern of [/^(?:import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^import\s*['"]([^'"]+)['"]/gm]) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1]
      if (spec !== undefined && !specs.includes(spec)) specs.push(spec)
    }
  }
  return specs
}
