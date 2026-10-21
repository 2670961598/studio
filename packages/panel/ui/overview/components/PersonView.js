/**
 * PersonView —— 人事档案页（/<slug>/people/<工号>；md 原文进 pre 块）。
 *
 * 数据：/api/overview/<slug>/people/<工号>。body=null → 在册但正文缺失（如实空态，
 * 与 /legacy 同判）；body 原文进 <pre>{{ body }}</pre>（Vue 模板自动转义——01-C2-04
 * 档案正文按文本不按 HTML）。
 */
import { useOverviewJson } from '../composables/useOverviewJson.js'
import { go } from '../router.js'
import SnapshotBadge from './SnapshotBadge.js'

export default {
  name: 'PersonView',
  props: {
    slug: { type: String, required: true },
    personId: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/people/${props.personId}`)
    const back = () => go(`/${props.slug}/people`)
    return { data, error, asOfMs, loading, back }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" :title="data ? `${data.person.id} ${data.person.name}` : personId">
  <template #header-extra>
    <n-button size="tiny" tertiary @click="back">← 花名册</n-button>
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <n-descriptions v-if="data" label-placement="left" :column="2" size="small" bordered style="margin-top:8px">
    <n-descriptions-item label="姓名">{{ data.person.name }}</n-descriptions-item>
    <n-descriptions-item label="login">{{ data.person.login }}</n-descriptions-item>
    <n-descriptions-item label="等级">L{{ String(data.person.level) }}</n-descriptions-item>
    <n-descriptions-item label="部门">{{ data.person.dept }}</n-descriptions-item>
  </n-descriptions>
  <n-card v-if="data && data.body !== null" size="small" title="档案正文（md 原文）" style="margin-top:12px">
    <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;line-height:1.7;color:#cfd8dc">{{ data.body }}</pre>
  </n-card>
  <n-empty v-else-if="data && !loading" description="在册但档案正文缺失（people/*.md 未提供——如实空态）" style="margin:16px 0" />
</n-card>
`,
}
