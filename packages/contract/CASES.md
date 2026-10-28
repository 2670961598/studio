# cases.json 契约格式规范（v1，冻结面）

> 依据：docs/25-§二、需求 F2-14、docs/08-§三（契约分级）。
> 本文件是契约格式的唯一规范；runner（src/runner.ts）是实现，二者冲突以本文件为准，
> 改本文件 = 改契约，走批示（20-§二：验收口径冻结后禁改）。

## 清单结构

`packages/contract/cases.json`：

```json
{
  "version": 1,
  "cases": [
    {
      "id": "C-dir-001",
      "domain": "dir",
      "docs": "04-§二",
      "title": "一句话人话描述",
      "input": { },
      "expected": { "out": { } }
    }
  ]
}
```

## 冻结规则

1. **稳定 id**：`C-<域>-<序号>`（如 `C-dir-001`）。一经合入**永不复用、永不改义**；
   废弃用例标 `deprecated`（清单级字段，后续版本引入），不物理删除。
2. **恰一期望**：`expected` 必须恰含 `out` 或 `err` 之一。
   - `out`：subject 正常返回，按匹配语义断言
   - `err`：subject 必须抛错，`category` 必须相等；`subcause` 仅在给出时断言
3. **`__NULL__` 哨兵**：期望树中字符串 `"__NULL__"` 表示「实际值必须是显式 null」，
   与「键省略=不关心」构成两种"无值"的正交表达。
4. **匹配语义**（语言无关，任何 runner 实现必须等价）：
   - 对象：expected 的键集是断言集，actual 多出的键不关心
   - 数组：长度相等 + 元素无序双射（每个期望元素恰匹配一个实际元素）
   - 原语：严格相等；期望值禁用 NaN
5. **input 内联**（v1）：小语料直接内联；大语料后续版本走 `file` 指针（schema 已预留扩展位）。
6. **每单必填 docs**：用例必须引用设计文档章节号（20-§二 依据链）。

## 域清单（v0）

| 域 | subject 归属 | 断言侧重 |
|---|---|---|
| `meta` | contract 自身（runner 自证） | 机制本身 |
| `dir` | company 校验器 | 语义（规则命中）；行号定位由 company 单测负责 |
| `evt` / `rpt` | contract 自身（src/schemas/，M1.2 已落：evt 6 条 + rpt 3 条） | 事件记录/REPORT+summary 格式（evt 6=P6 增补 JUDGE_ 前缀族正例） |
| `deps` | company 依赖清单引擎（DEV-26 已落：17 条——解析/绑定求值/版本并集/决策纯面/指纹） | 语义（43-§四+§十5-8 / 51-D）；隔离根安装/registry+log+confirm/热重载 IO 面由 company 单测负责 |
| `mj` | core 判定面（studio-dev-164 已落：8 条——parseJudgeVerdict 三道闸） | 语义（160-§6.1：严格 JSON 闸/op 枚举闸/params 域闸+严格键集）；三帽/熔断/拍闸策略面与调用库 IO 面由 core/daemon 单测负责 |
| `exe` / `inv` / `mdl` / `gw` | 各泳道 | 端口冒烟 case |
| `plat` | 各平台实现（yt/localfile 已接线，taiga 挂到期——见下方 v1 语义说明） | **错误分类一致性**（102-P2-①：只断言 category 全等）；端口冒烟正例归 P1 批次未兑现 |

### deps 域 v1 语义说明（DEV-26，规范 v1.1 已冻结——docs/43-§四/§十5-8）

> 依赖清单引擎（company 的 `depsSubject`）按 docs/43-§四（v1.1 主特性）落契约面。与 `dir`
> 域同分工：契约 case 断言**语义**，company 单测（dependencies.test.ts）承载 IO 面。

