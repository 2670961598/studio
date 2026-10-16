/**
 * Studio Next · studio-tools —— 内部 MCP server（v0.7+ 工具能力层对内第一块，docs/24-§二）
 *
 * 组成：
 *   - tools.ts   工具表单一事实源：STUDIO_TOOLS ↔ GATEWAY_ACTIONS 一一对应；
 *                typed input/output schema + 两级错误分类 + deps 注入形状
 *   - server.ts  createStudioToolsServer：McpServer 工厂（六工具注册/wkey 初始化注入
 *                fail-closed/网关拒绝码透传）+ withInitWkeyCapture transport 包装
 *
 * 协议依据：docs/24-§二（工具集=网关白名单的机器化、AGENTS.md 只教「什么时候用哪个」、
 * 状态推进永不在工具集）、docs/25-§4.1（GATEWAY_ACTIONS 与 studio-tools 同一张表）、
 * docs/16-§二（MCP 锁 @modelcontextprotocol/server 2.x 线）。
 *
 * TODO / 拟稿待批（详见 server.ts 头注）：
 *   [ ] wkey nonce 单次有效 vs MCP 会话复用的相容方案（沿 gateway/wkey.ts 疑点）
 *   [ ] evidence-write 大正文内联过闸的体积上限
 *   [ ] initialize _meta wkey 键名 'studio-wkey' 定名
 */
export * from './tools.ts'
export * from './server.ts'
