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
 *   gateway: true|false（网关写收口开关，缺省开——17-§7；生产不得关）
 *   gatewaySecret: <网关 HMAC 密钥>（>=32B；缺省开发值——**生产必配**，见 DEV_GATEWAY_SECRET 警告）
 *
 * v0 边界（诚实标注——v0.5 真单前还差什么）：
 *   - platform: localfile 未接线（@studio-next/localplatform 在 platform 泳道，未挂 daemon
 *     依赖——接入点=wirePlatform 的 localfile 分支）；v0 只支持 fake（demo 模式）。
 *   - 配置解析为零依赖手写扁平 YAML 子集（注释/#、key: value、引号剥壳、数字/布尔推断）——
 *     真 YAML（yaml@2 带行号 AST）装载归 daemon 依赖登记后的后续刀（16-§二 选型纪律）。
 *   - executor 只注册 fake adapter（demo）；真 dsh 注册走 agent.yaml + agentconfig.wireRegistry。
 *   - 网关（17-§7 写入全收口）：**平台写路径已过闸**（src/gated-platform.ts——控制面 control key、
 *     署名注入、fail-closed；缺省开，daemon.yaml `gatewaySecret:` 配密钥、缺省开发值生产必换）。
 *     worker 级按单 wkey 已接（src/worker-key.ts：dispatch 签发+TaskBrief.credentials
 *     env 注入、GATE_FAIL/断路/CLOSE 吊销）；仍欠：studio-tools stdio 入口（worker 进程内挂 MCP
 *     server 的入口单——工厂已备，须复用 createStudioToolsServer）与吊销集跨进程可见性
 *     （authority 落 store，gateway 包挂账）；审批流（呈批事件名待批示）同前。
 *   - 定时岗（v0.4，jobs: true）：scheduler（src/scheduler.ts）+ 引擎意图入口（engine.ingest）
 *     全链已通（demo 样例岗=DEMO_SNAPSHOT.health-patrol）；**公司目录 jobs 段装载不进
 *     snapshot**——packages/company 校验器只收形状、toSnapshot 恒置 jobs:[]（v0.1-M3 边界，
 *     见 validator.ts 头注「留后续单」），本刀不动 packages/*——公司目录岗进台账归该单；
 *     现行岗入口=快照 jobs（demo）/upsertJob 热更（测试与 API）。
 *   - 唤起源注册表（v0.8 地基，22-§一）：scheduler 源（jobs: true 时注册——源开关=既有 jobs
 *     键，缺省语义不动）+ matrix 源（matrix: true + 注入工厂，daemon 不强依赖 @studio-next/matrix）
 *     + watch-file 示例源（fileWatch: true + fileWatchPath，22-§三.1 验收靶子）。
 *     startAll 的 emit 统一进 engine.ingest——源零直驱（注册表与源实现见 src/sources.ts）。
 *     意图消费门在引擎：v0.4 面只物化 schedule 意图，webhook/mention 等明报不支持
 *     （六源全通归 v0.8 后续刀）——注册面先行，消费面按刀推进。
 *   - SIGINT/SIGTERM 优雅停：等当前拍收口 → **先 stopAll 唤起源**（不再进新意图）→ 在途
 *     drain（v0=对内存 handle 优雅杀，work_records 留 running——重启接管归后续刀）→ 关台账。
 *     队列中未消费意图停机即弃（at-most-once，与调度器 markRan 已提交而 ingest 未消费的
 *     既有边界同语义——engine.ts 头注）。
 *   - 进化管线判负闸（v0 观察模式，src/evolve-guard.ts）：serve 启动对框架资产清单（v0
 *     极小样例集）跑 authorize（core assertChangeAuthorized ∘ 台账候选全集），unauthorized
 *     如实报告（日志+ESCALATE 事件）**不阻断启动**；空库首启跳过（零检查如实）。真单刀接
 *     阻断模式+资产面扩展+真生产改动路径拦截（头注冻结边界）。
 */
