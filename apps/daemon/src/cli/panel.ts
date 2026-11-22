// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1084-L1128 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  createChatPanelTransport,
  loadChatPanelEnv,
  loadConversationWritePolicy,
  servePanel,
  type ChatAppOptions,
  type ConversationAppOptions,
} from '@studio-next/panel'
import { DaemonPanelConversationStore } from '../assembly/panel/conversation-store.ts'
import { ConversationStore as DaemonConversationStore } from '../engine/conversation/store.ts'
import { PORTAL_DEFAULT_CHAT_ACTOR, PORTAL_DEFAULT_PORT, servePortal } from '../assembly/portal/server.ts'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'
import { errText, parseArgv } from './argv.ts'

/** 仅 --portal 公司门户态有效的旗标（监控面给出即用法错——防静默忽略） */
const PORTAL_ONLY_FLAGS: readonly string[] = ['platform-root', 'portal-port', 'chatd-socket', 'chatd-token-file', 'chat-actor']

/** --chat-actor 合法形：非空白、无内嵌空白、≤64 字符（chatd 按房间成员校验工号） */
const CHAT_ACTOR_RE = /^\S{1,64}$/

/** 运行期注入位（测试停机信号；缺省=SIGINT/SIGTERM——vitest worker 会吃信号，测试须注入） */
export interface PanelRuntime {
  readonly waitForStop?: () => Promise<void>
}

const defaultWaitForStop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })

