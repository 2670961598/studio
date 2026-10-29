/**
 * port-map-rescan.test.ts —— F5 端口-文件映射机械复扫伴测（MIG-08 / IMPL-08-03）
 *
 * 依据：plan/05 IMPL-08-03（验收＝`node scripts/verify/port-map-rescan.mjs` exit 0
 *       ＋ `bun run test:v2 -- packages/contract` 绿）、plan/03 §九（MIG-08 出口门禁：
 *       本单落位后脚本入冻结命令链）、docs/v2/14 §二（端口-文件映射单点表＝F5 唯一源；
 *       终态 20 件）、docs/v2/17 §七 F5 行/§4.5 GAP-V2-15（F5 机械复扫腿）。
 *
 * 本文件只证**脚本事后件**（不复制脚本的六项比对逻辑、不冒充业务覆盖）：
 *   1. 正例：当前映射与 `packages/contract/src/ports/` 实况零差异 → 脚本 exit 0；
 *   2. 负例：临时把一行映射改成不存在的文件名 → exit 1（缺失＋多余同报）；
 *      真实源卷与落点目录前后逐字/逐项不变（「不改真实文件」）；
 *   3. 负例：临时把一行映射指向另一映射件 → exit 1（一文件一端口冲突）；
 *   4. 负例：临时删一行映射 → exit 1（表行数与冻结 13 不符、孤儿落点报多余）。
 * 负例夹具用 os.tmpdir() 临时副本经 `--doc` 注入，脚本只读、测试后即删；
 * 不写仓内任何文件、不改 docs/v2 与 ports/ 源件。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT = join(REPO_ROOT, 'scripts/verify/port-map-rescan.mjs')
const DOCS_V2 = join(REPO_ROOT, 'docs/v2')
const PORTS_DIR = join(REPO_ROOT, 'packages/contract/src/ports')

/** v2/14 映射源卷（按卷号定位，接受文件名变更；不复制映射内容）。 */
function sourceDocName(): string {
  const names = readdirSync(DOCS_V2)
    .filter((n) => n.startsWith('14-') && n.endsWith('.md'))
    .sort()
  const [name] = names
  if (names.length !== 1 || name === undefined) {
    throw new Error(`v2/14 映射源卷缺失或不唯一：${names.join(', ')}`)
  }
  return name
}

const SOURCE_DOC = join(DOCS_V2, sourceDocName())

interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** 子进程跑真脚本（验收命令同体：`node scripts/verify/port-map-rescan.mjs`）。 */
function runRescan(args: readonly string[]): RunResult {
  const proc = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
  return { status: proc.status ?? -1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' }
}

/** 临时副本注入：mutate 必须真改动源卷（否则负例是假绿）；用完即删。 */
function withMutatedDoc<T>(mutate: (text: string) => string, fn: (docPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'studio-port-map-'))
  try {
    const docPath = join(dir, sourceDocName())
    const source = readFileSync(SOURCE_DOC, 'utf8')
    const mutated = mutate(source)
    if (mutated === source) {
      throw new Error('负例夹具未生效：临时副本的映射行未被改写')
    }
    writeFileSync(docPath, mutated, 'utf8')
    return fn(docPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('F5 端口-文件映射机械复扫（IMPL-08-03）', () => {
  it('正例：当前映射与 ports/ 实况零差异 → exit 0（13 PORT ↔ 20 文件）', () => {
    const run = runRescan(['--root', REPO_ROOT])
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('port-map-rescan PASS')
    expect(run.stdout).toContain('6/6')
    expect(run.stdout).toContain('13 PORT')
    expect(run.stdout).toContain('20 文件')
  })

  it('负例：临时改一行落点（def.ts→defx.ts）→ exit 1，报缺失＋多余；真实文件零改动', () => {
    const beforeDoc = readFileSync(SOURCE_DOC, 'utf8')
    const beforeFiles = readdirSync(PORTS_DIR).sort()
    withMutatedDoc((text) => text.replace('| PORT-DEF | `def.ts` |', '| PORT-DEF | `defx.ts` |'), (docPath) => {
      const run = runRescan(['--root', REPO_ROOT, '--doc', docPath])
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('port-map-rescan FAIL')
      expect(run.stderr).toContain('defx.ts')
      expect(run.stderr).toContain('def.ts')
    })
    // 「不改真实文件」：源卷逐字不变、落点目录逐项不变
    expect(readFileSync(SOURCE_DOC, 'utf8')).toBe(beforeDoc)
    expect(readdirSync(PORTS_DIR).sort()).toEqual(beforeFiles)
  })

  it('负例：临时把 PORT-AUTH 指向已有他件（auth.ts→def.ts）→ exit 1，报一文件一端口冲突', () => {
    withMutatedDoc((text) => text.replace('| PORT-AUTH | `auth.ts` |', '| PORT-AUTH | `def.ts` |'), (docPath) => {
      const run = runRescan(['--root', REPO_ROOT, '--doc', docPath])
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('冲突')
      expect(run.stderr).toContain('PORT-AUTH')
      expect(run.stderr).toContain('PORT-DEF')
    })
  })

  it('负例：临时删一行映射（PORT-OPS）→ exit 1，报表行数与冻结 13 不符、ops.ts 成孤儿件', () => {
    withMutatedDoc(
      (text) => text.replace(/^\| PORT-OPS \|.*\n/m, ''),
      (docPath) => {
        const run = runRescan(['--root', REPO_ROOT, '--doc', docPath])
        expect(run.status).toBe(1)
        expect(run.stderr).toContain('单点表 12 行')
        expect(run.stderr).toContain('ops.ts')
      },
    )
  })
})
