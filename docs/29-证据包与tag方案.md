# 29 · 证据包与 tag 方案（v0.1–v0.10 发版准备）

> 性质：发版准备单产出（feature/release-prep，纯文档零代码）。本文把 v0.1–v0.10 的达成
> 情况固化为**tag 点提案 + 逐点证据包**，供制作人过目后**统一执行打 tag**——本文本身不执行
> 任何 `git tag`（20-§三：证据包 → 制作人过目 → tag；20-§十二 发版前检查单）。
> 依据：16-§四（里程碑表与验收口径）、20-§三章（版本制度）与 §十二章（检查清单）、
> git 全历史（dev@16202e4，199 提交）。达成内容分节见仓根 `CHANGELOG.md`。

纪律说明（本单自查口径）：
- **SHA 逐一用 git log / git rev-parse 核实**，无凭记忆书写；每个 tag 点的选取依据逐点注明。
- 测试数为**现场跑**所得：2026-10-17 用 `git worktree add --detach` 临时检出该 SHA，
  `bun install --frozen-lockfile` 后 `mise exec -- bun run test`，用后即删 worktree。
- 宰相亲证记录（对话中发生过、仓内无落盘物）一律标注「**宰相会话记录**」出处，并给出仓内
  对应物（提交信息 / 测试文件）；未发生的亲证不列。

---

## 一、tag 点提案总表

> 打 tag 命令统一为轻量 tag（`git tag <名> <sha>`）；如需附说明可加 `-a … -m "…"`。
> 所有 SHA 均为 dev（16202e4）祖先，在任意持有全历史的 clone 上可执行。
> 测试数=该点位全仓 `bun run test` 现场结果（见 §二逐点）。

| 版本 | 状态 | 建议 tag 名 | SHA（完整） | 点位测试 | 现成命令 |
|---|---|---|---|---|---|
| v0.1 契约包+目录模板 | **已达成待 tag** | `v0.1` | `999d56a39d1481b7df7d235cb9cefdcd32463187` | 39 例/4 文件全绿 | `git tag v0.1 999d56a39d1481b7df7d235cb9cefdcd32463187` |
| v0.2 SQLite 台账 | **已达成待 tag** | `v0.2` | `7031be5f70e0570278136ef955be2cc8319ab74a` | 92 例/9 文件全绿 | `git tag v0.2 7031be5f70e0570278136ef955be2cc8319ab74a` |
| v0.3 监控面板 :8787 | **已达成待 tag** | `v0.3` | `09a3bb64e0eb14c588f66c7415f59134c15d0d80` | 250 例/22 文件全绿 | `git tag v0.3 09a3bb64e0eb14c588f66c7415f59134c15d0d80` |
| v0.7 公司概览读面 | 读面达成（编辑中心未实现） | `v0.7-read` | `9610953af84be03fab8ba484629f82d7993cad41` | 820 例/54 文件全绿 | `git tag v0.7-read 9610953af84be03fab8ba484629f82d7993cad41` |
| v0.8 唤起源地基+网关署名 | 地基达成（六源全通未达） | `v0.8-base` | `e3f084ca12bbdcd3559daca82487082cf0438bd9` | 939 例/60 文件全绿 | `git tag v0.8-base e3f084ca12bbdcd3559daca82487082cf0438bd9` |
| v0.10 进化管线+健壮性 | **已达成待 tag** | `v0.10` | `16202e4c77c9c081024b9048008563fe5747da6e` | 1123 例/69 文件全绿 | `git tag v0.10 16202e4c77c9c081024b9048008563fe5747da6e` |

命名说明：`v0.7-read` / `v0.8-base` 为**切片 tag**（16-§四并行轨道的诚实切法）——这两
个里程碑的验收口径只兑现了一部分，不冒用整版本号；完整 v0.7（编辑中心）/v0.8（六源全通）
达标后另打全名 tag。

## 二、逐点证据包

### 2.1 v0.1 @ `999d56a`（2026-10-17）

- **SHA 选取依据**：里程碑收官提交本身——`test(company): init 验收测试（v0.1-M3）`，即
  v0.1 三件套（契约 cases+schema+runner / 目录校验器 / init+bin）的最后一刀，把验收口径
  「init 出模板公司并通过自检」固化成测试。该批 v0.1 提交当时直接落在 dev 线上（早于泳道
  编织；现经 fdcd4d7 编入现行 dev 首父链，祖先关系 `git merge-base --is-ancestor` 成立）。
