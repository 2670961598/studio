#!/usr/bin/env node
/**
 * probe-ledger.mjs —— 探针台账机械校验（PRB- 编号统一 + PB-2/4/6 产物完整性）
 *
 * 依据：
 *   - docs/v2/12 §5.1/§5.2/§5.3：PRB- 编号唯一主表；P-78-01..16⇒PRB-01..16、
 *     P-82-01⇒PRB-23（旧号只允许出现在映射说明，不得作为探针主键）。
 *   - docs/v2/17 §五：PB-1..PB-6 批次划分与每批 PRB 归属（唯一批次源）。
 *   - docs/17-§6 收割四要件：完成只认落盘证据（命令 + 原始输出 + 时间戳 + 闸门 exit）。
 *
 * 校验面（任一不满足 → exit 1）：
 *   ① 主表 26 条 PRB 连续无缺号；PB 批次覆盖 26 条且无重复归属；
 *   ② PB-1..PB-6 每批 report.md / log-00-environment.txt 在且非空；
 *   ③ PB-2/4/6 每批 probe-status.json：行集合=批次归属、状态三值、证据文件在且非空、
 *      证据含 DATE=/FINGERPRINT=/$ 命令/EXIT=、executed 有结论、not-executed 缺什么；
 *   ④ 环境指纹可复算（log-00-environment.txt 去掉 FINGERPRINT= 行后 sha256）；
 *   ⑤ 报告状态总表与 probe-status.json 一致；报告含「环境指纹」「时间戳」「HEAD」；
 *   ⑥ PB-2/4/6 产物不得出现旧号 P-78-xx / P-82-xx（编号统一；旧号映射只许在 README）。
 *
 * 用法：
 *   node scripts/verify/probe-ledger.mjs [--root <仓根>] [--verbose]
 *   node scripts/verify/probe-ledger.mjs --self-test [--root <含 docs/v2 与 docs/probe 的根>]
 *
 * 边界：本脚本只做台账/证据机械校验，不跑探针、不判探针结论真伪（那由原始日志与
 *       独立采集者复核）；不修改任何文件（self-test 只在 /private/tmp 临时目录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const STATUSES = new Set(['executed', 'not-executed', 'not-applicable'])
const MACHINE_BATCHES = new Set(['2', '4', '6'])
const LEGACY_RE = /\bP-(?:78|82)-\d{2}\b/

function parseArgs(argv) {
  const out = { verbose: false, selfTest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') out.root = argv[++i]
    else if (a === '--verbose') out.verbose = true
    else if (a === '--self-test') out.selfTest = true
  }
  return out
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function nonEmptyFile(file) {
  try {
    return fs.statSync(file).size > 0
  } catch {
    return false
  }
}

function sectionOf(text, startRe, endRe) {
  const start = text.search(startRe)
  if (start < 0) return ''
  const rest = text.slice(start)
  const end = rest.search(endRe)
  return end < 0 ? rest : rest.slice(0, end)
}

function findDoc(root, prefix) {
  const dir = path.join(root, 'docs', 'v2')
  if (!fs.existsSync(dir)) return undefined
  const name = fs.readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith('.md'))
  return name === undefined ? undefined : path.join(dir, name)
}

export function loadSources(root) {
  const errors = []
  const v212 = findDoc(root, '12-')
  const v217 = findDoc(root, '17-')
  if (v212 === undefined) errors.push({ code: 'missing-doc', detail: 'docs/v2/12-*.md 不存在' })
  if (v217 === undefined) errors.push({ code: 'missing-doc', detail: 'docs/v2/17-*.md 不存在' })
  if (errors.length > 0) return { errors, prbIds: [], batches: new Map() }

  const text12 = readText(v212)
  const text17 = readText(v217)
  const prbSection = sectionOf(text12, /^## 五、探针清单/m, /^## 六、/m)
  const prbIds = [...prbSection.matchAll(/^\|\s*(PRB-\d{2})\s*\|/gm)].map((m) => m[1])

  const pbSection = sectionOf(text17, /^## 五、探针与真机/m, /^## 六、/m)
  const batches = new Map()
  for (const line of pbSection.split('\n')) {
    const m = /^\|\s*(PB-\d)\s+[^|]*\|\s*([^|]+)\|/.exec(line)
    if (m === null) continue
    // 批次单元格形如 `PRB-01/02/03`（后续编号省略 PRB- 前缀）；按 / 或 + 拆分后补前缀。
    const ids = m[2]
      .split(/[/+]/)
      .map((token) => token.trim())
      .filter((token) => token !== '')
      .map((token) => (/^PRB-\d{2}$/.test(token) ? token : `PRB-${token.padStart(2, '0')}`))
    batches.set(m[1].slice(3), ids)
  }
  return { errors, prbIds, batches }
}

function parseStatusTable(report) {
  const rows = new Map()
  const re = /^\|\s*(PRB-\d{2})\s*\|\s*\*{0,2}(executed|not-executed|not-applicable)\b/gm
  for (const m of report.matchAll(re)) {
    const id = m[1]
    const status = m[2]
    if (rows.has(id)) rows.set(id, `DUPLICATE:${status}`)
    else rows.set(id, status)
  }
  return rows
}

export function check(root, options = {}) {
  const errors = []
  const notes = []
  const sources = loadSources(root)
  errors.push(...sources.errors)
  const { prbIds, batches } = sources

  const expectedIds = Array.from({ length: 26 }, (_, i) => `PRB-${String(i + 1).padStart(2, '0')}`)
  if (prbIds.length !== 26) {
    errors.push({ code: 'prb-count', detail: `v2/12 §5.3 主表应 26 条，实得 ${prbIds.length}` })
  }
  const missingIds = expectedIds.filter((id) => !prbIds.includes(id))
  const extraIds = prbIds.filter((id) => !expectedIds.includes(id))
  if (missingIds.length > 0) errors.push({ code: 'prb-gap', detail: `主表缺号：${missingIds.join(',')}` })
  if (extraIds.length > 0) errors.push({ code: 'prb-extra', detail: `主表越界号：${extraIds.join(',')}` })
  if (new Set(prbIds).size !== prbIds.length) errors.push({ code: 'prb-duplicate', detail: '主表 PRB 编号重复' })

  const owner = new Map()
  for (const [pb, ids] of batches) {
    for (const id of ids) {
      if (owner.has(id)) {
        errors.push({ code: 'duplicate-prb', detail: `${id} 同时归属 PB-${owner.get(id)} 与 PB-${pb}` })
      } else {
        owner.set(id, pb)
      }
    }
  }
  for (const id of expectedIds) {
    if (!owner.has(id)) errors.push({ code: 'batch-coverage', detail: `${id} 未归属任何 PB 批次` })
  }

  const readme = path.join(root, 'docs', 'probe', 'README.md')
  if (!nonEmptyFile(readme)) {
    errors.push({ code: 'missing-readme', detail: 'docs/probe/README.md 不存在或为空' })
  } else {
    const text = readText(readme)
    for (const pb of ['PB-1', 'PB-2', 'PB-3', 'PB-4', 'PB-5', 'PB-6']) {
      if (!text.includes(pb)) errors.push({ code: 'readme-batch', detail: `README 缺批次 ${pb}` })
    }
    for (const id of expectedIds) {
      if (!text.includes(id)) errors.push({ code: 'readme-prb', detail: `README 缺 ${id}` })
    }
    if (!text.includes('P-78-01') || !text.includes('P-82-01')) {
      errors.push({ code: 'readme-mapping', detail: 'README 缺 v2/12 §5.2 旧号映射（P-78-01/P-82-01）' })
    }
  }

  for (const pb of ['1', '2', '3', '4', '5', '6']) {
    const dir = path.join(root, 'docs', 'probe', `pb-${pb}`)
    const reportPath = path.join(dir, 'report.md')
    const envPath = path.join(dir, 'log-00-environment.txt')
    if (!nonEmptyFile(reportPath)) {
      errors.push({ code: 'missing-report', detail: `pb-${pb}/report.md 不存在或为空` })
      continue
    }
    if (!nonEmptyFile(envPath)) {
      errors.push({ code: 'missing-environment', detail: `pb-${pb}/log-00-environment.txt 不存在或为空` })
    } else if (MACHINE_BATCHES.has(pb)) {
      const envText = readText(envPath)
      for (const marker of ['DATE=', 'HEAD=', 'HOST=', 'NODE=', 'BUN=', 'FINGERPRINT=']) {
        if (!envText.includes(marker)) {
          errors.push({ code: 'environment-marker', detail: `pb-${pb} 环境日志缺 ${marker}` })
        }
      }
    }

    const report = readText(reportPath)
    const expected = batches.get(pb) ?? []
    const statusRows = parseStatusTable(report)
    for (const id of expected) {
      if (!report.includes(id)) {
        errors.push({ code: 'report-missing-prb', detail: `pb-${pb}/report.md 未出现 ${id}` })
      }
      // 历史批次（PB-1/3/5）状态表列序与机器台账不同：只查 PRB 出现，不重解析其状态表。
      if (!MACHINE_BATCHES.has(pb)) continue
      const status = statusRows.get(id)
      if (status === undefined) {
        errors.push({ code: 'report-missing-status', detail: `pb-${pb}/report.md 状态总表缺 ${id}` })
      } else if (status.startsWith('DUPLICATE:')) {
        errors.push({ code: 'duplicate-status-row', detail: `pb-${pb}/report.md 状态总表 ${id} 重复` })
      } else if (!STATUSES.has(status)) {
        errors.push({ code: 'invalid-status', detail: `pb-${pb}/report.md ${id} 状态非三值：${status}` })
      }
    }

    if (MACHINE_BATCHES.has(pb)) {
      for (const marker of ['环境指纹', '时间戳', 'HEAD']) {
        if (!report.includes(marker)) {
          errors.push({ code: 'report-marker', detail: `pb-${pb}/report.md 缺 ${marker}` })
        }
      }
      for (const file of fs.readdirSync(dir)) {
        if (!/\.(?:md|txt|json)$/.test(file)) continue
        const text = readText(path.join(dir, file))
        if (LEGACY_RE.test(text)) {
          errors.push({ code: 'legacy-numbering', detail: `pb-${pb}/${file} 出现旧号（应为 PRB-）` })
        }
      }

      const statusPath = path.join(dir, 'probe-status.json')
      if (!nonEmptyFile(statusPath)) {
        errors.push({ code: 'missing-status-json', detail: `pb-${pb}/probe-status.json 不存在或为空` })
        continue
      }
      let statusJson
      try {
        statusJson = JSON.parse(readText(statusPath))
      } catch (error) {
        errors.push({ code: 'status-json-parse', detail: `pb-${pb}/probe-status.json 不是合法 JSON：${String(error)}` })
        continue
      }
      if (statusJson.batch !== `PB-${pb}`) {
        errors.push({ code: 'status-batch', detail: `pb-${pb}/probe-status.json batch=${String(statusJson.batch)}` })
      }
      const rows = Array.isArray(statusJson.rows) ? statusJson.rows : []
      const rowIds = rows.map((r) => r.id)
      if (new Set(rowIds).size !== rowIds.length) {
        errors.push({ code: 'status-duplicate-row', detail: `pb-${pb}/probe-status.json 行重复` })
      }
      for (const id of expected) {
        if (!rowIds.includes(id)) {
          errors.push({ code: 'status-missing-row', detail: `pb-${pb}/probe-status.json 缺 ${id}` })
        }
      }
      for (const id of rowIds) {
        if (!expected.includes(id)) {
          errors.push({ code: 'status-extra-row', detail: `pb-${pb}/probe-status.json 多出 ${id}` })
        }
      }

      const envText = nonEmptyFile(envPath) ? readText(envPath) : ''
      const fpLine = envText.split('\n').find((l) => l.startsWith('FINGERPRINT=')) ?? ''
      const fp = fpLine.slice('FINGERPRINT='.length)
      const recomputed = envText === ''
        ? ''
        : `sha256:${sha256(envText.split('\n').filter((l) => !l.startsWith('FINGERPRINT=')).join('\n'))}`
      if (fp === '' || fp !== recomputed) {
        errors.push({ code: 'fingerprint-mismatch', detail: `pb-${pb} 环境指纹不可复算（${fp || '缺'} != ${recomputed || '空'}）` })
      }
      const headLine = envText.split('\n').find((l) => l.startsWith('HEAD=')) ?? ''
      if (statusJson.environment?.fingerprint !== fp) {
        errors.push({ code: 'status-fingerprint', detail: `pb-${pb}/probe-status.json 指纹与环境日志不一致` })
      }
      if (statusJson.environment?.head !== headLine.slice('HEAD='.length)) {
        errors.push({ code: 'status-head', detail: `pb-${pb}/probe-status.json HEAD 与环境日志不一致` })
      }

      for (const row of rows) {
        if (!STATUSES.has(row.status)) {
          errors.push({ code: 'status-invalid', detail: `pb-${pb} ${row.id} status=${String(row.status)} 非三值` })
          continue
        }
        const reportStatus = statusRows.get(row.id)
        if (reportStatus !== row.status) {
          errors.push({
            code: 'status-mismatch',
            detail: `pb-${pb} ${row.id} 报告=${String(reportStatus)} JSON=${row.status}`,
          })
        }
        if (row.status === 'executed' && (typeof row.conclusion !== 'string' || row.conclusion.trim() === '')) {
          errors.push({ code: 'missing-conclusion', detail: `pb-${pb} ${row.id} executed 但缺 conclusion` })
        }
        if (row.status === 'not-executed' && (typeof row.missing !== 'string' || row.missing.trim() === '')) {
          errors.push({ code: 'missing-missing', detail: `pb-${pb} ${row.id} not-executed 但缺 missing` })
        }
        const evidence = Array.isArray(row.evidence) ? row.evidence : []
        if (evidence.length === 0) {
          errors.push({ code: 'missing-evidence', detail: `pb-${pb} ${row.id} 无证据文件（executed 不得无证）` })
        }
        for (const file of evidence) {
          const evidencePath = path.join(dir, file)
          if (!nonEmptyFile(evidencePath)) {
            errors.push({ code: 'missing-evidence', detail: `pb-${pb} ${row.id} 证据不存在/为空：${file}` })
            continue
          }
          const text = readText(evidencePath)
          for (const marker of ['DATE=', 'FINGERPRINT=', '$ ', 'EXIT=']) {
            if (!text.includes(marker)) {
              errors.push({ code: 'evidence-marker', detail: `pb-${pb} ${file} 缺 ${marker}` })
            }
          }
          if (!text.includes(`FINGERPRINT=${fp}`)) {
            errors.push({ code: 'evidence-fingerprint', detail: `pb-${pb} ${file} 指纹与环境日志不一致` })
          }
        }
      }
    }
  }

  return { errors, stats: { prbIds: prbIds.length, batches: batches.size } }
}

function printResult(result) {
  if (result.errors.length === 0) {
    console.log(`PASS probe-ledger：PRB=${result.stats.prbIds}/26，PB=${result.stats.batches}/6，PB-2/4/6 台账与证据齐`)
    return true
  }
  for (const error of result.errors) console.log(`FAIL ${error.code}：${error.detail}`)
  console.log(`probe-ledger 红：${result.errors.length} 项`)
  return false
}

function copyFixture(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const prefix of ['12-', '17-']) {
    const doc = findDoc(source, prefix)
    if (doc === undefined) throw new Error(`fixture source 缺 docs/v2/${prefix}*.md`)
    fs.mkdirSync(path.join(target, 'docs', 'v2'), { recursive: true })
    fs.copyFileSync(doc, path.join(target, 'docs', 'v2', path.basename(doc)))
  }
  const probeSrc = path.join(source, 'docs', 'probe')
  const probeDst = path.join(target, 'docs', 'probe')
  fs.mkdirSync(probeDst, { recursive: true })
  fs.copyFileSync(path.join(probeSrc, 'README.md'), path.join(probeDst, 'README.md'))
  for (const pb of ['1', '2', '3', '4', '5', '6']) {
    fs.cpSync(path.join(probeSrc, `pb-${pb}`), path.join(probeDst, `pb-${pb}`), { recursive: true })
  }
}

function runSelfTest(source) {
  const base = fs.mkdtempSync('/private/tmp/probe-ledger-selftest-')
  const pristine = path.join(base, 'pristine')
  copyFixture(source, pristine)

  const cases = [
    {
      name: 'baseline-green',
      expected: null,
      mutate: () => {},
    },
    {
      name: 'missing-report-red',
      expected: 'missing-report',
      mutate: (root) => fs.rmSync(path.join(root, 'docs/probe/pb-2/report.md')),
    },
    {
      name: 'forged-executed-no-evidence-red',
      expected: 'missing-evidence',
      mutate: (root) => {
        const file = path.join(root, 'docs/probe/pb-2/probe-status.json')
        const json = JSON.parse(fs.readFileSync(file, 'utf8'))
        json.rows.find((r) => r.id === 'PRB-07').evidence = []
        fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
      },
    },
    {
      name: 'status-mismatch-red',
      expected: 'status-mismatch',
      mutate: (root) => {
        const file = path.join(root, 'docs/probe/pb-2/report.md')
        const text = fs.readFileSync(file, 'utf8')
        fs.writeFileSync(file, text.replace('| PRB-07 | **executed**', '| PRB-07 | **not-executed**'))
      },
    },
    {
      name: 'legacy-numbering-red',
      expected: 'legacy-numbering',
      mutate: (root) => {
        const file = path.join(root, 'docs/probe/pb-2/report.md')
        fs.appendFileSync(file, '\n旧号残留 P-78-01\n')
      },
    },
    {
      name: 'duplicate-prb-red',
      expected: 'duplicate-prb',
      mutate: (root) => {
        const doc = findDoc(root, '17-')
        const text = fs.readFileSync(doc, 'utf8')
        fs.writeFileSync(doc, text.replace('PRB-10/11/12/15/16', 'PRB-10/11/12/15/16/PRB-07'))
      },
    },
  ]

  let failed = 0
  for (const testCase of cases) {
    const dir = path.join(base, testCase.name)
    fs.cpSync(pristine, dir, { recursive: true })
    testCase.mutate(dir)
    const result = check(dir)
    const ok = testCase.expected === null
      ? result.errors.length === 0
      : result.errors.some((e) => e.code === testCase.expected)
    if (!ok) {
      failed += 1
      console.log(`SELFTEST ${testCase.name} FAIL（期望 ${testCase.expected ?? 'green'}，实得 ${result.errors.map((e) => e.code).join(',') || 'green'}）`)
    } else {
      console.log(`SELFTEST ${testCase.name} PASS`)
    }
  }
  fs.rmSync(base, { recursive: true, force: true })
  return failed === 0
}

const args = parseArgs(process.argv.slice(2))
const root = path.resolve(args.root ?? process.cwd())
if (args.selfTest) {
  const ok = runSelfTest(root)
  process.exit(ok ? 0 : 1)
}
const result = check(root, { verbose: args.verbose })
const ok = printResult(result)
process.exit(ok ? 0 : 1)
