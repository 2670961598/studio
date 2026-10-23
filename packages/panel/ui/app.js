/**
 * app —— 根组件（DEV-1 方案 §7.1：12 栅格装配六卡两图 + 页头状态行）。
 *
 * 布局（栅格 cols="12" 自适应 span）：
 *   StatStrip（全宽）→ [事件分布 | run 构成] → JobsCard（4）｜RunsCard（4）｜WorkersCard（4）
 *   → InboxCard（全宽：todo_queue 收件箱，129-§6.2 R5）→ CostsCard（全宽：统计行+双图）
 *   → JudgeCard（全宽：判断调用按址统计，160 §6.5 单D）→ BreakersCard（6）｜EventsFeedCard（6）。
 * 数据流：useSnapshot 四读面轮询（3s）+ useLedgerStream SSE 实时事件（backlog 合流）。
 */
import { computed } from 'vue'
import { useLedgerStream } from './composables/useLedgerStream.js'
import { useSnapshot } from './composables/useSnapshot.js'
import { eventDistributionOption, runCompositionOption } from './charts/options.js'
import BreakersCard from './components/BreakersCard.js'
import ChartCard from './components/ChartCard.js'
import CostsCard from './components/CostsCard.js'
import EventsFeedCard from './components/EventsFeedCard.js'
import InboxCard from './components/InboxCard.js'
import JudgeCard from './components/JudgeCard.js'
import JobsCard from './components/JobsCard.js'
import RunsCard from './components/RunsCard.js'
import StatStrip from './components/StatStrip.js'
import WorkersCard from './components/WorkersCard.js'
import { fmtTime } from './lib/format.js'
import { darkTheme, panelThemeOverrides } from './theme.js'

export default {
  name: 'PanelApp',
  components: {
    BreakersCard,
    ChartCard,
    CostsCard,
    EventsFeedCard,
    InboxCard,
    JudgeCard,
    JobsCard,
    RunsCard,
    StatStrip,
    WorkersCard,
  },
  setup() {
    const { state } = useSnapshot()
    const { feed, status } = useLedgerStream()

    const distOption = computed(() => {
      const byEvent = Array.isArray(state.snapshot?.events?.byEvent) ? state.snapshot.events.byEvent : []
      if (byEvent.length === 0) return null
      return eventDistributionOption(byEvent.map((r) => ({ name: r.event, count: r.count })))
    })
    const runCompOption = computed(() => {
      const runs = state.snapshot?.runs
      if (!runs) return null
      return runCompositionOption(runs.total, runs.inFlight)
    })
    const headMeta = computed(() =>
      state.snapshot
        ? `schema v${String(state.snapshot.schemaVersion)} · 快照 ${fmtTime(state.snapshot.generatedAt)} · 轮询 3s + SSE`
        : '连接中……',
    )

    return {
      state,
      feed,
      status,
      distOption,
      runCompOption,
      headMeta,
      darkTheme,
      panelThemeOverrides,
    }
  },
  template: `
<n-config-provider :theme="darkTheme" :theme-overrides="panelThemeOverrides" style="height:100%">
  <n-global-style />
  <div style="max-width:1440px;margin:0 auto;padding:16px">
    <header style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:4px 2px 12px">
      <h1 style="font-size:16px;font-weight:600;margin:0;color:#eceff1">Studio Next 监控（:8791 只读面）</h1>
      <span style="color:#90a4ae;font-size:12px">{{ headMeta }}</span>
      <span style="margin-left:auto">
        <a href="/legacy" style="color:#80cbc4;font-size:12px">/legacy 旧版</a>
      </span>
    </header>
    <n-alert v-if="state.error" type="error" :bordered="false" style="margin-bottom:12px">
      读面拉取失败：{{ state.error }}（其余读面照常展示；恢复后自动刷新）
    </n-alert>
    <n-space vertical :size="12">
      <stat-strip :snapshot="state.snapshot" />
      <n-grid cols="1 l:2" responsive="screen" :x-gap="12" :y-gap="12">
        <n-gi>
          <chart-card
            title="事件分布"
            subtitle="按事件名计数 · top 8"
            :option="distOption"
            :height="240"
            empty-text="台账暂无事件"
          />
        </n-gi>
        <n-gi>
          <chart-card
            title="run 构成"
            subtitle="在途 / 已收口"
            :option="runCompOption"
            :height="240"
            empty-text="台账暂无 runs"
          />
        </n-gi>
      </n-grid>
      <n-grid cols="1 l:2 xl:3" responsive="screen" :x-gap="12" :y-gap="12">
        <n-gi><jobs-card :body="state.jobs" /></n-gi>
        <n-gi><runs-card :runs="state.snapshot?.runs ?? null" /></n-gi>
        <n-gi><workers-card :workers="state.snapshot?.workers ?? null" /></n-gi>
      </n-grid>
      <inbox-card :body="state.inbox" />
      <costs-card :body="state.costs" />
      <judge-card :body="state.judge" />
      <n-grid cols="1 l:2" responsive="screen" :x-gap="12" :y-gap="12">
        <n-gi><breakers-card :body="state.breakers" /></n-gi>
        <n-gi><events-feed-card :feed="feed" :status="status" /></n-gi>
      </n-grid>
      <footer style="color:#546e7a;font-size:11px;padding:8px 2px 4px">
        只读面 · 数据源 SQLite 台账（WAL）· Naive UI + ECharts（vendor 进仓零构建，docs/37-§5.1）
      </footer>
    </n-space>
  </div>
</n-config-provider>
`,
}
