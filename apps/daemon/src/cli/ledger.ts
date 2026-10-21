// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L605-L679 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { openLedger, rebuild, renderDrillReport, runLedgerDrill } from '@studio-next/store'
import { CONCISE, SECTION } from './usage.ts'
import { errText } from './argv.ts'
import { helpOk, missingSub, unknownSub, usageFail, wantsHelp } from './help.ts'

/** 组面已知子命令表（S1d did-you-mean 的候选集=本表） */
const LEDGER_SUBS = ['drill', 'dump', 'rebuild'] as const

export async function cmdLedger(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'drill': {
      if (wantsHelp(rest)) return helpOk(SECTION.ledger) // S1b 预检（先于副作用——不建库）
      const dbPath = rest[0]
      if (rest.length !== 1 || dbPath === undefined) {
        return usageFail('ledger drill', '需要恰好一个参数（演习库路径；必须不存在——防误删真实台账）', CONCISE.ledger)
      }
      try {
        const report = await runLedgerDrill(path.resolve(dbPath))
        for (const line of renderDrillReport(report)) console.log(line)
        return report.pass ? 0 : 1
      } catch (err) {
        // ClassifiedError(CONFIG_INVALID)（路径已存在等防呆）与重建失败，如实分类上报
        console.error(`ledger drill 失败：${errText(err)}`)
        return 1
      }
    }
    case 'dump': {
      if (wantsHelp(rest)) return helpOk(SECTION.ledger)
      const [dbPath, outPath] = rest
      if (rest.length !== 2 || dbPath === undefined || outPath === undefined) {
        return usageFail('ledger dump', '需要恰好两个参数（库路径、输出.jsonl）', CONCISE.ledger)
      }
      try {
        const ledger = openLedger(path.resolve(dbPath))
        try {
          const { lines } = ledger.dumpEvents(outPath)
          console.log(`已导出 ${lines} 行 → ${outPath}`)
        } finally {
          ledger.close()
        }
        return 0
      } catch (err) {
        console.error(`ledger dump 失败：${errText(err)}`)
        return 1
      }
    }
    case 'rebuild': {
      if (wantsHelp(rest)) return helpOk(SECTION.ledger)
      const [source, target] = rest
      if (rest.length !== 2 || source === undefined || target === undefined) {
        return usageFail('ledger rebuild', '需要恰好两个参数（源.jsonl、目标库路径）', CONCISE.ledger)
      }
      try {
        const result = rebuild(path.resolve(source), path.resolve(target))
        console.log(`已重建：events=${result.events} / schema v${result.version} → ${target}`)
        return 0
      } catch (err) {
        console.error(`ledger rebuild 失败：${errText(err)}`)
        return 1
      }
    }
    case undefined:
      // S1c-B 批示统一：裸组命令=错误行+组简段+exit 1（原 exit 0 收敛——git 惯例）
      return missingSub('ledger', LEDGER_SUBS, CONCISE.ledger)
    case '-h':
    case '--help':
    case 'help':
      return helpOk(SECTION.ledger)
    default:
      return unknownSub('ledger', sub, LEDGER_SUBS, CONCISE.ledger)
  }
}

/**
 * candidates 子命令组：进化管线现状只读面（薄壳——语义全在 @studio-next/store 读面，
 * candidatesByStatus 全状态集=全量；只列不改）。库不存在即拒：只读面不代建库（panel 同款
 * existsSync 闸——openLedger 会建库迁移，代建即副作用，违「只读」语义）。
 */
