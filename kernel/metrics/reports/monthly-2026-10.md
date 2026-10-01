# 工作室运营月报 2026-10

## 指标（近 30 日）
派发 193 ｜ 闸门 ✓148 ✗61（失败率 29%）｜ QA ✓131 ✗13（打回率 9%）｜ 合并 119 ｜ 关单 113 ｜ 巡逻 39 ｜ 卡单 0

## 周趋势（远→近）
- 09-24~09-30：派发 134 ｜ 关单 87 ｜ 闸门失率 27%
- 09-17~09-23：派发 52 ｜ 关单 19 ｜ 闸门失率 38%
- 09-10~09-16：派发 7 ｜ 关单 7 ｜ 闸门失率 0%
- 09-03~09-09：派发 0 ｜ 关单 0 ｜ 闸门失率 0%

## 框架演进（git，30 日）
- 9b043e1 chore(sync): 每日自动同步快照
- 56c1240 merge(STUDIO-77): [STUDIO-55] wkey 签发补全
- 1ef2d0b merge(STUDIO-77): [STUDIO-55] 同步 master f289d3d..16d5c06——撞号化解与容错语义合流
- 16d5c06 merge(STUDIO-83): [STUDIO-55] 框架管家岗哨：派发单自动跟踪+宰相提醒
- 9113ed6 merge(STUDIO-82): [STUDIO-55] worker 任务书注入部门+职责提示词
- 589dc28 merge(STUDIO-78): [STUDIO-55] 联签协议：跨部门单涉及主管全签
- 087ead8 fix(STUDIO-83): 合并语义冲突——test_signoff 加测桩对齐 extra_test_gen cwd 形参
- 3dfe347 merge(STUDIO-82): 同步 master 4687c44..c6fcdf9——解 06:34 飞线退回（同步合并冲突）
- 6f7f590 Merge branch 'master' into feature/STUDIO-83
- c6fcdf9 merge(STUDIO-84): [STUDIO-55] [bug] 巡逻孵化 lane 哨兵 400 根治——yt.new 视 - 为无泳道+子单单点容错
- a550a74 merge(STUDIO-90): [STUDIO-55] [bug] sandbox-verify.sh 双洞——timeout 静默失效恒记 PASS + worker 运行期克隆 HEAD 双重 apply
- 4005a2d merge(STUDIO-91): [STUDIO-55] [bug] evolve.scan 锁只取不放——治理扫描退化为 5 小时一跑
- df74b45 feat(STUDIO-77): [STUDIO-55] wkey 签发补全——三类执行体统一 YouTrack 网关
- 785ab5c feat(STUDIO-78): [STUDIO-55] 联签协议代码化——跨部门单涉及部门主管全签方放行
- f289d3d merge(STUDIO-76): [STUDIO-55] 交付族级别流入 guard 扩面
- 9c16103 merge(STUDIO-79): [STUDIO-55] 全流程逐环签字协议
- d28d8a1 merge(STUDIO-80): [STUDIO-55] 团队升级流程代码化
- 396da2a merge(STUDIO-81): [STUDIO-55] 标准编制模板文档
- 1191138 fix(STUDIO-83): QA 加测 cwd 错配误红修复——attempt=1 重派根因
- 54c6320 fix(STUDIO-90): sandbox-verify.sh 双洞修复——timeout 探测兜底+跳过/通过显式分离+基线分支克隆
- 3c51529 fix(STUDIO-91): evolve.scan 锁只取不放——治理扫描退化为 5 小时一跑
- 6876357 feat(STUDIO-83): 框架管家岗哨 steward——收割校验+@宰相终验提醒
- 082c355 feat(STUDIO-82): [STUDIO-55] worker 任务书注入 org 人事四要素（部门·角色·职责·上级）
- 835a90e docs(STUDIO-81): [STUDIO-55] 标准编制模板文档——2-9 级推荐编制+进化路径（按九级表）
- 2423844 feat(STUDIO-80): [STUDIO-55] org.yaml team_level 升级链代码化——负责人提议→领导层会签→制作人终验
- ee7d4e1 fix(STUDIO-84): [STUDIO-55] 巡逻孵化 lane 哨兵 400 根治——yt.new 视-为无泳道+子单单点容错
- d7be41e feat(STUDIO-79): 全流程逐环签字协议——宪章§12.2 七环签字+终验前置校验
- 3f2b6a6 fix(P0): worker wkey 签发断链——launch 签发+wrap 导出（心跳/评论/文章 403 根因）
- 01ad67c feat(STUDIO-76): [STUDIO-55] 交付族级别流入 guard 扩面——平台 guard 从提案族到需求/缺陷/技术债（沙箱 PASS）
- 4687c44 docs: AGENTS 事实源指向 CHARTER-V3

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

> 自动生成 by studio-daemon reports，幂等重跑覆盖。
