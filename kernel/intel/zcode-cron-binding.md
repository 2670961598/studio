# 平台实测：ZCode 定时任务与会话的绑定关系（2026-09-15 实证）

来源：~/.zcode/v2/logs/2026-09-15.log 中 zcode-task-service 的 sendPrompt 记录 + rollout 会话文件交叉验证。置信度：高（直接日志证据）。

## 事实

1. **定时任务绑定创建它的会话**：调度器到点后把 prompt 用 `sendPrompt` 投回创建该任务的那个会话（taskId = 创建会话的 sessionId），**不开新会话**。
2. **一会话一任务**：已绑定定时任务的会话不能再创建第二条（报错 "Cannot create a scheduled task inside a session that already belongs to a scheduled task. Ask the user to start a new chat"）。
3. **会话忙则排队**：目标会话正在执行长轮次时，tick prompt 排队等待，轮次结束后才送达执行（实证：子PM cron 三连派发零副作用，因为宿主会话在忙；锁/心跳/日志均无痕迹，任务本身无故障）。
4. **副作用链路依赖宿主会话闲置**：PM/QA 的"每 N 分钟 tick"实际节奏 = max(N, 宿主会话当前轮次耗时)。

## 对宪章的影响（建议开内部改进单修订）

- §0 解法"每个子 PM = 一个独立定时任务会话"成立的前提是：**每个子 PM 的 cron 必须在一个专用对话里创建**（对话即会话即执行体）。主聊天室不要兼任任何 cron 宿主，否则交互轮次与 tick 互相排队。
- §4 错峰表需补一列"宿主会话"；新编制（日报官/Inspector/Scout/版本日官）每岗各需一个新建对话来落地 cron。
- 长跑会话上下文会持续膨胀（实证：旧 PM 会话单轮输入已 51 万 token，QA 会话 26 万），依赖上下文压缩续命；专用对话 + 薄剧本是成本底线。

## 关联风险（同日发现）

- 旧 PM cron（旧工作区会话）锁名为 `tick`，新子 PM 剧本锁名为 `tick-POLY`：**两者互不互斥**，双活期间同一板面可能被两套剧本交替处理。切换期应尽快下线旧 cron。
