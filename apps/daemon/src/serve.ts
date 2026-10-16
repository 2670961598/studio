/**
 * serve —— `studio-next serve --config <daemon.yaml>` 常驻主循环（v0.5 合龙件）
 *
 * 依据：docs/17-§2 主循环七相位（engine.ts）；docs/16-§四 v0.5「主循环 + demo 端到端」。
 *
 * v0 配置最小面（daemon.yaml，全扁平 key: value）：
 *   db: <台账库路径>            platform: localfile|fake      company: <slug>
 *   rootDir: <工位根>           tickMs: <拍间隔>              maxActionsPerTick / maxInflight
 *   stallAfterMs / laneTtlMs / breakerThreshold / autoApprove …（缺省见 DEFAULT_SERVE_CONFIG）
 *
 * v0 边界（诚实标注——v0.5 真单前还差什么）：
 *   - platform: localfile 未接线（@studio-next/localplatform 在 platform 泳道，未挂 daemon
 *     依赖——接入点=wirePlatform 的 localfile 分支）；v0 只支持 fake（demo 模式）。
 *   - 配置解析为零依赖手写扁平 YAML 子集（注释/#、key: value、引号剥壳、数字/布尔推断）——
 *     真 YAML（yaml@2 带行号 AST）装载归 daemon 依赖登记后的后续刀（16-§二 选型纪律）。
 *   - executor 只注册 fake adapter（demo）；真 dsh 注册走 agent.yaml + agentconfig.wireRegistry。
 *   - 无网关（wkey/署名/动作词校验）、无审批流、无定时岗调度（jobs 面 v0.4 未落）。
 *   - SIGINT/SIGTERM 优雅停：等当前拍收口 → 在途 drain（v0=对内存 handle 优雅 kill，
 *     work_records 留 running——重启接管归后续刀）→ 关台账。
 */
import { createRegistry } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type EngineConfig,
  type TickReport,
} from './engine.ts'
import { createFakeAdapter, createFakePlatform } from './fakes.ts'
import { createDefaultGateRunner } from './gate.ts'
import { createDefaultAssembler } from './prompt-assembly.ts'

// ————————————————————————— 配置 —————————————————————————

/** serve 配置（v0 最小面；引擎子配置并入扁平键） */
export interface ServeConfig {
  /** 台账库路径（不存在则建库+migrate——store openLedger 语义） */
  db: string
  /** 协作平台：fake（demo）| localfile（未接线，接入点见 wirePlatform） */
  platform: 'localfile' | 'fake'
  /** 公司 slug（events/intents/mirror 的 company 维） */
  company: string
  /** 工位根（workspace = <rootDir>/workspaces/<单号>/att<N>） */
  rootDir: string
  /** 拍间隔 ms */
  tickMs: number
  /** 并发三闸 */
  maxActionsPerTick: number
  maxInflight: number
  /** 在工静默告警阈值 ms */
  stallAfterMs: number
  /** 泳道租约 TTL ms */
  laneTtlMs: number
  /** 断路阈值 N */
  breakerThreshold: number
  /** demo 自动批（真制作人批准信号经网关动作词归一） */
  autoApprove: boolean
  /** 公司目录路径（可选：装载 CompanySnapshot；缺省用内置 demo 快照） */
  companyDir?: string
}

export const DEFAULT_SERVE_CONFIG: ServeConfig = {
  db: './var/ledger.sqlite',
  platform: 'fake',
  company: 'demo',
  rootDir: './var',
  tickMs: 1000,
  maxActionsPerTick: ENGINE_CONFIG_DEFAULTS.limits.maxActionsPerTick,
  maxInflight: ENGINE_CONFIG_DEFAULTS.limits.maxInflight,
  stallAfterMs: ENGINE_CONFIG_DEFAULTS.stallAfterMs,
  laneTtlMs: ENGINE_CONFIG_DEFAULTS.laneTtlMs,
  breakerThreshold: ENGINE_CONFIG_DEFAULTS.breakerThreshold,
  autoApprove: false,
}

