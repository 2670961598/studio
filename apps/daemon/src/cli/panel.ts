// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1084-L1128 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadConversationWritePolicy, servePanel, type ConversationAppOptions } from '@studio-next/panel'
import { DaemonPanelConversationStore } from '../assembly/panel/conversation-store.ts'
import { ConversationStore as DaemonConversationStore } from '../engine/conversation/store.ts'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdPanel(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.panel) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, new Set(['db', 'port', 'company-dir']))
  if ('error' in parsed) {
    return usageFail('panel', parsed.error, CONCISE.panel)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('panel', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.panel)
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    return usageFail('panel', '缺少 --db <库路径>', CONCISE.panel)
  }
  let port = 8791
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`panel：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  // 面板对话页生产装配（studio-dev-654a）：传 --company-dir 才注入 ConversationStore；
  // 缺省不传=store:null 503 降级（不伪造空列表，docs/v2/14-§8.1）。
  let conversation: ConversationAppOptions | undefined
  const companyDirFlag = parsed.flags['company-dir']
  if (companyDirFlag !== undefined) {
    const companyDir = path.resolve(companyDirFlag)
    // fail-fast：不代建公司目录（否则 store 递归 mkdir 会造出空目录并让读面 200 空列表）
    if (!existsSync(companyDir) || !statSync(companyDir).isDirectory()) {
      console.error(`panel：--company-dir 目录不存在或不是目录：${companyDir}（拒启；不代建公司目录）`)
      return 1
    }
    const store = new DaemonConversationStore({ dir: path.join(companyDir, 'conversations') })
    const policy = loadConversationWritePolicy(process.env)
    conversation = { store: new DaemonPanelConversationStore(store, { producerId: policy.producerId }), policy }
  }
  let handle
  try {
    handle = await servePanel(port, path.resolve(dbPath), conversation !== undefined ? { conversation } : undefined)
  } catch (err) {
    // 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`panel 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[panel] 监控面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[panel] 台账：${path.resolve(dbPath)}（零写；端面 /api/health|jobs|runs|workers|events|events/stream|snapshot）`)
  if (conversation !== undefined) {
    console.log(`[panel] 对话页已装配 → 存储同一事实源：${path.join(path.resolve(companyDirFlag ?? '.'), 'conversations')}（端口 /conversation、/api/conversations*；写鉴权=STUDIO_PANEL_PRODUCER_TOKEN）`)
  } else {
    console.log('[panel] 对话页未接线（缺 --company-dir）：/conversation 与 /api/conversations* 503 降级')
  }
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[panel] 已优雅关闭')
  return 0
}
