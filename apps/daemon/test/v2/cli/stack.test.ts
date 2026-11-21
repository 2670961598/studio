// stack.test —— `studio-next stack` 命令组测试（M5-1 第一刀＋M5-2；V2 套件）。
//
// 覆盖面（plan/08-§三 M5-1/M5-2 验收）：本件=launchd 面与命令分发——
//   1. plist 计划/渲染：占位符替换、残留即抛、同输入同字节（幂等）、label 三件约定
//   2. status 判定纯函数：daemon 200∧ok / panel 2xx / chatd 两步；skipped 不算失败
//   3. status/doctor 端到端（注入探针；doctor 六项判定纯函数在 stack-doctor.test.ts）
//   4. up/down（macOS launchd）：dry-run 零副作用；--apply 写 0600＋token 首产不覆盖＋
//      bootout 先行幂等；win32/linux-无-systemd 均 exit 3（注入 platform——绝不真调 launchctl）
//   5. 帮助面/用法面：-h exit 0；裸命令/未知子命令/未知旗标 exit 1
// Linux systemd 分支与模板单一源在 stack-systemd.test.ts（M5-2）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  judgeDaemonHealth,
  judgePanelHealth,
  cmdStack,
  STACK_EXIT,
  summarizeStatus,
  type HttpProbeResult,
  type StatusRow,
  type StackDepsInit,
} from '../../../src/cli/stack/stack.ts'
import {
  buildDownPlan,
  buildUpPlan,
  CHATD_PLIST_TEMPLATE,
  normalizeSlug,
  readFlatYamlScalars,
  renderPlist,
  StackUsageError,
  stackLabels,
} from '../../../src/cli/stack/plists.ts'

/* ---------------- 测试底座 ---------------- */

let root = ''
let home = ''
let workRoot = ''
let companyDir = ''
let configPath = ''
let guardianConfig = ''
let deployRoot = ''
let runCalls: string[][] = []
let bootFails = false

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stack-test-'))
  home = path.join(root, 'home')
  workRoot = path.join(root, 'work')
  companyDir = path.join(workRoot, 'demo-corp')
  configPath = path.join(companyDir, 'daemon.yaml')
  guardianConfig = path.join(workRoot, 'guardian.json')
  deployRoot = path.join(root, 'deploy')
  runCalls = []
  bootFails = false
  makeCompany()
  makeDeployTree()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** 健康Company夹具：<companyDir>/daemon.yaml(platform=localfile+db，扁平布局) + var/workbench 三件（0700/0600/0600） */
function makeCompany(): void {
  mkdirSync(path.join(companyDir, 'var', 'workbench'), { recursive: true })
  const varDir = path.join(companyDir, 'var', 'workbench')
  writeFileSync(path.join(varDir, 'chat.sock'), '', { mode: 0o700 })
  writeFileSync(path.join(varDir, 'chat.db'), '', { mode: 0o600 })
  writeFileSync(path.join(varDir, 'chatd.token'), 'a'.repeat(64), { mode: 0o600 })
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, `# 注释行\nplatform: localfile\ndb: "${path.join(workRoot, 'var', 'ledger.sqlite')}"\ntickMs: 1000\n`)
  writeFileSync(guardianConfig, '{}\n')
}

/** 假部署树（--apply 前置硬校验三个入口都在场） */
function makeDeployTree(): void {
  for (const rel of ['scripts/guardian.mjs', 'apps/workbench-chatd/src/main.ts', 'apps/daemon/src/cli/main.ts']) {
    const file = path.join(deployRoot, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '// stub\n')
  }
}

/** 可注入 deps（缺省=darwin 健康世界＋systemd 在场；测试绝不真调 launchctl/systemctl/真探针） */
function deps(over: StackDepsInit = {}): StackDepsInit {
  return {
    platform: 'darwin',
    nodeVersion: '24.21.0',
    home,
    env: {},
    uid: 501,
    systemdAvailable: true,
    run: (argv) => {
      runCalls.push([...argv])
      if (bootFails && argv[1] === 'bootstrap') return { status: 37, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' }
      return { status: 0, stdout: '', stderr: '' }
    },
    httpGet: async () => ({ http: 200, body: '{"ok":true,"pid":123}', error: null }),
    chatdProbe: async () => ({ state: 'up', server: 'workbench-chatd/1.0.0', rooms: 2 }),
    statfs: () => ({ bavail: 100, bsize: 1024 ** 3 }),
    ...over,
  }
}

/** console 捕获（CLI 输出面=console.log/error——help-face.test 同款口径） */
async function capture<T>(fn: () => Promise<T>): Promise<{ code: T; out: string; err: string }> {
  const logs: string[] = []
  const errors: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.join(' '))
  })
  try {
    return { code: await fn(), out: logs.join('\n'), err: errors.join('\n') }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
}

