/**
 * 分级公司模板生成器 V2（GAP-V2-18；DEV-14 复活＋MIG-05 迁移面收口）。
 *
 * 职责单一：level-specs（V2 结构单一事实源）+ namer（确定性花名）+ 2 级模板共享资产 →
 * 渲染整套模板文件（内存 Record）→ **生成后自检**（loadCompanyDirectory 全目录校验 + init
 * 占位恰好一次断言）→ 落盘。自检红即拒绝产出——绝不把校验不过的模板写进仓。
 *
 * V2 口径（docs/v2/03 §2.2/§6.2、docs/v2/06 §5.1/§六、docs/v2/10 §4.3、docs/v2/17 §4.5）：
 *   - 部门 D 级=负责人 Gn（v2/03 §6.2 表 E），不再写「dept.level=公司等级」的 v1 结构；
 *   - 最高宰相 G9 在各级模板均为拟任（表 A）；CL4+ 由 audit-cycle-<部门> 承载部门审计制度；
 *   - 一级单元 N 以 `unitCount`/`units[]` **字段级承载**（GAP-V2-17；示例不是规范）；
 *   - schema 字面量沿仓内 V2 模板（`studio-next/org@1`，迁移期绑定标识——v2/10 §3.3）。
 *
 * 确定性：结构有序遍历 + 花名种子冻结（=模板名）——再生成字节零 diff（dedicated test）。
 * init 可消费：七处占位恰好一次（slug/name/README 标题/template 行/created_at/
 * last_validated_at/last_validation——appendix C 不变式，自检断言）。
 *
 * CLI 薄壳：`studio-next gen-templates`（apps/daemon/src/cli/gen-templates.ts）。
 */

import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCompanyDirectory } from './validator.ts'
import { codenames } from './namer.ts'
import { LEVEL_SPECS, assertLevelSpec, levelSpec, levelTemplateName, rootDepartments } from './level-specs.ts'
import type { LevelDeptSpec, LevelPersonSpec, LevelSpec } from './level-specs.ts'

/** 2 级模板根（共享资产的单一事实源；与 init.ts defaultTemplateDir 同锚） */
export function baseTemplateDir(): string {
  return fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))
}

/** 渲染选项：baseTemplateDir 可注入（测试/隔离面）；缺省仓内 2 级模板 */
export interface RenderOptions {
  baseTemplateDir?: string
}

/** 工号前缀 → 技能本体（骨架示意；正式技能由公司落成后按档案补齐） */
const SKILLS_BY_PREFIX: Record<string, string[]> = {
  PRIME: ['管理'], ENG: ['typescript'], QA: ['测试'], PLN: ['策划'], HR: ['人事'],
  HF: ['人事', '财务'], FIN: ['财务'], INT: ['情报'], EXT: ['对外'], AUD: ['审计'],
  BU: ['经营'], SUB: ['经营'], PF: ['平台工程'], SSC: ['共享服务'], CAP: ['资本'], LAW: ['法务'],
}

function skillsFor(id: string): string[] {
  return SKILLS_BY_PREFIX[id.split('-')[0] ?? ''] ?? ['通用']
}

/** 花名序列：people 表按序取名（种子=模板名，冻结——改名即换全序列） */
function namesFor(spec: LevelSpec): string[] {
  return codenames(levelTemplateName(spec.level), spec.people.length)
}

function roleOf(spec: LevelSpec, id: string): string {
  return spec.people.find((p) => p.id === id)?.role ?? ''
}

function levelOf(spec: LevelSpec, id: string): number {
  return spec.people.find((p) => p.id === id)?.level ?? spec.level
}

/** 单元域说明（注释用；N=1 为根部门职能并集，N>1 为各单元域） */
function unitDomainNote(spec: LevelSpec): string {
  return spec.units.map((unit) => unit.domain.join('＋')).join('／')
}

/** CL 表 A 下限行（注释；唯一主表在 v2/03 §2.2，不复制矩阵本体） */
function tableALowerBounds(level: number): string[] {
  const lines: string[] = ['#   - 最高宰相 G9（拟任）', '#   - 一级单元 N≥1（默认 1）']
  if (level >= 3) lines.push('#   - 执行成员 G2-G1 正式任职（≥1 名）')
  if (level >= 4) lines.push('#   - 首个 D8 部门与 G8 部长在编（CL4 判据）')
  if (level >= 5) lines.push('#   - 中间层 G7 必设（CL5+）')
  if (level >= 6) lines.push('#   - 中间层 G6 必设（CL6+）', '#   - 第二个 D8 部门必设（CL6+）')
  if (level >= 7) lines.push('#   - 专职部门审计位置必设（CL7+）')
  if (level >= 4) lines.push('#   - 部门审计制度（周期记录；本骨架由 audit-cycle 定时岗承载）')
  if (level >= 8) lines.push('#   - G5-G3 层在编＋部门嵌套深度≥3（CL8+）')
  if (level >= 9) lines.push('#   - G2-G8 全链在编＋≥3 个 D8 部门（CL9）')
  return lines
}