import { createRegistry } from '@studio-next/adapters'
import { createModelCatalog, fingerprint, parseModelsYaml } from '@studio-next/core'
import { createGateway, CONTROL_TICKET } from '@studio-next/gateway'
import type { SignatureContext } from '@studio-next/gateway'
import { openLedger, type Ledger } from '@studio-next/store'
import type {
  CompanySnapshot,
  FlowPlatform,
  InvokeSource,
  ModelCatalog,
  PersonRef,
  ScheduledJob,
  SourceManifest,
} from '@studio-next/contract'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type EngineConfig,
  type TickReport,
} from './engine.ts'
import { runEvolveStartupSelfCheck, type EvolveSelfCheckReport, type FrozenAsset } from './evolve-guard.ts'
import { createFakeAdapter, createFakePlatform } from './fakes.ts'
import { createGatedPlatform } from './gated-platform.ts'
import { createDefaultGateRunner } from './gate.ts'
import { makeUlid } from './id.ts'
import { createDefaultAssembler } from './prompt-assembly.ts'
import { nextRunAt, type Scheduler } from './scheduler.ts'
import type { WorkerKeyDeps } from './worker-key.ts'
import {
  createFileWatchSource,
  createSchedulerSource,
  createSourceRegistry,
  FILE_WATCH_MANIFEST,
  SCHEDULER_SOURCE_MANIFEST,
  type SourceRegistry,
} from './sources.ts'

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
  /** 定时岗调度开关（v0.4，16-§四）：true=scheduler + engine 同栈起（demo 样例岗见 DEMO_SNAPSHOT）。
   *  v0.8 地基起 jobs 兼作 scheduler 源开关（22-§一/§二：注册表注册并随 startAll 起） */
  jobs: boolean
  /** 调度轮询间隔 ms（22-§二「节奏可配」；缺省 15 秒） */
  jobPollMs: number
  /**
   * matrix @唤醒源开关（22-§二；缺省关）：true 时经**注入工厂**装配（buildServeRuntime
   * opts.matrixSource）——daemon 不强依赖 @studio-next/matrix（装配单元注入
   * createMentionSource 产物；start/stop 签名对齐 InvokeSource 端口即可接入）。
   * 开而未注入工厂=CONFIG_INVALID 拒启动（不静默空转）。
   */
  matrix: boolean
  /**
   * watch-file 示例源开关（22-§三.1 验收靶子；缺省关）：true 时监听 fileWatchPath 指定
   * 文件的变化，JSON 行各产一条 webhook 意图（dedupKey=mtime#行号，见 src/sources.ts）。
   */
  fileWatch: boolean
  /** watch-file 监听文件路径（fileWatch: true 时必配；文件须先存在——CONFIG_INVALID 明报） */
  fileWatchPath?: string
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
  /**
   * 网关写收口开关（17-§7「一切平台写入经 wkey 网关」；src/gated-platform.ts）：
   * 缺省开——demo fake 平台也过真闸（同 secret 同验签链路）证明收口面；false=裸 platform
   * （仅测试/对照用，生产不得关——头注警告）。
   */
  gateway: boolean
  /**
   * 网关 HMAC 密钥（daemon.yaml `gatewaySecret:`；>=32 字节，不足构造期抛 CONFIG_INVALID 拒启动）。
   * 【警告】缺省=开发占位值（下方 DEV_GATEWAY_SECRET）——**生产必配强随机密钥**；
   * 密钥只进 HMAC，永不入日志/错误消息/台账（gateway 纪律）。
   */
  gatewaySecret?: string
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
  matrix: false,
  fileWatch: false,
  gateway: true,
}

/**
 * 开发缺省网关密钥（demo/测试占位——46 ASCII 字节，过 32B 门限）。
 * 【警告】生产必配 daemon.yaml `gatewaySecret:`（强随机 >=32B）：缺省值公开在仓库里，
 * 等于闸上无锁；secret 只进 HMAC 不落任何日志/台账（gateway 包纪律）。
 */
export const DEV_GATEWAY_SECRET = 'studio-next-dev-gateway-secret-do-not-use-in-prod'

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
      case 'matrix':
        cfg.matrix = bool(value, key)
        break
      case 'fileWatch':
        cfg.fileWatch = bool(value, key)
        break
      case 'fileWatchPath':
        cfg.fileWatchPath = str(value, key)
        break
      case 'gateway':
        cfg.gateway = bool(value, key)
        break
      case 'gatewaySecret':
        cfg.gatewaySecret = str(value, key)
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

