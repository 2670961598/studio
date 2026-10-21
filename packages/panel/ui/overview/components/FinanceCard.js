/**
 * FinanceCard —— 财务 tab（/<slug>/finance；三口径分列 + LLM 成本按日）。
 *
 * 数据：/api/overview/<slug>/finance。finance=null → 无台账降级（如实说明）。
 * 图表纪律（docs/26 C1 冻结）：预算三口径分列**不相加**——图无合计柱；净额=reserve−settle
 * 只在统计数字面显示（refusal 不计净额）。LLM 按日单线。
 */
import { computed } from 'vue'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import { budgetsOption, financeDailyOption } from '../charts/options.js'
import SnapshotBadge from './SnapshotBadge.js'
import ChartCard from '../../components/ChartCard.js'

export default {
  name: 'FinanceCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/finance`)
    const finance = computed(() => data.value?.finance ?? null)
    const budgets = computed(() => (finance.value === null ? null : budgetsOption(finance.value.budgets)))
    const daily = computed(() => (finance.value === null ? null : financeDailyOption(finance.value.llmDaily)))
    const net = computed(() => (finance.value === null ? null : finance.value.budgets.reserveUsd - finance.value.budgets.settleUsd))
    return { data, error, asOfMs, loading, finance, budgets, daily, net }
  },
  components: { SnapshotBadge, ChartCard },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" title="财务（三口径分列 · docs/26 C1）">
  <template #header-extra>
    <n-spin v-if="loading" :size="14" />
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <template v-if="finance">
    <n-space style="margin-top:8px" :size="24">
      <n-statistic label="reserve 预留" :value="finance.budgets.reserveUsd" />
      <n-statistic label="settle 结算" :value="finance.budgets.settleUsd" />
      <n-statistic label="refusal 拒批" :value="finance.budgets.refusalUsd" />
      <n-statistic label="净额（reserve−settle）" :value="net" />
    </n-space>
    <n-alert type="info" size="small" style="margin-top:8px" :bordered="false">{{ finance.note }}</n-alert>
    <chart-card title="三口径分列（无合计——C1 分列不相加）" :option="budgets" :height="220" empty-text="无预算" style="margin-top:12px" />
    <chart-card title="LLM 成本按日（单线 · v0 只列有事件的日）" :option="daily" :height="220" empty-text="无 LLM 成本事件" style="margin-top:12px" />
    <div v-if="(finance.llmDaily?.length ?? 0) > 0" style="color:#90a4ae;font-size:12px;margin-top:8px">
      {{ finance.llmDaily[0].date }} ~ {{ finance.llmDaily[finance.llmDaily.length - 1].date }} · {{ String(finance.llmDaily.length) }} 个有事件日
    </div>
  </template>
  <n-empty v-else-if="!loading && !error" description="无台账数据（--db 未给或库为空——如实降级）" style="margin:16px 0" />
</n-card>
`,
}
