/**
 * people-change 源 —— 人事变动唤起源（129-§6.1① 分类学首类 / §6.3 P0-A，studio-dev-178 单C）。
 *
 * 规格依据：
 *   - 129 提案 §6.1 分类学①数据变更类：挂 DEV-48 peopleDiff 出口**双写意图**
 *     （kind='data-change'，payload={classifier, person, prev/next, linked_ticket}）——
 *     挂既有分类器**之后**双写，零重复分类（diff 只跑一次，变更清单经 enqueueHrBatch
 *     产物 changes 回传，本源不重算 diffPeople）。
 *   - §6.1 铁律2 幂等双层：源面 at-least-once（变更指纹 `person+classifier+prev→next`
 *     同指纹重投只消费一次——引擎面恰好一次由 129-A 落定：dedupKey 断言+patrolKeys
 *     append-only）；指纹公式=dataChangeFingerprint 单一实现同引（源侧契约与引擎断言
 *     面同一函数，零漂移——129-A 的「源侧设置」本源字面落位）。
 *   - §6.1 铁律3 注册三件套：manifest 声明（本文件）+ daemon.yaml 开关
 *     （hrPeopleWatch: true——hr* 配置面 config.ts）+ 进化管线增删（后续批）。
 *     **新 hook 永不改主循环**（22-§一 不变量）：本文件零 engine.ts 触达，注册归
 *     装配面 wirePeopleChangeSource（serve.ts 一处调用）。
 *   - docs/22-§一 源是插件：只产意图进 engine.ingest，无任何源能直接驱动 worker。
 *     docs/52-§5.2/§9.1（数据面）→ 本源（意图面）：人事同步链的三面任务照旧，
 *     意图面唤起对账联动单（P0-A 验收样板：新人入司→对账岗收件箱自动出现对账单，
 *     零手工派单）。
 *
 * 推送面模型（scheduler 源 `liveEmit ?? sink` 先例）：people-change 无自有轮询——
 * 变更由 hr-sync apply 段推入（publish）。start 前手动面（测试/直接调 hrApplySegment）
 * 走构造期 sink 兜底，start 后由注册表注入的 emit 接管——同一队列无双写面。
 */
import type { CompanySlug, InvokeIntent, InvokeSource, SourceManifest } from '@studio-next/contract'
import type { PeopleChange } from '@studio-next/core'
import type { SourceRegistry } from '../sources.ts'
import { dataChangeFingerprint } from '../intents/taxonomy.ts'

/** people-change 源名（InvokeIntent.source 字段同名——幂等键第一槽） */
export const PEOPLE_CHANGE_SOURCE_NAME = 'people-change'

/** people-change 源 manifest（22-§二 内置源表；configSchema 记 daemon 侧配置面锚点） */
export const PEOPLE_CHANGE_SOURCE_MANIFEST: SourceManifest = {
  name: PEOPLE_CHANGE_SOURCE_NAME,
  kind: 'data-change',
  configSchema: 'daemon.yaml hrSync+hrPeopleWatch（hr* 扁平子集——config.ts）',
}

/** 源依赖（company 恒为配置注入——一源一公司，scheduler/watch-file 同款纪律） */
export interface PeopleChangeSourceDeps {
  company: CompanySlug
  /** 构造期兜底出口（start 前手动面；serve 侧与注册表 emit 同指 engine.ingest） */
  sink: (intent: InvokeIntent) => void
  log?: (line: string) => void
}

/** people-change 源（InvokeSource + publish 推送面） */
export interface PeopleChangeSource extends InvokeSource {
  /**
   * 变更双写面（hr-sync apply 段调用）：每条 PeopleChange → 一个 data-change 意图。
   * linked_ticket=batchId（hr 批次号=对账锚溯源——129-A payload 契约「peopleDiff
   * 溯源的镜像单/对账锚」槽位）。返回产出数（观测面：apply 段 log）。
   */
  publish(changes: readonly PeopleChange[], batchId: string): number
  /** 观测面计数（零行为分支，纯计数） */
  readonly stats: PeopleChangeSourceStats
}

/** 源运行面计数（观测/测试断言——零行为分支，纯计数） */
export interface PeopleChangeSourceStats {
  /** 已产意图数 */
  emitted: number
}

/**
 * createPeopleChangeSource —— 源本体：纯推送面（无定时器/无 IO），变更入→意图出。
 * payload 七字段全填（class/classifier/person/field/prev/next/linked_ticket）；
 * priority=1（mention 同档常规优先级——对账联动单非紧急插队面）。
 */
export function createPeopleChangeSource(deps: PeopleChangeSourceDeps): PeopleChangeSource {
  const log = deps.log ?? ((): void => undefined)
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  let emitted = 0
  return {
    name: PEOPLE_CHANGE_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      liveEmit = emit
    },
    stop(): void {
      liveEmit = undefined
    },
    publish(changes: readonly PeopleChange[], batchId: string): number {
      const target = liveEmit ?? deps.sink
      for (const change of changes) {
        const intent: InvokeIntent = {
          kind: 'data-change',
          company: deps.company,
          source: PEOPLE_CHANGE_SOURCE_NAME,
          dedupKey: dataChangeFingerprint({ person: change.personId, classifier: change.kind, prev: change.prev, next: change.next }),
          priority: 1,
          payload: {
            class: 'people-change',
            classifier: change.kind,
            person: change.personId,
            field: change.field,
            prev: change.prev,
            next: change.next,
            linked_ticket: batchId,
          },
        }
        target(intent)
        emitted += 1
        log(`[people-change] ${change.kind} ${change.personId}（${change.prev ?? '∅'}→${change.next ?? '∅'}）→ data-change 意图入队（批次 ${batchId}）`)
      }
      return changes.length
    },
    get stats(): PeopleChangeSourceStats {
      return { emitted }
    },
  }
}

/**
 * wirePeopleChangeSource —— 装配面注册件（serve.ts 唯一调用点；hrPeopleWatch: true 时）。
 * 注册+返回 publish 闭包（hr-sync apply 段注入）——「新源=新注册项」的一行接线。
 */
export function wirePeopleChangeSource(
  sources: SourceRegistry,
  deps: PeopleChangeSourceDeps,
): (changes: readonly PeopleChange[], batchId: string) => number {
  const source = createPeopleChangeSource(deps)
  sources.register(source, PEOPLE_CHANGE_SOURCE_MANIFEST)
  return (changes: readonly PeopleChange[], batchId: string): number => source.publish(changes, batchId)
}
