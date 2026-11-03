/**
 * :8788 对外 API 部署与触发面（studio-dev-629·rework #547）—— apiPort 接线/只读探活/fail-closed 回归
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（API-01..16 端点族冻结；默认绑定环回 127.0.0.1，显式旗标才开放局域网；
 *     「只落单不派工」；不新增端点）；
 *   - docs/17-§2（主循环七相位——监听/探活属装配面启动闸，不是新相位）；
 *   - docs/17-§6（收割四要件口径：本单是 devtask，四要件映射见 REPORT，不改判据）；
 *   - docs/plan/studio-next-restart-runbook.md:36（apiPort 缺省 0=临时端口；固定端口写 8788）。
 *
 * 覆盖：
 *   ① 配置面：apiPort 显式装载 / 缺省 0 / 越界·非整数·负数 fail-closed（不静默取整）；
 *   ② 接线面：runServe 装配腿把 config.apiPort 交给 wireServeApi（源码单点=防回退漂移）；
 *   ③ 只读探活：API-01 `GET /v1/company` 200 ∧ ok=true ∧ 公司维同源才通过；其余一律抛；
 *   ④ 监听面：非法端口在 bind 前即拒（不进入监听；不静默降级）；
 *   ⑤ 文档面：serve --help 与 company create 骨架均给出 apiPort 显式指引（可发现、不靠猜）。
 *
 * 边界：本套不真绑 TCP（沙箱 network-bind 拒=真机面归 Lead 部署窗口，见 REPORT「真机证据」）；
 * 探活用注入 fetch 驱动判定，监听失败面只测 bind 前的端口校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { probeServeApi, type ApiProbeFetch } from '../../../src/assembly/api/serve-face.ts'
import { startApiServer } from '../../../src/assembly/api/live.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { renderDaemonYamlSkeleton } from '../../../src/cli/serve.ts'
import { SECTION } from '../../../src/cli/usage.ts'

const BASE = ['db: ./x.sqlite', 'company: demo', 'platform: fake']

/** 固定响应探活桩（status/json 可指定；不触网） */
function stubFetch(payload: unknown, status = 200): ApiProbeFetch {
  return async () => ({ status, json: async () => payload })
}

describe('apiPort 配置面（部署 yaml → parseDaemonConfig）', () => {
  it('显式 apiPort: 8788 装载；缺省=0（ephemeral，不抢 :8788）', () => {
    expect(parseDaemonConfig([...BASE, 'apiPort: 8788'].join('\n')).apiPort).toBe(8788)
    expect(parseDaemonConfig(BASE.join('\n')).apiPort).toBe(0)
  })

  it('越界/非整数/负数＝CONFIG_INVALID 拒（fail-closed，不静默取整/降级）', () => {
    expect(() => parseDaemonConfig([...BASE, 'apiPort: 65536'].join('\n'))).toThrow(/apiPort 须为 0\.\.65535 的整数/)
    expect(() => parseDaemonConfig([...BASE, 'apiPort: 1.5'].join('\n'))).toThrow(/apiPort 须为非负数/)
    // 负数在扁平 YAML 标量面即被判为列表语法（同一 fail-closed 方向，错误文案不同）
    expect(() => parseDaemonConfig([...BASE, 'apiPort: -1'].join('\n'))).toThrow(/嵌套\/列表值|apiPort 须为非负数/)
  })
})

describe('apiPort 接线面（config → runServe 装配腿 → wireServeApi）', () => {
  it('runtime.ts 把 config.apiPort 作为监听端口交给 wireServeApi（单点接线，回退即红）', () => {
    const file = fileURLToPath(new URL('../../../src/assembly/serve/runtime.ts', import.meta.url))
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('wireServeApi(')
    expect(text).toContain('port: config.apiPort ?? 0')
  })
})

describe('只读探活（API-01 /v1/company；不新增端点）', () => {
  it('200 ∧ ok=true ∧ 公司维同源 → 通过（URL 归一化，尾斜杠不产生 //）', async () => {
    const result = await probeServeApi('http://127.0.0.1:8788/', 'studio-dev', {
      fetchImpl: stubFetch({ ok: true, company: { slug: 'studio-dev' } }),
    })
    expect(result).toEqual({ url: 'http://127.0.0.1:8788/v1/company', status: 200, companySlug: 'studio-dev' })
  })

  it('非 200 → 抛（503 缺口面不冒充存活）', async () => {
    await expect(
      probeServeApi('http://127.0.0.1:8788', 'studio-dev', { fetchImpl: stubFetch({ ok: false }, 503) }),
    ).rejects.toThrow(/API 探活非 200/)
  })

  it('ok≠true / 非 JSON / 公司维不符 / 请求异常 → 一律抛（fail-closed，不静默降级）', async () => {
    await expect(
      probeServeApi('http://127.0.0.1:8788', 'studio-dev', { fetchImpl: stubFetch({ ok: false }) }),
    ).rejects.toThrow(/ok≠true/)
    await expect(
      probeServeApi('http://127.0.0.1:8788', 'studio-dev', {
        fetchImpl: async () => ({
          status: 200,
          json: async () => {
            throw new Error('bad-json')
          },
        }),
      }),
    ).rejects.toThrow(/非 JSON/)
    await expect(
      probeServeApi('http://127.0.0.1:8788', 'studio-dev', {
        fetchImpl: stubFetch({ ok: true, company: { slug: 'other-co' } }),
      }),
    ).rejects.toThrow(/公司维不符/)
    await expect(
      probeServeApi('http://127.0.0.1:8788', 'studio-dev', {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    ).rejects.toThrow(/请求失败/)
  })
})

describe('监听面 fail-closed（端口校验先于 bind）', () => {
  it('越界端口在 bind 前即 CONFIG_INVALID 拒（不静默换端口/降级）', async () => {
    const app = null as unknown as Parameters<typeof startApiServer>[0]
    await expect(startApiServer(app, { port: 70_000 })).rejects.toThrow(/监听端口须为 0\.\.65535/)
  })
})

describe('部署文档面（apiPort 可发现）', () => {
  it('serve --help 键表与最小样例均含 apiPort（生产写 8788）', () => {
    expect(SECTION.serve).toContain('apiPort')
    expect(SECTION.serve).toContain('apiPort: 8788')
  })

  it('company create 骨架给出 apiPort 显式指引（注释行不生效——多实例防撞）', () => {
    const text = renderDaemonYamlSkeleton({
      dbPath: '/tmp/sn629/var/ledger.sqlite',
      slug: 'demo',
      companyDir: '/tmp/sn629/demo',
      rootDir: '/tmp/sn629/var',
    })
    expect(text).toContain('# apiPort: 8788')
    expect(parseDaemonConfig(text).apiPort).toBe(0)
  })
})
