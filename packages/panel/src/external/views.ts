/**
 * external views —— :8788 对外 API 纯投影层（零 IO 零 Hono，v0.9 首刀）
 *
 * 依据：docs/16-§四 v0.9（对外 API :8788 + Agent Card——「名片带版本」验收点）、
 * docs/17-§8（:8788 端面：信息端点 + 触发端点「只落单不派工」+ /v1/agent-card + SSE 订阅）、
 * docs/25-§4.2（EXTERNAL_AI_TOOLS 十名冻结——对外 MCP 的后续面；本刀做 HTTP 信息/触发端点骨架）、
 * docs/00-§四 D4/D5/D6（默认局域网｜人事全公开=信息面不限｜不收费、配额防滥用）。
 *
 * 本文件只放纯函数与常量（路由/凭证/配额/幂等归 server.ts）：
 *   - FRAMEWORK_VERSION：名片版本（=框架版本——统一版本常量的正式落位归契约包后续单，拟稿）
 *   - EXTERNAL_ENDPOINTS：端点清单（agent-card 端点表 + 根路径索引同源）
 *   - buildAgentCard：snapshot → 名片（name/slug/version/端点清单/联系位）
 *   - filterIssues：镜像行 → /v1/issues 分页投影（state 精确过滤 + limit 夹取）
 *   - buildProjectCards：镜像聚合 → /v1/projects 项目卡（N1「一公司一项目」）
 *   - parseIdempotentValue / buildIdempotentValue：幂等键 kv 值形态（issue+ts，TTL 读侧判）
 *
 * 投影复用纪律：财务三口径分列复用 overview/views.buildFinanceSnapshot（docs/26 C1，与 :8787
 * 成本卡同源口径——「对齐 8787 口径」的结构性保证）；进度聚合复用 buildProgressSnapshot；
 * 组织树悬空/成环标记复用 buildOrgTree。对外面不另立口径。
 */
import type { CompanySnapshot, DeptNode, PersonRef } from '@studio-next/contract'
import type { TicketMirrorRecord } from '@studio-next/store'
import { buildOrgTree, buildProgressSnapshot } from '../overview/views.ts'

/**
 * 框架版本（名片 version 字段出处——16-§四 v0.9「名片带版本」验收点）。
 * 【拟稿待批】统一框架版本常量的正式落位（contract 包或 root 单源）归后续单；
 * 当前取里程碑版本 v0.9（与仓内包 version 0.1.0 是两回事：前者=框架里程碑，后者=包私有版本）。
 */
export const FRAMEWORK_VERSION = '0.9.0'

/** 名片联系位缺失时的占位说明（org-config 无 contact 字段——拟稿见 buildAgentCard 注） */
export const CONTACT_MISSING_NOTE = '未提供（org-config.yaml 无联系位字段——契约面增字段走批示流）'

/** 端点规格（agent-card 端点清单条目；auth=none 对 D5 信息面不限，auth=token 对触发面凭证必带） */
export interface EndpointSpec {
  method: 'GET' | 'POST'
  path: string
  auth: 'none' | 'token'
  note?: string
}

/** :8788 端点清单（单一事实源：agent-card.endpoints 与根路径索引同源生成） */
export const EXTERNAL_ENDPOINTS: readonly EndpointSpec[] = [
  { method: 'GET', path: '/v1/agent-card', auth: 'none', note: 'Agent Card（org-config/snapshot 生成，带版本）' },
  { method: 'GET', path: '/v1/company', auth: 'none', note: '挂载公司清单（发现入口）' },
  { method: 'GET', path: '/v1/org', auth: 'none', note: '?company=<slug> 组织树（悬空/成环如实标记）' },
  { method: 'GET', path: '/v1/people', auth: 'none', note: '?company=<slug> 人事派工索引（D5 全公开）' },
  { method: 'GET', path: '/v1/projects', auth: 'none', note: '项目卡（N1 一公司一项目；镜像按状态聚合）' },
  { method: 'GET', path: '/v1/issues', auth: 'none', note: '?state=&company=&limit= 单据读面（ticket_mirror）' },
  { method: 'GET', path: '/v1/finance', auth: 'none', note: '?company=<slug> 成本三口径分列（对齐 :8787 口径）' },
  { method: 'GET', path: '/v1/reports', auth: 'none', note: '?company=<slug> 报表文件清单（正文 v0 不出——待批）' },
  { method: 'POST', path: '/v1/requests', auth: 'token', note: '外部需求落单（X-SN-Token 必带；只落单不派工；幂等键防重）' },
  { method: 'GET', path: '/v1/events', auth: 'none', note: 'SSE 订阅 v0 占位（501——subscription 语义归后续刀）' },
]

/** /v1/agent-card 名片形状（17-§8：org-config 生成，带版本/有效期——有效期 v0 暂无字段，拟稿） */
export interface AgentCard {
  framework: 'studio-next'
  name: string
  slug: string
  /** 框架版本（FRAMEWORK_VERSION——验收点「名片带版本」） */
  version: string
  /** 协作平台绑定（snapshot.platform.platform——23-§二 换平台=改一行配置） */
  platform: string
  endpoints: ReadonlyArray<EndpointSpec>
  /** 联系位（可选注入——org-config 无此字段，拟稿注入位；缺省=CONTACT_MISSING_NOTE 占位如实说明） */
  contact: string
}

