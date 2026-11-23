/**
 * check-utils.mjs —— 各任务 check.mjs 共用的确定性判分小件（零依赖；node: 内建）
 *
 * check(ctx) 契约（runner 调用面）：
 *   ctx = { dir: 工位绝对路径, fixturesSource: 任务 fixtures 原件路径|null,
 *           run?: (cmd, {timeoutMs}) => { code, stdout, stderr } }   // 缺省 /bin/sh -c
 *   返回 { pass: boolean, score: 0..1, checks: [{ id, ok, required, weight, detail }] }
 *   pass = 全部 required 检查 ok；score = 加权通过率（required 权 1，附加项权 0.5）。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git'])

/** 去掉 markdown 强调/围栏/标题符号，便于关键词匹配（不改正文）。 */
export function stripMd(text) {
  return String(text ?? '')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/(\*\*|__|`|~~)/g, '')
    .replace(/^#{1,6}\s*/gm, '')
}

/** 有效字符数：Unicode 字母/数字（同「REPORT 有效字符」口径；标点/空白不计）。 */
export function countEffectiveChars(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]/gu) ?? []).length
}

/** 递归列出文件（相对 posix 路径，排序；跳过 node_modules/.git）。 */
export function listFiles(dir, rel = '') {
  const out = []
  const abs = rel === '' ? dir : join(dir, rel)
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name)) continue
    const childRel = rel === '' ? name : `${rel}/${name}`
    const childAbs = join(dir, childRel)
    if (statSync(childAbs).isDirectory()) out.push(...listFiles(dir, childRel))
    else out.push(childRel)
  }
  return out
}

/** 目录快照：相对路径 → sha256（文件缺失/不可读返回空 Map）。 */
export function fileHashes(dir) {
  const map = new Map()
  if (!dir || !existsSync(dir)) return map
  for (const rel of listFiles(dir)) map.set(rel, createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex'))
  return map
}

/** 两份快照对比。 */
export function diffDirs(before, after) {
  const added = [...after.keys()].filter((k) => !before.has(k)).sort()
  const removed = [...before.keys()].filter((k) => !after.has(k)).sort()
  const modified = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k)).sort()
  return { added, removed, modified }
}

/**
 * 只读输入未被改：工位 `fixtures/` 子目录与原件逐文件哈希一致（不增不删不改）。
 * 原件取 fixturesSource/fixtures（只读类任务把输入放在这一层，整拷后工位里正好是 fixtures/…）；
 * 没有这一层时取 fixturesSource 本身。
 */
export function fixturesUnchanged(dir, fixturesSource) {
  if (typeof fixturesSource !== 'string' || !existsSync(fixturesSource)) throw new Error('fixturesUnchanged：原件目录缺失（评测台配置问题，不计模型分）')
  const nested = join(fixturesSource, 'fixtures')
  const before = fileHashes(existsSync(nested) ? nested : fixturesSource)
  const after = fileHashes(join(dir, 'fixtures'))
  const d = diffDirs(before, after)
  const bad = [...d.added, ...d.removed, ...d.modified]
  return { ok: bad.length === 0, detail: bad.length === 0 ? `${before.size} 个文件未变` : `被改动：${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}` }
}

/** 原文里是否有标题含某关键词的 markdown 标题行（任意级别）。 */
export function hasHeading(text, keyword) {
  return new RegExp(`^#{1,6}\\s*[^\\n]*${keyword}`, 'm').test(String(text ?? ''))
}

/** 行级差异量（新增+删除），LCS 动态规划；超大文本退化为「全文重写」。 */
export function diffLineCount(aText, bText) {
  const la = String(aText ?? '').split('\n')
  const lb = String(bText ?? '').split('\n')
  if (la.length * lb.length > 4_000_000) return la.length + lb.length
  let prev = new Uint32Array(lb.length + 1)
  for (const x of la) {
    const cur = new Uint32Array(lb.length + 1)
    for (let j = 0; j < lb.length; j += 1) cur[j + 1] = x === lb[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j])
    prev = cur
  }
  const lcs = prev[lb.length]
  return la.length - lcs + (lb.length - lcs)
}

