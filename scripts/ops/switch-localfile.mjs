#!/usr/bin/env node
/**
 * switch-localfile —— M2.5 单子自研切换·切换脚本（Taiga → LocalFile；task-131/134 续作）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M2.5（切换预演与切换脚本）
 *   - docs/sentinel-logs/单子自研切换-runbook-2026-11-19.md §十 切换日清单（T-1d 预检→T0
 *     切换窗→T0..T+24h 双跑）、§五 回滚（窗口期 Taiga 只读=事实源未动，回滚=改配置行不反迁）
 *   - SEC-WD-02（apps/daemon/src/assembly/serve/config.ts）：daemon.yaml `platform` 与
 *     org-config `company.platform` 不一致=拒启——**两文件必须同刀改**，本脚本不做单边切换。
 *
 * 形态：node 原生、零第三方依赖（node:fs/node:path + 全局 fetch 探活）。三种模式：
 *   --dry-run（缺省）  打印完整切换计划与检查项，零副作用（不写/不备份/不改任何文件）
 *   --apply            备份（时间戳）→ 原子改 platform: localfile + platformDir → 打印重启
 *                      与验证命令。**不自行重启生产**——重启归部署面（guardian/boot-start.sh）。
 *                      默认禁用：须显式 `--i-understand` 才放行（生产写入确认位）。
 *   --rollback         用最近一次备份恢复两配置 + 打印重启命令（备份不删，留审计）。
 *
 * 配置键名以 daemon 代码为准（任务书 M2.5 明示）：LocalFile 平台根=`platformDir`
 * （apps/daemon/src/assembly/serve/config.ts:468 / config-types.ts:267 / wire.ts:259；
 * 缺省 `<rootDir>/platform`）——**不是** platformRoot。
 *
 * 编辑安全（fail-closed，不半写）：
 *   - 只动目标行：daemon.yaml 的 `platform:` 行（值替换，行内注释保留）+
 *     `platformDir:` 行（在则替换值/不在则 platform 行后插一行）；org-config.yaml 的
 *     `company:` 段下 `  platform:` 行（值替换，缩进与行内注释保留）。其余行逐字节不动
 *     （编辑前后逐行比对断言，越线即中止）。
 *   - 原子写：写同目录临时文件 → renameSync 覆盖（同卷原子）；写前先对新内容做
 *     扁平 YAML 子集复 parse 校验（platform=localfile、platformDir=目标根），失败不落盘。
 *   - 平台树校验先行：issues/*.jsonl 逐行事件形状 + ID 唯一 + meta/fields.json provision +
 *     activity.jsonl 单调 id——任一失败在**任何写动作之前**中止。
 *
 * 退出码：0=成功（dry-run 打印计划/apply 完成/rollback 完成）；1=校验失败或执行中断
 *        （不半写——已备份未改则原样保留）；2=用法错误（含 --apply 缺 --i-understand）。
 *
 * 用法：
 *   node scripts/ops/switch-localfile.mjs --daemon-yaml <p> --org-config <p> \
 *        --platform-root <p> [--dry-run]
 *   node scripts/ops/switch-localfile.mjs ... --apply --i-understand
 *   node scripts/ops/switch-localfile.mjs --daemon-yaml <p> --org-config <p> --rollback
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PROG = 'switch-localfile'
const BACKUP_TAG = 'bak-switch-localfile'
/** 预演实测（2026-11-19 拷贝公司预演，docs/sentinel-logs/单子切换预演-2026-11-19.md §三）：
 *  boot→healthz ok=649ms、SIGINT 优雅停 drain=57ms（1554 单树+空台账）——停机预估的实测锚点。 */
const REHEARSAL = { bootToHealthzMs: 649, drainMs: 57 }
/** 切换窗停机预估系数：实测值 × 余量（生产 ledger 更大/冷缓存/文件系统抖动） */
const DOWNTIME_MARGIN = 3

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

function usage(message) {
  if (message !== undefined) console.error(`${PROG}: ${message}`)
  console.error(`用法：
  ${PROG} --daemon-yaml <daemon.yaml> --org-config <org-config.yaml> --platform-root <平台根> [--dry-run]
  ${PROG} --daemon-yaml <daemon.yaml> --org-config <org-config.yaml> --platform-root <平台根> --apply --i-understand
  ${PROG} --daemon-yaml <daemon.yaml> --org-config <org-config.yaml> --rollback

模式：--dry-run（缺省，零副作用）/ --apply（需 --i-understand）/ --rollback（用最近备份恢复）`)
}

