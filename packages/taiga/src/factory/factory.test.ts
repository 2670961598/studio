/**
 * factory —— 出厂态根治三步测试（DEV-49，docs/52-§十 方案 A；S0 形状=docs/32-§九）。
 *
 * 根因复现口径（红面）：项目出厂 default_us_status=New（fake 出厂值 id=1）——
 * 不带 status 的**裸 API 建单**（UI/第三方直调/放单脚本——事故里 14 单的来路）
 * 都落 'New' ∉ 公司声明集 → decide NOOP_UNKNOWN_STATE 静默卡死。红绿证一律走
 * ctx.client 直接 POST /userstories（不带 status）——经适配器建单会被
 * fieldMap.initialState 兜住，测不到「平台默认态」这条兜底链。
 * 单客户端口径：全用例共用一个 TaigaContext（FakeTaiga token 单槽——多客户端
 * 互踢会污染幂等计数；onboard.test 同法避免第二客户端）。
 *
 * 断言面（docs/52-§10.2 表逐行 + onboard 两跑幂等基线）：
 *   1. A1 默认态重指：PATCH /projects/{id} 一次携待改字段；已指即零写（重跑零写）
 *   2. A2 存量归化：流外态单逐单 transition 到类型收件态；声明集内单不动；重跑零写
 *   3. A3 出厂态退役：快照先行（任何 DELETE 之前回调）；DELETE ?moveTo= 语义
 *      （引用迁移+默认值联动）；无声明集实体跳过+报告；拒删逐条跳过不中断；重跑零删
 *   4. 三步合流两跑幂等：第二跑零写零删、平台指纹一致；**根治绿证=裸 API 建单落
 *      声明集内**（「平台默认态从兜底链变映射态」的可测化身）
 *   5. moveTo 必填（S0 400 语义——fake 按 docs/32-§九 建模的防回归面）
 *   6. DEV-43 实体档案：entities 分实体指默认态（task 档案首态）+ 分实体退役
 */
import { describe, expect, it } from 'vitest'
import type { FieldProvisionMap } from '@studio-next/contract'
import { buildContext } from '../platform.ts'
import { TaigaPlatformError } from '../transport/errors.ts'
import { getIssue, listIssues } from '../issues.ts'
import { provisionFields } from '../fields.ts'
import {
  cureFactoryStatuses,
  normalizeFactoryTickets,
  repointProjectDefaults,
  retireFactoryStatuses,
  type FactoryStatusSnapshot,
} from './factory.ts'
import { FakeTaiga, TEST_BASE_URL, TEST_PASSWORD_AUTH } from '../testutil.ts'

/** 五态现状口径（公司 var/taiga-fields.json 同构：无 entities/typeInbox） */
const CURE_MAP: FieldProvisionMap = {
  fields: { type: '类型', dept: '部门', level: '等级', lane: '泳道' },
  types: { level: 'int' },
  states: ['新单', '已派发', '已交付'],
  stateFlow: { 新单: ['已派发'], 已派发: ['已交付'] },
}

type Ctx = ReturnType<typeof buildContext>

function makeCtx(fake: FakeTaiga, map?: FieldProvisionMap): Ctx {
  return buildContext({
    baseUrl: TEST_BASE_URL,
    project: 'probe-co',
    auth: TEST_PASSWORD_AUTH,
    ...(map === undefined ? {} : { fields: map }),
    fetch: fake.fetch,
  })
}

/** 声明集建档（provision 是三步的前置——工厂函数不代跑 provision） */
async function provisioned(fake: FakeTaiga, map: FieldProvisionMap = CURE_MAP): Promise<Ctx> {
  const ctx = makeCtx(fake, map)
  await provisionFields(ctx, map)
  return ctx
}

/** 裸 API 建单（第三方直调口径：不带 status——落位完全由项目默认态决定） */
async function rawCreate(ctx: Ctx, subject: string): Promise<string> {
  const res = await ctx.client.request({
    method: 'POST',
    path: '/userstories',
    body: { project: await ctx.project(), subject },
  })
  const ref = Number((res.json as { ref?: unknown })['ref'])
  return `probe-co-${String(ref)}`
}

