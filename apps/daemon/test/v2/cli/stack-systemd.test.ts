// stack-systemd.test —— `studio-next stack` Linux systemd user 分支＋模板单一源测试（M5-2 第二刀；V2 套件）。
//
// 覆盖面（plan/08-§三 M5-2 验收）：
//   1. systemd 计划/渲染纯函数：三服务 label/unit 名/路径（缺省 ~/.config/systemd/user）、
//      ExecStart=node＋相对 deployRoot 入口＋WorkingDirectory、Restart=on-failure/RestartSec、
//      chatd Environment 四键带引号（token 只带路径）、EnvironmentFile 有无两态、幂等同字节
//   2. up/down（注入 platform=linux——测试零真 systemctl）：dry-run 零副作用零调用＋三 unit
//      预览；--apply unit 三件 0600（--user-units-dir 注入）＋daemon-reload 先行＋enable --now×3
//      顺序；幂等重入（token 不覆盖/unit 同字节）；enable 失败 exit 1；down disable --now×3
//      保 unit 与数据；未加载非零容错 exit 0
//   3. 模板单一源（M5-2 收敛）：chatd-setup.mjs 文本断言（import templates.ts、无本地模板体）；
//      plists.ts re-export 与 templates.ts 同一引用——BC-H2 唯一合法方向（scripts→apps）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cmdStack, STACK_EXIT, type StackDepsInit } from '../../../src/cli/stack/stack.ts'
import { CHATD_PLIST_TEMPLATE } from '../../../src/cli/stack/plists.ts'
import { CHATD_PLIST_TEMPLATE as CHATD_PLIST_FROM_TEMPLATES, CHATD_UNIT_TEMPLATE, DAEMON_UNIT_TEMPLATE, PANEL_UNIT_TEMPLATE } from '../../../src/cli/stack/templates.ts'
import { buildSystemdDownPlan, buildSystemdUpPlan, SYSTEMD_CONVENTIONS } from '../../../src/cli/stack/systemd.ts'

/* ---------------- 测试底座（与 stack.test.ts 同款——两文件各持一份避免跨文件耦合） ---------------- */

let root = ''
let home = ''
let workRoot = ''
let companyDir = ''
let configPath = ''
let guardianConfig = ''
let deployRoot = ''
let runCalls: string[][] = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stack-systemd-test-'))
  home = path.join(root, 'home')
  workRoot = path.join(root, 'work')
  companyDir = path.join(workRoot, 'demo-corp')
  configPath = path.join(companyDir, 'daemon.yaml')
  guardianConfig = path.join(workRoot, 'guardian.json')
  deployRoot = path.join(root, 'deploy')
  runCalls = []
  makeCompany()
  makeDeployTree()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** 健康 Company 夹具：daemon.yaml(platform=localfile+db) + var/workbench 三件 + guardian.json */
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

