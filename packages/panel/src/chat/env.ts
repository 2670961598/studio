/**
 * chat/env —— 面板聊天室 env 开关解析（M4-3 最小刀；纯函数零 IO）
 *
 * 开关口径（任务单 M4-3）：env 显式启用、缺省 off——
 *   WORKBENCH_CHATD_SOCKET：Unix socket 路径；非空=启用（面板聊天室视图与 /api/chat/* 开放），
 *                            缺省/空白=关闭（页面显示「未启用」，API 一律 503 CHAT_PANEL_DISABLED，
 *                            不因未配 chatd 拒启 panel/daemon——本解析不抛错）。
 *   WORKBENCH_CHATD_TOKEN ：鉴权 token（可选；chatd 配了 token 才需要；随 params 上帧，永不入页面/日志）。
 *   PANEL_CHAT_ACTOR      ：缺省操作者标识（可选；缺省 'panel'——chatd 端按房间成员校验）。
 */

/** env 解析结果：enabled=false 时其余字段为缺省值（唯一事实=没配 socket） */
export interface ChatPanelEnv {
  readonly enabled: boolean
  readonly socketPath: string | null
  readonly token: string | undefined
  readonly defaultActorId: string
}

const trimOf = (value: string | undefined): string => (typeof value === 'string' ? value.trim() : '')

/**
 * 解析聊天室 env（不抛错——配置缺失=关闭而非失败，任务单铁律「不得因未配 chatd 拒启」）。
 */
export function loadChatPanelEnv(env: Readonly<Record<string, string | undefined>>): ChatPanelEnv {
  const socketPath = trimOf(env['WORKBENCH_CHATD_SOCKET'])
  const token = trimOf(env['WORKBENCH_CHATD_TOKEN'])
  const actor = trimOf(env['PANEL_CHAT_ACTOR'])
  return {
    enabled: socketPath !== '',
    socketPath: socketPath !== '' ? socketPath : null,
    token: token !== '' ? token : undefined,
    defaultActorId: actor !== '' ? actor : 'panel',
  }
}
