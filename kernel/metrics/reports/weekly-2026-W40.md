# 工作室运营周报 2026-W40（2026-09-28 生成）

## 指标（近 7 日 vs 前 7 日）
- 派发 76（环比 +55） ｜ 关单 48（环比 +38）
- 闸门失败率 21%（上周 50%，↓改善） ｜ QA 打回率 17%（上周 0%，↑恶化）
- 合并 48 ｜ 巡逻 21 ｜ 卡单 0

## 异常 TOP（7 日归并）
- （×6）[llm] ask FAILED bin=/Users/xieqingxin/.local/bin/claude model=glm-5.3-flash TimeoutExpired: Command '['/Users/xieqingxi

## 框架演进（git，7 日）
c14accd fix(卫生债): TRIGGER_MAP 补齐全部岗哨——report-*/pm-games 曾"未知 job"（沙箱 PASS）
5196125 fix(事故): from_crontab 只认5字段——drain-watch 秒域改构造参数；装配冒烟补位
1821c08 feat(47-A): 优雅重载指令——重启即指令，drain 到在途清零自退，零中断续跑（制作人 2026-09-28 需求，沙箱 PASS）
c60515e fix(生产bug): result_stats 逐行容错——WORKER-EXIT 尾行曾让记账整桶失效一天
dc8f72d fix(第四批②): 草稿转正双断链 C1/C2 + 周报 cron 语义修正（STUDIO-39，沙箱 PASS）
bb27989 fix(第四批①): run_gate 危险快筛兜底 + dod_gen 去恒真教唆（STUDIO-39，沙箱 PASS）
e4acac6 fix(P2/P3)×2: 面板 POST 令牌防线 + worker 数据 token 脱敏（STUDIO-39 第三批③，沙箱验证 PASS）
bb4f80b chore(sync): 每日自动同步快照
f39a484 feat(治理×2): STUDIO 开发审核权移交 ZCode + 验证闸进全部流程——制作人 2026-09-27 指令
a438c8f fix(P1-2): 消毒器五面收紧——堵提示注入直通 bash -c 的通路（STUDIO-39 第三批①）
f79f110 fix(事故): 修复 daemon.py 括号语法错误——上跑编辑笔误致生产停摆 10 分钟
296e872 fix(P0-4): 泳道锁去 pid——lane 名即物理仓，跨项目互斥归位（STUDIO-39 第二批③）
30169e5 fix(P0-3): worker 三件套上线——显式模型/预算帽/45min 看门狗（STUDIO-39 第二批②）
a34f542 fix(P0-1): 记账四接线——成本/耗时/tokens 终于入账（STUDIO-39 第二批①）
51f01ed chore(sync): 每日自动同步快照
6ebcbe0 test: 委托边界用例钉旧表验证机制 + 新增 POLY 审查后代批生效用例（补 930adea 漏跑）
930adea feat(授权): POLY 委托代批——制作人 2026-09-26 '你直接审查之后，可以的进行同意即可'
3b42b76 fix(P0)×3: 审计止血——巡逻岛无响应独立分支/空壳战役短路/日报纳 llm FAILED
3c786e9 feat: STUDIO-37 前沿广域战役 spec（72h 全领域热点→提案队列）
a2776de chore: 战役 spec/快照入库（POLY-14/18~21）——git 是唯一变更史

## 待决提案（等制作人）
- STUDIO-39 [审计2026-09-26] 修复包：P0 记账断链/worker三约束/泳道锁 + P1 清单（草稿）
- STUDIO-42 [前沿] trace_id 贯穿全链路——单据时间线视图（span-per-tick 模式）（草稿）
- STUDIO-43 [前沿] QA 打回自动开复盘——人类反馈回流 evals（闭环缺失项）（草稿）
- STUDIO-44 [前沿] 知识注入检索化——全量上下文改分层（RAG 8-82x 成本差）（草稿）
- STUDIO-45 [前沿] MCP 作为 worker 受控工具面——评估性提案（大改，制作人定夺）（草稿）
- STUDIO-46 [自评] 断路触发 4 次（attempt≥3）——相关单需人工复盘（草稿）
- STUDIO-47 [Epic] 框架能力扩展——制作人 2026-09-28 需求（并行/多工具/接管/优雅重载/（草稿）
- STUDIO-48 [STUDIO-47] 46-A 优雅重载指令（最优先快赢）（草稿）
- STUDIO-49 [STUDIO-47] 46-B 面板接管续聊（快赢）（草稿）
- STUDIO-50 [STUDIO-47] 46-C 多执行器支持（渐进）（草稿）
- STUDIO-51 [STUDIO-47] 46-D 同仓并行实验（先实验后排期）（草稿）
- STUDIO-52 [STUDIO-47] 46-E 提示词版本化档案+效果关联（草稿）

> 自动生成 by studio-daemon reports，幂等重跑覆盖。
