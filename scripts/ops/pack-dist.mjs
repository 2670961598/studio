#!/usr/bin/env node
/**
 * pack-dist —— 分发产物打包（M5-3a 第一刀，2026-11-21；docs/plan/08-§三 里程碑5-3、§〇 目标）
 *
 * 产物：`<out-dir>/studio-next-<version>-<gitshort>.tgz`（缺省 out-dir=<repo>/dist，gitignore 已含 dist）：
 *   - 源码树＝`git archive HEAD`（钉 commit：未提交工作树变更不入包——含本脚本自身，属预期）；
 *   - 运行时 node_modules＝按「声明依赖闭包 + 源码静态 bare-import 扫描」双种子计算的最小子集
 *     （bun workspace 布局：各 workspace 自带 node_modules 符号链接 → 根 .bun store 真实目录）；
 *     符号链接一律**重写为相对路径**（仓内存在绝对路径链接——出包即断，且违反「本机路径不入库」纪律）；
 *   - `dist-manifest.json`（git commit/时间/件数/树内容摘要 sha256/大小）＋ `INSTALL.md`（三步安装）；
 *   - `<tgz>.sha256` 边车（产物自身的 sha256 不可能写进产物内的 manifest——自指矛盾，故落边车）。
 *
 * 排除规则（源码树与 node_modules 同用）：目录名 test/tests/.git/.tmpcache/.bin/.cache、
 * 文件 .DS_Store（公司数据本就不入 git archive；.tmpcache 为运行时缓存不入包）。
 *
 * 边界：只加本件，不改仓内生产文件；不 commit；不部署。node ≥24，零新依赖
 * （node:crypto/fs/path/zlib? 不用 zlib——压缩交给系统 tar -czf；git/tar 两个外部命令）。
 *
 * 用法：
 *   node scripts/ops/pack-dist.mjs [--out-dir <dir>] [--json] [--help]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const MANIFEST_NAME = 'dist-manifest.json'
export const MANIFEST_SCHEMA = 'studio-next/dist-manifest/v1'

/** 排除目录名（源码树与 node_modules 通用；tests/.git/.tmpcache=任务口径，.bin/.cache=包管理噪声） */
export const PRUNE_DIR_NAMES = ['test', 'tests', '.git', '.tmpcache', '.bin', '.cache']
/** 排除文件名 */
export const PRUNE_FILE_NAMES = ['.DS_Store']
/** dev 工具配置面（vitest 配置属开发机；分发产物不带） */
export const PRUNE_FILE_RE = /^vitest\.[^/]*\.config\.[cm]?[jt]s$/

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

/** 解析 argv：--out-dir <dir>｜--json｜--help；位置参数一律拒绝 */
export function parseArgs(argv) {
  const flags = { outDir: '', json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--out-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('参数 --out-dir 缺值')
      flags.outDir = value
      i += 1
    } else if (arg.startsWith('--out-dir=')) flags.outDir = arg.slice('--out-dir='.length)
    else throw new Error(`未知参数：${arg}（只收 --out-dir <dir>｜--json｜--help）`)
  }
  return flags
}

export function usageText() {
  return [
    '用法：node scripts/ops/pack-dist.mjs [--out-dir <dir>] [--json] [--help]',
    '',
    '  从当前 HEAD 生成分发 tarball：studio-next-<version>-<gitshort>.tgz',
    '  内容＝git archive 源码树 + 运行时 node_modules 子集 + dist-manifest.json + INSTALL.md；',
    '  排除 test/tests/.git/.tmpcache/.bin/.cache/.DS_Store；sha256 打印并写 <tgz>.sha256 边车。',
    '  缺省 --out-dir=<repo>/dist（已 gitignore）。',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* 排除规则                                                            */
/* ------------------------------------------------------------------ */

/** 条目是否被剪除（dir=目录名判定；file=文件名判定；仅供测试与 cp filter 复用） */
export function shouldPruneEntry(name, kind) {
  if (kind === 'dir') return PRUNE_DIR_NAMES.includes(name)
  return PRUNE_FILE_NAMES.includes(name) || PRUNE_FILE_RE.test(name)
}

/** cp filter 形（src 绝对路径 → 是否保留） */
export function cpFilter(src) {
  const name = path.basename(src)
  let st
  try {
    st = lstatSync(src)
  } catch {
    return false
  }
  return !shouldPruneEntry(name, st.isDirectory() ? 'dir' : 'file')
}

/** 对已解包的源码树做剪除（git archive 含各包 test 目录等；node_modules 稍后另行拷入） */
export function pruneTree(root) {
  let pruned = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (shouldPruneEntry(entry.name, entry.isDirectory() ? 'dir' : 'file')) {
        rmSync(abs, { recursive: true, force: true })
        pruned += 1
        continue
      }
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(abs)
    }
  }
  walk(root)
  return pruned
}

