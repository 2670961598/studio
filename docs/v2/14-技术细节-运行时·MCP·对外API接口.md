# V2·14 · 技术细节：运行时·MCP·对外 API 接口

> 头注：**v2，替代 docs/80（扩 MCP＋API 面）**——docs/80 及其 55 个 `TS-PORT-*` 整体转「历史·非现行」素材；V2 端口语义以 v2/05 §四 13 端口为准，接口签名与端口-文件映射的唯一主表在本卷。
> 版本：v2.1-draft｜日期：2026-10-28（原 v2.0-draft 2026-10-27）｜编写：最高宰相（运行时接口卷撰写子代理·GLM-5.3）｜修订依据：2026-10-28 制作人开工令（docs/49）＋修订令摘要 2026-10-28 修订令 §1.1-§1.8（明细见卷末「修订记录（2026-10-28）」）｜性质：V2 细节九卷之一。**端口计数不变＝13（修订令 §〇.5「PORT 14」与 05/09/14 现行口径及「不新增端口」指令冲突，已在卷末与回报中列明）。**
> 上位：v2/00（宪法——冻结门 F5「端口-文件映射单点」）、v2/05（PORT- 13 端口表·DOM- 分域权威表）；语义上游：v2/02/03/04（三册）、v2/06（ASSET-）、v2/07（CAP-/EXEC-/派生树）、v2/08（EVD-/MEM-/MON-/OBS-）、v2/11（REC- 74 类记录——本卷接口覆盖其读写，生产者主表在彼）、v2/12（BIND-/WS- 六区/PRM 段语义）、v2/15（SEC-SIG/SEC-WD/SEC-RD/SEC-FC）。
> 制作人裁决：**84 裁决二**（studio-tools MCP 与对外 API 纳入本次大重构：「人事改人事信息、财务查看、研发申请权限等都经 StudioNext 的 MCP 提供，而不是一股脑塞提示词」「对外除 MCP 外还要提供很多 API 与其他工具对接」）；docs/24（AI 接入面分层——现状设计事实：知识归 AGENTS.md 组装／工具归内部 MCP／对外归协议端点）。
> 审计输入：GLM H3b（P0×1＋P1×3）、C3-P1×3、K5；DSF V08-P0-02/P0-04、V11（P0×1＋P1×7）、L3-I（P1×6）／L3-J（P0×1＋P1×11）／L3-K（P0×1＋P1×7）。
> 状态：**draft——F8 未签不得标「定稿」；施工按 `docs/49` 2026-10-28 开工令 §3 与 F8 并行**（F8 外部签认不阻断施工）。
> 本卷主问题：**13 个端口的接口签名是什么、每个端口的类型落点在哪个文件且只有一处；员工与外部系统分别经什么工具面与端点面触达框架而不越过权责链；每一次平台写入在接口层如何携带署名、公司维与幂等键。**

---

## 〇、职责边界、前缀与总约定

### 0.1 职责边界

| 关系 | 本卷义务 | 本卷不做 |
|---|---|---|
| 对 v2/05 | 为 §四 13 端口给出接口签名（类型描述）、读写记录族引位、错误与幂等口径；**端口-文件映射单点表**（F5 唯一源） | 不重定义端口职责与所属域（主表 v2/05 §四） |
| 对 v2/11 | 接口须覆盖 REC- 74 类的读写面（逐类生产者以 v2/11 §一为准，本卷不重列——防双源） | 不定义记录字段形状与状态机（v2/11 §十四） |
| 对 v2/15 | 在签名层落 SEC-SIG-01 三值署名、SEC-WD-01 公司维、SEC-RD-01 读面字段承载、SEC-SIG-03 ctl- 词族 | 不定义机制实现（fail-closed 强制点归 15） |
| 对 v2/12/16 | PRM 生成器与工作空间端口签名；逐文件落点引位 | 不写绑定档案与迁移波次（v2/16） |
| 对 v2/09 | 新族 `MCP-`、`API-` 登记；本卷零枚举字面量 | — |

**前缀裁定（本卷任务书原名 TOOL-，改立 MCP-）**：v2/13 已把 `TOOL-` 登记为工具链约束族（TOOL-01..08，登记 v2/09）；本卷工具面若复用 `TOOL-` 即造同名异义（V11-02 同病）。故本卷立 **`MCP-`**（内部工具面条目）与 **`API-`**（对外端点条目）两族，语义唯一主表在本卷、登记 v2/09；`TOOL-` 维持 v2/13 语义不动。

### 0.2 接口层总约定（全端口共享，签名块只写增量）

```ts
interface CallContext {            // 一切写方法必带（缺任一即构造期非法）
  company: CompanyRef              // SEC-WD-01：多公司部署写必带；与平台绑定维不一致＝4xx/拒写
  caller: CallerRef                // 调用者身份（任职/位置/程序三分，v2/11 REC-MEM-02.who 同轴）
  authority: readonly GrantRef[]   // 权源主张（记录引用）；校验唯一经 PORT-AUTH，token/凭据不作权源
  signature: Signature             // SEC-SIG-01 三值（值集唯一主表 v2/09 ENU-118）{actorKind:'person'|'control'|'system', actorRef, onBehalfOf?}
  expected?: VersionRef            // 改状态调用必带预期版本（v2/11 §0.4-4；不匹配即拒并回当前版本）
}
interface ReadContext { readScope: ReadScope; caller: CallerRef }   // SEC-RD-01：本卷取「字段承载」二选一
type PortResult<T> = Result<T, ClassifiedError>   // 失败十四类（v2/11 §0.4-6 主表）；Err 必答「副作用可能/可否重试/对账入口」
```

