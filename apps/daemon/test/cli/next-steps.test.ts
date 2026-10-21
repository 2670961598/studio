/**
 * CLI 下一步指引与 --json 机器面守门（studio-dev-103 S3，studio-dev-125 实施；docs/20-§五）。
 *
 * E10 治理面：成功输出止在「做完了」不答「然后呢」——init/validate/add/create 四命令尾随
 * 下一步块（全部指向真实可跑命令，不虚构未立能力）；E11 治理面：add/create --json=单行
 * JSON 带 next 数组（机器面与人面不混流）；E15②：库不存在拒收报文指向 company create
 * （缺省即建库）——不再把建库推给「daemon/提案面」黑箱。
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { cmdCandidates } from '../../src/cli/candidates.ts'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))
let work = ''

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'next-steps-'))
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
}

describe('下一步指引块（E10：成功面答「然后呢」——四命令）', () => {
  it('init：成功尾随 validate→company create→serve 三步（全真实可跑命令）', () => {
    const res = run(['init', 'demo-corp', '--dir', path.join(work, 'src-repo')])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('下一步：')
    expect(res.stdout).toContain('1. 结构自检：studio-next validate ')
    expect(res.stdout).toContain('2. 建号/建库一条龙：studio-next company create demo-corp')
    expect(res.stdout).toContain('3. 起主循环：studio-next serve --config <daemon.yaml>')
  })

  it('validate：合法尾随编排导入/概览两步', () => {
    const res = run(['validate', path.join(work, 'src-repo')])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('下一步：')
    expect(res.stdout).toContain('studio-next company add <git-url>')
    expect(res.stdout).toContain('studio-next overview --company ')
  })

  it('company create：成功尾随 serve+overview 两步（serve 路径=<workRoot>/var/daemon.yaml）', () => {
    const res = run(['company', 'create', 'demo-corp', '--work-root', path.join(work, 'w2')])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('下一步：')
    expect(res.stdout).toContain(`studio-next serve --config ${path.join(path.join(work, 'w2'), 'var', 'daemon.yaml')}`)
    expect(res.stdout).toContain('studio-next overview --company ')
  })

  it('company add：成功尾随信任锚批准（E15①：手改 trust.json 指引——CLI 批准命令未立不虚构）+ serve', () => {
    const res = run(['company', 'add', path.join(work, 'src-repo'), 'imported-corp', '--work-root', path.join(work, 'w3')])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('下一步：')
    expect(res.stdout).toContain('"trust": false→true')
    expect(res.stdout).toContain('docs/44 另案')
    expect(res.stdout).toContain('studio-next serve --config <daemon.yaml>')
  })
})

describe('--json 机器面（E11：单行 JSON + next 数组，人机不混流）', () => {
  it('company create --json：末行可解析，含 ok/slug/serveConfig.path/next 数组', () => {
    const res = run(['company', 'create', 'demo-corp', '--work-root', path.join(work, 'w4'), '--json'])
    expect(res.status).toBe(0)
    const lines = res.stdout.trimEnd().split('\n')
    const payload = JSON.parse(lines[lines.length - 1]!) as {
      ok: boolean
      slug: string
      serveConfig: { path: string; status: string }
      next: string[]
    }
    expect(payload.ok).toBe(true)
    expect(payload.slug).toBe('demo-corp')
    expect(payload.serveConfig.path).toBe(path.join(path.join(work, 'w4'), 'var', 'daemon.yaml'))
    // 生命周期值（planned/created/kept）归 create-serve-face.test.ts 锁；本文件只锁形状
    expect(['planned', 'created', 'kept']).toContain(payload.serveConfig.status)
    expect(payload.next.length).toBeGreaterThanOrEqual(2)
    expect(payload.next[0]).toContain('studio-next serve --config')
  })

  it('company add --json：单行 JSON，next[0]=信任锚手改指引（E15①）', () => {
    const res = run(['company', 'add', path.join(work, 'src-repo'), 'imported-corp', '--work-root', path.join(work, 'w5'), '--json'])
    expect(res.status).toBe(0)
    const lines = res.stdout.trimEnd().split('\n')
    const payload = JSON.parse(lines[lines.length - 1]!) as { ok: boolean; slug: string; dir: string; gitCommit: string; next: string[] }
    expect(payload.ok).toBe(true)
    // slug=公司仓自声明（demo-corp）；安装名只决定目录名（…/imported-corp）
    expect(payload.slug).toBe('demo-corp')
    expect(payload.dir).toContain('imported-corp')
    expect(payload.next[0]).toContain('"trust": false→true')
    expect(payload.next.join('\n')).not.toContain('下一步：') // 人面文案不混入机器面
  })
})

describe('库不存在报文指路（E15②：建库走 company create——缺省即建库）', () => {
  it('candidates list：拒收报文含 company create 指引（in-process）', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')))
    try {
      const code = await cmdCandidates(['list', '--db', path.join(work, 'no-such-ledger.sqlite')])
      expect(code).toBe(1)
    } finally {
      spy.mockRestore()
    }
    expect(errors.join('\n')).toContain('建库走 studio-next company create <slug>（缺省即建库）')
  })

  it('sandbox（spawn 面）：拒收报文同款指引', () => {
    const res = run(['sandbox', '--db', path.join(work, 'no-such-ledger.sqlite'), '--candidate', 'c-1'])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('建库走 studio-next company create <slug>（缺省即建库）')
  })
})
