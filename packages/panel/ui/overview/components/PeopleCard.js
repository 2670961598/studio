/**
 * PeopleCard —— 花名册 tab（/<slug>/people；PersonRef 表 + 档案链接）。
 *
 * 数据：/api/overview/<slug>/people（hasBody=档案正文可读——仅可读者出「看档案」；
 * 未提供正文者如实标「无档案正文」，不臆造空档案）。
 */
import { h } from 'vue'
import { NButton } from 'naive-ui'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import { go } from '../router.js'
import SnapshotBadge from './SnapshotBadge.js'

export default {
  name: 'PeopleCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/people`)

    const columns = [
      { title: '工号', key: 'id', width: 110 },
      { title: '姓名', key: 'name', minWidth: 120 },
      { title: 'login', key: 'login', width: 130 },
      { title: '等级', key: 'level', width: 70, render: (row) => `L${String(row.level)}` },
      { title: '部门', key: 'dept', width: 150, ellipsis: { tooltip: true } },
      {
        title: '档案',
        key: 'hasBody',
        width: 120,
        render(row) {
          if (!row.hasBody) return h('span', { style: 'color:#90a4ae' }, '无档案正文')
          return h(
            NButton,
            { size: 'tiny', tertiary: true, type: 'primary', onClick: () => go(`/${props.slug}/people/${row.id}`) },
            { default: () => '看档案' },
          )
        },
      },
    ]

    return { data, error, asOfMs, loading, columns, rows: () => data.value?.people ?? [] }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" title="花名册">
  <template #header-extra>
    <span style="color:#90a4ae;font-size:12px">{{ (data?.people?.length ?? 0) > 0 ? `${String(data.people.length)} 人` : '' }}</span>
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <n-data-table
    style="margin-top:8px"
    size="small"
    :columns="columns"
    :data="data?.people ?? []"
    :loading="loading"
    :row-key="(row) => row.id"
    :bordered="false"
  />
</n-card>
`,
}
