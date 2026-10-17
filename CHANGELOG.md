# CHANGELOG（Studio Next）

> 版本纪律（制作人定调，16/20-§一.2）：**完成一个里程碑算一个版本**，不设周/月版本；
> 每个版本做出来制作人过目才发布（20-§三：证据包 → 制作人过目 → tag）。
> 本文按 16-§四里程碑表分节固化达成情况；tag 点提案与逐点证据包见 `docs/29-证据包与tag方案.md`。
> 日期=该里程碑收官提交的提交日期（git log 核实）。截至 2026-10-17（dev@16202e4）**尚无任何
> 已打 tag**——下列「已达成待 tag」各节均待制作人过目 docs/29 后统一执行。

状态图例：**已达成待 tag**（验收口径全量兑现，建议打 tag）｜**机制达成待外部条件**
（代码与测试面全绿，但验收口径含仓外件——真机/真单/连续运行——尚未兑现，暂不打 tag）。

---

## v0.1 · 契约包 + 公司目录模板（2026-10-16 → 2026-10-17）——已达成待 tag

达成内容：
- monorepo 初始骨架（九包 + daemon 占位 + 2 级公司目录模板）与设计文档库脱敏迁移（2915e4a）；
  工具链锁定 mise：Node 24.21.0 LTS + bun 1.4.3（1f2217e）
- 契约端口与协议冻结为并行开发唯一共享前提：ports 八模块类型骨架 + docs/25（314a1aa），
  端口随泳道首刀反馈迭代 v1.1/v1.2/v1.3（7a4d434 / faf6111 / f106091）
- contract 包：cases.json v1 清单（3 meta 自证 + 3 dir 语义）+ zod 清单 schema + runner
  （子集匹配 / `__NULL__` 哨兵 / 数组无序双射 / err 通道）（fed4cc7）
- evt/rpt 契约域：events 台账记录 zod（23 具体 + GW_/REPORT_ 前缀族=25 类冻结清单、ULID
  canonical、tokens 四桶）+ REPORT 骨架 + summary/v1 sidecar + 两级错误分类
  （8bfd4cb / 4ee500a / 10e5234，防恒反证入测）
- company 校验器 v0：org-config.yaml zod 结构校验 + yaml@2 行号定位（「文件:行 [规则] 修法」）
  + 交叉规则（等级分布↔people 实数、leader/dept 悬空双检）（e190aa5 / 75e9410）
- init 脚手架 initCompany（模板复制→占位替换→自检→git 单 commit，失败撤半成品）+
  `studio-next` bin：init / validate（4715b46 / 04ba739）
- 验收命令测试内固化：`node apps/daemon/src/bin.ts init demo → validate demo → exit 0`
  （拟冻结验收命令可执行化，999d56a）

关键验收证据：
- 验收口径（16-§四）「`studio-next init` 出模板公司并通过自检」：999d56a 内 spawn 冒烟
  两段直证（好目录 exit 0 / 坏目录 exit 1 带「文件:行 [规则]」）；该点位现场跑测试
  **39 例 / 4 文件全绿**（2026-10-17，临时 worktree 检出 999d56a，`bun run test`）
- 宰相亲证：init/validate 冒烟（出处：宰相会话记录，仓内对应物=上述测试）

待批残留：P-08（REPORT 必填节拟稿节集）、P-09（CASES.md dir 域 v1 语义）、P-07（events
拟稿口径三条）——见 docs/29 附录批示包。

## v0.2 · store 包（SQLite 台账）（2026-10-17）——已达成待 tag

达成内容：
- node:sqlite（DatabaseSync）驱动隔离（better-sqlite3 一行切换点）+ schema_version 薄
  migration runner（62b4c7b；drizzle 稳定线无 node:sqlite 驱动的实测勘误入 16-§二，f106091）
- openLedger 句柄 + appendEvent 契约闸（非法 CONFIG_INVALID 拒入账）+ 查询面 +
  dump/rebuild（c81f142；15 例 9b44df0）
