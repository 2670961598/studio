/**
 * crash-points —— 崩溃注入九点受控测试缝（F3-11 五点，v0.10＋MIG-04 第 6 点＋MIG-06 第 7/8/9 点）
 *
 * 【受控测试缝声明——非生产行为】
 * 本文件是崩溃注入回归集的注入机制：旧五点回归集＝apps/daemon/test/engine/crash-injection.test.ts
 * （只登记不扩展），记录面第 6 点＝apps/daemon/test/v2/crash/records-crash.test.ts，
 * 第 7/8/9 点＝apps/daemon/test/v2/crash/surfaces-crash.test.ts（MIG-06 波门欠账补登；
 * 三者均为 V2 crash 腿）：`SN_CRASH_POINT=<点名>` 环境变量开启后，crashHook(point) 在命中点
 * process.kill(SIGKILL) 自杀（硬杀——验证的是**非优雅死**后的恢复，不是优雅停机）。**未设环境
 * 变量=零行为**：①-⑤ 五处调用点进入生产代码（engine.ts）但默认 no-op，对生产路径无任何影响；
 * ⑥-⑨ **无生产调用点**（记录面归属 store：records 提交／备份快照／投影重建／排除域报告；daemon
 * 生产侧不 import 这些写面），只作注册名由 V2 crash 子进程以 store 模块写路径（backup.ts /
 * rebuild.ts）或 node:sqlite 直写 staging 产物、在提交/rename 前调用——不新增生产行为面。
 * 这是机制化的测试缝（env 门控），不是可配置的生产功能——daemon.yaml 不收此键。
 *
 * 【九点冻结表（本表即唯一权威；改动走批示）】
 * 需求源：docs/02-需求-框架面.md F3-11 原文只有一行——
 *   「崩溃注入+幂等恢复：五点各 kill 一次；prepare→execute→receipt，恢复先查 receipt」
 *   （验收口径：五点全绿方可切权）；F1-01 验收=「5 个 kill 点崩溃注入后重放同拍零重复动作」。
 * 五点清单未在需求文档逐点展开，按 docs/17-§2 主循环七相位 + F3-11 的
 * prepare→execute→receipt 三段缝推演定稿（文档源+推演双源），覆盖七相位的关键缝隙：
 * 第 6 点由 MIG-04 记录面扩展（docs/v2/16 §四／v2/17 §1.1 V5 行；plan/05 IMPL-04-07），
 * 登记记录事务提交前/后缝隙；**①-⑤ 逐字保留**（下表仅扩表头括注，旧行未改），⑥ 为 MIG-04 新增行。
 * 第 7/8/9 点由 MIG-06 波门欠账补登（plan/03 MIG-06「记录面注入点补点」；plan/04 §1.6）；
 * ①-⑥ 行文未改，⑦-⑨ 为新增行（备份快照写入中／投影重建提交前后／排除域报告写入中）。
 *
 * | # | 点名 | 相位（①-⑤ 17-§2；⑥-⑨ 记录面） | 注入位置（①-⑤ engine.ts；⑥-⑨ V2 crash 子进程） | 缝隙语义（F3-11 三段） |
 * |---|---|---|---|---|
 * | ① | dispatch-reserved | 相位 3 派发 | executeDispatch：预算 reserve 双行落账后、launch 前 | prepare 完成、execute 未启（半派发） |
 * | ② | dispatch-launched | 相位 3 派发 | executeDispatch：launch 返回后、work_records 在途落账前 | execute 已启动、无回执无在途账 |
 * | ③ | harvest-verdict | 相位 4 收割 | harvestOne：四要件判定后、GATE_PASS 落账前 | execute（收割）完成、receipt 缺失 |
 * | ④ | heartbeat-write | 相位 7 落账/心跳 | tick：零动作拍 HEARTBEAT 事件写入前 | 落账/心跳相位缝（v0 无批量汇总面——如实降级断言，见测试头注） |
 * | ⑤ | shutdown-drain | 停机（生命周期） | dispose：drain kill 循环后、在途注销前 | SIGINT 停机 drain 中途 |
 * | ⑥ | records-commit | 记录面（DOM-05；非主循环七相位） | records 表事务：INSERT 后、COMMIT 前调 crashHook('records-commit')（**无生产调用点**——记录提交归属 store，daemon 侧不 import；V2 crash 子进程以 node:sqlite 直写 v14 列） | **记录事务已写未提交**（提交前/后缝隙）：重启即回滚，records 无半截行；events/cost_daily 零副作用；同 recordId 重放只落一行（不重复副作用） |
 * | ⑦ | backup-snapshot | 记录面（DOM-04 备份快照；非主循环七相位） | cost_daily 备份写入：JSONL 半写＋`<out>.sha256` 侧车后、rename 完成屏障前调 crashHook('backup-snapshot')（**无生产调用点**——备份写面归属 store backup.ts；V2 crash 子进程 staging 半写） | **备份件已半写、完成屏障未过**：重启后 canonical 备份不成立，半 JSONL／孤儿侧车不得被当有效备份（行数不足/摘要不符可判）；重跑 backupCostDaily 产完整备份且 sha 一致 |
 * | ⑧ | projection-rebuild | 记录面（DOM-03 投影重建；非主循环七相位） | events 重放重建单事务：重放一半（replayed=⌊N/2⌋）后、COMMIT 前调 crashHook('projection-rebuild')（**无生产调用点**——重建写面归属 store rebuild.ts；V2 crash 子进程以 appendEvent 同写路径重放） | **投影重建事务已写未提交**：重启即回滚，目标库无半投影；重跑 rebuild 幂等（不重复不丢）；排除域仍零重放 |
 * | ⑨ | exclusion-report | 记录面（DOM-04 排除域报告；非主循环七相位） | rebuild 报告写入：报告 staging 文件半写后、rename 前调 crashHook('exclusion-report')（**无生产调用点**——报告渲染归属 store rebuild.ts，文件写面由调用方承载；V2 crash 子进程 staging 半写） | **排除域报告已半写、rename 未过**：重启后半报告不得被当有效（须含排除域/理由/备份声明）；重跑产完整报告含排除域，且不得称钱账已重建 |
 *
 * 恢复语义（F3-11「恢复先查 receipt」）＝重启后一切判定以台账事件（receipt）为据：
 *   - ①②（无 DISPATCH 回执）→ 单可重派 attempt 不漂（事件派生计数）、预算沿用未结预留（adopt 不双落）；
 *   - ③（DISPATCH 有、GATE_PASS 无）→ 意图键仍占用（seenKeys 不释放）→ 新意图重派 attempt+1，
 *     孤儿 work_record 由 serve 启动例行接管收口 interrupted（R-B 转正，docs/38-§2——崩溃
 *     注入测试语义转正为生产面；接管≠收割：四要件无据不判，预算沿用 adopt 不双落）；
 *   - ④⑤ → 重启后无害：心跳不重、拍序/游标续用、库完整（WAL 硬杀后 integrity ok）；
 *   - ⑥ → 记录面恢复：未 COMMIT 事务由 SQLite 回滚（无半截行、无「已提交」假绿）；
 *     已提交终态行跨崩溃存活（不丢终态）；同一 recordId 重放只落一行（不重复副作用——
 *     hist 写口的形状/幂等语义归 PORT-HIST 测试，本点只证提交缝隙的库语义）；
 *   - ⑦ → 备份面恢复：canonical 备份只认「完整字节＋侧车摘要＋行数」三合一的完成件；半写
 *     staging 件与孤儿侧车一律不当有效备份（不假绿），重跑 backupCostDaily 覆盖出完整件且
 *     摘要与崩溃前声明的全量身份一致；
 *   - ⑧ → 投影重建恢复：未 COMMIT 的重放事务由 SQLite 回滚（目标库无半投影），重跑 rebuild
 *     从同一 JSONL 全量再生；appendEvent 同 id 全列一致幂等跳过（不重复），全量行在（不丢）；
 *     排除域（cost_daily）不因重建入账；
 *   - ⑨ → 报告面恢复：排除域报告只认 rename 后的完整件；半报告（缺排除域/理由/备份声明）
 *     不得当有效，重跑渲染出含排除域段的完整报告，且不得把备份写成「钱账已重建」。
 *
 * 落点疑点（上报）：docs/17-§10 将五点记为「contract 包测试集」，但真进程 SIGKILL 硬杀+
 * 重启只能由 daemon 侧 spawn 测试承载（contract runner 跑不了进程生命周期）——①-⑤ 按实现单
 * 落 apps/daemon/test/engine/crash-injection.test.ts（旧测试只登记）；⑥ 属 V2 crash 腿，
 * 落 apps/daemon/test/v2/crash/records-crash.test.ts；⑦-⑨ 属 MIG-06 补登，落
 * apps/daemon/test/v2/crash/surfaces-crash.test.ts。契约面（恢复判据的纯函数部分）已在
 * core/store 既有测试覆盖。⑥-⑨ 不新增生产调用点：记录面写面归 store，daemon 生产侧不 import。
 */
