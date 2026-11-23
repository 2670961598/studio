/**
 * chat/mask —— 聊天正文主机路径脱敏（显示层卫生；单一正则源）。
 *
 * 依据：AGENTS.md §五.6「仓库里不得出现本机路径」同精神延伸到**展示面**——聊天正文
 * 可能携带 daemon 通知等系统消息，其落位/报表位址若含主机绝对路径（盘名/家目录=
 * 部署面隐私），只读视图不应原样呈现。本件只管**显示层兜底**：maskHostPaths 把正文
 * 中匹配主机绝对路径形态的片段替换为 `<path>`；不改 chatd 数据、不改 API 回包
 * （消息原样存储与传输，脱敏发生在渲染时——page.ts 前端 JS 与本件同源共用正则）。
 *
 * 正则形态（主机绝对路径族）：
 *   - Windows 盘符：`C:\…`（`[A-Za-z]:` 后跟 `\` 或 `/`）；
 *   - POSIX 卷/家目录根：`/Volumes/…`、`/Users/…`、`/home/…`（`\Volumes\…` 等
 *     反斜杠变体同罩——Windows 形态书写习惯的双保险）；
 *   - 尾段 `[^\s]+`：到首个空白符止（任务口径原样；中文标点不截断属可接受的兜底口径）。
 * 相对路径（如 `reports/综合部/x.md`）不命中——脱敏只对主机布局，不对位址本身。
 */

/** 主机绝对路径正则（单一冻结源：TS 本体与 page.ts 内联 JS 共用 `.source` 注入） */
const HOST_PATH_RE = /(?:[A-Za-z]:[\\/]|[\\/]Users[\\/]|[\\/]Volumes[\\/]|[\\/]home[\\/])[^\s]+/g

/** 正则源串（服务端 HTML 生成器注入前端脚本用——两处渲染同源不双轨） */
export const HOST_PATH_MASK_SOURCE: string = HOST_PATH_RE.source

/** 显示层脱敏：主机绝对路径 → `<path>`（幂等：`<path>` 自身无路径形态不再改写） */
export function maskHostPaths(text: string): string {
  return text.replace(HOST_PATH_RE, '<path>')
}
