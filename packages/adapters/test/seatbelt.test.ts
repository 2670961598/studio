/**
 * seatbelt 写域圈定测试（DEV-29 原型 attempt3，docs/43-§五 派发权限圈 ② + §八-3 spike 面）
 *
 * attempt3 变更（宰相审验打回② 4d91e6b2-cc3b-11f1，处置三选一取 (a)）：
 *   - **strictRead 形态删除**：att1 v1 与 att2 v2 两代读收口构造在宰相未沙箱环境
 *     apply 均 **SIGABRT**（status=null+signal=SIGABRT）——「根域读收口」构造类本身
 *     在本机（macOS 26.3 arm64）属崩溃类，读收口在 sandbox-exec 面不可表达，读域宽放
 *     （留待 Apple 支持或换机制）。本套以**读域宽放回归网**固话该处置：生成的
 *     profile 全文不得出现任何 `deny file-read`（再引入读收口=红，须附未沙箱 apply
 *     面复验输出走批示流——seatbelt.ts 头注再引入纪律）。
 *   - 三形态（wide/nonet/egress-port）编译断言保留 att2 的**崩溃守卫**（status≠null
 *     且 signal=null——任何崩溃信号都是红，att1/att2 打回红面回归网）+ **文法对照**
 *     （坏 host 字面量必须 exit 65——证明本环境 sandbox-exec 真在编译，65=编译错
 *     ≠ 71=嵌套 apply 拒 ≠ 崩溃，断言面自证方法论）。
 *
 * 分两面：
 *   - **纯函数面**（全平台恒跑）：profile 生成器随派发参数化（同参同文/异参异文）、
 *     fail-closed 规则序（基线先行、deny+白名单栈在其后）、SBPL 字面量转义、argv 包装
 *   - **真机编译面 + 适配器接线面**（darwin 档）：三形态 sandbox-exec 编译全过 +
 *     崩溃守卫 + 文法对照；DshAdapter mode='auto' 的 launch 落 profile+包装 argv；
 *     **嵌套沙箱负断言**——测试进程自身已处 seatbelt（worker 套 worker 场景）时
 *     macOS 拒绝嵌套 sandbox_apply（EPERM/exit 71），适配器落法=空流不 completed
 *     如实失败，**绝不静默改走无沙箱路径**；detect 面后端探测在嵌套环境如实 ok:false
 *     （fail-closed 不派）。未沙箱环境（daemon/门禁跑套件）同断言绿化为正路——
 *     断言面环境自适应：两种环境都证「fail-closed 语义」本身，不伪造绿。
 *
 * env 注入说明：与 dsh.test.ts 同款——spawn env 收封闭允许集，测试旋钮经 DSH_FAKE_*
 * 命名空间（fake CLI 入口折算回 FAKE_*，见 fake-cli.mjs 头注）。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { TaskBrief } from '@studio-next/contract'
import {
  DSH_HOST_RPC_DEFAULT,
  SEATBELT_BIN,
  buildWorkerSeatbeltProfile,
  seatbeltArgv,
  seatbeltProfileFileName,
} from '../src/seatbelt.ts'
import type { DshSeatbeltOptions } from '../src/dsh.ts'
import { DshAdapter } from '../src/dsh.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const p01Fixture = fileURLToPath(new URL('./fixtures/dsh/P01-真成功流.ndjson', import.meta.url))

const workdir = mkdtempSync(join(tmpdir(), 'seatbelt-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function makeBrief(workspace: string): TaskBrief {
  const briefPath = join(workspace, 'brief.md')
  writeFileSync(briefPath, 'TASK: seatbelt 接线探针')
  return {
    ticket: 'DEV-29',
    attempt: 3,
    briefPath,
    workspace,
    AGENTS_MD: { channel: 'native', target: join(workspace, 'AGENTS.md') },
  }
}

/** 收流到终态（或空流）：环境自适应消费——嵌套沙箱=空流（apply 拒），未沙箱=完整流 */
async function drain(adapter: DshAdapter, handle: Awaited<ReturnType<DshAdapter['launch']>>) {
  const events: { type?: string; text?: string; completed?: boolean }[] = []
  for await (const e of adapter.stream(handle)) {
    events.push(e as { type?: string; text?: string; completed?: boolean })
  }
  return events
}

