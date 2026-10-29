/**
 * evidence-channel.test.ts —— NEG-ENG-05 证据通道受理件伴测（V0·纪律）
 *
 * 依据：docs/v2/13 §1.5「证据通道（TOOL-07）」/§七-4（不用 eval/stdin 作证据通道）、
 *       docs/v2/17 §4.4 NEG-ENG-05（用 eval/stdin 形态当验证证据 → 拒；一律 `.ts` 文件或
 *       `mise exec -- node` 等价重跑）、docs/plan/04 §六.6（证据通道纪律）、
 *       docs/probe/neg-ring-eng/report.md §7.7（缺口：证据通道受理件 0 命中）。
 *
 * 本文件只证**受理件事后件**（不复制脚本内部逻辑、不 import 内部函数——实现可替换，
 * 只对可执行件、JSON 形状与 exit 码负责）：
 *   1. 正例：`--file`/位置参数受理仓内 `.ts`，输出恰好 `{ok,file,sha256}` 三键，仓相对 posix；
 *   2. 正例：受理基准是仓根（与 cwd 无关）；
 *   3. 正例：**不执行证据代码**——含顶层副作用（写 marker 后 throw）与语法错误的 `.ts`
 *      都只登记指纹，marker 不出现、进程不因证据代码报错；
 *   4. 负例：eval（`-e`/`--eval`/`--eval=`/`-p`/`--input-type`，含混入有效 `--file`）、
 *      stdin（`-`/`--file -`/管道）、内联代码、非 `.ts`、绝对路径（仓内/仓外/盘符）、
 *      `..` 逃逸、符号链接指仓外、不存在、`.ts` 目录、未知选项/多目标/缺值——逐条 exit 1
 *      且错误码可判（stdout 为空、stderr 单行 JSON）；
 *   5. 负例：成功后 stdout 不含本机绝对路径（登记面只落仓相对路径）。
 *
 * 负例夹具用仓根下的临时目录（受理口径本身要求「仓内 `.ts`」，故不能放 os.tmpdir()）；
 * `withRepoFixture` 保证用完即删。不写/不改仓内任何已跟踪文件，不新增记录类与端口。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 真实路径：受理件输出的是 realpath 的仓相对形态，伴测基准必须同源（防仓根含符号链接时误判）
const REPO_ROOT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)))
const SCRIPT = join(REPO_ROOT, 'scripts/verify/evidence-channel.mjs')

/** 受理面自身的 `.ts`：正例用它（测试运行期必然存在，且能独立复算 sha256）。 */
const SELF = 'packages/contract/test/v2/evidence-channel.test.ts'

/** 错误码（与脚本 `REJECT` 表逐字对应；伴测只认字符串契约）。 */
const REJECT = {
  NO_INPUT: 'EVIDENCE_CHANNEL_NO_INPUT',
  MISSING_FILE_VALUE: 'EVIDENCE_CHANNEL_MISSING_FILE_VALUE',
  MULTIPLE_INPUTS: 'EVIDENCE_CHANNEL_MULTIPLE_INPUTS',
  EVAL_FORBIDDEN: 'EVIDENCE_CHANNEL_EVAL_FORBIDDEN',
  STDIN_FORBIDDEN: 'EVIDENCE_CHANNEL_STDIN_FORBIDDEN',
  INLINE_CODE: 'EVIDENCE_CHANNEL_INLINE_CODE',
  UNKNOWN_FLAG: 'EVIDENCE_CHANNEL_UNKNOWN_FLAG',
  ABSOLUTE_PATH: 'EVIDENCE_CHANNEL_ABSOLUTE_PATH',
  PATH_ESCAPE: 'EVIDENCE_CHANNEL_PATH_ESCAPE',
  NOT_TS: 'EVIDENCE_CHANNEL_NOT_TS',
  NOT_FOUND: 'EVIDENCE_CHANNEL_NOT_FOUND',
  NOT_REGULAR_FILE: 'EVIDENCE_CHANNEL_NOT_REGULAR_FILE',
} as const

interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

interface RunOptions {
  readonly cwd?: string
  readonly input?: string
}

interface AcceptPayload {
  readonly ok: boolean
  readonly file: string
  readonly sha256: string
}

interface RejectPayload {
  readonly ok: boolean
  readonly error: { readonly code: string; readonly message: string }
}

