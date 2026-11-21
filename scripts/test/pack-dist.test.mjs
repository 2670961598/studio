/** pack-dist.test —— M5-3a 打包器纯函数面（node:test；假 repo 临时目录，不真跑大打包） */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import {
  MANIFEST_SCHEMA,
  bareSpecifier,
  buildManifest,
  computeRuntimePlan,
  computeTreeDigest,
  countTree,
  dependencyNames,
  expandWorkspaces,
  parseArgs,
  renderInstallMd,
  resolvePackageDir,
  scanBareImports,
  sha256File,
  shouldPruneEntry,
  toPosix,
  usageText,
  validateManifest,
} from '../ops/pack-dist.mjs'

const roots = []
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function tempRoot() {
  const d = mkdtempSync(path.join(tmpdir(), 'sn-pack-dist-test-'))
  roots.push(d)
  return d
}

/* ---------------- 假 repo 脚手架（bun workspace 布局仿真） ---------------- */

function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`)
}

/**
 * 布局：
 *   root package.json（workspaces ["apps/*","packages/*"]；devDeps vitest——必须被排除）
 *   apps/daemon/package.json deps：{zod, @studio-next/company}
 *   apps/daemon/src/main.ts 静态 import 'leftpad'（未声明——闭包须靠扫描种子收进来）
 *   packages/company/package.json deps：{yaml}
 *   node_modules/.bun/{zod,yaml,leftpad,vitest}@x/node_modules/<pkg>/…（store 真实目录）
 *   node_modules/.bun/zod@1/node_modules/zod 依赖 content-type（传递闭包）
 *   apps/daemon/node_modules/{zod→store, @studio-next/company→packages/company}
 *   packages/company/node_modules/{yaml→store}
 *   根 node_modules/vitest→store（dev 面：closure 不得包含）
 */
function fakeRepo() {
  const root = tempRoot()
  const nm = (rel) => path.join(root, 'node_modules', rel)
  const store = (dir, name, pkg, files = {}) => {
    const dirPath = nm(`.bun/${dir}/node_modules/${name}`)
    writeJson(path.join(dirPath, 'package.json'), pkg)
    for (const [f, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dirPath, f)), { recursive: true })
      writeFileSync(path.join(dirPath, f), content)
    }
    return path.relative(root, dirPath)
  }
  const link = (fromRel, targetAbs) => {
    const linkAbs = path.join(root, fromRel)
    mkdirSync(path.dirname(linkAbs), { recursive: true })
    symlinkSync(path.relative(path.dirname(linkAbs), path.resolve(root, targetAbs)), linkAbs)
  }

  writeJson(path.join(root, 'package.json'), { name: 'studio-next', version: '0.1.0', workspaces: ['apps/*', 'packages/*'], devDependencies: { vitest: '^3.0.0' } })
  writeJson(path.join(root, 'apps/daemon/package.json'), { name: '@studio-next/daemon', dependencies: { zod: '^4.0.0', '@studio-next/company': 'workspace:*' } })
  mkdirSync(path.join(root, 'apps/daemon/src'), { recursive: true })
  writeFileSync(path.join(root, 'apps/daemon/src/main.ts'), "import 'leftpad'\nimport { z } from 'zod'\n")
  writeJson(path.join(root, 'packages/company/package.json'), { name: '@studio-next/company', dependencies: { yaml: '^2.0.0' } })
  mkdirSync(path.join(root, 'packages/company/src'), { recursive: true })
  writeFileSync(path.join(root, 'packages/company/src/index.ts'), "import { x } from 'yaml'\n")
  writeFileSync(path.join(root, 'packages/company/src/testutil.ts'), "import { expect } from 'vitest'\n") // 不可达：不得把 vitest 拉进闭包
  // exports 子路径穿透用例：daemon 经 '@studio-next/api/x' 深进 api/src/x.ts（其依赖未在 api 声明面）
  writeJson(path.join(root, 'packages/api/package.json'), {
    name: '@studio-next/api',
    exports: { '.': './src/index.ts', './x': './src/x.ts' },
  })
  mkdirSync(path.join(root, 'packages/api/src'), { recursive: true })
  writeFileSync(path.join(root, 'packages/api/src/index.ts'), '')
  writeFileSync(path.join(root, 'packages/api/src/x.ts'), "import { pad } from 'leftpad2'\n")
  writeJson(path.join(nm('.bun/leftpad2@1.0.0/node_modules/leftpad2'), 'package.json'), { name: 'leftpad2', version: '1.0.0' })
  link('packages/api/node_modules/leftpad2', path.join(root, 'node_modules/.bun/leftpad2@1.0.0/node_modules/leftpad2'))
  link('apps/daemon/node_modules/@studio-next/api', path.join(root, 'packages/api')) // bun：全 workspace 都被链接
  writeFileSync(path.join(root, 'apps/daemon/src/main.ts'), "import 'leftpad'\nimport { z } from 'zod'\nimport './extra.ts'\nimport '@studio-next/api/x'\n")

  const zodStore = nm('.bun/zod@1.0.0/node_modules/zod')
  writeJson(path.join(zodStore, 'package.json'), { name: 'zod', version: '1.0.0', dependencies: { 'content-type': '*' } })
  mkdirSync(path.join(zodStore, 'lib'), { recursive: true })
  writeFileSync(path.join(zodStore, 'lib/z.js'), 'export const z=1\n')
  // bun 传递依赖布局：zod 的依赖与 zod 同居 .bun/zod@1.0.0/node_modules/ 下（同级邻居）
  writeJson(path.join(nm('.bun/zod@1.0.0/node_modules/content-type'), 'package.json'), { name: 'content-type', version: '1.0.0' })
  const zodDir = 'node_modules/.bun/zod@1.0.0/node_modules/zod'
  const yamlDir = store('yaml@2.0.0', 'yaml', { name: 'yaml', version: '2.0.0' })
  const leftpadDir = store('leftpad@0.1.0', 'leftpad', { name: 'leftpad', version: '0.1.0' })
  const vitestDir = store('vitest@3.0.0', 'vitest', { name: 'vitest', version: '3.0.0' })

  link('apps/daemon/node_modules/zod', path.join(root, zodDir))
  link('apps/daemon/node_modules/@studio-next/company', path.join(root, 'packages/company'))
  link('packages/company/node_modules/yaml', yamlDir)
  link('apps/daemon/node_modules/leftpad', leftpadDir)
  link('node_modules/vitest', vitestDir)
  link('node_modules/typescript', vitestDir) // 根 dev 面第二件
  return root
}

/* ---------------- 参数 ---------------- */

test('parseArgs：--out-dir 两形＋--json/--help；未知/缺值即抛', () => {
  assert.deepEqual(parseArgs(['--out-dir', '/tmp/x', '--json']), { outDir: '/tmp/x', json: true, help: false })
  assert.deepEqual(parseArgs(['--out-dir=/tmp/y']), { outDir: '/tmp/y', json: false, help: false })
  assert.deepEqual(parseArgs([]), { outDir: '', json: false, help: false })
  assert.throws(() => parseArgs(['--out-dir']), /缺值/)
  assert.throws(() => parseArgs(['--wat']), /未知参数/)
  assert.throws(() => parseArgs(['positional']), /未知参数/)
  assert.ok(usageText().includes('--out-dir'))
})

/* ---------------- 排除规则 ---------------- */

test('shouldPruneEntry：tests/.git/.tmpcache/.bin/.cache 目录与 .DS_Store 文件被剪', () => {
  for (const name of ['test', 'tests', '.git', '.tmpcache', '.bin', '.cache']) assert.equal(shouldPruneEntry(name, 'dir'), true, name)
  for (const name of ['src', 'lib', 'dist', 'node_modules']) assert.equal(shouldPruneEntry(name, 'dir'), false, name)
  assert.equal(shouldPruneEntry('.DS_Store', 'file'), true)
  assert.equal(shouldPruneEntry('vitest.v2.config.ts', 'file'), true) // dev 工具配置面
  assert.equal(shouldPruneEntry('main.ts', 'file'), false)
})

/* ---------------- 依赖面纯函数 ---------------- */

test('dependencyNames：runtime 三段并集，devDependencies 不进', () => {
  assert.deepEqual(
    dependencyNames({ dependencies: { zod: '*' }, optionalDependencies: { fsevents: '*' }, peerDependencies: { hono: '*' }, devDependencies: { vitest: '*' } }).sort(),
    ['fsevents', 'hono', 'zod'],
  )
  assert.deepEqual(dependencyNames(null), [])
})

test('bareSpecifier：@scope/name 与裸名；相对/绝对/node:/bun: 归 null', () => {
  assert.equal(bareSpecifier('@studio-next/company'), '@studio-next/company')
  assert.equal(bareSpecifier('@studio-next/company/src/x.ts'), '@studio-next/company')
  assert.equal(bareSpecifier('zod'), 'zod')
  assert.equal(bareSpecifier('zod/v4'), 'zod')
  assert.equal(bareSpecifier('./x.ts'), null)
  assert.equal(bareSpecifier('/abs'), null)
  assert.equal(bareSpecifier('node:fs'), null)
  assert.equal(bareSpecifier('bun:sqlite'), null)
})

test('scanBareImports：from/import()/require 三形都收；tests 目录与 .md 不扫', () => {
  const root = tempRoot()
  mkdirSync(path.join(root, 'src/tests'), { recursive: true })
  writeFileSync(path.join(root, 'src/a.ts'), "import { x } from 'zod'\nconst y = await import('hono')\n")
  writeFileSync(path.join(root, 'src/b.mjs'), "const r = require('execa')\nimport './rel.ts'\n")
  writeFileSync(path.join(root, 'src/tests/t.ts'), "import 'vitest'\n")
  writeFileSync(path.join(root, 'src/notes.md'), "from 'should-not-count'\n")
  assert.deepEqual(scanBareImports(path.join(root, 'src')).sort(), ['execa', 'hono', 'zod'])
})

test('expandWorkspaces：`前缀/*` 直下含 package.json 的目录；无 package.json 的跳过', () => {
  const root = tempRoot()
  writeJson(path.join(root, 'apps/a/package.json'), { name: 'a' })
  mkdirSync(path.join(root, 'apps/notapkg/docs'), { recursive: true })
  writeJson(path.join(root, 'packages/b/package.json'), { name: 'b' })
  const ws = expandWorkspaces(root, { workspaces: ['apps/*', 'packages/*'] })
  assert.deepEqual(ws.map((d) => path.relative(root, d)).sort(), ['apps/a', 'packages/b'])
  assert.deepEqual(expandWorkspaces(root, {}), [])
})

test('resolvePackageDir：workspace 自带 node_modules 优先，逐级上溯到根', () => {
  const root = fakeRepo()
  assert.equal(resolvePackageDir(path.join(root, 'apps/daemon'), 'zod'), path.join(root, 'apps/daemon/node_modules/zod'))
  assert.equal(resolvePackageDir(path.join(root, 'apps/daemon'), '@studio-next/company'), path.join(root, 'apps/daemon/node_modules/@studio-next/company'))
  assert.equal(resolvePackageDir(path.join(root, 'packages/company'), 'yaml'), path.join(root, 'packages/company/node_modules/yaml'))
  assert.equal(resolvePackageDir(path.join(root, 'packages/company'), 'zod'), null) // 上溯只到根 node_modules（vitest/typescript），不可横跳 workspace
  assert.equal(resolvePackageDir(path.join(root, 'apps/daemon'), 'nope'), null)
  // store 内包（.bun/<p>@<v>/node_modules/<p>）解析其传递依赖＝同级邻居
  assert.equal(resolvePackageDir(path.join(root, 'node_modules/.bun/zod@1.0.0/node_modules/zod'), 'content-type'), path.join(root, 'node_modules/.bun/zod@1.0.0/node_modules/content-type'))
})

/* ---------------- 闭包（假 repo，不真跑大打包） ---------------- */