function fingerprint(fake: FakeTaiga): string {
  return JSON.stringify({
    statuses: fake.statuses.map((s) => s.name),
    issueStatuses: fake.issueStatuses.map((s) => s.name),
    taskStatuses: fake.taskStatuses.map((s) => s.name),
    defaults: fake.defaultStatuses,
    entities: fake.entities.map((e) => [e.ref, e.status]),
  })
}

describe('A1 默认态重指（出厂 default_us_status=New → 公司收件态）', () => {
  it('红面复现：出厂默认态下裸 API 建单落 New；重指后同路径建单落新单（绿面）', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)

    // 红：平台默认态=出厂 New——裸建单路径流外
    const stray = await rawCreate(ctx, '第三方直调建单')
    expect((await getIssue(ctx, stray)).state).toBe('New')

    const r1 = await repointProjectDefaults(ctx, CURE_MAP)
    expect(r1.defaults).toEqual([{ entity: 'userstory', field: 'default_us_status', from: 'New', to: '新单' }])
    // task/issue 无声明（五态现状）→ 跳过+报告，不静默
    expect(r1.defaultsSkipped.map((s) => String(s.entity))).toEqual(['issue', 'task'])
    expect(fake.defaultStatuses.userstory).toBe(fake.statuses.find((s) => s.name === '新单')?.id)

    // 绿：同一裸建单路径落公司声明集内
    const cured = await rawCreate(ctx, '根治后建单')
    expect((await getIssue(ctx, cured)).state).toBe('新单')
  })

  it('幂等重入：已指即零写（defaultsKept 观测）', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    await repointProjectDefaults(ctx, CURE_MAP)
    const writes1 = fake.countWriteCalls()

    const r2 = await repointProjectDefaults(ctx, CURE_MAP)
    expect(r2.defaults).toEqual([])
    expect(r2.defaultsKept).toEqual([{ entity: 'userstory', field: 'default_us_status', current: '新单' }])
    expect(fake.countWriteCalls()).toBe(writes1) // 第二跑零写
  })
})

describe('A2 存量归化（流外态单 → 类型收件态）', () => {
  it('New/Done 单归化到新单；声明集内单不动；重跑零写', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    const dispatchedId = fake.statuses.find((s) => s.name === '已派发')?.id as number
    const onNew = fake.seedEntity({ subject: '出厂 New 单' }) // status=1（New）
    const onDone = fake.seedEntity({ subject: '出厂 Done 单', status: 5 })
    const inFlow = fake.seedEntity({ subject: '声明集内单', status: dispatchedId })

    const r1 = await normalizeFactoryTickets(ctx, CURE_MAP)
    expect(r1.normalized).toEqual([
      { ticket: `probe-co-${String(onNew.ref)}`, from: 'New', to: '新单' },
      { ticket: `probe-co-${String(onDone.ref)}`, from: 'Done', to: '新单' },
    ])
    expect(r1.normalizedKept).toBe(1)
    expect(r1.normalizeFailed).toEqual([])
    expect((await getIssue(ctx, `probe-co-${String(onNew.ref)}`)).state).toBe('新单')
    expect((await getIssue(ctx, `probe-co-${String(onDone.ref)}`)).state).toBe('新单')
    expect((await getIssue(ctx, `probe-co-${String(inFlow.ref)}`)).state).toBe('已派发')

    // 幂等重入：全部已在声明集 → 零写
    const writes1 = fake.countWriteCalls()
    const r2 = await normalizeFactoryTickets(ctx, CURE_MAP)
    expect(r2.normalized).toEqual([])
    expect(r2.normalizedKept).toBe(3)
    expect(fake.countWriteCalls()).toBe(writes1)
  })
})

