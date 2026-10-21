/**
 * overview reload —— :8789 公司目录热重载（DEV-12 执行刀二；IO 层）
 *
 * 依据：docs/04-§七（概览路由按公司目录 slug——公司 git 目录是组织事实源）、
 * docs/17-§1/§3（公司目录=组织事实源；SQLite 台账=可重建投影）与 bin.ts v0.7 首刀的
 * 已知缺口「快照挂载时装载并缓存（目录变更=重新挂载；热更归后续刀）」——本刀补上：
 *
 *   两条热重载能力（任务书 DEV-12 口径「快照时间标注或目录监听」，两条都落）：
 *   1. 快照时间标注：每次装载记录 at（epoch ms）与 version（装载代数），经
 *      OverviewCompanySource.snapshotInfo 注入 server，随 /api/overview/* JSON 读面
 *      透出（snapshotMeta 字段）——数据新鲜度页面可见，不凭感觉。
 *   2. 目录监听：fs.watch(recursive) 公司目录 → 防抖重载——目录变更（人事档案/组织
 *      配置等）在下一个轮询周期即可见，无需重启进程、无需手动重挂载。
 *
 *   诚实降级纪律（docs/20 证据断言/不臆造）：
 *   - 重载失败（目录被改成校验不过/IO 错误）：**保旧图**——继续服务最后一次有效快照，
 *     lastError 如实记录（页面亮出），不静默、不崩面、不臆造空数据；
 *   - fs.watch 不可用（平台不支持/目录被移走）：watching=false，退化为挂载时快照
 *     （即 v0.7 首刀行为），快照时间标注仍在。
 *
 * 分层：本文件是 overview 的 IO 层（与 server.ts 监听壳同级）；纯投影归 api.ts/views.ts。
 * 注入式 reload（() => OverviewCompanySource）——bin.ts 侧闭包装载链
 * （readDirectoryFiles → loadCompanyDirectory → 派生 mission/档案映射），测试可注入假装载。
 * 类型经 type-only import 自 server.ts（运行时零循环：server 不反向 import 本文件）。
 */
import { watch, type FSWatcher } from 'node:fs'
import type { OverviewCompanySource } from './server.ts'

/** 快照装载信息（快照时间标注的数据形状；server 侧原样透出到 JSON 读面） */
export interface SnapshotInfo {
  /** 本快照装载完成时刻（epoch ms） */
  at: number
  /** 装载代数：首次挂载=1，此后每次成功热重载 +1（消费方可判「数据换了没」） */
  version: number
  /** 目录监听是否在工作（false=平台不支持或启动失败，退化为挂载时快照） */
  watching: boolean
  /** 最近一次热重载失败原因（null=无失败；有值时页面如实亮出，快照仍为最后一次有效装载） */
  lastError: string | null
}

/** 热源：数据源 + snapshotInfo（server 侧 JSON 读面透出用） */
export type HotOverviewCompanySource = OverviewCompanySource & { snapshotInfo: () => SnapshotInfo }

/** mountHotCompanySource 选项 */
export interface HotCompanySourceOptions {
  /** 公司目录绝对路径（监听对象；整个目录树 recursive） */
  directory: string
  /**
   * 初装结果（必填，由调用方完成——bin.ts 先自行装载以保「校验不过拒挂载」UX：
   * 初装失败属启动错误，不走保旧图路径）。
   */
  initial: OverviewCompanySource
  /**
   * 重装载载链：读目录 + 校验 + 派生 OverviewCompanySource（可 async）。
   * 抛错/拒绝=本次重载失败（保旧图 + 记 lastError）。
   */
  reload: () => OverviewCompanySource | Promise<OverviewCompanySource>
  /** 监听事件防抖窗（ms；缺省 150——编辑器多次写事件合并成一次重载） */
  debounceMs?: number
  /** 是否开目录监听（缺省 true；false=只用快照时间标注，不监听——测试/特殊环境用） */
  watchEnabled?: boolean
}

/** mountHotCompanySource 返回句柄 */
export interface HotCompanyHandle {
  /** 热源（各字段活取最后一次有效装载；snapshotInfo=快照时间标注） */
  source: HotOverviewCompanySource
  /** 快照装载信息（与 source.snapshotInfo 同源） */
  info(): SnapshotInfo
  /** 关停监听（进程收尾用；snapshotProvider 仍可用，只是不再热更） */
  close(): void
}

/**
 * 挂一家「热」公司源：初装（initial——调用方已完成，含校验不过即拒启的 UX）→
 * fs.watch 目录（recursive）→ 防抖重载（成功=换图+version+1；失败=保旧图+记 lastError；
 * reload 可 async——异步装载在防抖窗后触发）。
 *
 * 活引用纪律：source 的可选字段（mission/readPersonFile/openLedger）用 getter 活取
 * current——热重载换图后引用不变、内容随取随新（spread 拷贝会冻结值，勿改成 spread）。
 */
export function mountHotCompanySource(opts: HotCompanySourceOptions): HotCompanyHandle {
  if (opts.initial === undefined || opts.initial === null) {
    // 类型契约的运行时兜底：初装必填（初装失败属启动错误，不走保旧图路径）
    throw new Error('mountHotCompanySource: initial 必填——初装由调用方完成（含「校验不过拒挂载」的启动 UX）')
  }
  const debounceMs = opts.debounceMs ?? 150
  let current: OverviewCompanySource = opts.initial
  let at = Date.now()
  let version = 1
  let lastError: string | null = null
  let closed = false
  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  if (opts.watchEnabled !== false) {
    try {
      watcher = watch(
        opts.directory,
        { recursive: true },
        () => {
          if (closed) return
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            // 同步 throw 不能逃出定时器回调（否则进程级 uncaught——reload 既允许 sync 也允许
            // async，sync 抛错在此转为拒绝，统一走保旧图+记错路径）
            let pending: Promise<OverviewCompanySource>
            try {
              pending = Promise.resolve(opts.reload())
            } catch (err) {
              pending = Promise.reject(err)
            }
            void pending.then(
              (next) => {
                if (closed) return
                current = next
                version += 1
                at = Date.now()
                lastError = null
              },
              (err: unknown) => {
                // 保旧图：目录当前状态校验不过/读不了——如实记录，继续服务最后一次有效快照
                if (closed) return
                lastError = err instanceof Error ? err.message : String(err)
              },
            )
          }, debounceMs)
        },
      )
      watcher.on('error', () => {
        // 监听器本身坏掉（目录被移走等）：如实降级为挂载时快照，不崩面
        watcher = null
      })
    } catch {
      watcher = null // 平台不支持 recursive 等——退化为挂载时快照（watching=false）
    }
  }

  const source: HotOverviewCompanySource = {
    get slug() {
      return current.slug
    },
    snapshotProvider: () => current.snapshotProvider(),
    get mission() {
      return current.mission
    },
    get readPersonFile() {
      return current.readPersonFile
    },
    get openLedger() {
      return current.openLedger
    },
    snapshotInfo: () => ({ at, version, watching: watcher !== null, lastError }),
  }

  return {
    source,
    info: () => ({ at, version, watching: watcher !== null, lastError }),
    close: () => {
      closed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      watcher?.close()
      watcher = null
    },
  }
}
