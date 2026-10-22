// boot CLI 入口（105-刀A A-3 部署面）：组合根 bootServe 的正式启动器。
// 用法：node apps/boot/src/main.ts <daemon.yaml 路径>
// 密码经 env MATRIX_BOT_PASSWORD 供给（红名单——永不入 yaml/日志/台账，21A D5）。
import { bootServe } from './boot.ts'

const configPath = process.argv[2]
if (configPath === undefined) {
  console.error('usage: node apps/boot/src/main.ts <daemon.yaml 路径>')
  process.exit(1)
}
await bootServe({ configPath })
// runServe 失败即抛（CONFIG_INVALID 等）——进程非零退出由未捕获异常面承接
