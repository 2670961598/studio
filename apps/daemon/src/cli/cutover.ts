// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L813-L899 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { openLedger } from '@studio-next/store'
import { renderCutoverLines, runCutover } from '../evolve/cutover.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdCutover(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'file', 'company', 'root', 'actor', 'dept', 'level']), undefined, new Set(['no-restart', 'no-gray']))
  if ('error' in parsed) {
    console.error(`cutover：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`cutover：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('cutover：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    console.error('cutover：缺少 --candidate <候选 id>')
    console.error(USAGE)
    return 1
  }
  const filePath = parsed.flags.file
  if (filePath === undefined) {
    console.error('cutover：缺少 --file <新文件>（新内容全文——判负闸消费其 sha256，缺即用法错误）')
    console.error(USAGE)
    return 1
  }
  const company = parsed.flags.company
  if (company === undefined) {
    console.error('cutover：缺少 --company <公司 slug>（events.company 台账路由键，不猜）')
    console.error(USAGE)
    return 1
  }
  let level: number | undefined
  if (parsed.flags.level !== undefined) {
    level = Number.parseInt(parsed.flags.level, 10)
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      console.error(`cutover：--level 取值非法：${parsed.flags.level}（须为 1-9 整数——04-§四等级口径）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`cutover：库不存在：${resolvedDb}（切权要落账+迁移——写面不代建库，先由 daemon/提案面建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolvedDb)
    try {
      const result = runCutover(ledger, candidateId, {
        newFilePath: filePath,
        assetRoot: parsed.flags.root ?? '.',
        company,
        restart: !parsed.booleans.has('no-restart'),
        gray: !parsed.booleans.has('no-gray'),
        ...(parsed.flags.actor !== undefined ? { actor: parsed.flags.actor } : {}),
        ...(parsed.flags.dept !== undefined ? { dept: parsed.flags.dept } : {}),
        ...(level !== undefined ? { level } : {}),
      })
      const row = ledger.getCandidate(candidateId)
      if (row !== undefined) {
        for (const line of renderCutoverLines(result, row)) console.log(line)
      }
      console.log(`候选 ${candidateId} 切权完成：${result.targetPath}（hash → ${result.newHash}，状态 ${row?.status ?? '?'}）`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——cutover.ts 头注失败面枚举；失败已回滚不留半改态）
    console.error(`cutover 失败：${errText(err)}`)
    return 1
  }
}

/**
 * gray 子命令：灰度观察窗薄壳（语义全在 src/evolve/gray.ts——进化链四刀之四收官）。
 * 三动作（互斥）：缺省=查窗（只读 kv 状态面）｜--check=手动检查（判定三态：阈值破窗→
 * 自动回滚字节级恢复+promoted→retired+note=gray-rollback 事件；到期无事故→关窗；守夜中
 * →无动作）｜--close=手动关窗（幂等；关窗不回滚——回滚只由事故阈值触发，面分离）。
 * 回滚是合法判定结果非命令错误（sandbox 判定面同款口径）→ exit 0；无窗候选/用法错/库
 * 面错 exit 1。备份锚点由 cutover 定名约定派生：--root（缺省 '.'）+ 窗内 assetPath +
 * `.bak-<候选id>`。库必须已存在（check/close 是写面——kv/事件/生产文件，不代建库）。
 */
