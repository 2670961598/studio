/**
 * Studio Next · adapters —— executor 适配器（占位）
 *
 * 定位（docs/18-§一，需求 F1-12/13/14）：框架与外部世界的**唯一接触面**，独立做、独立测、可单独发布。
 *
 * 四原语（基类抽象，四家差异全部收敛在各自文件内，调度器里不留 `if executor`）：
 *   detect()      版本 + 能力实测探测（launch 前必跑；不达标明报，绝不静默降级）
 *   estimate()    预算预留估算
 *   launch()      拉起（execa，killDescendants + forceKillAfterDelay）
 *   stream()      流式事件（各家 stdout 格式不同）
 *   resultStats() 成本/耗时/turns/tokens（无原生成本的按价目表折算）
 *   kill()        优雅终止（进程组 SIGTERM → 宽限 → SIGKILL）
 *
 * 已知坑（沉淀在各自文件注释与 fixture 测试里）：
 *   dsh    被 kill 后退出码=0 且 final 为空 —— 成功判定绝不能只看退出码（须 turn_end.completed + 输出非空）
 *   claude 版本门槛（AGENTS.md 原生读取需 ≥ 指定版本）；killpg TERM→KILL
 *   codex  无成本字段，成本按价目表折算
 *   kimi   usage 不在 stdout 而在 session wire.jsonl；`-p` 与 yolo/auto/plan 互斥
 *   通用   续跑（resume）各家机制不同，适配器必须声明是否支持；不支持则明报并降级为新派
 *
 * 纪律：一单一命，禁止嵌套转包；生产泳道禁运行时自装插件；每次派发的分层指纹照常记账。
 *
 * TODO(骨架阶段)：
 *   [ ] ExecutorAdapter 抽象基类 + ExecutorCapabilities 能力声明 schema（先定 schema 再谈实现，B7）
 *   [x] fake CLI harness（Node 脚本模拟各家 stdout/退出行为，test/fake-cli/）+ golden fixtures（test/fixtures/，四家流样本落库）
 *   [x] 流归一化器 streams.ts：parseStream 把四家原始流文本归一为 contract StreamEvent（对 fixture 全绿）
 *   [x] dsh 适配器首刀（对 fake harness 全绿；锁版本比对 + 通道 env 映射为拟稿，真 CLI 行为留探针单）
 *   [ ] claude 适配器（参考实现，含预算帽）
 *   [ ] codex / kimi 适配器
 *   [ ] 探针 runner：适配器写完先过探针集才允许注册
 */

/** 流归一化器：四家 CLI 原始流 → contract StreamEvent（docs/17-§6 / docs/18-§1.3） */
export * from "./streams.ts";

/** dsh 适配器（默认主力）：四原语实现，已知坑沉淀见文件头注（docs/17-§6 / docs/18-§1.2） */
export * from "./dsh.ts";

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/adapters";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
