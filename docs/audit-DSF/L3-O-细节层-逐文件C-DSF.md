# L3-O · 细节层 · 逐文件契约 C（yt / taiga / matrix / dsh-bridge）审计

> 审计员：L3-O（独立审计，不是作者；不为任何结论辩护）。
> 审计日期：2026-10-27。口径：`docs/audit-DSF/_scope-DSF.md`（P0–P3、证据纪律、报告结构）。
> 范围：`docs/81-files/09-yt.md`、`10-taiga.md`、`11-matrix.md`、`12-dsh-bridge.md` 四卷全文；上位只按相关节核对（75–80、01-contract v0.10、82 的登记口径）。**只审层内自洽与交班能力**；跨层问题只标注并交 C 组。
> 已读：四卷 792 / 1026 / 1092 / 950 行全部读完；另核对 `_scope-DSF.md`、81 主卷、80-§5.7/§6.6/§6.9/§11.2.1/§12.1、78-§3.2–§4.7/§7.4.1/§9.2/§9.3/§11.2/§13、01-contract v0.10、`boundary-rules.mjs` 与相关源码。
> 只写本报告；未改任何设计文档、源码、配置。

---

## 一、结论

- **P0 = 0，P1 = 10，P2 = 9，P3 = 1。**
- 四卷的“现有 / 目标 / 未证”标记总体诚实：没有把 fake 测试写成真机、把文档写成验证；计数（yt 25/27、taiga 35/41、matrix 18/26、dsh-bridge 7/24）逐路径可复算，行数抽样全部对得上。问题不在“有没有标”，而在**同一事实在卷与卷之间不一致、目标件契约本身不可执行**。
- 最严重三条：
  1. **L3O-01**：`11-matrix` 把 `SEC-MX-BOT-PASSWORD.allowedUses` 写成含 `matrix-register` 并称“保留未用位”，与 78/80/01 的“恰两项、不留保留位”相反；且它引用的 78 行内容正好相反。这是被三份上位文档明确废止的口径，若照此落 catalog，80 的启动校验会判配置错误。
  2. **L3O-02**：`10-taiga` 的 `BindingProfile.stateMappings` 用了**运行时** `StateMapping` 形状（`platformState/workStates/verification/...`），而 80 的 20 字段字段 #11 是 `{family, ours, theirs, direction, lossRefs}`；同时 `TaigaBindingFacts` 没有 `stateMappings` 入参、卷内又说现状为“零”、78 无 taiga 专用 `STAT-D` 表。结果是 `mapState` 的 `verified` 分支无数据来源，M2a 的“命中→verified”验收不可满足。
  3. **L3O-03**：`09-yt` 的 `bindingProfile()` / `lossReport()` 都是零参，卷内又说“事实由装配方以值注入”、且“纯函数、零状态、只导出三件”。零参 + 纯函数 + 运行期值注入三者互斥：没有构造器、没有参数、没有模块注入点；而 `10-taiga` 的同名函数是带 `facts` 参数的。宿主无法用同一套调用约定装配两个平台包。
- 最接近 P0 的是 L3O-01（安全边界），但当前权威 catalog 仍在 78/80/01，且 11 自身也写“不得拿来建号”，故按“会导致错误实现/验收说不清”的 P1 计；**若把 11 的表当作实现依据去落 catalog，应升级为 P0**。
- 四态标记的例外：`10-taiga` §4.0 把目标类型（`Result`、`FailureClass`、`WorkState`）写成现行来源（L3O-11），`11/12` 把已关闭的 78 口径写成“仍待回写”（L3O-01）。

---

## 二、发现表

### 2.1 P0（0 条）

无。没有发现新的、会使根命题/不变量/整条链当场不成立的缺陷；四卷的“绑定链未实现”“写路径零真机证据”“PRM 生成器不存在”均已被作者自己标为目标/未证。

### 2.2 P1（10 条）