/** up 参数集（函数——目录变量由 beforeEach 赋值，模块级常量会在导入期定格成空串） */
function upArgs(...extra: string[]): string[] {
  return ['up', '--company-dir', companyDir, '--guardian-config', guardianConfig, '--deploy-root', deployRoot, '--home', home, ...extra]
}

/* ---------------- 1. plist 计划与渲染（纯函数） ---------------- */

describe('stack/plists：计划/渲染纯函数', () => {
  const baseInput = (): Parameters<typeof buildUpPlan>[0] => ({
    companyDir,
    deployRoot,
    nodeBin: '/usr/local/bin/node',
    guardianConfig,
    daemonConfigPath: configPath,
    daemonDb: '/abs/ledger.sqlite',
    port: 8788,
    panelPort: 8791,
    home,
    labelPrefix: 'io.studionext',
  })

  it('label 三件约定：daemon=固定名，chatd/panel=<prefix>.<kind>.<slug>', () => {
    expect(stackLabels('io.studionext', 'demo-corp')).toEqual({
      daemon: 'io.studionext.daemon',
      chatd: 'io.studionext.chatd.demo-corp',
      panel: 'io.studionext.panel.demo-corp',
    })
  })

  it('占位符全替换：三 plist 无 __ 残留；路径/label/socket/db/token 落位', () => {
    const plan = buildUpPlan(baseInput())
    for (const service of plan.services) {
      expect(service.plist.includes('__'), service.id).toBe(false)
    }
    const chatd = plan.services.find((s) => s.id === 'chatd')?.plist ?? ''
    expect(chatd.includes('io.studionext.chatd.demo-corp')).toBe(true)
    expect(chatd.includes('WORKBENCH_CHATD_TOKEN_FILE')).toBe(true)
    expect(chatd.includes(plan.tokenFile)).toBe(true)
    expect(chatd.includes(plan.socketPath)).toBe(true)
    const daemon = plan.services.find((s) => s.id === 'daemon')?.plist ?? ''
    expect(daemon.includes('--config')).toBe(true)
    expect(daemon.includes(plan.guardianConfig)).toBe(true)
    expect(daemon.includes('guardian.mjs')).toBe(true)
    const panel = plan.services.find((s) => s.id === 'panel')?.plist ?? ''
    expect(panel.includes('--db')).toBe(true)
    expect(panel.includes('/abs/ledger.sqlite')).toBe(true)
    expect(panel.includes('--port')).toBe(true)
    expect(panel.includes('8791')).toBe(true)
  })

  it('幂等：同输入两次 buildUpPlan → 三 plist 逐字节相同', () => {
    const a = buildUpPlan(baseInput())
    const b = buildUpPlan(baseInput())
    expect(a.services.map((s) => s.plist)).toEqual(b.services.map((s) => s.plist))
  })

  it('renderPlist：残留占位符即抛（不落盘防线）', () => {
    expect(() => renderPlist('__LEFT__', { __OTHER__: 'x' })).toThrow(/残留占位符/)
    expect(renderPlist('__A__+__B__', { __A__: '1', __B__: '2' })).toBe('1+2')
  })

  it('token 值永不入 plist（只带 TOKEN_FILE 路径——密钥纪律）', () => {
    const plan = buildUpPlan(baseInput())
    for (const service of plan.services) expect(service.plist.includes('a'.repeat(64))).toBe(false)
  })

  it('自定义 label-prefix 生效（多机位隔离）', () => {
    const plan = buildUpPlan({ ...baseInput(), labelPrefix: 'io.studionext.staging' })
    expect(plan.services.map((s) => s.label)).toEqual(['io.studionext.staging.daemon', 'io.studionext.staging.chatd.demo-corp', 'io.studionext.staging.panel.demo-corp'])
  })

  it('normalizeSlug：--company 优先；非法 slug 抛 StackUsageError', () => {
    expect(normalizeSlug({ companyDir: '/abs/Demo-Corp', company: 'my-corp' })).toBe('my-corp')
    expect(normalizeSlug({ companyDir: path.join('/abs', 'demo-corp') })).toBe('demo-corp')
    expect(() => normalizeSlug({ companyDir: path.join('/abs', '有 空格!') })).toThrow(StackUsageError)
  })

  it('buildDownPlan：bootout 三 label；plist 不在命令面（数据保留）', () => {
    const plan = buildDownPlan({ companyDir, labelPrefix: 'io.studionext' })
    expect(plan.bootoutCmds).toEqual([
      'launchctl bootout gui/$(id -u)/io.studionext.daemon',
      'launchctl bootout gui/$(id -u)/io.studionext.chatd.demo-corp',
      'launchctl bootout gui/$(id -u)/io.studionext.panel.demo-corp',
    ])
  })

  it('readFlatYamlScalars：JSON 引号/单引号/行尾注释/注释行', () => {
    const out = readFlatYamlScalars('# 头注释\nplatform: localfile\ndb: "/abs/x#y.sqlite"\nname: \'quoted\'\ntickMs: 1000 # 行尾注释\nempty-key:\n')
    expect(out['platform']).toBe('localfile')
    expect(out['db']).toBe('/abs/x#y.sqlite')
    expect(out['name']).toBe('quoted')
    expect(out['tickMs']).toBe('1000')
    expect('empty-key' in out).toBe(false)
  })

  it('chatd 模板与 chatd-setup.mjs PLIST_TEMPLATE 同构关键行（env 四键＋strip-types）', () => {
    for (const key of ['WORKBENCH_CHATD_SOCKET', 'WORKBENCH_CHATD_DB', 'WORKBENCH_CHATD_TOKEN_FILE', 'WORKBENCH_CHATD_LOG', '--experimental-strip-types']) {
      expect(CHATD_PLIST_TEMPLATE.includes(key)).toBe(true)
    }
  })
})

