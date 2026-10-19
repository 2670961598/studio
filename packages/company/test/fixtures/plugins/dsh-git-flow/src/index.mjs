/**
 * dsh-git-flow —— 最小合法 dsh 插件②（docs/34-§3.2 模块约定同①）。
 */
export const name = 'dsh-git-flow'

export function apply(ctx, _config) {
  let seen = 0
  return ctx.on('session/event', () => {
    seen += 1
  })
}
