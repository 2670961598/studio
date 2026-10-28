/**
 * binding.test.ts —— Taiga 绑定三件套 V2 测试（IMPL-07-02；G-DOM-02 taiga 腿 / L3O-02 / L3O-04）
 *
 * 覆盖（本单冻结验收口径；三包同形，键表逐字相同、只换平台值）：
 *   ① 三件套同形：bindingProfile/mapState/lossReport 三入口＋唯一绑定选择器在同一模块；
 *      档案键面＝bindingId/平台/能力/状态映射/损失报告（+ 事实状态/探针）；
 *   ② bindingId 选择：只认本包 BINDING_ID；外域/未知/空串＝Err（不回落冒充）；
 *   ③ 状态映射：无部署值表⇒全 unverified（原值保留、不猜）；空/畸形原值⇒Err；
 *   ④ **stateMappings 唯一源＝绑定档案**：platform 面转引同一数组（L3O-02）；
 *   ⑤ 404 读口：**仅平台权威确认不存在**⇒Ok(undefined)；缺省读上下文/越权/不可确认⇒Err，
 *      不得用 Ok(undefined) 冒充「没有这张单」（L3O-04 / 80-§6.3 / v2/14 §0.2-1）；
 *      项目端点 404（绑定指错项目）≠ 单据不存在 ⇒ Err；
 *   ⑥ lossReport：卡行锚＋ENU-110 三值＋逐项 cannotClaim，severity 合计由声明复算；
 *   ⑦ BC-T1 复验（包内反向禁边）：transport/ 下不得出现 `../fieldmap.ts` 引用；
 *   ⑧ 证据不冒充：probes 三态、无 executed 自报（本波平台面零探针留证）。
 *
 * 依据：v2/12 §2.2（BIND-PLAT-TAIGA-01）/§2.3；v2/14 §八；plan/05 IMPL-07-02；差距 L3O-02/L3O-04。
 * 零真实网络：fake fetch 回放＋注入状态码桩。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, FlowPlatform, IssueRecord, ReadContext, Result } from '@studio-next/contract'
import { BINDING_ID, bindingProfile, lossReport, mapState, resolveBinding } from '../../src/binding.ts'
import { createTaigaPlatform, readContextDenial, readIssue, readIssueState, stateMappingTable } from '../../src/platform.ts'
import type { FetchLike } from '../../src/transport/http.ts'
import { FakeTaiga, TEST_BASE_URL, makePlatform } from '../../src/testutil.ts'

/** 读上下文（v2/14 §0.2-1：读方法必带；可见字段非空） */
const READ_CTX: ReadContext = {
  readScope: {
    company: { companyId: 'co-probe', slug: 'probe-co' },
    fields: ['issues.state', 'issues.title'],
    purpose: 'MON-04 工作十态可见性',
  },
  caller: { callerId: 'E-7', kind: 'employment' },
}

/** 从 Result 取 Ok 值（否则抛：让「期望 Err 实得 Ok」显式红） */
function okValue<T>(r: Result<T, ClassifiedError>): T {
  if (r.kind !== 'ok') throw new Error(`期望 Ok，实得 Err：${r.error.subcause}`)
  return r.value
}

/** 从 Result 取 Err（否则抛：让「期望 Err 实得 Ok」显式红） */
function errOf<T>(r: Result<T, ClassifiedError>): ClassifiedError {
  if (r.kind !== 'err') throw new Error('期望 Err，实得 Ok')
  return r.error
}

/** 状态码桩（零真实网络）：任何请求回固定状态码 */
function statusFetch(status: number): FetchLike {
  return async () => new Response(JSON.stringify({ _error_message: `stub ${String(status)}` }), { status })
}

/** 注入 fetch 的平台实例（token 态=不触登录交换，越权/不可确认负例用） */
function platformWith(fetch: FetchLike): FlowPlatform {
  return createTaigaPlatform({
    baseUrl: TEST_BASE_URL,
    project: 'probe-co',
    auth: { type: 'token', token: 'test-token-000' },
    fetch,
  })
}