| ID | 级别 | 类型 | 位置 | 事实 / 引文（≤2 行） | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3O-01 | P1 | A 矛盾 / C 漂移 / D 过度声明 | `docs/81-files/11-matrix.md:926`、`:961`、`:1059`、`:1073`；`docs/81-files/12-dsh-bridge.md:1073`；对照 `docs/81-files/10-taiga.md:244`、`docs/78-技术细节-宿主平台与工作区绑定.md:1017`、`:1025`、`docs/80-技术细节-StudioNext运行时与公共接口.md:3626`、`:3633`、`docs/81-files/01-contract.md:5` | 11 的表格把 bot 密码 `allowedUses` 写成 `platform-auth` + `matrix-register` + `outbound-redaction`；§7.5 写“`matrix-register` 是保留未用位”；§9.2-7/§9.3-8 称 78 仍写“同时服务建号”。78:1017 实为“**恰两项，不含 `matrix-register`**”，78:1025 写“**不留「保留未用」**”，80:3633 写该旧口径“**作废**”。 | (1) 把一条被 78/80/01 明确删除的用途重新写回，属于安全边界（秘密用途）回归；按 80 的 U80-18 负向探针，catalog 里出现该用途即“配置错误、拒启动该能力”，照 11 表实现的部署会启动失败或边界被放宽。(2) 引用的 78:1017 内容与原文相反，所谓“78 与 80 冲突、78 需回写”不存在；12:1073 复制了同一误引。(3) 10:244 写“78 三用途旧口径待同步”同样过期（78 已是两用途）。 | 把 11:926 行改为“`platform-auth` + `outbound-redaction`（恰两项）”；删除 11:961 的“保留未用位”、11:1059 与 11:1073 的“78 需回写”条；改 12:1073 与 10:244 的过期引述；在卷首“沿革”注明 2026-10-27 已按 78/80/01 收敛。若真有部署要用 bot 密码建号，走 catalog 语义变更提案，不在附录留位。 |
| L3O-02 | P1 | A 矛盾 / E 不可执行 | `docs/81-files/10-taiga.md:619`、`:406`、`:408`、`:776`、`:927`；`docs/80-技术细节-StudioNext运行时与公共接口.md:2043` | 10:619 写档案字段 #11 “只用 80-§6.6 的 `StateMapping` 字段名：每项 `platformState` / `workStates` / `verification` / `unmappedBehavior`”，并称 78 骨架里的 `theirs/ours` “只是语义别名，不另立字段”。80:2043 的 `BindingProfile.stateMappings` 实为 `{family, ours, theirs, direction, lossRefs}`。10:406 的 `TaigaBindingFacts` 没有 `stateMappings`；10:619 现状列写“**零**”；G18 说 78 没有 taiga 专用 `STAT-D` 表；10:927 的 M2a 验收却要“命中→`verified`”。 | (1) 字段 #11 若按 10:619 填，就缺少 `family/ours/theirs/direction/lossRefs`，`describe()` 返回的档案不满足 80 的 20 字段形状；若按 80 填，则 10 的 `StateMapping` 表又说错。(2) `mapState` 的“声明命中”分支需要一个静态 `stateMappings` 表，但 facts 没有该入参、卷内又说现状为零、78 没有该表；实现只有两条路：自造一张 `STAT-D` 表（违反 78-§9.5 与 G18“本卷不补”）或让 `verified` 分支永远不可达。(3) M2a 的验收断言因此不可满足。 | ① 按 80:2043 的字段形状重写 10:619（`family` + `ours`⊆`STAT-D` + `theirs` + `direction` + `lossRefs`）；② 给 `TaigaBindingFacts` 增 `stateMappings`（由 78 的 `STAT-D` 表提供，允许空数组，空则全 `unverified`）；③ 在 G18 关闭前把 `mapState` 的“命中”分支删除或改标“目标-门控”，M2a 验收改为“全 `unverified`”并断言 `Err` 只在空/畸形时出现；④ 同单回写 78-§9.2 的表。 |
| L3O-03 | P1 | A 矛盾 / B 缺口 / E 不可执行 | `docs/81-files/09-yt.md:488`、`:493`、`:498`、`:550`；`docs/81-files/10-taiga.md:406`–`:409`；`docs/80-技术细节-StudioNext运行时与公共接口.md:2130` | 09:488 的签名是 `bindingProfile(): Result<BindingProfile, ClassifiedError>`；09:498 说“公司/部署/权威事实须在装配期以值注入本包”；09:493 说本文件“只导出三件”、纯函数、零状态；09:550 说今日诚实返回是 `Err`。10 的同名函数是 `bindingProfile(facts, digestOf?)`、`lossReport(facts)`。80:2130 写的是 `bindingProfile()` / `lossReport()`（无参）。 | (1) 零参纯函数没有事实入口：要么读模块级可变状态（不再是纯函数，且成为第二事实源），要么永远拿不到 `ownerPositionRef`/`authorization`/`effective` 等字段，只能恒返 `Err`；09 没定义任何构造器、setter 或 facts 参数。(2) 同一组“三件套”在两个平台包里签名不同，宿主 `assembly/platform/binding.ts` 无法用同一套调用约定装配；80:2130 又是第三种（无参）写法。(3) `F-yt-test-binding` 的“20 字段逐项存在”成功态测试没有合法输入可造。 | 在 80 层二选一并写死：**(a)** 三件套都收 `facts`（含平台静态表 + 部署注入），同步改 80:2130、09、10；或 **(b)** 零参返回**静态骨架**，部署事实由宿主按 20 字段合并，明确哪些字段平台包可给、哪些只能宿主填。无论哪种，给 09 的 `bindingProfile`/`lossReport` 补输入通道，并与 10 的签名对齐；测试按新签名重写。 |
| L3O-04 | P1 | A 矛盾 / C 漂移 | `docs/81-files/09-yt.md:219`、`:737`；`docs/81-files/10-taiga.md:287`、`:363`、`:983`；`docs/80-技术细节-StudioNext运行时与公共接口.md:966`、`:1014` | yt 的 404 目标行：`EXTERNAL_REJECT/not-found`，`failure` 栏写“无 `failure` 可填”；taiga 的 404 行：`rejected_precondition / CONFIG_INVALID / not-found`。80:1014：`not_found` 不是 `FailureClass`，纯读不存在应 `Ok(undefined)`/`Ok([])`；80:966：`rejected_precondition` 唯一允许的覆盖是**我方对外 API 路由 404**，不是出境平台 404。 | (1) 同一个外部事件（平台 404）在两个平台包里给出两个 `failure/category` 结论，daemon/gateway 无法写一张统一处理表；按 `failure` 决定重试/对账时会分叉（yt 无 failure，taiga 说“前置缺件、补齐后可重试”）。(2) 两者都不符合 80 的 `Ok(undefined)`；yt 自己承认受冻结用例约束（Q17），taiga 承认 D14，但**层内没有单一临时口径**。(3) 这是交班能力的硬伤：适配器换平台会改变上层行为。 | 交 C 组/78/80 给一张唯一表：平台“记录不存在”= 读口 `Ok(undefined)`（需 D14 契约改）；在契约改动前，两个包统一用**同一个**临时映射（建议都 `rejected_precondition/CONFIG_INVALID`，把 yt 的冻结例外写成 80 的显式覆盖条目，而不是各写各的）；在 09/10 各加一行“以 80-§5.7 表为准，不在本卷另裁”。 |
| L3O-05 | P1 | A 矛盾 / E 不可验证 | `docs/81-files/11-matrix.md:369`、`:370`、`:549`；`docs/80-技术细节-StudioNext运行时与公共接口.md:966`、`:969`、`:970` | 11 的“唯一映射表”三行：`2xx 但响应缺字段 → unverified / EXTERNAL_REJECT`；`其它 4xx → rejected_precondition / EXTERNAL_REJECT`；hr-face 目标 `partial → EXTERNAL_REJECT`。80:966 只许“路由 404”把 `rejected_precondition` 覆盖为 `EXTERNAL_REJECT`；80:969 `unverified → EVOLVE_REJECT`（无覆盖）；80:970 `partial → STALL`（无覆盖）。 | (1) 三行都用了 80 不允许的 `category` 配对；按 80 的 `classified()` 构造器，显式覆盖必须落在允许集内，否则构造期 `configInvalid('classified-input-invalid')`——11 自己写的“**唯一来源**”表会让错误构造直接抛，而不是返回 `Err`。(2) 下游事件 note/告警分桶按 `category` 走，三行会把“响应形状/调用方入参/部分成功”混成外部拒绝，掩盖真实处置。(3) 11 没有把这三行的 `category` 配对登记为待回写；它的 §9.2-2 只登记“contract 缺 `FailureClass`”，读者会把这些配对当作已定。 | 三行改为 `CONFIG_INVALID` / `EVOLVE_REJECT` / `STALL`；若 Matrix 确需不同语义，在 80-§5.7 提“允许覆盖”的提案并在表里引用，不单方面写。补一组表驱动测试：每行 `(failure, category)` 必须能在 80 的缺省/覆盖表中查到，否则红。 |
| L3O-06 | P1 | E 不可执行 / F 权责 | `docs/81-files/11-matrix.md:465`；`packages/contract/src/schemas/errors.ts:54`；`docs/81-files/01-contract.md` 的 `F-contract-schema-errors` | 11:465：`redact` 抛错 → `Err(configInvalid)`，且“**不重试、不抛**”。`configInvalid(subcause, detail?): never` 是**抛错构造器**（已核 `schemas/errors.ts:54`）；真正的 `Err` 载体是 `classified(...)`（01-contract 目标）。 | (1) `Err(configInvalid)` 要么把函数对象当错误值（类型不符），要么先调用 `configInvalid(...)` 再包 `Err`——但它在返回前就 throw 了，直接违反同句“不抛”。(2) 结果不是 fail-closed 的 `Err`，而是未捕获异常；调用方拿不到 `ClassifiedError` 的 `failure/category`，通知面“脱敏闸失败”这一情形没有可判别的返回。 | 改成 `Err(classified({ failure:'rejected_precondition', subcause:'redact-failed', detail? }))`（或按 80 允许的等价 `Err` 字面量）；补一条测试：`redact` 抛错时 `send` 返回 `Err`、不抛、零 `sendMessage` 调用。 |
| L3O-07 | P1 | A 矛盾 / B 失败路径 | `docs/81-files/12-dsh-bridge.md:351`、`:401`；`docs/78-技术细节-宿主平台与工作区绑定.md:500` | 12 的 `listen` 步骤 3 顺序：`readFile → 字节上限 → parseManifest → validateShape → validateReferences → validateTime → validateHost → verifyManifest`；12:401 却写“先摘要后签名（**78-§3.4 顺序**）”。78:500 的顺序是“摘要 → 签名 → 有效期 → 引用可解析 → 与部署交集非空”。 | (1) 12 把“引用解析”和“期限/宿主匹配”放在摘要/签名**之前**：未验签的清单字节会先被解析、先触发注入的 `resolveRef`，再验完整性。78 把摘要/签名放在最前正是为了避免处理不可信内容；12 只保留了“摘要先于签名”这一对，未保留全序。(2) 对一张被篡改的清单，返回的首个错误是 `manifest-refs-unresolved`/`manifest-shape`，而不是 `manifest-digest-mismatch`/`manifest-signature-invalid`，调用方的处置分类会错。(3) 12 的测试矩阵只测单点错误，不测顺序，无法否证。 | 把顺序改为 `parse → shape（不触外部）→ digest → signature → effective/validity → host → refs → 部署交集`；`resolveRef` 只允许在 `verifyManifest` 成功之后调用；在 `test/position/manifest.test.ts` 加“先返回 digest/signature 错误、且 refs 未被调用”的负向用例。若 12 认为自己的顺序更合理，必须回写 78-§3.4，不能在同一卷里既引用 78 又不照做。 |
| L3O-08 | P1 | B 承诺无机制 / A 矛盾 | `docs/81-files/12-dsh-bridge.md:105`、`:352`、`:397`、`:881`；`docs/78-技术细节-宿主平台与工作区绑定.md:500`、`:505`–`:508` | 12:105 写“拿不到台账引用、部署配置交集、JCS 规范化实现（G3）与验签材料/算法（G17）。**拿不到就 fail-closed**”。但 12:352 的步骤 4 只对 `resolveRef`/`digestOf`/`verifySignature` 三项缺失拒载，**没有任何部署交集输入**；12:397 明说任职有效性“本文件不判、也判不了”；G3 只登记摘要实现缺口。78:505–508 的插件侧再校验是为“防启动器被绕过”，校验链含“与部署交集非空”。 | (1) 承诺的 fail-closed 只覆盖三项；缺“部署交集”不是返回 `Err`，而是**根本没有这项检查**。若启动器被绕过（这正是插件侧二次校验的存在理由），一份比部署更宽的清单会通过插件。(2) `appointmentRef` 的任职有效性同样不判，却不在 G 表登记为缩水项；82 无法据此登记损失。(3) 作者把“拿不到”与“没有通道去拿”混为一谈：前两项是可拒的缺注入，第三项是契约里没有输入。 | 二选一：① 给 `listen` 增 `deploymentIntersection`（或 `tightenOnly(manifest, deployment)`）输入，缺失即拒，并加“启动器被绕过 + 清单宽于部署 → 拒”的负向用例；② 明确登记为 G 项（扩展 G3 或新 G20）：“插件侧不校验部署交集与任职有效性，只有启动器校验”，同时删掉 12:105 的无条件 fail-closed 表述，并把该缩水写进 78 的 loss。 |
| L3O-09 | P1 | A 矛盾 / B 关键场景无出口 | `docs/81-files/12-dsh-bridge.md:349`、`:354`、`:373`；`docs/78-技术细节-宿主平台与工作区绑定.md:515` | 12:349 步骤 1：缺 `tools`/`sandbox`/`approval` 任一“必需面” → **先**抛 `host-face-missing`，且“不得先收紧一半再发现缺面”；12:354 步骤 6 又用 `unsupportedSegments[]` 让未承载段“不执行并标 `not-applicable`”。78:515 明确有“宿主只承载部分段（如只有 `sandbox`，无 `tools`/`approval`）”这一行：未承载段进 `unsupportedSegments[]` + 逐段 `REC-LOSS-01`，已承载段继续。 | (1) 12 的 all-or-nothing 面检查在解析清单**之前**执行，使 78 的“部分承载”路径不可达：一份正确地把 `tools` 列入 `unsupportedSegments[]` 的清单，仍会因宿主没有 `tools` 面而被拒。(2) 这与 12 自己的步骤 6（按 `unsupportedSegments` 跳过）自相矛盾；也把“降级运行”变成“整机拒绝”，属于关键场景无出口。(3) 78 的部分承载表是为“目标宿主不能表达某段”设计的，12 等于把它废掉。 | 先解析清单，再按段检查：若缺面对应的段在 `unsupportedSegments[]` 中 → 继续、逐段记损失；否则才 `host-face-missing`。补三组测试（只有 `sandbox`；`sandbox`+`tools`；缺 `tools` 且清单未列 unsupported → 拒），与 78:515 的行一一对应。若 DSH 0.2.0-rc.2 实际总是三面齐全，也必须先有探针证据（G7/U12-05）再收窄，不能现在写死。 |
| L3O-10 | P1 | B 未定义失败路径 | `docs/81-files/11-matrix.md:275`–`:278`、`:784`；`docs/81-files/11-matrix.md:545` | `MatrixSessionDeps.registration?` 可选；`MatrixSessionHandles.hrMatrixFace: () => MatrixHrFace` 是**必填**；工厂内部要 `createMatrixHrFace`，而该面的目标构造参数 `MatrixHrFaceOptions` 要求 `registrationSecret: SecretMaterial`。11:784 的测试设计写“建号关闭而 `registration` 存在 ⇒ 不启用建号（`hrMatrixFace()` 仍按**关闭语义**）”，但**关闭语义未定义**。 | (1) 当建号能力关闭、`registration` 缺失（这是合法配置）时，工厂无法按自己的契约构造 `hrMatrixFace`：要么这个必填 handle 在调用时抛错/返回 `undefined`，要么 `createMatrixHrFace` 被无秘密构造（违反其构造校验）。两条路都没写。(2) daemon 侧的 `MatrixHrFace` 是结构面，若拿到的是“关闭态”，`ensureAccount` 的返回/抛错类别也未定义；`ensureMembership`/`ensurePowerLevel`/`kick` 是否仍可用也未说明。(3) session.test 的目标用例无法写“关闭语义”的断言。 | 把 `hrMatrixFace` 改为可选（`hrMatrixFace?: () => MatrixHrFace`），并同步 daemon 结构面；或定义一个“关闭态面”：`ensureAccount` 返回 `Err(unsupported)`/`configInvalid('matrix-register-disabled')`，其余三方法正常，`MatrixSessionHandles` 单列该语义。补测试：`registration` 缺失时 handle 存在、`ensureAccount` 返回可分类拒绝、零注册请求；`registration` 存在但建号关闭时同样不启用。 |

