/**
 * Studio Next · taiga —— Taiga 适配器：FlowPlatform 端口的第三实现（v0.1 首刀）
 *
 * 定位（docs/23-§一 + docs/30 §5 推荐 + docs/32 真机试点全绿）：制作人拍板采纳
 * Taiga 为默认协作平台；本包把 Taiga 平台差异全部封装在内，框架核心零 `if platform`。
 * 与 yt/localplatform 只共享 @studio-next/contract 端口类型（本包零 npm 依赖：
 * 原生 fetch + 手写窄校验，不引 zod）。
 *
 * 七能力覆盖表（首刀边界，明报不静默）：
 * | 能力     | 状态       | 说明 |
 * |----------|------------|------|
 * | issues   | ✅ 读写    | list/get（by_ref）/create/transition（PATCH status+version 乐观并发）；setField 支持 title/description/assignee + 映射自定义维 |
 * | comments | ✅ 读写    | 写=PATCH comment（含署名尾行）；读=history 条目过滤 |
 * | fields   | ✅ 读 / ⛔ 写 | schema()=状态集+自定义属性真源反射；provision 显式未实现（onboard 切片，docs/30 §6 ②⑥） |
 * | kb       | ✅ 读 / ⛔ 写 | get=wiki by_slug；search=列表拉全+子串匹配；upsert 显式未实现（POST /wiki 已实证，onboard 切片） |
 * | activity | ✅ 读      | history 逐实体合并轮询 + 不透明游标（边界=最后活动 id+ts；不可达=全量重放）；建单事件不进 history（实测）——webhook 主通道负责 |
 * | links    | ⛔ 骨架    | issue↔US 关联未实测（docs/32 §四待核项），显式报错待补测定版 |
 * | guards   | ✅ 读 / ⛔ 写 | readTaigaRoles() 暴露角色×permissions 数组（包级导出）；install/uninstall 显式未实现（角色收窄=onboard 切片） |
 *
 * 真机事实依据（docs/32，9000 端口 Docker 试点，2026-10-18）：
 *   JWT auth（type:normal）/ webhook HMAC-SHA1 / history 逐字段 diff+actor /
 *   roles permissions 数组 / 分页头 x-pagination-count|by|current（头名已核）
 *
 * 已知边界与显式 TODO：
 *   1. ~~custom-attributes-values 写端点真机未实测~~ **已实测修正（2026-10-18 首刀
 *      冒烟）**：POST 405 不通；正解 PATCH {attributes_values, version}，version 是
 *      值对象自身并发号（先 GET 取）；实体序列化器不回显属性值——读写都走专用值端点
 *   2. activity 建 created 类活动拿不到（history 不录建单）——webhook 主通道职责，
 *      轮询兜底只见变更/评论
 *   3. 评论读回 author=平台账号 username（JWT 操作者），非工号——与 localplatform
 *      口径不一致，端口缺口已记录
 *
 * 端口缺口报告（只记录不改 contract，对齐 localplatform 头注先例）：
 *   1. guards 面只有 install/uninstall 写方法，无读位——Taiga 的「权限收窄闸」
 *      素材（roles permissions）只能经包级导出 readTaigaRoles() 暴露
 *   2. PlatformActivity.actor 语义三实现不一致（localplatform=工号 / yt=平台账号
 *      login / taiga=平台账号 username）——建议契约层注明「actor=平台侧可归因主体」
 *   3. kind 词表未冻结：本实现归一 created(缺)/commented/transitioned/field-set
 *   4. IssueQuery.lane/level 过滤维依赖自定义属性映射——未映射时显式报错
 *      （Taiga 侧无原生 lane 概念，比 YouTrack 多一层映射依赖）
 */
export { createTaigaPlatform, buildContext, type TaigaPlatformOptions } from './platform.ts'
export { TaigaClient, type FetchLike, type TaigaAuth, type TaigaRequest } from './http.ts'
export { TaigaPlatformError } from './errors.ts'
export { DEFAULT_PAGE_SIZE, encodeCursor, decodeCursor } from './activity.ts'
export { readTaigaRoles, type TaigaRoleInfo } from './guards.ts'
export type { TaigaEntity } from './entities.ts'

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/taiga'

/** 状态标记（links 面与 provision/kb-upsert/guards 写面显式未实现，见头注覆盖表） */
export const PACKAGE_STATUS = 'first-cut'
