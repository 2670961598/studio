/**
 * switch-localfile.test.ts —— M2.5 切换脚本规格测试（node:test；任务书 §二 M2.5）
 *
 * 五面（验收口径，与预演报告 单子切换预演-2026-11-19.md 对应）：
 *   1. dry-run 零副作用：计划打印完整（平台树计数/备份/健康/停机/重启/回滚），目录字节不变
 *   2. apply 默认禁用：缺 --i-understand → exit 2 且零写入零备份
 *   3. apply 只动目标行：platform/platformDir（daemon.yaml）+ company.platform（org-config），
 *      其余行逐字节不动（含行内注释保留）；taiga 键保留（回滚零成本）
 *   4. rollback：最近备份恢复两文件（逐字节），备份不删
 *   5. 坏平台树中止：apply/dry-run 均在写动作前 exit 1（apply 下零备份零写入）
 *
 * 依赖：node 原生（node:test；被测件=子进程 CLI，零仓内 import——脚本本身零依赖）。
 * 运行：node --test scripts/test/switch-localfile.test.ts
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'ops', 'switch-localfile.mjs')
const NODE = process.execPath

/* ---------- 临时公司拷贝夹具 ---------- */

const cleanups: string[] = []
function tempRoot(label: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `sw-localfile-${label}-`))
  cleanups.push(dir)
  return dir
}
test.after(() => {
  for (const dir of cleanups.reverse()) rmSync(dir, { recursive: true, force: true })
})

/** 最小合法平台树：2 单（1 带评论）、活动流、provision */
function writePlatformTree(root: string): void {
  const issues = path.join(root, 'issues')
  mkdirSync(issues, { recursive: true })
  mkdirSync(path.join(root, 'meta'), { recursive: true })
  writeFileSync(path.join(issues, 'demo-1.jsonl'), '{"type":"created","ts":"2026-11-01T00:00:00.000Z","state":"新单","input":{"title":"单1"}}\n', 'utf8')
  writeFileSync(path.join(issues, 'demo-2.jsonl'), '{"type":"created","ts":"2026-11-01T00:00:01.000Z","state":"已交付","input":{"title":"单2"}}\n{"type":"transitioned","ts":"2026-11-01T00:00:02.000Z","to":"已交付"}\n', 'utf8')
  writeFileSync(path.join(issues, 'demo-1.comments.md'), '<!-- comment {"id":"c-000001","created":"2026-11-02T00:00:00.000Z","author":"producer"} -->\n正文\n<!-- /comment c-000001 -->\n', 'utf8')
  writeFileSync(
    path.join(root, 'activity.jsonl'),
    '{"id":"a-000001","ts":"2026-11-01T00:00:00.000Z","issue":"demo-1","kind":"created"}\n' +
      '{"id":"a-000002","ts":"2026-11-01T00:00:01.000Z","issue":"demo-2","kind":"created"}\n' +
      '{"id":"a-000003","ts":"2026-11-01T00:00:02.000Z","issue":"demo-2","kind":"commented","actor":"producer"}\n',
    'utf8',
  )
  writeFileSync(path.join(root, 'meta', 'fields.json'), '{"provision":{"fields":{"type":"type"},"states":["新单","已交付"],"stateFlow":{}}}', 'utf8')
}

interface Company {
  dir: string
  daemonYaml: string
  orgConfig: string
  platformRoot: string
}

function makeCompany(label: string): Company {
  const dir = tempRoot(label)
  const platformRoot = path.join(dir, 'platform')
  writePlatformTree(platformRoot)
  const daemonYaml = path.join(dir, 'daemon.yaml')
  const orgConfig = path.join(dir, 'company', 'org-config.yaml')
  mkdirSync(path.dirname(orgConfig), { recursive: true })
  writeFileSync(
    daemonYaml,
    [
      '# StudioNext daemon 配置（测试形）',
      'db: /tmp/does-not-matter/ledger.sqlite',
      'platform: taiga',
      'taigaUrl: http://127.0.0.1:9000',
      'taigaProject: demo',
      'taigaAuth: password',
      'taigaEntity: userstory',
      'company: demo',
      'companyDir: /tmp/does-not-matter/company',
      'rootDir: /tmp/does-not-matter/var',
      'tickMs: 1000',
      'maxActionsPerTick: 30  # 制作人令：全员同时开工',
      'jobs: true',
      "seatbeltWriteRoots: '[\"/tmp/x/.AIWS\"]'",
      'apiPort: 0',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    orgConfig,
    [
      'schema: org-config/v1',
      '',
      'company:',
      '  name: Demo',
      '  slug: demo',
      '  platform: taiga # 协作平台绑定（行内注释须保留）',
      '  charter_ref: charter.md',
      '',
      'departments_index: []',
      '',
    ].join('\n'),
    'utf8',
  )
  return { dir, daemonYaml, orgConfig, platformRoot }
}

/** 目录指纹：相对路径+内容 sha256（.keep 忽略）——零副作用断言用 */
function treeFingerprint(root: string): string {
  const parts: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.keep') continue
      const full = path.join(dir, name)
      const st = statOf(full)
      if (st.isDirectory()) walk(full, `${prefix}${name}/`)
      else parts.push(`${prefix}${name}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`)
    }
  }
  walk(root, '')
  return parts.join('|')
}

