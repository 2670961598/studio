# 自研模型能力评测台（业务向）——口径、用法与边界

状态：工具 + 口径文档（2026-11-23）。制作人令：「GLM5.4 推出了，试一下；设定我们自己的模型能力评判，
对比 Kimi3.1Pro、DeepSeek4.1Flash、GLM5.4、GLM-5.3 的智能程度，我们的业务和其他人不一样，要知道哪个更合适。」
代码：`<repo>/scripts/ops/model-eval/`（零依赖，Node ≥ 24）；测试：`<repo>/scripts/test/model-eval-*.test.mjs`。

> 依据：AGENTS §五.3（证据断言——结论只认落盘产物）、§五.5（失败如实分类）、§五.6（密钥不入库、
> 仓里不落运行产物/不出现本机路径）；`docs/20-§十五`（分层门禁：本件只在 `scripts/` 下，不进 apps/packages）；
> `docs/quality/model-routing.md`（多源路由 / per-source overlay）；`docs/quality/kimi-on-dsh.md`
> （`kimi-coding` provider、token 文件、§1 的「只回复两个字：可用」PoC 探针口径）；
> `docs/quality/tier-executors.md`（high / mid / patrol 三档执行体）。本件**不新增设计面、不改生产配置**。

## 0. 结论

- 评测台 = **6 个取自本平台真实业务的题目**（t01–t06）× N 个模型 × `--reps` 次重复；每格
  **0.7 × 确定性检查分 + 0.3 × LLM 裁判分/10**，按 high / mid / patrol 三档任务加权排序，给出选型起点。
- 定位是**测量工具，不是门禁**：不写台账、不改 models.yaml、不接主循环；某模型不可用不算评测失败。
- 一条命令：`node scripts/ops/model-eval/run.mjs --judge none`（缺省全矩阵、全部任务、无裁判，约 35 次调用 = 30 格 + 5 次预探）；
  正式对比用 `--reps 3 --judge glm/GLM-5.4`。

## 1. 目的与口径

通用榜单（代码/数学/百科）量的是「考试智能」；本平台要的是**在我们的材料、我们的规程、我们的交付格式下，
哪个模型把活干对、干全、可核验**。所以题目一律满足：

1. **输入是本平台的材料形态**：任务书 + 事件尾巴 + 快照、带规程条款的值班请求、台账窗口工具的 TS 小包、
   单据 JSON、1.3 万字纪要汇编。
2. **产出是可机器判定的交付物**：`REPORT.md`、`decision.md`、`out/*.csv|json`、绿掉的测试、`answer.md`。
3. **先确定性、后裁判**：能用正则/数值/哈希/真跑测试判的绝不交给 LLM；LLM 只判「业务质量」那一层。
4. **失败分类先于打分**：调用没跑完（超时、429、5xx、401…）的格子记 0 并单列类目，不和「答错」混在一起。
5. **评测台自己的毛病不记到模型头上**：dsh 起不来、判分脚本报错 → 该格不计分（`null`），报告标 ⚠️。

## 2. 任务集

目录：`<repo>/scripts/ops/model-eval/tasks/<slug>/`，每个任务三件套：`prompt.md`（任务书）、`fixtures/`（输入，
整拷进工位）、`check.mjs`（导出 `check(ctx)` 与 `rubric`）。`*` = 附加项（可选，权重 0.5），其余为必过项。

