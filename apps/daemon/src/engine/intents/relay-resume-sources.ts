/**
 * relay/resume 源 —— 接力/续命两唤起源（129-§6.1⑥ 分类学收口类 / §6.4 C6 / §6.5 单E，
 * studio-dev-184；消费语义见 ./relay-resume.ts——people-change 先例同分工：源只产意图）。
 *
 * 规格依据（源侧）：
 *   - docs/22-§二 接力行（F1-11）：「worker 完成 →『请重估单 X』幂等提示（本机+wkey+防抖）
 *     ——轮询粒度降到秒级」。产面=**收割完成钩**（EngineDeps.onWorkComplete——engine 相位 4
 *     收口回调，GATE_PASS/GATE_FAIL 两面都报：「worker 完成」含失败完成，回滚后重派/证据链
 *     推进都是合法重估对象）。引擎只报事实不识源（hrSync digester 注入先例——行为缝不占
 *     主循环结构）；serve 侧闭包转发到本源 publish（engine 创建在前、源注册在后——后绑定）。
 *   - docs/22-§二 续命行（F1-15）：「resume-cmd/resume 续跑协议」。v0 生产调用面=测试与
 *     后续 CLI `studio resume`（50a-B4 归档在册——**源先在册、意图链全通**，命令面另批）。
 *   - §6.1 铁律3 注册三件套：manifest（本文件）+ daemon.yaml 开关（relay / resume——
 *     serve.ts config switch）+ 进化管线增删（后续批）。**新源不改主循环一行**（22-§一
 *     不变量；22-§三 解耦验收①「监听某文件变化的自定义源不改主循环即可注册生效」）。
 *   - docs/22-§一：只产意图进 engine.ingest，无任何源能直接驱动 worker——重估/续跑的
 *     「该不该干」全归状态机 decide（消费件 relay-resume.ts 头注同款声明）。
 *
 * 防抖口径（F1-11「防抖」的实现语义，随实现收口）：**誓作用域**去重——`(ticket, attempt)`
 * 对首次发、此后静默：同一誓的完成信号（钩重放/重入）只发一次；**跨誓恒发**（新 dispatch 的
 *     完成是新事实——GATE_FAIL→relay→重派→再 FAIL 的快循环不被任意时间窗误杀；时间窗常量
 *     的拟稿风险从根上消掉）。零时间态、零定时器；内存态可弃（源重启丢防抖面=多发重复意图，
 *     被引擎幂等面吞——方向安全，21-§三 fail-safe 取向）。
 *
 * wkey/本机边界（F1-11「本机+wkey」的实现落位）：钩子是 engine 进程内调用（非对外端点）
 *     ——「本机」信任边界结构性成立；relay 意图无 payload 派工位，伪造面=negative（外部
 *     输入进不来这条链，进来的意图缺 ticket/payload 畸形都被消费面明报拒收）。
 */
import type { CompanySlug, InvokeIntent, InvokeSource, SourceManifest, TicketId } from '@studio-next/contract'
import type { SourceRegistry } from '../sources.ts'

/** relay 源名（InvokeIntent.source 字段同名——幂等键第一槽，core intentKeyOf） */
export const RELAY_SOURCE_NAME = 'relay'

/** relay 源 manifest（22-§二 内置源表；configSchema 记 daemon 侧配置面锚点） */
export const RELAY_SOURCE_MANIFEST: SourceManifest = {
  name: RELAY_SOURCE_NAME,
  kind: 'relay',
  configSchema: 'daemon.yaml relay（接力源开关，缺省 false）',
}

/** resume 源名（同上） */
export const RESUME_SOURCE_NAME = 'resume'

/** resume 源 manifest（22-§二 内置源表） */
export const RESUME_SOURCE_MANIFEST: SourceManifest = {
  name: RESUME_SOURCE_NAME,
  kind: 'resume',
  configSchema: 'daemon.yaml resume（续命源开关，缺省 false）',
}

/**
 * 收割完成信号（engine onWorkComplete 钩载荷——engine 相位 4 收口发，本源消费转意图）。
 * outcome：completed=GATE_PASS（四要件齐）/ failed=GATE_FAIL（含收割失败回滚面）——
 * 两面都是「worker 完成」，都是合法重估对象（文件头注）。
 */
export interface RelayWorkSignal {
  ticket: TicketId
  attempt: number
  outcome: 'completed' | 'failed'
  personId: string
}

/** 源依赖（company 恒为配置注入——一源一公司，scheduler/watch-file/people-change 同款纪律） */
export interface RelayResumeSourceDeps {
  company: CompanySlug
  /** 构造期兜底出口（start 前手动面；serve 侧与注册表 emit 同指 engine.ingest——无双写面） */
  sink: (intent: InvokeIntent) => void
  log?: (line: string) => void
}

/** relay 源（InvokeSource + publish 推送面——收割钩的目标出口） */
export interface RelaySource extends InvokeSource {
  /**
   * 完成信号转发面（serve 侧 onWorkComplete 闭包调用）：誓作用域防抖（头注）后产
   * relay 意图。返回 false=防抖吞掉（观测面区分：钩已发过 vs 本源首产）。
   */
  publish(signal: RelayWorkSignal): boolean
  /** 观测面计数（零行为分支，纯计数） */
  readonly stats: RelaySourceStats
}

