# GAMES 团队升级方案 L2→L3（GAMES-134）

> 状态：草案（呈制作人终验，不直接 apply）｜ 派单：宰相 2026-10-14（制作人直提，制作人 2026-10-14 批准 GAMES 升 L3）
> 依据：宰相数据评估（153 会话均 608 万 token／累计交付 114 张／专岗实际干团队长——两条升级讯号全中）；
> docs/org-templates.md（STUDIO-81 宰相 09-30 定稿，3 级模板）｜ CHARTER-V3 §12 ｜ kernel/org.yaml 现产线形态
> 本文四节：①升级方案书（org.yaml 迁移段终稿/专岗升编制/worker 池入档/审批分权）②旧单迁移指导 ③试点计划 ④引擎侧确认。
> 配置变更以 diff 草案给出，不 apply；apply 走制作人终验后由 org 侧落盘。

## 一、升级方案书

### 1.1 升级讯号复核（数据评估结论）

| 讯号（org-templates §四触发线） | GAMES 实测 | 判定 |
|---|---|---|
| 专岗实际干团队长（编制错位） | GAMES 专岗统筹设计→开发→质检→日报全链（quality-pipeline 全程主理），非"1 级岗"职能 | ✅ |
| 交付量超出 2 级画像（简单直接实现） | 累计交付 114 张；E6 多人战役单链 10/10（多轮设计+压测+复盘）；153 会话均 608 万 token | ✅ |
| 人数逼近下一级下限（3-10 人） | 常态实体：专岗 1 + worker 池（agent-dev 施工）+ 战役单链多 worker 并行；有效编制按 3 级起步档适配 | ✅（以职能实体计） |

3 级团队画像（org-templates §三）：3-10 人、2 层、领导 干2-3/批1-2/派2、骨干 干1-2/批1、执行 干1；单据画像 1-3 级"多轮设计"——与 GAMES 战役实况（设计书→开发→QA→调优多轮链）吻合。

### 1.2 org.yaml 迁移段终稿（基于宰相 09-30 草案/STUDIO-81 模板 + team_level 3 + 渐进启用 [1,3]）

GAMES 现无 org 段（approval 引擎按 legacy 走 delegated_approvals）。终稿全文：

```yaml
  GAMES:                          # 3 级团队（GAMES-134 L2→L3，制作人 2026-10-14 批准）
    team_level: 3                 # 2 层编制：队长 + 执行池（骨干层未成形，见 agents 注）
    leader: {name: GAMES 专岗, level: 3, 上级: opengames}
    bu:                           # 3 部对齐 GAMES 交付循环：设计→开发→质检
      工程部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 游戏开发/修bug/重构, 泳道: [framework]}
      质量部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 波次质检/质量档案/案例库/日报, 汇报面: true}
      设计部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 策划案/玩法设计/视觉规范}
    agents:
      GAMES 专岗:                 # 由 STUDIO 段迁入（GAMES-134）：games-daily 定时岗随迁
        {level: 3, 部门: [工程部, 质量部, 设计部], 角色: GAMES 团队长,
         上级: opengames, 定时: games-daily(每日09:10), login: agent-3}
      worker池:                   # worker 池入档（事实源登记；任务书注入路径见 §4 披露）
        {level: 1, 部门: [工程部], 角色: 施工执行, 上级: GAMES 专岗, 身份: agent-dev}
    approvals:                    # 分权引擎配置（首段即影子期起步，复用 STUDIO 验证路径）
      engine: shadow              # legacy 权威不变 + org 并行记账；零分歧 3 天后切 org
      派单人终验收: true           # 铁律（定死，同 STUDIO）
      producer_level: 9           # 9 必亲批；8 制作人保留关注
      producer_watch_level: 8
      全流程签字: {阈值: 4}        # 等级=3 单 < 4：不触发七环逐环签字（见 §1.4）
      批干矩阵:                   # 3 级团队版（org-templates §三：领导 干2-3/批1-2/派2）
        - {层: 领导, 干: [2,3], 批: [1,2], 派: [2]}
        - {层: 骨干, 干: [1,2], 批: [1], 派: []}
        - {层: 执行, 干: [1], 批: [], 派: []}
      渐进启用: [1, 3]            # 升级同步拓展（org-templates §四：升级后建议同步拓展并复审豁免）
      exemptions:                 # 兼容现行 delegated_approvals 语义（切 org 权威时 yaml 驱动）
        - {范围: GAMES 业务单, 规则: GAMES 专岗无条件}
```