### 2.3 P2（9 条）

| ID | 级别 | 类型 | 位置 | 事实 / 引文（≤2 行） | 为什么错 | 修复路径 |
|---|---|---|---|---|---|---|
| L3O-11 | P2 | D 四态不诚实 / A 矛盾 | `docs/81-files/10-taiga.md:240`、`:243`；对照 `:974`；`docs/81-files/01-contract.md:514` | 10:240 写“类型来源：`Result`/`ClassifiedError` 在 `contract/src/ports/kernel.ts`，`FailureClass` 14 值在 `records/scalars.ts`”；10:243 写“`WorkState` 在 `ports/work.ts`”。同卷 D1（10:974）写这些“在 `packages/contract/src` **零命中/无定义**”，01-contract:514 也写 `Result` 与 `failure` 槽是“**目标增补**”；仓内 `packages/contract/src/ports/` 无 `work.ts`。 | 把目标落点写成现行来源，正是 81-§四禁止的“把目标写成已有”。读者若按 10:240/243 去 import，会找不到 `Result`/`FailureClass`/`WorkState`；同时与同卷 D1 自相矛盾。 | 改 10:240/243 为“**目标**落点（D1 关闭前不可 import）”，与 D1 同口径；在 §4.0 表头加一行“本列只指目标类型落点，不是现状”。 |
| L3O-12 | P2 | B 缺口 / A 矛盾 | `docs/81-files/11-matrix.md:209`；`docs/78-技术细节-宿主平台与工作区绑定.md:1530`；`docs/80-技术细节-StudioNext运行时与公共接口.md:3827` | 11:209 把 `PlatformBindingPort`/`BindingProfile`/`mapState`/`STAT-D` 全判 N/A（理由：Matrix 是通信绑定），引用的是 `80-§12.2`；80:3827 写“78 的损失报告**必须能进** `PlatformBindingPort.describe()` 的 `loss`，否则绑定档案与运行时不连通”；78:1530 的 Matrix 卡列了 4 条损失（含 `通知不是决定` blocking）。 | (1) Matrix 的 4 条损失没有在 11 的契约里落到任何端口/字段；11 只说 BindingProfile N/A，没有给替代承载面，导致 78 的 blocking 损失在运行时不连通。(2) 引用的 80-§12.2 实际是“与 79 构建/exports 的一致”，与绑定无关；正确的接缝在 80-§12.1/§6.6，锚点错了会让读者找不到依据。 | 二选一：① 为通信绑定增加 `lossReport()`/`losses` 投影（可复用 `REC-LOSS-01` qid），在 `F-matrix-*` 的某一处承载并说明与 `PlatformBindingPort` 的关系；② 明确写“edge binding 的损失由 78-§11.2 卡承载，不进 `PlatformBindingPort`”，并回写 80-§12.1 为 edge binding 开一句豁免（C 组）。同时把 11:209 的出处改为 80-§12.1/§6.6。 |
| L3O-13 | P2 | A 矛盾 / E 不可验证 | `docs/81-files/12-dsh-bridge.md:389`、`:399`；`docs/78-技术细节-宿主平台与工作区绑定.md` §3.2.1、§3.2.2 | 12 的 `ManifestHeader` 有 `effective{from,until?,reviewBy}`，`ValiditySegment` 又有 `effectiveFrom/effectiveUntil/reviewBy/revocationWatchRef`；`validateTime` 只读 `manifest.effective`（12:399），`validity` 段只做形状校验。78-§3.2.1 与 §3.2.2 两处都定义为“过期即拒绝”。 | 同一个“生效窗口”在 PRM 里有两份字段，12 只把 header 当权威；一份 header 宽、`validity` 窄的清单会被插件接受，而按 `validity` 读是过期的。若生成器写错一份，插件没有一致性检查；这是第二事实源 + 潜在 fail-open（在签名验证可用的目标态）。 | 二选一并写死：① 两处必须逐字段相等，否则 `manifest-shape`/`manifest-expired` 拒载；② 明确 `validity` 才是权威，header `effective` 只作摘要，`validateTime` 读 `validity` 并校验两者一致。加一条“header 与 validity 不一致 → 拒”的测试；若 78 本意是二选一，回写 78。 |
| L3O-14 | P2 | B 顺序矛盾 / G 工程 | `docs/81-files/12-dsh-bridge.md:577`、`:654`、`:865` | 12:577 的目标 `files` 白名单含 `LICENSE`；12:654 又说“在 D3 定案前，`files` 白名单里的 `LICENSE` 项与 `license` 字段**不得先落**”；12:865 的 M2（dist 切换六项）没有 D3 前置，却要“补 `files`”。 | M2 若先于 D3 执行，无法同时满足“补齐 `files`（含 LICENSE）”与“LICENSE 不得先落”；实现单要么漏项，要么把未定许可写进发布面。这是迁移顺序的可执行性问题，不是文风。 | M2 的 `files` 先写不含 LICENSE 的版本，D3 定案后单独一步加 LICENSE + `license` 字段；或在 M2 前置里加 D3。把 12:577 的目标值标成“D3 后”。 |
| L3O-15 | P2 | A 矛盾 / D 过度声明 | `docs/81-files/12-dsh-bridge.md:630`；`apps/daemon/src/assembly/serve.ts:40`、`:993`；`docs/78-技术细节-宿主平台与工作区绑定.md` §4.3 | 12:630 写“桥可以「daemon 帮你挂」，position 不行”；同段又写“需 `agent.yaml` 的 cmd 显式 `--patch <本文件>`，**daemon 不代改 executor 命令**”。实际 `serve.ts:40` 写“bridge overlay 启动期生成（下方段），**挂载归 cmd**”；`serve.ts:993` 写“overlay 未生成；须自行以 `--patch` 挂载”。 | 两句话自相矛盾：daemon 只生成 overlay 文件，是否挂载仍由部署的 `agent.yaml` cmd 决定。把它写成“daemon 帮你挂”，会让读者以为 bridge 自动生效；实际若 cmd 忘了 `--patch`，插件不加载、`required=false` 下静默降级，身份注入不发生。 | 改为“bridge 的 overlay 由 daemon 生成到固定路径，但**挂载仍归部署 cmd**；position 的补丁连生成都不在 daemon”。若确实要“daemon 帮挂”，必须落 `agent.yaml`/cmd 的写入机制与证据，否则别写。 |
| L3O-16 | P2 | A 矛盾 / G 治理 | `docs/81-files/12-dsh-bridge.md:880`、`:629`、`:239` | 12:880 的 G2 缓解写“在定案前本附录只保证「**同一 overlay 内 position 条目在前**」这一配置顺序”；12:629/§3.3 又说 position **不能**进 `dsh.bundle`，只有独立的 `cordis.position.patch.yml`，bridge 走 `dsh.bundle.patch`。 | 两个 patch 是分开的（一个 bundle、一个显式 `--patch`），不存在“同一 overlay 同时含两条”的形态；该缓解措施不可实现，读者会误以为顺序已有着落。 | 删除该缓解句，或明确“若部署自行合成一个同时含两条的 overlay，则 position 条目在前；本包不提供该合成物”。把 G2 的未决状态写清。 |
| L3O-17 | P2 | D 过度声明 / G 引用 | `docs/81-files/12-dsh-bridge.md:879`；`docs/80-技术细节-StudioNext运行时与公共接口.md:187` | 12:879 的 G1 写“80-§2.4 又说「**零新包**」「dsh-bridge 实现不动」”。80:187 的“零新包”是第 4 条，明确只指 `spec`/`engine`/`runtime`/`records`/`memory` 五个语义包，不是“position 插件不能另立包”。 | 用一条被限定范围的“零新包”来排除“position 独立包”的方案，论证不成立；G1 的结论（归属未定、需 80 表态）可能仍对，但依据是错的。 | 改 G1 的依据为“78-§4.1 只说‘框架发布’，未指定包；80-§2.1/§2.4 只写 dsh-bridge 不变，未说 position 归属”，删掉“零新包”引述；让 80 明确 position 入口归属。 |
| L3O-18 | P2 | A 二源 / G 维护 | `docs/81-files/12-dsh-bridge.md:402`–`:420`、`:938`；`docs/81-技术细节-StudioNext逐文件蓝图.md` §二（允许引用、不复制字段） | 12 的 `manifest.ts` 给出 15 个本地码到 77 `failure`/80 `category` 的完整映射表（12:402–420），同时 12:938 又说“映射表在调用方”；包本身零出边，调用方（daemon）还会有自己的一份映射。 | 同一映射有两处事实源（附录里的表 + daemon 实现），没有同步机制；82 若按附录写测试，daemon 改表时不会红。81-§二要求“引用接口而不复制字段”，这张表属于复制。 | 把映射表移到 daemon 分卷/80 的“本地码→ClassifiedError”唯一表，12 只保留本地码清单与“由调用方映射”的指针；或反过来，在 daemon 卷引用 12 的表并禁止另写。加一个机械检查：本地码枚举与映射表同源生成。 |
| L3O-19 | P2 | B 缺口 / E 不可验证 | `docs/81-files/10-taiga.md:624`；`docs/81-files/09-yt.md:542`；`docs/76-技术细节-公共语义与纯配置规范.md:2210`–`:2212`；`docs/78-技术细节-宿主平台与工作区绑定.md:1530` | taiga #16 写“Taiga 的损失事实**仍是** 78-§9.3 三条 + 本附录补的五条”；但同卷 D6-1/D6-2/D6-6、D7-1/D7-2/D7-3 记录了建单非原子、无 CAS、认证只在内存、`lane` 建单不写、kb slug 碰撞、拆闸无基线等字段/状态/权限损失，这些不在“3+5”里。yt #16 只列 78-§9.2 四条（guards/无 webhook/偏移分页/热换绑），其 Q1（typeInbox 丢）、Q2（schema 首页/粗映射）、Q13（巡逻核静默关）也不在四条里。76:2210–2212 的 `REC-LOSS-01` 要求 `lossId` + `dimension`（11 值：identity/authority/obligation/commitment/acceptance/evidence/memory/time/scope/extension/interoperability）+ `affectedRefs`/`detectableHow`/`cannotClaim`。 | `BindingProfile.losses` 是逐项 `REC-LOSS-01` 引用，`lossReport()` 与档案同源；“3+5”读起来是完整枚举，但缺少同卷自己记录的字段/状态/权限损失，档案会系统性少报。两份附录也没有按 76-§8.4 的 `dimension` 11 值分型，也没有按本次审计的“字段/状态/权限”三面做内部交叉表，无法检查“三面是否齐”。 | 在 09/10 各建一张“损失候选表”，列：`lossId`、`dimension`（取 76-§8.4 的 11 值）、内部三面（字段/状态/权限，可多选）、来源（78 已有/本卷 D/Q）、是否已进 78；`lossReport()` 只从这张表取。把 #16 的“仍是 3+5”改为“当前可引用清单，未含 D6/D7 候选”。在 78 回写前，`lossReport()` 对缺失 qid 一律 `Err`（两卷已如此），不得用“3+5”冒充完整。 |

