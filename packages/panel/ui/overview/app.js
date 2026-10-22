/**
 * app —— :8789 换装页根组件（DEV-12 刀二；单壳多页：路径即路由）。
 *
 * 结构：NConfigProvider（暗色 + panelThemeOverrides——与 :8787 同套观感）+ NGlobalStyle
 * + 顶栏（产品名 / 公司清单入口 / 旧版回滚面链接）+ 路由视图：
 *   companies → CompaniesCard；company → 公司卡 + NTabs 六 tab（overview/org/people/
 *   progress/finance/reports——tab 值与路径同构，切换走 pushState 不整页刷新；reports=
 *   127-B v1 metadata-only 报表聚合）；person → PersonView；null → 404 视图（与服务端
 *   HTML 404 口径一致）。
 * 路由事件：popstate + router.ROUTE_EVENT（go() 派发）→ 重解析 pathname。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { darkTheme } from 'naive-ui'
import { panelThemeOverrides } from '../theme.js'
import { ROUTE_EVENT, go, parseOverviewPath, tabPath } from './router.js'import CompaniesCard from './components/CompaniesCard.js'
import CompanyCard from './components/CompanyCard.js'
import OrgCard from './components/OrgCard.js'
import PeopleCard from './components/PeopleCard.js'
import PersonView from './components/PersonView.js'
import ProgressCard from './components/ProgressCard.js'
import FinanceCard from './components/FinanceCard.js'
import ReportsCard from './components/ReportsCard.js'

export default {
  name: 'OverviewApp',
  components: { CompaniesCard, CompanyCard, OrgCard, PeopleCard, PersonView, ProgressCard, FinanceCard, ReportsCard },
  setup() {
    const route = ref(parseOverviewPath(window.location.pathname))

    const onRouteChange = () => {
      route.value = parseOverviewPath(window.location.pathname)
    }
    onMounted(() => {
      window.addEventListener('popstate', onRouteChange)
      window.addEventListener(ROUTE_EVENT, onRouteChange)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('popstate', onRouteChange)
      window.removeEventListener(ROUTE_EVENT, onRouteChange)
    })

    const onTab = (tab) => {
      if (route.value?.view === 'company') go(tabPath(route.value.slug, tab))
    }
    const goCompanies = () => go('/')

    return { route, onTab, goCompanies, darkTheme, panelThemeOverrides }
  },
  template: `
<n-config-provider :theme="darkTheme" :theme-overrides="panelThemeOverrides">
  <n-global-style />
  <div style="max-width:1180px;margin:0 auto;padding:16px 16px 48px">
    <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:16px;font-weight:700;color:#eceff1">Studio Next · 公司概览</span>
      <a style="color:#80cbc4;font-size:13px;cursor:pointer" @click.prevent="goCompanies" href="/">公司清单</a>
      <a style="color:#90a4ae;font-size:13px" href="/legacy">旧版只读面</a>
      <span style="color:#607d8b;font-size:12px;margin-left:auto">:8789 · 只读 · 热重载（快照标注 + 目录监听）</span>
    </div>

    <companies-card v-if="route?.view === 'companies'" />

    <template v-else-if="route?.view === 'company'">
      <company-card :slug="route.slug" :key="route.slug" />
      <n-card size="small" :bordered="true">
        <n-tabs :value="route.tab" type="line" @update:value="onTab">
          <n-tab name="overview" tab="概览">
            <n-alert type="info" size="small" :bordered="false">公司概览卡见上（本 tab 即 /<slug>/ 规范页）。</n-alert>
          </n-tab>
          <n-tab name="org" tab="组织"><org-card :slug="route.slug" /></n-tab>
          <n-tab name="people" tab="人事"><people-card :slug="route.slug" /></n-tab>
          <n-tab name="progress" tab="进度"><progress-card :slug="route.slug" /></n-tab>
          <n-tab name="finance" tab="财务"><finance-card :slug="route.slug" /></n-tab>
          <n-tab name="reports" tab="报表"><reports-card :slug="route.slug" /></n-tab>
        </n-tabs>
      </n-card>
    </template>

    <person-view v-else-if="route?.view === 'person'" :slug="route.slug" :person-id="route.personId" :key="route.slug + '/' + route.personId" />

    <n-card v-else size="small" :bordered="true">
      <n-result status="404" title="页面不存在" description="路径不认识（公司页/组织/人事/进度/财务/报表——路径清单见旧版只读面）">
        <template #footer>
          <n-button size="small" @click="goCompanies">回公司清单</n-button>
        </template>
      </n-result>
    </n-card>
  </div>
</n-config-provider>
`,
}
