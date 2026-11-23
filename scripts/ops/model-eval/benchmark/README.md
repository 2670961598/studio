# model-eval/benchmark —— 业务向基准的分析层

评测台（上一级目录的 `run.mjs`，口径见 `docs/quality/model-eval.md`）负责**跑**；本目录负责**算与管**（指纹、多批次合并、失败分类、区间、配对比较、盲评），规范见 `docs/quality/benchmark-business-eval.md`。
本目录**只读复用**评测台的 `lib/`，不改动评测台任何文件。

| 文件 | 作用 | 典型用法（`<repo>` = 仓库根，`<outDir>` = 仓外产物目录） |
|---|---|---|
| `fingerprint.mjs` | 控制变量指纹（harness / 任务书渲染后字节 / fixtures / 全树）与环境事实 | `node <repo>/scripts/ops/model-eval/benchmark/fingerprint.mjs --out <outDir>/fingerprint.json` |
| `stats.mjs` | 多批次合并、失败分类、覆盖、区间、配对比较、结论闸 → `stats.json` + `stats.md` | `node <repo>/scripts/ops/model-eval/benchmark/stats.mjs --reports <outDir>/run1,<outDir>/run2 --out <outDir>/stats --fingerprint <outDir>/fingerprint.json` |
| `blind.mjs` | 盲评包生成（匿名 + 定种子洗牌）与评分汇总（跨评审均值 + 一致性） | `… blind.mjs build --reports <outDir>/run1 --out <outDir>/blind`；`… blind.mjs aggregate --package <outDir>/blind --scores 甲.csv,乙.csv --reviewers "甲,乙"` |
| `rubric.md` | 人工盲评 rubric（四维 × 0–3 分 + 任务族侧重点 + 流程 + 一致性门槛） | 随盲评包一起分发（`build` 会拷贝） |
| `report-template.md` | 对比报告模板（自动节贴脚本产物，人工节署名） | 复制到 `<outDir>/` 后逐节填写 |
| `lib/` | 纯函数模块（分类 / 合并 / 区间 / 统计矩阵 / 渲染 / 指纹 / 盲评核心 / IO） | 由上面的 CLI 调用；单测在 `scripts/test/model-eval-benchmark.test.mjs` |

## 一次正式对比的顺序

1. **跑前留指纹**：`fingerprint.mjs --out <outDir>/fingerprint.json --env`（记下 harness、任务书、fixtures 的哈希）。
2. **跑评测台**：`node <repo>/scripts/ops/model-eval/run.mjs --models <a,b> --reps 3 --out <outDir>/run1`（正式对比带裁判与价目表，见 `docs/quality/model-eval.md` §6）。
3. **补跑设施侧缺格**：`stats.mjs --reports <outDir>/run1` 先看缺格类目；只对 `PROVIDER_ERROR:*` / `LIMIT:timeout` / `HARNESS_BUG` 的任务重跑一批（`--tasks <…>`），输出到 `<outDir>/run2`。同一格的样本**先到先得**，重跑不会覆盖已有有效样本，也不存在「挑最好的一次」。
4. **合并统计**：`stats.mjs --reports <outDir>/run1,<outDir>/run2 --out <outDir>/stats --fingerprint <outDir>/fingerprint.json`。
5. **盲评**：`blind.mjs build --reports … --out <outDir>/blind` → ≥2 人独立打分 → `blind.mjs aggregate`。
6. **折分**：`stats.mjs … --blind <outDir>/blind/result/blind-result.json`（0.7 × 确定性 + 0.3 × 盲评/12）。
7. **出报告**：按 `report-template.md` 填写；自动节贴 `stats.md` / `blind-result.md`，人工节署名。

## 约定

- **输出必须在仓外**：复用评测台的 `assertSafeOutDir`（拒绝仓内、家目录、git 根）；本目录任何脚本都不写仓、不写家目录。
- **不改分**：确定性分来自评测台 `report.json`；本目录只在折分时按固定权重合入主观分，并照录折分模式。
- **可复现**：盲评包同种子同顺序；统计产物只依赖输入报告与协议常量，不含时间戳以外的随机量。
- **不带本机信息**：产物里的绝对路径只存在于仓外的 `report.json`；进仓文档一律用 `<repo>` / `<outDir>` 占位。
- 退出码：`0` 已写出；`2` 用法错（含输出目录不安全、盲评包目录非空）；`1` 内部错（打印调用栈）。

## 测试

```bash
node --test scripts/test/model-eval-benchmark.test.mjs     # 本目录：零联网、零凭据、不起 dsh
node --test scripts/test/model-eval-*.test.mjs            # 连评测台一起跑
node scripts/guards/boundaries.mjs                        # 边界门禁
```
