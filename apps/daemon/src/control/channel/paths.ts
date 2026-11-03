/**
 * control/channel/paths —— 控制面目录/文件路径（三通道单源）
 *
 * 依据：docs/17-§2（daemon 内部设计：`control/` 域=进程控制面——热重载/停机通道）；
 *   docs/41-§2（控制面文件协议落点 `<rootDir>/control/`）；docs/20-§十五.四（contrib 纪律：
 *   control 域平面基线 2 件，本件在 `control/channel/` 子域内，域平面零新增散件）。
 *
 * 单源理由（studio-dev-555 架构债清理）：stop / reload / restart 三通道各自拼过
 * `<rootDir>/control` 路径（第 3 套并行文件通道的组成部分）——目录约定只留这一处，
 * 三通道共用 `controlDirOf`。
 */
import path from 'node:path'

/** 控制面目录段（`<rootDir>/control`——workspace/tmp 同级，rootDir 旗下） */
export const CONTROL_DIR = 'control'

/** 控制面目录绝对路径（`<rootDir>/control`） */
export function controlDirOf(rootDir: string): string {
  return path.join(rootDir, CONTROL_DIR)
}

/** 控制面单文件绝对路径（`<rootDir>/control/<name>`） */
export function controlFileOf(rootDir: string, name: string): string {
  return path.join(controlDirOf(rootDir), name)
}
