/**
 * OrgCard —— 组织树 tab（/<slug>/org；NTree 嵌套 + 悬空/成环诚实标记）。
 *
 * 数据：/api/overview/<slug>/org（buildOrgTree 复用——悬空父/成环提升为根，promoted/cyclic
 * 以 path 列表给出）。节点渲染 name + L{level} 标 + leader；lanes/functions 悬浮展示。
 */
import { computed } from 'vue'
import { useOverviewJson } from '../composables/useOverviewJson.js'
import SnapshotBadge from './SnapshotBadge.js'

export default {
  name: 'OrgCard',
  props: {
    slug: { type: String, required: true },
  },
  setup(props) {
    const { data, error, asOfMs, loading } = useOverviewJson(() => `/api/overview/${props.slug}/org`)

    const keyToFlag = (node, flags) => flags[node.path] ?? null
    const treeData = computed(() => {
      const promoted = new Set((data.value?.promoted ?? []).map((p) => `${p}#promoted`))
      const cyclic = new Set((data.value?.cyclic ?? []).map((p) => `${p}#cyclic`))
      const toNode = (n) => ({
        key: n.path,
        label: `${n.name}（L${String(n.level)}${n.leader !== '' ? ` · ${n.leader}` : ''}）`,
        suffix: keyToFlag(n, { ...Object.fromEntries([...promoted].map((k) => [k.split('#')[0], 'promoted'])), ...Object.fromEntries([...cyclic].map((k) => [k.split('#')[0], 'cyclic'])) }),
        detail: [n.lanes.length > 0 ? `lanes: ${n.lanes.join(' / ')}` : '', n.functions.length > 0 ? `functions: ${n.functions.join(' / ')}` : ''].filter((s) => s !== '').join('\n'),
        children: n.children.map(toNode),
      })
      return (data.value?.roots ?? []).map(toNode)
    })

    const nodeProps = (option) => ({
      style: 'padding:1px 4px',
      title: option.detail !== '' ? option.detail : undefined,
    })

    const renderSuffix = (option) => {
      if (option.suffix === 'promoted') return '（悬挂父·提为根）'
      if (option.suffix === 'cyclic') return '（成环·提为根）'
      return ''
    }

    return { data, error, asOfMs, loading, treeData, nodeProps, renderSuffix }
  },
  components: { SnapshotBadge },
  template: `
<n-card size="small" :bordered="true" style="margin-bottom:12px" title="组织树（parent 链）">
  <template #header-extra>
    <n-spin v-if="loading" :size="14" />
  </template>
  <snapshot-badge :as-of="data?.asOf ?? ''" :meta="data?.snapshotMeta ?? null" :fetched-at-ms="asOfMs" />
  <n-alert v-if="error" type="error" size="small" style="margin-top:8px" title="取数失败（展示最后一次有效数据）">{{ error }}</n-alert>
  <n-alert v-if="(data?.promoted?.length ?? 0) > 0 || (data?.cyclic?.length ?? 0) > 0" type="warning" size="small" style="margin-top:8px" title="组织配置有悬挂/成环（如实展示，不静默修剪）">
    悬挂父提为根：{{ data?.promoted?.join('、') || '无' }}；成环提为根：{{ data?.cyclic?.join('、') || '无' }}
  </n-alert>
  <n-tree
    v-if="treeData.length"
    style="margin-top:8px;user-select:none"
    :data="treeData"
    :node-props="nodeProps"
    :render-suffix="renderSuffix"
    block-line
    expand-on-click
    :default-expanded-keys="treeData.map((n) => n.key)"
    label-field="label"
    key-field="key"
    children-field="children"
  />
  <n-empty v-else-if="!loading && !error" description="无部门（快照 departments 为空——如实空态）" style="margin:16px 0" />
</n-card>
`,
}