describe('A3 出厂态退役（快照先行 + DELETE ?moveTo=）', () => {
  it('快照在任何 DELETE 之前落回调；New/In progress/Done 退役 moveTo=新单；task/issue 无声明跳过+报告', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    fake.seedEntity({ subject: '扫描后竞态建的单（落 Done）', status: 5 }) // A2 之后才出现的流外单

    const snapshots: FactoryStatusSnapshot[] = []
    const r = await retireFactoryStatuses(ctx, CURE_MAP, {
      now: () => Date.parse('2026-10-20T00:00:00.000Z'),
      persistSnapshot: (s) => {
        snapshots.push(s)
        // 快照回调时平台还没收到任何 DELETE（S0：删除不可逆，入档后行）
        expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false)
      },
    })

    expect(r.retired).toEqual([
      { entity: 'userstory', status: 'New', moveTo: '新单' },
      { entity: 'userstory', status: 'In progress', moveTo: '新单' },
      { entity: 'userstory', status: 'Done', moveTo: '新单' },
    ])
    // 无声明集实体（五态现状）：值只增不删原则保持，跳过面逐条报告不静默
    expect(r.retireSkipped.map((s) => `${String(s.entity)}:${String(s.status)}`)).toEqual(['issue:New', 'task:New'])
    expect(fake.statuses.map((s) => s.name)).toEqual(['新单', '已派发', '已交付'])
    // A1 未跑（默认仍指 New）→ S0 联动语义：被删状态是项目默认 → 默认值改指 moveTo
    expect(fake.defaultStatuses.userstory).toBe(fake.statuses.find((s) => s.name === '新单')?.id)

    // moveTo 引用迁移语义（S0，docs/32-§九）：竞态单被 DELETE 迁到新单——与 A2 目标同值
    const moved = (await listIssues(ctx, {})).find((i) => i.title === '扫描后竞态建的单（落 Done）')
    expect(moved?.state).toBe('新单')

    // 快照=删除前原貌（含出厂三态+各实体默认值）
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.at).toBe(Date.parse('2026-10-20T00:00:00.000Z'))
    expect(snapshots[0]?.entities.userstory?.statuses?.map((s) => s.name)).toContain('New')
    expect(snapshots[0]?.entities.userstory?.defaultStatus).toBe(1)

    // 幂等重入：出厂态已不在状态集 → 零 DELETE（快照仍取证=删除面幂等观测）
    const writes1 = fake.countWriteCalls()
    const r2 = await retireFactoryStatuses(ctx, CURE_MAP, { persistSnapshot: (s) => snapshots.push(s) })
    expect(r2.retired).toEqual([])
    expect(r2.retireSkipped.map((s) => String(s.entity))).toEqual(['issue', 'task'])
    expect(fake.countWriteCalls()).toBe(writes1)
    expect(snapshots).toHaveLength(2)
  })

  it('moveTo 必填（S0 400 语义防回归）：直接 DELETE 不带 moveTo 被平台拒收', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    await expect(
      ctx.client.request({ method: 'DELETE', path: '/userstory-statuses/1' }),
    ).rejects.toMatchObject({ category: 'CONFIG_INVALID', subcause: 'bad-request' })
    expect(fake.statuses.some((s) => s.name === 'New')).toBe(true) // 未删（400 非静默）
  })

  it('平台拒删面：逐条跳过+报告（不中断其余退役）', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    fake.failStatusDeletes.add(3) // In progress（id=3）平台侧 500
    const r = await retireFactoryStatuses(ctx, CURE_MAP)
    expect(r.retired.map((x) => x.status)).toEqual(['New', 'Done'])
    expect(r.retireSkipped).toContainEqual(
      expect.objectContaining({ entity: 'userstory', status: 'In progress', reason: expect.stringContaining('500') }),
    )
    // 其余面不受中断影响
    expect(fake.statuses.map((s) => s.name)).toEqual(['In progress', '新单', '已派发', '已交付'])
  })
})

