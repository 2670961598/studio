/**
 * Studio Next · core —— 核心逻辑（占位，纯逻辑零 IO）
 *
 * 定位（docs/17-§2、§6、§9，需求 F1）：
 *   - 决策纯函数：`decide(state, level, type, lane_lease) → action`，同状态同配置必同决策，
 *     golden trace 可回放（需求 F1-03）
 *   - 主循环相位机：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳，每拍幂等（F1-01）
 *   - 并发三闸：泳道租约（锁名不含 pid，TTL+续租+死主回收）/ 每拍派发上限 / 全局在途上限（F1-05）
 *   - 收割成功契约四要件：终态事件 completed ＋ 输出非空 ＋ REPORT 落盘 ＋ 闸门 exit=0（F1-06）
 *   - 预算 reserve→settle→refusal；断路器（同单同错误签名 3 连击）（F1-09、F1-10）
 *   - 错误分类两级枚举：类别 × 子因（docs/17-§9）
 *
 * 纪律：本包**零 IO**——不碰文件、网络、子进程；一切外部世界经参数传入或返回值表达。
 *       IO 归 daemon/store/yt/adapters，这样 core 才能被契约测试完整覆盖（测试金字塔 T1/T2）。
 *
 * TODO(骨架阶段)：
 *   [ ] 状态机表驱动 FSM + zod 校验（迁移表默认模板见 docs/18-§二，公司可覆盖）
 *   [ ] 主循环相位机骨架（每相位幂等、tick 返回结构化 actions）
 *   [ ] 泳道租约与三闸
 *   [ ] 预算预留-结算与 refusal 落点
 *   [ ] 断路器与报错升级电路
 *   [ ] golden trace 回放器
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/core";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
