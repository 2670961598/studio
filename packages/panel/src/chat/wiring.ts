/**
 * chat/wiring —— env → Transport v1 客户端装配（M4-3 最小刀；本目录唯一 IO 依赖件）
 *
 * 数据经 @studio-next/workbench-transport 客户端连本地 chatd（Unix socket + NDJSON）：
 * 连接惰性（首请求才 connect，client.ts 判例），panel 不启动 chatd 进程（独立 ops 运维），
 * socket 不在=首请求 WB_NOT_CONNECTED → 503 透传呈现，不拒启不崩页。
 *
 * 已知限已清（M4-3）：v1 客户端 rooms.list 补可选参面（token 附加形参原样上帧，缺省 {} 与
 * 既有 wire 一致）——五个方法 token 均随 params 上帧（server 层注入）。
 */
import { WorkbenchTransport } from '@studio-next/workbench-transport'
import { loadChatPanelEnv, type ChatPanelEnv } from './env.ts'
import type { ChatPanelTransport } from './types.ts'
import type { ChatAppOptions } from './server.ts'

/** env → ChatPanelTransport 适配（token 由 server 层注入各调用 input，本件只管连接面） */
export function createChatPanelTransport(env: ChatPanelEnv): ChatPanelTransport {
  const client = new WorkbenchTransport({
    socketPath: env.socketPath as string,
  })
  return {
    listRooms: (input) => client.listRooms(input),
    listMessages: (input) => client.listMessages(input),
    sendMessage: (input) => client.sendMessage(input),
    read: (input) => client.read(input),
    inbox: (input) => client.inbox(input),
  }
}

/**
 * env → ChatAppOptions 装配（createPanelApp 缺省路径）：socket 未配=transport:null（未启用，
 * 不抛错不拒启）；配了=惰性 transport（首请求才连 socket）＋ token/缺省工号随行。
 */
export function createChatPanelOptions(env: Readonly<Record<string, string | undefined>>): ChatAppOptions {
  const parsed = loadChatPanelEnv(env)
  if (!parsed.enabled || parsed.socketPath === null) return { transport: null }
  return {
    transport: createChatPanelTransport(parsed),
    ...(parsed.token !== undefined ? { token: parsed.token } : {}),
    defaultActorId: parsed.defaultActorId,
  }
}
