/**
 * agy-argv.test.ts —— buildAgyArgv / assertAgyPrintTimeoutSec 纯函数直证（team task-149①）
 *
 * 冻结验收口径（task-149①：--print-timeout 单位；事实与余量见 docs/quality/agy-adapter.md §六/§八）：
 *   ① 配置语义恒为「秒」，下发值带单位：printTimeoutSec=60 → argv 含 `--print-timeout 60s`
 *      （两参形；argv 不出现裸数字 60）——真 CLI（v1.5.18）该旗标是 Go duration，裸数字被拒
 *      `time: missing unit in duration "60"` → exit 2 零模型回合
 *   ② 未配置 → 旗标缺席（CLI 缺省 0s＝等到回合完成；不擅自钉超时）
 *   ③ 非正整数秒 fail-closed（CONFIG_INVALID/agy/option-invalid）：0 / 负数 / 小数 / NaN / ∞ /
 *      非安全整数——不静默丢弃（0s＝等到完成，等于悄悄撤掉钉下的超时），也不下发非法值
 *
 * 依据：task-149 真机探针（`60` 拒收 exit 2；`60s` / `900s` 接受）。本文件 <600 行阈内。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import { assertAgyPrintTimeoutSec, buildAgyArgv } from '../../src/agy-argv.ts'

const BASE = ['agy']
const TASK = 'AGY-TEST: 任务串'
const HEAD = ['-p', TASK, '--output-format', 'json', '--dangerously-skip-permissions']

/** 捕获抛出件的分类面（category/subcause）；未抛出＝undefined */
function thrownBy(fn: () => unknown): Partial<ClassifiedError> | undefined {
  try {
    fn()
    return undefined
  } catch (e) {
    return e as Partial<ClassifiedError>
  }
}

describe('buildAgyArgv · --print-timeout 单位（task-149①）', () => {
  it('printTimeoutSec=60 → `--print-timeout 60s`（两参形）；argv 无裸数字 60、无 --print-timeout= 形', () => {
    const argv = buildAgyArgv({ base: BASE, taskText: TASK, printTimeoutSec: 60 })
    expect(argv).toEqual([...BASE, ...HEAD, '--print-timeout', '60s'])
    expect(argv).not.toContain('60')
    expect(argv.some((arg) => arg.startsWith('--print-timeout='))).toBe(false)
    const full = buildAgyArgv({ base: BASE, taskText: TASK, model: 'Gemini 4 Neon (High)', addDir: 'ws', printTimeoutSec: 900 })
    expect(full.slice(-2)).toEqual(['--print-timeout', '900s'])
  })

  it('未配置 → 旗标缺席（CLI 缺省 0s＝等到回合完成；不擅自钉超时）', () => {
    expect(buildAgyArgv({ base: BASE, taskText: TASK })).toEqual([...BASE, ...HEAD])
  })

  it('非正整数秒 fail-closed：CONFIG_INVALID/agy/option-invalid（0 / 负数 / 小数 / NaN / ∞ / 非安全整数）', () => {
    const bad = [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]
    for (const sec of bad) {
      expect(thrownBy(() => buildAgyArgv({ base: BASE, taskText: TASK, printTimeoutSec: sec })), String(sec)).toMatchObject({
        category: 'CONFIG_INVALID',
        subcause: 'agy/option-invalid',
      })
      expect(thrownBy(() => assertAgyPrintTimeoutSec(sec)), String(sec)).toMatchObject({ subcause: 'agy/option-invalid' })
    }
    expect(() => assertAgyPrintTimeoutSec(1)).not.toThrow()
    expect(() => assertAgyPrintTimeoutSec(Number.MAX_SAFE_INTEGER)).not.toThrow()
  })
})
