/**
 * Studio Next · gateway —— 写路径收口闸（v0.5 关键件，docs/17-§7）
 *
 * 组成（纯逻辑零 IO；唯一依赖 node:crypto 内建 + zod/contract）：
 *   - wkey.ts     按单凭据：签发/校验（fail-closed 全家）/关单吊销/控制面 key
 *   - actions.ts  动作词结构化校验（@action 行首冻结格式）+ 中文自由批示判定（只标记）
 *   - signature.ts 署名注入 [公司·部门·岗位·级别]（SignedBody v1.2，author=工号）
 *   - gateway.ts  门面：gateWrite = verify → parseAction → signedBody 的写路径闸
 *   - root-delegation.ts root_delegation 验签/指纹/期限/范围 preflight（SEC-ROOT-02/05 判定腿）
 *
 * 协议依据：docs/17-§7（写入全收口）、docs/24-§二（GATEWAY_ACTIONS=内部 MCP 工具集同一张表，
 * 状态推进永不在表内）、docs/25-§4.1（WkeyClaims/SignedBody 冻结形状）。
 *
 * TODO / 拟稿待批（详见各文件头注）：
 *   [ ] nonce 已见集合内存化 → 生产换 store 持久化；单次有效 vs MCP 复用的相容方案
 *   [ ] ttl 格式（<正整数><s|m|h|d> 单段）与 secret 门限（>=32B）定值
 *   [ ] 署名级别展示形态（数字直写 vs L 前缀）
 *   [ ] gateWrite 自由中文前置短路的顺序与任务书字面（先 verify 后 parse）的偏差已声明
 *   [ ] 控制面 wkey 保留单号 CONTROL_TICKET 的命名
 */
export * from './wkey.ts'
export * from './actions.ts'
export * from './signature.ts'
export * from './gateway.ts'
export * from './root-delegation.ts'
