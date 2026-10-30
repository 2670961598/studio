# F8 · DSF 增量复查结论（seatbelt 配置通道，DSF-REVIEW-03）

> 日期：2026-10-30｜复查人：**DSF 侧（DeepSeek Flash）**｜性质：**增量复查结论**——不是 F8 重审、不是 V2 定稿
> 对象：[f8-dsf-delta-seatbelt.md](f8-dsf-delta-seatbelt.md)（增量复查申请）｜增量：`15063ad..fbe634f`（seatbelt workspace-write 配置通道）
> 基线：F8 通过 tag `v2-f8-passed`（`15063ad`，105 files / 1567 tests）→ 增量树 `c8f687d`（tag `v2-seatbelt-delta`，fbe634f＋两份文档）
> 环境：macOS arm64｜node v24.21.0（`mise exec --`）｜bun 1.4.3｜工作树干净、复查全程 HEAD 未动
> 方法：不采信自述；读实现＋独立复跑＋负例逐条对照

---

## 一、判定

**增量通过。** 六项核验全部成立；整改两项（SB-1 证据勘误、SB-2 加固）＋测试补强一项已在增量树落地并复核（§四「处置」列）。**单列「seatbelt delta 通过」，不并入 F8 已审范围。**

---

## 二、六项核验逐条（对应申请件 §四）

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | 缺省是否确实 read-only | **成立** | 三键全缺省 → `coerceSeatbeltGrant` 返回 `undefined` → `config.seatbelt` 不设 → `dispatchAdapterResolver(undefined)` 与 `createEngine` 均不注入；`resolveSeatbeltGrant(undefined)` 返回冻结的 `DEFAULT_SEATBELT_PLAN`（tier=read-only、writeRoots 冻结空）。测试同时从**行为面**证：缺省 tick 的 DISPATCH note 为 `seatbelt=read-only;roots=0` |
| 2 | 负例是否全部拒、无静默补全/放宽 | **成立** | 代码逐条核对：tier 值域封闭（`str()` 拒非字符串/空串，`SEATBELT_TIERS` 仅两值，`off` 拒）；`read-only`（含未声明 tier）带 roots 或 authorization ＝拒；`workspace-write` 缺 roots/auth ＝拒；roots 非 JSON/非数组/空数组/非字符串项/相对路径 ＝拒；裸 YAML 列表 ＝明报「须引号包裹」；auth trim 后空 ＝拒。`coerceSeatbeltGrant` 末尾再调 `resolveSeatbeltGrant` 作二道守门（不复制规则） |
| 3 | grant 是否同一引用到达 resolver 与 engine | **成立** | 唯一装配源＝`ServeConfig.seatbelt`；`executor-face.ts:90` 用 `dispatchAdapterResolver(config.seatbelt)`，`runtime.ts` 用 `dispatchSeatbelt: config.seatbelt`（同一对象）。测试「装配源锚」断言两处取值，`runtime.dispatchSeatbelt` 深一致；行为面证据：放宽 grant 在无端子 executor 上 `dispatch/seatbelt-unknown-executor` 拒派且 **DISPATCH 事件 0 条**（若 grant 没进引擎，该单会以 read-only 静默派发） |
| 4 | 14 tests 是否真跑配置→runtime→engine | **基本成立** | 14 条中 12 条为行为断言（解析正/负例、runtime 注入深一致、缺省不注入、拒派不落 DISPATCH、端到端 note 携授权）；**2 条为源码字符串锚**（`toContain('dispatchAdapterResolver(config.seatbelt)')`）——属结构锚，非行为证据，但用于锁「唯一装配源」可接受（见 §四 SB-4） |
| 5 | 1581 tests 在增量树是否全绿 | **成立（本机 3/3）** | 见 §三 |
| 6 | 是否接受「PRB-04 未执行/实际拦截未证」为边界 | **接受** | 本增量是**配置通道＋构造期守门**，不证内核拦截；PRB-04 not-executed 为本批既定边界，已在申请件 §三 与 runbook §五 明写。不得据此称「seatbelt 已验证」 |

---

## 三、独立复跑（本机，2026-10-30 16:01–16:30 CST）

**整改后终态（本件判定所依据的树）**：`verify:v2` 连续 3 次 exit 0，**106 files / 1583 tests**；`verify:docs` 6/6；边界门禁 930 文件 0 违例；每轮 manifest 5/5、旧台账 7/7。

