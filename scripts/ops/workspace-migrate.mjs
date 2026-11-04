#!/usr/bin/env node
/**
 * workspace-migrate —— .AIWS 常驻资料迁移到 workspaces（studio-dev-723 / 计划 725；docs/90-§八）
 *
 * 语义：把 `<companyRoot>/.AIWS/<dept>/<person>/` 下**非 tickets** 内容复制到对应常驻家
 * `<companyRoot>/workspaces/<dept>/<汇报链…>/<person>/`；**不移动、不删除、不覆盖已有文件**；
 * 默认 dry-run，只有 `--apply` 才落盘；重复执行为幂等（已存在项跳过）。
 * 边界：只读 .AIWS/workspaces 两个目录；不写 company/ git；不碰台账/凭据；无第三方依赖。
 *
 * 用法：node scripts/ops/workspace-migrate.mjs --company <companyDir> [--apply] [--json]
 *   companyDir 默认取 <companyDir> 的父目录作为 companyRoot；workspaces=<companyRoot>/workspaces，
 *   .AIWS=<companyRoot>/.AIWS。也可显式 --workspaces <dir> --aiws <dir>。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function parse(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply' || arg === '--json') {
      flags[arg.slice(2)] = true
      continue
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${key} 缺值`)
      flags[key] = value
      i += 1
    }
  }
  return flags
}

/** 递归找「常驻家」目录（含 agent.md 的目录），返回 rel posix + personId（末段） */
function findHomes(root) {
  const homes = []
  const walk = (abs, rel) => {
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    if (existsSync(path.join(abs, 'agent.md'))) homes.push({ abs, rel, personId: path.basename(abs) })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      walk(path.join(abs, entry.name), rel === '' ? entry.name : `${rel}/${entry.name}`)
    }
  }
  walk(root, '')
  return homes
}

/** 找 .AIWS 下该工号目录（按目录名精确匹配；多个取第一个） */
function findAiwsPersonDir(aiwsRoot, personId) {
  const found = []
  const walk = (abs, rel) => {
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const childAbs = path.join(abs, entry.name)
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.name === personId) found.push({ abs: childAbs, rel: childRel })
      walk(childAbs, childRel)
    }
  }
  walk(aiwsRoot, '')
  return found[0]
}

/** 枚举 .AIWS person 目录下的非 tickets 条目（含文件与子目录） */
function sourceEntries(personAbs) {
  let entries
  try {
    entries = readdirSync(personAbs, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.name !== 'tickets' && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, abs: path.join(personAbs, entry.name), isDir: entry.isDirectory() }))
}

function main() {
  const flags = parse(process.argv.slice(2))
  const companyDir = flags.company !== undefined ? path.resolve(flags.company) : undefined
  const companyRoot = companyDir !== undefined ? path.dirname(companyDir) : undefined
  const workspacesRoot = path.resolve(flags.workspaces ?? path.join(companyRoot ?? '.', 'workspaces'))
  const aiwsRoot = path.resolve(flags.aiws ?? path.join(companyRoot ?? '.', '.AIWS'))
  if (!existsSync(workspacesRoot)) throw new Error(`workspaces 根不存在（先启动 daemon 建树）：${workspacesRoot}`)
  if (!existsSync(aiwsRoot)) throw new Error(`.AIWS 根不存在：${aiwsRoot}`)
  const apply = flags.apply === true
  const homes = findHomes(workspacesRoot)
  const plan = []
  for (const home of homes) {
    const source = findAiwsPersonDir(aiwsRoot, home.personId)
    if (source === undefined) continue
    for (const entry of sourceEntries(source.abs)) {
      const target = path.join(home.abs, entry.name)
      if (existsSync(target)) continue // 已存在不覆盖（幂等）
      plan.push({ personId: home.personId, from: entry.abs, to: target, isDir: entry.isDir })
      if (apply) {
        mkdirSync(path.dirname(target), { recursive: true })
        if (entry.isDir) cpSync(entry.abs, target, { recursive: true, errorOnExist: true })
        else copyFileSync(entry.abs, target)
      }
    }
  }
  const payload = { ok: true, dryRun: !apply, workspacesRoot, aiwsRoot, homes: homes.length, planned: plan.length, applied: apply ? plan.length : 0, items: plan }
  if (flags.json === true) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  else {
    process.stdout.write(`[workspace-migrate] ${apply ? 'APPLY' : 'DRY-RUN'} homes=${String(homes.length)} planned=${String(plan.length)}\n`)
    for (const item of plan) process.stdout.write(`  ${item.personId}: ${path.relative(process.cwd(), item.from)} → ${path.relative(process.cwd(), item.to)}\n`)
  }
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`[workspace-migrate] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
