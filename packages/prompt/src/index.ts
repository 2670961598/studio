/**
 * Studio Next · prompt —— 提示词组装器（L0-L5 → AGENTS.md + 任务书 + 分层指纹）
 *
 * 定位（docs/17-§5，需求 C2）：把分层内容组装成**抗压缩**的持久指令与任务书。
 *
 * 分层（六层定序，层间不可混淆，有定界标记）：
 *   L0 框架（基本法/红线/证据契约/工具规范，随发版）
 *   L1 公司（使命/方向/战役 ← 公司目录 prompts/）
 *   L2 组织（部门/岗位/汇报线/署名 ← org-config + 部门 config）
 *   L3 个人（人事档案事实段摘要 ← people/<工号>.md）
 *   L4 项目（任务书 + 冻结验收口径 + 同类教训 top-k）
 *   L5 工具（executor 能力声明 + 插件 manifest）
 *
 * 产物：
 *   - `AGENTS.md`（生态标准名，抗 auto-compact）：落点优先走各家**用户级通道**；
 *     若落仓内工作区根，禁止覆盖已有 AGENTS.md（改名或先备份 + `.git/info/exclude`）
 *   - 任务书两版：首次版 / 续跑版（续跑版含前情摘要 = 上次 summary.json，≤300 字）
 *   - 分层指纹 `W-<fwk>/co.<rev>/org.<rev>/p.<工号>.<rev>/t.<单号>.<att>/ex.<adapter>@<ver>` 记账
 *
 * 纪律：
 *   - 组装确定性：同输入同 bytes（同输入双跑 sha 相同）
 *   - 稳定层前置、易变层后置（利于 prompt cache）
 *   - 超长裁剪优先级：永不裁 = 红线 / 证据契约 / 验收口径 / 署名
 *   - 网页可编辑内容按**不可信输入**隔离（引用块包裹 + 剥离命令形态行 + 记事件）
 *   - 纯逻辑零盘 IO：一切内容参数注入，落盘归 daemon
 *
 * TODO(后续刀次)：
 *   [x] 六层组装器骨架 + 定界标记常量（layers.ts）
 *   [x] AGENTS.md 渲染器（含"生成物勿手改"标记）——通道探测与落盘归 daemon/adapters
 *   [x] 任务书模板（首次版 / 续跑版）+ summary.json sidecar 注入（brief.ts）
 *   [x] 分层指纹计算（C2-08 冻结式；记账接口归 daemon）
 *   [x] 裁剪器（超长时按优先级裁剪并输出裁剪清单，trim.ts）
 *   [x] 不可信输入消毒器（sanitize.ts）
 *   [ ] 末级裁剪：L3 自述与 L5 长文档转按需检索（C2-09 末级——检索机制，非文本裁剪）
 *   [ ] prompt cache breakpoint 各 executor 支持度实测（docs/01-C2 开放问题）
 */

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/prompt'

/** 包状态：装配管线首刀已落（分层/指纹/组装/裁剪/隔离/两模板）；daemon 接线未落 */
export const PACKAGE_STATUS = 'partial'

// 不可信输入隔离（C2-10）
export * from './sanitize.ts'

// 分层模型 + 定界标记 + 分层指纹（C2-06/C2-08/C2-11）
export * from './layers.ts'

// AGENTS.md 组装（17-§5 / 04-§六）
export * from './assemble.ts'

// 超长裁剪器（C2-09 阶梯）
export * from './trim.ts'

// 任务书两模板（17-§5：首次版/续跑版）
export * from './brief.ts'