/** org-config.yaml 渲染（键序沿 V2 模板；level_distribution 从 people 派生不手维护） */
function renderOrgConfig(spec: LevelSpec, names: string[]): string {
  const n = spec.level
  const dist = new Map<number, number>()
  for (const p of spec.people) dist.set(p.level, (dist.get(p.level) ?? 0) + 1)
  const roots = rootDepartments(spec)
  const L: string[] = []
  L.push(`# Studio Next · 公司组织配置（org-config.yaml）—— ${levelTemplateName(n)}（CL${n} ${spec.form}骨架）`)
  L.push(`#`)
  L.push(`# V2 依据（唯一主表，本文件不复制矩阵本体）：`)
  L.push(`#   - docs/v2/03 §2.2 表 A（CL2-CL9 必设矩阵）／§2.3 表 A′（保留权力：未设岗权力显式归老板）`)
  L.push(`#     ／§2.4（CL 判据=在编结构事实，「只改 level 字段」无效）／§6.2 表 E（部门 D 族：`)
  L.push(`#     Dn=负责人 Gn，D9 不启用；D3-D5 最低设立层 CL8，D6=CL6，D7=CL5，D8=CL4）／§7.2（组织变更）`)
  L.push(`#   - docs/v2/06 §5.1（拟任≠事实）／§5.2（CL 只是主张；包内不复制表 A 本体）／§六（模板=生成物源，`)
  L.push(`#     不是公司包本体；以模板初始化≠公司已设立）`)
  L.push(`#   - docs/v2/10 §4.3（SCH-ORG-01 字段表）／§3.3（schema 字面量=迁移期绑定标识，V2 替代为 schemaRef）`)
  L.push(`#`)
  L.push(`# 拟任声明（v2/06 §5.1）：本文件只登记**拟任**——最高宰相（G9）与各级人员皆为拟任安排；任命是否`)
  L.push(`# 生效、任职是否接受、谁实际在编，归记录（v2/11），不由本文件断言。设立=外部老板的设立记录＋`)
  L.push(`# root_delegation（v2/03 §3.1）；模板只产目录，不构成设立。`)
  L.push(`#`)
  L.push(`# CL 主张（v2/03 §2.4）：company.level=${n} 只是主张；判据=在编结构可满足的最高层判据。`)
  L.push(`# 本骨架声明 CL${n} ${spec.form}骨架；结构下限（表 A CL${n} 行）：`)
  L.push(...tableALowerBounds(n))
  L.push(`# 保留（可不设，缺位时权力按表 A′ 显式归老板；本文件不复制表 A′ 正文）：未列出的更高岗位。`)
  L.push(`#`)
  L.push(`# 一级单元 N（GAP-V2-17；v2/06 §5.2）：字段级承载已定形——\`unitCount\`（≥1，默认 1）＋`)
  L.push(`# \`units[]\`（unitId/domain/headRef/vacancyState/reviewAt；docs/v2/10 §4.3；vacancyState 值集 ENU-140）。`)
  L.push(`# 本模板结构示例 N（示例）= ${spec.units.length}（单元域=${unitDomainNote(spec)}）——**示例不是规范**：`)
  L.push(`# 「三省」N=3 只是示例；任何 N 由设立记录确认；增删单元=组织变更（v2/03 §7.2）。`)
  L.push(`#`)
  L.push(`# 部门结构（v2/03 §6.2 表 E）：本骨架部门等级 ${spec.departments.map((d) => `D${levelOf(spec, d.leader)}（${d.name}）`).join('、')}；`)
  L.push(`# D3-D5 最低设立层 CL8，本层不设；D9 不启用。`)
  L.push(`# 最高宰相为**公司层岗位**（不在部门硬核内）：people[].dept 仅作派工索引挂靠，不参与部门 Dn 判定。`)
  if (n >= 4) {
    L.push(`#`)
    L.push(`# 部门审计制度（CL4 起必设的周期记录）：由 audit-cycle-<部门> 定时岗按周期产出审计记录`)
    L.push(`# （本文件只声明拟任与定时岗；审计记录归台账 v2/11，审计者≠本次评价者——v2/03 §4.2/§4.3）。`)
  }
  L.push(`#`)
  L.push(`# 缺口登记 DEC-OPEN-16（软阻断，未裁）：解散/清算是否纳入公司硬核**未决**——本模板与`)
  L.push(`# charter.md **不写**解散/清算条款（不预设裁决结果）；裁决落卷后按批示流补条款并留痕。`)
  L.push(`#`)
  L.push(`# 字节惰性（v2/06 §2.2／v2/10 §4.8）：全模板除 plugins/ 下 DSH 插件（资产部专属资产位）外均为`)
  L.push(`# 纯配置/人读文本，不含脚本、宿主命令、自动执行钩子、本机路径或秘密值。`)
  L.push(``)
  L.push(`schema: studio-next/org@1 # 本文件的 schema 版本（须与 .studio-next.yaml 的 schema 一致）`)
  L.push(``)
  L.push(`company:`)
  L.push(`  name: 示例公司 # 公司名（init 替换占位）`)
  L.push(`  slug: example-corp # 目录 slug（init 替换占位）；概览路由 http://<host>:8789/<slug>/...`)
  L.push(`  mission: 用一条可验证的交付链，把需求变成有证据的产出 # 使命（L1）`)
  L.push(`  charter_ref: charter.md # 公司章程路径（相对公司目录根）`)
  L.push(`  level: ${n} # CL 主张（判据=结构事实，v2/03 §2.4；「只改 level 字段」无效）`)
  L.push(`  level_distribution: # 拟任人数按 G 档实数（与 people[].level 逐档相等——投影规则）`)
  for (const lv of [...dist.keys()].sort((a, b) => a - b)) {
    L.push(`    ${lv}: ${dist.get(lv)}`)
  }
  L.push(``)
  L.push(`# 部门索引：部门领导 = 该部门 config.yaml 的 leader；部门成员 = people/ 内档案`)
  L.push(`# dept.level = Dn（=负责人 Gn；v2/03 §6.2 表 E；D9 不启用）；嵌套深度看目录（${roots.length} 根部门）`)
  L.push(`departments:`)
  spec.departments.forEach((d) => {
    const note = d.note === undefined ? '' : `——${d.note}`
    L.push(`  - name: ${d.name}`)
    L.push(`    path: ${d.path} # 相对本目录根；即该部门的目录${note}`)
    L.push(`    leader: ${d.leader} # 主管工号（指向 people 索引与人事档案）`)
    L.push(`    level: ${levelOf(spec, d.leader)} # D${levelOf(spec, d.leader)}（=负责人 G${levelOf(spec, d.leader)} 拟任职级——v2/03 §6.2 表 E；D9 不启用）`)
    L.push(`    parent: ${d.parent === null ? 'null' : d.parent} # 上级部门 path；根部门为 null`)
    L.push(`    lanes: [${d.lanes.join(', ')}] # 泳道 = 资源标签 + 并行开发单元（锁粒度）`)
    L.push(`    functions: [${d.functions.join(', ')}] # 部门职能`)
    L.push(`    relations: [] # 跨部门关系：{to, type∈联签|下游交付|共享泳道, protocol}（C2-02）`)
  })
  L.push(``)
  L.push(`# 人员索引（只留派工索引；职责正文以人事档案为准）。name=花名（命名器确定性生成，种子冻结）`)
  L.push(`people:`)
  spec.people.forEach((p, i) => {
    const name = names[i]!
    L.push(`  - id: ${p.id}${i === 0 ? ' # 工号 = 文件名 = 永不变主键' : ''}`)
    L.push(`    name: ${name}`)
    L.push(`    login: ${p.id.toLowerCase()}${i === 0 ? ' # YouTrack 账号锚点（账号=等级锚点，工号=人）' : ''}`)
    L.push(`    level: ${p.level}`)
    L.push(`    dept: ${p.dept}`)
    L.push(`    role: ${p.role}${i === 0 ? ' # 岗位（岗位 → 模型档映射见框架级 models.yaml）' : ''}`)
    L.push(`    reports_to: ${p.reportsTo === null ? 'null' : p.reportsTo}${i === 0 ? ' # 汇报线（上级工号）' : ''}`)
    L.push(`    skills: [${skillsFor(p.id).join(', ')}]${i === 0 ? ' # 技能本体（内部工种映射表，不用自由文本）' : ''}`)
    L.push(`    status: active${i === 0 ? ' # active | paused | retired（只改状态不删号，历史不悬空）' : ''}`)
    L.push(`    executor: dsh${i === 0 ? ' # executor 偏好；缺省继承框架默认（docs/06-§三）' : ''}`)
    L.push(`    file: ${p.dept}/people/${p.id}.md${i === 0 ? ' # 人事档案路径（正文在此）' : ''}`)
  })
  L.push(``)
  L.push(`# 一级单元（GAP-V2-17 字段级承载；docs/v2/10 §4.3）——本模板示例不是规范：`)
  L.push(`# unitCount≥1（默认 1）；units[] 每项 unitId/domain/headRef/vacancyState/reviewAt。`)
  L.push(`unitCount: ${spec.units.length}`)
  L.push(`units:`)
  for (const unit of spec.units) {
    L.push(`  - unitId: ${unit.unitId}`)
    L.push(`    domain: [${unit.domain.join(', ')}]`)
    L.push(`    headRef: ${unit.headRef === null ? 'null' : unit.headRef}`)
    if (unit.vacancyState !== undefined) L.push(`    vacancyState: ${unit.vacancyState}`)
    if (unit.reviewAt !== undefined) L.push(`    reviewAt: ${unit.reviewAt}`)
  }
  L.push(``)
  L.push(`# 定时岗清单（定时岗通用模型）：每个根部门 2 岗——health-patrol-<部门>（巡查：结构性零产出，`)
  L.push(`# 不声明 output——127-A）＋ daily-report-<部门>（日报）；shape 沿 2 级模板。`)
  L.push(`jobs:`)
  let firstPatrol = true
  let firstReport = true
  for (const d of roots) {
    const role = roleOf(spec, d.leader)
    const level = levelOf(spec, d.leader)
    L.push(`  - id: health-patrol-${d.name}${firstPatrol ? ' # 巡查岗：5 分钟巡逻（巡检台账/在途/心跳，随事件留痕）' : ''}`)
    L.push(`    dept: ${d.path}`)
    L.push(`    cron: "*/5 * * * *" # 每 5 分钟（本地时区）`)
    L.push(`    role: ${role} # 岗位（随部门负责人拟任岗位）`)
    L.push(`    level: ${level} # 该岗等级（随部门负责人拟任职级）`)
    L.push(`    type: patrol${firstPatrol ? ' # patrol×output=结构性零产出，不声明 output（127-A）' : ''}`)
    L.push(`    model_tier: low`)
    L.push(`    budget_cap: 1 # USD/次`)
    firstPatrol = false
    L.push(`  - id: daily-report-${d.name}${firstReport ? ' # 日报岗：每日汇总叶子节点产出' : ''}`)
    L.push(`    dept: ${d.path} # 所属部门节点`)
    L.push(`    cron: "0 18 * * *" # 本地时区`)
    L.push(`    role: ${role} # 岗位（随部门负责人拟任岗位）`)
    L.push(`    level: ${level} # 该岗等级（随部门负责人拟任职级）`)
    L.push(`    type: report # 任务类型（report | audit | ...，自由扩展，框架不写死）`)
    L.push(`    model_tier: low # 模型档：high | mid | low`)
    L.push(`    budget_cap: 2 # 预算帽（USD/次；预留-结算，超额在调用前拒绝）`)
    L.push(`    output: reports/${d.name}/ # 产出落点（报表按 <date>-<type>-<节点>-<总结>.md 命名）`)
    firstReport = false
  }
  if (spec.auditCycle !== undefined) {
    const audit = spec.auditCycle
    const dept = spec.departments.find((d) => d.path === audit.dept)
    const deptName = dept?.name ?? audit.dept.split('/').pop() ?? audit.dept
    L.push(`  - id: audit-cycle-${deptName} # 部门审计制度（CL4 起必设的周期记录；审计者≠本次评价者——v2/03 §4.2/§4.3）`)
    L.push(`    dept: ${audit.dept}`)
    L.push(`    triggers:`)
    L.push(`      cadence: monthly`)
    L.push(`      at: "05:00"`)
    L.push(`    role: ${audit.role}`)
    L.push(`    level: ${audit.level}`)
    L.push(`    type: audit # 审计周期岗：周期记录入台账（记录面归 v2/11；岗位只声明拟任）`)
    L.push(`    model_tier: low`)
    L.push(`    budget_cap: 2 # 预算帽（USD/次；预留-结算）`)
    L.push(`    output: reports/${deptName}/ # 产出落点`)
  }
  L.push(``)
  L.push(`# YouTrack 账号锚点映射（账号=等级锚点，不随新增公司而新增账号）——根部门负责人`)
  L.push(`accounts:`)
  for (const d of roots) {
    L.push(`  - login: ${d.leader.toLowerCase()}`)
    L.push(`    level: ${levelOf(spec, d.leader)} # 账号锚定的等级（与人档案的工号解耦）`)
    L.push(`    note: ${d.name}负责人等级锚点（拟任岗位：${roleOf(spec, d.leader)}）`)
  }
  const prime = spec.people.find((p) => p.id === 'PRIME-0')
  if (prime !== undefined) {
    L.push(`  - login: prime-0 # 最高宰相账号锚点（G9 恒定——v2/03 表 A）`)
    L.push(`    level: ${prime.level} # 账号锚定的等级（与人档案的工号解耦）`)
    L.push(`    note: 最高宰相（内部老板；拟任）`)
  }
  L.push(``)
  return L.join('\n')
}

