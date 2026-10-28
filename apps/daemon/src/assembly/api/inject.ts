/**
 * assembly/api/inject —— 对外 API 注入契约与装配校验（gated-only 收口）
 *
 * 依据（实现单引用）：plan/05 IMPL-06-06「assembly/api 注入式装配」；
 *   docs/v2/14 §四（对外 API 面：只落单不派工；读面同源 PORT-OBS 投影；写面唯一经
 *     PORT-GATE；装配＝daemon assembly 同进程注入；「API 进程零库零平台」；`api→panel`
 *     边永禁）；
 *   docs/v2/15 §一 SEC-FC-07（一切非测试装配只允许注入 gated platform；「注入裸
 *     platform」＝装配错误拒启）与 §三 SEC-WD-03（写路径逐条登记：写面全行 gated 才算
 *     唯一写入者成立）；
 *   docs/v2/16 §三 api 行（真实装配落 `apps/daemon/src/assembly/api/`，由 runServe 同进程
 *     注入，不直调 engine.ingest；端点落地前不留占位依赖）。
 *
 * 唯一合法注入面（fail-closed；不在表内即拒启）：
 *   - `company`：本进程挂载公司维（CompanyRef；SEC-WD-01 读写同一公司维）。
 *   - `obs`    ：PORT-OBS 的**只读子口**（snapshot/clock/newId/health）——`reportFault`
 *                等写槽不注入；监控/API 不改事实（v2/08 §4.1「监控不改事实」）。
 *   - `gate`   ：PORT-GATE（receiveIntent/receipt/notify）——**gated-only**：外部意图唯一
 *                入口，只落单不派工；裸 FlowPlatform（issues/comments/fields/… 七能力）
 *                在结构上不满足 GatePort，注入即拒。
 *   - `log?`   ：装配日志出口（缺省 no-op；与 serve 装配同惯例，只作装配序证据）。
 *
 * 禁止槽（出现即装配错误，不静默忽略——半面启动不许当降级）：
 *   - `platform`/`gatedPlatform`/`flowPlatform`：API 注入面零平台（v2/14 §四）；裸
 *     platform＝SEC-FC-07 判负；平台写面唯一经 gate（PORT-GATE gated 入口）。
 *   - `engine`/`ingest`/`tick`/`scheduler`/`sources`/`runtime`：API 不持主循环——不独立取
 *     runServe 的引擎/队列/调度源（装配体对主循环零引用）。
 *   - `ledger`/`db`/`database`/`openLedger`/`ledgerPath`：API 不直写台账、也不自开库
 *     （唯一写入者=daemon；只读打开归 store 面，注入面不收句柄/路径）。
 *
 * 类型收口（机制而非自律）：本件不含 FlowPlatform 槽；`ApiObservationReadFace` 是
 * PORT-OBS 的 Pick 收窄（不新增端口形状），`gate` 复用 `GatePort`。校验通过后返回**能力
 * 剥离 wrapper**（只暴露允许的方法、冻结）——即使调用方给的对象夹带平台七能力，
 * 装配面也拿不到（`gated-only` 的运行期承载）。
 *
 * 端口/记录类零新增：端口形状唯一源仍是 `packages/contract/src/ports/`（v2/14 §二 F5
 * 单点表）；本件只做装配面收窄与拒启校验。
 */
import { SLUG_RE } from '@studio-next/company'
import { configInvalid } from '@studio-next/contract'
import type { CompanyRef, GatePort, ObservationPort } from '@studio-next/contract'

/** API 读面：PORT-OBS 只读子口（写槽 reportFault 不注入；无改事实方法槽） */
export type ApiObservationReadFace = Pick<ObservationPort, 'snapshot' | 'clock' | 'newId' | 'health'>

/** 允许的注入槽（固定三件＋日志出口；其余一律拒——含拼错槽名） */
export const API_INJECTION_SLOTS = ['company', 'obs', 'gate', 'log'] as const

/** 平台类禁止槽（SEC-FC-07：裸 platform 注入＝装配错误） */
export const API_FORBIDDEN_PLATFORM_SLOTS = ['platform', 'gatedPlatform', 'flowPlatform'] as const

/** 主循环类禁止槽（API 不持主循环：runServe 同进程只交只读端口与 gated 入口） */
export const API_FORBIDDEN_MAIN_LOOP_SLOTS = [
  'engine',
  'ingest',
  'tick',
  'scheduler',
  'sources',
  'runtime',
] as const

/** 台账类禁止槽（API 不直写台账、不自开库） */
export const API_FORBIDDEN_LEDGER_SLOTS = [
  'ledger',
  'db',
  'database',
  'openLedger',
  'ledgerPath',
] as const

