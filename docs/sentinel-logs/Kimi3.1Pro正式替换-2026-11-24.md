# Kimi 3.1 Pro 正式替换（制作人令 2026-11-24 16:2x）

## 一、指令
「可以的，把 kimi3.1pro 替换掉吧」——Kimi 3.1 Pro 周额度耗尽（weekly limit，真实派发 429 实测）后，正式从档位路由中替换。

## 二、替换后档位（已热切生效）
- **high = GLM-5.3**（主源，priority 10）+ **GLM-5.3-Flash 兜底**（priority 20）；
- **mid = GLM-5.3**；**low = GLM-5.3-Flash**；tierExecutors 全 `dsh`（high 走 dsh 执行器）；
- 热切日志：`[models-hot-swap] 已热切：high=glm/GLM-5.3、mid=glm/GLM-5.3、low=glm/GLM-5.3-Flash；…`（daemon 20575，健康）。
- 备份：`~/.config/studio-next/models.yaml.bak-replacekimi-*`（含 Kimi 源，回滚用）。

## 三、Kimi 相关资产处置（保留休眠能力，不作默认源）
- `kimi-coding` provider（DSH）+ `scripts/ops/kimi-token-refresh.mjs` + 注入面代码：保留，**不进入任何档位路由**（high 不再选 Kimi）；
- Kimi CLI executor：agent.yaml 中保留注册但无档位使用（成本 0，仅运维可见）；
- 恢复路径：Kimi 周额度恢复后，还原 `models.yaml.bak-replacekimi-*` 或把 `kimi-pro` 源加回 high 首位，热切即生效（无需重启）。

## 四、评测依据
- 业务向 benchmark（6 任务，judge=GLM-5.4）：GLM-5.3-Flash 6/6、GLM-5.3 5/6（judge 9.6 最高）、Kimi 5/6（146s 偏慢）；Kimi 仅在额度充足时才具竞争力，且本次耗尽订阅额度影响生产——替换为 GLM 系最稳。
- t03 判定器 bug 仍待修正（与本次替换无关）。

## 五、待办
- token 源后续由制作人决定（Kimi 买额度/恢复后重评、Go Extra Usage 等）；
- Kimi 恢复后可做一次 high 档真单 GATE_PASS 验证再决定是否回切。
