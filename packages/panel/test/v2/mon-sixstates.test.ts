/**
 * packages/panel/test/v2/mon-sixstates.test.ts —— MIG-08 / IMPL-08-01：panel 六态 stale 出口对账
 *
 * 依据：plan/05 IMPL-08-01（views.ts＋overview/views.ts 领土；NEG-MON-01/02/03）；v2/08 §4.1 投影
 * 六态（observed/derived/unknown/stale/conflicted/gapped；未知不得显示为零/无风险/已完成；陈旧＝
 * 超新鲜度须重核）、§4.2 MON-12（低档事后审计逾期＝异常并公开标注「未经事后审计」）、§4.4（监控
 * 故障一等观察：受影响视图显示未知/受损，不得留空/为零/沿用最后健康快照）；v2/11 §十二 REC-OBS-01
 * （dataValidWindow/来源/游标/规则版本）与 REC-EVD-05（事后审计）；v2/17 NEG-MON-01/02/03；
 * L3P-01（stale 无出口、dataValidWindow 无来源——新鲜度未判定须显式且不得为绿）。
 *
 * 覆盖：
 *   ① 六态逐态标签/依据/tone（无「绿」取值）；observed/derived 无故障声明，其余为未知/受损；
 *   ② NEG-MON-01：未知不补 0/空/绿（空依据补原因、无 value 槽、无 ok:true）、空槽集显式整视图
 *      未知（空集不读成「无异常」）、非 complete 全槽 observed→conflicted（全绿不冒充健康）；
 *   ③ stale 出口：可行动出口必携 dataValidWindow＋权威来源＋游标＋规则版本；元数据不全/状态不一致
 *      →unreconciled（不得冒充出口）；
 *   ④ NEG-MON-02：低档结论逾期未审计且记录无标注 → 面板强制「未经事后审计」＋MON-12 异常；接收者
 *      不臆造；内部老板自审显式标注；
 *   ⑤ NEG-MON-03：报告 readOnly/mutatesFacts、冻结不可写、入参不被修改、模块导出面无写族命名；
 *   ⑥ 面板接线：/api/snapshot 的 observation 自述 derived＋新鲜度未判定（不伪造 dataValidWindow）；
 *      概览 /legacy 进度/财务页未知不补 0、已推导不显示为绿。
 *
 * 隔离：纯函数＋手写投影夹具（不连库、不读环境、不依赖系统时钟——时刻一律注入）。
 */
import { describe, expect, it } from 'vitest'
import { PROJECTION_STATES } from '@studio-next/contract'
import type { CompanySnapshot, ProjectionState } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import * as views from '../../src/views.ts'
import {
  PROJECTION_STATE_LABELS,
  buildAuditOverdueView,
  buildDashboardSnapshot,
  buildObservationExit,
} from '../../src/views.ts'
import type { ObservationInput } from '../../src/views.ts'
import { renderFinancePage, renderProgressPage } from '../../src/overview/views.ts'

const ISO = '2026-11-01T12:00:00.000Z'
const NOW = Date.parse(ISO)
const WINDOW = { from: '2026-11-01T10:00:00.000Z', to: '2026-11-01T11:00:00.000Z' }
const SOURCE = { endpoint: { refId: 'endpoint:panel', refVersion: '1.0.0' }, generation: 3 }

/** REC-OBS-01 投影夹具（默认可用快照：complete、两面、无故障；按需覆盖） */
function projection(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    view: { viewName: 'panel-monitor', company: 'demo' },
    projectionRuleVersion: 'panel/views@1',
    authoritativeSource: SOURCE,
    sourceCursor: 'cursor:snapshot:7',
    generatedAt: ISO,
    dataValidWindow: WINDOW,
    viewCompleteness: 'complete',
    stateAssignments: [
      { face: 'MON-04', state: 'observed', basis: '台账事件逐条可见', lastTrustedCursor: 'cursor:work:7' },
      { face: 'MON-07', state: 'derived', basis: '按 UTC 日聚合成本', lastTrustedCursor: 'cursor:cost:7' },
    ],
    staleExits: [],
    fault: null,
    ...overrides,
  }
}

