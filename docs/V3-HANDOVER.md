# V3 运维交接文档（StudioNext 团队参考）

> 制作人 2026-10-19 定则：V3 冻结新功能，仅做 bug 修复+进程守护。新功能/新主意转 SNEXT 开发。
> 本文档汇总 V3 的架构决策、已知坑、未完成想法，供 SNEXT 团队参考。

## 一、V3 已交付能力（全部在产运行）

| 能力 | 实现位置 | 状态 |
|---|---|---|
| 九级组织架构（org.yaml） | kernel/org.yaml | ✅ 运行中 |
| 四维审批引擎（engine: org） | studio/approval.py | ✅ 已切权 |
| 全流程逐环签字（等级≥4） | studio/signoff.py | ✅ |
| 联签协议（跨部门） | studio/approval.py | ✅ |
| 团队升级流程 | studio/orggov.py | ✅ |
| HR 四要素注入+知识三节 | studio/workers.py | ✅ |
| 管家岗哨 | studio/steward.py | ✅ |
| 巡逻源预取 | studio/patrol.py | ✅ |
| 巡逻出生自带编制 | studio/patrol.py + ytgw.py | ✅ |
| token 成本记账 | studio/llm.py | ✅ |
| 四 dailies 岗 | studio/daemon.py | ✅ |
| 制作人门户（框架层） | static/index.html | ✅ |
| zcode-plan 端点（×0.67） | workers.py wrap 模板 | ✅ |

## 二、未完成/有价值的想法（转 SNEXT）

1. **公司层门户**（STUDIO-114 设计）：制作人定则"公司≠公司框架"——项目页=公司（进度/报告/人事/财务），框架数据收运维层。设计文档在 114 单评论。
2. **1-9 级升级门槛**（STUDIO-111 设计）：量化信号+采集代码化+日报面板。设计在 111 单描述。
3. **CLI 多执行器**（STUDIO-110/117 调研数据）：
   - zcode ×0.67 倍率已切（wrap 模板一行 export）
   - DSH 调研报告 /tmp/dsh-survey.md（多 agent 编排/OS 沙箱/Unity 桥接）
   - zcode CLI 六面验证数据在 110 单评论
4. **worker 上下文瘦身**（108 成本报告建议）：97% 输入是历史重放，三刀（拆小单/断点续跑/注入减薄）预估日省 50%
5. **flash 超时熔断**：flash 端点不稳（日 100+ 次超时白烧），建议连续 3 次超时后自动停用 30 分钟
6. **GAMES 日预算上限**：85% 消耗来自 GAMES，建议设 $40/日封顶
7. **GAMES L2→L3 升级**（GAMES-134 方案在途）：两条升级讯号全中（153 会话均 608 万 token/累计交付 114 张）

## 三、已知坑与运维要点

| 坑 | 症状 | 解法 |
|---|---|---|
| YouTrack 容器重建 | API 全 404（Spring 端点消失） | docker restart + Configuration Wizard 手动恢复；数据卷 /Users/xieqingxin/youtrack/data |
| daemon web 线程死锁 | 面板 8787 超时但 tick 正常 | pkill daemon（无活 worker 时安全），看护 30s 拉起 |
| GATE_DANGER 子串误杀 | 文件名含 "eval" 拒跑 | 改用词边界匹配（待修） |
| 巡逻岛 /tmp 清空 | FileNotFoundError 瞬败 | ask() 已加 mkdir 自愈（STUDIO-106） |
| YouTrack 搜索索引滞后 | 新单 1h+ 才被扫到 | 板面级特性，非 bug；等索引追上 |
| npm 安装卡死 | npm install 挂 >10min | 加 --fetch-timeout=60000 重试 |
| flash 端点超时潮 | 120s TimeoutExpired 每拍 1 条 | 无熔断，属上游问题；建议加熔断 |

## 四、V3 运维原则（继续有效）

1. 状态是唯一控制面（YouTrack 状态驱动一切）
2. 绝不杀活 worker
3. 完成只认落盘证据
4. 验证闸（一切改动先沙箱验证）
5. 项目仓永不自动 push
6. 宪章与红线的修改只认制作人

## 五、凭证与端口速查

| 服务 | 端口 | 凭证 |
|---|---|---|
| YouTrack | 8080 | ~/.config/polymatch3/youtrack.json |
| daemon 面板 | 8787 | ~/.config/polymatch3/panel-token |
| 游戏平台 | 4399 | 无需认证 |
| GLM Coding Plan | — | ~/.claude/settings.json（ANTHROPIC_AUTH_TOKEN） |

