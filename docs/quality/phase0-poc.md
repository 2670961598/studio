# Phase0 离线 PoC —— vendor workbench-core（task-63 切片1）

> 制作人 2026-11-17 批复：Workbench 代码归我司、可 vendor；Phase0 先做「单子+聊天室改造可行性 PoC」，
> 不做 service/sidecar 实现。本切片只落 vendor 快照+provenance+薄包装冒烟；10 单迁移 diff/mention→wake
> 由后续 task-64 交付。零生产/Docker/Taiga/Matrix 连接；Workbench 仓库未改。

## 1. Vendor 快照

- 路径：`vendor/workbench-core/{issues,collab}`（来自 `<workbenchRoot>/packages/{issues,collab}` 源码快照）。
- 快照：Workbench `verification/snapshot.txt` final 2026-11-11T10:07:34Z，Node `v25.6.1`；
  `@studio-next/issues 0.1.0`、`@studio-next/collab 0.1.0`。
- 授权/许可：制作人 2026-11-17 批复“归我司、可 vendor”；上游无 LICENSE 文件，按授权声明再分发并保留来源；
  详见 `vendor/workbench-core/PROVENANCE.md`（含树 sha256 与逐文件 sha256）。
- 变更：逐字节拷贝；仅 `collab/README.md` 两行本机绝对路径替换为 `<workspaceRoot>`（避免仓内 host path）。
  未 fork 业务代码、tests/README 随快照保留；不依赖 `node_modules`（Node 内置 `node:sqlite` 等）。
- 薄包装：`vendor/workbench-core/index.ts` 只 `export * as issues/collab`，不依赖宿主路径/StudioNext/DSH/网络。

## 2. 冒烟（thin wrapper smoke）

```sh
node --experimental-strip-types scripts/qa/phase0-vendor-smoke.ts
```

覆盖：issues 创建 principal/project/ticket/comment + get 回读；collab 创建 actor/group room + directed mention
send + list messages + markRead。实际输出（2026-11-17）：

```json
{"ok":true,"vendor":"workbench-core","issues":{"ticketId":"tkt_…","key":"PH0-1","stateCode":1,"comments":1},"collab":{"roomId":"…","seq":1,"roomSeq":1,"mentions":["…"],"unreadAfterRead":0},"hostPathDependency":false}
```

## 3. 门禁/证据

- `tsc -p vendor/workbench-core/issues/tsconfig.json`、`collab/tsconfig.json` → exit 0；
- `bun run typecheck` → 0；`node scripts/scan-repo-secrets.mjs --json` → newHits=0；
- scratch 纯树 `verify:v2` exit0（记录于交付日志）；
- 不新增 host 路径/密钥；不改 `packages/contract`/daemon 生产代码。

## 4. 切片边界/后续

- 本切片=可行性证明（vendor 可编译、可 import、薄包装冒烟、来源/授权可审计）；**不实现** service/sidecar、
  不改 daemon、不替代 Taiga/Matrix。
- task-64：10 张真实单迁移 diff/ID/external_ref + collab mention→wake（relay/lease/ack 薄适配与 P1 缺口）。
- 已知限制：vendor 快照是冻结拷贝，升级需整目录替换+PROVENANCE 更新；上游无正式 LICENSE，授权记录见上。

## 5. 切片2：10 单迁移 diff（task-70 返工后）

只读生产台账 `ticket_mirror` 导出 10 张真实单（多状态/部门/父子覆盖；台账无 title/description/comments 表，显式 gap）：

```sh
node --experimental-strip-types scripts/qa/phase0-ticket-migration.ts \
  --ledger <production-ledger.sqlite> --out /tmp/phase0-evidence
```

结果（证据 `docs/quality/phase0/`）：
- 10/10 导入 vendor issues；externalRef↔vendor key **roundtrip 10/10 true**；
- **state matched 10/10**：按 vendor 矩阵逐单重放 T1→T2→T3→T6→T7（assignee/reviewer、summary/report evidence、T7 前按当前 revision 落 daemon gate verdict）；`ticket-diff.json` 每单含 `stateAttempts[]`（tried target/ruleId/from/after/errorCode/details），无 stateExemption；
- type/dept/level/lane/assignee/parent 元数据写 labels/body；parent 在选集中父先子后传递；
- comments=0（生产台账无评论表，显式 gap）；attachments=not-migrated（显式）；title/description 台账无字段，合成并记录 gap；
- 逐单 diff 见 `docs/quality/phase0/ticket-diff.{md,json}`。

## 6. 切片2：collab mention→wake（task-70 返工后）

```sh
node --experimental-strip-types scripts/qa/phase0-collab-wake.ts --out /tmp/phase0-evidence
```

结果（`docs/quality/phase0/collab-wake.{md,json}`）：broadcast/group/DM 三通道均建并发送；
directed mention/mentionAll 产生 **3 个 wake**；send 幂等重放 `replayed=true`；inbox ack 3 个后 pending=0；
不同 key 重复 ack → `alreadyAcked=3`；group/broadcast/DM read cursor 均正常；relay/lease 进程内薄适配模拟。
**Matrix face 差距/P1 缺口**：vendor 无 relay/lease API、无跨进程 wake 推送、未接 daemon PORT/台账、
cursor 密钥需按租户隔离；详见报告。
