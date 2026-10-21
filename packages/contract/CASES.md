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
| `evt` / `rpt` | contract 自身（src/schemas/，M1.2 已落：evt 5 条 + rpt 3 条） | 事件记录/REPORT+summary 格式 |
| `deps` | company 依赖清单引擎（DEV-26 已落：17 条——解析/绑定求值/版本并集/决策纯面/指纹） | 语义（43-§四+§十5-8 / 51-D）；隔离根安装/registry+log+confirm/热重载 IO 面由 company 单测负责 |
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


## 运行方式

```ts
import { runCases } from '@studio-next/contract'
import manifest from '<contract>/cases.json'
const report = await runCases(manifest, { dir: loadCompanyDirectory }, { domains: ['dir'] })
// report.failed 非空 = 契约红
```