1. **读面缺省＝拒**（治 L3J-P0-01）：`ReadContext` 必填；越权返回 `Err(rejected_forbidden)`，**不得** `Ok(undefined)` 冒充「无行」；`Ok(undefined)` 只表「权威确认不存在」。
2. **Err 语义**（治 L3I-03）：`Err` 只表「确定未产生外部效果的拒绝」；已发送而结果不明＝`Ok({state:'unknown', …})` 并先对账（REC-EVT-02），处置表不得按 failure 一刀切重试。
3. **幂等键**（治 L3J-P1-03）：作用域＝五元组（公司×对象类型×对象标识×操作类别×请求方序列，v2/11 §0.4-5）；同键同内容→返回既有结果＋`deduped:true`，同键不同内容→`Err(rejected_idempotency)`。本卷登记特化键：**意图保留键＝（公司×来源×种类×票据或去重键）四槽**（PORT-GATE.reserveIntent；五元组在该协议的实例化）；任命四元组／权威激活三元组／收割二元组沿用 v2/11 登记，**不得缩写**。
4. **签名类型不悬空**（治 L3K-04）：签名中出现的一切类型须有形状归属（本卷草案块／v2/10 数据形状／v2/11 记录形状）或显式标「只读视图＝某记录投影」；无归属即缺口登记 v2/17。
5. **方法集覆盖写入面**（治 L3K-03）：每端口方法须覆盖其记录族全部写入面（首笔＋状态推进＋修正）；「只有首笔方法」即缺口。事件观察类方法（observe/stream）**不得**作为任何迁移类方法的 trigger 权源（v2/11 §十四）。
6. **顶层判别**（治 L3I-02）：记录读面用顶层 `kind` 判别联合收窄，禁嵌套路径判别。
7. 触发源与生产者三分（发起型/决定型/规则型）主表 v2/11 §十四；本卷签名只挂方法，不重复边表。

---

## 一、运行时端口接口（PORT- 13；签名块为类型描述，非实现代码）

### 1.1 定义域：PORT-DEF／PORT-REG

```ts
// PORT-DEF 定义目录（只读组）
readRevision(ref: DefRef, rc): PortResult<DefinitionSnapshot>   // 不可变修订；草案当已批准＝拒
resolve(refs: readonly DefRef[], rc): PortResult<ResolutionReport> // 引用链完整性与版本对齐（禁「当前最新」）
diff(from: DefRef, to: DefRef, rc): PortResult<DefDiff>
list(q: DefQuery & ReadContext): PortResult<Page<DefEntry>>
// PORT-REG 定义与权威登记
submitRevision(d: RevisionDraft, ctx): PortResult<RevisionTicket>    // 只产候选，「已提交」≠「已生效」
registerApproval(t: RevisionTicket, decision: DecisionFace, ctx): PortResult<ApprovalRef>
activateAuthority(req: ActivationRequest, ctx): PortResult<ActivationReceipt>  // REC-AUTH-07；幂等键=(域×端点×代次)
fenceWriter(req: FenceRequest, ctx): PortResult<FenceObservation>    // REC-AUTH-06；冻结旧写入者（围栏机制目标未证）
```
记录族：读 REC-ASSET-01 与组织面登记（DOM-01 投影）；写 REC-AUTH-06/07、定义修订链（DOM-01 挂单 commit，daemon 唯一写入者）。错误：`rejected_precondition`（草案/断链）、`rejected_version`（代次竞争）——保持冻结、交终裁位置，不单方宣布。

### 1.2 治理域：PORT-AUTH

```ts
verify(cmd: CommandRef, rc): PortResult<PolicyVerdict>            // REC-CMD-02；政策四态主表 v2/09
registerDecision(d: DecisionDraft, ctx): PortResult<DecisionRef>  // 具名决定；专用类型优先，无专用才 REC-DEC-01（一事件一身份）
exercise(use: ExerciseClaim, ctx): PortResult<ExerciseReceipt>    // REC-AUTH-02——端口侧落账，禁调用方自报（L3K-14 教训）
withdraw(req: WithdrawRequest, ctx): PortResult<WithdrawReceipt>  // REC-AUTH-03：descendants[]＋deactivation_evidence＋无后代显式确认
checkConflicts(subject: SubjectRef, rc): PortResult<ConflictReport> // 禁配与独立性核验（消费 REC-LIFE-05）
```
记录族：REC-CMD-01/02、REC-DEC-01、REC-AUTH-01..03。撤回网关强制（后代批量吊销）＝**目标（未证）**（v2/15 SEC-REV-02）；建成前以 REC-EVD-RVK＋审计断言代偿。**本端口不供能给任何「绕过其余端口」的直写路径**（PORT-OPS 的唯一供能者）。

### 1.3 人事域：PORT-HR（studio-tools 人事工具的后门）

```ts
submitAppointment(d: AppointmentDraft, ctx): PortResult<AppointmentRef>  // REC-LIFE-01 拟任面；幂等键四元组
transitionLifecycle(req: LifecycleTransitionRequest, ctx): PortResult<TransitionRef>  // REC-LIFE-02；按边触发者（v2/11 §14.2）
settleEmployment(face: 'handover'|'settlement', items, ctx): PortResult<SettlementRef> // REC-LIFE-03 两段式
recordPerformance(d: PerformanceDraft, ctx): PortResult<PerformanceRef>  // REC-PERF-01；评价位置独立（不得自评）
declareInterest(d: InterestDeclaration, ctx): PortResult<RegistryRef>   // REC-LIFE-05 申报面
current(q: HolderQuery, rc): PortResult<EmploymentView>                 // 任职视图（六状态投影）
```
记录族：REC-LIFE-01..06、REC-PERF-01。「非在岗态发起出工」网关拒绝＝**目标（未证）**，建成前以 REC-LIFE-02＋审计断言代偿（v2/02 §3.4）。

### 1.4 工作域：PORT-WORK

