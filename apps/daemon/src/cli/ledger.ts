// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L605-L679 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { openLedger, rebuild, renderDrillReport, runLedgerDrill } from '@studio-next/store'
import { USAGE } from './usage.ts'
import { errText } from './argv.ts'

export async function cmdLedger(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'drill': {
      const dbPath = rest[0]
      if (rest.length !== 1 || dbPath === undefined) {
        console.error('ledger drill：需要恰好一个参数（演习库路径；必须不存在——防误删真实台账）')
        console.error(USAGE)
        return 1
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
      const [dbPath, outPath] = rest
      if (rest.length !== 2 || dbPath === undefined || outPath === undefined) {
        console.error('ledger dump：需要恰好两个参数（库路径、输出.jsonl）')
        console.error(USAGE)
        return 1
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
      const [source, target] = rest
      if (rest.length !== 2 || source === undefined || target === undefined) {
        console.error('ledger rebuild：需要恰好两个参数（源.jsonl、目标库路径）')
        console.error(USAGE)
        return 1
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
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    default:
      console.error(`未知 ledger 子命令：${sub}`)
      console.error(USAGE)
      return 1
  }
}

/**
 * candidates 子命令组：进化管线现状只读面（薄壳——语义全在 @studio-next/store 读面，
 * candidatesByStatus 全状态集=全量；只列不改）。库不存在即拒：只读面不代建库（panel 同款
 * existsSync 闸——openLedger 会建库迁移，代建即副作用，违「只读」语义）。
 */
