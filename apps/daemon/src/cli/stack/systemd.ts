// systemd —— `studio-next stack up|down` Linux systemd user unit 分支（M5-2 第二刀，2026-11-21）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §2.2（systemd 模板：M5-2 按**user unit**落地——
//     与 §2.2 草案的 @.service 系统单元差异见 §八记录：干净机器无 root、三服务实例化
//     与 launchd label 判例同构）、§2.5（down 保数据）、§三 里程碑5-2、§六（不做 Linux
//     全自动验收——本仓只出模板与 dry-run 预览，测试零真 systemctl 调用）
//   - scripts/ops/deploy.mjs（M5-1 判例：healthz 口径）、scripts/ops/chatd-setup.mjs
//     （dry-run 缺省/--apply 写盘/token 0600 不覆盖/原子写判例——updown.ts 收拢共享）
//
// 形态（与 launchd 分支同纪律——plan/08 §七.4 全盘继承）：
//   - up：三枚 user unit（daemon=guardian/chatd/panel；模板单一源 templates.ts）写入
//     `~/.config/systemd/user/`（--user-units-dir 测试注入口）0600 原子写 →
//     `systemctl --user daemon-reload` → `enable --now` 三枚；var 目录 0700＋token 首产
//     0600 不覆盖与 launchd 分支同款。
//   - down：`disable --now` 三枚（unit 文件与数据全保留——保数据边界 §2.5）。
//   - 默认 dry-run 零副作用（只打印命令与 unit 渲染预览）；--apply 才动真。
//   - 日志走 journald（journalctl --user -u <unit>），不落日志文件——launchd 分支的
//     StandardOutPath 面在此不存在（差异记录 plan/08 §八）。
//
// 可测性：systemctl 全经 deps.run 注入执行器；systemd user 会话在场性由 stack.ts
// deps.systemdAvailable 注入判定（缺省 /run/systemd/users/<uid> 存在性）——测试零真调用。
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { StackDeps } from './stack.ts'
import { STACK_CONVENTIONS, STACK_EXIT, stackLabels, normalizeSlug } from './plists.ts'
import { CHATD_UNIT_TEMPLATE, DAEMON_UNIT_TEMPLATE, PANEL_UNIT_TEMPLATE, envFileLine, renderTemplate } from './templates.ts'
import { atomicWrite, requireCompanyDir, type UpContext } from './updown.ts'

/** systemd 面约定（与 STACK_CONVENTIONS 同级收口；RestartSec 与 launchd ThrottleInterval 同值 10s） */
export const SYSTEMD_CONVENTIONS = Object.freeze({
  unitDirRel: Object.freeze(['.config', 'systemd', 'user']),
  unitSuffix: '.service',
  restartSec: 10,
})

/* ------------------------------------------------------------------ */
/* 安装/停服计划（纯推导，零 IO）                                        */
/* ------------------------------------------------------------------ */

export interface SystemdServicePlan {
  readonly id: 'daemon' | 'chatd' | 'panel'
  readonly label: string
  readonly unitName: string
  readonly unitPath: string
  readonly unit: string
  /** 展示形命令；执行形由 CLI 侧组 argv（['systemctl','--user','enable','--now',unitName]） */
  readonly enableCmd: string
  readonly disableCmd: string
}

export interface SystemdUpPlan {
  readonly slug: string
  readonly companyDir: string
  readonly varDir: string
  readonly tokenFile: string
  readonly deployRoot: string
  readonly nodeBin: string
  /** --env-file 显式值（null=未指定→模板留自述注释行，不落 EnvironmentFile） */
  readonly envFile: string | null
  readonly unitDir: string
  readonly reloadCmd: string
  readonly services: readonly SystemdServicePlan[]
}

/**
 * up 安装计划（纯推导）。ExecStart＝node＋相对 deployRoot 入口（WorkingDirectory 兜底）；
 * label 与 launchd 分支同构（stackLabels 单源）；unit 名＝`<label>.service`。
 */