/** .studio-next.yaml 渲染（V2 定义描述段/挂载戳记拆分——v2/06 §4.4、v2/10 §4.7） */
function renderMeta(level: number): string {
  return `# Studio Next 挂载元信息（.studio-next.yaml）
#
# 定义描述段（schema/template）随公开定义传播；挂载戳记段（created_at/last_validated_at/
# last_validation/framework_version）属部署面状态，**传播前剥离**——v2/06 §4.4、v2/10 §4.7。
# 本波保留戳记占位以兼容 init 通道（init 负责写戳记；剥离与仓库规范收口归 v2/16）。
# 由框架维护：挂载时间与最近校验结果由 daemon 写入（挂单 commit 留痕），人工不要手改。
# schema 与 org-config.yaml 同源；schema 字面量为迁移期绑定标识（v2/10 §3.3），
# V2 正式替代为 SCH-PKG-01 的 schemaRef（v2/10 §4.1）。

schema: studio-next/org@1 # 公司目录 schema 版本（须与 org-config.yaml 的 schema 一致）
template: ${levelTemplateName(level)} # 生成本目录所用的模板名
created_at: null # 由 init 写入（ISO 8601 带时区偏移）
last_validated_at: null # 最近一次校验时间（ISO 8601）
last_validation: null # 最近一次校验结果：pass | fail（fail 时附错误清单）
framework_version: null # 写入时框架版本（供 migrate 判断是否需要迁移）
`
}

