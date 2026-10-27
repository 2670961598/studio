# L3-P · 细节层横向审计：panel / api / studio-tools / daemon-engine

> 口径：`docs/audit-DSF/_scope-DSF.md`（严厉程度、P0/P1/P2、证据纪律、固定结构）。
> 对象：`docs/81-files/13-panel.md`（1322 行）、`14-api.md`（1180）、`15-studio-tools.md`（636）、`16-daemon-engine.md`（2651），四卷全文分段读完（合计 5,863 行），并按 §「读法」用源码/锁文件/门禁配置做机械核对。
> 日期：2026-10-27（与四卷同版日；仓内实测同日）。只读审计：未改动任何设计文档、源码、配置，只写本文件。
> 范围：只审技术细节层（字段/状态/失败/退出/接口/绑定/逐文件契约/验证是否达到 75 的自称深度），只审本层自洽与交班能力。跨层冲突只标注，不替代 C 组结论。

---

## 一、结论

1. **P0 = 0；P1 = 10；P2 = 3；P3 = 2。**
2. 不设 P0 的理由：四卷对五条根命题（只落单不派工、唯一写入者、读投影只读、`allow ≠ applied`、未知/缺口不显示为绿）都有显式条文与判负条款，未发现被文字本身推翻的；两处最接近 P0 的（陈旧可显示为正常；stdio 面 `allow` 无结果可回成功）都在卷内有"判负"兜底，属**规则互斥、实现前必须消歧**，故按 P1 记，不升高也不压低。
3. 最严重 3 条：
   - **P1-01**：panel 六态里 `stale` 被宣布"v0 不可达"，而 `SnapshotMeta.dataValidWindow` 又是"九项缺一不可"——**陈旧无出口，且字段无来源**，监控面实际上无法把"旧数据"呈现为异常。
   - **P1-06 / P1-07**：跨卷冻结接口两处"两份签名"——`assembleApi` 的 `company` vs `companies`（13/16 vs 14/80），`WorkIntake.intake` 的单参/双参与"谁来判定受理结论"（16 内部三处互斥 + 与 80 冲突）；后者是权责主体缺失。
   - **P1-09 / P1-10**：studio-tools 的"结果面"在库面与 stdio 面之间自相矛盾——按字面实现要么六工具全拒，要么可在**未执行**时回 `ok:true`；而 fail-closed `deps` 指定的 `(unsupported, EVOLVE_REJECT)` 在现有 `StudioToolsDeps` 类型上根本表达不出来。
4. 四态标记总体**诚实**：39 个 daemon 目标件、api 35 件、studio-tools 5 件、panel 8 件都逐条标"不存在/未实现"，未发现把目标写成已有；失实集中在三处"自称"：14/16 的 80 行号"已核对"、13 的 `ReadOnlyLedger`"80 原文"、13 的"`Ledger` 仍可编译"。
5. 结论是"可以带着走，但 P1-06/07/09/10 必须在立实现单之前关闭"——它们决定类型与写口形状，之后再改就是返工。

---

## 二、发现表

### 2.1 索引

> 索引表的「位置」列省略公共前缀 `docs/81-files/`（`80`/`store`/`boundary-rules` 另行标注）；每条详条给全路径，便于直接定位。

| ID | 级别 | 类型 | 位置 | 一句话 |
|---|---|---|---|---|
| L3P-01 | P1 | B/E | `13-panel.md:1047`、`:1042`、`:983`、`:399`、`:1252` | `stale` 宣布不可达，`dataValidWindow` 却必填无来源：陈旧显示为 `derived`（正常） |
| L3P-02 | P1 | A/E | `13-panel.md:1043`、`:1212`、`:1062`、`:282` | 版本不匹配：健康面判 `conflict` vs 开库期 `rejected_version` 拒起，二者互斥，必测用例不可构造 |
| L3P-03 | P1 | C/D/E | `13-panel.md:19`、`:1182-1197`、`:262`、`:1111`；`80:2926-2932`；`store/ledger.ts:227-231` | `ReadOnlyLedger` 被缩成 4 成员还自称"80 原文"（真为 5 成员含 `payload`）；"它是 `Ledger` 的结构子集、传 `Ledger` 仍可编译"两处都不成立 |
| L3P-04 | P1 | D/A | `14-api.md:408`、`:413`、`:872` | throw 回查命中被渲染成 `200 {receipt, duplicate:true}`，而卷内自己承认"无法证明同摘要" |
| L3P-05 | P1 | D/G | `14-api.md:3`、`:55`；`16-daemon-engine.md:2592`、`:2636-2648`；80（现 4052 行） | 对 80 的行号锚系统性错位，14 自称"3680 行本复核"、16 自称"已逐一核对" |
| L3P-06 | P1 | A | `16-daemon-engine.md:1630-1645`；`13-panel.md:1147`；`14-api.md:76`；`80:3223-3234` | `assembleApi`/`ApiServerOptions` 出现单司 `company: string` 与 `companies[]` 两套冻结签名，并另造配置类型 |
| L3P-07 | P1 | A/F/E | `16-daemon-engine.md:1912`、`:1423`、`:632`、`:258`；`80:1645` | `WorkIntake.intake` 三处签名互斥，受理结论（`IntakeOutcome`）的计算主体未定 |
| L3P-08 | P1 | E/G | `16-daemon-engine.md:1769`、`:1770`；`boundary-rules.mjs:152` | `tick/phases.ts` 目标 ≤600，而其搬迁源段 `1582-2236` 已 655 行：拆分第 5 步必撞宪法阈值 |
| L3P-09 | P1 | A/E | `15-studio-tools.md:190`、`:605`、`:165`、`:188` | 同一句"无 `outcome` 一律拒绝"与"否则执行 run"互斥：库面全拒或 stdio 面可未执行即回成功 |
| L3P-10 | P1 | A/E | `15-studio-tools.md:300`、`:165`、`:190`、`§5.5`；`studio-tools/src/tools.ts:82-88` | fail-closed `deps` 规定"一律 `Err(unsupported/EVOLVE_REJECT)`"，但依赖类型没有 `Result` 通道，抛错路径又会把 category 改成 `STALL` |
| L3P-11 | P2 | G | `13-panel.md:194`（表 `:184-200`） | 现状目录表 `ui/components/ = 9`，实测 10；该表合计 32，与总数 33 不符 |
| L3P-12 | P2 | C/G | `13-panel.md:69`、`:970`、`:1108`；`15-studio-tools.md:473`；`14-api.md:1084`；`16-daemon-engine.md:2177`；`80 §6.9` | `contract/src/ports/*` 落点四说，`effects.ts` 被同时当成 OBS-01 与 BIND-01 的家；13 还先落一份本地 `ObservationState` |
| L3P-13 | P2 | E | `16-daemon-engine.md:1665`、`:1727` | "39 个目标测试与 39 个目标源件 1:1"不成立（A 组 12 源件配 11 直测 + 1 接缝测试） |
| L3P-14 | P3 | G | `15-studio-tools.md:558`、`:562-582` | 声明编号体例 `G-81-15-*`，表内实际用 `G-01…G-21` |
| L3P-15 | P3 | A | `16-daemon-engine.md:1548`、`:2333`；`80 D30` | `TableProjectionResult.name` 用 `TableProjectionName`，与 80 的 `TargetTableProjectionName`（含 `resourceLedger`）冲突 |