test('computeRuntimePlan：声明依赖＋静态 import 双种子；dev 面（vitest/typescript）被排除；绝对链接重写为相对', () => {
  const root = fakeRepo()
  const plan = computeRuntimePlan(root)

  const storeSet = new Set(plan.stores)
  assert.ok(storeSet.has('node_modules/.bun/zod@1.0.0/node_modules/zod'), 'zod store')
  assert.ok(storeSet.has('node_modules/.bun/zod@1.0.0/node_modules/content-type'), '传递依赖 content-type（.bun 同级邻居）')
  assert.ok(storeSet.has('node_modules/.bun/leftpad2@1.0.0/node_modules/leftpad2'), 'exports 子路径深进（@studio-next/api/x → x.ts）的依赖入闭包')
  assert.ok(storeSet.has('node_modules/.bun/yaml@2.0.0/node_modules/yaml'), 'yaml store')
  assert.ok(storeSet.has('node_modules/.bun/leftpad@0.1.0/node_modules/leftpad'), '未声明但被静态 import 的 leftpad')
  assert.ok(!storeSet.has('node_modules/.bun/vitest@3.0.0/node_modules/vitest'), 'dev 依赖 vitest 必须排除（testutil.ts 不可达）')
  assert.ok(!plan.stores.some((s) => s.includes('typescript')), '根 dev 面 typescript 必须排除')
  assert.ok(!storeSet.has('packages/company'), 'workspace 本体不入 stores（源码树来自 git archive，不走工作树拷贝）')

  const linkMap = new Map(plan.links.map((l) => [l.link, l.target]))
  assert.equal(linkMap.get('apps/daemon/node_modules/zod'), 'node_modules/.bun/zod@1.0.0/node_modules/zod')
  assert.equal(linkMap.get('apps/daemon/node_modules/@studio-next/company'), 'packages/company')
  assert.equal(linkMap.get('apps/daemon/node_modules/leftpad'), 'node_modules/.bun/leftpad@0.1.0/node_modules/leftpad')
  // 链接目标必须是相对路径可表达的仓内真实目录（无绝对路径/仓外目标）
  for (const target of linkMap.values()) assert.ok(!path.isAbsolute(target) && !target.startsWith('..'), `target 须为仓内相对：${target}`)
  // 无指向根 dev 面的链接
  assert.ok(!linkMap.has('node_modules/vitest') && !linkMap.has('node_modules/typescript'))
  assert.deepEqual(plan.warnings, []) // 假 repo 内全部可解析＝零警告
})