describe('三步合流两跑幂等（onboard 基线：provision 后 A1→A2→A3）', () => {
  it('第一跑治（重指+归化+退役+快照）；第二跑零写零删、指纹一致；建单不再流外', async () => {
    const fake = new FakeTaiga()
    const ctx = await provisioned(fake)
    fake.seedEntity({ subject: '存量 New 单' })
    fake.seedEntity({ subject: '存量 Done 单', status: 5 })

    const snapshots: FactoryStatusSnapshot[] = []
    const r1 = await cureFactoryStatuses(ctx, CURE_MAP, { persistSnapshot: (s) => snapshots.push(s) })
    expect(r1.defaults.map((d) => `${String(d.entity)}:${String(d.from)}→${String(d.to)}`)).toEqual(['userstory:New→新单'])
    expect(r1.normalized).toHaveLength(2)
    expect(r1.retired.map((x) => x.status)).toEqual(['New', 'In progress', 'Done'])
    expect(snapshots).toHaveLength(1)
    const fp1 = fingerprint(fake)

    // 第二跑：零写零删（快照仍取证——幂等无副作用）；指纹一致
    const r2 = await cureFactoryStatuses(ctx, CURE_MAP, { persistSnapshot: (s) => snapshots.push(s) })
    expect(r2.defaults).toEqual([])
    expect(r2.normalized).toEqual([])
    expect(r2.retired).toEqual([])
    expect(snapshots).toHaveLength(2)
    expect(fingerprint(fake)).toBe(fp1)

    // 根治绿证：根治前裸建单落 New（红），根治后同路径建单落声明集内（绿）
    const after = await rawCreate(ctx, '任意路径建单')
    expect((await getIssue(ctx, after)).state).toBe('新单')
    expect(fake.statuses.map((s) => s.name)).toEqual(['新单', '已派发', '已交付'])
  })
})

describe('DEV-43 实体档案：分实体指默认态 + 分实体退役', () => {
  it('entities.task 声明 → default_task_status 指 task 档案首态；task 出厂态退役；issue 无声明仍跳过', async () => {
    const fake = new FakeTaiga()
    const map: FieldProvisionMap = { ...CURE_MAP, entities: { task: { states: ['探索单', '探索完'] } } }
    const ctx = await provisioned(fake, map)
    const r = await cureFactoryStatuses(ctx, map)
    expect(r.defaults.map((d) => `${String(d.entity)}:${String(d.to)}`)).toEqual(['userstory:新单', 'task:探索单'])
    expect(fake.defaultStatuses.task).toBe(fake.taskStatuses.find((s) => s.name === '探索单')?.id)
    expect(r.retireSkipped.map((s) => String(s.entity))).toEqual(['issue'])
    expect(r.retired.map((x) => `${String(x.entity)}:${String(x.status)}→${String(x.moveTo)}`)).toEqual([
      'userstory:New→新单',
      'userstory:In progress→新单',
      'userstory:Done→新单',
      'task:New→探索单',
    ])
    expect(fake.taskStatuses.map((s) => s.name)).toEqual(['探索单', '探索完'])
    const after = await rawCreate(ctx, 'userstory 裸建单仍走绑定实体默认态')
    expect((await getIssue(ctx, after)).state).toBe('新单')
  })
})

describe('入参防御', () => {
  it('缺 states 段（provision 未跑先治）→ CONFIG_INVALID 明报零写', async () => {
    const fake = new FakeTaiga()
    const ctx = makeCtx(fake)
    const bad = { fields: {} } as unknown as FieldProvisionMap
    await expect(repointProjectDefaults(ctx, bad)).rejects.toBeInstanceOf(TaigaPlatformError)
    await expect(normalizeFactoryTickets(ctx, bad)).rejects.toMatchObject({ subcause: 'bad-provision-map' })
    await expect(retireFactoryStatuses(ctx, bad)).rejects.toMatchObject({ subcause: 'bad-provision-map' })
    expect(fake.calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE')).toBe(false) // 零写明报
  })
})
