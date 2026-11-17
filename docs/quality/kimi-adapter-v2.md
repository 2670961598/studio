# KimiAdapter v2 真机形态修复（task-98）

依据：`/tmp/kimi-static-review-2026-11-17.md`；本机 KimiCode 2.1.1 真实 session 样本（离线，不调用）。
- P0：launch 读 briefPath 文本作 `-p <prompt>`；真实 stdout 为 `role: meta/assistant/tool` + `session.resume_hint`，无 result/turn_end → `parseKimiLine` 归一，流尾按退出码+assistant 内容合成 turn_end（exit0+内容=completed；非0/空=fail，不伪造）。
- P1：wire 真实路径 `KIMI_CODE_HOME|~/.kimi-code/sessions/*/session_*/agents/main/wire.jsonl`，从 resume_hint 捕获 CLI id 并写 `Handle.executorSessionId`；`-S` 只传 `session_` id，禁裸 -S；`usage.record` 仅 `agentId=main` + `usageScope=turn`，映射 inputOther/output/inputCacheRead/inputCacheCreation。
- P2：`KIMI_CODE_HOME` 按数据根目录传（AGENTS.md 文件传其目录）；`KIMI_APPEND_SYSTEM_PROMPT_FILE` 真实不存在 → append unsupported 不注入假变量。
- 测试：真实形态 fixture（role/assistant/tool/resume_hint、usage.record、wire 隔离、resume id、旧 fixture 兼容）在 `packages/adapters/test/kimi.test.ts` 27/27 + `test/v2/kimi-real.test.ts` 1/1；真实 KimiCode 调用因账号 403 未做 smoke，auth 恢复后补。

## task-104 seatbelt 端子

- `KimiAdapter` 第三参 `SeatbeltPlan`（照 dsh 机制）：launch 用 `buildWorkerSeatbeltProfile` 生成 profile（写根=plan.writeRoots），以 `sandbox-exec -f <profile> -- kimi ...` 包装；profile 落 `workspace/.seatbelt/`（plan.profileDir 可覆盖），流尾/kill 清理。
- `agentconfig.BUILTIN_FACTORIES.kimi` 接收并传递 plan；移除 kimi 的 `seatbelt-unenforceable` 拒收；claude/codex 仍无端子拒收。read-only 缺省最严/workspace-write 需 authorization 由 `resolveSeatbeltGrant` 不变。
- detect 前置：计划存在时跑 `detectSeatbeltBackend`，嵌套环境 gap 明报。
