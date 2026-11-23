/**
 * fingerprint-core.mjs —— 控制变量指纹（纯函数 + 只读文件访问）
 *
 * 指纹 = 对「会改变被测模型行为或判分结果」的全部字节做 sha256：harness（run.mjs / judge.mjs / lib/**）、
 * 每个任务的 prompt.md（原件 + 渲染后 = 模型实际看到的字节）、check.mjs、fixtures/ 全树。跨批次比较时
 * 任一指纹变化 = 控制变量未对齐（docs/quality/benchmark-business-eval.md §4）。
 * 不含任何绝对路径，产物可随报告归档。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { listTasks, renderPromptFile } from '../../lib/tasks.mjs'

export const FINGERPRINT_SCHEMA = 'model-eval-fingerprint/v1'

/** 分析工具自身不影响被测行为，排除在 harness 指纹之外。 */
export const ANALYSIS_DIRS = Object.freeze(['benchmark'])

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function listFiles(root, base = root) {
  const out = []
  if (!existsSync(root)) return out
  for (const name of readdirSync(root).sort()) {
    if (name === '.DS_Store') continue
    const abs = join(root, name)
    const rel = (abs.slice(base.length + 1)).split('\\').join('/')
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs, base))
    else out.push(rel)
  }
  return out
}

/**
 * 目录树指纹：{ fileCount, sha256, files:[{rel, sha256}] }。skip = 不纳入的顶层相对路径前缀。
 */
export function hashTree(root, { skip = [] } = {}) {
  const skipped = (rel) => skip.some((p) => rel === p || rel.startsWith(`${p}/`))
  const files = listFiles(root).filter((rel) => !skipped(rel))
  const entries = files.map((rel) => ({ rel, sha256: sha(readFileSync(join(root, rel))) }))
  return { fileCount: entries.length, sha256: sha(entries.map((e) => `${e.rel}\u0000${e.sha256}\n`).join('')), files: entries }
}

/** 评测台目录 → 指纹对象（不含绝对路径）。 */
export function fingerprintEvalDir(evalDir) {
  const harness = hashTree(evalDir, { skip: ['tasks', ...ANALYSIS_DIRS] })
  const tasks = {}
  for (const t of listTasks(join(evalDir, 'tasks'))) {
    const tree = hashTree(t.dir)
    const fixturesDir = join(t.dir, 'fixtures')
    const fixtures = hashTree(fixturesDir)
    tasks[t.id] = {
      slug: t.slug,
      fileCount: tree.fileCount,
      sha256: tree.sha256,
      prompt: sha(readFileSync(join(t.dir, 'prompt.md'))),
      promptRendered: sha(renderPromptFile(join(t.dir, 'prompt.md'))),
      check: sha(readFileSync(join(t.dir, 'check.mjs'))),
      fixtures: { fileCount: fixtures.fileCount, sha256: fixtures.sha256 },
    }
  }
  const all = hashTree(evalDir, { skip: [...ANALYSIS_DIRS] })
  return {
    schema: FINGERPRINT_SCHEMA,
    evalDir: basename(evalDir),
    harness: { fileCount: harness.fileCount, sha256: harness.sha256 },
    tasks,
    all: { fileCount: all.fileCount, sha256: all.sha256 },
  }
}

/** 两份指纹的差异说明（空数组 = 一致）。 */
export function diffFingerprints(a, b) {
  const diffs = []
  if (a?.harness?.sha256 !== b?.harness?.sha256) diffs.push(`harness（run.mjs/judge.mjs/lib）${a?.harness?.sha256 ? '变了' : '缺失'}`)
  const ids = [...new Set([...Object.keys(a?.tasks ?? {}), ...Object.keys(b?.tasks ?? {})])].sort()
  for (const id of ids) {
    const x = a?.tasks?.[id]
    const y = b?.tasks?.[id]
    if (!x || !y) {
      diffs.push(`任务 ${id} ${x ? '在参照中缺失' : '新增'}`)
      continue
    }
    const parts = []
    if (x.promptRendered !== y.promptRendered) parts.push('任务书（渲染后）')
    if (x.check !== y.check) parts.push('check.mjs')
    if (x.fixtures?.sha256 !== y.fixtures?.sha256) parts.push('fixtures')
    if (parts.length > 0) diffs.push(`任务 ${id}：${parts.join(' / ')}变了`)
  }
  return diffs
}
