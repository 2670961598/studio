/**
 * serve —— `studio-next serve --config <daemon.yaml>` 常驻主循环（v0.5 合龙件）
 *
 * 依据：docs/17-§2 主循环七相位（engine.ts）；docs/16-§四 v0.5「主循环 + demo 端到端」。
 *
 * v0 配置最小面（daemon.yaml，全扁平 key: value）：
 *   db: <台账库路径>            platform: localfile|fake      company: <slug>
 *   rootDir: <工位根>           tickMs: <拍间隔>              maxActionsPerTick / maxInflight
 *   stallAfterMs / laneTtlMs / breakerThreshold / autoApprove …（缺省见 DEFAULT_SERVE_CONFIG）
 *   jobs: true|false（定时岗调度开关，v0.4）   jobPollMs: <调度轮询间隔>（缺省 15000）
 *   models: <models.yaml 路径>（可选价目表，17-§4：装载→catalog 注入引擎——注入=估算
 *     态 A「estimateCost 校准+双帽」；缺省=态 B 降级「估算=适配器自报、仅票级帽」，
 *     两态详见 src/budget-gate.ts 头注。**缺省不拷贝 models.example.yaml**）
 *   budgetTicketCapUsd / budgetPersonCapUsd（可选预算帽：票级恒生效；岗级仅态 A 生效）
 *
 * v0 边界（诚实标注——v0.5 真单前还差什么）：
 *   - platform: localfile 未接线（@studio-next/localplatform 在 platform 泳道，未挂 daemon
 *     依赖——接入点=wirePlatform 的 localfile 分支）；v0 只支持 fake（demo 模式）。
 *   - 配置解析为零依赖手写扁平 YAML 子集（注释/#、key: value、引号剥壳、数字/布尔推断）——
 *     真 YAML（yaml@2 带行号 AST）装载归 daemon 依赖登记后的后续刀（16-§二 选型纪律）。
 *   - executor 只注册 fake adapter（demo）；真 dsh 注册走 agent.yaml + agentconfig.wireRegistry。
 *   - 无网关（wkey/署名/动作词校验）、无审批流。
 *   - 定时岗（v0.4，jobs: true）：scheduler（src/scheduler.ts）+ 引擎意图入口（engine.ingest）
 *     全链已通（demo 样例岗=DEMO_SNAPSHOT.health-patrol）；**公司目录 jobs 段装载不进
 *     snapshot**——packages/company 校验器只收形状、toSnapshot 恒置 jobs:[]（v0.1-M3 边界，
 *     见 validator.ts 头注「留后续单」），本刀不动 packages/*——公司目录岗进台账归该单；
 *     现行岗入口=快照 jobs（demo）/upsertJob 热更（测试与 API）。
 *   - SIGINT/SIGTERM 优雅停：等当前拍收口 → 停调度器 → 在途 drain（v0=对内存 handle 优雅杀，
 *     work_records 留 running——重启接管归后续刀）→ 关台账。
 */
