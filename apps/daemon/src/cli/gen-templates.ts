/**
 * gen-templates —— 分级公司模板生成器 CLI 薄壳（DEV-14，docs/36-§4 M-A）。
 *
 * 本体在 @studio-next/company（renderLevelTemplate/writeLevelTemplate/regenerateLevelTemplates
 * ——渲染后自检红即不落盘）；此处只做旗标解析与结果面。缺省落仓根 templates/（再生成零
 * diff——花名种子冻结）；--out 可指到任意目录（隔离面/预览面）。
 */
import { fileURLToPath } from 'node:url'
import { regenerateLevelTemplates } from '@studio-next/company'
import { CONCISE, SECTION } from './usage.ts'
import { errText, parseArgv } from './argv.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'

export async function cmdGenTemplates(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['gen-templates']) // S1b 预检：先于解析、零副作用
  const parsed = parseArgv(argv, new Set(['out']))
  if ('error' in parsed) return usageFail('gen-templates', parsed.error, CONCISE['gen-templates'])
  if (parsed.positionals.length > 0) {
    return usageFail('gen-templates', `多余的位置参数：${parsed.positionals.join(' ')}（本命令无位置参数）`, CONCISE['gen-templates'])
  }
  const outRoot = parsed.flags.out ?? fileURLToPath(new URL('../../../../templates', import.meta.url))

  try {
    const results = await regenerateLevelTemplates(outRoot)
    for (const r of results) {
      const name = r.dir.split('/').pop() ?? `company-${r.level}-level`
      console.log(`${name}：${r.fileCount} 文件 · ${r.deptCount} 部门 · ${r.peopleCount} 人 · ${r.jobCount} 定时岗 · 自检绿（目录校验+init 占位断言）`)
    }
    console.log(`已生成 ${results.length} 套分级模板（3-9 级，docs/33-§3）→ ${outRoot}`)
    console.log('验收：逐套 studio-next company validate <目录> 全 PASS；再生成零 diff（花名种子冻结——namer.ts）')
    return 0
  } catch (err) {
    // 渲染/自检红即不落盘（宁失败不半成品）；如实上报
    console.error(`gen-templates 失败：${errText(err)}`)
    return 1
  }
}
