/**
 * size-gate 对账 —— docs/17-§5.1 SG-1/SG-5（studio-dev-576）
 *
 * 断言：任务书阈值常量（`SIZE_GATE_MAX_LINES_PER_FILE`，brief.ts）与规则唯一源
 * `scripts/guards/boundary-rules.mjs` 的 `maxLinesPerFile` 相等——两处口径漂移即红
 * （注入文案说 600、门禁判 400 之类，是比「不注入」更危险的假安全）。
 *
 * 边界纪律：只以**文本方式**读规则文件，不 import 仓外脚本（prompt 包依赖边全程不动，
 * BC-H1/BC-H2 面无新增边）。`lineBaseline` 只断言「在场且为对象」——条目数随清偿下降，
 * 锁死条数=伪红（20-§十五.三.3「只减不增」，除名随任意提交顺带办理）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIZE_GATE_MAX_LINES_PER_FILE } from '../src/brief.ts'

/** 规则文件路径（仓根 scripts/guards/；本测试文件位于 packages/prompt/test/） */
const RULES_URL = new URL('../../../scripts/guards/boundary-rules.mjs', import.meta.url)

function readRulesText(): string {
  return readFileSync(RULES_URL, 'utf8')
}

describe('行数阈常量 ← 规则唯一源对账（docs/17-§5.1 SG-1/SG-5）', () => {
  it('规则源可读且声明 maxLinesPerFile（缺失=对账断链，不静默跳过）', () => {
    expect(readRulesText()).toMatch(/export const maxLinesPerFile\s*=\s*\d+/)
  })

  it('常量 === 规则源 maxLinesPerFile（当前 600，docs/20-§十五.三.2）', () => {
    const matched = /export const maxLinesPerFile\s*=\s*(\d+)/.exec(readRulesText())
    expect(matched).not.toBeNull()
    const rulesMax = Number(matched?.[1])
    expect(rulesMax).toBe(600)
    expect(SIZE_GATE_MAX_LINES_PER_FILE).toBe(rulesMax)
  })

  it('lineBaseline 棘轮面在场（对象声明；条目不锁——清偿会减，锁数=伪红）', () => {
    expect(readRulesText()).toMatch(/export const lineBaseline\s*=\s*\{/)
  })
})
