/**
 * JudgeCard —— 判断调用表（/api/judge：{basis, days, sites, totals, openBreakers, note}；
 * studio-dev-160 §6.5 面板读面 · 单D studio-dev-180）。
 * 行=按址统计（提案冻结四要件列）：site｜调用量（ok/降分解）｜降级率｜实费｜熔断态
 * （NTag 红=熔断中/绿=闭合——重放投影）｜连击｜原因分布（events.ts 钦定 reason 分组消费）｜最近。
 * 行序=服务端序（calls 降序，同数 site 升序）——面板零重排；口径 note 如实展示。
 */
import { h } from 'vue'
import { NTag } from 'naive-ui'
import { fmtDateTime, fmtDur, fmtUsd } from '../lib/format.js'

export default {
  name: 'JudgeCard',
  props: {
    body: { type: Object, default: null },
  },
  setup(props) {
    const columns = [
      {
        title: 'site',
        key: 'site',
        width: 170,
        ellipsis: { tooltip: true },
        render: (row) => h('code', { style: 'font-size:12px' }, row.site),
      },
      { title: '公司', key: 'company', width: 90, ellipsis: { tooltip: true } },
      {
        title: '调用量',
        key: 'calls',
        width: 150,
        render: (row) => `${String(row.calls)}（ok ${String(row.ok)} · 降 ${String(row.fallbacks)}）`,
      },
      {
        title: '降级率',
        key: 'fallbackRate',
        width: 90,
        render(row) {
          const hot = row.fallbackRate >= 0.5
          const text = `${(row.fallbackRate * 100).toFixed(1)}%`
          return h('span', { style: hot ? 'color:#e57373;font-weight:600' : '' }, text)
        },
      },
      {
        title: '实费',
        key: 'costUsd',
        width: 100,
        render: (row) => fmtUsd(row.costUsd),
      },
      {
        title: '均时',
        key: 'avgDurationMs',
        width: 90,
        render: (row) => (row.avgDurationMs === null ? '—' : fmtDur(row.avgDurationMs)),
      },
      {
        title: '熔断态',
        key: 'breaker.open',
        width: 200,
        render(row) {
          return h(
            NTag,
            { size: 'small', bordered: false, type: row.breaker.open ? 'error' : 'success' },
            {
              default: () =>
                row.breaker.open
                  ? `熔断中（自 ${String(row.breaker.openSinceDay)}）`
                  : `闭合（连击 ${String(row.breaker.streak)}/3）`,
            },
          )
        },
      },
      {
        title: '原因分布',
        key: 'byReason',
        ellipsis: { tooltip: true },
        render: (row) =>
          row.byReason.length === 0
            ? '—'
            : row.byReason.map((r) => `${r.reason}×${String(r.count)}`).join(' · '),
      },
      {
        title: '最近',
        key: 'lastTs',
        width: 140,
        render: (row) => fmtDateTime(row.lastTs),
      },
    ]
    const rows = () => (Array.isArray(props.body?.sites) ? props.body.sites : [])
    const extra = () => {
      const b = props.body
      if (b == null) return ''
      const rate = (b.totals?.fallbackRate ?? 0) * 100
      return (
        `共 ${String(b.totals?.calls ?? 0)}（ok ${String(b.totals?.ok ?? 0)} · 降 ${String(b.totals?.fallbacks ?? 0)}` +
        ` · 降级率 ${rate.toFixed(1)}% · 实费 ${fmtUsd(b.totals?.costUsd ?? 0)}）` +
        ` · 熔断中 ${String(b.openBreakers ?? 0)} 址`
      )
    }
    const subtitle = () => `近 ${String(props.body?.days ?? 7)} 天`
    const note = () => props.body?.note ?? ''
    return { columns, rows, extra, subtitle, note }
  },
  template: `
<n-card size="small">
  <template #header>
    <span style="font-size:13px;font-weight:600">判断调用 micro-judge</span>
    <n-tag v-if="(body?.openBreakers ?? 0) > 0" type="error" size="small" :bordered="false" style="margin-left:8px">
      熔断 {{ String(body?.openBreakers) }}
    </n-tag>
  </template>
  <template #header-extra><span style="color:#90a4ae;font-size:12px">{{ subtitle() }}</span></template>
  <n-data-table
    :columns="columns"
    :data="rows()"
    :bordered="false"
    size="small"
    :max-height="260"
    :row-key="(row) => row.site"
  />
  <n-empty v-if="rows().length === 0" description="窗口内无判断调用（JUDGE_* 事件）" style="padding:24px 0" />
  <n-alert v-if="note()" type="info" :bordered="false" style="margin-top:8px;font-size:11px">
    {{ note() }}
  </n-alert>
</n-card>
`,
}
