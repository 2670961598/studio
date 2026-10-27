# L3-J · 细节层审计：运行时与公共接口（中段 §6.0–§6.6）

> 审计员：L3-J（独立审计，非作者）。审计日期：2026-10-27。
> 审计对象：`docs/80-技术细节-StudioNext运行时与公共接口.md` 第 1087–2452 行（§6.0–§6.6）。
> 口径：`docs/audit-DSF/_scope-DSF.md`（P0/P1/P2 分级、证据纪律、报告结构）。
> 下文 `80:nnnn` 均指该文件行号；`77:nnnn` 指 `docs/77-技术细节-运行记录与行为契约.md`；`78:nnnn` 指 `docs/78-技术细节-宿主平台与工作区绑定.md`。引文均为节选，事实与判断分列。

## 一、结论

- 范围：§6.0–§6.6 共 **47 个端口**（§6.7 的 8 个端口不在此段）；§6.0 自称 55 个，经标题计数核对为真。
- 分级：**P0 1 条，P1 11 条，P2 9 条**，无 P3。
- 最严重三条：**P0-01** 读面知悉范围/调用者上下文在端口上不可表达；**P1-01 + P1-02** 记录事务无法收纳记录写、同事务投影钩子无接口且依赖错件；**P1-04** 意图保留记录与受理记录之间丢失 `intentRef` 链。
- 总判断：规范面/权威面/工作面多数端口的语义写得比记录面细；真正卡住施工的是**记录面与意图链的三处接缝**（事务、钩子、意图身份），以及**能力/紧急止损/执行面**三处“没有记录或没有出口”。
- §6.6 **没有**把效果闸门、证据、验收混成一个端口：EFF-01/EVD-01/EVD-02 分列，EVD-01 明写“只收材料、不判验收”，EVD-02 明写“接受≠结清”。EFF-01 自身把“验签/执行/回执”编排在同一端口，但执行器是明确声明的内部注入面，不是第二公共端口；未发现自授权/自验收的声明（其授权核验接缝列入“未证”）。
- 四原语：launch/stream/resultStats/kill 四个都在，失败由 `turn_end.completed`/`errorCode` 保留；**取消只有进程级 `kill`（`cancel_turn` 能力无操作、无消费），超时在端口上无表达**（P1-11）。
- 状态矩阵：`ExecutorAdapter` 的“已有”经代码核对成立；`RecordReader` 的“新建/包装”在同一卷内直接矛盾；Notifier 的“已有（端口）/局部（实现）”不符合 §6.0 自己的“已有”定义（P2-01）。
- 本卷的“未实现/未证”总体是诚实的（§0.4 自认未跑 `typecheck`/`test`/`guard`，§6.9 标“均未实现”）；但 §6.0 的状态列另造了一套词表，使“已有/局部/包装/新建”无法与 §0.1 的四态一一对上（P2-01）。
- 跨层问题（77 的 `intent_ref` 必填、78 的多份 BIND 档案、76 的 SG-07 知悉范围）在本报告只作为证据引用并标注，不替代 C 组结论。

## 二、发现表

### 2.1 P0

| ID | 级别 | 类型 | 位置 | 事实/引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3J-P0-01 | P0 | B/F（数据/安全边界；缺口） | 80:1449、80:1462、80:1472、80:1484、80:1490、80:1614 | `get(recordId: Qid)` 无访问上下文；`knowledgeScope?: KnowledgeScope` 可选、未定缺省；`payload(ref)` 要求“按该信封的 `knowledge`/`scope` 校验调用方许可”，但 `payload(ref)` 同样没有调用者参数；§6.3 同时写“知悉范围不可被查询绕过”。 | 知悉范围是记录面的读边界（76-§4.2 SG-07）。端口没有把“谁、为何、可读到哪”带进来，`get`/`payload` 只能靠实现私设上下文；`query` 的 `knowledgeScope` 可选且缺省未定义，按可选字段的通常读法可退化为全可见。这样 §6.3 的“WHERE 过滤”“按信封权检”在 `get`/`payload` 上不成立，且 `Ok(undefined)` 会把“无权”伪装成“没有”。这不是实现细节，是端口边界缺失。 | 把 `AccessContext`（caller/purpose/knowledgeScope）设为 `get`/`query`/`payload` 的**必填**入参，定义“缺省=拒”（不是全可见）；`get` 越权 ⇒ `Err(rejected_forbidden)`，不得 `Ok(undefined)`；补 U80-21 的 `get`/`payload` 越权与“省略 scope”负向探针；若 `get` 仅供 daemon 内部可信调用，必须在端口上写明并取消公共导出（或给出绑定 AccessContext 的工厂）。 |

### 2.2 P1

