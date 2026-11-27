/**
 * models-hot-swap —— models.yaml 动态模型热切（task-34；零重启、不打断在途单）
 *
 * 触发面=文件监听（fs.watch + mtime/hash 去抖 + 启动盲窗补检），**不扩 L1 reload 语义**：
 * L1 的幂等键/信任锚门以 companyDir 指纹为准，models.yaml 不在公司目录且手动 reload 在
 * 公司目录未变时会判 unchanged 不进 apply；独立监听面最小、可测、失败不牵连 L1。
 *
 * 单拍边界执行链（serve 主循环 tick 收口后；单线程无并发 tick）：
 *   1) 检测 models.yaml 内容 hash 变化，稳定 debounceMs（默认 500）后读全文；
 *   2) `parseModelsYaml` 全量校验（strict、三档、价格、roles.main_worker）→ `createModelCatalog`；
 *   3) `provisionModelTierOverlays` **原子重写** var/tmp/dsh-tier-{high,mid,low}.yml（worker
 *      下次 spawn 读新文件；mid overlay 路径已挂 cmd，无需改 cmd 数组）；
 *   4) 回调 serve 层刷新内存价目表/角色路由/adapter model 声明镜像（在途 worker 用 launch
 *      捕获值，不被串档）；
 *   5) 成功 SCHEMA_EVOLVE；失败 ESCALATE——**复用既有事件词表，不新增事件名**。
 *
 * fail-closed/原子：解析全部通过后才写 overlay；overlay 写入/apply 任一步失败→回滚旧
 * overlay 内容并保持旧 catalog/路由（不半切换）；坏文件内容 hash 记录后不每拍重试，
 * 文件再变才重试。不写 agent.yaml/profile、不改契约/schema、不自动重启。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { ModelCatalog } from '@studio-next/contract'
import { createModelCatalog, parseModelsYaml, type TierId } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { provisionModelTierOverlays } from '../../engine/tier/model-tier.ts'
import { seedRoutingPriceSnapshots } from '../../engine/routing/seed.ts'
import { sourceExecutorIssues, type SourceRegistryFace } from '../../engine/routing/source-executor.ts'

/** models.yaml tier → executor 位名（与 executor-face TIER_EXECUTOR / 885 自动挂载同源） */
const TIER_EXECUTORS: Readonly<Record<string, TierId>> = { dsh: 'mid', 'dsh-mid': 'mid', 'dsh-high': 'high', 'dsh-low': 'low' }

export interface ModelsHotSwapApplyInput {
  readonly catalog: ModelCatalog
  readonly modelTierByRole: Readonly<Record<string, TierId>>
  /** executor 位名 → provider/model（serve 层刷新 DshAdapter 声明镜像；在途不受影响） */
  readonly tierModels: Readonly<Record<string, string | undefined>>
  /** task-56：新 sources 计划（serve 热切原子替换；在途不换源） */
  readonly sources?: Partial<Record<import('@studio-next/core').TierId, readonly import('@studio-next/core').ModelSourceSpec[]>>
  /** 已落盘 overlay 绝对路径（观测/测试） */
  readonly overlays: Readonly<Record<TierId, string>>
}

export interface ModelsHotSwapDeps {
  /** daemon.yaml models 段（缺省=面关；不报错） */
  readonly modelsPath: string | undefined
  readonly rootDir: string
  readonly company: string
  readonly deptFallback: string
  /** 台账（appendEvent=热切事件；append/listPriceSnapshots=task-135 新源价目即时补种） */
  readonly ledger: Pick<Ledger, 'appendEvent' | 'appendPriceSnapshot' | 'listPriceSnapshots'>
  readonly clock: () => number
  readonly makeId: (ts: number) => string
  readonly log: (line: string) => void
  /** 应用面（serve 层：engine.applyModelsUpdate + adapter.setModel；抛错=回滚旧 overlay/旧内存） */
  readonly apply: (input: ModelsHotSwapApplyInput) => void
  /**
   * task-141：源 executor 登记校验面（serve 恒注入 executor 注册表；缺省=校验面关——仅
   * 测试直连可省，派发面 adapterForSource 仍 fail-closed 兜底）。热切先校验后落盘：
   * sources[].executor 未登记 → 拒绝热切、保持旧配置（kind='invalid'）。
   */
  readonly registry?: SourceRegistryFace
  /** 内容稳定窗（半写防护；缺省 500ms） */
  readonly debounceMs?: number
}

export type ModelsHotSwapKind = 'applied' | 'invalid' | 'apply-failed'
export interface ModelsHotSwapReport {
  readonly kind: ModelsHotSwapKind
  readonly models: readonly string[]
  readonly detail?: string
  readonly eventId: string
}