/** 子进程跑真受理件（与调用方同体：`node scripts/verify/evidence-channel.mjs …`）。 */
function run(args: readonly string[], options: RunOptions = {}): RunResult {
  const proc = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: options.cwd ?? REPO_ROOT,
    timeout: 30_000,
    input: options.input,
  })
  return { status: proc.status ?? -1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' }
}

/** 仓根下临时夹具目录（受理口径要求仓内路径；调用方负责在 withRepoFixture 内用完即删）。 */
function withRepoFixture<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(REPO_ROOT, 'tmp-evidence-channel-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const toPosix = (p: string): string => p.split(sep).join('/')

function toRepoPath(absPath: string): string {
  return toPosix(relative(REPO_ROOT, absPath))
}

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 正例断言：exit 0、stderr 空、stdout 单行 JSON 且**恰好** ok/file/sha256 三键。 */
function parseAccept(result: RunResult): AcceptPayload {
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  const lines = result.stdout.trim().split('\n')
  expect(lines).toHaveLength(1)
  const payload = JSON.parse(lines[0] ?? '') as AcceptPayload
  expect(payload.ok).toBe(true)
  expect(Object.keys(payload).sort()).toEqual(['file', 'ok', 'sha256'])
  return payload
}

/** 负例断言：exit 1、stdout 空、stderr 单行 JSON，错误码与期望逐字相等且 message 非空。 */
function parseReject(result: RunResult, expectedCode: string): void {
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  const lines = result.stderr.trim().split('\n')
  expect(lines).toHaveLength(1)
  const payload = JSON.parse(lines[0] ?? '') as RejectPayload
  expect(payload.ok).toBe(false)
  expect(payload.error.code).toBe(expectedCode)
  expect(payload.error.message.length).toBeGreaterThan(0)
}

describe('NEG-ENG-05 证据通道受理件（v2/13 §1.5 TOOL-07）', () => {
  it('正例：--file 受理仓内 .ts，输出 ok/file/sha256 且不回显本机路径', () => {
    const result = run(['--file', SELF])
    const accepted = parseAccept(result)
    expect(accepted.file).toBe(SELF)
    expect(accepted.sha256).toBe(sha256Of(join(REPO_ROOT, SELF)))
    expect(accepted.sha256).toMatch(/^[0-9a-f]{64}$/)
    // 登记面只落仓相对路径：stdout 里不出现仓根绝对路径
    expect(result.stdout).not.toContain(REPO_ROOT)
  })

  it('正例：位置参数等价受理，`./` 前缀归一为仓相对 posix 路径；基准是仓根而非 cwd', () => {
    const target = 'packages/contract/src/index.ts'
    for (const arg of [target, `./${target}`]) {
      const accepted = parseAccept(run([arg]))
      expect(accepted.file).toBe(target)
      expect(accepted.sha256).toBe(sha256Of(join(REPO_ROOT, target)))
    }
    // 从 os.tmpdir() 调用、仍按仓根解析（不受 cwd 影响）
    const fromOutsideCwd = parseAccept(run(['--file', target], { cwd: tmpdir() }))
    expect(fromOutsideCwd.file).toBe(target)
  })

  it('正例：只受理登记，不执行证据代码（顶层副作用不触发、语法错误件也受理）', () => {
    withRepoFixture((dir) => {
      const marker = join(dir, 'executed.marker')
      const sideEffect = join(dir, 'side-effect.ts')
      writeFileSync(
        sideEffect,
        [
          'import { writeFileSync } from "node:fs";',
          'writeFileSync(new URL("./executed.marker", import.meta.url), "executed");',
          'throw new Error("证据通道不得执行证据代码");',
          '',
        ].join('\n'),
        'utf8',
      )
      const brokenSyntax = join(dir, 'broken-syntax.ts')
      writeFileSync(brokenSyntax, 'const broken = ;\n', 'utf8')

      const accepted = parseAccept(run(['--file', toRepoPath(sideEffect)]))
      expect(accepted.file).toBe(toRepoPath(sideEffect))
      expect(accepted.sha256).toBe(sha256Of(sideEffect))
      expect(existsSync(marker)).toBe(false)

      // 语法错件照收：本件不解析/不执行证据代码，只做字节指纹
      const broken = parseAccept(run([toRepoPath(brokenSyntax)]))
      expect(broken.sha256).toBe(sha256Of(brokenSyntax))
      expect(existsSync(marker)).toBe(false)
    })
  })

  it('负例：eval 形态一律拒（含 `-eCODE`/`--eval=`/`--input-type`/混入有效 --file）', () => {
    const cases: readonly (readonly string[])[] = [
      ['-e', 'console.log(1)'],
      ['-econsole.log(1)'],
      ['--eval', 'console.log(1)'],
      ['--eval=console.log(1)'],
      ['-p', '1+1'],
      ['--print=1+1'],
      ['--input-type=module', '-e', 'x'],
      ['--file', SELF, '--eval', 'console.log(1)'],
    ]
    for (const args of cases) parseReject(run(args), REJECT.EVAL_FORBIDDEN)
  })

  it('负例：stdin 不读不执行（`-`/`--file -`/管道输入）', () => {
    parseReject(run(['-']), REJECT.STDIN_FORBIDDEN)
    parseReject(run(['--file', '-']), REJECT.STDIN_FORBIDDEN)
    const piped = run([], { input: 'console.log("from-stdin")\n' })
    parseReject(piped, REJECT.NO_INPUT)
    expect(piped.stdout).toBe('')
  })

  it('负例：内联代码 INLINE_CODE、非 .ts NOT_TS（错误码可判）', () => {
    for (const inline of ['console.log(1)', 'const x = 1', 'process.exit(0)']) {
      parseReject(run([inline]), REJECT.INLINE_CODE)
    }
    parseReject(run(['--file', 'console.log(1)']), REJECT.INLINE_CODE)
    for (const notTs of ['README.md', 'package.json', 'docs/v2', 'packages/contract/src']) {
      parseReject(run([notTs]), REJECT.NOT_TS)
    }
  })

  it('负例：绝对路径（仓内/仓外/Windows 盘符）一律 ABSOLUTE_PATH', () => {
    parseReject(run([join(REPO_ROOT, SELF)]), REJECT.ABSOLUTE_PATH)
    parseReject(run(['/etc/hosts.ts']), REJECT.ABSOLUTE_PATH)
    parseReject(run(['C:\\tmp\\x.ts']), REJECT.ABSOLUTE_PATH)
  })

  it('负例：`..` 段一律拒（含未逃逸的规范化路径）与符号链接指仓外 → PATH_ESCAPE', () => {
    parseReject(run(['../outside.ts']), REJECT.PATH_ESCAPE)
    parseReject(run(['packages/../../outside.ts']), REJECT.PATH_ESCAPE)
    // 即使词法上仍在仓内，也不受理 `..`（登记面只收规范仓相对路径）
    parseReject(run(['packages/contract/src/../index.ts']), REJECT.PATH_ESCAPE)
    const outsideDir = mkdtempSync(join(tmpdir(), 'studio-evidence-channel-outside-'))
    try {
      const outside = join(outsideDir, 'outside.ts')
      writeFileSync(outside, 'export const outside = true\n', 'utf8')
      withRepoFixture((dir) => {
        const link = join(dir, 'escape.ts')
        symlinkSync(outside, link)
        parseReject(run([toRepoPath(link)]), REJECT.PATH_ESCAPE)
      })
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('负例：不存在 .ts → NOT_FOUND；`.ts` 目录 → NOT_REGULAR_FILE', () => {
    parseReject(run(['packages/contract/test/v2/does-not-exist.ts']), REJECT.NOT_FOUND)
    withRepoFixture((dir) => {
      const dirNamedTs = join(dir, 'bundle.ts')
      mkdirSync(dirNamedTs)
      parseReject(run([toRepoPath(dirNamedTs)]), REJECT.NOT_REGULAR_FILE)
    })
  })

  it('负例：未知选项/多目标/`--file` 缺值逐条可判', () => {
    parseReject(run(['--stdin']), REJECT.UNKNOWN_FLAG)
    parseReject(run(['--file']), REJECT.MISSING_FILE_VALUE)
    parseReject(run(['--file', SELF, SELF]), REJECT.MULTIPLE_INPUTS)
    parseReject(run(['--file', SELF, '--file', SELF]), REJECT.MULTIPLE_INPUTS)
  })
})
