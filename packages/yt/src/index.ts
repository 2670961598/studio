/**
 * Studio Next · yt —— YouTrack 客户端（占位）
 *
 * 定位（docs/03、docs/17-§7，需求 F2-10 / Y-N 系列）：
 *   - 自研薄客户端：fetch + zod 校验，不引重型 SDK；平台是内部实现，对外零 YouTrack 凭证（N12）
 *   - 增量采集：活动流游标（持久化起点 + 最后活动 id 去重双保险），全量 list 降为对账
 *   - 写入全收口：一切写入经 wkey 网关（按单签发 / 关单吊销 / scope+TTL+nonce / fail-closed），
 *     署名 `[公司·部门·岗位·级别]` 由网关注入，agent 永不直连（docs/04-§五）
 *   - 动作词结构化（枚举 + zod），中文自由批示保留 LLM 回退解析（docs/17-§7）
 *   - 读面分级：Full / Focused / Blind（验证岗用 Blind，防生成者上下文污染）
 *   - 字段/状态流全部是**默认模板**：公司目录可整体替换（N2-N5、D12）
 *
 * 平台实测约束（写码时别踩）：无 webhook（404）；角色权限无写 API；分页必须 $top/$skip；
 * 未知参数被静默丢弃（探测代码必须对照返回值自证生效，见 docs/独立复核与可行性验证-2026-10-16.md §3.2）。
 *
 * TODO(骨架阶段)：
 *   [ ] 客户端骨架：认证、重试、限流、错误映射（两级错误分类）
 *   [ ] 活动流增量采集器（游标持久化接口 + 去重边界）
 *   [ ] 字段/状态流映射加载（org-config.yaml 的 yt 段覆盖）
 *   [ ] wkey 网关客户端（按单签发、吊销、署名注入）
 *   [ ] onboard 工作面：项目/bundle/字段/workflow/板/团队/KB 根（幂等 + --dry-run + --rollback）
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/yt";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