const tonesOf = (report: ReturnType<typeof buildObservationExit>): Record<string, string> =>
  Object.fromEntries(report.faces.map((face) => [face.face, face.tone]))

describe('投影六态逐态（MON-ST；v2/08 §4.1）', () => {
  it('六态齐全：标签/依据非空；observed/derived=neutral，unknown/stale/conflicted/gapped=未知或受损', () => {
    const assignments = PROJECTION_STATES.map((state, index) => ({
      face: `F-${String(index)}`,
      state,
      basis: `依据：${state}`,
      lastTrustedCursor: `cursor:${state}`,
    }))
    const report = buildObservationExit(projection({ stateAssignments: assignments, viewCompleteness: 'incomplete' }), { freshnessJudged: true })

    expect(report.faces.map((face) => face.state)).toEqual([...PROJECTION_STATES])
    for (const face of report.faces) {
      expect(face.label).toBe(PROJECTION_STATE_LABELS[face.state])
      expect(face.basis.trim()).not.toBe('')
    }
    const tones = tonesOf(report)
    expect(tones['F-0']).toBe('neutral') // observed
    expect(tones['F-1']).toBe('neutral') // derived
    expect(tones['F-2']).toBe('unknown') // unknown
    expect(tones['F-3']).toBe('impaired') // stale
    expect(tones['F-4']).toBe('impaired') // conflicted
    expect(tones['F-5']).toBe('impaired') // gapped
    // tone 词表里没有「绿/健康」取值（类型＋运行值双重约束）
    expect(Object.values(tones).every((tone) => tone === 'neutral' || tone === 'unknown' || tone === 'impaired')).toBe(true)
  })

  it('陈旧面出口必携 dataValidWindow/权威来源/游标/规则版本＋须取更新快照（NEG-MON-01 stale 出口）', () => {
    const report = buildObservationExit(
      projection({
        stateAssignments: [
          { face: 'MON-07', state: 'stale', basis: '超新鲜度要求（maxAgeMs=3600000）', lastTrustedCursor: 'cursor:cost:6' },
        ],
        staleExits: [{ face: 'MON-07', requiresNewerSnapshot: true, lastTrustedCursor: 'cursor:cost:6' }],
      }),
      { freshnessJudged: true },
    )

    expect(report.staleUnreconciled).toEqual([])
    expect(report.staleExits).toHaveLength(1)
    const exit = report.staleExits[0]!
    expect(exit).toMatchObject({
      face: 'MON-07',
      requiresNewerSnapshot: true,
      lastTrustedCursor: 'cursor:cost:6',
      generatedAt: ISO,
      dataValidWindow: WINDOW,
      source: SOURCE,
      sourceCursor: 'cursor:snapshot:7',
      projectionRuleVersion: 'panel/views@1',
    })
    expect(report.faces[0]?.tone).toBe('impaired')
  })

  it('陈旧但元数据不全：不给可行动出口（unreconciled），仍显示受损——不得静默选边', () => {
    const report = buildObservationExit(
      projection({
        dataValidWindow: null,
        authoritativeSource: null,
        stateAssignments: [{ face: 'MON-07', state: 'stale', basis: '陈旧', lastTrustedCursor: null }],
      }),
      { freshnessJudged: true },
    )

    expect(report.staleExits).toEqual([])
    expect(report.faces[0]?.tone).toBe('impaired')
    expect(report.staleUnreconciled).toHaveLength(1)
    expect(report.staleUnreconciled[0]?.reason).toContain('不得冒充可行动出口')
  })

  it('来源声明陈旧而逐面状态非 stale：对账不一致进 unreconciled（不静默采信来源自报）', () => {
    const report = buildObservationExit(
      projection({
        stateAssignments: [{ face: 'MON-07', state: 'derived', basis: '按规则聚合', lastTrustedCursor: 'c:7' }],
        staleExits: [{ face: 'MON-07', requiresNewerSnapshot: true, lastTrustedCursor: 'c:7' }],
      }),
      { freshnessJudged: true },
    )

    expect(report.staleExits).toEqual([])
    expect(report.staleUnreconciled).toHaveLength(1)
    expect(report.staleUnreconciled[0]?.reason).toContain('对账不一致')
  })
})