/** 源运行面计数（观测/测试断言——零行为分支，纯计数） */
export interface RelaySourceStats {
  /** 已产意图数（防抖通过面） */
  emitted: number
  /** 防抖吞掉数（同誓重复完成信号） */
  debounced: number
}

/**
 * createRelaySource —— relay 源本体：纯推送面（无定时器/无 IO/无平台读），完成信号入 →
 * relay 意图出（priority=1 常规档——重估非插队面，四闸/队列照常定序）。
 */
export function createRelaySource(deps: RelayResumeSourceDeps): RelaySource {
  const log = deps.log ?? ((): void => undefined)
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  const fired = new Set<string>()
  let emitted = 0
  let debounced = 0
  return {
    name: RELAY_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      liveEmit = emit
    },
    stop(): void {
      liveEmit = undefined
    },
    publish(signal: RelayWorkSignal): boolean {
      // 誓作用域防抖（头注口径）：同一 (ticket, attempt) 的完成信号只发一次；跨誓恒发
      const scope = `${signal.ticket}#${signal.attempt}`
      if (fired.has(scope)) {
        debounced += 1
        return false
      }
      fired.add(scope)
      const intent: InvokeIntent = {
        kind: 'relay',
        company: deps.company,
        source: RELAY_SOURCE_NAME,
        ticket: signal.ticket,
        priority: 1,
        payload: {
          reason: `${signal.outcome === 'completed' ? 'GATE_PASS' : 'GATE_FAIL'}：第 ${signal.attempt} 誓完成（${signal.personId}）——请重估单 ${signal.ticket}`,
        },
      }
      ;(liveEmit ?? deps.sink)(intent)
      emitted += 1
      log(`[relay] ${scope} ${signal.outcome} → relay 意图入队（请重估单 ${signal.ticket}）`)
      return true
    },
    get stats(): RelaySourceStats {
      return { emitted, debounced }
    },
  }
}

/** resume 源（InvokeSource + publish 推送面——v0 产面=测试/后续 CLI resume 命令，B4 归档） */
export interface ResumeSource extends InvokeSource {
  /**
   * 续命触发面：ticket → resume 意图（断点解析在消费侧——work_records 单一事实源，
   * payload 不带 executor/session 覆盖位，relay-resume.ts 头注「伪造面负向封死」）。
   * cause=触发溯源（展示位，可缺省）。返回 false=输入被拒（观测面：空单号等畸形面）。
   */
  publish(ticket: TicketId, cause?: string): boolean
  /** 观测面计数（零行为分支，纯计数） */
  readonly stats: ResumeSourceStats
}

/** 源运行面计数（观测/测试断言——零行为分支，纯计数） */
export interface ResumeSourceStats {
  /** 已产意图数 */
  emitted: number
  /** 拒收数（畸形输入——ticket 空/cause 类型不符） */
  rejected: number
}

/**
 * createResumeSource —— resume 源本体：纯推送面。priority=1 常规档（同 relay：续跑对象
 * 的四闸/断路器照常过——「不派」的答案归状态机，22-§一）。
 */
export function createResumeSource(deps: RelayResumeSourceDeps): ResumeSource {
  const log = deps.log ?? ((): void => undefined)
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  let emitted = 0
  let rejected = 0
  return {
    name: RESUME_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      liveEmit = emit
    },
    stop(): void {
      liveEmit = undefined
    },
    publish(ticket: TicketId, cause?: string): boolean {
      if (ticket === '' || (cause !== undefined && cause === '')) {
        rejected += 1
        return false
      }
      const intent: InvokeIntent = {
        kind: 'resume',
        company: deps.company,
        source: RESUME_SOURCE_NAME,
        ticket,
        priority: 1,
        ...(cause !== undefined ? { payload: { cause } } : {}),
      }
      ;(liveEmit ?? deps.sink)(intent)
      emitted += 1
      log(`[resume] ${ticket} → resume 意图入队（断点续跑${cause === undefined ? '' : `：${cause}`}）`)
      return true
    },
    get stats(): ResumeSourceStats {
      return { emitted, rejected }
    },
  }
}

/**
 * wireRelaySource / wireResumeSource —— 装配面注册件（serve.ts 各一处调用；开关开时）。
 * 注册+返回 publish 闭包——「新源=新注册项」的一行接线（people-change 同款）。
 */
export function wireRelaySource(sources: SourceRegistry, deps: RelayResumeSourceDeps): (signal: RelayWorkSignal) => boolean {
  const source = createRelaySource(deps)
  sources.register(source, RELAY_SOURCE_MANIFEST)
  return (signal: RelayWorkSignal): boolean => source.publish(signal)
}

export function wireResumeSource(sources: SourceRegistry, deps: RelayResumeSourceDeps): (ticket: TicketId, cause?: string) => boolean {
  const source = createResumeSource(deps)
  sources.register(source, RESUME_SOURCE_MANIFEST)
  return (ticket: TicketId, cause?: string): boolean => source.publish(ticket, cause)
}
