/**
 * chatd-errors —— chatd 双面共享叶（M5 尾拆件，plan/09-…-2026-11-21.md §二#3）
 *
 * 持有 chatd-mention-source（唤醒源，M4-1 task-136）与 chatd-notify-face（通知面，M5 尾）
 * 共用的两块小面，使两面互不 import（notify 面不依赖唤醒源件；唤醒源件的键收口可路由
 * notify 键到 notify 面——单向 mention→notify，无环）：
 *   - classifyChatdError：WB_* 稳定码 → 可读分类（transport/config/defect/conflict/gone/
 *     unknown——提案 §5.3；docs/17:331-335 分类枚举的源侧软失败面）。分类面=处置语义；
 *     具体处置（计数/退避/日志）归各消费循环；
 *   - ChatdServeKeyHelpers：config.ts 扁平解析面 str/num 同形（保持面件与解析件解耦的单孔）。
 *
 * 拆件动因：20-§十五.三.3 尺寸阈（config.ts 600 行满格——notify 键经既有 chatd case 组
 * 路由进 coerceChatdServeKey，零新增行；两面共享分类收口本叶，避免复制）。
 */
import { WB_ERROR_CODES } from '@studio-next/workbench-transport'

const WB_CODES = new Set<string>(WB_ERROR_CODES)

/** chatd 面侧错误分类（kind=处置语义；计数/日志归各消费循环——唤醒源轮询/通知面软失败） */
export type ChatdErrorKind = 'transport' | 'config' | 'defect' | 'conflict' | 'gone' | 'unknown'

export interface ChatdSourceError {
  readonly kind: ChatdErrorKind
  readonly code: string
  readonly readable: string
}

/** WB_* 稳定码 → 可读分类（非 WB_* 错误归 unknown，同走软失败面不炸循环） */
export function classifyChatdError(err: unknown): ChatdSourceError {
  const code = (err as { code?: unknown } | null | undefined)?.code
  const message = err instanceof Error ? err.message : String(err)
  if (typeof code !== 'string' || !WB_CODES.has(code)) {
    return { kind: 'unknown', code: 'UNKNOWN', readable: `未分类错误：${message}` }
  }
  switch (code) {
    case 'WB_TIMEOUT':
    case 'WB_UNAVAILABLE':
    case 'WB_NOT_CONNECTED':
      return { kind: 'transport', code, readable: `传输面（${code}，可重试）：${message}` }
    case 'WB_INVALID_ARGUMENT':
      return {
        kind: 'config',
        code,
        readable: message.startsWith('unauthenticated:')
          ? `配置面（${code} 鉴权失败——token 缺失/不符，检查 env WORKBENCH_CHATD_TOKEN 供给）：${message}`
          : `配置面（${code} 参数缺陷——socket/token/工号拼参明报）：${message}`,
      }
    case 'WB_PROTOCOL':
    case 'WB_INTERNAL':
      return { kind: 'defect', code, readable: `源缺陷（${code}）：${message}` }
    case 'WB_IDEMPOTENCY_CONFLICT':
      return { kind: 'conflict', code, readable: `幂等冲突（${code}，以 chatd 审计为准，跳过不重试）：${message}` }
    default: // WB_ROOM/MESSAGE/WAKE_NOT_FOUND、WB_WAKE_NOT_CLAIMABLE（含 dead-letter 终态）
      return { kind: 'gone', code, readable: `对象缺失/终态（${code}，软失败跳过）：${message}` }
  }
}

/** serveconfig 值收口助手（config.ts 扁平解析面的 str/num 同形——保持面件与解析件解耦的单孔） */
export interface ChatdServeKeyHelpers {
  readonly str: (value: unknown, key: string) => string
  readonly num: (value: unknown, key: string) => number
}
