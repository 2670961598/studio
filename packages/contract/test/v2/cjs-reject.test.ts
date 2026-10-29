/**
 * cjs-reject.test.ts —— NEG-ENG-01 CJS 拒绝面（V3·负测）
 *
 * 依据：docs/v2/17 §4.4 NEG-ENG-01（ESM-only；`require('@studio-next/…')` 预期失败形态实测）、
 *       docs/v2/13 §1.6-6 / DEC-13-13（分发面 ESM-only；CJS 消费者经 exports.require 拒绝，
 *       ERR_ESM_ONLY，不走 dist/CJS 构建）、docs/49「NEG-ENG-01 CJS 拒绝面」决定记录。
 *
 * 本文件只证**包名解析的事后件**（不 import 各包源码、不复制内部实现——实现可替换）：
 *   1. 15 个 packages/* 的 exports 每个子路径均为 `{ import, require }` 条件对象，
 *      `require` 全部指向包根同一 `require-reject.cjs`；`main`/`type` 保持不动；
 *   2. 15 包 CJS 子进程 `require('@studio-next/<pkg>')` 全部抛 Error，
 *      `code='ERR_ESM_ONLY'`，消息含包名与 「use import」；
 *   3. panel/studio-tools 的每个导出子路径（overview/inbox/judge/stdio）同样拒绝；
 *   4. 正例：ESM 子进程 `import('@studio-next/contract')` 仍按 exports.import 加载（PACKAGE_NAME）；
 *   5. 边界如实登记：**只保证包名 exports 条件**；子路径深路径由 Node exports 封装拒绝
 *      （ERR_PACKAGE_PATH_NOT_EXPORTED，非本 stub 的 ERR_ESM_ONLY）；绕过 exports 的
 *      绝对/相对文件路径不在承诺面，行为由 Node/文件本身决定，本测试不作断言。
 *
 * 夹具：os.tmpdir() 下建 `node_modules/@studio-next/<pkg>` 符号链接到 15 个包目录，
 * 探针子进程从临时目录解析包名；测试后即删，不写仓内任何文件。
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** packages/ 根（本文件位于 packages/contract/test/v2/）。 */
const PACKAGES_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** 15 个 workspace 包目录名（与 packages/* 一致；顺序即证据顺序）。 */
const PACKAGE_NAMES = [
  'adapters',
  'api',
  'company',
  'contract',
  'core',
  'dsh-bridge',
  'gateway',
  'localplatform',
  'matrix',
  'panel',
  'prompt',
  'store',
  'studio-tools',
  'taiga',
  'yt',
] as const

/** 仅 panel/studio-tools 有非根导出子路径；require 仍指同一包根 stub。 */
const SUBPATH_SPECIFIERS = [
  '@studio-next/panel/overview',
  '@studio-next/panel/inbox',
  '@studio-next/panel/judge',
  '@studio-next/studio-tools/stdio',
] as const

const REJECT_STUB = './require-reject.cjs'

interface ExportCondition {
  readonly import?: string
  readonly require?: string
}

interface PackageManifest {
  readonly name: string
  readonly type?: string
  readonly main?: string
  readonly exports: Record<string, ExportCondition>
}

interface RequireProbeResult {
  readonly specifier: string
  readonly threw: boolean
  readonly isError: boolean
  readonly code: string | null
  readonly message: string
}

interface RunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * CJS 探针：逐个 require 参数规格符，只序列化失败形态（不吞错、不重试）。
 * 用 argv 传规格符，避免把包名清单复制进子进程脚本。
 */
const CJS_PROBE_SOURCE = `'use strict'
const results = []
for (const specifier of process.argv.slice(2)) {
  try {
    require(specifier)
    results.push({ specifier, threw: false, isError: false, code: null, message: '' })
  } catch (error) {
    results.push({
      specifier,
      threw: true,
      isError: error instanceof Error,
      code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
process.stdout.write(JSON.stringify(results))
`

/** ESM 正例探针：动态 import 包名，回报包自述常量。 */
const ESM_PROBE_SOURCE = `const specifier = process.argv[2]
const mod = await import(specifier)
process.stdout.write(JSON.stringify({ packageName: mod.PACKAGE_NAME }))
`

let tmpRoot = ''