- migration v2 五表：people / personnel_events / departments / ticket_mirror / budgets；
  personnel_events append-only 走 UPDATE/DELETE 触发器（纪律4「机制保证，不是自律」）
  （0e73fc7）；五表读写 + personnelTimeline 三表归并（9afc106；17 例 5b0bf36）
- migration v3 jobs 调度表（17-§2 列集 + 两索引）与 upsert/due/markRan 四面（bdccfba）
- 删库重建演习与维护 CLI：store drill 模块（防呆→26 条确定性语料→dump→删库三件套→
  rebuild→四项比对，末行冻结结论「演习 PASS/FAIL」）+ daemon `ledger drill/dump/rebuild`
  子命令组（d1fedb6；21 例含 spawn 冒烟 7031be5）

关键验收证据：
- 验收口径「删库重建演习一次通过」：spawn 冒烟测试固化 `studio-next ledger drill →
  exit 0 + stdout 含「演习 PASS」`；该点位现场跑 **92 例 / 9 文件全绿**
  （2026-10-17，worktree 检出 7031be5）

待批残留：store v2/v3 疑点（budget_cap REAL 口径、last_run_at 不随覆盖、jobs.status 值域
不锁等）——P-17/P-18/P-20/P-34/P-37 等，见 docs/29 附录。

## v0.3 · 面板 :8787（只读监控面）（2026-10-17）——已达成待 tag

达成内容：
- panel 包 :8787 只读监控面首刀：六端面 + SSE 事件流送达/续传 + HTML 单页（a50f3ce；
  13 例含 servePanel 真端口冒烟 36e40d7）
- `studio-next panel --db <路径> [--port 8787]` 子命令接线（09a3bb6）
- 同点位并行泳道成果一并入库：dsh 适配器四原语（17 例）、claude 适配器（24 例）、
  localplatform 第二实现（29 例）、yt 全量 fake 测试

关键验收证据：
- 验收口径「信息覆盖：jobs/runs/workers/事件流齐备」：六端面形状测试 + SSE 续传测试
  （36e40d7）；点位现场跑 **250 例 / 22 文件全绿**（2026-10-17，worktree 检出 09a3bb6）
- 宰相亲证：面板六端面（出处：宰相会话记录，仓内对应物=上述测试与端面清单）

待批残留：无本里程碑专属项。

## v0.4 · 首个定时岗（健康巡检）（2026-10-17）——机制达成待外部条件

达成内容：
- croner 驱动调度器：due 轮询 + 错过补跑 coalesce + 同岗不重叠 + 坏 cron 隔离
  （21431ac，16-§四 v0.4 / 18-§三）
- 引擎意图入口 ingest：schedule 意图物化岗单据进 decide 主链（3e19226，22-§一/§三.2）
- serve jobs 开关 + 定时岗播种 + 运行栈统一停机面；demo/模板健康巡逻样例岗（47c9a7e）
- 调度层 35 测：coalesce / 不重叠 / 坏 cron / 热更 / 意图全链 / 真进程 SIGINT 冒烟
  （b17c672）；入 dev：aeb826c

关键验收证据：上述 35 测全绿；岗播种面在 daemon e2e 全链复跑。

待批残留与缺口：验收口径「**连续 48h 无故障运行证据**」未演（需要常驻部署窗口）——
**不建议现在 tag**；岗单据物化口径拟稿（P-52）。

## v0.5 · 主循环 + dsh 适配器（首个真单）（2026-10-17）——机制达成待外部条件

达成内容：
- 主循环七相位引擎 createEngine（收割/泳道/幂等/断路面合龙，c299db2，17-§2/§6）
- serve 子命令成真：demo 栈接线 + 常驻循环 + SIGINT 优雅停（94ede5b）
- demo 模式端到端 e2e「零依赖跑通」全绿（6da77cc，23-§四预演；后续 e2e 面 11 例随
  daemon store 切换扩至现行）
- gateway 包：wkey 按单凭据签发/校验/吊销（9208de3）+ 动作词结构化校验与署名注入
  （809cb21）+ 网关门面 gateWrite（f6e5ccb，v0.5 关键件）
