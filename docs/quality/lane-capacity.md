# 泳道容量域（lane capacity；LOCAL-329）

- 状态：已实现（2026-11-26 落地；实现单=LOCAL-329，设计落单=2026-11-03 #488 泳道容量域）。
- 一句话：daemon.yaml 可配每泳道并发槽位（`laneCapacity`），缺省全泳道容量 1＝单持有者旧语义**字节不变**；启用＝加键+重启，回滚＝删键+重启。

## 0. 背景与问题

2026-11-24 事故：LOCAL-300（基准长跑）持有 core 泳道租约 1h+，同泳道 6+ 单全部 `HOLD_LANE_BUSY`（TTL 30min 内零派发）。根因＝`LaneRegistry` 单持有者模型：一泳道一租约，任何长跑单天然串行阻塞整条泳道。#488（docs/sentinel-logs/2026-11-03.md）落单「泳道容量域」→ 本单实现**可配置泳道容量**（核心多槽并发）。

## 1. 模型（每泳道＝租约集）

- 数据面：泳道 → `Map<ticket, lease{holder, expiresAt, epoch}>`（占道序）；容量＝`laneCapacity[lane]`，未列泳道＝1。
- `acquire(lane, ticket, at)`：
  - 占道即清**他单过期**死主（TTL 语义不变：过期不占容量）；
  - 本单已有租约＝**原位刷新保 epoch**（不占新槽、不 bump——execute 二次 acquire 与 state-diff 首占同 epoch）；
  - 无租约且活跃数 ≥ 容量＝**拒收**返回 `LANE_FULL`(-1)，不静默逐出活租约（fail-closed）；
  - 新租约 epoch：与他单共存＝bump 计数（新 epoch > 一切已发 ⇒ 同泳道在册租约 epoch 两两不同）；空道＝沿用当前计数（容量 1＝旧语义）。
- `state(lane)` 兼容面：`holder/expiresAt`＝最早占道者（容量 1＝旧快照原样，含过期死租约可见——`state()` 无时钟，与旧一致）；新增 `holders: {ticket,expiresAt,epoch}[]`（占道序全量）与 `capacity`。
- `decide` laneFree（core 纯件）：快照带 `holders` 时＝「活跃（未过期）数 < max(1, capacity)」；不带 holders＝旧 holder/null 路径逐字节不变。

## 2. 容量 1＝单持有者旧语义逐字节等价（要点）

- **acquire**：空道/同单重占＝沿用计数（同旧）；唯一刻意分歧＝他单活跃在册时旧实现静默覆盖、新实现拒收——引擎链路不可达（decide 先闸 laneFree，decide 与 acquire 间无 await），只对直连误用收紧为 fail-closed。
- **release/stop 四分支等价**：本单无租约且道空→幂等；栅栏先于幂等（旧序不变）；本单租约在场＝比对该租约 epoch（容量 1 下恒＝计数）；本单无租约而他单在册携当前 epoch→幂等零行为。
- **isCurrent**：旧＝`epoch===计数`；新＝在册租约中存在同 epoch。容量 1 下不变式「在册租约 epoch 恒＝计数」成立（release/stop 后道空才重占新计数）⇒ 等价；引擎所有调用面（hosts/execute/watchdog）的 epoch 均取自当拍 acquire。
- **laneFree / renew**：活跃数 0/1 与旧 holder/null 判定同值；renew 的 holder===ticket ≡ 本单租约在场＋epoch 比对。
- **回归证据**：core decide 旧用例零改动绿；daemon v2 既有 lease-epoch / lane-release / orphan-recovery 零改动绿；golden 不加字段（§5）。

## 3. epoch 栅栏语义：计数器 → 逐租约（容量>1 生效）

- acquire 返回值＝**本租约唯一标识**（共存必 bump ⇒ 同泳道在册租约 epoch 两两不同）。
- `release/stop/renew` 按 ticket+epoch 精确到单租约：迟到完成（旧 epoch）不误放新租约，也不误放邻槽；renew 只续本租约 expiresAt，不 bump、不触及他单。
- 进程重启：租约簿为内存态随进程清空，计数经 `EpochStore`（daemon_kv `lease.epoch.lane:<lane>`；registry 键参 `lane:<lane>`）恢复；旧 epoch 不复活（不在册即 stale）。
- 完成面携带链不变（812 收口）：state-diff acquire → dispatchQ → execute 记 inflight `liveLaneEpoch` → 收割成功/失败/stop 释放；无 epoch 来源仍禁止释放（fail-closed）。

