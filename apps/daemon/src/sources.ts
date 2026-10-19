/**
 * sources —— 唤起源注册表 + 三源接入（v0.8 地基，docs/22-唤起源与解耦）
 *
 * 规格依据（实现单引用）：
 *   - docs/22-§一 唤起源接口：**源是插件**——只产「唤起意图」，没有任何源能直接驱动
 *     worker；意图进主循环（engine.ingest 队列），由状态机决定是否唤起。新源=新注册项
 *     （register 声明 manifest），不动主循环一行；源的增删走进化管线（可配可灰度）。
 *   - docs/22-§三 解耦验收口径三条（本模块测试逐条钉死，test/sources.test.ts）：
 *       ① 新增自定义源（示例=watch-file 监听文件变化）注册即生效，零改 engine/ingest；
 *       ② 同一意图（同 dedupKey）投 100 次，主循环只唤起一次（复用 engine ingest 幂等面）；
 *       ③ 关掉（unregister）任一源，其他源与主循环零影响。
 *   - docs/25-§3.4 端口（invoke.ts v1.3）：InvokeSource { name, start(emit), stop() }；
 *     幂等键=(source, kind, company, ticket ?? dedupKey)——无单意图必带 dedupKey。
 *   - docs/25-§3.4.5 IM 泳道首刀裁决：**emit 抛错=源自身缺陷——源必须捕获记录、不得中断
 *     轮询**（实现契约）。注册表侧同形兜底：emit 包装器吞错+计数+继续（源侧契约的第一道、
 *     注册表侧兜底为第二道；engine.ingest 是纯入队，正常路径不抛——兜底面给自定义收集器）。
 *   - docs/22-§二 内置源表：定时查单（scheduler）/ Matrix @唤醒（mention）/ 事件（webhook）。
 *     本刀接入 scheduler（包装现有 onDue）+ matrix（注入式工厂，daemon 不强依赖
 *     @studio-next/matrix）+ watch-file（22-§三.1 的验收靶子示例源）。
 *
 * 语义说明（本文件口径，测试逐条钉死）：
 *   - **单源崩溃隔离**：一个源的 start/stop/emit 异常只计数（stats.sourceErrors +
 *     lastSourceError 记源名与相位），不炸 startAll/stopAll 循环、不拖死其他源。源**轮询期**
 *     的自我隔离是源侧实现契约（scheduler/matrix/watch-file 各自的头注与 catch 面）——
 *     注册表管不到源内部定时器，只管注册表触达的三个相位（start/stop/emit）。
 *   - **startAll 幂等面**：已启动源跳过（源 start 不可重入——scheduler.start 重入明报）；
 *     注册后追加的源在下一次 startAll 补启动（源增删热更面，22-§一「新源=新注册项」）。
 *   - **stopAll 全停**：对所有已注册源逐个 stop（源 stop 端口语义幂等；未启动的停也无害），
 *     清空启动集——停机收口一个不漏。
 *   - **scheduler 源包装**：现有调度器（src/scheduler.ts）非 InvokeSource——本包装把
 *     onDue 回调产出的 scheduleIntent 转发到 emit。**sink 兜底出口**（构造期固定）：手动泵
 *     （scheduler.poll，测试/显式驱动面）不经 start(emit)，意图走 sink——serve 侧 sink 与
 *     注册表 emit 同指 engine.ingest（同一队列，无双写面）；start 后由注册表注入的 emit 接管。
 *   - **watch-file 基线纪律**：启动时已有内容只建基线不产意图（历史不当唤起——与 matrix 源
 *     首拉建基线同语义）；监听面=该文件的**变化**（文件须先存在，缺文件 CONFIG_INVALID 明报
 *     不猜——「监听目录等文件出现」归进化管线按需扩展）。
 *   - **watch-file 去抖与行级隔离**：一次写入可能触发多个 fs.watch 事件——mtime 未前进不产
 *     （去抖）；文件按 JSON 行解析，坏行跳过+计数（parseErrors），好行照常产（行级隔离，
 *     一行坏不炸一批）。dedupKey=`${mtimeMs}#${行号}`——同一写幂等、新写重投（at-least-once
 *     源面；重复消费去重归引擎幂等键，22-§三.2）。
 *   - **watch-file 启动盲窗补检**：fs.watch（macOS FSEvents）挂载期内变化丢事件（实测
 *     复现）——挂上后 graceMs（缺省 250ms）再按手动泵路径补检一次，mtime 去抖使补检幂等。
 *   - **company 恒为配置注入**：行内 company 字段不收——一源一公司（25-§3.4 裁决 2
 *     「一频道一公司」同精神：跨公司内容不产意图，源身份结构性绑定）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - registry 无 manifest 必填：register 允许裸源（manifest 可选）。进化管线（可配可灰度）
 *     落地时再决定 manifest 是否升必填——本刀只校验「给了则 name 必须与源一致」。
 *   - watch-file 的 kind 白名单：行内可声明任一 kind（缺省 'webhook'；v1.4 起 7 kind——
 *     docs/35-§3 增 'escalate'）。是否应收窄为
 *     webhook 专属（防文件内容伪造 schedule 意图）待批示——本刀按「示例源从宽、引擎侧
 *     kind 消费门（v0.8 六源全通刀）兜底」处理。
 */
import { readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import type { CompanySlug, InvokeIntent, InvokeSource, SourceManifest, TicketId } from '@studio-next/contract'
import { createScheduler, scheduleIntent, type Scheduler, type SchedulerDeps } from './scheduler.ts'

// ————————————————————————— 源名与 manifest（22-§二 内置源表） —————————————————————————

/** scheduler 源名（scheduleIntent 的 source 字段同名——幂等键第一槽） */
export const SCHEDULER_SOURCE_NAME = 'scheduler'

/** file-watch 示例源名（22-§三.1 验收靶子） */
export const FILE_WATCH_SOURCE_NAME = 'watch-file'

/** scheduler 源 manifest（源的增删走进化管线——configSchema 记 daemon 侧配置面锚点） */
export const SCHEDULER_SOURCE_MANIFEST: SourceManifest = {
  name: SCHEDULER_SOURCE_NAME,
  kind: 'schedule',
  configSchema: 'daemon.yaml jobs/jobPollMs（扁平子集）',
}

/** watch-file 源 manifest（同上） */
export const FILE_WATCH_MANIFEST: SourceManifest = {
  name: FILE_WATCH_SOURCE_NAME,
  kind: 'webhook',
  configSchema: 'daemon.yaml fileWatch/fileWatchPath（扁平子集）',
}

// ————————————————————————— 注册表 —————————————————————————

/** 注册表运行面计数（观测/测试断言——单源崩溃隔离的计数面） */
export interface SourceRegistryStats {
  /** 当前已注册源数 */
  registered: number
  /** 当前已启动源数 */
  started: number
  /** start/stop/emit 三相位异常累计（捕获+计数+继续——一个源的异常不拖死其他源） */
  sourceErrors: number
  /** 最近一次源异常（源名+相位+消息） */
  lastSourceError?: { source: string; phase: 'start' | 'stop' | 'emit'; message: string }
}

/** 注册表条目（list() 返回快照；manifest 注册期可选携带） */
export interface SourceRegistryEntry {
  source: InvokeSource
  manifest?: SourceManifest
}

/** 源注册表句柄（22-§一 Source Registry） */
export interface SourceRegistry {
  /** 登记源（重名/空名/manifest 名不一致 → CONFIG_INVALID 拒收）；已启动栈上追加源归下一次 startAll 补启动 */
  register(source: InvokeSource, manifest?: SourceManifest): void
  /** 除名（运行中的先停再除名）；未知名返 false 不炸 */
  unregister(name: string): boolean
  /** 已注册源快照（注册序） */
  list(): readonly SourceRegistryEntry[]
  /** 启动所有未启动源：emit 统一进调用方收集器（serve 侧=engine.ingest 队列） */
  startAll(emit: (intent: InvokeIntent) => void): void
  /** 停所有已注册源（幂等；一个源 stop 异常不拖其他源） */
  stopAll(): void
  readonly stats: SourceRegistryStats
}

/** 注册表依赖（日志面缺省静默；serve 接 console.log） */
export interface SourceRegistryDeps {
  log?: (line: string) => void
}

/**
 * createSourceRegistry —— 源注册表本体。
 * 注册表只是「源的名单 + 生命周期壳」：不解析意图、不碰引擎——emit 由调用方注入
 * （serve 侧统一进 engine.ingest，决策归主循环，22-§一「源零直驱」的结构性保证）。
 */
export function createSourceRegistry(deps?: SourceRegistryDeps): SourceRegistry {
  const log = deps?.log ?? ((): void => undefined)
  const entries = new Map<string, SourceRegistryEntry>()
  const started = new Set<string>()
  const counters = { sourceErrors: 0 }
  let lastSourceError: SourceRegistryStats['lastSourceError']

  function noteError(source: string, phase: 'start' | 'stop' | 'emit', err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    counters.sourceErrors += 1
    lastSourceError = { source, phase, message }
    log(`[sources] 源 ${source} ${phase} 异常（隔离：捕获+计数+继续，不拖其他源）：${message}`)
  }

  function register(source: InvokeSource, manifest?: SourceManifest): void {
    if (typeof source.name !== 'string' || source.name === '') {
      throw new Error('CONFIG_INVALID：唤起源 name 必须非空字符串（22-§一 InvokeSource）')
    }
    if (manifest !== undefined && manifest.name !== source.name) {
      throw new Error(
        `CONFIG_INVALID：manifest.name '${manifest.name}' 与源名 '${source.name}' 不一致（注册表按源名寻址）`,
      )
    }
    if (entries.has(source.name)) {
      throw new Error(
        `CONFIG_INVALID：唤起源重名 '${source.name}'（已注册——源增删先 unregister 再注册，22-§一 走进化管线）`,
      )
    }
    entries.set(source.name, { source, ...(manifest !== undefined ? { manifest } : {}) })
    log(`[sources] 源 ${source.name} 已注册${manifest !== undefined ? `（kind=${manifest.kind}）` : ''}`)
  }

  function unregister(name: string): boolean {
    const entry = entries.get(name)
    if (entry === undefined) return false
    if (started.has(name)) {
      try {
        entry.source.stop()
      } catch (err) {
        noteError(name, 'stop', err)
      }
    }
    entries.delete(name)
    started.delete(name)
    log(`[sources] 源 ${name} 已注销`)
    return true
  }

  function list(): readonly SourceRegistryEntry[] {
    return [...entries.values()].map((e) => ({ source: e.source, ...(e.manifest !== undefined ? { manifest: e.manifest } : {}) }))
  }

  function startAll(emit: (intent: InvokeIntent) => void): void {
    for (const entry of [...entries.values()]) {
      const name = entry.source.name
      if (started.has(name)) continue // 已启动源跳过（源 start 不可重入——端口语义）
      // 每源独立 emit 包装器：emit 异常记到具体源头上（25-§3.4.5 注册表侧兜底——
      // 源侧契约是第一道：源必须自己捕获不中断轮询；此处兜底防自定义收集器炸源）
      const safeEmit = (intent: InvokeIntent): void => {
        try {
          emit(intent)
        } catch (err) {
          noteError(name, 'emit', err)
        }
      }
      try {
        entry.source.start(safeEmit)
        started.add(name)
        log(`[sources] 源 ${name} 已启动`)
      } catch (err) {
        noteError(name, 'start', err)
      }
    }
  }

  function stopAll(): void {
    for (const entry of [...entries.values()]) {
      const name = entry.source.name
      try {
        entry.source.stop()
      } catch (err) {
        noteError(name, 'stop', err)
      }
    }
    started.clear()
    log(`[sources] 源已全停（${entries.size} 个注册源）`)
  }

  return {
    register,
    unregister,
    list,
    startAll,
    stopAll,
    get stats(): SourceRegistryStats {
      return {
        registered: entries.size,
        started: started.size,
        sourceErrors: counters.sourceErrors,
        ...(lastSourceError !== undefined ? { lastSourceError } : {}),
      }
    },
  }
}

// ————————————————————————— scheduler 源（包装现有 onDue，零改调度器） —————————————————————————

/** scheduler 源依赖：调度器依赖（onDue 除外）+ 意图出口 */
export interface SchedulerSourceDeps extends Omit<SchedulerDeps, 'onDue'> {
  /**
   * 意图兜底出口（构造期固定）：手动泵（scheduler.poll——测试/显式驱动面）不经 start(emit)，
   * onDue 产出的意图走此出口。serve 侧 sink 与注册表 emit 同指 engine.ingest（同一队列）；
   * start 后由注册表注入的 emit 接管，stop 后回落 sink。
   */
  sink: (intent: InvokeIntent) => void
}

/** scheduler 源句柄：InvokeSource 端口 + 底层调度器（手动泵/观测面，serve 测试同用） */
export interface SchedulerSource extends InvokeSource {
  readonly scheduler: Scheduler
}

/**
 * createSchedulerSource —— 把现有调度器包成 InvokeSource（name='scheduler'）。
 * 零改 src/scheduler.ts：onDue 产 scheduleIntent（dedupKey=job_id@firedAt，invoke v1.3）
 * 转发到 emit（start 后）或 sink（手动泵/停机后）——只产意图不直接干活（22-§一）。
 */
export function createSchedulerSource(deps: SchedulerSourceDeps): SchedulerSource {
  const { sink, ...rest } = deps
  const log = rest.log ?? ((): void => undefined)
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  const scheduler = createScheduler({
    ...rest,
    onDue: (job, firedAt) => {
      const intent = scheduleIntent(job, firedAt)
      const target = liveEmit ?? sink
      target(intent)
      log(`[scheduler] job ${job.job_id} 到点（firedAt=${new Date(firedAt).toISOString()}）→ schedule 意图入队`)
    },
  })
  return {
    name: SCHEDULER_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      liveEmit = emit // 先接出口再起调度器：立即 due 的岗不丢
      scheduler.start()
    },
    stop(): void {
      scheduler.stop()
      liveEmit = undefined
    },
    get scheduler(): Scheduler {
      return scheduler
    },
  }
}

