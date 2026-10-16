/**
 * Studio Next · contract —— 契约包（规格测试的唯一标尺）
 *
 * 定位（docs/16-§一 / docs/17-§9、§13，需求 F2-14）：
 *   - 契约 = 新系统的规格测试标尺：语言无关的 cases.json（格式规范见 CASES.md，v1 已冻结）
 *   - 端口与协议类型（docs/25）：全部并行开发的共享接口面
 *   - runner 只跑契约，不跑实现细节；契约分级见 docs/08-§三
 *
 * TODO：
 *   [ ] schemas/：events 枚举、REPORT 骨架、work_records（docs/17-§3、§9）
 *   [ ] 崩溃注入用例集（5 个 kill 点，F3-11）
 *   [ ] 双 runner（语言无关证明）
 */

/** 包名常量（占位导出：让 import 图与 workspace 解析在骨架阶段即可验证） */
export const PACKAGE_NAME = '@studio-next/contract'

// 端口与协议（docs/25-端口与协议.md）——全部并行开发的共享接口面
export * from './ports/index.ts'

// 契约格式与运行器（CASES.md v1）
export * from './cases-schema.ts'
export * from './runner.ts'