/* ------------------------------------------------------------------ */
/* 运行时 node_modules 闭包                                            */
/* ------------------------------------------------------------------ */

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readJsonQuiet(file) {
  try {
    return readJson(file)
  } catch {
    return null
  }
}

/** 包的运行时依赖名集合（dependencies＋optionalDependencies＋peerDependencies；不含 dev） */
export function dependencyNames(pkg) {
  if (pkg === null || typeof pkg !== 'object') return []
  const names = new Set()
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = pkg[key]
    if (section !== null && typeof section === 'object') for (const name of Object.keys(section)) names.add(name)
  }
  return [...names]
}

/** Node 解析算法（无 exports 面的物理查找）：从 fromDir 起逐级上溯找 node_modules/<name>/package.json */
export function resolvePackageDir(fromDir, name) {
  let cur = path.resolve(fromDir)
  for (;;) {
    const cand = path.join(cur, 'node_modules', name)
    if (existsSync(path.join(cand, 'package.json'))) return cand
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

/** bare import 说明符（@scope/name 或 name；不含相对/绝对/node:） */
export function bareSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('bun:')) return null
  if (spec.length > 214) return null
  const parts = spec.split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0]
  if (!/^[a-zA-Z@][a-zA-Z0-9@/._-]*$/.test(name) || name.endsWith('/')) return null
  return name
}

/** 剥注释（块＋行）——JSDoc 里的 `import { x } from 'vitest'` 示例不是真依赖 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ')
}

/** 测试形态文件（src 内混居的 *.test.ts／*.spec.mjs／*.nt.ts／testutil.*——运行时零加载） */
export const TEST_FILE_RE = /(\.(test|spec|nt)\.[cm]?[jt]s$|^testutil\.[cm]?[jt]s$)/