## 4. 配置、启用与回滚

- daemon.yaml：`laneCapacity: '{"core":4,"qa":2}'`（JSON 字符串对象；YAML 外层引号由 parseScalar 剥）。
- 解析即验（serve/config `case 'laneCapacity'` → `parseLaneCapacity`）：非 JSON／非对象／空泳道名／非 1..8 整数 → **启动拒**（CONFIG_INVALID，与 `tierExecutors` 同款）；空串/`{}`＝空表。
- 上限 8：单泳道同拍多写冲突面随槽数放大（§6），封顶。
- 装配链：ServeConfig.laneCapacity（缺省 `{}`）→ buildServeEngineConfig → EngineConfig.laneCapacity → createRuntime → `createLaneRegistry(laneTtlMs, epochStore, laneCapacity)`。
- **启用**＝daemon.yaml 加键＋重启；**回滚**＝删键＋重启（重启清空内存租约簿，回到全泳道容量 1；epoch 计数持久化不受影响）。生产 daemon.yaml 本次不动。

## 5. 观测面（前缀兼容）

- `HOLD_LANE_BUSY` 决策载荷：**仅容量>1** 追加 `laneHolders[]`（{ticket, expiresAt?}）＋`laneCapacity`；容量 1（含缺省）决策载荷字节不变——golden 精确匹配判据不加字段。
- 渲染行：`… expiresAt=<t> holders=2/2（…）`——旧行字节不变、前缀兼容；签名去重键（ticket+lane+holder+expiresAt）不加新字段。
- tick-report `laneHolder` 兼容面＝首持有者（最早占道）；`laneHolders` 为可选新面，不入冻结 golden。

## 6. 威胁与缓解

- **同泳道多写冲突**（多执行体同拍写同一公司目录/工位）：既有隔离＝员工家 workspace（docs/43-§五）＋网关 wkey 单写收口；容量上限 8 封顶放大面。
- **长跑单仍占槽**：容量治「串行阻塞」不治「长跑」——长任务应配独立泳道（org lanes）或走看门狗/缩短 TTL，不在本单范围。
- **满员静默**：`HOLD_LANE_BUSY` 行携 holders=N/capacity=M（§5），「谁占了几个槽」可见。
- **单持有者假设残留面**：已核对——orphan-recovery 只用 `state().holder` 做审计注记（非闸门）；hosts/execute 走 isCurrent/epoch；均多槽安全。

## 7. 验收口径映射（LOCAL-329 L1-L4）

- **L1 容量 1 零回归**：packages/core/test/decide.test.ts（旧用例零改动）＋ apps/daemon/test/v2/engine/{lease-epoch,lane-release,orphan-recovery}.test.ts（零改动绿）＋ lane-capacity.test.ts「L1」组（state 兼容面逐字节/死主回收/拒收不逐出/isCurrent-renew 旧义）。
- **L2 容量>1 并发**：lane-capacity.test.ts「L2」组（registry 共存＋满员拒收＋过期回收＋按泳道隔离；引擎真栈同拍/跨拍两单同泳道都派发、第三单 HOLD_LANE_BUSY 携 2/2 观测、槽位回收补位）＋ core decide「泳道容量域」组（synthetic DecisionInput：余位派/满员挡/死主不占槽/闸序不变）。
- **L3 epoch 逐租约**：lane-capacity.test.ts「L3」组（精确释放/旧 epoch 拒收/只续本租约/重启 epoch 恢复/stop 幂等/releaseTicketLane 按 ticket 回退）。
- **L4 配置/回滚**：apps/daemon/test/v2/assembly/lane-capacity-config.test.ts（缺省 {}、JSON 装载、坏值拒启、engine 投影透传）。
- 全量门：`mise x -- bun run verify:v2`、`bun run typecheck`、`bun run typecheck:v2`、`bun run guard:boundaries`、`bun run verify:docs`、scan-repo-secrets。

## 8. 不做什么

- 不改四闸顺序（断路 > 泳道 > 人 > 每拍/在途）与理由码集（`HOLD_LANE_BUSY` 语义不变）。
- 不做跨进程分布式租约（进程内簿＋kv epoch 持久化，与现状同界）。
- 不做容量热更（重启生效，与 EngineConfig 其余配置面同款）。
- 不动 mergeLease / 人闸 / 在途闸 / 回收语义。