/**
 * snapshot → Agent Card。
 * 【拟稿待批】①contact：契约 CompanySnapshot/org-config 无联系位字段，本刀以注入位承接
 * （wiring 侧可不给——名片如实显示「未提供」占位）；②version：暂取 FRAMEWORK_VERSION
 * （框架版本，非公司版本）；③有效期（17-§8「带版本/有效期」）：v0 无字段可取，暂缺，
 * 待 org-config 契约面批示后补。
 */
export function buildAgentCard(snapshot: CompanySnapshot, opts?: { contact?: string; version?: string }): AgentCard {
  return {
    framework: 'studio-next',
    name: snapshot.name,
    slug: snapshot.slug,
    version: opts?.version ?? FRAMEWORK_VERSION,
    platform: snapshot.platform.platform,
    endpoints: EXTERNAL_ENDPOINTS,
    contact: opts?.contact ?? CONTACT_MISSING_NOTE,
  }
}

// —— /v1/issues（ticket_mirror 读面） ——

/** /v1/issues 查询语义（与 :8787 clampLimit 同风格：limit 夹取归 server） */
export interface IssuesQuery {
  /** 状态精确过滤（缺省=全部） */
  state?: string
  /** 公司维过滤（缺省=全部挂载公司） */
  company?: string
  limit: number
}

/** /v1/issues 分页投影：镜像行（store 冻结序 updated ASC）→ state 过滤 → 截 limit */
export function filterIssues(mirrors: readonly TicketMirrorRecord[], query: IssuesQuery): TicketMirrorRecord[] {
  let rows = mirrors
  if (query.company !== undefined) rows = rows.filter((m) => m.company === query.company)
  if (query.state !== undefined) rows = rows.filter((m) => m.state === query.state)
  return rows.slice(0, query.limit)
}

/** /v1/issues 单行的对外投影（全列直出——镜像本就是可重建投影，无敏感列；D5 信息面不限） */
export function issueView(m: TicketMirrorRecord): Record<string, unknown> {
  return { ...m }
}

// —— /v1/projects（N1 一公司一项目） ——

/** 项目卡：公司维 + 该司镜像单据聚合（byState=count 降序、同数按状态名稳定序——与进度面同序） */
export interface ProjectCard {
  company: string
  name: string
  platform: string
  /** 本司镜像单据总数 */
  total: number
  byState: Array<{ state: string; count: number }>
}

/** 镜像聚合 → 项目卡列表（挂载公司序；镜像复用 buildProgressSnapshot 聚合口径——拷贝入参适配可变数组签名） */
export function buildProjectCards(snapshots: readonly CompanySnapshot[], mirrors: readonly TicketMirrorRecord[]): ProjectCard[] {
  const rows = [...mirrors]
  return snapshots.map((s) => {
    const progress = buildProgressSnapshot(rows, s.slug)
    return { company: s.slug, name: s.name, platform: s.platform.platform, total: progress.total, byState: progress.byState }
  })
}

// —— /v1/org 与 /v1/people 的对外投影 ——

/** 部门行（DeptNode 直出；relations 含跨部门关系正文——组织面全公开） */
export function deptView(d: DeptNode): Record<string, unknown> {
  return { ...d }
}

/** 悬空/成环警告文案（buildOrgTree 的诚实标记 → JSON warns 位；与 overview /org 同判据） */
export function orgWarns(snapshot: CompanySnapshot): string[] {
  const tree = buildOrgTree(snapshot.departments)
  const warns: string[] = []
  if (tree.promoted.length > 0) {
    warns.push(`悬空父引用（parent 不在部门集，已提升为根）：${tree.promoted.map((d) => d.path).join('、')}`)
  }
  if (tree.cyclic.length > 0) {
    warns.push(`parent 链成环（从根不可达，已提升为根）：${tree.cyclic.map((d) => d.path).join('、')}`)
  }
  return warns
}

/** 人事行（PersonRef 直出：工号/姓名/login/等级/部门——D5 全公开=信息面不限） */
export function personView(p: PersonRef): Record<string, unknown> {
  return { ...p }
}

// —— /v1/reports（报表文件清单） ——

/** 报表清单条目（正文 v0 不出——头注待批：报表面=文件名+大小，内容端点待批示） */
export interface ReportFile {
  file: string
  bytes?: number
}

export const REPORTS_BODY_NOTE = '报表正文 v0 不出（文件清单先行——内容端点与口径待批示后开）'

// —— 幂等键 kv 值形态（store daemon_kv：external:idem:<slug>:<key> → {issue, ts}） ——

/** 幂等记录（kv 值 JSON 形态） */
export interface IdempotentValue {
  issue: string
  /** 落单时刻 epoch ms（TTL 读侧判据——kv 无原生 TTL，过期即视为 miss 并可覆盖） */
  ts: number
}

/** kv 值序列化（canonical：固定键序，同值恒同字节——与 store canonical 风格一致） */
export function buildIdempotentValue(issue: string, ts: number): string {
  return JSON.stringify({ issue, ts })
}

/**
 * kv 值解析：坏值（旧格式/手改）→ undefined（视为 miss，调用方覆盖重写）。
 * 解析而非抛错：幂等面是防重优化不是正确性闸——坏值最多导致一次重复落单，
 * 由「返回单号一致性」兜底可见，不拒服务（fail-open 于坏值、fail-closed 于越权——两码事）。
 */
export function parseIdempotentValue(raw: string | null): IdempotentValue | undefined {
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const obj = parsed as Record<string, unknown>
    if (typeof obj['issue'] !== 'string' || obj['issue'] === '') return undefined
    if (typeof obj['ts'] !== 'number' || !Number.isFinite(obj['ts'])) return undefined
    return { issue: obj['issue'], ts: obj['ts'] }
  } catch {
    return undefined
  }
}
