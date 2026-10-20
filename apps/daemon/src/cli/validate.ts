// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L577-L604 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { USAGE } from './usage.ts'
import { errText } from './argv.ts'

export async function cmdValidate(argv: string[]): Promise<number> {
  const dir = argv[0]
  if (argv.length !== 1 || dir === undefined) {
    console.error('validate：需要恰好一个参数（公司目录路径）')
    console.error(USAGE)
    return 1
  }
  let files: Record<string, string>
  try {
    files = await readDirectoryFiles(path.resolve(dir))
  } catch (err) {
    console.error(`validate：读取目录失败：${errText(err)}`)
    return 1
  }
  const mounted = loadCompanyDirectory(files)
  if (mounted.ok) {
    const s = mounted.snapshot
    console.log(`合法：${s.slug}（${s.level} 级公司 · ${s.departments.length} 部门 · ${s.people.length} 人 · 平台 ${s.platform.platform}）`)
    return 0
  }
  for (const issue of mounted.issues) {
    console.error(`${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
  }
  console.error(`校验不通过：${mounted.issues.length} 个问题（docs/04-§九：结构不合法拒绝挂载，修法见上）`)
  return 1
}

/** ledger 子命令组：薄壳转调 store（drill/dump/rebuild 全部语义在 @studio-next/store） */