### 2.2 P1 详条

#### L3P-01 · panel 的"陈旧"没有出口，且 `dataValidWindow` 无来源

- **位置**：`docs/81-files/13-panel.md:1047`、`:1042`、`:983`、`:399`、`:1252`（G10）。
- **事实与引文**：
  - `:1047`「`stale`：无 freshness policy 来源（缺口 G10），v0 **不可达**，不得伪造"最后可信时间 + 新鲜度窗"两个数」。
  - `:983`「`SnapshotMeta`…字段为 `viewIdentity`/…/`dataValidWindow`/…（九项齐全，缺一不可）」；`:1042`「状态判定（默认 `derived`…）」。
  - `:1252` G10：「六态 `stale` 的新鲜度窗…未给窗长与来源 | v0 判为不可达」。
- **为什么错**：
  1. `SnapshotMeta` 把 `dataValidWindow` 定为**必填且缺一即未实现**，但该字段唯一的语义来源（新鲜度窗）被 G10 判为"未定"；于是实现只能二选一——留空/占位（违反"缺一不可/缺键即未实现"）或自造窗长（违反"不得伪造"）。这是 E 类"字段无来源 + 无空值口径"。
  2. 六态里有一态在生产不可达，且默认态是 `derived`。结果是"六小时前的快照"与"刚生成的快照"在 payload 里除 `generatedAt` 外**同形同色**：`unknown`/`gap` 的"不显示为绿"守住了，**陈旧这一关键失败面没有出口**——这正是 80-§9.6/77-§9.4 要防的"用没有告警暗示健康"的变体。
  3. 卷内没有"新鲜度未知"的临时判据（例如无 policy 时该面降 `unknown` + `reason:'freshness-policy-missing'`），也没有把 `derived` 限定为"内容按规则算出、新鲜度未判"的呈现约束。
- **最小修复**：G10 关闭前把"新鲜度未知"显式化——`dataValidWindow` 允许 `null` 且此时该面 `state='unknown'`（原因 `freshness-policy-missing`），或保留 `derived` 但强制 payload 带 `freshness:'unjudged'` 且 UI 不得显示为绿；在 `test/monitor-health.test.ts` 增加一条"`generatedAt` 早于 `now` 超过任一约定窗时不得为绿"的负向断言。只改这三处，不动六态词表。

#### L3P-02 · 版本不匹配：健康面 `conflict` 与开库期拒起互斥

- **位置**：`docs/81-files/13-panel.md:1043`、`:1212`、`:1062`、`:282`。
- **事实与引文**：
  - `:1043`「schema 版本不一致：`conflict`（并列期望值与实际值），与启动期 `openLedgerReadonly` 的 `Err` 互补」。
  - `:1212`「**版本不匹配拒起**且带期望/实际」；`:282`「版本落后或超前 `rejected_version`/`EVOLVE_REJECT`/`schema-behind`|`schema-ahead`」。
  - `:1062` 要求 `test/monitor-health.test.ts` 覆盖「版本落后 `conflict`」。
