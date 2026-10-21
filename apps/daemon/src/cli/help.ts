// help.ts —— 分面 help 与错误面小件（studio-dev-103 S1，studio-dev-125 实施；零依赖手写——docs/16-§二 选型纪律）。
//
// 契约（S5c 冻结声明）：
//   - 流分面（治 E7「两种流」）：错误行 → stderr；帮助面（-h/--help/help 与错误面附带的
//     简段）→ stdout。脚本可稳定预期：stderr 只出错误行，stdout 只出帮助/结果面。
//   - 退出码：显式求助（-h/--help/help）=0；用法错（缺参/未知旗标/裸命令/未知子命令）=1。
//   - 裸命令=错误行+简段+exit 1（git 惯例，制作人 2026-10-21 批示 S1c-B——原 ledger/candidates
//     裸命令 exit 0 收敛为 1）。
//   - 预检（S1b，治 E9）：-h/--help/help 在 argv 任一位出现即出该命令帮助，先于位置参数
//     解析、零副作用（不 scandir/不建目录/不碰库）。

/** 求助令牌（任何位置出现即出面——含 `company add -h`、`validate --help`） */
const HELP_TOKENS = new Set(['-h', '--help', 'help'])

/** S1b 预检：argv 任一位出现求助令牌即 true（调用方先于 parseArgv/副作用检查本谓词） */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((a) => HELP_TOKENS.has(a))
}

/**
 * S1d 拼写建议（did-you-mean，零依赖手写 ≤2 编辑距离——docs/16-§二）：
 * 命中条件=Levenshtein ≤2，或输入 ≥3 字符且为某已知命令前缀；无命中=undefined。
 */
export function suggestNear(input: string, known: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = 3
  for (const candidate of known) {
    if (candidate === input) continue
    const distance = levenshtein(input, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  if (best !== undefined) return best
  if (input.length >= 3) return known.find((k) => k.startsWith(input))
  return undefined
}

/** 两行滚动数组 DP（命令名长度 ≤16，O(n·m) 足够；零依赖） */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = row
  }
  return prev[b.length]!
}

/** 用法错误面：错误行→stderr、本命令简段→stdout、exit 1（子命令错误只打本命令段——S1a） */
export function usageFail(prefix: string, message: string, concise: string): number {
  console.error(`${prefix}：${message}`)
  console.log(concise)
  return 1
}

/** 求助面：本命令全文段→stdout、exit 0（全文段来自 usage.ts SECTION——单源） */
export function helpOk(section: string): number {
  console.log(section)
  return 0
}

/** 组面缺子命令（裸组命令）：错误行+组简段、exit 1（S1c-B 批示统一） */
export function missingSub(group: string, subcommands: readonly string[], concise: string): number {
  console.error(`${group}：缺少子命令（当前支持：${subcommands.join('、')}）`)
  console.log(concise)
  return 1
}

/** 未知子命令：带 did-you-mean 建议（S1d）、错误行+组简段、exit 1 */
export function unknownSub(group: string, sub: string, subcommands: readonly string[], concise: string): number {
  const hint = suggestNear(sub, subcommands)
  const near = hint === undefined ? '' : `——是否想说 ${hint}？`
  console.error(`${group}：未知子命令：${sub}${near}（当前支持：${subcommands.join('、')}）`)
  console.log(concise)
  return 1
}
