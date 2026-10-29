/**
 * assembly/api/serve-face —— serve 侧 API 面供给与监听生命周期（同进程装配体）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（对外 API 装配＝runServe 同进程注入；读面同源 PORT-OBS 投影、写面唯一
 *     经 PORT-GATE；「API 进程零库零平台」；默认绑定环回）；
 *   - docs/v2/15 §4.4（SEC-SEC-04：API 响应＝第 5 出口，出站闸 wrapper 由装配面注入）×
 *     docs/plan/mig08-closeout.md §六 欠账①②（runServe→assembleApi/createApiApp 接线、
 *     readers/auth 供给——本件即该欠账的 serve 装配腿）；
 *   - docs/v2/16 §三 api 行（真实装配落 `apps/daemon/src/assembly/api/`）；
 *     `api→panel` 边永禁（本文件零 panel import）。
 *
 * 本件职责（把装配面拼起来，不改 serve 主循环语义）：
 *   ① **PORT-OBS 只读面**（`buildServeObsFace`）：时钟/标识可注入；`snapshot` 无投影库＝
 *      `Err(unsupported)`（不伪造投影），`health` 可用性取 `unverified`（未核验不等于可用）；
 *   ② **PORT-GATE gated 入口**（`buildFailClosedGate`）：意图保留/回执投影/通知出口三面
 *      未装配＝一律 `Err(unsupported)`（不伪造 queued 回执；「查不到」不以 Ok(undefined)
 *      冒充无行）。注入面保留 `gate` 槽：PORT-GATE 落位后由装配单元传入替换；
 *   ③ **readers/auth 供给**：readers＝公司快照投影（L1 热重载后取新快照），auth＝fail-closed
 *      认证器（partner/signed 未装配⇒拒；root 拒）；
 *   ④ **装配＋监听生命周期**：`assembleApi`（gated-only 不变）→ `start()`＝真监听
 *      （port/缺省 0；JSON 响应过 `guardResponse`＝第 5 出口 wrapper）＋启动行（实际端口/
 *      只读面/缺口）→ `close()`（runServe 停机收口先关 API）。
 *
 * 边界：本件不持 engine/ledger/平台句柄；ledger 只经注入的 `guardResponse`（出站闸失败
 * 落账）间接触达——与 log-egress 出口同纪律，API 代码本身零库零平台。
 */
import type {
  CallContext,
  CompanyRef,
  CompanySnapshot,
  DeliveryReceipt,
  ExternalIntent,
  GatePort,
  HealthReport,
  IntentKey,
  IntentReceipt,
  NotificationEnvelope,
  PortFailure,
  PortResult,
  Projection,
  ReadContext,
} from '@studio-next/contract'
import type { ApiReadSources } from '@studio-next/api'
import { makeUlid } from '../../engine/tools/id.ts'
import { assembleApi, type ApiAssembly } from './index.ts'
import { buildApiReaders, API_READ_FACE_GAPS, API_READ_FACE_GAP_REASONS, API_READ_FACE_SERVED } from './readers.ts'
import { buildApiIntakeAuth } from './auth.ts'
import { startApiServer, type ApiServerHandle } from './live.ts'
import type { ApiObservationReadFace } from './inject.ts'

/** 失败分类（Err 必答副作用可能/可否重试/对账入口/责任位置；v2/11 §0.4-6） */
function unsupported(subcause: string, detail: string, responsiblePosition: string): PortFailure {
  return {
    category: 'unsupported',
    subcause,
    detail,
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: '入口/投影面未装配：确定未产生外部效果（无写路径产生，无需对账）' },
    responsiblePosition,
  }
}

/** PORT-OBS 只读面装配入参（时钟注入＝确定性；唯一进程依赖是 ULID 随机源） */
export interface ServeObsFaceArgs {
  /** 毫秒时钟（runServe 与 buildServeRuntime 同源注入） */
  readonly clock: () => number
  /** 服务名（health 报告；缺省 studio-next-api） */
  readonly service?: string
}

