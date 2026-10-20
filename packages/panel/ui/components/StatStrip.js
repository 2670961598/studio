/**
 * StatStrip —— 顶部四联小统计（DEV-1 方案 §7.2：旧页 stats 行的 Naive 化）。
 * jobs 总数(+due)｜runs 在途(/总数)｜workers 活跃｜events 总数——一眼温度计。
 */
export default {
  name: 'StatStrip',
  props: {
    snapshot: { type: Object, default: null },
  },
  computed: {
    jobsTotal() {
      return this.snapshot?.jobs?.total ?? 0
    },
    jobsDue() {
      return this.snapshot?.jobs?.due ?? 0
    },
    runsInFlight() {
      return this.snapshot?.runs?.inFlight ?? 0
    },
    runsTotal() {
      return this.snapshot?.runs?.total ?? 0
    },
    workersActive() {
      return this.snapshot?.workers?.active?.length ?? 0
    },
    eventsTotal() {
      return this.snapshot?.events?.total ?? 0
    },
  },
  template: `
<n-grid cols="2 s:4" responsive="screen" :x-gap="12" :y-gap="12">
  <n-gi>
    <n-card size="small">
      <n-statistic label="定时岗 jobs" :value="jobsTotal">
        <template #suffix>
          <n-tag v-if="jobsDue > 0" type="warning" size="small" :bordered="false">due {{ jobsDue }}</n-tag>
          <span v-else style="color:#90a4ae;font-size:12px">due 0</span>
        </template>
      </n-statistic>
    </n-card>
  </n-gi>
  <n-gi>
    <n-card size="small">
      <n-statistic label="在途 runs" :value="runsInFlight">
        <template #suffix>
          <span style="color:#90a4ae;font-size:12px">/ 共 {{ runsTotal }}</span>
        </template>
      </n-statistic>
    </n-card>
  </n-gi>
  <n-gi>
    <n-card size="small">
      <n-statistic label="活跃 workers" :value="workersActive">
        <template #suffix>
          <span style="color:#90a4ae;font-size:12px">v0 台账口径</span>
        </template>
      </n-statistic>
    </n-card>
  </n-gi>
  <n-gi>
    <n-card size="small">
      <n-statistic label="台账事件" :value="eventsTotal">
        <template #suffix>
          <span style="color:#90a4ae;font-size:12px">SSE 实时</span>
        </template>
      </n-statistic>
    </n-card>
  </n-gi>
</n-grid>
`,
}
