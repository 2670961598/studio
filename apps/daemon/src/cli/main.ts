#!/usr/bin/env node
// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1-L113（头注）+L1549-L1603（main 体）逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、新装配 import 头与路径注记机械替换）。
/**
 * studio-next CLI 入口与分发（v0.1-M3；落点按 docs/25-§七 P1 拟批默认：daemon 包出 bin，不新增 apps/cli）。
 *
 * 【命令文档单一源 = src/cli/usage.ts】（studio-dev-103 S6 收敛，studio-dev-125 实施）：
 *   - 全命令清单与用法 → `studio-next --help`（= usage.ts 的 USAGE 装配全文）
 *   - 单命令全文段 → usage.ts 的 SECTION；错误面/裸命令简段 → usage.ts 的 CONCISE
 *   - 本头注不复制命令文档（双源漂移教训 = 提案 E5：头注曾漏 company validate 段）；
 *     增删/改名命令只回写 usage.ts 与 docs/17-§2（对账闸 = apps/daemon/test/cli/help-face.test.ts）。
 *
 * argv 解析零依赖手写（单命令薄壳不值得引库；16-§二 选型纪律：引新依赖须登记选型表）。
 * 用 process.exitCode 而非 process.exit 收尾：让管道下的 stdout/stderr 先冲刷再自然退出。
 */
import { readFileSync } from 'node:fs'
import { SECTION, USAGE } from './usage.ts'
import { errText } from './argv.ts'
import { suggestNear } from './help.ts'

/** 版本面（S5c/E6）：apps/daemon/package.json=同仓单一源（不引 process.env 仿冒面） */
function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }
  return pkg.version ?? 'unknown'
}
import { cmdInit } from './init.ts'
import { cmdGenTemplates } from './gen-templates.ts'
import { cmdCompany } from './company.ts'
import { cmdValidate } from './validate.ts'
import { cmdLedger } from './ledger.ts'
import { cmdCandidates } from './candidates.ts'
import { cmdJobs } from './jobs.ts'
import { cmdSandbox } from './sandbox.ts'
import { cmdCutover } from './cutover.ts'
import { cmdGray } from './gray.ts'
import { cmdPostmortem } from './postmortem.ts'
import { cmdPanel } from './panel.ts'
import { cmdOverview } from './overview.ts'
import { cmdExternal } from './external.ts'
import { cmdReload } from './reload.ts'
import { cmdStop } from './stop.ts'
import { cmdServe } from './serve.ts'
import { cmdTaigaCure } from './taiga-cure.ts'
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'init':
      return cmdInit(rest)
    case 'gen-templates':
      return cmdGenTemplates(rest)
    case 'company':
      return cmdCompany(rest)
    case 'validate':
      return cmdValidate(rest)
    case 'ledger':
      return cmdLedger(rest)
    case 'candidates':
      return cmdCandidates(rest)
    case 'jobs':
      return cmdJobs(rest)
    case 'sandbox':
      return cmdSandbox(rest)
    case 'cutover':
      return cmdCutover(rest)
    case 'gray':
      return cmdGray(rest)
    case 'postmortem':
      return cmdPostmortem(rest)
    case 'panel':
      return cmdPanel(rest)
    case 'overview':
      return cmdOverview(rest)
    case 'external':
      return cmdExternal(rest)
    case 'serve':
      return cmdServe(rest)
    case 'taiga-cure':
      return cmdTaigaCure(rest)
    case 'reload':
      return cmdReload(rest)
    case 'stop':
      return cmdStop(rest)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    case '--version':
    case '-V': {
      // S5c 版本声明（E6）：读 apps/daemon/package.json（同仓单一源），单行打印
      console.log(`studio-next ${cliVersion()}`)
      return 0
    }
    default: {
      // S1d（studio-dev-103）：typo 面不再倾倒全文——错误行（含 did-you-mean）→stderr、
      // 已知命令一行+看全文指引→stdout、exit 1
      const hint = suggestNear(command, Object.keys(SECTION))
      console.error(`未知子命令：${command}${hint === undefined ? '' : `——是否想说 ${hint}？`}`)
      console.log(`已知命令：${Object.keys(SECTION).join('、')}`)
      console.log('全文：studio-next --help')
      return 1
    }
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(`studio-next：未预期错误：${errText(err)}`)
    process.exitCode = 1
  },
)
