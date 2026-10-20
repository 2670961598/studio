/**
 * EventsFeedCard —— 台账事件实时流卡（SSE 合流 feed + 连接状态点；DEV-1 §6/§7.2）。
 * NTimeline 呈现最近事件（ts 降序环形 50 条）；状态徽标：open=绿/connecting=黄/
 * reconnecting=红/unsupported=灰——如实亮，不假装连着。
 */
import { computed } from 'vue'
import { fmtTime } from '../lib/format.js'

const STATUS_META = {
  open: { label: '已连接', type: 'success' },
  connecting: { label: '连接中', type: 'warning' },
  reconnecting: { label: '重连中', type: 'error' },
  unsupported: { label: '不支持 SSE', type: 'default' },
}

export default {
  name: 'EventsFeedCard',
  props: {
    feed: { type: Array, default: () => [] },
    status: { type: String, default: 'connecting' },
  },
  setup(props) {
    const statusMeta = computed(() => STATUS_META[props.status] ?? STATUS_META.connecting)
    const items = computed(() =>
      props.feed.map((ev) => ({
        time: fmtTime(ev.ts),
        title: ev.event,
        content:
          `${ev.company ?? '—'} · ${ev.issue ?? '—'} · ${ev.actor ?? '—'}` +
          (ev.cost_usd !== undefined && ev.cost_usd !== null ? ` · $${Number(ev.cost_usd).toFixed(4)}` : ''),
        id: ev.id,
      })),
    )
    return { items, statusMeta }
  },
  template: `
<n-card size="small">
  <template #header>
    <span style="font-size:13px;font-weight:600">台账事件流</span>
    <n-tag :type="statusMeta.type" size="small" :bordered="false" style="margin-left:8px">
      {{ statusMeta.label }}
    </n-tag>
  </template>
  <template #header-extra>
    <span style="color:#90a4ae;font-size:12px">最近 {{ feed.length }} / 50 条</span>
  </template>
  <n-timeline v-if="items.length > 0" style="margin-top:4px;max-height:420px;overflow:auto">
    <n-timeline-item
      v-for="item in items"
      :key="item.id"
      :type="item.title === 'CIRCUIT_BREAK' ? 'error' : 'default'"
      :title="item.title"
      :content="item.content"
      :time="item.time"
    />
  </n-timeline>
  <n-empty v-else description="等待事件……（SSE 连接中）" style="padding:24px 0" />
</n-card>
`,
}