- **验收口径对照**（16-§四：「studio-next init 出模板公司并通过自检」）：
  - 测试内固化冻结验收命令：`node apps/daemon/src/cli/main.ts init demo --dir <tmp> → exit 0`、
    `validate <tmp>/demo → exit 0`（进程内全链 + spawn 冒烟两段，坏目录 exit 1 带
    「文件:行 [规则] 修法」）。
- **点位测试**：39 例 / 4 文件全绿（contract 2+23、company dir-cases 6 + init 8；现场跑
  2026-10-17，输出尾部 `Test Files 4 passed (4) / Tests 39 passed (39)`）。
- **宰相亲证**：init/validate 冒烟（出处：宰相会话记录；仓内对应物=上述 init.test.ts）。
- **该点位待批残留**：P-07 / P-08 / P-09（附录）。

### 2.2 v0.2 @ `7031be5`（2026-10-17）

- **SHA 选取依据**：里程碑收官提交本身——`test(store): v3 jobs 15 例 + drill 6 例`，
  内含验收口径件（删库重建演习）的 spawn 冒烟；store v1→v3 三批迁移与五表读写此前均已
  落在当时 dev 线。
- **验收口径对照**（「删库重建演习一次通过」）：
  - `studio-next ledger drill → exit 0 + stdout 含「演习 PASS」`（防呆拒已存在库 exit 1、
    dump→rebuild 往返 26 行、坏 JSONL 中止指明行号——全部测试内固化）。
- **点位测试**：92 例 / 9 文件全绿（store 五套 + company/contract；现场跑 2026-10-17）。
- **该点位待批残留**：P-17 / P-18 / P-20 / P-34 / P-37（附录）。

### 2.3 v0.3 @ `09a3bb6`（2026-10-17）

- **SHA 选取依据**：:8787 面板三连刀的最后一刀（`bin 加 panel 子命令`）；该提交在现行
  dev 首父链上（`git rev-list --first-parent` 直含，lane/main 经快进编织入 dev）。
- **验收口径对照**（「信息覆盖：jobs/runs/workers/事件流齐备」）：六端面形状 + 过滤 +
  SSE 送达/续传 + servePanel 真端口冒烟共 13 例（36e40d7）。
- **点位测试**：250 例 / 22 文件全绿（含同点位并行泳道成果：dsh 17、claude 24、
  localplatform 29、yt fake 全量；现场跑 2026-10-17）。
- **宰相亲证**：面板六端面（出处：宰相会话记录；仓内对应物=panel.test.ts/serve.test.ts）。
- **该点位待批残留**：无本里程碑专属项。

### 2.4 v0.7 读面 @ `9610953`（2026-10-17）

- **SHA 选取依据**：显式合并提交 `Merge branch 'lane/cli' into dev（v0.7 公司概览 :8789
  首刀）`——五读面+28 例+overview 子命令整体入 dev 的那一刻；为 dev 祖先（不在现行首父
  链上属正常编织现象，见 §四注）。
- **验收口径对照**（「制作人三连问页面直答」读面部分）：`/<slug>/` 五读面（组织树嵌套/
  人事档案正文转义/财务三口径/进度）+ slug 路由 404 + 无台账降级 + 构造闸，28 例
  （151f6e0）；财务口径复用同一 buildFinanceSnapshot 保与 :8787 对齐。
- **点位测试**：820 例 / 54 文件全绿（现场跑 2026-10-17；该点位已含预算链 43 例、模型档
  40 例、company M2.2 32 测、yt 真实例修复回归面）。
- **宰相亲证**：概览五页（出处：宰相会话记录；仓内对应物=overview.test.ts 28 例）。
- **诚实注记**：完整 v0.7 还含「网页编辑走草稿→批示→留痕」——仅有设计呈批稿 docs/28
  （93b88e3，EC-①..⑱ 待批 P-43），实现未启动。故只打 `v0.7-read`，不打 `v0.7`。

### 2.5 v0.8 地基 @ `e3f084c`（2026-10-17）

- **SHA 选取依据**：显式合并提交 `Merge branch 'lane/im' into dev（v0.8 源注册表+验收
  三证）`——源注册表三源接入 + serve 接线 + 28 用例 + wkey 生命周期 e2e 整体入 dev。