- **为什么错**：打开期已把版本不匹配变成 `Err` 并**拒绝启动**，进程不存在，健康面不可能观测到 `actual ≠ expected`。所以 (a) `:1043` 的 `conflict` 分支是死代码，其必测用例只能靠 mock 一个"能打开但版本不符"的 `ReadOnlyLedger`，与 `:1212` 直接冲突（E 类：验收用例不可构造）；(b) 若真的出现，只可能是两个注入点给了不同的 `expectedSchemaVersion`（wiring 缺陷），把它报成数据冲突 `conflict` 会误导定位。`:1246`（G4）承认 80 未逐项规定，但同一卷的硬规则已经排除了这条分支——这不是"待确认"，是自相矛盾。
- **最小修复**：二选一写死，并把用例同批改：(i) 删除健康面的版本冲突分支，`expected/actual` 只作展示字段（状态取 `derived` 或 `gap`）；或 (ii) 允许"版本不符仍只读打开、只拒写"（此时 `open` 不返回 `Err`），由健康面承担 `conflict`。同时在该节注明 `expectedSchemaVersion` 的两个注入点必须同源（指向 G7）。

#### L3P-03 · `ReadOnlyLedger` 被缩成 4 成员，还自称"80 原文"；"`Ledger` 仍可编译"不成立

- **位置**：`docs/81-files/13-panel.md:19`、`:1182-1197`、`:1202`、`:262`、`:1111`；对照 `docs/80-…:2926-2932`、`packages/store/src/ledger.ts:227-231`。
- **事实与引文**：
  - `:19`「`ReadOnlyLedger` **只有** `schemaVersion`/`query`/`get`/`close`」；`:1182` 的代码块自述「**目标签名（80-§8.2 原文，不在本卷重定义）**」。
  - 80 `:2926-2932` 的 `ReadOnlyLedger` 另有 `payload(ref): Result<RecordPayload | undefined, ClassifiedError>`（同步）。
  - `:262`/`:1111`「`ReadOnlyLedger` 是 `Ledger` 的结构子集，现有测试传 `Ledger` **仍可编译**」；实测 `Ledger` 接口为 `version(): number`（`ledger.ts:231`），**没有** `schemaVersion` 属性。
- **为什么错**：
  1. 把 5 成员端口缩成 4 成员并标注"原文"，会让 `03-store` 按此实现时缺 `payload`，与 80 的 `ReadOnlyLedger` 不兼容；`14`/`16` 也沿用同一份 4 成员描述，形成跨三卷的一致错误。这属静默丢失公共接口成员（C），且以"原文"名义使下游无从质疑（D）。
  2. 结构关系说反且不成立：`ReadOnlyLedger` 需要 `schemaVersion`，`Ledger` 不提供，因此 `Ledger` **不可**赋给 `ReadOnlyLedger`；S3b 之后 `test/panel.test.ts` 等既有用例传的都是 `Ledger`，不会"仍可编译"。
  3. 后果被门禁掩盖：`test/` 不进根 `tsc`（本卷 `:943`、79-D10 自述），断裂不会在类型门禁暴露，而会在运行期让 `schemaVersion` 为 `undefined`，健康面九面全部落进异常分支——与"行为零变更"的 S4 证据策略直接冲突。
- **最小修复**：代码块按 80 补 `payload`；把结论改成"`ReadOnlyLedger` **不是** `Ledger` 的结构子集（`Ledger` 无 `schemaVersion`）"；S3b 的验收改为"同提交加 `openLedgerReadonly` 工厂 + 测试改用只读句柄"，并加一条运行期断言 `typeof ledger.schemaVersion === 'number'`。

#### L3P-04 · throw 回查命中被写成 `duplicate:true`

- **位置**：`docs/81-files/14-api.md:408`、`:413`、`:872`。
- **事实与引文**：
  - `:408`「`registered` → **200** `{receipt, duplicate:true}`」。
  - `:413`「`registered` 是**异常后的最佳努力**，不是判重路径：它**无法证明"同摘要"**（摘要域在 daemon）」。
  - `:872`「同键同内容 → 200 + `duplicate:true`；同键不同内容 → 409；两者都由 ingress 判，api 只映射」。
- **为什么错**：`duplicate:true` 在 77/80 的语义是"同键同**摘要**重投"。throw 后的回查只知道"内存快照有这个键"，摘要无法比对（`:396` 明确"不计算 `bodyDigest`"，canonicalization 在 daemon）。于是对"同键但换了正文"的调用方，契约要求 409，实际会拿到 `200 + duplicate:true` 与一份 `bodyDigest` 属于旧正文的回执——把"未证明"写成"已证明"，属 D 类，且与 14 自己在 `:413` 的免责声明矛盾。
- **最小修复**：throw 回查命中时不得置 `duplicate:true`——回 `200 {receipt}`（不带 duplicate）或 `202` 带 `outcomeUnknown`，或维持 503；只有 `emitIntent` 返回 `Ok(duplicate:true)` 才允许输出 duplicate。若确需保留 200，必须由 ingress 在回执里给出可比对的 `bodyDigest` 与请求体摘要的比对结论，并写进 `submission.test`。

#### L3P-05 · 对 80 的行号锚系统性错位，且两卷都自称"已核对"

