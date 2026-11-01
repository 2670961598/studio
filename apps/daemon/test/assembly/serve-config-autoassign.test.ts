// ▸ 落仓路径：apps/daemon/test/assembly/serve-config-autoassign.test.ts（新文件，全文照抄）

/**
 * serve 配置解析 · autoAssign 开关（轨2 R1 登记项①，studio-dev-345）
 *
 * 口径（同 daemon.yaml 既有扁平键纪律）：true/false 布尔直收；缺省=undefined（面关，
 * 行为零变）；非布尔值 fail-closed 拒启动（CONFIG_INVALID——不静默忽略）。
 */
import { describe, expect, it } from 'vitest'
import { parseDaemonConfig } from '../../src/assembly/serve/config.ts'

function parse(pairs: Record<string, unknown>): { autoAssign: boolean | undefined } {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : String(v)}`)
  return parseDaemonConfig(lines.join('\n')) as { autoAssign: boolean | undefined }
}

describe('parseDaemonConfig · autoAssign（轨2 R1①）', () => {
  it('true 解析真', () => {
    expect(parse({ autoAssign: true }).autoAssign).toBe(true)
  })
  it('false 解析假（显式面关≠缺省面关——配置面可查）', () => {
    expect(parse({ autoAssign: false }).autoAssign).toBe(false)
  })
  it('缺省=undefined（不注入 EngineConfig——行为零变）', () => {
    expect(parse({ company: 'demo' }).autoAssign).toBeUndefined()
  })
  it('非布尔值 CONFIG_INVALID 拒启动（fail-closed 不猜）', () => {
    expect(() => parse({ autoAssign: 'yes' })).toThrow()
    expect(() => parse({ autoAssign: 1 })).toThrow()
  })
})
