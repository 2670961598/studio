/**
 * 组织纯投影 · 公共类型（MIG-05 / IMPL-05-03，LANE-O）
 *
 * 依据：docs/v2/06 §五（公司层级与组织面在包内的表达：5.1 拟任≠事实、5.2 CL 主张/
 * 一级单元 N、5.3 空编与保留权力、5.4 CL2 单人退化）、docs/v2/03 §2.2/§2.3/§2.4（表 A /
 * 表 A′ / CL 判据）、§3.5（老板缺席：内核冻结·运行延续）、§六（D 族）、§八（强制失败出口）、
 * docs/v2/15 §一 SEC-FC-03、docs/plan/05 IMPL-05-03/05-07、docs/v2/16 company 行
 * （「纯投影 buildOrgTree 等下沉；org-config 只读兼容至 MIG-08 结束」）。
 *
 * 三条边界（本模块是纯投影，不是校验器、不是写入者）：
 *   1. **零 IO**：输入是**已解析**的 org-config/departments（内存对象），本模块不读文件、
 *      不访问网络、不写盘、不取时钟、不用随机数——同输入同输出（可复算）。
 *   2. **旧格式只读**：legacy org-config/departments 只作**只读投影**输入（到 MIG-08 结束）；
 *      本模块不产出写路径，也不把投影结果当权威（权威迁移见 §四.3：旧格式只读投影＋
 *      新格式权威）。
 *   3. **O3-01 三契约互斥**：同一组织对象在投影中**恰有一个权威面**（legacy-readonly 或
 *      definition）；同一对象出现两权威＝结构违规，拒（不静默择一、不合并）。三契约的
 *      投影侧命名见 OrganizationDeclarationSource；v1 的 76 DEF-ORG-01 / validator 部门
 *      形状 / 81-files/19 逐文件契约冲突，V2 以「旧格式只读投影 + 新格式权威」消解
 *      （docs/v2/17 O3-01 行；复验记录 docs/baselines/split-plan-company.md §三）。
 *
 * 不复制矩阵本体：表 A（必设矩阵）与表 A′（保留权力表）的唯一主表在 docs/v2/03 §2.2/§2.3；
 * 本模块只输出**判据输入**与**行号引用**（ReservedPowerRefsProjection），不内联归属表。
 *
 * 一级单元字段载形（GAP-V2-17）：`unitCount`/`units[]`（`unitId`/`domain`/`headRef`/
 * `vacancyState`）在 SCH-ORG-01 尚无字段级承载（docs/v2/10 §4.3、v2/17 §4.5）。本模块把
 * 该载形冻结在**投影输入边界**（ParsedUnit），不新增 YAML 键、不新增记录类；YAML/SCH 侧
 * 落位归 MIG-08 前的定义包修订（登记见 docs/baselines/split-plan-company.md §五）。
 */

// ───────────────────────── 权威面（O3-01） ─────────────────────────

/**
 * 组织对象权威面（O3-01）：投影输出中每个对象恰有一个。
 * legacy-readonly＝旧格式（org-config/departments）只读投影；definition＝新格式（定义包）
 * 权威。二者不是「优先级」关系——同一对象同时出现即拒（不得靠先后覆盖）。
 */
export type OrganizationAuthority = 'legacy-readonly' | 'definition'

/** 组织对象契约面（O3-01 三契约在投影侧的二分：旧格式契约 vs 定义包契约）。 */
export type OrganizationContract = 'legacy' | 'definition'

/**
 * 声明来源（三契约的投影侧命名；O3-01 复验的输入面）：
 *   - legacy-index：org-config.yaml 的 departments 索引（validator.ts 部门形状面）
 *   - legacy-file：departments/<部门>/config.yaml（81-files/19 逐文件契约面）
 *   - definition：定义包组织面（76 DEF-ORG-01 语义 schema 面）
 * 前两者同属 legacy 契约（互为镜像面，漂移即拒）；与 definition 同时出现＝两权威＝拒。
 */
export type OrganizationDeclarationSource = 'legacy-index' | 'legacy-file' | 'definition'

/** O3-01 复验记录（代码内单一记录；文档侧记录见 docs/baselines/split-plan-company.md §三）。 */
export const O3_01 = {
  id: 'O3-01',
  /** 一个对象一个权威面——不是「优先级」，是互斥 */
  rule: 'one-object-one-authority',
  /** V2 消解口径：旧格式只读投影 + 新格式权威（v2/06 §四.3） */
  resolution: 'legacy-readonly-projection+definition-authority',
  /** 冲突处置：拒（blocking），不静默择一、不回落、不合并 */
  onConflict: 'reject',
} as const

