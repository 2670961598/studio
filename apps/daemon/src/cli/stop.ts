// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1452-L1516 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseDaemonConfig } from '../serve.ts'
import { awaitStopResult, writeStopRequest, type StopRequest } from '../control/stop-channel.ts'
import { makeUlid } from '../engine/id.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdStop(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['reason', 'root', 'config', 'timeout']))
  if ('error' in parsed) {
    console.error(`stop：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`stop：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  let timeoutMs = 15_000
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
      console.error(`stop：--timeout 取值非法：${parsed.flags.timeout}（须为 >=100 的整数毫秒）`)
      return 1
    }
  }

  // 工位根发现序：--root > --config 的 rootDir > ./var（daemon 控制面落点 <rootDir>/control/）
  let rootDir: string
  if (parsed.flags.root !== undefined) {
    rootDir = path.resolve(parsed.flags.root)
  } else {
    const configPath = parsed.flags.config ?? './daemon.yaml'
    if (existsSync(path.resolve(configPath))) {
      try {
        rootDir = path.resolve(parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8')).rootDir)
      } catch (err) {
        console.error(`stop：daemon.yaml 解析失败（${configPath}）：${errText(err)}`)
        return 1
      }
    } else if (parsed.flags.config !== undefined) {
      console.error(`stop：--config 指定的 daemon.yaml 不存在：${configPath}`)
      return 1
    } else {
      rootDir = path.resolve('./var')
    }
  }

  const id = makeUlid(Date.now())
  const request: StopRequest = {
    id,
    requestedAt: Date.now(),
    ...(parsed.flags.reason !== undefined ? { reason: parsed.flags.reason } : {}),
  }
  writeStopRequest(rootDir, request)
  console.log(`[stop] 请求已写：${path.join(rootDir, 'control', 'stop.request.json')}（id=${id}${request.reason !== undefined ? `，reason=${request.reason}` : ''}）——等 daemon 拍边界优雅停（超时 ${timeoutMs}ms）`)

  const result = await awaitStopResult(rootDir, id, timeoutMs)
  if (result === undefined) {
    console.error(`stop：超时无回执（${timeoutMs}ms）——daemon 未运行 / tickMs 过大 / 控制面目录不符（rootDir=${rootDir}；可用 --root/--config 指定）`)
    return 1
  }
  if (result.ok && result.stopped) {
    console.log(`[stop] 回执 ok（id=${result.id}）：daemon 已优雅停——在途 worker 整树杀、台账已落盘${result.detail !== undefined ? `——${result.detail}` : ''}`)
    return 0
  }
  console.error(`[stop] 回执失败（id=${result.id}）：${result.detail ?? result.reason ?? '未知失败面'}`)
  return 1
}

/** serve 子命令：薄壳转 runServe（配置装载/循环/优雅停语义全在 src/serve.ts） */
