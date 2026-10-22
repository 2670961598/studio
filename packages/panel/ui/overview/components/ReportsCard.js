/**
 * ReportsCard —— 报表 tab（/<slug>/reports；127-B v1，studio-dev-176）。
 *
 * 数据：/api/overview/<slug>/reports（basis=ledger-events+directory-aux——台账事件为源、
 * 目录大小/mtime 仅辅助列，P4 口径）。v1 metadata-only：只列元数据不渲染正文（正文端点
 * 与口径待批示后开——REPORTS_BODY_NOTE；v2 逐级收集上汇为登记位，未立项不开）。
 * 诚实纪律：归档缺失（台账有落位、目录无件）红标不静默跳过；无台账锚历史件如实标注；
 * 受辖岗从未落位如实标注；无台账→灯全灰降级，不臆造。
 */
import { computed, h } from 'vue'
import { NTag } from 'naive-ui'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import SnapshotBadge from './SnapshotBadge.js'

/** 灯 → 视觉映射（与 reports.ts REPORT_LIGHT_TEXT 同表口径——浏览器侧不可 import TS，等价复刻） */
const LIGHT_META = {
  fresh: { text: '产出落位', type: 'success' },
  stale: { text: '停跑/从未跑', type: 'error' },
  debt: { text: '对账欠账', type: 'warning' },
  none: { text: '无台账信号', type: 'default' },
}

/** epoch ms → 本地时间串（页面只读展示；空值=—） */
const fmtTime = (ms) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toLocaleString() : '—')

