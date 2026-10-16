# 03 · YouTrack 对接方案（能力榨干 + 平台分工 + 多公司建模）

> 来源：3 路 YouTrack agent 实测（2026-10-15，本机 jetbrains/youtrack:2026.2.18769 只读探测 + 官方文档），主 PM 整理。

## 一、能力矩阵（实测三态）

> **模板化原则（制作人 2026-10-16 定调）**：本方案里所有 YouTrack 侧的规约——字段名（State/部门/等级/派单人）、
> 状态流（新单/待批/已派发…）、单型（需求/缺陷/提案…）、等级映射——**全部是默认模板**。
> 框架不写死任何一个；公司目录可整体替换为自己的字段与状态流（org-config.yaml 声明映射），
> 模板只是"开箱即用的建议"。

**已用**：issues CRUD/状态迁移/评论、articles 读写、issueLinks（Subtask/Relates）、customFields 写值、网关 wkey。**已探测可用、未接线**：activities 活动流（categories+epoch 游标，代码零引用，现网派单靠状态查询——F2-10 标注为新增实现）。

**可用未用（红利）**：
- `/api/agiles` + sprints（**注意：网上流传的 `/api/agileBoards` 是错的，实测 404**；本机零看板）
- 内置报表（issue 分布/Issues per Two Fields）、仪表板 widget、Gantt（依赖+容量，需补 Estimation 字段）
- 时间跟踪 workItems（本机已配 开发/测试/文档/调查/实现 五类）
- saved search 共享查询、站内通知订阅（不发邮件，正合宪章 §8）
- Hub API（`/hub/api/rest/users|usergroups`：12 用户/4 组）——`/api/groups` 对 agent 403，**用户/组/认证必须走 Hub**
- `/api/admin/customFieldSettings` schema 自省（字段/bundle/枚举可导出生成 TS 类型）
- on-schedule workflow 规则（纯改单/通知类定时活可交平台）

**确认没有**：webhook（所有路径 404，事件只能轮询）；角色权限写 API（`/api/assignedRoles` 只读，权限集改不了）；子项目（项目是平的）；on-remove 规则类型（只有 on-change/on-schedule/state-machine/action）；内置报表 API 导出（`/api/reports` 实测 []）。

**查询语法实测白名单**：`project:`、`字段: a,b`、`字段: -值`（无空格）、`#Unresolved`、`sort by:`、`created: a .. b`、`updated: today|{This week}`、`has: comments`、`issue id:`、中文字段名直接当键。实测 400：`-Field: v`、`{a b}` 多值 braces、`#Assigned to me`（与官方文档不一致，标注版本行为）。列表必须显式 `fields`+`order by`（缺 fields 只回 id，顺序不稳定）。

## 二、平台能扛 vs 框架扛（分工线）

**关键原则：平台只认自己字段里的数。** 成本/token/证据哈希/工号平台一律算不了——正解是「框架算 → 写回字段 → 平台展示」。workflow JS 是受限沙箱（发不了外网、起不了进程、跑不了 LLM），**唤起 worker 永远只能在框架**。平台 guard 必须由 ticket-types.yaml 同源生成，禁平台手改（防双真源）。

| 平台能扛（交出去） | 框架必须扛（留下） |
|---|---|
| 状态迁移 guard（第二道闸） | worker 唤起/杀/返工、派工决策 |
| 字段校验/预查字段级拦截 | LLM 预查、提示词分层拼接 |
| 报表/Gantt/工时表/仪表板/通知 | 成本与 token 记账、预算预留-结算 |
| on-schedule 纯改单定时活 | 15 岗中跑 LLM/shell 的全部岗位 |
| saved search 看板载体 | 证据落盘/哈希、SQLite 台账、工号人事台账 |
| 项目团队成员资格（有 API） | org 引擎分权、联签、config.yaml 公司即文件、沙箱、GitHub、对外 API |

