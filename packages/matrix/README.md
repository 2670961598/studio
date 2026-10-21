# @studio-next/matrix

Matrix 集成 v0.1（IM 泳道第一切片）。协议依据：`docs/21-协作通讯-Matrix.md`、`docs/22-唤起源与解耦.md`、`docs/25-端口与协议.md`（§3.4 invoke / §4.2 notifier）。

## 本切片范围

| 层 | 文件 | 内容 |
|---|---|---|
| 纯核心（零 IO） | `src/mentions.ts` | @唤醒解析器：`m.room.message` → 零或多条 `InvokeIntent(kind='mention')`；识别两路互补（105-刀A A-4）：正文词元路（@工号默认样式 `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$` 可配、@角色词映射表、完整 MXID 按工号段）+ `m.mentions.user_ids` 结构化提路（pill 点选，正文可无 @ 词元；localpart 原文/大写两试过同一解析面；bot 自身与发送者本人不算唤醒）；防误报：围栏代码块 / 引用行 / 行内代码 / 词中缀 @（邮箱）/ 非 `m.text` 一律不唤起；同消息同对象两路去重。dedupKey=eventId 源侧设置（105-刀A A-1，21A-§5.10 勘误后口径） |
| 纯核心（零 IO） | `src/format.ts` | `Notification` → Matrix 文本（kind 前缀 + 标题加粗 + 链接转 markdown） |
| 薄网络层 | `src/client.ts` | Matrix CS API 最小客户端：`login(password)` / `sendMessage(roomId, text, {mentionedUserIds?})`（发送侧恒写 `m.mentions`：空对象或 `user_ids`，A-4）/ `sync(since?, timeout?)`；429 限流礼让：读 `retry_after_ms` 等待后重试一次（缺省 2000ms、上限 30s 封顶；再 429 抛错走调用方退避——F4）；注入式 fetch（默认 `globalThis.fetch`），零 npm 依赖、不引 SDK；`SyncResponse` 只建模消费字段 |
| 适配 | `src/adapter.ts` | `createMatrixNotifier`（send → format → sendMessage）与 `createMentionSource`（start(emit) 轮询 sync → mentions 解析 → emit；节奏默认 3000ms，出错指数退避翻倍封顶 60s、成功复位；增量 sync 空闲期长轮询 timeout=`syncTimeoutMs` 默认 25000ms——只改请求参数，节奏与退避语义不变，A-4；stop() 清 setTimeout 链干净终止）。首拉只建基线（timeout=0），历史消息不当唤起（防重放）；自发消息过滤（防回声） |

测试：51 例全绿（mentions 31 / format 5 / adapter+client 15），网络层用注入 fake fetch 回放预造 JSON，不真实联网。

## 未做事项与升级路径

- **真实 homeserver 集成**：待 Synapse 部署后跑 fake/真实双环境回归 → 升级为按 25-§六.5 过 stable 前置条件补齐
- **Synapse 部署**（21-§五：docker、127.0.0.1:8008、数据在外置盘）：归运维切片，不在本包
- **token 持久化**：凭据只在进程内存，重启重登 → 升级路径：daemon 侧密钥管理（凭证永不入库；密码经 env 注入，见 apps/boot 组合根）
- **E2EE 加密房间**：不支持（v0.1 依赖本机未加密部署）→ 升级路径：如需再评估 vodozemac
- **alias → room_id 解析、v3 filter、m.mentions 富标签（formatted_body/pill 渲染）**：未实现 → 升级路径：client.ts 逐个补端点，纯核心不动
- **Notifier 级别→频道路由与 mentionedUserIds 组装**：归 105-刀B notify 端口接线单（本包已备发送面参数）
- **契约 cases**（invoke/notifier 端口冒烟 case 进 `packages/contract` cases.json）：待 lane/main 契约 runner 就位后回填

## 纪律备注

- 源只产意图，绝不直接驱动 worker（22-§一）；频道内容按不可信输入对待（21-§三）
- `Notifier.send(channel)` 的 channel 语义 = room_id；角色词映射与房间白名单随公司实例配置（每公司一个 source/notifier 实例）
- 本包被组合根（apps/boot）装配进 daemon——daemon 本体不 import 本包（25-§一.2 依赖方向）
