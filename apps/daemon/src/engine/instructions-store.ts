/**
 * instructions-store —— bridge 通道每任务指令临时文件的落点 / 写盘 / 清理 + 插件 overlay 生成
 *
 * 规格依据（实现单引用）：
 *   - docs/25-§3.1 v1.5 裁决#1（制作人 2026-10-19 批）：AGENTS.md 注入走 dsh 插件——
 *     daemon 把组装好的分层指令写为每任务临时文件（workspace 外），dsh 适配器 launch env
 *     注 `STUDIO_NEXT_INSTRUCTIONS=<该文件路径>`，studio-next-bridge 宿主插件
 *     （packages/dsh-bridge）在 agent 创建时读文件注入系统提示 persona 前缀段。
 *   - docs/04-§六：AGENTS.md 落点规则（B5 修订优先用户级通道——bridge 即 dsh 的用户级
 *     通道实现；文件标记「生成物勿手改」由 assemble.ts AGENTS_MD_BANNER 承载——本文件
 *     只管字节落盘，不改写组装文本）；落 workspace 根会污染工位（native 通道除外），
 *     临时文件不进 workspace、不进任何 git 仓（exclude 纪律结构性免疫）。
 *   - docs/34-§3.1 装载法 B（运行时 overlay）：`dsh --profile <p> --patch <yml>` 不落
 *     profile、不动机器全局状态——docs/31-§5-5 明示「机器全局层，多公司共机有串染风险
 *     ——建议走 per-company profile patch」；overlay 由 serve 启动期生成本文件
 *     （provisionDshBridgeOverlay），agent.yaml 的 dsh cmd 以 `--patch <overlay 路径>` 挂载
 *     （cmd 是配置的覆盖注入位，agentconfig.ts 口径——provisioning 与挂载声明分离，
 *     挂不挂由部署的 agent.yaml 说了算，daemon 不代改 executor 命令）。
 *
 * 生命周期（清理策略，任务书裁定的口径）：
 *   - 写盘：dispatch 相位装配后、launch 前（指令必须先于 worker 可见）；
 *   - 保留至收割完成再删：GATE_PASS / GATE_FAIL（含 WORKER_DEAD/CONFIG_INVALID 等一切
 *     failHarvest 收口面）删除——收割期间文件在盘（worker 全程可读、抗 compact 重注入）；
 *   - 派发失败（DISPATCH_FAIL / 预算拒派）即删：launch 没发生、不会有收割来收这个 attempt，
 *     留着即泄漏（重派会重写同路径，但失败路径立即清理更干净）；
 *   - dispose（停机 drain）不删：work_records 留 running 的接管语义同款——重启接管重写。
 *
 * 纯逻辑纪律：本文件只做路径计算与字节落盘，零业务分支；0600/0700 权限（指令含组织
 * 人事内容，公司目录不入产品仓的同精神——最小可读面）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TicketId } from '@studio-next/contract'

/** 指令临时文件目录段（<rootDir>/tmp/instructions——workspace 外、rootDir 旗下） */
export const INSTRUCTIONS_DIR = path.join('tmp', 'instructions')

/** 每任务指令临时文件落点：<rootDir>/tmp/instructions/<单号>.md（同单重派重写同路径） */
export function instructionsTarget(rootDir: string, ticket: TicketId): string {
  return path.join(rootDir, INSTRUCTIONS_DIR, `${ticket}.md`)
}

/**
 * 指令文件写盘：目录 0700、文件 0600（首次创建时生效；既有文件沿用原 mode——重派
 * 重写同路径时已是 0600）。文本=组装产物原样（含「生成物勿手改」横幅与分层指纹，
 * assemble.ts 承载）——不裁不拼不加头。
 */
export function writeInstructions(target: string, text: string): void {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, text, { encoding: 'utf8', mode: 0o600 })
}

/** 指令文件清理（收割完成 / 派发失败）：force=容忍已不存在（幂等）。 */
export function removeInstructions(target: string): void {
  rmSync(target, { force: true })
}

// ---------------------------------------------------------------------------
// dsh bridge 插件 overlay 生成（provisioning——docs/34-§3.1 装载法 B）
// ---------------------------------------------------------------------------

/** overlay 生成结果（serve 启动日志与 agent.yaml 挂载指引的素材） */
export interface BridgeOverlay {
  /** overlay 文件落点（agent.yaml dsh cmd 以 --patch 引用它） */
  overlayPath: string
  /** 插件源文件绝对路径（overlay name 锚定的目标；存在性已验） */
  bridgeSrc: string
}

/** dsh-bridge 包内插件源的仓内相对位（monorepo 布局：apps/daemon/src → 仓根） */
const BRIDGE_SRC_REL = path.join('..', '..', '..', 'packages', 'dsh-bridge', 'src', 'index.ts')

/**
 * 生成 bridge 插件运行时 overlay：<rootDir>/tmp/dsh-bridge-overlay.yml。
 * 内容=insert 条目（id=studio-next-bridge、name=锚定插件源的相对路径——docs/34-§3.1
 * 铁律：insert 键包完整条目；相对路径锚定 overlay 文件所在目录，与包内 cordis.patch.yml
 * 同形）。每次启动覆盖刷新（确定性内容——同仓同 rootDir 恒同 bytes）。
 * dsh-bridge 包不在预期位置（仓外部署）→ undefined 如实回（调用方明报不静默）。
 * opts.bridgeSrc 覆盖插件源解析位（测试注入面；缺省=仓内 monorepo 布局推导）。
 */
export function provisionDshBridgeOverlay(
  rootDir: string,
  opts?: { bridgeSrc?: string },
): BridgeOverlay | undefined {
  const bridgeSrc =
    opts?.bridgeSrc ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), BRIDGE_SRC_REL)
  if (!existsSync(bridgeSrc)) return undefined
  const overlayPath = path.join(rootDir, 'tmp', 'dsh-bridge-overlay.yml')
  // name 相对路径锚定 overlay 所在目录（装载法 B 真机实证形态——bridge 冒烟同款）
  const name = path.relative(path.dirname(overlayPath), bridgeSrc)
  const text = [
    '# Studio Next daemon 生成（serve 启动刷新；生成物勿手改）',
    '# dsh bridge 插件运行时 overlay（docs/34-§3.1 装载法 B）——挂法：agent.yaml 的 dsh',
    '# cmd 追加 `--patch <本文件绝对路径>`。不落 profile、不动机器全局状态（docs/31-§5-5',
    '# per-company patch 建议）；插件在无 STUDIO_NEXT_INSTRUCTIONS env 的进程里零行为（无害共存）。',
    '- insert:',
    '    - id: studio-next-bridge',
    `      name: ${name}`,
    '      config:',
    '        instructionsEnv: STUDIO_NEXT_INSTRUCTIONS',
    '',
  ].join('\n')
  mkdirSync(path.dirname(overlayPath), { recursive: true, mode: 0o700 })
  writeFileSync(overlayPath, text, { encoding: 'utf8', mode: 0o600 })
  return { overlayPath, bridgeSrc }
}