/**
 * PORT-OBS 只读子口（API 注入面收窄后只留 snapshot/clock/newId/health）。
 * `snapshot`：本进程无投影库（面板投影归 control/panel 读面）——如实 Err，不伪造 Projection。
 * `health`：availability='unverified'（未核验不等于可用；autonomyProven 恒 false）。
 */
export function buildServeObsFace(args: ServeObsFaceArgs): ApiObservationReadFace {
  const service = args.service ?? 'studio-next-api'
  const now = (): string => new Date(args.clock()).toISOString()
  return {
    snapshot(view: { readonly viewName: string }, _rc: ReadContext): PortResult<Projection> {
      return {
        kind: 'err',
        error: unsupported(
          'projection-source-not-wired',
          `PORT-OBS 投影源未装配（view=${view.viewName}）：本进程零投影库；对外读面经 API readers（公司快照投影）供给`,
          'daemon/assembly（投影面装配）',
        ),
      }
    },
    clock(): { now: string; source: 'injected' } {
      return { now: now(), source: 'injected' }
    },
    newId(kind: string): { kind: string; value: string; sortable: boolean } {
      return { kind, value: makeUlid(args.clock()), sortable: true }
    },
    health(_rc: ReadContext): PortResult<HealthReport> {
      return {
        kind: 'ok',
        value: {
          service,
          checkedAt: now(),
          availability: 'unverified',
          resources: [],
          autonomyProven: false,
          proofBoundary: {
            proves: ['进程内 API 装配面在位（/v1 读面注册、时钟/标识可注入）'],
            doesNotProve: ['公司自治在线率（v2/05 §四）', 'PORT-OBS 投影源（未装配）'],
          },
        },
      }
    },
  }
}

/**
 * PORT-GATE 的 fail-closed 面（意图保留/回执投影/通知出口三面未装配时的唯一合法形态）。
 * 三方法全部 `Err(unsupported)`：不产假回执、不以 Ok(undefined) 冒充「权威确认不存在」。
 */
export function buildFailClosedGate(): GatePort {
  return {
    receiveIntent(_intent: ExternalIntent, _ctx: CallContext): PortResult<IntentReceipt> {
      return {
        kind: 'err',
        error: unsupported(
          'port-gate-not-wired',
          '外部意图落单面（REC-WORK-01 意图保留＋四槽幂等＋回执投影）未装配——只落单不派工：入口 fail-closed，不伪造 queued 回执',
          '宰衡/装配（assembly 意图入口）',
        ),
      }
    },
    receipt(_key: IntentKey, _rc: ReadContext): PortResult<IntentReceipt | undefined> {
      return {
        kind: 'err',
        error: unsupported(
          'intent-receipt-projection-not-wired',
          '回执投影未装配：快照未命中≠不存在（不得以 Ok(undefined) 冒充无行——v2/14 §四 503 receipt-not-in-snapshot）',
          '宰衡/装配（assembly 意图入口）',
        ),
      }
    },
    notify(_envelope: NotificationEnvelope, _ctx: CallContext): PortResult<DeliveryReceipt> {
      return {
        kind: 'err',
        error: unsupported(
          'notify-channel-not-wired',
          '通知出口未装配（通知面经 notifyBroadcast 注入，不在 API 面；送达≠接受）',
          'daemon/assembly（通知面装配）',
        ),
      }
    },
  }
}

