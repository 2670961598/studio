/**
 * 评论面测试：写（PATCH comment=正文+署名尾行、带 version）、读（history 条目过滤：
 * 纯评论条目、隐藏/快照滤除、升序稳定）、author=平台账号语义、坏入参显式报错。
 * 评论在 Taiga=history 条目（docs/32 §四形状）——fake 同构手造。
 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, expectTaigaReject, makePlatform } from './testutil.ts'

describe('评论写', () => {
  it('add：正文+署名尾行进 comment，带 version；写后即读得', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    await p.comments.add('probe-co-1', {
      author: 'AGENT-1',
      body: '评论第一行\n评论第二行',
      signature: '[demo·平台部·工兵·L2]',
    })
    const patch = fake.calls.filter((c) => c.method === 'PATCH').at(-1)
    expect(patch?.body).toMatchObject({ comment: '评论第一行\n评论第二行\n\n[demo·平台部·工兵·L2]', version: 1 })
    const list = await p.comments.list('probe-co-1')
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({ issue: 'probe-co-1', body: '评论第一行\n评论第二行\n\n[demo·平台部·工兵·L2]' })
    expect((list[0]?.created ?? '') > '2026-10-18T00:00:00.000Z').toBe(true)
  })

  it('add：author/body/signature 缺一 → bad-signed-body', async () => {
    const fake = new FakeTaiga()
    fake.seedEntity({ subject: '甲' })
    const p = makePlatform(fake)
    await expectTaigaReject(
      () => p.comments.add('probe-co-1', { body: 'x', signature: '[s]' } as never),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
  })
})

describe('评论读（history 通道）', () => {
  it('纯 diff 条目不算评论；隐藏条目滤除；多条升序', async () => {
    const fake = new FakeTaiga()
    const e = fake.seedEntity({ subject: '甲' })
    fake.pushHistory(e.id, { diffKeys: ['status'] }) // 流转条目——不是评论
    fake.pushHistory(e.id, { comment: '第一条' })
    const hiddenId = fake.pushHistory(e.id, { comment: '隐藏的' })
    const hiddenEntry = e.history.find((h) => h.id === hiddenId)
    if (hiddenEntry !== undefined) hiddenEntry.hidden = true
    fake.pushHistory(e.id, { comment: '第二条', username: 'worker-p2' })
    const list = await makePlatform(fake).comments.list('probe-co-1')
    expect(list.map((c) => c.body)).toEqual(['第一条', '第二条'])
    expect(list[0]?.author).toBe('admin') // 平台账号语义（端口缺口注记见 index 头注）
    expect(list[1]?.author).toBe('worker-p2')
    // 升序稳定
    const sorted = [...list].sort((x, y) => (x.created === y.created ? (x.id < y.id ? -1 : 1) : x.created < y.created ? -1 : 1))
    expect(list.map((c) => c.id)).toEqual(sorted.map((c) => c.id))
  })

  it('单不存在 → not-found 透传；单号非法 → bad-ticket-id', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.comments.list('probe-co-9'), 'EXTERNAL_REJECT', 'not-found')
    await expectTaigaReject(() => p.comments.list('xx'), 'CONFIG_INVALID', 'bad-ticket-id')
  })
})