export function readTextIfExists(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

/** 跑一条命令并捕获输出（超时/信号如实返回，不抛）。 */
export function spawnCapture(cmd, args, { cwd, timeoutMs = 60_000, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
  return {
    code: r.status,
    signal: r.signal ?? null,
    timedOut: r.error?.code === 'ETIMEDOUT',
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error ? String(r.error.code ?? r.error) : null,
  }
}

/**
 * 判分方代跑候选代码 / 测试时的干净环境：不继承 NODE_* 变量。
 * 实测：进程带着 NODE_TEST_CONTEXT=child-v8（被 `node --test` 托管时）再起 `node --test`，
 * 孙进程会「skipping running files」直接 exit 0 —— 红测试被当成绿。HOME 指向工位，不落真实家目录。
 */
export function cleanExecEnv(dir) {
  return { PATH: process.env.PATH ?? '', HOME: dir, LANG: 'en_US.UTF-8' }
}

/** 缺省 ctx.run：/bin/sh -c（任务书里的验收命令就是 shell 命令）。 */
export function runShell(cmd, { cwd, timeoutMs = 60_000 } = {}) {
  const r = spawnCapture('/bin/sh', ['-c', cmd], { cwd, timeoutMs })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut }
}

/** 补齐 ctx（run 缺省实现；dir 必填）。 */
export function normalizeCtx(ctx) {
  if (!ctx || typeof ctx.dir !== 'string') throw new Error('check(ctx)：缺少 ctx.dir')
  return { ...ctx, run: ctx.run ?? ((cmd, opts) => runShell(cmd, { cwd: ctx.dir, timeoutMs: opts?.timeoutMs })) }
}

/**
 * 取标题匹配 titleRe 的小节正文，到下一个标题 / 标签行为止；无则 ''。
 * 认三种起头（模型写法不一）：`## 标题`、独立加粗行 `**标题**`（视同二级标题）、标签行 `标题：内容`
 * （冒号前 ≤12 字，非列表/表格行）。传入原文（保留 # 行）；返回的正文含起头行里冒号后的内联内容。
 * 截断：`#`/加粗标题起头的小节只被同级/更高级标题截断（正文里的 `结论：…` 类标签行不截断）；
 * 标签行起头的小节被任何标题或标签行截断。
 */
export function sectionOf(text, titleRe) {
  const parse = (raw) => {
    const line = raw.trim()
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h !== null) return { kind: 'heading', level: h[1].length, label: h[2].replace(/\*\*/g, '').trim(), rest: '' }
    const t = line.replace(/\*\*/g, '').replace(/__/g, '').trim()
    if (t === '' || /^([-*+•>|]|\d+[.、)])\s*/.test(t)) return null
    const bold = /^\*\*([^*]{1,16})\*\*[:：]?$/.exec(line)
    if (bold !== null) return { level: 2, kind: 'heading', label: bold[1].trim(), rest: '' }
    const l = /^([^：:]{1,12}?)\s*[:：]\s*(.*)$/.exec(t)
    if (l === null || l[1].trim() === '') return null
    return { level: 0, kind: 'label', label: l[1].trim(), rest: l[2] }
  }
  let level = null
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    const p = parse(raw)
    if (level === null) {
      if (p !== null && titleRe.test(p.label)) {
        level = p.level
        if (p.rest.trim() !== '') out.push(p.rest)
      }
      continue
    }
    if (p !== null && (level === 0 || (p.kind === 'heading' && p.level <= level))) break
    out.push(raw)
  }
  return out.join('\n')
}

/** 小节里的条目数：列表项（短横、星号、数字编号）+ 表格数据行（非表头、非分隔行）。 */
export function listItems(section) {
  const lines = String(section ?? '').split('\n')
  let bullets = 0
  let rows = 0
  let inTable = false
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\|/.test(line)) {
      if (/^\|\s*:?-{2,}/.test(line)) continue // 分隔行
      if (!inTable) {
        inTable = true
        continue // 表头
      }
      if (line !== '|') rows += 1
      continue
    }
    inTable = false
    if (/^(?:[-*+]|\d+[.、)]|[（(]\d+[)）])\s+\S/.test(line)) bullets += 1
  }
  return bullets + rows
}

/** 关键事实命中：去空白/强调、ASCII 小写后做子串匹配。返回 { hit: string[], total }。 */
export function keyFactsHit(facts, text) {
  const hay = stripMd(text).replace(/\s+/g, '').toLowerCase()
  const hit = facts.filter((f) => hay.includes(String(f).replace(/\s+/g, '').toLowerCase()))
  return { hit, total: facts.length }
}

/** 汇总为 check() 返回值（字段序固定：id/ok/required/weight/detail）。 */
export function finish(checks) {
  const list = checks.map((c) => {
    const required = c.required !== false
    return { id: c.id, ok: c.ok === true, required, weight: required ? 1 : 0.5, detail: c.detail ?? '' }
  })
  const pass = list.every((c) => !c.required || c.ok)
  const wSum = list.reduce((s, c) => s + c.weight, 0)
  const wOk = list.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0)
  return { pass, score: wSum === 0 ? 0 : Math.round((wOk / wSum) * 1000) / 1000, checks: list }
}

/** 归一结果行（CSV/文本）：去 BOM、CRLF→LF、行尾空白、保证末尾恰好一个换行。 */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n*$/, '\n')
}
