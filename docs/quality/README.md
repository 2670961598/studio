# QA 只读指标报表（#811 阶段 1；observe-only）

> 设计面依据：`docs/17-§3`（台账=可重建投影事实源）与 `docs/02-F2`（数据/状态）；
> 制作人 2026-11-11 令「继续推进所有 V2 承诺都实现」；P0 教训（台账 §八十六）=
> 评测/门禁类必须 **observe-only、可回滚、不得阻断既有流程**。本目录只放报表口径文档，
> 不新增设计面、不做 golden/门禁（golden 归 QA-1 后续阶段，落 docs/quality）。

## 1. 命令

```sh
studio-next qa-report --db <ledger.sqlite> --company <slug> [--date YYYY-MM-DD] \
  [--out-dir <目录>] [--log <daemon.log>] [--models <models.yaml>] [--top N]
```

- `--date` 缺省=昨天（本地时区）；坏日期/缺参/未知旗标 exit 1；读库/日志/输出错误 exit 2。
- `--out-dir` 缺省 `<db 所在目录>/var/reports/qa/`（= `<companyDir>/var/reports/qa`；**不写公司
  git 树**——尊重「公司目录唯一写入者=daemon」）；输出 `qa-report-<date>.json|.md`，原子写
  tmp→rename，同参数重跑**同字节**；失败零输出。
- `--models` 给出时按 models.yaml 三档映射 high/mid/low；缺省 tier 显示 `-`（不猜）。
- `--log` 给出时附日志 tail 摘要（见 §4）；缺省 JSON `log: null`。

## 2. 只读保证（observe-only）

- 只读开库：`node:sqlite` `DatabaseSync({ readOnly: true })`，仅 SELECT；**不使用 openLedger**
  （其 migrate/链锚定会写库）。
- 不写台账/不改单据状态/不落事件/不新增事件词/不改 schema/不接主循环/不做门禁判定或阻断。
- 报表是外部可重建产物（不 `insertReport` 进台账 reports 表），删除/重跑无副作用。
- 测试断言：生成前后 DB 文件 sha256 与 mtime 不变；重跑 JSON+MD 同字节。

## 3. 指标定义（date=本地自然日 `[00:00, 24:00)`，epoch ms 闭开区间）

| 指标 | 定义/口径 | 数据源 |
| --- | --- | --- |
| `counts.gatePass/gateFail/stall/jobStale/escalate/close/...` | 窗口内 events 按 event 名计数；事件枚举无 `STALE`，故 **`stall`（STALL）与 `jobStale`（JOB_STALE）分列** | events |
| `dailyAlarmsBySrc` | DAILY_ALARM 按 note `src=` 归一分组计数 | events |
| `failures.total/top` | GATE_FAIL 计数 + 原因 top-N（默认 10）：优先 note `category=…`，否则 note 首段（去 `src=`）截 80 字；稳定排序（count desc, reason asc） | events |
| `models.rows` | 窗口内 work_records（started_at）按 model 计数 + usage_daily(date) 四桶汇总；`--models` 时带 tier | work_records + usage_daily |
| `models.tierCounts` | 按 tier 汇 work_records（未给 --models=全 0，tier=null） | work_records |
| `durations` | 窗口内 work_records 按 issue：`max(ended_at)-min(started_at)`；median/p90（nearest-rank，整数 ms）；inFlight=有 ended_at=NULL 的单；attempts=记录数 | work_records |
| `ticketCount` | 公司 ticket_mirror ∪ 窗口事件 issue 去重数（work_records 按此单集过滤——work_records 无 company 列，此为公司归属代理口径） | ticket_mirror + events |
| `log`（可选） | 见 §4 | daemon 日志 tail |

## 4. noop / loop-lag 摘要（phase1 限制）

- 二者**不在台账**（noop 仅 serve 日志；`[loop-lag]` 仅 serve stdout），且日志行无逐行时间戳 →
  **无法按 date 做历史回溯**。`--log` 给定时只汇总「生成时刻的日志 tail」（上限 4MB）：
  `{ asOf: 文件 mtime ISO, window: 'tail', linesScanned, loopLag:{count,maxMs,medianMs,maxSeq}, noop:{aggregateLines,decisionLines,decisions} }`。
- JSON 明确 `window:"tail"`/`asOf`，**不参与日期对比**；无 `--log` 则 `null`。
- 若需按日严格口径，需先给日志加时间戳/落结构化观测（phase2 单独立项）。

## 5. 产物形状

- JSON：`{ schema:'qa-report/v1', reportDate, company, window:{since,until}, metrics:{...}, log, observeOnly:true }`
  ——键序/数组排序/数值取整固定，无 wall-clock 字段（幂等）；schema bump 走版本键。
- Markdown：事件计数/失败 top-N/模型分布/单耗时/日志摘要五段，面向人工阅读与归档。
- 失败：stderr 一行 `qa-report 失败：<原因>`，exit≠0，零输出（tmp 清理）。

## 6. 不做什么（本阶段）

- 不做 golden 基线/断言/门禁/自动阻断（后续阶段，且须保持 observe-only 可回滚）。
- 不查/不校验 events 哈希链（需要写模式打开；审计另有 `ledger` 命令面）。
- 不写公司 git 树、不改宿主 config、不引外网。

## 7. 阶段2：golden 评测（`qa-eval`，observe-only）

- golden 数据（不入仓）：`<companyDir>/var/qa/golden/golden-v<n>.json` + `manifest.json`（sha256/
  版本/样本量）；显式构建入口=`studio-next qa-eval --build-golden <目录> --db … --company …`
  （QA-1 人工审后运行；已存在即拒、不自动覆盖）。
- 评测：`studio-next qa-eval --db … --company … --date YYYY-MM-DD [--golden-dir …] [--out-dir …] [--baseline qa-report.json]`
  → `qa-eval/v1` JSON+MD（结论先行；baseline 版本+sha256+样本量；onePass/失败原因 JSD/top 漂移/
  耗时 median+p90 漂移/tier 分布 pp/outcome/coverage）。`--baseline` 可载入阶段1 qa-report JSON，以其窗口
  指标替代 golden 基线做 drift（golden 仍供 coverage/逐单）；drift 只观测，**不阻断、不 exit≠0**。
- 只读/边界与阶段1同：node:sqlite readOnly 仅 SELECT、不写台账/单据/事件/事件词/schema、不接主循环。
- schema/选取规则/人工审流程：`docs/quality/golden.md`。