export async function cmdPanel(argv: string[], runtime: PanelRuntime = {}): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.panel) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(
    argv,
    new Set(['db', 'port', 'company-dir', ...PORTAL_ONLY_FLAGS]),
    undefined,
    new Set(['portal']),
  )
  if ('error' in parsed) {
    return usageFail('panel', parsed.error, CONCISE.panel)
  }
  if (parsed.positionals.length > 0) {
    return usageFail('panel', `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.panel)
  }
  if (parsed.booleans.has('portal')) {
    return cmdCompanyPortal(parsed.flags, runtime)
  }
  const portalOnly = PORTAL_ONLY_FLAGS.find((f) => parsed.flags[f] !== undefined)
  if (portalOnly !== undefined) {
    return usageFail('panel', `--${portalOnly} 仅在 --portal 公司门户态有效（监控面无此旗标）`, CONCISE.panel)
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
  await (runtime.waitForStop ?? defaultWaitForStop)()
  await handle.close()
  console.log('[panel] 已优雅关闭')
  return 0
}

/**
 * --portal 公司门户态的聊天接线（显式旗标优先，env 缺省兜底；token 只驻内存不打印）。
 * 缺省操作者三级：--chat-actor > env PANEL_CHAT_ACTOR > PORTAL_DEFAULT_CHAT_ACTOR（在册工号）。
 */
function buildPortalChat(flags: Record<string, string>): { options: ChatAppOptions; socketPath: string | null; tokenFromFile: boolean; actor: string; actorFrom: 'flag' | 'env' | 'default' } {
  // fallbackActorId 只改「env 未配时」的缺省——监控面（不带 fallback）缺省 'panel' 不变
  const envChat = loadChatPanelEnv(process.env, { fallbackActorId: PORTAL_DEFAULT_CHAT_ACTOR })
  const actorFlag = flags['chat-actor']
  const actor = actorFlag !== undefined ? actorFlag : envChat.defaultActorId
  const envActorSet = (process.env['PANEL_CHAT_ACTOR'] ?? '').trim() !== ''
  const actorFrom: 'flag' | 'env' | 'default' = actorFlag !== undefined ? 'flag' : envActorSet ? 'env' : 'default'
  const socketFlag = flags['chatd-socket']
  const socketPath = socketFlag !== undefined ? socketFlag : envChat.socketPath ?? undefined
  if (socketPath === undefined || socketPath === '') {
    return { options: { transport: null, defaultActorId: actor }, socketPath: null, tokenFromFile: false, actor, actorFrom }
  }
  let token: string | undefined
  let tokenFromFile = false
  const tokenFlagFile = flags['chatd-token-file']
  if (tokenFlagFile !== undefined) {
    try {
      const raw = readFileSync(tokenFlagFile, 'utf8').trim()
      token = raw === '' ? undefined : raw
      tokenFromFile = token !== undefined
    } catch {
      token = undefined // 文件不可读：不拒启；chatd 要求鉴权时聊天面 503 如实降级
    }
  } else if (envChat.token !== undefined && envChat.token !== '') {
    token = envChat.token
  }
  const options: ChatAppOptions = {
    transport: createChatPanelTransport({ enabled: true, socketPath, token, defaultActorId: actor }),
    ...(token !== undefined ? { token } : {}),
    defaultActorId: actor,
  }
  return { options, socketPath, tokenFromFile, actor, actorFrom }
}

/**
 * 公司门户（--portal，docs/plan/11-公司门户-2026-11-23.md）：公司目录五读面合一
 * （概览/单子/聊天/组织/报表）+ 只读 JSON API；监控面 :8791 不并入。缺件降级矩阵：
 * 平台根缺→单子面空列表；chatd 缺→聊天面降级卡；库/公司目录缺→拒启（只读不代建）。
 */
async function cmdCompanyPortal(flags: Record<string, string>, runtime: PanelRuntime): Promise<number> {
  const companyDirFlag = flags['company-dir']
  if (companyDirFlag === undefined) {
    return usageFail('panel', '--portal 需要 --company-dir <公司目录>（组织/报表/mission 读此目录）', CONCISE.panel)
  }
  const companyDir = path.resolve(companyDirFlag)
  // fail-fast：与监控面同判例——不代建公司目录
  if (!existsSync(companyDir) || !statSync(companyDir).isDirectory()) {
    console.error(`portal：--company-dir 目录不存在或不是目录：${companyDir}（拒启；不代建公司目录）`)
    return 1
  }
  const dbFlag = flags.db
  if (dbFlag === undefined) {
    return usageFail('panel', '缺少 --db <库路径>', CONCISE.panel)
  }
  if (!existsSync(path.resolve(dbFlag))) {
    console.error(`portal：--db 库不存在：${path.resolve(dbFlag)}（拒启；门户只读不代建库）`)
    return 1
  }
  let port = PORTAL_DEFAULT_PORT
  const portRaw = flags['portal-port'] ?? flags.port
  if (portRaw !== undefined) {
    port = Number.parseInt(portRaw, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`portal：--portal-port 取值非法：${portRaw}（须为 1-65535 整数）`)
      return 1
    }
  }
  const platformFlag = flags['platform-root']
  const platformRoot = platformFlag !== undefined ? path.resolve(platformFlag) : path.resolve(companyDir, '..', 'platform')
  const platformOk = existsSync(platformRoot) && statSync(platformRoot).isDirectory()
  const chatActorFlag = flags['chat-actor']
  if (chatActorFlag !== undefined && !CHAT_ACTOR_RE.test(chatActorFlag)) {
    return usageFail('panel', `--chat-actor 取值非法：空白或超过 64 字符（收工号，例：--chat-actor ${PORTAL_DEFAULT_CHAT_ACTOR}）`, CONCISE.panel)
  }
  const chat = buildPortalChat(flags)
  if (chat.socketPath !== null && !existsSync(chat.socketPath)) {
    console.error(`[portal] chatd socket 不存在：${chat.socketPath}（不拒启；聊天面实时降级 503，chatd 起后自愈）`)
  }
  let handle
  try {
    handle = await servePortal({
      companyDir,
      dbPath: path.resolve(dbFlag),
      platformRoot: platformOk ? platformRoot : null,
      chat: chat.options,
      port,
      hostname: '127.0.0.1',
    })
  } catch (err) {
    // 公司目录校验不过 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`portal 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[portal] 公司门户已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[portal] 公司目录：${companyDir}（校验不过即拒启；mission/组织/报表读此目录）`)
  console.log(`[portal] 台账：${path.resolve(dbFlag)}（零写；端面 /api/stats|activity|tickets|org|reports）`)
  if (platformOk) {
    console.log(`[portal] 单子平台：${platformRoot}（全树只读；列表 TTL 缓存 5s）`)
  } else {
    console.log(`[portal] 单子平台未接：${platformRoot} 不存在——单子面空列表降级（不代建；加 --platform-root 或建 <companyDir>/../platform）`)
  }
  const actorSource = chat.actorFrom === 'flag' ? '来自 --chat-actor' : chat.actorFrom === 'env' ? '来自 env PANEL_CHAT_ACTOR' : '内置缺省'
  if (chat.socketPath !== null) {
    const tokenNote = chat.options.token !== undefined ? `token ${chat.tokenFromFile ? '由 --chatd-token-file 读入内存' : '来自 env'}（永不落日志）` : '未配 token'
    console.log(`[portal] 聊天：chatd socket ${chat.socketPath}（缺省操作者 ${chat.actor}，${actorSource}；${tokenNote}；chatd 挂时页面实时降级）`)
  } else {
    console.log(`[portal] 聊天未配置（--chatd-socket 或 env WORKBENCH_CHATD_SOCKET）：/chat 降级卡，/api/chat/* 503（缺省操作者 ${chat.actor}，${actorSource}）`)
  }
  await (runtime.waitForStop ?? defaultWaitForStop)()
  await handle.close()
  console.log('[portal] 已优雅关闭')
  return 0
}
