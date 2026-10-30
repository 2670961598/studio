# StudioNext 重启 Runbook（v2 施工后）

> 2026-10-30｜性质：**启动/停机/回滚操作单**；不是生产就绪声明。当前 F8 已过；seatbelt 增量待 DSF；PB-3/PB-5 未过；API 只读面不齐。

## 一、启动前置

1. `node --version` ≥ v24（入口 fail-fast）；`bun --version` 1.4.x。
2. `bun install --frozen-lockfile`。
3. 公司目录已通过 `company validate`；`platform` 与 org-config 一致。
4. `daemon.yaml` 至少：`db`、`platform`、`company`、`companyDir`、`rootDir`。
5. 网关 secret：`STUDIO_GATEWAY_SECRET` ≥32B（或公司目录 demo 临时源）；不写进 yaml。
6. 无残留 `<db>.writer.lock`；有锁按 pid 判活，活锁拒启。
7. seatbelt 缺省 read-only。要真实派工写 workspace，显式加：
   ```yaml
   seatbeltTier: workspace-write
   seatbeltWriteRoots: '["/abs/ticket-root","/abs/dsh-home"]'
   seatbeltAuthorization: '谁/何单/何策略'
   ```
   必须绝对路径＋授权留痕；缺一项拒启。写根不得为 `/`、不得含控制字符；authorization 避免 ` #`（会被 YAML 行内注释截断）。

## 二、启动

```bash
# 真入口
bun run daemon -- --config var/daemon.yaml

# 或 CLI 同实现
mise exec -- node apps/daemon/src/cli/main.ts serve --config var/daemon.yaml

# 版本/用法
node apps/daemon/src/index.ts --help
```

预期：
- 启动行打印 executor 注册、读面缺口（issues/finance/reports/agentCard 503）、seatbelt 档位；
- API 缺省 `apiPort: 0`（临时端口）；要固定写 `apiPort: 8788`；
- 无 `--config` 只打印 usage 并 exit 1，不假装常驻。

## 三、健康检查

```bash
curl -s http://127.0.0.1:<port>/api/v1/company
curl -s http://127.0.0.1:<port>/api/v1/org
curl -s http://127.0.0.1:<port>/api/v1/people
curl -s http://127.0.0.1:<port>/api/v1/projects
```
- 以上 4 面应有投影；issues/finance/reports/agentCard 当前 **503**（不得补 0/空冒充）。
- 触发面 partner/signed 凭据未装配时 **401**；LAN 缺省未开。

## 四、停机/回滚

- `SIGINT`/`SIGTERM`：先关 API → stopAll → 在途 drain → 关台账；writer lease 释放。
- 台账异常：不得手工删 `*.writer.lock` 除非确认 pid 已死；用 `ledger rebuild`（writer 围栏）重建投影。
- 代码回滚：checkout tag `v2-f8-passed` 或 `v2-seatbelt-delta`（后者含 seatbelt 增量）。

## 五、当前已知限制（不得当生产就绪）

- API 只读 4 面；finance/issues/reports/agentCard 无源 503。
- OPS：REC-WORK-18 只落记录，不执行停注入/杀树/吊销。
- PB-3/PB-5 未通过；PRB-23/PRB-13 not-executed；PRB-04 实际拦截未证。
- seatbelt 配置通道已落，但实际内核拦截未证；符号链接/绝对路径边界按不支持处理。
- V2 版本轴仍 draft；final 待制作人明示。

## 六、最小启动结论

本地/demo：可启动。
生产派工：需 seatbelt 写根授权、API 凭据/读源、PB 与 OPS 面收口；当前不能称生产就绪。
