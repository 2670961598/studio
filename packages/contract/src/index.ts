/**
 * Studio Next · contract —— 契约包（占位）
 *
 * 定位（docs/16-§一 / docs/17-§9、§13，需求 F2-14）：
 *   - 契约 = 新系统的**规格测试**标尺：语言无关的 cases.json（稳定 id + 恰一 in/out/err + `__NULL__` 哨兵）
 *   - JSON Schema 描述三种格式：YouTrack 写入格式、文件产物格式（REPORT/summary.json）、SQLite schema
 *   - runner 只跑契约，不跑实现细节；契约分级见 docs/08-§三（experimental/beta/stable/deprecated）
 *   - 崩溃注入五点（kill 点回归集）也落在这里（需求 F3-11）
 *
 * TODO(骨架阶段)：
 *   [ ] cases/ 语料目录与 cases.json 清单（稳定 id、恰一 in/out/err）
 *   [ ] schemas/：events 枚举、REPORT 骨架、work_records、error 两级分类（docs/17-§3、§9）
 *   [ ] runner：vitest 侧 30 行 runner（双栈共跑的理由只剩"契约语言无关"）
 *   [ ] 崩溃注入用例集（5 个 kill 点）
 *   [ ] 契约变更纪律：改契约 = 走批示 + 版本号（禁实现反向改契约）
 */

/** 包名常量（占位导出：让 import 图与 workspace 解析在骨架阶段即可验证） */
export const PACKAGE_NAME = "@studio-next/contract";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