- dsh 适配器四原语对 fake CLI 全绿（920c509；17 例 07b0079，含 dsh 吞 SIGTERM 退出码 0
  已知坑的 fake 复现）

关键验收证据：demo 全链 e2e（6da77cc）；dsh 17 例；gateway 三件套测试随包入库。

待批残留与缺口：验收口径「**端到端首单**（真实需求单走完派发→dsh 干活→收割→证据→
关单）」未跑——前置=dsh 镜像源装机（docs/27 §4.1）、四家 CLI 在机；时间盒（D7 两周）
框架侧机制面按期，真单面**待外部条件**——**不建议现在 tag**。

## v0.6 · 适配器四家 + 价目表成本（2026-10-17）——机制达成待外部条件

达成内容：
- executor 注册表：能力路由 pick/pickAll 零名单硬编码 + agent.yaml 装载
  （096398c / 50d537b，17-§2/§4）
- 四家适配器 fake-harness 全链全绿：dsh 17 / claude 24（b5db9d3/a8c35ad）/ codex 22
  （ca23f43/7d6f864）/ kimi 24（8c56e72/449ff68）
- 模型档装载与目录 models.yaml（预算/价目表链地基，7c047ca；40 例 41e31dd，core 118 例）
- 预算链纯逻辑：foldBudgets 折叠 + reserve/settle 判定面（3608188；43 例 069af35）
- 预算闸机制化「不落即不派」：budget-gate 接线件 + engine 派发前闸 + 收割 settle +
  daemon.yaml 价目表装载（344c115/2160760/e56ba45；16 例 + e2e 全链预算行断言 75481be；
  入 dev 1805800）
- budgets 全量读面 listBudgets（8 例，81e1fc8）+ panel 成本卡消费（4ed6fea）

关键验收证据：四家 87 例（17+24+22+24）+ 预算链 43 例 + 预算闸 16 例 + e2e 断言全绿。

待批残留与缺口：验收口径「**同一探针单分别派给四家，证据格式一致、成本可对账**」未跑
真机——探针集 v0 八单设计已呈批（docs/27 §三）、执行前置（装机/授权/题目库冻结）待
制作人拍板（P-21/P-22/P-23/P-44）——**不建议现在 tag**。

## v0.7 · 公司面（:8789 读面 / 编辑中心）（2026-10-17）——读面已达成待 tag；编辑中心设计稿呈批

达成内容：
- :8789 公司概览读面首刀：`/<slug>/` 五读面（组织/人事/财务/进度等）+ slug 路由 404 +
  无台账降级（6d1efa0；28 例 151f6e0）；listenHono 共用件提取（0312c7f）；
  `studio-next overview --company` 子命令（ba3bf0a）；入 dev：9610953
- 公司目录 M2.2 多文件交叉校验（全目录面清偿 v0 挂账，04-§二/§九；7011f61；32 测
  c1d4c65）+ org-config jobs 段收紧装载进 snapshot.jobs（541c167；12 测 ae2ab98）+
  模板 jobs 清单对齐（2193bc9）
- 编辑中心（v0.7 后半）：**纯设计零代码呈批稿 docs/28**（草稿→批示→留痕全链 + EC-①..⑱
  拟稿清单，93b88e3）——实现未启动

关键验收证据：
- 读面：9610953 点位现场跑 **820 例 / 54 文件全绿**（2026-10-17，worktree 检出）
- 宰相亲证：概览五页（出处：宰相会话记录，仓内对应物=151f6e0 28 例）

待批残留与缺口：验收口径「制作人三连问页面直答」读面可答；「网页编辑走草稿→批示→
留痕」未实现（docs/28 待批，P-43）——完整 v0.7 不 tag，**读面单独立 `v0.7-read` tag**
（提案见 docs/29）。

## v0.8 · 唤起六源全通 + 网关署名（2026-10-17）——地基已达成待 tag；六源全通未达

