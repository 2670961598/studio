/**
 * Studio Next · panel/external —— :8788 对外 API（v0.9 首刀：信息/触发端点骨架；独立入口）
 *
 * 定位（docs/16-§四 v0.9、docs/17-§8、docs/25-§4.2、docs/00-§四 D4/D5/D6）：
 * 信息端点（company/org/people/projects/issues/finance/reports，全 GET 全公开）+ 触发端点
 * /v1/requests（X-SN-Token 必带，**只落单不派工**，幂等键防重）+ /v1/agent-card（名片带版本）
 * + SSE 订阅 v0 占位（501）。越权调用全部 fail-closed（无凭证 401/坏凭证 403/配额超限 429）。
 * 分层与 :8787/:8789 同款：views.ts 纯投影层（零 IO 零 Hono）+ server.ts 服务器层
 * （路由/凭证/配额/幂等/监听壳）。零新依赖；公司目录装载与平台写闸归 wiring 侧（apps/daemon bin）。
 */
export {
  CONTACT_MISSING_NOTE,
  EXTERNAL_ENDPOINTS,
  FRAMEWORK_VERSION,
  REPORTS_BODY_NOTE,
  buildAgentCard,
  buildIdempotentValue,
  buildProjectCards,
  deptView,
  filterIssues,
  issueView,
  orgWarns,
  parseIdempotentValue,
  personView,
} from './views.ts'
export type { AgentCard, EndpointSpec, IdempotentValue, IssuesQuery, ProjectCard, ReportFile } from './views.ts'

export {
  CLIENT_KEY_HEADER,
  DEFAULT_EXTERNAL_PAGE_SIZE,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_REQUESTS_PER_MINUTE,
  EXTERNAL_REQUEST_TYPE,
  IDEMPOTENCY_KV_PREFIX,
  MAX_REQUEST_BODY_BYTES,
  QUOTA_WINDOW_MS,
  TOKEN_HEADER,
  createExternalApp,
  serveExternal,
} from './server.ts'
export type {
  ExternalApp,
  ExternalAppOptions,
  ExternalCompanySource,
  ExternalHandle,
  ExternalPlatformWrite,
  ServeExternalOptions,
} from './server.ts'
