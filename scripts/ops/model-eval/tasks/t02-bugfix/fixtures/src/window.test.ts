import assert from 'node:assert/strict'
import test from 'node:test'
import { DAY_MS, dayWindow, inWindow, overlaps, sliceByHours } from './window.ts'

const W = { since: 1_000, until: 2_000 }

test('下界闭合：since 时刻在窗口内', () => {
  assert.equal(inWindow(1_000, W), true)
})

test('上界开放：until 时刻不在窗口内', () => {
  assert.equal(inWindow(2_000, W), false)
})

test('窗口内 / 窗口外', () => {
  assert.equal(inWindow(1_500, W), true)
  assert.equal(inWindow(999, W), false)
  assert.equal(inWindow(2_001, W), false)
})

test('日窗口：从本地 00:00 起、跨度 24h、首尾时刻归属', () => {
  const w = dayWindow(new Date(2026, 10, 23, 15, 42))
  const start = new Date(w.since)
  assert.equal(start.getHours(), 0)
  assert.equal(start.getDate(), 23)
  assert.equal(w.until - w.since, DAY_MS)
  assert.equal(inWindow(w.since, w), true)
  assert.equal(inWindow(w.until, w), false)
})

test('半开区间：首尾相接不算重叠', () => {
  assert.equal(overlaps({ since: 1_000, until: 2_000 }, { since: 2_000, until: 3_000 }), false)
  assert.equal(overlaps({ since: 1_500, until: 2_500 }, { since: 2_000, until: 3_000 }), true)
})

test('按小时切片：无缝拼回、末片可短', () => {
  const pieces = sliceByHours({ since: 0, until: 9_000_000 })
  assert.equal(pieces.length, 3)
  assert.deepEqual(pieces.at(-1), { since: 7_200_000, until: 9_000_000 })
})
