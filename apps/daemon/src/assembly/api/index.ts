/**
 * assembly/api —— 对外 API 注入式装配（runServe 同进程；:8788 的装配点）
 *
 * 依据（实现单引用）：
 *   - plan/05 IMPL-06-06「assembly/api 注入式装配」冻结验收：裸 platform 注入＝装配错误
 *     拒启；`api→panel` 边永禁（guard 绿即证）；
 *   - docs/v2/14 §四（API 只落单不派工：读面同源 PORT-OBS 投影、写面唯一经 PORT-GATE；
 *     「API 进程零库零平台」；装配＝daemon assembly 同进程注入，不自起进程/不自立 bin）；
 *   - docs/v2/16 §三 api 行（真实装配落本目录，由 runServe 同进程注入，不直调
 *     engine.ingest；端点落地前 api 包不留占位依赖）；
 *   - docs/plan/mig08-closeout.md §六 欠账①②（runServe→assembleApi/createApiApp 接线、
 *     API readers/auth 供给——本件即该欠账的装配腿）。
 *
 * 职责：`assembleApi(injection)` —— 校验注入面（见 inject.ts：company/obs/gate/readers/
 * auth/log，gated-only；裸 platform、engine/ledger 等一律拒启）→ 收窄并冻结句柄 →
 * 构造 `createApiApp`（Hono 应用；端点与视图序列化唯一源仍在 packages/api）→ 返回装配面
 * （`app` 供监听壳 `live.ts` 与测试驱动；本件**不自开监听**）。
 *
 * 装配面**无主循环引用**（不持 engine/scheduler/ingest/tick）、**无台账句柄**（不持
 * Ledger/DB/路径）、**无 FlowPlatform 写句柄**（平台面句柄只以 gated 形态的 gate 存在，
 * 平台写面唯一经 PORT-GATE）——三者不是纪律，是类型与运行期双闸：注入槽不在契约内，
 * 能力 wrapper 也不暴露。**无 secrets/凭据值表**：auth 是判定函数，不是凭据目录。
 *
 * 分界（不越界）：
 *   - HTTP 应用与端点族（API-01..16）归 `packages/api/src/`（06-07/08）；本件不造第二
 *     app、不自开监听、不改路由——只交装配序与注入面。
 *   - runServe 主循环编排归 `assembly/serve/`（06-05）；本件不 import serve。
 *     监听壳归 `live.ts`（node:http＋Hono fetch；缺省 127.0.0.1 环回、port=0 可 ephemeral）；
 *     serve 侧面供给/生命周期归 `serve-face.ts`。
 *   - `api→panel` 永禁：本目录零 panel import（guard 机械背书）。
 */
import { createApiApp } from '@studio-next/api'
import type { ApiApp } from '@studio-next/api'
import type { CompanyRef, GatePort } from '@studio-next/contract'
import { assertApiInjection } from './inject.ts'
import type { ApiInjection, ApiObservationReadFace } from './inject.ts'

export {
  API_FORBIDDEN_LEDGER_SLOTS,
  API_FORBIDDEN_MAIN_LOOP_SLOTS,
  API_FORBIDDEN_PLATFORM_SLOTS,
  API_INJECTION_SLOTS,
  API_READER_SLOTS,
  assertApiInjection,
} from './inject.ts'
export type { ApiInjection, ApiObservationReadFace } from './inject.ts'

/** 装配形态：只存在同进程注入（不自起进程、不自立 bin、不自开库、不独立取主循环） */
export const API_ASSEMBLY_MODE = 'in-process' as const

/**
 * API 装配面（注入句柄的冻结视图）。
 * 端点族按端口消费：读走 `readers`（公司快照投影，零库）、写走 `ports.gate`
 * （PORT-GATE gated 入口）——两张口之外无其他能力可达（无 engine/ledger/platform）。
 */
export interface ApiAssembly {
  /** 同进程装配标记（本进程内 runServe 装配位；无独立进程形态） */
  readonly mode: typeof API_ASSEMBLY_MODE
  /** 本进程挂载公司维（与注入面同对象：冻结副本，读写同维） */
  readonly company: CompanyRef
  /** 冻结后的端口视图（obs/gate 为能力剥离 wrapper，非调用方原对象） */
  readonly ports: Readonly<{
    /** PORT-OBS 只读子口（snapshot/clock/newId/health；reportFault 不可达） */
    readonly obs: ApiObservationReadFace
    /** PORT-GATE gated 入口（receiveIntent/receipt/notify；裸 platform 不可达） */
    readonly gate: GatePort
  }>
  /** Hono 应用（端点族装配完成；监听壳=live.ts startApiServer，测试可 app.request 驱动） */
  readonly app: ApiApp
}

/**
 * 同进程装配入口（runServe 装配位调用；装配序＝校验→收窄→冻结→createApiApp）。
 *
 * @param injection 只读端口＋gated 入口＋readers/auth＋公司维（见 inject.ts 头注；
 *                  裸 platform 等禁止槽一律 CONFIG_INVALID 拒启）
 */
export function assembleApi(injection: ApiInjection): ApiAssembly {
  const valid = assertApiInjection(injection)
  const ports = Object.freeze({ obs: valid.obs, gate: valid.gate })
  const log = valid.log ?? ((): void => {})
  // 端点/视图序列化唯一源＝packages/api（本件只交装配序；不自造第二 app）
  const app = createApiApp({
    company: valid.company,
    obs: valid.obs,
    gate: valid.gate,
    readers: valid.readers,
    auth: valid.auth,
    log,
  })
  log(
    `[api] 注入式装配完成（同进程 runServe 装配位）：company=${valid.company.slug} ` +
      `obs=PORT-OBS(只读 snapshot/clock/newId/health) gate=PORT-GATE(gated-only receiveIntent/receipt/notify) ` +
      `readers=8(公司快照投影；零库) auth=fail-closed(partner/signed 未装配＝拒/root 拒)；` +
      `零主循环（无 engine/ingest/tick）零台账直写（无 ledger/db）零裸平台（SEC-FC-07）`,
  )
  return Object.freeze({ mode: API_ASSEMBLY_MODE, company: valid.company, ports, app })
}
