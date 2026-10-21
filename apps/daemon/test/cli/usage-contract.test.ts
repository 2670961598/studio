/**
 * CLI 声明面守门（studio-dev-103 S5，studio-dev-125 实施；docs/20-§五）：
 * 语法归位表/旗标同义表/退出码表/版本声明（S5a/b/c）——正文单一源=usage.ts 尾部，
 * 本文件锁「声明的每一条都被行为兑现」（防声明漂移成谎言）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { USAGE } from '../../src/cli/usage.ts'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))
const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 30_000 })
}

describe('S5a/b/c：声明在场（USAGE 尾部四表）', () => {
  it('语法位/旗标同义/退出码/版本四声明齐', () => {
    expect(USAGE).toContain('语法位：')
    expect(USAGE).toContain('旗标同义：')
    expect(USAGE).toContain('退出码：')
    expect(USAGE).toContain('版本：studio-next --version 或 -V')
  })
})

describe('S5c 版本声明被行为兑现（--version/-V）', () => {
  it('--version：单行 studio-next <版本>，exit 0，stderr 空', () => {
    const res = run(['--version'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`studio-next ${PKG.version}`)
    expect(res.stderr).toBe('')
  })

  it('-V 短旗标同义（≡ --version）', () => {
    const res = run(['-V'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`studio-next ${PKG.version}`)
  })
})

describe('S5c 退出码表被行为兑现（抽样三档）', () => {
  it('0：显式求助（--help）', () => {
    expect(run(['--help']).status).toBe(0)
  })

  it('1：用法错（顶级 typo）', () => {
    expect(run(['no-such-command'].join(' ').split(' ')).status).toBe(1)
  })

  it('2：company validate 判定器自身错误（路径不存在）——声明中唯一的 2 面之一', () => {
    expect(run(['company', 'validate', '/nonexistent/repo-for-exit-2']).status).toBe(2)
  })
})

describe('S5b 旗标同义被行为兑现（--flag=value ≡ --flag value）', () => {
  it('两式同效（panel --port=8799 与 --port 8799 等价收参——以可观测差异最小面验）', () => {
    const a = run(['panel', '--db=/nonexistent/a.sqlite', '--port=8799'])
    const b = run(['panel', '--db', '/nonexistent/a.sqlite', '--port', '8799'])
    // 两式同因「库不存在」拒（同错误面=同解析结果；差异只在文件名不可观测处）
    expect(a.status).toBe(1)
    expect(b.status).toBe(1)
    expect(a.stderr.replace(/a\.sqlite/g, 'X')).toBe(b.stderr.replace(/a\.sqlite/g, 'X'))
  })
})