**立即该兑现的红利**（不需等新框架）：
1. **guard 扩面**：POLY/GAMES 挂 `studio-state-guard`（实测仅 STUDIO 有，两家裸奔）
2. **第一块 Agile 板**：`/api/agiles` 实测为空——建板（列=State 序，泳道=部门）
3. **工时收编**：worker 完工按 work item 写回时长+类型，报告吃平台工时表
4. **saved search 固化**：`State: 待批`（批示积压栏）、`created: {minus 7d} #Unresolved` 等关键查询共享化

## 三、多公司多等级建模（N1-N12）

**设计判断**：YouTrack 没有子项目，能榨出层级的只有三杠杆——Subtask 链接（可跨项目）、OwnedBundle（值带 owner，天然"部门有人负责"）、Articles 树。免费版 10 用户已满（opengames+agent-1..9），**账号=等级锚点、工号=人**是永久决策。角色权限无法 API 化（实锤），平台权限=公司级粗隔离+一次性 UI 配置，细粒度分权留在 org 引擎+guard。人事档案不进 YouTrack（9 级数千人会拖垮查询与权限面）。

| # | 方案 | 要点 |
|---|---|---|
| N1 | **公司=一个 YouTrack 项目** | 短名=公司代号，单号 startingNumber 起；承载权限域+编号域 |
| N2 | 部门双模：默认 `mode=field`（OwnedBundle 值，owner=主管，直接当板泳道）；`mode=project` 为例外开关 | 两模式下 /company 组织视图输出同一 JSON schema |
| N3 | 字段分层：全局共享（等级/泳道/Type/Priority/attempt/验收命令）；公司级（State、部门 bundle 可写已实测） | 新公司不改旧公司 bundle，互不污染 |
| N4 | 等级升枚举 1-9 + 新增工号字段；`派单人` 改存工号（现存人名） | 存量不回填，渐进启用 |
| N5 | bundle 自动 provisioning 按名幂等（存在则复用+比 diff）；四级顺序固定，每级可 dry-run | 值只增不删，旧的置 archived |
| N6 | workflow 护栏按公司安装（复用 ytguard.GuardAdmin 三步法），guard 由 **ticket-types.yaml 同源生成**（经 statemachine 渲染；分权不进平台 guard，归 org 引擎，见 N8） | 该端点在 openapi.json 之外，需锁版本+回归 |
| N7 | 板自动化：`POST /api/agiles`，列=State 序，泳道=部门；**禁用工号当泳道**（9 级退化成数千行） | 2 级与 9 级同模板 |
| N8 | 权限两层：公司级隔离=项目团队（有 API）；等级分权不进平台角色（无 API），交 guard+org 引擎；6 内置角色映射 9 账号=一次性 UI setup 文档 | 产出"平台层能否拒绝 X"可执行断言清单 |
| N9 | 账号恒为等级锚点，不随公司新增账号。活跃 11 个中 **agent-pm 已拍板清除**（D13，2026-10-16）；PM 职能归九级体系内角色 | 任一单据 actor 可还原（公司,工号,账号,署名）四元组 |
| N10 | **`studio onboard` 从零实现**（现状零代码！）：config.yaml → 项目+bundle+字段+workflow+板+团队+KB 根+泳道注册+id 回写 | 空实例 5 分钟得到可用公司；`--dry-run`+幂等+`--rollback` |
| N11 | id 绝不落盘：只按名字解析内部 id（现状硬编码 0-1/0-2/0-3 不可移植） | 同一 config 在干净实例 onboard 成功且零新增常量 |
| N12 | 对外只暴露框架 API，YouTrack 是内部实现 | 外部零 YouTrack 凭据；9 账号零外部发放 |

**可复用零件**：ytguard.GuardAdmin（workflow 装卸实测可用）、yt.YT（建单/字段/链接/Articles）、evolve.py:256（enum bundle 加值）。
**缺的七项**（即 N10 工作面）：建项目、建 bundle、建/挂字段、建板、建团队、KB 根、幂等与回滚。

## 四、迁移期纪律

- 平台 guard JS 100% 由 schema 生成（Y2-3），新框架上线前先补挂 POLY/GAMES（不等 Studio Next）
- YouTrack 写入格式+文件产物格式纳入 contract 契约包（F2-14），双栈同为契约客户端
- 实体 id 三套并存（idReadable/数字 id/Hub uuid）在契约层显式建模转换