### 2.4 P3（1 条，编辑/锚点，不阻塞）

| ID | 级别 | 类型 | 位置 | 事实 | 修复 |
|---|---|---|---|---|---|
| L3O-20 | P3 | G 失效引用 / 计数 | `docs/81-files/11-matrix.md:1074`（称“78 现 1933 行”，实测 1981 行）；`docs/81-files/11-matrix.md:209`（把绑定 N/A 的出处写成 80-§12.2，实际是 §12.1/§6.6）；`docs/81-files/10-taiga.md:252`（“2、5 全适用”，#5 实为“部分适用”）；`docs/81-files/09-yt.md:180`（“导出 6 组”，实列 7 项） | 均为引用/计数小错，不影响结论，但会破坏“行号按实测”的自述纪律。 | 统一改锚点/计数；卷首“行号复核”段补一条“78 现 1981 行”。 |

---

## 三、覆盖核对

### 3.1 已覆盖对象

| 卷 | 覆盖范围 | 核对结果 |
|---|---|---|
| `09-yt.md`（792 行） | §〇–§九全部；F-yt-* 目标 27 件（生产 13 / 测试基建 7 / fixtures 5 / 配置 2）；Q1–Q17；G1–G19；V0–V5 口径 | 全读；计数复算 25→27、`src` 直属 18→20 成立；Q13 的 `fieldSchema` 不填 `values`、Q8 的 `ACTIVITY_CATEGORIES` 缺 Updated、`PACKAGE_STATUS='ready'` 均已核代码；`plat-cases` 5 个 `it` 实跑 5/5 通过 |
| `10-taiga.md`（1026 行） | §〇–§八全部；现有 35 件全部、目标 41 件（18 生产 / 7 测试基建 / 14 测试 / 2 配置）；D1–D16；M0–M4 | 全读；行数 5764、生产 2868、测试基建 838、src 测试 1614、test/ 421、配置 23 全部复算成立；88 处 `new TaigaPlatformError` + 1 处裸 `Error` 成立；`PACKAGE_STATUS='onboard-cut'`、`testutil` 693、`platform-fixture` 57、`fake-faces` 88 成立 |
| `11-matrix.md`（1092 行） | §一–§十全部；现有 18 件、目标 26 件（15 生产 / 8 测试 / 3 配置）；9.1 未证 25 项、9.2 跨卷缺口、9.3 冲突 | 全读；行数 3547、生产 1946、测试 1548、配置 53、`it` 96 全部复算成立；`client.ts:184 whoami`、`:162–164` 四段 mac、`provision.ts:35` sleep、`hr-face.test.ts:52` SECRET 成立；`session.ts`/`errors.ts` 不存在（目标）成立 |
| `12-dsh-bridge.md`（950 行） | §〇–§十一全部；现有 7 件、目标 24 件（7 生产 / 10 测试 / 7 配置）；G1–G19；U12-01…21 | 全读；现有 7 件、行数 212/321/217/20/6/12/8 成立；`boundary-rules.mjs:94` `dsh-bridge:1`、无模块入边成立；`serve.ts:40/993` 的“挂载归 cmd”与 12:630 的“daemon 帮你挂”矛盾已核 |

