/**
 * WorkersCard —— 活跃 workers 表（snapshot.workers：v0 台账聚合口径；DEV-1 §7.2）。
 * 列：工号｜在途 runs｜在途 sessions｜executors｜涉及单号｜最早活动至今。
 * 口径 note 如实展示（basis=ledger-v0——v0.4 daemon 内存态接管后整体替换）。
 */
import { fmtDur, fmtList } from '../lib/format.js'

export default {
  name: 'WorkersCard',
  props: {
    workers: { type: Object, default: null },
  },
  setup(props) {
    const columns = [
      { title: '工号', key: 'person_id', width: 130, ellipsis: { tooltip: true } },
      { title: '在途 runs', key: 'activeRuns', width: 90 },
      { title: '在途 sessions', key: 'activeSessions', width: 110 },
      { title: 'executors', key: 'executors', width: 110, render: (row) => fmtList(row.executors) },
      {
        title: '涉及单号',
        key: 'issues',
        ellipsis: { tooltip: true },
        render: (row) => fmtList(row.issues),
      },
      {
        title: '最早活动',
        key: 'sinceMs',
        width: 100,
        render: (row) => fmtDur(Date.now() - row.sinceMs),
      },
    ]
    const rows = () => (Array.isArray(props.workers?.active) ? props.workers.active : [])
    const note = () => props.workers?.note ?? ''
    return { columns, rows, note }
  },
  template: `
<n-card size="small">
  <template #header>
    <span style="font-size:13px;font-weight:600">活跃 workers</span>
    <n-tag size="small" :bordered="false" style="margin-left:8px">{{ workers?.basis ?? '…' }}</n-tag>
  </template>
  <template #header-extra>
    <span style="color:#90a4ae;font-size:12px">共 {{ rows().length }}</span>
  </template>
  <n-data-table
    :columns="columns"
    :data="rows()"
    :bordered="false"
    size="small"
    :max-height="240"
    :row-key="(row) => row.person_id"
  />
  <n-alert v-if="note()" type="info" :bordered="false" style="margin-top:8px;font-size:11px">
    {{ note() }}
  </n-alert>
</n-card>
`,
}
