# 虚拟工作室总体方案 v1.0（宪章）

> 园区：/Volumes/BigDisk/Studio ｜ 板面：YouTrack localhost:8080 ｜ 制作人：opengames
> 本文档是全工作室的唯一事实源。修改本文档需开"内部改进"单并经制作人批准。

## 0. 架构现实与总原则

**实测约束**（2026-09-15 验证）：子 agent 无 Agent 工具（嵌套派工不成立）；`claude -p` CLI 认证 403（子进程会话不成立）。
**2026-09-16 修订**：`claude -p` 经 GLM 兼容端点已验证可用（架构v2）——执行层切换为独立 claude 进程（`~/bin/studio-worker` 派发，REPORT 落盘交付），"子进程会话不成立"作废；详见 kernel/intel/claude-code-worker.md。
**解法**：cron 触发的会话拥有完整工具（含 spawn 权，现行 PM tick 已实证）→ **每个子 PM = 一个独立定时任务会话**，项目间天然异步并行，无需主 PM 调度器。

三铁律：
1. **状态外置**——一切进行态都在 YouTrack/文件里，任何会话崩溃后下个 tick 无损接手；
2. **机器断言**——"完成"只认 run-gate 落盘证据，不认任何 agent 自述；
3. **两级承包**——功能活一单一命；更大需求拆单上板（Epic→子单 DAG），不搞 agent 套 agent。

---

## 1. 组织与编制

| 角色 | YouTrack 账号 | 形态 | 职责 | 手册（kernel/skills/） |
|---|---|---|---|---|
| 制作人 | opengames | 人 | 只管不可逆动作与预算（批示协议见 §2.6） | — |
| 子PM·POLY | agent-pm | **cron 每10分钟** | POLY 项目全生命周期：拆 Epic、派工、收工核验、推状态机、记账 | sub-pm.md |
| 子PM·WEBx | agent-pm | **cron 每10分钟（错峰）** | 同构，项目实例 | sub-pm.md + 项目插件 |
| 全局QA | agent-qa | **cron 每10分钟（错峰）** | 独立验收线：认领一切"待测试"单，新上下文复测 | qa-gate.md |
| 程序 worker | agent-dev | **独立 claude 进程**（studio-worker 派发，一单一命） | 按 Type=核心/业务 单实现+自测+REPORT 落盘 | worker-common.md |
| 策划 worker | agent-designer | **独立 claude 进程** | Type=策划：产出设计文档（DoD=含表路径+验收公式） | worker-common.md + 设计规范 |
| 美术 worker | agent-artist | **独立 claude 进程** | Type=美术：产出资源（DoD=过命名/引用/导入检查） | worker-common.md + 资产规范 |
| Inspector | agent-inspector | cron 每日 09:00 | 全项目代码体检→技术债单（草稿态，≤3/日，带量化证据） | inspector.md |
| Scout | agent-scout | cron 每日 10:00 | 外部情报→情报单（草稿态，≤5/日，带链接+置信度） | scout.md |
| 版本日官 | agent-pm | cron 每周五 18:00 | 冻结/回归/tag/release notes/retro/编制与预算建议（财务+人事帽） | version-day.md |
| 日报官 | agent-pm | cron 每日 09:30 | 一屏日报（薄） | digest.md |
| 看门狗 | 无 | launchd 每1分钟 | 非LLM：心跳/日志/分叉/预算四查，只告警不行动 | watchdog.sh |

原则：**主 PM 岗位取消**。全局事务（验收线、体检、情报、报表、看门狗）都是薄的全局 cron；项目事务全部归各子 PM。财务/人事在版本日官身上，单量起来前不设独立编制。

---

## 2. YouTrack 全面设置

### 2.1 账号权限矩阵

| 账号 | 建单 | 改状态 | 关单 | 批准类操作 |
|---|---|---|---|---|
| opengames | ✅ | ✅ | ✅ | ✅（唯一批准源） |
| agent-pm | ✅（拆单/改进单/情报转正除外） | ✅ 全状态 | ✅（仅闸门断言全绿后） | ❌ |
| agent-qa | 仅 QA 退回时自动开单 | 仅 待测试↔测试中→待合并/退回 | ❌ | ❌ |
| agent-dev/designer/artist | ❌ | ❌（只能评论+心跳字段） | ❌ | ❌ |
| agent-inspector/scout | 仅草稿态 | 仅草稿↔新单（promote 由制作人文案触发） | ❌ | ❌ |

执行层：token 分文件存放（pm/qa/worker 各自的 token 文件 600 权限，worker 会话注入环境变量而非可读配置文件）；admin token 仅本机交互使用，任何 cron 提示词不引用。

