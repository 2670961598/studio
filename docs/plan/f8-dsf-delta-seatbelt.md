# F8 · DSF 增量复查申请（seatbelt 配置通道）

> 日期：2026-10-30｜对象：F8 通过基线 `v2-f8-passed`（15063ad）之后的 seatbelt 增量 `fbe634f`｜性质：**增量复查申请，不是 F8 重审，不是 V2 定稿**

## 一、基线

- F8 通过：DSF-REVIEW-02，tag `v2-f8-passed`（15063ad），105 files/1567 tests。
- 增量：commit `fbe634f`，仅 seatbelt 配置通道；全 V2 1581 tests。

## 二、增量面（`15063ad..fbe634f`）

| 文件 | 变更 |
|---|---|
| `apps/daemon/src/assembly/serveconfig/coerce.ts` | `coerceSeatbeltGrant` / `parseSeatbeltWriteRoots`：三键校验＋二道 `resolveSeatbeltGrant` |
| `apps/daemon/src/assembly/serve/config.ts` | `seatbelt?: SeatbeltGrant`；缺省 `undefined` |
| `apps/daemon/src/assembly/serve/executor-face.ts` | `dispatchAdapterResolver(config.seatbelt)`（同一 grant） |
| `apps/daemon/src/assembly/serve/runtime.ts` | `createEngine({dispatchSeatbelt})`；`ServeRuntime.dispatchSeatbelt` 观测位 |
| `apps/daemon/src/cli/usage.ts` | `serve --help` 三键 |
| `apps/daemon/test/v2/security/seatbelt-config.test.ts` | 14 tests：正/负例、runtime 深一致、缺省 read-only、workspace-write fail-closed |
| `apps/daemon/test/v2/security/ws-escape.test.ts` | 源锚改 `dispatchAdapterResolver(config.seatbelt)` |
| `docs/plan/05-实现单拆分清单.md` | MIG-07 表后配置通道说明 |

## 三、行为声明（可复算）

- 不写三键＝`undefined`＝引擎 `resolveSeatbeltGrant(undefined)`＝**read-only**；缺省不放宽。
- `seatbeltTier` 封闭两值；`workspace-write` 必须给引号包裹的 JSON 数组绝对路径根＋非空 authorization；`read-only` 给 roots/auth 即拒；`off`/未知/相对路径/空数组/非 JSON 一律拒。
- 同一 grant 进 `wireExecutorFace` 与 `createEngine`，不存在第二写面。
- workspace-write 在无 seatbelt 端子的 fake executor 上 `DISPATCH_FAIL`，**不静默降级**；生产需 agent.yaml 挂 dsh 家族。
- PRB-04 未执行：本增量不证内核实际拦截；authorization 进 DISPATCH note 经既有 `noteText` 归一，不是逐字节原文。
- 未改记录类/端口/契约；未改 F8 基线文档。

## 四、请 DSF 增量核验

1. 缺省是否确实 read-only（不写三键路径）；
2. 负例是否全部拒、无静默补全/放宽；
3. grant 是否同一引用到达 resolver 与 engine，无第二写面；
4. 14 tests 是否真跑配置→runtime→engine 面，不是只测解析；
5. 1581 tests 是否在增量树上全绿（允许 DSF 独立复跑）；
6. 是否接受「PRB-04 未执行/实际拦截未证」作为本增量的边界。

## 五、封版建议

DSF 若认可增量，建议：
- 以 `fbe634f`（或含本文件的 tag）为 V2 final 候选；
- 不把本增量回写成 F8 已审范围；在 DSF 记录中单列「seatbelt delta 通过」；
- V2 final 标记仍由制作人明示后执行。