/** 相对说明符解析（本仓惯例显式 .ts 后缀；兼容无后缀与 index） */
function resolveRelative(fromDir, spec) {
  const base = path.resolve(fromDir, spec)
  const candidates = [base, `${base}.ts`, `${base}.mts`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.mjs')]
  for (const cand of candidates) {
    try {
      if (statSync(cand).isFile()) return cand
    } catch {
      // 尝试下一候选
    }
  }
  return null
}

/** workspace 子路径解析（exports 感知：精确键→* 通配→import/default 条件；无 exports 才文件探测） */
function resolveWsSubpath(pkgDir, name, spec) {
  const sub = spec === name ? '.' : `./${spec.slice(name.length + 1)}`
  const pkgMeta = readJsonQuiet(path.join(pkgDir, 'package.json')) ?? {}
  const pick = (e) => (typeof e === 'string' ? e : Array.isArray(e) ? e[0] : e?.import ?? e?.default ?? e?.require)
  const exportsField = pkgMeta.exports
  if (exportsField !== undefined) {
    let mapped
    if (typeof exportsField === 'string' || Array.isArray(exportsField)) mapped = sub === '.' ? pick(exportsField) : undefined
    else {
      mapped = pick(exportsField[sub])
      if (mapped === undefined) {
        for (const [k, v] of Object.entries(exportsField)) {
          const idx = k.indexOf('*')
          if (idx === -1) continue
          const pre = k.slice(0, idx)
          const post = k.slice(idx + 1)
          if (sub.startsWith(pre) && sub.endsWith(post)) {
            const star = sub.slice(pre.length, sub.length - post.length)
            mapped = String(pick(v)).replace('*', star)
            break
          }
        }
      }
    }
    if (typeof mapped === 'string') {
      const abs = path.resolve(pkgDir, mapped)
      if (existsSync(abs)) return abs
    }
    return null // 有 exports 而未命中＝包语义即失败，不做文件探测猜测
  }
  if (sub === '.') return null
  return resolveRelative(pkgDir, sub)
}

/**
 * 运行时静态 import 图（可达性分析）：
 * 从各 workspace 真入口（package.json main/bin 值＋src/main.ts／src/index.ts 兜底）沿
 * 相对 import 传递闭包走到模块集，只收**可达**文件的 bare import——src 内混居的
 * *.test.ts／testutil.ts／platform-fixture.ts（引 vitest）天然不可达，不再污染闭包。
 * 返回 { entries, modules, bare: [{ name, from }] }（from=引用文件绝对路径）。
 */
export function collectRuntimeImports(repoRoot) {
  const root = path.resolve(repoRoot)
  const rootPkg = readJsonQuiet(path.join(root, 'package.json')) ?? {}
  const workspaces = expandWorkspaces(root, rootPkg)
  const importRe = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\n\\]+)['"]/g
  const seen = new Set()
  const bare = []
  const stack = []
  for (const ws of [root, ...workspaces]) {
    const pkg = ws === root ? rootPkg : readJsonQuiet(path.join(ws, 'package.json')) ?? {}
    const cands = [pkg.main, ...Object.values(pkg.bin ?? {}), 'src/main.ts', 'src/index.ts']
    for (const c of cands) {
      if (typeof c !== 'string' || c === '') continue
      const abs = path.resolve(ws, c)
      if (existsSync(abs)) stack.push(abs)
    }
  }
  const entries = [...stack]
  // workspace 本体判定：位于 ws 目录下、但不在其 node_modules 里（那里是第三方包，不可穿透）
  const isWsDir = (dir) =>
    workspaces.some((ws) => {
      if (dir === ws) return true
      if (!dir.startsWith(ws + path.sep)) return false
      const rel = path.relative(ws, dir)
      return rel !== 'node_modules' && !rel.startsWith(`node_modules${path.sep}`)
    })
  while (stack.length > 0) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    let text
    try {
      text = stripComments(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    for (const m of text.matchAll(importRe)) {
      const spec = m[1]
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveRelative(path.dirname(file), spec)
        if (resolved !== null && resolved.startsWith(root + path.sep)) stack.push(resolved)
        continue
      }
      const name = bareSpecifier(spec)
      if (name === null || isBuiltin(spec)) continue
      bare.push({ name, from: path.dirname(file) })
      // bare import 解析到仓内 workspace → 沿其入口/exports 子路径续走（跨包穿透：bun 把
      // 全部 workspace 链进各包 node_modules，src 可能 import 未声明进 package.json 的兄弟
      // 包或经 exports 子路径深进——图必须跟上，否则漏链接漏依赖）。解析用**收敛后的包名**
      // （子路径直查 <pkg>/subpath/package.json 必然扑空）；resolvePackageDir 返回链接路径，
      // 须先 realpath 落到真实 workspace 目录再做本体判定。
      const pkgDirRaw = resolvePackageDir(path.dirname(file), name)
      const pkgDir = pkgDirRaw !== null ? realpathSync(pkgDirRaw) : null
      if (pkgDir !== null && isWsDir(pkgDir)) {
        const subFile = resolveWsSubpath(pkgDir, name, spec)
        if (subFile !== null) stack.push(subFile)
        else {
          const pkgMeta = readJsonQuiet(path.join(pkgDir, 'package.json')) ?? {}
          for (const c of [pkgMeta.main, ...Object.values(pkgMeta.bin ?? {}), 'src/index.ts']) {
            if (typeof c === 'string' && c !== '') {
              const abs = path.resolve(pkgDir, c)
              if (existsSync(abs)) stack.push(abs)
            }
          }
        }
      }
    }
  }
  return { entries, modules: seen.size, moduleFiles: [...seen], bare }
}

/** 扫描一棵源码树的静态 import 面（from 'x' / import 'x' / import('x') / require('x')；单行内匹配） */
export function scanBareImports(dir, exts = ['.ts', '.mts', '.js', '.mjs']) {
  const found = new Set()
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (!shouldPruneEntry(entry.name, 'dir')) walk(abs)
        continue
      }
      if (!exts.includes(path.extname(entry.name))) continue
      if (TEST_FILE_RE.test(entry.name)) continue
      const text = stripComments(readFileSync(abs, 'utf8'))
      const re = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\n\\]+)['"]/g
      for (const m of text.matchAll(re)) {
        const name = bareSpecifier(m[1])
        if (name !== null) found.add(name)
      }
    }
  }
  walk(dir)
  return [...found]
}