- subject 路由：case 输入按键分派到引擎纯面——`{parse}`→parseDependencies（strictObject
  未知键/未知 attr/坏 version 形态拒收）、`{enabled}`/`{demanded}`→绑定求值（dept 双候选、
  skills 逐元素、level 字符串化、多绑定同插件=约束并集）、`{satisfies}`→版本判定表
  （^caret 区间/^0.x 锁 minor/精确等值/缺 patch 归一）、`{plan}`→安装决策纯面
  planPluginInstalls（install/replace/satisfied/conflict/missing 五动作，零 IO）、
  `{fingerprint}`→配置指纹三态（sha256(deps 原文‖启用集投影)，43-§十-8）。
- 不进契约的面（IO/位置细节，归 company 单测）：隔离插件根落位（pluginRoot 注入无缺省值，
  绝不写用户 ~/.dsh）、registry.json/install-log.jsonl、confirm 确认位、failOnMissing
  严格面抛错、51-D-4 公司包插件形态闸（dsh.bundle 声明）——err 通道 subcause 面由单测断言。
- 冲突语义红线（51-D-2）：源版本不满足约束并集=conflict 如实上报，**不装错版本**——
  C-deps-014 钉死；缺源双面（51-D-3）：默认 missing 可见不阻断，failOnMissing 抛错归单测。

### dir 域 v1 语义增补（v0.1-M2.2，拟稿待批）

> 本节为增补说明，头注明示**拟稿待制作人批示后固化**（改本文件=改契约，20-§二）。

company 校验器自 v0.1-M2.2 起对 `loadCompanyDirectory` 缺省做**多文件全目录校验**
（departments/**/config.yaml、人事档案 front-matter、charter_ref、.studio-next.yaml 交叉——
docs/04-§二 契约全貌；实现 packages/company/src/multifile.ts）。`dir` 域 3 case 的 input
只有 org-config.yaml 单文件（v0 语料），按全检语义 C-dir-001 将因部门/档案/元信息文件缺失翻红；
契约语料单写者纪律（不为本单改 cases.json），故：

- `dir` 域 v1 语义冻结为「**org-config.yaml 单文件校验**」：subject（company 的 `dirSubject`）
  以宽容位 `strictFiles:false` 包装 `loadCompanyDirectory`，既有 3 case 口径零漂移。
- 多文件全目录校验的契约面留给后续批次的 `dir2` 域（开批时落 case，`strictFiles` 宽容位
  届时随契约化收口）；多文件行为面暂由 company 单测（multifile.test.ts）承载。

### plat 域 v1 语义说明（studio-dev-102 P2-①，2026-10-21 落批）

> 首批 8 case（C-plat-001..008）= **错误分类一致性批**：同一坏输入打两实现
> （yt 真适配器＋localfile 内存实现），只断言 `expected.err.category` 全等
> （docs/25-§一.4 错误语义统一；docs/25-§6-2 前半句自此有机械兑现面）。

- **op 路由约定**：`input.op` 按键分派到 FlowPlatform 七面（docs/25-§3.2）——
  `activity.since`→activity.since(cursor)、`comments.add`→issues 侧评论写、
  `fields.provision`→fields.provision(map)、`issues.get`→issues.get(id)、
  `kb.get`→kb.get(path)。subject 由各实现包测试内接线
  （yt：`packages/yt/src/plat-cases.test.ts`，真适配器＋FakeYouTrack 注入 fetch——
  坏输入族全部先于网络/落盘校验；localplatform：
  `packages/localplatform/src/plat-cases.test.ts`，内存实现＋tmpRoot）。
- **BASE 哨兵**：`issue: "BASE"` = subject 预建基准单（两实现各自预建一张同位单，
  subject 负责翻译成本实现单号）——两实现的 comments 写路径都**先查单存在再验署名体**
  （同序），坏署名体 case 必须落在存在的单上才会走到署名校验。
- **只断言 category 纪律**：`expected.err` 只给 `category` 不给 `subcause`——subcause
  跨实现差异**如实放行**（yt `not-found` vs localfile `kb-not-found` 同属 not-found 族）；
  跨实现 subcause 词表对齐=第二阶段，随公共 subcause 词表批示（102-§4.2 冻结面）。
  单实现内的稳定键（同错同键：同一坏输入两次抛同 subcause）与 not-found 族稳定键前缀
  由各实现包测试断言（不进契约面）。
