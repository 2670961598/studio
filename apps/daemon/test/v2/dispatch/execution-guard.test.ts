/**
 * 775/C3 —— 执行类单据监控（发布岗 REL-1 不得被派执行类单据）
 *
 * 背景：REL-1 有写盘+dsh shell 能力，若收到 deploy/release/tag/push 类指令可绕过 719
 * 审批执行原始发布命令；verifier C2/C3 要求派工面拒派 + ESCALATE 人工复核。
 * 本用例钉纯函数判定；接线点=dispatch/execute.ts（resolve 出人后、预算/装配前）。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXECUTION_GUARD_KEYWORDS, executionGuardHit } from '../../../src/engine/work/dispatch-selection.ts'

const ROLES = ['发布岗']

describe('executionGuardHit（775/C3）', () => {
  it('受监控岗位 + 标题含 deploy/tag/push → hit（关键词返回）', () => {
    for (const title of ['deploy 717 to production', 'git tag v0.2.0', 'hotfix: push release', '部署到部署树', '发布 v1.2.3']) {
      const r = executionGuardHit({ title, personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES })
      expect(r.hit, title).toBe(true)
      expect(r.keyword).toBeTruthy()
    }
  })

  it('描述命中同样拦截（标题干净也没用）', () => {
    const r = executionGuardHit({
      title: '例行日报整理',
      description: '完成后执行 deploy.mjs deploy --ref abc，再 git tag -a v1 && git push',
      personId: 'REL-1',
      personRole: '发布岗',
      guardRoles: ROLES,
    })
    expect(r.hit).toBe(true)
  })

  it('非受监控岗位 / 无岗位 / 面关 → 不拦（零行为变）', () => {
    expect(executionGuardHit({ title: 'deploy thing', personId: 'ENG-1', personRole: '程序工程师', guardRoles: ROLES }).hit).toBe(false)
    expect(executionGuardHit({ title: 'deploy thing', personId: 'X-1' }).hit).toBe(false)
    expect(executionGuardHit({ title: 'deploy thing', personId: 'REL-1', personRole: '发布岗', guardRoles: [] }).hit).toBe(false)
    expect(executionGuardHit({ title: 'deploy thing', personId: 'REL-1', personRole: '发布岗' }).hit).toBe(false)
  })

  it('ASCII 词边界：deployment 不误命中 deploy；纯文本里 deploy 命中', () => {
    expect(executionGuardHit({ title: 'deployment plan review', personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES }).hit).toBe(false)
    expect(executionGuardHit({ title: 'deploy plan review', personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES }).hit).toBe(true)
  })

  it('custom keywords 覆盖内置（空数组回落内置；自定义生效）', () => {
    const custom = ['cutover']
    expect(executionGuardHit({ title: 'cutover window', personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES, keywords: custom }).hit).toBe(true)
    expect(executionGuardHit({ title: 'deploy', personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES, keywords: custom }).hit).toBe(false)
    expect(executionGuardHit({ title: 'deploy', personId: 'REL-1', personRole: '发布岗', guardRoles: ROLES, keywords: [] }).hit).toBe(true)
    expect(DEFAULT_EXECUTION_GUARD_KEYWORDS).toContain('push')
  })
})