function parseScalar(raw: string): string | number | boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10)
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1)
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1)
  return v
}

/**
 * 零依赖扁平 YAML 子集解析（v0 占位——真 YAML 装载归依赖登记后）：
 * 只认 `key: value` 行与 # 注释；嵌套/列表/多行标量不收（CONFIG_INVALID 明报不猜）。
 */
export function parseDaemonConfig(text: string): ServeConfig {
  const out: Record<string, string | number | boolean> = {}
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (line === '' || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行不是扁平 key: value（v0 只收扁平子集）：${line}`)
    }
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (valueRaw === '' || valueRaw.startsWith('#')) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行 value 为空（v0 不收嵌套/空值）：${line}`)
    }
    if (/^[\[{]|^\s*-/.test(valueRaw)) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行是嵌套/列表值（v0 只收扁平标量）：${line}`)
    }
    out[key] = parseScalar(valueRaw.split(' #')[0] ?? valueRaw)
  }
  return coerceServeConfig(out)
}

function str(v: unknown, key: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`daemon.yaml：${key} 须为非空字符串`)
  return v
}

function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`daemon.yaml：${key} 须为非负数`)
  return v
}

function bool(v: unknown, key: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`daemon.yaml：${key} 须为 true/false`)
  return v
}

function coerceServeConfig(raw: Record<string, string | number | boolean>): ServeConfig {
  const cfg: ServeConfig = { ...DEFAULT_SERVE_CONFIG }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'db':
        cfg.db = str(value, key)
        break
      case 'platform':
        cfg.platform = str(value, key) === 'localfile' ? 'localfile' : 'fake'
        break
      case 'company':
        cfg.company = str(value, key)
        break
      case 'rootDir':
        cfg.rootDir = str(value, key)
        break
      case 'companyDir':
        cfg.companyDir = str(value, key)
        break
      case 'tickMs':
        cfg.tickMs = num(value, key)
        break
      case 'maxActionsPerTick':
        cfg.maxActionsPerTick = num(value, key)
        break
      case 'maxInflight':
        cfg.maxInflight = num(value, key)
        break
      case 'stallAfterMs':
        cfg.stallAfterMs = num(value, key)
        break
      case 'laneTtlMs':
        cfg.laneTtlMs = num(value, key)
        break
      case 'breakerThreshold':
        cfg.breakerThreshold = num(value, key)
        break
      case 'autoApprove':
        cfg.autoApprove = bool(value, key)
        break
      default:
        throw new Error(`daemon.yaml：未知配置键 ${key}（v0 最小面，见 serve.ts 头注）`)
    }
  }
  return cfg
}

// ————————————————————————— demo 快照与栈装配 —————————————————————————

/** 内置 demo 公司快照（companyDir 未给时的兜底——单部门单人， Lane 通道走 defaultLane） */
export const DEMO_SNAPSHOT: CompanySnapshot = {
  slug: 'demo',
  name: 'Demo 公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    {
      name: '工程部',
      path: 'departments/工程部',
      parent: null,
      leader: 'AGENT-1',
      level: 2,
      lanes: ['core'],
      functions: ['交付'],
      relations: [],
    },
  ],
  people: [
    { id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
  ],
  jobs: [],
}

/** 平台接线（localplatform 接入点：platform 泳道合龙后在此分支挂 createLocalPlatform） */
function wirePlatform(config: ServeConfig): FlowPlatform {
  if (config.platform === 'localfile') {
    throw new Error(
      'platform: localfile 未接线——@studio-next/localplatform 在 platform 泳道（未挂 daemon 依赖）。' +
        '接入点=serve.ts wirePlatform（挂依赖后改挂 createLocalPlatform(rootDir)）；v0 用 platform: fake（demo 模式）',
    )
  }
  return createFakePlatform()
}

// ————————————————————————— 主循环 —————————————————————————

/** 一拍心跳日志行（serve 运行面观测；事件面账目在台账） */
function renderTick(report: TickReport): string {
  const p = report.phases
  return (
    `tick#${report.seq} actions=${report.actions.length} dispatched=${p.dispatch.dispatched} ` +
    `harvest=${p.harvest.completed}/${p.harvest.checked} merged=${p.merge.merged} recycled=${p.recycle.recycled} ` +
    `events=${p.account.eventsAppended} inflight=${report.inflightAfter} cursor=${p.collect.cursorAfter ?? '-'}${p.account.heartbeat ? ' [heartbeat]' : ''}`
  )
}