| 轮 | 命令 | exit | Test Files | Tests | 耗时 |
|---|---|---|---|---|---|
| 1 | `mise exec -- bun run verify:v2` | **0** | **106** | **1583** | 162s |
| 2 | 同上 | **0** | **106** | **1583** | 123s |
| 3 | 同上 | **0** | **106** | **1583** | 123s |

锚点：本轮第 1 跑期间 HEAD 由 `c8f687d` 前移到 `b4f1200`（**同内容提交**，工作区文件未变）；此后在 `b4f1200` 干净树上补跑 1 次确认（见 §三之二）。终态 tag＝`v2-seatbelt-delta-02` → `b4f1200`。

**整改前基线（记录用）**：raw 增量树（`c8f687d`）3 次 exit 0，106 files / **1581** tests（129s/216s/148s）。

> 用例增量：1581 → 1583（+2：控制字符/根目录负例、resolver 行为面）。文件数 105→**106**（SB-1 勘误）。

### 三之二、干净 HEAD 确认跑（`b4f1200`，tag `v2-seatbelt-delta-02`）

| 门 | 结果 |
|---|---|
| `verify:v2` | **exit 0**：106 files / 1583 tests；manifest 5/5；旧台账 7/7；边界 930 文件 0 违例 |
| `verify:docs` | **PASS 6/6**（35 件、真悬空 0） |

## 四、发现与处置

| # | 级别 | 发现 | 处置（增量树已落地） |
|---|---|---|---|
| **SB-1** | 中（证据） | 申请件写「105 files / 1581 tests」，实测 **106 files**（增量新增 1 个测试文件） | **已修**：申请件 §五/§七 改 106；测试增至 1583。同族错误（103/104/105）已三次，建议验收件一律按实测写 |
| **SB-2** | 低（加固） | `sbQuote` 不转义换行/CR；coerce 只校验 `isAbsolute`。含换行的根会断 profile 行 | **已修**：`parseSeatbeltWriteRoots` 拒控制字符；`resolve()` 归一后拒根目录 `/`（显式全盘写域）；`..` 归一后同样拒。派发面 `realpathNearest` 本已消解符号链接与 `..`，现两处双保险 |
| **SB-3** | 提示 | `seatbeltAuthorization` 原文进 DISPATCH note（平台面可见）；另 ` #` 会被 YAML 行内注释截断 | **已登记**：申请件 §七 C2-3 写明非逐字节/避用提示；runbook 示例用「谁/何单/何策略」。不阻断，部署面自担 |
| **SB-4** | 说明 | 2 条源码 `toContain` 属结构锚；另有 1 条空转断言（只断言 `tier`）、resolver 行为面缺测试 | **已补齐**：空转断言改为 `resolveSeatbeltGrant` 全字段深比对；新增 `resolver 行为面`（claude + workspace-write 装配期 `agentconfig/seatbelt-unenforceable`） |

> 另：并行独立审计件 [seatbelt-delta-audit.md](../probe/seatbelt-delta-audit.md) 对同一增量的结论与本件一致（缺省最严/负例 fail-closed/单源 grant/全门绿成立），其 C2 边界项已由申请件 §七 登记。两件互不引用为证据，属独立复算。

## 五、边界确认（与本增量一起生效，不得被后续件读成「已验证」）

1. **PRB-04 未执行**：不证内核实际拦截；本增量只到「配置→装配→派发计划→profile 生成」。
2. **符号链接/绝对路径逃逸**：派发面按 `realpath` 判据处理（`NEG-RUN-04` 覆盖），runbook 按「不支持」登记。
3. **authorization 不是秘密**：见 SB-3。
4. **不并入 F8 已审范围**：F8 基线 `15063ad` 的结论不变；本件单列 seatbelt delta。
5. **V2 final 仍待制作人明示**：本件不构成 final。

---

## 六、签署

| 角色 | 结论 | 日期 |
|---|---|---|
| DSF 侧（DeepSeek Flash） | **seatbelt 增量通过**：六项核验成立；SB-1/SB-2 已修并复核（106 files / 1583 tests ×3） | DSF-REVIEW-03｜2026-10-30 |
| 施工侧 | 无待办（SB-1/SB-2 已落；C2 边界登记在案） | — |
| 制作人 | 待阅：是否接受增量通过；V2 final 明示 | |

*本件为 DSF 增量复查记录；不改 F8 结论、不改任何卷状态词、不宣称 V2 定稿。*
