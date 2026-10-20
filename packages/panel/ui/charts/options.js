/**
 * charts/options —— ECharts option 纯函数构造器（DEV-1 方案 §7.3/§7.4）。
 *
 * 纪律：本文件只做「数据 → option 对象」，不碰 DOM 不碰 echarts 实例（生命周期归
 * composables/useEchart.js）——可单测、可复用。配色沿用旧页调色板（theme.js）。
 *
 * 成本纪律（docs/26 C1 冻结，展示面声明见 /api/costs note）：LLM 岛成本与收割成本
 * **分列两条线，绝不求和当总额**；预算净额 = reserve − settle（refusal 不计净额）。
 */
import { PANEL_PALETTE } from '../theme.js'
import { fmtUsd } from '../lib/format.js'

/** 减动效偏好（prefers-reduced-motion：图表动画关掉，重排仍生效） */
const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 图表通用底座：暗色系轴线/文字色 + 动效开关 */
function base(extra = {}) {
  return {
    animation: !REDUCED_MOTION,
    backgroundColor: 'transparent',
    textStyle: { color: PANEL_PALETTE.dim, fontFamily: 'inherit' },
    ...extra,
  }
}

/** 通用网格边距（容器小，留白紧凑） */
const GRID = { left: 58, right: 14, top: 34, bottom: 26 }

/** 成本趋势（§7.3.1）：双折线（LLM 岛 / 收割），分列不相加——无合计线是纪律 */
export function costsTrendOption(series) {
  const points = Array.isArray(series) ? series : []
  return base({
    grid: GRID,
    legend: { top: 2, textStyle: { color: PANEL_PALETTE.dim, fontSize: 11 }, itemWidth: 14 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => fmtUsd(Number(v)),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((p) => p.date.slice(5)),
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: PANEL_PALETTE.dim,
        fontSize: 11,
        formatter: (v) => (v === 0 ? '0' : `$${v}`),
      },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    series: [
      {
        name: 'LLM 岛成本',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: points.map((p) => p.llm_cost_usd),
        lineStyle: { color: PANEL_PALETTE.teal },
        itemStyle: { color: PANEL_PALETTE.teal },
        areaStyle: { color: PANEL_PALETTE.teal, opacity: 0.08 },
      },
      {
        name: '收割成本',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: points.map((p) => p.harvest_cost_usd),
        lineStyle: { color: PANEL_PALETTE.warn },
        itemStyle: { color: PANEL_PALETTE.warn },
        areaStyle: { color: PANEL_PALETTE.warn, opacity: 0.05 },
      },
    ],
  })
}

/** 预算三分量（§7.3.2）：reserve/settle/refusal 分组柱（日 × 三柱） */
export function budgetOption(series) {
  const points = Array.isArray(series) ? series : []
  return base({
    grid: GRID,
    legend: { top: 2, textStyle: { color: PANEL_PALETTE.dim, fontSize: 11 }, itemWidth: 14 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => fmtUsd(Number(v)),
    },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.date.slice(5)),
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: PANEL_PALETTE.dim,
        fontSize: 11,
        formatter: (v) => (v === 0 ? '0' : `$${v}`),
      },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    series: [
      {
        name: '预留 reserve',
        type: 'bar',
        barMaxWidth: 18,
        data: points.map((p) => p.reserve_usd),
        itemStyle: { color: PANEL_PALETTE.teal },
      },
      {
        name: '结算 settle',
        type: 'bar',
        barMaxWidth: 18,
        data: points.map((p) => p.settle_usd),
        itemStyle: { color: PANEL_PALETTE.ok },
      },
      {
        name: '拒绝 refusal',
        type: 'bar',
        barMaxWidth: 18,
        data: points.map((p) => p.refusal_usd),
        itemStyle: { color: PANEL_PALETTE.fail },
      },
    ],
  })
}

/**
 * 事件分布（§7.3.3）：按事件名聚合计数的横向条形图。
 * byEvent：[{name, count}]（app 侧按 snapshot.events 全量聚合并降序）；取 top-8，
 * 其余合并为「其他」——长尾不挤压主分布。
 */
export function eventDistributionOption(byEvent) {
  const rows = (Array.isArray(byEvent) ? byEvent : []).filter(
    (r) => r && typeof r.name === 'string' && Number.isFinite(r.count),
  )
  const top = rows.slice(0, 8)
  const rest = rows.slice(8).reduce((acc, r) => acc + r.count, 0)
  const data = rest > 0 ? [...top, { name: '其他', count: rest }] : top
  // 横向条形：y 轴类别自下而上画——升序入表让最大者居顶
  const ordered = [...data].sort((a, b) => a.count - b.count)
  return base({
    grid: { left: 128, right: 40, top: 8, bottom: 22 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      axisLabel: { color: PANEL_PALETTE.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: PANEL_PALETTE.border, opacity: 0.5 } },
    },
    yAxis: {
      type: 'category',
      data: ordered.map((r) => r.name),
      axisLine: { lineStyle: { color: PANEL_PALETTE.border } },
      axisLabel: {
        color: PANEL_PALETTE.text,
        fontSize: 11,
        width: 120,
        overflow: 'truncate',
      },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 14,
        data: ordered.map((r) => r.count),
        itemStyle: { color: PANEL_PALETTE.teal, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', color: PANEL_PALETTE.dim, fontSize: 11 },
      },
    ],
  })
}

/** run 构成（§7.3.4 附）：在途 vs 已收口 环形图 */
export function runCompositionOption(runsTotal, inFlight) {
  const total = Number.isFinite(runsTotal) ? runsTotal : 0
  const flying = Number.isFinite(inFlight) ? Math.min(inFlight, total) : 0
  return base({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: PANEL_PALETTE.dim, fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['42%', '66%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: PANEL_PALETTE.card, borderWidth: 2 },
        label: { color: PANEL_PALETTE.text, fontSize: 11, formatter: '{b} {c}' },
        data: [
          { name: '在途', value: flying, itemStyle: { color: PANEL_PALETTE.warn } },
          { name: '已收口', value: Math.max(total - flying, 0), itemStyle: { color: PANEL_PALETTE.ok } },
        ],
      },
    ],
  })
}