- **验收口径对照**（22-§三验收三证，c1b8aa6 直证）：
  1. 注册 watch-file 自定义源**零改主循环**（真引擎只经公面 ingest/pendingIntents/tick）；
  2. **100 同键意图经注册表投递、引擎派发恰 1**（PATROL/DISPATCH 各 1）+ 异键不殃及
     ——「接力重投零重复派发」的机制直证；
  3. unregister 任一源，其余源照常产意图（fake 双源 + scheduler/watch-file 真实双源）。
  - 网关署名面：wkey 按单签发→随派发注入→**关单即吊销**（17-§7），e2e + studio-tools
    真协议链路打通（0da31a2）。
- **点位测试**：939 例 / 60 文件全绿（现场跑 2026-10-17）。
- **诚实注记**：「六源各一端到端」未全通——matrix 源仅包级首刀（cd0c6fc/11af218/9137a4c，
  未接注册表）、yt 活动源待真机、webhook 消费门归 v0.8 全通刀。故打 `v0.8-base`，不打
  `v0.8`。待批残留：P-29 ~ P-33。

### 2.6 v0.10 @ `16202e4`（2026-10-17，现行 dev tip）

- **SHA 选取依据**：dev 现行顶点——进化链 e2e 把裸 SQL 模拟替换为 store 正式写面
  updateVerification 后**再无后继提交**，验收三件在此点全部齐活。
- **验收口径对照**（三条全兑现）：
  1. **一次真实提案走完全链**（谱系→沙箱→三态闸门→判负）：evolution-e2e（1323458 建立、
     16202e4 固化正式写面）；core 54 用例（92779fe）+ store v5 23 用例（4fd48e2）。
  2. **崩溃注入五点全绿**：crash-injection.test.ts「五点各 kill 一次，重启恢复先查
     receipt」——spawn 真 serve 硬杀重启恢复断言（595355f；入 dev 9e75c89）。
  3. **无 candidate id 的生产改动判负**：evolve-guard 判负闸 + serve 启动自检（v0 观察
     模式，b2247b1；13 测）+ updateVerification 单一口径源（72d708b）。
- **点位测试**：1123 例 / 69 文件全绿（dev@16202e4 全量套件，2026-10-17 现场跑）。
- **宰相亲证**：崩溃注入五点（出处：宰相会话记录；仓内对应物=crash-injection.test.ts）。
- **诚实注记**：v0.10 交付物栏的「漂移看门狗」现有形态=在工静默停摆告警 + STALL 响置
  闭环（engine.ts；告警达阈 `stallKillAfterAlarms` → kill 面/消亡面咬合：整树杀或
  WORKER_DEAD 收口 → 回首批位 attempt+1 重派，2026-10-20 三例 studio-dev-20/25/71 的
  「只叫不咬」由 DEV-44 收口，红证=apps/daemon/test/stall-response.test.ts 四例）；
  断路升级（core F1-10 + engine 熔断吊销）已接。待批残留：P-45 / P-46。

## 三、不建议现在 tag 的里程碑（诚实清单）

| 版本 | 现状证据 | 不 tag 理由（差什么） |
|---|---|---|
| v0.4 首个定时岗 | 调度层 35 测全绿（b17c672；入 dev aeb826c），demo/模板健康巡逻样例岗已播种 | 验收口径=「**连续 48h 无故障运行证据**」——需要常驻部署窗口，未演。机制待命，先不 tag |
| v0.5 首单端到端 | demo 模式全链 e2e 绿（6da77cc）+ 引擎/收割/网关/dsh 适配器全绿 | 验收口径=「**端到端首单（真实需求单）**」——差 dsh 镜像源装机等外部条件（docs/27 §4.1）；时间盒（D7 两周）框架机制面按期，真单面待外部条件 |
| v0.6 四家适配器+成本 | 四家 fake-harness 87 例 + 预算链 43 例 + 预算闸 16 例 + e2e 断言全绿（入 dev 1805800） | 验收口径=「**同一探针单四家全绿**」——探针集真机未跑；前置拍板项 P-21/P-22/P-23/P-44 未清 |
| v0.7 完整版 | 读面已达标（打 v0.7-read） | 差「编辑中心」实现——docs/28 呈批稿待批（P-43），实现未启动 |
| v0.8 完整版 | 地基+验收三证已达标（打 v0.8-base） | 差「六源各一端到端」——matrix 源未接注册表、yt 活动源待真机 |
| v0.9 对外 API | 37 例全绿 + mock agent「提需求→读进度」冒烟链通（32d7554/fa5e341） | **SSE `/v1/events` 为 501 占位**（subscription 语义归后续刀）；且 FRAMEWORK_VERSION=0.9.0 与令牌/幂等/配额三拟稿（P-40~P-42）未批——待补齐后随下一个版本点打 |
| v1.0 切权上线 | 未启动 | 前置=v0.5 真单 / v0.6 探针 / v0.4 48h 演习等外部条件兑现 |