/** 部门 config.yaml 渲染（V2：部门等级=负责人职级；根部门 jobs 清单与 org-config 一致——C-5） */
function renderDeptConfig(spec: LevelSpec, dept: LevelDeptSpec): string {
  const L: string[] = []
  const level = levelOf(spec, dept.leader)
  L.push(`# ${dept.name} · 部门章程与规定`)
  L.push(`#`)
  L.push(`# 契约依据：docs/04-§二（部门领导配置 = 本文件；leader 指向工号）`)
  L.push(`# V2 依据：docs/v2/03 §6.2（Dn=负责人 Gn，D9 不启用；D3-D5 最低设立层 CL8）/§6.3（部门硬核`)
  L.push(`# 由部长上一层批准与保管，部长只改软外围）/§2.3 表 A′（未设岗权力显式归老板，不悬空）。`)
  L.push(`# 生成来源：${levelTemplateName(spec.level)}（CL${spec.level} ${spec.form}骨架；结构=负责人职级决定部门 D 级——v2/03 §6.2 表 E）`)
  if (dept.note !== undefined) L.push(`# ${dept.note}`)
  L.push(``)
  L.push(`name: ${dept.name}`)
  L.push(`path: ${dept.path}`)
  L.push(`level: ${level} # 部门等级 D${level}（=负责人 G${level} 拟任职级；v2/03 §6.2 表 E；D9 不启用）`)
  L.push(`parent: ${dept.parent === null ? 'null' : dept.parent} # 上级部门 path（根部门为 null）`)
  L.push(`leader: ${dept.leader} # 主管工号（指向 people/ 内人事档案）`)
  L.push(`functions: # 部门职能`)
  for (const f of dept.functions) L.push(`  - ${f}`)
  L.push(`lanes: # 泳道：资源标签 + 并行开发单元（一泳道一 worker 一分支）`)
  for (const l of dept.lanes) L.push(`  - ${l}`)
  L.push(`reports_to: ${dept.parent === null ? 'null' : dept.parent} # 汇报线：本部门向哪个节点汇报（根部门为 null）`)
  L.push(``)
  const hardCoreRule = dept.hardCoreRule === true
  L.push(hardCoreRule ? `# 部门规定（部门内部规则；不得与 charter.md 的红线冲突——部门硬核由上一层批准保管）` : `# 部门规定（部门内部规则；不得与 charter.md 的红线冲突）`)
  L.push(`rules:`)
  L.push(`  - 一切交付以落盘证据为准（REPORT + 闸门 exit=0）`)
  L.push(`  - 在途单一律挂泳道租约，忙则顺延不抢锁`)
  // 硬核变更权在上一层（v2/03 §6.3）；其余部门以跨部门协作规则收口
  L.push(hardCoreRule ? `  - 部门自改硬核（章程/预算上限/验收口径/部门审计）无效——v2/03 §6.3` : `  - 跨部门协作按 relations 走（relations 由公司落成后按需增补）`)
  L.push(``)
  L.push(`# 跨部门关系：{to, type∈联签|下游交付|共享泳道, protocol}`)
  L.push(`relations: []`)
  if (dept.parent === null) {
    L.push(``)
    L.push(`# 本部门名下的定时岗（清单与 org-config.yaml 的 jobs 段保持一致）`)
    L.push(`jobs:`)
    L.push(`  - health-patrol-${dept.name}`)
    L.push(`  - daily-report-${dept.name} # 日报岗：每日汇总叶子节点产出（定时岗通用模型的一个实例）`)
    if (spec.auditCycle !== undefined && spec.auditCycle.dept === dept.path) {
      L.push(`  - audit-cycle-${dept.name} # 周期审计岗（部门审计制度：CL4 起必设的周期记录）`)
    }
  }
  L.push(``)
  return L.join('\n')
}

