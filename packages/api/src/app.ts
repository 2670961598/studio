/**
 * packages/api/src/app.ts —— 对外 API 应用装配（createApiApp；Hono，进程内注入）
 *
 * 依据：
 *   - docs/v2/14 §四（API- 端点族：读走 PORT-OBS 投影/只读台账视图、写唯一经 PORT-GATE；
 *     只落单不派工；API 进程零库零平台；装配由 daemon assembly 同进程注入）；
 *   - docs/v2/15 §一 SEC-FC-07（非测试装配 gated-only；裸 platform 注入＝装配错误拒启）、
 *     §三 SEC-WD-01（写必带公司维）、§五 SEC-RD-01（读面 readScope/caller 字段承载）、
 *     §七 SEC-ROOT（root 凭据不入接口面）；
 *   - plan/05 IMPL-06-07/08（端点面与 Hono app 装配/导出；测试用 app.request 进程内驱动）。
 *
 * 装配纪律（与 06-06 assembly/api 同向，不造第二装配源）：
 *   - 唯一入参是 `ApiAppOptions`（company/obs/gate/readers/auth ＋ hooks/events/
 *     subscriptions/log 可选）——**类型上无 platform/ledger/engine/scheduler/launch/
 *     dispatch 槽**；运行期再对 unknown 入参逐槽复检（JS 调用面同拒）。
 *   - 允许槽之外一律 CONFIG_INVALID 拒启（含拼错槽名）；半面启动不当降级：
 *     obs/gate/readers/auth 缺一即构造期失败，hooks/events/subscriptions 缺省时对应
 *     端点回 501 带原因（不是空流/空实现）。
 *   - 收窄并冻结注入句柄：obs 只留四只读方法（reportFault 不可达）、gate 只留 PORT-GATE
 *     三方法（裸 FlowPlatform 七能力不可达）、readers 只留八个读取器（无库句柄）。
 */
import { Hono } from 'hono'
import { configInvalid } from '@studio-next/contract'
import type { CompanyRef, GatePort } from '@studio-next/contract'
import { createRoutes } from './routes/index.ts'
import { API_ENDPOINT_COUNT } from './catalog.ts'
import { internalFailure, isRecord, isNonEmptyString, newTraceId, routeNotFound } from './http.ts'
import type { ApiObservationReadFace } from './types.ts'
import type {
  ApiApp,
  ApiAppOptions,
  ApiEnv,
  ApiEventFeed,
  ApiHookSource,
  ApiIntakeAuthenticator,
  ApiReadSources,
  ApiRouteDeps,
  ApiSubscriptionPolicy,
} from './types.ts'

/** 唯一合法注入槽（拼错槽名＝装配错误，不静默忽略） */
export const API_APP_SLOTS = [
  'company',
  'obs',
  'gate',
  'readers',
  'auth',
  'hooks',
  'events',
  'subscriptions',
  'log',
] as const

/** 明示禁止槽（类型上不可表达；运行期给可判定的拒启原因） */
export const API_APP_FORBIDDEN_SLOTS = [
  'platform',
  'gatedPlatform',
  'flowPlatform',
  'ledger',
  'db',
  'database',
  'openLedger',
  'ledgerPath',
  'engine',
  'ingest',
  'tick',
  'scheduler',
  'sources',
  'runtime',
  'dispatch',
  'launch',
  'worker',
  'store',
] as const

/** readers 唯一合法方法名（未知键＝拼错/夹带，拒启） */
const READER_SLOTS = [
  'company',
  'org',
  'people',
  'projects',
  'issues',
  'finance',
  'reports',
  'agentCard',
] as const

/** obs 只读子口方法名（reportFault 等写槽不注入） */
const OBS_READ_METHODS = ['snapshot', 'clock', 'newId', 'health'] as const

/** gate 三方法（PORT-GATE；裸平台七能力不在此列） */
const GATE_METHODS = ['receiveIntent', 'receipt', 'notify'] as const

/** 平台七能力判别键（三键同现即判裸 FlowPlatform——gate 槽不得冒充意图入口） */
const PLATFORM_ABILITY_KEYS = ['issues', 'comments', 'fields'] as const

function rejectSlot(slot: string): never {
  if ((API_APP_FORBIDDEN_SLOTS as readonly string[]).includes(slot)) {
    configInvalid(
      `api/app:forbidden-slot:${slot}`,
      `禁止注入槽 ${slot}：API 进程零库零平台（v2/14 §四）——写面唯一经 gate（PORT-GATE gated 入口），派工/收割是显式不存在的第三级`,
    )
  }
  configInvalid(
    `api/app:unknown-slot:${slot}`,
    `未知注入槽 ${slot}（合法槽=${API_APP_SLOTS.join('/')}）——拼错槽名＝装配错误，不静默忽略`,
  )
}

