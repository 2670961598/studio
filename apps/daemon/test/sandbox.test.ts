/**
 * sandbox —— 进化链沙箱执行器测试集（src/sandbox.ts：SandboxRunner 端口 + CLI 链）
 *
 * 依据（实现单引用）：
 *   - docs/20-§九：一切改进走候选制品管线（观测→提案→**沙箱**→三态闸门→…）——沙箱环节
 *     验证闸精神：补丁+测试+针对性验证先在临时目录跑，确认价值后进生产（实现单转述）。
 *   - docs/02 F3-02（四元组缺一不进闸门：沙箱证据是闸门前置）/ F3-03（fail-closed）；
 *     docs/17-§3 进化行 + §11（沙箱与探针集物理隔离——本套不涉探针面）。
 *   - packages/store ledger.updateVerification（证据写面——sandboxed 窗口闸）；
 *     packages/core evolution.ts（proposed→sandboxed 机器边；非法边 EVOLVE_REJECT）。
 *
 * 覆盖面（实现单口径 14+）：
 *   - **tmp 隔离**（结构性零触碰）：生产树前后逐字节一致（全文件 sha256 快照比对）+
 *     tmp 用后清理（受控 tmpBase 跑后空）；
 *   - 补丁应用成功/失败面（路径逃逸拒写、写失败不跑命令）；
 *   - 超时杀（真子进程进程组 SIGKILL——durationMs 有界即杀证）；
 *   - 报告形状（pass/fail 全字段）/ 摘要截断 / 最小集拷贝（资产+同目录测试文件）；
 *   - CLI 链：候选 proposed→sandboxed 带证据回查 store；draft/gated 状态拒；sandboxed
 *     重跑覆盖；无命令 fail 如实落账；真 bin 进程端到端；用法错误面。
 *
 * 手法纪律：真子进程（spawn 遵守 crash-injection 先例——等 exit 事件一次定局，不盲等
 * 定时；命令用 process.execPath 绝对路径，不依赖 PATH）；os.tmpdir() 真文件（沿 store
 * 测试风格）；确定性候选语料（insertCandidate 直插——store 写面）；只 import 不改他包。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import type { CandidateRow, Ledger } from '@studio-next/store'
import type { ClassifiedError } from '@studio-next/contract'
import { createSandboxRunner, runCandidateSandbox } from '../src/sandbox.ts'
import type { SandboxReport, SandboxRunner } from '../src/sandbox.ts'

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/bin.ts')
const NODE = process.execPath // 绝对路径——命令不依赖 PATH

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-sandbox-test-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 测试基建 —————————————————————————

/** 受控 tmp 基目录（「用后清理」断言面：跑完 readdir 应为空） */
async function newTmpBase(name: string): Promise<string> {
  const dir = path.join(root, `tmpbase-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 生产树全文件 sha256 快照（「零字节变化」断言面：相对路径 → 内容哈希） */
function treeSnapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) out.set(r, createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir, '')
  return out
}

/** 生产资产树语料：prompts/agent.md（资产）+ 同目录测试文件 + 非测试邻居 */
function seedProduction(dir: string, assetBody = 'agent prompt v1\n'): string {
  mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  writeFileSync(path.join(dir, 'prompts', 'agent.md'), assetBody, 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'agent.test.ts'), "it('agent', () => { expect(true).toBe(true) })\n", 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'agent.spec.js'), 'test("agent spec", () => {})\n', 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'test-util.ts'), 'export const util = 1\n', 'utf8')
  writeFileSync(path.join(dir, 'prompts', 'other.md'), 'not a test neighbor\n', 'utf8') // 非测试面——不进最小集
  return dir
}

const CAND = { id: 'cand-0001', asset_path: 'prompts/agent.md', diff_hash: 'sha256:deadbeef' }
const PASS_CMD = `"${NODE}" -e "process.exit(0)"`
const EXIT3_CMD = `"${NODE}" -e "console.log('out-line'); console.error('err-line'); process.exit(3)"`

/** ClassifiedError 断言捕手（fail-fast 上抛面：category/subcause 如实；含异步拒斥面） */
async function expectConfigInvalid(fn: () => Promise<unknown> | unknown, subcause: string): Promise<void> {
  let caught: unknown
  try {
    await fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const e = caught as Error & ClassifiedError
  expect(e.category).toBe('CONFIG_INVALID')
  expect(e.subcause).toBe(subcause)
}

// ————————————————————————— 执行器面：tmp 隔离与最小集 —————————————————————————

describe('SandboxRunner：tmp 隔离（结构性零触碰）与最小集拷贝', () => {
  it('零触碰：跑全流程（拷贝+补丁+命令）后生产树逐字节不变，tmp 用后清理', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'iso-prod'), 'agent prompt v1\n')
    const tmpBase = await newTmpBase('iso')
    const before = treeSnapshot(prod)
    const runner = createSandboxRunner({ tmpBase })
    const report = await runner.runSandbox(CAND, {
      assetRoot: prod,
      patch: [{ path: 'prompts/agent.md', content: 'agent prompt v2（拟应用变更）\n' }],
      testCommand: `"${NODE}" -e "require('node:fs').writeFileSync('out.txt','产物'); process.exit(0)"`,
      timeoutMs: 10_000,
    })
    expect(report.pass).toBe(true)
    expect(report.artifacts).toContain('out.txt') // 命令真跑了（tmp 内产物）
    // 生产零触碰：全文件 sha256 快照前后一致（含资产/测试文件/非测试邻居）
    expect(treeSnapshot(prod)).toEqual(before)
    // tmp 用后清理：受控 tmpBase 下无残留目录
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('最小集=资产+同目录测试文件：测试后缀/前缀进、非测试邻居不进；产物清单 posix 升序', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'minimal-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('minimal') })
    const report = await runner.runSandbox(CAND, { assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 10_000 })
    expect(report.pass).toBe(true)
    expect(report.artifacts).toEqual([
      'prompts/agent.md',
      'prompts/agent.spec.js',
      'prompts/agent.test.ts',
      'prompts/test-util.ts',
    ]) // other.md 不在（非测试文件不进最小集——v0 冻结正则）
  })

  it('无同目录测试文件的资产：最小集只资产自身', { timeout: 30_000 }, async () => {
    const prod = path.join(root, 'lone-prod')
    mkdirSync(path.join(prod, 'docs'), { recursive: true })
    writeFileSync(path.join(prod, 'docs', 'policy.md'), 'policy v1\n', 'utf8')
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('lone') })
    const report = await runner.runSandbox(
      { id: 'cand-lone', asset_path: 'docs/policy.md', diff_hash: 'sha256:1' },
      { assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 10_000 },
    )
    expect(report.pass).toBe(true)
    expect(report.artifacts).toEqual(['docs/policy.md'])
  })
})

// ————————————————————————— 执行器面：补丁成功/失败 —————————————————————————

describe('SandboxRunner：补丁应用成功/失败面', () => {
  it('补丁成功：命令读到的是替换后的新内容（针对性验证——拟应用变更真生效于 tmp）', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'patch-ok'), 'agent prompt v1\n')
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('patch-ok') })
    const report = await runner.runSandbox(CAND, {
      assetRoot: prod,
      patch: [{ path: 'prompts/agent.md', content: 'agent prompt v2\n' }],
      testCommand: `"${NODE}" -e "process.exit(require('node:fs').readFileSync('prompts/agent.md','utf8').includes('v2') ? 0 : 1)"`,
      timeoutMs: 10_000,
    })
    expect(report.pass).toBe(true)
    expect(readFileSync(path.join(prod, 'prompts', 'agent.md'), 'utf8')).toBe('agent prompt v1\n') // 生产原样
  })

  it('补丁路径逃逸：../evil.txt → fail path-escape、不跑命令（exitCode null）、生产树零新文件', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'patch-escape'))
    const before = treeSnapshot(prod)
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('patch-escape') })
    const report = await runner.runSandbox(CAND, {
      assetRoot: prod,
      patch: [{ path: '../evil.txt', content: 'escaped\n' }],
      testCommand: PASS_CMD,
      timeoutMs: 10_000,
    })
    expect(report.pass).toBe(false)
    expect(report.failReason).toBe('path-escape')
    expect(report.exitCode).toBeNull() // 命令未跑
    expect(report.artifacts).not.toContain('evil.txt')
    expect(treeSnapshot(prod)).toEqual(before) // 结构性拒写的直证
  })

  it('asset_path 逃逸（../ 形态）：镜像目的地出 tmp 根即拒（path-escape，先于拷贝）', { timeout: 30_000 }, async () => {
    const prod = path.join(root, 'asset-escape')
    mkdirSync(prod, { recursive: true })
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('asset-escape') })
    const report = await runner.runSandbox(
      { id: 'cand-esc', asset_path: '../outside.md', diff_hash: 'sha256:2' },
      { assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 10_000 },
    )
    expect(report.pass).toBe(false)
    expect(report.failReason).toBe('path-escape')
    expect(report.artifacts).toEqual([]) // 未拷任何东西
    expect(report.exitCode).toBeNull()
  })
})

// ————————————————————————— 执行器面：fail-closed 分类 —————————————————————————

describe('SandboxRunner：fail-closed 分类（超时/命令失败/资产缺失/无命令/形状闸）', () => {
  it('超时杀：30s 命令 400ms 到点进程组 SIGKILL——timedOut=true、failReason=timeout、duration 有界（<5s 即杀证）', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'timeout-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('timeout') })
    const report = await runner.runSandbox(CAND, {
      assetRoot: prod,
      testCommand: `"${NODE}" -e "setTimeout(function(){}, 30000)"`,
      timeoutMs: 400,
    })
    expect(report.pass).toBe(false)
    expect(report.failReason).toBe('timeout')
    expect(report.timedOut).toBe(true)
    expect(report.exitCode).toBeNull()
    expect(report.durationMs).toBeGreaterThanOrEqual(300)
    expect(report.durationMs).toBeLessThan(5_000) // 命令本要跑 30s——快速返回即真杀证
  })

  it('命令失败：exit 3 → fail command-failed、exitCode=3 如实、stdout/stderr 摘要捕获', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'exit3-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('exit3') })
    const report = await runner.runSandbox(CAND, { assetRoot: prod, testCommand: EXIT3_CMD, timeoutMs: 10_000 })
    expect(report.pass).toBe(false)
    expect(report.failReason).toBe('command-failed')
    expect(report.exitCode).toBe(3)
    expect(report.timedOut).toBe(false)
    expect(report.stdout).toContain('out-line')
    expect(report.stderr).toContain('err-line')
    expect(report.note).toContain('退出码 3')
  })

  it('资产缺失=fail：assetRoot 下无该文件 → asset-missing、不跑命令', { timeout: 30_000 }, async () => {
    const prod = path.join(root, 'missing-prod')
    mkdirSync(prod, { recursive: true })
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('missing') })
    const report = await runner.runSandbox(CAND, { assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 10_000 })
    expect(report).toMatchObject({ pass: false, failReason: 'asset-missing', exitCode: null, durationMs: 0 } satisfies Partial<SandboxReport>)
    expect(report.note).toContain('资产文件缺失')
  })

  it('无命令即 fail 如实：testCommand 空 → command-missing（不建 tmp、不跑子进程）', { timeout: 30_000 }, async () => {
    const tmpBase = await newTmpBase('nocmd')
    const runner = createSandboxRunner({ tmpBase })
    const report = await runner.runSandbox(CAND, { assetRoot: root, testCommand: '', timeoutMs: 10_000 })
    expect(report.pass).toBe(false)
    expect(report.failReason).toBe('command-missing')
    expect(report.exitCode).toBeNull()
    expect(report.artifacts).toEqual([])
    expect(readdirSync(tmpBase)).toEqual([]) // 未建 tmp（无谓面不做）
  })

  it('形状闸 fail-fast：timeoutMs 非正整数 → CONFIG_INVALID 上抛（调用方 bug 不进证据面）', async () => {
    const runner = createSandboxRunner({ tmpBase: root })
    await expectConfigInvalid(() => runner.runSandbox(CAND, { assetRoot: root, testCommand: PASS_CMD, timeoutMs: 0 }), 'daemon/sandbox:bad-plan')
    await expectConfigInvalid(() => runner.runSandbox(CAND, { assetRoot: root, testCommand: PASS_CMD, timeoutMs: Number.NaN }), 'daemon/sandbox:bad-plan')
  })
})

// ————————————————————————— 执行器面：报告形状与摘要 —————————————————————————

describe('SandboxRunner：报告形状与输出摘要', () => {
  it('PASS 报告全字段形状：pass/failReason=null/exitCode=0/timedOut=false/durationMs/artifacts/stout/stderr', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'shape-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('shape') })
    const report = await runner.runSandbox(
      CAND,
      { assetRoot: prod, testCommand: EXIT3_CMD.replace('process.exit(3)', 'process.exit(0)'), timeoutMs: 10_000 },
    )
    expect(report.pass).toBe(true)
    expect(report.failReason).toBeNull()
    expect(report.exitCode).toBe(0)
    expect(report.timedOut).toBe(false)
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
    expect(report.stdout).toContain('out-line')
    expect(report.stderr).toContain('err-line')
    expect(report.note).toBeUndefined()
  })

  it('摘要截断：5000 字符输出 → 保头尾+中段截断标记，长度受限', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'summary-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('summary') })
    const report = await runner.runSandbox(
      CAND,
      {
        assetRoot: prod,
        testCommand: `"${NODE}" -e "process.stdout.write('a'.repeat(4000)+'MARK-TAIL'); process.exit(0)"`,
        timeoutMs: 10_000,
      },
    )
    expect(report.pass).toBe(true)
    expect(report.stdout.length).toBeLessThan(3_200)
    expect(report.stdout).toContain('沙箱摘要：中段截断')
    expect(report.stdout.startsWith('aaaa')).toBe(true) // 头保留
    expect(report.stdout.endsWith('MARK-TAIL')).toBe(true) // 尾保留
  })

  it('命令产物入清单：命令在 tmp 写文件 → artifacts 含之（tmp 内产物=证据面）', { timeout: 30_000 }, async () => {
    const prod = seedProduction(path.join(root, 'artifact-prod'))
    const runner = createSandboxRunner({ tmpBase: await newTmpBase('artifact') })
    const report = await runner.runSandbox(
      CAND,
      {
        assetRoot: prod,
        testCommand: `"${NODE}" -e "require('node:fs').mkdirSync('evidence/deep',{recursive:true}); require('node:fs').writeFileSync('evidence/deep/run.log','ok'); process.exit(0)"`,
        timeoutMs: 10_000,
      },
    )
    expect(report.artifacts).toContain('evidence/deep/run.log')
    expect(report.pass).toBe(true)
  })
})

// ————————————————————————— CLI 链（runCandidateSandbox 直调面） ———————————————————

/** 语料候选行（status 可调） */
function seedCandidate(ledger: Ledger, id: string, status: CandidateRow['status'], assetPath = 'prompts/agent.md'): string {
  ledger.insertCandidate({
    id,
    asset_type: 'prompt',
    asset_path: assetPath,
    version: 'v2',
    diff_hash: `sha256:${id}`,
    blast_radius: 'isolated',
    verification: null,
    parent_id: null,
    status,
    created_at: Date.now(),
  })
  return id
}

describe('CLI 链 runCandidateSandbox：取候选→runSandbox→updateVerification→transition', () => {
  let ledger: Ledger
  let prod: string

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'chain.sqlite'))
    prod = seedProduction(path.join(root, 'chain-prod'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('proposed→sandboxed 全链：判定 PASS → 证据回查 store（verification deep-equal、sandboxPass=true）、状态落 sandboxed', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-pass', 'proposed')
    const result = await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      testCommand: `"${NODE}" -e "process.exit(0)"`,
      timeoutMs: 10_000,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-pass') }),
    })
    expect(result.report.pass).toBe(true)
    expect(result.transitioned).toBe(true)
    // 台账视角回查：状态 + verification 快照（证据确实流经 store，不是内存直通）
    const row = ledger.getCandidate(id)
    expect(row?.status).toBe('sandboxed')
    expect(row?.verification).toEqual(result.verification)
    expect((row?.verification as { sandboxPass: boolean }).sandboxPass).toBe(true)
    expect((row?.verification as { blastRadiusOk: boolean }).blastRadiusOk).toBe(false) // 影响面不在本刀——未证实即不声称
  })

  it('判定红也走完链：命令 exit 3 → sandboxPass=false 落账（失败如实，不伪造）+ 状态仍迁移 sandboxed', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-fail', 'proposed')
    const result = await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      testCommand: EXIT3_CMD,
      timeoutMs: 10_000,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-fail') }),
    })
    expect(result.report.pass).toBe(false)
    expect(result.transitioned).toBe(true)
    const row = ledger.getCandidate(id)
    expect(row?.status).toBe('sandboxed')
    const v = row?.verification as { sandboxPass: boolean; sandbox: { failReason: string; exitCode: number } }
    expect(v.sandboxPass).toBe(false)
    expect(v.sandbox.failReason).toBe('command-failed')
    expect(v.sandbox.exitCode).toBe(3)
  })

  it('无命令走链：--command 缺省 → command-missing fail 如实落账（sandboxPass=false、状态 sandboxed）', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-nocmd', 'proposed')
    const result = await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-nocmd') }),
    })
    expect(result.report.failReason).toBe('command-missing')
    expect(result.report.pass).toBe(false)
    expect(result.transitioned).toBe(true)
    expect(ledger.getCandidate(id)?.status).toBe('sandboxed')
    expect((ledger.getCandidate(id)?.verification as { sandboxPass: boolean }).sandboxPass).toBe(false)
  })

  it('--file 变更文件：tmp 内资产被整文件替换，命令验证新内容（v0 单文件语义）', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-file', 'proposed')
    const changeFile = path.join(root, 'change-agent.md')
    writeFileSync(changeFile, 'agent prompt v2（变更文件全文）\n', 'utf8')
    const result = await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      changeFile,
      testCommand: `"${NODE}" -e "process.exit(require('node:fs').readFileSync('prompts/agent.md','utf8').includes('变更文件全文') ? 0 : 1)"`,
      timeoutMs: 10_000,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-file') }),
    })
    expect(result.report.pass).toBe(true)
    expect(readFileSync(path.join(prod, 'prompts', 'agent.md'), 'utf8')).toBe('agent prompt v1\n') // 生产原样（tmp 内替换）
  })

  it('sandboxed 重跑：不迁移（transitioned=false）、verification 覆盖=最新一次为准', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-rerun', 'proposed')
    await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      testCommand: PASS_CMD,
      timeoutMs: 10_000,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-rerun-1') }),
    })
    expect(ledger.getCandidate(id)?.status).toBe('sandboxed')
    const second = await runCandidateSandbox(ledger, {
      candidateId: id,
      assetRoot: prod,
      testCommand: EXIT3_CMD,
      timeoutMs: 10_000,
      runner: createSandboxRunner({ tmpBase: await newTmpBase('chain-rerun-2') }),
    })
    expect(second.transitioned).toBe(false)
    expect(ledger.getCandidate(id)?.status).toBe('sandboxed')
    const v = ledger.getCandidate(id)?.verification as { sandboxPass: boolean }
    expect(v.sandboxPass).toBe(false) // 最新一次（红）覆盖旧判定（绿）
  })

  it('draft 拒：机器边非法（合法后继 proposed）→ EVOLVE_REJECT 上抛、状态不动、证据不落', () => {
    const id = seedCandidate(ledger, 'chain-draft', 'draft')
    let caught: unknown
    return runCandidateSandbox(ledger, { candidateId: id, assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 1000 })
      .catch((err: unknown) => {
        caught = err
      })
      .then(() => {
        expect(caught).toBeInstanceOf(Error)
        const e = caught as Error & ClassifiedError
        expect(e.category).toBe('EVOLVE_REJECT')
        expect(e.subcause).toBe('evolve/illegal-transition')
        expect(e.message).toContain('draft→sandboxed')
        expect(ledger.getCandidate(id)?.status).toBe('draft')
        expect(ledger.getCandidate(id)?.verification).toBeNull() // 先验后跑：沙箱没跑、证据没落
      })
  })

  it('gated 拒：证据只进沙箱阶段（F3-02 时序）→ EVOLVE_REJECT、状态不动', () => {
    const id = seedCandidate(ledger, 'chain-gated', 'gated')
    let caught: unknown
    return runCandidateSandbox(ledger, { candidateId: id, assetRoot: prod, testCommand: PASS_CMD, timeoutMs: 1000 })
      .catch((err: unknown) => {
        caught = err
      })
      .then(() => {
        const e = caught as Error & ClassifiedError
        expect(e.category).toBe('EVOLVE_REJECT')
        expect(e.subcause).toBe('evolve/illegal-transition')
        expect(ledger.getCandidate(id)?.status).toBe('gated')
      })
  })

  it('候选不在库拒：CONFIG_INVALID/daemon/sandbox:candidate-unknown（回查失败如实）', () => {
    let caught: unknown
    return runCandidateSandbox({ getCandidate: () => undefined } as unknown as Ledger, {
      candidateId: 'no-such',
      assetRoot: prod,
      testCommand: PASS_CMD,
      timeoutMs: 1000,
    })
      .catch((err: unknown) => {
        caught = err
      })
      .then(() => {
        expectConfigInvalid(() => {
          throw caught
        }, 'daemon/sandbox:candidate-unknown')
      })
  })

  it('注入替身端口：runner 报告原样落账（端口可注入——GateRunner 形态对齐）', { timeout: 30_000 }, async () => {
    const id = seedCandidate(ledger, 'chain-stub', 'proposed')
    const stub: SandboxRunner = {
      async runSandbox(): Promise<SandboxReport> {
        return { pass: true, failReason: null, stdout: 'stub-out', stderr: '', durationMs: 7, artifacts: ['a.md'], exitCode: 0, timedOut: false }
      },
    }
    const result = await runCandidateSandbox(ledger, { candidateId: id, assetRoot: prod, testCommand: 'unused', timeoutMs: 1000, runner: stub })
    expect(result.report.stdout).toBe('stub-out')
    expect(ledger.getCandidate(id)?.status).toBe('sandboxed')
  })
})

// ————————————————————————— CLI 面：真 bin 进程 —————————————————————————

describe('CLI 面：studio-next sandbox --db --candidate（真 bin 进程端到端）', () => {
  function runBin(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args], { encoding: 'utf8' })
      let out = ''
      let err = ''
      child.stdout?.on('data', (d: string) => {
        out += d
      })
      child.stderr?.on('data', (d: string) => {
        err += d
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        resolve({ code, out, err })
      })
    })
  }

  it('一条命令进沙箱：proposed 候选 + --command + --file → exit 0、判定行、store 回查 sandboxed+证据', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-sandbox.sqlite')
    const prod = seedProduction(path.join(root, 'cli-prod'))
    const changeFile = path.join(root, 'cli-change.md')
    writeFileSync(changeFile, 'agent prompt v2（CLI 变更全文）\n', 'utf8')
    const before = treeSnapshot(prod)
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-1', 'proposed')
    ledger.close()

    const result = await runBin([
      'sandbox',
      '--db', dbPath,
      '--candidate', 'cli-cand-1',
      '--command', `"${NODE}" -e "process.exit(require('node:fs').readFileSync('prompts/agent.md','utf8').includes('CLI 变更全文') ? 0 : 1)"`,
      '--file', changeFile,
      '--root', prod,
      '--timeout', '15000',
    ])
    expect(result.code).toBe(0)
    expect(result.out).toContain('判定：PASS')
    expect(result.out).toContain('证据落账：updateVerification sandboxPass=true')
    expect(result.out).toContain('proposed→sandboxed')
    expect(result.out).toContain('候选 cli-cand-1 沙箱完成：PASS')

    // 台账视角回查（不只 stdout——store 是事实源）
    const reopened = openLedger(dbPath)
    const row = reopened.getCandidate('cli-cand-1')
    expect(row?.status).toBe('sandboxed')
    const v = row?.verification as { sandboxPass: boolean; sandbox: { artifacts: string[] } }
    expect(v.sandboxPass).toBe(true)
    expect(v.sandbox.artifacts).toContain('prompts/agent.md')
    reopened.close()
    expect(treeSnapshot(prod)).toEqual(before) // 生产零触碰（CLI 全链直证）
  })

  it('判定红也是 exit 0（红是档案面非命令错误）：失败命令 → FAIL 行 + sandboxPass=false 落账', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-sandbox-red.sqlite')
    const ledger = openLedger(dbPath)
    seedCandidate(ledger, 'cli-cand-red', 'proposed')
    ledger.close()
    const result = await runBin([
      'sandbox', '--db', dbPath, '--candidate', 'cli-cand-red',
      '--command', `"${NODE}" -e "process.exit(3)"`,
      '--root', path.join(root, 'cli-prod'),
    ])
    expect(result.code).toBe(0)
    expect(result.out).toContain('判定：FAIL（command-failed）')
    const reopened = openLedger(dbPath)
    expect(reopened.getCandidate('cli-cand-red')?.status).toBe('sandboxed')
    expect((reopened.getCandidate('cli-cand-red')?.verification as { sandboxPass: boolean }).sandboxPass).toBe(false)
    reopened.close()
  })

  it('用法错误面：缺 --candidate exit 1；库不存在 exit 1（候选必须在库，不代建库）', { timeout: 60_000 }, async () => {
    const noCandidate = await runBin(['sandbox', '--db', path.join(root, 'cli-sandbox.sqlite')])
    expect(noCandidate.code).toBe(1)
    expect(noCandidate.err).toContain('缺少 --candidate')
    const noDb = await runBin(['sandbox', '--db', path.join(root, 'no-such.sqlite'), '--candidate', 'x'])
    expect(noDb.code).toBe(1)
    expect(noDb.err).toContain('库不存在')
    expect(existsSync(path.join(root, 'no-such.sqlite'))).toBe(false) // 写面不代建库
    const badTimeout = await runBin(['sandbox', '--db', path.join(root, 'cli-sandbox.sqlite'), '--candidate', 'x', '--timeout', 'abc'])
    expect(badTimeout.code).toBe(1)
    expect(badTimeout.err).toContain('--timeout 取值非法')
  })
})