- **位置**：`docs/81-files/14-api.md:3`、`:55`、`:1069`/`:1073`/`:1074`、附录 A；`docs/81-files/16-daemon-engine.md:2592`、`:2636-2648`；对照 `docs/80-技术细节-StudioNext运行时与公共接口.md`（实测 **4052 行**）。
- **事实与引文**：
  - 14 `:3`「按 80 现行 **3680 行**本…定点返修」；`:55`「v0.6 按现行 **3680 行**本复核行号」并列出约 40 个行号。
  - 16 `:2592`「本卷引用的关键锚（**已逐一核对**；`path:line` 均为 2026-10-27 实测）」。
  - 实测对照（任一可复算）：14 称 `:2810` 是"路由计数 16 条"，80 现文 16 条在 `:3139`，`:2810` 属 §7.8 拍边界表；14 称 `:2834` 是 404 行，实际 `:3163`；14 称 `:2870` 是 `ApiCompanySource`，实际 `:3199`；14 称 `:2944-2956` 是注入表，实际 `:3271-3283`；14 称 D21 在 `:3642`，实际 `:4003`；16 称 `:2031-2083` 是 `IntentReceiptStore`，实际 `:2400-2421`；16 称 `:1269-1541` 是 §6.4 十一 WORK 端口，80 `:1269` 是 `RuleDiagnosticCode`。
- **为什么错**：无论成因是 80 在 14/16 之后被改，还是引用时算错，"照 80 定稿逐字对齐""缺口-API-05 已关闭""已逐一核对"这三类结论**当前都不可复现**；实现者按行号会读到无关段落。按 scope §六，不可复现的全量声明应降级为"当前环境未证"。注意：**内容本身可复核**——16 条路由、404/500 两行、`AssembleApiDeps`/`ApiServerOptions`、`IntentReceiptStore` 形状、`WorkIntake` 签名都在 80 现文中找到且与两卷描述一致，所以这是"证据位置失效"，不是"编造结论"。
- **最小修复**：把 80 的 `:line` 锚一律改为节号锚（80-§9.4 / §6.6 规则 7-9 / §8.2 / §6.9 / D21-D22）；确需保留行号处加"行号随 80 改版漂移，非判据"；16 §12 的"已逐一核对"改为"按 vX 时点核对，需重跑复算命令"，并给出复算命令（按节标题 grep）而不是行号。

#### L3P-06 · `assembleApi` 两套冻结签名，并另造配置类型

- **位置**：`docs/81-files/16-daemon-engine.md:1630-1645`；`docs/81-files/13-panel.md:1147`；`docs/81-files/14-api.md:76`；`docs/80-…:3223-3234`。
- **事实与引文**：
  - 16 `:1631-1635`「`ingress: Pick<…>'submit'|'receipt'>`；`ledgerPath: string`；`company: string`；`config: ExternalApiConfig`」，紧跟 `:1636-1644` 就地定义 `ExternalApiConfig` 七键。
  - 13 `:1147` M3「`assembleApi(deps: { ingress…; ledgerPath: string; company; config })`」。
  - 14 `:76`「`assembleApi(deps: AssembleApiDeps)`：`ingress…` + `ledgerPath: string` + **`companies: readonly ApiCompanySource[]`** + **`config: ServeConfig`**」；80 `:3229`/`:3232` 同（`companies` + `config: ServeConfig`）。
- **为什么错**：同一冻结接口在同一层出现两份签名。按 16/13 实现会得到单司 API 与第二套配置类型：(a) 14 的路由要求按 `?company=` 解析并区分 422 `company-required`/`unknown-company`（`14:322`），单司形态下这些分支无意义；(b) `ServeConfig` 是全机唯一配置面（80-§3.3），另造 `ExternalApiConfig` 会在装配层产生第二解析源，违反"配置不推授权/不二次解析"。这属 A（同对象两个主表）+ G（破坏既有接口边界）。
- **最小修复**：16 §4.10.5 改为 `companies: readonly ApiCompanySource[]` + `config: ServeConfig`，删掉 `ExternalApiConfig`；13 `:1147` 的 M3 行同步为 `companies`。其余（`ingress` 只两方法、`ledgerPath`、不含 engine）保留。

#### L3P-07 · `WorkIntake.intake` 三处签名互斥，受理结论无主体

- **位置**：`docs/81-files/16-daemon-engine.md:1912`、`:1423`、`:632`、`:258`；对照 `docs/80-…:1645`。
- **事实与引文**：
  - 80 `:1645`「`intake(intent: RecIntentEnvelope): Promise<IntakeOutcome>`」；16 `:1423` 照抄。
  - 16 `:1912`（WORK-INTAKE 文件契约）「`intake(intentRef, outcome, …)` → `Result<void>`」+「**不判受理结论**（结论由业务方给，本件只承载）」。
  - 16 `:632`（drain）「消费受理成功后调 `workIntake.intake(invokeIntent)`，**取其 `IntakeOutcome.outcome`** 写进本拍汇报」；`:258`「引擎只在相位 2 **判定完**、真正受理意图时调 `intake`」。
- **为什么错**：三处互斥（单参返回结论 / 双参接收结论 / 引擎"判定完再调"）。真正的问题不是签名笔误，而是**受理结论（77 的五值 `IntakeOutcome`）由谁计算**没有主体：端口签名说"调用方给"，drain 说"调用后取回"，`REC-WORK-02` 的唯一写口又说"引擎判定后才写"。这是 F 类权责失真（自己给自己出结论 vs 只承载别人结论），并直接决定 `REC-WORK-02` 写口的形状与 `Pick<WorkIntake,'intake'>` 的类型。
- **最小修复**：以 80 的 `intake(intent) → IntakeOutcome` 为唯一形状，删除 `:1912` 的双参形态；在 §4.3/§4.12 写死"结论计算在何处"（若在引擎，则端口只落账且签名不含 outcome；若在端口，则引擎不得先判），并把"不判受理结论"这句与选择对齐；`test/engine/work/intake.test.ts` 的用例按同一口径改。