const statOf = (p: string) => statSync(p)

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

function run(args: string[]): RunResult {
  const res = spawnSync(NODE, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000 })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

const switchArgs = (c: Company, extra: string[]): string[] => [
  '--daemon-yaml', c.daemonYaml, '--org-config', c.orgConfig, '--platform-root', c.platformRoot, ...extra,
]

/* ---------- 1) dry-run：计划完整 + 零副作用 ---------- */

test('dry-run 打印完整切换计划且零副作用', () => {
  const c = makeCompany('dry')
  const before = treeFingerprint(c.dir)
  const r = run(switchArgs(c, ['--dry-run']))
  assert.equal(r.status, 0, `exit=${String(r.status)} stderr=${r.stderr}`)
  for (const needle of [
    '平台树校验', '单据 issues/*.jsonl = 2', '评论 *.comments.md = 1 文件 / 1 块', '活动流 activity.jsonl = 3 条',
    'ID 唯一：ok', '配置编辑计划', 'platform: localfile', 'platformDir', '  platform: localfile # 协作平台绑定（行内注释须保留）',
    '备份计划', '.bak-switch-localfile-', 'daemon 健康与在途', '预计停机窗口', '重启与验证命令', '回滚步骤',
    'DRY-RUN OK',
  ]) {
    assert.ok(r.stdout.includes(needle), `输出缺「${needle}」`)
  }
  assert.equal(treeFingerprint(c.dir), before, 'dry-run 后目录字节不变')
})

test('dry-run 为缺省模式', () => {
  const c = makeCompany('drydefault')
  const before = treeFingerprint(c.dir)
  const r = run(switchArgs(c, []))
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes('DRY-RUN OK'))
  assert.equal(treeFingerprint(c.dir), before)
})

/* ---------- 2) apply 默认禁用 ---------- */

test('apply 缺 --i-understand 拒绝（exit 2 零写入）', () => {
  const c = makeCompany('guard')
  const before = treeFingerprint(c.dir)
  const r = run(switchArgs(c, ['--apply']))
  assert.equal(r.status, 2)
  assert.ok(r.stderr.includes('--i-understand'), '提示须点名确认位')
  assert.equal(treeFingerprint(c.dir), before, '零写入零备份')
})

/* ---------- 3) apply 只动目标行 ---------- */

test('apply 只动 platform/platformDir/company.platform 三处，其余行逐字节不动', () => {
  const c = makeCompany('apply')
  const daemonBefore = readFileSync(c.daemonYaml, 'utf8')
  const orgBefore = readFileSync(c.orgConfig, 'utf8')
  const r = run(switchArgs(c, ['--apply', '--i-understand']))
  assert.equal(r.status, 0, r.stderr)

  const daemonAfter = readFileSync(c.daemonYaml, 'utf8').split('\n')
  const daemonOld = daemonBefore.split('\n')
  // platform 行（L3）替换、platformDir 插在其后；其余行相对顺序与字节一致
  const expectAfter = [
    ...daemonOld.slice(0, 2), // 注释、db
    'platform: localfile',
    `platformDir: ${c.platformRoot}  # 单子切换（switch-localfile；缺省 <rootDir>/platform）`,
    ...daemonOld.slice(3), // taiga 四键（保留）及其后全部
  ]
  assert.deepEqual(daemonAfter, expectAfter)

  const orgAfter = readFileSync(c.orgConfig, 'utf8').split('\n')
  const orgOld = orgBefore.split('\n')
  const orgExpect = orgOld.map((line) => (line === '  platform: taiga # 协作平台绑定（行内注释须保留）' ? '  platform: localfile # 协作平台绑定（行内注释须保留）' : line))
  assert.deepEqual(orgAfter, orgExpect)

  // taiga 键保留（回滚零成本）；幂等复跑=零动作
  assert.ok(daemonAfter.join('\n').includes('taigaUrl'))
  const r2 = run(switchArgs(c, ['--apply', '--i-understand']))
  assert.equal(r2.status, 0)
  assert.ok(r2.stdout.includes('幂等无动作'))
  assert.deepEqual(readFileSync(c.daemonYaml, 'utf8').split('\n'), expectAfter)

  // 备份存在且=切换前内容
  const baks = readdirSync(c.dir).filter((n) => n.includes('bak-switch-localfile'))
  assert.equal(baks.length, 1)
  assert.equal(readFileSync(path.join(c.dir, baks[0] as string), 'utf8'), daemonBefore)
})