**对本次三个重点的直接回答（细节见上表）**：

- **字段/状态/权限损失是否各自列明**：yt 与 taiga 都**列了**（yt：78-§9.2 四条 + Q1/Q2/Q6/Q8/Q13；taiga：78-§9.3 三条 + §4.5.2 补五条 + D6/D7），但都**没有按 `REC-LOSS-01.dimension` 分型**，也没有一张“字段/状态/权限”三面齐全的候选表；`losses` 的完整性无法验收（L3O-19）。另有两处状态/权限语义被写成可执行契约但缺数据源或分类（L3O-02、L3O-05）。
- **Matrix 的会话/身份/权限是否与公司身份混同**：11 的 §2.4/§7.5 明写“通知不是决定、房间不是公司身份、会话不是岗位资格、频道内容不可信”，`company` 只作 `InvokeIntent` 的归属参数；**本次未发现把会话/token/room 当作公司身份或岗位资格的混同**。邻接风险是已登记的“`rooms` 缺省=全部已加入房间”（11:956/§7.4，目标要求显式白名单）与本报告的 L3O-10（建号关闭态的未定义）、L3O-12（损失无承载面）；前者的修复在 boot/装配，不在本包。
- **dsh-bridge 与 78 的 position 插件/PRM 是否职责重叠**：12 把“PRM 生成”归 78-§3.3、“授权/资格/生效”归公司面与 `TS-PORT-*`，“加载/校验/收紧/事件”归插件，§1.4/§4.3 与 78 的分工一致；**这不是双实现，是 78 定义、12 落码**。真正的重叠风险是 12 的 `manifest.ts` 复制了 78-§3.2.2 的段内字段清单与 78-§3.4 的映射（L3O-18 的同类问题），以及 `host.ts` 的宿主面投影建立在 78-§13 未探的形参上（G7，作者已登记）。**未发现 12 另立 PRM 生成器或授权源**。


