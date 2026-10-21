/**
 * CLI 分面 help / 错误面守门（studio-dev-103 S1，studio-dev-125 实施；docs/20-§五：新特性
 * 同 PR 带测试）。七态矩阵 + 单源装配对账 + 拼写建议 + `--flag=value` 内联式。
 *
 * 契约（help.ts 头注冻结）：
 *   - 流分面（治 E7）：错误行→stderr；帮助面（简段/全文段/全文）→stdout
 *   - 退出码：显式求助（-h/--help/help）=0；用法错（缺参/未知旗标/裸命令/未知子命令）=1
 *   - 裸命令=错误行+简段+exit 1（制作人 2026-10-21 批示 S1c-B——原 ledger/candidates 裸组 0→1）
 *   - 预检（治 E9）：-h/--help/help 先于位置参数解析、零副作用（不碰库/不建目录/不克隆）
 *   - 顶级 typo（治 E8）：不再倾倒 64 行全文——did-you-mean + 已知命令一行（S1d）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { CONCISE, SECTION, USAGE, USAGE_HEADER, USAGE_TAIL } from '../../src/cli/usage.ts'
import { suggestNear, wantsHelp } from '../../src/cli/help.ts'
import { parseArgv } from '../../src/cli/argv.ts'
import { cmdInit } from '../../src/cli/init.ts'
import { cmdCompany } from '../../src/cli/company.ts'
import { cmdValidate } from '../../src/cli/validate.ts'
import { cmdLedger } from '../../src/cli/ledger.ts'
import { cmdCandidates } from '../../src/cli/candidates.ts'
import { cmdPanel } from '../../src/cli/panel.ts'
import { cmdSandbox } from '../../src/cli/sandbox.ts'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))

/** 捕获两流跑 cmd*（in-process；副作用面断言要求预检在一切 IO 之前） */
async function runCmd(fn: (argv: string[]) => Promise<number>, argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const logs: string[] = []
  const errors: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')))
  try {
    const code = await fn(argv)
    return { code, out: logs.join('\n'), err: errors.join('\n') }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
}

describe('单源装配对账（S1a：usage.ts=命令文档唯一源）', () => {
  it('SECTION 与 CONCISE 键集全等（增删命令必须两处同改）', () => {
    expect(Object.keys(SECTION).sort()).toEqual(Object.keys(CONCISE).sort())
  })

  it('USAGE=头+Σ全文段+尾（机械装配，不许手写全文）', () => {
    expect(USAGE).toBe(USAGE_HEADER + Object.values(SECTION).join('') + USAGE_TAIL)
  })

  it('16 顶级命令齐全（main.ts 分发表=SECTION 键集）', () => {
    expect(Object.keys(SECTION)).toEqual([
      'init', 'company', 'validate', 'ledger', 'candidates', 'sandbox', 'cutover', 'gray',
      'postmortem', 'panel', 'overview', 'external', 'serve', 'taiga-cure', 'reload', 'stop',
    ])
  })

  it('每条简段自带看全文指引（错误面是路标不是死端）', () => {
    for (const [key, text] of Object.entries(CONCISE)) {
      expect(text.includes(key === 'company' || key === 'ledger' ? '本组全文' : '本命令全文'), `${key} 简段缺看全文指引`).toBe(true)
    }
  })

  it('全文段命令行均以 studio-next 开头（可复制即用）', () => {
    for (const [key, text] of Object.entries(SECTION)) {
      expect(text.includes(`studio-next ${key === 'taiga-cure' ? 'taiga-cure' : key}`), `${key} 全文段缺命令行`).toBe(true)
    }
  })
})

describe('拼写建议 suggestNear（S1d：did-you-mean，零依赖手写）', () => {
  it('编辑距离 ≤2 命中：sandboxe→sandbox / companyy→company / dril→drill', () => {
    expect(suggestNear('sandboxe', ['init', 'company', 'sandbox'])).toBe('sandbox')
    expect(suggestNear('companyy', ['init', 'company', 'sandbox'])).toBe('company')
    expect(suggestNear('dril', ['drill', 'dump', 'rebuild'])).toBe('drill')
  })

  it('≥3 字符前缀命中：cand→candidates / pos→postmortem', () => {
    expect(suggestNear('cand', ['init', 'candidates', 'cutover'])).toBe('candidates')
    expect(suggestNear('pos', ['panel', 'postmortem', 'stop'])).toBe('postmortem')
  })

  it('无近邻=undefined：lst 在 company 组（无 list）不猜', () => {
    expect(suggestNear('lst', ['add', 'create', 'validate'])).toBeUndefined()
    expect(suggestNear('zzz', ['init', 'company'])).toBeUndefined()
  })
})

describe('求助预检 wantsHelp（S1b：任何位置出现即出面）', () => {
  it('-h / --help / help 任一位命中', () => {
    expect(wantsHelp(['-h'])).toBe(true)
    expect(wantsHelp(['--help'])).toBe(true)
    expect(wantsHelp(['help'])).toBe(true)
    expect(wantsHelp(['--db', 'x', '-h'])).toBe(true)
    expect(wantsHelp(['init', 'help'])).toBe(true)
  })

  it('普通参数不误触', () => {
    expect(wantsHelp(['init'])).toBe(false)
    expect(wantsHelp(['--db', 'helper.sqlite'])).toBe(false)
    expect(wantsHelp([])).toBe(false)
  })
})

describe('七态矩阵（流分面+退出码——E7 治理面）', () => {
  it('态1 显式求助：panel -h → 全文段→stdout、exit 0、零副作用（坏库路径也不碰）', async () => {
    const r = await runCmd(cmdPanel, ['-h', '--db', '/nonexistent/panic.sqlite'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('studio-next panel --db')
    expect(r.err).toBe('')
  })

  it('态1b 预检先于参数校验：validate --help extra → 仍 exit 0（不报多余参数）', async () => {
    const r = await runCmd(cmdValidate, ['--help', 'extra'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('校验公司目录结构')
  })

  it('态1c 组内子命令求助：company add --help → 组全文段（先于 clone 零副作用）', async () => {
    const r = await runCmd(cmdCompany, ['add', '--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('git 网址即公司')
    expect(r.err).toBe('')
  })

  it('态2 裸单命令：init → 错误行→stderr+简段→stdout、exit 1（不再倾倒全文）', async () => {
    const r = await runCmd(cmdInit, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain('init：缺少 <slug>')
    expect(r.out).toContain('本命令全文：studio-next init --help')
    expect(r.out).not.toContain('taiga-cure')
  })

  it('态2b 裸组命令：ledger → 缺子命令、exit 1（S1c-B 批示——原 exit 0 收敛）', async () => {
    const r = await runCmd(cmdLedger, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain('ledger：缺少子命令（当前支持：drill、dump、rebuild）')
    expect(r.out).toContain('drill（删库重建演习）')
  })

  it('态2c 裸组命令：candidates → 缺子命令、exit 1（同上）', async () => {
    const r = await runCmd(cmdCandidates, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain('candidates：缺少子命令')
  })

  it('态3 缺参：sandbox 缺 --candidate → 简段、exit 1', async () => {
    const r = await runCmd(cmdSandbox, ['--db', '/nonexistent/x.sqlite'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('sandbox：缺少 --candidate')
    expect(r.out).toContain('进化链沙箱执行器')
  })

  it('态4 未知旗标：init x --bogus → 简段、exit 1', async () => {
    const r = await runCmd(cmdInit, ['x', '--bogus', 'y'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('init：未知参数：--bogus')
  })

  it('态4b validate 的旗标形令牌拒收（原当目录名去 scandir——E12 附带治理）', async () => {
    const r = await runCmd(cmdValidate, ['--json'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('未知旗标：--json')
    expect(r.out).toContain('本命令全文：studio-next validate --help')
  })

  it('态5 组内 typo：ledger dril → 是否想说 drill、exit 1', async () => {
    const r = await runCmd(cmdLedger, ['dril'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('是否想说 drill')
  })

  it('态5b 组内 typo 无近邻：company lst → 列已知子命令、不猜、exit 1', async () => {
    const r = await runCmd(cmdCompany, ['lst'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('company：未知子命令：lst（当前支持：add、create、validate、check）')
    expect(r.err).not.toContain('是否想说')
  })

  it('态6 组 -h/--help/help：三种令牌同面 → 组全文段、exit 0', async () => {
    for (const token of ['-h', '--help', 'help']) {
      const r = await runCmd(cmdCandidates, [token])
      expect(r.code, token).toBe(0)
      expect(r.out, token).toContain('candidates list --db')
    }
  })

  it('态7 顶级 typo（spawn 面）：sandboxe → stderr did-you-mean+stdout 已知命令一行、exit 1、不倾倒全文', () => {
    const res = spawnSync(process.execPath, [BIN, 'sandboxe', '--db', 'x'], { encoding: 'utf8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('未知子命令：sandboxe——是否想说 sandbox？')
    expect(res.stdout).toContain('已知命令：init、company、validate、ledger')
    expect(res.stdout).not.toContain('删库重建演习')
  })

  it('顶级 --help（spawn 面）：全文=USAGE 装配、exit 0', () => {
    const res = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(USAGE_HEADER.trimEnd())
    expect(res.stdout).toContain(USAGE_TAIL.trimEnd())
  })
})

describe('argv 内联式 --flag=value（E12/F5：加法式，两式并存）', () => {
  const VF = new Set(['db', 'candidate'])

  it('内联式与空格式同效', () => {
    expect(parseArgv(['--db=x', 'y'], VF)).toEqual(parseArgv(['--db', 'x', 'y'], VF))
    expect(parseArgv(['x', '--candidate=c-1'], VF)).toEqual(parseArgv(['x', '--candidate', 'c-1'], VF))
  })

  it('空值内联=用法错（--db= 不容忍）', () => {
    expect(parseArgv(['--db='], VF)).toEqual({ error: '--db= 缺少取值' })
  })

  it('布尔旗标不收内联值（--dry-run=1 明报）', () => {
    expect(parseArgv(['--dry-run=1'], new Set(), undefined, new Set(['dry-run']))).toEqual({
      error: '布尔旗标 --dry-run 不收值（去掉 =1）',
    })
  })

  it('可重复旗标内联式照收进 multi（空格式同款）', () => {
    expect(parseArgv(['--company=a', '--company=b'], new Set(['company']), new Set(['company']))).toEqual(
      parseArgv(['--company', 'a', '--company', 'b'], new Set(['company']), new Set(['company'])),
    )
  })
})