#### L3P-08 · `tick/phases.ts` 的 600 行预算与搬迁源段自相矛盾

- **位置**：`docs/81-files/16-daemon-engine.md:1769`、`:1770`、`:193`；`scripts/guards/boundary-rules.mjs:152`。
- **事实与引文**：`:1770`「迁移：`engine.ts:1582-2236` 七相位段逐段搬移」；`:1769`「规模：目标 ≤600（硬上限）」；`boundary-rules.mjs:152` `maxLinesPerFile = 600`（对 `src` 全量生效，无豁免）。
- **为什么错**：`2236−1582+1 = 655` 行，仅源段就超过 600，再加编排外壳与新切片只会更大。于是 §2.3 第 5 步的两条验收（`wc -l engine.ts < 600` 且 `bun run guard:boundaries` 绿）与 §2.1 第 3 条结构线（600 上限）不可同时成立；卷内也没有 `phases.ts` 的二级拆分方案。这属 E（验收不可达）+ G（拆分方案违反宪法阈值）。
- **最小修复**：在 §2.3/§4.12 把 `phases.ts` 拆成"编排 + 每相位一件"（`tick/phases/{collect,pre,dispatch,harvest,merge,reclaim,account}.ts`，或同目录多文件），并把第 5 步验收改为"每件 ≤600、`phases.ts` 内只剩调用与汇报片段"。

#### L3P-09 · studio-tools：`allow` 无 `outcome` 的判据自相矛盾

- **位置**：`docs/81-files/15-studio-tools.md:190`、`:605`、`:165`/`:188`。
- **事实与引文**：`:190`「放行分支带 `gated.outcome` 时**跳过** `spec.run`…（…`allow` 无 `outcome` 只准按 `unsupported`/`verdict-without-result` 拒绝，§4.9/§八 G-19）；**否则** `await spec.run(args, env, gated.signed)` → `okResult`」；`:605` 判负 #14「`allow` 就是成功 / 工具已生效」。
- **为什么错**：同一句里"无 outcome 一律拒绝"与"否则执行 run"互斥，两种读法各有一个坏结果：
  - 按前者：库面注入真 `Gateway`（`GateWriteResult` 本来就没有 `outcome` 字段，`15:453` 自述）会让六工具**全部被拒**，直接推翻 §4.4 的 22 例 happy path 与 §5.2 的现状调用链；
  - 按后者：stdio 面在 `allow` 无 `outcome` 时会本地执行零 IO 的 `comment`/`heartbeat`/`article` 并回 `ok:true`，即"daemon 未执行却回成功"——正是本卷判负 #14 与 80-§6.6 `EffectOutcome` 必带引用的禁止项。
  判据不可判定，且失败方向是"假成功"，不是"假失败"。
- **最小修复**：把执行模式显式进类型，不要用 `outcome` 的有无去推断：`ToolGate.gateWrite` 返回 tagged union `{allowed:true, mode:'local', signed}` | `{allowed:true, mode:'remote', outcome}` | `{allowed:false, reason}`；`runTool` 按 `mode` 分支，`remote` 无 `outcome` 一律拒（保住 G-19 的锁），`local` 才走 `spec.run`。`test/engine` 同类断言按 mode 补两例。

#### L3P-10 · fail-closed `deps` 指定的错误形状在现有类型上不可表达

- **位置**：`docs/81-files/15-studio-tools.md:300`、`:165`、`:190`、`§5.5`；对照 `packages/studio-tools/src/tools.ts:82-88`。
- **事实与引文**：
  - `:300`「(a) 段的 `deps` 只能是 **fail-closed 三方法**：一律 `Err({failure:'unsupported', category:'EVOLVE_REJECT', subcause:'result-channel-unavailable'})`，永不返回数据、不产生成功回执」。
  - `:165` 与 `tools.ts:82-88`：`StudioToolsDeps` 三方法返回 `Promise<WriteEvidenceOutcome>` / `Promise<readonly KbHit[]>` / `Promise<Readonly<Record<string,unknown>>>`——**没有 `Result` 失败位**。
  - `:190` 与 §5.5：deps 抛错归 `deps` 类，`subcause='<tool>-failed'`，`failure` 取后端的，`category` 由 80-§5.7 缺省给 `STALL`。
- **为什么错**：指定的 `(unsupported, EVOLVE_REJECT, result-channel-unavailable)` 三元组在**返回值**通道不存在（类型里没有失败位），在**抛错**通道会被改写成 `(后端 failure, STALL, <tool>-failed)`。实现者只能三选一：改 `StudioToolsDeps` 形状（破坏本卷自称"保留"的公共面，且 06/80 未批）、往 `KbHit[]` 里塞错误对象（第二套语义）、或让 stdio 返回空成功（正是要防的）。
- **最小修复**：二选一并写死：①`StudioToolsDeps` 三方法改 `Result<T, ClassifiedError>`（需 06/80 同步、走提案）；②保留现状签名，把 fail-closed 规定为"抛 `ClassifiedError`"，并在 §5.5/§4.2 明确 `runTool` 对 deps 抛错**保留 `failure` 与 `category` 两键**（现在只保留 failure）、`subcause` 允许 `result-channel-unavailable`；`stdio.test` ⑨ 按所选口径改写。

