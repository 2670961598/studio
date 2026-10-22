/**
 * InboxCard —— 收件箱表（/api/inbox：{total, ready, awaitingApproval, persons,
 * oldestWaitMs, rows}；129-§6.2 R2/R5，studio-dev-167 单B）。
 * 行序=核心排序键（置顶恒首→score 降→FIFO→单号）——面板零重排，服务端序即显序。
 * 列：单号（置顶徽标）｜工号｜状态（ready/待批）｜prio｜boost｜等待（时长人话）｜归因。
 */
import { h } from 'vue'
import { NTag } from 'naive-ui'
import { fmtTime } from '../lib/format.js'

/** 等待时长人话（ms → 「2.5h」/「3m」/「45s」——观测面不做精确计时呈现） */
function fmtWait(ms) {
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)}h`
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 1000)}s`
}

export default {
  name: 'InboxCard',
  props: {
    body: { type: Object, default: null },
  },
  setup(props) {
    const columns = [
      {
        title: '单号',
        key: 'ticket',
        width: 160,
        ellipsis: { tooltip: true },
        render(row) {
          const tag = row.pinned
            ? h(NTag, { type: 'error', size: 'small', bordered: false, style: 'margin-left:6px' }, { default: () => '置顶' })
            : null
          return h('span', null, [row.ticket, tag])
        },
      },
      { title: '工号', key: 'person', width: 110, ellipsis: { tooltip: true } },
      {
        title: '状态',
        key: 'ready_state',
        width: 90,
        render(row) {
          const waiting = row.ready_state === 'awaiting_approval'
          return h(
            NTag,
            { size: 'small', bordered: false, type: waiting ? 'warning' : 'info' },
            { default: () => (waiting ? '待批' : '排队') },
          )
        },
      },
      { title: 'prio', key: 'priority', width: 70 },
      {
        title: 'boost',
        key: 'boost_tier',
        width: 70,
        render: (row) => (row.boost_tier > 0 ? `+${String(row.boost_tier)}` : '—'),
      },
      {
        title: '等待',
        key: 'waitingMs',
        width: 90,
        render(row) {
          const hot = row.waitingMs >= 3_600_000
          return h('span', { style: hot ? 'color:#e57373;font-weight:600' : '' }, fmtWait(row.waitingMs))
        },
      },
      {
        title: '入队',
        key: 'first_seen_at',
        width: 130,
        render: (row) => fmtTime(row.first_seen_at),
      },
      { title: '归因', key: 'why', ellipsis: { tooltip: true } },
    ]
    const rows = () => (Array.isArray(props.body?.rows) ? props.body.rows : [])
    const extra = () => {
      const b = props.body
      if (b == null) return ''
      return (
        `共 ${String(b.total ?? 0)} · 排队 ${String(b.ready ?? 0)} · 待批 ${String(b.awaitingApproval ?? 0)}` +
        ` · ${String(b.persons ?? 0)} 人 · 最久 ${b.oldestWaitMs > 0 ? fmtWait(b.oldestWaitMs) : '—'}`
      )
    }
    return { columns, rows, extra }
  },
  template: `
<n-card size="small">
  <template #header><span style="font-size:13px;font-weight:600">收件箱 todo_queue</span></template>
  <template #header-extra><span style="color:#90a4ae;font-size:12px">{{ extra() }}</span></template>
  <n-data-table
    :columns="columns"
    :data="rows()"
    :bordered="false"
    size="small"
    :max-height="240"
    :row-key="(row) => row.ticket"
  />
</n-card>
`,
}
