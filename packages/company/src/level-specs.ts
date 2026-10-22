/**
 * 分级公司模板规格（DEV-14，docs/36-§4 M-A；逐级部门表=docs/33-§3 已批示范表）。
 *
 * 本文件是 company-{3..9}-level 七套模板的**单一事实源**：结构与人事骨架逐行转写 docs/33-§3
 * （studio-dev-29 plan §5 冻结稿随 DEV-14 复活）；gen-template.ts 渲染消费，模板产物手改会被
 * 再生成覆盖——改结构先改这里（文档先行，docs/33 与本表冲突时停手改文档）。
 *
 * 骨架口径（docs/33 §3 与 2 级模板双口径，plan §4 冻结）：
 *   - 每级只放「负责人 + 单岗 + 代表执行」的**骨架**（10-16 人）；编制区间（15-10000）作注释
 *     双口径呈现，填满编制归 company create 向导（docs/36-§4 M-B，范围外）；
 *   - 每个根部门挂 2 个定时岗（health-patrol-<部门> ＋ daily-report-<部门>，shape 沿 2 级模板——
 *     patrol 不声明 output：巡查工件不是工单，结构性零产出，studio-dev-127-A）；
 *   - accounts = 根部门负责人的 login（账号=等级锚点，docs/04-§二）；
 *   - level_distribution 从 people 表**派生**（不手维护——两口径永不漂移）；
 *   - 花名不在此表：命名器按模板种子确定性生成（namer.ts，种子=模板名，冻结）。
 *
 * 语义呈批项（plan R1-R6，随 DEV-14 交宰相，代码不先行）：子公司语义（L9）= 独立编制边界；
 * dept.level = 公司等级（沿活公司先例）；命名词池口味=附录 B 初稿。
 */

/** 单个骨架人事条目（花名由命名器按序补齐） */
export interface LevelPersonSpec {
  id: string
  role: string
  level: number
  dept: string // 部门 path（含嵌套 departments/<父>/departments/<子>）
  reportsTo: string | null
}

/** 单个部门条目 */
export interface LevelDeptSpec {
  name: string
  path: string
  parent: string | null // null=根部门
  leader: string // 工号（须在 people 表）
  lanes: string[]
  functions: string[]
  note?: string // 转写为部门 config 注释（如「内设组——组≠部门」）
}

/** 一级模板的结构规格 */
export interface LevelSpec {
  level: number
  form: string // docs/33 §3 形态名（小团队/团队/部门化/多团队/事业部/集团/控股）
  headcount: string // 编制区间（注释双口径）
  span: string // 跨度（注释双口径）
  note: string // 示范要点（注释）
  departments: LevelDeptSpec[]
  people: LevelPersonSpec[]
}