export function buildSystemdUpPlan(input: {
  companyDir: string
  company?: string
  deployRoot: string
  nodeBin: string
  guardianConfig: string
  daemonConfigPath: string
  daemonDb: string
  port: number
  panelPort: number
  home: string
  labelPrefix: string
  envFile?: string
  userUnitsDir?: string
}): SystemdUpPlan {
  const companyDir = path.resolve(input.companyDir)
  const slug = normalizeSlug({ companyDir, company: input.company })
  const deployRoot = path.resolve(input.deployRoot)
  const labels = stackLabels(input.labelPrefix, slug)
  const unitDir = path.resolve(
    input.userUnitsDir !== undefined && input.userUnitsDir !== ''
      ? input.userUnitsDir
      : path.join(path.resolve(input.home), ...SYSTEMD_CONVENTIONS.unitDirRel),
  )
  const varDir = path.join(companyDir, ...STACK_CONVENTIONS.varRel)
  const restartSec = String(SYSTEMD_CONVENTIONS.restartSec)
  const envFile = input.envFile !== undefined && input.envFile !== '' ? path.resolve(input.envFile) : null
  const envLine = envFileLine(envFile)
  const logLevel = STACK_CONVENTIONS.logLevel

  const daemonUnit = renderTemplate(DAEMON_UNIT_TEMPLATE, {
    __LABEL__: labels.daemon,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __GUARDIAN_CONFIG__: path.resolve(input.guardianConfig),
    __DEPLOY_ROOT__: deployRoot,
    __RESTART_SEC__: restartSec,
    __ENV_FILE_LINE__: envLine,
  })
  const chatdUnit = renderTemplate(CHATD_UNIT_TEMPLATE, {
    __LABEL__: labels.chatd,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __DEPLOY_ROOT__: deployRoot,
    __SOCKET__: path.join(varDir, STACK_CONVENTIONS.socketFile),
    __DB__: path.join(varDir, STACK_CONVENTIONS.dbFile),
    __TOKEN_FILE__: path.join(varDir, STACK_CONVENTIONS.tokenFile),
    __LOG_LEVEL__: logLevel,
    __RESTART_SEC__: restartSec,
    __ENV_FILE_LINE__: envLine,
  })
  const panelUnit = renderTemplate(PANEL_UNIT_TEMPLATE, {
    __LABEL__: labels.panel,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __DEPLOY_ROOT__: deployRoot,
    __DB__: path.resolve(input.daemonDb),
    __COMPANY_DIR__: companyDir,
    __PANEL_PORT__: String(input.panelPort),
    __RESTART_SEC__: restartSec,
    __ENV_FILE_LINE__: envLine,
  })

  const service = (id: SystemdServicePlan['id'], label: string, unit: string): SystemdServicePlan => {
    const unitName = `${label}${SYSTEMD_CONVENTIONS.unitSuffix}`
    return {
      id,
      label,
      unitName,
      unitPath: path.join(unitDir, unitName),
      unit,
      enableCmd: `systemctl --user enable --now ${unitName}`,
      disableCmd: `systemctl --user disable --now ${unitName}`,
    }
  }

  return {
    slug,
    companyDir,
    varDir,
    tokenFile: path.join(varDir, STACK_CONVENTIONS.tokenFile),
    deployRoot,
    nodeBin: path.resolve(input.nodeBin),
    envFile,
    unitDir,
    reloadCmd: 'systemctl --user daemon-reload',
    services: [
      service('daemon', labels.daemon, daemonUnit),
      service('chatd', labels.chatd, chatdUnit),
      service('panel', labels.panel, panelUnit),
    ],
  }
}

export interface SystemdDownPlan {
  readonly slug: string
  readonly companyDir: string
  readonly labels: { readonly daemon: string; readonly chatd: string; readonly panel: string }
  readonly disableCmds: readonly string[]
}

/** down 停服计划（纯推导）：disable --now 三枚；unit 文件与数据面全保留（plan/08 §2.5） */
export function buildSystemdDownPlan(input: { companyDir: string; company?: string; labelPrefix: string }): SystemdDownPlan {
  const companyDir = path.resolve(input.companyDir)
  const slug = normalizeSlug({ companyDir, company: input.company })
  const labels = stackLabels(input.labelPrefix, slug)
  const units = [labels.daemon, labels.chatd, labels.panel].map((label) => `${label}${SYSTEMD_CONVENTIONS.unitSuffix}`)
  return {
    slug,
    companyDir,
    labels,
    disableCmds: units.map((unitName) => `systemctl --user disable --now ${unitName}`),
  }
}

/* ------------------------------------------------------------------ */
/* 执行面（systemctl 全经注入执行器——测试零真调用）                      */
/* ------------------------------------------------------------------ */