### 2.3 P2 / P3 详条

- **L3P-11（P2）**：`13-panel.md:194` 行 `ui/components/ | 9 | 九张卡与容器`，但 `:121-124` 的枚举与磁盘实测都是 **10** 件（`ls packages/panel/ui/components | wc -l = 10`）；该表 `:184-200` 各行相加为 **32**，与 `:112` 的"合计 73 / ui 33"不一致。属"实测表"里的计数错误（G/一致性）。修复：改 9→10，或删掉这张重复于 §一的表。
- **L3P-12（P2）**：`contract/src/ports/*` 的落点四说——`13:69`/`13:970` 把 `TS-PORT-OBS-01` 的类型家写成 `F-contract-port-effects`（`src/ports/effects.ts`）；`15:473` 把 `BindingProfile`/`StateMapping`/`ExportScope` 也写在 `effects.ts`；`14:1084` 建议 `ports/records.ts`；`16:2177` 写 `ports/observation.ts`。80-§6.9（`:2562-2590`）已定：OBS-01→`contract/src/ports/observation.ts`、BIND-01→`binding.ts`、EFF-01→`effects.ts`。另加 `13:1108` 的 S1"先落 `monitor/projection-state.ts`"= 在 contract 之外先造一份 `ObservationState`（本卷 `:991` 自己规定"复制即第二套语义"）。**为什么错**：同一类型文件被指派给两个不同端口，实现时要么落错文件再迁移、要么出现两份六态定义，而 13 的 S1 顺序会把本地定义变成既成事实，正好踩中它自己判负的"第二套语义"。修复：四卷统一引 80-§6.9 的三个落点，13 的 S1 改为"等 01 卷落 `observation.ts` 后只做运行时证据构造"。
- **L3P-13（P2）**：`16:1665`「新增 **39** 个…与 §4.12 的 39 个目标源件 **1:1** 对应（…；`tick/types.ts` 是纯类型，无独立运行时测试…）」——同句已自证不是 1:1：A 组 12 个源件只对应 11 个直测，另有 1 个 `intents/intake-receipt`（对应 §4.10.4 接缝，§4.12 无此源件）；B 组 27:27。总数 39 是加法巧合。修复：改为"38 件 1:1 + 1 件接缝测试"，或给 `tick/types.ts` 补一条编译期断言测试。
- **L3P-14（P3）**：`15:558`「编号 `G-81-15-*`（本附录内部登记号）」但表内 `:562-582` 实际用 `G-01…G-21`。**为什么错**：13 也有 `G1–G14`（13 的 G5 与 15 的 G-05 不是同一件事），跨卷引用“G-05/G5”时无法判断归属，回写清单会串卷。修复：统一成一种前缀并声明不跨卷复用。
- **L3P-15（P3）**：`16:1548` 的 `TableProjectionResult = { … name: TableProjectionName … }`，而 80 D30（`:4012`）定 `name: TargetTableProjectionName`（= 17 名 + `resourceLedger`），本卷 `:2333`/§5.1 也要求"目标第 18 个投影名"可返回。将来 rebuild 返回 `resourceLedger` 会类型非法。修复：改用 `TargetTableProjectionName`。

---

## 三、覆盖核对

### 3.1 要求的对象 / 章节 / ID 是否覆盖

| 对象 | 覆盖方式 | 结论 |
|---|---|---|
| `13-panel` §0.1–§八 | 全文 1322 行分段读完；逐 § 核 | 覆盖 100% |
| `13` 关键 ID | `F-panel-*`（src 17 + test 18 + ui 33 + 新增 8 逐条有 ID）、`G1–G14`、`80-D12`、`79-D6/D10`、`U80-16`、`TS-PORT-OBS-01`/`API-01` | 均在卷内有定义或引用；未见断引 |
| `14-api` §〇–§十二 + 附录 A | 全文 1180 行读完 | 覆盖 100% |
| `14` 关键 ID | `F-api-*` 35、`缺口-API-01…16`、`D5/D15/D21/D22/D25/S7/S9` | 均落地；`缺口-API-01/05` 的"已关闭"内容可复核，但行号锚失效（L3P-05） |
| `15-studio-tools` §〇–§十 | 全文 636 行读完 | 覆盖 100% |
| `15` 关键 ID | `F-studio-tools-*` 13、`G-01…G-21`、`U80-17` | 覆盖；编号体例问题见 L3P-14 |
| `16-daemon-engine` §〇–§十二 | 全文 2651 行读完（含 §4.12 的 39 条逐件契约与 §12 锚点表） | 覆盖 100% |
| `16` 关键 ID | `F-DAEMON-ENGINE-*`（68 现有 + 39 目标）、`S-ENGINE-*` 5、`U81-01…24`、`GAP-82-01/05` | 覆盖；ID 无重复、无通配冒用 |
| 本次重点四条 | panel 未知/陈旧→健康（L3P-01/02/03）；api 只落单不派工（见 3.3 正证）；studio-tools 权限边界（L3P-09/10 + 3.3）；daemon 相位/调度/收割/预算/断路与 77/80（L3P-06/07/08 + 3.3） | 覆盖 |
| 逐文件条目"目标写成已有" | 逐条抽 16 的 39 个目标件、14 的 21 个 src 目标件、15 的 5 个新增件、13 的 8 个新增件 | **未发现**把目标写成已有（见 3.3） |

