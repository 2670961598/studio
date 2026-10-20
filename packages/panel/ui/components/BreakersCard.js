/**
 * BreakersCard —— 断路器告警卡（/api/breakers：{count, breakers, note, days}；DEV-1 §7.2）。
 * NTimeline 呈现 (单号,签名) 聚合行：单号 · trips 次 · 最近触发 · 连击/阈值/bug 单；
 * 空=近期无熔断（好事，NEmpty）；口径 note 如实展示（复位未落账不做消红推断）。
 */
import { computed } from 'vue'
import { fmtDateTime } from '../lib/format.js'

export default {
  name: 'BreakersCard',
  props: {
    body: { type: Object, default: null },
  },
  setup(props) {
    const items = computed(() => {
      const rows = Array.isArray(props.body?.breakers) ? props.body.breakers : []
      return rows.map((b) => ({
        type: 'error',
        title: `${b.issue}${b.signature ? ' · ' + b.signature : ' · (无签名)'}`,
        content:
          `trips ${String(b.trips)} · 最近 ${fmtDateTime(b.lastTs)}` +
          (b.streak !== null ? ` · 连击 ${String(b.streak)}/${String(b.threshold ?? '?')}` : '') +
          (b.bug !== null ? ` · bug ${b.bug}` : '') +
          ` · ${b.company}`,
      }))
    })
    const note = computed(() => props.body?.note ?? '')
    const subtitle = computed(() => `近 ${String(props.body?.days ?? 7)} 天`)
    return { items, note, subtitle }
  },
  template: `
<n-card size="small">
  <template #header>
    <span style="font-size:13px;font-weight:600">断路器告警</span>
    <n-tag v-if="items.length > 0" type="error" size="small" :bordered="false" style="margin-left:8px">
      {{ items.length }}
    </n-tag>
  </template>
  <template #header-extra><span style="color:#90a4ae;font-size:12px">{{ subtitle }}</span></template>
  <n-timeline v-if="items.length > 0" style="margin-top:4px">
    <n-timeline-item
      v-for="(item, i) in items"
      :key="i"
      :type="item.type"
      :title="item.title"
      :content="item.content"
    />
  </n-timeline>
  <n-empty v-else description="近期无熔断触发" style="padding:24px 0" />
  <n-alert v-if="note" type="warning" :bordered="false" style="margin-top:8px;font-size:11px">
    {{ note }}
  </n-alert>
</n-card>
`,
}