/** up（Linux systemd user 分支）——前置体检已由 updown.upContext 收拢（ctx 携带两档结果）。 */
export async function runUpSystemd(input: { flags: Map<string, string>; apply: boolean; deps: StackDeps; ctx: UpContext }): Promise<number> {
  const { flags, apply, deps, ctx } = input
  const plan = buildSystemdUpPlan({
    companyDir: ctx.companyDir,
    company: ctx.company,
    deployRoot: ctx.deployRoot,
    nodeBin: ctx.nodeBin,
    guardianConfig: ctx.guardianConfig,
    daemonConfigPath: ctx.configPath,
    daemonDb: ctx.daemonDb,
    port: ctx.port,
    panelPort: ctx.panelPort,
    home: ctx.home,
    labelPrefix: flags.get('label-prefix') ?? STACK_CONVENTIONS.labelPrefix,
    envFile: flags.get('env-file') ?? '',
    userUnitsDir: flags.get('user-units-dir') ?? '',
  })

  if (apply && ctx.missing.length > 0) {
    for (const line of ctx.missing) console.error(`stack up：前置缺件：${line}`)
    return STACK_EXIT.usage
  }

  console.log(apply ? 'stack up --apply（systemd user unit 写盘+enable --now）' : 'stack up dry-run（零副作用——写盘与 enable 需 --apply；Linux systemd user 分支）')
  console.log(`  公司     slug=${plan.slug}`)
  console.log(`  公司目录 ${plan.companyDir}`)
  console.log(`  部署树   ${plan.deployRoot}`)
  console.log(`  单元目录 ${plan.unitDir}`)
  if (plan.envFile !== null) console.log(`  凭据面   EnvironmentFile=${plan.envFile}（0600 自管——本命令不代建）`)
  for (const service of plan.services) {
    console.log(`  ${service.id.padEnd(6)} label=${service.label}`)
    console.log(`         unit=${service.unitPath}`)
  }
  for (const warning of ctx.warnings) console.log(`  提醒  ${warning}`)
  console.log('--- 将执行（--apply）---')
  console.log(`  ${plan.reloadCmd}（单元文件变更后重载）`)
  for (const service of plan.services) console.log(`  ${service.enableCmd}`)
  console.log('  日志面 journald：journalctl --user -u <unit> -f（无文件日志——与 launchd 分支差异，plan/08 §八）')
  if (!apply) {
    for (const service of plan.services) {
      console.log(`--- unit 渲染预览（${service.id}；未写任何文件/未执行任何命令）---`)
      console.log(service.unit)
    }
    return STACK_EXIT.ok
  }

  // --apply：① var 目录 0700 ② token 首产 0600（在场不覆盖）③ unit 原子写 0600 ④ daemon-reload＋enable --now
  mkdirSync(plan.varDir, { recursive: true })
  chmodSync(plan.varDir, 0o700)
  const results: string[] = []
  if (!existsSync(plan.tokenFile)) {
    atomicWrite(plan.tokenFile, randomBytes(32).toString('hex'), 0o600)
    results.push(`token 首产 0600：${plan.tokenFile}（值不打印）`)
  } else {
    chmodSync(plan.tokenFile, 0o600)
    results.push(`token 已在场，保留不覆盖（chmod 0600 复核）：${plan.tokenFile}`)
  }
  for (const service of plan.services) {
    const existed = existsSync(service.unitPath)
    atomicWrite(service.unitPath, service.unit, 0o600)
    results.push(`${service.id} unit ${existed ? '幂等重写（同字节）' : '已写入'} 0600：${service.unitPath}`)
  }
  const reload = deps.run(['systemctl', '--user', 'daemon-reload'])
  if (reload.status !== 0) {
    for (const line of results) console.log(`  ${line}`)
    console.error(`stack up：daemon-reload 失败（exit ${String(reload.status)}）：${(reload.stderr !== '' ? reload.stderr : reload.stdout).trim().slice(0, 300)}`)
    return STACK_EXIT.usage
  }
  results.push(`daemon-reload ok（systemctl --user）`)
  let failed = 0
  for (const service of plan.services) {
    const enable = deps.run(['systemctl', '--user', 'enable', '--now', service.unitName])
    if (enable.status === 0) results.push(`${service.id} enable --now ok（unit=${service.unitName}）`)
    else {
      failed += 1
      console.error(`stack up：enable 失败（${service.unitName}，exit ${String(enable.status)}）：${(enable.stderr !== '' ? enable.stderr : enable.stdout).trim().slice(0, 300)}`)
    }
  }
  for (const line of results) console.log(`  ${line}`)
  if (failed > 0) {
    console.error(`stack up：${String(failed)} 项 enable 失败——journalctl --user -u <unit> -n 50 查因；unit/数据已就位，修复后重跑（幂等）`)
    return STACK_EXIT.usage
  }
  console.log('  下一步：studio-next stack status 验证三端点；studio-next stack doctor 复检六项')
  return STACK_EXIT.ok
}

/** down（Linux systemd user 分支）：disable --now 三枚；unit 文件与数据全保留。 */
export function runDownSystemd(input: { flags: Map<string, string>; apply: boolean; deps: StackDeps }): number {
  const { flags, apply, deps } = input
  const companyDir = requireCompanyDir(flags)
  const plan = buildSystemdDownPlan({ companyDir, company: flags.get('company') ?? '', labelPrefix: flags.get('label-prefix') ?? STACK_CONVENTIONS.labelPrefix })
  console.log(apply ? 'stack down --apply（systemd user 分支：disable --now 三服务）' : 'stack down dry-run（零副作用——停服需 --apply；Linux systemd user 分支）')
  for (const cmd of plan.disableCmds) console.log(`  ${cmd}`)
  console.log('  保留面：unit 文件与数据全不动（socket/db/token/公司目录——卸载销毁走 chatd-setup --remove，plan/08 §2.5）')
  if (!apply) return STACK_EXIT.ok
  const units = [plan.labels.daemon, plan.labels.chatd, plan.labels.panel].map((label) => `${label}${SYSTEMD_CONVENTIONS.unitSuffix}`)
  for (const unitName of units) {
    const res = deps.run(['systemctl', '--user', 'disable', '--now', unitName])
    if (res.status === 0) console.log(`  ${unitName} disable --now ok`)
    else console.log(`  ${unitName} 未加载/已停（exit ${String(res.status)}：${(res.stderr !== '' ? res.stderr : res.stdout).trim().slice(0, 160)}）`)
  }
  console.log('  数据保留：三服务进程已停；复起=stack up --apply（幂等重入）')
  return STACK_EXIT.ok
}