import { createRegistry } from '@studio-next/adapters'
import { createModelCatalog, fingerprint, parseModelsYaml } from '@studio-next/core'
import { openLedger, type Ledger } from '@studio-next/store'
import type { CompanySnapshot, FlowPlatform, ModelCatalog, PersonRef, ScheduledJob } from '@studio-next/contract'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type EngineConfig,
  type TickReport,
} from './engine.ts'
import { createFakeAdapter, createFakePlatform } from './fakes.ts'
import { createDefaultGateRunner } from './gate.ts'
import { createDefaultAssembler } from './prompt-assembly.ts'
import { createScheduler, nextRunAt, scheduleIntent, type Scheduler } from './scheduler.ts'

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
  /** 定时岗调度开关（v0.4，16-§四）：true=scheduler + engine 同栈起（demo 样例岗见 DEMO_SNAPSHOT） */
  jobs: boolean
  /** 调度轮询间隔 ms（22-§二「节奏可配」；缺省 15 秒） */
  jobPollMs: number
  /** 公司目录路径（可选：装载 CompanySnapshot；缺省用内置 demo 快照） */
  companyDir?: string
  /**
   * 价目表路径（可选，17-§4 models.yaml）：装载→catalog 注入引擎（估算态 A：
   * estimateCost 校准+双帽）；缺省不装载=态 B 降级（估算=适配器自报、仅票级帽）——
   * **缺省不拷贝 models.example.yaml**（示例价入账=伪依据，两态见 budget-gate.ts 头注）。
   */
  models?: string
  /** 票级预算帽缺省（USD；docs/16-§三 reserve 票帽；TaskBrief.budgetCap 优先） */
  budgetTicketCapUsd?: number
  /** 岗级预算帽缺省（USD；04-§四；仅价目表态 A 生效） */
  budgetPersonCapUsd?: number
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
  jobs: false,
  jobPollMs: 15_000,
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
      case 'models':
        cfg.models = str(value, key)
        break
      case 'budgetTicketCapUsd':
        cfg.budgetTicketCapUsd = num(value, key)
        break
      case 'budgetPersonCapUsd':
        cfg.budgetPersonCapUsd = num(value, key)
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
      case 'jobs':
        cfg.jobs = bool(value, key)
        break
      case 'jobPollMs':
        cfg.jobPollMs = num(value, key)
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
  jobs: [
    // v0.4 首个定时岗样例（16-§四「健康巡检」）：5 分钟巡逻——demo 模式出厂即跑通
    // 「cron 到点 → schedule 意图 → 岗单据 → 派发 → 收割 → 台账」全链（结果=PATROL 起头的事件链）。
    // 真「健康巡检」实职（巡检台账/在途/心跳并产巡逻纪要）归后续运维单——本岗只验机制。
    {
      job_id: 'health-patrol',
      company: 'demo',
      dept: 'departments/工程部',
      cron: '*/5 * * * *',
      role: 'AGENT-1',
      level: 2,
      model_tier: 'low',
      budget_cap: { usd: 1 },
      payload: { type: 'patrol', note: 'demo 健康巡检样例岗（16-§四 v0.4）' },
    },
  ],
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

// ————————————————————————— 定时岗：播种与运行栈 —————————————————————————

/** 播种缺省隔离窗（与 scheduler 缺省一致；坏 cron 走统一隔离路径——scheduler 会再计数+推后） */
const SEED_QUARANTINE_MS = 60 * 60_000

/** 播种结果（serve 启动面观测） */
export interface SeedJobsResult {
  seeded: number
  /** 既有行保序数（next_run_at 原样保留——欠账不清，首拍补跑） */
  kept: number
}

/**
 * 快照 jobs → 台账 jobs 表播种（jobs: true 时 serve 启动调用；18-§三「定时岗全部来自
 * 公司目录配置」的 daemon 侧落点——现行入口=快照 jobs，公司目录 jobs 段装载归
 * packages/company 后续单，见文件头注 v0 边界）。
 * 语义：新岗 next_run_at=cron 下一槽（不立即抢跑）；**既有行 next_run_at 原样保留**
 * ——重启不清欠账：错过槽位由调度器首拍补跑一次（coalesce，18-§三）；last_run_at
 * 不在 upsert 更新列（store 契约）——跑史恒真。坏 cron=now+隔离窗（调度器统一隔离）。
 */
export function seedJobs(
  ledger: Ledger,
  jobs: readonly ScheduledJob[],
  now: number,
): SeedJobsResult {
  let seeded = 0
  let kept = 0
  for (const job of jobs) {
    const existing = ledger.getJob(job.job_id)
    let next: number
    if (existing !== undefined) {
      next = existing.next_run_at
      kept += 1
    } else {
      try {
        const computed = nextRunAt(job.cron, now)
        next = computed === null ? now + SEED_QUARANTINE_MS : computed
      } catch {
        next = now + SEED_QUARANTINE_MS
      }
    }
    ledger.upsertJob({
      job_id: job.job_id,
      company: job.company,
      dept: job.dept,
      cron: job.cron,
      role: job.role,
      level: job.level,
      model_tier: job.model_tier,
      ...(job.budget_cap !== undefined ? { budget_cap: job.budget_cap.usd } : {}),
      ...(job.payload !== undefined ? { payload: job.payload } : {}),
      next_run_at: next,
    })
    if (existing === undefined) seeded += 1
  }
  return { seeded, kept }
}

/** serve 运行栈（engine + 可选 scheduler + 统一停机面；runServe 与测试共用装配） */
export interface ServeRuntime {
  engine: Engine
  scheduler: Scheduler | null
  /** 优雅停：停调度器 → 在途 drain → 关台账（SIGINT/SIGTERM 同一收口；可重入） */
  stop(): Promise<void>
}

/**
 * 装配 serve 运行栈：jobs=true 时快照播种 + scheduler 起在 engine 边上——
 * onDue 只产 schedule 意图入 engine.ingest（22-§一 源零直驱），决策归主循环。
 */
