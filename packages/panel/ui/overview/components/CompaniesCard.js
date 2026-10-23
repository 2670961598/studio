/**
 * CompaniesCard —— 公司清单页（/ 的换装面；04-§七：根路径列全部挂载公司）。
 *
 * 数据：/api/overview/companies（3s 轮询——新挂载/热重载后的公司下一周期可见）；
 * 行点击进公司概览 tab（站内导航不整页刷新）。mission=null 显示「未提供」——不臆造。
 */
import { computed, h } from 'vue'
import { NTag } from 'naive-ui'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import { go } from '../router.js'
import SnapshotBadge from './SnapshotBadge.js'

export default {
  name: 'CompaniesCard',
  setup() {
    const { data, error, asOfMs, loading } = useOverviewJson(() => '/api/overview/companies')

    const rows = computed(() => data.value?.companies ?? [])
    const meta = computed(() => rows.value.find((r) => r.snapshotMeta)?.snapshotMeta ?? null)

    const columns = [
      {
        title: '公司',
        key: 'name',
        minWidth: 180,
        render(row) {
          return h('a', { style: 'color:#80cbc4;cursor:pointer', onClick: () => go(`/${row.slug}/`) }, row.name)
        },
      },
      { title: 'slug', key: 'slug', width: 140 },
      {
        title: '等级',
        key: 'level',
        width: 80,
        render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => `L${String(row.level)}` }),
      },
      { title: '部门', key: 'departmentCount', width: 70 },
      { title: '人数', key: 'peopleCount', width: 70 },
      { title: '平台', key: 'platform', width: 110 },
      {
        title: '使命',
        key: 'mission',
        ellipsis: { tooltip: true },
        render: (row) => row.mission ?? '（未提供）',
      },
    ]

    return { data, error, asOfMs, loading, rows, columns, meta }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" title="公司清单" :bordered="true" style="margin-bottom:12px">
  <template #header-extra>
    <span style="color:#90a4ae;font-size:12px">{{ rows.length ? '已挂载 ' + String(rows.length) + ' 家公司' : '' }}</span>
  </template>
  <snapshot-badge :asOf="data?.asOf ?? ''" :meta="meta" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <n-data-table
    style="margin-top:8px"
    size="small"
    :columns="columns"
    :data="rows"
    :loading="loading"
    :row-key="(row) => row.slug"
    :bordered="false"
  />
  <div style="color:#90a4ae;font-size:12px;margin-top:8px">basis=company-directory · 只读面（docs/04-§七：概览路由按公司目录 slug）</div>
</n-card>
`,
}