## 四、拓扑注记与历史疑点（如实登记）

1. **dev 首父链编织现象**：dev 与四条泳道（lane/main、lane/cli、lane/im、lane/platform）
   存在互并+快进，部分显式「Merge lane/* into dev」提交（9610953、e3f084c、1805800、
   7c09ad8、5566cb9）**不在现行 dev 首父链上**（在第二父侧）。它们仍是 dev 的真实祖先
   （`git merge-base --is-ancestor` 全部成立），**打 tag 不受影响**；但「按首父链找合并
   点」的方法对本仓不可靠，本方案逐点用祖先关系核实。
2. **yt/src/index.ts 头注疑点 4 已过时**：头注仍写「不发任何排序参数……待真实例验证」，
   而 dbc99ab（真实例冒烟实证）已改**显式发 reverse=true 与 categories**。属文件头注滞
   后（代码已按实证修正），建议随批改单机械更正头注（不属本单权限）。
3. **docs/27 F7 同源过时**：同上，「activities 默认排序假设」已被真实例证伪并修复，
   F7 条目应改「已实证收口」（连同 §一 yt 小计的「真实例验证件 5 条」计数）。
4. 全部 199 提交的提交日期仅两天（2026-10-16 骨架与文档 / 2026-10-17 全部实现），里程碑
   区间切分以提交信息中的里程碑引用（16-§四 vN）为准，无日期歧义。

---

## 附录 · 批示包汇总（散落各文件头注的拟稿待批项总表）

> 目标：制作人**一次交互全批完**。三档分组——**勘误/口径类**（事实性，可直接批「可」）、
> **选型类**（需拍板，均给建议默认值）、**设计类**（需过目）。编号 P-nn 为本表稳定编号，
> 供批文引用；「出处」为头注/文档所在文件。全批后各头注的「拟稿待批点」段即可清偿。

### A 档 · 事实勘误/口径确认类（20 项——批「可」即生效）

| 编号 | 出处 | 一句话内容 | 建议默认值 |
|---|---|---|---|
| P-01 | packages/core/src/decide.ts | submit_approval 列第十动作（「新单→待批」由 daemon 经网关执行） | 认可 |
| P-02 | packages/core/src/decide.ts | approved 批准信号=布尔入参（落点=平台动作词+daemon 归一） | 认可 |
| P-03 | packages/core/src/flows.ts | 断路回首批位双读（已派发→新单/待批两读）；type 边 v0 空表待单型冻结 | 认可双收 |
| P-04 | apps/daemon/src/engine/engine.ts | events.level=max(1, level)（流等级 0 与人员 1..9 两口径，文档补笔） | 认可+补文档 |
| P-05 | apps/daemon/src/engine/engine.ts | ticket_mirror.created 以 updated 近似（镜像=可重建投影） | 认可 |
| P-06 | apps/daemon/src/engine/engine.ts + evolve-guard.ts | HEARTBEAT/ESCALATE 零单号语境哨兵单号取 '-'（契约必填） | 认可（或改专属哨兵） |
| P-07 | packages/contract/src/schemas/events.ts | attempt 最小 1、level 1..9、零活动日事件挂哨兵单号 | 认可 |
| P-08 | packages/contract/src/schemas/report.ts | REPORT 必填节=结论/改动/验证（额外节开放、节序不约束），批后冻结进 cases | 认可 |
| P-09 | packages/contract/CASES.md | dir 域 v1 语义增补说明（M2.2-⑨） | 认可 |
| P-10 | packages/yt/src/index.ts | 构造绑定字段名 opts.project（25-§3.2 补笔） | 认可 |
| P-11 | packages/yt/src/activity.ts | 游标双形态兼容（规范形优先）+「items 非空必给 nextCursor」自洽语义（docs/27 F3） | 冻结规范形 |
| P-12 | packages/yt/src/activity.ts | PlatformActivity.kind 5 类归一+未知透传（F4 词表） | 真实例语料后冻结 |
| P-13 | packages/yt/src/activity.ts | actor=平台侧可归因主体（localplatform=工号/YouTrack=login 并存注明）（F5） | 认可注明 |
| P-14 | apps/daemon/src/engine/read-tiers.ts | role→tier 映射（main_worker=Full/verifier=Blind/其余 Focused 保守档） | 认可 |
| P-15 | apps/daemon/src/engine/read-tiers.ts | Focused 评论摘要窗口缺省 5 | 认可 |
| P-16 | apps/daemon/src/engine/budget-gate.ts + 四家 estimate() | 估算折算系数 v0（chars/token≈4、地板 $0.05/天花板 $8、confidence 0.2） | 认可 v0，v0.6 前按探针样本回归细化 |
| P-17 | packages/store/src/index.ts（v3 段） | budget_cap REAL(USD)；upsertJob 不清 last_run_at；jobs.status 值域不锁/dueJobs 不按 status 过滤 | 全认可 |
| P-18 | packages/store/src/index.ts（v4 段） | endWorkRecord status 值域不锁、无此行 false；kv 键命名空间直用 'activity.cursor'/'tick.seq' | 全认可 |
| P-19 | packages/store/src/index.ts（v5 段） | 列名取舍/值域复制非 import/幂等口径（非终态命中返回既有 id）/边合法性归 core——core↔store 一致性测试已钉死 | 全认可 |
| P-20 | packages/store/src/index.ts（v2 段） | personnel_events type 值域 v0 不锁、capability_tier 0-3、prev/next 标量拆条 | 认可，待 contract 冻结时收口 |

### B 档 · 选型/裁决类（22 项——需拍板，均有建议值）

| 编号 | 出处 | 一句话内容 | 建议 |
|---|---|---|---|
| P-21 | docs/27 §五-1（E2） | execa 升 10.x（内建 killDescendants）vs 留 9.6.1 自持进程组杀 | 升 10.x |
| P-22 | docs/27 §五-2 | dsh 安装镜像源渠道+锁 0.2.0-rc.2 可得性 | npmmirror 同源，确认渠道 |
| P-23 | docs/27 §五-3 | YouTrack 只读探测账号+写面一次性授权+牺牲项目指定 | 开设 |
| P-24 | docs/27 §五-4 | v0.6 成本达标口径：tokens 可比+claude 原生 cost vs 必须折算 usd | 前者 |
| P-25 | docs/27 §五-5 | 探针成本落 daemon 台账 source='probe' 维度 vs 独立账本 | 台账+维度 |
| P-26 | docs/27 §五-7（D2） | kimi wire 逐轮求和=turn 总账若证伪的换算预案 | 授权「取最后一条」为回退 |
| P-27 | docs/27 §五-8（B3） | claude 2.1.277-rc.1 视同达标口径保留 vs 收紧 | 保留 |
| P-28 | docs/27 §五-9（A6） | dsh --session-id 续跑 v0.6 是否顺带启用 | P-05 实测后定 |
| P-29 | apps/daemon/src/engine/worker-key.ts | 吊销粒度：ticket 级终局（GATE_FAIL 只删文件）vs 扩 per-key 吊销 API | 维持现实现 |
| P-30 | apps/daemon/src/engine/worker-key.ts | wkey 注入通道：workspace 文件 vs env 直传（后者动 contract） | 维持文件通道 |
| P-31 | apps/daemon/src/engine/gated-platform.ts | 控制面操作借道 'comment'+args.op vs 增 ctl-* 动词族（动 contract） | v0 借道，ctl-* 随契约批 |
| P-32 | apps/daemon/src/engine/sources.ts | watch-file 行内 kind 白名单收窄 webhook 专属 vs 从宽 | v0.8 全通刀收窄 |
| P-33 | apps/daemon/src/engine/sources.ts | registry manifest 可选（裸源允许） | 进化管线落地时升必填 |
| P-34 | packages/store/src/index.ts（v2） | people 表无 company 列（工号全局唯一前提） | 认可前提+04 补笔 |
| P-35 | packages/store/src/index.ts（v2） | DeptNode.name/level/relations 与 PersonRef 扩列不镜像——是否补列 | 暂不扩，编辑中心单统一 |
| P-36 | packages/store/src/index.ts（v2） | 镜像收敛策略（已删人/部门不剔除） | 维持 personnel_events 流程现状 |
| P-37 | packages/store/src/index.ts（v2） | events 表是否补 append-only 触发器（personnel_events 已有） | 补（机制化） |
| P-38 | packages/store/src/index.ts（v5） | candidates 无 FK/lineage 应用层循环非 CTE/空数组两口径并存 | 认可 |
| P-39 | packages/store/src/index.ts | 索引补列（timeline/work_records person_id、budgets ts）待量级证 | 挂账量级证 |
| P-40 | packages/panel/src/external/ | :8788 绑定缺省 127.0.0.1、--lan 才 0.0.0.0（D4 拟稿反转） | 认可 |
| P-41 | packages/panel/src/external/ | X-SN-Token/X-SN-Client-Key 令牌头、幂等 TTL 24h、配额缺省 30/分（D5/D6 拟稿） | 认可 |
| P-42 | packages/panel/src/external/views.ts | FRAMEWORK_VERSION=0.9.0 拟稿字面量 | 随 tag 定版号 |

### C 档 · 设计类（14 项——需过目）

| 编号 | 出处 | 一句话内容 | 建议处置 |
|---|---|---|---|
| P-43 | docs/28 §七.2 | 编辑中心 EC-①..⑱ 全列（草稿存储/批示流/写回九步/API 面/安全面/验收口径冻结候选） | 逐条过目（呈批稿本体） |
| P-44 | docs/27 §三/§五-6 | 探针集 v0 八单设计（P-01..P-08）+题目库冻结与写权限收制作人专户 | 过目冻结 |
| P-45 | apps/daemon/src/evolve/evolve-guard.ts | 框架资产清单样例集=三件（AGENTS.md/cases.json/docs/20）；类型标注进清单归真单刀 | 认可三件起步 |
| P-46 | apps/daemon/src/evolve/evolve-guard.ts | 空库首启跳过语义（empty-ledger 观察模式，首启不误报） | 认可 |
| P-47 | apps/daemon/src/engine/budget-gate.ts | duplicate=沿用（失败保留重派：一笔预留服务 N 次尝试至 settle） | 认可（否决失败释放案） |
| P-48 | apps/daemon/src/engine/budget-gate.ts | 双行落账顺序 issue 先 person 后（半行态恒 duplicate→绝不双派）+settle 桥降级 | 认可 |
| P-49 | apps/daemon/src/engine/budget-gate.ts | 态 B 自报估算 0 额时 reserve 照落（审计轨迹） | 认可 |
| P-50 | apps/daemon/src/engine/engine.ts | 断路器状态进程内（重启清零）、持久化拟走 events 派生 | 认可 v0，持久化列后续单 |
| P-51 | apps/daemon/src/engine/engine.ts | 呈批迁移 submit_approval v0 直迁平台不落事件（呈批事件名待批示） | 批事件名（建议 APPROVE_SUBMIT） |
| P-52 | apps/daemon/src/engine/engine.ts + scheduler.ts | 岗单据物化口径（type=task/level=0 走 L0 流/assignee=job.role） | 认可 |
| P-53 | apps/daemon/src/engine/gate.ts | REPORT/summary 约定文件名（workspace 约定）+sidecar 不存在不拦收 | 认可 |
| P-54 | apps/daemon/src/assembly/serve.ts | 网关签名上下文取快照首部门+公司级（控制面无人员档案） | 认可 |
| P-55 | packages/studio-tools/README.md | CLI 挂载形态 P 系列待核（dsh 插件/claude --mcp-config） | 真机核实前不当实锤（无需现在批） |
| P-56 | docs/25 §4.1 | wkey ttl 语义注记（时长输入/时刻入 token） | 认可注记 |

> 计数：A 档 20（可直接批）｜B 档 22（需拍板）｜C 档 14（需过目）——共 56 项。
> 全批后的落款方式建议：批示直接引编号（如「P-01~P-20 全批；P-21 升 10.x；P-43 另议」），
> 各文件头注据批文逐条清偿并注明批文出处。