### 2.2 分轨状态机（Type 决定闸门内容，轨道决定流程形状与介入次数）

**状态全集（16 通用 + 7 专用）**：草稿、新单、排期待审、**方案待审**、已排期、开发中、待测试、测试中、**代码待审**、待合并、已批准、合并中、合并验证、**待终验收**、已关闭、已取消；专用态：情报流（研究中、报告待审、已归档）、事故流（触发、止血中、待复盘、复盘中）。

**轨道 A · 特护轨（全程跟）**——核心架构/数据迁移/存档格式/依赖升级/发版/安全/跨仓：
新单→排期待审 →`approve-plan`→ **方案待审** →`approve-design`→ 已排期→开发中→待测试→测试中→**代码待审** →`approve-merge`→ 已批准→合并中→合并验证→**待终验收** →`accept`→ 已关闭。
制作人 4~5 触点；且 A 轨单**每次状态迁移自动贴进展摘要**（"全程跟"由 PM 主动汇报实现，无需你轮询）。

**轨道 B · 常规轨（首尾跟）**——常规功能/缺陷：
新单→排期待审 →`approve-plan`→ 已排期→开发中→待测试→测试中→待合并 →`approve-merge`（即终验收）→ 已批准→合并中→合并验证→已关闭。2 触点。

**轨道 C · 轻轨（免审）**——纯文档/注释/测试补充/格式化/无逻辑资源导入：
新单→已排期（自动）→开发中→待测试→测试中→已批准（QA 过即自动）→合并中→合并验证→已关闭。0 触点（日报可见、随时 kill）；**永不自动 push**，C 轨提交累积到版本日一次性批量授权。

**专用流（Type 决定，不走通用轨形状）**：
- 策划单：随所在轨道走，但闸门换**文档门**（DoD 清单核验+格式检查），QA=可消费性评审；
- 美术单：随 B/C 轨走，闸门换**资产门**（命名/引用/导入脚本校验）；
- 情报单：草稿→`promote`→新单→研究中→报告待审→已归档（入情报库，1 触点）；
- 事故单：触发→止血中→待复盘→复盘中→已关闭（关闭前置=关联复盘单，1 触点）。

各状态的本地对应物（lane 锁/`feature/<单号>` 分支/心跳字段/evidence/attempt 计数）与 §5 十二步剧本不变，只是**每轨取状态全集的一个子集**。

红线：`yt next-state` 按（轨道×Type）查迁移矩阵强制校验，LLM 无权跳态或串轨；attempt≥3 一律退"排期待审"并 @制作人。

**定轨规则**：建单时按触碰范围自动提案（动核心/数据/依赖/跨仓→A；常规代码→B；纯文本→C），制作人评论 `track A|B|C` 可改轨；**升轨即时生效，降轨需确认**；QA 复测发现实际改动超轨（如 C 单动了逻辑）→ 自动升轨+通知。

### 2.3 Type 枚举与 DoD

`核心`（架构/共享代码）、`业务`（玩法/功能）、`策划`（设计文档）、`美术`（资源）、`情报`（Scout，草稿起）、`技术债`（Inspector，草稿起）、`内部改进`（工作室自身）、`缺陷`、`事故`（互联网项目用）。
原 T0/T1/T2 分级已由 §2.2 的轨道制取代：**Type 决定闸门内容，轨道(A/B/C) 决定流程形状与介入次数**，两轴独立。

### 2.4 字段模板（每个项目统一，onboarding 脚本自动建）

State（状态全集 §2.2）、Type、**轨道(A/B/C)**、泳道、心跳(timestamp)、attempt(int)、目标分支、**验收命令(冻结，创建后禁改)**、**期望输出哈希(冻结)**、置信度、来源(链接)、Fix versions(里程碑)、depends-on(单链)、单件成本(float，关单时结算)。

### 2.5 项目与板

- 每项目一个 YouTrack project，**短名 = 园区目录名 = PID**（POLY、WEB1…）。
- 板：①流程看板（按 13 态列）②里程碑板（按 Fix version 聚合退出标准）③QA 板（只看待测试/测试中）④草稿池板（情报+债）。
- STUDIO 总控项目：跨项目的情报归档、内部改进单、retro 报告挂这里。

### 2.6 指挥协议（制作人只在 YouTrack 评论里下指令）