/* ---------------- 2. status 判定纯函数 ---------------- */

describe('status 判定纯函数', () => {
  it('judgeDaemonHealth：200∧ok=true→up；503/坏 body/网络错→down', () => {
    expect(judgeDaemonHealth({ http: 200, body: '{"ok":true,"pid":1}', error: null })).toBe('up')
    expect(judgeDaemonHealth({ http: 503, body: '{"ok":false}', error: null })).toBe('down')
    expect(judgeDaemonHealth({ http: 200, body: '{"ok":false}', error: null })).toBe('down')
    expect(judgeDaemonHealth({ http: 200, body: 'not-json', error: null })).toBe('down')
    expect(judgeDaemonHealth({ http: null, body: null, error: 'ECONNREFUSED' })).toBe('down')
  })

  it('judgePanelHealth：任一 2xx→up；404/网络错→down', () => {
    expect(judgePanelHealth({ http: 200, body: '<html>', error: null })).toBe('up')
    expect(judgePanelHealth({ http: 204, body: '', error: null })).toBe('up')
    expect(judgePanelHealth({ http: 404, body: '', error: null })).toBe('down')
    expect(judgePanelHealth({ http: null, body: null, error: 'timeout' })).toBe('down')
  })

  it('summarizeStatus：failed 只数 down；skipped 不算失败', () => {
    const rows: StatusRow[] = [
      { id: 'daemon', target: 't1', state: 'up', detail: '' },
      { id: 'chatd', target: 't2', state: 'skipped', detail: '' },
      { id: 'panel', target: 't3', state: 'down', detail: '' },
    ]
    expect(summarizeStatus(rows)).toEqual({ failed: 1, skipped: 1 })
  })
})

/* ---------------- 3. status / doctor 端到端（注入探针） ---------------- */

