/**
 * dsh-web-test —— 互联网公司示例包自带插件（docs/34-§3.2 插件模块约定：
 * ESM + 具名导出 name/apply；行为面最小占位——「安装=落位+登记」语义可处理即可，
 * 真插件行为归各自公司扩展）。
 */
export const name = 'dsh-web-test'

export function apply(ctx, _config) {
  let checked = 0
  return ctx.on('session/event', () => {
    checked += 1
  })
}
