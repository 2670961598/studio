# 主绑定执行器可配置（task-106）

- `packages/adapters/src/bindcard/selection.ts`：`resolveDispatchTarget(..., primaryBinding = 'dsh')`；放行判据`executor === primaryBinding`，note 标实际主绑定；缺省参数=零漂移。
- daemon：`DispatchSelectionDeps.primaryExecutor?: ExecutorFamily`；`resolveDispatchSelection` 透传；serve `daemon.yaml` 可选 `primaryExecutor`（ENU-88 值集，非法拒启；缺省 dsh），装配注入并日志标实际主绑定。合法值集自 task-147 起以契约 `EXECUTOR_VALUES`（`@studio-next/contract/records`，现＝dsh|claude|codex|kimi|agy）为唯一源，拒启报文动态列出值集；`agy` 可解析≠已启用（启用归 agent.yaml 登记与装配批示）。
- NEG-RUN-05 不变：primaryExecutor=kimi 时请求 dsh 仍拒；只有实际主绑定走缺省链，非主绑定仍需登记。
- 测试：`apps/daemon/test/v2/serve/primary-executor.test.ts`（缺省零漂移、kimi 放行/dsh 拒、非法拒启）；`bindcard.test.ts` 既有默认主绑定断言不动。