```ts
reserveIntent(intent: IntentEnvelope, ctx): PortResult<IntentTicket>    // REC-WORK-01 唯一写口；幂等键=四槽（§0.2-3）
recordIntake(d: IntakeDecisionDraft, ctx): PortResult<IntakeRef>       // REC-WORK-02（决定面）
reviseContract(d: ContractRevisionDraft, ctx): PortResult<ContractRef> // REC-WORK-03；承诺类变更走 COMMIT-CHANGE 程序
judgeReadiness(d: ReadinessJudgmentDraft, ctx): PortResult<GateRef>    // REC-WORK-04 五门各一；judge→role 封闭映射（v2/11）
lockPlan(d: PlanLockDraft, ctx): PortResult<PlanRef>                    // REC-WORK-05
transition(req: WorkTransitionRequest, ctx): PortResult<TransitionRef> // REC-WORK-06；trigger_ref 必填且为前置记录（治 L3K-01）
classifyEffect(d: EffectClassDraft, ctx): PortResult<ClassRef>         // REC-WORK-07（交付方 +1 独立首判）
recordCompletion / recordAcceptance / recordMaintAcceptance（d, ctx）   // REC-WORK-08/09/ACCEPT-MAINT
raiseException(d: ExceptionDraft, ctx): PortResult<ExceptionRef>       // REC-WORK-17（receiver 必填具名）
reopen / recordSettlement(d, ctx)                                       // REC-WORK-11/12
submitHandover / requestAssignment(d, ctx)                              // REC-WORK-HANDOVER/13
addComment(a: PlatformActivity, ctx): PortResult<ActivityRef>          // REC-EVT-01；评论塞无权决定＝拒
```
记录族：REC-WORK 全族＋REC-EVT-01。事件流、执行面自报终态、平台「完成」标记不得触发迁移（v2/07 §三总规则）。守护计时者（规则型生产者）＝**目标（未证）**。

### 1.5 执行域：PORT-EXEC／PORT-WS

```ts
// PORT-EXEC 执行能力（DSH 主绑定）
selectExecutor(c: SelectionChain, rc): PortResult<ExecutorChoice>  // 单据指定＞岗位绑定＞默认（DSH）；选择≠授权
launch(b: DispatchBrief, ctx): PortResult<SegmentReceipt>          // 简报九件（v2/07 EXEC-01）；三 fail-closed 前置（策略投影/能力覆盖/秘密确认）
observe(handle): AsyncIterable<SegmentEvent>                        // 流式事件＝收割输入，只观察
resultStats(handle, rc): PortResult<TerminalStats>                  // 终态五值，不压缩布尔（v2/07 EXEC-05）
kill(req: KillRequest, ctx): PortResult<KillReceipt>                // 整树终树＋围栏；无终态事件→结果「不明」先对账
compileProjection(input: ProjectionInput): PortResult<PolicyProjection> // PRM 生成器（§六）；纯函数
// PORT-WS 工作空间（契约锚承接 v2/12 §三）
resolve(zone: WorkspaceZone, rc): PortResult<ZonePath>   // 六区相对路径；绝对路径不入公共类型
containment(target: RelPath, rc): PortResult<ContainmentReport>
realpath(p: RelPath, rc): PortResult<RelPath>
read/write(p, body?, ctx): PortResult<IOReceipt>          // 受限读写；cwd 不是隔离
stageArtifact(d: ArtifactDraft, ctx): PortResult<StagedRef> // 产物暂存→定稿走 PORT-EVD；交接材料同区
```
记录族：REC-LIFE-04（出工段）、REC-CAP-RECEIPT（探测/回执）、REC-ASSET-02（绑定损失）。PORT-WS 不落独立记录（写痕迹随 PORT-EVD/PORT-HIST）。

### 1.6 证据与记忆域：PORT-EVD／PORT-HIST

```ts
// PORT-EVD 产物与证据
harvest(seg: SegmentRef, window: Window, ctx): PortResult<HarvestBatch>   // REC-EVD-01；幂等键=(出工段×采集区间)
registerItem(d: EvidenceItemDraft, ctx): PortResult<ItemRef>              // REC-EVD-02——收草案不收记录（L3K-14）
assemblePackage(d: PackageDraft, ctx): PortResult<PackageRef>             // REC-EVD-03 八要素
assessValue / postAudit / recordRevocation(d, ctx)                        // REC-EVD-04/05/RVK（judged_by＋独立性必填）
// PORT-HIST 历史与记忆（记录唯一写口）
append(d: RecordDraft, ctx, tx?: TxHandle): PortResult<RecordRef>         // 多记录同域原子：显式 tx 句柄（治 L3J-P1-01）
begin/commit/abort(tx, ctx): PortResult<TxReceipt>                        // 事务壳；投影钩子同事务触发＝目标（未证，治 L3J-P1-02）
get(ref: RecordRef, rc): PortResult<Record | undefined>                   // 越权=Err（§0.2-1）
query(q: RecordQuery & ReadContext): PortResult<Page<Record>>
payload(ref, rc): PortResult<PayloadView>          // 按信封知悉范围；byteDigestState: 'present'|'unknown'|'not-collected'（治 L3I-01）
correct(d: CorrectionDraft, ctx): PortResult<CorrectionRef>               // REC-COR-01 追加不覆盖
reconcile(q: ReconcileQuery, ctx): PortResult<ReconcileBatch>             // REC-EVT-02；对账完成前不得结清
memoryWrite / memoryDispose / memoryAuditAccess(d, ctx)                   // REC-MEM-01/03/02（处置授权主表 v2/03 表 D 行 10/11）
```

### 1.7 供给域：PORT-TRUST（凭据目录，无值）

```ts
verifySource(handle: TokenHandle, rc): PortResult<CallerRef>      // 来源核验；未核验只能暂缓或拒绝
issue(req: CredentialIssueRequest, ctx): PortResult<CredentialRef> // REC-AUTH-04 逻辑引用（类别+引用，永不回值）
supply(ref: CredentialRef, window: TTL, rc): PortResult<ShortLivedHandle> // 短时句柄；值不入提示词/日志/快照（v2/15 三不入）
revoke(ref, ctx): PortResult<RevocationReceipt>                    // 吊销三动作逐项留证（v2/15 SEC-SEC-03）
auditUse(q: UseQuery, rc): PortResult<Page<UseRecord>>             // MON-09 访问留痕消费面
```
记录族：REC-AUTH-04；秘密五型分类与差分主表 v2/15 §四。