export interface ServeResult {
  ticks: number
  stopReason: 'signal' | 'error'
  lastError?: string
}

/**
 * 常驻主循环：装配 demo 栈 → 循环 tick（tickMs 间隔，信号可打断等待）→ 信号优雅停。
 * 返回 ServeResult（exit code 由调用方定：signal=0；error=1）。
 */
export async function runServe(configPath: string): Promise<ServeResult> {
  const config = parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8'))
  const ledger: Ledger = openLedger(path.resolve(config.db))

  let stopped = false
  let stopReason: ServeResult['stopReason'] = 'signal'
  let lastError: string | undefined
  const onSignal = (): void => {
    stopped = true
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let snapshot = DEMO_SNAPSHOT
  if (config.companyDir !== undefined) {
    // 公司目录装载（校验不过拒绝启动——04-§九；daemon 只读快照不写目录）
    const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')
    const files = await readDirectoryFiles(path.resolve(config.companyDir))
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      ledger.close()
      throw new Error(`公司目录校验不通过（拒绝启动）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`)
    }
    snapshot = mounted.snapshot
  }

  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })

  const engineConfig: EngineConfig = {
    ...ENGINE_CONFIG_DEFAULTS,
    company: config.company,
    rootDir: path.resolve(config.rootDir),
    defaultPersonId: (snapshot.people[0] as PersonRef | undefined)?.id ?? '',
    deptFallback: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    defaultLane: snapshot.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
    limits: { maxActionsPerTick: config.maxActionsPerTick, maxInflight: config.maxInflight },
    stallAfterMs: config.stallAfterMs,
    laneTtlMs: config.laneTtlMs,
    breakerThreshold: config.breakerThreshold,
    autoApprove: config.autoApprove,
  }
  const engine = createEngine({
    platform: wirePlatform(config),
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 Studio Next demo worker：按任务书目标产出，落 REPORT 与 summary，验收口径即闸门。',
      snapshot,
      acceptance: ['echo demo-ok（v0 占位闸门不执行验收命令）'],
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: () => Date.now(),
    config: engineConfig,
    people: snapshot.people,
  })

  console.log(`[serve] studio-next daemon 启动（company=${config.company} platform=${config.platform} db=${path.resolve(config.db)} tickMs=${config.tickMs}）`)
  console.log('[serve] v0 demo 栈：fake platform + fake executor + 默认占位闸门（诚实边界见 src/serve.ts 头注）')

  let ticks = 0
  while (!stopped) {
    try {
      const report = await engine.tick()
      ticks += 1
      console.log(`[serve] ${renderTick(report)}`)
      for (const err of report.errors) console.error(`[serve] tick#${report.seq} 错误：${err}`)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      stopReason = 'error'
      break
    }
    // 拍间隔等待（信号打断不硬等满）
    const deadline = Date.now() + config.tickMs
    while (!stopped && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())))
    }
  }

  console.log(`[serve] 停机（${stopReason}${lastError !== undefined ? `：${lastError}` : ''}）——在途 drain`)
  await engine.dispose()
  ledger.close()
  console.log('[serve] 已优雅关闭（台账落盘；work_records 在途项接管归后续刀）')
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