/** 展开 root package.json 的 workspaces（只支持 `前缀/*` 形——本仓唯一形） */
export function expandWorkspaces(repoRoot, rootPkg) {
  const globs = Array.isArray(rootPkg?.workspaces) ? rootPkg.workspaces : []
  const out = []
  for (const glob of globs) {
    if (!glob.endsWith('/*') || glob.includes('*.*')) continue
    const base = path.join(repoRoot, glob.slice(0, -2))
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(base, entry.name, 'package.json'))) out.push(path.join(base, entry.name))
    }
  }
  return out
}

/**
 * 运行时闭包计划（纯函数——测试用假 repo 驱动；IO=只读）。
 *
 * 种子二路：① 各 package.json 声明的运行时依赖；② 各 workspace src 树静态 bare-import 扫描
 * （防「daemon 静态 import 了只写在 devDependencies 的 workspace 包」漏包——bun 的 workspace
 * node_modules 同时链接 dev 面，本机跑得通、裁剪后干净机器才炸）。
 *
 * 返回 { links: [{link, target}], stores: [rel], warnings: [string] }：
 *   links ＝ 需在包内重建的符号链接（link/target 均为相对 repo 根的 POSIX 路径；target=真实目录）；
 *   stores＝需整目录拷入的 .bun 真实包目录（相对 repo 根）。
 */
export function computeRuntimePlan(repoRoot, opts = {}) {
  // realpath 根：macOS tmpdir 等场景下 /var 与 /private/var 前缀不一致会导致「仓外」误判
  let root
  try {
    root = realpathSync(path.resolve(repoRoot))
  } catch {
    root = path.resolve(repoRoot)
  }
  const scanSrc = opts.scanSrc !== false
  const rootPkg = readJsonQuiet(path.join(root, 'package.json')) ?? {}
  const workspaces = expandWorkspaces(root, rootPkg)
  const links = new Map()
  const stores = new Map()
  const warnings = []
  const queue = []

  const enqueueFromPkg = (dir, pkg, origin) => {
    for (const name of dependencyNames(pkg)) queue.push({ from: dir, name, origin })
  }

  // 种子①：根 + 各 workspace 的声明依赖
  enqueueFromPkg(root, rootPkg, 'root')
  for (const ws of workspaces) enqueueFromPkg(ws, readJsonQuiet(path.join(ws, 'package.json')) ?? {}, path.relative(root, ws))

  // 种子②：运行时可达 import 图的 bare 引用（防「daemon 静态 import 了只写在 devDependencies
  // 的包」漏包——bun 的 workspace node_modules 同时链接 dev 面，本机跑得通、裁剪后干净机器才炸）
  if (scanSrc) {
    const graph = collectRuntimeImports(root)
    for (const { name, from } of graph.bare) queue.push({ from, name, origin: `${path.relative(root, from)} 静态引用` })
  }

  // workspace 本体不入 stores（源码树来自 git archive HEAD；从工作树拷会把未提交变更走私进「钉 HEAD」的包）
  const workspaceRoots = new Set(workspaces.map((ws) => realpathSync(ws)))
  const isWorkspaceDir = (dir) => [...workspaceRoots].some((ws) => dir === ws || dir.startsWith(ws + path.sep))

  const seen = new Set()
  while (queue.length > 0) {
    const { from, name, origin } = queue.shift()
    const key = `${from}\0${name}`
    if (seen.has(key)) continue
    seen.add(key)
    const dir = resolvePackageDir(from, name)
    if (dir === null) {
      warnings.push(`未解析依赖 ${name}（来源 ${origin}）——干净机器运行可能缺件`)
      continue
    }
    const real = realpathSync(dir)
    if (!real.startsWith(root + path.sep)) {
      warnings.push(`依赖 ${name} 解析到仓外（${real}）——不入包`)
      continue
    }
    // 链接位＝父目录 realpath 后拼 basename（候选路径与 realpath 根的前缀差异——macOS /var
    // vs /private/var——不得混算，否则 linkRel 出垃圾相对路径）
    const linkAbs = path.join(realpathSync(path.dirname(dir)), path.basename(dir))
    const linkRel = toPosix(path.relative(root, linkAbs))
    const targetRel = toPosix(path.relative(root, real))
    if (linkRel !== targetRel && !links.has(linkRel)) links.set(linkRel, targetRel)
    // workspace 本体不入 stores：源码树来自 git archive HEAD，从工作树拷会把未提交变更走私进「钉 HEAD」的包
    if (!isWorkspaceDir(real) && !stores.has(targetRel)) {
      stores.set(targetRel, true)
      enqueueFromPkg(real, readJsonQuiet(path.join(real, 'package.json')) ?? {}, targetRel)
    }
  }
  return {
    links: [...links.entries()].map(([link, target]) => ({ link, target })).sort((a, b) => (a.link < b.link ? -1 : 1)),
    stores: [...stores.keys()].sort(),
    warnings,
  }
}

