/**
 * useOverviewJson —— /api/overview/* 轮询取数（DEV-12 刀二；换装页热重载的数据通道）。
 *
 * 口径：
 *   - 轮询间隔默认 3s（与 :8787 useSnapshot 同节奏）——目录热重载后的新数据在下一周期
 *     自动可见，页面无需手动刷新；
 *   - 失败保旧图：fetch/HTTP 非 2xx/解析失败 → error 置错、data 保留最后一次有效值
 *     （与服务端 reload.ts 的保旧图纪律同构——不白屏、不臆造）；
 *   - asOfMs=本地取数完成时刻（与 payload.asOf=服务端取数时刻双时间戳，页面两处都亮）。
 * 本件不掺业务：URL 由调用侧给（getUrl 每次轮询重取——路由切换组件重挂载，天然换端点）。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

export function useOverviewJson(getUrl, intervalMs = 3000) {
  const data = shallowRef(null)
  const error = ref(null)
  const asOfMs = ref(0)
  const loading = ref(true)
  let timer = null
  let seq = 0

  async function refresh() {
    const url = typeof getUrl === 'function' ? getUrl() : getUrl
    if (!url) return
    const mySeq = ++seq
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      const payload = await res.json()
      if (mySeq !== seq) return // 过期响应（路由已换）——丢弃，防旧数据覆盖新页
      data.value = payload
      error.value = null
      asOfMs.value = Date.now()
    } catch (err) {
      if (mySeq !== seq) return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (mySeq === seq) loading.value = false
    }
  }

  onMounted(() => {
    void refresh()
    timer = setInterval(() => void refresh(), intervalMs)
  })
  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer)
    timer = null
    seq++ // 让在途请求全部过期
  })

  return { data, error, asOfMs, loading, refresh }
}