// ————————————————————————— watch-file 示例源（22-§三.1 验收靶子） —————————————————————————

/** watch-file 行意图（JSON 行可声明字段；company 恒为配置注入——行内不收） */
export interface FileWatchIntentLine {
  kind?: InvokeIntent['kind']
  ticket?: TicketId
  payload?: unknown
  priority?: number
}

/** watch-file 源运行面计数（观测/测试断言） */
export interface FileWatchSourceStats {
  /** 已产意图数 */
  emitted: number
  /** 坏行数（非 JSON/非对象/字段非法——跳过+计数，行级隔离） */
  parseErrors: number
  /** 文件系统面异常数（stat/read/watch 失败——不炸源，如实计数） */
  watchErrors: number
}

/** watch-file 源依赖 */
export interface FileWatchSourceOptions {
  /** 一源一公司：产出的意图 company 恒为此值（行内 company 不收——25-§3.4 裁决 2 同精神） */
  company: CompanySlug
  /** 监听文件路径（须先存在——监听的是变化不是出现；CONFIG_INVALID 明报） */
  file: string
  /**
   * 启动盲窗补检延迟 ms（缺省 250）：fs.watch（macOS FSEvents）挂载期内文件变化会丢事件
   * ——挂上后 graceMs 再按手动泵路径补检一次（mtime 去抖使补检天然幂等；实测复现见
   * test/sources.test.ts「真 fs.watch 事件路径」用例头注）。
   */
  graceMs?: number
  /** 日志面（缺省静默） */
  log?: (line: string) => void
}