/** 九点名（冻结表；as const——成员即类型。①-⑤ 旧五点语义不变，⑥=MIG-04 记录面注册点，⑦-⑨=MIG-06 补登记录面注册点） */
export const CRASH_POINTS = [
  'dispatch-reserved',
  'dispatch-launched',
  'harvest-verdict',
  'heartbeat-write',
  'shutdown-drain',
  'records-commit',
  'backup-snapshot',
  'projection-rebuild',
  'exclusion-report',
] as const

/** 崩溃注入点名（冻结表成员） */
export type CrashPoint = (typeof CRASH_POINTS)[number]

/** 模块加载时读一次注入开关（缺省 undefined=全部零行为；仅测试进程由 spawn env 开启） */
const ARMED: string | undefined = process.env.SN_CRASH_POINT

/**
 * 崩溃注入钩子：命中点名则 SIGKILL 自杀；默认（未设 SN_CRASH_POINT 或点名不符）零行为。
 * 调用点：engine.ts 五处（①-⑤）＋V2 crash 子进程四处（⑥-⑨，测试侧；无生产调用点）；
 * 本函数是唯一的「行为面」——env 门控，非生产配置。
 */
export function crashHook(point: CrashPoint): void {
  if (ARMED === point) {
    process.kill(process.pid, 'SIGKILL')
  }
}