/**
 * API 注入面（runServe 同进程装配的唯一入参）。
 * 类型上无 `platform`/`engine`/`ledger` 槽——裸 platform 与主循环句柄不可表达；
 * 运行期再由 `assertApiInjection` 对 unknown 入参逐槽复检（JS 调用面同拒）。
 */
export interface ApiInjection {
  /** 本进程挂载公司维（SEC-WD-01；单公司部署亦显式，不留空） */
  readonly company: CompanyRef
  /** PORT-OBS 只读子口（API 读面唯一来源） */
  readonly obs: ApiObservationReadFace
  /** PORT-GATE gated 入口（API 写面唯一入口；裸 FlowPlatform 不可注入） */
  readonly gate: GatePort
  /** 装配日志出口（缺省 no-op；只作装配序证据，不影响装配结果） */
  readonly log?: (line: string) => void
}

/** 只读子口方法名（wrapper 收窄清单；`reportFault` 不在内＝只读面在运行期也不可达） */
const OBS_READ_METHODS = ['snapshot', 'clock', 'newId', 'health'] as const

/** gated 入口方法名（PORT-GATE 全三方法；wrapper 只留这三槽） */
const GATE_METHODS = ['receiveIntent', 'receipt', 'notify'] as const

/** 平台七能力判别键（三键同现即判裸 FlowPlatform——gate 槽不得冒充意图入口） */
const PLATFORM_ABILITY_KEYS = ['issues', 'comments', 'fields'] as const

/** 对象闸（null/数组外的一切 object 都按 Record 逐槽检查；数组由未知槽兜底拒） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 禁止/未知槽的拒启分派：已知禁止槽给一条可判定的原因，未知槽同样拒绝（fail-closed）。
 * 一切「顺手多给一个句柄」的装配形态都在此闸死——不靠调用方自律。
 */
function rejectSlot(slot: string): never {
  if ((API_FORBIDDEN_PLATFORM_SLOTS as readonly string[]).includes(slot)) {
    configInvalid(
      'api/assembly:bare-platform',
      `禁止注入槽 ${slot}：API 注入面零平台（v2/14 §四「API 进程零库零平台」）——裸 FlowPlatform 注入＝装配错误（SEC-FC-07）；写面唯一经 gate（PORT-GATE gated 入口）`,
    )
  }
  if ((API_FORBIDDEN_MAIN_LOOP_SLOTS as readonly string[]).includes(slot)) {
    configInvalid(
      'api/assembly:main-loop',
      `禁止注入槽 ${slot}：API 不持主循环（不独立取 engine/ingest/tick/调度源——runServe 同进程注入只交只读端口与 gated 入口）`,
    )
  }
  if ((API_FORBIDDEN_LEDGER_SLOTS as readonly string[]).includes(slot)) {
    configInvalid(
      'api/assembly:direct-ledger',
      `禁止注入槽 ${slot}：API 不直写台账、也不自开库（唯一写入者=daemon；只读打开归 store 面，注入面不收句柄/路径）`,
    )
  }
  configInvalid(
    'api/assembly:unknown-slot',
    `未知注入槽 ${slot}（合法槽=${API_INJECTION_SLOTS.join('/')}）——拼错槽名＝装配错误，不静默忽略`,
  )
}

/** 公司维：两槽必填同源（读写同一解析规则，v2/14 §四跨公司一致性） */
function assertCompany(value: unknown): CompanyRef {
  if (value === undefined) {
    configInvalid(
      'api/assembly:company-missing',
      '缺 company 公司维（SEC-WD-01：读写同一公司维；单公司部署亦显式声明，不留空）',
    )
  }
  if (!isRecord(value)) {
    configInvalid('api/assembly:company-invalid', `company 须为 {companyId, slug}（实得 ${typeof value}）`)
  }
  const companyId = value['companyId']
  const slug = value['slug']
  if (typeof companyId !== 'string' || companyId.trim() === '') {
    configInvalid('api/assembly:company-invalid', 'company.companyId 须为非空字符串（公司维缺失=装配错误）')
  }
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    configInvalid(
      'api/assembly:company-invalid',
      `company.slug 非法（须匹配 ${SLUG_RE.source}；实得 ${JSON.stringify(slug)}）——跨公司读隔离以同维为前提（NEG-SEC-02）`,
    )
  }
  return Object.freeze({ companyId, slug })
}