| ID | 级别 | 类型 | 位置 | 事实/引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3J-P1-01 | P1 | B（承诺无机制） / A | 80:1438、80:1444、80:1534、80:1563、80:1613 | `RecordTransaction` 只有 `begin/commit/abort/receipt`；`RecordWriter.append` 的 `AppendOptions` 无 `tx`/`TxHandle`；§6.3 却写“跨类型多记录必须走 `TS-PORT-REC-04`”，CMD-01 又要求“命令 + 权检两条同域追加”。 | 事务壳没有任何“把记录写进本事务”的写口：`append` 是单条原子写，`RecordTransaction` 只有开/合/弃。按现在的签名，REC-04 只能包住“没有记录的事务”，多记录同域原子写在接口层不可实现；照此实现只能靠环境变量/线程上下文这类隐式事务，直接违反“显式事务句柄”的纪律。 | 给 `AppendOptions` 加 `tx?: TxHandle`（或给 REC-04 加 `append(tx, input)`），明确“给了 tx 就加入该事务、commit 时校验/回滚”；写明 CMD-01/AUTH-05 等多记录端口必须走这条。补负向测试：两条记录，第二条失败 ⇒ 零行可见。 |
| L3J-P1-02 | P1 | B（承诺无机制） / A | 80:2337、80:2419、80:2448、80:1110、80:2578 | `createIntentReceiptStore(deps: { ledger: Ledger })` 的唯一写句柄是 `Ledger`；§6.3/§6.9 明说 `Ledger.appendEvent` 不能当 `RecordWriter`、`records` 表在它之外另建；而 §6.6 第 3/7 条要求投影 hook 在“同一条记录事务”里写表投影。 | 声明的依赖到不了 `records` 事务：`Ledger` 写的是 `events`/投影表族，`records` 由另一个 store 句柄写；全卷没有任何 hook 注册接口（REC-04 也没有）。于是“decided 不可能被读成 queued”这一“无窗口”不变量只能靠实现自创第二写路径，违反单一写入者与投影同事务两条纪律。 | 在 store 的记录事务上定义 `ProjectionHook` 注册/同事务调用点；把 `IntentReceiptStore` 的依赖改为 store 的记录句柄（不是 `Ledger`），或在 `createIntentReceiptStore` 明确“hook 由 store 持有并在同事务触发”。做不到就必须撤回 §6.6 第 7 条的“无窗口”承诺，并给出等强证明（§6.6 第 10 条自己要求的四点崩溃注入）。 |
| L3J-P1-03 | P1 | B（语义缺口） / E | 80:1438、80:1443、80:1608、80:1970、80:2337 | `AppendOptions.idempotencyKey` 只在形状与 `records` 索引清单里出现；REC-01 的幂等段只定义 `recordId` 重复（同内容 `deduped:true`，不同内容 `Err`）；EFF-01 却按 `idempotencyKey` 查 `REC-RCP-01`/`REC-EVT-01`，并靠 `deduped=true` 表示“已有尝试”。 | `idempotencyKey` 的去重语义（作用域、同键不同内容返回什么、与 `recordId` 去重的优先级、返回哪个 recordId）全卷未定义。EFF-01 的“一个持久化尝试最多主动发起一次平台调用”和 API-01 的“同键并发收敛为一个尝试”都建立在这条未定义语义上；实现者只能自选一种，导致两处行为不一致。 | 在 REC-01 写明：key 的作用域（按 recordType/authorityDomain？）、同键同内容返回 `Ok({recordId: 原记录, deduped:true})`、同键不同内容返回 `Err(rejected_idempotency)`、与 `recordId` 去重的优先级；补同键并发与同键不同内容两条负向测试。 |
| L3J-P1-04 | P1 | A/B（链断裂） / E | 80:1645、80:1647、80:2338、80:2390、80:2354、77:824 | `reserve` 产出 `intentRef`；`invokeIntent` 的形状（80:2390）没有 `intentRef`；`enqueue` 只把 `invokeIntent` 交给 `engine.ingest`；`intake(intent: RecIntentEnvelope)` 没有 `intentRef` 参数，`IntakeOutcome` 也不回 `intentRef`；而 77-§4.1.2 的 `REC-WORK-02.intent_ref` 是必填。 | 从“保留记录”到“受理记录”的同一性链断在队列上：相位 2 拿到的只是意图内容，无法证明它对应哪条 `REC-WORK-01`。TTL 到期另立同键记录后，按 `IntentKey` 回查还有歧义（取最大 `receivedAt` 会串到新记录）。这使 `intent_receipts.status='decided'` 的归属、`intakeRecordRef` 的回填和 `replayQueued` 的幂等都失去唯一支点。 | 让 `intentRef` 随队列项传递（如 `{ intentRef, invokeIntent }` 包装或扩 `InvokeIntent`），`intake` 收 `intentRef` 并写入 `REC-WORK-02.intent_ref`；`replayQueued` 用投影行的 `intentRef` 重放，不得按 `IntentKey` 重新猜。补“同键两条（一条 superseded）仍能链接到正确 intentRef”的测试。 |
| L3J-P1-05 | P1 | B/E（关键场景无出口） | 80:2020、80:2043、80:2129、80:2130、78:70-76、78:1759 | `describe()`、`mapState(platformState)`、`exportBundle(scope)` 都没有 `bindingId` 参数；`BindingProfile.stateMappings` 带 `family`，78 登记多份 `BIND-*`（`BIND-CORE-01`/`BIND-DSH-01`/`BIND-PLAT-YT-01` 等）；§6.6 又规定宿主实现“有且仅有一处”。 | 一个宿主实现持有全部档案，`describe()` 返回哪一份、`mapState` 用哪张族表、`exportBundle` 导哪份绑定，签名都没有选择器。多平台/多公司部署时只能靠单例或调用前隐式设置，读错档案会把状态映射、损失与退出计划套到错误对象上。 | 给三个方法加 `bindingId`（或定义 `createPlatformBinding(bindingId)` 工厂并声明“一绑定一实例、实现只有一处”）；在 80 写明 78 的多档案基数与选择规则。 |
| L3J-P1-06 | P1 | B/D（承诺无机制；验证/证据缺口） | 80:1918-1956、80:1931、80:1958、80:2050、80:775-826 | CAP-01..06 多数只有“签名/语义/错误/锚点”3–5 项，无前置/后置/权限/幂等/事务；CAP-02 的证据写“安装回执（不是 `REC-WORK-*`）”，CAP-04 的 `ProbeReport` 无记录落点，CAP-05/06 的 `activate`/`retire` 无权限与幂等；§6.5 却称“目标态必须逐段可查”；BIND-01 的 `probes[].evidenceRef?: Qid` 需要一条记录。 | “逐段可查”的六段里，资格认定（REC-WORK-08）与权威激活（REC-AUTH-07）有记录，安装/挂载/探测/能力激活/退役**没有**任何 `REC-*` 落点，§4.7 的 record→port 表也没有 CAP 行。`ProbeReport`/`ActivationReceipt`/`RetirementReceipt` 是“回执”但不是记录，无法被 `Qid` 引用；能力激活与退役是真实状态变化，却没有权源、幂等与事务。 | 为安装/挂载/探测/激活/退役各定记录落点：若是 `REC-RCP-01` 投影，明确写并补 §4.7 行；否则新增记录类型或明确“不落账”并撤销“逐段可查”。给 CAP-05/06 补 authority/idempotency/transaction，给 CAP-03/04 补前置/后置。`probes[].evidenceRef` 必须指向已登记记录类型。 |
| L3J-P1-07 | P1 | B（记录无端口） / G | 80:813、80:1786、80:773 | §4.7 把 `REC-EXC-02` 的执行端口写成“`TS-PORT-WORK-06` + **停机通道**”；`停机通道` 不是 `TS-PORT-*`，WORK-06 的方法只有 raise/receive/escalate/close，没有紧急止损。 | 紧急止损是安全关键路径，却只有一条没有名字的“通道”承担写口。按 §4.7 自己的规则“无专用端口的必须写明复用哪个既有端口”，这里既没复用也没命名；它要么绕过 `RecordWriter`（违反唯一写口），要么无人写（记录缺失）。 | 命名 `emergencyStop` 端口/方法（或明确复用的现有通道及其 TS 名），补 §4.7 行与记录写口；写明“越预设边界 ⇒ 转异常并追认审查”的负向测试。 |
| L3J-P1-08 | P1 | E（错误通道缺失） / A | 80:1374、80:1387、80:1410、80:1634、80:1668、80:1764、80:1775、80:1797、80:1808、80:1819、80:1474、80:1021 | 10 个方法裸返回：`AUTH-04.release` 是写方法却 `Promise<void>`；`AUTH-05.chain`、`AUTH-07.recoveryPreconditions` 回 `Promise<readonly …[]>`；`DEC-01.get`、`WORK-02.current`、`WORK-04.get`、`WORK-05.state`、`WORK-07.status`、`WORK-08.current`、`WORK-09.current` 回 `T \| undefined` 且无 `Result`。§6.3 的规则是“读失败不得降级成 `undefined`/空页”（80:1474），§5.7 也禁止“签名裸返回、错误栏写 rejected_*”。 | 这些方法都会经 `RecordReader` 读库，库不可读时无通道可报；`undefined`/空数组会被读成“未登记/没有”，从而可能重复建单、重复结清或把授权链判成断链。`release` 更是写方法：失败被吞掉，租约仍持有/围栏状态未知。 | 统一改为 `Promise<Result<T \| undefined, ClassifiedError>>`（或定义 `ReadOutcome`），`release` 改 `Result<void, …>`；明确“`Ok(undefined)` 只表示不存在，读失败一律 `Err(unavailable/STALL)`”；补库故障负向测试（至少 `WORK-05.state`、`WORK-07.status`、`AUTH-04.release` 三处）。 |
| L3J-P1-09 | P1 | F/B（权责/机制缺口） | 80:2137、80:2141-2159、80:2170、80:2173、80:2175 | `plan(req)` 是同步的；`MigrationPlan.dryRun.reportArtifactRef?` 没说由谁写、计划存哪；`apply(plan)` 接收调用方给的 plan，无法证明它来自一次干跑；`MigrationRequest`/`MigrationPlan` **没有** `authorizationRef`，而 §6.6 要求 schema 迁移记录含“批准（`authorizationRef`：谁依何权批准这次迁移）”。 | 迁移是可能不可逆的动作，记录要求“谁批准”，端口却没有批准入参；“必须先干跑”只是前置声明，没有持久化干跑计划的机制，调用方可以拿一份没干跑过的 plan 来 apply（`planDigest` 只能和“已干跑的那份”比，但那份不在任何可读处）。 | 给 `MigrationRequest`/`MigrationPlan` 加 `authorizationRef`；增加 `persistPlan`/`getPlan`（或把计划落成 `REC-MIG-01` 的干跑记录）；定义 `reportArtifactRef` 的产物落点；`apply` 必须读已存的 planDigest 校验；补“未干跑”“批准缺失”两条负向测试。 |
| L3J-P1-10 | P1 | A/E（失败不可表达） | 80:1494-1498、80:1527 | `TableProjectionResult = { kind:'table'; name; rows; cursor }`，没有 `state`/`gaps`/错误字段；§6.3 却写“表投影无 `Result` 通道——失败以 `kind` 与 `state` 结论表达”。 | 表投影失败/部分成功时没有表达位：`rows` 少了也看着像成功，`cursor` 为 null 会被读成“做完了”；只有“投影定义未注册/库不可打开”才允许抛，其余失败无出口。这直接违反 80 自己的“未知不得显示为 0/空/绿”。 | 给 `TableProjectionResult` 加 `state: 'complete' \| 'partial' \| 'failed'` + `gaps`，或改回 `Result`；定义 partial 时 `rows`/`cursor` 的含义；补“投影中途失败 ⇒ 不得报成功”的负向测试。 |
| L3J-P1-11 | P1 | B（关键出口缺失） | 80:1904、80:1907、80:1913-1916；`packages/contract/src/ports/executor.ts:12`、`:51` | 四原语为 `launch`/`stream`/`resultStats`/`kill`；`cancel_turn` 只是能力声明（仓库内除类型与测试外无消费方）；`kill(h, graceMs): Promise<void>` 无回执；`TaskBrief` 无超时/截止字段；§6.5 目标“只补两处”（`planRef`、`fence`），未提取消/超时。 | 失败保留（`turn_end.completed`/`errorCode`），但**取消**只有进程级 `kill`，单轮 cancel 的能力声明没有对应操作；`kill` 返回 void，无法证明“等死”，也无法区分“kill 成功”与“kill 失败/进程早已退出”。**超时**在端口上无表达，§8.4 把 timeout 放到引擎侧，但 §6.5 没有说由谁计时、如何把“超时”记为 `timeout`（而不是 boolean 失败）。执行面最关键的两个异常出口仍然靠端口外的约定。 | 明确“取消=进程 kill”并说明 `cancel_turn` 仅为咨询能力（或加 `cancelTurn(h)`）；把超时计时/记录写进 §6.5 的调用点或 §8.4，确保“超时先落 `REC-EVT-03`、不得折算失败”；`kill` 返回 `Result<void, …>` 或终态回执；补 kill 失败、timeout、单轮 cancel 三条负向测试。 |