**模板偏离留痕**（org-templates 总纲第 10 条）：
- 3 级模板推荐"部主管独立（骨干层）"，GAMES 骨干未成形——三部主管暂由专岗兼任，
  首个骨干（质量部优先：QA 单链已有稳定多轮质检实践）到位后逐项卸任；
- 无"省"键：对齐 STUDIO 生产段形态（leader 直报制作人顶格承担省职），3 级小省不单设。
- 联签现状披露：跨部门单联签机制上线即生效，但三部主管同一人 → 首期联签退化为专岗一人签，
  骨干到位后自然分化（机制先于人员到位，无返工）。

### 1.3 GAMES 专岗 → L3 团队长编制 + worker 池入档

- **专岗升格**：`level 1（日巡汇报岗）→ level 3（团队长）`，上级由宰相(ZCode) 改 opengames
  （3 级团队最高负责人直报制作人，升级流程此后由其发起；宰相保留跨项目协调监督面）。
- **STUDIO 段同步移除 GAMES 专岗条目**（人事档案随编制走，一增一删同一 diff）；
  dailies.games_daily 的署名 SIGN_GAMES 为代码常量不读 org——**零代码改动**，定时岗运转不变。
- **账号锚点**：agents 档案声明 `login: agent-3`（账号=纯等级锚点，agent-3 等级 3）。
  注意：daemon 现行 GAMES 代批仍走 config.delegated_approvals 的 agent-8（PM 治理账号），
  该映射的调整属引擎侧后续单，本单不动（见 §4）。

### 1.4 审批分权变化说明

- **等级=3 单在批干矩阵的位置**：落在领导"干 [2,3]"区间——即 L3 单为**团队长亲自主理**档；
  骨干（到位后）可干 1-2、worker 干 1。子单派生：专岗派 2 → 子单等级上限 2（天然防越级）。
- **逐环签字确认**：全流程签字阈值=4，等级 3 < 4 → **不触发**七环逐环签字
  （签字协议是 4 级以上单的机制；GAMES 段声明同阈值，渐进启用 [1,3] 内全部单据豁免）。
- **亲批面不变**：producer_level 9 / watch 8——GAMES 单据上限 3，远低于亲批线；
  制作人 hold 亲批叮嘱任意单仍最高优先（org_decide 全灭分支）。
- **引擎裁决路径**（engine: shadow 期）：legacy（agent-8 无条件代批）权威不变；
  org_decide 并行记账，终验位锁派单人、hold、联签三约束先行——影子期零干预，只记 SHADOW_DIFF。

## 二、旧单迁移指导（存量 133 张，等级全 None）

**总原则**（org.yaml 头注释 V3 编制定则）：**增量合规、存量零迁移**。处置矩阵三态：

| 态 | 范围 | 处置 | 说明 |
|---|---|---|---|
| **已关闭** | 历史归档单（约存量主体） | **不动**：等级保持 None | 历史单是当时事实，回填=伪造编制历史；双轨映射对其无感（查询侧按需统计） |
| **活跃** | 升级时点仍在流转的单（新单/运行中/待验收等） | **增量补、不回填**：时点后新开单由派单人按 1-3 填等级字段；时点前活跃单不填字段，靠轨道双轨自然解析 | 引擎 level_of 双轨兼容：等级字段优先、轨道回退（org.py:37-44）——L2 常规→3、L1 首批→2、L0 自动→1。**注意 GAMES 常规轨道"L2 常规"双轨即等级 3**：存量活跃单的复杂度语义与本轮 L3 上限天然咬合，零迁移零断层 |
| **在途（E6 波次）** | E6 多人战役单链（kernel/campaigns GAMES-60/61 巡逻 state 活跃，2026-10-13 仍有巡逻轮次） | **切完再切（推荐）**：E6 按现行轨道跑完收官；收官后新战役以 L3 编制开单 | 中途换轨=同链单据等级语义前后不一致（收官单与过程单口径分裂）；E6 已 10/10 单链收官在望，等一周量级的收官成本远小于换轨回归风险 |

