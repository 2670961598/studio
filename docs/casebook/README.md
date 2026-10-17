# 案例库（casebook）——目录约定

> 依据：docs/20-§十一「事故：发现→止血→复盘（挂复盘单）→案例库；**复盘不追责，追流程**」；
> docs/04-§二（公司目录 `docs/` = 规范/知识/案例）；docs/05-§二（工作知识=YouTrack Articles——
> v0 先落 git 目录，kb 化归后续刀）。

## 条目形状

- 文件名：`<YYYY-MM-DD>-<slug>.md`（slug=字母/数字/中日文/连字符）
- 条目四节：**现象 → 根因 → 解法 → 预防**（20-§十一 案例库结构，对齐旧系统知识库同名结构）
- 根因只分三类：流程缺口 / 环境因素 / 判据失误（**无「责任人」字段——不追责的结构保证**）
- 预防措施每条带出口标签：进案例库 / 进判据 / 进规程
- 条目文件 = 案例条目（检索面）+ 完整复盘单（审计面）自包含
- 台账留痕：每条案例对应一条 POSTMORTEM 事件（`events.note`=条目约定相对路径、
  `size`/`payload_hash`=文件字节与内容指纹）

## 归属定夺（拟批口径）

| 层 | 路径 | 说明 |
|---|---|---|
| **公司目录（正式归属）** | `<company>/docs/casebook/<date>-<slug>.md` | 复盘是公司运营产物，归公司目录；git 历史=案例演进史（04-§二「git 历史=组织变迁史」） |
| **框架级（本目录，v0 演示）** | `docs/casebook/<date>-<slug>.md` | 框架自身事故的自举案例（吃自己狗粮）；daemon 服务真公司时写公司目录同构子路径（`--casebook` 指根即可） |

## 写入方式

```
studio-next postmortem --db <库> --company <slug> --issue <复盘单号> \
  --input <复盘.json> --casebook <案例库目录> [--slug <slug>] [--date <YYYY-MM-DD>]
```

链：断路器关联（该单 CIRCUIT_BREAK/ESCALATE 台账历史自动进时间线）→ 渲染复盘模板
（七节；无「责任人」字段）→ 写案例条目文件 → 落 POSTMORTEM 事件。实现与形状闸见
`apps/daemon/src/postmortem.ts`。
