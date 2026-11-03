/**
 * ctl-write-routing.test.ts —— 控制面写路径接 gateWriteCtl（studio-dev-545；SEC-SIG-03）
 *
 * 依据：
 *   - docs/17-§7（写入全收口：控制面自身也过网关，不留绕过通道）；
 *   - docs/17-§2（主循环七相位：平台写经 gated-platform 收口）、docs/17-§6（收割四要件：
 *     完成只认可核证据——本件=定向红→绿证据）；
 *   - docs/v2/15 §二 SEC-SIG-03（ctl- 词族入网关校验；申报/实文一致；transition 不得显示为
 *     comment）；docs/v2/14 §二-2（六动词值与借道禁令）；docs/v2/09 ENU-119（值集唯一主表）。
 *
 * 断言口径（负向按「借道路径不存在」）：
 *   1. 六 ctl- 动词全部由控制面写方法申报（create/transition/set-field/link/provision/guards），
 *      入口恒为 gateWriteCtl；申报值只能是 GATEWAY_CTL_ACTIONS；
 *   2. worker 面方法（comments.add/kb.upsert）仍走 gateWrite（comment/article），不混用入口；
 *   3. 控制面写绝不借道 gateWrite（无 comment 申报、无 worker 口混入 ctl- 动词）；
 *   4. 网关拒绝（缺证/越权/动词不匹配）→ EXTERNAL_REJECT/gw-* 且底层 platform 零调用（fail-closed）。
 */
import { describe, expect, it } from 'vitest'
import type { GatewayAction } from '@studio-next/contract'
import { CONTROL_TICKET, GATEWAY_CTL_ACTIONS, createGateway } from '@studio-next/gateway'
import type { CtlAction, Gateway } from '@studio-next/gateway'
import { createGatedPlatform } from '../../../src/engine/tools/gated-platform.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'

const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
const CTX = { company: '指尖游戏', dept: '平台部', role: '控制面', level: 9 }
const AUTHOR = 'daemon-ctl'
const NOW = 1_700_000_000_000

/** 网关入口调用记录：face 区分两个入口，action 是申报动词 */
interface Entry {
  readonly face: 'worker' | 'ctl'
  readonly action: string
}

/** 记录入口调用的真网关（入口切换=被观测行为，不是测试桩替身） */
function instrumentedGateway(): { gateway: Gateway; calls: Entry[] } {
  const base = createGateway({ secret: SECRET, clock: () => NOW, ticket: CONTROL_TICKET, ctx: CTX, author: AUTHOR })
  const calls: Entry[] = []
  const gateway: Gateway = {
    ...base,
    gateWrite(token, action, payload) {
      calls.push({ face: 'worker', action })
      return base.gateWrite(token, action, payload)
    },
    gateWriteCtl(token, action, payload) {
      calls.push({ face: 'ctl', action })
      return base.gateWriteCtl(token, action, payload)
    },
  }
  return { gateway, calls }
}

