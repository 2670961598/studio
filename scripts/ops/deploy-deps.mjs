/**
 * deploy-deps —— 部署树依赖安装（studio-dev-717 拆件；scripts/ops 边界登记）
 *
 * 抽件理由同 deploy-state.mjs（deploy.mjs 600 行阈）。语义为零行为搬迁：
 *   - node_modules 缺失或 bun.lock 变化 → 部署树内 `bun install --frozen-lockfile`；
 *   - 不软链主工作区 node_modules（workspace 包软链会指回主工作区，破坏部署隔离）；
 *   - --skip-install=演练/离线（真实部署不建议）。
 * 仅 node 标准库；runCmd/sha256File/fail 由 deploy.mjs 注入（纯编排，测试经 CLI 子进程覆盖）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

/** bun.lock 内容摘要（无 lock=null；用于判断依赖是否需要重装） */
export function bunLockSha(deploy, sha256File) {
  const lock = path.join(deploy, 'bun.lock')
  return existsSync(lock) ? sha256File(lock) : null
}

/**
 * 依赖安装决策与执行。
 * @returns {{installed: boolean, skipped?: boolean, reason: string, lockSha256: string|null, nodeModules: boolean}}
 */
export function installDeps({ opts, deploy, previousState, runCmd, sha256File, fail }) {
  const lockSha = bunLockSha(deploy, sha256File)
  const nodeModules = existsSync(path.join(deploy, 'node_modules'))
  const lockChanged = previousState !== null && previousState.lockSha256 !== null && previousState.lockSha256 !== lockSha
  const needsInstall = !nodeModules || lockChanged
  if (opts['skip-install'] === true) {
    return {
      installed: false,
      skipped: true,
      reason: needsInstall ? 'node_modules 缺失或 bun.lock 变化，但指定了 --skip-install（演练/离线）' : '依赖未变化',
      lockSha256: lockSha,
      nodeModules,
    }
  }
  if (!needsInstall) return { installed: false, reason: '依赖未变化', lockSha256: lockSha, nodeModules }
  const bun = typeof opts.bun === 'string' && opts.bun !== '' ? opts.bun : 'bun'
  const result = runCmd([bun, 'install', '--frozen-lockfile'], { cwd: deploy, timeoutMs: 1_200_000 })
  if (result.status !== 0) fail(3, `依赖安装失败（bun install --frozen-lockfile）：\n${result.output}`)
  return { installed: true, reason: 'node_modules 缺失或 bun.lock 变化', lockSha256: lockSha, nodeModules: true }
}
