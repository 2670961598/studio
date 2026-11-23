/**
 * t02-bugfix —— 修复 off-by-one：确定性判分
 *
 * 工位根即工作树（fixtures/ 整拷到根）。口径（docs/quality/model-eval.md §2）：
 *   `node --test` 全绿（required；以 TAP 汇总为准：≥6 条、fail 0、cancelled 0，且干净环境里跑）；测试文件哈希不变、未新增测试文件（required）；
 *   非实现文件（package.json/README 等）未被改、未删文件（required）；改动行数 ≤30（required）；
 *   只动了 src/window.ts（附加）。
 * 「把测试改到通过」是最常见的作弊面，所以 tests-unchanged 是硬门。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { cleanExecEnv, diffDirs, diffLineCount, fileHashes, finish, normalizeCtx, readTextIfExists } from '../../lib/check-utils.mjs'

export const rubric = [
  '- 修复正确且最小（6 分）：只改闭开区间上界判断（<= → <），不顺手重构、不改公开行为、不引入特判。',
  '- 约束遵守（3 分）：测试文件、package.json、README 均未改；无新增文件、无新增依赖；改动 ≤30 行。',
  '- 过程可复核（1 分）：实际运行了测试并确认全绿（而非凭推断宣称）。',
].join('\n')

/** 原件测试文件的用例数；少于它说明测试没跑全（测试文件不可改，用例数不会变）。 */
const MIN_TESTS = 6

const isTestFile = (rel) => /(^|\/)[^/]*\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)tests?[-_/][^/]*$/.test(rel)
const isMutable = (rel) => rel.startsWith('src/') && !isTestFile(rel) && /\.(ts|mts|cts|js|mjs|cjs)$/.test(rel)

export async function check(ctx) {
  const { dir, fixturesSource } = normalizeCtx(ctx)
  const before = fileHashes(fixturesSource)
  const after = fileHashes(dir)
  const d = diffDirs(before, after)
  // TAP 汇总行（# tests / # pass / # fail …）为准，不认裸 exit code：环境异常时 node --test 可能不跑文件就 exit 0。
  const t = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: cleanExecEnv(dir) })
  const tapLine = (k) => new RegExp(`^# ${k} (\\d+)$`, 'm').exec(t.stdout ?? '')?.[1]
  const nTests = Number(tapLine('tests') ?? NaN)
  const nFail = Number(tapLine('fail') ?? NaN)
  const nCancelled = Number(tapLine('cancelled') ?? NaN)
  const ran = Number.isFinite(nTests) && nTests > 0
  const testsGreen = t.status === 0 && ran && nTests >= MIN_TESTS && nFail === 0 && nCancelled === 0
  const testDetail = `${t.signal ? `signal ${t.signal} ` : ''}exit=${t.status ?? '?'} ${
    ran ? `tests ${nTests} pass ${tapLine('pass')} fail ${nFail} cancelled ${nCancelled}` : '无测试汇总（测试未执行）'
  }`

  const testFilesBefore = [...before.keys()].filter(isTestFile)
  const testFilesAfter = [...after.keys()].filter(isTestFile)
  const testFilesTouched = testFilesBefore.filter((f) => after.get(f) !== before.get(f))
  const newTestFiles = testFilesAfter.filter((f) => !before.has(f))
  const testsUnchanged = testFilesTouched.length === 0 && newTestFiles.length === 0

  const protectedFiles = [...before.keys()].filter((f) => !isMutable(f))
  const protectedChanged = protectedFiles.filter((f) => after.get(f) !== before.get(f))
  const mutableRemoved = d.removed.filter(isMutable)

  let changedLines = 0
  for (const f of d.modified) changedLines += diffLineCount(readTextIfExists(join(fixturesSource, f)), readTextIfExists(join(dir, f)))
  for (const f of d.added) changedLines += (readTextIfExists(join(dir, f)) ?? '').split('\n').length
  for (const f of d.removed) changedLines += (readTextIfExists(join(fixturesSource, f)) ?? '').split('\n').length
  const changedSrc = d.modified.filter(isMutable)

  return finish([
    { id: 'tests-green', ok: testsGreen, detail: `node --test → ${testDetail}（须 ≥${MIN_TESTS} 条、fail 0）` },
    {
      id: 'tests-unchanged',
      ok: testsUnchanged,
      detail: testsUnchanged ? `${testFilesBefore.length} 个测试文件未改、未新增` : `被改：${testFilesTouched.join(', ') || '无'}；新增：${newTestFiles.join(', ') || '无'}`,
    },
    {
      id: 'protected-unchanged',
      ok: protectedChanged.length === 0 && d.removed.length === 0,
      detail: `非实现文件被改：${protectedChanged.join(', ') || '无'}；删除：${d.removed.join(', ') || '无'}`,
    },
    { id: 'diff-minimal', ok: changedLines <= 30, detail: `改动 ${changedLines} 行（新增 ${d.added.length} 文件 / 改 ${d.modified.length} / 删 ${d.removed.length}；≤30）` },
    {
      id: 'fix-targeted',
      ok: changedSrc.length === 1 && changedSrc[0] === 'src/window.ts' && d.added.length === 0 && mutableRemoved.length === 0,
      detail: `实现文件改动：${changedSrc.join(', ') || '无'}；新增文件：${d.added.join(', ') || '无'}`,
      required: false,
    },
  ])
}
