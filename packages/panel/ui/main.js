/**
 * main —— 前端入口（importmap 已在页壳 shell.ts 注入：vue / naive-ui / echarts → /vendor/*）。
 * createApp(App) + naive 全量注册（app.use(naive)——组件面板量小，不做按需注册）。
 * 全局错误兜底：任何渲染/数据错都打到控制台（boot-error 文案已由页壳占位，
 * 挂载成功即被替换——挂载本身失败则兜底文案保留，人看得到提示而非白屏）。
 */
import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './app.js'

const app = createApp(App)
app.use(naive)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[panel-ui]', info, err)
}
app.mount('#app')