function assertCompany(value: unknown): CompanyRef {
  if (!isRecord(value)) configInvalid('api/app:company-missing', '缺 company 公司维（单公司部署亦显式，不留空）')
  const companyId = value['companyId']
  const slug = value['slug']
  if (!isNonEmptyString(companyId)) configInvalid('api/app:company-shape', 'company.companyId 须为非空字符串')
  if (!isNonEmptyString(slug)) configInvalid('api/app:company-shape', 'company.slug 须为非空字符串')
  return Object.freeze({ companyId, slug })
}

/** PORT-OBS 只读子口：wrapper 只转调四方法；原对象上的写方法在装配面不可达 */
function assertObservation(value: unknown): ApiObservationReadFace {
  if (!isRecord(value)) configInvalid('api/app:obs-missing', '缺 obs（PORT-OBS 只读子口，读面/时钟/标识唯一来源）')
  for (const method of OBS_READ_METHODS) {
    if (typeof value[method] !== 'function') {
      configInvalid('api/app:obs-shape', `obs 缺只读方法 ${method}（API 读面=${OBS_READ_METHODS.join('/')}）`)
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

/** PORT-GATE：三方法齐全；裸平台七能力同体出现＝拒启（gated-only 运行期承载） */
function assertGate(value: unknown): GatePort {
  if (!isRecord(value)) configInvalid('api/app:gate-missing', '缺 gate（PORT-GATE gated 入口；写面唯一入口）')
  if (PLATFORM_ABILITY_KEYS.every((key) => key in value)) {
    configInvalid(
      'api/app:bare-platform',
      `gate 槽收到平台七能力对象（${PLATFORM_ABILITY_KEYS.join('/')} 同现）——裸 FlowPlatform 不能冒充意图入口（SEC-FC-07）`,
    )
  }
  for (const method of GATE_METHODS) {
    if (typeof value[method] !== 'function') {
      configInvalid('api/app:gate-shape', `gate 缺方法 ${method}（PORT-GATE=${GATE_METHODS.join('/')}）`)
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

/** 只读投影读取器：八件齐全；未知键拒启；wrapper 不把装配对象本身交给路由 */
function assertReaders(value: unknown): ApiReadSources {
  if (!isRecord(value)) configInvalid('api/app:readers-missing', '缺 readers（只读投影读取器八件）')
  for (const key of Object.keys(value)) {
    if (!(READER_SLOTS as readonly string[]).includes(key)) {
      configInvalid('api/app:readers-unknown', `readers 未知读取器 ${key}（合法=${READER_SLOTS.join('/')}）`)
    }
  }
  for (const key of READER_SLOTS) {
    if (typeof value[key] !== 'function') {
      configInvalid('api/app:readers-shape', `readers 缺读取器 ${key}（八件缺一＝半面启动，拒启）`)
    }
  }
  const source = value as unknown as ApiReadSources
  const face: ApiReadSources = {
    company: (rc) => source.company(rc),
    org: (rc) => source.org(rc),
    people: (rc) => source.people(rc),
    projects: (rc) => source.projects(rc),
    issues: (query, rc) => source.issues(query, rc),
    finance: (rc) => source.finance(rc),
    reports: (rc) => source.reports(rc),
    agentCard: (rc) => source.agentCard(rc),
  }
  return Object.freeze(face)
}

function assertAuth(value: unknown): ApiIntakeAuthenticator {
  if (typeof value !== 'function') {
    configInvalid('api/app:auth-missing', '缺 auth（触发面认证器：partner/signed；失败 fail-closed）')
  }
  return value as ApiIntakeAuthenticator
}

const HOOK_SOURCE_RE = /^[a-z][a-z0-9-]{0,31}$/
const DEFAULT_HOOK_TOLERANCE_MS = 5 * 60_000
const MAX_HOOK_TOLERANCE_MS = 60 * 60_000

/** 入站 hooks 登记表（source 唯一；secret 只作运行时验签材料，不进日志/响应） */
function assertHooks(value: unknown): readonly ApiHookSource[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) configInvalid('api/app:hooks-shape', 'hooks 须为数组（缺省＝hooks 面 501）')
  const seen = new Set<string>()
  const out: ApiHookSource[] = []
  for (const entry of value) {
    if (!isRecord(entry)) configInvalid('api/app:hooks-shape', 'hooks 条目须为对象')
    const source = entry['source']
    const secret = entry['signingSecret']
    const tolerance = entry['toleranceMs']
    if (!isNonEmptyString(source) || !HOOK_SOURCE_RE.test(source)) {
      configInvalid('api/app:hooks-shape', `hook source 须匹配 ${HOOK_SOURCE_RE.source}`)
    }
    if (seen.has(source)) configInvalid(`api/app:hooks-duplicate:${source}`, `hook source 重复：${source}`)
    seen.add(source)
    if (!isNonEmptyString(secret)) configInvalid('api/app:hooks-shape', `hook ${source} 缺 signingSecret（运行时注入，不入仓）`)
    if (tolerance !== undefined) {
      if (typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 1 || tolerance > MAX_HOOK_TOLERANCE_MS) {
        configInvalid('api/app:hooks-shape', `hook ${source} toleranceMs 须为 1..${String(MAX_HOOK_TOLERANCE_MS)} 的整数`)
      }
      out.push(Object.freeze({ source, signingSecret: secret, toleranceMs: tolerance }))
    } else {
      out.push(Object.freeze({ source, signingSecret: secret, toleranceMs: DEFAULT_HOOK_TOLERANCE_MS }))
    }
  }
  return Object.freeze(out)
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/** 出站订阅策略（allowlist 空＝全部拒绝；host 形态非法＝构造期拒启） */
function assertSubscriptions(value: unknown): ApiSubscriptionPolicy {
  if (value === undefined) configInvalid('api/app:subscriptions-missing', '内部错误：缺省不应进入本校验')
  if (!isRecord(value)) configInvalid('api/app:subscriptions-shape', 'subscriptions 须为对象')
  const allowlist = value['allowlist']
  const allowInsecureHttp = value['allowInsecureHttp']
  if (!Array.isArray(allowlist)) configInvalid('api/app:subscriptions-shape', 'subscriptions.allowlist 须为数组（空数组＝全拒）')
  const hosts: string[] = []
  for (const entry of allowlist) {
    if (typeof entry !== 'string') configInvalid('api/app:subscriptions-shape', 'allowlist 条目须为字符串')
    const host = entry.trim().toLowerCase()
    if (!HOST_RE.test(host)) configInvalid('api/app:subscriptions-shape', `allowlist 条目非法：${JSON.stringify(entry)}（只收裸主机名）`)
    if (!hosts.includes(host)) hosts.push(host)
  }
  if (allowInsecureHttp !== undefined && typeof allowInsecureHttp !== 'boolean') {
    configInvalid('api/app:subscriptions-shape', 'subscriptions.allowInsecureHttp 须为布尔')
  }
  const policy: ApiSubscriptionPolicy = {
    allowlist: Object.freeze(hosts),
    ...(allowInsecureHttp !== undefined ? { allowInsecureHttp } : {}),
  }
  return Object.freeze(policy)
}

function assertEvents(value: unknown): ApiEventFeed {
  if (!isRecord(value) || typeof value['read'] !== 'function') {
    configInvalid('api/app:events-shape', 'events 须为 { read(after, rc) }（SSE 事件源）')
  }
  const feed: ApiEventFeed = { read: (after, rc) => (value as unknown as ApiEventFeed).read(after, rc) }
  return Object.freeze(feed)
}

function assertLog(value: unknown): (line: string) => void {
  if (value === undefined) return (): void => {}
  if (typeof value !== 'function') configInvalid('api/app:log-shape', 'log 须为 (line: string) => void')
  return value as (line: string) => void
}

/**
 * 注入面校验（`createApiApp` 与测试共用）：unknown 入参逐槽复检 → 收窄 → 冻结。
 * 校验通过后返回的 deps 中 obs/gate/readers 是能力剥离 wrapper。
 */
export function resolveApiDeps(input: unknown): ApiRouteDeps {
  if (!isRecord(input)) configInvalid('api/app:options-shape', 'createApiApp 入参须为对象（缺配置＝拒启）')
  const allowed = new Set<string>(API_APP_SLOTS)
  for (const slot of Object.keys(input)) {
    if (!allowed.has(slot)) rejectSlot(slot)
  }
  const company = assertCompany(input['company'])
  const obs = assertObservation(input['obs'])
  const gate = assertGate(input['gate'])
  const readers = assertReaders(input['readers'])
  const auth = assertAuth(input['auth'])
  const hooks = assertHooks(input['hooks'])
  const events = input['events'] === undefined ? undefined : assertEvents(input['events'])
  const subscriptions = input['subscriptions'] === undefined ? undefined : assertSubscriptions(input['subscriptions'])
  const log = assertLog(input['log'])
  return Object.freeze({
    company,
    obs,
    gate,
    readers,
    auth,
    hooks,
    events,
    subscriptions,
    log,
  })
}

/**
 * 对外 API 应用工厂（Hono；进程内注入，不自开监听——监听壳归 daemon assembly）。
 * 返回的 app 可直接以 `app.request()` 驱动测试，不触网络。
 */
export function createApiApp(options: ApiAppOptions): ApiApp {
  const deps = resolveApiDeps(options)
  const app = new Hono<ApiEnv>()

  app.use('*', async (c, next) => {
    c.set('traceId', newTraceId(deps))
    c.header('cache-control', 'no-store')
    await next()
  })

  app.notFound((c) => routeNotFound(c))
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    deps.log(`[api] 未捕获错误：${message}`)
    return internalFailure(c, message)
  })

  app.route('/', createRoutes(deps))

  deps.log(
    `[api] app 装配完成：company=${deps.company.slug} endpoints=${String(API_ENDPOINT_COUNT)} ` +
      `hooks=${String(deps.hooks.length)} events=${deps.events === undefined ? 'unwired(501)' : 'wired'} ` +
      `subscriptions=${deps.subscriptions === undefined ? 'unwired(501)' : 'wired'}；只落单不派工（写面唯一经 PORT-GATE）`,
  )
  return app
}