describe('stack status（只读探测，注入探针）', () => {
  it('全绿：exit 0，三行 up；--json 可解析', async () => {
    const res = await capture(() => cmdStack(['status', '--company-dir', companyDir], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('stack status')).toBe(true)
    expect(res.out.match(/● up/g)?.length).toBe(3)
    const json = await capture(() => cmdStack(['status', '--company-dir', companyDir, '--json'], deps()))
    const payload = JSON.parse(json.out) as { rows: { id: string; state: string }[]; failed: number }
    expect(payload.failed).toBe(0)
    expect(payload.rows.map((r) => r.id)).toEqual(['daemon', 'chatd', 'panel'])
  })

  it('缺 --company-dir：chatd=skipped 不算失败，exit 0', async () => {
    const res = await capture(() => cmdStack(['status'], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('- skip')).toBe(true)
    expect(res.out.includes('未给 --company-dir')).toBe(true)
  })

  it('探针失败：exit 1 明报（daemon 503＋chatd down）', async () => {
    const res = await capture(() =>
      cmdStack(
        ['status', '--company-dir', companyDir],
        deps({
          httpGet: async (): Promise<HttpProbeResult> => ({ http: 503, body: '{"ok":false}', error: null }),
          chatdProbe: async () => ({ state: 'down', reason: 'socket 不存在：chatd 未启动？' }),
        }),
      ),
    )
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.out.match(/○ down/g)?.length).toBe(3)
    expect(res.out.includes('chatd 未启动')).toBe(true)
  })

  it('--port/--panel-port 透传到探针 URL', async () => {
    const seen: string[] = []
    const res = await capture(() =>
      cmdStack(
        ['status', '--port', '9001', '--panel-port', '9002'],
        deps({ httpGet: async (url) => (seen.push(url), { http: 200, body: '{"ok":true}', error: null }) }),
      ),
    )
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(seen).toContain('http://127.0.0.1:9001/healthz')
    expect(seen).toContain('http://127.0.0.1:9002/')
  })
})

describe('stack doctor（端到端，真实临时目录）', () => {
  it('健康公司：exit 0（7/7 PASS——第 7 项=Docker 退役提示恒绿）', async () => {
    const res = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('PASS（7/7）')).toBe(true)
    expect(res.out.includes('docker-retired')).toBe(false) // 文本面按序号+名称显示，id 只进 --json
  })

  it('M5-4a：Docker 在位＋声明退役（env）→ 第 7 项绿＋hint 可卸载；不声明则无 hint', async () => {
    const retired = await capture(() =>
      cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps({ env: { STUDIO_NEXT_DOCKER_RETIRED: '1' } })),
    )
    expect(retired.code).toBe(STACK_EXIT.ok)
    expect(retired.out.includes('7. ● ok')).toBe(true)
    expect(retired.out.includes('Docker 已退役，可卸载')).toBe(true)
    const quiet = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups'), '--json'], deps()))
    const payload = JSON.parse(quiet.out) as { checks: { id: string; ok: boolean; hint?: string }[] }
    const item = payload.checks.find((c) => c.id === 'docker-retired')
    expect(item?.ok).toBe(true)
    expect(item?.hint).toBeUndefined()
  })

  it('M5-4a：Docker CLI 不在（run 返回非零）→ 第 7 项绿、detail=干净机器形态', async () => {
    const res = await capture(() =>
      cmdStack(
        ['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups'), '--json'],
        deps({ run: () => ({ status: 127, stdout: '', stderr: 'not found' }) }),
      ),
    )
    expect(res.code).toBe(STACK_EXIT.ok)
    const payload = JSON.parse(res.out) as { checks: { id: string; ok: boolean; detail: string }[] }
    const item = payload.checks.find((c) => c.id === 'docker-retired')
    expect(item?.ok).toBe(true)
    expect(item?.detail.includes('干净机器')).toBe(true)
  })

  it('缺省 daemon.yaml 推导＝<company-dir>/daemon.yaml：尾斜杠/相对路径输入规范化为绝对后相等（回归 2026-11-21：不丢公司段、不拼父级 var）', async () => {
    for (const input of [`${companyDir}/`, path.relative(process.cwd(), companyDir)]) {
      const res = await capture(() => cmdStack(['doctor', '--company-dir', input, '--backup-dir', path.join(root, 'backups'), '--json'], deps()))
      expect(res.code, `input=${input}`).toBe(STACK_EXIT.ok)
      const payload = JSON.parse(res.out) as { checks: { id: string; detail: string }[] }
      const entry = payload.checks.find((c) => c.id === 'daemon-yaml')
      const shown = (entry?.detail ?? '').split(' platform=')[0] ?? ''
      expect(path.resolve(shown), `input=${input}`).toBe(path.resolve(companyDir, 'daemon.yaml'))
      // 旧 bug 位（dirname(companyDir)/var/daemon.yaml）不得再出现
      expect(shown.includes(path.join(path.dirname(path.resolve(companyDir)), 'var')), `input=${input}`).toBe(false)
    }
  })

  it('doctor 文本输出含真实 daemon.yaml 绝对路径', async () => {
    const res = await capture(() => cmdStack(['doctor', '--company-dir', `${companyDir}/`, '--backup-dir', path.join(root, 'backups')], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out).toContain(path.join(companyDir, 'daemon.yaml'))
  })

  it('daemon.yaml 缺失：红项 detail/hint 明报真实推导路径（错误信息不指错地方）', async () => {
    rmSync(configPath)
    const res = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups'), '--json'], deps()))
    expect(res.code).toBe(STACK_EXIT.doctor)
    const payload = JSON.parse(res.out) as { checks: { id: string; ok: boolean; detail: string; hint: string }[] }
    const entry = payload.checks.find((c) => c.id === 'daemon-yaml')
    expect(entry?.ok).toBe(false)
    expect(path.resolve(entry?.detail ?? '')).toBe(path.resolve(companyDir, 'daemon.yaml'))
    expect(entry?.hint ?? '').toContain(path.resolve(companyDir, 'daemon.yaml'))
  })

  it('platform 非 localfile：exit 2 逐项明报；--json 带红项', async () => {
    writeFileSync(configPath, 'platform: taiga\ndb: "/abs/x.sqlite"\n')
    const res = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps()))
    expect(res.code).toBe(STACK_EXIT.doctor)
    expect(res.out.includes('FAIL')).toBe(true)
    expect(res.out.includes('platform=taiga')).toBe(true)
    const json = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--json'], deps()))
    const payload = JSON.parse(json.out) as { checks: { id: string; ok: boolean }[]; pass: boolean }
    expect(payload.pass).toBe(false)
    expect(payload.checks.find((c) => c.id === 'daemon-yaml')?.ok).toBe(false)
  })

  it('chatd 三件缺失（未 up 过的干净目录）：第 4 项红＋hint 指路', async () => {
    rmSync(path.join(companyDir, 'var', 'workbench'), { recursive: true, force: true })
    const res = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps()))
    expect(res.code).toBe(STACK_EXIT.doctor)
    expect(res.out.includes('chatd 权限')).toBe(true)
    expect(res.out.includes('缺失')).toBe(true)
  })

  it('注入低磁盘 statfs：第 6 项红 exit 2', async () => {
    const res = await capture(() =>
      cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps({ statfs: () => ({ bavail: 1, bsize: 1024 ** 3 }) })),
    )
    expect(res.code).toBe(STACK_EXIT.doctor)
    expect(res.out.includes('磁盘余量')).toBe(true)
  })

  it('注入 node 23：第 1 项红 exit 2', async () => {
    const res = await capture(() => cmdStack(['doctor', '--company-dir', companyDir, '--backup-dir', path.join(root, 'backups')], deps({ nodeVersion: '23.11.0' })))
    expect(res.code).toBe(STACK_EXIT.doctor)
    expect(res.out.includes('v23.11.0')).toBe(true)
  })

  it('缺 --company-dir：用法错 exit 1', async () => {
    const res = await capture(() => cmdStack(['doctor'], deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err.includes('--company-dir')).toBe(true)
  })
})

