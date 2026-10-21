/**
 * company check 接棒 + validate 兼容别名守门（studio-dev-103 S2 候选 B，studio-dev-125
 * 实施；docs/20-§五）。契约：
 *   - company check <目录> = 顶级 validate 的语义正位（同输出同退码——单一源
 *     runStructureCheck）
 *   - validate 保留兼容：stderr 加法式弃用告警一行，stdout/退码零变化（脚本管道不受扰）
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))
let work = ''

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 's2-check-'))
  // 一家合法公司做绿面样本（init=模板复制+自检+git 首提，repo 局部身份零全局依赖）
  const res = spawnSync(process.execPath, [BIN, 'init', 'demo-corp', '--dir', path.join(work, 'corp')], { encoding: 'utf8', timeout: 60_000 })
  expect(res.status).toBe(0)
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
}

describe('company check（正位面）', () => {
  it('合法目录：exit 0 + 同款摘要/下一步（与 validate 的 stdout 逐行全等）', () => {
    const check = run(['company', 'check', path.join(work, 'corp')])
    const legacy = run(['validate', path.join(work, 'corp')])
    expect(check.status).toBe(0)
    expect(legacy.status).toBe(0)
    expect(check.stdout).toBe(legacy.stdout) // 语义单一源：结果面逐字节同款
  })

  it('不合法目录：exit 1 + 逐条「文件:行 [规则] 修法」', () => {
    const bad = path.join(work, 'bad-corp')
    const res = run(['company', 'check', bad]) // 目录不存在=读取失败面
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('读取目录失败')
  })

  it('旗标形令牌拒收（本命令无旗标）', () => {
    const res = run(['company', 'check', '--json'])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('未知旗标：--json')
  })

  it('组清单含 check；typo 面 did-you-mean 候选集同步', () => {
    const help = run(['company', '--help'])
    expect(help.stdout).toContain('studio-next company check <目录>')
    const bare = run(['company'])
    expect(bare.stderr).toContain('当前支持：add、create、validate、check')
  })
})

describe('validate（兼容别名——加法式弃用）', () => {
  it('stderr 附一行弃用告警；stdout/退码零变化（同目录绿面）', () => {
    const res = run(['validate', path.join(work, 'corp')])
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('已让位 company check')
    expect(res.stdout).toContain(`合法：demo-corp`)
    expect(res.stdout).toContain('下一步：')
  })

  it('-h 面不触发弃用告警（纯求助零噪声）', () => {
    const res = run(['validate', '--help'])
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('兼容别名——已让位 company check')
  })
})