### 2.3 P2

| ID | 级别 | 类型 | 位置 | 事实/引文 | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3J-P2-01 | P2 | D/A（四态不诚实/自相矛盾） | 80:24、80:1095-1100、80:1110、80:1477、80:4014、80:1121、80:1128、80:1994 | §0.1 的状态词是“已有/库级存在/目标/未证”；§6.0 另定义“已有/局部/包装/新建”；`RecordWriter/RecordReader` 在 80:1110 是“**新建**”，`RecordReader` 在 80:1477 又写“包装 `Ledger.queryEvents`”，而 D32（80:4014）明说“状态由「包装」改「新建」，不得再写包装”。 | 同一端口两个状态，且 §6.0 的第二套词表没有映射到 §0.1，读者无法判断“包装”算“库级存在”还是“目标”。AcceptanceEvaluator 的“包装（前）”包的是 v0 占位 GateRunner（`apps/daemon/src/engine/gate.ts:10` 自标“v0 占位”，exit0 是模拟）；EffectGateway 的“包装”同段又写“目标实现与回执能力均未落地”；Notifier 的“已有（端口）/局部（实现）”不符合“已有=在主循环里被调用”（daemon 源码无 Notifier 引用，`matrixSessionFactory` 也仅是目标）。 | 统一到 §0.1 四态并给出映射（局部→库级存在/未接运行链，包装→库级存在，新建→目标）；把 `RecordReader` 的 80:1477 改“新建”；“包装”只用于已有真实等价物的端口；v0 占位与“均未落地”的端口改“目标/未证”。 |
| L3J-P2-02 | P2 | C/G（记录多主/错主） | 80:780、80:1160、80:782、80:1970、80:788、80:1358、80:821、80:2200、80:2113 | `REC-RCP-01` 表行只归 EFF-01，但 SPEC-03 的 `ImportReceipt` 自称“是 `REC-RCP-01` 的投影”；`REC-EVT-01` 表行只写 RecordWriter 且注“源 ingest 触发、单写口”，EFF-01 又直接追加 EVT-01；`REC-OBS-02` 表行归 OBS-01，NOTI-01 与 BIND-01 的消费方也写它；AUTH-02 说探测结果落 `REC-AUTH-04`（凭据引用）或 `REC-EVT-02`（对账）。 | §4.7 声称“每类记录有谁执行/哪个端口”，实际是多主：读者无法判断哪个是语义主、哪个只是物理写口。AUTH-02 把“端点可达性探测”写进“凭据引用”尤其错位——REC-AUTH-04 只存凭据引用，探测结果不是凭据。 | 在 §4.7 加“语义主 / 物理写口 / 其他触发方”三列；对 `REC-RCP-01`、`REC-EVT-01`、`REC-OBS-02` 逐条写清多写是否允许；AUTH-02 的探测落点改为 `REC-EVT-02` 或新的观测记录，不要写 `REC-AUTH-04`。 |
| L3J-P2-03 | P2 | E（声明不可达） | 80:2184、80:2188-2193、80:2199、80:2208 | `NotificationEnvelope` 定义了 `notificationId`/`targets`/`dedupKey`，但 `Notifier.send(channel, message)` 只收 `Notification`；`NotifyBroadcastFace.send(message, targets)` 也不收 envelope；§6.6 却要求“重复投递由订阅方按 `NotificationEnvelope.notificationId`（或 `dedupKey`）去重”。 | 去重键没有任何路径到达订阅方：`send` 只传 `Notification`，接收方拿不到 `notificationId`/`dedupKey`。于是“至少一次”投递实际是“无法去重的至少一次”，文档的去重承诺不可实现。 | 加 `sendEnvelope(env)`（或把 `notificationId` 放进投递面/消息），或删掉 envelope 并把去重明确放到发送侧；写明 at-least-once 的去重点与幂等窗。 |
| L3J-P2-04 | P2 | A（纯读/写矛盾） | 80:2114、80:2129 | `describe`/`mapState` 被称“纯读”；同节又说 `describe()`“执行探针、合并档案、**按需写 `REC-LOSS-01` 引用**”。 | `describe` 若写记录，就不是纯读：它需要写权、事务、幂等与失败通道（`describe` 只有 `Result<BindingProfile,…>`，没有写回执）；若“写引用”由别人做，就不该写在 `describe` 的职责里。两种读法会导出两种实现。 | 把写 `REC-LOSS-01` 拆成独立的写方法（带权源/事务/回执），`describe` 与 `mapState` 保持只读；或明确 `describe` 是“读+按需写”并补写权限、事务、幂等与失败语义。 |
| L3J-P2-05 | P2 | E/G（ID 类型误用/字段过宽） | 80:2149、80:2146、80:470 | `MigrationPlan.planId: Qid`，但计划不是记录；同卷 80:470 只说 `planDigest`“不冒充记录”；`MigrationScope.recordKinds: readonly string[]`。 | `Qid` 在 §4.2 的定义是记录身份（`kind='record'`），`planId` 用 `Qid` 却没有计划记录类型；要么它是“指向某条记录的 id”（无此记录），要么是“产物标识”（应为 string）。`recordKinds` 用自由 string 与 77 的 50 类封闭词表不一致。 | `planId` 改 `string`（产物/计划标识），或定义干跑计划记录并让 `planId` 指向它；`recordKinds` 改 `readonly RecTypeName[]`。 |
| L3J-P2-06 | P2 | E（类型未定义） | 80:1374、80:1375、80:1987、80:1797、80:1786、80:1588、80:1590、80:1775 | `LeaseScope`、`WriterId`、`FenceToken`（“单调递增”但无形状）、`AcceptanceRequest`、`SettlementRequest`、`TerminalDisposition`、`ReconcileScope`、`UnknownDraft`、`TransitionBasis` 均在端口签名中出现，但全卷无 TS 定义。 | 这些不是 77 的字段表能替代的 TS 请求形状：`FenceToken` 的形状决定跨进程围栏怎么比较/持久化；`AcceptanceRequest` 决定评估者与交付方的独立性怎么带入；`TransitionBasis` 的“含权源与证据引用”过虚。字段无类型/来源/空值/默认，正落在本次审计的 E 类。 | 在 §6 的端口旁补最小 TS 定义（或在 §4.3 统一）；至少给 `FenceToken`（number/string + 单调比较规则）、`LeaseScope`、`AcceptanceRequest`、`TerminalDisposition`、`TransitionBasis` 五件。 |
| L3J-P2-07 | P2 | A（时钟纪律） | 80:1856、80:1887、80:1893、80:1895 | `ResourceBaselineRequest` 有 `asOf`，且注“端口不读宿主时间”；`gap(subject)` 没有 `asOf`；`baseline`/`gap` 共用一个“同一 `asOf` 下重算一致”的幂等句。 | `gap(subject)` 没有时点，只能读宿主时钟或隐式取“现在”，与同端口的“端口不读宿主时间”和“同一 `asOf` 重算一致”直接冲突；`gap` 的结果不可复现。 | `gap(req: { subject; asOf })` 或 `gap(subject, asOf)`，与 `baseline` 用同一 `asOf`；补“同一 asOf 两次 gap 逐字段一致”的测试。 |
| L3J-P2-08 | P2 | A/E（幂等不可判） | 80:1775、80:1779、80:1780 | `TransitionExpectation` 只有 `expectedState` + `expectedLineageHead`；错误行说链顶不符 ⇒ `rejected_version`；幂等行又说“同一迁移重复提交返回既有记录（链顶已是本条即幂等）”。 | 第一次提交成功后链顶已是新记录；重试仍带旧 `expectedLineageHead` ⇒ 按错误行是 `rejected_version`，按幂等行却是成功。要判“链顶已是本条”必须比较 `ticket`/`to`/`basis` 内容，但签名里没有幂等键，判据未定义。 | 定义幂等判据（同 `ticket` + `to` + `basisDigest` + `expectedState`，且链顶记录内容等于本次迁移），或加 `idempotencyKey`；明确“重试时 expectedLineageHead 应给旧链顶还是允许 head==本记录”。 |
| L3J-P2-09 | P2 | D（目标写成已有） | 80:1969、80:569；`packages/gateway/src/actions.ts` | §6.6 写“**现有** `packages/gateway/src/actions.ts` 唯一负责 `ControlEffectAction → { gatewayAction, args }` 映射和编解码”；§4.3.1 却写“`CONTROL_EFFECT_ACTIONS` 是目标集合，不是当前 `GATEWAY_ACTIONS` 已扩大的事实”。仓库检索 `ControlEffectAction` 零命中，`actions.ts` 只导出 `parseAction`/`isFreeformChinese`。 | 这是把目标写成现状：九动作映射尚不存在，`actions.ts` 目前只是 `@action` 行解析器。读者会以为映射已具备，从而跳过效果路径最关键的动作/scope 校验实现。 | 把“现有”改为“目标落点（`F-gateway-actions`，未实现）”，或在实现映射后再写“现有”；在 §6.6 明说“当前只有六个 `GATEWAY_ACTIONS`，九动作是目标”。 |