// ───────────────────────── 输入：已解析的 org-config / departments ─────────────────────────

/** 已解析 company 段（CL 字段只是主张，见 ParsedOrgConfig 头注）。 */
export interface ParsedCompany {
  name: string
  slug: string
  /**
   * CL 主张（2-9）。**只是主张**：CL 判据是结构事实（v2/03 §2.4；「只改 level 字段」无效），
   * 本投影不把它当结构事实、不据此升降层（NEG-ORG-06）。
   */
  level: number
  /** 等级分布声明（51 C-8 沿用为投影规则：与 people 实数对账归校验器，投影只透传）。 */
  level_distribution?: Readonly<Record<string, number>>
  charter_ref?: string
  mission?: string
}

/** 已解析部门条目（org-config departments 索引与部门 config.yaml 的公共形状）。 */
export interface ParsedDepartment {
  name: string
  path: string
  /** 主管工号；null/缺省=未声明（legacy 契约下不得静默，见 org-structure 空编面）。 */
  leader?: string | null
  /** 部门层级声明（透传，不参与 CL 判据）。 */
  level?: number
  /** 上级部门 path；null/缺省=根。 */
  parent?: string | null
  lanes?: readonly string[]
  functions?: readonly string[]
}

/** 已解析 departments/<部门>/config.yaml（legacy 逐文件契约面；镜像字段必须与索引一致）。 */
export interface ParsedDepartmentFile extends ParsedDepartment {
  reports_to?: string | null
  rules?: readonly string[]
  jobs?: readonly string[]
}

/** 已解析 people 索引条目（只取投影需要的派工索引键）。 */
export interface ParsedPerson {
  id: string
  name?: string
  login?: string
  level?: number
  dept?: string
  role?: string
  reports_to?: string | null
  status?: string
}

/** 单元空编态（GAP-V2-17 载形：`vacancyState`）。 */
export const UNIT_VACANCY_STATES = ['staffed', 'head-vacant'] as const
export type UnitVacancyState = (typeof UNIT_VACANCY_STATES)[number]

/**
 * 已解析一级单元声明（GAP-V2-17 投影载形）。
 * N≥1、默认 1；「三省」只是 N=3 的示例，代码不写死 3。
 */
export interface ParsedUnit {
  unitId: string
  /** 单元域划分（声明面；域重叠=结构违规 v2/03 §八）。 */
  domain?: readonly string[]
  /** 单元首长（G8 工号）；缺省=不单设（N=1 默认退化形态，非空编）。 */
  headRef?: string | null
  /** 空编态（记录事实的声明影子；'head-vacant' 必须有复审期限）。 */
  vacancyState?: UnitVacancyState
  /** 空编复审期限（ISO 8601；缺=登记不完整，不得静默）。 */
  reviewAt?: string | null
}

/** 空编对象族（v2/03 §2.2 注/§3.5：最高宰相缺位、单元缺位、部门首长缺位）。 */
export const VACANCY_KINDS = ['supreme-minister', 'unit-head', 'department-head'] as const
export type VacancyKind = (typeof VACANCY_KINDS)[number]

/** 已解析空编登记声明（记录事实的声明影子；空编=登记＋复审期限）。 */
export interface ParsedVacancy {
  /** 空编对象引用（最高宰相用 'supreme-minister'；单元用 unitId；部门用部门 path/工号位兼位）。 */
  ref: string
  kind: VacancyKind
  /** 复审期限（ISO 8601）；缺=空编静默，投影阻断。 */
  reviewAt?: string | null
  declaredAt?: string | null
}

/** 已解析 org-config.yaml（legacy 只读面；本函数不解析 YAML）。 */
export interface ParsedOrgConfig {
  company: ParsedCompany
  /** departments 索引（可缺省：只给 departmentFiles 时走逐文件契约面）。 */
  departments?: readonly ParsedDepartment[]
  people?: readonly ParsedPerson[]
  /** 一级单元声明（GAP-V2-17 投影载形；缺省=N=1 隐式单元）。 */
  units?: readonly ParsedUnit[]
  /** 空编登记声明（缺省=未登记，不发明）。 */
  vacancies?: readonly ParsedVacancy[]
}

/** 新权威切片（定义包组织面已解析件；本周期只用于 O3-01 互斥复验）。 */
export interface ParsedDefinitionSlice {
  departments?: readonly ParsedDepartment[]
  people?: readonly ParsedPerson[]
  units?: readonly ParsedUnit[]
  vacancies?: readonly ParsedVacancy[]
}

