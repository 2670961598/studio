# 对标-OneManCompany（只读简报 · 2026-11-20）

> 依据：`docs/sentinel-logs/前沿动态汇总-2026-11-20.md` ＋ 公开资料（[GitHub](https://github.com/1mancompany/OneManCompany)、[官网](https://1mancompany.github.io/OneManCompany/)、[npm](https://www.npmjs.com/package/@1mancompany/onemancompany)、[Vessel+Talent 文档](https://1mancompany.github.io/OneManCompany/docs/reference/vessel-system/)）。
> 对照基线：docs/17（技术设计/预算/执行器）、docs/20（规程/验收闸/分层宪法）、docs/04（公司目录/等级）、docs/plan/06（自研切换与 M5 打包）、docs/quality/workbench-transport-v1.md（Transport v1）、daemon 四域（engine/control/evolve/cli）、docs/quality/acceptance.md（验收闸）。
> 性质：只读对标——不引入代码/依赖、不 commit、不改事实源。

## 一、对方产品化能力清单

产品定位：一人当 CEO 的 Agent OS——`npx @1mancompany/onemancompany` 单命令，浏览器内得到一家全 AI 员工公司（Apache-2.0，2026-01 发布；Python FastAPI+LangChain 栈，自动装 Python 3.12）。

| # | 能力 | 要点 | 证据 |
|---|---|---|---|
| 1 | 一键安装 | npx 单命令；Node+Git 即可；macOS/Windows/Linux | [npm](https://www.npmjs.com/package/@1mancompany/onemancompany) |
| 2 | org chart | CEO→高管→员工层级汇报线、部门制结构，浏览器可视化 | [官网](https://1mancompany.github.io/OneManCompany/) |
| 3 | 招聘/入职 | HR 搜 Talent Market→CEO 面试→自动入职流 | 同上 |
| 4 | 解雇/离职 | 解雇带清理（"not just kill -9"），教训入库传继任者 | [GitHub](https://github.com/1mancompany/OneManCompany) |
| 5 | 绩效/PIP | 季度评分、试用期、PIP、晋升通道；"情绪模拟"——CEO 反馈永久改变行为 | [官网](https://1mancompany.github.io/OneManCompany/) |
| 6 | 委派/审批链 | CEO→executives→employees 逐层质量门；文件改动批量 diff 审批 | [npm](https://www.npmjs.com/package/@1mancompany/onemancompany) |
| 7 | 会议室 | 多 agent **同步**讨论＋自动生成会议纪要 | [官网](https://1mancompany.github.io/OneManCompany/) |
| 8 | 成本核算 | 按项目实时 token/USD | 同上 |
| 9 | Vessel | 执行容器：runner/hooks/context/limits/capabilities＋6 类 harness 协议（事件/存储等套接件） | [Vessel 文档](https://1mancompany.github.io/OneManCompany/docs/reference/vessel-system/) |
| 10 | Talent | 技能/知识/人格/工具的能力包；`employees/<id>/`＝profile+vessel+skills+progress.log，可从市场安装 | 同上 |
| 11 | 像素办公室 | 浏览器像素风办公室 UI（产品门面） | [官网](https://1mancompany.github.io/OneManCompany/) |
| 12 | 知识沉淀 | KB/SOP；1-on-1 辅导转永久工作原则 | [GitHub](https://github.com/1mancompany/OneManCompany) |
| 13 | 派发模型 | 事件驱动、零空闲、按需派发（自述对照心跳轮询） | [npm](https://www.npmjs.com/package/@1mancompany/onemancompany) |

## 二、能力对照与差距

| 对方面 | 我们的对应（依据） | 判定 |
|---|---|---|
| 一键安装/分发 | M5 打包在办（plan/06 里程碑5）：去 Docker/Taiga/Matrix、init 默认 localfile+chatd、一键启动＋备份/升级/卸载、tarball 分发；运行时 Node 24+ 直跑 .ts | **有差距**（对方已产品化；我方里程碑1-4 仍在切换中） |
| 组织/层级 | 公司目录=外置 git 仓；部门嵌套 9 级、公司 2-9 级形态表＋升级触发阈值；唯一写入者＋挂单 commit＝组织变迁史（docs/04） | **我们更强**（事实源/审计/回滚机制化）；对方可视化更产品化 |
| 招聘 | 岗位=目录配置＋批示流；人事档案/工号制；编辑中心人事域草稿→三档批示→daemon 单点写回（docs/17-§8） | **有差距**：无自动"搜市场→面试→入职"流（边界不同，非缺陷） |
| 解雇/离职 | personnel_events（入/调/升/降/停/复/退）append-only＋批准人/单据号；任职闸门 HOLD_NOT_IN_SERVICE 硬拒非在岗派发（docs/17-§2） | 语义对等（治理更强：留痕/审计）；对方流程自动化更顺 |
| 绩效/试用/PIP | perf-weekly 台账复算五指标（闸过率/打回/时延/工时成本/证据完备度；零自评只投影不裁决）；升级=宰相定时审查→会签→制作人终验（docs/04-§三/四） | **部分覆盖**：账面有、试用期/PIP 显式闭环无 |
| 会议室 | chatd（Unix socket+SQLite+NDJSON）＋ Transport v1 冻结（rooms/messages/read/inbox/wakes.claim/ack）；制作人-岗位持久对话 DM（docs/21-§七） | **有差距**：异步消息面有，多 agent 同步讨论＋自动纪要无 |
| 成本 | budgets 三态（reserve/settle/refusal）＋事件级 tokens 四桶/cost_usd＋"预算预留-结算不落即不派"红线＋惊动预算审查岗＋micro-judge 三帽（docs/17-§2/§6，docs/20-§六） | **我们更强**（对方仅项目级展示，无预留-结算-拒派机制） |
| UI | 三端口：8791 监控（SSE/成本趋势）/8789 概览＋编辑中心（`<slug>` 路由）/8788 对外 API＋agent-card（docs/04-§七） | 定位不同：只读投影＋受控编辑 vs 演示级仿真 |
| 执行架构 | adapters 四原语四家（dsh/claude/codex/kimi）＋L0-L5 分层（L2.5 角色包六类模板＋岗位卡）＋REC-CAP 能力声明与缺口五出口（docs/17-§5/§6） | **同构对等**（Vessel+Talent ≈ adapters＋角色包＋CAP）；对方"可安装/可交易"产品化更强 |
| 质量门/验收 | 收割四要件＋每单 acceptance_criteria＋派发拒派/CLOSE HOLD 验收闸＋分级签收（low=lead-verifier/medium=eng0/high=producer）＋证据断言（docs/quality/acceptance.md，docs/20-§五） | **我们更强**（对方逐层质量门无独立验收闸/证据链口径） |
| 知识沉淀 | 公司 docs/＋案例库（复盘单→POSTMORTEM 事件）＋REPORT sidecar 续跑前情（docs/17-§6） | 语义对等；对方"1-on-1→永久原则"叙事化更讨喜 |
| 派发模型 | tick 相位机（七相位每拍幂等）＋并发四闸（断路/泳道租约/人闸/在途上限）（docs/17-§2） | 架构不同不评优劣：四闸/断路/租约/验收闸长在拍上 |

小结：差距集中在**产品化/可安装性**（安装、招聘流、会议室、试用期/PIP 闭环）四处；机制面（成本、验收、审计）我们全面占优。

### 我方独有面（对方没有，产品化时是卖点不是负担）

- 三事实源＋每源唯一写入者（机制保证非自律）；台账 append-only＋rolling hash 可重建投影。
- 验收闸 enforce（缺 acceptance_criteria 拒派、缺结论 HOLD 不 CLOSE）＋分级签收＋证据断言。
- 执行器中立：四家 CLI（dsh/claude/codex/kimi）同契约可换，探针集回归＋崩溃注入五点。
- 多公司隔离（`<slug>` 路由＋每公司 API 端口＋registry）与分层宪法机械门禁（guard:boundaries）。
- daemon 四域分层（engine/control/evolve/cli）＋自进化守护（切权升级），千文件级扩容纪律。

## 三、可借鉴（3-4 项）

1. **能力包产品化**（对齐 Vessel+Talent 分离）：把 L2.5 角色包（roles/ 六类模板＋岗位卡）＋定时岗配置＋prompts/ 片段做成**可版本化、随框架分发的「岗位模板包」**。
   同构件已齐（adapters capabilities＋gen-templates 分级生成器），缺的只是"包格式＋安装面"。
2. **会议室多 agent 同步**（对齐 meeting rooms）：chatd rooms/messages 基础已在（Transport v1 冻结）；其上补"同步讨论＋自动纪要"协作面——纪要=一张定时岗单的 REPORT（落 `reports/`），复用四要件，不新造事实源。
3. **绩效/试用/升级节奏**（对齐 probation/PIP）：perf-weekly 账面之上补轻量闭环——personnel_events 已有调/降/停 type，可承载"试用期观察标记＋PIP 改进单"（PIP=挂单跟踪的改进单，仍零自评、只投影）。
4. **一键安装开发者体验**（对齐 npx 单命令）：前沿汇总建议1 已点名——M5 打包优先级提升，干净机器一条命令到"看到公司跑起来"。

## 四、不照搬（2-3 项）

1. **Talent 外部市场供应链**：外部能力包未经我方证据链/验收闸验证即上岗，违反"无证据=无完成"与 CAP 资格认定不代作原则（docs/17-§2 缺口五出口：缩/换/外援/拒绝/停止）。若做能力包，只做**公司目录内 git 资产＋批示流安装**，不做可交易外部市场。
2. **像素仿真 UI 与情绪模拟**：演示级门面不产生证据；面板是只读投影，不做"看起来在办公"的仿真；绩效账面零自评只投影（docs/04-§三），不渲染"员工会紧张"类叙事。
3. **不替换核心事实源/执行模型**：员工目录≠三事实源（单据平台＋公司 git 目录＋SQLite 台账，各唯一写入者）；事件驱动派发不替换 tick 相位机——换底座=推翻既有治理面（四闸/断路/租约/验收闸）。

## 五、对 M5 打包/产品化的 3 条具体建议

1. **一键命令面＋冻结验收**：把 M5 的"一键启动（daemon+chatd 双进程同生命周期）＋备份/升级/卸载"收敛为命令组（如 `studio-next up|down|doctor`）；`doctor`=Node≥24/git/socket/端口/公司目录 schema/healthz 六项自检。
   验收冻结为**干净机器 E2E**（仿 `scripts/qa/acceptance-e2e.sh` 口径新增 bootstrap 脚本）：无 Docker/Taiga/Matrix/bun 环境，tarball 起步→8789 首页→首单 CLOSE 全链绿。
2. **样例公司开箱体验**：`templates/` 增 demo 公司（2 级班组、单部门、2-3 个定时岗、1 张含 acceptance_criteria 的样例单），`studio-next init` 默认带上——init 后一条命令跑通派发→收割→CLOSE，8789 概览/组织/成本三页即有真数据。
   对标"浏览器里立刻看到公司"的体验，但内容全部是三事实源投影，非仿真。
3. **岗位模板包随发布版本化**：角色包/定时岗模板/prompts 片段打成分版本资产随 tarball 发布（schema 版本迁移脚本同行，docs/04-§九.4 已有此约定）。
   安装=目录 schema 校验＋挂单 commit（daemon 唯一写入者）；能力不达标照旧五出口拒派——借 Vessel+Talent 之形，不借市场之实。

## 结论

对方赢在**产品化/可安装性/演示面**，我们赢在**事实源纪律/证据链/验收闸/预算机制**。
M5 打包是收敛两者差距的最短路径：按前沿汇总建议提升优先级，且以"干净机器跑通真单闭环"为唯一验收口径。
