/**
 * verify-docs.test.ts —— V0 自检脚本件伴测（MIG-08 / IMPL-08-02）
 *
 * 依据：plan/05 IMPL-08-02（验收＝`bun run verify:docs` exit 0（真悬空=0）
 *       ＋ `bun run test:v2 -- packages/contract` 绿；伴测 1 件）、plan/04 §1.1
 *       （V0 六项检查 CI 前置化，独立文档门）、v2/17 §二（六项检查口径）。
 *
 * 本文件只证**脚本事后件**（不复制脚本的检查逻辑、不冒充业务覆盖）：
 *   1. 脚本存在、带 node shebang、具可执行位；
 *   2. 正例：docs/v2＋docs/plan 全库副本 → exit 0，六项检查各有一条 OK 输出，真悬空=0；
 *   3. 负例：临时夹具注入「v2/10 §二.99」悬空引用 → exit 1，stderr 指名该引用；
 *      真实 docs 源卷逐字不变（脚本只读；「不改 v2/plan 文档内容」）。
 *
 * 正例用 os.tmpdir() 全量副本；负例在同法副本上追加一行；测试后即删。不写仓内任何文件。
 * 注：不 import 脚本内部函数——伴测只对脚本可执行件与 exit 码负责，内部实现可替换。
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT = join(REPO_ROOT, 'scripts/verify/v0-doc-check.mjs')
const DOCS_V2 = join(REPO_ROOT, 'docs/v2')
const DOCS_PLAN = join(REPO_ROOT, 'docs/plan')

interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** 子进程跑真脚本（验收命令同体：`node scripts/verify/v0-doc-check.mjs`）。 */
function runCheck(root: string): RunResult {
  const proc = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 120_000 })
  return { status: proc.status ?? -1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' }
}

/** 全量文档副本夹具（docs/v2＋docs/plan）；调用方负责 rmSync。 */
function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-v0-doc-'))
  try {
    cpSync(DOCS_V2, join(root, 'docs/v2'), { recursive: true })
    cpSync(DOCS_PLAN, join(root, 'docs/plan'), { recursive: true })
    return root
  } catch (err) {
    rmSync(root, { recursive: true, force: true })
    throw err
  }
}

/** v2/10 卷名（按卷号定位，接受文件名变更；不复制卷内容）。 */
function volume10Name(): string {
  const names = readdirSync(DOCS_V2)
    .filter((n) => n.startsWith('10-') && n.endsWith('.md'))
    .sort()
  const [name] = names
  if (names.length !== 1 || name === undefined) {
    throw new Error(`v2/10 卷缺失或不唯一：${names.join(', ')}`)
  }
  return name
}

let positive: RunResult = { status: -1, stdout: '', stderr: '' }
let positiveRoot: string | null = null

beforeAll(() => {
  positiveRoot = makeFixture()
  positive = runCheck(positiveRoot)
})

afterAll(() => {
  if (positiveRoot !== null) rmSync(positiveRoot, { recursive: true, force: true })
})

describe('V0 文档自检脚本件（IMPL-08-02）', () => {
  it('脚本存在、带 node shebang、具可执行位', () => {
    expect(existsSync(SCRIPT)).toBe(true)
    expect(readFileSync(SCRIPT, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
    if (process.platform !== 'win32') {
      expect((statSync(SCRIPT).mode & 0o111) !== 0).toBe(true)
    }
  })

  it('根 package.json 有独立 verify:docs，且不串 verify:v2 冻结面', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.['verify:docs'] ?? '').toContain('v0-doc-check.mjs')
    expect(pkg.scripts?.['verify:v2'] ?? '').not.toContain('v0-doc-check')
  })

  it('正例：docs/v2＋docs/plan 全库副本 → exit 0，真悬空=0', () => {
    expect(positive.status).toBe(0)
    expect(positive.stderr).toBe('')
    expect(positive.stdout).toContain('v0-doc-check PASS')
    expect(positive.stdout).toContain('真悬空 0')
    expect(positive.stdout).toMatch(/docs\/v2 \d+ 卷＋docs\/plan \d+ 卷/)
  })

  it('六项检查全部输出（OK ①-⑥ 与检查名逐项在册）', () => {
    const marks = ['①', '②', '③', '④', '⑤', '⑥']
    const labels = [
      '检查一 悬空节号引用',
      '检查二 跨卷 ID 存在性',
      '检查三 裸字母 ID 族',
      '检查四 枚举字面量重述',
      '检查五 节号连续性',
      '检查六 示例值自洽',
    ]
    expect(positive.stdout).toContain('V0 六项 6/6')
    for (let i = 0; i < labels.length; i += 1) {
      expect(positive.stdout).toContain(`OK ${marks[i]}`)
      expect(positive.stdout).toContain(labels[i])
    }
  })

  it('负例：临时夹具注入悬空引用 → exit 1 并指名；真实 docs 逐字不变', () => {
    const name = volume10Name()
    const realDoc = join(DOCS_V2, name)
    const beforeReal = readFileSync(realDoc, 'utf8')
    const root = makeFixture()
    try {
      appendFileSync(join(root, 'docs/v2', name), '\n\n> 负例夹具：v2/10 §二.99 不存在。\n', 'utf8')
      const run = runCheck(root)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('v0-doc-check FAIL')
      expect(run.stderr).toContain('检查一 悬空')
      expect(run.stderr).toContain('v2/10 §二.99')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
    expect(readFileSync(realDoc, 'utf8')).toBe(beforeReal)
  })
})