function parseArgs(argv) {
  const out = { mode: 'dry-run', daemonYaml: '', orgConfig: '', platformRoot: '', iUnderstand: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      i += 1
      const v = argv[i]
      if (v === undefined || v.startsWith('--')) throw new Error(`参数 ${a} 缺值`)
      return v
    }
    if (a === '--dry-run') out.mode = 'dry-run'
    else if (a === '--apply') out.mode = 'apply'
    else if (a === '--rollback') out.mode = 'rollback'
    else if (a === '--i-understand') out.iUnderstand = true
    else if (a === '--daemon-yaml') out.daemonYaml = next()
    else if (a === '--org-config') out.orgConfig = next()
    else if (a === '--platform-root') out.platformRoot = next()
    else if (a === '--help' || a === '-h') {
      usage()
      process.exit(0)
    } else throw new Error(`未知参数 ${a}`)
  }
  if (out.daemonYaml === '') throw new Error('缺 --daemon-yaml <daemon.yaml>')
  if (out.orgConfig === '') throw new Error('缺 --org-config <org-config.yaml>')
  if (out.platformRoot === '' && out.mode !== 'rollback') throw new Error(`缺 --platform-root <平台根>（${out.mode} 模式必填）`)
  if (out.mode === 'apply' && !out.iUnderstand) {
    usage('--apply 默认禁用：生产写入须显式 --i-understand（切换窗内人工确认）')
    process.exit(2)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 通用                                                                */
/* ------------------------------------------------------------------ */

/** 本地时区时间戳（备份文件名用；与生产既有 *.bak-<tag>-<ts> 命名同构） */
function timestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fail(message, code = 1) {
  console.error(`${PROG}: FAIL ${message}`)
  process.exit(code)
}

const section = (title) => console.log(`\n===== ${title} =====`)

/** 扁平 YAML 子集行解析（与 daemon config.ts parseDaemonConfig 同口径：只收
 *  `key: value` 标量行；空值/嵌套/列表=结构错误——本工具编辑安全的前置断言） */
function parseFlatLine(line, file, lineNo) {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'skip' }
  const idx = trimmed.indexOf(':')
  if (idx <= 0) return { kind: 'bad', error: `${file} 第 ${lineNo} 行不是扁平 key: value：${line}` }
  const key = trimmed.slice(0, idx).trim()
  const valueRaw = trimmed.slice(idx + 1).trim()
  if (valueRaw === '' || valueRaw.startsWith('#')) return { kind: 'bad', error: `${file} 第 ${lineNo} 行 value 为空（不收嵌套/空值）：${line}` }
  if (/^[\[{]|^\s*-/.test(valueRaw)) return { kind: 'bad', error: `${file} 第 ${lineNo} 行是嵌套/列表值：${line}` }
  return { kind: 'kv', key, value: valueRaw.split(' #')[0].trim().replace(/^['"]|['"]$/g, '') }
}

/** 整文件扁平子集 parse：返回逐行结果（保序；重复键检出——daemon 语义=后者覆盖，切换面=拒歧义） */
function parseFlatYaml(text, file) {
  const lines = text.split(/\r?\n/)
  const rows = []
  const seen = new Map()
  for (let i = 0; i < lines.length; i += 1) {
    const r = parseFlatLine(lines[i] ?? '', file, i + 1)
    if (r.kind === 'bad') throw new Error(r.error)
    if (r.kind === 'kv') {
      if (seen.has(r.key)) throw new Error(`${file}：键 ${r.key} 出现多次（第 ${seen.get(r.key)} 与 ${i + 1} 行）——切换面拒歧义`)
      seen.set(r.key, i + 1)
      rows.push({ ...r, lineNo: i + 1, raw: lines[i] ?? '' })
    }
  }
  return { lines, rows }
}

const PLATFORM_LINE = /^(\s*)platform(\s*):(\s*)(\S+?)(\s*#.*)?$/
const PLATFORM_DIR_LINE = /^(\s*)platformDir(\s*):(.*)$/

/** 拆行内注释：`value  # note` → { value, comment }（value 去引号；comment 含前导空白） */
function splitValueComment(rest) {
  const m = /^(\s*)(\S+?)(\s*#.*)?$/.exec(rest)
  if (m === null) return { space: ' ', value: rest.trim(), comment: '' }
  return { space: m[1] === '' ? ' ' : m[1], value: m[2].replace(/^['"]|['"]$/g, ''), comment: m[3] ?? '' }
}

/* ------------------------------------------------------------------ */
/* daemon.yaml 编辑计划                                                */
/* ------------------------------------------------------------------ */

/** 计算 daemon.yaml 编辑后行集（不落盘）。返回 { lines, changes[], alreadyLocal, addDir } */
function planDaemonEdit(text, platformRoot, file) {
  const parsed = parseFlatYaml(text, file)
  const platformHits = []
  let dirHit = -1
  for (let i = 0; i < parsed.lines.length; i += 1) {
    const line = parsed.lines[i] ?? ''
    if (PLATFORM_LINE.test(line)) platformHits.push(i)
    if (PLATFORM_DIR_LINE.test(line)) dirHit = i
  }
  if (platformHits.length !== 1) {
    throw new Error(`${file}：platform: 行须恰有一行（实得 ${platformHits.length}）——切换面拒歧义`)
  }
  const pi = platformHits[0]
  const pm = PLATFORM_LINE.exec(parsed.lines[pi] ?? '')
  if (pm === null) throw new Error(`${file}：platform: 行解析失败`)
  const current = pm[4].replace(/^['"]|['"]$/g, '')
  if (current !== 'taiga' && current !== 'localfile') {
    throw new Error(`${file}：platform=${current} 非 taiga|localfile——本工具只做 taiga→localfile 单向切换（回退走 --rollback）`)
  }
  const alreadyLocal = current === 'localfile'
  const lines = [...parsed.lines]
  const changes = []

  // ① platform 行：值替换（缩进/冒号间距/行内注释逐字保留）
  const indent = pm[1]
  const newPlatform = `${indent}platform${pm[2]}:${pm[3]}localfile${pm[5] ?? ''}`
  if (!alreadyLocal) {
    changes.push({ file, lineNo: pi + 1, before: lines[pi], after: newPlatform })
    lines[pi] = newPlatform
  }

  // ② platformDir 行：在则值替换；不在则 platform 行后插一行
  let addDir = false
  if (dirHit >= 0) {
    const dm = PLATFORM_DIR_LINE.exec(lines[dirHit] ?? '')
    if (dm !== null) {
      const vc = splitValueComment(dm[3])
      if (vc.value !== platformRoot) {
        const after = `${dm[1]}platformDir${dm[2]}:${vc.space}${platformRoot}${vc.comment}`
        changes.push({ file, lineNo: dirHit + 1, before: lines[dirHit], after })
        lines[dirHit] = after
      }
    }
  } else {
    const insertAt = pi + 1
    const added = `${indent}platformDir: ${platformRoot}  # 单子切换（switch-localfile；缺省 <rootDir>/platform）`
    lines.splice(insertAt, 0, added)
    addDir = true
    changes.push({ file, lineNo: insertAt + 1, before: '（无此行）', after: added })
  }

  // 编辑安全断言：除目标行外逐字节不动；行数差 ≤1
  const removed = addDir ? 1 : 0
  const kept = lines.length - (addDir ? 1 : 0)
  if (kept !== parsed.lines.length) throw new Error(`${file}：编辑后行数断言失败（内部错误，不落盘）`)
  if (alreadyLocal && changes.length === 0) return { lines, changes, alreadyLocal, addDir, original: parsed.lines }
  verifyDaemonEdited(parsed.lines, lines, changes.map((c) => c.lineNo - 1), addDir ? [changes[changes.length - 1].lineNo - 1] : [])
  return { lines, changes, alreadyLocal, addDir, original: parsed.lines }
}

/** 逐行断言：除 changedIdx/insertedIdx 外所有行与原文逐字节一致（编辑面安全闸） */
function verifyDaemonEdited(original, edited, changedIdx, insertedIdx) {
  const changed = new Set(changedIdx)
  const inserted = new Set(insertedIdx)
  let oi = 0
  for (let ei = 0; ei < edited.length; ei += 1) {
    if (inserted.has(ei)) continue
    const o = original[oi]
    const e = edited[ei]
    if (!changed.has(ei) && o !== e) {
      throw new Error(`编辑越线：第 ${oi + 1} 行被意外改动（"${o}" → "${e}"）——中止不落盘`)
    }
    oi += 1
  }
  if (oi !== original.length) throw new Error('编辑行数断言失败（内部错误）')
}

/** 编辑后内容复校验：扁平子集可 parse + platform=localfile + platformDir=目标根 */
function verifyDaemonContent(text, platformRoot, file) {
  const { rows } = parseFlatYaml(text, file)
  const platform = rows.find((r) => r.key === 'platform')
  const dir = rows.find((r) => r.key === 'platformDir')
  if (platform === undefined || platform.value !== 'localfile') throw new Error(`${file}：编辑后复校验 platform!=localfile（内部错误，不落盘）`)
  if (dir === undefined || path.resolve(dir.value) !== path.resolve(platformRoot)) {
    throw new Error(`${file}：编辑后复校验 platformDir!=${platformRoot}（内部错误，不落盘）`)
  }
}

/* ------------------------------------------------------------------ */
/* org-config.yaml 编辑计划（company: 段下 platform 行）                */
/* ------------------------------------------------------------------ */

function planOrgEdit(text, file) {
  const lines = text.split(/\r?\n/)
  let companyAt = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^company\s*:\s*(#.*)?$/.test(lines[i] ?? '')) {
      companyAt = i
      break
    }
  }
  if (companyAt < 0) throw new Error(`${file}：找不到顶层 company: 段——org-config 结构与预期不符，中止`)
  const hits = []
  for (let i = companyAt + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(line)) break // 下一个顶层键=段结束
    const m = /^(\s+)platform(\s*):(\s*)(\S+?)(\s*#.*)?$/.exec(line)
    if (m !== null) hits.push({ i, m })
  }
  if (hits.length !== 1) {
    throw new Error(`${file}：company: 段下 platform: 行须恰有一行（实得 ${hits.length}）——SEC-WD-02 两文件同刀改的前提`)
  }
  const { i, m } = hits[0]
  const current = (m[4] ?? '').replace(/^['"]|['"]$/g, '')
  if (current !== 'taiga' && current !== 'localfile') {
    throw new Error(`${file}：company.platform=${current} 非 taiga|localfile——拒改（回退走 --rollback）`)
  }
  if (current === 'localfile') return { lines, changes: [], alreadyLocal: true }
  const after = `${m[1]}platform${m[2]}:${m[3]}localfile${m[5] ?? ''}`
  const edited = [...lines]
  edited[i] = after
  // 逐行断言：只动第 i 行
  for (let j = 0; j < lines.length; j += 1) {
    if (j !== i && (edited[j] ?? '') !== (lines[j] ?? '')) throw new Error(`${file}：编辑越线（第 ${j + 1} 行）——中止不落盘`)
  }
  return { lines: edited, changes: [{ file, lineNo: i + 1, before: lines[i], after }], alreadyLocal: false }
}

/* ------------------------------------------------------------------ */
/* 平台树校验（有效 localplatform：单据/评论/ID 唯一/provision/活动流） */
/* ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 单事件形状（localplatform/src/issues.ts IssueEvent 同口径，零依赖重述） */
function issueEventProblem(ev, file, lineNo) {
  if (!isPlainObject(ev)) return `${file}:${lineNo} 非 JSON 对象`
  if (ev['type'] === 'created') {
    if (typeof ev['ts'] !== 'string' || typeof ev['state'] !== 'string' || !isPlainObject(ev['input'])) return `${file}:${lineNo} created 事件形状坏（ts/state/input）`
    if (typeof ev['input']['title'] !== 'string' || ev['input']['title'] === '') return `${file}:${lineNo} created 事件缺 title`
    return null
  }
  if (ev['type'] === 'transitioned') {
    if (typeof ev['ts'] !== 'string' || typeof ev['to'] !== 'string') return `${file}:${lineNo} transitioned 事件形状坏（ts/to）`
    return null
  }
  if (ev['type'] === 'field-set') {
    if (typeof ev['ts'] !== 'string' || typeof ev['field'] !== 'string' || !('value' in ev)) return `${file}:${lineNo} field-set 事件形状坏（ts/field/value）`
    return null
  }
  return `${file}:${lineNo} 未知事件类型 ${String(ev['type'])}`
}

/**
 * 校验平台树（runbook §三 G1-G4 的切换面重述；零依赖只读扫描）。
 * @returns {{ ok: boolean, problems: string[], counts: {issues:number,comments:number,
 *            commentFiles:number, activity:number, kb:number}, states: Record<string,number>,
 *            provisionStates: string[], idsUnique: boolean }}
 */
function validatePlatformTree(root) {
  const problems = []
  const counts = { issues: 0, comments: 0, commentFiles: 0, activity: 0, kb: 0 }
  const states = {}
  const errors = (limit = 10) => problems.slice(0, limit).join('；')

  // —— 布局：issues/ 目录 + meta/fields.json + activity.jsonl ——
  if (!existsSync(root)) return { ok: false, problems: [`平台根不存在：${root}`], counts, states, provisionStates: [], idsUnique: false }
  if (!statSync(root).isDirectory()) return { ok: false, problems: [`平台根不是目录：${root}`], counts, states, provisionStates: [], idsUnique: false }
  const issuesDir = path.join(root, 'issues')
  if (!existsSync(issuesDir) || !statSync(issuesDir).isDirectory()) {
    return { ok: false, problems: [`缺 issues/ 目录：${issuesDir}`], counts, states, provisionStates: [], idsUnique: false }
  }

  // meta/fields.json：provision 形状（localplatform/src/fields.ts isProvisionMap 同口径）
  let provisionStates = []
  const fieldsFile = path.join(root, 'meta', 'fields.json')
  if (!existsSync(fieldsFile)) {
    problems.push(`缺 meta/fields.json（provision 未落盘——daemon 建/迁单闸会拒）`)
  } else {
    try {
      const parsed = JSON.parse(readFileSync(fieldsFile, 'utf8'))
      const prov = isPlainObject(parsed) ? parsed['provision'] : undefined
      const fieldsOk = isPlainObject(prov) && isPlainObject(prov['fields']) && Object.values(prov['fields']).every((v) => typeof v === 'string')
      const statesOk = isPlainObject(prov) && Array.isArray(prov['states']) && prov['states'].every((s) => typeof s === 'string') && prov['states'].length > 0
      const flowOk = isPlainObject(prov) && isPlainObject(prov['stateFlow']) && Object.values(prov['stateFlow']).every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))
      if (!fieldsOk || !statesOk || !flowOk) problems.push(`meta/fields.json provision 形状坏（fields/states/stateFlow——localplatform/src/fields.ts 口径）`)
      else provisionStates = prov['states']
    } catch (err) {
      problems.push(`meta/fields.json 非 JSON：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // issues/*.jsonl：逐行事件形状 + 派生终态 + ID 唯一（大小写折叠防 macOS 文件系撞名）
  const entries = readdirSync(issuesDir).sort()
  const jsonl = entries.filter((n) => n.endsWith('.jsonl'))
  const stems = new Set()
  const stemsFolded = new Set()
  let idsUnique = true
  for (const name of jsonl) {
    const stem = name.slice(0, -'.jsonl'.length)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem)) {
      problems.push(`单据文件名非票号形（localplatform scanIssueIds 口径）：${name}`)
      continue
    }
    if (stems.has(stem)) {
      problems.push(`单据 ID 重复：${stem}`)
      idsUnique = false
    }
    stems.add(stem)
    const folded = stem.toLowerCase()
    if (stemsFolded.has(folded)) {
      problems.push(`单据 ID 大小写折叠后重复（macOS 文件系同档）：${stem}`)
      idsUnique = false
    }
    stemsFolded.add(folded)
    const file = path.join(issuesDir, name)
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    if (lines[lines.length - 1] !== '') problems.push(`${name}：末行无换行（append-only jsonl 口径）`)
    let state = null
    let first = true
    let n = 0
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line === '') continue
      n += 1
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        problems.push(`${name}:${i + 1} 非 JSON 行`)
        continue
      }
      const problem = issueEventProblem(ev, name, i + 1)
      if (problem !== null) {
        problems.push(problem)
        continue
      }
      if (first) {
        if (ev['type'] !== 'created') problems.push(`${name}:${i + 1} 首事件须为 created（实得 ${String(ev['type'])}）`)
        first = false
      }
      if (ev['type'] === 'created' && n === 1) state = ev['state']
      if (ev['type'] === 'transitioned') state = ev['to']
    }
    if (n === 0) problems.push(`${name}：空事件流`)
    if (state !== null) states[state] = (states[state] ?? 0) + 1
    counts.issues += 1
  }
  if (counts.issues === 0) problems.push('issues/ 下无 *.jsonl 单据（空平台树不允许切换——先跑迁移）')

  // 评论：*.comments.md 块（<!-- comment … --> 头行计数；localplatform/src/comments.ts 口径）
  for (const name of entries) {
    if (!name.endsWith('.comments.md')) continue
    counts.commentFiles += 1
    const file = path.join(issuesDir, name)
    const commentLines = readFileSync(file, 'utf8').split('\n')
    let open = false
    for (let i = 0; i < commentLines.length; i += 1) {
      const line = commentLines[i] ?? ''
      if (line.startsWith('<!-- comment ')) {
        if (!line.endsWith(' -->')) problems.push(`${name}:${i + 1} 评论头行损坏`)
        open = true
        counts.comments += 1
      } else if (line.startsWith('<!-- /comment ')) {
        if (!open) problems.push(`${name}:${i + 1} 评论结束标记无配对头行`)
        open = false
      }
    }
    if (open) problems.push(`${name}：评论块缺结束标记`)
    const stem = name.slice(0, -'.comments.md'.length)
    if (!stems.has(stem)) problems.push(`${name}：评论文件无对应单据事件流 ${stem}.jsonl`)
  }

  // 活动流：activity.jsonl 每行 JSON、id a-000001 形、单调递增唯一
  const activityFile = path.join(root, 'activity.jsonl')
  if (!existsSync(activityFile)) {
    problems.push('缺 activity.jsonl（全局活动流）')
  } else {
    let prev = 0
    const seenIds = new Set()
    const lines = readFileSync(activityFile, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line === '') continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        problems.push(`activity.jsonl:${i + 1} 非 JSON 行`)
        continue
      }
      const id = isPlainObject(ev) ? ev['id'] : undefined
      const m = /^a-(\d+)$/.exec(typeof id === 'string' ? id : '')
      if (m === null) {
        problems.push(`activity.jsonl:${i + 1} id 非 a-N 形（实得 ${String(id)}）`)
        continue
      }
      const num = Number.parseInt(m[1], 10)
      if (seenIds.has(id)) {
        problems.push(`activity.jsonl:${i + 1} 活动 id 重复：${id}`)
        continue
      }
      seenIds.add(id)
      if (num !== prev + 1) problems.push(`activity.jsonl:${i + 1} 活动 id 不连续（${id}，期值 a-${String(prev + 1).padStart(6, '0')}）`)
      prev = num
      counts.activity += 1
    }
    if (counts.activity === 0) problems.push('activity.jsonl 空')
  }

  // kb/（可空——工作知识树）
  const kbDir = path.join(root, 'kb')
  if (existsSync(kbDir)) {
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.md')) counts.kb += 1
      }
    }
    walk(kbDir)
  }

  return { ok: problems.length === 0, problems, counts, states, provisionStates, idsUnique: idsUnique && problems.length === 0 }
}

/* ------------------------------------------------------------------ */
/* 检查项（dry-run 打印用；零副作用——HTTP GET 只读探活）               */
/* ------------------------------------------------------------------ */

async function probeHealthz(daemonYamlText, file) {
  const parsed = parseFlatYaml(daemonYamlText, file)
  const port = parsed.rows.find((r) => r.key === 'apiPort')
  if (port === undefined) return { status: 'unknown', note: 'daemon.yaml 未配 apiPort（缺省 0=ephemeral）——探活口以部署面为准' }
  const n = Number.parseInt(port.value, 10)
  if (!Number.isInteger(n) || n <= 0) return { status: 'unknown', note: `apiPort=${port.value}（ephemeral/非法）——探活口以部署面为准` }
  const url = `http://127.0.0.1:${n}/healthz`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    const body = await res.json()
    return { status: 'ok', note: `${url} → HTTP ${res.status}`, body }
  } catch (err) {
    return { status: 'unreachable', note: `${url} 不可达（${err instanceof Error ? err.message.split('\n')[0] : String(err)}）——daemon 未起或端口不符` }
  }
}

function inflightCheckCommand(daemonYamlText, file) {
  const parsed = parseFlatYaml(daemonYamlText, file)
  const db = parsed.rows.find((r) => r.key === 'db')
  if (db === undefined) return { db: null }
  return {
    db: db.value,
    sql: `sqlite3 ${db.value} "SELECT COUNT(*) FROM work_records WHERE ended_at IS NULL;"  -- 在途单数（>0=切换窗禁停机）`,
  }
}

/* ------------------------------------------------------------------ */
/* 备份与原子写                                                         */
/* ------------------------------------------------------------------ */

function backupPath(file, ts) {
  return `${file}.${BACKUP_TAG}-${ts}`
}

function latestBackup(file) {
  const dir = path.dirname(file)
  const base = path.basename(file)
  const prefix = `${base}.${BACKUP_TAG}-`
  if (!existsSync(dir)) return null
  const cands = readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .filter((n) => /^\d{8}-\d{6}$/.test(n.slice(prefix.length)))
    .sort()
  if (cands.length === 0) return null
  return path.join(dir, cands[cands.length - 1])
}

/** 原子写：同目录临时文件 → rename（编辑后内容已在内存复校验过） */
function atomicWrite(file, content) {
  const tmp = `${file}.${PROG}-tmp-${process.pid}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function readTextOrFail(file, label) {
  if (!existsSync(file)) fail(`${label} 不存在：${file}`)
  const st = statSync(file)
  if (!st.isFile()) fail(`${label} 不是文件：${file}`)
  return readFileSync(file, 'utf8')
}

function printChanges(changes) {
  for (const c of changes) {
    console.log(`  ${c.file} 第 ${c.lineNo} 行`)
    console.log(`    - ${c.before}`)
    console.log(`    + ${c.after}`)
  }
}

function printRestartCommands(daemonYaml) {
  console.log('\n-- 重启与验证（本脚本不自行重启生产——执行归切换窗值守人）--')
  console.log(`  1) 停旧进程：优雅停优先（SIGINT/控制面 stop.request.json——runbook §六踩坑：SIGKILL 残留 writer.lock）`)
  console.log(`  2) 重启：node apps/boot/src/main.ts ${daemonYaml}   # 生产以 guardian/boot-start.sh 部署面为准`)
  console.log(`  3) 验证：healthz {"ok":true,...} 且 tick.seq 前进；/v1/company 200；活动流游标消费至末条`)
  console.log(`  4) 双跑对账：node scripts/taiga-localplatform-dualrun.ts --snapshot <冻结快照> --root <平台根>（G6，连续 ≥24h 0 drift）`)
}

function printRollbackSteps(daemonYaml, orgConfig) {
  console.log('\n-- 回滚步骤（runbook §五：Taiga 窗口期只读=事实源未动，回滚=改配置行，不反迁）--')
  console.log(`  1) 停 daemon（优雅停）`)
  console.log(`  2) node scripts/ops/switch-localfile.mjs --daemon-yaml ${daemonYaml} --org-config ${orgConfig} --rollback`)
  console.log(`     （或人工：daemon.yaml platform 改回 taiga + org-config company.platform 同步改回——SEC-WD-02 两文件必须一致）`)
  console.log(`  3) 重启 daemon；Taiga 启动探针（fields.schema 四层连通）通过即回滚完成`)
  console.log(`  4) LocalFile 平台根整体归档留证（tar；只增不改的 jsonl 树，不删除）`)
}

async function cmdDryRun(args) {
  const daemonText = readTextOrFail(args.daemonYaml, 'daemon.yaml')
  const orgText = readTextOrFail(args.orgConfig, 'org-config.yaml')
  const platformRootAbs = path.resolve(args.platformRoot)

  console.log(`${PROG} · dry-run（零副作用——不写/不备份/不改任何文件）· ${new Date().toISOString()}`)

  // 1) 平台树校验（切换面 G1-G4 重述）
  section('1) 平台树校验（--platform-root）')
  const tree = validatePlatformTree(platformRootAbs)
  console.log(`  平台根：${platformRootAbs}`)
  console.log(`  单据 issues/*.jsonl = ${tree.counts.issues}`)
  console.log(`  评论 *.comments.md = ${tree.counts.commentFiles} 文件 / ${tree.counts.comments} 块`)
  console.log(`  活动流 activity.jsonl = ${tree.counts.activity} 条`)
  console.log(`  kb = ${tree.counts.kb} 篇；provision states = [${tree.provisionStates.join('、')}]`)
  const stateRows = Object.entries(tree.states).sort((a, b) => b[1] - a[1])
  console.log(`  终态分布：${stateRows.map(([s, n]) => `${s}=${n}`).join(' / ') || '（无）'}`)
  console.log(`  ID 唯一：${tree.idsUnique ? 'ok' : 'FAIL'}`)
  if (!tree.ok) {
    console.log(`  校验失败 ${tree.problems.length} 项：`)
    for (const p of tree.problems.slice(0, 20)) console.log(`    - ${p}`)
    if (tree.problems.length > 20) console.log(`    …（共 ${tree.problems.length} 项）`)
    fail(`平台树校验未过——修复后重试（切换前置 G1-G4）`)
  }
  console.log('  校验：ok（单据/评论/活动流/ID 唯一/provision 全过）')

  // 2) 配置 diff 计划（不落盘）
  section('2) 配置编辑计划（dry-run 只打印，不写）')
  let daemonPlan
  let orgPlan
  try {
    daemonPlan = planDaemonEdit(daemonText, platformRootAbs, args.daemonYaml)
    orgPlan = planOrgEdit(orgText, args.orgConfig)
  } catch (err) {
    fail(`配置编辑计划失败：${err instanceof Error ? err.message : String(err)}`)
  }
  if (daemonPlan.alreadyLocal && orgPlan.alreadyLocal) {
    console.log('  daemon.yaml platform 已是 localfile 且 org-config company.platform 已是 localfile——无需切换（幂等：本次零动作）')
  } else {
    printChanges([...daemonPlan.changes, ...orgPlan.changes])
    if (daemonPlan.changes.length === 0 && !orgPlan.alreadyLocal) console.log('  ⚠ daemon.yaml 已是 localfile 但 org-config 未声明——不一致形态（SEC-WD-02 拒启），本次将补齐 org-config')
    if (orgPlan.changes.length === 0 && !daemonPlan.alreadyLocal) console.log('  ⚠ org-config 已是 localfile 但 daemon.yaml 未切——本次将补齐 daemon.yaml')
  }
  // 编辑后内容预演校验（内存中）
  const newDaemonText = daemonPlan.lines.join('\n')
  try {
    verifyDaemonContent(newDaemonText, platformRootAbs, args.daemonYaml)
    console.log('  编辑后内容复校验（扁平子集 parse + platform/platformDir 断言）：ok')
  } catch (err) {
    fail(`编辑后内容复校验失败（不落盘）：${err instanceof Error ? err.message : String(err)}`)
  }

  // 3) 备份计划
  section('3) 备份计划（apply 时先备份再改）')
  const ts = timestamp()
  console.log(`  ${backupPath(args.daemonYaml, ts)}`)
  console.log(`  ${backupPath(args.orgConfig, ts)}`)

  // 4) daemon 健康 + inflight
  section('4) daemon 健康与在途检查（只读探查）')
  const health = await probeHealthz(daemonText, args.daemonYaml)
  console.log(`  healthz：${health.status} —— ${health.note}`)
  if (health.status === 'ok' && health.body?.tick !== undefined) {
    console.log(`    tick.seq=${String(health.body.tick.seq ?? '?')} advancing=${String(health.body.tick.seq ?? 0) > 0}`)
  }
  const inflight = inflightCheckCommand(daemonText, args.daemonYaml)
  if (inflight.db === null) console.log('  在途检查：daemon.yaml 未配 db——人工确认在途=0')
  else console.log(`  在途检查（须=0 再停机）：\n    ${inflight.sql}`)

  // 5) 预计停机
  section('5) 预计停机窗口')
  const estMs = (REHEARSAL.bootToHealthzMs + REHEARSAL.drainMs) * DOWNTIME_MARGIN
  console.log(`  优雅停（drain 实测 ${REHEARSAL.drainMs}ms）+ 重启至 healthz ok（实测 ${REHEARSAL.bootToHealthzMs}ms，1554 单树+空台账拷贝）`)
  console.log(`  预估停机 ≈ ${Math.max(5, Math.round(estMs / 1000))}s（×${DOWNTIME_MARGIN} 余量：生产 ledger 更大/冷缓存）；窗口仍按 5min 申请（留探针+人工复核）`)

  // 6) 重启命令 + 7) 回滚步骤
  section('6) 重启与验证命令（apply 完成后执行）')
  printRestartCommands(args.daemonYaml)
  printRollbackSteps(args.daemonYaml, args.orgConfig)

  section('切换前置门槛（runbook §十.2：G1-G7 全绿才开窗）')
  console.log('  G1 逐单 0-gap：taiga-localplatform-diff.ts exit 0')
  console.log('  G2 幂等收敛：migrate 复跑 written=0 树哈希不变')
  console.log('  G3 daemon 可起：本预演（拷贝公司 boot）已验证')
  console.log('  G4 只读兼容：daemon 短跑前后平台树字节不变（本预演已验证）')
  console.log('  G5 状态口径：binding 判决 Ok/unverified（STATE_MAPPINGS 部署工件另补）')
  console.log('  G6 双跑 0-drift：切流前连续 ≥24h 每 <30min 一跑全绿')
  console.log('  G7 审计旁注：migration-audit planHash 与实跑一致、history 计数=源总数')
  console.log('\nDRY-RUN OK：以上为完整切换计划；执行 --apply --i-understand 落盘。')
}

async function cmdApply(args) {
  const daemonText = readTextOrFail(args.daemonYaml, 'daemon.yaml')
  const orgText = readTextOrFail(args.orgConfig, 'org-config.yaml')
  const platformRootAbs = path.resolve(args.platformRoot)

  console.log(`${PROG} · apply · ${new Date().toISOString()}`)
  console.log(`  目标：daemon.yaml=${args.daemonYaml} / org-config=${args.orgConfig} / 平台根=${platformRootAbs}`)

  // —— 校验先行（任一失败=零写动作）——
  const tree = validatePlatformTree(platformRootAbs)
  if (!tree.ok) {
    console.error(`平台树校验失败（不切换）：`)
    for (const p of tree.problems.slice(0, 20)) console.error(`  - ${p}`)
    fail(`平台树无效——中止（零写入）`)
  }
  console.log(`平台树校验：ok（单据 ${tree.counts.issues} / 评论 ${tree.counts.comments} / 活动 ${tree.counts.activity} / ID 唯一）`)

  const daemonPlan = planDaemonEdit(daemonText, platformRootAbs, args.daemonYaml)
  const orgPlan = planOrgEdit(orgText, args.orgConfig)
  if (daemonPlan.alreadyLocal && orgPlan.alreadyLocal) {
    console.log('两配置已为 localfile——幂等无动作，退出。')
    return
  }
  // 行集 join 即还原原文换行形态（split 产生的末尾空串元素保留=末行换行不丢、不重复）
  const newDaemonText = daemonPlan.lines.join('\n')
  const newOrgText = orgPlan.lines.join('\n')
  verifyDaemonContent(newDaemonText, platformRootAbs, args.daemonYaml)

  // —— 备份（时间戳；两份都成后才动配置）——
  const ts = timestamp()
  const daemonBak = backupPath(args.daemonYaml, ts)
  const orgBak = backupPath(args.orgConfig, ts)
  section(`备份（${ts}）`)
  mkdirSync(path.dirname(orgBak), { recursive: true })
  copyFileSync(args.daemonYaml, daemonBak)
  console.log(`  ${daemonBak}`)
  copyFileSync(args.orgConfig, orgBak)
  console.log(`  ${orgBak}`)

  // —— 原子写（编辑内容已复校验；rename 同卷原子）——
  section('配置写入（原子：tmp+rename）')
  let daemonWritten = false
  try {
    atomicWrite(args.daemonYaml, newDaemonText)
    daemonWritten = true
    console.log(`  daemon.yaml 已写（platform: localfile + platformDir: ${platformRootAbs}）`)
    atomicWrite(args.orgConfig, newOrgText)
    console.log(`  org-config.yaml 已写（company.platform: localfile——SEC-WD-02 同刀改）`)
  } catch (err) {
    console.error(`写入失败：${err instanceof Error ? err.message : String(err)}`)
    if (daemonWritten) {
      console.error('daemon.yaml 已写而 org-config 失败——从备份恢复 daemon.yaml（不留半切换态）')
      copyFileSync(daemonBak, args.daemonYaml)
      console.error('已恢复 daemon.yaml 原状（备份仍在）')
    }
    fail('写入中断——已回滚半写（备份保留），修复后重试')
  }

  // —— 写后核验（重读盘上文件；与计划逐字节一致）——
  section('写后核验（重读盘上文件）')
  const daemonAfter = readFileSync(args.daemonYaml, 'utf8')
  const orgAfter = readFileSync(args.orgConfig, 'utf8')
  if (daemonAfter !== newDaemonText) fail('写后核验失败：daemon.yaml 与计划不一致（异常——请人工核对备份）')
  if (orgAfter !== newOrgText) fail('写后核验失败：org-config.yaml 与计划不一致（异常——请人工核对备份）')
  verifyDaemonContent(daemonAfter, platformRootAbs, args.daemonYaml)
  console.log('  盘上内容与计划逐字节一致；扁平子集复 parse 通过。')

  printChanges([...daemonPlan.changes, ...orgPlan.changes])
  printRestartCommands(args.daemonYaml)
  printRollbackSteps(args.daemonYaml, args.orgConfig)
  console.log(`\nAPPLY OK：配置已切换（未重启——重启归切换窗值守人）。回滚：--rollback（最近备份=${path.basename(daemonBak)}）`)
}

function cmdRollback(args) {
  const daemonBak = latestBackup(args.daemonYaml)
  const orgBak = latestBackup(args.orgConfig)
  console.log(`${PROG} · rollback · ${new Date().toISOString()}`)
  if (daemonBak === null || orgBak === null) {
    fail(`找不到切换备份（模式 *.${BACKUP_TAG}-<ts>）：daemon=${String(daemonBak)} org=${String(orgBak)}——不能凭空回滚，人工核配置`)
  }
  console.log(`  最近备份：\n    ${daemonBak}\n    ${orgBak}`)
  const daemonTs = daemonBak.slice(daemonBak.lastIndexOf('-') + 1)
  const orgTs = orgBak.slice(orgBak.lastIndexOf('-') + 1)
  if (daemonTs !== orgTs) {
    console.log(`  ⚠ 两文件最近备份时间戳不一致（daemon=${daemonTs} / org=${orgTs}）——非同刀备份，恢复前请人工核对两份内容配套`)
  }
  const daemonBakText = readFileSync(daemonBak, 'utf8')
  const orgBakText = readFileSync(orgBak, 'utf8')
  // 备份自身须可 parse 且形态=taiga（回滚目标面；非 taiga 形态提示人工核）
  try {
    const parsed = parseFlatYaml(daemonBakText, daemonBak)
    const platform = parsed.rows.find((r) => r.key === 'platform')
    if (platform === undefined) fail('备份 daemon.yaml 缺 platform 键——人工核对后再回滚')
    if (platform.value !== 'taiga') console.log(`  ⚠ 备份 platform=${platform.value}（非 taiga）——仍按备份原样恢复`)
  } catch (err) {
    fail(`备份 daemon.yaml 结构校验失败：${err instanceof Error ? err.message : String(err)}`)
  }
  // 恢复（备份→tmp→rename 原子；备份文件保留不删）
  const daemonTmp = `${args.daemonYaml}.${PROG}-tmp-${process.pid}`
  const orgTmp = `${args.orgConfig}.${PROG}-tmp-${process.pid}`
  try {
    copyFileSync(daemonBak, daemonTmp)
    renameSync(daemonTmp, args.daemonYaml)
    console.log(`  daemon.yaml 已恢复 ← ${path.basename(daemonBak)}`)
    copyFileSync(orgBak, orgTmp)
    renameSync(orgTmp, args.orgConfig)
    console.log(`  org-config.yaml 已恢复 ← ${path.basename(orgBak)}`)
  } catch (err) {
    fail(`恢复失败：${err instanceof Error ? err.message : String(err)}——人工核对（备份未删）`)
  }
  const daemonAfter = readFileSync(args.daemonYaml, 'utf8')
  const orgAfter = readFileSync(args.orgConfig, 'utf8')
  if (daemonAfter !== daemonBakText || orgAfter !== orgBakText) fail('恢复后核验失败：盘上内容与备份不一致——人工核对')
  console.log('  恢复后核验：与备份逐字节一致。')
  printRestartCommands(args.daemonYaml)
  console.log(`\nROLLBACK OK：配置已恢复（备份保留未删）。重启后 Taiga 启动探针通过=回滚完成（runbook §五）。`)
}

/* ------------------------------------------------------------------ */

const args = (() => {
  try {
    return parseArgs(process.argv.slice(2))
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err))
    process.exit(2)
  }
})()

if (args.mode === 'dry-run') await cmdDryRun(args)
else if (args.mode === 'apply') await cmdApply(args)
else cmdRollback(args)
