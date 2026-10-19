/**
 * dsh-web-test —— 最小合法 dsh 插件①（docs/34-§3.2 插件模块约定：
 * ESM + 具名导出 name/apply；本引擎只需「安装=落位+登记」语义可处理，行为面最小占位）。
 */
export const name = 'dsh-web-test'

export function apply(ctx, _config) {
  let seen = 0
  return ctx.on('session/event', () => {
    seen += 1
  })
}
