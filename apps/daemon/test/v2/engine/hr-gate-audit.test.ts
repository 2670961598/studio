/**
 * hr-gate-audit.test.ts —— 任职闸门「接线审计断言」纳入 V2 套件（studio-dev-550 重出 #625）
 *
 * 依据：
 *   - docs/v2/17 GAP-V2-06 / NEG-REC-02：「代偿面＝REC-LIFE-02＋审计断言」收敛为真闸门
 *     ＋可重复的接线断言（断言必须随门禁跑，不能只是仓里躺着的一份脚本）；
 *   - docs/17-§2 相位 3 派发（闸门接在派发/出工前）、§6 收割四要件（本闸不改判据）；
 *   - 冻结链：`scripts/verify/hr-gate-audit.mjs` 已由 `7f289d9` 接入 `verify:v2`（制作人
 *     2026-11-03 批）。本用例再随 `test:v2`（verify:v2 既有的一步）复跑一次，形成双保险：
 *     即便将来链行被误摘，V2 套件仍红——**不改命令串**（AGENTS §五.2）。
 *
 * 边界：只做接线/形状断言，执行体是唯一实现（审计脚本），本文件不复制其判据；
 * 行为红→绿仍在 `hr-gate.test.ts`（8 用例：控制组/六状态/缺证/冲突/未知/兜底/纯函数）。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 仓根＝本文件 `apps/daemon/test/v2/engine/` 上溯五级 */
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

describe('任职闸门接线审计断言（NEG-REC-02 代偿面收敛）', () => {
  it('审计脚本 exit=0：事实/判定/决策位/执行位/生产 strict/观测留痕六面不摘线', () => {
    const result = spawnSync(process.execPath, ['scripts/verify/hr-gate-audit.mjs', '--root', repoRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('任职闸门审计断言 PASS')
  })
})