**在途战役是否切 L3 编制的裁决建议**：完成后再切（采纳任务书推荐方向）。理由：
① E6 单链的派单人/批示人均按旧语境署理，切编制改变终验锁的派单人解析面（agent-3 档）；
② 战役 spec（kernel/campaigns/<单号>.yaml）的 child_level 三键是新战役粮，在途单不吃新键；
③ 新战役开山单（见 §三）恰是 L3 首试的最佳载体——新旧编制边界=战役边界，干净可审计。

**质量档案（game-quality.json）与等级制的映射说明**：
- 正交维度：档案 stage（backlog→designed→dev→testing→tuning→accepted，现 135 款/26 家族：
  accepted 29、testing 3、backlog 103）是**产品**生命周期；单据等级是**组织**复杂度度量——互不替代。
- 档案是等级制的**选型粮仓**：backlog 103 款=未来战役候选池；档案 notes 的合并链/事故复盘
  是 L3 单"多轮设计"画像的实证素材（PM 回填波次报告时已有此耦合）。
- 单型→等级建议（新战役开单参考，PM 掌握）：设计书 2（试点开山单 3）／开发·迁移 2／QA 三支柱 2／
  FIX·FEEL 调优 1。战役 spec 相应配 child_level（缺省 2 红线不变）。

## 三、试点计划

### 3.1 首个 L3 单选型建议

- **载体**：E6 收官后**下一个质量战役的开山设计单**（从 backlog 103 款中选型开新战役）。
- **选型标准**：①机制新（覆盖未做的同步/玩法维度，"多轮设计"属性强，撑得起等级 3）；②跨工程+设计两部
  （首试联签路径，当前主管兼任=一人签，先跑通机制）；③单链可控（≤6 单，含 D→DEV→QA→FEEL）。
- **开单要素**：等级=3、派单人=GAMES 专岗、Type=需求（设计书）、轨道 L3 特护或直接等级字段 3
  （双轨映射 L3 特护→4 会触发逐环签字——**开单用等级字段=3，勿用 L3 轨道字段**，此为口径锚点）。
- **验收冻结**：沿用质量战役冻结验收命令惯例（PM 按 quality-pipeline §验收配置）。

### 3.2 断点续跑纪律模板（L3 长单 worker 侧，嵌入任务书附录）

```markdown
# 断点续跑纪律（等级 3 长单适用）
1. 开工先考古：读板面 attempt 数与 kernel/workers/<单号>.stream.jsonl——前任被收割时
   未提交件可从 stream 重建（案例：GAMES-A-80）；树上未推送提交 git log 逐条核对。
2. 阶段化推进：把单据拆为可独立验证的阶段，每阶段产物即时落盘+即时提交
   （feat(<单号>): 阶段名），不留"最后一把梭"。
3. 心跳：每完成一阶段 POST 网关 heartbeat 一次（attempt 计数即进度锚）。
4. 交接断点：REPORT attempt=<n> 必写【已完成/未完成/续跑入口命令】三行——
   续跑 worker 从断点入口直接开干，不重做已绿阶段。
5. 自检收尾：冻结验收自跑留退出码；红了不交，不带红过夜。
```

### 3.3 升级落地时序（制作人终验后）

1. apply org.yaml diff（本文件 §1.2 + §4 diff）→ org 热刷新（org.load(force) 幂等）；
2. 影子期观察：games-daily 日报 + SHADOW_DIFF 事件流盯 3 天；
3. 零分歧 3 天 → engine: shadow→org（改配置+优雅重载，回滚=一键 legacy）；
4. 同步复审：delegated_approvals 的 GAMES 代批账号与 agent-3 档的对齐（引擎侧后续单）；
5. E6 收官 → 新战役以 L3 编制开山（§3.1）。

