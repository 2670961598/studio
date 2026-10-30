// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L742-L812 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { openLedgerWriter } from '@studio-next/store'
import { renderSandboxLines, runCandidateSandbox } from '../evolve/sandbox.ts'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdSandbox(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.sandbox) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'command', 'file', 'timeout', 'root']))
  if ('error' in parsed) {
    return usageFail('sandbox', parsed.error, CONCISE.sandbox)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('sandbox', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.sandbox)
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    return usageFail('sandbox', '缺少 --db <库路径>', CONCISE.sandbox)
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    return usageFail('sandbox', '缺少 --candidate <候选 id>', CONCISE.sandbox)
  }
  let timeoutMs: number | undefined
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      console.error(`sandbox：--timeout 取值非法：${parsed.flags.timeout}（须为正整数毫秒）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`sandbox：库不存在：${resolvedDb}（候选必须在库——写面不代建库——建库走 studio-next company create <slug>（缺省即建库））`)
    return 1
  }
  try {
    // 写面（候选状态迁移 + verification 快照）：取 writer 租约（daemon 持锁时
    // STALL/writer-lease-held 拒，PB-5 围栏覆盖）
    const ledger = openLedgerWriter(resolvedDb, 'cli:sandbox')
    try {
      const row = ledger.getCandidate(candidateId)
      if (row === undefined) {
        console.error(`sandbox：候选 ${candidateId} 不在库（--candidate 回查失败）`)
        return 1
      }
      const result = await runCandidateSandbox(ledger, {
        candidateId,
        ...(parsed.flags.command !== undefined ? { testCommand: parsed.flags.command } : {}),
        ...(parsed.flags.file !== undefined ? { changeFile: parsed.flags.file } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        assetRoot: parsed.flags.root ?? '.',
      })
      for (const line of renderSandboxLines(result, row)) console.log(line)
      console.log(`候选 ${candidateId} 沙箱完成：${result.report.pass ? 'PASS' : 'FAIL'}（证据已落台账，状态 ${ledger.getCandidate(candidateId)?.status ?? '?'}）`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID/EVOLVE_REJECT——sandbox.ts 头注分类面）
    console.error(`sandbox 失败：${errText(err)}`)
    return 1
  }
}

/**
 * cutover 子命令：进化链切权薄壳（语义全在 src/evolve/cutover.ts——受控上产执行器）。
 * --file 必给（新内容全文——判负闸消费其 sha256）；--company 必给（events.company 台账
 * 路由键，postmortem 同款不猜）。库必须已存在：事件要落账+状态要迁移，写面不代建库
 * （sandbox 同款 existsSync 闸）。--no-restart 抑制重启提示（v0 恒不实际重启——诚实边界）。
 */