| 指令 | 作用于 | 效果 |
|---|---|---|
| `approve-plan` | 排期待审 | →已排期（C 轨免） |
| `approve-design` | 方案待审（A 轨） | →已排期 |
| `approve-merge` | 待合并(B)/代码待审(A) | →已批准 |
| `accept` | 待终验收（A 轨） | →已关闭 |
| `approve-push` | 待合并/合并验证 | 关单时一并 push+tag |
| `approve-push-batch` | 版本日 | C 轨累积提交一次性批量推送 |
| `track A\|B\|C` | 任意非终态 | 改轨（升轨即时生效，降轨需确认） |
| `reject <理由>` | 排期待审/待合并 | →已取消或退回改需求 |
| `promote` | 草稿 | →新单（进排期审） |
| `kill` | 任意态 | →已取消+资源回收 |
| `defer` | 任意非终态 | 降优先级延后 |

子 PM tick 解析时**只认 opengames 账号的评论**，其他人的同名评论无效。

---

## 3. 本地园区与工件对应

```
/Volumes/BigDisk/Studio/
├── CHARTER.md                       # 本文档
├── kernel/
│   ├── projects.json                # 项目注册表 {pid, yt_project_id, dir, 优先级, cron表达式, 预算}
│   ├── roster.json                  # 编制/借调记录（人事地基）
│   ├── locks/<pid>/{tick,lane,qa}.lock
│   ├── evidence/<pid>/<单号>-<attempt>.json   # {commit, gate_cmd, exit, log_hash, ts}
│   ├── metrics/{events.jsonl, budget-YYYY-MM.json, digest/}
│   ├── heartbeats/<pid>.hb          # 看门狗巡检物
│   ├── logs/<pid>-tick-YYYY-MM-DD.log
│   └── skills/                      # 全角色手册（§1 表）
└── projects/<PID>/
    ├── repo/                        # 主仓（POLY 现仓可留原地，plugin 指认）
    ├── plugin.json                  # {lanes, base_branch, 验收命令, Type扩展, 特有剧本}
    ├── skills/                      # 项目专属手册（Unity 资产管线/Web 部署）
    └── evidence/ logs/
```

对齐铁律：YouTrack 短名=PID=目录名；子 PM 的 cwd 白名单锁死在 `projects/<自己PID>/`；锁 key 全部带 pid 前缀（防串单）。

---

## 4. 定时任务舰队（错峰部署）

| cron | 表达式 | 说明 |
|---|---|---|
| 子PM·POLY | `0,10,20,30,40,50 * * * *` | |
| 子PM·WEB1 | `5,15,25,35,45,55 * * * *` | 新项目 onboard 时由**主会话（我/你）创建**——平台规定被调度会话不得再建调度任务 |
| 全局QA | `7,17,27,37,47,57 * * * *` | 独立验收线 |
| 日报官 | `30 9 * * *` | |
| Inspector | `0 9 * * *` | |
| Scout | `0 10 * * *` | |
| 版本日官 | `0 18 * * 5` | 周五 |
| 看门狗 | launchd 每1分钟 | 非LLM |

**停车机制（替代"删 cron"）**：项目无待办时，子 PM tick 第 1 步 bash 预筛即 NOOP 退出（成本≈一次板面查询），cron 保留但逻辑停驶；有新单自动醒。生命周期管理零违规、零开销。

---

## 5. 循环剧本（子 PM tick 十二步，每步 ↔ 状态）

1. **项目 tick 锁**（G0）：拿不到即退出（上轮未完）。
2. **bash 预筛**：`yt list` 板面快照 + 心跳文件检查 → 无可推进单且无超时风险 → touch 心跳、结束（NOOP 停车）。
3. **卡单巡检**："开发中"但心跳>90min → 树干净则回收（attempt+1→已排期）；脏则 stash 入隔离区再回收；attempt≥3 → 排期待审+@制作人。"排期待审/待合并">4h → 日志记 STALL。
4. **批示解析**：拉 opengames 新评论 → 执行 approve-plan/approve-merge/reject/kill/promote/defer → 相应状态迁移。
5. **拆解检查**：Epic 单若无子单 → 先拆（≤5 子单+depends-on DAG，Type 按 策划/程序/美术 路由）→ 子单逐张进"新单"。
6. **DoD 校验**：新单→排期待审 前查验收命令/期望哈希已冻结，缺则补齐（向制作人要或按手册生成）。
7. **派工**（G1 全绿）：对每张"已排期"单：按 Type 选角色 → spawn worker（注入：单号、需求、冻结验收、base 分支、同类历史教训）→ 置"开发中"→ 打心跳。**每 tick 每 lane 最多 1 个 worker**（lane 锁即并发上限）。
8. **收工核验**（G2）：worker 返回 REPORT（完整 diff+命令 trace+commit）→ 子 PM 在干净 checkout 跑 run-gate → 证据落盘 → 绿置"待测试"，红 attempt+1 退"已排期"。
9. **记账**：本 tick 事件+token 追加 metrics/events.jsonl；预算原子扣减。
10. **配额检查**：本会话已推 ≥3 单或 ≥90min → 收尾（写项目日志评论）。
11. **释放锁+心跳**：touch heartbeats/<pid>.hb，释放 tick 锁（lane 锁随 worker 生命周期）。
12. **异常即停**：连续失败≥2 或预算触底 → 停止派工、日志标记、等看门狗/制作人。