export function toPosix(p) {
  return p.split(path.sep).join('/')
}

/* ------------------------------------------------------------------ */
/* 摘要 / manifest / INSTALL.md                                        */
/* ------------------------------------------------------------------ */

/** 单文件 sha256（hex；不存在=抛） */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 树内容摘要：对排序后的全部条目（文件=内容 sha256；符号链接=link:<target>）做总 sha256。
 * skip=相对根的排除名集合（缺省 dist-manifest.json 自身——manifest 写于摘要之后）。
 */
export function computeTreeDigest(root, skip = [MANIFEST_NAME]) {
  const lines = []
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (skip.includes(rel)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        lines.push(`${rel}\tlink:${readlinkSync(abs)}`)
        continue
      }
      if (entry.isDirectory()) {
        walk(abs, rel)
        continue
      }
      lines.push(`${rel}\t${sha256File(abs)}`)
    }
  }
  walk(path.resolve(root), '')
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** 统计树条目（fileCount=常规文件＋符号链接；sizeBytes=常规文件字节和） */
export function countTree(root) {
  let files = 0
  let symlinks = 0
  let sizeBytes = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        symlinks += 1
        continue
      }
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      files += 1
      sizeBytes += statSync(abs).size
    }
  }
  walk(path.resolve(root))
  return { fileCount: files + symlinks, symlinkCount: symlinks, sizeBytes }
}

/** 组 manifest（纯装配；字段校验归 validateManifest） */
export function buildManifest(fields) {
  return {
    schema: MANIFEST_SCHEMA,
    name: fields.name,
    version: fields.version,
    createdAt: fields.createdAt,
    git: { commit: fields.commit, short: fields.short, commitTime: fields.commitTime, branch: fields.branch, dirty: fields.dirty },
    artifact: { file: fields.artifactFile },
    tree: {
      source: 'git archive HEAD + runtime node_modules subset',
      fileCount: fields.fileCount,
      symlinkCount: fields.symlinkCount,
      sizeBytes: fields.treeSizeBytes,
      treeDigest: fields.treeDigest,
      runtimePackages: fields.runtimePackages,
      pruned: { dirs: [...PRUNE_DIR_NAMES], files: [...PRUNE_FILE_NAMES] },
    },
    runtime: { node: fields.nodeVersion, platform: fields.platform },
    limits: [
      '首版整包含运行时 node_modules（bun 安装面的运行时闭包子集拷贝，非逐包重装）',
      '无跨架构二进制保证：运行时依赖应为纯 JS；若混入原生件须在目标架构重装依赖',
      '产物钉 HEAD：未提交工作树变更不入包',
    ],
  }
}