- **反证纪律**：各实现包测试内含「改坏 category 必红」反证（谎报 subject 必被 runner
  揪出——防恒）。
- **taiga 到期挂账**：taiga 实现已同构（102 证据 E4：三套错误类 category+subcause 形状
  一致），接线归 platform 泳道后续批次（102-§4.5-4 不催在飞泳道）；到期条件=泳道合入后
  补第三 subject 同批 case 三绿。

### plat 域 v1 语义说明·第二批（studio-dev-126，2026-10-21 提案全批）

> 增批 2 case（C-plat-009/010）= **provision 收敛批**：同 map 的 provision 是收敛
> 幂等操作——重跑（C-plat-009）与两写者并发竞跑（C-plat-010，TOCTOU 判重窗口）都
> 不得误报 CONFIG_INVALID（studio-dev-104 提案 B 轴：并发 TOCTOU 窗口收敛为幂等成功，
> 非假 CONFIG_INVALID）。

- **op 增批**：`fields.provision.rerun`（同 map 二连跑）、`fields.provision.concurrent`
  （同 map Promise.all 双跑）——subject **诚实计算** `out.converged`（任一跑抛错即
  false，case 断言钉死 true，谎报必被反证揪出）；`expected.out` 走 runner 的
  键集全等断言面。
- **map 合法形状跨实现一致**：`fields` 恒含 `state` 映射（yt 面要求——IssueRecord.state
  必填、transition 写它；taiga/localfile 面同形状放行）——契约 map 是三实现共享面，
  合法性取最严公约。
- **分层证明纪律**：契约 case = 三适配器统一义务面（收敛不误报）；**窗口吸收机制**
  （真机 400 `Duplicated name` 二写读回吸收——B 轴的实现体）归 taiga 包单测
  `fields.test.ts`（FakeTaiga 脚本化 400 形状对齐真机实测，S3 证据 docs/32-§九），
  不进契约面——机制是实现自由度，收敛是契约冻结面。


### mj 域 v1 语义说明（studio-dev-160 提案 §6.1/§6.6-C1，制作人 2026-10-22 全批；单 164 落 case）

> micro-judge 判断调用的**裁决解析语义**契约面：subject=core 纯函数 `parseJudgeVerdict`
> （packages/core/src/judge.ts；core 测试内接线 `runCases(manifest, { mj: subject })`）。
> 策略面（三帽/按址熔断/拍闸）与调用库 IO 面（合成 brief/一次性工作区/落账/事件）不进
> 契约——归 core（judge-gates.test.ts）/daemon（engine/judge/）单测。

- **输入路由**：case 输入 `{raw, vocab}`——raw=模型原始输出串（不预处理：围栏/解说
  文字/前后缀噪声原样进），vocab=调用方冻结词表（结构形 `{ops:[{op, params:{键:域}}]}`，
  enum 域带 values 候选集）。
- **三道闸语义**（160-§6.1 冻结）：闸① `judge/bad-json`——raw 必须解析为单一对象
  `{op:string, params:object}`，**前后缀噪声与顶层未知键拒收**（不抢救：判断输出是
  机器消费面）；闸② `judge/op-not-in-vocab`——op ∈ 词表（模型无词表扩展权）；
  闸③ `judge/params-domain`——params 键集**恰等**词表键集（未知键=造键，缺键=半成品）
  且逐键过域（enum ∈ 候选集=上下文候选的语义细化面 / string 非空 / string-list
  全非空串）。
- **err 通道全给 subcause**（区别于 plat 域只断 category）：mj 是单实现（core 判定面），
  subcause 即三道闸的闸位标识，跨闸漂移=语义漂移，契约直接钉死。
- **词表语义白名单**（§8-S10：选择/排序/过滤——pick/order/front/append/collect/skip）
  是**注册闸**（assertJudgeVocab，CONFIG_INVALID）不是解析闸，不进本域 case；白名单
  断言归 core 单测。
