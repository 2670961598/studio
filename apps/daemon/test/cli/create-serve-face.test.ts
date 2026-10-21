/**
 * company create 顺产 daemon.yaml 骨架守门（studio-dev-103 S4A/S4C，studio-dev-125 实施；
 * docs/20-§五：新特性同 PR 带测试）。
 *
 * S4A 契约：
 *   - 尾相位顺产 <work-root>/var/daemon.yaml：db/platform/company/companyDir/rootDir/
 *     platformDir/tickMs/jobs 八键预填（全为 parseDaemonConfig 收的面——往返解析=守门）
 *   - 幂等：在场即 kept 绝不覆盖手改；dry-run 只报 planned 零落盘
 *   - --json 面 serveConfig.status ∈ {planned, created, kept}
 * S4C 契约：serve 全文段含最小样例（帮助面可复制即用——与骨架同款单一形状）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDaemonConfig } from '../../src/assembly/serve.ts'
import { renderDaemonYamlSkeleton } from '../../src/cli/serve.ts'
import { SECTION } from '../../src/cli/usage.ts'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))
let work = ''

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 's4-skeleton-'))
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
}

describe('骨架渲染：parseDaemonConfig 往返（键集 ⊆ 收的面）', () => {
  it('渲染→解析零异常，八键全中且值如实（路径引号壳剥净）', () => {
    const dbPath = path.join(work, 'var', 'ledger.sqlite')
    const text = renderDaemonYamlSkeleton({ dbPath, slug: 'demo-corp', companyDir: path.join(work, 'demo-corp'), rootDir: path.join(work, 'var') })
    const cfg = parseDaemonConfig(text) // 抛错即败——骨架键面漂移的第一闸
    expect(cfg.db).toBe(dbPath)
    expect(cfg.platform).toBe('localfile')
    expect(cfg.company).toBe('demo-corp')
    expect(cfg.companyDir).toBe(path.join(work, 'demo-corp'))
    expect(cfg.rootDir).toBe(path.join(work, 'var'))
    expect(cfg.platformDir).toBe(path.join(work, 'var', 'platform'))
    expect(cfg.tickMs).toBe(1000)
    expect(cfg.jobs).toBe(true)
  })

  it('路径含空格不破（引号壳职责）', () => {
    const rootDir = path.join(work, 'with space', 'var')
    const text = renderDaemonYamlSkeleton({ dbPath: path.join(rootDir, 'l.sqlite'), slug: 's', companyDir: path.join(rootDir, 's'), rootDir })
    expect(() => parseDaemonConfig(text)).not.toThrow()
  })
})

describe('S4A：create 顺产骨架（真 bin 进程端到端）', () => {
  it('首跑：daemon.yaml 落盘且往返解析通过；--json serveConfig.status=created', () => {
    const w1 = path.join(work, 'w1')
    const res = run(['company', 'create', 'demo-corp', '--work-root', w1, '--json'])
    expect(res.status).toBe(0)
    const lines = res.stdout.trimEnd().split('\n')
    const payload = JSON.parse(lines[lines.length - 1]!) as { serveConfig: { path: string; status: string } }
    expect(payload.serveConfig.path).toBe(path.join(w1, 'var', 'daemon.yaml'))
    expect(payload.serveConfig.status).toBe('created')
    const yaml = readFileSync(path.join(w1, 'var', 'daemon.yaml'), 'utf8')
    expect(() => parseDaemonConfig(yaml)).not.toThrow()
    expect(yaml).toContain(`db: ${JSON.stringify(path.join(w1, 'var', 'ledger.sqlite'))}`)
    expect(yaml).toContain('jobs: true')
  })

  it('再跑=kept 不覆盖：手改一行后重跑，手改内容原样保留 + status=kept', async () => {
    const w2 = path.join(work, 'w2')
    expect(run(['company', 'create', 'demo-corp', '--work-root', w2]).status).toBe(0)
    const cfgFile = path.join(w2, 'var', 'daemon.yaml')
    await writeFile(cfgFile, readFileSync(cfgFile, 'utf8').replace('tickMs: 1000', 'tickMs: 250'), 'utf8')
    const res = run(['company', 'create', 'demo-corp', '--work-root', w2, '--json'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('serve 配置已在场（保留手改、不覆盖）')
    expect(readFileSync(cfgFile, 'utf8')).toContain('tickMs: 250')
    const lines = res.stdout.trimEnd().split('\n')
    const payload = JSON.parse(lines[lines.length - 1]!) as { serveConfig: { status: string } }
    expect(payload.serveConfig.status).toBe('kept')
  })

  it('dry-run：零落盘（daemon.yaml 不存在）+ status=planned', () => {
    const w3 = path.join(work, 'w3')
    const res = run(['company', 'create', 'demo-corp', '--work-root', w3, '--dry-run', '--json'])
    expect(res.status).toBe(0)
    expect(existsSync(path.join(w3, 'var', 'daemon.yaml'))).toBe(false)
    const lines = res.stdout.trimEnd().split('\n')
    const payload = JSON.parse(lines[lines.length - 1]!) as { serveConfig: { status: string } }
    expect(payload.serveConfig.status).toBe('planned')
  })
})

describe('S4C：serve 全文段样例（帮助面可复制即用）', () => {
  it('SECTION.serve 含最小样例（与骨架同款键形）', () => {
    expect(SECTION.serve).toContain('配置样例（最小可跑')
    for (const key of ['db:', 'platform:', 'company:', 'companyDir:', 'rootDir:', 'tickMs:', 'jobs:']) {
      expect(SECTION.serve, key).toContain(key)
    }
  })
})
