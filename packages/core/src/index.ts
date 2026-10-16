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
 * v0.7 增量（feature/core-budget，预算链纯逻辑；16-§三 预算行 / 20-§六.8 / F1-09）：
 *   [x] BudgetRow（对齐 store budgets 列，拟升 contract）+ 纯折叠 foldBudgets
 *       （行流→每票/每人净预留视图 + ticket→person 桥重建）——budget.ts
 *   [x] reserve 判定面（重复预留拒 / 票级帽+岗级帽超帽落 refusal 行；预留不落即不派）
 *   [x] settle（冲销该票全部未结预留，成本按每成功交付记账；无预留可结=CONFIG_INVALID）
 *
 * v0.10 增量（feature/core-evolution，进化管线+健壮性首刀；16-§四 v0.10 / 02-F3 / 20-§九）：
 *   [x] 候选制品谱系纯逻辑（CandidateRecord 对齐 17-§3 candidates 列；draft→…→retired
 *       状态机非法迁移显式拒；parent_id 链 fork-only + 环/断链 fail-closed；同
 *       asset_path×diff_hash 幂等提案）——evolution.ts
 *   [x] 三态闸门纯决策 gate()（approve/reject/escalate，fail-closed；判据类资产恒
 *       escalate——L4 宪法锁死非策略项，08-§五 D8 护栏外置）——evolution.ts
 *   [x] 「无 candidate id 的生产改动判负」判定面 assertChangeAuthorized()
 *       （CONFIG_INVALID/evolve/unauthorized + nearMisses 诊断）——evolution.ts
 *
 * TODO（后续刀）：
 *   [ ] 主循环相位机骨架（每相位幂等、tick 聚合结构化 actions 落账）
 *   [ ] 泳道租约状态机本体（TTL+续租+死主回收的纯逻辑核）
 *   [ ] 预算链 store 对接（appendBudget/queryBudgets 喂 foldBudgets；扇出不超父单预留 F1-09）
 *   [ ] 收割四要件判定纯函数（17-§6）
 *   [ ] golden trace 格式升 contract 包（F3-01 进化管线）
 *   [ ] 进化管线 daemon 接线：store candidates 表 migration、沙箱执行器、灰度/切权/
 *       复盘、判负面挂主循环与网关写径（evolution.ts 头注「后续刀」清单）
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

// 预算链纯逻辑（16-§三 预算行 / 20-§六.8 / F1-09：reserve→settle→refusal）
export * from './budget.ts'

// 进化管线纯逻辑（16-§四 v0.10 / 02-F3 / 20-§九：候选谱系+三态闸门+判负面）
export * from './evolution.ts'

/** 包名常量 */
export const PACKAGE_NAME = '@studio-next/core'

/** 包状态标记：状态机/决策/断路/处置/golden/模型档/预算链已落地（partial）；主循环待后续刀 */
export const PACKAGE_STATUS = 'partial'