- **反证纪律**：core 测试内含「改坏期望必红」反证（同 deps 域先例——防全绿假象）。


## 运行方式

```ts
import { runCases } from '@studio-next/contract'
import manifest from '<contract>/cases.json'
const report = await runCases(manifest, { dir: loadCompanyDirectory }, { domains: ['dir'] })
// report.failed 非空 = 契约红
```


### rec 域登记（MIG-03 / IMPL-03-01，2026-10-28；**追加不重写**）

> 域清单增补：新增 `rec` 域。上方「域清单（v0）」表为 v0 冻结行（改表=改契约，20-§二），
> 故新增域以本节登记，不覆盖既有行。依据：plan/05 IMPL-03-01（领土含「CASES.md 域清单登记 rec 域」）、
> v2/11 §一（REC- 74 类唯一登记处）、v2/14 §二 规则②（记录族形状落 `contract/src/records/`）。

- **域归属**：`rec`＝**运行记录族形状校验面**（v2/11 §一 74 类）。subject 归属＝`packages/contract/src/records/`
  的族校验器（envelope/auth/common/life/perf）；断言侧重＝**形状与拒绝条件**（字段必填/枚举投影/跨记录不变量），
  不做语义判定（语义归各族校验器之后的位置记录，真机腿归 V3 各实现单）。
- **落位**：本域用例**不以 cases.json 条目承载**（cases.json 唯一写者＝LANE-C 的 case 扩充单，见 IMPL-03-06），
  而落 V2 新套件 `packages/contract/test/v2/records/**`（fixtures.ts＋org-root/rec-auth/rec-common/rec-life/rec-perf）。
  因此本域不参与 `runCases` 路由；`bun run test:v2 -- packages/contract` 即本域回归命令。
- **已覆盖 NEG（V1 形状腿）**：`NEG-ORG-09/11/12/13/14/15`（org-root.test.ts：无 root_delegation／子 agent 持 root／
  root 超范围／N 单元域重叠／单元缺位静默／自审自称独立）＋`NEG-REC-01/02/03` 底行（rec-auth／rec-life／rec-perf
  的族内拒绝条件）。V3（真机/网关）腿不在本域，归 07-06/07-10 与各编排单。
- **登记面自检**：本域登记 3 族 28 类（AUTH 16＋LIFE 11＋PERF 1），余 46 类（WORK/EVD/ACC/CHG/CAP/REV/EVAL/
  ASSET/OBS/MEM）归 IMPL-03-02；**74 类总数不变**（未新增记录类）。
- **反证纪律**：每族至少一正一负（正例证明形状不自相矛盾、负例证明放行路径不存在）；不跑真机、不打桩 LLM。

### enc／rule／sch／rec／port 域清单登记（MIG-03 / IMPL-03-06，2026-10-28；**追加不重写**）

> 域清单增补：新增 `enc`／`rule`／`sch`／`rec`／`port` 五域（首批 43 条，`cases.json` 53→96；plan/05
> IMPL-03-06「契约 case 扩充·enc/rule/sch/rec/port 域首批」）。上方「域清单（v0）」表为 v0 冻结行
> （改表=改契约，20-§二），故按上文「rec 域登记」先例以本节追加，不覆盖既有行、不改既有 case。
> 依据：plan/04 §1.2（V1 契约先行法：id 形／docs 形／NEG 前缀映射／VEC-01..08 直接入 enc 域）＋§三
> （NEG-119 分配：SCH10＋RULE10＋ENC2 的契约 case 域）；v2/10 §一/§四/§六/§七/§八/§九；v2/11 各族节；
> v2/14 §二（F5 端口-文件映射）；v2/17 §四（NEG-ENC/SCH/RULE/REC 的 V1 腿）。