达成内容：
- 源注册表与三源接入面：register/unregister/startAll/stopAll + 单源崩溃隔离三相位
  （54cfdeb，22-§一/§二）；scheduler 源零改包装 + watch-file 示例源（基线纪律/mtime
  去抖/dedupKey/坏行隔离/启动盲窗补检）
- serve 接线源注册表：sources 配置段 + 统一 ingest 注入口（源零直驱，决策归主循环）+
  停机顺序收口（f08ec5f；engine.ts 零改）
- 源注册表 28 用例 + **验收三证**（c1b8aa6）：①注册自定义源零改主循环 ②100 同键意图
  经注册表投递恰 1 次派发 + 异键不殃及 ③unregister 任一源其余源照常产意图；入 dev：e3f084c
- wkey 生命周期闭环：按单签发 → 随派发 workspace 注入 → 关单吊销（0116f5b/8fb9af0；
  e2e + studio-tools 真协议链路 0da31a2）——17-§7「关单即吊销」的可执行证明
- GatedPlatform 写路径收口包装器（engine 平台写调用全过 wkey 网关，a410bb9）+ serve
  网关缺省开（ac27d40）；studio-tools MCP server：六工具 + wkey 初始化注入 fail-closed
  （e794403/c031afe，24-§二）

关键验收证据：e3f084c 点位现场跑 **939 例 / 60 文件全绿**（2026-10-17，worktree 检出）；
接力重投零重复=验收三证②直证（dedupKey 幂等）。

待批残留与缺口：「六源各一端到端」未全通（matrix 源只有包级首刀未接注册表、yt 活动源
待真机、webhook 消费门 v0.8 全通刀）——完整 v0.8 不 tag，**地基单独立 `v0.8-base` tag**
（提案见 docs/29）；P-29~P-33 拟稿待批。

## v0.9 · 对外 API :8788 + Agent Card（2026-10-17）——机制达成，暂不打 tag

达成内容：
- :8788 对外 API 骨架：七信息端点（company/org/people/projects/issues/finance/reports
  + 索引）+ `POST /v1/requests` 只落单不派工 + `/v1/agent-card` 名片带版本（32d7554）
- 越权三闸全 fail-closed：无凭证 401 / 坏凭证 403 / 令牌未配=全 401 / 配额超限 429
  （固定窗按客户端键分桶）；幂等键防重（TTL 24h）
- 测试 37 例（32 例进程内 + 5 例真端口绑定面）；**mock 外部 agent 冒烟链「提需求→读
  进度」fetch 全通**（external-serve，v0.9 验收口径预演）
- `studio-next external` 子命令：--lan / --token / --requests-per-minute（fa5e341；缺省
  只绑 127.0.0.1，--lan 才 0.0.0.0）

关键验收证据：37 例全绿（含「零 DISPATCH 事件」台账侧证据）；越权 fail-closed 全负路径
断言。

待批残留与缺口：SSE 订阅 `/v1/events` 为 **501 占位**（subscription 语义归后续刀）；
FRAMEWORK_VERSION=0.9.0 与令牌/幂等/配额三拟稿（P-40~P-42）未批——**不建议现在
tag**（验收口径三项主体已测，差 SSE 面与拟稿批文）。

## v0.10 · 进化管线 + 健壮性（2026-10-17）——已达成待 tag

达成内容：
- 进化管线纯逻辑：候选制品谱系 + 状态机 + 三态闸门 + 判负面（75e73a4；54 用例 92779fe：
  状态机全迁移/谱系环断链/幂等提案/闸门三态矩阵/全链拼合）
- store migration v5 candidates 表 + 三索引 + 读写五面（zod 行形状 + core 值域一致性
  钉死；e7dcb2f/09a1e78；23 用例 4fd48e2）
- 崩溃注入受控测试缝 crashHook 五点接入 engine（453a5a1）+ 五点回归集：spawn 真 serve
  硬杀→重启恢复断言（595355f；入 dev 9e75c89）
- 进化链端到端：一次真实提案走完谱系+闸门+判负全链（1323458；后换 store 正式写面
  updateVerification 固化，16202e4）
