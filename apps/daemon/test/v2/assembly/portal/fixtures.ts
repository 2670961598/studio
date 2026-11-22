/**
 * 公司门户测试夹具（docs/plan/11-公司门户-2026-11-23.md §三 数据来源／降级矩阵）。
 *
 * 最小合法公司目录＋本地平台单子树＋台账——造数走各事实源的正式写面（appendEvent），
 * 被测门户自身零写（断言面见 portal-app.test.ts / portal-cli.test.ts）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openLedger, type Ledger } from '@studio-next/store'
import { makeUlid } from '../../../../src/engine/tools/id.ts'

/** 最小合法 org-config（level_distribution 与 people 实数逐档相等——C-8） */
export const ORG_CONFIG = [
  'schema: org-config/v1',
  'company:',
  '  name: 门户测试公司',
  '  slug: portal-demo',
  '  mission: 用一条可验证的交付链，把需求变成有证据的产出 # 使命',
  '  charter_ref: charter.md',
  '  level: 2',
  '  platform: localfile',
  '  level_distribution:',
  '    2: 1',
  '    1: 2',
  'departments:',
  '  - name: 研发部',
  '    path: departments/研发部',
  '    leader: ENG-1',
  '    level: 2',
  '    parent: null',
  '    lanes: [core, qa]',
  '    functions: [交付, 质量]',
  '    relations: []',
  '  - name: 平台组',
  '    path: departments/研发部/平台组',
  '    leader: OPS-1',
  '    level: 2',
  '    parent: departments/研发部',
  '    lanes: [ops]',
  '    functions: [运维]',
  '    relations: []',
  'people:',
  '  - id: ENG-1',
  '    name: 工程师甲',
  '    login: eng-1',
  '    level: 2',
  '    dept: departments/研发部',
  '    status: active',
  '  - id: OPS-1',
  '    name: 运维乙',
  '    login: ops-1',
  '    level: 1',
  '    dept: departments/研发部/平台组',
  '    status: active',
  '  - id: QA-1',
  '    name: 测试丙',
  '    login: qa-1',
  '    level: 1',
  '    dept: departments/研发部',
  '    status: active',
  '',
].join('\n')

export const CHARTER = '# 门户测试公司章程\n\n测试夹具，无业务含义。\n'

export const STUDIO_META = ['schema: org-config/v1', 'template: company-2-level', 'created_at: "2026-11-20T00:00:00.000Z"', 'last_validation: pass', 'framework_version: 0.1.0', ''].join('\n')

/** 部门 config.yaml（必填集镜像 org-config 索引条目——M2.2-④） */
const deptConfig = (name: string, deptPath: string, level: number, parent: string | null, leader: string, lanes: string, functions: string): string =>
  [`name: ${name}`, `path: ${deptPath}`, `level: ${String(level)}`, `parent: ${parent === null ? 'null' : parent}`, `leader: ${leader}`, `lanes: [${lanes}]`, `functions: [${functions}]`, 'reports_to: null', ''].join('\n')

/** 人事档案（front-matter 必填集 + 六节弱校验——M2.2-①③） */
const peopleArchive = (id: string, name: string, login: string, level: number, dept: string): string =>
  [
    '---',
    `id: ${id}`,
    `name: ${name}`,
    `login: ${login}`,
    `level: ${String(level)}`,
    `dept: ${dept}`,
    'status: active',
    '---',
    '',
    '## 一、定位',
    '测试夹具人员。',
    '',
    '## 二、职责',
    '测试夹具人员。',
    '',
    '## 三、做过的事',
    '测试夹具人员。',
    '',
    '## 四、技能本体',
    '测试夹具人员。',
    '',
    '## 五、表现画像',
    '测试夹具人员。',
    '',
    '## 六、自述',
    '测试夹具人员。',
    '',
  ].join('\n')

/** 公司目录全量文件（org-config 索引 ↔ 部门/人事/章程/元文件 双检闭合） */
export const COMPANY_FILES: Readonly<Record<string, string>> = {
  'org-config.yaml': ORG_CONFIG,
  'charter.md': CHARTER,
  '.studio-next.yaml': STUDIO_META,
  'departments/研发部/config.yaml': deptConfig('研发部', 'departments/研发部', 2, null, 'ENG-1', 'core, qa', '交付, 质量'),
  'departments/研发部/平台组/config.yaml': deptConfig('平台组', 'departments/研发部/平台组', 2, 'departments/研发部', 'OPS-1', 'ops', '运维'),
  'departments/研发部/people/ENG-1.md': peopleArchive('ENG-1', '工程师甲', 'eng-1', 2, 'departments/研发部'),
  'departments/研发部/平台组/people/OPS-1.md': peopleArchive('OPS-1', '运维乙', 'ops-1', 1, 'departments/研发部/平台组'),
  'departments/研发部/people/QA-1.md': peopleArchive('QA-1', '测试丙', 'qa-1', 1, 'departments/研发部'),
}

