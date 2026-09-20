# STUDIO 工作室框架全面审核报告（第二次）

> 审核日期：2026-09-20 ｜ 审核人：Kimi（主会话 + 4 路并行只读审核：代码 / 运行史 / YouTrack 实况 / 本机运维）
> 审核基线：Studio 仓 master @ 074b735；YouTrack 2026.2 (build 18769)；daemon 运行中（PID 27895）
> 方法：16 个源码文件全量读码 + 旧报告 31 条发现逐一对码核销 + 关键疑点实证复现 + runs.jsonl 2102 条 / events.jsonl 113 条 / 37 个证据文件全量统计 + YouTrack REST 全项目 GET 审计 + launchd/脚本/权限/进程实况核查。关键结论均经主会话二次抽查复核。

---

## 〇、结论先行

**框架方向正确、骨架可信，但当前有三个必须立即处理的问题，外加一层大面积「空心化」的证据体系。**

1. **🔴 P0 — run_gate 超时分支必崩（N1）**：`gates.py:34-37` 超时异常下 `bytes + str` 拼接抛 TypeError。收割路径上这会造成「worker 重跑 → 再超时 → 再炸 → 再重派」的**无断路死循环**，每循环烧一整轮 worker 费用，是全线最贵的洞。一行可修。
2. **🔴 P0 — 命令注入链是真实可达的（N2 + 运维面）**：消毒器对双引号段整体豁免黑名单（`llm.py:34-57`），`python -c "任意代码"` 原样放行（已实证）；而 worker 以 `claude -p --dangerously-skip-permissions`（无 --model / 无 --disallowedTools / 无超时，`~/bin/studio-worker:62`）执行由 YouTrack 单据原文拼装的 prompt，且 YouTrack Docker 绑定 `0.0.0.0:8080` 对整个局域网开放。**结论：任何能写单据描述的人 ≈ 获得本机 shell。**
3. **🔴 P0 — 证据体系大面积空心**：37 份闸门证据里 35 份的日志是 0 字节空文件（哈希全为 `e3b0c442…`）；两张交付单用恒真命令 `test -e /dev/null` 当验收；QA 加测 3 次「生成失败跳过」仍放行、且加测从不写入证据；QA 历史 10/10 全过 0 打回。「完成只认落盘证据」的铁律在，但证据本身目前证明不了什么。
4. **旧账偿还率低**：9-16 第一次审核的 4 个 P1 只修了 1 个（C3，修复质量好）；C1/C2 草稿转正断链原样保留 4 天，Inspector/Scout 上线前必爆；P2 七条全在，其中 C9/C10（批示全史重放烧 LLM、测试真实扣费）因 reviewed_ask 与 `_claude_bin` 绝对路径回退**反而恶化**。
5. **健康面（也应如实记录）**：永不自动 push、批示只认 opengames、worker 无板面写权三条红线在代码层全部守住；调度器/心跳/锁全部鲜活；测试 88 例全绿（但不封闭）；今天 STUDIO-13 刚刚走完「派发→闸门→QA→复验→合并→关闭」全闭环。

---

## 一、必须立即处理（P0）

### N1【实锤】run_gate 超时分支 bytes+str 拼接 TypeError —— 无断路烧钱死循环
- 位置：`studio-daemon/studio/gates.py:34-37`
- 机制：CPython 中 `TimeoutExpired.stdout` 恒为 bytes（与 `text=True` 无关），`(e.stdout or "") + f"\n[GATE-TIMEOUT 600s]"` 必抛 TypeError。只要超时命令产生过任何输出即触发。
- 后果：收割路径异常穿透 finally（worker 已归档、锁已释放）→ pm_tick 记 ERROR → 单留「已派发」→ 下轮按 ARCHIVED 处理**不罚 attempt** → 重派 → 再超时再炸……断路永不触发，每轮烧一整份 worker 费用。QA 与 merge-verify 路径同样中招（单卡死、每 tick ERROR）。
- 修法：`e.stdout` 先 `(e.stdout or b"").decode("utf-8","replace")`，stderr 同理；并为超时路径补测试（旧报告盲区 B11 正是它漏网的原因）。