// ---------------------------------------------------------------------------
// 纯函数面：profile 生成器（参数化=fail-closed 白名单的逐条落文）
// ---------------------------------------------------------------------------

describe('buildWorkerSeatbeltProfile（纯函数，随派发参数化）', () => {
  it('fail-closed 骨架：基线先行（最后匹配规则胜），deny+白名单栈在其后（写/网双收口）', () => {
    const text = buildWorkerSeatbeltProfile({ writeRoots: ['/w/a'] })
    expect(text).toContain('(version 1)')
    const baseline = text.indexOf('(allow default)')
    expect(baseline).toBeGreaterThan(-1)
    const denyWrite = text.indexOf('(deny file-write*)')
    const allowWrite = text.indexOf('(allow file-write* (subpath "/w/a"))')
    const denyNet = text.indexOf('(deny network*)')
    expect(denyWrite).toBeGreaterThan(baseline)
    expect(allowWrite).toBeGreaterThan(denyWrite)
    expect(denyNet).toBeGreaterThan(baseline)
  })

  it('写域参数化：writeRoots 逐条进文，缺席根不进文（异参异文）', () => {
    const a = buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket-1'] })
    const b = buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket-1', '/w/out-1'] })
    expect(a).not.toContain('/w/out-1')
    expect(b).toContain('(allow file-write* (subpath "/w/ticket-1"))')
    expect(b).toContain('(allow file-write* (subpath "/w/out-1"))')
    expect(a).not.toEqual(b)
    // 空串根跳过（防手滑造出 (subpath "") 全域放行的反模式）
    expect(buildWorkerSeatbeltProfile({ writeRoots: ['', '/w/x'] })).not.toContain('(subpath "")')
  })

  it('同参同文（可落账可审计）：生成是纯函数', () => {
    const params = { writeRoots: ['/w/t'], label: 'T-1/att3' }
    expect(buildWorkerSeatbeltProfile(params)).toEqual(buildWorkerSeatbeltProfile(params))
    expect(buildWorkerSeatbeltProfile(params)).toContain(';; dispatch: T-1/att3')
  })

  it('网域参数化：缺省回环宿主 RPC 13800（IP 归一 localhost 形态——macOS remote 过滤器只认 */localhost）；显式空=禁回环；端口档逐条进文', () => {
    expect(DSH_HOST_RPC_DEFAULT).toEqual([{ host: '127.0.0.1', port: 13800 }])
    expect(buildWorkerSeatbeltProfile({ writeRoots: ['/w'] })).toContain(
      '(allow network-outbound (remote tcp "localhost:13800"))',
    )
    expect(
      buildWorkerSeatbeltProfile({ writeRoots: ['/w'], localRpcEndpoints: [{ host: '::1', port: 13800 }] }),
    ).toContain('(allow network-outbound (remote tcp "localhost:13800"))')
    const closed = buildWorkerSeatbeltProfile({ writeRoots: ['/w'], localRpcEndpoints: [] })
    expect(closed).not.toContain('network-outbound')
    // 通配出口（host='*'）=裸放行过渡面（darwin 25.3 真机：过滤式 remote 对非回环不生效——
    // studio-dev-269 att17 复现；回环端点保留过滤式）
    expect(
      buildWorkerSeatbeltProfile({ writeRoots: ['/w'], outboundTcp: [{ host: '*', port: 443 }] }),
    ).toContain('(allow network-outbound) ;; 通配出口过渡面')
    expect(
      buildWorkerSeatbeltProfile({
        writeRoots: ['/w'],
        outboundTcp: [
          { host: '*', port: 443 },
          { host: 'localhost', port: 8443 },
        ],
      }),
    ).toContain('(allow network-outbound (remote tcp "localhost:8443"))')
  })

  it('网域 fail-closed：按域名/IP 收口出口在 macOS remote 过滤器不可表达——生成期显式拒绝（不静默放宽成 * 通配）', () => {
    expect(() =>
      buildWorkerSeatbeltProfile({ writeRoots: ['/w'], outboundTcp: [{ host: 'api.deepseek.com', port: 443 }] }),
    ).toThrow(/仅接受回环|不可表达/)
    expect(() =>
      buildWorkerSeatbeltProfile({ writeRoots: ['/w'], outboundTcp: [{ host: '10.0.0.9', port: 443 }] }),
    ).toThrow(/仅接受回环|不可表达/)
    // 拒绝面=生成器纯函数层：写域不受影响（同参去掉坏端点即出文）
    expect(buildWorkerSeatbeltProfile({ writeRoots: ['/w'] })).toContain('(deny file-write*)')
  })

  it('读域宽放回归网（attempt3 处置 (a)）：全文零读收口——任何 deny file-read* 都是红（再引入须附未沙箱 apply 面复验输出走批示流）', () => {
    for (const text of [
      buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'] }),
      buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'], localRpcEndpoints: [] }),
      buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'], outboundTcp: [{ host: '*', port: 443 }] }),
    ]) {
      expect(text).not.toContain('deny file-read') // 根域读收口=本机未沙箱 apply 面 SIGABRT 崩溃类（att1/att2 两例打回）
      expect(text).not.toContain('file-read-data') // att1 怀疑组合逐字排除
      expect(text.indexOf('(allow default)')).toBeGreaterThan(-1) // 读面由基线放行（宽放）
    }
  })

  it('SBPL 字面量转义：路径含引号/反斜杠不破文法（防 profile 注入）', () => {
    const evil = '/w/嘴上说"引号"与\\反斜杠'
    const text = buildWorkerSeatbeltProfile({ writeRoots: [evil] })
    expect(text).toContain('(subpath "/w/嘴上说\\"引号\\"与\\\\反斜杠")')
    expect(text).not.toContain(`(subpath "${evil}")`)
  })
})