| 域 | subject 归属 | 断言侧重 |
|---|---|---|
| `enc` | core 的 jcs 面（`canonicalizeJsonText`／`semanticDigestOfText`；执行落 `packages/core/test/v2/enc-digest.test.ts`——**契约包不 import core**） | VEC-01..08 规范文本＋SHA-256（**照录** v2/10 §七 表，不自造）；VEC-09/10→NEG-ENC-01/02 拒收（E-ENC-003 域外数值／E-ENC-002 I-JSON 前置） |
| `rule` | core 的两阶段门面（`typecheckRuleProfile`→`evaluateRule`／`checkProfileUpgrade`；执行落 `packages/core/test/v2/rule-engine*.test.ts`） | 最小合法档＋单点非法构造：E-RULE-001/003/004/005/006/008/010 码级；`refused`／`unknown` 不压布尔；档升级缺变更链判负 |
| `sch` | contract 的记录／标量 schema 面（`ALL_RECORD_SCHEMAS`＋`records/envelope.ts` 标量族；**V1 结构腿**，company 纯配置真面归 MIG-05/06） | NEG-SCH-01..10 的形状腿：标量域／数值域／非规范投影／未知类型／未知扩展／版本形／词表外码值（只断 category，见下 err 通道） |
| `rec` | contract 的 `ALL_RECORD_SCHEMAS`（按记录自带 `recordType` 分派） | NEG-REC-01..09＋11 一族一条形状拒绝（字段必填／枚举投影／superRefine 承载的跨记录不变量） |
| `port` | contract 的 13 端口模块常量＋映射（v2/14 §二 F5 单点表；含 gate/obs/ops） | 13 端口名集合／`PORT_VERSION`＝`v0`／端口-文件映射 13/13（新增第 14 端口即红） |

#### input 形与 subject 路由（v1 inline）

| 域 | input | 路由 |
|---|---|---|
| `enc` | `{jsonText: string}` | 文本→规范文本→语义摘要；VEC 负向走 `parseIJson` 拒收 |
| `rule` | `{profile, rule, inputs?, limits?}`（两阶段）或 `{upgrade: {previous, next, evidence}}`（档升级判定） | typecheck 失败→err；通过→evaluate（返回恰七字段）；`upgrade`→`checkProfileUpgrade`（判负→err） |
| `sch` | `{op:'scalar', family:'token'|'dotid'|'semver'|'timestamp'|'recordTypeId', value}` 或 `{op:'record', record}` | 标量域→标量 schema；记录→`ALL_RECORD_SCHEMAS[recordType]` |
| `rec` | `{record: AnyRecordEnvelope}` | `ALL_RECORD_SCHEMAS[record.recordType]` 形状闸；未登记类型／形状不符即拒 |
| `port` | `{op:'names'|'version'|'fileMap'}` | 端口模块常量／`PORT_VERSION`／模块-文件映射 |

#### err 通道与码级纪律（本批冻结口径）

- **category**：契约 subject 的拒绝统一 `CONFIG_INVALID`（17-§9 两级分类；实现侧 subcause 不同不跨实现断言）。
- **enc／rule 给码**：`subcause`＝v2/10 §八 诊断码（E-ENC-002/003、E-RULE-001..010），即「码级断言」；
  码与相位映射见 v2/10 §八（一码一相位，不跨用）。rule 档的 `semanticDigest`＝
  `semanticDigest({profileId, version})`（与 core `test/v2/rule-fixtures.ts` 同法复算），不得手写十六进制。
- **sch 只断 category**：形状腿 subject 不合成 §八 码值——标题里的 `E-SCH-00x` 是**语义归属**（v2/10 §九
  强制失败出口的码位），code 级断言归 MIG-04/05 的记录／资产面实现单。§八 的 `refResolve` 相位与 v2/09
  ENU-97 七值存在登记张力（core `spec.ts` 已登记），故 SCH 码不跨相位断言。
- **rec 只断 category**：族内**语义判定**腿仍在 `test/v2/records/*.test.ts`（`validateXxx`＋族上下文），
  cases.json 的 rec 条只覆盖 `ALL_RECORD_SCHEMAS` 可判的形状面。