/** 最高宰相档案（G9 恒定；V2 专项文本——拟任非事实、内外部老板边界，v2/03 §3.1） */
function renderPrimeFile(person: LevelPersonSpec, name: string): string {
  return `---
# 人事档案 front-matter（契约：docs/v2/06 §四.1（人员档案=提示词资产面）/§5.1（拟任≠事实））
id: ${person.id} # 工号 = 文件名 = 永不变主键
name: ${name} # 花名（命名器确定性生成，种子冻结） # 花名（命名器确定性生成，种子冻结）
login: ${person.id.toLowerCase()} # YouTrack 账号锚点（账号=等级锚点，工号=人）
level: 9 # G9：最高宰相（内部老板）——v2/03 表 A 恒必设
dept: ${person.dept}
role: 最高宰相 # 岗位（拟任；权源=外部老板 root_delegation——v2/03 §3.1）
reports_to: null # 汇报线：最高宰相无 agent 上级（任免只在外部老板——表 A′ 行 4）
skills: [管理] # 技能本体（内部工种映射表，不用自由文本）
side_effects: [写盘, 改单, 对外发言] # 副作用等级（写库/改单/对外发言），防派错工
executor: dsh # executor 偏好（缺省继承框架默认）
status: active # active | paused | retired
---

# ${person.id} · ${name} # 花名（命名器确定性生成，种子冻结）

> 本档案固定六节（定位 / 职责 / 做过的事 / 技能本体 / 表现画像 / 自述）。
> **机器只写 \`<!--AUTO-->\` 受管区块**，越界即测试红灯；其余各节由人事流程写。
> 拟任声明（v2/06 §5.1）：本档案是**拟任安排**，不是任命事实；任命生效、任职接受与在编归记录（v2/11）。

## 一、定位

最高宰相（G9，唯一，内部老板）：持外部老板 \`root_delegation\` 授予的 operating root key，以老板身份
签发内部硬动作；承载未下发权力（表 A′），对一级单元首长/部门首长任免。**不是**任何意义上的投影，
也**不是**对外单一受理口；不得对外承诺，不得自授（权源只来自外部 root_delegation——v2/03 §3.1）。

## 二、职责

- 公司硬核（制宪与修宪、公司级审计、G8 任免提议链、合并/分立决定）按表 A′ 行号行使，并留记录
- 公司级审计=内部老板自审，结论必标「内部老板自审」，不得自称独立（v2/03 §4.2）
- 保留权力（未设岗）按表 A′ 逐行显式承载，不悬空、不塞回可选容器（v2/03 §2.3）
- 子 agent 不得自授；对下授予是老板行为，受外部 root_delegation 范围约束（v2/03 §3.1）

## 三、做过的事（事实段 · 系统机械归集）

<!--AUTO-->
> 本区块由系统按约定生成，**勿手改**；内容随派工进展自动刷新。

| 单据 | 结果 | 工时 | 成本 | 证据 |
|---|---|---|---|---|
| （待回填：台账接入后由 work_records + sessions 机械归集） | | | | |

<!--/AUTO-->

## 四、技能本体

| 技能 | 等级 | 依据 |
|---|---|---|
| 管理 | 熟练 | 见技能本体映射表 |

## 五、表现画像（事实段 · 零自评）

- 一次通过率：待台账接入后生成
- 单件成本 / 耗时：待台账接入后生成
- 活跃曲线：待台账接入后生成

> 纪律：绩效只认已验证的交付证据；**严禁自评与互评打分**。

## 六、自述（本人写 · 每周）

> 干了什么 / 卡在哪 / 下一步该接什么。本段不参与派工匹配，也不计入绩效。

（待本人填写）
`
}

