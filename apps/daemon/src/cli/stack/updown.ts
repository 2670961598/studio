// updown —— `studio-next stack up|down` 双平台共享执行面（M5-2 第二刀，2026-11-21）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §2.2（up/down 一键起停：macOS launchd ＋
//     Linux systemd user unit 双分支）、§三 里程碑5-2、§七.4（M5-1 dry-run 缺省/--apply
//     纪律——本件全盘继承）、§八（M5-2 实现记录）
//
// 形态：launchd（stack.ts runUpLaunchd/runDownLaunchd）与 systemd（systemd.ts
// runUpSystemd/runDownSystemd）两分支的**公共前置**收拢于此——参数面（company-dir/
// guardian-config/config/port…）、daemon.yaml 扁平读、前置体检（两档：dry-run 软提醒
// 不拦预览；--apply 硬拒 fail-closed）、原子写防线。branch 特有面（plist/unit 模板与
// launchctl/systemctl 调用）各归其文件。
//
// 纪律：缺省值运行时推导（deploy/node/home），仓内零主机路径；token/凭据永不入参打印。
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFlatYamlScalars, StackUsageError } from './plists.ts'

/** daemon.yaml 缺省位＝`<company-dir>/daemon.yaml`（resolve 规范化：尾斜杠/相对输入→绝对）。 */
export function defaultDaemonConfigPath(companyDir: string): string {
  return path.join(path.resolve(companyDir), 'daemon.yaml')
}

/** 部署树缺省＝仓根（本文件在 apps/daemon/src/cli/stack/ —— 四级上跳；移动文件须同步改） */
export function defaultDeployRoot(): string {
  return fileURLToPath(new URL('../../../../..', import.meta.url))
}

export function requireCompanyDir(flags: Map<string, string>): string {
  const dir = flags.get('company-dir') ?? ''
  if (dir === '') throw new StackUsageError('缺 --company-dir <公司目录>')
  return dir
}

export function parsePort(raw: string, flag: string): number {
  const port = parsePositiveInt(raw, flag)
  if (port > 65535) throw new StackUsageError(`--${flag} 超出端口域：${raw}`)
  return port
}

export function parsePositiveInt(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new StackUsageError(`--${flag} 须为正整数：${raw}`)
  return Number(raw)
}

/** 原子写（tmp+rename；0600 收口）——chatd-setup.mjs atomicWrite 同款防线 */
export function atomicWrite(file: string, content: string, mode: number): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${String(process.pid)}-${String(Date.now())}`
  writeFileSync(tmp, content, { mode })
  chmodSync(tmp, mode)
  renameSync(tmp, file)
}

/** up/down 公共前置（参数面＋daemon.yaml 读＋两档体检）。用法错抛 StackUsageError（CLI 收口 exit 1）。 */
export interface UpContext {
  readonly companyDir: string
  /** slug 覆盖入参原样（''=未指定——分支侧交 normalizeSlug 兜底） */
  readonly company: string
  readonly home: string
  readonly guardianConfig: string
  readonly configPath: string
  readonly daemonDb: string
  /** daemon.yaml platform 键（null=未声明）——非 localfile 软提醒（M5 目标态） */
  readonly platformYaml: string | null
  readonly deployRoot: string
  readonly nodeBin: string
  readonly port: number
  readonly panelPort: number
  /** dry-run 软提醒（不拦预览） */
  readonly warnings: readonly string[]
  /** --apply 硬拒项（前置缺件——fail-closed） */
  readonly missing: readonly string[]
}

/** 前置体检事实收集（两档分桶——plan/08 §七.4 判例） */
function preflightExists(pairs: readonly (readonly [name: string, p: string])[], apply: boolean): { warnings: string[]; missing: string[] } {
  const warnings: string[] = []
  const missing: string[] = []
  for (const [name, p] of pairs) if (!existsSync(p)) (apply ? missing : warnings).push(`${name}不存在：${p}`)
  return { warnings, missing }
}

/**
 * up 公共前置：双分支（launchd/systemd）同款——guardian-config 必填（daemon 侧保活
 * 模型一致）、daemon.yaml 可读且含 db 键（panel --db 来源）、部署树三入口在场体检。
 */
export function upContext(flags: Map<string, string>, apply: boolean, deps: { home: string }): UpContext {
  const companyDir = requireCompanyDir(flags)
  const home = flags.get('home') ?? deps.home
  if (home === '') throw new StackUsageError('$HOME 未设置（或 --home 显式指定）')
  const guardianConfig = flags.get('guardian-config') ?? ''
  if (guardianConfig === '') throw new StackUsageError('缺 --guardian-config <guardian.json>（daemon 保活 guardian——ops/launchd/io.studionext.daemon.plist 同构）')
  const configPath = path.resolve(flags.get('config') ?? defaultDaemonConfigPath(companyDir))
  const deployRoot = path.resolve(flags.get('deploy-root') ?? defaultDeployRoot())
  const nodeBin = path.resolve(flags.get('node-bin') ?? process.execPath)

  let daemonDb = ''
  let platformYaml: string | null = null
  try {
    const scalars = readFlatYamlScalars(readFileSync(configPath, 'utf8'))
    daemonDb = scalars['db'] ?? ''
    platformYaml = scalars['platform'] ?? null
  } catch (err) {
    throw new StackUsageError(`daemon.yaml 不可读（${configPath}）：${errText(err)}（panel --db 取其 db 键；--config 显式指定）`)
  }
  if (daemonDb === '') throw new StackUsageError(`daemon.yaml 缺 db 键（${configPath}）——panel 需要 --db`)

  const guardianEntry = path.join(deployRoot, 'scripts', 'guardian.mjs')
  const chatdEntry = path.join(deployRoot, 'apps', 'workbench-chatd', 'src', 'main.ts')
  const cliEntry = path.join(deployRoot, 'apps', 'daemon', 'src', 'cli', 'main.ts')
  const pre = preflightExists(
    [
      ['部署树', deployRoot],
      ['node', nodeBin],
      ['guardian 配置', guardianConfig],
      ['guardian 入口', guardianEntry],
      ['chatd 入口', chatdEntry],
      ['CLI 入口', cliEntry],
    ],
    apply,
  )
  if (platformYaml !== null && platformYaml !== 'localfile') pre.warnings.push(`daemon.yaml platform=${platformYaml}（非 localfile——M5 目标态，doctor 会红；plan/08 §1.A#3）`)
  return {
    companyDir,
    company: flags.get('company') ?? '',
    home,
    guardianConfig,
    configPath,
    daemonDb,
    platformYaml,
    deployRoot,
    nodeBin,
    port: parsePort(flags.get('port') ?? '8788', 'port'),
    panelPort: parsePort(flags.get('panel-port') ?? '8791', 'panel-port'),
    warnings: pre.warnings,
    missing: pre.missing,
  }
}

/** errText 同款（cli/argv.ts 面拉的本地副本——避免 cli 根模块互引） */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