| id | 业务场景（岗） | 输入 | 期望产物 | 必过检查 | 附加项 |
|---|---|---|---|---|---|
| t01-ticket-report | 平台日巡检闭环（patrol） | `fixtures/`：任务书、事件尾巴、健康快照、额度状态 | `REPORT.md` | accept-cmd（含可执行验收命令）report-length report-date task-id sections evidence-count facts-hit conclusion-alarm（结论须报警）plan-table fixtures-unchanged | accept-line next-steps |
| t02-bugfix | 修日闭窗口 `[since, until)` 边界缺陷（mid） | 工位即工作树：`README.md` `src/window.ts` `src/window.test.ts`（原件 2 个用例是红的）`package.json` | 改后的源码 | tests-green（判分方真跑 `node --test`）tests-unchanged（不许改测试凑绿）protected-unchanged diff-minimal（≤30 行） | fix-targeted |
| t03-research | 本周平台风险 Top3（high） | `fixtures/`：三份材料（周报 / 台账摘要 / 成本快照），出处标记 `[A]` `[B]` `[C]` | `report.md` | report-exists key-facts（92.4 / 3.1 / 12.40 / 19.80 / 17 次 / 61%）citations（≥3）top3 fixtures-unchanged | length-range advice-section no-extra-files |
| t04-triage | 值班分诊：重启 daemon 的请求该不该批（high） | `fixtures/`：请求、规程（G-01～G-08）、在途单 | `decision.md` | decision-first-line（首行 `判定：该问清`）per-item（①②③逐项）clause-citations（≥3，含 G-05）no-restart no-kill next-steps fixtures-unchanged | d120-fact risk-section |
| t05-toolchain | 滞留单统计脚本（mid） | 工位即工作树：`tickets.json` | `stats.mjs` + `out/stalled-by-lane.csv` + `out/summary.json` | csv-values summary-values（滞留 17；topModel 并列取字典序最小）script-exists input-unchanged no-deps | csv-bytes json-bytes script-reproducible no-extra-files |
| t06-longctx | 1.3 万字纪要汇编问答（high/patrol） | `fixtures/material.md`（约 30 KB、30 章；关键事实只在中部，首尾有同类干扰项），任务书内嵌同一份材料 | `answer.md` | answer-exists q1-person q1-condition q2-rootcause q2-fix q3-limit q3-handling fixtures-unchanged | citations format-lines |

### 2.1 工位与两种 fixtures 布局

每格开跑前，runner 把任务的 `fixtures/` **原样整拷到工位根**（工位 = `<outDir>/work/<模型slug>__<任务slug>__r<n>/`，
先清空再拷）。两种布局：

- **只读输入类**（t01 / t03 / t04 / t06）：输入放在 `fixtures/fixtures/…`，拷完后工位里是 `fixtures/…`（只读材料）
  + 空白根目录（模型在这里落产物）。`fixtures-unchanged` 比对工位 `fixtures/` 与原件逐文件哈希。
- **工作树类**（t02 / t05）：`fixtures/` 本身就是待改的工作树，拷完后工位根即仓库；检查用 `treeDiff`
  （对原件做行级 LCS 差异）、`protected-unchanged`、`no-deps` 等判定「只改了该改的」。

### 2.2 任务书约定（每个 prompt.md 都带）

- 「当前工作目录就是你的工位；只能读写当前工作目录，不要联网」（工作树类再加「不要新增依赖」）。
- 产物文件名、格式、必含字段写死在任务书里，检查项与之逐条对应；t06 用 `{{include:fixtures/fixtures/material.md}}` 把材料
  内嵌进任务书（`renderPromptFile` 按 `{{include:<相对任务目录的路径>}}` 展开；越界/缺文件即抛，材料不齐不发车）。
- t04 明确「不要尝试执行任何重启、杀进程类动作——你只做判定与说明」；t05 明确「做完即停」。

### 2.3 `check(ctx)` 契约与新增任务

```js
export const rubric = `- …（给裁判看的 0-10 分依据）`
export async function check({ dir, fixturesSource }) {
  // dir = 工位绝对路径；fixturesSource = 任务 fixtures/ 原件目录
  return finish([{ id: 'x', ok, detail: '…' }, { id: 'y', ok, detail: '…', required: false }])
}
```

- `finish()`：`pass` = 必过项全过；`score` = Σ(通过项权重) / Σ(全项权重)，必过项权重 1、附加项 0.5，三位小数。
- **检查不得抛异常**（缺产物按未过处理，返回 `ok:false`）；真抛了 → runner 记 `checkError`、该格不计分并告警。
- 共用工具在 `lib/check-utils.mjs`：`stripMd`（剥 markdown 强调/围栏）、`sectionOf`（按标题行 / **加粗行** / 「标签：」
  行三种起头截段，模型不用标准标题也能对上）、`normalizeText`（BOM/CRLF/行尾空白）、`cleanExecEnv`
  （跑子进程前剔 `NODE_TEST_CONTEXT` 等，防测试框架把结果洗绿）、`fixturesUnchanged`、`treeDiff`。