/** manifest 结构校验（smoke 复用）：返回问题清单（空=过） */
export function validateManifest(obj) {
  const issues = []
  const hex = (s, n) => new RegExp(`^[0-9a-f]{${n}}$`).test(s ?? '')
  if (obj === null || typeof obj !== 'object') return ['manifest 非对象']
  if (obj.schema !== MANIFEST_SCHEMA) issues.push(`schema≠${MANIFEST_SCHEMA}`)
  if (typeof obj.name !== 'string' || obj.name === '') issues.push('name 缺失')
  if (typeof obj.version !== 'string' || obj.version === '') issues.push('version 缺失')
  if (Number.isNaN(Date.parse(obj.createdAt ?? ''))) issues.push('createdAt 非法时间')
  const git = obj.git ?? {}
  if (!hex(git.commit, 40)) issues.push('git.commit 非 40 位 hex')
  if (typeof git.short !== 'string' || git.short.length < 7 || !(git.commit ?? '').startsWith(git.short)) issues.push('git.short 与 commit 不符')
  if (Number.isNaN(Date.parse(git.commitTime ?? ''))) issues.push('git.commitTime 非法时间')
  const artifact = obj.artifact ?? {}
  if (typeof artifact.file !== 'string' || !/\.tgz$/.test(artifact.file)) issues.push('artifact.file 非 .tgz 名')
  const tree = obj.tree ?? {}
  if (!Number.isInteger(tree.fileCount) || tree.fileCount <= 0) issues.push('tree.fileCount 非正整数')
  if (!Number.isInteger(tree.sizeBytes) || tree.sizeBytes <= 0) issues.push('tree.sizeBytes 非正整数')
  if (!hex(tree.treeDigest, 64)) issues.push('tree.treeDigest 非 64 位 hex')
  if (!Number.isInteger(tree.runtimePackages) || tree.runtimePackages < 0) issues.push('tree.runtimePackages 非法')
  return issues
}

/** INSTALL.md（干净机器三步：解包 → stack doctor → stack up） */
export function renderInstallMd({ version, short, tgzName }) {
  return `# Studio Next 分发包（${version}-${short}）

干净机器安装三步：**解包 → 体检 → 起服**（macOS/Linux ＋ Node ≥24 ＋ git；无 Docker/Taiga/Matrix/bun 依赖）。

## 1) 解包

\`\`\`sh
node --version          # 必须 ≥ 24
tar -xzf ${tgzName} -C /opt/studio-next   # 目标目录任意，下称 <ROOT>
cd /opt/studio-next && cat ${MANIFEST_NAME}   # git commit / 内容摘要 / 件数 / 排除面
\`\`\`

## 2) 体检（stack doctor 六项）

先生成一家公司——\`company create\` 走 fresh 通道（内含 init＋平台绑定＋daemon.yaml 顺产；
\`--dir\` 必须是**空目录**，对既有目录会走 adopt 并拒绝改绑平台）：

\`\`\`sh
node apps/daemon/src/cli/main.ts company create demo-corp \\
  --dir <work>/demo-corp --work-root <work> --platform localfile
\`\`\`

再六项体检（node/公司目录/daemon.yaml/chatd 权限/备份目录/磁盘；chatd 三件在起服前缺失＝正常）：

\`\`\`sh
node apps/daemon/src/cli/main.ts stack doctor \\
  --company-dir <work>/demo-corp --config <work>/var/daemon.yaml --backup-dir <work>/backups
\`\`\`

## 3) 起服

前台双进程（M5-3：干净机器无 launchd/systemd 也能起公司闭环，Ctrl-C 优雅停）：

\`\`\`sh
node apps/daemon/src/cli/main.ts stack run \\
  --company-dir <work>/demo-corp --config <work>/var/daemon.yaml
\`\`\`

装成服务（macOS=launchd／Linux=systemd user，可后续再切）：

\`\`\`sh
node apps/daemon/src/cli/main.ts stack up --apply \\
  --company-dir <work>/demo-corp --guardian-config <guardian.json>
node apps/daemon/src/cli/main.ts stack status --company-dir <work>/demo-corp   # 三端点复验
\`\`\`

产物自身校验：\`sha256 -c\` 对照边车 \`${tgzName}.sha256\`；树内容摘要见 ${MANIFEST_NAME}（treeDigest）。
限制：首版含运行时 node_modules；无跨架构二进制保证（详见 manifest limits 字段）。
`
}

/* ------------------------------------------------------------------ */
/* 打包主流程                                                          */
/* ------------------------------------------------------------------ */

