/**
 * main —— :8789 换装页入口（DEV-12 刀二；与刀一 ui/main.js 同款启动法）。
 * importmap 已在页壳 shell.ts 注入（vue / naive-ui / echarts → /vendor/*——刀一进仓三件）。
 * createApp(OverviewApp) + naive 全量注册；全局错误兜底打到控制台（boot-error 文案由
 * 页壳占位，挂载成功即被替换——挂载失败则兜底文案保留，不白屏）。
 */
import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './app.js'

const app = createApp(App)
app.use(naive)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[overview-ui]', info, err)
}
app.mount('#app')
