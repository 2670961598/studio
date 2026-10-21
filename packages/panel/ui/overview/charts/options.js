/**
 * charts/options —— :8789 概览面 ECharts option 纯函数构造器（DEV-12 刀二）。
 *
 * 纪律与刀一 ui/charts/options.js 同款：本文件只做「数据 → option 对象」，不碰 DOM
 * 不碰 echarts 实例——可单测（test/overview-ui.test.ts）。配色沿用 theme.js 调色板。
 *
 * 成本纪律（docs/26 C1 冻结）：三口径分列**不相加**——预算图只画 reserve/settle/refusal
 * 三根柱、无合计柱；净额（reserve−settle）只在统计数字面显示，不进任何求和图。
 * LLM 成本按日为单系列折线（v0 只列有事件的日——稀疏口径与 /legacy 面同源）。
 */
import { PANEL_PALETTE } from '../../theme.js'
import { fmtUsd } from '../../lib/format.js'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function base(extra = {}) {
  return {
    animation: !REDUCED_MOTION,
    backgroundColor: 'transparent',
    textStyle: { color: PANEL_PALETTE.dim, fontFamily: 'inherit' },
    ...extra,
  }
}

/**
 * 单据状态分布（进度页）：横向条形图，单系列计数——状态名做类目轴、计数做值轴，
 * 降序数据由服务端聚合定序（byState 已按计数降序、同数按状态名稳定序）。
 */
export function progressStatesOption(byState) {
  const rows = Array.isArray(byState) ? byState : []
  return base({
    grid: { left: 96, right: 30, top: 12, bottom: 26 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.state),
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: { color: PANEL_PALETTE.text, fontSize: 11 },
    },
    series: [
      {
        name: '单据数',
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { color: PANEL_PALETTE.teal, borderRadius: [0, 3, 3, 0] },
        data: rows.map((r) => r.count),
      },
    ],
  })
}

/** LLM 成本按日（财务页）：单系列折线（稀疏日——只画有事件的日，零填充归后续需要时加） */
export function financeDailyOption(llmDaily) {
  const rows = Array.isArray(llmDaily) ? llmDaily : []
  return base({
    grid: { left: 64, right: 16, top: 16, bottom: 26 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtUsd(Number(v)) },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: rows.map((r) => r.date.slice(5)),
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11, formatter: (v) => (v === 0 ? '0' : `$${String(v)}`) },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    series: [
      {
        name: 'LLM 成本',
        type: 'line',
        symbolSize: 5,
        lineStyle: { color: PANEL_PALETTE.teal, width: 2 },
        itemStyle: { color: PANEL_PALETTE.teal },
        data: rows.map((r) => r.costUsd),
      },
    ],
  })
}

/**
 * 三口径分列（财务页）：三根柱（reserve/settle/refusal），**无合计柱**（docs/26 C1
 * 分列不相加——合计/净额不进图；净额=reserve−settle 在统计数字面显示）。
 */
export function budgetsOption(budgets) {
  const b = budgets ?? { reserveUsd: 0, settleUsd: 0, refusalUsd: 0 }
  return base({
    grid: { left: 64, right: 16, top: 16, bottom: 26 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtUsd(Number(v)) },
    xAxis: {
      type: 'category',
      data: ['reserve', 'settle', 'refusal'],
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: { color: PANEL_PALETTE.text, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11, formatter: (v) => (v === 0 ? '0' : `$${String(v)}`) },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    series: [
      {
        name: '口径金额',
        type: 'bar',
        barMaxWidth: 26,
        itemStyle: { borderRadius: [3, 3, 0, 0], color: (p) => [PANEL_PALETTE.teal, PANEL_PALETTE.warn, PANEL_PALETTE.fail][p.dataIndex] ?? PANEL_PALETTE.teal },
        data: [b.reserveUsd, b.settleUsd, b.refusalUsd],
      },
    ],
  })
}
