// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L991-L1083 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { openLedger } from '@studio-next/store'
import { parsePostmortemInput, renderPostmortemLines, runPostmortemChain } from '../evolve/postmortem.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdPostmortem(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'company', 'issue', 'input', 'casebook', 'slug', 'date', 'dept', 'level', 'actor']))
  if ('error' in parsed) {
    console.error(`postmortem：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`postmortem：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('postmortem：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const company = parsed.flags.company
  if (company === undefined) {
    console.error('postmortem：缺少 --company <公司 slug>（events.company 台账路由键，不猜）')
    console.error(USAGE)
    return 1
  }
  const inputPath = parsed.flags.input
  if (inputPath === undefined) {
    console.error('postmortem：缺少 --input <复盘.json>（复盘正文不可虚构——七件套形状见 src/evolve/postmortem.ts PostmortemInput；fail-closed 拒空模板旁路）')
    console.error(USAGE)
    return 1
  }
  let raw: string
  try {
    raw = readFileSync(path.resolve(inputPath), 'utf8')
  } catch (err) {
    console.error(`postmortem：--input 文件不可读 ${inputPath}：${errText(err)}`)
    return 1
  }
  let parsedInput: ReturnType<typeof parsePostmortemInput>
  try {
    parsedInput = parsePostmortemInput(JSON.parse(raw) as unknown)
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`postmortem：--input 不是合法 JSON：${inputPath}（${err.message}）`)
    } else {
      console.error(`postmortem：复盘输入形状不合法（fail-fast，逐字段修法）：${errText(err)}`)
    }
    return 1
  }
  const issue = parsed.flags.issue ?? parsedInput.issue
  if (parsed.flags.issue !== undefined && parsed.flags.issue !== parsedInput.issue) {
    console.error(`postmortem：--issue ${parsed.flags.issue} 与 JSON 内 issue ${parsedInput.issue} 不一致（双源分歧如实拒）`)
    return 1
  }
  let level: number | undefined
  if (parsed.flags.level !== undefined) {
    level = Number.parseInt(parsed.flags.level, 10)
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      console.error(`postmortem：--level 取值非法：${parsed.flags.level}（须为 1-9 整数——04-§四等级口径）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`postmortem：库不存在：${resolvedDb}（POSTMORTEM 事件要落账——写面不代建库，先由 daemon/回填侧建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolvedDb)
    try {
      const result = runPostmortemChain(ledger, {
        input: parsedInput,
        casebookRoot: parsed.flags.casebook ?? path.join(process.cwd(), 'docs/casebook'),
        ...(parsed.flags.slug !== undefined ? { slug: parsed.flags.slug } : {}),
        ...(parsed.flags.date !== undefined ? { date: parsed.flags.date } : {}),
        company,
        ...(parsed.flags.dept !== undefined ? { dept: parsed.flags.dept } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(parsed.flags.actor !== undefined ? { actor: parsed.flags.actor } : {}),
      })
      for (const line of renderPostmortemLines(result)) console.log(line)
      console.log(`复盘单 ${issue} 归档完成：事件 ${result.event.id} → 案例条目 ${result.relPath}`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——postmortem.ts 头注分类面）
    console.error(`postmortem 失败：${errText(err)}`)
    return 1
  }
}

/** panel 子命令：薄壳转 servePanel（语义全在 @studio-next/panel；默认只绑本机） */
