/**
 * CompanyCard —— 公司概览卡（/<slug>/ 的概览 tab；snapshot 全字段 + 快照时间标注）。
 *
 * 数据：/api/overview/<slug>/snapshot（3s 轮询）。mission=null → 「未提供」（与 /legacy
 * 同判——契约快照无 mission 字段的拟稿注入位，server.ts 头注）。
 */
import { computed } from 'vue'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import SnapshotBadge from './SnapshotBadge.js'

export default {
  name: 'CompanyCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/snapshot`)
    const items = computed(() => {
      const d = data.value
      if (!d) return []
      return [
        { label: '公司', value: d.name },
        { label: '等级', value: `L${String(d.level)}` },
        { label: '使命', value: d.mission ?? '（未提供）' },
        { label: '章程', value: d.charter },
        { label: '平台绑定', value: d.platform },
        { label: '部门数', value: String(d.departmentCount) },
        { label: '人数', value: String(d.peopleCount) },
        { label: '定时岗', value: String(d.jobCount) },
      ]
    })
    return { data, error, asOfMs, loading, items }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" :title="data?.name ?? slug">
  <template #header-extra>
    <n-spin v-if="loading" :size="14" />
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <n-descriptions v-if="items.length" label-placement="left" :column="2" size="small" bordered style="margin-top:8px">
    <n-descriptions-item v-for="it in items" :key="it.label" :label="it.label">{{ it.value }}</n-descriptions-item>
  </n-descriptions>
</n-card>
`,
}
