/**
 * rebuild —— 删库重建（F2-12：恢复重建+演习；rebuild --from jsonl 的库内通道）
 *
 * 语义：
 *   - source 为 dumpEvents 产出的 JSONL（逐行一条 EventRecord，含 ULID）；
 *     target 为目标库路径（重建演习传新路径或删库后的原路径）。
 *   - 打开 target → migrate()（幂等）→ **单事务重放全部行**：任一行坏（JSON 解析失败 /
 *     契约校验不过 / 重复 id 内容冲突）→ 整体回滚 + CONFIG_INVALID 指明 1 起行号——
 *     全量再生是原子语义，不留半截库（F2-12「再生后行数/哈希全对」的前提）。
 *   - 行内容与库内已有事件全列一致时走 appendEvent 幂等规则跳过（F2-13 回填幂等）。
 *
 * 限域（MIG-04 / docs/v2/16 §四；v2/05 §三 DOM-04）：
 *   - 重放范围**只有 events**；DOM-04 `cost_daily` 在排除域清单（EXCLUDED_DOMAINS），
 *     **只备份不重放**（备份走 backup.ts backupCostDaily）。rebuild 从不读写 cost_daily，
 *     RebuildResult.excludedDomains / renderRebuildReport 显式登记该域——报告不得声称
 *     钱账已重建（遗留不可重建；备份=恢复语义，非重建语义）。
 */
import { readFileSync } from 'node:fs'
import { configInvalid } from '@studio-next/contract'
import { openLedger } from './ledger.ts'
import { EXCLUDED_DOMAINS, excludedDomainRefs, renderExcludedDomainsSection } from './backup.ts'

// 排除域规范常量单点定义在 backup.ts（DOM-04 模块）；rebuild 固定入口 re-export 便于消费方
export { COST_DAILY_DOMAIN, COST_DAILY_EXCLUSION_REASON, EXCLUDED_DOMAINS, EXCLUDED_DOMAIN_REASONS } from './backup.ts'
export type { ExcludedDomainRef } from './backup.ts'

/** rebuild 结果：events=重放后库内事件数；version=target 库 schema 版本；excludedDomains=未重放域 */
export interface RebuildResult {
  events: number
  version: number
  /** 排除域清单（与 dump/drill 报告同源；当前 ['cost_daily']，DOM-04 只备份不重放） */
  excludedDomains: readonly string[]
}

/**
 * JSONL → 新库逐条 appendEvent（事务原子）。
 * 返回前 close 目标句柄（rebuild 自管生命周期；演习后由调用方重新 openLedger 验收）。
 */
export function rebuild(source: string, target: string): RebuildResult {
  const text = readFileSync(source, 'utf8')
  const lines = text.split('\n')
  const ledger = openLedger(target)
  const db = ledger.db
  let count = 0
  db.exec('BEGIN')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.trim() === '') continue // 空行（含 EOF 尾行）跳过
    const lineNo = i + 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      db.exec('ROLLBACK')
      ledger.close()
      configInvalid('store/rebuild:bad-line', `第 ${lineNo} 行 JSON 解析失败：${ errorMessage(err) }`)
    }
    try {
      ledger.appendEvent(parsed)
      count++
    } catch (err) {
      db.exec('ROLLBACK')
      ledger.close()
      configInvalid('store/rebuild:bad-line', `第 ${lineNo} 行被拒：${errorMessage(err)}`)
    }
  }
  db.exec('COMMIT')
  const version = ledger.version()
  const events = count // 单写连接内重放，COMMIT 后即库内计数
  ledger.close()
  return { events, version, excludedDomains: EXCLUDED_DOMAINS }
}

/** 重建报告（人读；「排除域」段与 drill/dump 同内容——显式声明 cost_daily 未重放） */
export function renderRebuildReport(result: RebuildResult, target?: string): string[] {
  const where = target === undefined ? '' : ` → ${target}`
  return [
    `已重建：events=${result.events} / schema v${result.version}${where}`,
    ...renderExcludedDomainsSection(excludedDomainRefs()),
  ]
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
