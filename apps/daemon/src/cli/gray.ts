// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L900-L990 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { openLedger } from '@studio-next/store'
import { renderGrayCheckLines, renderGrayStatusLines, checkGrayWindow, closeGrayWindow, readGrayWindow } from '../evolve/gray.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdGray(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'root']), undefined, new Set(['check', 'close']))
  if ('error' in parsed) {
    console.error(`gray：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`gray：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.booleans.has('check') && parsed.booleans.has('close')) {
    console.error('gray：--check 与 --close 互斥（检查=判定+自动处置；关窗=平安提前收口——三动作一次一个）')
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('gray：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    console.error('gray：缺少 --candidate <候选 id>')
    console.error(USAGE)
    return 1
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`gray：库不存在：${resolvedDb}（观察窗检查是写面（kv/事件/生产文件）——不代建库，先由 daemon/切权面建库）`)
    return 1
  }
  const assetRoot = parsed.flags.root ?? '.'
  try {
    const ledger = openLedger(resolvedDb)
    try {
      // 备份锚点派生（cutover ⑥ 定名约定：--root + assetPath + .bak-<候选id>——回滚物理基础）
      const deriveBackup = (assetPath: string): string => path.resolve(assetRoot, `${assetPath}.bak-${candidateId}`)

      if (parsed.booleans.has('check')) {
        const state = readGrayWindow(ledger, candidateId)
        if (state === null) {
          console.error(`gray：候选 ${candidateId} 无灰度观察窗（kv gray:${candidateId} 缺——无窗候选不检查；窗由 cutover 默认后缀开）`)
          return 1
        }
        const result = checkGrayWindow(ledger, deriveBackup(state.assetPath))
        for (const line of renderGrayCheckLines(result)) console.log(line)
        console.log(
          `候选 ${candidateId} 灰度检查完成：${result.rolled ? '已自动回滚（零事故破窗）' : result.done ? '窗已收口（平安）' : '守夜中（无动作）'}` +
            `｜信号 ${String(result.incidents)} 条｜窗状态 ${readGrayWindow(ledger, candidateId)?.status ?? '?'}`,
        )
        return 0
      }

      if (parsed.booleans.has('close')) {
        const { state, changed } = closeGrayWindow(ledger, candidateId)
        for (const line of renderGrayStatusLines(state, deriveBackup(state.assetPath), Date.now())) console.log(line)
        console.log(
          changed
            ? `候选 ${candidateId} 灰度观察窗已手动关窗（kv gray:${candidateId} → closed——窗平安提前收口=可请求制作人过目）`
            : `候选 ${candidateId} 灰度观察窗已是 ${state.status}（幂等无动作）`,
        )
        return 0
      }

      // 缺省动作：查窗（只读）
      const state = readGrayWindow(ledger, candidateId)
      if (state === null) {
        console.error(`gray：候选 ${candidateId} 无灰度观察窗（kv gray:${candidateId} 缺——窗由 cutover 默认后缀开，--no-gray 跳过的切权无窗）`)
        return 1
      }
      for (const line of renderGrayStatusLines(state, deriveBackup(state.assetPath), Date.now())) console.log(line)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——gray.ts 头注失败面枚举；回滚失败窗保持 open）
    console.error(`gray 失败：${errText(err)}`)
    return 1
  }
}

/**
 * postmortem 子命令：复盘归档薄壳（语义全在 src/evolve/postmortem.ts——渲染器+CLI 链）。
 * --input 必给（拟稿，postmortem.ts 头注：复盘正文不可虚构——缺即用法错误，不给空模板
 * 充数的旁路）；--issue 与 JSON 内 issue 双给时须一致（双源分歧如实拒）。库必须已存在：
 * 事件要落账，写面不代建库（sandbox 同款 existsSync 闸）。
 */