/* ---------------- 4. up / down（dry-run 缺省 + --apply） ---------------- */

describe('stack up', () => {
  it('dry-run：exit 0 零副作用——不写盘、不调 launchctl、三 bootstrap 命令预览', async () => {
    const res = await capture(() => cmdStack(upArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('dry-run（零副作用')).toBe(true)
    expect(res.out.match(/launchctl bootstrap gui\/\$\(id -u\)/g)?.length).toBe(3)
    expect(res.out.includes('<?xml')).toBe(true)
    expect(runCalls.length).toBe(0)
    expect(statSync(path.join(home, 'Library'), { throwIfNoEntry: false })).toBeUndefined() // 零副作用：LaunchAgents 未建
  })

  it('dry-run 前置缺件=软提醒不拦预览；--apply 缺件=硬拒 exit 1', async () => {
    rmSync(deployRoot, { recursive: true, force: true })
    const dry = await capture(() => cmdStack(upArgs(), deps()))
    expect(dry.code).toBe(STACK_EXIT.ok)
    expect(dry.out.includes('提醒')).toBe(true)
    expect(dry.out.includes('部署树不存在')).toBe(true)
    const apply = await capture(() => cmdStack(upArgs('--apply'), deps()))
    expect(apply.code).toBe(STACK_EXIT.usage)
    expect(apply.err.includes('前置缺件')).toBe(true)
    expect(runCalls.length).toBe(0)
  })

  it('--apply：plist 三件 0600 落盘；token 首产 64-hex 0600；bootout 先行＋bootstrap×3（gui/<uid>）', async () => {
    const res = await capture(() => cmdStack(upArgs('--apply'), deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    const agentsDir = path.join(home, 'Library', 'LaunchAgents')
    for (const label of ['io.studionext.daemon', 'io.studionext.chatd.demo-corp', 'io.studionext.panel.demo-corp']) {
      const st = statSync(path.join(agentsDir, `${label}.plist`))
      expect((st.mode & 0o777)).toBe(0o600)
    }
    const token = readFileSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), 'utf8')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(path.join(companyDir, 'var', 'workbench', 'chatd.token')).mode & 0o777).toBe(0o600)
    const boots = runCalls.filter((c) => c[1] === 'bootstrap')
    const outs = runCalls.filter((c) => c[1] === 'bootout')
    expect(boots.length).toBe(3)
    expect(outs.length).toBe(3)
    for (const call of boots) expect(call[2]).toBe('gui/501') // bootstrap=域＋plist
    for (const call of outs) expect(call[2]).toMatch(/^gui\/501\/io\.studionext\./) // bootout=域/label——先停后起（幂等重入）
  })

  it('--apply 幂等重入：token 不覆盖（值不变）；plist 同字节；输出「保留不覆盖」「幂等重写」', async () => {
    await capture(() => cmdStack(upArgs('--apply'), deps()))
    const tokenBefore = readFileSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), 'utf8')
    const plistBefore = readFileSync(path.join(home, 'Library', 'LaunchAgents', 'io.studionext.chatd.demo-corp.plist'), 'utf8')
    const res = await capture(() => cmdStack(upArgs('--apply'), deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('保留不覆盖')).toBe(true)
    expect(res.out.match(/幂等重写/g)?.length).toBe(3)
    expect(readFileSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), 'utf8')).toBe(tokenBefore)
    expect(readFileSync(path.join(home, 'Library', 'LaunchAgents', 'io.studionext.chatd.demo-corp.plist'), 'utf8')).toBe(plistBefore)
  })

  it('--apply bootstrap 失败：exit 1 明报，plist/数据仍就位', async () => {
    bootFails = true
    const res = await capture(() => cmdStack(upArgs('--apply'), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err.includes('bootstrap 失败')).toBe(true)
    expect(res.err.includes('exit 37')).toBe(true)
    expect(statSync(path.join(home, 'Library', 'LaunchAgents', 'io.studionext.daemon.plist'), { throwIfNoEntry: false })).toBeDefined()
  })

  it('win32 等其余平台：exit 3 明报 unsupported（up/down 双面；M5-2 起 Linux 走 systemd）', async () => {
    for (const args of [upArgs(), upArgs('--apply'), ['down', '--company-dir', companyDir]] as const) {
      const res = await capture(() => cmdStack([...args], deps({ platform: 'win32' })))
      expect(res.code).toBe(STACK_EXIT.unsupported)
      expect(res.err.includes('仅支持 macOS launchd 与 Linux systemd user')).toBe(true)
    }
    expect(runCalls.length).toBe(0)
  })

  it('linux 无 systemd user 会话：exit 3 明报 enable-linger 面（up/down 双面）', async () => {
    for (const args of [upArgs(), ['down', '--company-dir', companyDir]] as const) {
      const res = await capture(() => cmdStack([...args], deps({ platform: 'linux', systemdAvailable: false })))
      expect(res.code).toBe(STACK_EXIT.unsupported)
      expect(res.err.includes('/run/systemd/users/501')).toBe(true)
      expect(res.err.includes('enable-linger')).toBe(true)
    }
    expect(runCalls.length).toBe(0)
  })

  it('缺 --guardian-config / daemon.yaml 缺 db 键：用法错 exit 1', async () => {
    const noGuardian = await capture(() => cmdStack(['up', '--company-dir', companyDir, '--deploy-root', deployRoot, '--home', home], deps()))
    expect(noGuardian.code).toBe(STACK_EXIT.usage)
    expect(noGuardian.err.includes('--guardian-config')).toBe(true)
    writeFileSync(configPath, 'platform: localfile\n')
    const noDb = await capture(() => cmdStack(upArgs(), deps()))
    expect(noDb.code).toBe(STACK_EXIT.usage)
    expect(noDb.err.includes('db 键')).toBe(true)
  })
})