全局 QA tick：QA 锁 → 拉所有项目"待测试"单 → 逐张（或并行 spawn 验证员）干净 checkout @worker 所报 commit → run-gate 重跑+**加跑一条 worker 没跑过的命令** → 引用证据文件+hash 评论 → 过置"待合并"/退回并自动开债单。

单据生命线示例（T1 业务单，理想时钟）：09:00 建单(冻结验收) → 09:10 排期待审 → 09:20 你 approve-plan → 09:30 派工开发中 → 11:00 REPORT+run-gate 绿 → 11:07 待测试 → 11:17 QA 认领 → 11:50 待合并 → 13:00 你 approve-merge(+push) → 13:10 merge+终验 → 13:20 已关闭。**你全程只出手两次。**

---

## 6. 闸门断言清单（全部机器可验）

- G0 幂等：tick 锁 OK（studio-lock v2：mkdir 原子+调用方长活 PID+TTL 续期）
- G1 派工：状态合法 ∧ lane锁FREE ∧ 树CLEAN ∧ attempt<3 ∧ 预算>0
- G2 收工：`git rev-parse` 成功 ∧ 所报 commit ∈ base..feature ∧ run-gate exit=0 ∧ 证据落盘
- G3 QA：QA 证据引用路径 ∧ hash==worker commit ∧ 含≥1 条加测命令
- G4 合并：merge --no-ff 成功 ∧ main run-gate exit=0
- G5 关闭：最近 QA/终验证据 exit=0 ∧ HEAD==所报 commit ∧（push 需批示记录）
- 断路：attempt≥3 退审；tick 连续失败≥2 停机；单件预算超限挂起转人工；日/月预算触底 → Scout 先停、nice 单顺延、worker 降档

## 7. 制作人介入点总表

| 轨道 | 你的触点 | 次数 |
|---|---|---|
| A 特护 | approve-plan → approve-design → approve-merge → accept（→approve-push），全程有 PM 贴进展 | 4~5 |
| B 常规 | approve-plan → approve-merge | 2 |
| C 轻轨 | 无（日报可见可 kill；push 随版本日批量授权） | 0 |
| 情报单 | promote | 转正时 1 |
| 事故单 | 复盘批示 | 1 |
| 里程碑 | 版本日拍板冻结范围 | 每周五一页 retro |
| 预算 | 调 budget 线 | 每月 |

## 8. 迁移与实施分期（每期有验收判据）

- **P0 地基（立即）**：修 studio-lock；建园区目录；yt v2 参数化（-P PID，去 0-1/POLY 硬编码）；token 分文件收敛；建 projects.json/roster.json。判据：双仓锁定演练+新账号 token 隔离生效。
- **P1 内核闸门**：run-gate 执行器+证据落盘；yt next-state 状态迁移表+attempt 机器计数；launchd 看门狗四查。判据：伪造 worker 谎报被 G2 拦截；kill 掉 tick 进程看门狗 2 分钟内告警。
- **P2 编制扩充**：建 agent-designer/artist/inspector/scout 账号+字段模板脚本+全角色手册落 kernel/skills。判据：手册齐备、草稿池板可用。
- **P3 子 PM 制切换**：现 POLY cron 剧本重写为十二步子 PM 制+全局 QA cron+日报官。判据：连续 5 张单零人工干预走完（除批示）。
- **P4 软职能**：Inspector 日课→版本日官（首次 retro+release notes）→Scout。判据：首份 retro 一页纸+首张自动债单。
- **P5 第二项目**：onboard WEB1（目录+YouTrack 项目+cron 错峰）。判据：**内核零改动，只写 plugin**；双项目并行各 1 worker 互不干扰。

## 9. 度量（metrics/events.jsonl schema）

`{ts, pid, issue, event, actor, attempt, tokens, cost_cny, note}`，事件枚举：DISPATCH/DONE/GATE_PASS/GATE_FAIL/QA_PASS/QA_BACK/MERGE/PUSH/CLOSE/STALL/QUARANTINE/BUDGET_HELD。
报表口径（AI 版 DORA）：单件成本、重试率、QA 打回率、闸门拦截率、变更周期（建单→关闭）、燃钱速度 vs 预算线、情报转化率。
