# Provider 密钥使用政策（Kimi / GLM / opencode-go / DeepSeek 官方）

> 状态：**已定稿（task-101，2026-11-17 制作人令）**。本文件只规定密钥与提供方使用边界；不包含任何密钥值。
> 事实源：制作人 2026-11-17 令 + `docs/quality/model-routing.md` + KimiCode/GLM/opencode-go 接入记录。

## 1. 角色—提供方矩阵（冻结）

| 档位/用途 | 提供方/执行体 | 凭据类别 | 规则 |
|---|---|---|---|
| **high**（verifier/judge/攻坚） | **KimiCode**（本机 `kimi` executor，独立额度） | KimiCode OAuth/本机登录 | 只走本机 KimiCode；不把 Kimi 塞进 opencode-go 的模型别名 |
| **mid**（main_worker/主力） | **GLM**（Zcode coding plan） | `GLM_*`/Zcode 订阅 | 按 models.yaml 档位配置；禁止混入官方 DeepSeek key |
| **fallback**（冷备/降级） | **opencode-go**（订阅套餐，含 `opencode-go/deepseek-v4.1-flash`） | `OPENCODE_GO_API_KEY`（套餐） | 允许作 fallback；`opencode-go/deepseek-*` 是套餐模型，**不是** DeepSeek 官方 API key |
| **仅制作人 DSH 对话** | **DeepSeek 官方 API** | `DEEPSEEK_API_KEY`（`~/.dsh/.env`） | **只允许制作人在其 DSH 对话/DSH Web 中使用**；框架/公司/worker/CI/备份/计划任务一律禁用 |

## 2. 关键定义（避免把套餐与官方 key 混为一谈）

- **DeepSeek 官方 key**：`DEEPSEEK_API_KEY`（`api.deepseek.com` 直连）；只属于制作人 DSH 配置（`~/.dsh/.env`、`~/.dsh/.credentials.yaml`），不得出现在框架仓、公司目录、launchd env、worker 环境或任何派发命令中。
- **opencode-go 套餐模型**：`opencode-go/deepseek-v4.1-flash` 等，凭据=`OPENCODE_GO_API_KEY`（订阅），按价目/额度计费；可作为允许的 fallback。审计时按 **model 前缀**区分：`deepseek/`（官方）vs `opencode-go/`（套餐）。
- **KimiCode**：本机 `~/.kimi-code` OAuth/配置，独立额度；与 opencode-go 的 `kimi-*` 模型别名不是同一通道。
- **GLM**：Zcode 订阅 key；`glm/GLM-5.3`、`glm/GLM-5.3-Flash` 属允许通道。

## 3. 允许/禁止（红线）

**允许**
1. 制作人在其 DSH 对话/DSH Web（`~/.dsh`）中使用官方 DeepSeek key 及其 Search/Fetch 插件；不复制、不外发、不写入仓/公司/日志。
2. 框架使用 KimiCode（high）、GLM（mid）、opencode-go（fallback）——凭据只能来自各自允许的配置面。
3. `opencode-go/deepseek-*` 作为 fallback（订阅套餐，价目按 models.yaml）。

**禁止**
1. 任何 daemon/worker/executor/子进程继承或读取 `DEEPSEEK_API_KEY`、`api.deepseek.com` 直连凭据；
2. 公司 `daemon.yaml`/`agent.yaml`/`models.yaml`、launchd plists、boot/wrapper 脚本、CI、备份/报表脚本出现官方 key 或官方 DeepSeek provider/model（`deepseek/*`）；
3. 通过 `TaskBrief.credentials` 或其他注入通道向 worker 传官方 key；
4. 把官方 key 写进提示词、任务书、工位、台账、事件 note、日志、截图或工单；
5. 在 worker 共享 `DSH_HOME`/`~/.dsh` 时让 dsh 子进程自动加载制作人 `.env`（见 §5 风险）。

## 4. 审计方法（只读；不打印值）