### 3.2 交叉核对的上位锚（只核相关节）

- 80-§5.7（`failure`×`category` 缺省/覆盖、`Err` 可达 6 类、`not_found`/404）、§6.6（`PlatformBindingPort` 20 字段、`StateMapping`、BIND-01 三层）、§6.9（类型/宿主落点）、§11.2.1（秘密六用途、bot/HR 两条目）、§12.1（四个注入面、损失进 describe）、§12.2（构建，不是绑定）。
- 78-§1.2（20 字段）、§3.2.1/§3.2.2/§3.2.4（PRM 头部/九段/PTC）、§3.3（G1–G8）、§3.4（双重校验与顺序）、§4.1–§4.7（position 卡/九职责/与 bridge 区别/子 agent/不可写面/事件/损失）、§7.4.1（秘密清单）、§9.2/§9.3（两个平台卡）、§11.2（Matrix 卡）、§13（探针）。
- 01-contract v0.10（`F-contract-port-binding`、`F-contract-rec-scalars`、`ClassifiedError` 两轴、`configInvalid` 与 `classified` 分工）；`scripts/guards/boundary-rules.mjs`（层位/边/线基线）；相关源码（yt/taiga/matrix/dsh-bridge、`contract/src/ports/kernel.ts`、`contract/src/schemas/errors.ts`、`serve.ts`、`instructions-store.ts`）。