/** 人事档案渲染（V2 六节固定格式——v2/06 §四.1；multifile 弱匹配面） */
function renderPersonFile(person: LevelPersonSpec, name: string): string {
  if (person.id === 'PRIME-0') return renderPrimeFile(person, name)
  const skills = skillsFor(person.id)
  return `---
# 人事档案 front-matter（契约：docs/v2/06 §4.1（人员档案=提示词资产面）/§5.1（拟任≠事实）；
# 工号=文件名=永不变主键；六节固定格式见 v2/06 §四.1）
id: ${person.id} # 工号 = 文件名 = 永不变主键
name: ${name} # 花名（命名器确定性生成，种子冻结）
login: ${person.id.toLowerCase()} # YouTrack 账号锚点（账号=等级锚点，工号=人）
level: ${person.level}
dept: ${person.dept}
role: ${person.role}
reports_to: ${person.reportsTo === null ? 'null' : person.reportsTo} # 汇报线（上级工号）
skills: [${skills.join(', ')}] # 技能本体（内部工种映射，不用自由文本）
side_effects: [写盘] # 副作用等级（写库/改单/对外发言），防派错工
executor: dsh # executor 偏好（缺省继承框架默认）
status: active # active | paused | retired
---

# ${person.id} · ${name}

> 本档案固定六节（定位 / 职责 / 做过的事 / 技能本体 / 表现画像 / 自述）。
> **机器只写 \`<!--AUTO-->\` 受管区块**，越界即测试红灯；其余各节由人事流程（整理岗 + 本人）写。
> 事实段零 LLM 机械归集，数字必须可回溯台账行；自述段只本人写，不参与派工匹配与绩效。

## 一、定位

${person.role}：所在部门（${person.dept}）职能的骨架执行（拟任档案——正式定位由公司落成后按章程补齐；v2/06 §5.1 拟任≠事实）。

## 二、职责

- 所在部门职能的骨架执行（模板默认职责；正式职责由公司落成后按部门 config 补齐）
- 一切交付以落盘证据为准（REPORT + 闸门 exit=0）
- 泳道纪律：一泳道一 worker 一分支，不抢锁、不并线

## 三、做过的事（事实段 · 系统机械归集）

<!--AUTO-->
> 本区块由系统按约定生成，**勿手改**；内容随派工进展自动刷新。

| 单据 | 结果 | 工时 | 成本 | 证据 |
|---|---|---|---|---|
| （待回填：台账接入后由 work_records + sessions 机械归集） | | | | |

<!--/AUTO-->

## 四、技能本体

| 技能 | 等级 | 依据 |
|---|---|---|
| ${skills.join(' / ')} | 熟练 | 见技能本体映射表 |

## 五、表现画像（事实段 · 零自评）

- 一次通过率：待台账接入后生成
- 单件成本 / 耗时：待台账接入后生成
- 活跃曲线：待台账接入后生成

> 纪律：绩效只认已验证的交付证据；**严禁自评与互评打分**。

## 六、自述（本人写 · 每周）

> 干了什么 / 卡在哪 / 下一步该接什么。本段不参与派工匹配，也不计入绩效。

（待本人填写）
`
}

