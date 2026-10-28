/**
 * packages/api/src/catalog.ts —— API- 端点清单单一事实源（API-01..16）
 *
 * 依据：docs/v2/14 §四端点族表（API-01..16 语义与状态）；docs/v2/16 §三 api 行
 * （API- 端点与视图序列化唯一源＝packages/api/src/）。
 *
 * 纪律：
 *   - Agent Card（API-09）的端点表与路由挂载同源——端点数/路径从本件生成，避免
 *     「名片说有一套、路由跑另一套」的双源。
 *   - 值集（auth 三档）引 v2/14 §四凭证三档：public 只读面＝`none`（公开读）、
 *     partner/signed 才可落单；hooks 仅 signed；订阅登记需 partner/signed。
 *   - 本件只是 API 目录，不登记 PORT-/REC- 端口/记录类。
 */
import type { ApiEndpointSpec } from './types.ts'

/** 对外 API 的 16 个 API- 条目（API-16 的 POST/GET 同条） */
export const API_ENDPOINTS: readonly ApiEndpointSpec[] = Object.freeze([
  {
    id: 'API-01',
    method: 'GET',
    path: '/v1/company',
    auth: 'none',
    note: '公司维（?company= 读写同一解析规则；跨公司读隔离）',
  },
  {
    id: 'API-02',
    method: 'GET',
    path: '/v1/org',
    auth: 'none',
    note: '组织树投影（悬空/成环如实入 warnings，不静默补链）',
  },
  {
    id: 'API-03',
    method: 'GET',
    path: '/v1/people',
    auth: 'none',
    note: '人事默认只出聚合（无人员级明细槽）',
  },
  {
    id: 'API-04',
    method: 'GET',
    path: '/v1/projects',
    auth: 'none',
    note: '项目卡（只出挂载公司行）',
  },
  {
    id: 'API-05',
    method: 'GET',
    path: '/v1/issues',
    auth: 'none',
    note: '?state=&limit= 单据读面（可重建投影；只出挂载公司行）',
  },
  {
    id: 'API-06',
    method: 'GET',
    path: '/v1/finance',
    auth: 'none',
    note: '财务三源逐段列示（缺源=unknown，不补 0）',
  },
  {
    id: 'API-07',
    method: 'GET',
    path: '/v1/reports',
    auth: 'none',
    note: '报表文件清单（正文不出）',
  },
  {
    id: 'API-08',
    method: 'GET',
    path: '/v1/requests/status',
    auth: 'none',
    note: '回执查询（读投影快照；快照未命中=503 非 404）',
  },
  {
    id: 'API-09',
    method: 'GET',
    path: '/v1/agent-card',
    auth: 'none',
    note: 'A2A 名片（公司定义生成，带版本与有效期）',
  },
  {
    id: 'API-10',
    method: 'POST',
    path: '/v1/requests',
    auth: 'partner',
    note: '触发面：只产意图（202=已入队≠已受理；幂等键四槽）',
  },
  {
    id: 'API-11',
    method: 'POST',
    path: '/v1/explore',
    auth: 'partner',
    note: '触发面（同上；requestKind=explore）',
  },
  {
    id: 'API-12',
    method: 'POST',
    path: '/v1/tasks',
    auth: 'partner',
    note: '触发面（同上；requestKind=task）',
  },
  {
    id: 'API-13',
    method: 'POST',
    path: '/v1/intel',
    auth: 'partner',
    note: '触发面（同上；requestKind=intel）',
  },
  {
    id: 'API-14',
    method: 'GET',
    path: '/v1/events',
    auth: 'none',
    note: 'SSE 订阅（event id 去重＋Last-Event-ID 续传；未实装=501 带原因）',
  },
  {
    id: 'API-15',
    method: 'POST',
    path: '/v1/hooks/{source}',
    auth: 'signed',
    note: '入站签名（HMAC＋时间戳＋nonce＋重放窗＋载荷上限；产意图同触发面收口）',
  },
  {
    id: 'API-16',
    method: 'GET|POST',
    path: '/v1/subscriptions',
    auth: 'partner',
    note: '出站订阅登记/查询（allowlist＋SSRF 拒＋退避/死信策略随意图）',
  },
])

/** API 目录条目数（16 个 API-ID；API-16 的 POST/GET 同条） */
export const API_ENDPOINT_COUNT = API_ENDPOINTS.length
