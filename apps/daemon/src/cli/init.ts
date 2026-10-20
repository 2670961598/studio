// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L311-L358 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { initCompany } from '@studio-next/company'
import type { InitOptions } from '@studio-next/company'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdInit(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['name', 'dir', 'template']))
  if ('error' in parsed) {
    console.error(`init：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const slug = parsed.positionals[0]
  if (slug === undefined) {
    console.error('init：缺少 <slug>（例：studio-next init demo-corp）')
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 1) {
    console.error(`init：多余的位置参数：${parsed.positionals.slice(1).join(' ')}`)
    console.error(USAGE)
    return 1
  }

  const options: InitOptions = { slug, targetDir: parsed.flags.dir ?? path.resolve(slug) }
  if (parsed.flags.name !== undefined) options.name = parsed.flags.name
  if (parsed.flags.template !== undefined) options.templateDir = parsed.flags.template

  try {
    const result = await initCompany(options)
    console.log(`已生成公司目录：${result.dir}`)
    console.log(`git 首次提交：${result.gitCommit}`)
    console.log(`目录自检：通过（slug=${slug}；结构契约 docs/04-§二）`)
    return 0
  } catch (err) {
    // initCompany 的失败即 ClassifiedError(CONFIG_INVALID)（宁失败不半成品，已撤除产物）
    console.error(`init 失败：${errText(err)}`)
    return 1
  }
}

/**
 * company add <git-url> [名] —— git 网址即公司（DEV-27；docs/43-§一，§十1-4 定稿增补）
 *
 * 链路：真实 git clone → 剥离活性 .git 重建本地仓（任意深度剥 .git，禁整目录复制）→
 * schema 校验（写盘前）→ 初始化（localfile 平台字段 provision + 信任锚 trust=false +
 * .AIWS 员工工作区树 + 依赖清单自动安装到隔离插件根）。升级=同 git-url 再次调用
 * （镜像同步+内容变了才新提交+盖戳字段不回卷+有锚+slug 同家）。
 * 布局：<work-root>/（缺省=目标目录的上级）
 *   ├── <名>/            公司 git 目录（本命令产物）
 *   ├── .AIWS/           员工工作区树（不进公司 git 目录——docs/43-§五）
 *   └── var/platform|plugins   平台盘与隔离插件根（绝不写用户 ~/.dsh——docs/43-§四）
 */