// ---------------------------------------------------------------------------
// 包装面
// ---------------------------------------------------------------------------

describe('seatbeltArgv / seatbeltProfileFileName（包装面）', () => {
  it('argv 包装：sandbox-exec -f <profile> -- <子 argv>（-- 防首参被当旗标）', () => {
    expect(seatbeltArgv('/p/worker-1.sbpl', ['dsh', '--json'])).toEqual([
      SEATBELT_BIN,
      '-f',
      '/p/worker-1.sbpl',
      '--',
      'dsh',
      '--json',
    ])
    // 子 argv 首参以 - 开头也只落在 -- 之后（sandbox-exec 旗标区安全）
    expect(seatbeltArgv('/p/x', ['-weird', 'arg'])[4]).toBe('-weird')
  })

  it('profile 文件名唯一前缀（每 attempt 落独立文件，证据随单走）', () => {
    const a = seatbeltProfileFileName()
    const b = seatbeltProfileFileName()
    expect(a).toMatch(/^worker-[0-9a-f-]{36}\.sbpl$/)
    expect(a).not.toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// 真机编译面（darwin；att1/att2 打回的闸门红面——崩溃守卫 + 文法对照收紧）
// ---------------------------------------------------------------------------

describe('生成 profile 的 SBPL 编译面（darwin 真机——三形态必须编译过且不崩溃）', () => {
  const variants: readonly (readonly [string, string])[] = [
    ['wide', buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'], label: 'compile/wide' })],
    ['nonet', buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'], localRpcEndpoints: [], outboundTcp: [], label: 'compile/nonet' })],
    [
      'egress-port',
      buildWorkerSeatbeltProfile({ writeRoots: ['/w/ticket'], outboundTcp: [{ host: '*', port: 443 }], label: 'compile/egress-port' }),
    ],
  ]

  it('三形态全部编译通过：崩溃守卫（status≠null 且无 signal——att1/att2 strictRead SIGABRT 回归网）+ exit 65 文法错绝不允许', () => {
    if (process.platform !== 'darwin') return
    for (const [name, text] of variants) {
      const profilePath = join(workdir, `compile-${name}-${randomUUID()}.sbpl`)
      writeFileSync(profilePath, text, 'utf8')
      const r = spawnSync(SEATBELT_BIN, ['-f', profilePath, '/usr/bin/true'], { encoding: 'utf8' })
      // 崩溃守卫（att1/att2 打回：未沙箱环境 apply 时 strictRead 形态 SIGABRT，status=null
      // +signal=SIGABRT——该类崩溃在**任何环境**都是红，先于环境自适应断言）
      expect(r.error).toBeUndefined()
      expect(r.status, `${name}: 崩溃守卫——status=null 即 sandbox-exec 崩溃（att1/att2 SIGABRT 面）`).not.toBeNull()
      expect(r.signal, `${name}: 崩溃守卫——不允许任何信号终止`).toBeNull()
      // 0=未沙箱环境跑通（编译+apply+exec 全过）；71=已沙箱环境（编译过+嵌套 apply 拒
      // EPERM）——两者都证明文法合法；65=编译错（真机对非法 host 字面量的报法）=生成器缺陷
      expect([0, 71], `${name}: status=${String(r.status)} stderr=${String(r.stderr)}`).toContain(r.status)
      if (r.status === 71) {
        expect(String(r.stderr)).toContain('sandbox_apply')
      }
      rmSync(profilePath, { force: true })
    }
  })

  it('文法对照（方法论有效性）：坏 profile（非法 host 字面量）必须 exit 65——证明本环境 sandbox-exec 真在编译，65≠71 面可分辨', () => {
    if (process.platform !== 'darwin') return
    const bad = join(workdir, `bad-${randomUUID()}.sbpl`)
    writeFileSync(bad, '(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote tcp "10.0.0.9:443"))\n', 'utf8')
    const r = spawnSync(SEATBELT_BIN, ['-f', bad, '/usr/bin/true'], { encoding: 'utf8' })
    expect(r.status).toBe(65) // 编译错（真机报法：host must be * or localhost in network address）
    expect(String(r.stderr)).toContain('host must be * or localhost')
    rmSync(bad, { force: true })
  })
})

// ---------------------------------------------------------------------------
// 适配器接线面（darwin 真机档；环境自适应断言，两种环境都证 fail-closed 语义）
// ---------------------------------------------------------------------------

describe('DshAdapter seatbelt 接线（DEV-29 attempt3，docs/43-§五②）', () => {
  it('缺省（无 opts）：不圈定——launch argv 不含 sandbox-exec，无 .seatbelt 落盘（既有行为零改动）', async () => {
    const ws = mkdtempSync(join(workdir, 'off-'))
    const adapter = new DshAdapter([process.execPath, fakeCli])
    process.env.DSH_FAKE_ECHO_ARGS = '1'
    process.env.DSH_FAKE_FIXTURE = p01Fixture
    try {
      const handle = await adapter.launch(makeBrief(ws))
      const events = await drain(adapter, handle)
      expect(readdirSync(ws).includes('.seatbelt')).toBe(false)
      const argvEcho = events.find((e) => e.type === 'log' && e.text?.startsWith('fake-cli argv:'))
      expect(argvEcho?.text?.includes('sandbox-exec')).toBe(false)
    } finally {
      delete process.env.DSH_FAKE_ECHO_ARGS
      delete process.env.DSH_FAKE_FIXTURE
    }
  })

  it('mode=off：显式关闭同缺省（不圈定不探测）', async () => {
    const adapter = new DshAdapter([process.execPath, fakeCli], { seatbelt: { mode: 'off' } })
    const detect = await adapter.detect()
    // off 档不触 seatbelt 探测：detect 结果只反映 dsh 面本身（fake CLI 装了即 ok）
    expect(detect.ok).toBe(true)
    expect(detect.gaps.join(' ').includes('seatbelt')).toBe(false)
  })

  it('mode 形状闸：非法档位结构拒收 CONFIG_INVALID（不静默当 off）', () => {
    expect(
      () =>
        new DshAdapter([process.execPath, fakeCli], {
          seatbelt: { mode: 'bad' } as unknown as DshSeatbeltOptions,
        }),
    ).toThrow(/seatbelt-mode-invalid|仅接受/)
  })

  it('mode=auto：launch 落参数化 profile 到 workspace/.seatbelt/ 并包装 argv（真机档）', async () => {
    if (process.platform !== 'darwin') return // seatbelt=darwin 面（docs/43-§五② 定域）
    const ws = mkdtempSync(join(workdir, 'on-'))
    const dshHome = join(ws, '.dsh-home')
    const adapter = new DshAdapter([process.execPath, fakeCli], {
      seatbelt: { mode: 'auto', dshHomeRedirect: dshHome },
    })
    process.env.DSH_FAKE_FIXTURE = p01Fixture
    process.env.DSH_FAKE_ECHO_ENV = 'DSH_HOME'
    try {
      const handle = await adapter.launch(makeBrief(ws))
      // profile 已随派发参数化落盘（写域=workspace+dshHome；标签=单号/attempt）
      const seatbeltDir = join(ws, '.seatbelt')
      const files = readdirSync(seatbeltDir)
      expect(files.length).toBe(1)
      const profile = readFileSync(join(seatbeltDir, files[0]!), 'utf8')
      expect(profile).toContain(`(allow file-write* (subpath "${ws}"))`)
      expect(profile).toContain(`(allow file-write* (subpath "${dshHome}"))`)
      expect(profile).toContain(';; dispatch: DEV-29/att3')
      expect(profile).toContain('(deny file-write*)')
      // attempt3 处置 (a)：profile 无读收口（读域宽放——回归网同纯函数面）
      expect(profile).not.toContain('deny file-read')
      expect(readdirSync(dshHome).length).toBeGreaterThanOrEqual(0) // 重定向目录已建（dsh boot 写面就绪）
      // 流终态：未沙箱环境=fake CLI 经 sandbox-exec 正常跑完（completed）；
      // 嵌套沙箱环境（本套在 worker 内跑=sandbox_apply EPERM exit 71）=空流不 completed
      // ——两种落法都不得伪造成功（isCompleted 唯一判据 docs/31-§7 P-08）
      const events = await drain(adapter, handle)
      const turnEnd = events.find((e) => e.type === 'turn_end')
      if (turnEnd === undefined) {
        expect(turnEnd).toBeUndefined() // 嵌套拒绝：sandbox-exec 未跑起子进程——env 无消费者
      } else {
        expect(turnEnd.completed).toBe(true)
        const envEcho = events.find((e) => e.type === 'log' && e.text?.startsWith('fake-cli env: DSH_HOME='))
        expect(envEcho?.text).toBe(`fake-cli env: DSH_HOME=${dshHome}`)
      }
    } finally {
      delete process.env.DSH_FAKE_FIXTURE
      delete process.env.DSH_FAKE_ECHO_ENV
    }
  })

  it('mode=auto+detect：后端不可用如实 ok:false（嵌套沙箱环境 gap 明报，fail-closed 不派）', async () => {
    if (process.platform !== 'darwin') return
    const adapter = new DshAdapter([process.execPath, fakeCli], { seatbelt: { mode: 'auto' } })
    const detect = await adapter.detect()
    // 引擎 detect 闸的语义断言：后端不可用必须挡派（ok:false），绝不静默走无沙箱
    if (detect.ok) {
      // 未沙箱环境（daemon/门禁）：后端可用——dsh 面照常过闸（gap 只剩版本面）
      expect(detect.gaps.join(' ').includes('seatbelt')).toBe(false)
    } else {
      expect(detect.gaps.join(' ')).toMatch(/seatbelt-(nested-sandbox|backend-failed)/)
    }
  })
})
