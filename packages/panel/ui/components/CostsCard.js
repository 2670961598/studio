/**
 * CostsCard —— 成本趋势卡（/api/costs；DEV-1 §7.3——docs/26 C1 冻结口径的展示面）。
 *
 * 纪律（口径 note 原文随响应展示）：
 *   - LLM 岛成本与收割成本**两条线分列，绝不求和当总额**；
 *   - 预算 reserve/settle/refusal 分组柱；净额 net = reserve − settle 以 NStatistic 呈现
 *     （可为负——未释放的预留占用）；refusal 不计净额。
 * 图表由 ChartCard 承载（option 纯函数在 charts/options.js），本件管口径装配与统计行。
 */
import { computed } from 'vue'
import { budgetOption, costsTrendOption } from '../charts/options.js'
import { fmtUsd } from '../lib/format.js'
import ChartCard from './ChartCard.js'

export default {
  name: 'CostsCard',
  components: { ChartCard },
  props: {
    body: { type: Object, default: null },
  },
  setup(props) {
    const series = computed(() => (Array.isArray(props.body?.series) ? props.body.series : []))
    const hasData = computed(() => series.value.length > 0)
    const trendOption = computed(() => (hasData.value ? costsTrendOption(series.value) : null))
    const budgetBarOption = computed(() => (hasData.value ? budgetOption(series.value) : null))
    const totals = computed(() => props.body?.totals ?? null)
    const note = computed(() => props.body?.note ?? '')
    const days = computed(() => props.body?.days ?? 7)
    return { trendOption, budgetBarOption, hasData, totals, note, days, fmtUsd }
  },
  template: `
<div>
  <n-card size="small">
    <template #header>
      <span style="font-size:13px;font-weight:600">成本趋势（近 {{ days }} 天 · UTC 日切）</span>
    </template>
    <template #header-extra>
      <span style="color:#90a4ae;font-size:12px">LLM 岛 / 收割分列不相加（docs/26 C1）</span>
    </template>
    <div style="display:flex;gap:28px;flex-wrap:wrap;padding:4px 0 8px">
      <n-statistic label="LLM 岛成本" :value="totals ? fmtUsd(totals.llm_cost_usd) : '—'" />
      <n-statistic label="收割成本" :value="totals ? fmtUsd(totals.harvest_cost_usd) : '—'" />
      <n-statistic label="预算净额 reserve−settle" :value="totals ? fmtUsd(totals.net_usd) : '—'" />
      <n-statistic label="结算合计" :value="totals ? fmtUsd(totals.settle_usd) : '—'" />
      <n-statistic label="拒绝合计" :value="totals ? fmtUsd(totals.refusal_usd) : '—'" />
    </div>
    <n-alert v-if="note" type="info" :bordered="false" style="font-size:11px">{{ note }}</n-alert>
  </n-card>
  <n-grid cols="1 l:2" responsive="screen" :x-gap="12" :y-gap="12" style="margin-top:12px">
    <n-gi>
      <chart-card
        title="成本双线（分列）"
        subtitle="LLM 岛 vs 收割"
        :option="trendOption"
        :height="220"
        empty-text="窗口内无成本数据"
      />
    </n-gi>
    <n-gi>
      <chart-card
        title="预算三分量（分组柱）"
        subtitle="reserve / settle / refusal"
        :option="budgetBarOption"
        :height="220"
        empty-text="窗口内无预算数据"
      />
    </n-gi>
  </n-grid>
</div>
`,
}