1. **配置文件键名**（只看键/路径，不输出值）：
   ```sh
   grep -E '^[A-Z0-9_]+=' ~/.dsh/.env | cut -d= -f1 | sort
   COMPANY_ROOT=<companiesRoot>   # 本机公司根，不在文档写死路径
   grep -RIlE 'DEEPSEEK|api\.deepseek\.com' ~/.dsh ~/Library/LaunchAgents \
     "$COMPANY_ROOT"/*/daemon.yaml "$COMPANY_ROOT"/*/agent.yaml 2>/dev/null
   ```
   预期：官方 key 只出现在 `~/.dsh`；launchd/公司 live 配置 0 命中（注释/历史记录除外）。
2. **进程 env 键名**：用宿主等效 `ps eww`（或本机 sysctl KERN_PROCARGS2）取键名，检查 `DEEPSEEK_*`；不得打印值。
3. **派发链**：`TaskBrief.credentials` 调用点应只有 `STUDIO_TOOLS_WKEY`；dsh adapter 的 env 白名单/DSH_HOME 见 §5。
4. **账目**（近 7 日）：SQLite `work_records.model`/`usage_daily.model`；
   - 违规标志：`model LIKE 'deepseek/%'` 或 `model LIKE 'deepseek-%'`（官方）；
   - 允许：`glm/%`、`opencode-go/%`（含 `opencode-go/deepseek-*`）。
5. **凭据清单**：launchd `EnvironmentVariables` 只允许 PATH/HOME/DSH_TELEMETRY 等运行键；发现 `DEEPSEEK_*` 即停。
6. **周期**：每次部署/换 provider 必查；至少每周一次；证据落只读报告（不落 key）。

## 5. 2026-11-17 审计结论与已知风险

- 初查+复核：daemon 进程 env 无 `DEEPSEEK_*`；launchd 无 DeepSeek env；公司 live 配置无官方 key/provider；近 7 日 dev/profit/workbench/pilot 的 `work_records`/`usage_daily` **0 条官方 `deepseek/` 模型**（仅 `glm/*` 与 `opencode-go/deepseek-v4.1-flash` 套餐）。
- **风险（需实现单收口，不在本单改码）**：
  1. dsh adapter 的宿主 env 白名单允许 `DSH_*`（`packages/adapters/src/dsh/basics.ts`），且 dsh 默认 `DSH_HOME=~/.dsh`；dev/profit/workbench 的派发写域包含 `~/.dsh`，未配置 per-attempt `dshHomeRedirect`。worker dsh 可能加载制作人 `~/.dsh/.env` 的 `DEEPSEEK_API_KEY`（官方 key 暴露面，即使当前模型路由未用官方模型）。
  2. `DEEPSEEK_API_KEY` 仍在 dsh credentials 键域枚举中（`basics.ts`），结构上允许 `TaskBrief.credentials` 注入（当前调用点只注入 `STUDIO_TOOLS_WKEY`）。
  3. `~/.dsh/profiles/headless/cordis.patch.yml` 的 web Search/Fetch 插件使用 `DEEPSEEK_API_KEY`；这属制作人 DSH 通道，但 worker 若共享同一 DSH_HOME 即越界。
- **最小修复方向（建议另立实现单）**：派发前强制 per-attempt `DSH_HOME` 到工位隔离目录（不继承制作人 home），只注入所需 profile/模型订阅凭据；从 credentials 键域移除 `DEEPSEEK_API_KEY`；spawn 前断言 worker env 无 `DEEPSEEK_*`；`~/.dsh` 不进入 worker 读/写面。未完成前，按本政策将共享 DSH_HOME 派发视为**待收口风险**（不作为已合规宣称）。

## 6. 违规处置

1. **立即停止**相关派发/服务（不杀在途 worker 以外的生产；守红线）；
2. **轮换**受影响官方 key（制作人执行；不打印、不入库、不贴聊天）；
3. 清理泄露面（env/plist/公司配置/工位/日志/备份），保留只读证据（键名/路径/计数，不存值）；
4. 记 `ESCALATE`/审计事件（沿用既有事件词，不新增契约），报告制作人；按事故流程复盘；
5. 复核通过（重跑 §4）后才可恢复；违规记录不得删除。

## 7. 周期性检查建议

- 每次部署/换 provider/改 DSH 配置后：§4 全项；
- 每周一：daemon env 键名 + launchd + 公司 live 配置 + 近 7 日 model 前缀；
- 每季度：密钥轮换与恢复演练（与 `docs/quality/backup-restore.md` 的季度演练同窗）。
