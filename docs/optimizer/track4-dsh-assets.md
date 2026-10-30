# 轨 4 · DSH 插件搜集与资产化（追加式轨道文件）

> 守护程序见 docs/88-自优化守护程序.md。每轮追加带日期小节；资产归类口径=D1a（84 号
> 裁决）：插件=公司资产部「执行器专属资产」，启用走登记制不散装。

## 2026-10-31 R1（首轮普查——npm 生态 20 件 @deepseek-ai/dsh-*）

**[P0·已接入] web 搜索对**：`@deepseek-ai/dsh-web`（provider 选择）+ `@deepseek-ai/dsh-web-deepseek-api`
（DeepSeek Search/Fetch API 直连，单请求无辅助模型；key=env DEEPSEEK_API_KEY 与 llm 路由
同源）+ `dsh-tool-web`（模型侧工具，bundle 自带）。
**已落**：headless profile cordis.patch.yml 增补（备份 cordis.patch.yml.bak-search-20261031）；
**真机冒烟 PASS**：沙箱工人 3 步实搜带回带源引用结果（11.5k token/次）；合成校验 exit=0。
资产卡：用途=worker 前沿搜索/资料核查；冲突面=无（纯增益）；生产可用性=已验证；归类=通用
必达资产（非 DSH 专属不可——但实现依托 dsh 插件面，登记为执行器专属资产·通用类）。

**[P1·机制吸收] agent-team 系**：Lead+具名 teammate 两级、inbox 直信、CAS 任务板+依赖 DAG+
文件触及警告；共享工作区、无跨进程。判定=机制吸收进 W- 系条目（吸收 CAS/DAG/触及警告三
件），非生产启用。

**[P1·场景启用] tool-worktree 系**：`create_worktree` 一次调用建分支+工作树+切 cwd。判定=
V2 施工泳道（plan/02 并行组）启用候选；**生产 headless 禁**（cwd 调度纪律冲突——docs/25 §3.4
session 存档键随 cwd）。

**[P2·评估中] session-search**（工位历史会话检索——知识回收面）；**persistent-terminal**
（shell 跨调用驻留——与工位一次性纪律待调和）；**ralph 循环**（明确指令的循环执行——巡逻
岗候选）。

**[禁·生产不开] subagent ACP/Codex/Claude 子智能体**（绕台账：工时/成本/证据不可收）；
**自动授权审查**（治理权让渡给模型，与批示链冲突）；**开发者工具**（调试面）。

**[记录] dsh-badge/custom-marketplace/title-update/voice-input**：低优先或暂无关。

### 待办（下轮）
- 逐件深读 README 出完整资产卡（≥8 件）→ docs/v2/06 资产部卷的实例填充提案
- 检查 dsh-web-search-deepseek（Messages 搜索）与 web-deepseek-api（直接 API）双通道取舍