describe('NEG-MON-01 未知不补 0/空/绿', () => {
  it('未知面：空依据补原因、游标显式 null、无 value 槽、无 ok:true、标签不含绿/健康', () => {
    const report = buildObservationExit(
      projection({
        viewCompleteness: 'unknown',
        stateAssignments: [{ face: 'MON-12', state: 'unknown', basis: '', lastTrustedCursor: null }],
      }),
      { freshnessJudged: true },
    )

    const face = report.faces[0]!
    expect(face.state).toBe('unknown')
    expect(face.tone).toBe('unknown')
    expect(face.basis).toContain('依据缺失')
    expect(face.lastTrustedCursor).toBeNull()
    expect(face.label).not.toMatch(/绿|健康|正常/)
    const json = JSON.stringify(report)
    expect(json).not.toContain('"value"')
    expect(json).not.toContain('"value":0')
    expect(json).not.toContain('"ok":true')
  })

  it('空槽集：显式整视图未知（空面集不得读成「无异常」）', () => {
    const report = buildObservationExit(projection({ stateAssignments: [] }), { freshnessJudged: true })

    expect(report.faces).toHaveLength(1)
    expect(report.faces[0]?.face).toBe('panel-monitor')
    expect(report.faces[0]?.state).toBe('unknown')
    expect(report.faces[0]?.basis).toContain('材料不足')
    expect(report.staleExits).toEqual([])
  })

  it('部分缺失：缺槽面保持 unknown，已给面不被连带补绿（全绿不冒充健康）', () => {
    const report = buildObservationExit(
      projection({
        viewCompleteness: 'incomplete',
        stateAssignments: [
          { face: 'MON-04', state: 'observed', basis: '有来源材料', lastTrustedCursor: 'c:4' },
          { face: 'MON-07', state: 'unknown', basis: '材料不足', lastTrustedCursor: null },
        ],
      }),
      { freshnessJudged: true },
    )

    expect(report.faces.map((face) => [face.face, face.state, face.tone])).toEqual([
      ['MON-04', 'observed', 'neutral'],
      ['MON-07', 'unknown', 'unknown'],
    ])
    expect(report.faces.some((face) => face.state === 'unknown')).toBe(true)
  })

  it('完整却全槽 observed：complete 允许 observed；非 complete 全 observed 降 conflicted', () => {
    const complete = buildObservationExit(projection(), { freshnessJudged: true })
    expect(complete.faces.every((face) => face.state === 'observed' || face.state === 'derived')).toBe(true)

    const green = buildObservationExit(
      projection({
        viewCompleteness: 'unknown',
        stateAssignments: [
          { face: 'MON-04', state: 'observed', basis: '有来源材料', lastTrustedCursor: 'c:4' },
          { face: 'MON-05', state: 'observed', basis: '有来源材料', lastTrustedCursor: 'c:5' },
        ],
      }),
      { freshnessJudged: true },
    )
    expect(green.faces.map((face) => face.state)).toEqual(['conflicted', 'conflicted'])
    expect(green.faces[0]?.basis).toContain('全绿不得冒充健康')
    expect(green.faces.every((face) => face.tone === 'impaired')).toBe(true)
  })

  it('运行期坏状态值：按 gapped 降级并要求取更新快照，不得冒充已观察', () => {
    const bad = {
      face: 'MON-15',
      state: 'green' as unknown as ProjectionState,
      basis: '坏源值',
      lastTrustedCursor: null,
    }
    const report = buildObservationExit(projection({ stateAssignments: [bad] }), { freshnessJudged: true })

    expect(report.faces[0]?.state).toBe('gapped')
    expect(report.faces[0]?.basis).toContain('状态值非法')
    expect(report.faces[0]?.tone).toBe('impaired')
  })

  it('新鲜度未判定：derived 面 tone=unknown（不得显示为绿——L3P-01）', () => {
    const report = buildObservationExit(projection())
    expect(report.freshness).toBe('unjudged')
    expect(report.faces.every((face) => face.tone === 'unknown')).toBe(true)
    const judged = buildObservationExit(projection(), { freshnessJudged: true })
    expect(judged.freshness).toBe('judged')
    expect(judged.faces.every((face) => face.tone === 'neutral')).toBe(true)
  })
})

