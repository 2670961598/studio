/**
 * binding.test.ts —— LocalFile 绑定三件套 V2 测试（IMPL-07-03；G-DOM-02 local 腿 / L3O-04）
 *
 * 覆盖（本单冻结验收口径；三包同形，键表逐字相同、只换平台值）：
 *   ① 三件套同形：bindingProfile/mapState/lossReport 三入口＋唯一绑定选择器在同一模块；
 *      档案键面＝bindingId/平台/能力/状态映射/损失报告（+ 事实状态/探针）；
 *   ② bindingId 选择：只认本包 BINDING_ID；外域/未知/空串＝Err（不回落冒充）；
 *   ③ 状态映射：无部署值表⇒全 unverified（原值保留、不猜 provision states）；空/畸形⇒Err；
 *   ④ stateMappings 唯一源＝绑定档案（platform 面转引同一数组，不散落第二张表）；
 *   ⑤ 404 读口：**仅平台权威确认不存在**（文件不存在）⇒Ok(undefined)；缺省读上下文/越权/
 *      不可确认（事件流损坏、盘读失败）⇒Err，不得用 Ok(undefined) 冒充「没有这张单」
 *      （L3O-04 / 80-§6.3 / v2/14 §0.2-1；LocalFile 也适用「读不到≠没有」）；
 *   ⑥ lossReport：卡行锚＋ENU-110 三值＋逐项 cannotClaim，severity 合计由声明复算；
 *   ⑦ 证据不冒充：probes 三态、无 executed 自报（本波平台面零探针留证）。
 *
 * 依据：v2/12 §2.2（BIND-PLAT-LOCAL-01）/§2.3；v2/14 §八；plan/05 IMPL-07-03；差距 L3O-04。
 * 夹具全落 os.tmpdir()，用后清理；不写仓内文件、零外部服务。
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClassifiedError, FlowPlatform, ReadContext, Result } from '@studio-next/contract'
import { BINDING_ID, bindingProfile, lossReport, mapState, resolveBinding } from '../../src/binding.ts'
import { issuesDir } from '../../src/layout.ts'
import { createLocalPlatform, readContextDenial, readIssue, readIssueState, stateMappingTable } from '../../src/platform.ts'
import { tmpRoot } from '../../src/testutil.ts'

const ROOT = tmpRoot('binding')
afterAll(() => {
  // 权限负例把文件置 000；先恢复再删（unlink 只依赖父目录写权限，这里仍显式复位）
  try {
    chmodSync(join(issuesDir(ROOT), 'LOCAL-2.jsonl'), 0o600)
  } catch {
    // 文件不存在/未创建＝无需复位
  }
  rmSync(ROOT, { recursive: true, force: true })
})

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

describe('绑定三件套同形（IMPL-07-03；v2/14 §八）', () => {
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
    expect(profile.platform.kind).toBe('localfile')
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
    // 卡「覆盖」行：七项实现（含 guards），guards 只落盘不执行＝degraded
    expect(profile.capabilities.find((c) => c.name === 'guards')?.status).toBe('degraded')
    expect(profile.capabilities.filter((c) => c.status === 'unsupported')).toEqual([])
    expect(profile.factStatus).toBe('已有')
    // 三件套共用同一档案对象（单例；防每次新建出第二份真值）
    expect(okValue(bindingProfile())).toBe(profile)
  })

  it('唯一绑定选择器：只认本包 bindingId；外域/未知/空串＝Err（不回落冒充）', () => {
    const own = okValue(resolveBinding())
    expect(own.bindingId).toBe(BINDING_ID)
    expect(okValue(resolveBinding(BINDING_ID))).toBe(own)

    for (const foreign of ['BIND-PLAT-YT-01', 'BIND-PLAT-TAIGA-01', 'BIND-DSH-01', '']) {
      const err = errOf(resolveBinding(foreign))
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('binding-unknown')
    }
    expect(errOf(bindingProfile('BIND-PLAT-YT-01')).subcause).toBe('binding-unknown')
    expect(errOf(mapState('open', 'BIND-PLAT-TAIGA-01')).subcause).toBe('binding-unknown')
    expect(errOf(lossReport('BIND-PLAT-YT-01')).subcause).toBe('binding-unknown')
    expect(errOf(stateMappingTable('BIND-PLAT-TAIGA-01')).subcause).toBe('binding-unknown')
  })
})

describe('状态映射（v2/12 §2.3：未映射但合法＝Ok(unverified)；空/畸形＝Err）', () => {
  it('本部署无已核值表：一切非空合法原值⇒unverified＋原值逐字保留（不猜 provision states）', () => {
    // 部署工件未注入（LocalFile 状态集来自 provision states）；把公司流程态当工作十态＝跨族错填
    expect(okValue(bindingProfile()).stateMappings).toEqual([])

    for (const platformState of ['open', '新单', '已派发', '已交付']) {
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
    for (const bad of ['', '  ', '\r\n']) {
      const err = errOf(mapState(bad))
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('platform-state-invalid')
    }
    expect(errOf(mapState(undefined as unknown as string)).subcause).toBe('platform-state-invalid')
  })

  it('stateMappings 唯一源＝绑定档案：platform 面转引同一数组（不散落第二张表）', () => {
    const table = okValue(stateMappingTable())
    expect(table).toBe(okValue(bindingProfile()).stateMappings) // 引用同一数组＝单一源
  })
})

describe('404 读口（L3O-04：仅权威确认不存在＝Ok(undefined)；越权/不可确认＝Err）', () => {
  it('权威「文件不存在」⇒Ok(undefined)；存在⇒Ok(记录)', async () => {
    const platform = createLocalPlatform(ROOT)
    const created = await platform.issues.create({ title: '甲单：绑定读口' })

    const absent = await readIssue(platform, 'LOCAL-999', READ_CTX)
    expect(absent).toEqual({ kind: 'ok', value: undefined })

    const found = await readIssue(platform, created.id, READ_CTX)
    const record = okValue(found)
    expect(record?.id).toBe(created.id)
    expect(record?.state).toBe('open') // DEFAULT_INITIAL_STATE（未 provision）
  })

  it('缺省读上下文⇒Err（读面缺省＝拒，不按「无行」处理）', async () => {
    const platform = createLocalPlatform(ROOT)
    expect(readContextDenial(undefined)?.subcause).toBe('read-context-missing')
    expect(errOf(await readIssue(platform, 'LOCAL-1', undefined)).subcause).toBe('read-context-missing')
  })

  it('越权（可见字段空集/调用者缺失/readScope 缺失）⇒Err，不得 Ok(undefined) 冒充不存在', async () => {
    const platform = createLocalPlatform(ROOT)

    const emptyScope = { ...READ_CTX, readScope: { ...READ_CTX.readScope, fields: [] } } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'LOCAL-1', emptyScope)).subcause).toBe('read-scope-invalid')

    const noCaller = { readScope: READ_CTX.readScope } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'LOCAL-1', noCaller)).subcause).toBe('read-caller-missing')

    const noScope = { caller: READ_CTX.caller } as unknown as ReadContext
    expect(errOf(await readIssue(platform, 'LOCAL-1', noScope)).subcause).toBe('read-scope-missing')
  })

  it('不可确认（事件流损坏/盘读失败/读回形状不符）⇒Err，不冒充不存在', async () => {
    const platform = createLocalPlatform(ROOT)
    const dir = issuesDir(ROOT)
    mkdirSync(dir, { recursive: true })

    // ① 事件流行损坏＝读不出来（corrupt-issue-log），不是「没有这张单」
    writeFileSync(join(dir, 'LOCAL-1.jsonl'), '{"type":"bogus"}\n', 'utf8')
    const corrupt = await readIssue(platform, 'LOCAL-1', READ_CTX)
    expect(errOf(corrupt).subcause).toBe('corrupt-issue-log')
    expect(corrupt).not.toEqual({ kind: 'ok', value: undefined })

    // ② 盘读失败（EACCES）：文件在、读不出 ⇒ Err（STALL），不得当不存在
    const okLine = `${JSON.stringify({ type: 'created', ts: '2026-01-01T00:00:00.000Z', state: 'open', input: { title: '乙单' } })}\n`
    writeFileSync(join(dir, 'LOCAL-2.jsonl'), okLine, 'utf8')
    chmodSync(join(dir, 'LOCAL-2.jsonl'), 0o000)
    const unreadable = await readIssue(platform, 'LOCAL-2', READ_CTX)
    expect(errOf(unreadable).category).toBe('STALL')
    expect(errOf(unreadable).subcause).toBe('read-unconfirmable')

    // ③ 适配器读回非 IssueRecord 形状：不可确认 ⇒ Err，不得当「不存在」
    const broken = { issues: { async get() { return 'not-a-record' } } } as unknown as FlowPlatform
    expect(errOf(await readIssue(broken, 'LOCAL-1', READ_CTX)).subcause).toBe('read-shape-invalid')
  })

  it('readIssueState：状态判决同源于绑定档案；不存在时不映射', async () => {
    const platform = createLocalPlatform(ROOT)
    rmSync(join(issuesDir(ROOT), 'LOCAL-1.jsonl'), { force: true })
    const created = await platform.issues.create({ title: '丙单：状态判决' })

    const hit = okValue(await readIssueState(platform, created.id, READ_CTX))
    expect(hit).toBeDefined()
    expect(hit?.mapping).toEqual(okValue(mapState(hit!.record.state))) // 同一 mapState，不另写一套
    expect(hit?.mapping.verification).toBe('unverified')

    expect(await readIssueState(platform, 'LOCAL-999', READ_CTX)).toEqual({ kind: 'ok', value: undefined })
    expect(errOf(await readIssueState(platform, created.id, READ_CTX, 'BIND-PLAT-YT-01')).subcause).toBe(
      'binding-unknown',
    )
  })
})

describe('损失报告与证据（v2/12 §2.2/§六：逐项 cannotClaim，severity 三值）', () => {
  it('lossReport：卡行锚＋ENU-110 三值＋非空 cannotClaim，与档案 losses 同源', () => {
    const report = okValue(lossReport())
    expect(report.bindingId).toBe(BINDING_ID)
    expect(report.losses).toBe(okValue(bindingProfile()).losses) // 同一数组＝单一源
    expect(report.losses.length).toBeGreaterThan(0)

    for (const loss of report.losses) {
      expect(loss.lossRef.startsWith('v2/12 §2.2 BIND-PLAT-LOCAL-01')).toBe(true)
      expect(['blocking', 'degrading', 'cosmetic']).toContain(loss.severity)
      expect(loss.description.trim()).not.toBe('')
      expect(loss.cannotClaim.trim()).not.toBe('')
      expect(['issues', 'comments', 'fields', 'kb', 'activity', 'links', 'guards']).toContain(loss.capability)
    }
    // 卡「损失」行两项：guard 不执行 / 单机文件无并发控制
    const refs = report.losses.map((l) => l.lossRef).join('\n')
    expect(refs).toContain('guard 不执行')
    expect(refs).toContain('单机并发')
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