### 3.2 机械核对（本次实跑）

- 计数：daemon engine `68` 件 / `15476` 行、`test/engine` `60` 个 `.test.ts` + 1 夹具、直下 `25` 件、`src/engine` 直下 `13` 件、子域 `19`/`16`——**与 16 全部一致**；`engine.ts 2337`、`merge-run.ts 582`、`sources.ts 479`、`taxonomy.ts 465`、`fakes.ts 451`、`scheduler.test.ts 785`、`sources.test.ts 768`——**一致**。
- 16 的 `errors.push(` = **23 处**、`TickReport.errors: readonly string[]`——**一致**；类型环 5 节点 11 边与 `engine.ts:635` 内联 `import()`、`merge-run.ts:84`、`merge-lease.ts:17`、`MergeRunHost:129`——**一致**。
- 16 的 fake 三处生产调用点 `wire.ts:147`/`serve.ts:975`/`cli/external.ts:94`、`CIRCUIT_BREAK` 只在 `notify/route.ts:83` 与 `evolve/gray.ts:93` 被期待而引擎只发 `ESCALATE`——**一致**。
- `boundary-rules.mjs`：`engine:3`/`engine/tools:2`（`:30-31`）、`engine:13`（`:62`）、`engine.ts:2337`（`:160`）、`scheduler:785`（`:167`）、`sources:768`（`:170`）、`maxLinesPerFile=600`（`:152`）、`daemon→api`（`:108`）、`panel` 层 4——**与三卷引用一致**。
- panel：三面开库点均 `openLedger`（`server.ts:454`、`overview/server.ts:483`、`external/server.ts:553`）且 `servePanel` 有 `existsSync`+`panel/db-not-found`（`:443-444`）；`/api/health` 确为 `{ok:true, schema_version}`（`:176-179`）；`EXTERNAL_ENDPOINTS` 恰 10 条、`external/server.ts` 恰 11 条路由；`src` 17 件、`test` 18 件、`ui` 33 件、`views.ts 662`/`overview/views.ts 629` 在基线——**与 13 一致**（仅 L3P-11 的目录表计数错）。
- api：`packages/api` 恰 3 件（`src/index.ts` 43 / `package.json` 23 / `tsconfig.json` 5）、6 条依赖、`src` 零 import、`apps/daemon/package.json:22` 声明且无人 import；`tsc --noEmit -p packages/api/tsconfig.json` → **exit 0**、`vitest run --root packages/api` → **No test files found / exit 1**——**完整复现 14 的静态检查声明**。
- studio-tools：`git ls-files` 恰 8 条、行数 20/335/264/440/141/21/5/118、`TOOL_ERROR_CATEGORIES` 存在、`GATE_DENY_HINTS` 14 键、`SERVER_INFO`/`DEPS_BACKED` 一致；`@modelcontextprotocol/server@2.3.1` 确有 `./stdio` 子路径与 `maxBufferSize`（`stdio.d.mts:96`）——**与 15 一致**；`server.test.ts` 22 个 `it`、`tools.test.ts` 16 个 `it`（含 `it.each` 展开 21）与 README 的 43 例**自洽**。
- 关键"不存在"：`openLedgerReadonly`、`IntentIngress`、`IntentReceiptStore`、`WorkIntake` 全仓 **0 命中**；`contract/src/ports/` 无 `intent.ts`/`secret.ts`/records；`packages/api/src` 只有 `index.ts`；`assembly/api`/`assembly/intent` 不存在——**14/15/16 的"目标/未实现"标记为真**。

### 3.3 四态与"未越位"的正证（不重复计为发现）

- **api 只落单不派工**：`14` 的 `submitAndClassify` 只转发 `emitIntent`，`ApiServerOptions` 无 `engine`/可写 `Ledger`/`platform`，`intent.ts` 只造信封；`/v1/requests/status` 只读快照、类型上无 `replayQueued`——与 80-§9.4、77-§1.4 一致，未发现越界。
- **daemon 主循环/相位**：16 §4.0.2 的七相位矩阵与 `engine.ts:1582-2236` 锚、相位 4"本拍派发下一拍才收"、相位 5 缺省模拟轨、相位 6 `CLOSE` 终态、相位 7 四尾、"起跑接管不是第八相位"——与 77/80 的相位语义一致；预算"先预留后派发"、断路器不新增相位、收割四要件、`GATE_PASS ≠ 验收` 均写对。
- **studio-tools 权限边界**：wkey 是技术许可不是授权、worker 不持 `gatewaySecret`、helper 先三步注册、`allow ≠ applied`、未注册一律 deny、`peer-verified` 只在宿主注入验证器且 uid 相等时成立——方向正确，问题只在结果面（L3P-09/10）。
- **panel 读投影只读**：三面不写台账/不调平台写、不跑 DDL、"未知不得显示为 0/空/绿"、"缺数据显缺口不补零"、错误体不回 `err.message`/绝对路径——方向正确，问题在陈旧/版本两处（L3P-01/02）。
- **诚实标记**：39 个 daemon 目标件逐条标"文件不存在、零运行证据"（`16:1729`、`U81-22`）；15 明确"stdio 已接"判负、"43 例"只是静态计数；14 明确"未启动 :8788、未装配"；13 明确"未跑任何门禁与测试"。这些都属于合格的 D 类自律。