test('computeRuntimePlan：可达文件引用不存在的包＝warning；不可达文件（含测试件）静默不收编', () => {
  const root = fakeRepo()
  writeFileSync(path.join(root, 'apps/daemon/src/extra.ts'), "import 'ghost-pkg'\n") // 可达：main.ts 引它
  writeFileSync(path.join(root, 'apps/daemon/src/main.ts'), "import 'leftpad'\nimport { z } from 'zod'\nimport './extra.ts'\n")
  writeFileSync(path.join(root, 'apps/daemon/src/extra.test.ts'), "import 'ghost-test-only'\n") // 不可达：测试件
  writeFileSync(path.join(root, 'packages/company/src/orphan.ts'), "import 'ghost-orphan'\n") // 不可达：无人引用
  const plan = computeRuntimePlan(root)
  assert.ok(plan.warnings.some((w) => w.includes('ghost-pkg') && w.includes('静态引用')), plan.warnings.join('\n'))
  assert.ok(!plan.stores.some((s) => s.includes('ghost-pkg')))
  assert.ok(!plan.warnings.some((w) => w.includes('ghost-test-only') || w.includes('ghost-orphan')), `不可达面不得告警：${plan.warnings.join('\n')}`)
})

/* ---------------- 摘要 / 计数 ---------------- */

