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
  NO_APPROVAL_ANCHOR,
  canTransition,
  flowAnchors,
  flowLevelKey,
  flowStates,
  forwardStates,
  nextStates,
  resolveFlow,
  resolveTicketFlow,
  typeFlowKey,
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

// ————————————————— 类型流（DEV-43，docs/18-§2.1.1；契约=docs/51 v1.1 W-1..W-9） —————————————————

/** e2e/demo 同源夹具：探索单（无 entity；双终态+重开边） */
const SPIKE_FLOW = {
  mainline: ['待探索', '探索中', '探索结论就绪', '复验通过', '已归档', '不予归档'],
  finalStates: ['已归档', '不予归档'],
  typeEdges: [{ from: '已归档', to: '待探索' }],
  anchors: {
    fresh: '待探索',
    approval: '',
    dispatched: '探索中',
    evidenceReady: '探索结论就绪',
    verified: '复验通过',
    delivered: '已归档',
  },
} as const

const TYPE_TABLE: FlowTable = { ...DEFAULT_FLOW_TABLE, 'T:spike': SPIKE_FLOW }

describe('typeFlowKey / resolveTicketFlow（解析序冻结）', () => {
  it('typeFlowKey：id→T:<id>；undefined/空串不产键（直落等级回退）', () => {
    expect(typeFlowKey('spike')).toBe('T:spike')
    expect(typeFlowKey(undefined)).toBe('')
    expect(typeFlowKey('')).toBe('')
  })

  it('类型命中优先：T:spike 走类型流（命中时不要求 level）', () => {
    expect(resolveTicketFlow(TYPE_TABLE, 'spike', undefined)).toBe(SPIKE_FLOW)
    expect(resolveTicketFlow(TYPE_TABLE, 'spike', 2)).toBe(SPIKE_FLOW)
  })

  it('类型未声明回退等级：untyped/undefined 走 L 键（现状语义原样）', () => {
    expect(resolveTicketFlow(TYPE_TABLE, 'defect', 0)).toBe(DEFAULT_FLOW_TABLE.L0)
    expect(resolveTicketFlow(TYPE_TABLE, undefined, 1)).toBe(DEFAULT_FLOW_TABLE.L1)
    expect(resolveTicketFlow(TYPE_TABLE, undefined, undefined)).toBeUndefined()
  })

  it('保留词查不到 T 键：bug（断路单·不定级）→NOOP 面；task（岗单）→L0', () => {
    expect(resolveTicketFlow(TYPE_TABLE, 'bug', undefined)).toBeUndefined()
    expect(resolveTicketFlow(TYPE_TABLE, 'task', 0)).toBe(DEFAULT_FLOW_TABLE.L0)
  })

  it('两路都未命中=undefined（decide NOOP_UNKNOWN_FLOW 同源）', () => {
    expect(resolveTicketFlow({}, 'spike', undefined)).toBeUndefined()
    expect(resolveTicketFlow({}, 'spike', 0)).toBeUndefined()
  })
})

describe('终态截断（finalStates——W-5 推导语义）', () => {
  it('终态无主干前向边：首位终态截断其后全部声明态', () => {
    expect(forwardStates(SPIKE_FLOW, '复验通过')).toEqual(['已归档'])
    expect(forwardStates(SPIKE_FLOW, '已归档')).toEqual([]) // 终态
    expect(forwardStates(SPIKE_FLOW, '不予归档')).toEqual([]) // 截断后声明态（人类经边可达）
  })

  it('flowStates 仍取全集（成员校验不缩水——多终态并列合法在场）', () => {
    expect(flowStates(SPIKE_FLOW)).toEqual(['待探索', '探索中', '探索结论就绪', '复验通过', '已归档', '不予归档'])
  })

  it('声明边 from=final 合法（重开已关单）：nextStates 含声明边（canTransition 放行）', () => {
    expect(forwardStates(SPIKE_FLOW, '已归档')).toEqual([]) // 机器不主动走
    expect(nextStates(SPIKE_FLOW, '已归档')).toEqual(['待探索']) // 声明边解锁 canTransition
    expect(canTransition(SPIKE_FLOW, '已归档', '待探索')).toBe(true)
    expect(canTransition(SPIKE_FLOW, '不予归档', '待探索')).toBe(false) // 未声明边
  })

  it('缺省 finalStates=不截断（等级流现状行为字节不变）', () => {
    const noFinal = { mainline: ['a', 'b', 'c'] }
    expect(forwardStates(noFinal, 'b')).toEqual(['c'])
    expect(forwardStates(noFinal, 'c')).toEqual([]) // 尾态本无后继（非终态截断所致）
  })

  it('重名态去重保持首现序（与等级流同语义）', () => {
    const l2 = DEFAULT_FLOW_TABLE.L2!
    expect(flowStates(l2)).toEqual([fresh, approval, dispatched, evidenceReady, verified, delivered])
  })
})

describe('无审批环哨兵（NO_APPROVAL_ANCHOR）', () => {
  it('哨兵=空串（构造性安全：decide 5a/5b 永不命中非空状态名）', () => {
    expect(NO_APPROVAL_ANCHOR).toBe('')
    expect(SPIKE_FLOW.anchors.approval).toBe(NO_APPROVAL_ANCHOR)
    expect(forwardStates(SPIKE_FLOW, '待探索')).not.toContain(NO_APPROVAL_ANCHOR)
  })
})