### 1.8 入口、观察与运维域：PORT-GATE／PORT-OBS／PORT-OPS

```ts
// PORT-GATE 入口与通知（外部意图唯一入口；只落单不派工）
receiveIntent(p: ExternalIntent, ctx): PortResult<IntentReceipt>   // REC-WORK-01；intentRef 随队列传递（治 L3J-P1-04）
receipt(key: IntentKey, rc): PortResult<IntentReceipt | undefined>  // 读本进程投影快照；未命中≠不存在（HTTP 映射 503）
notify(e: NotificationEnvelope, ctx): PortResult<DeliveryReceipt>   // envelope（notificationId/dedupKey）直达订阅方；送达≠接受
// PORT-OBS 观察与基础服务（只读投影；监控不改事实）
snapshot(view: ViewId, rc): PortResult<Projection>   // REC-OBS-01；六态 state_assignments＋权威端点代次＋游标
reportFault(f: ProjectionFault, ctx): PortResult<FaultRef>  // REC-OBS-02 唯一写口；投影侧记录，不进事实 mutation 计数（治 L3K-07）
clock() / newId() / health(rc): 基础服务                 // 时钟/标识注入（v2/08 §4.4 读面写面隔离）
// PORT-OPS 操作与处置面（由 PORT-AUTH 供能，自身不新增权源）
exportBundle(req, ctx) / migrationCandidate(req, ctx) / preserve(req, ctx)   // 打包/迁移候选/保全
circuitBreak(req, ctx): PortResult<BreakReceipt>       // 止损围栏
emergencyStop(req: EmergencyStopRequest, ctx): PortResult<StopReceipt>  // REC-WORK-18 落口（命名治 L3J-P1-07「停机通道」）
```

**覆盖核对（一句话，防双源）**：REC- 74 类的写入面全部由上述 13 端口方法承载，逐类「生产者/写入者」以 v2/11 §一总表为唯一口径；端口方法缺承载的记录类＝缺口登记 v2/17（判据：v2/11 每族「生产者」列可指回本卷某方法签名）。

---

## 二、端口-文件映射单点表（冻结门 F5 唯一源；治 K5/H3b-P0-1）

**规则**：① PORT- 的公共类型形状**唯一**落 `packages/contract/src/ports/<file>.ts`，别处（core/store/daemon/平台包）不得定义公共端口形状；② 记录族形状（REC-）落 `contract/src/records/`（v2/11 域），不占 ports/ 平铺名额；③ 实现落点逐件归 v2/16（本表只给域级方向）；④ **任何他卷、附录（81-files）与代码头注与本表冲突，一律以本表为准并登记为改动项**——v1 docs/80-§6.9 与 81-files/01 对 7 个端口文件的互斥指认就此废止（两卷均历史）。

| PORT-ID | 类型唯一落点（packages/contract/src/ports/） | 实现域（引 v2/16） | 备注 |
|---|---|---|---|
| PORT-DEF | `def.ts` | core/spec＋assembly/spec | 读文件在 assembly，纯决策在 core |
| PORT-REG | `reg.ts` | core/authority＋store | DOM-01 挂单 commit 由 daemon |
| PORT-AUTH | `auth.ts` | core/authority＋gateway 编排（engine/tools） | gateway 只承内核验签，不承载授权判定 |
| PORT-HR | `hr.ts` | engine/hr | 六状态推进写路径齐（§0.2-5） |
| PORT-WORK | `work.ts` | engine/work；平台绑定接 binding（v2/12） | 五门纯求值唯一件 core/work-readiness（v2/16） |
| PORT-EXEC | `exec.ts` | adapters＋engine 派发域；PRM 生成器=core 纯函数 | 现状 `executor.ts`（v0 四原语）并入本件，退役归 MIG-06 |
| PORT-WS | `ws.ts` | engine/workspace＋seatbelt 接线 | 六区语义锚 v2/12 §三 |
| PORT-EVD | `evd.ts` | engine/harvest | 收割只读材料目录 |
| PORT-HIST | `hist.ts` | store（records/对账/记忆表族） | 唯一记录写口；DDL 归 v2/16 MIG-04 |
| PORT-TRUST | `trust.ts` | gateway 凭据＋assembly 供给 | 目录不存值（SEC-T3 域归 v2/15） |
| PORT-GATE | `gate.ts` | assembly/intent＋api 装配 | 吸收现状 `invoke.ts`/`notifier.ts`（两件并入后退役，MIG-06） |
| PORT-OBS | `obs.ts` | engine/observe＋panel/api 读面 | 只读投影；三面（监控/概览/对外）共享 |
| PORT-OPS | `ops.ts` | control＋cli 一命令一模块 | 供能链 PORT-AUTH→PORT-OPS 单向 |

**目录预算复算（2026-10-27）**：`contract/src/ports/` 现状 9 件（company/executor/gateway/index/invoke/kernel/models/notifier/platform）；本表新增 12 件、改造承载 1 件（executor→exec 更名）、并入退役 2 件（invoke/notifier）→ 终态 **20 件 ≤ 25**（阈=25，B4/v2/16），余量 5；再新增须子目录化并走提案流。**面-文件单点**：MCP- 工具 schema 唯一源＝`packages/studio-tools/src/tools.ts`（工具表与网关动词表一致性由测试钉死——现状已有）；API- 端点与视图序列化唯一源＝`packages/api/src/`（装配落 `apps/daemon/src/assembly/api/`，v2/16 MIG-06；`api→panel` 边永禁）。

---

## 三、studio-tools MCP 工具面（MCP- 族；84 裁决二成文）

