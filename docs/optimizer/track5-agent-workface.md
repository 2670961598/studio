# 轨 5 · Agent 工作面审计（追加式轨道文件）

> 守护程序见 docs/88-自优化守护程序.md。面：沙箱摩擦/工具链/证据质量/断路重试/意图链。

## 2026-10-31 R1（24h 全量复盘——夜战+晨战实证）

**已修复并投产验证**（生产工人 studio-dev-314/INT-1 实测样本）：
1. 临时目录写根（/private/tmp+用户 T）——314 sbpl 含 2 条 ✓（此前 mktemp EPERM 100% 复现）
2. 网域裸放行过渡面——314 sbpl 含通配行 ✓（此前过滤式 remote 对非回环全灭）
3. **DeepSeek 搜索已进生产**：314 REPORT 自报「web_search 4 查询、web_fetch 1 深取均成功」
   ——情报岗前沿巡逻真用上了（轨 4 P0 资产投产闭环）
4. DSH_HOME 写域（~/.dsh 入根）——269 att18 起所有 worker 稳定 boot

**证据质量面（正向样本）**：
- 269 att18：诚实申报「五维未执行不伪造」+ 过闸≠完成声明——红线纪律满分；
- 314：主动声明 MCP 未接入面+文档「按节号对齐不逐字引用、不虚构条款」——降级声明规范。

**未修复摩擦（待立单/待接线，按优先级）**：
1. **意图去重墙**（P0-框架缺陷）：单据 noop 后后补字段/状态救不回（intentKey 一次性）——
   269/306 双重实证。修法方向：change 类事件对「未成功派发过的单」产新 intent 键（或 noop
   键带 attemptN）。→ 立实现单提案（轨 5→devtask）
2. **批示人白名单缺口**（P1）：宰相/派单身份不在 DIRECTIVE 词表校验白名单
   （DIRECTIVE_REJECTED not-whitelisted 实录）→ 立单补白名单映射
3. **任务书路径可达性**（P1→轨 1 联动）：模板缺「对象绝对路径+可达性自检」段——269 att18
   环境审计空转主因之一
4. 断路自愈观察：半开试探机制（DEV-46）整夜表现正确；5 张自动 bug 单（271/277/286/293/
   299）根因均已修复——建议 QA 复核后关单
5. **DB 写禁令**（新铁律，源 10-31 事故）：平台事实源只走 API/网关——见
   incident-20261031-taiga-history.md

**成本记账**：本轮审计≈35k token（台账抽样+2 工位实证+复盘）。

## 2026-11-01 R2（08:00 班）

**双杀修复**：①worker bash 工具链复活——`mkdtemp` EPERM 根因=/var/folders 系符号链接、
sbpl subpath 需真路径 `/private/var/folders/...`（daemon.yaml 已改+沙箱实测 ✓，首个
受益者=342 运维首报如实申报了此故障——开工自检段+诚实降级的实战首验，模板投资回本）；
②岗位物化堵点（OPS-1 等无 Taiga 账号）——邀请 membership+Django 壳建号三件套入项目，
岗单 338/341/342 恢复流转。
**发现**：342 报告自报 studio-tools MCP 未挂载（wkey 在 env 但 MCP 工具面缺席）——84 号
MCP 大重构的 worker 侧缺口实证。
**遗留**：活动流派发饿死（343-350 八单待派——feed 读洞致 activitySince 全量通过罕见；
调度器路径正常）——与认证振荡同源，继续围猎。

## 2026-11-01 R3（12:00 班——bash 工具链深修战报）

**进展链**：mkdtemp 符号链接修复后，bash 换死法→`sandbox_apply: Operation not permitted`
（**嵌套沙箱**：dsh-bash-sandbox 给子进程套内层沙箱，外层工位 seatbelt 已圈禁——macOS
内核拒嵌套 apply，与 profile 无关，seatbelt.ts 头注先例）。`mode: danger-full-access`
配置后工具恢复在场但执行时探 backend 仍拒（"no sandbox backend usable…ensure
sandbox-exec is usable"）——backend 探测本身要起 sandbox-exec（嵌套）。
**正解**：bash-local 执行器（无内层沙箱，隔离全责外层）——但 insertAfter 补丁只进
config 树不激活插件，工具不发布；**需 bundle/includes 级激活**（dsh 组合机制知识缺口，
修复路径已明确）。当前态：bash 工具在场+诚实拒（优于隐性坏）；glob/grep 待同路复验。
**候补**：外层 seatbelt 白名单放行 sandbox-exec 嵌套=内核级不可能，排除。