- evolve-guard 判负闸 + serve 启动自检接线（v0 观察模式）：**无 candidate id 的生产改动
  判负**（b2247b1 + updateVerification 单一口径源 72d708b；13 测）
- 断路器（core F1-10 + engine 压制/熔断吊销）与在工静默停摆看门狗告警已在引擎面
  （kill 重派归后续刀，如实注记）

关键验收证据：
- 验收口径三条全兑现：①一次真实提案走完全链（1323458/16202e4 e2e）②崩溃注入五点全绿
  （595355f，五点各 kill 一次重启恢复先查 receipt）③无 candidate id 判负（evolve-guard
  测试 + serve 自检接线）
- 宰相亲证：崩溃注入五点（出处：宰相会话记录，仓内对应物=crash-injection.test.ts）

待批残留：P-45/P-46（资产清单样例集、空库首启语义）；漂移看门狗的 kill 重派面列后续单。

## 未编号切片（并行轨道与横切微单，2026-10-16 → 2026-10-17）

不占版本号、按 16-§四并行轨道推进的包级与横切成果（均随上述点位测试面全绿）：
- **prompt 包**：不可信输入隔离消毒器（C2-10）、L0-L5 分层模型与分层指纹（C2-06/08/11）、
  AGENTS.md 组装器（勿手改横幅+指纹注释）、超长裁剪器（C2-09 阶梯）、任务书两模板
  （c4da83b/19fa1d4/ecff9b8/76256b2/6f62cd3）
- **core 地基**：flows 表驱动 FSM（L0/L1/L2 + rollback/type 边）、decide 决策纯函数
  （结构化 Action + 并发三闸 + 幂等去重 + 断路压制）、breaker 断路 + dispositions 语义表、
  golden trace 格式与回放器四份全绿（4a85b00/64de423/6abb247/1d5b8b1）
- **localplatform**（23 解耦第二实现）：七能力齐活 + 29 例（9f11bd7..5c778f8）
- **matrix 包**（21 协作通讯首刀）：@唤醒解析 + 通知格式化 + CS API 薄客户端 + fake fetch
  回放测试（cd0c6fc/11af218/9137a4c）；21A Synapse 部署侦察手册（95f2f18，未部署）
- **读面三档分级**（17-§7）：Full/Focused/Blind 三档视图 + dispatch 按岗选档进任务书与 L4
  （308f208/3730d34；22+4 例；入 dev 7c09ad8）
- **:8787 全量口径补齐**（17-§8）：断路器聚合 + 成本双序列 + 六区块单页 + /api/breakers
  +/api/costs + order/event 新过滤维（520aeb2/6aa62dc；18 例 03aec42）
- **store v4 + daemon 切正式面**：daemon_kv 接管（DDL 字节级一致）+ endWorkRecord（含
  tokens 写面）+ queryEvents desc 通道；daemon 删自建 kv/直发 UPDATE 两段切换债（b4d8ab2/
  53ae140/abe62a4/a99f6bc/a41d84d/0f54c09；入 dev 5566cb9）
- **yt 真实例四修 + 复验**：activities 补 reverse=true 与 categories（dbc99ab）、
  customFields value(name,login) 子选择器（7a086b4）、活动流边界可达性=全量重放
  （73003e6；9 例 165894e）、游标语义措辞强化（4a42953/a3c28f2）；实证收口 STUDIO-110
  待批（宰相亲证出处：宰相会话记录；仓内对应物=上述四提交）
- **文档库扩充**：21/21A/22/23/24（解耦面设计）、26（回填与对账侦察）、27（探针与真机
  核实清单 46 条 + 拍板项 10 条）、28（编辑中心呈批稿）；16-§二 drizzle 勘误等事实性
  勘误四处（5c6b25d）
- **质量微单**：adapters kill 宽限测试竞态修复（624f42c）、同类旧路径残留清理三处
  （7e0ed8f）

## 未启动

- **v1.0 切权上线**（连续 7 天制作人零批示正常运转）：未启动——前置为 v0.5 真单、v0.6
  探针、v0.4 48h 演习等外部条件兑现。
