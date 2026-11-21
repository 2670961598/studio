/**
 * id-floor.test.ts —— 平台级发号下限（M5 尾 #5；docs/plan/09 §二.5/§五、issues.ts readIdFloor）
 *
 * 背景：2026-11-20 单子切换用 LOCAL-99 占位单（Archived）把发号抬到 LOCAL-100（数据 hack，
 * sentinel-logs/单子切换执行记录-2026-11-20.md §三）；本面把它代码化——
 * `<platformRoot>/id-floor.json` 形如 {"min":99}，createIssue 取 max(树内 LOCAL-N max, floor)+1。
 *
 * 覆盖（冻结验收口径）：
 *   ① 无 floor（缺文件）行为不变：空树 LOCAL-1 起号连续单调（M2 口径逐位不动）；
 *   ② floor=99 + 树内 max=28 → 新单 LOCAL-100（切换现场口径）；占位单在场不双抬（迁移重叠期）；
 *   ③ floor 低于树内 max → 取树内 max+1（只抬下限不压上界）；min=0 合法且等效无下限；
 *   ④ 非法内容明报不静默：非合法 JSON / 负值 / 非整数 / 非安全整数 / 非对象 / 缺 min /
 *      min 非数字 → CONFIG_INVALID / bad-id-floor，且拒于落盘前（树零新增）；
 *   ⑤ 幂等与同根多实例：floor 文件 daemon 只读（N 次建单后逐字节不变）、重复读同值、
 *      两实例交错建单号不重不漏。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { idFloorPath } from '../../src/layout.ts'
import { readIdFloor } from '../../src/issues.ts'
import { createLocalPlatform } from '../../src/platform.ts'
import { expectLocalError, expectLocalReject, tmpRoot } from '../../src/testutil.ts'

let root: string

beforeEach(() => {
  root = tmpRoot('id-floor')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 落一张历史单（最小合法事件流：一行 created；发号只扫文件名，不折叠内容） */
function seedIssue(id: string): void {
  writeFileSync(
    join(root, 'issues', `${id}.jsonl`),
    `${JSON.stringify({ type: 'created', ts: '2026-01-01T00:00:00.000Z', state: 'Archived', input: { title: `历史单 ${id}` } })}\n`,
    'utf8',
  )
}

function writeFloor(content: string): void {
  writeFileSync(idFloorPath(root), content, 'utf8')
}

describe('id-floor：无 floor 行为不变', () => {
  it('缺文件=无下限：空树 LOCAL-1 起号、连续单调；list 语义不变', async () => {
    const p = createLocalPlatform(root)
    expect(readIdFloor(root)).toBe(null)
    const a = await p.issues.create({ title: '甲' })
    const b = await p.issues.create({ title: '乙' })
    expect(a.id).toBe('LOCAL-1')
    expect(b.id).toBe('LOCAL-2')
    expect((await p.issues.list({})).map((r) => r.id)).toEqual(['LOCAL-1', 'LOCAL-2'])
  })

  it('min=0 合法且等效无下限（空树仍 LOCAL-1）', async () => {
    const p = createLocalPlatform(root)
    writeFloor('{"min":0}')
    expect(readIdFloor(root)).toBe(0)
    expect((await p.issues.create({ title: '甲' })).id).toBe('LOCAL-1')
  })
})

describe('id-floor：floor 抬下限', () => {
  it('floor=99 + 树内 max=28 → 新单 LOCAL-100，后续 101 递增（切换现场口径）', async () => {
    const p = createLocalPlatform(root)
    seedIssue('LOCAL-1')
    seedIssue('LOCAL-28')
    writeFloor('{"min":99}')
    expect((await p.issues.create({ title: '防撞号' })).id).toBe('LOCAL-100')
    expect((await p.issues.create({ title: '次单' })).id).toBe('LOCAL-101')
  })

  it('floor=99 + LOCAL-99 占位单在场 → 仍 LOCAL-100（迁移重叠期：占位单未删也不双抬）', async () => {
    const p = createLocalPlatform(root)
    seedIssue('LOCAL-99')
    writeFloor('{"min":99}')
    expect((await p.issues.create({ title: '迁移期' })).id).toBe('LOCAL-100')
  })

  it('floor 低于树内 max → 取树内 max+1（只抬下限不压上界）', async () => {
    const p = createLocalPlatform(root)
    seedIssue('LOCAL-28')
    writeFloor('{"min":10}')
    expect((await p.issues.create({ title: '甲' })).id).toBe('LOCAL-29')
  })
})

describe('id-floor：非法内容明报（不静默）', () => {
  const BAD_FLOORS: ReadonlyArray<readonly [string, string]> = [
    ['非合法 JSON', '{oops'],
    ['负值', '{"min":-1}'],
    ['非整数', '{"min":1.5}'],
    ['非安全整数', '{"min":1e21}'],
    ['min 非数字', '{"min":"99"}'],
    ['缺 min', '{}'],
    ['顶层非对象', '"99"'],
  ]

  for (const [label, content] of BAD_FLOORS) {
    it(`${label} → CONFIG_INVALID / bad-id-floor，且拒于落盘前`, async () => {
      const p = createLocalPlatform(root)
      seedIssue('LOCAL-1')
      writeFloor(content)
      // 直读面与建单面同一 subcause（明报不静默）
      expectLocalError(() => readIdFloor(root), 'CONFIG_INVALID', 'bad-id-floor')
      await expectLocalReject(() => p.issues.create({ title: '甲' }), 'CONFIG_INVALID', 'bad-id-floor')
      expect((await p.issues.list({})).map((r) => r.id)).toEqual(['LOCAL-1']) // 零新增
    })
  }
})

describe('id-floor：幂等与同根多实例', () => {
  it('floor daemon 只读：N 次建单后文件逐字节不变；重复读同值（无缓存漂移）', async () => {
    const p = createLocalPlatform(root)
    writeFloor('{"min":99}')
    const before = readFileSync(idFloorPath(root), 'utf8')
    for (let i = 0; i < 3; i++) {
      expect(readIdFloor(root)).toBe(99) // 每次建单直读盘，重复读同值
      await p.issues.create({ title: `单${i}` })
    }
    expect(readFileSync(idFloorPath(root), 'utf8')).toBe(before)
  })

  it('同根两实例交错建单：号不重不漏（实例无内状态，盘是唯一真值）', async () => {
    writeFloor('{"min":99}')
    const p1 = createLocalPlatform(root)
    const p2 = createLocalPlatform(root)
    const x = await p1.issues.create({ title: '甲' })
    const y = await p2.issues.create({ title: '乙' })
    const z = await p1.issues.create({ title: '丙' })
    expect([x.id, y.id, z.id]).toEqual(['LOCAL-100', 'LOCAL-101', 'LOCAL-102'])
  })
})
