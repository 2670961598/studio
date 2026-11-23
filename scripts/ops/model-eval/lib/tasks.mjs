/**
 * tasks.mjs —— 任务集发现 / prompt 渲染 / 工位准备 / check.mjs 加载
 *
 * 任务目录约定（docs/quality/model-eval.md §2）：
 *   tasks/<slug>/prompt.md   给被测模型的完整任务文本；支持一行指令
 *                            `{{include:fixtures/xxx.md}}`（相对本目录，单层展开；长上下文任务用）
 *   tasks/<slug>/fixtures/   工位初始内容（整目录原样复制到临时工位根）。两种布局：
 *                            只读输入类（t01/t03/t04/t06）：输入放在 fixtures/fixtures/ 下，工位里即
 *                            `fixtures/…`（任务书写 fixtures/xxx.md，check 用 fixturesUnchanged 核对）；
 *                            工作树类（t02/t05）：fixtures/ 本身就是工作树，拷到工位根。
 *   tasks/<slug>/check.mjs   导出 check(ctx)（确定性判分）与可选 rubric（LLM 裁判评分依据）
 * 目录名以 `.`/`_` 开头的不是任务。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { UsageError } from './args.mjs'

const INCLUDE_RE = /\{\{\s*include:\s*([^\s}]+)\s*\}\}/g

/** 列出任务目录下的全部任务（按目录名排序；id = 目录名首段，如 t01）。 */
export function listTasks(tasksDir) {
  if (!existsSync(tasksDir)) throw new Error(`任务目录不存在：${tasksDir}`)
  const out = []
  for (const name of readdirSync(tasksDir).sort()) {
    const dir = resolve(tasksDir, name)
    if (name.startsWith('.') || name.startsWith('_')) continue
    if (!statSync(dir).isDirectory()) continue
    if (!existsSync(resolve(dir, 'prompt.md')) || !existsSync(resolve(dir, 'check.mjs'))) continue
    out.push({ id: name.split('-')[0].toLowerCase(), slug: name, dir })
  }
  return out
}

/**
 * 按请求筛任务：接受 id（t01）、目录名（t01-ticket-report）或唯一前缀（不分大小写）；保持目录序。
 * 未知/不唯一 → UsageError。
 */
export function resolveTasks(tasks, requested) {
  if (requested === null || requested.length === 0) return [...tasks]
  const picked = new Set()
  for (const wantRaw of requested) {
    const want = String(wantRaw).trim().toLowerCase()
    const exact = tasks.filter((t) => t.id === want || t.slug === want)
    const prefix = exact.length > 0 ? exact : tasks.filter((t) => t.slug.startsWith(`${want}-`))
    if (prefix.length === 1) picked.add(prefix[0])
    else if (prefix.length > 1) throw new UsageError(`任务前缀不唯一：${want}`)
    else throw new UsageError(`未知任务：${want}（可用：${tasks.map((t) => t.id).join(', ')}）`)
  }
  return tasks.filter((t) => picked.has(t))
}

/** 读 prompt.md 并展开 `{{include:…}}`（越界/缺文件即抛——评测材料不齐不发车）。 */
export function renderPromptFile(file) {
  const base = resolve(dirname(file))
  const text = readFileSync(file, 'utf8')
  return text.replace(INCLUDE_RE, (_m, rel) => {
    const target = resolve(base, rel)
    if (!target.startsWith(`${base}${sep}`)) throw new Error(`include 越界：${rel}（prompt=${file}）`)
    if (!existsSync(target)) throw new Error(`include 目标不存在：${rel}（prompt=${file}）`)
    return readFileSync(target, 'utf8').replace(/\s+$/, '')
  })
}

/**
 * 准备工位：建临时目录、整拷 fixtures 到工位根、realpath（macOS /tmp→/private/tmp，否则 dsh
 * workspace-write 写域与真实路径不一致）。
 * @returns {{ dir: string, fixturesSource: string|null }}
 */
export function prepareWorkdir(task, workdir) {
  mkdirSync(workdir, { recursive: true })
  const src = resolve(task.dir, 'fixtures')
  if (existsSync(src)) cpSync(src, workdir, { recursive: true })
  return { dir: realpathSync(workdir), fixturesSource: existsSync(src) ? src : null }
}

/** 动态加载任务的 check.mjs：{ check(ctx), rubric: string|null }。 */
export async function loadCheck(task) {
  const mod = await import(pathToFileURL(resolve(task.dir, 'check.mjs')).href)
  if (typeof mod.check !== 'function') throw new Error(`${task.slug}/check.mjs 未导出 check(ctx)`)
  return { check: mod.check, rubric: typeof mod.rubric === 'string' ? mod.rubric : null }
}