**原则（裁决二原文口径成文）**：「人事改人事信息、财务查看、研发申请权限等都经 StudioNext 的 MCP 提供，而不是一股脑塞提示词」——**提示词只含身份与上下文，操作走工具**。分工三层（docs/24 现状设计事实升格为规范）：身份与知识层＝AGENTS.md 组装（L0-L5，v2/12 §1.7 注入面——注入是上下文不是策略）；工具能力层（对内）＝本节 MCP- 面；对外 AI 层＝§四 API- 面（同一能力两种出口）。「怎么调」由工具 input schema 承担（strictObject，多余字段拒收，fail-closed）；AGENTS.md 只教「什么时候用哪个」。

**四条铁律**：
1. **工具是端口的前门，不新增权源**：每工具调用先过 PORT-AUTH.verify（权源主张→政策四态），再路由到 §一对应端口方法；拒绝原样透传（category=subcause 两级错误，现状冻结四族 auth/gateway/deps/internal 沿用）。
2. **除只读外一律落「请求/申报」型记录**：工具调用产生 REC-CMD-01/专用申报记录，决定由有权位置经端口作出——**员工用工具「申请」，不是「办成」**；状态推进不经工具（工具面无 transition 写动词；ctl- 词族仅控制面 daemon 自用，§五）。
3. **署名与公司维随调用必带**（§0.2 CallContext）；wkey 按单签发、关单吊销（SEC-T4；stdio 注入与 challenge-proof 注册协议沿 v1 80-§11.4.1 口径，目标未证）。
4. **内/外两面不得同名同表**（治 V11-02）：MCP- 面只对挂载的 CLI/worker；对外 MCP 若建，复用 API- 资源语义与凭证三档，独立命名——**目标（未证）**。

**工具表（每行：入参｜出参｜所需权限（引 v2/03 权力树）｜署名主体（SEC-SIG-01）｜公司维）**。现状事实：studio-tools 六工具（comment/heartbeat/article/kb-search/evidence-write/budget-query）已与网关白名单一一对应并有进程内 server（已有）；**下表场景分组面（人事/财务/研发）与 stdio 形态全部为新增面＝目标（未证）**。

| ID | 工具名 | 入参（简） | 出参 | 所需权限 | 署名 | 公司维 |
|---|---|---|---|---|---|---|
| MCP-HR-01 | hr.profileAmend | 本人/授权范围 subjectRef＋field patch＋理由＋依据 | 修订候选回执（RevisionTicket） | 本人档案=任职者本人；他人=人事职能位（+1 提议） | person | 必带（DOM-01 挂单） |
| MCP-HR-02 | hr.appointmentPropose | positionRef＋holderRef＋nominationRef＋scope/term | 拟任登记回执（REC-LIFE-01 拟任面，幂等键四元组） | +1 提议位按位置（v2/03 §3.3；2026-10-28 新模型）：**G9 最高宰相＝外部老板提议；G8 一级单元首长＝最高宰相或另一单元首长提议；G8 部门首长＝一级单元首长提议、最高宰相任免；G7 及以下逐级 +1** | person | 必带 |
| MCP-HR-03 | hr.transitionRequest | from/to＋trigger 主张＋依据 | 申请回执（按边触发者校验后进 REC-LIFE-02 决定链） | 按边触发者（v2/11 §14.2）；辞职=任职者本人 | person | 必带 |
| MCP-HR-04 | hr.interestDeclare | holdings＋利益关系＋复核期 | 登记回执（REC-LIFE-05 申报面） | 任职者申报＋独立检查位置检查 | person | 必带 |
| MCP-FIN-01 | fin.ledgerRead | 时间窗＋账段（预算/事件/月报）＋readScope | 只读账视图（缺源段=unknown，不补 0） | 财务知悉范围（v2/02 §八；readScope 字段承载） | person | 必带（多公司视图隔离） |
| MCP-FIN-02 | fin.budgetQuery | issue/部门＋期间 | 预算只读投影（现状 budget-query 的 V2 化=已有） | 在岗者本单/本部门 | person | 必带 |
| MCP-FIN-03 | fin.costguardStatus | issue/部门 | 警戒线状态只读视图（core costguard 投影） | 同上 | person | 必带 |
| MCP-DEV-01 | dev.permissionRequest | 申请的授予面（purpose/scope/期限）＋理由 | 命令请求回执（REC-CMD-01）——**申请不是授权** | 任何任职者可申请；批准=授权者（+2 链，v2/03 §三） | person | 必带 |
| MCP-DEV-02 | dev.capabilityDeclare | 九维声明（REC-CAP-01）＋claimant | 声明回执（声明是主张非认定） | 声明来源/公司需求（v2/07 §一） | person | 必带 |
| MCP-DEV-03 | dev.assetRegister | 资产条目（类型/来源摘要/兼容/专属标记） | 登记申请回执（REC-ASSET-01 写入者=daemon/部署） | 研发职能位提议；登记=daemon | person（登记面 control） | 必带（DOM-07） |
| MCP-GEN-01 | work.intake | 意图信封（raw_content/来源/时限） | 意图回执（intentRef，REC-WORK-01） | 任职者（内部意图入口） | person | 必带 |
| MCP-GEN-02 | work.evidenceSubmit | 材料引用＋要素主张＋证明边界 | 证据项回执（REC-EVD-02 草案；材料落 PORT-EVD 受控区） | 工作责任者（自述级来源，v2/08 EVD-ANC） | person | 必带 |
| MCP-GEN-03 | work.handoverSubmit | 交接包十项＋连续性四问 | 提交回执（REC-WORK-HANDOVER；提交≠接收确认） | 交出者 | person | 必带 |
| MCP-GEN-04 | work.comment | issue＋body | 活动回执（REC-EVT-01 观察；评论塞无权决定=拒） | 在岗者（wkey scope） | person | 必带（=现状 comment） |
| MCP-GEN-05 | work.heartbeat | issue | 活性观察回执（不证工作完成） | 在岗者（wkey scope） | person | 必带（=现状 heartbeat） |
| MCP-GEN-06 | kb.search / kb.upsert | query／path＋markdown | 命中列表（readScope 过滤）／文章回执 | 检索=知悉范围内；沉淀=岗位方法（MEM-03 确认制） | person | 必带（=现状 kb-search/article） |