/* ---------- 4) rollback ---------- */

test('rollback 用最近备份恢复两文件，备份保留', () => {
  const c = makeCompany('rollback')
  const daemonBefore = readFileSync(c.daemonYaml, 'utf8')
  const orgBefore = readFileSync(c.orgConfig, 'utf8')
  assert.equal(run(switchArgs(c, ['--apply', '--i-understand'])).status, 0)
  const r = run(['--daemon-yaml', c.daemonYaml, '--org-config', c.orgConfig, '--rollback'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(c.daemonYaml, 'utf8'), daemonBefore)
  assert.equal(readFileSync(c.orgConfig, 'utf8'), orgBefore)
  // 备份保留（审计）；daemon+org 各一份
  assert.ok(readdirSync(c.dir).some((n) => n.startsWith('daemon.yaml.bak-switch-localfile-')))
  assert.ok(readdirSync(path.dirname(c.orgConfig)).some((n) => n.startsWith('org-config.yaml.bak-switch-localfile-')))
  // 无备份时 rollback=fail-closed
  const c2 = makeCompany('rollback-nobak')
  const r2 = run(['--daemon-yaml', c2.daemonYaml, '--org-config', c2.orgConfig, '--rollback'])
  assert.equal(r2.status, 1)
})

/* ---------- 5) 坏平台树中止 ---------- */

test('坏平台树：dry-run 与 apply 均在写动作前中止', () => {
  const base = makeCompany('badtree')
  // 变体 a：活动流 id 撞号（M2 实跑缺陷形态——预演报告 §四）
  const dupActivity = makeCompany('badtree-dup')
  copyTree(base.platformRoot, dupActivity.platformRoot)
  appendLine(path.join(dupActivity.platformRoot, 'activity.jsonl'), '{"id":"a-000003","ts":"2026-11-01T00:00:03.000Z","issue":"demo-1","kind":"field-set"}')
  // 变体 b：事件流形状坏（首事件非 created——切换树逐单派生口径）
  const badFirst = makeCompany('badtree-first')
  copyTree(base.platformRoot, badFirst.platformRoot)
  writeFileSync(path.join(badFirst.platformRoot, 'issues', 'demo-3.jsonl'), '{"type":"transitioned","ts":"2026-11-01T00:00:00.000Z","to":"已交付"}\n', 'utf8')
  // 变体 c：provision 损坏（meta/fields.json 缺 provision.states）
  const badProv = makeCompany('badtree-prov')
  copyTree(base.platformRoot, badProv.platformRoot)
  writeFileSync(path.join(badProv.platformRoot, 'meta', 'fields.json'), '{"provision":{"fields":{"type":"type"},"states":[],"stateFlow":{}}}', 'utf8')

  for (const [label, company] of [['活动 id 撞号', dupActivity], ['首事件非 created', badFirst], ['provision states 空', badProv]] as const) {
    const before = treeFingerprint(company.dir)
    const rd = run(switchArgs(company, ['--dry-run']))
    assert.equal(rd.status, 1, `${label}：dry-run 须 exit 1`)
    assert.ok(rd.stdout.includes('校验失败'), `${label}：须报校验失败`)
    const ra = run(switchArgs(company, ['--apply', '--i-understand']))
    assert.equal(ra.status, 1, `${label}：apply 须 exit 1`)
    assert.equal(treeFingerprint(company.dir), before, `${label}：零备份零写入`)
    assert.ok(!readdirSync(company.dir).some((n) => n.includes('bak-switch-localfile')), `${label}：不得留备份`)
  }
})

test('平台已 localfile 时 dry-run 报幂等', () => {
  const c = makeCompany('already')
  assert.equal(run(switchArgs(c, ['--apply', '--i-understand'])).status, 0)
  const r = run(switchArgs(c, ['--dry-run']))
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes('已是 localfile'))
})

/* ---------- 辅助 ---------- */

function copyTree(src: string, dst: string): void {
  for (const name of readdirSync(src)) {
    if (name === '.keep') continue
    const from = path.join(src, name)
    if (statOf(from).isDirectory()) {
      mkdirSync(path.join(dst, name), { recursive: true })
      copyTree(from, path.join(dst, name))
    } else copyFileSync(from, path.join(dst, name))
  }
}

function appendLine(file: string, line: string): void {
  const cur = readFileSync(file, 'utf8')
  writeFileSync(file, `${cur}${line}\n`, 'utf8')
}