- 新增任务：建 `tasks/t07-xxx/{prompt.md,fixtures/,check.mjs}` → `resolveTasks` 自动发现（id = 目录名首段）；
  进档位排序需在 `lib/roles.mjs` 的 `ROLE_WEIGHTS` 给权重（缺省 1）。`--tasks` 认 id / 目录名 / 唯一前缀。

## 3. 判分构成

### 3.1 确定性检查（权重 0.7）

`check(ctx)` 的 `score ∈ [0,1]`（§2.3 公式）。判分方**不代跑**模型的脚本：t02 的 `tests-green` 是判分方在工位里
真跑 `node --test --test-reporter=tap` 并解析 TAP 汇总行（不用 `exit code`，因为 `node --test` 进程若带着
`NODE_TEST_CONTEXT` 环境变量会改变输出协议——所以先 `cleanExecEnv`）；t05 只认模型自己跑出来的产物文件。

### 3.2 LLM 裁判（权重 0.3）

- 裁判 = 固定的、**独立于被测**的模型（缺省 `glm/GLM-5.4`；`--judge none` 关闭）。逐格调用一次：输入 =
  任务书节选（≤3000 字符）+ 该任务 `rubric` + 工位产物（最多 8 个文件，每个 ≤6000 字符；只读输入类不含
  `fixtures/`，工作树类只取相对原件有变化的文件）；输出 = 一行 `{"score": 0-10 整数, "reason": "…"}`。
- 评分纪律写在 prompt 里：只评业务质量（结论正确 / 证据引自材料 / 动作可执行 / 守约束）；明显错误 ≤3，
  有缺陷可用 4–7，可直接采用 ≥8；不因文风加减分。
