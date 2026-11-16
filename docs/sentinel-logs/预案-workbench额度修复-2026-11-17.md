# 预案：workbench（插件公司）额度阻塞修复（2026-11-17）

> 只读诊断+待批预案；**未改它司配置/未重启其 daemon**。触发：OPENCODE Go 5h 额度（今日 7 次 429，LOCAL-80 熔断→LOCAL-81）。

## 一、根因（证据）
- workbench `agent.yaml` 只注册 `dsh`（default），cmd 仅 `--patch .../dsh-bridge-overlay.yml`，**无 dsh-high/mid/low 档位执行位、无档位 overlay**；
- 其 `work_records` 53 条模型全=`opencode-go/deepseek-v4.1-flash`（DSH profile 缺省模型）→ 命中 OpenCode Go 5h 上限；
- 对比 studio-dev `agent.yaml`：有 `dsh-high`（`--patch dsh-tier-high.yml`→GLM-5.3）/`dsh-mid`/`dsh-low`，档位路由命中 GLM，故 dev 今日 429=0。

## 二、选项（需制作人批）

### A. 补档位执行位（推荐，切换主力到 GLM；成本上升）
1) 备份 `workbench-dev/agent.yaml` → `.bak-<ts>`；
2) 在 `executors:` 下补（路径与 dev 同构、指向 workbench 自己的 var/tmp）：
```yaml
  dsh-mid:
    version: "0.2.1-rc.5"
    cmd: [dsh, --profile, headless, --patch, <wb>/var/tmp/dsh-bridge-overlay.yml, --json]
    capabilities: { session_resume: true }
  dsh-high:
    version: "0.2.1-rc.5"
    cmd: [dsh, --profile, headless, --patch, <wb>/var/tmp/dsh-bridge-overlay.yml, --patch, <wb>/var/tmp/dsh-tier-high.yml, --json]
    capabilities: { session_resume: true }
  dsh-low:
    version: "0.2.1-rc.5"
    cmd: [dsh, --profile, headless, --patch, <wb>/var/tmp/dsh-bridge-overlay.yml, --patch, <wb>/var/tmp/dsh-tier-low.yml, --json]
    capabilities: { session_resume: true }
```
3) 重启其 daemon：kill node pid（wrapper `while true` 5 秒内自动重启；当前无在途、安全）；确认新 pid/日志；
4) 验证：`work_records.model` 变为 `glm/GLM-5.3`（main_worker=mid 映射 global models high/mid=GLM-5.3）、无 GoUsageLimit、tick 前进；
5) 回滚：恢复 agent.yaml 备份 → 同样 kill node 让 wrapper 重启。
- **成本影响**：主力从 DeepSeek Flash（约 $0.006/单）切到 GLM-5.3（约 $1.3/单）——与其"本轮全部 DeepSeek Flash"定调冲突，需制作人拍。

### B. 保持 DeepSeek Flash 路线
- 等 5h 重置（02:10 已重置，但 ticket 停在`新单`，需要其公司流程放行/重试——非我们控制）；
- 或开 **Extra Usage**（付费，opencode.ai console 对应 org），可立即继续。

### C. 中期
- 部署模型路由切片2（`64ddb2f`，未部署）→ workbench 的 models 配第二源高/低档 → 自动 failover；需重启其 daemon 加载新代码 + 改全局 models.yaml（影响 dev，需备份+审批）。

## 三、当前状态
- LOCAL-80=`新单`（熔断后不自动重试，其 autoApprove:false）、LOCAL-81=bug=`新单`；
- 5h 窗口 02:10 重置后无新事件（需人工/其公司流程推进）；
- 我们未做任何改动。

## 四、建议
首选 **A**（插件是主路线，额度卡死代价更高；GLM 成本可接受），或先 **B 开 Extra Usage** 过渡、再择机 A/C。请制作人拍板后由 Lead 派单执行（改它司配置需明确授权）。