/**
 * daemon 侧网关身份（控制面与 worker-key 签发共用的 secret/署名上下文/工号）。
 * 签名上下文取快照首部门+公司级（控制面无人员档案，拟稿待批）。
 */
function daemonIdentity(config: ServeConfig, snapshot: CompanySnapshot): {
  secret: Uint8Array
  ctx: SignatureContext
  author: string
} {
  return {
    secret: new TextEncoder().encode(config.gatewaySecret ?? DEV_GATEWAY_SECRET),
    ctx: {
      company: snapshot.name,
      dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
      role: 'daemon',
      level: Math.max(1, snapshot.level),
    },
    author: ENGINE_CONFIG_DEFAULTS.actor,
  }
}

/**
 * 网关写收口接线（17-§7：engine 直调 platform 是最后一条未收口写路径——本函数收口）。
 * 控制面实例（ticket=CONTROL_TICKET）+ daemon 侧身份署名；gateway: false 时裸 platform 直返
 * （对照/测试用——生产不得关）。签名上下文取快照首部门+公司级（控制面无人员档案，拟稿待批）。
 */
function wireGatedPlatform(raw: FlowPlatform, config: ServeConfig, snapshot: CompanySnapshot, clock: () => number, log: (line: string) => void): FlowPlatform {
  if (!config.gateway) {
    log('[serve] 警告：gateway=false——平台写路径未过闸（仅测试/对照用；生产不得关，17-§7）')
    return raw
  }
  const { secret, ctx, author } = daemonIdentity(config, snapshot)
  const usingDevSecret = config.gatewaySecret === undefined
  const gateway = createGateway({ secret, clock, ticket: CONTROL_TICKET, ctx, author })
  log(
    `[serve] 网关已接：平台写路径全收口（17-§7；控制面 control key，一调用一签发）` +
      `${usingDevSecret ? '——【警告】用开发缺省密钥（生产必配 daemon.yaml gatewaySecret:）' : '（密钥来自 daemon.yaml）'}`,
  )
  return createGatedPlatform(raw, gateway, { ctx, author })
}

/**
 * worker 级 wkey 接线（17-§7「按单签发→随派发注入→关单吊销」；src/worker-key.ts）。
 * gateway: false 时不签发（与控制面同开关）；签发实例绑 CONTROL_TICKET——本实例只用
 * issue/revoke 面，verify 面结构性失效（永远不能验 worker key，防误用；worker 侧验签
 * 归 per-ticket studio-tools 接线，吊销跨进程可见性疑点见 worker-key.ts 头注）。
 */
