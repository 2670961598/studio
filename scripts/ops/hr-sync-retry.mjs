#!/usr/bin/env node
/**
 * hr-sync-retry —— 把 hr_sync_log 中 failed 的同步任务重置为 pending（重试）以重放（studio-dev-784）
 *
 * 背景（ref=784）：775 修了 membership 形状漂移，但 hr-sync 仍失败于「角色不存在」（taigaRoleOf
 * 未接线）。修复代码/配置后，需要把此前 failed 的 taiga 任务（如 REL-1 入项目）**人工唤醒**：
 * 本 CLI 只做「failed→pending + attempts 归零 + last_error 清空」，随后由 daemon 相位尾消化器重试
 * （目标态 ensure-shape，多执行不坏）。不改业务数据、不直接调 Taiga/Matrix。
 *
 * 安全（daemon 停止时执行；writer.lock 处理）：
 *   - 先 `acquireWriterLease(db,'hr-sync-retry-cli')` 取台账写者租约（`<db>.writer.lock`）；
 *   - daemon 在跑（持锁）→ STALL/writer-lease-held 拒绝，**不覆盖、不删他人锁**；
 *   - daemon 已停（无锁，或崩溃残留的死 pid 锁由 store 逻辑识别清理一次）→ CLI 持锁写库，结束释放；
 *   - **禁止手工删 writer.lock 绕过**；拒锁指引=先停 daemon（launchctl bootout/kickstart 窗口）再重试。
 *
 * 用法：
 *   node scripts/ops/hr-sync-retry.mjs --db <ledger.sqlite> --person REL-1 [--id <taskId>] [--dry-run] [--json]
 *   node scripts/ops/hr-sync-retry.mjs --daemon-yaml <companyDir>/daemon.yaml --person REL-1
 *   node scripts/ops/hr-sync-retry.mjs --db <db> --all --platform taiga --company studio-dev
 *
 * 退出码：0=成功/无需处理；1=拒绝（daemon 在跑/参数错）；2=库/租约错误。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const USAGE = `用法：node scripts/ops/hr-sync-retry.mjs (--db <ledger.sqlite> | --daemon-yaml <daemon.yaml>) --person <工号>|--all [选项]

选项：
  --db <path>         台账 SQLite（与 daemon.yaml 的 db: 同源）
  --daemon-yaml <f>   从 daemon.yaml 读取 db:（与 --db 二选一）
  --person <工号>     只重置该工号的 failed 任务（与 --all/--id 可组合=交集）
  --all               重置所有匹配（危险；务必配合 --platform/--company 过滤）
  --platform <p>      平台过滤（缺省 taiga）
  --id <taskId>       只重置指定任务 id（本身即充分范围；可与 --person 组合）
  --company <slug>    公司过滤（可选）
  --dry-run           只列出将重置的行，不写库
  --json              机器可读摘要（stdout 最后一行）
  --help              本帮助

安全：CLI 先取 <db>.writer.lock 写者租约；daemon 在跑=拒绝（不要手工删锁）。退出码 0/1/2。`

const EXIT = { ok: 0, refused: 1, error: 2 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--dry-run' || token === '--json' || token === '--all') {
      opts[token.slice(2)] = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    opts[key] = value
    i += 1
  }
  return { help: false, opts }
}

function resolveDbPath(opts, cwd) {
  if (typeof opts.db === 'string' && opts.db !== '') return path.resolve(cwd, opts.db)
  if (typeof opts['daemon-yaml'] === 'string' && opts['daemon-yaml'] !== '') {
    const yamlPath = path.resolve(cwd, opts['daemon-yaml'])
    if (!existsSync(yamlPath)) throw new Error(`daemon.yaml 不存在：${yamlPath}`)
    for (const line of readFileSync(yamlPath, 'utf8').split('\n')) {
      const match = /^\s*db:\s*["']?([^"'#\n]+)["']?\s*(?:#.*)?$/.exec(line)
      if (match !== null) return path.resolve(path.dirname(yamlPath), match[1].trim())
    }
    throw new Error(`daemon.yaml 未找到 db: 键：${yamlPath}`)
  }
  throw new Error('缺 --db 或 --daemon-yaml')
}

async function loadStore() {
  // 相对脚本位置（repo 布局 scripts/ops → ../../packages/store/src/index.ts）；不依赖 npm 包名解析/cwd
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const storeUrl = pathToFileURL(path.resolve(repoRoot, 'packages', 'store', 'src', 'index.ts')).href
  return await import(storeUrl)
}

function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`hr-sync-retry：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return Promise.resolve(EXIT.refused)
  }
  if (parsed.help === true) {
    process.stdout.write(USAGE)
    return Promise.resolve(EXIT.ok)
  }
  return run(parsed.opts)
}

async function run(opts) {
  const cwd = process.cwd()
  const json = opts.json === true
  let dbPath
  try {
    dbPath = resolveDbPath(opts, cwd)
  } catch (err) {
    process.stderr.write(`hr-sync-retry：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.refused
  }
  if (!existsSync(dbPath)) {
    process.stderr.write(`hr-sync-retry：台账不存在：${dbPath}\n`)
    return EXIT.refused
  }
  const person = typeof opts.person === 'string' && opts.person !== '' ? opts.person : ''
  const taskId = typeof opts.id === 'string' && opts.id !== '' ? opts.id : ''
  // F2（verifier）：--id 是充分范围（只影响该行，不会全库）；与 --person/--all 可组合（交集）
  if (person === '' && opts.all !== true && taskId === '') {
    process.stderr.write('hr-sync-retry：需 --person <工号>、--id <taskId> 或显式 --all（防误重置全库）\n')
    return EXIT.refused
  }
  const platform = typeof opts.platform === 'string' && opts.platform !== '' ? opts.platform : 'taiga'
  const company = typeof opts.company === 'string' && opts.company !== '' ? opts.company : ''

  // —— 写者租约：daemon 在跑=拒绝；持有期间 CLI 是唯一写者 ——
  let store
  let lease
  try {
    store = await loadStore()
    lease = store.acquireWriterLease(dbPath, 'hr-sync-retry-cli')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `hr-sync-retry：无法取得台账写者租约（${message}）\n` +
        `  处理：daemon 可能在跑（writer.lock 由它持有）——先停 daemon 再重试；\n` +
        `        崩溃残留的死 pid 锁会被 acquireWriterLease 自动识别清理；**不要手工删 ${dbPath}.writer.lock**。\n`,
    )
    return EXIT.error
  }
  let db
  try {
    db = new DatabaseSync(dbPath)
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hr_sync_log'").get()
    if (hasTable === undefined) {
      process.stderr.write(`hr-sync-retry：库内无 hr_sync_log 表（不是本框架台账？）：${dbPath}\n`)
      return EXIT.error
    }
    const where = ["status = 'failed'", 'platform = ?']
    const params = [platform]
    if (person !== '') {
      where.push('person_id = ?')
      params.push(person)
    }
    if (company !== '') {
      where.push('company = ?')
      params.push(company)
    }
    if (taskId !== '') {
      where.push('id = ?')
      params.push(taskId)
    }
    const whereSql = where.join(' AND ')
    const rows = db.prepare(`SELECT id, company, person_id, platform, attempts, last_error, updated FROM hr_sync_log WHERE ${whereSql} ORDER BY ts ASC`).all(...params)
    if (rows.length === 0) {
      if (json === true) process.stdout.write(`${JSON.stringify({ ok: true, dbPath, platform, person: person === '' ? null : person, matched: 0, reset: 0, dryRun: opts['dry-run'] === true })}\n`)
      else process.stdout.write(`[hr-sync-retry] 无匹配 failed 任务（platform=${platform}${person !== '' ? ` person=${person}` : ''}）——无需处理\n`)
      return EXIT.ok
    }
    if (!json) {
      process.stdout.write(`[hr-sync-retry] 匹配 ${String(rows.length)} 条 failed 任务（platform=${platform}${person !== '' ? ` person=${person}` : ''}）：\n`)
      for (const row of rows) process.stdout.write(`  ${String(row.id)}  ${String(row.person_id)}  attempts=${String(row.attempts)}  ${row.last_error === null ? '' : String(row.last_error).slice(0, 120)}\n`)
    }
    if (opts['dry-run'] === true) {
      const summary = { ok: true, dbPath, platform, person: person === '' ? null : person, matched: rows.length, reset: 0, dryRun: true }
      if (json === true) process.stdout.write(`${JSON.stringify(summary)}\n`)
      else process.stdout.write('[hr-sync-retry] --dry-run：未写库（去掉 --dry-run 执行重置）\n')
      return EXIT.ok
    }
    const now = Date.now()
    const ids = rows.map((row) => String(row.id))
    const placeholders = ids.map(() => '?').join(',')
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = db.prepare(`UPDATE hr_sync_log SET status='pending', attempts=0, last_error=NULL, updated=? WHERE id IN (${placeholders})`).run(now, ...ids)
      db.exec('COMMIT')
      const stats = db.prepare('SELECT status, COUNT(*) AS n FROM hr_sync_log GROUP BY status').all()
      const summary = {
        ok: true,
        dbPath,
        platform,
        person: person === '' ? null : person,
        matched: rows.length,
        reset: Number(result.changes),
        dryRun: false,
        queue: Object.fromEntries(stats.map((row) => [String(row.status), Number(row.n)])),
        nextSteps: '启动/唤醒 daemon（guardian kickstart）让相位尾消化器重试 pending 任务；观测 daemon.log [hr-sync] 与 Taiga memberships',
      }
      if (json === true) process.stdout.write(`${JSON.stringify(summary)}\n`)
      else {
        process.stdout.write(`[hr-sync-retry] 已重置 ${String(result.changes)} 条 failed → pending（attempts=0,last_error=NULL）\n`)
        process.stdout.write(`  队列现状：${JSON.stringify(summary.queue)}\n`)
        process.stdout.write('  下一步：启动/唤醒 daemon（launchctl kickstart -k gui/$(id -u)/io.studionext.daemon）让消化器重试；\n')
        process.stdout.write('          观测 daemon.log 的 [hr-sync] 行与 Taiga 项目成员列表。\n')
      }
      return EXIT.ok
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* 回滚失败不掩盖原错 */
      }
      throw err
    }
  } catch (err) {
    process.stderr.write(`hr-sync-retry：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.error
  } finally {
    try {
      db?.close()
    } catch {
      /* 关闭失败不掩盖结果 */
    }
    try {
      lease?.release()
    } catch {
      /* 释放失败：锁残留由死 pid 清理兜底 */
    }
  }
}

function realpathOrResolved(target) {
  try {
    return realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathOrResolved(process.argv[1]) === realpathOrResolved(new URL(import.meta.url).pathname)
if (invokedDirectly) {
  process.exit(await main(process.argv.slice(2)))
}
