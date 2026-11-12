/**
 * 787 P0-1：每公司 seatbelt 写根围栏（parseDaemonConfig 真路径）
 * 只允许本公司 <CROOT>/.AIWS|workspaces + 基础设施白名单；禁全局 <WORKROOT>/.AIWS/跨公司/任意绝对路径。
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkCompanySeatbeltWriteRoots, detectCompanyLayout, parseDaemonConfig, validateCompanySeatbeltWriteRoots } from '../../../src/assembly/serve/config.ts'

const WORKROOT = '/srv/787-seatbelt-work'
const COMPANY_DIR = `${WORKROOT}/demo/company`
const cleanups: string[] = []
afterEach(() => { for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const REPO_PARENT = path.dirname(process.cwd())
function repoTemp(prefix: string): string {
  // 仓外兄弟临时目录（不污染仓根扫描）；环境若把该路径放进 /private/tmp 通用白名单，
  // 真实路径放行不能当规则证据——规则拒绝面另用 synthetic /srv 路径经纯函数断言。
  const dir = mkdtempSync(path.join(REPO_PARENT, `.sn-787v4-${prefix}-`))
  cleanups.push(dir)
  return dir
}

function yamlWithRoots(roots: string[], companyDir = COMPANY_DIR): string {
  return [
    'db: /tmp/787-demo/var/ledger.sqlite',
    'platform: localfile',
    'company: demo',
    `companyDir: ${companyDir}`,
    'rootDir: /tmp/787-demo/var',
    'maxInflight: 4',
    'jobs: false',
    'seatbeltTier: workspace-write',
    `seatbeltWriteRoots: '${JSON.stringify(roots)}'`,
    `seatbeltAuthorization: '制作人批准（测试夹具）'`,
  ].join('\n')
}

describe('787：每公司 seatbeltWriteRoots 校验', () => {
  it('本公司 .AIWS/workspaces + 基础设施白名单 → 通过', () => {
    const cfg = parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/.AIWS`, `${COMPANY_DIR}/workspaces`, `${process.env.HOME ?? '/tmp'}/.dsh`, '/private/tmp', '/private/var/folders/xx']))
    expect(cfg.seatbelt?.writeRoots).toContain(`${WORKROOT}/demo/.AIWS`)
  })

  it('全局 <WORKROOT>/.AIWS（越出本公司根）→ CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/.AIWS`]))).toThrow(/越出本公司根|787/)
  })

  it('其它公司根/任意绝对路径 → CONFIG_INVALID', () => {
    expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/other/.AIWS`]))).toThrow(/787/)
    expect(() => parseDaemonConfig(yamlWithRoots(['/etc']))).toThrow(/白名单/)
  })

  it('公司根内但不在 .AIWS/workspaces 子域 → CONFIG_INVALID（防越权写公司目录其它面）', () => {
    expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/company/docs`]))).toThrow(/\.AIWS|workspaces/)
  })

  it('未配 companyDir 时不误判（单测直构注入面不受影响）', () => {
    const cfg = parseDaemonConfig([
      'db: /tmp/x/var/ledger.sqlite', 'platform: localfile', 'company: demo', 'maxInflight: 4', 'jobs: false',
      'seatbeltTier: workspace-write', `seatbeltWriteRoots: '${JSON.stringify(['/tmp/whatever/.AIWS'])}'`, "seatbeltAuthorization: 'x'",
    ].join('\n'))
    expect(cfg.seatbelt?.writeRoots).toEqual(['/tmp/whatever/.AIWS'])
  })

  it('纯函数直调：同一规则可复用（validateCompanySeatbeltWriteRoots）', () => {
    expect(() => validateCompanySeatbeltWriteRoots({ tier: 'workspace-write', writeRoots: [`${WORKROOT}/demo/.AIWS`], authorization: 'x' }, COMPANY_DIR)).not.toThrow()
  })

  it('F1：companyRoot 下 symlink→/etc → CONFIG_INVALID 且错误含 realpath', () => {
    const w = mkdtempSync(path.join(tmpdir(), 'sn-787-sym-'))
    try {
      const companyDir = path.join(w, 'demo', 'company')
      mkdirSync(companyDir, { recursive: true })
      symlinkSync('/etc', path.join(w, 'demo', 'link'))
      expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, 'demo', 'link', '.AIWS')], companyDir))).toThrow(/realpath=\/etc|白名单/)
    } finally { rmSync(w, { recursive: true, force: true }) }
  })

  it('F1：symlink→非白名单系统目录（/usr/local，真实 symlink）→ CONFIG_INVALID', () => {
    const w = mkdtempSync(path.join(tmpdir(), 'sn-787-sym2-'))
    try {
      const companyDir = path.join(w, 'demo', 'company')
      mkdirSync(companyDir, { recursive: true })
      symlinkSync('/usr/local', path.join(w, 'demo', 'link'))
      expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, 'demo', 'link', '.AIWS')], companyDir))).toThrow(/787/)
    } finally { rmSync(w, { recursive: true, force: true }) }
  })

  it('F1：兄弟公司/.. 逃逸（synthetic 公司树，canonical 后判归属）→ cross-company', () => {
    const companyDir = '/srv/787-work/demo/company'
    const base = { tier: 'workspace-write' as const, authorization: 'x' }
    const violations = checkCompanySeatbeltWriteRoots(
      { ...base, writeRoots: ['/srv/787-work/other/.AIWS', '/srv/787-work/.AIWS', '/srv/787-work/demo/company/../../.AIWS'] },
      companyDir,
    )
    expect(violations.map((v) => v.reason)).toEqual(['cross-company', 'cross-company', 'cross-company'])
    expect(() => validateCompanySeatbeltWriteRoots({ ...base, writeRoots: ['/srv/787-work/other/.AIWS'] }, companyDir)).toThrow(/realpath=/)
  })

  it('F1：不存在 root 但父目录 symlink→/etc → CONFIG_INVALID', () => {
    const w = mkdtempSync(path.join(tmpdir(), 'sn-787-sym3-'))
    try {
      const companyDir = path.join(w, 'demo', 'company')
      mkdirSync(companyDir, { recursive: true })
      symlinkSync('/etc', path.join(w, 'demo', 'linkdir'))
      expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, 'demo', 'linkdir', 'nonexistent', '.AIWS')], companyDir))).toThrow(/787/)
    } finally { rmSync(w, { recursive: true, force: true }) }
  })

  it('F1：真实合法根（<CROOT>/.AIWS 子树/workspaces 子树）仍通过', () => {
    const w = mkdtempSync(path.join(tmpdir(), 'sn-787-ok-'))
    try {
      const companyDir = path.join(w, 'demo', 'company')
      mkdirSync(path.join(w, 'demo', '.AIWS', 'sub'), { recursive: true })
      mkdirSync(path.join(companyDir, 'workspaces', 'sub'), { recursive: true })
      const cfg = parseDaemonConfig(yamlWithRoots([path.join(w, 'demo', '.AIWS', 'sub'), path.join(companyDir, 'workspaces', 'sub')], companyDir))
      expect(cfg.seatbelt?.writeRoots).toHaveLength(2)
    } finally { rmSync(w, { recursive: true, force: true }) }
  })

  it('F2：<CROOT>/company/docs/.AIWS 与 <CROOT>/x/workspaces/y 均拒（segment 过宽已修）', () => {
    expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/company/docs/.AIWS`]))).toThrow(/白名单/)
    expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/x/workspaces/y`]))).toThrow(/白名单/)
  })

  it('F1：大小写语义按平台断言（darwin 不敏感；其它平台大小写敏感）', () => {
    if (process.platform === 'darwin') {
      // macOS 大小写不敏感：`.aiws` 视同 `.AIWS`，必须按规范根接受（不是绕过）
      expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/.aiws`]))).not.toThrow()
      expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/DEMO/.AIWS`]))).not.toThrow()
    } else {
      // 大小写敏感平台：`.aiws` 不等于 `.AIWS` → 公司根内但不在规范根 → CONFIG_INVALID；`DEMO` 越出公司根 → CONFIG_INVALID
      expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/demo/.aiws`]))).toThrow(/787|白名单/)
      expect(() => parseDaemonConfig(yamlWithRoots([`${WORKROOT}/DEMO/.AIWS`]))).toThrow(/787/)
    }
  })

  it('v4：扁平布局（profit）companyDir 本身=公司根 → <companyDir>/.AIWS 与 <companyDir>/workspaces 通过', () => {
    const w = repoTemp('flat')
    const profit = path.join(w, 'studio-profit')
    mkdirSync(profit, { recursive: true })
    writeFileSync(path.join(profit, 'daemon.yaml'), '# marker\n', 'utf8')
    expect(detectCompanyLayout(profit).layout).toBe('flat')
    // 合法根：扁平布局 <companyDir>=<CROOT>，写域只有 <companyDir>/.AIWS 与 <companyDir>/workspaces
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(profit, '.AIWS'), path.join(profit, 'workspaces')], profit))).not.toThrow()
    // profit 旧全局根 = <WORKROOT>/.AIWS（dirname(companyDir)/.AIWS）→ cross-company 拒
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, '.AIWS')], profit))).toThrow(/787/)
    // 兄弟公司根 → 拒
    mkdirSync(path.join(w, 'studio-dev', '.AIWS'), { recursive: true })
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, 'studio-dev', '.AIWS')], profit))).toThrow(/787/)
    // 白名单规则：扁平布局下 companyDir/company/workspaces 不在写域（<companyDir>/workspaces 才是）→ not-whitelisted。
    // 用 synthetic /srv 纯函数断言，避免仓在 /private/tmp 时被基础设施通用根“放过”造成假绿。
    expect(
      checkCompanySeatbeltWriteRoots(
        { tier: 'workspace-write', writeRoots: ['/srv/787-work/profit/company/workspaces'], authorization: 'x' },
        '/srv/787-work/profit',
        'flat',
      ).map((v) => v.reason),
    ).toEqual(['not-whitelisted'])
  })

  it('v4：嵌套布局（studio-dev）companyDir 父目录=公司根 → <CROOT>/.AIWS 通过；全局/兄弟仍拒', () => {
    const w = repoTemp('nested')
    const croot = path.join(w, 'studio-dev')
    const companyDir = path.join(croot, 'company')
    mkdirSync(companyDir, { recursive: true })
    writeFileSync(path.join(croot, 'daemon.yaml'), '# marker\n', 'utf8')
    expect(detectCompanyLayout(companyDir).layout).toBe('nested')
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(croot, '.AIWS'), path.join(companyDir, 'workspaces')], companyDir))).not.toThrow()
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, '.AIWS')], companyDir))).toThrow(/787/)
    expect(() => parseDaemonConfig(yamlWithRoots([path.join(w, 'studio-profit', '.AIWS')], companyDir))).toThrow(/787/)
  })

  it('v4：扁平布局 pure 面（forced layout）与 multicompy 同源函数一致', () => {
    const base = { tier: 'workspace-write' as const, authorization: 'x' }
    expect(checkCompanySeatbeltWriteRoots({ ...base, writeRoots: ['/srv/787-work/profit/.AIWS'] }, '/srv/787-work/profit', 'flat')).toEqual([])
    expect(checkCompanySeatbeltWriteRoots({ ...base, writeRoots: ['/srv/787-work/.AIWS'] }, '/srv/787-work/profit', 'flat').map((v) => v.reason)).toEqual(['cross-company'])
    expect(checkCompanySeatbeltWriteRoots({ ...base, writeRoots: ['/srv/787-work/other/.AIWS'] }, '/srv/787-work/profit', 'flat').map((v) => v.reason)).toEqual(['cross-company'])
  })
})