function wireWorkerKeys(config: ServeConfig, snapshot: CompanySnapshot, clock: () => number, log: (line: string) => void): WorkerKeyDeps | undefined {
  if (!config.gateway) return undefined
  const { secret, ctx, author } = daemonIdentity(config, snapshot)
  const gateway = createGateway({ secret, clock, ticket: CONTROL_TICKET, ctx, author })
  log('[serve] worker wkey 已接：按单签发 → TaskBrief.credentials（env 通道，子进程 env STUDIO_TOOLS_WKEY）→ GATE_FAIL/断路/CLOSE 吊销（17-§7；scope=六动词全集；凭据值红名单——不入提示词/档案/任务书/日志）')
  return { gateway }
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

/** serve 运行栈（engine + 唤起源注册表 + 统一停机面；runServe 与测试共用装配） */
export interface ServeRuntime {
  engine: Engine
  scheduler: Scheduler | null
  /** 唤起源注册表（22-§一）：startAll 的 emit 统一进 engine.ingest（runServe 接线） */
  sources: SourceRegistry
  /**
   * 启动期进化判负自检汇报（src/evolve-guard.ts，v0 观察模式）：ESCALATE 事件已在装配期
   * 落账（unauthorized 时）；本字段为汇报面（测试/面板观测锚）。
   */
  evolveSelfCheck: EvolveSelfCheckReport
  /**
   * 优雅停：先 stopAll 唤起源（不再进新意图）→ 在途 drain → 关台账
   * （SIGINT/SIGTERM 同一收口；可重入）。队列中未消费意图停机即弃（at-most-once，
   * 与调度器 markRan 已提交而 ingest 未消费的既有边界同语义——engine.ts 头注）。
   */
  stop(): Promise<void>
}

/** matrix 源 manifest（工厂注入面——daemon 不强依赖 @studio-next/matrix，22-§二） */
const MATRIX_MANIFEST: SourceManifest = {
  name: 'matrix',
  kind: 'mention',
  configSchema: '注入工厂（装配单元供 createMentionSource 产物；daemon.yaml matrix 开关）',
}

/**
 * demo 冻结验收命令（单一常量双消费：装配器 L4 acceptance + Blind 读面验收面——
 * 17-§7 读面分级与 17-§6 收割口径同源，不双源漂移；真单刀接任务书粒度冻结时此处换装载）
 */
const ACCEPTANCE: string[] = ['echo demo-ok（v0 占位闸门不执行验收命令）']

/**
 * 装配 serve 运行栈：唤起源统一走注册表（22-§一）——
 *   - jobs=true：快照播种 + scheduler 源注册（源开关=既有 jobs 键，缺省语义不动）；
 *   - matrix=true：注入工厂装配（开而未注入=CONFIG_INVALID 拒启动）；
 *   - fileWatch=true：watch-file 示例源注册（fileWatchPath 必配）。
 * 源的 emit 由 runServe 的 startAll 统一接进 engine.ingest——源零直驱，决策归主循环。

 */
export function buildServeRuntime(
  config: ServeConfig,
  ledger: Ledger,
  snapshot: CompanySnapshot,
  opts?: {
    log?: (line: string) => void
    clock?: () => number
    quarantineMs?: number
    /** matrix 源工厂（matrix: true 时调用；不注入=CONFIG_INVALID——daemon 不强依赖 matrix 包） */
    matrixSource?: () => InvokeSource
    /**
     * 进化判负自检注入面（测试确定性；缺省=仓样例集 FROZEN_FRAMEWORK_ASSETS + cwd 真文件
     * 哈希——src/evolve-guard.ts 头注锚定口径）：manifest/hashFile/fileExists 逐项覆盖。
     */
    evolveSelfCheck?: {
      manifest?: readonly FrozenAsset[]
      hashFile?: (assetPath: string) => string
      fileExists?: (assetPath: string) => boolean
    }
  },
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
    // 读面分级（17-§7）：Blind 档冻结验收命令来源——与装配器 acceptance **同一常量**
    //（单一事实源，不双源漂移）；遇 Blind 派发而缺失 → createView fail-closed 明报
    readBlindAcceptance: ACCEPTANCE,
    ...(config.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: config.budgetTicketCapUsd } : {}),
    ...(config.budgetPersonCapUsd !== undefined ? { budgetPersonCapUsd: config.budgetPersonCapUsd } : {}),
  }
  // worker 级 wkey（17-§7）：按单签发→TaskBrief.credentials env 注入→关单吊销（src/worker-key.ts）
  const workerKeys = wireWorkerKeys(config, snapshot, clock, log)
  const engine = createEngine({
    // 写路径网关收口（17-§7）：raw platform 包一层 gated 代理——engine 写调用签名不变（透明）
    platform: wireGatedPlatform(wirePlatform(config), config, snapshot, clock, log),
    ...(workerKeys !== undefined ? { workerKeys } : {}),
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 Studio Next demo worker：按任务书目标产出，落 REPORT 与 summary，验收口径即闸门。',
      snapshot,
      acceptance: ACCEPTANCE,
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock,
    config: engineConfig,
    people: snapshot.people,
    ...(catalog !== undefined ? { catalog } : {}),
  })

  // —— 唤起源注册表（22-§一）：三源按配置接入，emit 统一进 engine.ingest（runServe 接线） ——
  const sources = createSourceRegistry({ log })
  const ingestSink = (intent: Parameters<Engine['ingest']>[0][number]): void => {
    engine.ingest([intent])
  }

  let scheduler: Scheduler | null = null
  if (config.jobs) {
    const seeded = seedJobs(ledger, snapshot.jobs, clock())
    log(`[serve] 定时岗播种：新 ${seeded.seeded} / 保留 ${seeded.kept}（快照共 ${snapshot.jobs.length} 岗）`)
    // scheduler 源：包装现有调度器（零改 scheduler.ts）——手动泵（poll）经 sink 直达 ingest
    // （serve 测试面），start 后由注册表 emit 接管同一队列（src/sources.ts 头注）
    const schedulerSource = createSchedulerSource({
      ledger,
      clock,
      intervalMs: config.jobPollMs,
      ...(opts?.quarantineMs !== undefined ? { quarantineMs: opts.quarantineMs } : {}),
      sink: ingestSink,
      log,
    })
    scheduler = schedulerSource.scheduler
    sources.register(schedulerSource, SCHEDULER_SOURCE_MANIFEST)
  }

  if (config.matrix) {
    if (opts?.matrixSource === undefined) {
      throw new Error(
        'CONFIG_INVALID：matrix: true 需注入 matrix 源工厂（buildServeRuntime opts.matrixSource）——' +
          'daemon 不强依赖 @studio-next/matrix；装配单元注入 createMentionSource 产物（22-§二，' +
          'start/stop 签名对齐 InvokeSource 端口即可接入）',
      )
    }
    sources.register(opts.matrixSource(), MATRIX_MANIFEST)
  }

  if (config.fileWatch) {
    if (config.fileWatchPath === undefined || config.fileWatchPath === '') {
      throw new Error('CONFIG_INVALID：fileWatch: true 需配 fileWatchPath（监听文件路径，文件须先存在——22-§三.1）')
    }
    sources.register(
      createFileWatchSource({ company: config.company, file: path.resolve(config.fileWatchPath), log }),
      FILE_WATCH_MANIFEST,
    )
  }

  log(`[serve] 唤起源注册表：${sources.list().map((e) => e.source.name).join('、') || '（空）'}——emit 统一进 engine.ingest（22-§一 源零直驱）`)

  // —— 进化管线判负闸·启动自检（v0 观察模式，src/evolve-guard.ts；20-§九 无 candidate id
  //    的生产改动判负）：对框架资产清单逐项 authorize，unauthorized 落 ESCALATE 如实报告、
  //    不阻断启动（阻断模式+资产面扩展归真单刀——头注冻结边界） ——
  const evolveSelfCheck = runEvolveStartupSelfCheck({
    ledger,
    clock,
    makeId: makeUlid,
    company: config.company,
    actor: ENGINE_CONFIG_DEFAULTS.actor,
    dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    log,
    ...(opts?.evolveSelfCheck ?? {}),
  })

  return {
    engine,
    scheduler,
    sources,
    evolveSelfCheck,
    async stop(): Promise<void> {
      // 先停源（不再进新意图）→ 再停引擎（在途 drain）→ 关台账（SIGINT 停机顺序，22-§三.3）
      sources.stopAll()
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

  const { engine, sources, stop } = buildServeRuntime(config, ledger, snapshot)

  console.log(`[serve] studio-next daemon 启动（company=${config.company} platform=${config.platform} db=${path.resolve(config.db)} tickMs=${config.tickMs}${config.jobs ? ` jobs=on pollMs=${config.jobPollMs}` : ''}）`)
  console.log('[serve] v0 demo 栈：fake platform + fake executor + 默认占位闸门（诚实边界见 src/serve.ts 头注）')
  // 唤起源统一启动（22-§一）：各源 start(emit)——emit 统一进引擎 ingest 队列，
  // 下一拍 state-diff 前消费；单源启动异常由注册表隔离（捕获+计数+继续，src/sources.ts）
  sources.startAll((intent) => {
    engine.ingest([intent])
  })

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

  console.log(`[serve] 停机（${stopReason}${lastError !== undefined ? `：${lastError}` : ''}）——先停唤起源（不进新意图）+ 在途 drain`)
  await stop()
  console.log('[serve] 已优雅关闭（台账落盘；work_records 在途项接管归后续刀）')
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
