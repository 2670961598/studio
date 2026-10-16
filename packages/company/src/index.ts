/**
 * Studio Next · company —— 公司目录引擎
 *
 * 定位（docs/04，需求 C1/C2）：公司 = 代码外部的一个 git 目录；目录即 API。
 *
 * 职责：
 *   - 目录契约校验：org-config.yaml + departments 嵌套 config.yaml + people 档案 +
 *     reports/ docs/ prompts/ .studio-next.yaml；结构不合法给 **文件:行 + 修法**（04-§九）
 *   - 挂载：`serve --company <dir>`，可挂多家；校验不过拒绝启动
 *   - 模板与建议，不写死：目录结构/部门模板/报表约定/等级映射/定时岗配置全是默认模板，公司可覆盖
 *   - 定时岗调度源（D9 通用模型）：一切唤起都是定时任务，挂在部门节点下；
 *     报表岗/财务审查/人事审查/项目审查/惊动预算检查都只是这个模型的实例（04-§三）
 *   - 报表逐级聚合：叶子 → 部门 → 公司 → 总览，每层只读下层文件按约定归并，不跳级；
 *     数字从 SQLite 台账取，文字由负责 agent 写（零自评指标）
 *   - 配置漂移看门狗：配置 ↔ 代码能力 ↔ 未提交改动，只读确定性、零 LLM
 *   - 公司目录写路径：daemon 唯一写入者（人事变动/报表/配置落盘挂单 commit）
 *
 * 模板：`templates/company-2-level/`（2 级公司，最小可用公司目录）。
 *
 * TODO(骨架阶段)：
 *   [ ] zod schema：org-config / 部门 config / 人事档案 front-matter / .studio-next.yaml
 *   [ ] 校验器：错误定位到 文件:行 + 给出修法
 *   [ ] 挂载器：加载 → 校验 → 汇总为内存快照 → 供 prompt/store 消费
 *   [ ] 定时岗装载：目录配置 → jobs 表（热更一个岗不影响其他岗）
 *   [ ] 报表聚合器：按 `<date>-<type>-<节点>-<一句话>.md` 约定归并
 *   [x] init 脚手架：从 templates 生成新公司目录（v0.1-M3，src/init.ts）
 *   [ ] schema 版本迁移脚本（migrate，由 daemon 执行、挂单留痕、可 git revert）
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/company";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";

// 目录契约校验器 v0（docs/04-§二/§九；docs/25-§3.5 目录端口）
export * from './validator.ts'

// init 脚手架 + 目录读取壳（v0.1-M3，docs/16-§四 验收口径「init 出模板公司并通过自检」）
export * from './init.ts'