/** 可注入 deps（缺省=linux＋systemd 在场健康世界；绝不真调 systemctl/真探针） */
function deps(over: StackDepsInit = {}): StackDepsInit {
  return {
    platform: 'linux',
    nodeVersion: '24.21.0',
    home,
    env: {},
    uid: 501,
    systemdAvailable: true,
    run: (argv) => {
      runCalls.push([...argv])
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
/* ---------------- 7. systemd 计划/渲染纯函数（M5-2） ---------------- */

describe('stack/systemd：计划/渲染纯函数', () => {
  const baseInput = (): Parameters<typeof buildSystemdUpPlan>[0] => ({
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

  it('三服务计划：label/unit 名/路径；缺省单元目录=~/.config/systemd/user；无 __ 残留', () => {
    const plan = buildSystemdUpPlan(baseInput())
    expect(plan.services.map((s) => s.id)).toEqual(['daemon', 'chatd', 'panel'])
    expect(plan.services.map((s) => s.unitName)).toEqual([
      'io.studionext.daemon.service',
      'io.studionext.chatd.demo-corp.service',
      'io.studionext.panel.demo-corp.service',
    ])
    expect(plan.unitDir).toBe(path.join(home, '.config', 'systemd', 'user'))
    for (const service of plan.services) {
      expect(service.unitPath, service.id).toBe(path.join(plan.unitDir, service.unitName))
      expect(service.unit.includes('__'), service.id).toBe(false)
    }
    expect(plan.reloadCmd).toBe('systemctl --user daemon-reload')
  })

  it('daemon unit：ExecStart=node+相对入口 scripts/guardian.mjs；WorkingDirectory；Restart 面', () => {
    const plan = buildSystemdUpPlan(baseInput())
    const daemon = plan.services.find((s) => s.id === 'daemon')?.unit ?? ''
    expect(daemon.includes(`ExecStart=/usr/local/bin/node scripts/guardian.mjs --config ${guardianConfig}`)).toBe(true)
    expect(daemon.includes(`WorkingDirectory=${deployRoot}`)).toBe(true)
    expect(daemon.includes('Restart=on-failure')).toBe(true)
    expect(daemon.includes(`RestartSec=${String(SYSTEMD_CONVENTIONS.restartSec)}`)).toBe(true)
    expect(daemon.includes('WantedBy=default.target')).toBe(true)
    expect(daemon.includes('io.studionext.daemon')).toBe(true)
  })

  it('chatd unit：相对入口＋--experimental-strip-types；Environment 四键带引号；token 只带路径', () => {
    const plan = buildSystemdUpPlan(baseInput())
    const chatd = plan.services.find((s) => s.id === 'chatd')?.unit ?? ''
    expect(chatd.includes('ExecStart=/usr/local/bin/node --experimental-strip-types apps/workbench-chatd/src/main.ts')).toBe(true)
    const varDir = path.join(companyDir, 'var', 'workbench')
    expect(chatd.includes(`Environment="WORKBENCH_CHATD_SOCKET=${path.join(varDir, 'chat.sock')}"`)).toBe(true)
    expect(chatd.includes(`Environment="WORKBENCH_CHATD_DB=${path.join(varDir, 'chat.db')}"`)).toBe(true)
    expect(chatd.includes(`Environment="WORKBENCH_CHATD_TOKEN_FILE=${path.join(varDir, 'chatd.token')}"`)).toBe(true)
    expect(chatd.includes('Environment="WORKBENCH_CHATD_LOG=info"')).toBe(true)
    expect(chatd.includes('a'.repeat(64))).toBe(false) // 值不入模板——只 TOKEN_FILE 路径
  })

  it('panel unit：相对入口 CLI main.ts panel --db/--company-dir/--port（绝对值）', () => {
    const plan = buildSystemdUpPlan(baseInput())
    const panel = plan.services.find((s) => s.id === 'panel')?.unit ?? ''
    expect(panel.includes('ExecStart=/usr/local/bin/node --experimental-strip-types apps/daemon/src/cli/main.ts panel')).toBe(true)
    expect(panel.includes('--db /abs/ledger.sqlite')).toBe(true)
    expect(panel.includes(`--company-dir ${companyDir}`)).toBe(true)
    expect(panel.includes('--port 8791')).toBe(true)
  })

  it('EnvironmentFile 有无两态：缺省=自述注释行；--env-file=三 unit 全带绝对路径行', () => {
    const without = buildSystemdUpPlan(baseInput())
    for (const service of without.services) {
      expect(service.unit.includes('EnvironmentFile='), service.id).toBe(false)
      expect(service.unit.includes('# EnvironmentFile 未指定'), service.id).toBe(true)
    }
    const envFile = path.join(root, 'secrets', 'daemon.env')
    const withFile = buildSystemdUpPlan({ ...baseInput(), envFile })
    expect(withFile.envFile).toBe(envFile)
    for (const service of withFile.services) expect(service.unit.includes(`EnvironmentFile=${envFile}`), service.id).toBe(true)
  })

  it('幂等：同输入两次 buildSystemdUpPlan → 三 unit 逐字节相同；--user-units-dir 注入口生效', () => {
    const unitsDir = path.join(root, 'units')
    const a = buildSystemdUpPlan({ ...baseInput(), userUnitsDir: unitsDir })
    const b = buildSystemdUpPlan({ ...baseInput(), userUnitsDir: unitsDir })
    expect(a.services.map((s) => s.unit)).toEqual(b.services.map((s) => s.unit))
    expect(a.unitDir).toBe(unitsDir)
  })

  it('buildSystemdDownPlan：disable --now 三 unit（.service 后缀）；unit 名单源同 label 判例', () => {
    const plan = buildSystemdDownPlan({ companyDir, labelPrefix: 'io.studionext' })
    expect(plan.disableCmds).toEqual([
      'systemctl --user disable --now io.studionext.daemon.service',
      'systemctl --user disable --now io.studionext.chatd.demo-corp.service',
      'systemctl --user disable --now io.studionext.panel.demo-corp.service',
    ])
  })
})

/* ---------------- 8. up/down Linux systemd 分支（M5-2；零真 systemctl） ---------------- */

describe('stack up/down（Linux systemd user）', () => {
  const linuxDeps = (over: StackDepsInit = {}): StackDepsInit => deps({ platform: 'linux', ...over })

  it('up dry-run：exit 0 零副作用——不建 ~/.config、零 systemctl；daemon-reload＋enable --now×3 预览＋三 unit 全文', async () => {
    const res = await capture(() => cmdStack(upArgs(), linuxDeps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('systemd user')).toBe(true)
    expect(res.out.includes('systemctl --user daemon-reload')).toBe(true)
    expect(res.out.match(/systemctl --user enable --now io\.studionext\./g)?.length).toBe(3)
    expect(res.out.match(/\[Unit\]/g)?.length).toBe(3)
    expect(res.out.includes('journalctl --user -u')).toBe(true)
    expect(runCalls.length).toBe(0)
    expect(statSync(path.join(home, '.config'), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('up --apply：unit 三件 0600 落盘（--user-units-dir 注入）；daemon-reload 先行＋enable --now×3 顺序', async () => {
    const unitsDir = path.join(root, 'units')
    const res = await capture(() => cmdStack(upArgs('--apply', '--user-units-dir', unitsDir, '--env-file', path.join(root, 'daemon.env')), linuxDeps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    for (const unitName of ['io.studionext.daemon.service', 'io.studionext.chatd.demo-corp.service', 'io.studionext.panel.demo-corp.service']) {
      const st = statSync(path.join(unitsDir, unitName))
      expect(st.mode & 0o777).toBe(0o600)
    }
    const chatdUnit = readFileSync(path.join(unitsDir, 'io.studionext.chatd.demo-corp.service'), 'utf8')
    expect(chatdUnit.includes(`EnvironmentFile=${path.join(root, 'daemon.env')}`)).toBe(true)
    expect(runCalls[0]).toEqual(['systemctl', '--user', 'daemon-reload'])
    const enables = runCalls.filter((c) => c[2] === 'enable')
    expect(enables.length).toBe(3)
    expect(enables.map((c) => c[4])).toEqual(['io.studionext.daemon.service', 'io.studionext.chatd.demo-corp.service', 'io.studionext.panel.demo-corp.service'])
    for (const call of enables) expect(call.slice(0, 4)).toEqual(['systemctl', '--user', 'enable', '--now'])
  })

  it('up --apply 幂等重入：token 保留不覆盖；unit 同字节重写', async () => {
    const unitsDir = path.join(root, 'units')
    await capture(() => cmdStack(upArgs('--apply', '--user-units-dir', unitsDir), linuxDeps()))
    const tokenBefore = readFileSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), 'utf8')
    const unitBefore = readFileSync(path.join(unitsDir, 'io.studionext.chatd.demo-corp.service'), 'utf8')
    runCalls.length = 0
    const res = await capture(() => cmdStack(upArgs('--apply', '--user-units-dir', unitsDir), linuxDeps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.includes('保留不覆盖')).toBe(true)
    expect(res.out.match(/幂等重写/g)?.length).toBe(3)
    expect(readFileSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), 'utf8')).toBe(tokenBefore)
    expect(readFileSync(path.join(unitsDir, 'io.studionext.chatd.demo-corp.service'), 'utf8')).toBe(unitBefore)
  })

  it('up --apply enable 失败：exit 1 明报 journalctl 查因；unit/数据仍就位', async () => {
    const unitsDir = path.join(root, 'units')
    const res = await capture(() =>
      cmdStack(
        upArgs('--apply', '--user-units-dir', unitsDir),
        linuxDeps({ run: (argv) => (argv[2] === 'enable' ? { status: 1, stdout: '', stderr: 'Failed to start: Unit not found' } : { status: 0, stdout: '', stderr: '' }) }),
      ),
    )
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err.includes('enable 失败')).toBe(true)
    expect(res.err.includes('journalctl')).toBe(true)
    expect(statSync(path.join(unitsDir, 'io.studionext.daemon.service'), { throwIfNoEntry: false })).toBeDefined()
  })

  it('up dry-run 前置缺件=软提醒；--apply 缺件=硬拒 exit 1（双分支同款两档体检）', async () => {
    rmSync(deployRoot, { recursive: true, force: true })
    const dry = await capture(() => cmdStack(upArgs(), linuxDeps()))
    expect(dry.code).toBe(STACK_EXIT.ok)
    expect(dry.out.includes('部署树不存在')).toBe(true)
    const apply = await capture(() => cmdStack(upArgs('--apply'), linuxDeps()))
    expect(apply.code).toBe(STACK_EXIT.usage)
    expect(apply.err.includes('前置缺件')).toBe(true)
    expect(runCalls.length).toBe(0)
  })

  it('down dry-run：exit 0 预览 disable --now×3；不调 systemctl；声明数据保留', async () => {
    const res = await capture(() => cmdStack(['down', '--company-dir', companyDir], linuxDeps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    expect(res.out.match(/systemctl --user disable --now io\.studionext\./g)?.length).toBe(3)
    expect(res.out.includes('保留面')).toBe(true)
    expect(runCalls.length).toBe(0)
  })

  it('down --apply：disable --now×3（unit 名）；unit 文件与数据全保留；未加载非零容错 exit 0', async () => {
    const unitsDir = path.join(root, 'units')
    await capture(() => cmdStack(upArgs('--apply', '--user-units-dir', unitsDir), linuxDeps()))
    runCalls.length = 0
    const res = await capture(() => cmdStack(['down', '--company-dir', companyDir, '--apply'], linuxDeps()))
    expect(res.code).toBe(STACK_EXIT.ok)
    const disables = runCalls.filter((c) => c[2] === 'disable')
    expect(disables.length).toBe(3)
    expect(disables.map((c) => c[4])).toEqual(['io.studionext.daemon.service', 'io.studionext.chatd.demo-corp.service', 'io.studionext.panel.demo-corp.service'])
    for (const unitName of ['io.studionext.daemon.service', 'io.studionext.chatd.demo-corp.service', 'io.studionext.panel.demo-corp.service']) {
      expect(statSync(path.join(unitsDir, unitName), { throwIfNoEntry: false })).toBeDefined() // down 不删 unit
    }
    expect(statSync(path.join(companyDir, 'var', 'workbench', 'chatd.token'), { throwIfNoEntry: false })).toBeDefined() // 数据保留
    const unloaded = await capture(() => cmdStack(['down', '--company-dir', companyDir, '--apply'], linuxDeps({ run: () => ({ status: 5, stdout: '', stderr: 'Unit not loaded' }) })))
    expect(unloaded.code).toBe(STACK_EXIT.ok)
    expect(unloaded.out.includes('未加载/已停')).toBe(true)
  })
})

/* ---------------- 9. 模板单一源（M5-2 收敛——文本断言，不 import scripts/） ---------------- */

describe('模板单一源（chatd-setup.mjs ↔ templates.ts）', () => {
  const CHATD_SETUP_PATH = fileURLToPath(new URL('../../../../../scripts/ops/chatd-setup.mjs', import.meta.url))

  it('chatd-setup.mjs 引用共享模板：import 指向 templates.ts；仓内无本地 PLIST_TEMPLATE 模板体', () => {
    const text = readFileSync(CHATD_SETUP_PATH, 'utf8')
    expect(text.includes("from '../../apps/daemon/src/cli/stack/templates.ts'")).toBe(true)
    expect(/export const PLIST_TEMPLATE = `/.test(text)).toBe(false) // 本地模板体必须绝迹（re-export 除外）
  })

  it('plists.ts 的 CHATD_PLIST_TEMPLATE 与 templates.ts 同一引用（re-export 不复制）', () => {
    expect(CHATD_PLIST_TEMPLATE).toBe(CHATD_PLIST_FROM_TEMPLATES)
  })

  it('systemd 三模板落在 templates.ts 单一源（本测试即 import 面——BC-H2 合法方向）', () => {
    expect(DAEMON_UNIT_TEMPLATE.includes('scripts/guardian.mjs')).toBe(true)
    expect(CHATD_UNIT_TEMPLATE.includes('apps/workbench-chatd/src/main.ts')).toBe(true)
    expect(PANEL_UNIT_TEMPLATE.includes('apps/daemon/src/cli/main.ts')).toBe(true)
    for (const template of [DAEMON_UNIT_TEMPLATE, CHATD_UNIT_TEMPLATE, PANEL_UNIT_TEMPLATE]) {
      expect(template.includes('__DEPLOY_ROOT__')).toBe(true)
      expect(template.includes('__ENV_FILE_LINE__')).toBe(true)
    }
  })
})
