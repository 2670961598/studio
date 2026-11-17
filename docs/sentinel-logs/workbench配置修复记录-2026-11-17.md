# workbench 档位执行位修复记录（2026-11-17；制作人批 A；先写配置后重启）

## 一、决定（制作人 10:59 裁）
- workbench 有在途 LOCAL-82（dsh pid 91037，30+ 分钟无进展，疑似额度重试卡住）；
- 按"不杀活 worker"红线：**先写配置不重启，等 LOCAL-82 自然结束后再由 Lead 重启加载**。

## 二、配置变更（已写盘，未加载）
- 备份：`<companyDir>/workbench-dev/agent.yaml.bak-tierfix-20261117-105937`（旧 sha256 `c36ca77362…b35d4d`）；
- 新文件：`<companyDir>/workbench-dev/agent.yaml`（sha256 `bca3a6ecc2…52f4d0f`）——在原 `dsh` 外补 `dsh-mid`/`dsh-high`/`dsh-low`（bridge overlay + tier overlay；同 dev 同构）；
- 生效条件：daemon `reloadWatch=false` → **必须重启**才加载；当前 daemon 仍用旧配置/旧 overlay（`dsh-tier-mid.yml` 仍为 opencode-go/deepseek-v4.1-flash）。

## 三、后续（待执行）
1. 等 LOCAL-82 自然结束（或超时）→ Lead kill workbench node（wrapper 5s 自动重起）→ serve 启动重生成 `dsh-tier-*.yml`（当前全局 models.yaml：high/mid=GLM-5.3、low=GLM-5.3-Flash）；
2. 验证：新 worker `work_records.model=glm/GLM-5.3`、无新 GoUsageLimit、tick 前进、health/日志无 preflight 错误；
3. 若失败：恢复 `agent.yaml.bak-tierfix-20261117-105937` 再 kill node 重启。

## 四、证据
- 备份/新文件 sha256 如上；diff=新增 3 个 executor 段；未重启前 daemon 61799/dsh 91037 仍在。