export interface ModelsHotSwap {
  /** serve 拍边界调用；恒不抛（内部全捕获；失败=ESCALATE+旧态保持） */
  check(): Promise<ModelsHotSwapReport | null>
  readonly stats: { readonly checks: number; readonly applies: number; readonly failures: number; readonly lastHash: string | null }
  /** 停监听（进程停机；不影响台账） */
  close(): void
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
function modelOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** 构造热切执行体（modelsPath 缺省=面关；监听失败降级为每拍 hash 补检，不崩） */
export function createModelsHotSwap(deps: ModelsHotSwapDeps): ModelsHotSwap {
  const debounceMs = deps.debounceMs ?? 500
  const modelsPath = deps.modelsPath === undefined ? undefined : path.resolve(deps.modelsPath)
  let lastHash: string | null = null
  let pendingSince: number | null = null
  let watcher: FSWatcher | undefined
  let closed = false
  const stats = { checks: 0, applies: 0, failures: 0, get lastHash(): string | null { return lastHash } }

  const emit = (event: 'SCHEMA_EVOLVE' | 'ESCALATE', note: string, level: number): string => {
    const ts = deps.clock()
    const id = deps.makeId(ts)
    deps.ledger.appendEvent({
      id,
      ts,
      company: deps.company,
      issue: '-',
      event,
      actor: 'daemon',
      attempt: 1,
      level,
      dept: deps.deptFallback,
      tokens: { input: 0 },
      note: note.slice(0, 2000),
    })
    return id
  }

  // 启动盲窗：构造时读当前内容做基线——启动后首拍即可发现构造前发生的修改
  if (modelsPath !== undefined) {
    try {
      if (existsSync(modelsPath)) lastHash = hashOf(readFileSync(modelsPath, 'utf8'))
      deps.log(`[models-hot-swap] models.yaml 监听已接：${modelsPath}（baseline=${(lastHash ?? 'missing').slice(0, 12)}…；debounce=${String(debounceMs)}ms；零重启热切）`)
      try {
        watcher = watch(modelsPath, { persistent: false }, () => {
          if (!closed) pendingSince = deps.clock()
        })
      } catch (err) {
        deps.log(`[models-hot-swap] fs.watch 不可用（降级每拍 hash 补检，不崩）：${err instanceof Error ? err.message : String(err)}`)
      }
    } catch (err) {
      deps.log(`[models-hot-swap] models.yaml 基线读取失败（面关，保持启动装配）：${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    deps.log('[models-hot-swap] 无 models 段——动态热切面关（换模型仍需重启）')
  }

  const backupsOf = (rootDir: string): Map<string, string | null> => {
    const m = new Map<string, string | null>()
    for (const tier of ['high', 'mid', 'low'] as const) {
      const file = path.join(rootDir, 'tmp', `dsh-tier-${tier}.yml`)
      m.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null)
    }
    return m
  }
  const restore = (backups: Map<string, string | null>): void => {
    for (const [file, text] of backups) {
      try {
        if (text === null) {
          if (existsSync(file)) unlinkSync(file)
          continue
        }
        const tmp = `${file}.restore-${String(process.pid)}`
        writeFileSync(tmp, text, 'utf8')
        renameSync(tmp, file)
      } catch {
        /* 回滚失败不掩盖原错误（旧内容已尽力恢复；下一次热切会再刷新） */
      }
    }
  }

  const applyNow = (hash: string, text: string): ModelsHotSwapReport => {
    // ① 全量校验（任何坏 YAML/缺档/坏价/roles 缺 main_worker → CONFIG_INVALID，旧态不动）
    let parsed: ReturnType<typeof parseModelsYaml>
    try {
      parsed = parseModelsYaml(text)
    } catch (err) {
      stats.failures += 1
      const detail = err instanceof Error ? err.message : String(err)
      const eventId = emit('ESCALATE', `MODELS_RELOAD_INVALID：models.yaml 校验失败，保持旧模型/旧价（trigger=watch）：${detail}`, 1)
      deps.log(`[models-hot-swap] 热切拒绝（保持旧配置）：${detail}——ESCALATE ${eventId}`)
      lastHash = hash
      pendingSince = null
      return { kind: 'invalid', models: [], detail, eventId }
    }
    // ② 内存装配全量构造后再写文件（原子面：先校验后落盘）
    let catalog: ModelCatalog
    try {
      catalog = createModelCatalog(parsed)
    } catch (err) {
      stats.failures += 1
      const detail = err instanceof Error ? err.message : String(err)
      const eventId = emit('ESCALATE', `MODELS_RELOAD_INVALID：catalog 构造失败，保持旧配置：${detail}`, 1)
      lastHash = hash
      pendingSince = null
      return { kind: 'invalid', models: [], detail, eventId }
    }
    // ②′ task-141：源 executor 登记校验（先校验后落盘——未登记名拒绝热切、保持旧配置；
    //    与 serve 启动校验同判据 engine/routing/source-executor.ts；校验面随 registry 注入）
    if (deps.registry !== undefined) {
      const issues = sourceExecutorIssues(parsed.sources, deps.registry.list().map((e) => e.name))
      if (issues.length > 0) {
        stats.failures += 1
        const detail = `sources[].executor 未登记（task-141）：${issues.join('；')}`
        const eventId = emit('ESCALATE', `MODELS_RELOAD_INVALID：models.yaml sources[].executor 未登记，保持旧配置：${issues.join('；')}`, 1)
        deps.log(`[models-hot-swap] 热切拒绝（保持旧配置）：${detail}——ESCALATE ${eventId}`)
        lastHash = hash
        pendingSince = null
        return { kind: 'invalid', models: [], detail, eventId }
      }
    }
    const tierModels: Record<string, string | undefined> = {}
    for (const [executor, tier] of Object.entries(TIER_EXECUTORS)) {
      const spec = parsed.tiers[tier]
      tierModels[executor] = spec === undefined ? undefined : modelOf(spec.provider, spec.model)
    }
    const modelList = (['high', 'mid', 'low'] as const).map((t) => `${t}=${modelOf(parsed.tiers[t].provider, parsed.tiers[t].model)}`)
    const backups = backupsOf(path.resolve(deps.rootDir))
    let overlays: Record<TierId, string>
    try {
      overlays = provisionModelTierOverlays(path.resolve(deps.rootDir), parsed)
      deps.apply({ catalog, modelTierByRole: parsed.roles, tierModels, overlays, ...(parsed.sources !== undefined ? { sources: parsed.sources } : {}) })
    } catch (err) {
      restore(backups)
      stats.failures += 1
      const detail = err instanceof Error ? err.message : String(err)
      const eventId = emit('ESCALATE', `MODELS_RELOAD_APPLY_FAILED：热切应用失败，已回滚 overlay/保持旧内存配置：${detail}`, 1)
      deps.log(`[models-hot-swap] 热切失败（已回滚，旧配置继续跑）：${detail}——ESCALATE ${eventId}`)
      lastHash = hash
      pendingSince = null
      return { kind: 'apply-failed', models: modelList, detail, eventId }
    }
    // task-135：apply 后对新源即时补种 price snapshot（同启动播种口径 engine/routing/seed.ts；
    // 当日已播 provider/model 幂等跳过；异常只告警不回滚——价目缺行不破坏热切本体，不重启）
    let sourcesSeeded = 0
    try {
      sourcesSeeded = seedRoutingPriceSnapshots({ ledger: deps.ledger, company: deps.company, clock: deps.clock, log: deps.log, origin: 'task-135 热切补种' }, parsed).appended
    } catch (err) {
      deps.log(`[models-hot-swap] 源价目补种异常（不回滚，价目缺行可查）：${err instanceof Error ? err.message : String(err)}`)
    }
    const eventId = emit('SCHEMA_EVOLVE', `MODELS_RELOAD;trigger=watch;models=${modelList.join(',')};overlays=${Object.values(overlays).map((p) => path.basename(p)).join('/')};sourcesSeeded=${String(sourcesSeeded)};零进程重启、在途单不打断（task-34）`, 1)
    stats.applies += 1
    lastHash = hash
    pendingSince = null
    deps.log(`[models-hot-swap] 已热切：${modelList.join('、')}；overlay 已重写（下一次 spawn 生效）；台账 SCHEMA_EVOLVE ${eventId}`)
    return { kind: 'applied', models: modelList, eventId }
  }

  return {
    async check(): Promise<ModelsHotSwapReport | null> {
      if (closed || modelsPath === undefined) return null
      stats.checks += 1
      try {
        if (!existsSync(modelsPath)) return null // 文件缺失=保持旧配置（不热切、不清空）
        const text = readFileSync(modelsPath, 'utf8')
        const hash = hashOf(text)
        if (hash === lastHash) {
          pendingSince = null
          return null
        }
        // 去抖：首次发现变化只记待稳定，满 debounce 后仍同 hash 才应用
        if (pendingSince === null) {
          pendingSince = deps.clock()
          return null
        }
        if (deps.clock() - pendingSince < debounceMs) return null
        return applyNow(hash, text)
      } catch (err) {
        stats.failures += 1
        deps.log(`[models-hot-swap] 检测异常（保持旧配置，不崩）：${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
    stats,
    close(): void {
      closed = true
      try {
        watcher?.close()
      } catch {
        /* 已关闭/未建立 */
      }
    },
  }
}
