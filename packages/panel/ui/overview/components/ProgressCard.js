/**
 * ProgressCard —— 单据进度 tab（/<slug>/progress；ticket_mirror 按状态聚合）。
 *
 * 数据：/api/overview/<slug>/progress。progress=null → 无台账降级（如实说明，不臆造空聚合
 * ——与 /legacy 同判）。图：横向条形单系列（charts/options.js 纪律：无合计系列）。
 */
import { computed } from 'vue'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import { progressStatesOption } from '../charts/options.js'
import SnapshotBadge from './SnapshotBadge.js'
import ChartCard from '../../components/ChartCard.js'

export default {
  name: 'ProgressCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/progress`)
    const progress = computed(() => data.value?.progress ?? null)
    const option = computed(() => (progress.value === null ? null : progressStatesOption(progress.value.byState)))
    const rows = computed(() => (progress.value === null ? [] : progress.value.byState.map((r) => ({ ...r, share: progress.value.total > 0 ? `${((r.count / progress.value.total) * 100).toFixed(1)}%` : '—' }))))
    const columns = [
      { title: '状态', key: 'state', minWidth: 140 },
      { title: '单据数', key: 'count', width: 90 },
      { title: '占比', key: 'share', width: 90 },
    ]
    return { data, error, asOfMs, loading, progress, option, rows, columns }
  },
  components: { SnapshotBadge, ChartCard },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" title="单据进度（ticket_mirror 状态聚合）">
  <template #header-extra>
    <n-spin v-if="loading" :size="14" />
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <template v-if="progress">
    <n-space style="margin-top:8px" :size="24">
      <n-statistic label="单据总数" :value="progress.total" />
      <n-statistic label="状态数" :value="progress.byState.length" />
    </n-space>
    <chart-card title="状态分布（降序）" :option="option" :height="240" empty-text="无单据" style="margin-top:12px" />
    <n-data-table style="margin-top:8px" size="small" :columns="columns" :data="rows" :bordered="false" :row-key="(r) => r.state" />
    <div style="color:#90a4ae;font-size:12px;margin-top:8px">{{ progress.note }}</div>
  </template>
  <n-empty v-else-if="!loading && !error" description="无台账数据（--db 未给或库为空——如实降级）" style="margin:16px 0" />
</n-card>
`,
}