test('sha256File：已知内容摘要', () => {
  const root = tempRoot()
  const f = path.join(root, 'a.txt')
  writeFileSync(f, 'hello\n')
  assert.equal(sha256File(f), '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')
})

test('computeTreeDigest：内容/链接目标变即变；skip 名单跳过；countTree 计常规文件与符号链接', () => {
  const root = tempRoot()
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  writeFileSync(path.join(root, 'lib/a.js'), 'a\n')
  symlinkSync('../elsewhere', path.join(root, 'lib/lnk'))
  const d1 = computeTreeDigest(root, [])
  writeFileSync(path.join(root, 'lib/a.js'), 'a2\n')
  const d2 = computeTreeDigest(root, [])
  rmSync(path.join(root, 'lib/lnk'))
  symlinkSync('../other', path.join(root, 'lib/lnk'))
  const d3 = computeTreeDigest(root, [])
  assert.notEqual(d1, d2)
  assert.notEqual(d2, d3)
  assert.equal(d3, computeTreeDigest(root, []))
  // skip：manifest 自身不入摘要
  writeFileSync(path.join(root, 'dist-manifest.json'), '{"x":1}\n')
  assert.equal(computeTreeDigest(root), d3)
  const counts = countTree(root)
  assert.deepEqual([counts.fileCount, counts.symlinkCount], [3, 1])
  assert.equal(counts.sizeBytes, 3 + 8) // lib/a.js='a2\n'(3)＋dist-manifest.json(8)
})

