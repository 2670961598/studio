/**
 * read-tiers —— 读面三档视图单测（docs/17-§7 末行「读面分级：Full/Focused/Blind
 * （验证岗 Blind，防生成者上下文污染）」；实现单=src/engine/read-tiers.ts）
 *
 * 断言面：
 *   1. 三档结构（createView）：Full=字段+正文+评论全量；Focused=字段+摘要（最后 N 条+
 *      总计数）；Blind=标题/状态+验收命令+产出物路径，**正文/评论/摘要/字段键结构性
 *      不存在**（防污染是结构保证不是约定）；
 *   2. role→tier 映射（拟稿表）：main_worker=Full、verifier=Blind、summarizer/precheck=
 *      Focused、未登记=Focused、覆盖表按键胜出；角色解析（工号→main_worker、非工号串=
 *      角色名）；
 *   3. Blind fail-closed：缺补齐面/空验收命令 → CONFIG_INVALID（无验收不派工，纪律 3）；
 *   4. 渲染（renderReadViewSection）：三档各自的呈现与窗口外语义（计数替代正文）。
 *
 * e2e（verifier 任务书不含生成者正文的端到端证明）见 read-tiers.e2e.test.ts。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, PersonRef } from '@studio-next/contract'
import { createFakePlatform } from '../../src/engine/fakes.ts'
import {
  DEFAULT_FOCUSED_COMMENT_WINDOW,
  DEFAULT_ROLE_READ_TIERS,
  READ_TIERS,
  UNMAPPED_ROLE_READ_TIER,
  blindArtifactPaths,
  createView,
  renderReadViewSection,
  resolveReadTier,
  roleOfAssignee,
  type TicketReadView,
} from '../../src/engine/read-tiers.ts'

const T0 = '2026-10-16T00:00:00.000Z'

/** 生成者叙事标记（e2e 同款——断言「污染内容在/不在」的锚） */
const STORY = '生成者叙事：我已完成重构，改了 12 个文件，自测全绿（标记 GEN-STORY）'

function commentBody(n: number): string {
  return `评论 ${n}：叙事内容（标记 GEN-COMMENT-${n}）`
}

/** 种子平台：一单（正文=STORY）+ N 条评论（旧→新） */
async function seed(opts?: { comments?: number; withDescription?: boolean }): Promise<{ platform: ReturnType<typeof createFakePlatform>; id: string }> {
  const platform = createFakePlatform({ now: () => T0 })
  const created = await platform.issues.create({
    title: '实现读面分级',
    type: 'task',
    dept: 'departments/工程部',
    level: 2,
    assignee: 'P-1',
    ...(opts?.withDescription === false ? {} : { description: STORY }),
  })
  for (let i = 1; i <= (opts?.comments ?? 0); i += 1) {
    await platform.comments.add(created.id, { author: 'P-9', body: commentBody(i), signature: '[demo·工程部·worker·L2]' })
  }
  return { platform, id: created.id }
}

function expectClassifiedInvalid(err: unknown, subcause: string): void {
  const e = err as ClassifiedError
  expect(e.category).toBe('CONFIG_INVALID')
  expect(e.subcause).toBe(subcause)
}

// ————————————————————————— 三档结构 —————————————————————————

