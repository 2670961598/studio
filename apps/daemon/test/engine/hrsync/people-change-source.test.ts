/**
 * people-change 源单测（129-C，studio-dev-178；129-§6.1①/§6.3 P0-A）。
 * 覆盖面：
 *   - 意图形状七字段全填（class/classifier/person/field/prev/next/linked_ticket）+
 *     kind='data-change' + priority=1 + source/company 槽位
 *   - dedupKey=变更指纹 `person+classifier+prev→next`——与引擎断言面同一公式
 *     （dataChangeFingerprint 同引零漂移；129-§6.1 铁律2 源面 at-least-once 契约）
 *   - liveEmit ?? sink 双出口：start 前 sink 兜底（构造期固定），start 后注册表
 *     emit 接管，stop 后回落 sink（scheduler 源先例——同一队列无双写面）
 *   - wirePeopleChangeSource：注册进源注册表（manifest 名=源名；startAll 注入 emit
 *     后 publish 走 liveEmit——注册与推送同一实例）
 */
import { describe, expect, it } from 'vitest'
import type { InvokeIntent } from '@studio-next/contract'
import { createSourceRegistry } from '../../../src/engine/sources.ts'
import { dataChangeFingerprint } from '../../../src/engine/intents/taxonomy.ts'
import {
  createPeopleChangeSource,
  PEOPLE_CHANGE_SOURCE_MANIFEST,
  PEOPLE_CHANGE_SOURCE_NAME,
  wirePeopleChangeSource,
} from '../../../src/engine/hrsync/people-change-source.ts'
import type { PeopleChange } from '@studio-next/core'

function change(over: Partial<PeopleChange> = {}): PeopleChange {
  return { personId: 'AGENT-3', kind: '入', field: '*', prev: null, next: '1', ...over }
}

describe('publish 意图形状（129-§6.1 契约①：payload 七字段+指纹）', () => {
  it('每条变更产一个 data-change 意图：payload 全填+linked_ticket=批次号（对账锚溯源）', () => {
    const got: InvokeIntent[] = []
    const src = createPeopleChangeSource({ company: 'demo', sink: (i) => got.push(i) })
    const n = src.publish([change(), change({ personId: 'AGENT-1', kind: '升', field: 'level', prev: '2', next: '3' })], 'BATCH-01')
    expect(n).toBe(2)
    expect(got).toHaveLength(2)
    const first = got[0]
    expect(first.kind).toBe('data-change')
    expect(first.company).toBe('demo')
    expect(first.source).toBe(PEOPLE_CHANGE_SOURCE_NAME)
    expect(first.priority).toBe(1)
    expect(first.payload).toEqual({
      class: 'people-change',
      classifier: '入',
      person: 'AGENT-3',
      field: '*',
      prev: null,
      next: '1',
      linked_ticket: 'BATCH-01',
    })
    expect(got[1].payload).toMatchObject({ classifier: '升', person: 'AGENT-1', field: 'level', prev: '2', next: '3', linked_ticket: 'BATCH-01' })
  })

  it('dedupKey=变更指纹（dataChangeFingerprint 同引——引擎断言面同一公式零漂移）', () => {
    const got: InvokeIntent[] = []
    const src = createPeopleChangeSource({ company: 'demo', sink: (i) => got.push(i) })
    const c = change()
    src.publish([c], 'B1')
    expect(got[0].dedupKey).toBe(dataChangeFingerprint({ person: c.personId, classifier: c.kind, prev: c.prev, next: c.next }))
    expect(got[0].dedupKey).toBe('AGENT-3+入+→1')
  })

  it('同指纹不同批次：dedupKey 相同（幂等键不含 batchId——引擎 patrolKeys 面恰好一次）', () => {
    const got: InvokeIntent[] = []
    const src = createPeopleChangeSource({ company: 'demo', sink: (i) => got.push(i) })
    src.publish([change()], 'B1')
    src.publish([change()], 'B2')
    expect(got).toHaveLength(2)
    expect(got[0].dedupKey).toBe(got[1].dedupKey)
    expect(got[0].payload).toMatchObject({ linked_ticket: 'B1' })
    expect(got[1].payload).toMatchObject({ linked_ticket: 'B2' })
  })

  it('空变更清单=零意图零 log 噪音；返回 0', () => {
    const got: InvokeIntent[] = []
    const src = createPeopleChangeSource({ company: 'demo', sink: (i) => got.push(i) })
    expect(src.publish([], 'B1')).toBe(0)
    expect(got).toHaveLength(0)
  })
})

describe('liveEmit ?? sink 双出口（22-§三 源协议）', () => {
  it('start 前 publish 走构造期 sink；start 后走注册表 emit；stop 后回落 sink', () => {
    const sink: InvokeIntent[] = []
    const live: InvokeIntent[] = []
    const src = createPeopleChangeSource({ company: 'demo', sink: (i) => sink.push(i) })
    src.publish([change()], 'B1')
    expect(sink).toHaveLength(1)
    src.start((i) => live.push(i))
    src.publish([change()], 'B2')
    expect(live).toHaveLength(1)
    expect(sink).toHaveLength(1)
    src.stop()
    src.publish([change()], 'B3')
    expect(sink).toHaveLength(2)
    expect(live).toHaveLength(1)
  })

  it('stats.emitted 纯计数（观测面）', () => {
    const src = createPeopleChangeSource({ company: 'demo', sink: () => undefined })
    expect(src.stats.emitted).toBe(0)
    src.publish([change(), change()], 'B1')
    expect(src.stats.emitted).toBe(2)
  })
})

describe('wirePeopleChangeSource 注册件（serve 唯一调用点）', () => {
  it('注册进源注册表（manifest 名=源名），返回的 publish 与注册实例同一——startAll 后走 liveEmit', () => {
    const sources = createSourceRegistry({ log: () => undefined })
    const sink: InvokeIntent[] = []
    const live: InvokeIntent[] = []
    const publish = wirePeopleChangeSource(sources, { company: 'demo', sink: (i) => sink.push(i) })
    publish([change()], 'B1')
    expect(sink).toHaveLength(1)
    // startAll 注入 safeEmit 包装：此后 publish 经 liveEmit（sink 不再进）
    sources.startAll((i) => live.push(i))
    publish([change({ personId: 'AGENT-9' })], 'B2')
    expect(sink).toHaveLength(1)
    expect(live).toHaveLength(1)
    sources.stopAll()
    publish([change({ personId: 'AGENT-8' })], 'B3')
    expect(sink).toHaveLength(2)
    expect(live).toHaveLength(1)
  })

  it('manifest 声明（22-§二 内置源表）：name=people-change，kind=data-change', () => {
    expect(PEOPLE_CHANGE_SOURCE_MANIFEST.name).toBe(PEOPLE_CHANGE_SOURCE_NAME)
    expect(PEOPLE_CHANGE_SOURCE_MANIFEST.kind).toBe('data-change')
  })
})
