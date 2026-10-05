# 工作室运营周报 2026-W41（2026-10-05 生成）

## 指标（近 7 日 vs 前 7 日）
- 派发 98（环比 +22） ｜ 关单 57（环比 +9）
- 闸门失败率 31%（上周 21%，↑恶化） ｜ QA 打回率 4%（上周 17%，↓改善）
- 合并 63 ｜ 巡逻 11 ｜ 卡单 0

## 异常 TOP（7 日归并）
- （×3）[POLY] ERROR POLY-53 GATE-DANGEROUS POLY-53 验收命令含危险特征，拒跑：test -f Tests/Game/LevelsIndexDocTests.cs && dotnet test Tests/
- （×2）[llm] ask FAILED bin=/Users/xieqingxin/.local/bin/claude model=glm-5.3-flash TimeoutExpired: Command '['/Users/xieqingxi

## 框架演进（git，7 日）
0b70a57 merge(STUDIO-98): [bug] 危险词表 ~ 通杀 dotnet 过滤器+两道闸词集不同源——POLY-53 出生即不可交付
7551c69 fix(STUDIO-98): 危险词表 ~ 收窄 ~/ + 出生-交付两闸同源化（POLY-53 出生即不可交付）
58f08f8 chore(sync): 每日自动同步快照
649a194 chore(sync): 每日自动同步快照
59b9243 chore(sync): 每日自动同步快照
f99d039 merge(STUDIO-94): [STUDIO-84 漏修③] derive 父单回写项目适配——STUDIO Simple 型+缺失降级不炸链（POLY-46/47/48 实弹暴露）
1158414 fix(STUDIO-94): derive 父单回写项目适配——Simple 字型+缺失降级不炸链（POLY-46/47/48 实弹暴露）
eb30a65 merge(STUDIO-93): [STUDIO-84 漏修] link_subtask 端点 405 补丁——契约已实测照抄（POLY-45 实弹暴露）
956a00b fix(STUDIO-93): link_subtask 端点 405 补丁——契约三重实测照抄
5c54c03 chore(sync): 每日自动同步快照
9b043e1 chore(sync): 每日自动同步快照
56c1240 merge(STUDIO-77): [STUDIO-55] wkey 签发补全
1ef2d0b merge(STUDIO-77): [STUDIO-55] 同步 master f289d3d..16d5c06——撞号化解与容错语义合流
16d5c06 merge(STUDIO-83): [STUDIO-55] 框架管家岗哨：派发单自动跟踪+宰相提醒
9113ed6 merge(STUDIO-82): [STUDIO-55] worker 任务书注入部门+职责提示词
589dc28 merge(STUDIO-78): [STUDIO-55] 联签协议：跨部门单涉及主管全签
087ead8 fix(STUDIO-83): 合并语义冲突——test_signoff 加测桩对齐 extra_test_gen cwd 形参
3dfe347 merge(STUDIO-82): 同步 master 4687c44..c6fcdf9——解 06:34 飞线退回（同步合并冲突）
6f7f590 Merge branch 'master' into feature/STUDIO-83
c6fcdf9 merge(STUDIO-84): [STUDIO-55] [bug] 巡逻孵化 lane 哨兵 400 根治——yt.new 视 - 为无泳道+子单单点容错

## 提示词版本归因（派发/打回 按版本）
- W-2026-09-29.1：派发 58 ｜ QA打回 3 ｜ 闸门败 17
- W-2026-09-30.1：派发 10 ｜ QA打回 0 ｜ 闸门败 7
- W-2026-09-30.2：派发 7 ｜ QA打回 0 ｜ 闸门败 3

## 待决提案（等制作人）
- STUDIO-39 [审计2026-09-26] 修复包：P0 记账断链/worker三约束/泳道锁 + P1 清单（草稿）
- STUDIO-47 [Epic] 框架能力扩展——制作人 2026-09-28 需求（并行/多工具/接管/优雅重载/（草稿）
- STUDIO-55 [Epic·战略9级] 组织架构改造——纵向分级×横向分部×交叉负责（制作人 2026-09-2（草稿）
- STUDIO-56 [STUDIO-55] P1 组织编制落地：org.yaml + STUDIO 小团队 v1 +（草稿）
- STUDIO-57 [STUDIO-55] P2 审批引擎泛化：等级阈值+部门主管+跨部门联签（草稿）
- STUDIO-58 [STUDIO-55] P3 派生链与部门路由（草稿）
- STUDIO-59 [STUDIO-55] P4 标准编制模板+项目迁移+宪章v3呈批（草稿）
- STUDIO-89 [STUDIO-37] 闸门双绿设计单：合并验证连续两轮全绿＋FLAKE事件进自评（草稿）
- STUDIO-92 [自评] 断路触发 8 次（attempt≥3）——相关单需人工复盘（草稿）
- STUDIO-95 [STUDIO-37] 新增 docs/kb-coldstart.md：worker 冷启动领地（草稿）
- STUDIO-96 [STUDIO-37] 新增 docs/kb-index.md：收割散落各票分支的 kb-* 知（草稿）
- STUDIO-97 [自评] 闸门失败率 32%（40/124）——检查 DoD 生成质量与 worker 任（草稿）

> 自动生成 by studio-daemon reports，幂等重跑覆盖。