## 三、覆盖核对

### 3.1 已覆盖的对象/章节/ID

- **§6.0–§6.6 全部 47 个端口标题**逐条读过（不是只读目录）：SPEC-01/02/03、RULE-01；AUTH-01…07；REC-01…06；CMD-01、DEC-01；WORK-01…11；RES-01；EXEC-01；CAP-01…06；EFF-01；EVD-01/02；MEM-01；OBS-01；BIND-01；MIG-01；NOTI-01；API-01。
- **§6.0 计数核对**：`grep -c '^#### TS-PORT-'` = 55（全卷），其中 §6.1–§6.6 = 47，§6.7 = 8；分组求和（SPEC 3 / RULE 1 / AUTH 7 / REC 6 / CMD 1 / DEC 1 / WORK 11 / RES 1 / EXEC 1 / CAP 6 / EFF 1 / EVD 5 / MEM 1 / OBS 1 / OBL 1 / LIFE 4 / BIND 1 / MIG 1 / NOTI 1 / API 1）= 55。**计数通过。**
- **record→port 映射**：读了 §4.7 的 50 行与 §4.8 的 2 行（`REC-MIG-01`、`REC-LOSS-01`）。逐类核对结果：50 类都有至少一个端口；**`REC-EXC-02` 的“端口”是“停机通道”，不是 TS 端口**（P1-07）；**CAP-01..06 没有任何 `REC-*` 行**（P1-06）；`REC-RCP-01`/`REC-EVT-01`/`REC-OBS-02`/`REC-AUTH-04` 存在多写/错写（P2-02）。
- **§6.6 是否混合效果/证据/验收**：未混合。EFF-01 与 EVD-01/EVD-02 分录；EVD-01 明写“只收材料、不判验收”，EVD-02 明写“接受≠结清”。EFF-01 内部有“验签闸门 + 注入的 `EffectWriter` + 回执/未知”编排，但 `EffectWriter` 被明确声明为内部注入面、不是第二公共端口；未发现自授权/自验收的**声明**（其授权核验的接缝见“未证”）。
- **执行面四原语**：`launch`/`stream`/`resultStats`/`kill` 都在；失败由 `turn_end.completed`/`errorCode` 与 `resultStats` 保留；取消/超时的缺口见 P1-11。附：四要件的“闸门 exit=0”来自 `GateRunner`（engine.ts:1257 读 `gate.exitCode`），不是 executor 进程退出码——这一点文档没有误称，故不列为发现。
- **§6.3 记录面不变量**：四张表、四条可测不变量、`commitSeq`/`proofRef` 无窗口、17+1 投影名、`payload(ref)` 四态都与 §6.0/§6.6 的引用一致（除 P0-01 的读上下文与 P1-10 的表投影失败表达）。
- **§6.4 工作面**：`ReadinessVerdict` 三中文值、`ReadinessJudgeRole` 六英文内部名、`RecReadinessJudgment` 13 字段、`judgeRole` 逐门列表、`refused` 不升级为第四值——内部自洽；其与 77-§4.4.1 的逐字段对齐只做了抽查（见“未证”）。
- **§6.5 现有端口保留清单**：§6.8 的 `FlowPlatform`/`Ledger`/`GateRunner` 等保留理由与 §6.9 的落点表一致；`FlowPlatform` 确为七能力（`contract/src/ports/platform.ts:179` 起），`Ledger.appendEvent` 确为 events 唯一写口（`packages/store/src/ledger.ts:233`）。
- **代码锚点抽查**（只核对“文件存在、行号内容对得上”，不执行）：`contract/src/ports/executor.ts:43`（ExecutorAdapter）、`notifier.ts:6`–`:13`（Notification）、`platform.ts:4`/`:157`/`:179`、`company.ts:9`（PlatformBinding）、`invoke.ts:29`（InvokeSource）、`ports/index.ts:6`（`PORT_VERSION='v0'`）、`store/src/ledger.ts:233`/`:865`/`:948`、`engine/engine.ts:1146`/`:1224`/`:1361`/`:1585`/`:1963`/`:2032`、`engine/gate.ts:47`/`:76`、`gateway/src/gateway.ts:52`、`engine/tools/gated-platform.ts:66`（九条写面）、`engine/fakes.ts:78`/`:333`、`engine/notify/broadcast.ts:27`–`:35`、`panel/src/external/server.ts:100`/`:487`/`:491`、`schemas/errors.ts:54`/`:77`。**未发现断锚**。注：80 的 `engine.ts:nnnn` 是 `apps/daemon/src/engine/engine.ts` 的简写，`store/src/ledger.ts` 是 `packages/store/src/ledger.ts` 的简写，行号均对得上。
- **零命中核对**：仓库检索 `ControlEffectAction`/`CONTROL_EFFECT_ACTIONS` 为零；`cancel_turn` 仅出现在 contract 类型、`engine/fakes.ts` 的假体与测试夹具，适配器实现与主循环均无消费方；`matrixSessionFactory` 在代码中零命中（与 §6.6 NOTI-01 的“目标态”说法一致，但与“已有”状态不一致）。
- **§0.1/§0.3/§5.2/§5.7/§6.9/§12.7 的支撑口径**读过，用于判定状态、错误通道与拒绝通道；§6.10/§6.11 读过，用于判断验证责任与覆盖声明。

