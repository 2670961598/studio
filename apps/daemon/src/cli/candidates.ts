// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L680-L741 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CANDIDATE_STATUS_VALUES, openLedger } from '@studio-next/store'
import { CONCISE, SECTION } from './usage.ts'
import { errText, parseArgv } from './argv.ts'
import { helpOk, missingSub, unknownSub, usageFail, wantsHelp } from './help.ts'

const CANDIDATES_SUBS = ['list'] as const

export async function cmdCandidates(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'list':
      break
    case undefined:
      // S1c-B 批示统一：裸组命令=错误行+组简段+exit 1（原 exit 0 收敛——git 惯例）
      return missingSub('candidates', CANDIDATES_SUBS, CONCISE.candidates)
    case '-h':
    case '--help':
    case 'help':
      return helpOk(SECTION.candidates)
    default:
      return unknownSub('candidates', sub, CANDIDATES_SUBS, CONCISE.candidates)
  }
  if (wantsHelp(rest)) return helpOk(SECTION.candidates) // S1b 预检（先于库存在性检查）
  const parsed = parseArgv(rest, new Set(['db']))
  if ('error' in parsed) {
    return usageFail('candidates list', parsed.error, CONCISE.candidates)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('candidates list', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.candidates)
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    return usageFail('candidates list', '缺少 --db <库路径>', CONCISE.candidates)
  }
  const resolved = path.resolve(dbPath)
  if (!existsSync(resolved)) {
    console.error(`candidates list：库不存在：${resolved}（只读面不代建库——建库走 studio-next company create <slug>（缺省即建库））`)
    return 1
  }
  try {
    const ledger = openLedger(resolved)
    try {
      const rows = ledger.candidatesByStatus([...CANDIDATE_STATUS_VALUES])
      const byStatus = new Map<string, number>()
      for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
      const dist = [...byStatus.entries()].map(([s, n]) => `${s}=${n}`).join(' ')
      console.log(`候选 ${rows.length} 条${dist === '' ? '（库空）' : `（${dist}）`}——库 ${resolved}（schema v${ledger.version()}，只读）`)
      for (const r of rows) {
        const hash = r.diff_hash.length > 17 ? `${r.diff_hash.slice(0, 17)}…` : r.diff_hash
        console.log(
          `${r.id}  ${r.status.padEnd(9)}  ${r.asset_type.padEnd(10)}  ${r.blast_radius.padEnd(10)}  ${r.version.padEnd(12)}  parent=${r.parent_id ?? '—（初代）'}  ${r.asset_path}  ${hash}`,
        )
      }
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 坏库/坏行（CONFIG_INVALID 形状）如实分类上报
    console.error(`candidates list 失败：${errText(err)}`)
    return 1
  }
}

/**
 * sandbox 子命令：进化链沙箱执行薄壳（语义全在 src/evolve/sandbox.ts——runner+CLI 链）。
 * 退出码语义（拟稿，sandbox.ts 头注）：链走完（证据落账+迁移完成）即 0——判定红是档案面
 * 非命令错误；用法/库/候选/状态面错误 1。库必须已存在：候选必须在库，写面不代建库
 * （candidates list 同款 existsSync 闸）。
 */
