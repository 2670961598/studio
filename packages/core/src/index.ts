/**
 * Studio Next · core —— 核心逻辑（纯逻辑零 IO）
 *
 * 定位（docs/17-§2、§6、§9、§10，需求 F1）：
 *   - 决策纯函数：`decide(input) → {action, intentKey}`，同状态同配置必同决策，
 *     golden trace 可回放（需求 F1-03）
 *   - 主循环相位机：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳，每拍幂等（F1-01）
 *   - 并发三闸：泳道租约（锁名不含 pid，TTL+续租+死主回收）/ 每拍派发上限 / 全局在途上限（F1-05）
 *   - 收割成功契约四要件：终态事件 completed ＋ 输出非空 ＋ REPORT 落盘 ＋ 闸门 exit=0（F1-06）
 *   - 预算 reserve→settle→refusal；断路器（同单同错误签名 3 连击）（F1-09、F1-10）
 *   - 错误分类两级枚举：类别 × 子因（docs/17-§9）+ 处置语义表（重试/退审/开单/熔断）
 *
 * 纪律：本包**零 IO**——不碰文件、网络、子进程；时间一律入参；一切外部世界经参数传入或
 *       返回值表达。IO 归 daemon/store/yt/adapters，这样 core 才能被契约测试完整覆盖
 *       （测试金字塔 T1/T2）。
 *
 * 本刀（v0.5 首刀，feature/main-core-decide）已落地：
 *   [x] 表驱动 FSM + 默认 flow_by_level 模板（L0/L1/L2，公司可覆盖传入替换）——flows.ts
 *   [x] decide 纯函数 + 结构化 Action 联合 + 理由码（拟升 contract）——decide.ts
 *   [x] 断路器纯逻辑（连击/熔断/复位，N 参数化）——breaker.ts
 *   [x] 错误处置语义表（11 类 × 四处置，全表拟稿待批）——dispositions.ts
 *   [x] golden trace 格式与回放器（格式即契约雏形）——golden.ts
 *
 * v0.6 增量（feature/core-models，模型档端口）：
 *   [x] models.yaml 装载（zod strict 闸 + yaml 行号定位）与 ModelCatalog 目录实现
 *       （tiers/resolve/estimateCost）+ 价目表内容指纹 fingerprint——models.ts
 *       （预算/价目表链地基：estimateCost 供 budgets reserve/settle 折算，17-§3 末）
 *
 * TODO（后续刀）：
 *   [ ] 主循环相位机骨架（每相位幂等、tick 聚合结构化 actions 落账）
 *   [ ] 泳道租约状态机本体（TTL+续租+死主回收的纯逻辑核）
 *   [ ] 预算预留-结算与 refusal 落点（消费 models.estimateCost）
 *   [ ] 收割四要件判定纯函数（17-§6）
 *   [ ] golden trace 格式升 contract 包（F3-01 进化管线）
 */

// 状态机（docs/18-§二）
export * from './flows.ts'

// 决策纯函数与 Action 联合（docs/17-§2；拟升 contract）
export * from './decide.ts'

// 断路器（docs/17-§6 末 / F1-10）
export * from './breaker.ts'

// 错误处置语义表（docs/17-§9）
export * from './dispositions.ts'

// golden trace 格式与回放器（F1-03 / F2-14；格式即契约雏形）
export * from './golden.ts'

// 模型档装载与目录（docs/25-§3.3 端口 / 17-§4 models.yaml；预算链地基）
export * from './models.ts'

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/core'

/** 包状态标记：状态机/决策/断路/处置/golden/模型档已落地（partial）；主循环与预算待后续刀 */
export const PACKAGE_STATUS = 'partial'
