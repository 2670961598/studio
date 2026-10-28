/**
 * crash-points —— 崩溃注入六点受控测试缝（F3-11 五点，v0.10＋MIG-04 记录面第 6 点）
 *
 * 【受控测试缝声明——非生产行为】
 * 本文件是崩溃注入回归集的注入机制：旧五点回归集＝apps/daemon/test/engine/crash-injection.test.ts
 * （只登记不扩展），记录面第 6 点＝apps/daemon/test/v2/crash/records-crash.test.ts（V2 crash 腿）：
 * `SN_CRASH_POINT=<点名>` 环境变量开启后，crashHook(point) 在命中点 process.kill(SIGKILL)
 * 自杀（硬杀——验证的是**非优雅死**后的恢复，不是优雅停机）。**未设环境变量=零行为**：
 * ①-⑤ 五处调用点进入生产代码（engine.ts）但默认 no-op，对生产路径无任何影响；
 * ⑥ records-commit **无生产调用点**（记录提交在 store hist.ts；daemon 侧不 import 记录提交），
 * 只作注册名由 V2 crash 子进程在记录事务 COMMIT 前调用——不新增生产行为面。
 * 这是机制化的测试缝（env 门控），不是可配置的生产功能——daemon.yaml 不收此键。
 *
 * 【六点冻结表（本表即唯一权威；改动走批示）】
 * 需求源：docs/02-需求-框架面.md F3-11 原文只有一行——
 *   「崩溃注入+幂等恢复：五点各 kill 一次；prepare→execute→receipt，恢复先查 receipt」
 *   （验收口径：五点全绿方可切权）；F1-01 验收=「5 个 kill 点崩溃注入后重放同拍零重复动作」。
 * 五点清单未在需求文档逐点展开，按 docs/17-§2 主循环七相位 + F3-11 的
 * prepare→execute→receipt 三段缝推演定稿（文档源+推演双源），覆盖七相位的关键缝隙：
 * 第 6 点由 MIG-04 记录面扩展（docs/v2/16 §四／v2/17 §1.1 V5 行；plan/05 IMPL-04-07），
 * 登记记录事务提交前/后缝隙；**①-⑤ 逐字保留**（下表仅扩表头括注，旧行未改），⑥ 为新增行。
 *
 * | # | 点名 | 相位（①-⑤ 17-§2；⑥ 记录面） | 注入位置（①-⑤ engine.ts；⑥ V2 crash 子进程） | 缝隙语义（F3-11 三段） |
 * |---|---|---|---|---|
 * | ① | dispatch-reserved | 相位 3 派发 | executeDispatch：预算 reserve 双行落账后、launch 前 | prepare 完成、execute 未启（半派发） |
 * | ② | dispatch-launched | 相位 3 派发 | executeDispatch：launch 返回后、work_records 在途落账前 | execute 已启动、无回执无在途账 |
 * | ③ | harvest-verdict | 相位 4 收割 | harvestOne：四要件判定后、GATE_PASS 落账前 | execute（收割）完成、receipt 缺失 |
 * | ④ | heartbeat-write | 相位 7 落账/心跳 | tick：零动作拍 HEARTBEAT 事件写入前 | 落账/心跳相位缝（v0 无批量汇总面——如实降级断言，见测试头注） |
 * | ⑤ | shutdown-drain | 停机（生命周期） | dispose：drain kill 循环后、在途注销前 | SIGINT 停机 drain 中途 |
 * | ⑥ | records-commit | 记录面（DOM-05；非主循环七相位） | store hist 记录事务 INSERT 后、COMMIT 前调 crashHook('records-commit')（**无生产调用点**——记录提交在 store，daemon 侧不 import） | **记录事务已写未提交**（提交前/后缝隙）：重启即回滚，records 无半截行；events/cost_daily 零副作用；再提交同 recordId 幂等（不重复副作用） |
 *
 * 恢复语义（F3-11「恢复先查 receipt」）＝重启后一切判定以台账事件（receipt）为据：
 *   - ①②（无 DISPATCH 回执）→ 单可重派 attempt 不漂（事件派生计数）、预算沿用未结预留（adopt 不双落）；
 *   - ③（DISPATCH 有、GATE_PASS 无）→ 意图键仍占用（seenKeys 不释放）→ 新意图重派 attempt+1，
 *     孤儿 work_record 由 serve 启动例行接管收口 interrupted（R-B 转正，docs/38-§2——崩溃
 *     注入测试语义转正为生产面；接管≠收割：四要件无据不判，预算沿用 adopt 不双落）；
 *   - ④⑤ → 重启后无害：心跳不重、拍序/游标续用、库完整（WAL 硬杀后 integrity ok）；
 *   - ⑥ → 记录面恢复：未 COMMIT 事务由 SQLite 回滚（无半截行、无「已提交」假绿）；
 *     再提交同一 recordId＝hist 幂等返回既有（不重复副作用）；已提交终态行跨崩溃存活（不丢终态）。
 *
 * 落点疑点（上报）：docs/17-§10 将五点记为「contract 包测试集」，但真进程 SIGKILL 硬杀+
 * 重启只能由 daemon 侧 spawn 测试承载（contract runner 跑不了进程生命周期）——①-⑤ 按实现单
 * 落 apps/daemon/test/engine/crash-injection.test.ts（旧测试只登记）；⑥ 属 V2 crash 腿，
 * 落 apps/daemon/test/v2/crash/records-crash.test.ts。契约面（恢复判据的纯函数部分）已在
 * core/store 既有测试覆盖。⑥ 不新增生产调用点：记录提交归属 store，daemon 侧不 import。
 */
/** 六点名（冻结表；as const——成员即类型。①-⑤ 旧五点语义不变，⑥=MIG-04 记录面注册点） */
export const CRASH_POINTS = [
  'dispatch-reserved',
  'dispatch-launched',
  'harvest-verdict',
  'heartbeat-write',
  'shutdown-drain',
  'records-commit',
] as const

/** 崩溃注入点名（冻结表成员） */
export type CrashPoint = (typeof CRASH_POINTS)[number]

/** 模块加载时读一次注入开关（缺省 undefined=全部零行为；仅测试进程由 spawn env 开启） */
const ARMED: string | undefined = process.env.SN_CRASH_POINT

/**
 * 崩溃注入钩子：命中点名则 SIGKILL 自杀；默认（未设 SN_CRASH_POINT 或点名不符）零行为。
 * 调用点：engine.ts 五处（①-⑤）＋V2 crash 子进程一处（⑥ records-commit，测试侧）；
 * 本函数是唯一的「行为面」——env 门控，非生产配置。
 */
export function crashHook(point: CrashPoint): void {
  if (ARMED === point) {
    process.kill(process.pid, 'SIGKILL')
  }
}
