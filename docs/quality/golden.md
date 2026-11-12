# QA golden 集（#811 阶段2；observe-only，QA-1 维护）

> 设计面依据：`docs/17-§3`（台账=可重建投影事实源）、`docs/02-F2`（数据/状态）；
> 口径/纪律：observe-only、不硬门禁、只读本仓数据、golden 归 QA-1、不污染仓。
> 阶段1（纯观测 `qa-report`）见 `docs/quality/README.md`；本文件只定义 golden/eval。

## 1. 数据位置与版本

- golden 数据（**不入仓**）：`<companyDir>/var/qa/golden/golden-v<n>.json` +
  `manifest.json`（`qa-golden-manifest/v1`：版本/文件名/sha256/样本数/generatedAt）。
- 口径文档（入仓，QA-1 维护）：本文件。
- 版本：文件名/内容 `version` 递增（v1→v2…），**只增不改旧版**；旧版不删除（可回看漂移历史）。

## 2. 显式构建（人工审后跑；实现绝不自动生成/覆盖）

```sh
studio-next qa-eval --build-golden <golden目录> --db <ledger.sqlite> --company <slug> \
  [--count 80] [--until YYYY-MM-DD] [--version v1] [--models <models.yaml>]
```

- 版本升序：已有 manifest 时请求 version 必须 **> 旧 version**（v1→v2 可建新版，旧 v1 文件保留可回滚，
  manifest 原子更新指向最新版）；同版本/降版本明确拒绝（不覆盖）；该版本 golden 文件已存在也拒绝。
- 构建只读台账：候选=`有 CLOSE 且至少一次 GATE_PASS` 的已收口单（每单一条，CLOSE 去重）；
  `--until` 缺省=昨天；`--count` 默认 80（分层覆盖不足时按确定性哈希序补齐，不虚报样本）。
- `--models` 给出时 golden 内 tier 计数按 models.yaml 三档映射（不给则 tier=0，不猜）。

## 3. 选取规则（`hash-strata/v1`，冻结）

1. 候选：CLOSE 且 GATE_PASS≥1；按 issue 去重（取最后 CLOSE）。
2. 分层键：`dept|level|type|outcome`；outcome 优先级 `stall > qa-back > long > retry > clean`
   （long=首 DISPATCH→CLOSE ≥30min；retry=有 GATE_FAIL；clean=无 GATE_FAIL）。
3. 层内按 `sha256('qa-golden/v1:'+issue)` 稳定排序；层间 round-robin 取至 target；
   不足则按全局哈希序补齐。
4. 脱敏：ticket 记录只含 单号/部门/等级/类型/lane/outcome/attempt 数/GATE_FAIL/QA_BACK/STALL/
   RESUME/首DISPATCH→CLOSE 时长/模型列表；**不含 note 原文、路径、凭据、外部链接**。
5. 样本量/覆盖：report 标 `cohorts`（部门维度样本数）与 `coverage`；不做统计显著性断言。

## 4. 评测（`qa-eval`，observe-only）

```sh
studio-next qa-eval --db <ledger.sqlite> --company <slug> --date YYYY-MM-DD \
  [--golden-dir <目录>] [--out-dir <目录>] [--golden-version v1] [--baseline qa-report.json] \
  [--models <models.yaml>] [--top N]
```

- 窗口=本地自然日 `[00:00,24:00)`；当前窗口指标复用 qa-report 口径；golden baseline 统计=
  golden 选中样本聚合（构建时冻结）。
- 指标：`onePassRate`（CLOSE 单 GATE_FAIL=0 占比）、失败原因分布 JSD+top 漂移、耗时 median/p90
  漂移、model/tier 分布 pp、outcome 构成、DAILY_ALARM by src、逐 golden 单 expected vs actual
  （仅本窗口可见者）+ coverage matched/missing。
- 输出 `<db目录>/var/reports/qa/qa-eval-<date>.json|.md`（`qa-eval/v1`）：JSON 含
  baseline{goldenVersion,sha256,generatedAt,builtUntil,sampleCount,cohorts}、window、current、
  drift、coverage、tickets、verdict:'observe-only'；MD 结论先行（coverage/onePass/drift 摘要）。
- `--baseline <qa-report.json>`（可选）：载入阶段1报表，校验 `qa-report/v1`，drift 用其**窗口指标**
  替代 golden 基线（golden 仍供 coverage/逐单；输出保留 baseline 来源/报表日/sha256）；坏 baseline → exit≠0
  零输出（不静默忽略）。
- **drift 红不 exit≠0**（observe-only）；仅参数/数据/IO 错 exit≠0 且零输出；同参数重跑同字节；
  原子写（tmp→rename，失败还原旧报告）。
- 只读：`node:sqlite DatabaseSync({readOnly:true})` 仅 SELECT；不写台账/单据/事件/事件词/schema、
  不接主循环、不外发。

## 5. golden 更新流程（人工）

1. QA-1 复核候选窗口/覆盖（部门/等级/类型/outcome）与脱敏。
2. 运行显式 build（升 `--version`，例 v2），生成新文件+manifest；旧版本保留。
3. 人工检查 manifest sha256/样本数/cohorts；通过后作为新 baseline 使用。
4. 代码/脚本不得自动触发 build；daemon/主循环/门禁均不读 golden（本阶段只读人工命令）。

## 6. 不做（本阶段）

不改主循环/不接门禁/不做自动判定/不写台账/不写公司 git 树/不自动生成或覆盖 golden；
不做统计显著性/回归判定；不承诺 golden 长期代表当前流程（版本+coverage 标注局限）。
