/**
 * contract 冻结工件 CLI：离线生成（--write）／漂移检查（--check，默认）——MIG-03 / IMPL-03-05
 *
 * 依据链：DEC-13-11（离线生成＋禁运行时重生成）、DEC-OPEN-15（未批不发 id 关键字）、
 *   v2/16 §三 contract 行、plan/05 IMPL-03-05、plan/04 §MIG-03 行（⑤ `bun run contract:check` exit 0）。
 *
 * 用法（仓根）：
 *   node packages/contract/src/artifacts/cli.ts                 # 等价 --check：漂移 exit 1
 *   node packages/contract/src/artifacts/cli.ts --check
 *   node packages/contract/src/artifacts/cli.ts --write         # 重新冻结（提案流批后执行）
 *   选项：--artifacts-dir <dir>｜--generated-at <ISO>｜--source-commit <sha>｜--json｜--help
 *
 * 纪律：`--write` 是**唯一**写工件路径；写后同门自检（写→查一体，避免写入不可复现字节）。
 *   冻结期元数据（生成时间/来源 commit）只在 --write 时采集：时间取系统时钟，来源提交取 git HEAD。
 *   不把本机绝对路径写入工件（来源文件一律仓相对 posix 路径）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkArtifacts, defaultArtifactsDir, formatCheckReport } from './check.ts'
import {
  ARTIFACT_AREAS,
  ARTIFACT_INDEX_FILE,
  ARTIFACT_RECORDS_DIR,
  buildIndex,
  generateAreaDoc,
  resolveZodVersion,
  serializeArtifact,
  type FreezeMeta,
} from './generate.ts'

/** 仓根（本文件位 packages/contract/src/artifacts/ → 上四级） */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const USAGE = `contract 冻结 JSON Schema 工件 CLI（MIG-03 / IMPL-03-05；DEC-13-11）

用法：
  node packages/contract/src/artifacts/cli.ts [--check | --write] [选项]

模式：
  --check（默认）   内存重生成后与 artifacts/ 逐字节比对；有漂移 exit 1
  --write           重新冻结 13 AREA 数据件＋旁注索引（唯一写路径；须走提案流）

选项：
  --artifacts-dir <dir>   工件目录（默认 packages/contract/artifacts/）
  --generated-at <ISO>    仅 --write：指定生成时间（默认系统时钟）
  --source-commit <sha>   仅 --write：指定来源提交（默认 git HEAD）
  --json                  以 JSON 打印检查结论
  --help                  打印本页
`

interface CliOptions {
  mode: 'check' | 'write'
  artifactsDir: string
  generatedAt?: string
  sourceCommit?: string
  json: boolean
  help: boolean
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { mode: 'check', artifactsDir: defaultArtifactsDir(), json: false, help: false }
  const readValue = (argv2: readonly string[], index: number, flag: string): string => {
    const value = argv2[index + 1]
    if (value === undefined) throw new Error(`${flag} 缺值`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.mode = 'check'
    else if (arg === '--write') options.mode = 'write'
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--artifacts-dir') {
      options.artifactsDir = resolve(readValue(argv, index, '--artifacts-dir'))
      index += 1
    } else if (arg === '--generated-at') {
      options.generatedAt = readValue(argv, index, '--generated-at')
      index += 1
    } else if (arg === '--source-commit') {
      options.sourceCommit = readValue(argv, index, '--source-commit')
      index += 1
    } else {
      throw new Error(`未知参数 ${String(arg)}（--help 看用法）`)
    }
  }
  return options
}

/** 来源提交：git HEAD（不写本机路径；失败记 unknown，不阻断离线生成） */
function gitHeadCommit(): string {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    return /^[0-9a-f]{40}$/.test(out) ? out : 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface WriteArtifactsOptions {
  artifactsDir?: string
  generatedAt?: string
  sourceCommit?: string
}

export interface WriteArtifactsResult {
  written: string[]
}

/** 重新冻结：写 13 AREA 数据件＋旁注索引（唯一写路径；返回件相对路径清单） */
export function writeArtifacts(options: WriteArtifactsOptions = {}): WriteArtifactsResult {
  const artifactsDir = options.artifactsDir ?? defaultArtifactsDir()
  const meta: FreezeMeta = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceCommit: options.sourceCommit ?? gitHeadCommit(),
    zodVersion: resolveZodVersion(),
  }
  const written: string[] = []
  for (const area of ARTIFACT_AREAS) {
    const rel = `${ARTIFACT_RECORDS_DIR}/${area.file}`
    const target = join(artifactsDir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, serializeArtifact(generateAreaDoc(area)), 'utf8')
    written.push(rel)
  }
  writeFileSync(join(artifactsDir, ARTIFACT_INDEX_FILE), serializeArtifact(buildIndex(meta)), 'utf8')
  written.push(ARTIFACT_INDEX_FILE)
  return { written }
}

/** CLI 主函数（导出供测试面复用；返回进程退出码） */
export function main(argv: readonly string[]): number {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (options.mode === 'write') {
    const result = writeArtifacts({
      artifactsDir: options.artifactsDir,
      ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
      ...(options.sourceCommit !== undefined ? { sourceCommit: options.sourceCommit } : {}),
    })
    process.stdout.write(`重新冻结 ${result.written.length} 件（13 AREA 数据件＋索引；DEC-13-11 离线生成）\n`)
    // 写→查同门：写入后立即自检，保证落盘字节可复算（写不出可复现字节＝生成器缺陷）
  }
  const report = checkArtifacts({ artifactsDir: options.artifactsDir })
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(formatCheckReport(report))
  return report.ok ? 0 : 1
}

/** 直接执行判据（被 import 时不得跑主流程；仓内 guards 同款口径） */
function isExecutedDirectly(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (isExecutedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`contract:check 启动失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
