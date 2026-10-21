/**
 * SnapshotBadge —— 快照时间标注（DEV-12 热重载能力其一的展示面）。
 *
 * 双时间戳口径（api.ts）：asOf=本次取数时刻（本地时钟）；snapshotMeta=公司目录快照的
 * 装载时刻/代数/监听态。meta 缺省（静态挂载、无注入位）时只显示取数时间——不臆造标注。
 * lastError 有值 → NAlert 亮出（热重载失败·保旧图——服务端仍服务最后一次有效快照）。
 */
import { computed } from 'vue'
import { fmtTime } from '../../lib/format.js'

export default {
  name: 'SnapshotBadge',
  props: {
    /** payload.asOf（ISO 串）——本次取数时刻 */
    asOf: { type: String, default: '' },
    /** payload.snapshotMeta（可缺省——静态挂载） */
    meta: { type: Object, default: null },
    /** 本地取数完成时刻（epoch ms；与 asOf 双时间戳——前者服务端后者本地） */
    fetchedAtMs: { type: Number, default: 0 },
  },
  setup(props) {
    const metaText = computed(() => {
      if (!props.meta) return ''
      return `快照 ${fmtTime(props.meta.at)} · v${String(props.meta.version)}`
    })
    const asOfText = computed(() => (props.fetchedAtMs > 0 ? `取数 ${fmtTime(props.fetchedAtMs)}` : props.asOf !== '' ? `取数 ${props.asOf}` : ''))
    return { metaText, asOfText, fmtTime }
  },
  template: `
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:#90a4ae;font-size:12px">
  <n-tag v-if="meta" size="small" :bordered="false" type="info">{{ metaText }}</n-tag>
  <n-tag v-if="meta" size="small" :bordered="false" :type="meta.watching ? 'success' : 'default'">
    {{ meta.watching ? '目录监听中' : '静态挂载' }}
  </n-tag>
  <span v-if="asOfText">{{ asOfText }}</span>
</div>
<n-alert v-if="meta && meta.lastError" type="warning" size="small" style="margin-top:8px" title="热重载失败·保旧图">
  公司目录当前状态装载失败（继续展示最后一次有效快照）：{{ meta.lastError }}
</n-alert>
`,
}
