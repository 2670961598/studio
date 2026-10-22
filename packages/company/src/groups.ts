/**
 * groups —— org-config 组群声明段（130-P3 频道供给扩展，130 提案 §6.7.1/C4）。
 *
 * 自 validator.ts 拆出（20-§十五.三.3 尺寸门「先拆再增」，同 state-hygiene.ts 先例）：
 * 结构闸（OrgGroupSchema）/内容引用闸（groupCrossRules）/快照装载（toGroups）三位一体，
 * validator 经同源 import 消费——逐字搬迁零行为漂移。
 *
 * 注：SLUG_RE 经 validator.ts 循环 import——仅用于 refine 回调（惰性求值面），模块顶层
 * 零消费，环安全（与 multifile.ts type-only 环同款纪律）。
 */
import type { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { DirectoryIssue, OrgGroupDecl } from '@studio-next/contract'
import type { OrgConfig } from './validator.ts'
import { SLUG_RE } from './validator.ts'
import { lineOfPath } from './multifile.ts'

/** org-config 文件名（DirectoryIssue 指认面——与 validator.ts 同一事实） */
const ORG_CONFIG_FILE = 'org-config.yaml'

/**
 * 组群声明条目（org-config `groups:`）：members 工号显式清单（审计面——不按 role
 * 模糊匹配）；dept/leader/members 的引用完整性在 crossRules（悬空双检同款）。
 * id 语法闸=SLUG_RE 单表（频道别名段 `#<slug>-<部门slug>-<组id>` 的安全平面）。
 */
export const OrgGroupSchema = z.strictObject({
  id: z.string().min(1).refine((s) => SLUG_RE.test(s), {
    message: '组 id 须形如 pln（小写字母/数字/连字符——频道别名段语法闸，与公司 slug 同表）',
  }),
  dept: z.string().min(1),
  name: z.string().min(1),
  leader: z.string().min(1).optional(),
  members: z.array(z.string().min(1)).min(1),
})

/**
 * 组群声明引用完整性（130-P3，130 提案 §6.7.1/C4）：dept 在册/工号在册/组长∈成员/
 * (dept,id) 唯一——结构形状在 OrgGroupSchema，内容引用在此逐条指认到行。
 */
export function groupCrossRules(doc: ReturnType<typeof parseDocument>, lc: LineCounter, org: OrgConfig, deptPaths: Set<string>, peopleIds: Set<string>): DirectoryIssue[] {
  const out: DirectoryIssue[] = []
  if (org.groups === undefined) return out
  const groupKeys = new Set<string>()
  org.groups.forEach((g, i) => {
    if (!deptPaths.has(g.dept)) {
      out.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(doc, lc, ['groups', i, 'dept']),
        rule: 'org-config/dangling-ref',
        fix: `组 ${g.id} 的 dept ${g.dept} 不在 departments 索引中（悬空引用双检）`,
      })
    }
    const key = `${g.dept}#${g.id}`
    if (groupKeys.has(key)) {
      out.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(doc, lc, ['groups', i, 'id']),
        rule: 'org-config/group-duplicate-id',
        fix: `组 id ${g.id} 在 ${g.dept} 内重复（频道别名 #<slug>-<部门slug>-<组id> 须唯一）`,
      })
    }
    groupKeys.add(key)
    g.members.forEach((m, j) => {
      if (!peopleIds.has(m)) {
        out.push({
          file: ORG_CONFIG_FILE,
          line: lineOfPath(doc, lc, ['groups', i, 'members', j]),
          rule: 'org-config/dangling-ref',
          fix: `组 ${g.id} 的成员 ${m} 不在 people 索引中（悬空引用双检）`,
        })
      }
    })
    if (g.leader !== undefined && !g.members.includes(g.leader)) {
      out.push({
        file: ORG_CONFIG_FILE,
        line: lineOfPath(doc, lc, ['groups', i, 'leader']),
        rule: 'org-config/group-leader-not-member',
        fix: `组 ${g.id} 的组长 ${g.leader} 不在成员清单内（组长须进群——130 §6.7.1 小组频道成员列）`,
      })
    }
  })
  return out
}

/**
 * 组群声明装载（130-P3，130 提案 §6.7.1/C4）：org-config groups 段 → snapshot.groups
 *（供给器展开为小组频道；leader 可选键不落显式 undefined——同 status/role 扩法）。
 */
export function toGroups(groups: NonNullable<OrgConfig['groups']>): OrgGroupDecl[] {
  return groups.map((g) => ({
    id: g.id,
    dept: g.dept,
    name: g.name,
    ...(g.leader !== undefined ? { leader: g.leader } : {}),
    members: g.members,
  }))
}