/** serve 侧 API 装配入参（组合根与 runServe 同源；只交窄面） */
export interface ServeApiArgs {
  /** 本进程挂载公司维（SEC-WD-01：读/写同一解析规则） */
  readonly company: CompanyRef
  /** 公司快照活取（L1 热重载整组换——读取器闭包随取随新，不冻结旧快照） */
  readonly readSnapshot: () => CompanySnapshot
  /** 监听端口（缺省 0＝ephemeral，不抢 :8788；生产在 daemon.yaml 显式指定） */
  readonly port: number
  readonly clock: () => number
  /** 装配/启动日志出口（**必须**是未过闸 raw log → serve 侧经 guardLog 收口） */
  readonly log: (line: string) => void
  /** PORT-GATE 面（缺省＝fail-closed 面；PORT-GATE 落位后由装配单元注入替换） */
  readonly gate?: GatePort
  /** API 响应面出站闸 wrapper（第 5 出口；缺省不扫描——启动行显式登记缺口） */
  readonly guardResponse?: (payload: unknown) => unknown
  /** 监听地址（缺省 127.0.0.1 环回；LAN 暴露未落位＝缺口） */
  readonly host?: string
}

/** serve 侧 API 装配面（`ServeRuntime.api`）：装配一次、监听一次、停机一处收口 */
export interface ServeApiWiring {
  /** 同进程装配面（app/ports/company；测试可 app.request 驱动） */
  readonly assembly: ApiAssembly
  /** 真监听（幂等：重复调用返回同一句柄）；启动行在此打印实际端口/只读面/缺口 */
  start(): Promise<ApiServerHandle>
  /** 关监听（幂等；未 start＝no-op）——runServe 停机收口第一步 */
  close(): Promise<void>
}

/** 读源活取包装（L1 热重载后新快照即刻生效：每次调用按当前快照重建 8 件闭包） */
function liveReaders(readSnapshot: () => CompanySnapshot, obs: ApiObservationReadFace): ApiReadSources {
  const current = (): ApiReadSources => buildApiReaders(readSnapshot(), obs)
  return {
    company: (rc) => current().company(rc),
    org: (rc) => current().org(rc),
    people: (rc) => current().people(rc),
    projects: (rc) => current().projects(rc),
    issues: (query, rc) => current().issues(query, rc),
    finance: (rc) => current().finance(rc),
    reports: (rc) => current().reports(rc),
    agentCard: (rc) => current().agentCard(rc),
  }
}

/**
 * 装配 serve 侧 API 面（runServe 装配序调用一次；本件不自启主循环、不自开库）。
 * 监听不在装配期起（buildServeRuntime 保持同步）——`start()` 由 runServe 在源启动前 await。
 */
export function wireServeApi(args: ServeApiArgs): ServeApiWiring {
  const obs = buildServeObsFace({ clock: args.clock })
  const gate = args.gate ?? buildFailClosedGate()
  const assembly = assembleApi({
    company: args.company,
    obs,
    gate,
    readers: liveReaders(args.readSnapshot, obs),
    auth: buildApiIntakeAuth({ log: args.log }),
    log: args.log,
  })
  let server: ApiServerHandle | undefined
  return {
    assembly,
    async start(): Promise<ApiServerHandle> {
      if (server !== undefined) return server
      const handle = await startApiServer(assembly.app, {
        port: args.port,
        ...(args.host !== undefined ? { host: args.host } : {}),
        ...(args.guardResponse !== undefined ? { guardResponse: args.guardResponse } : {}),
      })
      server = handle
      const gaps = API_READ_FACE_GAPS.map((face) => `${face}(${API_READ_FACE_GAP_REASONS[face]})`).join('、')
      args.log(
        `[serve] 对外 API 已监听：${handle.url}（同进程装配；绑定=${handle.host}；` +
          `只读面=${API_READ_FACE_SERVED.join('/')}；缺口=${gaps}→503 不补 0；` +
          `触发面=fail-closed 401/403（凭据目录/签名验签未装配）；写面=PORT-GATE gated-only；` +
          `响应面出站闸=${args.guardResponse !== undefined ? '已接 guardApiResponse' : '未接（缺口）'}）`,
      )
      return handle
    },
    async close(): Promise<void> {
      const current = server
      server = undefined
      if (current !== undefined) await current.close()
    },
  }
}
