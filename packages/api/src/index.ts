/**
 * Studio Next · api —— 对外 API（:8788；API-01..16 端点面）
 *
 * 定位（docs/v2/14 §四、plan/05 IMPL-06-07/08）：独立凭证 / 独立端口 / **只落单不派工**；
 * 读面同源 PORT-OBS 投影＋只读台账视图，写面唯一经 PORT-GATE（gated）。装配由 daemon
 * assembly/api 同进程注入（06-06 已落，本包不造第二装配源、不自开监听）。
 *
 * 交付面：
 *   - `createApiApp(options)`：Hono 应用工厂（进程内注入；测试用 app.request 驱动）；
 *   - 只读族 API-01..09（company/org/people/projects/issues/finance/reports/
 *     request-status/agent-card）；
 *   - 触发族 API-10..13（requests/explore/tasks/intel）＋入站 hooks API-15 →
 *     产 webhook 意图（202=已入队≠已受理）；
 *   - 订阅/SSE API-14/16（SSE 未装配=501 带原因；出站订阅 allowlist＋SSRF 拒）。
 *
 * 硬边界（机制而非自律）：
 *   - 注入面类型无 platform/ledger/db/engine/scheduler/launch/dispatch 槽；运行期未知槽
 *     ＝CONFIG_INVALID 拒启（含拼错槽名）；
 *   - 包依赖只增 hono＋@studio-next/contract（无 store/panel——`api→panel` 边永禁）；
 *   - 相对 import 全带 `.ts`（Node 原生 type-stripping 纪律）；只写可擦除语法。
 *
 * 未解决缺口（如实登记）：凭证目录/签名验签实现归装配侧（本包只收认证器结果）；SSE
 * 常驻投递/心跳、订阅退避/死信实际投递、防 DNS rebinding 归 daemon 侧（目标未证）。
 */
export {
  API_APP_FORBIDDEN_SLOTS,
  API_APP_SLOTS,
  createApiApp,
  resolveApiDeps,
} from './app.ts'
export { API_ENDPOINT_COUNT, API_ENDPOINTS } from './catalog.ts'
export {
  DEFAULT_ISSUES_LIMIT,
  MAX_ISSUES_LIMIT,
  MAX_REQUEST_BODY_BYTES,
  MAX_TEXT_FIELD_LENGTH,
  READ_CALLER,
} from './http.ts'
export {
  DEFAULT_HOOK_TOLERANCE_MS,
  HOOK_DELIVERY_HEADER,
  HOOK_NONCE_HEADER,
  HOOK_SIGNATURE_HEADER,
  HOOK_TIMESTAMP_HEADER,
  MAX_HOOK_TOLERANCE_MS,
} from './signature.ts'
export { FINANCE_SOURCES } from './types.ts'
export type {
  ApiAgentCardView,
  ApiApp,
  ApiAppOptions,
  ApiAuthInput,
  ApiCompanyView,
  ApiCredentialClass,
  ApiEndpointSpec,
  ApiEnv,
  ApiEventFeed,
  ApiEventFeedItem,
  ApiEventFeedPage,
  ApiFinanceSegment,
  ApiFinanceSource,
  ApiFinanceView,
  ApiHookSource,
  ApiIntakeAuthResult,
  ApiIntakeAuthenticator,
  ApiIssuePage,
  ApiIssueQuery,
  ApiIssueView,
  ApiObservationReadFace,
  ApiOrgDepartmentView,
  ApiOrgView,
  ApiPeopleGroup,
  ApiPeopleView,
  ApiProjectView,
  ApiReadSources,
  ApiReportEntry,
  ApiRouteDeps,
  ApiStateCount,
  ApiSubscriptionPolicy,
} from './types.ts'