---

## 四、对外 API 面（API- 族；:8788）

**定位与关系**：对外除 MCP 外提供 API 与其他工具对接（84 裁决二）；**API 与 MCP 是同一能力的两种出口**——读面同源 PORT-OBS 投影＋只读台账视图，写面同经 PORT-GATE 意图入口；**只落单不派工**：外部请求最多到「受理结论」（REC-WORK-02）为止，不得直接 launch worker、不得直写台账/平台（API 进程零库零平台）。装配：daemon assembly 同进程注入（v2/16 MIG-06；`api→panel` 边永禁）。

**端点族（API-01..16；GET 全走只读投影，POST 全走 PORT-GATE）**：

| ID | 端点 | 语义 | 状态 |
|---|---|---|---|
| API-01..07 | GET /v1/company・org・people・projects・issues・finance・reports | 信息面（people 默认只出聚合；finance 三源缺一=unknown 段不补 0；reports 只出清单） | 现状骨架在 panel/external，迁 api=MIG-06 |
| API-08 | GET /v1/requests/status | 回执查询（读投影快照；快照未命中=503 非 404——「查不到」≠「没有」） | 目标（未证） |
| API-09 | GET /v1/agent-card | A2A 名片（公司定义生成，带版本与有效期；A2A 只做 exporter） | 骨架 |
| API-10..13 | POST /v1/requests・explore・tasks・intel | 触发面：只产意图（REC-WORK-01）；202=已入队≠已受理；outcome 五值只在查询时出现（**值集唯一主表 v2/09 ENU-122**——09 §六-5 回填；仅查询投影用，终值以 REC-WORK-02/12 为准） | 骨架 |
| API-14 | GET /v1/events（SSE 订阅） | at-least-once＋event id 去重＋断线续传 | 目标（未证）；未实装=501 带原因，禁空流 |
| API-15 | POST /v1/hooks/{source}（签名入站） | HMAC＋时间戳＋nonce＋重放窗＋载荷上限；产意图同触发面收口 | 目标（未证） |
| API-16 | POST/GET /v1/subscriptions（出站订阅） | allowlist＋SSRF 拒＋退避＋死信（REC-EVT-03）＋重放窗 | 目标（未证） |

**触发面公共入参槽（治 V11-01 P0——外部委托链起点）**：`company`｜`requestKind`｜`dedupKey`｜**`commissioner`**（外部委托主体引用；未映射时显式声明＋identity_mapping 依据，不留空）｜**`dispatcherAnchor`**（派单人锚；**缺省＝意图受理治理位：N=1 默认形态＝最高宰相，N>1 按域＝所属一级单元首长**，引 v2/03 表 D；等级封顶随锚声明）｜`body`｜`correlation?`。回执（IntentReceipt）带 `commissionerRef/anchorRef`。**幂等键**=四槽意图保留键（§0.2-3）；同键同内容=200＋duplicate，同键异内容=409。

**跨公司一致性（治 V08-P0-04/SEC-WD-01）**：`?company=` 读与写同一解析规则；**写请求解析出的公司维与平台绑定维不一致＝4xx 拒绝**，不得静默落错库；单公司部署可省略 company，多公司缺维=请求非法。

**凭证三档（治 V11-06）**：公开（public 视图）｜伙伴（凭据目录条目：随机 credential ID＋scope＋TTL＋吊销——**接 PORT-TRUST/REC-AUTH-04**；吊销后 30s 内失效=fail-closed 目标）｜签名（HMAC＋时间戳＋nonce）。**凭据分级另轴（2026-10-28）**：`credential_class`＝**root／scoped**——operating root key 只由最高宰相（G9，内部老板）持有，**不进入任何接口载荷/回执/日志/提示词**；子 agent、执行体与外部伙伴只持 scoped key；接口层不得以「持 root」代替授权链核验（安全机制 v2/15 §七 SEC-ROOT-01..05；值集 v2/09 **ENU-136 凭据类别**，字段形状 v2/11）。**单静态 token＝禁止形态**（v2/15 §一口径；v1 单 token 装配面废止）。**默认绑定＝环回 127.0.0.1，显式旗标才开放局域网**（治 V11-10——V2 裁决取 fail-closed 方向；AGENTS.md「默认局域网」现状句待按 V2 修订，登记转卷）。

**错误模型（沿用 v1 80-§9.4 冻结口径，唯一错误体）**：`{ error:{ failure, category, subcause }, traceId }`（422 加 fieldPath、429 加 retryAfter、501 加 reason，均在外层）。三边界不串味：记录不存在=Ok(undefined)→对外 503 receipt-not-in-snapshot；路由不存在=404；读不出来=500（subcause 透传）。HTTP 拒绝（401/403/409/422/429）只写拒绝审计；结果不明才落 REC-EVT-03（unknown_scope.intentRef 必指 REC-WORK-01）；观察缺口落 REC-OBS-02。**工具面分级（治 V11-04）**：①只读 ②落单/评论 ③派工与收割——**第三级显式不存在**，非「默认不授」的开关。

---

## 五、署名与控制面（接口层对齐 v2/15）

1. **三值署名必带**：§0.2 CallContext.signature 即 SEC-SIG-01 的接口层承载（person=工号｜control=控制面位置＋决定记录引用｜system=onBehalfOf 必填可还原）；无 onBehalfOf 的 system 署名＝构造期非法（SEC-FC-06）。网关落款不改写正文（现状纪律保留）；REC-AUTH-02 行使记录由端口侧落账，禁调用方自报（L3K-14）。
2. **ctl- 动作词族（SEC-SIG-03）**：控制面平台写动词 `ctl-create/ctl-transition/ctl-set-field/ctl-link/ctl-provision/ctl-guards`（值域登记 v2/09，contract 变更走批示流）；网关校验申报动词与实文一致（沿 `gw-action-mismatch` 机制）；**transition 不得显示为 comment**；迁移期 `op` 借道允许但须记台账降级标记。MCP-/API- 面的写动词只能映射到 ctl- 族（控制面）或 comment（自由评论），借道即违规。
3. **写域公司维**：一切写方法经 CallContext.company；网关侧对照 SEC-WD-03 写路径对照表；本卷签名即该表的接口面冻结点。

