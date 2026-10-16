/**
 * flows 表驱动 FSM 测试 —— docs/18-§2.1 默认模板冻结形状 / 回退边 / 公司覆盖 / 越界。
 * 分支全覆盖目标：主干前向边、回退边过滤、类型边占位、未知态、覆盖表。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLOW_ANCHORS,
  DEFAULT_FLOW_TABLE,
  DEFAULT_ROLLBACK_EDGES,
  DEFAULT_STATES,
  DEFAULT_TYPE_EDGES,
  canTransition,
  flowAnchors,
  flowLevelKey,
  flowStates,
  forwardStates,
  nextStates,
  resolveFlow,
  type FlowTable,
} from '../src/flows.ts'

const { fresh, approval, dispatched, evidenceReady, verified, delivered } = DEFAULT_STATES

describe('默认模板冻结形状（18-§2.1）', () => {
  it('L0 主干：[新单→已派发→证据就绪→复验通过→已交付]', () => {
    expect(flowStates(DEFAULT_FLOW_TABLE.L0!)).toEqual([fresh, dispatched, evidenceReady, verified, delivered])
  })

  it('L1 主干：新单与已派发之间加一道待批', () => {
    const flow = DEFAULT_FLOW_TABLE.L1!
    expect(flowStates(flow)).toEqual([fresh, approval, dispatched, evidenceReady, verified, delivered])
    expect(canTransition(flow, fresh, approval)).toBe(true)
    expect(canTransition(flow, approval, dispatched)).toBe(true)
    expect(canTransition(flow, fresh, dispatched)).toBe(false)
  })

  it('L2 主干：前后双待批——重名态按边集不歧义（状态集按名去重）', () => {
    const flow = DEFAULT_FLOW_TABLE.L2!
    expect(flowStates(flow)).toEqual([fresh, approval, dispatched, evidenceReady, verified, delivered])
    expect(flow.mainline).toEqual([fresh, approval, dispatched, evidenceReady, verified, approval, delivered])
    expect(canTransition(flow, approval, dispatched)).toBe(true) // 前批位
    expect(canTransition(flow, approval, delivered)).toBe(true) // 交付批位
    expect(forwardStates(flow, approval)).toEqual([dispatched, delivered]) // 主干序
    expect(canTransition(flow, fresh, dispatched)).toBe(false)
  })
})

describe('前向边 vs 回退边', () => {
  it('前向后继只含主干相邻（不含 rollback）', () => {
    const flow = DEFAULT_FLOW_TABLE.L0!
    expect(forwardStates(flow, fresh)).toEqual([dispatched])
    expect(forwardStates(flow, delivered)).toEqual([]) // 终态无前向
  })

  it('nextStates 含回退边：已交付→已派发（复验打回，18-§2.1 例）', () => {
    const flow = DEFAULT_FLOW_TABLE.L0!
    expect(nextStates(flow, delivered)).toEqual([dispatched]) // 待批不在 L0 状态集，被过滤
    expect(canTransition(flow, delivered, dispatched)).toBe(true)
  })

  it('回退边按流状态集过滤：L1 的已派发可回新单与待批，L0 只可回新单（前向后继在先）', () => {
    expect(nextStates(DEFAULT_FLOW_TABLE.L0!, dispatched)).toEqual([evidenceReady, fresh])
    expect(nextStates(DEFAULT_FLOW_TABLE.L1!, dispatched)).toEqual([evidenceReady, fresh, approval])
  })

  it('证据就绪/复验通过 可打回已派发', () => {
    const flow = DEFAULT_FLOW_TABLE.L0!
    expect(canTransition(flow, evidenceReady, dispatched)).toBe(true)
    expect(canTransition(flow, verified, dispatched)).toBe(true)
  })

  it('越表迁移拒绝：新单→已交付、跨级跳态', () => {
    const flow = DEFAULT_FLOW_TABLE.L0!
    expect(canTransition(flow, fresh, delivered)).toBe(false)
    expect(canTransition(flow, evidenceReady, delivered)).toBe(false)
    expect(canTransition(flow, fresh, fresh)).toBe(false)
  })

  it('未知状态：无后继、无迁移', () => {
    const flow = DEFAULT_FLOW_TABLE.L0!
    expect(nextStates(flow, '不存在')).toEqual([])
    expect(canTransition(flow, '不存在', fresh)).toBe(false)
  })
})

describe('类型专属边占位（v0）', () => {
  it('DEFAULT_TYPE_EDGES 为空表（技术债 promote 待冻结）', () => {
    expect(DEFAULT_TYPE_EDGES).toEqual([])
    expect(DEFAULT_FLOW_TABLE.L0!.typeEdges).toEqual([])
  })

  it('typeEdges 传入后并入 nextStates（过滤同 rollback）', () => {
    const flow = {
      mainline: ['a', 'b', 'c'],
      typeEdges: [{ from: 'a', to: 'c' }, { from: 'a', to: '外部态' }],
    }
    expect(nextStates(flow, 'a')).toEqual(['b', 'c']) // 越状态集的边被滤掉
    expect(canTransition(flow, 'a', 'c')).toBe(true)
  })
})

describe('公司覆盖（传入替换，不写死）', () => {
  it('自定义流换名换形状完全生效', () => {
    const custom: FlowTable = {
      L0: { mainline: ['Open', 'Approved', 'Running', 'Done'] },
    }
    const flow = custom.L0!
    expect(canTransition(flow, 'Open', 'Approved')).toBe(true)
    expect(canTransition(flow, 'Running', 'Done')).toBe(true)
    expect(canTransition(flow, 'Open', 'Running')).toBe(false)
    expect(nextStates(flow, 'Done')).toEqual([]) // 无回退边
  })

  it('自定义锚点随表走（缺省回退默认状态名）', () => {
    const flow = {
      mainline: ['s1', 's2'],
      anchors: { ...DEFAULT_FLOW_ANCHORS, dispatched: 's2' },
    }
    expect(flowAnchors(flow).dispatched).toBe('s2')
    expect(flowAnchors({ mainline: ['a'] })).toBe(DEFAULT_FLOW_ANCHORS)
  })
})

describe('键与查表', () => {
  it('flowLevelKey：0→L0 / 2→L2 / 未定级→空串', () => {
    expect(flowLevelKey(0)).toBe('L0')
    expect(flowLevelKey(2)).toBe('L2')
    expect(flowLevelKey(undefined)).toBe('')
  })

  it('resolveFlow：默认表三级齐备；缺键返回 undefined（不猜默认流）', () => {
    expect(resolveFlow(DEFAULT_FLOW_TABLE, 'L0')).toBeDefined()
    expect(resolveFlow(DEFAULT_FLOW_TABLE, 'L1')).toBeDefined()
    expect(resolveFlow(DEFAULT_FLOW_TABLE, 'L2')).toBeDefined()
    expect(resolveFlow(DEFAULT_FLOW_TABLE, 'L9')).toBeUndefined()
    expect(resolveFlow({}, 'L0')).toBeUndefined()
  })

  it('默认回退边集合含断路回首批位两条读法（拟稿）', () => {
    expect(DEFAULT_ROLLBACK_EDGES).toContainEqual({ from: dispatched, to: fresh })
    expect(DEFAULT_ROLLBACK_EDGES).toContainEqual({ from: dispatched, to: approval })
    expect(DEFAULT_ROLLBACK_EDGES).toContainEqual({ from: delivered, to: dispatched })
  })
})