### N2【实锤】消毒器引号豁免 + 解释器首词白名单 = 任意命令执行
- 位置：`studio-daemon/studio/llm.py:34-57` + `:20-21`
- 实证：`python -c "import os;os.system('id')"` 过 `_sanitize_cmd` 原样放行——双引号段被占位符替换后黑名单与分段扫描全部失效，首词 `python` 又在白名单。dod_gen 的 prompt 直接拼接单据标题与描述（`llm.py:199-206`），恶意单据可尝试 prompt 注入诱使 LLM 产出此类命令，随后以 daemon 权限 `bash -c` 执行。
- 关联：**N3** 白名单命令（`cat`/`git show`）可读任意路径敏感文件，gate stdout 全文落证据盘（`gates.py:38`）——一张「验收时请 cat ~/.config/polymatch3/youtrack.json」的单据会把全账号 token 写进证据文件。
- 修法：解释器首词（python/npm/dotnet/cargo/make）不适用引号豁免，禁 `-c` 类参数；白名单命令参数路径限制在 lane 仓库内（拒绝绝对路径与 `~`）。

### W1【实锤】worker 执行面：单据描述即 shell
- `~/bin/studio-worker:62`：`claude -p --dangerously-skip-permissions`，无 `--model`、无 `--disallowedTools`、无 wall-clock 超时（僵死进程只靠 90 分钟心跳兜底）；单据 `$SUMMARY/$DESC/$GATE` 原文未消毒拼入 prompt（`:26-49`）。
- YouTrack Docker 绑定 `0.0.0.0:8080->8080`（已核实），局域网任何设备可访问板面、写单据。
- 修法（按性价比排序）：① docker 端口改绑 `127.0.0.1:8080`；② worker 调用补 `--model`、`--disallowedTools`、外层 `timeout`；③ kill 改杀整棵进程树（当前 `pkill -P` 只杀直接子进程，孙进程成孤儿）。

