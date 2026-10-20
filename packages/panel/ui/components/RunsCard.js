/**
 * RunsCard —— work_records 近况表（snapshot.runs：在途优先，started_at 降序；DEV-1 §7.2）。
 * 列：单号｜工号｜executor｜起跑｜时长（在途=至今，已收口=全程）｜状态（在途 warn/收口 ok）。
 */
import { h } from 'vue'
import { NTag } from 'naive-ui'
import { fmtDur, fmtTime } from '../lib/format.js'

export default {
  name: 'RunsCard',
  props: {
    runs: { type: Object, default: null },
  },
  setup(props) {
    const columns = [
      {
        title: '单号',
        key: 'issue',
        width: 170,
        ellipsis: { tooltip: true },
        render: (row) => h('span', null, row.issue),
      },
      { title: '工号', key: 'person_id', width: 120, ellipsis: { tooltip: true } },
      { title: 'executor', key: 'executor', width: 100, ellipsis: { tooltip: true } },
      {
        title: '起跑',
        key: 'started_at',
        width: 130,
        render: (row) => fmtTime(row.started_at),
      },
      {
        title: '时长',
        key: 'duration',
        width: 90,
        render: (row) => fmtDur((row.ended_at ?? Date.now()) - row.started_at),
      },
      {
        title: '状态',
        key: 'status',
        width: 100,
        render(row) {
          const done = row.ended_at !== undefined
          const failed = done && row.status === 'failed'
          return h(
            NTag,
            {
              size: 'small',
              bordered: false,
              type: failed ? 'error' : done ? 'success' : 'warning',
            },
            { default: () => (done ? row.status : '在途') },
          )
        },
      },
    ]
    const rows = () => (Array.isArray(props.runs?.recent) ? props.runs.recent : [])
    const extra = () =>
      `共 ${String(props.runs?.total ?? 0)} · 在途 ${String(props.runs?.inFlight ?? 0)} · 近 ${String(rows().length)} 条`
    return { columns, rows, extra }
  },
  template: `
<n-card size="small">
  <template #header><span style="font-size:13px;font-weight:600">runs 近况</span></template>
  <template #header-extra><span style="color:#90a4ae;font-size:12px">{{ extra() }}</span></template>
  <n-data-table
    :columns="columns"
    :data="rows()"
    :bordered="false"
    size="small"
    :max-height="260"
    :row-key="(row) => row.id"
  />
</n-card>
`,
}
