/**
 * Studio Next · daemon —— 框架唯一常驻进程（骨架占位实现）
 *
 * 定位（文档依据）：
 *   - 主循环：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。每拍幂等（docs/17-§2）
 *   - 调度：SQLite jobs 表 + croner 表达式解析；启动补跑错过的槽位（docs/18-§三）
 *   - 公司目录：挂载前做 schema 校验，不合法拒绝启动并给 文件:行（docs/04-§二 / §九）
 *   - 唯一写入者：公司目录与 SQLite 台账的写路径全部收口在本进程（docs/08-§二 第三不变律）
 *
 * TODO(骨架阶段)：以下能力尚未实现，按里程碑逐版本落地（docs/16-§四）
 *   [x] v0.1  `studio-next init` 从 templates/company-2-level 生成公司目录 + 目录校验器（M3：src/cli/main.ts 出 studio-next bin）
 *   [ ] v0.1  契约包接线：cases.json 规格测试进 CI
 *   [ ] v0.2  store 接线：SQLite 台账建表、migration、快照/重建脚本
 *   [x] v0.3  panel 接线：:8787 只读监控（jobs/runs/workers/事件流；`studio-next panel --db`）
 *   [x] v0.4  首个定时岗：调度表 + 启动补跑（coalesce 成一次）+ 结果落账
 *             （apps/daemon/src/engine/scheduler.ts + engine.ingest 意图入口 + serve jobs 开关；
 *             48h 连续运行证据与真实系统岗归后续运维单——诚实边界见 scheduler.ts 头注）
 *   [x] v0.5  合龙件：主循环七相位引擎 + `studio-next serve`（demo 模式=fake 全家桶端到端，
 *             apps/daemon/src/engine/engine.ts / serve.ts / test/e2e.test.ts）
 *   [ ] v0.5  真单：dsh 真跑 + YouTrack/网关 wkey + localfile 平台 + 审批流 + 真闸门验收命令
 *   [ ] v0.6+ 四家适配器、公司面 :8789、唤起六源、对外 API :8788、进化管线
 */

const BANNER = `
┌───────────────────────────────────────────────┐
│ Studio Next · daemon                          │
│ AI 公司框架 —— 唯一常驻进程（骨架占位，无逻辑） │
└───────────────────────────────────────────────┘
`;

console.log(BANNER);
console.log("[daemon] 骨架阶段：打印横幅后退出，不启动任何服务、不触碰任何事实源。");
console.log("[daemon] 实现顺序与验收口径见 docs/16-技术实现与里程碑.md §四（v0.1 → v1.0）。");

// 骨架阶段显式成功退出：等到主循环落地后，这里应换成 supervisor 看护下的常驻循环。
process.exit(0);