describe('stack down', () => {
  it('dry-run：exit 0 预览三 bootout；不调 launchctl；声明数据保留', async () => {
    const res = await capture(() => cmdStack(['down', '--company-dir', companyDir], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.match(/launchctl bootout gui\/\$\(id -u\)/g)?.length).toBe(3)
    expect(res.out.includes('保留面')).toBe(true)
    expect(runCalls.length).toBe(0)
  })

  it('--apply：bootout×3（gui/<uid>/<label>）；plist 与数据不动', async () => {
    await capture(() => cmdStack(upArgs('--apply'), deps()))
    runCalls.length = 0
    const res = await capture(() => cmdStack(['down', '--company-dir', companyDir, '--apply'], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    const outs = runCalls.filter((c) => c[1] === 'bootout')
    expect(outs.map((c) => c[2])).toEqual(['gui/501/io.studionext.daemon', 'gui/501/io.studionext.chatd.demo-corp', 'gui/501/io.studionext.panel.demo-corp'])
    expect(statSync(path.join(home, 'Library', 'LaunchAgents', 'io.studionext.daemon.plist'))).toBeDefined()
    expect(statSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'))).toBeDefined()
  })

  it('bootout 非 0（未加载）：视为已停，仍 exit 0', async () => {
    const res = await capture(() =>
      cmdStack(['down', '--company-dir', companyDir, '--apply'], deps({ run: () => ({ status: 5, stdout: '', stderr: 'No such process' }) })),
    )
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('未加载/已停')).toBe(true)
  })
})

/* ---------------- 5. 帮助面/用法面 ---------------- */

describe('stack 帮助面/用法面', () => {
  it('-h：exit 0，stdout 带 stack 帮助全文', async () => {
    const res = await capture(() => cmdStack(['-h'], deps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('studio-next stack status|doctor|up|down')).toBe(true)
  })

  it('裸命令：exit 1 缺少子命令；未知子命令：exit 1 带当前支持清单', async () => {
    const bare = await capture(() => cmdStack([], deps()))
    expect(bare.code).toBe(STACK_EXIT.usage)
    expect(bare.err.includes('缺少子命令')).toBe(true)
    const bad = await capture(() => cmdStack(['frobnicate'], deps()))
    expect(bad.code).toBe(STACK_EXIT.usage)
    expect(bad.err.includes('未知子命令：frobnicate')).toBe(true)
    expect(bad.err.includes('status、doctor、up、down')).toBe(true)
  })

  it('未知旗标/坏端口：exit 1 用法错', async () => {
    const unknown = await capture(() => cmdStack(['status', '--nope', 'x'], deps()))
    expect(unknown.code).toBe(STACK_EXIT.usage)
    const badPort = await capture(() => cmdStack(['status', '--port', 'abc'], deps()))
    expect(badPort.code).toBe(STACK_EXIT.usage)
    expect(badPort.err.includes('--port')).toBe(true)
  })
})