---

## 六、PRM 生成器接口链（治 H3b-P1-1）

**签名**（§1.5 已挂 PORT-EXEC.compileProjection，此处冻结输入输出）：输入 `ProjectionInput`＝{任职关系引用（生效版 REC-LIFE-01）、计划锁引用（REC-WORK-05）、能力声明集（REC-CAP-01＋版本）、部署收紧面（只收紧字段）}；输出 `PolicyProjection`＝{九段清单（段名值集唯一主表 v2/09 ENU-108；段语义 v2/12 §1.6：identity/authority/plan/tools/sandbox/approval/persona/evidence/validity）、digest、`unsupportedSegments[]` 逐段损失}。**验收口径＝生成八律 PRM-G1..PRM-G8**（v2/12 §1.6、正式号 09 §一-61：单向编译／幂等／只收紧／段绑定／撤回可传／不猜不填／可复算／宿主子集显式降级）；实现=core 纯函数（零 IO、可复算），落点 v2/16 MIG-07；**生成器归 daemon 侧（框架），dsh-bridge 不生成**（现状 81-files/12 口径沿用）。建成前策略投影校验通道缺口登记 v2/17（SEC-SIG-04）。

## 七、工作空间端口（PORT-WS；治 C3-P1-3/H3b-P1-2）

§1.5 已立签名；此处冻结三条边界：①**六区解析只回相对路径**（ZonePath 相对工位根；绝对路径不入公共类型——沿 78 请求口径）；②**cwd 不是隔离**（只影响相对路径解析；隔离六面现状与目标未证清单主表 v2/12 §3.3，本卷不重述）；③**不可写面**（策略投影文件/插件/hooks/台账库）由 containment 强制，改一处即全盘失效（v2/12 §3.2 表为唯一现状口径）。语义（分区六义）锚 v2/07 §五，机制与形态锚 v2/12 §三——本卷只锁接口，不造第二语义源。

## 八、参考装配（Studio Next，不混入规范正文）

- studio-tools：现状六工具＋进程内 server（已有）；stdio 入口、challenge-proof 注册、场景分组面（§三）＝目标（未证），MIG-06。
- panel/external 现状 11 路由（:8788 骨架）→ MIG-06 迁 `packages/api`＋`assembly/api`，收尾步删旧面（DISP-04）。
- 端口类型分区 `contract/src/ports/`（§二表）＝MIG-03；`PORT_VERSION='v0'` experimental 声明沿用；记录族表族＝MIG-03/04。
- 平台三件套统一签名（bindingProfile/mapState/lossReport＋bindingId 选择器，治 L3J-P1-05）＝MIG-07，形状源=本卷 PORT-WORK 备注列＋v2/12 绑定卡。

## 九、审计处置表

