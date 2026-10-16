/**
 * Studio Next · localplatform —— LocalFile 协作平台（v0.1）
 *
 * 定位（docs/23-§一）：FlowPlatform 端口的**文件驱动第二实现**，同时满足三个目的：
 *   P8 的零依赖 demo 模式、契约测试的靶子、端口有效性的证明。
 * YouTrack = 参考实现（packages/yt）；本包与其只共享 contract 端口类型，零 import。
 *
 * 形态（docs/23-§一定调）：单据=jsonl 事件流、状态=末次 transition 派生、评论=md 追加；
 * 全局 activity.jsonl 单调递增 id，游标=「最后见过的活动 id」边界（不透明 string）。
 *
 * 设计约束与假设（v0.1）：
 *   - **零外部 npm 依赖**：仅 node:fs + @studio-next/contract（类型），Node 24 原生
 *     type-stripping 直接可跑（P8 demo：不装任何东西即可跑通 TTHW）
 *   - **并发安全 v0 按「单 daemon 写」假设**（docs/04 唯一写入者）：无文件锁、append
 *     直写；出现第二写入者时的升级路径=锁文件/写队列+原子 rename
 *   - **guard 仅落盘不执行**（LocalFile 是契约靶子；规则在 meta/guards.json 供查阅/迁移）
 *   - **kb search 是子串匹配**（标题/路径/正文，大小写不敏感）；升级路径=倒排索引/FTS
 *   - IssueQuery.project 过滤维忽略（LocalFile 是单项目平台，且端口无处读写 project——
 *     端口疑点已上报，不改 contract）
 *
 * 端口疑点（只记录，不改 contract——plat 域 cases 由主泳道晋升时补）：
 *   1. IssueQuery.project 无处可读：IssueRecord / IssueCreate 均无 project 维
 *   2. IssueCreate.description 可写但 IssueRecord 无此字段，get() 查不回（本实现事件留痕）
 *   3. SignedBody 无独立 author，Comment.author 只能从 signature 派生（本实现取 signature 全文）
 *   4. PlatformActivity.issue 必填——kb/fields/guards/links 的变更进不了活动流
 *   5. 写方法无 actor 参数——活动归因只能靠上游 gateway/wkey 上下文（本实现仅评论带 actor）
 *   6. FieldProvisionMap 不带字段类型，provision 后 schema() 只能标 'string'
 *   7. guards 按 company 键安装，但 transition() 无 company 上下文，端口层无法按公司执行 guard
 */
export { createLocalPlatform } from './platform.ts'
export type { LocalPlatformOptions } from './platform.ts'
export { LocalPlatformError } from './errors.ts'
export { DEFAULT_INITIAL_STATE } from './issues.ts'
export { DEFAULT_PAGE_SIZE, formatActivityId, parseActivityId } from './activity.ts'

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/localplatform'

/** 状态标记 */
export const PACKAGE_STATUS = 'ready'