/** watch-file 源句柄：InvokeSource 端口 + 手动泵（check）+ 计数 */
export interface FileWatchSource extends InvokeSource {
  /**
   * 手动泵（测试/显式驱动）：与 fs.watch 事件同路径（stat→mtime 前进→读→行解析→emit），
   * 返回本泵产意图数。仅运行中有意义（未 start/已 stop 返 0）。
   */
  check(emit: (intent: InvokeIntent) => void): number
  readonly stats: FileWatchSourceStats
}

/** kind 白名单（InvokeIntent['kind'] 全集——v1.4 增 'escalate'，docs/35-§3 首刀；行内声明缺省 webhook） */
const INTENT_KINDS: ReadonlySet<string> = new Set(['ticket', 'mention', 'schedule', 'relay', 'resume', 'webhook', 'escalate'])

/**
 * createFileWatchSource —— 监听文件变化产意图的示例源（22-§三.1 的验收靶子）。
 * 注册即生效、零改主循环：start(emit) 挂 fs.watch；文件每前进一步 mtime，内容按 JSON 行
 * 各产一条意图（dedupKey=`${mtimeMs}#${行号}`）。坏行/文件系统异常计数不炸（行级+源级隔离）。
 */
export function createFileWatchSource(options: FileWatchSourceOptions): FileWatchSource {
  const log = options.log ?? ((): void => undefined)
  const graceMs = options.graceMs ?? 250
  const stats: FileWatchSourceStats = { emitted: 0, parseErrors: 0, watchErrors: 0 }
  let running = false
  let baselineMtime: number | undefined
  let watcher: FSWatcher | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined

  function closeWatcher(): void {
    if (watcher !== undefined) {
      watcher.close()
      watcher = undefined
    }
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer)
      graceTimer = undefined
    }
  }

  /** stat+读+行解析+emit（fs.watch 事件与 check() 同一执行体）；返回产意图数 */
  function pump(emit: (intent: InvokeIntent) => void): number {
    if (!running) return 0
    let mtime: number
    try {
      mtime = statSync(options.file).mtimeMs
    } catch (err) {
      stats.watchErrors += 1
      log(`[watch-file] 文件不可读：${err instanceof Error ? err.message : String(err)}（本泵跳过，不炸源）`)
      return 0
    }
    if (mtime === baselineMtime) return 0 // 去抖：一次写入多个事件只产一批
    baselineMtime = mtime
    let text: string
    try {
      text = readFileSync(options.file, 'utf8')
    } catch (err) {
      stats.watchErrors += 1
      log(`[watch-file] 内容读取失败：${err instanceof Error ? err.message : String(err)}（不炸源）`)
      return 0
    }
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
    let produced = 0
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i] as string
      let parsed: FileWatchIntentLine
      try {
        const v: unknown = JSON.parse(raw)
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          throw new Error('非对象行（须为 JSON 对象）')
        }
        const candidate = v as FileWatchIntentLine
        if (candidate.kind !== undefined && !INTENT_KINDS.has(candidate.kind)) {
          throw new Error(`kind '${String(candidate.kind)}' 不在六源枚举`)
        }
        if (candidate.ticket !== undefined && typeof candidate.ticket !== 'string') {
          throw new Error('ticket 须为字符串')
        }
        if (candidate.priority !== undefined && typeof candidate.priority !== 'number') {
          throw new Error('priority 须为数值')
        }
        parsed = candidate
      } catch (err) {
        stats.parseErrors += 1
        log(`[watch-file] 第 ${i + 1} 行不是合法意图行（${err instanceof Error ? err.message : String(err)}）——跳过（行级隔离）`)
        continue
      }
      emit({
        kind: parsed.kind ?? 'webhook',
        company: options.company,
        source: FILE_WATCH_SOURCE_NAME,
        dedupKey: `${mtime}#${i}`,
        ...(parsed.ticket !== undefined ? { ticket: parsed.ticket } : {}),
        ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      })
      stats.emitted += 1
      produced += 1
    }
    if (produced > 0) log(`[watch-file] 文件变化（mtime=${mtime}）→ ${produced} 条意图`)
    return produced
  }

  return {
    name: FILE_WATCH_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      if (running) return
      let baseline: number
      try {
        baseline = statSync(options.file).mtimeMs
      } catch {
        // 文件须先存在：明报不猜（监听面=变化，非出现——目录级出现监听归进化管线）
        throw new Error(
          `CONFIG_INVALID：watch-file 监听文件不存在：${options.file}（先建文件再启动源；历史内容只建基线不唤起）`,
        )
      }
      running = true
      baselineMtime = baseline // 基线：启动时已有内容不当唤起（对齐 matrix 首拉建基线）
      try {
        watcher = watch(options.file, { persistent: false }, (event) => {
          try {
            pump(emit)
          } catch (err) {
            stats.watchErrors += 1
            log(`[watch-file] 事件处理异常（${event}）：${err instanceof Error ? err.message : String(err)}（不炸源）`)
          }
        })
        watcher.on('error', (err: Error) => {
          stats.watchErrors += 1
          log(`[watch-file] 监听异常：${err.message}——退出监听（不炸进程；恢复=重启源）`)
          closeWatcher()
        })
        // 启动盲窗补检（one-shot）：挂载期内变化丢事件——graceMs 后补一泵（mtime 去抖幂等）
        graceTimer = setTimeout(() => {
          graceTimer = undefined
          try {
            pump(emit)
          } catch (err) {
            stats.watchErrors += 1
            log(`[watch-file] 盲窗补检异常：${err instanceof Error ? err.message : String(err)}（不炸源）`)
          }
        }, graceMs)
        graceTimer.unref()
        log(`[watch-file] 监听已挂：${options.file}（基线 mtime=${baseline}，盲窗补检 ${graceMs}ms）`)
      } catch (err) {
        stats.watchErrors += 1
        log(`[watch-file] 监听挂载失败：${err instanceof Error ? err.message : String(err)}（源标记运行但无事件面——check 手动泵仍可用）`)
      }
    },
    stop(): void {
      running = false
      closeWatcher()
    },
    check(emit: (intent: InvokeIntent) => void): number {
      return pump(emit)
    },
    get stats(): FileWatchSourceStats {
      return { ...stats }
    },
  }
}