- 解析：只认**顶层**带数值 `score` 的 JSON 对象（可带 ``` 围栏；理由里含花括号不误伤），四舍五入并夹到 0–10；
  解析不出 → `judgeError=parse`，该格只用确定性分。
- 裁判与被测是同一模型时行上 `judgeSelf=true`（不独立，读报告时降权）；裁判预探不可用 → 全部格子只用确定性分。

### 3.3 格分 → 模型汇总 → 档位排序

- 格分 `cellScore` = `0.7 × det + 0.3 × judge/10`（裁判关闭/缺席 = `det`）。调用失败格 = `0`（进平均）。
  评测台故障 / 判分异常 / 跳过 = `null`（不进平均）。
- 模型 × 任务均分 → 档位加权（`ROLE_WEIGHTS`，权重即「这个岗多常用这类活」）：

  | 档 | t01 | t02 | t03 | t04 | t05 | t06 | 额外项 |
  |---|---|---|---|---|---|---|---|
  | mid（主力 worker） | 1 | 2 | 1 | 1 | 2 | 1 | — |
  | high（verifier / 决策） | 1 | 1 | 2 | 2 | 1 | 2 | — |
  | patrol（巡检岗，成本敏感） | 2 | 0.5 | 1 | 1 | 1.5 | 1.5 | 扣 `0.05 × 该模型总 tokens / 矩阵内最大 tokens` |

- 可进推荐（`eligible`）的条件：预探可用 **且** 覆盖 ≥60% 的任务（`--tasks` 子集运行时覆盖按子集算，报告会注明
  「本次只跑 N 个任务」）。不满足者列末位并写明「不可用（类目: 原因）」或「覆盖不足（n/m）」。
- 排序：可推荐者在前 → 分数降序 → 均时延升序 → 模型名。每个条目带强项（≥0.85）/ 弱项（<0.6）任务。

### 3.4 失败与「评测台问题」的中性处理

| 情形 | 行状态 | 格分 | 进汇总的方式 |
|---|---|---|---|
| 调用成功、检查有未过项 | completed | 0.7·det(+0.3·judge) | 正常 |
| 调用失败（超时 / quota / server / auth / …） | failed | 0 | 计 0 进 `byTask`；未过项、时延、裁判不统计；`failures` 计数 |
| 预探不可用且缺省跳过 | skipped | null | `cellsSkipped`；该模型不可推荐 |
| 预探不可用 + `--no-skip-unavailable` | failed | 0 | 同「调用失败」 |
| 评测台故障（`errorClass=harness`：dsh 起不来、写 profile 被拒、依赖缺失） | skipped / failed | **null** | `cellsBroken`；报告标 ⚠️；全部模型预探皆 harness → exit 3 |
| 判分脚本抛异常（`checkError`） | completed | **null** | `cellsBroken`；报告标 ⚠️；告警列出 |

## 4. 模型矩阵

`--models` 缺省（按序）：

| # | 引用（provider/model） | 身份 | 凭据来源 | 预期可用性处理 |
|---|---|---|---|---|
| 1 | `glm/GLM-5.4` | 新旗舰（制作人点名） | dsh profile `headless` 既有路由 | 正常 |
| 2 | `glm/GLM-5.3-Flash` | 轻量档（patrol 候选，0 边际成本口径见 tier-executors） | 同上 | 正常 |
| 3 | `glm/GLM-5.3` | 上一代基线（制作人点名） | 同上 | 曾见 529 → `server`，缺省跳过并记原因 |
| 4 | `kimi-coding/k3.1-pro` | Kimi 3.1 Pro（制作人点名） | 宿主 token 文件 → 仅注入 kimi 子进程 env `KIMI_API_KEY` | 文件缺失/过期 → `auth`（不调 dsh）；401 → `auth` |
| 5 | `opencode-go/deepseek-v4.1-flash` | DeepSeek 4.1 Flash（制作人点名） | dsh profile 既有路由 | 额度耗尽 → 429 → `quota`，缺省跳过并记原因 |

引用形态固定 `provider/model`（字符集 `[A-Za-z0-9._-]`，防 overlay 注入）；slug = `provider__model`，用于文件名。
矩阵可随意增删；换裁判不换被测即可复跑同一批产物思路（裁判逐格读的是工位产物）。

## 5. 不可用处理 / 调用方式 / 隔离边界

### 5.1 调用方式

- 每格 = 一次 `dsh` 子进程：
  `dsh --profile headless --patch <outDir>/overlays/<slug>.yml --permission-mode workspace-write --json -- <任务书全文>`
  （任务书全文作为 `--` 之后的**单个 argv** 传入：不经 shell 解释、不落临时文件；`--permission-mode workspace-write` 是 dsh 的工具权限模式）。
- overlay 是 runner 生成的 YAML 数组补丁，**只覆盖 `agent-default-model` 的 provider/model**，不动宿主 profile：
  ```yaml
  - id: agent-default-model
    config:
      provider: glm
      model: GLM-5.4
  ```
- 子进程 env：继承宿主，但剔掉父会话身份（`DSH_PROFILE` `DSH_PROFILE_DIR` `DSH_SESSION_ID` `DSH_SHELL`，保留 `DSH_HOME`）
  与一切 `DEEPSEEK_*`；`KIMI_API_KEY` **先删后加**——仅当被测 provider 是 `kimi-coding` 且 token 文件可读时注入。
- Kimi token 文件：`STUDIO_KIMI_TOKEN_FILE` 可覆盖；缺省宿主 home 下
  `Library/Application Support/StudioNext/secrets/kimi-access-token`（纯文本一行或含 `access_token` 的 JSON）。
  文件写入超过 15 分钟 → 报告告警（token 有效期短，过期即 `auth`）。**评测台不刷新 token**（刷新归
  `scripts/ops/kimi-token-refresh.mjs`，见 kimi-on-dsh §3）。
- 顺序执行（不并发）：先逐模型**可用性预探**（1 次最小调用「只回复两个字：可用」，超时 `--probe-timeout-ms`），
  再按 模型 × 任务 × rep 顺序跑；裁判在全部被测格子跑完后统一预探并逐格打分。

### 5.2 可用性预探与失败类目

- 预探失败 → 缺省 `--skip-unavailable`：该模型其余格子标 `skipped`（不花额度），报告 §1 写明类目与原因。
- 成功判据 `ok` ⇔ 事件流里 `turn_end.reason.kind === 'completed'` **且** exit 0 **且** 无顶层 `error` 事件。
- 类目（`lib/errors.mjs`，对齐 `apps/daemon/src/engine/routing/router.ts` 的 FailureClass）：
  `quota`（429 / usage limit / 额度）、`rate_limit`、`server`（5xx / 529）、`timeout`（408 / 超时 / TimeoutError）、
  `network`（ECONN* / ENOTFOUND…）、`auth`（401 / 403 / 凭据类 code）、`parse`、`bad_request`（其余 4xx）、
  `refusal`、`blocked`、`aborted`（无 turn_end / 被信号杀死）、`max_tokens`，另加评测台自身的 `harness`，
  其余落 `unknown`（宁可标「不明」不冒认）。分类次序：spawn 失败 / 超时 → **stderr 或 error 事件带评测台指纹
  （`.dsh` / `profiles/` / `cordis` 附近的 EPERM/EACCES、ENOENT、Cannot find module、unknown option）→ harness**
  → 顶层 error → turn_end 失败原因 → 信号。

### 5.3 隔离边界

| 面 | 做法 |
|---|---|
| 工位 | 只在 `<outDir>/work/` 下，每格先 `rmSync` 再整拷 fixtures；realpath 后再传给 dsh |
| outDir | `assertSafeOutDir`：拒文件系统根、home 或其上级、**仓内**、非目录、git 工作树根；缺省 `/tmp/model-eval/<时间戳>` |
| overlay / 证据 | `<outDir>/overlays/*.yml`；`<outDir>/logs/<模型slug>__<标签>.ndjson`（事件流）与 `.stderr.log`（仅有内容时）；预探不占 logs |
| AGENTS.md 污染 | 工位祖先目录若有 `AGENTS.md`，dsh 会注入被测模型上下文 → 报告告警（outDir 别放在仓内/公司目录下的原因之一） |
| 被测模型的工具面 | profile `headless` 的 `bash-sandbox` 补丁是 `danger-full-access`（2026-11-01 轨 7 装备令：bash 内层沙箱关闭，隔离责任归外层工位）。评测台**不再套外层 seatbelt**：模型若无视任务书约束，bash 可触及运行评测的用户能触及的一切；只有事后检查（`fixtures-unchanged` / `treeDiff`）。见 §8.4 |
| 不碰的面 | 不写台账 / 公司目录 / 平台配置；不改宿主 dsh profile；不提交、不部署 |

## 6. 运行命令

```sh
# 缺省：全矩阵 × 全部任务 × 1 次，裁判 glm/GLM-5.4，产物 /tmp/model-eval/<时间戳>/
node <repo>/scripts/ops/model-eval/run.mjs

# 快速冒烟（无裁判、3 个任务、2 个模型）
node <repo>/scripts/ops/model-eval/run.mjs --models glm/GLM-5.4,glm/GLM-5.3-Flash --tasks t01,t02,t04 --reps 1 \
  --judge none --out <outDir>

# 正式对比：重复 3 次、带裁判、带价目表
node <repo>/scripts/ops/model-eval/run.mjs --reps 3 --judge glm/GLM-5.4 --prices <prices.json> --out <outDir>
```

| 选项 | 说明 |
|---|---|
| `--models a/b,c/d` | 被测模型（provider/model，逗号分隔；缺省 §4 全矩阵） |
| `--tasks t01,t04-triage,…` | 任务 id / 目录名 / 唯一前缀（缺省全部；未知 → exit 2） |
| `--reps <n>` | 每（模型, 任务）重复次数（缺省 1；<3 时报告告警「单次抽样」） |
| `--out <dir>` | 产物目录（缺省 `/tmp/model-eval/<时间戳>`；仓内 / home / git 根一律拒绝 → exit 1） |
| `--timeout-ms` / `--probe-timeout-ms` | 单次任务 / 预探调用超时（缺省 300000 / 90000；到点杀整个进程组） |
| `--judge x/y \| none` | 裁判（缺省 `glm/GLM-5.4`；`none` 关闭） |
| `--skip-unavailable` / `--no-skip-unavailable` | 预探失败是否跳过该模型（缺省跳过） |
| `--dsh <path>` | dsh 可执行文件（缺省取代码常量 `DEFAULT_DSH_BIN`＝Homebrew Apple Silicon 的缺省安装位；不存在则退到 `PATH` 里的 `dsh`；都没有 → exit 3） |
| `--prices <json>` | 可选价目表：`{"provider/model": {"input": 1, "output": 2, "cacheRead": 0.1, "cacheWrite": 1, "per": 1000000}}`（USD；`per` 缺省 1e6） |
| `-q` / `--help` | 只打印最终 JSON 行 / 用法 |

- 产物：`<outDir>/report.md`（人读，六段：可用性预探 / 结果矩阵 / 逐模型汇总 / 逐任务明细 / 业务适配建议 / 警告与局限）、
  `report.json`（机器读，schema `model-eval/v1`，含每格的 `outputPath` 与证据路径）、`work/` `logs/` `overlays/`。
- 退出码：`0` 报告已写出（模型不可用**不算**失败）；`2` 用法错（含未知任务、非法模型引用）；`3` 评测台自身不可用
  （找不到 dsh，或全部模型预探皆 harness；此时报告仍写出）；`1` 内部错。
- 结束时 stdout 打一行 `{"report","json","cells","completed","passed"}`，便于上游脚本接。

## 7. 结果解读

- **矩阵格**：`✅`/`❌` = 调用成功（全过 / 有未过项），后接 `通过数/运行数 · 确定性分 · 判分 · 均时延 · 均 tokens`；
  `💥` = 调用失败（类目: 原因）；`⏭ 跳过` = 预探不可用；`⚠️` = 评测台故障或判分异常（**不计入模型**）。
- **§3 逐模型汇总**的「平均确定性分」把失败格按 0 计入；「未过检查」只统计成功调用的格子（失败格的空工位没有意义）。
- **§5 业务适配建议**按三档各给一个排序；只看「可推荐」的条目，`（不推荐）` 后面写了原因。子集运行时该段首行注明
  「本次只跑 N 个任务」，排序只代表这些任务上的表现。
- 读法建议：先看 §1 有没有该模型（不可用的原因是否可修复：`quota` → 充值/换源；`auth` → 刷新 token；
  `server` → 稍后重跑），再看 §5 的档位排序与强弱项，最后到 `work/<格>` 抽看产物与 `logs/*.ndjson` 复核。
- `report.md` 不含宿主绝对路径（产物目录写作「本报告所在目录」）；`report.json` 的 `outDir` / `outputPath` 是机器本地的
  绝对路径，**不要把 report.json 贴进仓内文档**。

## 8. 局限

1. **样本小**：6 题 × 1–3 次；LLM 输出方差大，单次 `--reps 1` 的排名差异不足以下结论，正式对比至少 `--reps 3`
   并看逐任务明细。题目是「我们业务的几个切面」，不是全覆盖；换业务线应补题而不是改权重。
2. **裁判有偏**：裁判也是 LLM，可能偏爱某家的文风/结构；同厂模型互评（judgeSelf）尤其要降权。确定性权重给到 0.7
   就是为了压这个风险，但 30% 的主观分仍在。
3. **价格是估算**：不给 `--prices` 就没有成本列；给了也只按 tokens × 单价算，不含平台加价/缓存折扣差异。
   tokens 口径取自 dsh 事件流 `step_end.usage`，各 provider 上报口径可能不同。
4. **被测模型的内层 bash 无沙箱**：profile `headless` 的 bash 内层沙箱是关的（§5.3），评测台也没再套外层 seatbelt，
   模型若无视任务书约束可能读写工位之外的文件、甚至联网。评测台只能事后检查工位内变化；请在专用账号 / 可随时还原的
   机器上跑，不要在有敏感目录的日常工位上跑。
5. **判分是近似的**：正则/关键词类检查（如 `facts-hit`、`clause-citations`）可能漏判改写过的正确答案或误判巧合命中；
   新题上线前先用「标准答案 / 错答样本」双向校准（见 §10）。
6. **长上下文题只考「找得到」**：t06 的事实是离散点，不考综合推理；真正的长材料任务（整库审计）没有覆盖。
7. **时延含 dsh 启动开销**：单次调用的 wall time 里进程启动占固定成本，对短任务（t05）的时延比较影响大。

## 9. 安全边界

- **凭据**：不读、不打印任何 API key；Kimi access token 只在内存里从文件读出、只写进 `kimi-coding` 被测子进程的 env。
  一切错误文本、裁判理由、`checkError` 进报告前过 `redact()`（显式秘密 + 形态兜底：JWT / `sk-`、`ghp_` 类 token / `Bearer …` / `32 位hex.后缀` 密钥 /
  48 位以上大小写数字混合长串），测试断言报告全文不含 token。
- **不落仓**：产物只去 outDir（仓内/home/根/git 根拒绝）；仓内文档只出现 `<repo>` `<outDir>` 占位。
- **不改宿主**：dsh profile 不动（只经 `--patch` 临时覆盖路由）；不写 `~/.dsh`；不刷新 token；不装依赖。
- **不外发**：评测台自身不联网（联网的只有 dsh → 模型 provider）；任务书明令被测模型不联网，但无技术拦截（§8.4）。
- **注入面收紧**：模型引用字符集白名单；任务书全文经 `--` 之后的单个 argv 传入（不经 shell）；overlay 文件名用 slug。
- **可审计**：每格的事件流 NDJSON 与 stderr 留档在 `logs/`，任何结论都能回溯到原始输出。

## 10. 测试

```sh
node --test <repo>/scripts/test/model-eval-*.test.mjs     # 三个文件，零 dsh、零联网、零真实凭据
node <repo>/scripts/scan-repo-secrets.mjs                 # 不得新增命中
node <repo>/scripts/guards/boundaries.mjs                 # 本件只在 scripts/ 下，应 PASS
```

| 文件 | 覆盖 |
|---|---|
| `model-eval-checks.test.mjs` | 六任务目录契约；`resolveTasks`；每个任务的「合格样本全过 / 缺产物不抛 / 错答对应项判负」；t02 真跑测试（红→绿、改测试凑绿判负、`NODE_TEST_CONTEXT` 下不得洗绿）；t05 期望值口径与浮点；t06 材料形态与答案解析；`sectionOf` |
| `model-eval-runner.test.mjs` | 纯函数：`parseArgs`（缺省/覆盖/用法错表）、`parseModelRef`/`renderOverlay`/`dshArgs`、`buildChildEnv`（剔除集与 KIMI 注入条件）、`readKimiToken`/`kimiTokenFile`/`resolveDshBin`、`execDsh` 契约（用 node 自身冒烟：正常 / ENOENT / 超时杀进程组）、NDJSON 解析与 usage 累加、`classifyFailure`/`detectHarness`/`classifyRun`（harness 优先）、`redact`、`cellScore`、`summarizeModels`/`rankRoles`（合成 6 任务报告：加权 / 覆盖不足与不可用不进推荐 / patrol 成本扣分 / 同分次序）、`renderMarkdown`、`buildJudgePrompt`/`parseJudgeAnswer`、`assertSafeOutDir`、`findAgentsMd`/`collectArtifacts`/`readPriceTable` |
| `model-eval-evaluate.test.mjs` | `runEval` 注入假 exec 的编排：主流程（预探失败跳过、逐格跑判、证据落盘、凭据只进 kimi 子进程且不进报告）、裁判路径（逐格打分 / parse 失败 / 裁判用量 / 同模型只预探一次）、judgeSelf 与价目表、裁判不可用、评测台故障（全 harness → `benchBroken`；`--no-skip-unavailable` 逐格 failed 不计分）、超时、kimi 无 token 不调 dsh、token 过期与 AGENTS.md 告警、判分脚本抛异常不计分；**CLI 端到端**（假 dsh 脚本走完 `main()`：exit 0 / 3 / 2 / 1 与 report 落盘） |

共享样本：`<repo>/scripts/test/fixtures/model-eval/samples.mjs`（t04 合格判定、t06 合格答案）。

## 11. 不做的事

- 不做通用能力榜（代码/数学/推理基准）；不接外部 benchmark 数据集。
- 不做自动选型落地：评测结果不改 `models.yaml` / 路由表，选型由人按报告决策。
- 不做并发压测与吞吐对比；时延列只作参考。
- 不替代 kimi-on-dsh 的启用步骤与 token 刷新器；Kimi 在本评测里不可用时按 §5.2 记录，不在此修。