describe('读面三档结构（createView）', () => {
  it('档位清单三档穷尽（full/focused/blind）', () => {
    expect(READ_TIERS).toEqual(['full', 'focused', 'blind'])
  })

  it('Full：全量——字段+正文+评论全量（旧→新原序），tier=full', async () => {
    const { platform, id } = await seed({ comments: 3 })
    const view = await createView(platform, 'full', id)
    expect(view.tier).toBe('full')
    expect(view.issue).toBe(id)
    expect(view.title).toBe('实现读面分级')
    expect(view.state).toBe('新单')
    expect(view.fields).toMatchObject({ type: 'task', dept: 'departments/工程部', level: 2, assignee: 'P-1', updated: T0 })
    expect(view.description).toBe(STORY)
    expect(view.comments?.map((c) => c.body)).toEqual([commentBody(1), commentBody(2), commentBody(3)])
    // 结构性存在的键（对照 Blind 档的键缺席断言）
    expect('description' in view).toBe(true)
    expect('comments' in view).toBe(true)
  })

  it('Full：单据无正文——description 键结构性省略（exactOptional 口径）', async () => {
    const { platform, id } = await seed({ comments: 0, withDescription: false })
    const view = await createView(platform, 'full', id)
    expect('description' in view).toBe(false)
    expect(view.comments).toEqual([])
  })

  it('Focused：字段+摘要——description/comments 键结构性不存在', async () => {
    const { platform, id } = await seed({ comments: 8 })
    const view = await createView(platform, 'focused', id, { focusedWindow: 3 })
    expect(view.tier).toBe('focused')
    expect(view.fields?.dept).toBe('departments/工程部')
    expect(view.commentDigest).toBeDefined()
    expect('description' in view).toBe(false)
    expect('comments' in view).toBe(false)
    expect('commentDigest' in view).toBe(true)
  })

  it('Focused：窗口=最后 N 条（8 条窗 3 → 3 条、total=8、末条=最新）', async () => {
    const { platform, id } = await seed({ comments: 8 })
    const digest = (await createView(platform, 'focused', id, { focusedWindow: 3 })).commentDigest
    expect(digest?.total).toBe(8)
    expect(digest?.window.map((c) => c.body)).toEqual([commentBody(6), commentBody(7), commentBody(8)])
  })

  it('Focused：缺省窗口=DEFAULT_FOCUSED_COMMENT_WINDOW（7 条 → 5 条）', async () => {
    const { platform, id } = await seed({ comments: 7 })
    const digest = (await createView(platform, 'focused', id)).commentDigest
    expect(DEFAULT_FOCUSED_COMMENT_WINDOW).toBe(5)
    expect(digest?.total).toBe(7)
    expect(digest?.window).toHaveLength(5)
  })

  it('Focused：评论数小于窗口 → 窗口=全部；零评论 → total=0、window=[]', async () => {
    const few = await seed({ comments: 2 })
    const fewDigest = (await createView(few.platform, 'focused', few.id, { focusedWindow: 5 })).commentDigest
    expect(fewDigest?.total).toBe(2)
    expect(fewDigest?.window).toHaveLength(2)

    const none = await seed({ comments: 0 })
    const noneDigest = (await createView(none.platform, 'focused', none.id)).commentDigest
    expect(noneDigest?.total).toBe(0)
    expect(noneDigest?.window).toEqual([])
  })

  it('Blind：最小面——只有 tier/issue/title/state/acceptance/artifacts；正文/评论/摘要/字段键结构性不存在', async () => {
    const { platform, id } = await seed({ comments: 3 })
    const view = await createView(platform, 'blind', id, {
      blind: { acceptance: ['echo demo-ok'], artifacts: ['/ws/REPORT.md'] },
    })
    expect(view.tier).toBe('blind')
    expect(view.title).toBe('实现读面分级')
    expect(view.state).toBe('新单')
    expect(view.acceptance).toEqual(['echo demo-ok'])
    expect(view.artifacts).toEqual(['/ws/REPORT.md'])
    // 防污染结构保证：四个键一概不存在（生成者叙事进不了视图对象）
    expect('description' in view).toBe(false)
    expect('comments' in view).toBe(false)
    expect('commentDigest' in view).toBe(false)
    expect('fields' in view).toBe(false)
  })

  it('Blind：缺补齐面 → CONFIG_INVALID fail-closed（无验收不派工，纪律 3）', async () => {
    const { platform, id } = await seed({ comments: 1 })
    await expect(createView(platform, 'blind', id)).rejects.toSatisfy((err: unknown) => {
      expectClassifiedInvalid(err, 'read-tiers/blind-acceptance')
      return true
    })
  })

  it('Blind：验收命令为空数组 → 同上 fail-closed', async () => {
    const { platform, id } = await seed({ comments: 1 })
    await expect(
      createView(platform, 'blind', id, { blind: { acceptance: [], artifacts: ['/ws/REPORT.md'] } }),
    ).rejects.toSatisfy((err: unknown) => {
      expectClassifiedInvalid(err, 'read-tiers/blind-acceptance')
      return true
    })
  })

  it('单据不存在 → 平台异常原样上抛（装饰层不吞不伪装）', async () => {
    const platform = createFakePlatform({ now: () => T0 })
    await expect(createView(platform, 'full', 'T-404')).rejects.toThrow('单据不存在')
  })
})

// ————————————————————————— role → tier 映射 —————————————————————————

describe('role→tier 映射（拟稿表：main_worker=Full、verifier=Blind、其余 Focused）', () => {
  it('缺省表逐条（v0 已知四岗）', () => {
    expect(DEFAULT_ROLE_READ_TIERS).toEqual({
      main_worker: 'full',
      verifier: 'blind',
      summarizer: 'focused',
      precheck: 'focused',
    })
    expect(resolveReadTier('main_worker')).toBe('full')
    expect(resolveReadTier('verifier')).toBe('blind')
    expect(resolveReadTier('summarizer')).toBe('focused')
    expect(resolveReadTier('precheck')).toBe('focused')
  })

  it('未登记角色 → 保守档 Focused（UNMAPPED_ROLE_READ_TIER）', () => {
    expect(UNMAPPED_ROLE_READ_TIER).toBe('focused')
    expect(resolveReadTier('reviewer')).toBe('focused')
    expect(resolveReadTier('custom-role')).toBe('focused')
  })

  it('覆盖表按键胜出、未覆盖键仍走缺省（公司可改档）', () => {
    const overrides: Readonly<Record<string, 'full' | 'focused' | 'blind'>> = { verifier: 'focused', auditor: 'blind' }
    expect(resolveReadTier('verifier', overrides)).toBe('focused')
    expect(resolveReadTier('auditor', overrides)).toBe('blind')
    expect(resolveReadTier('main_worker', overrides)).toBe('full')
    expect(resolveReadTier('reviewer', overrides)).toBe('focused')
  })
})

