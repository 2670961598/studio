// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L577-L604 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { CONCISE, SECTION } from './usage.ts'
import { errText } from './argv.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'

/**
 * 目录结构校验内核（挂载闸，docs/04-§九）——两个命令面共用单一语义源：
 *   - company check <目录>（studio-dev-103 S2 候选 B，studio-dev-125 实施）：正位命令
 *   - validate <目录>：兼容别名——加法式弃用告警（stderr 一行，退码/输出零变化），
 *     后续版本移除；语义单一源在本函数，两个面只是入口壳
 */
export async function runStructureCheck(dir: string): Promise<number> {
  let files: Record<string, string>
  try {
    files = await readDirectoryFiles(path.resolve(dir))
  } catch (err) {
    console.error(`check：读取目录失败：${errText(err)}`)
    return 1
  }
  const mounted = loadCompanyDirectory(files)
  if (mounted.ok) {
    const s = mounted.snapshot
    console.log(`合法：${s.slug}（${s.level} 级公司 · ${s.departments.length} 部门 · ${s.people.length} 人 · 平台 ${s.platform.platform}）`)
    // S3 下一步指引（E10：合法之后常卡在「然后呢」——指向编排导入与读面）
    console.log('下一步：')
    console.log('  1. 编排导入/从零建：studio-next company add <git-url>（既有公司仓）或 company create <slug>（建号+建库一条龙）')
    console.log(`  2. 概览读面：studio-next overview --company ${dir}`)
    return 0
  }
  for (const issue of mounted.issues) {
    console.error(`${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
  }
  console.error(`校验不通过：${mounted.issues.length} 个问题（docs/04-§九：结构不合法拒绝挂载，修法见上）`)
  return 1
}

/** 收一个目录路径、拒旗标形令牌（check/validate 两面同规；分面求助各自回自己的 concise） */
function oneDirArg(face: string, argv: string[], concise: string): { dir: string } | number {
  const dir = argv[0]
  if (argv.length !== 1 || dir === undefined) {
    return usageFail(face, '需要恰好一个参数（公司目录路径）', concise)
  }
  if (dir.startsWith('--')) {
    return usageFail(face, `未知旗标：${dir}（本命令无旗标——收一个目录路径）`, concise)
  }
  return { dir }
}

/**
 * company check <目录> —— 目录结构校验正位面（S2 候选 B：顶级 validate 的语义由本命令
 * 接棒）。本命令无旗标；-h/--help/help 预检出组全文段（S1b——零副作用）。
 */
export async function cmdCompanyCheck(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.company)
  const args = oneDirArg('company check', argv, CONCISE.company)
  return typeof args === 'number' ? args : runStructureCheck(args.dir)
}

/**
 * validate <目录> —— 兼容别名（已让位 company check——S2 候选 B）。加法式弃用：stderr
 * 一行告警（脚本管道 stdout 结果面不混入），退码/输出与 company check 逐字节同款；
 * 后续版本移除（docs/17-§2 CLI 人机面约定）。
 */
export async function cmdValidate(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.validate)
  const args = oneDirArg('validate', argv, CONCISE.validate)
  if (typeof args === 'number') return args
  console.error('validate：已让位 company check（同语义同退码同输出）——本命令保留兼容，后续版本移除（studio-dev-103 S2）')
  return runStructureCheck(args.dir)
}

/** ledger 子命令组：薄壳转调 store（drill/dump/rebuild 全部语义在 @studio-next/store） */