### 3.2 未覆盖清单

- **§6.7 的 8 个端口**（EVD-03/04/05、OBL-01、LIFE-01…04）不在本次行号范围；只核了它们在 §4.7/§4.8 的记录映射行，未审其端口定义（属另一位审计员）。
- **§7–§12** 只在需要引用时抽读（§8.4 超时/取消、§8.6 时钟、§9.4 回执、§12.7 反例、§12.8 锚点表）；未做整段审计。
- **76/77/78 全卷字段表**未逐表通读：只抽查了 77-§4.1.1/§4.1.2（REC-WORK-01/02）、77-§3.1（REC-AUTH-01）、77-§2.4（REC-RCP-01）、77-§6.7（REC-EXC-02）、78-§1.2（BIND 20 字段）；其余 50 类记录的字段表未逐字段核对。
- **81/82 的逐文件/波次/探针**未审（不属于本层），只把 `contract/src/ports/executor.ts`、`packages/gateway/src/actions.ts` 等作为事实锚点。
- **运行时**：未执行 `bun run typecheck`、`bun run test`、`bun run guard:boundaries`；未启动 daemon；未复现文档里的 `209` 个测试文件、`44763` 行等基线。所有“已有/实现”的判断只到“端口形状存在 + 主循环有调用点”的代码检索级别。
- **`21`–`62` 历史探索**、**`75` 原文**（只通过 80-§0.1 的转述使用四态）、`78a`、`81-files` 均未审。

