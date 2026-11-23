# Kimi 3.1 Pro 默认化 + Kimi 接入 DSH（2026-11-23）

## 一、制作人令（2026-11-23）
「将 Kimi3.1Pro 作为 Kimi 的默认 coding 模型」「如果能先用就先用上」「Kimi 不能接入 DSH 吗？能接的话，就别 KimiCli 了」。

## 二、已执行（Lead）
- `~/.kimi-code/config.toml`：`default_model: kimi-code/kimi-for-coding → kimi-code/k3.1-pro`（备份 `config.toml.bak-pre-k31pro-20261123-*`）；
- 验证：真实调用后 wire `model=kimi-code/k3.1-pro`；CLI 会话正常；
- **DSH PoC**：`~/.dsh/profiles/headless/cordis.patch.yml` 增加 provider `kimi-coding {apiKeyEnv: KIMI_API_KEY}`（备份 `cordis.patch.yml.bak-kimi-poc-*`）；用 `--patch` overlay（agent-default-model: kimi-coding/k3.1-pro）+ `KIMI_API_KEY=<OAuth access token>` 实跑 `dsh --profile headless --json` → exit 0，回答「可用」。
- 结论：**Kimi 可作为 DSH 模型源运行，KimiCode CLI 执行器非必需**。

## 三、迁移方案（worker 施工中）
1. token 刷新器：refresh_token 直连 OAuth token 端点（不调 kimi CLI）→ 0600 token 文件；
2. dispatch 前注入 `KIMI_API_KEY`（dsh worker env；不落日志/台账）；
3. `models.yaml` high 档加源 `kimi-coding/k3.1-pro`（订阅制边际成本 0）；`tierExecutors.high: kimi → dsh`；
4. 退役 Kimi CLI 执行器（公司 agent.yaml 去 kimi；适配器 deprecated，代码保留回退）。
- 凭据策略：制作人选择 **A：复用现有 kimi-code 凭据的 refresh_token 自动刷新**（暂不重登；后续可补 DSH 原生 OAuth 设备码登录实现完全脱钩）。

## 四、回退
- 还原 `config.toml` 备份 → Kimi CLI 默认模型回 kimi-for-coding；
- 还原 `models.yaml` 备份 + `tierExecutors.high=kimi` → 高配档回 Kimi CLI；
- DSH profile patch 删除 kimi-coding provider 行（备份在）。
