/**
 * Studio Next · yt —— YouTrack 适配器：FlowPlatform 端口的参考实现（v0）
 *
 * 定位（docs/23-§一）：bundle/agiles/guard JS 等 YouTrack 特性全部封装在本适配器内不外泄；
 * 框架核心零 `if platform`，只 import @studio-next/contract 端口类型（25-§一.2）。
 * 自研薄客户端 fetch+zod（16-§二 选型定稿），零真实网络测试（fake fetch 回放），
 * 真实例冒烟=独立集成单。
 *
 * 本切片 v0 边界与显式缺口（明报不静默）：
 *   - guards.install/uninstall/read → 抛 CONFIG_INVALID/yt-guards-not-implemented（YouTrack
 *     workflow JS 与角色/权限读取面是独立大件，N6；23 允许分步；read 位为 v1.6 修订刀新增）
 *   - fields.provision → 仅实例内热换绑；平台侧建字段（N10 onboard）未做，见 fields.ts
 *   - 超时/重试/限流不做（errors.ts 头注）
 *   - setField('parent') 只挂链不换链（删旧链留集成单）
 *
 * 拟稿待批点（只记录，待制作人/宰相裁决）：
 *   1. 构造参数 project：docs/25-§3.2 只说「公司/项目绑定在构造时注入」，未给字段名；
 *      create() 在 YouTrack 侧必须有项目（N1 公司=项目），本实现以可选 opts.project
 *      落地，缺它时 create 显式报 missing-project-binding。建议端口文档补一笔。
 *   2. opts.clock 预留未用（服务器时间戳权威）；若上游坚持注入时钟需先定语义。
 *   3. 活动游标双形态兼容：规范形=base64url({v,last})（nextCursor 产出），
 *      裸活动 id 形（^\d+-\d+$）也认——对齐 localplatform 基线的调用惯例
 *      （轮询方拿 items 末条 id 续问）。建议契约层冻结「调用方该用哪种」。
 *      另：nextCursor=null 且 items 非空时，调用方只能凭末条 id 续问——
 *      端口若想完全自洽，可考虑「items 非空必给 nextCursor」语义（localplatform 同款问题）。
 *   4. since(null)=全量对账模式，返回**最旧 pageSize 条**（非最新一批）——2026-10-17
 *      宰相探针曾误读为「最新批」。建议 docs/25-§3.2 游标语义补一句：
 *      「cursor=null 返回自最旧起的对账全量（靠 nextCursor 翻到最新）；增量语义
 *      只对 since(边界) 成立」。行为与返回结构不动，纯措辞强化（activity.ts 头注同步）。
 *
 * 协议/文档疑点（v1.6 修订刀已裁决两项，2026-10-19，docs/25-§3.2）：
 *   1. ~~kind 词表未冻结~~ **已冻结**：PLATFORM_ACTIVITY_KINDS 六词（created/commented/
 *      transitioned/field-set/change/unknown）——本实现未知类别不再透传，归 unknown 兜底
 *   2. ~~actor 语义两实现不一致~~ **已定案（选A）**：actor=平台侧可归因主体（平台账号
 *      login）；工号翻译归框架侧（公司目录账号映射表 docs/04-§五），翻译机制归后续刀
 *   3. updatedSince 查询发 `updated: <iso> .. *` 开区间语法（docs/03 白名单只实测过
 *      `created: a .. b` 闭区间），下界含等风险已由客户端严格后滤兜平；开区间语法本身待真实例验证
 *   4. activities 端点默认排序=新→旧的假设待真实例验证（本实现把响应顺序当权威顺序，
 *      不发任何排序参数——N10：未知参数会被静默丢弃）
 *   5. POST /api/issues/{src}/links/{typeId}/issues/{tgt} 的确切形态待真实例验证
 *   6. $top/$skip 偏移分页在服务端数据并发变更时可漏可重（v0 已知局限，activity
 *      全量对账模式兜底）
 */
export { createYouTrackPlatform, type YouTrackPlatformOptions } from './platform.ts'
export { YouTrackPlatformError } from './errors.ts'
export type { FetchLike } from './http.ts'
export { DEFAULT_PAGE_SIZE, encodeCursor, decodeCursor } from './activity.ts'

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/yt'

/** 状态标记（guards 显式缺口见头注，不静默） */
export const PACKAGE_STATUS = 'ready'
