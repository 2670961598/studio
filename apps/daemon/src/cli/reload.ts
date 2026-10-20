// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1382-L1451 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseDaemonConfig } from '../serve.ts'
import { awaitReloadResult, writeReloadRequest } from '../control/hot-reload.ts'
import { makeUlid } from '../engine/id.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdReload(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'root', 'config', 'timeout']))
  if ('error' in parsed) {
    console.error(`reload：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`reload：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  let timeoutMs = 15_000
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
      console.error(`reload：--timeout 取值非法：${parsed.flags.timeout}（须为 >=100 的整数毫秒）`)
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
        console.error(`reload：daemon.yaml 解析失败（${configPath}）：${errText(err)}`)
        return 1
      }
    } else if (parsed.flags.config !== undefined) {
      console.error(`reload：--config 指定的 daemon.yaml 不存在：${configPath}`)
      return 1
    } else {
      rootDir = path.resolve('./var')
    }
  }

  const id = makeUlid(Date.now())
  const request = { id, company: parsed.flags.company ?? null, requestedAt: Date.now() }
  writeReloadRequest(rootDir, request)
  console.log(`[reload] 请求已写：${path.join(rootDir, 'control', 'reload.request.json')}（id=${id}${request.company !== null ? `，company=${request.company}` : ''}）——等 daemon 拍边界处理（超时 ${timeoutMs}ms）`)

  const result = await awaitReloadResult(rootDir, id, timeoutMs)
  if (result === undefined) {
    console.error(`reload：超时无回执（${timeoutMs}ms）——daemon 未运行 / tickMs 过大 / 控制面目录不符（rootDir=${rootDir}；可用 --root/--config 指定）`)
    return 1
  }
  if (result.ok) {
    console.log(`[reload] 回执 ok（id=${result.id}）：${result.applied ? '已重装载' : `无动作（${result.reason ?? 'unchanged'}）`}${result.detail !== undefined ? `——${result.detail}` : ''}`)
    return 0
  }
  console.error(`[reload] 回执失败（id=${result.id}，reason=${result.reason ?? '?'}）：${result.detail ?? ''}`)
  return 1
}

/**
 * stop 子命令：控制面优雅停机薄壳（DEV-9 顺带项——孤儿进程问题的通道面；执行体全在
 * daemon 侧 src/serve.ts runServe + src/control/stop-channel.ts）。动机：`nohup sh -c "…"` 双层
 * 壳下 kill 外层 sh 不杀 node 孙进程——停机改走 daemon 自身优雅停（在途 worker 整树
 * 杀+台账落盘），回执为证。工位根发现序与 reload 同款：--root > --config（缺省
 * ./daemon.yaml，读其 rootDir）> 缺省 ./var。退出码：0=优雅停完成（回执 stopped=true）；
 * 1=超时无回执（daemon 未运行/拍太慢/控制面目录不符）或回执失败面。
 * DEV-41（2026-10-20 daemon-taiga6 一拍自停事故）：daemon 侧消费请求后改名 .consume +
 * 去重位落 daemon_kv——本命令面零改（写请求/轮询回执按 id 匹配不变；回执文件保留）。
 */
