/**
 * dsh-path —— dsh-bridge「路径消费二选一」声明与解析口径 V2 测试（IMPL-06-11）
 *
 * 依据（实现单引用章节号）：v2/13-§1.6-5（二选一写死并声明是否新增包边）、
 * v2/13-§3.3（dsh-bridge 仓内零模块入边）、v2/16-§三 dsh-bridge 行（现状错误面无稳定码→
 * 对齐 v2/11 通道）、v2/11-§0.4-6（Err 四问：副作用可能/可否重试/对账入口/责任位置）、
 * plan/05 IMPL-06-11、v2/13-§3.5＋plan/02-§七-3（新包四边登记：加边须四登记＋提案流）。
 *
 * 覆盖（冻结验收口径）：
 *   ① 数据面正例：本包真实 `package.json#dsh.entry` 可解析＝`src/index.ts`，与
 *      `main`/`exports["."]` 同指一处、所指文件真实存在（daemon 读文件即可装载）；
 *      `dsh` 段形状最小（恰 `entry`＋`bundle` 两键，不膨胀）；
 *   ② 负例（明确拒绝，不静默回退）：缺 `dsh` 段/缺 `entry`＝`bridge/entry-missing`；
 *      顶层或段/键坏形＝`bridge/entry-invalid`；失败面答满四问；无「兜底值」第三态；
 *   ③ 零模块入边冻结面：`apps/*` 与 `packages/*` 无任何模块说明符指向本包（daemon 只读
 *      文件不 import）；daemon manifest 不声明本包依赖；本包 `dependencies` 仍缺省；
 *   ④ 不新增包边：`guard:boundaries` 实跑 exit 0（分层宪法 20-§十五），且
 *      `boundary-rules` 的 `allowedPackageEdges` 无 `[daemon, dsh-bridge]` 条目
 *      （加边＝判据类资产修订＝提案流，本单不登记）。
 *
 * 零依赖纪律：本件只用 node 内置与 vitest，不 import 任何工作区包——否则本件自身就构成
 * 一条包边（零模块入边是本包的冻结面，测试不得破面取证）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSH_ENTRY_FIELD, DSH_MANIFEST_FIELD, resolveBridgeEntry } from '../../src/index.ts'
import type { BridgeEntryFailure, BridgeEntryResolution } from '../../src/index.ts'

/** 本包目录名（路径面断言与扫描豁免的唯一字面量） */
const BRIDGE_DIR = 'dsh-bridge'

/** 仓根（packages/dsh-bridge/test/v2 → 四级上）= REPO_ROOT；包根 = packages/dsh-bridge */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PKG_ROOT = join(REPO_ROOT, 'packages', BRIDGE_DIR)

/** exports 子路径条件对象（NEG-ENG-01：import 指源码、require 指拒绝 stub） */
interface ExportCondition {
  readonly import?: string
  readonly require?: string
}