describe('绑定三件套同形（IMPL-07-02；v2/14 §八）', () => {
  it('档案键面与入口形状：bindingProfile/mapState/lossReport＋唯一选择器', () => {
    expect(typeof bindingProfile).toBe('function')
    expect(typeof mapState).toBe('function')
    expect(typeof lossReport).toBe('function')
    expect(typeof resolveBinding).toBe('function')

    const profile = okValue(bindingProfile())
    expect(Object.keys(profile).sort()).toEqual([
      'bindingId',
      'capabilities',
      'factStatus',
      'losses',
      'platform',
      'probes',
      'stateMappings',
    ])
    expect(profile.bindingId).toBe(BINDING_ID)
    expect(profile.platform.kind).toBe('taiga')
    expect(profile.platform.version).toBe('v2.0')
    // 七能力恰一组、顺序固定（v2/09 ENU-112 能力名值集）
    expect(profile.capabilities.map((c) => c.name)).toEqual([
      'issues',
      'comments',
      'fields',
      'kb',
      'activity',
      'links',
      'guards',
    ])
    // 卡「覆盖」行：七项均有实现（含 guards）但 guards/activity 有已声明损失
    expect(profile.capabilities.find((c) => c.name === 'guards')?.status).toBe('degraded')
    expect(profile.capabilities.find((c) => c.name === 'activity')?.status).toBe('degraded')
    expect(profile.capabilities.filter((c) => c.status === 'unsupported')).toEqual([])
    // 卡「现状」行：已有（适配器接线；凭据 env）
    expect(profile.factStatus).toBe('已有')
    // 三件套共用同一档案对象（单例；防每次新建出第二份真值）
    expect(okValue(bindingProfile())).toBe(profile)
  })

  it('唯一绑定选择器：只认本包 bindingId；外域/未知/空串＝Err（不回落冒充）', () => {
    const own = okValue(resolveBinding())
    expect(own.bindingId).toBe(BINDING_ID)
    expect(okValue(resolveBinding(BINDING_ID))).toBe(own)

    for (const foreign of ['BIND-PLAT-YT-01', 'BIND-PLAT-LOCAL-01', 'BIND-DSH-01', '']) {
      const err = errOf(resolveBinding(foreign))
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('binding-unknown')
    }
    expect(errOf(bindingProfile('BIND-PLAT-YT-01')).subcause).toBe('binding-unknown')
    expect(errOf(mapState('New', 'BIND-PLAT-YT-01')).subcause).toBe('binding-unknown')
    expect(errOf(lossReport('BIND-PLAT-LOCAL-01')).subcause).toBe('binding-unknown')
    expect(errOf(stateMappingTable('BIND-PLAT-YT-01')).subcause).toBe('binding-unknown')
  })
})

describe('状态映射（v2/12 §2.3：未映射但合法＝Ok(unverified)；空/畸形＝Err）', () => {
  it('本部署无已核值表：一切非空合法原值⇒unverified＋原值逐字保留（不猜项目级状态板）', () => {
    // 部署工件未注入（Taiga 状态板是项目级配置；PRB-23 未执行）⇒ 表必须为空，不得编造 verified 行
    expect(okValue(bindingProfile()).stateMappings).toEqual([])

    for (const platformState of ['New', 'In progress', 'Done', '项目自定义态']) {
      const mapping = okValue(mapState(platformState))
      expect(mapping).toEqual({
        platformState,
        workStates: [],
        verification: 'unverified',
        unmappedBehavior: 'observe-unmapped',
      })
    }
  })

  it('空/畸形原值⇒Err（配置缺陷，不是「不存在」也不是 unverified）', () => {
    for (const bad of ['', ' ', '\n']) {
      const err = errOf(mapState(bad))
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('platform-state-invalid')
    }
    expect(errOf(mapState(undefined as unknown as string)).subcause).toBe('platform-state-invalid')
  })

  it('stateMappings 唯一源＝绑定档案：platform 面转引同一数组（L3O-02 治表散落）', () => {
    const table = okValue(stateMappingTable())
    expect(table).toBe(okValue(bindingProfile()).stateMappings) // 引用同一数组＝单一源
  })
})