### 3.3 未覆盖清单

- 未读 75/76/77/79/82 全文；只按四卷引用到的节核对（76-§7.7/§8.4、77-§11.1/§4.8/§4.9、79-§5/§6/§7、82-§12.3/§12.4 只看引用是否自洽，未逐条读）。
- 未审 `13-panel`、`14-api`、`15-studio-tools`、`16-daemon-engine`、`17-daemon-assembly`、`18-boot`、`19-root-guards` 附录；`12` 的 daemon 宿主、`09/10/11` 的 daemon 装配只在必要处引用。
- 未做跨层 C 映射表（09/10/11/12 与 76/77/78/80 的逐概念承接）；本报告只在 L3O-01/04/12/19 标注“交 C 组”。
- 未逐字节核对 fixtures JSON、`test/smoke/*` 脚本、`probe-evidence/**`；只按文档描述与文件存在性核对。
- 未运行全量测试、`typecheck`、`guard:boundaries`；未接真实 Matrix/Synapse/YouTrack/Taiga，未跑 82 的 V4/V5。

---

## 四、未证与无法判断

1. **测试只跑了一个文件**：`packages/yt/src/plat-cases.test.ts` 用仓内 vitest 实跑 **5/5 通过**（对应“10 条全绿”），其余 09/10/11/12 的测试套未跑；因此“18 it/21 it”“96 例”“15 例”等只是**静态 `it(` 计数**，不是全量回归证据。`bun` 不在本环境，`bun run test` / `typecheck` / `guard:boundaries` 均未执行。
2. **`BindingProfile`/`Result`/`FailureClass`/`PlatformBindingPort` 在 `packages/contract/src` 零落点**：`grep` 与 01-contract v0.10/D1 一致；`ClassifiedError` 仍是 `{category, subcause, detail?}` 三字段；`configInvalid` 是 `never` 抛错构造器（`schemas/errors.ts:54`）。这些是“未证/目标”，不是“已具备”。
3. **真机证据未复跑**：`docs/31` 的 2026-10-19 bridge 冒烟、`docs/32` 的 Taiga 试点、`probe-evidence/taiga-links` 都只作为仓内记录引用；本报告未启动 DSH、Matrix、Synapse、YouTrack、Taiga。12 的 E6（源码形态）与 11 的 V5、10 的 V5 一律**未证**。
4. **78/80 是长卷，只读相关节**：本报告对 78/80 的引用均核到行；但 78/80 其他节若还有与四卷冲突的口径，可能未发现。C 组做全卷映射时应复核。
5. **“P0=0”的判断**：以“权威 catalog 仍在 78/80/01、四卷均为设计呈审稿”为前提；若 L3O-01 的表被当作实现依据，或 11 的错误映射被直接落码，应按 P0 重新评估。