/**
 * 只读读面：四方法齐全才注入；wrapper 只转调这四槽（reportFault 在装配面不可达）。
 * 返回冻结 wrapper——装配体与 API 都拿不到原端口对象上的写方法。
 */
function assertObservationFace(value: unknown): ApiObservationReadFace {
  if (value === undefined) {
    configInvalid(
      'api/assembly:missing-obs',
      `缺 obs 只读端口（PORT-OBS 子口：${OBS_READ_METHODS.join('/')}）——API 读面唯一来源；开而不注入＝半面启动，拒启（不静默空转）`,
    )
  }
  if (!isRecord(value)) {
    configInvalid('api/assembly:obs-shape', `obs 须为 PORT-OBS 只读子口对象（实得 ${typeof value}）`)
  }
  for (const method of OBS_READ_METHODS) {
    if (typeof value[method] !== 'function') {
      configInvalid(
        'api/assembly:obs-shape',
        `obs 缺只读方法 ${method}（API 读面=${OBS_READ_METHODS.join('/')}；reportFault 等写槽不注入）`,
      )
    }
  }
  const source = value as unknown as ApiObservationReadFace
  const face: ApiObservationReadFace = {
    snapshot: (view, rc) => source.snapshot(view, rc),
    clock: () => source.clock(),
    newId: (kind) => source.newId(kind),
    health: (rc) => source.health(rc),
  }
  return Object.freeze(face)
}

/**
 * gated 入口：PORT-GATE 三方法齐全才注入；平台七能力同体出现按裸 platform 拒。
 * 返回冻结 wrapper（只留三方法）——即便注入对象夹带 issues 等平台能力，API 侧也不可达。
 */
function assertGateFace(value: unknown): GatePort {
  if (value === undefined) {
    configInvalid(
      'api/assembly:missing-gate',
      `缺 gate 入口（PORT-GATE gated 形态：${GATE_METHODS.join('/')}）——API 写面唯一入口；开而不注入＝半面启动，拒启（不静默空转）`,
    )
  }
  if (!isRecord(value)) {
    configInvalid('api/assembly:gate-shape', `gate 须为 PORT-GATE gated 入口对象（实得 ${typeof value}）`)
  }
  if (PLATFORM_ABILITY_KEYS.every((key) => key in value)) {
    configInvalid(
      'api/assembly:bare-platform',
      `gate 槽收到平台七能力对象（${PLATFORM_ABILITY_KEYS.join('/')} 同现）——裸 platform 不能冒充意图入口（SEC-FC-07 gated-only）；平台写面唯一经 PORT-GATE`,
    )
  }
  for (const method of GATE_METHODS) {
    if (typeof value[method] !== 'function') {
      configInvalid(
        'api/assembly:gate-shape',
        `gate 缺方法 ${method}——写面唯一形态是 PORT-GATE（gated-only：${GATE_METHODS.join('/')}）；裸 FlowPlatform 不满足 GatePort（SEC-FC-07）`,
      )
    }
  }
  const source = value as unknown as GatePort
  const face: GatePort = {
    receiveIntent: (intent, ctx) => source.receiveIntent(intent, ctx),
    receipt: (key, rc) => source.receipt(key, rc),
    notify: (envelope, ctx) => source.notify(envelope, ctx),
  }
  return Object.freeze(face)
}

/**
 * 注入面校验（唯一入口；`assembleApi` 与测试共用）。
 * 入参是 unknown：类型面之外（JS 调用/配置拼装/未来调用方）同一套 fail-closed 复检，
 * 不因「类型上过了」而免检。校验通过后返回**收窄+冻结**的注入面（gate/obs 为 wrapper）。
 */
export function assertApiInjection(input: unknown): ApiInjection {
  if (!isRecord(input)) {
    configInvalid(
      'api/assembly:injection-shape',
      `API 注入面须为对象（实得 ${input === null ? 'null' : typeof input}）——缺注入＝半面启动，拒启（不静默空转）`,
    )
  }
  const allowed = new Set<string>(API_INJECTION_SLOTS)
  for (const slot of Object.keys(input)) {
    if (!allowed.has(slot)) rejectSlot(slot)
  }
  const company = assertCompany(input['company'])
  const obs = assertObservationFace(input['obs'])
  const gate = assertGateFace(input['gate'])
  const log = input['log']
  if (log !== undefined && typeof log !== 'function') {
    configInvalid('api/assembly:log-shape', `log 须为 (line: string) => void（实得 ${typeof log}；缺省不注入=no-op）`)
  }
  return Object.freeze({
    company,
    obs,
    gate,
    ...(log !== undefined ? { log: log as (line: string) => void } : {}),
  })
}