## 四、未证与无法判断

1. **`RecordReader` 是否只供 daemon 内部可信调用**：文档没有明说。若是内部专用，P0-01 的严重度可降为“需写明内部限定”，但 §6.3 的 `query.knowledgeScope` 与 §9.4 `searchKb` 的用法表明它要承载外部调用者的范围，故本报告按公共读面判 P0；若作者能证明“所有调用点都在 daemon 内且调用者范围由外层强制”，请把该限定写进端口并降级。
2. **`EffectGateway` 的 `authorityRef` 由谁核验**：错误行有 `rejected_authority`/`rejected_forbidden`，但步骤 ② 只写“解析 `authorityRef`、凭据与 fence，完成动作编码和内核验签”。是否另由上游（CMD-01 的 REC-CMD-02、AUTH-05 的 `exercise`）核验，文档没有给出引用；本报告不把它列为已证漏洞，只标“未证”。
3. **`describe()` 是否写 `REC-LOSS-01`**：80:2114 与 80:2129 两种说法并存（P2-04）。若“按需写”指“准备写而不落记录”，请写明；否则按写路径补权/事务。
4. **CAP-02/03/05/06 的回执是否 `REC-RCP-01` 投影**：文档只写“安装回执（不是 REC-WORK-*）”，没有说是不是 `REC-RCP-01`；若是，§4.7 的 `REC-RCP-01` 行应补生产者；若不是，则没有记录类型（P1-06）。
5. **`PlatformBindingPort` 是否按绑定实例化**：若 `assembly/platform/binding.ts` 导出的是“一绑定一实例”的工厂，P1-05 降为“文档未写清”；但 §6.9 只写“唯一宿主”，未写工厂/基数。
6. **`MigrationService` 的干跑计划是否由 81/82 另行持久化**：80 内没有 `getPlan`/存储声明；若在下游有，P1-09 的“无落点”应改为“本卷未写、下游待补”。
7. **77 的 `REC-WORK-02.intent_ref` 与 80 的 `IntakeOutcome` 映射**：77 只规定字段必填，未规定“由队列携带还是按 IntentKey 回查”；本报告按“必须由队列携带”判 P1，若作者选择回查，需在 80 写出歧义消解规则。
8. **`§6.0` 的“已有/局部/包装/新建”是否只是工作策略而非状态**：若作者主张“包装/局部”是施工策略、不是四态，P2-01 可降为“词表需加一段映射”；但 `RecordReader` 的“新建/包装”直接矛盾与 D32 的“改新建”仍是硬冲突。
9. **文档里的全量声明**（`209` 测试、`55` 端口、`50` 类记录、`17+1` 投影名）：本报告只复算了 55 端口与 50 类记录行；测试数、行数、`guard` 基线未复算，均标“未证”。
10. **`§6.6` 的“九动作映射”是否为 81 的 `F-gateway-actions` 目标文件**：仓库无 `ControlEffectAction`，但 81 可能把该文件登记为“目标”；本报告按 80:1969 的“现有”措辞判 P2，若 81 已标目标，则只需改 80 的措辞。