/* ---------------- manifest ---------------- */

function manifestFixture() {
  return buildManifest({
    name: 'studio-next',
    version: '0.1.0',
    createdAt: '2026-11-21T12:00:00.000Z',
    commit: '5c5cd402b28a3d9eef83cb2a528eda6090dc8e3d',
    short: '5c5cd40',
    commitTime: '2026-11-21T08:00:00.000+08:00',
    branch: 'main',
    dirty: false,
    artifactFile: 'studio-next-0.1.0-5c5cd40.tgz',
    fileCount: 1234,
    symlinkCount: 20,
    treeSizeBytes: 5678,
    treeDigest: 'a'.repeat(64),
    runtimePackages: 12,
    nodeVersion: 'v25.6.1',
    platform: 'darwin-arm64',
  })
}

test('buildManifest/validateManifest：字段齐全即过；逐字段破坏逐条报', () => {
  const good = manifestFixture()
  assert.deepEqual(validateManifest(good), [])

  const cases = [
    ['schema', 'studio-next/wrong/v1', /schema/],
    ['version', '', /version/],
    ['createdAt', 'not-a-date', /createdAt/],
  ]
  for (const [key, value, re] of cases) {
    const m = { ...good, [key]: value }
    assert.ok(validateManifest(m).some((i) => re.test(i)), `${key} 破坏须报`)
  }
  const badGit = { ...good, git: { ...good.git, commit: 'xyz', short: '5c5cd40' } }
  assert.ok(validateManifest(badGit).some((i) => i.includes('git.commit')), 'commit 非 hex 须报')
  const badShort = { ...good, git: { ...good.git, short: 'deadbee' } }
  assert.ok(validateManifest(badShort).some((i) => i.includes('git.short')), 'short 非 commit 前缀须报')
  const badTree = { ...good, tree: { ...good.tree, treeDigest: 'zz', fileCount: 0, sizeBytes: -1 } }
  assert.equal(validateManifest(badTree).filter(Boolean).length >= 3, true)
  assert.deepEqual(validateManifest(null), ['manifest 非对象'])
})

test('renderInstallMd：三步齐全＋tarball 名/版本入文；schema 常量单一源', () => {
  const md = renderInstallMd({ version: '0.1.0', short: '5c5cd40', tgzName: 'studio-next-0.1.0-5c5cd40.tgz' })
  assert.ok(md.includes('tar -xzf studio-next-0.1.0-5c5cd40.tgz'))
  assert.ok(md.includes('stack doctor'))
  assert.ok(md.includes('stack up --apply'))
  assert.ok(md.includes('--platform localfile'))
  assert.ok(md.includes('.sha256'))
  assert.equal(MANIFEST_SCHEMA, 'studio-next/dist-manifest/v1')
  assert.ok(toPosix('a/b/c').includes('/'))
})