---

## 五、给作者的修复顺序（≤7 条）

1. **先修安全边界（L3O-01）**：11:926 改两用途、删“保留未用”、删 11:1059/1073 与 12:1073 的 78 回写条、改 10:244 的过期引述。零代码，一次改完；这是唯一“照抄就出事”的条目。
2. **定绑定三件套的调用约定（L3O-03）**：在 80 层二选一（`facts` 参数 vs 零参静态骨架 + 宿主合并），同步 09/10 的签名与测试；再接 10 的 `stateMappings` 字段形状（L3O-02）。这两条不解决，`F-yt-binding`/`F-taiga-binding` 无法开工，M2a 验收也写不出来。
3. **统一错误分类（L3O-04/05/06）**：先由 C 组/78/80 给平台 404 的唯一表；11 的三行改回 80 的缺省/覆盖；`Err(configInvalid)` 改 `classified(...)`。55 个端口都读这套错，越晚改越贵。
4. **修 dsh-bridge 的 PRM 校验链（L3O-07/08/09）**：顺序改回 78-§3.4；补部署交集输入或登记缩水；先解析清单再按 `unsupportedSegments` 决定缺面。这三条都在 `position/index.ts` 的 `listen` 一处，适合同单。
5. **补 Matrix 会话的关闭态（L3O-10）**：`hrMatrixFace` 可选或定义关闭态面，写进 `MatrixSessionHandles`/daemon 结构面与 `session.test`。
6. **补损失承载（L3O-12/19）**：给 Matrix 的 edge-binding 损失找承载面；给 09/10 建带 `dimension` 的损失候选表，把“3+5/四条”改为“可引用清单 + 候选”。
7. **最后清 P2 工程项（L3O-11/13–18/20）**：taiga 的“目标类型写成现状”、PRM 双 `effective`、LICENSE/`files` 顺序、bridge “daemon 帮你挂”、G2 的“同一 overlay”、G1 的“零新包”引述、12 的映射表二源、11 的过期行号。可随各自实现单带着走，不必单独立项。

---

## 六、本报告没有做什么

- 没有替作者重写任何卷；只给最小修复路径，没有提出“全部重做”。
- 没有修改任何设计文档、源码、配置、guard 或 lock；唯一写入是本报告。
- 没有做跨层 C 映射表的替代工作：凡“78/80 与 09/10/11/12 的承接”只标注并建议交 C 组，未在这里下最终裁决。
- 没有把 75/76/77/79/82 当作审计对象；只把它们当锚点，引用其相关节。
- 没有运行全量测试/类型门禁/边界守卫；没有真机探针、没有导出/迁移/退出演练、没有 `semanticDigest` 对拍。
- 没有在“未证”处补证，也没有把“文档写了”当“系统已有”；所有“已核”均指本次实际读到的文件/代码/行，不包含未复跑的真机记录。