- **rule 的 out 例外面**（v2/10 §6.6，必须保留，不得改写成 err／布尔）：NEG-RULE-02/03 的
  `inputBinding` 拒绝记 `outcome=refused`＋E-RULE-005/006；NEG-RULE-07 超限记 `refused`＋E-RULE-008；
  NEG-RULE-08 `if` 条件 unknown 不求值分支、结果 `unknown`。

#### 本批 case 与 NEG 覆盖（43 条：enc10／rule10／sch10／rec10／port3）

- **enc**：`C-enc-001..008`＝VEC-01..08（正向，`expected.out={canonical, sha256}`）；`C-enc-009/010`＝
  NEG-ENC-01（`{"v":1e+30}`→E-ENC-003）／NEG-ENC-02（`{"a":1,"a":2}`→E-ENC-002）。
- **rule**：`C-rule-001..010`＝NEG-RULE-01..10 各一条（最小合法档＋单点构造）；err 6 条、out 4 条（refused×3＋unknown×1）。
- **sch**：`C-sch-001..010`＝NEG-SCH-01..10 的形状腿：dotid 大写段、非整数计数、timestamp 无偏移、
  `schemaVersion` 非 semver、未登记 AREA、缺 `index_ref`、空 `provenance.digest`、未知键 `entrypoint`／
  `mount_stamp`、词表外 `effectiveState`。
- **rec**：`C-rec-001..010`＝NEG-REC-01（AUTH `proof_mode`）／02（LIFE-08 缺 `review_terms`）／
  03（PERF 五维合并）／04（WORK 空 `raw_content`）／05（EVD 空 `does_not_prove`）／06（ACC 缺申辩说明）／
  07（CHG 空 `criteria_version`）／08（CAP 九维缺项）／09（REV 空 `dissent_position`）／11（ASSET 空传播语义）。
- **port**：`C-port-001`（13 名）／`C-port-002`（`v0`）／`C-port-003`（文件映射 13/13）。
- **NEG 前缀映射**：本批 32 条（ENC2＋RULE10＋SCH10＋REC10），`title` 首段为 `NEG-<族>-<序号>｜`，
  机械统计见 `test/v2/cases/case-manifest.test.ts`。**REC 族 10 号无该 NEG 行**（v2/17 §4.3 表无 10 号，编号不连续是登记事实）；
  NEG-REC-12（OBS，无 V1 腿）/13（MEM）与 NEG-SCH 的 company 语义半面归后续批次。

#### 修订与缺口（如实登记，不代决）

- **对既有「rec 域登记」的修订**：该节「本域用例**不以 cases.json 条目承载**」自本批起**仅指各族语义判定腿**；
  本批新增 10 条 rec 形状 case 落 `cases.json`（subject＝`ALL_RECORD_SCHEMAS`），族内语义腿仍在
  `test/v2/records/*.test.ts`，两腿不互相顶替。原登记不删除、不回改。
- **缺口 1（sch §四 真面）**：YAML 投影子集（E-ENC-004）／资产导入卫生／签名粒度／通道边界／信任态剥离
  依赖 company 装载器与资产部（MIG-05/06），本批只落 schema 形状腿；NEG-SCH-03/06/07/08/09 的语义半面待补。
- **缺口 2（YAML bomb 上限负测）**：需 company 装载器面（YAML 别名/深度/规模上限），未入本批
  （plan/04 §二 MIG-03 行原列该条；本批领土不含 company，如实挂账）。
- **缺口 3（rule 正向 case）**：本批 rule 10 条全为 NEG 码级（03-07 验收口径「E-RULE 码逐条负例」）；
  合法档两阶段全绿的正例证据在 core `rule-engine.test.ts`，cases.json 正向首批随下一批 case 扩充补。
- **执行归属**：`enc`／`rule` 在 cases.json **无执行 subject**（契约不依赖 core，依赖方向=实现包→契约包）；
  `test/v2/cases/case-manifest.test.ts` 对二域只做结构／期望形态断言（VEC 表与码表为 v2/10 §七/§八 照录副本），
  执行归 core 的 V2 测试；`rec`／`sch`／`port` 三域由该测试的本地 subject 跑可执行子集（含正例对照与改坏必红反证）。
