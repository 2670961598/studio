/**
 * 工具表单一事实源测试 —— 两表对齐防漂移 + schema 拒坏输入 + 摘要形态
 *
 * 冻结验收（docs/25-§4.1：GATEWAY_ACTIONS 与 studio-tools 同一张表）：
 *   - STUDIO_TOOLS 与 GATEWAY_ACTIONS 同名同序——不一致即红（防漂移第一道钉）
 *   - 每工具输入 schema：正确输入收、坏输入拒（空串/错型/多余字段——fail-closed 不猜）
 *   - 输出 schema：deny 形态带两级分类（category/subcause），非冻结 category 拒
 *   - studioToolSummaries：供 AGENTS.md L5 的摘要形态（name/action/title/description/inputSchema）
 */
import { describe, expect, it } from 'vitest'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'
import {
  ArticleInput,
  ArticleOutput,
  BudgetQueryInput,
  CommentInput,
  CommentOutput,
  EvidenceWriteInput,
  HeartbeatInput,
  KbSearchInput,
  STUDIO_TOOLS,
  STUDIO_TOOL_NAMES,
  studioToolSummaries,
  TOOL_ERROR_CATEGORIES,
} from './tools.ts'

describe('STUDIO_TOOLS ↔ GATEWAY_ACTIONS 对齐（防漂移）', () => {
  it('同名同序、长度一致——两表不一致即红', () => {
    expect(STUDIO_TOOL_NAMES).toEqual([...GATEWAY_ACTIONS])
    expect(STUDIO_TOOLS).toHaveLength(GATEWAY_ACTIONS.length)
  })

  it('每工具 name/title/description 齐备（AGENTS.md 只教「什么时候用」，描述不得为空）', () => {
    for (const t of STUDIO_TOOLS) {
      expect(t.name).toBeTruthy()
      expect(t.title).toBeTruthy()
      expect(t.description.length).toBeGreaterThan(8)
      expect(t.description).not.toContain('怎么调') // 教用法不教「怎么调」——schema 承担
    }
  })

  it('状态推进不在工具名面（白名单本就不含状态动作，双重钉）', () => {
    const forbidden = ['state', 'transition', 'move', 'close', 'resolve']
    for (const name of STUDIO_TOOL_NAMES) {
      for (const f of forbidden) expect(name).not.toContain(f)
    }
  })
})

describe('输入 schema：收正确、拒坏输入（协议层拒绝的标的）', () => {
  const good: Record<GatewayAction, Record<string, unknown>> = {
    comment: { issue: 'T-1', body: '进展：已完成地基' },
    heartbeat: { issue: 'T-1' },
    article: { path: 'kb/lessons/yt-cursor.md', markdown: '# 游标教训\n...' },
    'kb-search': { query: '游标 语义' },
    'evidence-write': { path: 'evidence/REPORT.md', content: '# REPORT\n全绿' },
    'budget-query': { issue: 'T-1' },
  }

  it.each([...GATEWAY_ACTIONS])('%s 收正确输入', (name) => {
    const schema = STUDIO_TOOLS.find((t) => t.name === name)?.input
    expect(schema).toBeDefined()
    expect(schema!.safeParse(good[name]).success).toBe(true)
  })

  it('comment 拒空 body / 缺 issue', () => {
    expect(CommentInput.safeParse({ issue: 'T-1', body: '' }).success).toBe(false)
    expect(CommentInput.safeParse({ body: 'x' }).success).toBe(false)
  })

  it('heartbeat 拒空 issue 与错型', () => {
    expect(HeartbeatInput.safeParse({ issue: '' }).success).toBe(false)
    expect(HeartbeatInput.safeParse({ issue: 42 }).success).toBe(false)
  })

  it('article 拒空 path 与多余字段（strictObject）', () => {
    expect(ArticleInput.safeParse({ path: '', markdown: 'x' }).success).toBe(false)
    expect(ArticleInput.safeParse({ path: 'a.md', markdown: 'x', extra: 1 }).success).toBe(false)
  })

  it('kb-search 拒非串 query 与多余字段', () => {
    expect(KbSearchInput.safeParse({ query: ['a'] }).success).toBe(false)
    expect(KbSearchInput.safeParse({ query: 'a', limit: 5 }).success).toBe(false)
  })

  it('evidence-write 拒空 content', () => {
    expect(EvidenceWriteInput.safeParse({ path: 'a.md', content: '' }).success).toBe(false)
  })

  it('budget-query 拒空 issue', () => {
    expect(BudgetQueryInput.safeParse({}).success).toBe(false)
  })
})

describe('输出 schema：两级错误分类形态', () => {
  const deny = {
    ok: false as const,
    error: { category: 'gateway' as const, subcause: 'gw-verify-expired', message: 'wkey 已过期' },
  }

  it('deny 形态过判别并集（六工具共用同一 deny 分支，抽三面验证）', () => {
    expect(CommentOutput.safeParse({ ...deny }).success).toBe(true)
    expect(ArticleOutput.safeParse({ ...deny }).success).toBe(true)
    expect(BudgetQueryInput.safeParse({ issue: 'T-1' }).success).toBe(true) // 邻 schema 烟囱
  })

  it('非冻结 category 拒（两级分类是冻结面，不收编外值）', () => {
    const bad = { ok: false, error: { category: 'random', subcause: 'x', message: 'y' } }
    expect(CommentOutput.safeParse(bad).success).toBe(false)
    expect(ArticleOutput.safeParse(bad).success).toBe(false)
  })

  it('TOOL_ERROR_CATEGORIES 冻结四族', () => {
    expect([...TOOL_ERROR_CATEGORIES]).toEqual(['auth', 'gateway', 'deps', 'internal'])
  })

  it('ok 分支缺必填字段拒（如 comment 缺 signature）', () => {
    expect(CommentOutput.safeParse({ ok: true, action: 'comment', issue: 'T-1', author: 'P-1' }).success).toBe(false)
  })
})

describe('studioToolSummaries（AGENTS.md L5 引用面）', () => {
  it('每工具摘要有 name/action/描述与 JSON Schema 形态的 inputSchema', () => {
    const sums = studioToolSummaries()
    expect(sums.map((s) => s.name)).toEqual([...GATEWAY_ACTIONS])
    for (const s of sums) {
      expect(s.action).toBe(s.name)
      expect(s.description.length).toBeGreaterThan(8)
      const js = s.inputSchema as { type?: string; properties?: Record<string, unknown> }
      expect(js.type).toBe('object')
      expect(js.properties).toBeDefined()
      expect(Object.keys(js.properties!).length).toBeGreaterThan(0)
    }
  })

  it('inputSchema 的 required 与 zod 声明一致（comment：issue+body 全必填）', () => {
    const comment = studioToolSummaries().find((s) => s.name === 'comment')
    expect((comment!.inputSchema as { required?: string[] }).required).toEqual(['issue', 'body'])
  })
})