describe('404 读口（L3O-04：仅权威确认不存在＝Ok(undefined)；越权/不可确认＝Err）', () => {
  it('平台权威 404⇒Ok(undefined)；存在⇒Ok(记录)', async () => {
    const platform = makePlatform(new FakeTaiga())
    const created = await platform.issues.create({ title: '甲单：绑定读口' })

    const absent = await readIssue(platform, 'probe-co-9999', READ_CTX)
    expect(absent).toEqual({ kind: 'ok', value: undefined })

    const found = await readIssue(platform, created.id, READ_CTX)
    const record = okValue(found) as IssueRecord
    expect(record.id).toBe(created.id)
    expect(record.state).toBe('New') // 出厂落位态（平台真源回读）
  })

  it('缺省读上下文⇒Err（读面缺省＝拒，不按「无行」处理）', async () => {
    const platform = makePlatform(new FakeTaiga())
    expect(readContextDenial(undefined)?.subcause).toBe('read-context-missing')
    expect(errOf(await readIssue(platform, 'probe-co-1', undefined)).subcause).toBe('read-context-missing')
  })

  it('越权（可见字段空集/调用者缺失/平台 401·403）⇒Err，不得 Ok(undefined) 冒充不存在', async () => {
    const platform = makePlatform(new FakeTaiga())

    const emptyScope = { ...READ_CTX, readScope: { ...READ_CTX.readScope, fields: [] } } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'probe-co-1', emptyScope)).subcause).toBe('read-scope-invalid')

    const noCaller = { readScope: READ_CTX.readScope } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'probe-co-1', noCaller)).subcause).toBe('read-caller-missing')

    const noScope = { caller: READ_CTX.caller } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'probe-co-1', noScope)).subcause).toBe('read-scope-missing')

    for (const status of [401, 403]) {
      const denied = await readIssue(platformWith(statusFetch(status)), 'probe-co-1', READ_CTX)
      expect(denied.kind).toBe('err')
      expect(errOf(denied).subcause).toBe('auth-rejected')
      expect(denied).not.toEqual({ kind: 'ok', value: undefined })
    }
  })

  it('不可确认（5xx/网络异常/项目端点 404/读回形状不符）⇒Err，不冒充不存在', async () => {
    for (const status of [500, 503]) {
      expect(errOf(await readIssue(platformWith(statusFetch(status)), 'probe-co-1', READ_CTX)).subcause).toBe(
        'server-error',
      )
    }

    const offline: FetchLike = async () => {
      throw new Error('socket hang up')
    }
    expect(errOf(await readIssue(platformWith(offline), 'probe-co-1', READ_CTX)).subcause).toBe('network-error')

    // 项目端点 404＝绑定指错项目（not-found），不是「这张单不存在」（issue-not-found）⇒ Err
    const wrongProject = await readIssue(platformWith(statusFetch(404)), 'probe-co-1', READ_CTX)
    expect(errOf(wrongProject).subcause).toBe('not-found')
    expect(wrongProject).not.toEqual({ kind: 'ok', value: undefined })

    const broken = { issues: { async get() { return null } } } as unknown as FlowPlatform
    expect(errOf(await readIssue(broken, 'probe-co-1', READ_CTX)).subcause).toBe('read-shape-invalid')
  })

  it('readIssueState：状态判决同源于绑定档案；不存在时不映射', async () => {
    const platform = makePlatform(new FakeTaiga())
    const created = await platform.issues.create({ title: '乙单：状态判决' })

    const hit = okValue(await readIssueState(platform, created.id, READ_CTX))
    expect(hit).toBeDefined()
    expect(hit?.mapping).toEqual(okValue(mapState(hit!.record.state))) // 同一 mapState，不另写一套
    expect(hit?.mapping.verification).toBe('unverified')

    expect(await readIssueState(platform, 'probe-co-9999', READ_CTX)).toEqual({ kind: 'ok', value: undefined })
    expect(errOf(await readIssueState(platform, created.id, READ_CTX, 'BIND-PLAT-YT-01')).subcause).toBe(
      'binding-unknown',
    )
  })
})

describe('BC-T1 复验与损失报告（v2/12 §2.2/§六）', () => {
  it('BC-T1：transport/ 不得引 ../fieldmap.ts（包内反向禁边不触）', () => {
    const dir = join(import.meta.dirname, '..', '..', 'src', 'transport')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(join(dir, file), 'utf8')
      expect(src, `${file} 不得引 ../fieldmap.ts（BC-T1）`).not.toMatch(/['"]\.\.\/fieldmap\.ts['"]/)
    }
  })

  it('lossReport：卡行锚＋ENU-110 三值＋非空 cannotClaim，与档案 losses 同源', () => {
    const report = okValue(lossReport())
    expect(report.bindingId).toBe(BINDING_ID)
    expect(report.losses).toBe(okValue(bindingProfile()).losses) // 同一数组＝单一源
    expect(report.losses.length).toBeGreaterThan(0)

    for (const loss of report.losses) {
      expect(loss.lossRef.startsWith('v2/12 §2.2 BIND-PLAT-TAIGA-01')).toBe(true)
      expect(['blocking', 'degrading', 'cosmetic']).toContain(loss.severity)
      expect(loss.description.trim()).not.toBe('')
      expect(loss.cannotClaim.trim()).not.toBe('')
      expect(['issues', 'comments', 'fields', 'kb', 'activity', 'links', 'guards']).toContain(loss.capability)
    }
    // 卡「损失」行三项：无转换级 guard / 无基线快照 / webhook 依赖环境
    const refs = report.losses.map((l) => l.lossRef).join('\n')
    expect(refs).toContain('无转换级 guard')
    expect(refs).toContain('无基线快照')
    expect(refs).toContain('webhook')
  })

  it('severity 合计由声明复算（不手写合计、不四舍五入）', () => {
    const report = okValue(lossReport())
    const counts = { blocking: 0, degrading: 0, cosmetic: 0 }
    for (const loss of report.losses) counts[loss.severity] += 1
    expect(report.summary).toEqual(counts)
  })

  it('证据不冒充：probes 三态取值合法且无 executed 自报（本波平台面零探针留证）', () => {
    const profile = okValue(bindingProfile())
    expect(profile.probes.length).toBeGreaterThan(0)
    for (const probe of profile.probes) {
      expect(['executed', 'not-executed', 'not-applicable']).toContain(probe.state)
    }
    expect(profile.probes.filter((p) => p.state === 'executed')).toEqual([])
  })
})
