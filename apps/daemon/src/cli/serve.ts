// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1517-L1548 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { runServe } from '../serve.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdServe(argv: string[]): Promise<number> {  const parsed = parseArgv(argv, new Set(['config']))
  if ('error' in parsed) {
    console.error(`serve：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`serve：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const configPath = parsed.flags.config
  if (configPath === undefined) {
    console.error('serve：缺少 --config <daemon.yaml>')
    console.error(USAGE)
    return 1
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