function runNode(args: readonly string[]): RunResult {
  const proc = spawnSync('node', [...args], {
    cwd: tmpRoot,
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr }
}

function runRequireProbe(specifiers: readonly string[]): readonly RequireProbeResult[] {
  const proc = runNode(['probe-require.cjs', ...specifiers])
  expect(proc.status, proc.stderr).toBe(0)
  return JSON.parse(proc.stdout) as readonly RequireProbeResult[]
}

function readManifest(packageName: string): PackageManifest {
  const manifestPath = join(PACKAGES_ROOT, packageName, 'package.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'studio-next-cjs-reject-'))
  const scopeDir = join(tmpRoot, 'node_modules', '@studio-next')
  mkdirSync(scopeDir, { recursive: true })
  for (const packageName of PACKAGE_NAMES) {
    symlinkSync(join(PACKAGES_ROOT, packageName), join(scopeDir, packageName), 'dir')
  }
  writeFileSync(join(tmpRoot, 'probe-require.cjs'), CJS_PROBE_SOURCE)
  writeFileSync(join(tmpRoot, 'probe-import.mjs'), ESM_PROBE_SOURCE)
})

afterAll(() => {
  if (tmpRoot !== '') rmSync(tmpRoot, { recursive: true, force: true })
})

describe('NEG-ENG-01 CJS 拒绝面（15 包）', () => {
  it('15 包 exports 每个子路径均为 import/require 条件，require 指向同一 stub，main/type 不动', () => {
    for (const packageName of PACKAGE_NAMES) {
      const manifest = readManifest(packageName)
      expect(manifest.name, packageName).toBe(`@studio-next/${packageName}`)
      expect(manifest.type, packageName).toBe('module')
      expect(manifest.main, packageName).toBe('src/index.ts')

      const entries = Object.entries(manifest.exports)
      expect(entries.length, packageName).toBeGreaterThan(0)
      for (const [subpath, condition] of entries) {
        const label = `${packageName} exports[${subpath}]`
        expect(typeof condition, label).toBe('object')
        expect(condition.import, label).toMatch(/^\.\/src\/.+\.ts$/)
        expect(condition.require, label).toBe(REJECT_STUB)
      }
    }

    // 子路径完整枚举：panel 4 条、studio-tools 2 条（不以 "./*" 通配）。
    expect(Object.keys(readManifest('panel').exports)).toEqual([
      '.',
      './overview',
      './inbox',
      './judge',
    ])
    expect(Object.keys(readManifest('studio-tools').exports)).toEqual(['.', './stdio'])
  })

  it('15 个 require-reject.cjs 存在，只含 ERR_ESM_ONLY 拒绝逻辑（包名 + use import）', () => {
    for (const packageName of PACKAGE_NAMES) {
      const stubPath = join(PACKAGES_ROOT, packageName, 'require-reject.cjs')
      expect(existsSync(stubPath), stubPath).toBe(true)
      const source = readFileSync(stubPath, 'utf8')
      expect(source, packageName).toContain(`@studio-next/${packageName}`)
      expect(source, packageName).toContain('ERR_ESM_ONLY')
      expect(source, packageName).toContain('use import()')
      // 拒绝面不提供可 require 的导出：不写 module.exports / exports 赋值。
      expect(source, packageName).not.toContain('module.exports')
      expect(source, packageName).not.toMatch(/^exports\./m)
    }
  })

  it('CJS 子进程 require 15 个包名：全部 Error + ERR_ESM_ONLY + 消息含包名与 use import', () => {
    const specifiers = PACKAGE_NAMES.map((packageName) => `@studio-next/${packageName}`)
    const results = runRequireProbe(specifiers)

    expect(results).toHaveLength(PACKAGE_NAMES.length)
    for (const result of results) {
      expect(result.threw, result.specifier).toBe(true)
      expect(result.isError, result.specifier).toBe(true)
      expect(result.code, result.specifier).toBe('ERR_ESM_ONLY')
      expect(result.message, result.specifier).toContain(result.specifier)
      expect(result.message.toLowerCase(), result.specifier).toContain('use import')
    }
  })

  it('panel/studio-tools 子路径 require 同样经 exports.require 拒绝', () => {
    const results = runRequireProbe(SUBPATH_SPECIFIERS)

    expect(results).toHaveLength(SUBPATH_SPECIFIERS.length)
    for (const result of results) {
      expect(result.threw, result.specifier).toBe(true)
      expect(result.isError, result.specifier).toBe(true)
      expect(result.code, result.specifier).toBe('ERR_ESM_ONLY')
      // 同一 stub 由根与子路径共用，消息含包名（不含子路径）即满足拒绝面契约。
      const baseName = result.specifier.split('/').slice(0, 2).join('/')
      expect(result.message, result.specifier).toContain(baseName)
      expect(result.message.toLowerCase(), result.specifier).toContain('use import')
    }
  })

  it('正例：ESM import() 仍按 exports.import 加载 contract（PACKAGE_NAME）', () => {
    const proc = runNode(['probe-import.mjs', '@studio-next/contract'])
    expect(proc.status, proc.stderr).toBe(0)
    const parsed = JSON.parse(proc.stdout) as { packageName?: string }
    expect(parsed.packageName).toBe('@studio-next/contract')
  })

  it('边界登记：包名深路径由 Node exports 封装拒绝，非本 stub 的 ERR_ESM_ONLY', () => {
    // 只保证包名 exports 条件；`@studio-next/contract/src/index.ts` 未在 exports 枚举内，
    // 由 Node 的 exports 封装拒绝（ERR_PACKAGE_PATH_NOT_EXPORTED）。
    // 绕过 exports 的绝对/相对文件路径不经过 package.json，不在本单承诺面，故不断言。
    const [result] = runRequireProbe(['@studio-next/contract/src/index.ts'])
    expect(result?.threw).toBe(true)
    expect(result?.code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })
})