/** 断言子串恰好出现一次（init 占位不变式——appendix C；违例即渲染面 bug） */
function assertExactlyOnce(content: string | undefined, needle: string, label: string): void {
  const hits = content === undefined ? 0 : content.split(needle).length - 1
  if (hits !== 1) {
    throw new Error(`模板自检红：${label}「${needle}」应恰好 1 处，实得 ${hits} 处（init 通道 replaceOnce 会拒——修渲染器，不迁就模板）`)
  }
}

/**
 * 生成后自检（appendix A 验收④）：目录校验绿 + init 占位七处恰好一次 + 单元字段自洽。
 * 红即抛错——绝不产出 init/校验消费不了的模板。
 */
function selfCheck(files: Record<string, string>, spec: LevelSpec): void {
  const tpl = levelTemplateName(spec.level)
  assertExactlyOnce(files['org-config.yaml'], 'slug: example-corp', `${tpl} org-config`)
  assertExactlyOnce(files['org-config.yaml'], 'name: 示例公司', `${tpl} org-config`)
  assertExactlyOnce(files['README.md'], '# 示例公司（公司自述）', `${tpl} README`)
  const meta = files['.studio-next.yaml'] ?? ''
  if ((meta.match(/^(template: )/gm) ?? []).length !== 1) {
    throw new Error(`模板自检红：${tpl} .studio-next.yaml template: 行应恰好 1 行`)
  }
  assertExactlyOnce(files['.studio-next.yaml'], 'created_at: null', `${tpl} meta`)
  assertExactlyOnce(files['.studio-next.yaml'], 'last_validated_at: null', `${tpl} meta`)
  assertExactlyOnce(files['.studio-next.yaml'], 'last_validation: null', `${tpl} meta`)
  assertExactlyOnce(files['org-config.yaml'], `unitCount: ${spec.units.length}`, `${tpl} org-config unitCount`)
  for (const unit of spec.units) assertExactlyOnce(files['org-config.yaml'], `- unitId: ${unit.unitId}`, `${tpl} unit ${unit.unitId}`)
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) {
    const detail = mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')
    throw new Error(`模板自检红：${tpl} 未过目录校验（docs/04-§二 目录契约）：\n${detail}`)
  }
  if (mounted.snapshot.level !== spec.level) {
    throw new Error(`模板自检红：${tpl} 挂载等级回读不符：期望 ${spec.level}，实得 ${mounted.snapshot.level}`)
  }
}