/** 纯投影输入：已解析对象，无 IO 句柄、无路径参数、无时钟。 */
export interface OrganizationProjectionInput {
  org: ParsedOrgConfig
  /** 已解析 departments/<部门>/config.yaml（legacy 逐文件面；缺省则只用索引面）。 */
  departmentFiles?: readonly ParsedDepartmentFile[]
  /** 新格式权威切片（定义包组织面）；不传=纯 legacy 只读投影。 */
  definition?: ParsedDefinitionSlice
}

// ───────────────────────── 输出：问题与树 ─────────────────────────

/** 投影问题（纯数据；blocking=true → 投影 status='blocked'）。 */
export interface ProjectionIssue {
  code: string
  /** 问题归属面：authority（O3-01/声明面）/ tree（父子结构）/ structure（单元/空编/判据）。 */
  area: 'authority' | 'tree' | 'structure'
  /** 对象引用（部门 path、unitId、工号、空编 ref；无对象时='(org)'）。 */
  ref: string
  detail: string
  /** true=拒（不产出可信投影）；false=明示性提示（不得据此放宽任何判定）。 */
  blocking: boolean
}

/** 投影部门节点（扁平节点表＋childPaths；无递归引用，输出可 JSON 序列化）。 */
export interface ProjectedDepartmentNode {
  path: string
  name: string
  parent: string | null
  /** 树深（根=0），由 parent 链计算；不取声明 level（不得以字段冒充结构）。 */
  depth: number
  childPaths: readonly string[]
  /** 对象权威面（O3-01：恰一个）。 */
  authority: OrganizationAuthority
  /** 对象契约面（legacy/definition，二选一）。 */
  contract: OrganizationContract
  /** 声明来源（legacy 索引/逐文件可同时存在——同契约镜像面，漂移即拒）。 */
  declaredBy: readonly OrganizationDeclarationSource[]
  /** 主管工号（声明面；null=未声明）。 */
  leaderRef: string | null
  /** 主管是否在 people 索引中（false=悬空，不静默）。 */
  leaderResolved: boolean
}

/** 组织树投影（deterministic：节点/根/前序均按 path 码点序，childPaths 同序）。 */
export interface OrgTreeProjection {
  /** 根节点 path（码点序）。 */
  roots: readonly string[]
  /** 前序 path 序列（根→子，码点序；无环，有则相关节点不入树并由 issue 阻断）。 */
  preorder: readonly string[]
  /** 节点表（按 path 码点序；只含结构有效的节点）。 */
  nodes: readonly ProjectedDepartmentNode[]
  /** 最大树深（空树=0）。 */
  maxDepth: number
}

/** O3-01 权威对账结果（同一对象不出现在两权威；冲突逐条列出）。 */
export interface AuthorityReconciliation {
  table: 'O3-01'
  rule: 'one-object-one-authority'
  resolution: 'legacy-readonly-projection+definition-authority'
  /**
   * 出现在 legacy 契约面的对象 id（码点序）：部门＝path；一级单元＝`unit:<unitId>`；
   * 空编＝`vacancy:<kind>:<ref>`（对象族前缀保证不同族不撞名）。
   */
  legacyObjects: readonly string[]
  /** 出现在 definition 契约面的对象 id（码点序；前缀同左）。 */
  definitionObjects: readonly string[]
  /** 同对象两权威的冲突 id（码点序；非空即 status='blocked'）。 */
  conflicts: readonly string[]
}

// ───────────────────────── 输出：结构面 ─────────────────────────

/** 单元首长的投影态：staffed（在编）/ vacant（空编，必有复审期限）/ default-single（N=1 不单设）。 */
export type UnitHeadState = 'staffed' | 'vacant' | 'default-single'

/** 投影后的一级单元。 */
export interface ProjectedUnit {
  unitId: string
  domain: readonly string[]
  headRef: string | null
  headState: UnitHeadState
  /** 空编复审期限（headState='vacant' 时必有；其余 null）。 */
  reviewAt: string | null
  authority: OrganizationAuthority
}

/** 一级单元 N 参数投影（N 不写死：默认 1；三省=N=3 仅示例）。 */
export interface FirstLevelUnitsProjection {
  /** N（未阻断时 ≥1；units:[] 显式空声明会阻断并保留 0 供判读）。 */
  count: number
  /** default-single=无声明（N=1 隐式单元）；declared=输入声明。 */
  source: 'default-single' | 'declared'
  units: readonly ProjectedUnit[]
}

