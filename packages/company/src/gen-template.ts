/**
 * 分级公司模板生成器（DEV-14，docs/36-§4 M-A：docs/33-§3 逐级部门表 → templates/company-{3..9}-level）。
 *
 * 职责单一：level-specs（结构单一事实源）+ namer（确定性花名）+ 2 级模板共享资产 →
 * 渲染整套模板文件（内存 Record）→ **生成后自检**（loadCompanyDirectory 全目录校验 + init
 * 占位恰好一次断言）→ 落盘。自检红即拒绝产出——绝不把校验不过的模板写进仓。
 *
 * 契约（studio-dev-29 plan §3-§5，随 DEV-14 复活；行号漂移以键名为锚）：
 *   - 文件集沿 2 级模板：org-config.yaml / charter.md / README.md / .studio-next.yaml /
 *     prompts/company.md / docs/.gitkeep / reports/.gitkeep / departments/**（config.yaml + people/）
 *     ——charter/README/prompts 与 2 级模板**同文**（渲染时直读，单一事实源不复制）；
 *   - 确定性：结构有序遍历 + 花名种子冻结（=模板名）——再生成字节零 diff（appendix A 验收②）；
 *   - init 可消费：七处占位恰好一次（slug/name/README 标题/template 行/created_at/
 *     last_validated_at/last_validation——appendix C 不变式，自检断言）；
 *   - 骨架最小面：workflows/hooks/yt 等可选段不随模板分发（daemon 缺省兜底：T:patrol
 *     未声明走 L0 delivered——engine 物化丁案；需要 v1.1 示例段时按 2 级模板增补）。
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

/** org-config.yaml 渲染（键序沿 2 级模板；level_distribution 从 people 派生不手维护） */
function renderOrgConfig(spec: LevelSpec, names: string[]): string {
  const n = spec.level
  const dist = new Map<number, number>()
  for (const p of spec.people) dist.set(p.level, (dist.get(p.level) ?? 0) + 1)
  const roots = rootDepartments(spec)
  const roleOf = (id: string): string => spec.people.find((p) => p.id === id)?.role ?? ''
  const L: string[] = []
  L.push(`# Studio Next · 公司组织配置（org-config.yaml）—— ${levelTemplateName(n)}（${spec.form}骨架）`)
  L.push(`#`)
  L.push(`# 逐级部门表依据：docs/33-§3（L${n} ${spec.form}）；生成器 packages/company/src/gen-template.ts`)
  L.push(`# （结构源=level-specs.ts，花名种子=${levelTemplateName(n)} 冻结——手改本文件会被再生成覆盖）`)
  L.push(`# 契约依据：docs/04-公司目录与等级体系.md §二；校验规则见 packages/company zod schema。`)
  L.push(`#`)
  L.push(`# 骨架口径（双口径）：编制目标 ${spec.headcount} 人、跨度 ${spec.span}——本模板只放 ${spec.people.length} 名`)
  L.push(`# 骨架（负责人＋单岗＋代表执行）；填满编制归 company create 向导（docs/36-§4 M-B）。`)
  L.push(`# 示范要点：${spec.note}`)
  L.push(``)
  L.push(`schema: studio-next/org@1 # 本文件的 schema 版本（须与 .studio-next.yaml 的 schema 一致）`)
  L.push(``)
  L.push(`company:`)
  L.push(`  name: 示例公司 # 公司名（init 替换占位）`)
  L.push(`  slug: example-corp # 目录 slug（init 替换占位）；概览路由 http://<host>:8789/<slug>/...`)
  L.push(`  mission: 用一条可验证的交付链，把需求变成有证据的产出 # 使命（L1）`)
  L.push(`  charter_ref: charter.md # 公司章程路径（相对公司目录根）`)
  L.push(`  level: ${n} # 公司等级 2-9（docs/33-§3 L${n} ${spec.form}）`)
  L.push(`  level_distribution: # 等级分布（骨架实数，与 people[].level 逐档相等；编制目标另见顶部双口径注记）`)
  for (const lv of [...dist.keys()].sort((a, b) => a - b)) {
    L.push(`    ${lv}: ${dist.get(lv)}`)
  }
  L.push(``)
  L.push(`# 部门索引：部门领导 = 该部门 config.yaml 的 leader；部门成员 = people/ 内档案`)
  L.push(`# dept.level = 公司等级（沿 2 级模板先例）；部门嵌套深度看目录（${roots.length} 根部门）`)
  L.push(`departments:`)
  spec.departments.forEach((d, i) => {
    L.push(`  - name: ${d.name}`)
    L.push(`    path: ${d.path} # 相对本目录根；即该部门的目录${d.note === undefined ? '' : `——${d.note}`}`)
    if (i === 0) L.push(`    leader: ${d.leader} # 主管工号（指向 people 索引与人事档案）`)
    else L.push(`    leader: ${d.leader}`)
    L.push(`    level: ${n}`)
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
  L.push(`# 定时岗清单（D9 通用模型）：每个根部门 2 岗——health-patrol-<部门>（巡查：结构性零产出，`)
  L.push(`# 不声明 output——127-A）＋ daily-report-<部门>（日报）；shape 沿 2 级模板。`)
  L.push(`jobs:`)
  let firstPatrol = true
  let firstReport = true
  for (const d of roots) {
    const role = roleOf(d.leader)
    L.push(`  - id: health-patrol-${d.name}${firstPatrol ? ' # 巡查岗：5 分钟巡逻（巡检台账/在途/心跳，随事件留痕）' : ''}`)
    L.push(`    dept: ${d.path}`)
    L.push(`    cron: "*/5 * * * *" # 每 5 分钟（本地时区）`)
    L.push(`    role: ${role} # 岗位`)
    L.push(`    level: ${n} # 该岗等级`)
    L.push(`    type: patrol${firstPatrol ? ' # patrol×output=结构性零产出，不声明 output（127-A）' : ''}`)
    L.push(`    model_tier: low`)
    L.push(`    budget_cap: 1 # USD/次`)
    firstPatrol = false
    L.push(`  - id: daily-report-${d.name}${firstReport ? ' # 日报岗：每日汇总叶子节点产出' : ''}`)
    L.push(`    dept: ${d.path} # 所属部门节点`)
    L.push(`    cron: "0 18 * * *" # 本地时区`)
    L.push(`    role: ${role} # 岗位`)
    L.push(`    level: ${n} # 该岗等级`)
    L.push(`    type: report # 任务类型（report | audit | ...，自由扩展，框架不写死）`)
    L.push(`    model_tier: low # 模型档：high | mid | low`)
    L.push(`    budget_cap: 2 # 预算帽（USD/次；预留-结算，超额在调用前拒绝）`)
    L.push(`    output: reports/${d.name}/ # 产出落点（报表按 <date>-<type>-<节点>-<总结>.md 命名）`)
    firstReport = false
  }
  L.push(``)
  L.push(`# YouTrack 账号锚点映射（账号=等级锚点，不随新增公司而新增账号）——根部门负责人`)
  L.push(`accounts:`)
  for (const d of roots) {
    L.push(`  - login: ${d.leader.toLowerCase()}`)
    L.push(`    level: ${n} # 账号锚定的等级（与人档案的工号解耦）`)
    L.push(`    note: ${roleOf(d.leader)}（${d.name}负责人）`)
  }
  L.push(``)
  return L.join('\n')
}

/** .studio-next.yaml 渲染（与 2 级模板同形；schema 用 canonical 字面量——DEV-32） */
function renderMeta(level: number): string {
  return `# Studio Next 挂载元信息（.studio-next.yaml）
#
# 由框架维护：挂载时间与最近校验结果由 daemon 写入（挂单 commit 留痕），人工不要手改。
# 契约依据：docs/04-§二 / §九（公司目录 schema 版本迁移由 daemon 执行，可 git revert）

schema: studio-next/org@1 # 公司目录 schema 版本（须与 org-config.yaml 的 schema 一致）
template: ${levelTemplateName(level)} # 生成本目录所用的模板名
created_at: null # 由 init 写入（ISO 8601 带时区偏移）
last_validated_at: null # 最近一次校验时间（ISO 8601）
last_validation: null # 最近一次校验结果：pass | fail（fail 时附错误清单）
framework_version: null # 写入时框架版本（供 migrate 判断是否需要迁移）
`
}

/** 部门 config.yaml 渲染（键序沿 2 级模板；根部门 jobs 清单与 org-config 双清单一致——C-5） */
function renderDeptConfig(spec: LevelSpec, dept: LevelDeptSpec): string {
  const L: string[] = []
  L.push(`# ${dept.name} · 部门章程与规定`)
  L.push(`#`)
  L.push(`# 契约依据：docs/04-§二（部门领导配置 = 本文件；leader 指向工号）`)
  L.push(`# 生成来源：${levelTemplateName(spec.level)}（docs/33-§3 L${spec.level} ${spec.form}骨架）`)
  if (dept.note !== undefined) L.push(`# ${dept.note}`)
  L.push(``)
  L.push(`name: ${dept.name}`)
  L.push(`path: ${dept.path}`)
  L.push(`level: ${spec.level} # 部门 level=公司等级（沿 2 级模板先例）；嵌套深度看目录`)
  L.push(`parent: ${dept.parent === null ? 'null' : dept.parent} # 上级部门 path（根部门为 null）`)
  L.push(`leader: ${dept.leader} # 主管工号（指向 people/ 内人事档案）`)
  L.push(`functions: # 部门职能`)
  for (const f of dept.functions) L.push(`  - ${f}`)
  L.push(`lanes: # 泳道：资源标签 + 并行开发单元（一泳道一 worker 一分支）`)
  for (const l of dept.lanes) L.push(`  - ${l}`)
  L.push(`reports_to: ${dept.parent === null ? 'null' : dept.parent} # 汇报线：本部门向哪个节点汇报（根部门为 null）`)
  L.push(``)
  L.push(`# 部门规定（部门内部规则；不得与 charter.md 的红线冲突）`)
  L.push(`rules:`)
  L.push(`  - 一切交付以落盘证据为准（REPORT + 闸门 exit=0）`)
  L.push(`  - 在途单一律挂泳道租约，忙则顺延不抢锁`)
  L.push(`  - 跨部门协作按 relations 走（relations 由公司落成后按需增补）`)
  L.push(``)
  L.push(`# 跨部门关系：{to, type∈联签|下游交付|共享泳道, protocol}`)
  L.push(`relations: []`)
  if (dept.parent === null) {
    L.push(``)
    L.push(`# 本部门名下的定时岗（清单与 org-config.yaml 的 jobs 段保持一致）`)
    L.push(`jobs:`)
    L.push(`  - health-patrol-${dept.name}`)
    L.push(`  - daily-report-${dept.name} # 日报岗：每日汇总叶子节点产出（D9 通用模型的一个实例）`)
  }
  L.push(``)
  return L.join('\n')
}

/** 人事档案渲染（六节固定格式与 2 级模板同形——multifile 弱匹配面） */
function renderPersonFile(spec: LevelSpec, person: LevelPersonSpec, name: string): string {
  const skills = skillsFor(person.id)
  return `---
# 人事档案 front-matter（契约：docs/01-需求-公司面.md C2-04 / docs/04-§二）
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

${person.role}：所在部门职能的骨架执行（${spec.form}骨架岗——正式定位由公司落成后按章程补齐）。

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
 * 生成后自检（appendix A 验收④）：目录校验绿 + init 占位七处恰好一次。
 * 红即抛错——绝不产出 init/校验消费不了的模板。
 */
function selfCheck(files: Record<string, string>, level: number): void {
  const tpl = levelTemplateName(level)
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
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) {
    const detail = mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')
    throw new Error(`模板自检红：${tpl} 未过目录校验（docs/04-§二 目录契约）：\n${detail}`)
  }
  if (mounted.snapshot.level !== level) {
    throw new Error(`模板自检红：${tpl} 挂载等级回读不符：期望 ${level}，实得 ${mounted.snapshot.level}`)
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
    files[`${p.dept}/people/${p.id}.md`] = renderPersonFile(spec, p, names[i]!)
  })
  selfCheck(files, spec.level)
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
    jobCount: rootDepartments(spec).length * 2,
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