/**
 * 渲染一整套分级模板（纯内存，不落盘——落盘走 writeLevelTemplate）。
 * 结构自洽断言先行（assertLevelSpec），自检（selfCheck）殿后。
 * async：共享资产（charter/README/prompts）直读 2 级模板（与之间同文——单一事实源不复制）。
 */
export async function renderLevelTemplate(level: number, opts?: RenderOptions): Promise<Record<string, string>> {
  const spec = levelSpec(level)
  assertLevelSpec(spec)
  const names = namesFor(spec)
  const base = path.resolve(opts?.baseTemplateDir ?? baseTemplateDir())
  const files: Record<string, string> = {}
  files['org-config.yaml'] = renderOrgConfig(spec, names)
  files['.studio-next.yaml'] = renderMeta(spec.level)
  for (const rel of ['charter.md', 'README.md', 'prompts/company.md']) {
    files[rel] = await readFile(path.join(base, rel), 'utf8')
  }
  files['docs/.gitkeep'] = ''
  files['reports/.gitkeep'] = ''
  for (const dept of spec.departments) {
    files[`${dept.path}/config.yaml`] = renderDeptConfig(spec, dept)
  }
  spec.people.forEach((p, i) => {
    files[`${p.dept}/people/${p.id}.md`] = renderPersonFile(p, names[i]!)
  })
  selfCheck(files, spec)
  return files
}

/** 落盘结果摘要（CLI/测试消费；fileCount=文件数） */
export interface WriteResult {
  level: number
  dir: string
  fileCount: number
  deptCount: number
  peopleCount: number
  jobCount: number
}

/**
 * 落盘一套模板（先清空目标目录再写——再生成对陈旧文件零残留，保证零 diff）。
 * 目标目录缺省仓根 templates/；写后逐文件自检已在 render 内完成（自检红即不落盘）。
 */
export async function writeLevelTemplate(level: number, outRoot: string, opts?: RenderOptions): Promise<WriteResult> {
  const spec = levelSpec(level)
  const files = await renderLevelTemplate(level, opts)
  const dir = path.join(path.resolve(outRoot), levelTemplateName(level))
  await rm(dir, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  return {
    level: spec.level,
    dir,
    fileCount: Object.keys(files).length,
    deptCount: spec.departments.length,
    peopleCount: spec.people.length,
    jobCount: rootDepartments(spec).length * 2 + (spec.auditCycle === undefined ? 0 : 1),
  }
}

/** 再生成全部分级模板（3-9；CLI `studio-next gen-templates` 的本体） */
export async function regenerateLevelTemplates(outRoot: string, opts?: RenderOptions): Promise<WriteResult[]> {
  const out: WriteResult[] = []
  for (const spec of LEVEL_SPECS) {
    out.push(await writeLevelTemplate(spec.level, outRoot, opts))
  }
  return out
}
