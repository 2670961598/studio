/**
 * useEchart —— ECharts 实例生命周期包装（DEV-1 方案 §7.6）。
 *
 * 职责：init（dark 主题/透明底）/ option 变更重绘（notMerge 全量替换——option 由
 * 纯函数整体重建）/ ResizeObserver 随容器缩放 / 卸载时 dispose 防泄漏。
 * 数据与 option 构造全在调用侧（charts/options.js 纯函数）——本件不掺业务。
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import * as echarts from 'echarts'

/**
 * useEchart(elRef, optionRef)：elRef=容器 DOM ref；optionRef=computed option ref
 * （空数据时调用侧给 null——本件跳过 setOption，空态归 ChartCard 的 NEmpty）。
 */
export function useEchart(elRef, optionRef) {
  let chart = null
  let observer = null

  onMounted(() => {
    const el = elRef.value
    if (!el) return
    chart = echarts.init(el, 'dark', { renderer: 'canvas' })
    if (optionRef.value) chart.setOption(optionRef.value)
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        if (chart) chart.resize()
      })
      observer.observe(el)
    }
  })

  watch(optionRef, (opt) => {
    if (chart && opt) chart.setOption(opt, { notMerge: true })
  })

  onBeforeUnmount(() => {
    if (observer) observer.disconnect()
    if (chart) chart.dispose()
    chart = null
    observer = null
  })

  return {
    resize: () => {
      if (chart) chart.resize()
    },
  }
}