describe('错误/冲突/缺口：一等观察不透传为正常', () => {
  it('gapped/conflicted 透传 fault（类别/细节）且显示受损', () => {
    const report = buildObservationExit(
      projection({
        viewCompleteness: 'unknown',
        stateAssignments: [
          { face: 'MON-12', state: 'gapped', basis: '采集中断（最后可信游标 c:5）', lastTrustedCursor: 'c:5' },
          { face: 'MON-15', state: 'conflicted', basis: '来源互相矛盾', lastTrustedCursor: 'c:6' },
        ],
        fault: { kind: 'collection_interrupted', detail: '采集中断：受影响视图显示未知/受损' },
      }),
      { freshnessJudged: true },
    )

    expect(report.fault).toEqual({ kind: 'collection_interrupted', detail: '采集中断：受影响视图显示未知/受损' })
    expect(report.faces.map((face) => face.tone)).toEqual(['impaired', 'impaired'])
  })
})

describe('NEG-MON-02 MON-12 低档事后审计逾期', () => {
  const overdueRow = {
    conclusionRef: 'REC-EVD-04:low-tier-1',
    deadline: '2026-10-01T00:00:00.000Z',
    auditRef: null,
    auditClass: null,
    overdueDisposition: null,
  }

  it('逾期未审计且记录无标注：面板强制「未经事后审计」＋MON-12 异常；接收者不臆造', () => {
    const view = buildAuditOverdueView([overdueRow], ISO)

    expect(view.rows[0]).toEqual({
      conclusionRef: 'REC-EVD-04:low-tier-1',
      overdue: true,
      publicLabel: '未经事后审计',
      auditClassLabel: null,
      escalation: null,
    })
    expect(view.anomaly).toEqual({ face: 'MON-12', count: 1, label: '未经事后审计' })
    // 六态对账报告可挂 MON-12 审计段（给定行且未审计→异常随报告透出，不吞）
    const report = buildObservationExit(projection(), { freshnessJudged: true, audits: [overdueRow], now: ISO })
    expect(report.audit?.anomaly?.label).toBe('未经事后审计')
  })

  it('已审计（内部老板自审）：显式标注自审、不得自称独立；未到期不判逾期', () => {
    const view = buildAuditOverdueView(
      [
        {
          conclusionRef: 'REC-EVD-04:low-tier-2',
          deadline: '2026-10-01T00:00:00.000Z',
          auditRef: 'REC-EVD-05:audit-2',
          auditClass: 'internal_boss_self_audit',
          overdueDisposition: null,
        },
        {
          conclusionRef: 'REC-EVD-04:low-tier-3',
          deadline: '2027-01-01T00:00:00.000Z',
          auditRef: null,
          auditClass: null,
          overdueDisposition: '待升级：最高宰相',
        },
      ],
      ISO,
    )

    expect(view.rows[0]?.overdue).toBe(false)
    expect(view.rows[0]?.publicLabel).toBeNull()
    expect(view.rows[0]?.auditClassLabel).toContain('内部老板自审')
    expect(view.rows[0]?.auditClassLabel).not.toBe('外部独立审计（外部锚）')
    expect(view.rows[1]?.overdue).toBe(false)
    expect(view.anomaly).toBeNull()
  })

  it('未注入评估时点：不拿系统时钟冒充逾期判定（anomaly=null）', () => {
    const view = buildAuditOverdueView([overdueRow])
    expect(view.rows[0]?.overdue).toBe(false)
    expect(view.anomaly).toBeNull()
  })
})