| 来源 | 条目 | 本卷处置 | 状态 |
|---|---|---|---|
| H3b-P0-1 | 80-§6.9 与 81-files/01 七端口文件路径冲突、81 内部互矛盾 | §二单点表唯一裁决：13 PORT- 各一件；v1 两处指认整体废止（历史卷） | 已解（规范面） |
| H3b-P1-1 | PRM 生成器接口链断裂（78 请求 80 出签名、无承载） | §六 compileProjection 冻结输入输出＋G1-G8 验收口径＋落点 MIG-07 | 方向已定（签名已立；实现未证） |
| H3b-P1-2 | 「工作空间」端口无落点、六区解析接口未落 | §1.5 PORT-WS 签名＋§七三边界 | 已解（规范面） |
| H3b-P1-3 | DEP-HONO api 声明未用 | 本卷侧：API 真实装配归 assembly/api（v2/16 MIG-06），api 不留装饰依赖；条目级登记转 v2/13 | 登记转卷 |
| C3-P1-1 | 变更链记录被自引未定义 | REC-CHG-01 已由 v2/11 立；本卷经 PORT-EVD/PORT-WORK 方法承载其写入 | 已解（配合） |
| C3-P1-2 | 绩效有语义无形状 | REC-PERF-01 已由 v2/11 立；本卷 PORT-HR.recordPerformance 挂载 | 已解（配合） |
| C3-P1-3 | 工作空间端口仅在绑定层 | §一/§七 立 PORT-WS 签名（v2/05 已立端口行，本卷补签名与边界） | 已解（规范面） |
| DSF V08-P0-02 | 署名回不到决定人、@action comment 借道 | §五：三值署名接口层必带＋ctl- 词族替代借道＋网关不改写正文；机制=SEC-FC-06（v2/15） | 规范已解；contract 变更目标未证 |
| DSF V08-P0-04 | 多公司写路径无公司维 | §0.2 CallContext.company 写必带；§四 ?company= 读写一致、错绑 4xx | 规范已解；机制目标未证 |
| DSF V11-01（P0） | 外部委托主体/派单人锚/等级封顶零承载 | §四触发面 commissioner＋dispatcherAnchor 公共槽；回执带 commissionerRef/anchorRef | 已解（规范面） |
| DSF V11-02 | 对外 MCP 与内部工具面同名异义 | §三铁律 4：内/外两面分立命名；对外 MCP 复用 API- 资源语义（目标未证）；本卷前缀裁定 TOOL-→MCP- 同病同防 | 已解（规范面） |
| DSF V11-04 | 三级 scope「永不」vs「默认不授」 | §四写死：第三级（派工与收割）=显式不存在 | 已解 |
| DSF V11-05 | 端点集合静默缩窄、无差异去向 | §四端点族表逐项标注状态（骨架/目标未证）；/v1/docs・/v1/games・people history 等旧需求项未入族=显式不承载（差异以本表为去向登记） | 已解 |
| DSF V11-06 | 凭证单 token 与凭据目录双源 | §四凭证三档接 PORT-TRUST 凭据目录；单静态 token=禁止形态；**补 credential_class root/scoped 分级（root 不入接口面）** | 规范已解；机制目标未证 |
| DSF V11-10 | 默认绑定两说（环回 vs 局域网） | §四裁决：缺省环回＋显式开放（fail-closed）；AGENTS.md 现状句待按 V2 修订 | 已解（规范面）；AGENTS.md 修订转卷 |
| 84 裁决二 | MCP 与对外 API 纳入大重构、不塞提示词 | §三原则成文＋MCP-16 工具表；§四 API-16 端点族；场景分组面全部目标（未证） | 方向已定（新增面未证） |
| docs/24 对齐 | 知识/工具/对外三层分工 | §三沿用三层并升格规范；现状六工具映射 MCP-GEN-04/05/06・MCP-GEN-02・MCP-FIN-02 | 已解（对齐） |
| L3-J-P0-01 | 读面知悉范围/调用者上下文不可表达 | §0.2-1：ReadContext 必填、缺省=拒、越权=Err 非 Ok(undefined) | 已解（规范面） |
| L3-J-P1-01/02 | 事务不收记录写、投影钩子无接口 | PORT-HIST.append 显式 tx 句柄；钩子同事务=目标（未证，登记 v2/17） | 规范已解；机制未证 |
| L3-J-P1-03/04 | 幂等键语义未定义、intentRef 断链 | §0.2-3 幂等键规则＋意图保留键登记；PORT-GATE intentRef 随队列、回执可归链 | 已解（规范面） |
| L3-J-P1-07 | 紧急止损「停机通道」无名 | PORT-OPS.emergencyStop 命名并落 REC-WORK-18 | 已解（规范面） |
| L3-J-P1-08（含 L3-K-10） | 读写方法裸返回 | §0.2 PortResult 全覆盖；只读方法同规 | 已解（规范面） |
| L3-K-01（P0） | 状态迁移无生产者、平台流反推矛盾 | PORT-WORK.transition trigger_ref 必填且为前置记录；事件/自报终态/平台标记非 trigger（引 v2/11 §十四） | 已解（规范面；守护计时未证） |
| L3-K-03 | 新端口缺状态推进写路径 | §0.2-5 规则：方法集覆盖记录族全部写入面；PORT-HR/PORT-WORK 推进方法齐 | 已解（规范面） |
| L3-K-04 | 16 个签名类型无定义、81 自造 | §0.2-4 规则：签名类型须有形状归属或标草案/视图；81 附录形状引用以本卷为准 | 已解（规范面） |
| L3-K-05 | 落点表 26>25 与 81 冲突 | §二复算：9＋12−2=20 ≤ 25，余量 5；唯一源=F5 | 已解（规范面） |
| L3-I-02/03 | 嵌套判别不收窄、Err 语义与重试冲突 | §0.2-2/6：Err 只表无副作用拒绝、不明先对账；顶层判别 | 已解（规范面） |
| L3-I-01 | digest unknown 无载体 | PORT-HIST.payload byteDigestState 三态（'present'/'unknown'/'not-collected'）；字段形状归 v2/11 | 方向已定（登记转 v2/11） |
| L3-I-05/06 及 L3-J P2 簇 | 公司时区无归属、matrix 工厂论据、RunServeOpts 清单等 | 记录/装配/工程面归 v2/10・v2/16（MIG-06）；本卷不私设 | 登记转卷 |
| GLM K5 | 端口-文件映射双源 | §二即唯一映射源（F5）；v2/05 §四零文件路径、v2/16 零端口路径断言已成文 | 已解（三卷合围） |

---

## 十、修订记录（2026-10-28）

依据：2026-10-28 制作人开工令（docs/49）＋修订令摘要 §1.1-§1.8、§二-F（只改接口中涉 G9/G8/老板证明/root key 的句子；**不新增端口、端口计数不变＝13**）。版本升 v2.1-draft。

1. **头注**：版本 v2.1-draft；编写者称谓改最高宰相；增列修订依据，并明示端口计数＝13、修订令 §〇.5「PORT 14」的冲突已回报。
2. **§三 工具表 MCP-HR-02（任命提议）**：权限列按新模型改写——**G9 最高宰相＝外部老板提议；G8 一级单元首长＝最高宰相或另一单元首长提议；G8 部门首长＝一级单元首长提议、最高宰相任免；G7 及以下逐级 +1**（引 v2/03 §3.3）。删旧句「G9 提名者=老板」。
3. **§四 触发面 `dispatcherAnchor`**：缺省由「主 PM 治理位」改为**意图受理治理位**——N=1 默认形态＝最高宰相，N>1 按域＝所属一级单元首长（引 v2/03 表 D）。
4. **§四 凭证三档**：新增**凭据分级另轴** `credential_class`＝root／scoped（安全机制 v2/15 §七 SEC-ROOT-01..05；值集 v2/09 ENU-136）——operating root key 只由最高宰相持有、不进任何接口载荷/回执/日志/提示词；子 agent/执行体/外部伙伴只持 scoped key；不得以「持 root」代替授权链核验（语义与字段**登记 v2/09**、形状 v2/11）。审计表 DSF V11-06 行同步标注。
5. **称谓**：卷内「宰相」改「最高宰相」。
6. **未改**：PORT- 13 端口与 §二端口-文件映射单点表（F5）、MCP- 16 工具与 API- 16 端点计数、§0.2 接口层总约定、§五 署名与 ctl- 词族、§六 PRM 生成器接口、§七 工作空间端口、§九 审计处置表其余条目。

---

*本卷为 V2 运行时接口、MCP 工具面与对外 API 面的唯一规范；记录形状归 v2/11、机制归 v2/15、绑定归 v2/12、逐文件与波次归 v2/16、负向用例归 v2/17。与 v2/00 冲突时停手改上位卷（走制作人批示）。未过 DSF 复查（F8）前不得标「定稿」。*
