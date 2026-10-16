/**
 * 通知与对外 AI 面协议（docs/25-§4.2，依据 21、24-§三）
 * Notifier=通知出口（Matrix 等）；EXTERNAL_AI_TOOLS=对外 MCP server 工具名（触发类只落单不派工）。
 */

export interface Notification {
  kind: string
  title: string
  body: string
  /** 展示性发件人（v1.3，如「宰相」「daemon」）——非安全边界，外部鉴权归 21-§五 token 机制 */
  from?: string
  links?: { label: string; url: string }[]
}

export interface Notifier {
  send(channel: string, message: Notification): Promise<void>
}

export const EXTERNAL_AI_TOOLS = [
  'company.get',
  'org.get',
  'people.get',
  'progress.get',
  'finance.get',
  'request.create',
  'explore.trigger',
  'task.create',
  'intel.submit',
  'events.subscribe',
] as const

export type ExternalAiTool = (typeof EXTERNAL_AI_TOOLS)[number]
