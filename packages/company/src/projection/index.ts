/**
 * 组织纯投影 · 出口（MIG-05 / IMPL-05-03，LANE-O）
 *
 * ── 一、org-config / departments 只读兼容声明（至 MIG-08） ─────────────────────────────
 * legacy `org-config.yaml` + `departments/<部门>/config.yaml` 是本包的**旧格式组织面**。
 * V2 口径（docs/v2/06 §四.3；docs/v2/16 company 行）：**旧格式只读投影 + 新格式权威**——
 * 旧格式在 MIG-08 结束前只作为**只读投影输入**保留；本模块不产生任何写路径，投影结果
 * 也不构成组织事实的权威（权威＝定义包 + 记录；见 docs/v2/06 §5.1「拟任≠事实」）。
 * 登记：docs/baselines/split-plan-company.md §四（MIG-08 出口前有效）。
 *
 * ── 二、零 IO 契约（机器可判） ───────────────────────────────────────────────────────
 * `src/projection/**` 不 import `node:*`/工作区包，不读写文件、不访问网络、不取时钟、
 * 不用随机数；输入是**已解析**对象。同输入同输出，输入不被改写。测试静态扫描＋冻结输入
 * 双跑在 `packages/company/test/v2/org-projection.test.ts`。
 *
 * ── 三、O3-01 三契约互斥复验 ────────────────────────────────────────────────────────
 * 同一组织对象在投影中恰有一个 authority/contract 面（legacy-readonly 或 definition）；
 * 同对象两权威＝阻断，不静默择一、不合并、不回落。三契约（76 DEF-ORG-01 / validator 部门
 * 形状 / 81-files/19 逐文件契约）的 V2 消解与复验记录：`docs/baselines/split-plan-company.md §三`
 * （docs/v2/17 O3-01 行「V2 已消解；随 MIG-05 复验」）。
 *
 * ── 四、GAP-V2-17（一级单元字段级承载）──────────────────────────────────────────────
 * `unitCount`/`units[]`（`unitId`/`domain`/`headRef`/`vacancyState`）在本模块的**投影输入
 * 边界**定形（ParsedUnit），不新增 YAML 键、不新增记录类；SCH-ORG-01 的字段级落位归
 * MIG-08 前的定义包修订（docs/v2/10 §4.3、docs/v2/17 §4.5；登记见 split-plan §五）。
 *
 * ── 五、出口面说明（诚实登记）──────────────────────────────────────────────────────
 * 本单领土不含 `packages/company/src/index.ts`，故投影暂以**相对路径**消费（同包内
 * `import … from './projection/index.ts'` / `../src/projection/index.ts`）；包根导出面
 * 收口归 MIG-08（缺口登记见 split-plan §六）。本轮不放宽任何对外 API。
 */
import { compareText, sortProjectionIssues } from './issues.ts'
import { buildOrgTree } from './org-tree.ts'
import { buildStructureProjection } from './org-structure.ts'
import type { StructureAuthority } from './org-structure.ts'
import type { AuthorityReconciliation, OrganizationProjection, OrganizationProjectionInput } from './types.ts'

export * from './types.ts'
export * from './issues.ts'
export * from './authority.ts'
export * from './org-tree.ts'
export * from './org-structure.ts'

/** 投影契约标识（消费方用于断言「这是纯投影产物，不是台账/权威快照」）。 */
export const ORG_PROJECTION_CONTRACT = {
  version: 'org-projection/v1',
  io: 'zero',
  authorityRule: 'one-object-one-authority',
  legacyCompatUntil: 'MIG-08',
} as const

/**
 * 组织纯投影总入口：树面 + 结构面（N/空编/CL 判据输入/保留权力引用/老板缺席策略）。
 * 纯函数、零 IO；`status='blocked'` 时消费方不得采信未阻断部分的判定。
 */
export function projectOrganization(input: OrganizationProjectionInput): OrganizationProjection {
  const treeBuild = buildOrgTree(input)
  const structureBuild = buildStructureProjection(input, treeBuild)
  const issues = sortProjectionIssues([...treeBuild.issues, ...structureBuild.issues])
  return {
    status: issues.some((issue) => issue.blocking) ? 'blocked' : 'ok',
    authority: mergeAuthorityFaces(treeBuild.authority, structureBuild.authority),
    tree: treeBuild.tree,
    structure: structureBuild.structure,
    issues,
  }
}

/** 部门面（树）＋单元/空编面（结构）的 O3-01 权威记录合并（排序去重，纯函数）。 */
function mergeAuthorityFaces(base: AuthorityReconciliation, extra: StructureAuthority): AuthorityReconciliation {
  const legacyObjects = [...base.legacyObjects, ...extra.legacyObjects].sort(compareText)
  const definitionObjects = [...base.definitionObjects, ...extra.definitionObjects].sort(compareText)
  const conflicts = [...base.conflicts, ...extra.conflicts].sort(compareText)
  return {
    table: 'O3-01',
    rule: base.rule,
    resolution: base.resolution,
    legacyObjects: [...new Set(legacyObjects)],
    definitionObjects: [...new Set(definitionObjects)],
    conflicts: [...new Set(conflicts)],
  }
}