describe('ctl- 动作词族接线：控制面走 gateWriteCtl，禁借道 gateWrite（SEC-SIG-03）', () => {
  it('六 ctl- 动词全覆盖：控制面七写全部从 gateWriteCtl 进入，worker 入口零调用', async () => {
    const { gateway, calls } = instrumentedGateway()
    const gated = createGatedPlatform(createFakePlatform(), gateway, { ctx: CTX, author: AUTHOR })

    const parent = await gated.issues.create({ title: '父单', type: 'task', level: 0 })
    const child = await gated.issues.create({ title: '子单', type: 'task', level: 0 })
    await gated.issues.transition(parent.id, '已派发')
    await gated.issues.setField(parent.id, 'lane', 'core')
    await gated.links.link(parent.id, child.id, 'parent-child')
    await gated.fields.provision({
      fields: { dept: '部门' },
      states: ['新单', '已派发'],
      stateFlow: { 新单: ['已派发'] },
    })
    await gated.guards.install('demo', [{ from: '新单', to: '已派发' }])
    await gated.guards.uninstall('demo')

    // 入口切换：控制面写不得从 worker 口（gateWrite/comment 借道）出现
    expect(calls).toEqual([
      { face: 'ctl', action: 'ctl-create' },
      { face: 'ctl', action: 'ctl-create' },
      { face: 'ctl', action: 'ctl-transition' },
      { face: 'ctl', action: 'ctl-set-field' },
      { face: 'ctl', action: 'ctl-link' },
      { face: 'ctl', action: 'ctl-provision' },
      { face: 'ctl', action: 'ctl-guards' },
      { face: 'ctl', action: 'ctl-guards' },
    ])
    const verbs = new Set(calls.map((c) => c.action))
    expect([...verbs].sort()).toEqual([...GATEWAY_CTL_ACTIONS].sort())
    for (const call of calls) {
      expect(call.face).toBe('ctl')
      expect(GATEWAY_CTL_ACTIONS).toContain(call.action)
      expect(call.action).not.toBe('comment')
    }
  })

  it('worker 面写仍走 gateWrite（comment/article）：两面词域不混用', async () => {
    const { gateway, calls } = instrumentedGateway()
    const gated = createGatedPlatform(createFakePlatform(), gateway, { ctx: CTX, author: AUTHOR })
    const issue = await gated.issues.create({ title: '评论目标', type: 'task', level: 0 })
    await gated.comments.add(issue.id, { author: 'FAKER', body: '正文', signature: 's' })
    await gated.kb.upsert('kb/ctl-wire.md', '# 证据')

    expect(calls.slice(0, 1)).toEqual([{ face: 'ctl', action: 'ctl-create' }])
    expect(calls.slice(1)).toEqual([
      { face: 'worker', action: 'comment' },
      { face: 'worker', action: 'article' },
    ])
  })

  it('缺证（控制面通道吊销）→ ctl 写恒拒且平台状态不变（fail-closed）', async () => {
    const { gateway, calls } = instrumentedGateway()
    const inner = createFakePlatform()
    const gated = createGatedPlatform(inner, gateway, { ctx: CTX, author: AUTHOR })
    const issue = await gated.issues.create({ title: '吊销前建单', type: 'task', level: 0 })
    gateway.revoke(CONTROL_TICKET)
    const before = calls.length

    await expect(gated.issues.transition(issue.id, '已派发')).rejects.toMatchObject({
      category: 'EXTERNAL_REJECT',
      subcause: 'gw-verify-revoked',
    })
    const after = await inner.issues.get(issue.id)
    expect(after.state).toBe(issue.state)
    // 拒绝发生在闸内：本次调用只有一次 gateWriteCtl 尝试，平台迁移零副作用
    expect(calls.length).toBe(before + 1)
    expect(calls.at(-1)).toEqual({ face: 'ctl', action: 'ctl-transition' })
  })

  it('闸拒绝（动词不匹配/越权语义）→ EXTERNAL_REJECT/gw-action-mismatch，平台零调用', async () => {
    const base = createGateway({ secret: SECRET, clock: () => NOW, ticket: CONTROL_TICKET, ctx: CTX, author: AUTHOR })
    const probe: string[] = []
    const gateway: Gateway = {
      ...base,
      gateWriteCtl: (token, action, payload): ReturnType<Gateway['gateWriteCtl']> => {
        probe.push(action)
        return base.gateWriteCtl(token, action, payload.replace(action, 'comment'))
      },
    }
    const inner = createFakePlatform()
    const gated = createGatedPlatform(inner, gateway, { ctx: CTX, author: AUTHOR })
    await expect(gated.issues.transition('LOCAL-1', '已派发')).rejects.toMatchObject({
      category: 'EXTERNAL_REJECT',
      subcause: 'gw-action-mismatch',
    })
    expect(probe).toEqual(['ctl-transition'])
    expect(await inner.issues.list({})).toEqual([])
  })

  it('越权动词域（worker 口夹带 ctl- / ctl 口夹带 worker 动词）由运行期硬化拒绝', () => {
    const base = createGateway({ secret: SECRET, clock: () => NOW, ticket: CONTROL_TICKET, ctx: CTX, author: AUTHOR })
    // 入口只收各自动词域：类型层伪造绕不过运行期检查（擦除后无类型仍拦）
    expect(base.gateWriteCtl('any', 'comment' as unknown as CtlAction, '@action comment {}')).toEqual({
      allowed: false,
      reason: 'gw-action-mismatch',
    })
    expect(base.gateWrite('any', 'ctl-create' as unknown as GatewayAction, '@action ctl-create {}')).toEqual({
      allowed: false,
      reason: 'gw-action-mismatch',
    })
  })
})
