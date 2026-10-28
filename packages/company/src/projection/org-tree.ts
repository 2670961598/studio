/**
 * 组织纯投影 · 组织树（MIG-05 / IMPL-05-03；docs/v2/16 company 行「buildOrgTree 等下沉」）
 *
 * 输入：已解析 org-config / departments（内存对象），零 IO。
 * 输出：扁平节点表（path/depth/childPaths/权威面/主管解析态）＋roots＋preorder＋maxDepth。
 *
 * 纪律：
 *   - 树形只认 `parent` 链（结构事实），不认声明 `level`（「只改 level 字段」不得改结构）；
 *   - 悬空 parent / parent 环 / 重复声明→相关节点**不入树**并阻断（fail-closed：宁缺不伪造）；
 *   - 输出确定性：节点/根/子/前序一律按 path 码点序（不依赖 locale、不依赖声明顺序）；
 *   - O3-01：节点恰一个 authority/contract（见 authority.ts）；同对象两权威=阻断。
 */
import { reconcileDepartmentDeclarations, collectPersonIds } from './authority.ts'
import type { CanonicalDepartment } from './authority.ts'
import { compareText, ISSUE_CODES, projectionIssue, sortProjectionIssues } from './issues.ts'
import type {
  AuthorityReconciliation,
  OrgTreeProjection,
  OrganizationProjectionInput,
  ProjectedDepartmentNode,
  ProjectionIssue,
} from './types.ts'

/** 组织树投影结果（authority 同时供上层结构面复用）。 */
export interface OrgTreeBuild {
  tree: OrgTreeProjection
  authority: AuthorityReconciliation
  issues: readonly ProjectionIssue[]
}

/** org-config/departments 已解析件 → 组织树（纯函数，零 IO）。 */
export function buildOrgTree(input: OrganizationProjectionInput): OrgTreeBuild {
  const reconciled = reconcileDepartmentDeclarations(input)
  const issues: ProjectionIssue[] = [...reconciled.issues]
  const personIds = collectPersonIds(input)

  const byPath = new Map<string, CanonicalDepartment>()
  for (const node of reconciled.canonical) byPath.set(node.path, node)

  // —— parent 链：悬空/环 → 相关节点整体不入树（不产出伪造深度） ——
  const depthByPath = new Map<string, number>()
  const invalidPaths = new Set<string>()
  for (const node of reconciled.canonical) {
    if (depthByPath.has(node.path) || invalidPaths.has(node.path)) continue
    const chain: CanonicalDepartment[] = []
    const onChain = new Map<string, number>()
    let cursor: CanonicalDepartment | undefined = node
    let edges = 0
    let tailDepth = 0
    let failure: { kind: 'dangling'; parentPath: string } | { kind: 'cycle'; cyclePath: string } | null = null

    while (cursor !== undefined) {
      const cached = depthByPath.get(cursor.path)
      if (cached !== undefined) {
        tailDepth = cached
        break
      }
      if (onChain.has(cursor.path)) {
        failure = { kind: 'cycle', cyclePath: cursor.path }
        break
      }
      onChain.set(cursor.path, chain.length)
      chain.push(cursor)
      const parentPath = cursor.parent
      if (parentPath === null) break
      const parent = byPath.get(parentPath)
      if (parent === undefined) {
        failure = { kind: 'dangling', parentPath }
        break
      }
      cursor = parent
      edges += 1
    }

    if (failure !== null) {
      for (const member of chain) invalidPaths.add(member.path)
      if (failure.kind === 'dangling') {
        issues.push(
          projectionIssue(
            'tree',
            ISSUE_CODES.danglingParent,
            node.path,
            `部门 ${node.path} 的 parent=${failure.parentPath} 不在组织对象表（悬空父节点）——不伪造根/不跳级，投影拒绝`,
          ),
        )
      } else {
        issues.push(
          projectionIssue(
            'tree',
            ISSUE_CODES.parentCycle,
            node.path,
            `部门 ${node.path} 的 parent 链成环（回到 ${failure.cyclePath}）——树结构不可判，投影拒绝（不递归展开）`,
          ),
        )
      }
      continue
    }

    for (let i = chain.length - 1; i >= 0; i--) {
      const member = chain[i]
      if (member === undefined) continue
      const depth = tailDepth + edges - i
      depthByPath.set(member.path, depth < 0 ? 0 : depth)
    }
  }

  // —— 有效节点 → 子表/根表（码点序） ——
  const childrenByPath = new Map<string, string[]>()
  const roots: string[] = []
  for (const node of reconciled.canonical) {
    if (!depthByPath.has(node.path)) continue
    if (node.parent === null) {
      roots.push(node.path)
      continue
    }
    const siblings = childrenByPath.get(node.parent) ?? []
    siblings.push(node.path)
    childrenByPath.set(node.parent, siblings)
  }
  roots.sort(compareText)
  for (const [parentPath, siblings] of childrenByPath) {
    siblings.sort(compareText)
    childrenByPath.set(parentPath, siblings)
  }

  const nodes: ProjectedDepartmentNode[] = []
  let maxDepth = 0
  for (const node of reconciled.canonical) {
    const depth = depthByPath.get(node.path)
    if (depth === undefined) continue
    if (depth > maxDepth) maxDepth = depth
    nodes.push({
      path: node.path,
      name: node.name,
      parent: node.parent,
      depth,
      childPaths: childrenByPath.get(node.path) ?? [],
      authority: node.authority,
      contract: node.contract,
      declaredBy: node.declaredBy,
      leaderRef: node.leaderRef,
      leaderResolved: node.leaderRef !== null && personIds.has(node.leaderRef),
    })
  }
  nodes.sort((a, b) => compareText(a.path, b.path))

  return {
    tree: { roots, preorder: preorderOf(roots, childrenByPath), nodes, maxDepth },
    authority: reconciled.authority,
    issues: sortProjectionIssues(issues),
  }
}

/** 前序序列（迭代实现：深树不爆栈；子序=码点序）。 */
function preorderOf(roots: readonly string[], childrenByPath: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const order: string[] = []
  const stack: string[] = []
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i]
    if (root !== undefined) stack.push(root)
  }
  while (stack.length > 0) {
    const path = stack.pop()
    if (path === undefined) continue
    order.push(path)
    const children = childrenByPath.get(path) ?? []
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child !== undefined) stack.push(child)
    }
  }
  return order
}