export function buildServeRuntime(
  config: ServeConfig,
  ledger: Ledger,
  snapshot: CompanySnapshot,
  opts?: { log?: (line: string) => void; clock?: () => number; quarantineMs?: number },
): ServeRuntime {
  const log = opts?.log ?? ((line: string): void => console.log(line))
  const clock = opts?.clock ?? ((): number => Date.now())

  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })

  // 价目表装载（可选，17-§4）：daemon.yaml models: 段 → parseModelsYaml → catalog 注入引擎
  // （态 A）；缺省不装载=态 B 降级——**不拷贝 models.example.yaml**（示例价入账=伪依据）。
  // fingerprint 启动日志呈现（「价目表改动走批示」的可观测锚；台账事件锚归后续 daemon 单，
  // 事件名待批示）。装载失败（语法/形状/缺 main_worker）→ CONFIG_INVALID 拒绝启动，不静默降级。
  let catalog: ModelCatalog | undefined
  if (config.models !== undefined) {
    const text = readFileSync(path.resolve(config.models), 'utf8')
    const parsed = parseModelsYaml(text)
    catalog = createModelCatalog(parsed)
    log(`[serve] 价目表装载：${config.models}（fingerprint=${fingerprint(parsed)}；估算态 A：estimateCost 校准+双帽）`)
  } else {
    log('[serve] 无价目表：预算闸态 B 降级（估算=适配器自报、仅票级帽——见 src/budget-gate.ts 头注两态）')
  }

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
    ...(config.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: config.budgetTicketCapUsd } : {}),
    ...(config.budgetPersonCapUsd !== undefined ? { budgetPersonCapUsd: config.budgetPersonCapUsd } : {}),
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
    clock,
    config: engineConfig,
    people: snapshot.people,
    ...(catalog !== undefined ? { catalog } : {}),
  })

  let scheduler: Scheduler | null = null
  if (config.jobs) {
    const seeded = seedJobs(ledger, snapshot.jobs, clock())
    log(`[serve] 定时岗播种：新 ${seeded.seeded} / 保留 ${seeded.kept}（快照共 ${snapshot.jobs.length} 岗）`)
    scheduler = createScheduler({
      ledger,
      clock,
      intervalMs: config.jobPollMs,
      ...(opts?.quarantineMs !== undefined ? { quarantineMs: opts.quarantineMs } : {}),
      onDue: (job, firedAt) => {
        engine.ingest([scheduleIntent(job, firedAt)])
        log(`[scheduler] job ${job.job_id} 到点（firedAt=${new Date(firedAt).toISOString()}）→ schedule 意图入队`)
      },
      log,
    })
  }

  return {
    engine,
    scheduler,
    async stop(): Promise<void> {
      if (scheduler !== null && scheduler.running) scheduler.stop()
      await engine.dispose()
      ledger.close()
    },
  }
}

// ————————————————————————— 主循环 —————————————————————————

/** 一拍心跳日志行（serve 运行面观测；事件面账目在台账） */
function renderTick(report: TickReport): string {
  const p = report.phases
  return (
    `tick#${report.seq} actions=${report.actions.length} dispatched=${p.dispatch.dispatched} ` +
    `budget=${p.dispatch.budgetReserved}reserved/${p.dispatch.budgetRefused}refused ` +
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
 * 常驻主循环：装配运行栈（jobs=true 时含调度器播种与启动）→ 循环 tick（tickMs 间隔，
 * 信号可打断等待）→ 信号/出错优雅停（runtime.stop 统一收口：停调度器→drain→关台账）。
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

  const { engine, scheduler, stop } = buildServeRuntime(config, ledger, snapshot)

  console.log(`[serve] studio-next daemon 启动（company=${config.company} platform=${config.platform} db=${path.resolve(config.db)} tickMs=${config.tickMs}${config.jobs ? ` jobs=on pollMs=${config.jobPollMs}` : ''}）`)
  console.log('[serve] v0 demo 栈：fake platform + fake executor + 默认占位闸门（诚实边界见 src/serve.ts 头注）')
  scheduler?.start()

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

  console.log(`[serve] 停机（${stopReason}${lastError !== undefined ? `：${lastError}` : ''}）——停调度器 + 在途 drain`)
  await stop()
  console.log('[serve] 已优雅关闭（台账落盘；work_records 在途项接管归后续刀）')
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