/** 本包真实清单（数据面声明位＝被测事实源；只读不写） */
interface BridgeManifest {
  readonly name?: string
  readonly main?: string
  readonly exports?: Record<string, string | ExportCondition>
  readonly dsh?: Record<string, unknown>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

const MANIFEST = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as BridgeManifest

/** 解析并断言拒绝，返回失败面（放行即本测试自己失败，不静默） */
function rejected(manifestLike: unknown): BridgeEntryFailure {
  const resolution: BridgeEntryResolution = resolveBridgeEntry(manifestLike)
  expect(resolution.ok).toBe(false)
  if (resolution.ok) throw new Error('解析放行了应当拒绝的清单')
  return resolution.failure
}

// ---------------------------------------------------------------------------
// ① 数据面正例：package.json#dsh.entry → 入口路径
// ---------------------------------------------------------------------------

describe('数据面正例（选择①：入口路径写进 package.json#dsh，消费方只读文件）', () => {
  it('真实清单：entry 归一为 src/index.ts、与 main/exports["."] 同指一处、所指文件存在', () => {
    const resolution = resolveBridgeEntry(MANIFEST)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.entryRel).toBe('src/index.ts')
    // 声明一致性：三处同指一个文件（entry 不是另立的第二事实源）
    expect(MANIFEST.main).toBe(resolution.entryRel)
    const rootExport = MANIFEST.exports?.['.']
    expect(typeof rootExport === 'string' ? rootExport : rootExport?.import).toBe(
      `./${resolution.entryRel}`,
    )
    expect(existsSync(resolve(PKG_ROOT, resolution.entryRel))).toBe(true)
  })

  it('dsh 段形状最小：恰 entry＋bundle 两键（entry 是数据面声明位，bundle 保宿主语义）', () => {
    expect(Object.hasOwn(MANIFEST, DSH_MANIFEST_FIELD)).toBe(true)
    expect(MANIFEST.dsh?.[DSH_ENTRY_FIELD]).toBe('src/index.ts')
    expect(Object.keys(MANIFEST.dsh ?? {}).sort()).toStrictEqual([
      'bundle',
      DSH_ENTRY_FIELD,
    ])
    // dsh.bundle.patch 仍在（宿主分发面未被 entry 取代）
    expect(MANIFEST.dsh?.['bundle']).toStrictEqual({ patch: './cordis.patch.yml' })
    expect(existsSync(join(PKG_ROOT, 'cordis.patch.yml'))).toBe(true)
  })

  it('归一：`./` 前缀可有可无（仓内 main 用裸路径、exports 用 ./ 前缀，两种写法同解）', () => {
    expect(resolveBridgeEntry({ dsh: { entry: 'src/index.ts' } })).toStrictEqual({
      ok: true,
      entryRel: 'src/index.ts',
    })
    expect(resolveBridgeEntry({ dsh: { entry: './src/index.ts' } })).toStrictEqual({
      ok: true,
      entryRel: 'src/index.ts',
    })
    // dist 切换后同形（v2/13-§1.6-1：entry 与 exports["."] 同步改指，消费方零改动）
    expect(resolveBridgeEntry({ dsh: { entry: 'dist/index.js' } })).toStrictEqual({
      ok: true,
      entryRel: 'dist/index.js',
    })
  })

  it('纯函数：解析不改动入参清单（消费方可以放心只读复用）', () => {
    const sample = { dsh: { entry: './src/index.ts', bundle: { patch: './cordis.patch.yml' } } }
    const before = JSON.stringify(sample)
    resolveBridgeEntry(sample)
    expect(JSON.stringify(sample)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// ② 负例：缺字段／坏形＝明确拒绝（v2/11-§0.4-6 通道；不静默回退）
// ---------------------------------------------------------------------------

describe('负例（缺字段/坏形＝明确拒绝；不静默回退到 exports 或旧路径推断）', () => {
  it('缺字段：无 dsh 段／dsh 无 entry → bridge/entry-missing（exports 不得兜底）', () => {
    expect(rejected({}).code).toBe('bridge/entry-missing')
    expect(rejected({ dsh: {} }).code).toBe('bridge/entry-missing')
    expect(rejected({ dsh: { bundle: { patch: './cordis.patch.yml' } } }).code).toBe(
      'bridge/entry-missing',
    )
    // 有 exports["."] 也不算「读到了入口」——缺声明就是缺声明
    expect(rejected({ exports: { '.': './src/index.ts' } }).code).toBe('bridge/entry-missing')
    expect(rejected({ main: 'src/index.ts' }).code).toBe('bridge/entry-missing')
  })

  it('坏形：顶层／段／键逐层拒绝 → bridge/entry-invalid（逐类枚举）', () => {
    const badShapes: readonly unknown[] = [
      // 顶层不是对象（JSON.parse 得到 null/标量/数组）
      null,
      'garbage',
      42,
      [],
      // dsh 段不是对象
      { dsh: null },
      { dsh: 'x' },
      { dsh: [] },
      { dsh: 7 },
      // entry 不是非空字符串
      { dsh: { entry: 42 } },
      { dsh: { entry: null } },
      { dsh: { entry: ['src/index.ts'] } },
      { dsh: { entry: '' } },
      { dsh: { entry: '   ' } },
      // 绝对路径／盘符（越出包边界）
      { dsh: { entry: '/etc/index.ts' } },
      { dsh: { entry: 'C:/x/index.ts' } },
      // 上跳／当前段／空段
      { dsh: { entry: '../outside.ts' } },
      { dsh: { entry: 'src/../../outside.ts' } },
      { dsh: { entry: './..' } },
      { dsh: { entry: 'src/./index.ts' } },
      { dsh: { entry: 'src/' } },
      { dsh: { entry: './' } },
      { dsh: { entry: 'src//index.ts' } },
      // 反斜杠（POSIX 单一形态：跨平台歧义不入声明面）
      { dsh: { entry: 'src\\index.ts' } },
    ]
    for (const bad of badShapes) expect(rejected(bad).code).toBe('bridge/entry-invalid')
  })

  it('无回退：失败面不携 entryRel 等成功键（成功/失败二分，无兜底值第三态）', () => {
    const failure = rejected({ exports: { '.': './src/index.ts' } })
    expect(Object.hasOwn(failure, 'entryRel')).toBe(false)
    expect(Object.keys(failure).sort()).toStrictEqual([
      'category',
      'code',
      'detail',
      'reconcile',
      'responsibility',
      'retriable',
      'sideEffects',
    ])
  })

  it('失败面四问齐备：分类/稳定码/副作用/可否重试/对账入口/责任位置（v2/11-§0.4-6）', () => {
    for (const bad of [{}, { dsh: { entry: 42 } }] as const) {
      const failure = rejected(bad)
      expect(failure.category).toBe('rejected_precondition')
      expect(['bridge/entry-missing', 'bridge/entry-invalid']).toContain(failure.code)
      expect(failure.sideEffects).toBe('none')
      expect(failure.retriable).toBe('after-fix')
      expect(failure.detail.length).toBeGreaterThan(0)
      expect(failure.reconcile.length).toBeGreaterThan(0)
      expect(failure.responsibility.length).toBeGreaterThan(0)
    }
    // 两类失败必须可区分（不合并成一句「无效」）
    expect(rejected({}).code).not.toBe(rejected({ dsh: { entry: 42 } }).code)
  })
})

// ---------------------------------------------------------------------------
// ③ 零模块入边：仓内无 import 指向本包（daemon 只读文件不 import）
// ---------------------------------------------------------------------------

/** 递归收集仓内代码件（仓相对 posix；跳过噪声目录与本包自身——本包内互引不是入边） */
function codeFiles(): string[] {
  const out: string[] = []
  const noise = new Set(['node_modules', '.git', 'dist'])
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (noise.has(entry.name) || child === `packages/${BRIDGE_DIR}`) continue
        walk(child)
      } else if (/\.(?:ts|mts|mjs|cjs|js)$/.test(entry.name)) {
        out.push(child)
      }
    }
  }
  walk('apps')
  walk('packages')
  return out
}

/** 模块说明符抽取（静态 from／裸 import／dynamic import／require 四形——与边界门禁同口径） */
const SPEC_RE = /(?:\bfrom\b\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g

function moduleSpecs(source: string): string[] {
  const specs = new Set<string>()
  for (const match of source.matchAll(SPEC_RE)) {
    const spec = match[2]
    if (spec !== undefined && spec !== '') specs.add(spec)
  }
  return [...specs]
}

/** 说明符是否指向本包（裸包名／相对路径两种形态都按真实解析目标判） */
function pointsIntoBridge(fromRel: string, spec: string): boolean {
  if (spec.includes(BRIDGE_DIR)) return true
  if (!spec.startsWith('.')) return false
  const target = resolve(dirname(join(REPO_ROOT, fromRel)), spec)
  const rel = relative(PKG_ROOT, target)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

describe('零模块入边冻结面（daemon 只读文件不 import；不新增包边）', () => {
  it('apps/* 与 packages/* 无任何模块说明符指向 packages/dsh-bridge', () => {
    const offenders: string[] = []
    for (const rel of codeFiles()) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      for (const spec of moduleSpecs(source)) {
        if (pointsIntoBridge(rel, spec)) offenders.push(`${rel} → ${spec}`)
      }
    }
    expect(offenders).toStrictEqual([])
  })

  it('daemon manifest 不声明本包依赖；本包 dependencies 仍缺省（零依赖纪律）', () => {
    const daemonPkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps', 'daemon', 'package.json'), 'utf8'),
    ) as BridgeManifest
    expect(daemonPkg.dependencies?.['@studio-next/dsh-bridge']).toBeUndefined()
    expect(daemonPkg.devDependencies?.['@studio-next/dsh-bridge']).toBeUndefined()
    expect(MANIFEST.dependencies).toBeUndefined()
  })

  it('guard:boundaries 实跑 exit 0（分层宪法 20-§十五；层间/包间门禁绿＝无表中新边）', () => {
    const run = spawnSync(process.execPath, ['scripts/guards/boundaries.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    expect(output).toContain('边界门禁 PASS')
    expect(run.status).toBe(0)
  })

  it('不新增包边：boundary-rules 的 allowedPackageEdges 无 [daemon, dsh-bridge] 条目', () => {
    const rules = readFileSync(join(REPO_ROOT, 'scripts', 'guards', 'boundary-rules.mjs'), 'utf8')
    // 层位行仍在（包未消失，零入边注释仍在）
    expect(rules).toContain(`"${BRIDGE_DIR}": 1`)
    expect(rules).not.toMatch(/\[\s*["']daemon["']\s*,\s*["']dsh-bridge["']\s*\]/)
    expect(rules).not.toMatch(/\[\s*["']dsh-bridge["']\s*,\s*["']daemon["']\s*\]/)
  })
})