const T0 = '2026-11-20T10:00:00.000Z'
const T1 = '2026-11-20T11:00:00.000Z'
const T2 = '2026-11-21T09:30:00.000Z'
const T3 = '2026-11-22T08:00:00.000Z'

/** 平台单子树（issues/*.jsonl；三态＋ XSS 语料＋验收段） */
export const ISSUE_FILES: Readonly<Record<string, string>> = {
  // 新单 → 已派发（两次状态推进）＋字段写入：时间线全类型覆盖
  'issues/PORTAL-1.jsonl': [
    JSON.stringify({ type: 'created', ts: T0, state: '新单', input: { title: '登录页改版：支持暗色主题', description: '背景：设计稿已出。', type: 'devtask', dept: 'departments/研发部', level: 2, assignee: 'ENG-1', lane: 'core' } }),
    JSON.stringify({ type: 'transitioned', ts: T1, to: '已派发' }),
    JSON.stringify({ type: 'field-set', ts: T2, field: 'lane', value: 'qa' }),
    '',
  ].join('\n'),
  // 已交付：描述含「## 验收口径」段＋HTML 注入语料（渲染面须全转义）
  'issues/PORTAL-2.jsonl': [
    JSON.stringify({
      type: 'created',
      ts: T3,
      state: '已交付',
      input: {
        title: '<script>alert("xss")</script> 交付单',
        description: '正文 <img src=x onerror=alert(1)>\n\n## 验收口径\n\n- 闸门 exit=0\n- REPORT 落盘 <b>加粗</b>',
        type: 'devtask',
        dept: 'departments/研发部',
        level: 2,
        assignee: 'QA-1',
        parent: 'PORTAL-1',
      },
    }),
    '',
  ].join('\n'),
  // Archived：归档态徽标中性
  'issues/PORTAL-3.jsonl': [JSON.stringify({ type: 'created', ts: T1, state: 'Archived', input: { title: '旧巡逻单' } }), ''].join('\n'),
}

/** 报表目录（含占位件——列表应跳过；含非白名单后缀——查看应 400） */
export const REPORT_FILES: Readonly<Record<string, string>> = {
  'reports/研发部/2026-11-20-report-a.md': '# 日报 A\n\n结论：一切正常。\n',
  'reports/研发部/2026-11-21-report-b.txt': '纯文本报表 <script>不执行</script>\n',
  'reports/研发部/summary.json': '{"ok":true,"n":3}\n',
  'reports/研发部/run.sh': 'echo 不应可读\n',
  'reports/.gitkeep': '',
  'reports/研发部/.DS_Store': 'x',
}

export interface PortalTree {
  readonly root: string
  readonly companyDir: string
  readonly platformRoot: string
  readonly dbPath: string
  /** 写台账事件（走 store 正式写面；ts 为 epoch ms） */
  readonly ledger: Ledger
}

export const COMPANY = 'portal-demo'
export const ISSUE = 'PORTAL-1'

export interface SeedEvent {
  readonly ts: number
  readonly event: string
  readonly issue?: string
  readonly note?: string
  readonly cost_usd?: number
}

/** 落一条合法台账事件（contract validateEventRecord 前置闸内） */
export function seedEvent(ledger: Ledger, e: SeedEvent): void {
  ledger.appendEvent({
    id: makeUlid(e.ts),
    ts: e.ts,
    company: COMPANY,
    issue: e.issue ?? ISSUE,
    event: e.event,
    actor: e.event === 'HEARTBEAT' ? 'daemon' : 'ENG-1',
    attempt: 1,
    level: 2,
    dept: 'departments/研发部',
    tokens: { input: 0 },
    ...(e.note !== undefined ? { note: e.note } : {}),
    ...(e.cost_usd !== undefined ? { cost_usd: e.cost_usd } : {}),
  })
}

const writeTree = (dir: string, files: Readonly<Record<string, string>>): void => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
}

export interface MakeTreeOptions {
  readonly platform?: boolean
  readonly reports?: boolean
}

/** 建整棵夹具树（公司目录＋平台＋台账）；台账留空由用例按需 seed */
export function makeTree(prefix: string, opts: MakeTreeOptions = {}): PortalTree {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  const companyDir = path.join(root, 'company')
  const platformRoot = path.join(root, 'platform')
  mkdirSync(companyDir, { recursive: true })
  writeTree(companyDir, { ...COMPANY_FILES, ...(opts.reports === false ? {} : REPORT_FILES) })
  if (opts.platform !== false) writeTree(platformRoot, ISSUE_FILES)
  const dbPath = path.join(root, 'ledger.sqlite')
  const ledger = openLedger(dbPath)
  return { root, companyDir, platformRoot, dbPath, ledger }
}

export function dropTree(tree: PortalTree): void {
  try {
    tree.ledger.close()
  } catch {
    // 已关：幂等
  }
  rmSync(tree.root, { recursive: true, force: true })
}
