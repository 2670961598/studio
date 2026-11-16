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