function removeQuiet(p) {
  try {
    lstatSync(p)
  } catch {
    return
  }
  rmSync(p, { recursive: true, force: true })
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败（exit=${res.status}）：${String(res.stderr ?? '').slice(0, 2000)}`)
  }
  return res
}

export async function main(argv) {
  const flags = parseArgs(argv)
  if (flags.help) {
    console.log(usageText())
    return 0
  }
  const started = Date.now()
  const repoRoot = REPO_ROOT

  const head = run('git', ['-C', repoRoot, 'rev-parse', 'HEAD']).stdout.trim()
  const short = run('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD']).stdout.trim()
  const commitTime = run('git', ['-C', repoRoot, 'log', '-1', '--format=%cI', 'HEAD']).stdout.trim()
  const branch = run('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  const status = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' })
  const dirty = status.status === 0 && status.stdout.trim() !== ''
  if (dirty) console.error(`提醒：工作树有未提交变更（产物钉 HEAD=${short}，不含这些变更——含打包脚本自身属预期）`)

  const daemonPkg = readJson(path.join(repoRoot, 'apps/daemon/package.json'))
  const version = daemonPkg.version ?? '0.1.0'
  const tgzName = `studio-next-${version}-${short}.tgz`
  const outDir = path.resolve(flags.outDir || path.join(repoRoot, 'dist'))
  mkdirSync(outDir, { recursive: true })

  const staging = mkdtempSync(path.join(tmpdir(), 'sn-pack-'))
  try {
    // 1) 源码树：git archive HEAD → 解包到 staging → 剪除 tests/.git/.tmpcache 等
    const archiveTar = path.join(staging, '..', `${path.basename(staging)}-src.tar`)
    run('git', ['-C', repoRoot, 'archive', '--format=tar', `--output=${archiveTar}`, 'HEAD'])
    run('tar', ['-xf', archiveTar, '-C', staging])
    rmSync(archiveTar, { force: true })
    const prunedSource = pruneTree(staging)

    // 2) 运行时 node_modules 子集
    const plan = computeRuntimePlan(repoRoot)
    for (const warning of plan.warnings) console.error(`警告：${warning}`)
    for (const rel of plan.stores) {
      cpSync(path.join(repoRoot, rel), path.join(staging, rel), { recursive: true, verbatimSymlinks: true, filter: cpFilter })
    }
    for (const { link, target } of plan.links) {
      const linkAbs = path.join(staging, link)
      mkdirSync(path.dirname(linkAbs), { recursive: true })
      removeQuiet(linkAbs)
      symlinkSync(path.relative(path.dirname(linkAbs), path.join(staging, target)), linkAbs)
    }

    // 3) INSTALL.md → 摘要/件数 → dist-manifest.json（manifest 不入自身摘要）
    writeFileSync(path.join(staging, 'INSTALL.md'), renderInstallMd({ version, short, tgzName }))
    const counts = countTree(staging)
    const treeDigest = computeTreeDigest(staging)
    const manifest = buildManifest({
      name: 'studio-next',
      version,
      createdAt: new Date().toISOString(),
      commit: head,
      short,
      commitTime,
      branch,
      dirty,
      artifactFile: tgzName,
      fileCount: counts.fileCount,
      symlinkCount: counts.symlinkCount,
      treeSizeBytes: counts.sizeBytes,
      treeDigest,
      runtimePackages: plan.stores.length,
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
    })
    const manifestIssues = validateManifest(manifest)
    if (manifestIssues.length > 0) throw new Error(`manifest 自检失败：${manifestIssues.join('；')}`)
    writeFileSync(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)

    // 4) tar -czf → sha256 边车
    const outTgz = path.join(outDir, tgzName)
    run('tar', ['-czf', outTgz, '-C', staging, '.'])
    const sha = sha256File(outTgz)
    const size = statSync(outTgz).size
    writeFileSync(`${outTgz}.sha256`, `${sha}\n`)

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, artifact: outTgz, sizeBytes: size, sha256: sha, fileCount: counts.fileCount, runtimePackages: plan.stores.length, prunedSource, warnings: plan.warnings, elapsedSec: Number(elapsed) }, null, 2))
    } else {
      console.log(`产物：${outTgz}`)
      console.log(`  commit：${head}（${branch}，${commitTime}）`)
      console.log(`  大小：${(size / 1024 / 1024).toFixed(1)}MiB｜件数：${counts.fileCount}（含符号链接 ${counts.symlinkCount}；源树剪除 ${prunedSource} 件）`)
      console.log(`  运行时包目录：${String(plan.stores.length)} 个｜treeDigest：${treeDigest}`)
      console.log(`  sha256：${sha}`)
      console.log(`  耗时：${elapsed}s`)
    }
    return 0
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      console.error(`pack-dist 失败：${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    },
  )
}
