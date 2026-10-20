/**
 * ChartCard —— NCard + ECharts 容器包装（DEV-1 方案 §7.6）。
 *
 * 容器纪律：图表 div 永远挂载（v-if 换出容器会让 echarts 实例指向脱挂 DOM——经典坑），
 * 空态用绝对定位 NEmpty 覆盖层；option 由纯函数构造（charts/options.js），生命周期归
 * composables/useEchart.js。样式全内联/Naive——本目录零 CSS 文件。
 */
import { computed, ref } from 'vue'
import { useEchart } from '../composables/useEchart.js'

export default {
  name: 'ChartCard',
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    /** ECharts option（null/undefined = 空态盖 NEmpty） */
    option: { type: Object, default: null },
    height: { type: Number, default: 240 },
    emptyText: { type: String, default: '暂无数据' },
    loading: { type: Boolean, default: false },
  },
  setup(props) {
    const el = ref(null)
    const optionRef = computed(() => props.option)
    useEchart(el, optionRef)
    const boxStyle = computed(() => ({ position: 'relative', height: `${String(props.height)}px` }))
    return { el, boxStyle }
  },
  template: `
<n-card size="small">
  <template #header>
    <span style="font-size:13px;font-weight:600">{{ title }}</span>
  </template>
  <template v-if="subtitle" #header-extra>
    <span style="color:#90a4ae;font-size:12px">{{ subtitle }}</span>
  </template>
  <n-spin :show="loading">
    <div :style="boxStyle">
      <div ref="el" style="position:absolute;inset:0"></div>
      <div v-if="!option" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <n-empty size="small" :description="emptyText" />
      </div>
    </div>
  </n-spin>
</n-card>
`,
}