export const LEVEL_SPECS: LevelSpec[] = [
  {
    level: 3,
    form: '小团队',
    headcount: '15-25',
    span: '4-7',
    note: '研发部一部＋综合部（人事财务单岗＋情报单岗）——最小可运转闭环',
    departments: [
      { name: '研发部', path: 'departments/研发部', parent: null, leader: 'ENG-0', lanes: ['core', 'qa'], functions: ['交付', '策划', '质量'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '人事', '财务', '情报'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总经理（负责人）', level: 3, dept: 'departments/综合部', reportsTo: null },
      { id: 'HF-1', role: '人事财务（单岗）', level: 2, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'INT-1', role: '情报（单岗）', level: 2, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'ENG-0', role: '研发部长', level: 3, dept: 'departments/研发部', reportsTo: 'PRIME-0' },
      { id: 'PLN-1', role: '策划', level: 2, dept: 'departments/研发部', reportsTo: 'ENG-0' },
      { id: 'ENG-1', role: '程序工程师', level: 1, dept: 'departments/研发部', reportsTo: 'ENG-0' },
      { id: 'QA-1', role: '质量工程师', level: 2, dept: 'departments/研发部', reportsTo: 'ENG-0' },
    ],
  },
  {
    level: 4,
    form: '团队',
    headcount: '40-80',
    span: '5-8',
    note: '研发部内设策划/程序/QA 组（组≠部门）＋人事/财务/情报三单岗',
    departments: [
      { name: '研发部', path: 'departments/研发部', parent: null, leader: 'ENG-0', lanes: ['core', 'qa'], functions: ['交付', '策划', '质量'], note: '内设策划组/程序组/QA 组——组≠部门（不进部门树，人档案归属即组）' },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '人事', '财务', '情报'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总经理', level: 4, dept: 'departments/综合部', reportsTo: null },
      { id: 'HR-1', role: '人事（单岗）', level: 2, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'FIN-1', role: '财务（单岗）', level: 2, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'INT-1', role: '情报（单岗）', level: 2, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'ENG-0', role: '研发部长', level: 4, dept: 'departments/研发部', reportsTo: 'PRIME-0' },
      { id: 'PLN-1', role: '策划组长', level: 3, dept: 'departments/研发部', reportsTo: 'ENG-0' },
      { id: 'ENG-1', role: '程序组长', level: 3, dept: 'departments/研发部', reportsTo: 'ENG-0' },
      { id: 'ENG-2', role: '程序工程师', level: 2, dept: 'departments/研发部', reportsTo: 'ENG-1' },
      { id: 'QA-1', role: '质量组长', level: 3, dept: 'departments/研发部', reportsTo: 'ENG-0' },
      { id: 'QA-2', role: '质量工程师', level: 2, dept: 'departments/研发部', reportsTo: 'QA-1' },
    ],
  },
  {
    level: 5,
    form: '部门化',
    headcount: '100-250',
    span: '5-8',
    note: '工程/质量/产品策划/人事/财务五职能部＋综合部（对外与战略情报单岗）',
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'ENG-0', lanes: ['core'], functions: ['交付'] },
      { name: '质量部', path: 'departments/质量部', parent: null, leader: 'QA-0', lanes: ['qa'], functions: ['质量'] },
      { name: '产品策划部', path: 'departments/产品策划部', parent: null, leader: 'PLN-0', lanes: ['core'], functions: ['策划'] },
      { name: '人事部', path: 'departments/人事部', parent: null, leader: 'HR-0', lanes: ['ops'], functions: ['人事'] },
      { name: '财务部', path: 'departments/财务部', parent: null, leader: 'FIN-0', lanes: ['ops'], functions: ['财务'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '对外', '情报'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总经理', level: 5, dept: 'departments/综合部', reportsTo: null },
      { id: 'EXT-1', role: '对外（单岗）', level: 3, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'INT-1', role: '战略情报（单岗）', level: 3, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'ENG-0', role: '工程部长', level: 4, dept: 'departments/工程部', reportsTo: 'PRIME-0' },
      { id: 'ENG-1', role: '工程师', level: 3, dept: 'departments/工程部', reportsTo: 'ENG-0' },
      { id: 'QA-0', role: '质量部长', level: 4, dept: 'departments/质量部', reportsTo: 'PRIME-0' },
      { id: 'QA-1', role: '质量工程师', level: 3, dept: 'departments/质量部', reportsTo: 'QA-0' },
      { id: 'PLN-0', role: '产品策划部长', level: 4, dept: 'departments/产品策划部', reportsTo: 'PRIME-0' },
      { id: 'PLN-1', role: '策划', level: 3, dept: 'departments/产品策划部', reportsTo: 'PLN-0' },
      { id: 'HR-0', role: '人事部长', level: 4, dept: 'departments/人事部', reportsTo: 'PRIME-0' },
      { id: 'HR-1', role: '人事专员', level: 2, dept: 'departments/人事部', reportsTo: 'HR-0' },
      { id: 'FIN-0', role: '财务部长', level: 4, dept: 'departments/财务部', reportsTo: 'PRIME-0' },
      { id: 'FIN-1', role: '财务专员', level: 2, dept: 'departments/财务部', reportsTo: 'FIN-0' },
    ],
  },
  {
    level: 6,
    form: '多团队',
    headcount: '250-600',
    span: '6-9',
    note: '工程部内嵌项目群（物理嵌套——departments/工程部/departments/项目群A）＋审计合规/战略情报部',
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'ENG-0', lanes: ['core'], functions: ['交付'] },
      { name: '项目群A', path: 'departments/工程部/departments/项目群A', parent: 'departments/工程部', leader: 'ENG-1', lanes: ['core'], functions: ['交付'] },
      { name: '项目群B', path: 'departments/工程部/departments/项目群B', parent: 'departments/工程部', leader: 'ENG-3', lanes: ['core'], functions: ['交付'] },
      { name: '质量部', path: 'departments/质量部', parent: null, leader: 'QA-0', lanes: ['qa'], functions: ['质量'] },
      { name: '产品部', path: 'departments/产品部', parent: null, leader: 'PLN-0', lanes: ['core'], functions: ['策划'] },
      { name: '人事部', path: 'departments/人事部', parent: null, leader: 'HR-0', lanes: ['ops'], functions: ['人事'] },
      { name: '财务部', path: 'departments/财务部', parent: null, leader: 'FIN-0', lanes: ['ops'], functions: ['财务'] },
      { name: '审计合规部', path: 'departments/审计合规部', parent: null, leader: 'AUD-0', lanes: ['audit'], functions: ['审计'] },
      { name: '战略情报部', path: 'departments/战略情报部', parent: null, leader: 'INT-0', lanes: ['intel'], functions: ['情报'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '对外'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总经理', level: 6, dept: 'departments/综合部', reportsTo: null },
      { id: 'EXT-1', role: '对外（单岗）', level: 3, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'ENG-0', role: '工程部长', level: 5, dept: 'departments/工程部', reportsTo: 'PRIME-0' },
      { id: 'ENG-1', role: '项目群A 主管', level: 4, dept: 'departments/工程部/departments/项目群A', reportsTo: 'ENG-0' },
      { id: 'ENG-2', role: '程序工程师', level: 3, dept: 'departments/工程部/departments/项目群A', reportsTo: 'ENG-1' },
      { id: 'ENG-3', role: '项目群B 主管', level: 4, dept: 'departments/工程部/departments/项目群B', reportsTo: 'ENG-0' },
      { id: 'ENG-4', role: '程序工程师', level: 3, dept: 'departments/工程部/departments/项目群B', reportsTo: 'ENG-3' },
      { id: 'QA-0', role: '质量部长', level: 5, dept: 'departments/质量部', reportsTo: 'PRIME-0' },
      { id: 'PLN-0', role: '产品部长', level: 5, dept: 'departments/产品部', reportsTo: 'PRIME-0' },
      { id: 'HR-0', role: '人事部长', level: 5, dept: 'departments/人事部', reportsTo: 'PRIME-0' },
      { id: 'HR-1', role: '招聘专员', level: 3, dept: 'departments/人事部', reportsTo: 'HR-0' },
      { id: 'FIN-0', role: '财务部长', level: 5, dept: 'departments/财务部', reportsTo: 'PRIME-0' },
      { id: 'FIN-1', role: 'FP&A 专员', level: 3, dept: 'departments/财务部', reportsTo: 'FIN-0' },
      { id: 'AUD-0', role: '审计合规部长', level: 5, dept: 'departments/审计合规部', reportsTo: 'PRIME-0' },
      { id: 'INT-0', role: '战略情报部长', level: 5, dept: 'departments/战略情报部', reportsTo: 'PRIME-0' },
    ],
  },
  {
    level: 7,
    form: '事业部',
    headcount: '600-1500',
    span: '7-10',
    note: '事业部内嵌研发/质量闭环（A 双嵌、B 单嵌）＋集团职能（人事/财务/审计/战略/平台工程）',
    departments: [
      { name: '事业部A', path: 'departments/事业部A', parent: null, leader: 'BU-1', lanes: ['core'], functions: ['经营'] },
      { name: '研发部', path: 'departments/事业部A/departments/研发部', parent: 'departments/事业部A', leader: 'ENG-1', lanes: ['core'], functions: ['交付'] },
      { name: '质量部', path: 'departments/事业部A/departments/质量部', parent: 'departments/事业部A', leader: 'QA-1', lanes: ['qa'], functions: ['质量'] },
      { name: '事业部B', path: 'departments/事业部B', parent: null, leader: 'BU-2', lanes: ['core'], functions: ['经营'] },
      { name: '研发部', path: 'departments/事业部B/departments/研发部', parent: 'departments/事业部B', leader: 'ENG-3', lanes: ['core'], functions: ['交付'] },
      { name: '人事部', path: 'departments/人事部', parent: null, leader: 'HR-0', lanes: ['ops'], functions: ['人事'] },
      { name: '财务部', path: 'departments/财务部', parent: null, leader: 'FIN-0', lanes: ['ops'], functions: ['财务'] },
      { name: '审计合规部', path: 'departments/审计合规部', parent: null, leader: 'AUD-0', lanes: ['audit'], functions: ['审计'] },
      { name: '战略部', path: 'departments/战略部', parent: null, leader: 'INT-0', lanes: ['intel'], functions: ['战略'] },
      { name: '平台工程部', path: 'departments/平台工程部', parent: null, leader: 'PF-0', lanes: ['platform'], functions: ['平台工程'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '对外'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总裁', level: 7, dept: 'departments/综合部', reportsTo: null },
      { id: 'EXT-1', role: '对外（单岗）', level: 4, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'BU-1', role: '事业部A 总经理', level: 6, dept: 'departments/事业部A', reportsTo: 'PRIME-0' },
      { id: 'ENG-1', role: '研发部长（A）', level: 5, dept: 'departments/事业部A/departments/研发部', reportsTo: 'BU-1' },
      { id: 'ENG-2', role: '程序工程师', level: 4, dept: 'departments/事业部A/departments/研发部', reportsTo: 'ENG-1' },
      { id: 'QA-1', role: '质量部长（A）', level: 5, dept: 'departments/事业部A/departments/质量部', reportsTo: 'BU-1' },
      { id: 'BU-2', role: '事业部B 总经理', level: 6, dept: 'departments/事业部B', reportsTo: 'PRIME-0' },
      { id: 'ENG-3', role: '研发部长（B）', level: 5, dept: 'departments/事业部B/departments/研发部', reportsTo: 'BU-2' },
      { id: 'HR-0', role: '人事部长', level: 6, dept: 'departments/人事部', reportsTo: 'PRIME-0' },
      { id: 'FIN-0', role: '财务部长', level: 6, dept: 'departments/财务部', reportsTo: 'PRIME-0' },
      { id: 'AUD-0', role: '审计合规部长', level: 6, dept: 'departments/审计合规部', reportsTo: 'PRIME-0' },
      { id: 'INT-0', role: '战略部长', level: 6, dept: 'departments/战略部', reportsTo: 'PRIME-0' },
      { id: 'PF-0', role: '平台工程部长', level: 6, dept: 'departments/平台工程部', reportsTo: 'PRIME-0' },
    ],
  },
  {
    level: 8,
    form: '集团',
    headcount: '1500-4000',
    span: '8-10',
    note: '多事业部（A 内嵌研发/质量闭环）＋职能层级化＋共享服务平台（三脚架示范）',
    departments: [
      { name: '事业部A', path: 'departments/事业部A', parent: null, leader: 'BU-1', lanes: ['core'], functions: ['经营'] },
      { name: '研发部', path: 'departments/事业部A/departments/研发部', parent: 'departments/事业部A', leader: 'ENG-1', lanes: ['core'], functions: ['交付'] },
      { name: '质量部', path: 'departments/事业部A/departments/质量部', parent: 'departments/事业部A', leader: 'QA-1', lanes: ['qa'], functions: ['质量'] },
      { name: '事业部B', path: 'departments/事业部B', parent: null, leader: 'BU-2', lanes: ['core'], functions: ['经营'] },
      { name: '事业部C', path: 'departments/事业部C', parent: null, leader: 'BU-3', lanes: ['core'], functions: ['经营'] },
      { name: '人事部', path: 'departments/人事部', parent: null, leader: 'HR-0', lanes: ['ops'], functions: ['人事'] },
      { name: '财务部', path: 'departments/财务部', parent: null, leader: 'FIN-0', lanes: ['ops'], functions: ['财务'] },
      { name: '审计合规部', path: 'departments/审计合规部', parent: null, leader: 'AUD-0', lanes: ['audit'], functions: ['审计'] },
      { name: '战略部', path: 'departments/战略部', parent: null, leader: 'INT-0', lanes: ['intel'], functions: ['战略'] },
      { name: '平台工程部', path: 'departments/平台工程部', parent: null, leader: 'PF-0', lanes: ['platform'], functions: ['平台工程'] },
      { name: '共享服务平台部', path: 'departments/共享服务平台部', parent: null, leader: 'SSC-0', lanes: ['ops'], functions: ['共享服务'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '对外'] },
    ],
    people: [
      { id: 'PRIME-0', role: '总裁', level: 8, dept: 'departments/综合部', reportsTo: null },
      { id: 'EXT-1', role: '对外（单岗）', level: 5, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'BU-1', role: '事业部A 总经理', level: 7, dept: 'departments/事业部A', reportsTo: 'PRIME-0' },
      { id: 'ENG-1', role: '研发部长（A）', level: 6, dept: 'departments/事业部A/departments/研发部', reportsTo: 'BU-1' },
      { id: 'QA-1', role: '质量部长（A）', level: 6, dept: 'departments/事业部A/departments/质量部', reportsTo: 'BU-1' },
      { id: 'BU-2', role: '事业部B 总经理', level: 7, dept: 'departments/事业部B', reportsTo: 'PRIME-0' },
      { id: 'BU-3', role: '事业部C 总经理', level: 7, dept: 'departments/事业部C', reportsTo: 'PRIME-0' },
      { id: 'HR-0', role: '人事总监', level: 7, dept: 'departments/人事部', reportsTo: 'PRIME-0' },
      { id: 'FIN-0', role: '财务总监', level: 7, dept: 'departments/财务部', reportsTo: 'PRIME-0' },
      { id: 'AUD-0', role: '审计合规总监', level: 7, dept: 'departments/审计合规部', reportsTo: 'PRIME-0' },
      { id: 'INT-0', role: '战略总监', level: 7, dept: 'departments/战略部', reportsTo: 'PRIME-0' },
      { id: 'PF-0', role: '平台工程总监', level: 7, dept: 'departments/平台工程部', reportsTo: 'PRIME-0' },
      { id: 'SSC-0', role: '共享服务平台部长', level: 6, dept: 'departments/共享服务平台部', reportsTo: 'PRIME-0' },
      { id: 'SSC-1', role: '财务共享专员', level: 5, dept: 'departments/共享服务平台部', reportsTo: 'SSC-0' },
      { id: 'SSC-2', role: '人事共享专员', level: 5, dept: 'departments/共享服务平台部', reportsTo: 'SSC-0' },
      { id: 'SSC-3', role: '计算平台工程师', level: 5, dept: 'departments/共享服务平台部', reportsTo: 'SSC-0' },
    ],
  },
  {
    level: 9,
    form: '控股',
    headcount: '3000-10000',
    span: '8-12',
    note: '子公司群＋控股职能（战略/资本/审计/法务）——子公司语义=独立编制边界（R1 呈批项随单）',
    departments: [
      { name: '战略部', path: 'departments/战略部', parent: null, leader: 'INT-0', lanes: ['intel'], functions: ['战略'] },
      { name: '资本部', path: 'departments/资本部', parent: null, leader: 'CAP-0', lanes: ['capital'], functions: ['资本'] },
      { name: '审计部', path: 'departments/审计部', parent: null, leader: 'AUD-0', lanes: ['audit'], functions: ['审计'] },
      { name: '法务部', path: 'departments/法务部', parent: null, leader: 'LAW-0', lanes: ['law'], functions: ['法务'] },
      { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PRIME-0', lanes: ['ops'], functions: ['管理', '对外', '人事', '财务'] },
      { name: '子公司A', path: 'departments/子公司A', parent: null, leader: 'SUB-1', lanes: ['core'], functions: ['经营'] },
      { name: '子公司B', path: 'departments/子公司B', parent: null, leader: 'SUB-2', lanes: ['core'], functions: ['经营'] },
      { name: '子公司C', path: 'departments/子公司C', parent: null, leader: 'SUB-3', lanes: ['core'], functions: ['经营'] },
    ],
    people: [
      { id: 'PRIME-0', role: '董事长', level: 9, dept: 'departments/综合部', reportsTo: null },
      { id: 'INT-0', role: '首席战略', level: 8, dept: 'departments/战略部', reportsTo: 'PRIME-0' },
      { id: 'CAP-0', role: '资本部长', level: 8, dept: 'departments/资本部', reportsTo: 'PRIME-0' },
      { id: 'AUD-0', role: '审计部长', level: 8, dept: 'departments/审计部', reportsTo: 'PRIME-0' },
      { id: 'LAW-0', role: '法务部长', level: 8, dept: 'departments/法务部', reportsTo: 'PRIME-0' },
      { id: 'SUB-1', role: '子公司A 负责人', level: 7, dept: 'departments/子公司A', reportsTo: 'PRIME-0' },
      { id: 'SUB-2', role: '子公司B 负责人', level: 7, dept: 'departments/子公司B', reportsTo: 'PRIME-0' },
      { id: 'SUB-3', role: '子公司C 负责人', level: 7, dept: 'departments/子公司C', reportsTo: 'PRIME-0' },
      { id: 'EXT-1', role: '对外（单岗）', level: 6, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
      { id: 'HF-1', role: '人事财务（控股面单岗）', level: 6, dept: 'departments/综合部', reportsTo: 'PRIME-0' },
    ],
  },
]

/** 模板名（=命名器种子，冻结——改名=换花名序列，属口味变更） */
export function levelTemplateName(level: number): string {
  return `company-${level}-level`
}

/** 取某级规格（3-9；越界抛错——调用面只有生成器与测试） */
export function levelSpec(level: number): LevelSpec {
  const spec = LEVEL_SPECS.find((s) => s.level === level)
  if (spec === undefined) throw new Error(`level=${level} 不在分级模板域（3-9，docs/36-§4 M-A）`)
  return spec
}

/** 根部门（parent=null，按规格序）——定时岗与 accounts 的挂靠面 */
export function rootDepartments(spec: LevelSpec): LevelDeptSpec[] {
  return spec.departments.filter((d) => d.parent === null)
}

/**
 * 规格自洽断言（生成器装载期自检第一步，红即拒绝渲染——绝不产出校验不过的模板）：
 * leader 悬空 / people.dept 悬空 / parent 链断环 / 嵌套 path 与父前缀不符。
 */
export function assertLevelSpec(spec: LevelSpec): void {
  const ids = new Set(spec.people.map((p) => p.id))
  const paths = new Set(spec.departments.map((d) => d.path))
  for (const d of spec.departments) {
    if (!ids.has(d.leader)) throw new Error(`L${spec.level} 部门 ${d.path} 的 leader ${d.leader} 不在 people 表`)
    if (d.parent !== null && !paths.has(d.parent)) throw new Error(`L${spec.level} 部门 ${d.path} 的 parent ${d.parent} 不在部门表`)
    if (d.parent !== null && !d.path.startsWith(`${d.parent}/departments/`)) {
      throw new Error(`L${spec.level} 嵌套部门路径 ${d.path} 与父 ${d.parent} 前缀不符（物理嵌套约定）`)
    }
  }
  for (const p of spec.people) {
    if (!paths.has(p.dept)) throw new Error(`L${spec.level} 人员 ${p.id} 的 dept ${p.dept} 不在部门表`)
    if (p.reportsTo !== null && !ids.has(p.reportsTo)) throw new Error(`L${spec.level} 人员 ${p.id} 的 reports_to ${p.reportsTo} 不在 people 表`)
  }
  // 汇报链断环：沿 reports_to 走必须终于 null
  for (const p of spec.people) {
    const seen = new Set<string>()
    let cursor: string | null = p.id
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error(`L${spec.level} reports_to 链成环（涉 ${p.id}）`)
      seen.add(cursor)
      const next = spec.people.find((x) => x.id === cursor)
      if (next === undefined) throw new Error(`L${spec.level} reports_to 链悬空（涉 ${p.id}）`)
      cursor = next.reportsTo
    }
  }
}