/** 投影后的空编条目（declared=输入登记；derived=结构推导，如单元缺首长）。 */
export interface ProjectedVacancy {
  kind: VacancyKind
  ref: string
  reviewAt: string | null
  origin: 'declared' | 'derived'
  authority: OrganizationAuthority
}

/** 结构事实（CL 判据输入与消费面共用的原始计数；不含裁决）。 */
export interface StructureFacts {
  departments: { total: number; roots: number; maxDepth: number }
  people: { total: number; active: number }
  leaders: { declared: number; resolved: number; unresolved: number }
  units: { declared: number; count: number; withHead: number; vacant: number; defaultSingle: number }
  audit: { declaredPositions: number }
  vacancies: { total: number; declared: number; derived: number }
}

/**
 * 单层 CL 判据输入（v2/03 §2.4 逐层累进）。
 *   - present：本输入能提供的判据证据名（输入项，不是裁决）
 *   - missing：本输入缺的判据证据名（不猜不填）
 *   - satisfied：null=输入不足，不得以 company.level 代替；true 仅在三态证据齐全时由
 *     定义包/记录面判据求值器给出（本投影不越权裁决）
 */
export interface ClCriterionInput {
  cl: number
  /** 判据出处引用（唯一主表 v2/03 §2.4；不复制矩阵正文）。 */
  criterionRef: string
  present: readonly string[]
  missing: readonly string[]
  satisfied: boolean | null
}

/** CL 判据输入投影（NEG-ORG-06：level 字段只是主张，不参与结构事实/判据求值）。 */
export interface ClCriteriaProjection {
  levelClaim: number
  criteriaRef: 'v2/03 §2.4'
  criteria: readonly ClCriterionInput[]
  /** 结构面最高可判层；null=输入不足（不得回落到 levelClaim）。 */
  structuralLevel: number | null
  /** 主张状态：unverified=结构证据不足（本投影唯一取值；不得据此升/降层）。 */
  claimStatus: 'unverified'
  /** 显式断言：levelClaim 未被当作结构事实（NEG-ORG-06 机器可判）。 */
  claimUsedAsFact: false
}

/** 保留权力引用投影（只引用表 A′ 行号；不复制正文/归属，不另立副本）。 */
export interface ReservedPowerRefsProjection {
  /** 唯一主表引用（v2/03 §2.3 表 A′）。 */
  tableRef: 'v2/03 §2.3'
  /** 行号引用（1..12）；归属解析只在主表，投影不改写。 */
  rowRefs: readonly number[]
  /** 消费纪律：reference-only-no-copy（包内章程可引用、不得另立副本或改写归属）。 */
  rule: 'reference-only-no-copy'
}

/**
 * 老板缺席投影（NEG-ORG-07）：外部老板不是 CL 的一层，恒在组织树之外为根（v2/03 §2.1-3/
 * §3.5）。老板不可达且无有效代行＝**内核冻结·运行延续**，不得悬置（无主体悬置态不存在）。
 */
export interface BossAbsenceProjection {
  externalBoss: 'outside-tree-root'
  /** 依赖外部老板在场的硬核动作唯一主表引用（本投影不复制清单正文）。 */
  dependentHardCoreRef: 'v2/03 §3.5'
  dependentHardCoreCount: 4
  /** 不可达且无有效代行：内核冻结·运行延续（不是停摆、不是悬置）。 */
  whenUnavailable: 'freeze-kernel-run-continues'
  /** 悬置态禁止（NEG-ORG-07：不得出现无主体的悬置终态）。 */
  suspension: 'forbidden'
  /** 冻结须登记并触发复审，不得无限期。 */
  reviewRequired: true
  /** 代行者不得是最高宰相（它就是内部老板），也不得是本次被处置对象。 */
  proxyRule: { allowed: 'external-proxy'; forbidden: 'supreme-minister' }
}

/** 结构面输出（组织树之外的层级/空编/权力引用投影）。 */
export interface StructureProjection {
  units: FirstLevelUnitsProjection
  vacancies: readonly ProjectedVacancy[]
  facts: StructureFacts
  cl: ClCriteriaProjection
  reservedPowers: ReservedPowerRefsProjection
  bossAbsence: BossAbsenceProjection
}

/** 纯投影最终产物（status='blocked' 时消费方不得采信 tree/structure 的未阻断部分）。 */
export interface OrganizationProjection {
  status: 'ok' | 'blocked'
  authority: AuthorityReconciliation
  tree: OrgTreeProjection
  structure: StructureProjection
  issues: readonly ProjectionIssue[]
}