### W2【活跃】`/api/schema` 500 —— STUDIO-13 收尾遗漏
- `web.py:234` 仍 `read_text` 已被删除的 `kernel/TEAM.md`，err 日志今日仍在刷 FileNotFoundError（历史累计 793 个 Traceback 中最新一批全是它）。一行修复或改指 Articles。
- 同类：`evolve.py:13-14` KB_ALLOW 仍指向已删除的 kernel/TEAM.md 与 agents/*.md —— kb-propose 治理流写入「死文件」，approve 后无人消费（N6）。

---

## 二、旧账核销（STUDIO-11 审核 31 条现状）

### P1（4 条）

| 编号 | 现状 | 证据 |
|---|---|---|
| C1 技术债草稿 promote 被状态机拒绝 | **仍在** | `statemachine.py:84-90` 交付族永不查 TYPE_EDGES；`ticket-types.yaml:60` 死配置原样 |
| C2 yaml `情报` 键重复丢边 | **仍在** | `ticket-types.yaml:61` 与 `:63` 双键原样（本次复核确认）；`recompute()` 仍无 BUILTIN↔加载对账断言 |
| C3 收割 is-ancestor 误杀 | **已修** ✅ | `orchestrator.py:259-268` 自动 sync-merge + 冲突才 ORPHAN；带 2 个真实场景测试（416d626） |
| C4 merge 冲突测试恒真 | **仍在** | `test_orchestrator.py:222-248` 结构未变，仍走错路径，终态断言仍豁免「已派发」 |

### P2（7 条）

| 编号 | 现状 | 备注 |
|---|---|---|
| C5 evolve 双指令切片 | 仍在 | `evolve.py:69-72` 原样 |
| C6 L3 裸 approve 跳复验 | 仍在 | `orchestrator.py:162` 机制不变 |
| C7 MISMATCH 刷评论 / kill 迟滞 | 仍在 | `orchestrator.py:461-463, 421-434` |
| C8 evolve 无锁 `git add -A` | 仍在 | `evolve.py:139-141, 257-259` |
| C9 批示全史重放烧 LLM | **恶化** | 仍无缓存无水位；且 STUDIO-12 后走 `reviewed_ask`（`llm.py:243-251`），单条评论每 tick 最多 4 次调用（主+审+重试+再审），成本放大 2-4 倍 |
| C10 测试真实调 claude 扣费 | **恶化** | conftest 仍无打桩；且 `_claude_bin` 绝对路径回退（`llm.py:63-75`）使 PATH 屏蔽失效——本次审核实测剥 PATH 后 3 个批示测试仍真实调用本机 claude（单测 47.9s，cProfile 显示 11 次 ~2.7s subprocess） |
| C11 approve/kill 解析分裂 + confidence 未用 | 仍在 | `orchestrator.py:413-434` |

### P3（9 条）

C17（自评重复开单）**已修** ✅（`metrics.py:75-85` 查重 + supervise 巡检；但见 §四-6：修复后 09-20 又堆出 2 张，效果待观察）。C12/C13/C14/C15/C16/C18/C19/C20 仍在，其中 **C12 后果升级为新发现 N4**（pid 复用时 `killpg` 会 SIGTERM 无辜进程组，`workers.py:162-181`）。

### 文档漂移 D1-D11

仅 D2 因载体（kernel/skills/）被 STUDIO-13 整体删除而「失效」；D1（宪章 v1 vs 实现 v4 离婚）与其余全部仍在。新增：板面「轨道」枚举 11 值 vs yaml 8 值（A/B/C 轨遗留仍在用）、Type 枚举 15 值 vs yaml 9 值、两项目 Priority 枚举不一致（YouTrack 实况对账，见 §五-F）。

### 测试盲区 B1-B13

B7 已补（C3 修复带测试）；B5 部分缓解；其余依旧。B11（gate 超时无测试）直接导致了 N1 漏网 4 天。

---

## 三、新发现问题（本次首报，按级排序）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| N1 | P1 | run_gate 超时 TypeError → 无断路烧钱循环（§一） | gates.py:34-37 |
| N2 | P2↑ | 消毒器引号豁免任意命令执行（§一） | llm.py:34-57 |
| N3 | P2 | 白名单命令可读敏感文件，token 可落证据盘 | llm.py:12-21 + gates.py:38 |
| N4 | P2 | pid 复用时 killpg 误杀无辜进程组 | workers.py:162-181 |
| N5 | P2 | 批示链成本被 reviewed_ask 倍增且无预算闸（BUDGET 体系是死代码） | orchestrator.py:413 → llm.py:243-251 |
| N6 | P3 | kb-propose 治理流写入死文件 | evolve.py:13-14 |
| N7 | P3 | `_merge` 开局 `reset --hard`+`clean -fd` 无隔离 stash（人的临时文件会被硬删） | orchestrator.py:304-306 |
| N8 | P3 | evolve-scan 无锁，手动 trigger 与 cron 可并发双跑 | web.py:195-212 + daemon.py:51 |
| N9 | P3 | 心跳 kill 只看板面字段不看 stream 文件活性（yt 脚本缺失时认真干活的 worker 会被误杀） | orchestrator.py:145-150 |
| N10 | P3 | supervise 双取评论 + 死变量 | supervise.py:115-116 |
| N11 | P3 | web._transcript 无上限全量读大 stream 文件 | web.py:131 |
| N12 | P3 | kb_articles_migrate --check 用迁移日正文钉死比对，Article 演进后永久 MISMATCH | tools/kb_articles_migrate.py:113-125 |

---

## 四、运行史全量分析（09-15 ～ 09-20）

### 4.1 总量

- daemon job 2102 次：pm-poly 668 / pm-studio 653 / evolve-scan 658 / patrol 112（6 error）/ qa **5** / self-eval 6。
- worker 实跑 19 个进程：exit 0 ×17，exit 127 ×2；总成本 **$30.25**，总时长 140.6 分钟。
- **STUDIO-14 一单：4 批 10 次派发、11 次 GATE_FAIL、2 次断路、$13.76（占全程 45%）。**
- 单据层 113 事件：闸门失败率 45.8%（11/24，全部 STUDIO-14）；QA 10/10 全过、**打回率 0%**；13 张 CLOSE 全部「未 push（无批示）」。

### 4.2 完整错误史（按模式归类）

| # | 模式 | 次数 | 时间 | 说明 |
|---|---|---|---|---|
| B1 | worker 启动即死 exit 127（launchd PATH 缺 claude） | 3 次 GATE_FAIL | 09-17 01:34-01:44 | STUDIO-14 第 1 批全灭，当日 P0 修复 15cf624 |
| B2 | 恒红 gate：`test -f /dev/null`（字符设备，-f 恒假） | 2 次 + 断路 | 09-17 03:03-03:24 | LLM 岛全灭期 dod_gen 产物 |
| B3 | 「飞线」GATE_FAIL（base 前进，is-ancestor 误杀） | 6 次 | 09-17 12:14-16:34 | 即 C3，当天修复 416d626 |
| B4 | LLM 岛 ask 超时（GLM 端点 60s；含 2 次异常 1s 超时） | 14 次 | 09-17 ～ 09-20 16:47 | 端点偶发，至今仍有（今日 16:47 一条） |
| B5 | evolve 扫描 AttributeError | 4 次 | 09-16 03:43-04:13 | STUDIO-10 从此从流水消失，无后续追踪 |
| B6 | 分支名硬编码：studio 仓是 master，脚本 checkout main | 1 次 | 09-16 15:24 | 报错未阻断流程，12 秒后照常派发 |
| B7 | 巡逻锁事故：僵尸锁 + 锁所有权 PermissionError | 14 LOCK-HELD + 6 error | 09-16 | 锁 v2 修复后收敛 |
| B8 | 巡逻情报源持续失败（域名校验拦截 + 解析失败 + 备用通道 500） | 贯穿 5 天 | 09-16 ～ 09-19 | 两个战役 112 次巡逻 **0 张孵化子单**，纯成本中心 |
| B9 | worker 进程内工具错误（均自愈） | 11 处 | 全程 | Traceback、`== not found` 等 |
| B10 | POLY-13 双重派发（38 秒内 2 次 DISPATCH） | 1 起 | 09-16 03:06 | 第一个进程生死无任何记录 |

### 4.3 「看起来没问题但实际有问题」清单（运行史侧）

1. **恒真验收过闸**：STUDIO-14、POLY-17 的冻结验收 = `test -e /dev/null`（恒真），两单分别交付 554/511 行文档，gate 零验证。
2. **证据日志全空**：37 个证据 JSON 中 35 个 `log_sha256_16 = e3b0c44298fc1c14`（空串哈希），唯一有真实输出的是 POLY-9。「证据落盘」只落了 exit 码。
3. **QA 加测无证据**：QA_PASS 事件 note 写了加测命令，但 `*-qa-*.json` 的 cmd 仍是 gate 原命令、日志仍空——加测是否真执行过无法复查；3 张单「加测=生成失败跳过」仍放行合并。
4. **QA 半停摆 + 恒绿**：qa job 全程只跑 5 次，POLY-11/12 为「手动代跑」；10/10 PASS 0 打回。
5. **自评引擎三天复读**：09-18/19/20 三份自评 metrics 字节级雷同（dispatch=19 一动不动），且 09-16 自评数字与自家事件流对不上（称 6 次派发，实为 9 次）。
6. **耗时仪表没接线**：runs.jsonl 2102 条 `duration_ms` 全为 0。
7. **done.json 无退出字段且指针失效**：10 份均无 exit/error 字段；8 份的 stream/report 路径指向改名前的旧文件名。
8. **REPORT 与验收 commit 不符**：STUDIO-14 REPORT 声明 tip=5e3380b，验收证据记 4a47ceb（daemon 自动 sync-merge 产物）——验收跑的并非 worker 交付的 tip。
9. **attempt 语义混乱**：每批准断路后清零，事件流 attempt 与证据文件名号对不上。
10. **战役与工人不在同一个仓**：POLY-14.yaml 指向 `Match-GLM/Match3`，POLY worker 实际在 `MatchThree/Match3` 干活。

---

## 五、YouTrack 实况（09-20 17:00 基准，全程 GET 只读）

- **A. 总览**：POLY 13 单（12 已了结）/ STUDIO 20 单（17 已了结）；知识库 31 篇全挂 STUDIO，**POLY 项目层 0 篇**（POLY-17 号称交付 7 篇 Article，实际落在仓库 kb/ 文件而非 YouTrack）。
- **B. 卡单**：**POLY-14 巡逻断更 ≈44h**（同周期 STUDIO-9 已跑到 #4）；STUDIO-9 观察中（19h，巡逻正常产出但 Unity 两源连续 4 轮抓取失败）。
- **C. 已批示无响应**：**STUDIO-21/22 于 15:12 被制作人「批准」，至审核时无任何 daemon 响应**；STUDIO-15/16 的「批准」3 天未兑现（最终被以去重名义取消）；POLY-17 批示延迟 10.5h 才执行。对照 STUDIO-13 两次批准 2-9 分钟响应——机制可用，**问题集中在提案（G1）通路对「批准」的解析**，与 C9/C11 批示解析问题同源。
- **D. 重复单**：STUDIO-15~22 共 8 张内容仅两种的自评草稿（去重修复后 09-20 仍新增 2 张）。
- **E. 历史单 Type×State 违反现行 schema**（POLY-1/2/3、STUDIO-10/15~20），无碍运行但污染统计口径。
- **F. 枚举三处对账**：State 40 值三处一致 ✅；轨道板面 11 值 vs yaml 8 值 ⚠️；Type 板面 15 值 vs yaml 9 值 ⚠️；Priority 两项目不一致 ⚠️。
- **G. 账号与 workflow**：8 个机器人账号齐备；42 个 workflow 全为 JetBrains 官方包、无自定义规则——状态机完全由 daemon 驱动，与架构一致 ✅。

---

## 六、本机运维面

| 项 | 现状 |
|---|---|
| 服务 | daemon / launchd `com.studio.daemon` / YouTrack(Docker) / 心跳（POLY 17:10、STUDIO 17:15）全部鲜活 ✅；kernel/locks 无死锁残留 ✅ |
| 安全 | **YouTrack 绑 0.0.0.0:8080** 🔴；worker `--dangerously-skip-permissions` 无约束 🔴；token 文件 600 ✅、仓内无密钥 ✅；`~/.claude/session-env/` 644 待查 ⚠️；youtrack.json 内另存明文 password（非必要存储）⚠️ |
| 重启机制 | KeepAlive + 脚本内 while 双重重启叠加；plist 无 ThrottleInterval；看门狗 3×4s 超时即 kill -9，高负载时可能误杀 ⚠️ |
| 仓库卫生 | 三泳道工作树全干净 ✅；**16 个已合并 feature 分支堆积**（MatchThree 12 + Studio 4）⚠️；**Studio 框架仓无 git remote，单盘故障即全丢** 🔴（两游戏仓有 GitHub 远端） |
| 磁盘 | BigDisk 仅用 4% ✅；kernel/workers 已积 39MB 归档 stream 且无轮转清理机制 ⚠️ |
| jobs.sqlite | 24KB 单表，调度状态正常 ✅ |

---

## 七、红线复核

| 红线 | 结论 |
|---|---|
| 永不自动 push | ✅ 全库无远端 push 代码；CLOSE 事件明记「未push(无批示)」；消毒黑名单含 push |
| 批示只认 opengames | ✅ 全部消费点均有 author 过滤，LLM 解析在过滤之后 |
| worker 无板面写权 | ✅ 代码层成立（prompt 纪律）；例外是设计内的 worker 自账号心跳字段与 Article 草稿写权；**注意 STUDIO-13 起任务书教 worker 自读 token 直调 API，token 使用面扩散到每个 worker 进程** ⚠️ |

---

## 八、修复优先级路线图（建议）

**今天（P0，全是小改动）**
1. N1：`gates.py` 超时分支 decode 修复 + 补超时测试（堵最贵的洞）。
2. W2：`/api/schema` 死文件引用修复。
3. YouTrack docker 端口改绑 `127.0.0.1`（一条 run 参数的事）。
4. studio-worker 补 `--model` / `--disallowedTools` / wall-clock 超时。
5. N2：解释器首词不适用引号豁免 + 禁 `-c`。

**本周（P1）**
6. C10：conftest 打桩 `llm.parse_directive`（套件立刻回到秒级、确定、零扣费）。
7. C9：批示解析缓存（评论 created 为 key），`yt.f` 移出循环——顺带大概率治好 STUDIO-21/22 批示无响应。
8. 证据空心化专项：gate 必须留真实输出（空日志视为无效证据）、QA 加测命令与输出必须写入 `*-qa-*` 证据、「加测生成失败」不得放行、恒真命令（`test -e /dev/null` 类）进 dod_gen 黑名单。
9. N3：白名单命令参数路径限 lane 仓内。
10. C1/C2：草稿转正断链修复（Inspector/Scout 上线前置）。

**排期（P2）**
11. 文档单：CHARTER v1→v4 重写 + 板面轨道/Type/Priority 枚举清理对齐。
12. C6/C7/C8 + N4（kill 前校验进程身份）。
13. 观测层修复：duration_ms 接线、自评口径对齐事件流、attempt 语义统一。
14. 战役：修情报源（域名校验/备用通道）或下架，目前 112 次巡逻 0 产出。
15. 运维债：16 个已合并分支清理、**Studio 仓配置远端备份**、workers 归档轮转、launchd ThrottleInterval。

---

## 附：本次审核方式与可信度说明

四路只读审核（代码 / 运行史 / YouTrack API / 本机运维）独立完成，结论交叉印证；主会话对最高危结论（N1/N2 代码、yaml 重复键、/api/schema 500、空证据日志 35/37、docker 0.0.0.0 绑定、worker 调用行）做了二次实证抽查，全部属实。唯一遗憾：测试套件因 C10 未修且 PATH 屏蔽失效，在验证过程中真实调用了 3 次本机 claude（GLM 端点）——这本身即是 C10 恶化的实证。
