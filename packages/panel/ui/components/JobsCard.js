/**
 * JobsCard —— 定时岗表（/api/jobs：{total, due, jobs}；DEV-1 方案 §7.2）。
 * 列：岗位（due 高亮）｜公司｜cron｜下次应跑｜状态。行密度 small + max-height 防长表撑爆。
 */
import { h } from 'vue'
import { NTag } from 'naive-ui'
import { fmtTime } from '../lib/format.js'

export default {
  name: 'JobsCard',
  props: {
    body: { type: Object, default: null },
  },
  setup(props) {
    const columns = [
      {
        title: '岗位',
        key: 'job_id',
        width: 200,
        ellipsis: { tooltip: true },
        render(row) {
          const tag = row.due
            ? h(NTag, { type: 'warning', size: 'small', bordered: false, style: 'margin-left:6px' }, { default: () => 'due' })
            : null
          return h('span', null, [row.job_id, tag])
        },
      },
      { title: '公司', key: 'company', width: 140, ellipsis: { tooltip: true } },
      { title: 'cron', key: 'cron', width: 110, ellipsis: { tooltip: true } },
      {
        title: '下次应跑',
        key: 'next_run_at',
        width: 130,
        render: (row) => fmtTime(row.next_run_at),
      },
      {
        title: '状态',
        key: 'status',
        width: 90,
        render(row) {
          const paused = row.status === 'paused'
          return h(
            NTag,
            { size: 'small', bordered: false, type: paused ? 'default' : 'success' },
            { default: () => (row.status ?? '—') },
          )
        },
      },
    ]
    const rows = () => (Array.isArray(props.body?.jobs) ? props.body.jobs : [])
    const extra = () => `共 ${String(props.body?.total ?? rows().length)} · due ${String(props.body?.due ?? 0)}`
    return { columns, rows, extra }
  },
  template: `
<n-card size="small">
  <template #header><span style="font-size:13px;font-weight:600">定时岗 jobs</span></template>
  <template #header-extra><span style="color:#90a4ae;font-size:12px">{{ extra() }}</span></template>
  <n-data-table
    :columns="columns"
    :data="rows()"
    :bordered="false"
    size="small"
    :max-height="240"
    :row-key="(row) => row.job_id"
  />
</n-card>
`,
}