## 四、引擎侧确认（零代码改动）

- **STUDIO-102 泛化已交付**，projects.GAMES 段读取路径全部就位：
  - `studio/org.py:33-34` project(pid)：按 projects.{pid} 取段；
  - `studio/approval.py:23-34` _dispa_logins 按 pid 查 agents login；
  - `studio/signoff.py:33-40` threshold(pid) 按段读签字阈值；
  - `studio/orchestrator.py:675` engine_mode(iid.split("-")[0]) 按单据前缀取项目；
  - `tests/test_approval_generalize.py` 源级冻结断言（无 .get("STUDIO") 裸读取）+ 多项目桩全绿。
- **加段=纯配置新增**：engine: shadow 下审批权威仍 legacy，GAMES 流转行为零变化（影子只记账）。
- **如实披露（非本单范围）**：`studio/workers.py:178` org_profile_block(role) 未传 pid（默认 STUDIO）——
  GAMES worker 任务书的人事档案注入仍读 STUDIO 段 worker池 条目；GAMES 段 worker池 为事实源登记。
  一行改造（补传单据 pid）属引擎侧后续可选单，按"零代码改动"边界本单不动。

## 附：org.yaml 配置变更草案（diff 形式，不 apply）

```diff
--- a/kernel/org.yaml
+++ b/kernel/org.yaml
@@（STUDIO 段：GAMES 专岗条目迁出——人事随编制走）
-      GAMES专岗:                   # STUDIO-109：ZCode 定时岗归框架（games-daily 日巡汇报）
-        {level: 1, 部门: [质量部], 角色: GAMES 日巡汇报, 上级: 宰相(ZCode), 定时: games-daily(每日09:10)}
@@（新增 GAMES 段，插于 STUDIO 段之后）
+  GAMES:                          # 3 级团队（GAMES-134 L2→L3，制作人 2026-10-14 批准）
+    team_level: 3                 # 2 层编制：队长 + 执行池（骨干层未成形，首个骨干到位逐项卸任）
+    leader: {name: GAMES 专岗, level: 3, 上级: opengames}
+    bu:                           # 3 部对齐 GAMES 交付循环：设计→开发→质检
+      工程部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 游戏开发/修bug/重构, 泳道: [framework]}
+      质量部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 波次质检/质量档案/案例库/日报, 汇报面: true}
+      设计部: {主管: GAMES 专岗, 上级: [GAMES 专岗], 职能: 策划案/玩法设计/视觉规范}
+    agents:
+      GAMES 专岗:                 # 由 STUDIO 段迁入（GAMES-134）：games-daily 定时岗随迁
+        {level: 3, 部门: [工程部, 质量部, 设计部], 角色: GAMES 团队长,
+         上级: opengames, 定时: games-daily(每日09:10), login: agent-3}
+      worker池:                   # worker 池入档（事实源登记；任务书注入路径见方案 §4 披露）
+        {level: 1, 部门: [工程部], 角色: 施工执行, 上级: GAMES 专岗, 身份: agent-dev}
+    approvals:
+      engine: shadow              # 影子期起步（复用 STUDIO 路径：零分歧 3 天切 org）
+      派单人终验收: true
+      producer_level: 9
+      producer_watch_level: 8
+      全流程签字: {阈值: 4}        # 等级=3 单 < 4：不触发七环逐环签字
+      批干矩阵:                   # 3 级团队版（org-templates §三）
+        - {层: 领导, 干: [2,3], 批: [1,2], 派: [2]}
+        - {层: 骨干, 干: [1,2], 批: [1], 派: []}
+        - {层: 执行, 干: [1], 批: [], 派: []}
+      渐进启用: [1, 3]            # 升级同步拓展（org-templates §四）
+      exemptions:
+        - {范围: GAMES 业务单, 规则: GAMES 专岗无条件}
```

（diff 中 YAML 全文与 §1.2 一致；apply 前置条件=制作人终验批准。）