### 3.4 未覆盖清单

- `13` 的 `ui/**` 33 件只按"语法门禁 + 导入白名单"理解，**未读 JS 源码**，未验证渲染/浏览器行为。
- `13`/`15` 的 vendor 产物哈希、`LICENSE`、`README` 文本未逐条核（只核了路径与行数）。
- `14` 的 80 行号未逐一对表：抽查 8 处即全部错位，按系统性问题报（L3P-05），不再逐行穷举。
- `16` 的"被 40/41/44 个测试文件 import"等计数未逐个复核（只抽了 fake 的三处生产调用点）。
- 未运行 `bun run test`、`bun run guard:boundaries`、根 `typecheck`（除 3.2 的 api 两项复现）。
- 15 的 `proof`/JCS/`PeerCredentialVerifier` 只与 80 文本核对（仓内无实现，无法执行）。

---

## 四、未证与无法判断

1. **80 行号错位的成因不可判**：可能是 80 在 14/16 定稿后被改（同日多轮），也可能是引用时算错。本报告只认定"当前不可复现"，不推断责任；80 内部是否自洽由 C 组判。
2. **`expectedSchemaVersion` 的常量来源（13 的 G7）**：store 现只导出 `Ledger.version()`，无版本常量；该值将来由谁导出、panel 的 wiring 如何拿，未证。若 80/03 也不给，panel 目标态的开库闸无法实现（L3P-01/02 之外的另一处硬前置）。
3. **投影表行读取口（13 的 G5）**：`ReadOnlyLedger` 只给记录信封（`query`/`get`/`payload`），panel 需要 jobs/runs/sessions/events 行；本报告不重复计为发现，但需指出：13 的六个目标投影件与两个必测文件都建在这个不存在的读口上，"计划内红"的关闭时点与责任人未指派。
4. **16 的 39 个目标件能否编译**：B 组 27 件的类型面（`contract/src/ports/{work,evidence,…}.ts`）与纯求值（`core/src/work-readiness.ts`）均不存在，卷内已自认"全部不可编译"；具体类型兼容性未证（无实现可跑）。
5. **15 的 `proof` 跨实现一致性**：依赖 `studio-next/jcs@1` 的共用实现（G-21），仓内两处私有 `canonicalize` 未导出、未标 ID；"字节规则已冻结"为真，"实现已一致"未证。
6. **13 的"陈旧不作为"是否最终显示为绿**：取决于 UI 呈现（33 件未读）；本报告只认定 payload 层没有"陈旧"这一状态位，页面是否另有时间提示未判。
7. **16 的 `fakes` 是否会在真实装配被选中**：三处守卫的实测差异（wire 兜底无 log、serve 静默注册、cli 有 warn）已核；"生产默认不落 fake"取决于 `daemon.yaml` 部署面，未证。

---

## 五、给作者的修复顺序（≤7）

1. **先关接口互斥（L3P-06、L3P-07、L3P-09、L3P-10）**：四处都在冻结签名/权责面上，改文档即可，但必须在立实现单之前；否则类型与写口成形后再改等于返工。
2. **同批修 panel 的只读面与六态（L3P-03、L3P-01、L3P-02）**：都落在 `openReadOnly` + `health` 同一改造面，一次改完再一次写用例；`ReadOnlyLedger` 的成员表要照 80 补齐。
3. **修 14 的 throw 回执（L3P-04）**：它在 M4 冻结验收口径上（`requests/status` 与 202/200 语义），越早越省事；同时把 `duplicate` 的判定权收回到 ingress。
4. **重锚 80 引用（L3P-05）**：机械但必须做——建议一次性改成节号锚 + 复算命令，并删掉"已逐一核对/3680 行本"这类时点性声明。
5. **调 daemon 拆分预算（L3P-08）**：先改 §2.3 的件数与验收命令，再谈实现顺序；否则第 5 步必红。
6. **随上述同批改 P2（L3P-11、L3P-12、L3P-13）**：计数、端口落点、1:1 口径都在同一批文档编辑里顺手完成，不必单开。
7. **P3（L3P-14、L3P-15）**：编辑时顺手统一编号体例与 `TargetTableProjectionName`，不阻塞。

---

## 六、本报告没有做什么

- 没有审邻卷：`03-store`、`01-contract`、`06-gateway`、`17-assembly`、`80` 正文只作为对照证据引用；80/77/79 内部的自洽性、以及 `81-files` 其余 15 卷的交叉冲突，不属本次横向层内审计，交 C 组与对应 L3 分卷。
- 没有替作者重写任何契约，没有给出实现方案或补丁；没有改动任何设计文档、源码、配置、`package.json`、`tsconfig`、`scripts/guards/*`（只创建本文件）。
- 没有把作者**已自认**的缺口重复计为发现：13 的 G1–G14（G5/G7/G8/G9/G10 等）、14 的 `缺口-API-01…16`、15 的 G-01…G-21、16 的 U81-01…24 均按"作者已登记"处理，只在影响判断时引用其位置；本报告只新增**未登记或登记不当**的问题。
- 没有评价文风、篇幅、目录美学；没有把 P1 降成 P2 以求报告好看，也没有把 P2 升成 P0 以求震撼。
- 没有跑全量门禁、没有启动 `:8788`/`:8791`/`:8789`、没有执行真机/跨进程/崩溃注入；所有"未证"均按 scope §六 降级处理，不替文档补证。