describe('角色解析（roleOfAssignee——v0 无 role 元数据的拟稿口径）', () => {
  const people: readonly PersonRef[] = [
    { id: 'P-1', name: '张工', login: 'zhang', level: 2, dept: 'departments/工程部' },
  ]

  it('assignee=工号（命中 people）→ main_worker（直派人默认生成岗）', () => {
    expect(roleOfAssignee('P-1', people)).toBe('main_worker')
  })

  it('assignee=非工号串 → 该串即角色名（岗单据形态：assignee=job.role）', () => {
    expect(roleOfAssignee('verifier', people)).toBe('verifier')
    expect(roleOfAssignee('summarizer', people)).toBe('summarizer')
  })

  it('assignee 缺省/空串 → main_worker', () => {
    expect(roleOfAssignee(undefined, people)).toBe('main_worker')
    expect(roleOfAssignee('', people)).toBe('main_worker')
  })
})

// ————————————————————————— 渲染 —————————————————————————

describe('任务书读面节渲染（renderReadViewSection）', () => {
  it('Full：含正文与全部评论体（全量面呈现）', async () => {
    const { platform, id } = await seed({ comments: 3 })
    const section = renderReadViewSection(await createView(platform, 'full', id))
    expect(section).toContain('## 单据读面（Full · 生成岗全量面）')
    expect(section).toContain(STORY)
    expect(section).toContain('GEN-COMMENT-1')
    expect(section).toContain('GEN-COMMENT-3')
    expect(section).toContain('评论（3 条，旧→新）')
  })

  it('Focused：含窗口评论体与总计数；窗口外评论只以计数呈现（防膨胀）', async () => {
    const { platform, id } = await seed({ comments: 8 })
    const section = renderReadViewSection(await createView(platform, 'focused', id, { focusedWindow: 3 }))
    expect(section).toContain('## 单据读面（Focused · 协作岗摘要面')
    expect(section).toContain('共 8 条；仅示最后 3 条')
    expect(section).toContain('GEN-COMMENT-6')
    expect(section).toContain('GEN-COMMENT-8')
    expect(section).not.toContain('GEN-COMMENT-1')
    expect(section).not.toContain('GEN-COMMENT-5')
    expect(section).toContain('其余 5 条以计数呈现')
    // Focused 无正文（摘要面：标题/状态/关键字段/评论摘要）
    expect(section).not.toContain(STORY)
  })

  it('Blind：含冻结验收命令与产出物路径；不含任何叙事内容（正文/评论均不可见）', async () => {
    const { platform, id } = await seed({ comments: 3 })
    const section = renderReadViewSection(
      await createView(platform, 'blind', id, {
        blind: { acceptance: ['echo demo-ok'], artifacts: ['/ws/REPORT.md', '/ws/summary.json'] },
      }),
    )
    expect(section).toContain('## 单据读面（Blind · 验证岗最小面')
    expect(section).toContain('verify 的是证据不是叙事')
    expect(section).toContain('`echo demo-ok`')
    expect(section).toContain('`/ws/REPORT.md`')
    expect(section).toContain('`/ws/summary.json`')
    expect(section).toContain('「实现读面分级」')
    expect(section).not.toContain(STORY)
    expect(section).not.toContain('GEN-COMMENT')
  })

  it('Blind：畸形视图（缺验收命令）→ CONFIG_INVALID 拒渲染（结构完整性防御）', () => {
    const malformed = { tier: 'blind', issue: 'T-1', title: 't', state: 's' } as TicketReadView
    expect(() => renderReadViewSection(malformed)).toThrowError()
    expect(() => renderReadViewSection(malformed)).toThrowError(/blind-acceptance/)
  })

  it('blindArtifactPaths：本工位证据面三路径（workspace/REPORT.md/summary.json）', () => {
    expect(blindArtifactPaths('/var/workspaces/T-1/att1')).toEqual([
      '/var/workspaces/T-1/att1',
      '/var/workspaces/T-1/att1/REPORT.md',
      '/var/workspaces/T-1/att1/summary.json',
    ])
  })
})