/** 字节数 → 人读（辅助列；空值=—，读面未挂/归档缺失） */
const fmtSize = (bytes) => {
  if (typeof bytes !== 'number' || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default {
  name: 'ReportsCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/reports`)
    const reports = computed(() => data.value?.reports ?? null)

    /** 行时序展示：台账 ts（权威）优先，无锚退 mtime 并亮「目录」徽（可被 touch 洗绿——辅助列） */
    const rowTime = (row) => {
      if (row.ledgerTs !== null) return { text: fmtTime(row.ledgerTs), basis: '台账' }
      if (row.mtimeMs !== null) return { text: fmtTime(row.mtimeMs), basis: '目录' }
      return { text: '—', basis: '' }
    }

    /** 行状态标（归档缺失=红、无台账锚=橙、其余=默认；缺失件绝不静默跳过） */
    const rowState = (row) => {
      if (row.missing) return { text: '归档缺失', type: 'error' }
      if (row.unanchored) return { text: '无台账锚', type: 'warning' }
      return { text: '已落账', type: 'default' }
    }

    const summaryColumns = [
      { title: '部门', key: 'dept', minWidth: 110 },
      {
        title: '灯',
        key: 'light',
        width: 130,
        render: (row) => h(NTag, { size: 'small', bordered: false, type: LIGHT_META[row.light]?.type ?? 'default' }, { default: () => LIGHT_META[row.light]?.text ?? row.light }),
      },
      {
        title: '最新件',
        key: 'newest',
        minWidth: 260,
        render: (row) => (row.newest === null ? '—（尚无归档件）' : `${row.newest.name}（${rowTime(row.newest).text}）`),
      },
      { title: '件数', key: 'itemsCount', width: 70 },
      {
        title: '缺失/无锚',
        key: 'flags',
        width: 100,
        render: (row) => {
          const missing = row.items.filter((it) => it.missing).length
          const unanchored = row.items.filter((it) => it.unanchored).length
          return `${missing} / ${unanchored}`
        },
      },
      { title: '受辖岗（从未落位）', key: 'jobsNote', width: 170, render: (row) => `${row.jobs.length}（${row.jobs.filter((j) => j.neverLanded).length}）` },
    ]

    const itemColumns = [
      {
        title: '文件名',
        key: 'name',
        minWidth: 280,
        render: (row) =>
          h('span', { title: row.path, style: row.missing ? 'color:#ef9a9a' : '' }, row.name),
      },
      {
        title: '状态',
        key: 'state',
        width: 110,
        render: (row) => h(NTag, { size: 'small', bordered: false, type: rowState(row).type }, { default: () => rowState(row).text }),
      },
      {
        title: '落账时间（台账）',
        key: 'ledgerTs',
        width: 180,
        render: (row) => {
          const t = rowTime(row)
          return t.basis === '' ? '—' : `${t.text}${t.basis === '目录' ? '（目录 mtime）' : ''}`
        },
      },
      { title: '大小', key: 'sizeBytes', width: 90, render: (row) => fmtSize(row.sizeBytes) },
      { title: '单号', key: 'ticket', width: 150, render: (row) => row.ticket ?? '—' },
      { title: '岗', key: 'jobId', width: 170, render: (row) => row.jobId ?? '—' },
    ]

    const summaryRows = computed(() => (reports.value === null ? [] : reports.value.departments.map((g) => ({ ...g, itemsCount: g.items.length }))))

    return { data, error, asOfMs, loading, reports, summaryColumns, summaryRows, itemColumns, fmtTime, LIGHT_META }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" title="报表（逐级聚合 v1 · metadata-only）">
  <template #header-extra>
    <n-spin v-if="loading" :size="14" />
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert type="info" size="small" style="margin-top:8px" title="v1 只列元数据">{{ reports?.bodyNote ?? '……' }}</n-alert>
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <template v-if="reports">
    <n-space style="margin-top:8px" :size="24" align="center">
      <n-statistic label="部门分组" :value="reports.departments.length" />
      <n-tag size="small" :bordered="false" :type="LIGHT_META[reports.companyLight]?.type ?? 'default'">公司级灯：{{ LIGHT_META[reports.companyLight]?.text ?? reports.companyLight }}</n-tag>
      <n-tag v-if="!reports.ledgerAvailable" size="small" type="warning" :bordered="false">无台账——灯面降级（全灰），清单退目录件</n-tag>
      <n-tag v-if="!reports.dirAvailable" size="small" type="warning" :bordered="false">目录读面未挂——大小/mtime 缺省，不判归档缺失</n-tag>
    </n-space>
    <n-data-table style="margin-top:12px" size="small" :columns="summaryColumns" :data="summaryRows" :bordered="false" :row-key="(r) => r.dept" />
    <n-collapse style="margin-top:12px">
      <n-collapse-item v-for="group in reports.departments" :key="group.dept" :title="group.dept + '（' + group.items.length + ' 件）'">
        <template #header-extra>
          <n-tag size="small" :bordered="false" :type="LIGHT_META[group.light]?.type ?? 'default'">{{ LIGHT_META[group.light]?.text ?? group.light }}</n-tag>
        </template>
        <div v-if="group.jobs.length > 0" style="margin-bottom:8px">
          <n-tag
            v-for="job in group.jobs"
            :key="job.jobId"
            size="small"
            :bordered="false"
            :type="LIGHT_META[job.light]?.type ?? 'default'"
            :title="job.lastSignalText ?? ''"
            style="margin:0 6px 6px 0"
          >
            {{ job.jobId }} · {{ LIGHT_META[job.light]?.text ?? job.light }}{{ job.neverLanded ? ' · 从未落位' : '' }}（落位 {{ job.landings }}）
          </n-tag>
        </div>
        <div style="color:#90a4ae;font-size:12px;margin-bottom:8px">{{ group.lightText }}<template v-if="group.deptPath"> · {{ group.deptPath }}</template></div>
        <n-data-table size="small" :columns="itemColumns" :data="group.items" :bordered="false" :row-key="(r) => r.path" />
      </n-collapse-item>
    </n-collapse>
    <div style="color:#90a4ae;font-size:12px;margin-top:8px">{{ reports.v2Note }}</div>
  </template>
  <n-empty v-else-if="!loading && !error" description="报表读面未挂载（无数据源注入——如实降级）" style="margin:16px 0" />
</n-card>
`,
}