## 五、给作者的修复顺序（≤7 条）

1. **先堵 P0-01**：给 `RecordReader.get`/`payload` 与 `RecordQuery` 定必填 `AccessContext`/`knowledgeScope`，写“缺省=拒”，补越权负向探针。这是唯一直接落在数据/安全边界上的问题，且改动只在端口签名与探针，不需要重写记录面。
2. **再定记录事务与投影钩子（P1-01 + P1-02）**：在 `AppendOptions`/REC-04 上打通“记录写进事务”，在 store 上定义 `ProjectionHook` 同事务触发；把 `IntentReceiptStore` 的依赖从 `Ledger` 改为记录句柄。这两个决定必须先于任何多记录端口（CMD-01/AUTH-05/EFF-01）开工。
3. **同一批定意图身份（P1-03 + P1-04）**：定义 `idempotencyKey` 语义，把 `intentRef` 随队列项传递并写进 `REC-WORK-02.intent_ref`。这两条决定“外部提交→受理→回执”链能否被唯一地重放/对账，属于外部 API 的根。
4. **补齐错误通道（P1-08）**：10 个读写方法改 `Result`/`ReadOutcome`，`release` 改 `Result<void,…>`；与第 2/3 条同一批改签名，避免二次返工。
5. **补状态变化路径的记录与出口（P1-06 + P1-07 + P1-11）**：能力安装/挂载/探测/激活/退役的记录落点、紧急止损端口、执行面 kill/超时/单轮 cancel 的语义。三处都是“状态变了但没有记录/没有出口”的同类问题。
6. **收 §6.6 的三处（P1-05 + P1-09 + P1-10）**：BIND 绑定选择器、MIG 干跑/批准落点、表投影失败表达。这三处影响绑定档案、迁移与投影的可审性，但不阻塞前面 1–5 的施工。
7. **最后清 P2 批次（P2-01…09）**：先改状态矩阵与 `RecordReader` 的 80:1477（一字改动），再补 §4.7 的“语义主/物理写口”列与 AUTH-02 的探测落点；Notifier envelope、BIND describe 的读写分离、`planId` 类型、未定义类型、`gap` 的 `asOf`、WORK-05 幂等、EFF 的“现有”措辞可随各端口一并修。

## 六、本报告没有做什么

- **没有修改任何现有文档、源码、配置**；只新增本报告。
- **没有替作者重写端口**；只给最小修复路径，不重排 §6 的结构。
- **没有做跨层结论**：77 的 `intent_ref`、78 的多 BIND、76 的 SG-07 只作为证据引用；它们是否成立、是否要改，归 C 组与相应层。
- **没有做 §6.7 的端口审计**（EVD-03/04/05、OBL-01、LIFE-01…04）；本报告只在 record→port 映射层面核了它们。
- **没有做运行时验证**：未跑测试/类型/边界门禁，未复现文档的全量计数；所有“已有/包装/未实现”的判断只到“代码检索 + 锚点行”级别。
- **没有做 P3 编辑校对**（错别字、表格对齐、术语大小写）；本报告只在术语多义（如“信封/RecordEnvelope”“停机通道”）影响理解时记录。
- **没有把“设计上可修”当成“已修”**：凡标“未证”的，都是本报告无法从文档/代码确认的；不替作者补证。
