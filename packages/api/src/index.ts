/**
 * Studio Next · api —— 对外 API（占位）
 *
 * 定位（docs/17-§8、§11，需求 C3）：独立进程 / 独立端口（:8788）/ 独立凭证，默认局域网暴露。
 *
 * 边界（硬约束）：
 *   - 外部只能**落单**，不能派工：任何外部请求都不得直接产生 worker 进程
 *   - 派单人锚 + 等级封顶：外部世界无等级，缺省派单人=主 PM，等级按项目渐进启用封顶
 *   - 字段级视图分级：public / partner / internal 三套 zod schema，白名单式序列化
 *     （静态检查不得出现"直接序列化 DB 行"）
 *   - 凭证三档：公开（只读公开视图）/ 伙伴（ak-id.secret，哈希+last4，可 scope/吊销/TTL）/
 *     签名（HMAC + 时间戳 + nonce）；越权一律 fail-closed
 *
 * 端点族：
 *   信息面  /v1/company、/v1/org、/v1/people、/v1/projects/{pid}/progress、/v1/issues/{id}、
 *           /v1/finance/summary、/v1/reports、/v1/docs
 *   触发面  POST /v1/requests、/v1/explore、/v1/tasks、/v1/intel（幂等键 → 查重 → 落单 → 绑锚 → 署名）
 *   订阅    /v1/subscriptions（at-least-once + 幂等 + HMAC + 退避 + 熔断 + 死信）、
 *           /v1/events/stream（SSE 断线续传，按 event id 去重）
 *   名片    /v1/agent-card（由 org-config 生成，带版本与有效期）
 *   入站    /v1/hooks/*（签名校验 + 重放窗口 + payload 上限）
 *
 * 安全：出站白名单 + 密钥扫描 + 防 SSRF（硬禁内网/回环）；外部调用全落 events 可回放。
 * MCP 侧：对外只做 exporter / server 面，内部 schema 才是唯一事实源。
 *
 * TODO(骨架阶段)：
 *   [ ] Hono 应用骨架 + 凭证中间件（三档） + 视图分级序列化
 *   [ ] 信息面端点（OpenAPI 自动生成）
 *   [ ] 触发面端点（幂等键 + 派单人锚）
 *   [ ] SSE 订阅与断线续传
 *   [ ] Agent Card 生成器（org-config → 名片，带版本/有效期）
 *   [ ] MCP server 暴露面（@modelcontextprotocol/server）
 *   [ ] 出站白名单与密钥扫描
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/api";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