describe('NEG-MON-03 监控只读不改事实', () => {
  it('报告 readOnly/mutatesFacts 字面量、冻结不可写、入参原样（纯函数）', () => {
    const input = projection()
    const before = JSON.stringify(input)
    const report = buildObservationExit(input, { freshnessJudged: true })

    expect(report.readOnly).toBe(true)
    expect(report.mutatesFacts).toBe(false)
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.faces)).toBe(true)
    expect(Object.isFrozen(report.staleExits)).toBe(true)
    const mutable = report as unknown as { readOnly: boolean }
    expect(() => {
      mutable.readOnly = false
    }).toThrow(TypeError)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('模块导出面无写族命名（监控面不存在写台账/改事实的方法槽）', () => {
    const writeful = Object.keys(views).filter((name) => /insert|update|delete|write|mutate|append|persist|save/i.test(name))
    expect(writeful).toEqual([])
  })
})

describe('面板接线：/api/snapshot 自述六态（不伪造 dataValidWindow）', () => {
  const emptyLedger = {
    version: () => 15,
    listJobs: () => [],
    listWorkRecords: () => [],
    listSessions: () => [],
    queryEvents: () => [],
  } as unknown as Ledger

  it('快照带 observation：四面 derived＋新鲜度未判定＋数据窗未声明，无 stale 出口、无绿', () => {
    const snapshot = buildDashboardSnapshot(emptyLedger, { now: NOW })
    const observation = snapshot.observation

    expect(observation.faces.map((face) => face.face)).toEqual(['jobs', 'runs', 'workers', 'events'])
    expect(observation.faces.every((face) => face.state === 'derived')).toBe(true)
    expect(observation.faces.every((face) => face.tone === 'unknown')).toBe(true) // 未判定≠绿
    expect(observation.freshness).toBe('unjudged')
    expect(observation.dataValidWindow).toBeNull()
    expect(observation.staleExits).toEqual([])
    expect(observation.source).toBeNull()
    expect(observation.readOnly).toBe(true)
  })
})

describe('概览读面六态出口（overview/views.ts）', () => {
  const company: CompanySnapshot = {
    slug: 'corp-x',
    name: 'Corp X',
    level: 2,
    charter: 'charter',
    platform: { platform: 'youtrack' },
    departments: [],
    people: [],
    jobs: [],
  }

  it('无台账：未知＋ledger-not-mounted，不出现「共 0 单」、不显示为绿', () => {
    const html = renderProgressPage('corp-x', company, undefined)
    expect(html).toContain('未知（unknown）')
    expect(html).toContain('ledger-not-mounted')
    expect(html).toContain('不补 0/空/绿')
    expect(html).toContain('无台账数据')
    expect(html).not.toContain('共 0 单')
  })

  it('有台账无镜像行：已推导计数 0 显式不等于无单据（不把空读成健康）', () => {
    const html = renderProgressPage('corp-x', company, { basis: 'ticket-mirror', note: '镜像口径', total: 0, byState: [] })
    expect(html).toContain('已推导（derived）')
    expect(html).toContain('新鲜度未判定')
    expect(html).toContain('数据有效窗：未声明')
    expect(html).toContain('不等于无单据')
    expect(html).toContain('共 0 单')
  })

  it('财务页同口径：无台账=未知不补 0；有台账=已推导＋新鲜度未判定（不得显示为绿）', () => {
    const unknownHtml = renderFinancePage('corp-x', company, undefined)
    expect(unknownHtml).toContain('未知（unknown）')
    expect(unknownHtml).toContain('ledger-not-mounted')
    expect(unknownHtml).toContain('不补 0/空/绿')

    const finance = {
      basis: 'budgets+events' as const,
      note: '三口径分列',
      budgets: { reserveUsd: 0, reserveCount: 0, settleUsd: 0, settleCount: 0, refusalUsd: 0, refusalCount: 0, netUsd: 0 },
      llmDaily: [],
      monthly: [],
    }
    const derivedHtml = renderFinancePage('corp-x', company, finance)
    expect(derivedHtml).toContain('已推导（derived）')
    expect(derivedHtml).toContain('新鲜度未判定')
    expect(derivedHtml).toContain('数据有效窗：未声明')
  })
})
