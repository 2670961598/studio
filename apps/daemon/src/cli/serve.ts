// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1517-L1548 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { runServe } from '../assembly/serve.ts'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import { errText, parseArgv } from './argv.ts'

/**
 * daemon.yaml 骨架渲染（studio-dev-103 S4A，studio-dev-125 实施）：company create 尾相位
 * 顺产 `<work-root>/var/daemon.yaml` 的同款内容。纪律：
 *   - 键集 ⊆ parseDaemonConfig 收的面（守门=test/cli/create-serve-face.test.ts 往返解析）；
 *   - 路径标量走 JSON.stringify 引号壳（含空格/特殊字符安全）；
 *   - 调用方负责幂等：在场即 kept，绝不覆盖手改（骨架只做首产）。
 */
export function renderDaemonYamlSkeleton(input: { dbPath: string; slug: string; companyDir: string; rootDir: string }): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    '# studio-next daemon 配置骨架 —— company create 顺产（studio-dev-103 S4A）；手改即用，绝不被命令覆盖',
    '# 全键面与语义：studio-next serve --help；v0 只收扁平 `key: value` 子集（不认识的键=启动拒，不静默丢）',
    `db: ${q(input.dbPath)}`,
    'platform: localfile',
    `company: ${q(input.slug)}`,
    `companyDir: ${q(input.companyDir)}`,
    `rootDir: ${q(input.rootDir)}`,
    `platformDir: ${q(path.join(input.rootDir, 'platform'))}`,
    'tickMs: 1000',
    '# 定时岗调度器（cron 到点→schedule 意图→主循环，结果落台账）；首跑可改 false 只看心跳',
    'jobs: true',
    '',
  ].join('\n')
}

export async function cmdServe(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.serve) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, new Set(['config']))
  if ('error' in parsed) {
    return usageFail('serve', parsed.error, CONCISE.serve)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('serve', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.serve)
  }
  const configPath = parsed.flags.config
  if (configPath === undefined) {
    return usageFail('serve', '缺少 --config <daemon.yaml>', CONCISE.serve)
  }
  try {
    const result = await runServe(configPath)
    if (result.stopReason === 'error') {
      console.error(`serve：运行中断（tick 异常）：${result.lastError ?? '未知'}`)
      return 2
    }
    console.log(`serve：已停机（共 ${result.ticks} 拍）`)
    return 0
  } catch (err) {
    // 配置/平台接线/公司目录装载失败：CONFIG_INVALID 形状，如实分类上报
    console.error(`serve 启动失败：${errText(err)}`)
    return 1
  }
}

