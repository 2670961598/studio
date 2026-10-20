/**
 * postmortem —— 复盘单与案例库测试集（src/evolve/postmortem.ts：渲染器 + 目录约定 + CLI 链）
 *
 * 依据（实现单引用）：
 *   - docs/20-§十一：事故全链「发现→止血→复盘（挂复盘单）→案例库；**复盘不追责，追流程**」
 *     ——不追责的结构保证（模板无责任人字段 + 追责哨兵）是本套核心断言面。
 *   - docs/20-§九：复盘是进化管线尾位（观测→…→切权→复盘）——POSTMORTEM 是链尾事件。
 *   - docs/17-§3：事件枚举冻结 v1 含 POSTMORTEM——本套断言它经 appendEvent 正式写口落账
 *     并可回查（有实体，非枚举占位）。
 *   - docs/04-§二：公司目录 docs/ = 规范/知识/案例——案例库目录约定 docs/casebook/ 的落点。
 *
 * 覆盖面（实现单口径 12+）：
 *   - 模板形状：七节骨架齐 / 无「责任人」类标题（**不追责的结构保证**）/ 根因三分类固定小节
 *     （空类占位）/ 预防三出口标签 / 时间线条目带事件 id 与来源徽标；
 *   - 追责哨兵：输入文本经 markdown 注入「## 责任人」标题 → parse 与渲染双道闸都拒
 *     （CONFIG_INVALID 分类面）；assertNoBlameHeading 直接面；
 *   - 输入解析：枚举外根因分类 / 枚举外预防出口 / 空根因 / 空预防 / 坏 timeline 项 → 拒；
 *   - 案例条目映射：现象←summary、根因←三分类、解法←止血+结论、预防←三出口；四节齐；
 *   - 目录约定：条目名形状闸（合法过 / 缺日期 / 坏日期 / slug 带路径分隔 → 拒）、约定相对
 *     路径 docs/casebook/<file>；
 *   - CLI 链：模板→案例库文件落盘→POSTMORTEM 事件落账回查（note=条目路径、size=字节、
 *     payload_hash=内容 sha256）；断路器关联（该单 CIRCUIT_BREAK/ESCALATE 历史自动进
 *     时间线；他单事件不进；手写与台账同 id 去重）；真 bin 进程端到端；用法错误面
 *     （缺 --db / 缺 --company / 缺 --input / --issue 双源分歧 / 库不存在）。
 *
 * 手法纪律：os.tmpdir() 真文件库（沿 store 测试风格，不用 :memory:）；确定性 id/时钟注入
 * （idFactory/clock——e2e deterministicIds 同精神）；真子进程 spawn 遵守 crash-injection
 * 先例（等 exit 一次定局；process.execPath 绝对路径不依赖 PATH）；只 import 不改他包。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import type { Ledger } from '@studio-next/store'
import type { ClassifiedError } from '@studio-next/contract'
import {
  CASEBOOK_DIR_NAME,
  CASEBOOK_ENTRY_SECTIONS,
  CASEBOOK_FILE_RE,
  POSTMORTEM_BLAME_MARKERS,
  POSTMORTEM_TEMPLATE_SECTIONS,
  ROOT_CAUSE_LABELS,
  assertNoBlameHeading,
  casebookDate,
  casebookEntryFileName,
  casebookEntryRelPath,
  collectBreakerTimeline,
  mergeTimeline,
  parsePostmortemInput,
  renderCasebookEntry,
  renderPostmortemLines,
  renderPostmortemTemplate,
  runPostmortemChain,
} from '../../src/evolve/postmortem.ts'
import type { PostmortemInput, PostmortemTimelineEntry } from '../../src/evolve/postmortem.ts'
import { makeUlid } from '../../src/engine/id.ts'

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')

let root = ''
let clockMs = 0

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-postmortem-test-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 测试基建 —————————————————————————

const T0 = Date.parse('2026-10-17T08:00:00.000Z')

/** 确定性时钟（每调一次 +1ms——事件 ts/日期面确定性语料） */
function tick(): number {
  clockMs += 1
  return clockMs
}

/** 确定性 ULID 工厂（Crockford Base32 编码——src/engine/id.ts 同款算法；时间戳=ts、随机段=计数） */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let ulidSeq = 0
function encodeBase32(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i -= 1) {
    out = CROCKFORD[Number((value / 32n ** BigInt(i)) % 32n)] + out
  }
  return out
}
function deterministicUlid(ts: number): string {
  ulidSeq += 1
  return encodeBase32(BigInt(ts), 10) + encodeBase32(BigInt(ulidSeq), 16)
}

/** 合法复盘输入语料（七件套；时间线手写两条） */
function sampleInput(): PostmortemInput {
  return {
    issue: 'STUDIO-201',
    summary: '双工兵并行推进时外部模型配额耗尽，两个工位同时中断，任务停摆。',
    incidentAt: Date.parse('2026-10-17T09:30:00.000Z'),
    detectedAt: Date.parse('2026-10-17T10:00:00.000Z'),
    timeline: [
      { ts: Date.parse('2026-10-17T09:31:00.000Z'), event: 'QUOTA_EXHAUSTED', id: 'manual-quota', note: '供应商返回配额耗尽错误' },
      { ts: Date.parse('2026-10-17T10:05:00.000Z'), event: 'MANUAL_RESTART', id: 'manual-restart', note: '人工转单工兵节奏续作' },
    ],
    rootCauses: [
      { kind: 'environment', summary: '外部供应商配额硬上限（当日额度耗尽）' },
      { kind: 'process-gap', summary: '调度未把外部配额约束纳入考量——并行工位叠加燃烧率无上限' },
    ],
    containment: '止血：切单工兵节奏（一次只跑一个工位）+ 续作模式（从中断处接力，不重跑已完成段）。',
    preventions: [
      { summary: '燃烧率监控候批：每日定时岗对账消耗速率，逼近阈值告警', outlet: 'criteria' },
      { summary: '并行工位数与配额余量联动判据候批', outlet: 'protocol' },
    ],
    conclusion: '外部配额是环境硬约束，但「未纳入调度考量」是流程缺口——调度判据补配额面后并行才可恢复。',
  }
}

/** 台账事件语料直插（appendEvent 正式写口；attempt/level/dept 补全列） */
function seedEvent(ledger: Ledger, evt: { issue: string; event: string; ts: number; note: string }): void {
  ledger.appendEvent({
    id: makeUlid(evt.ts),
    ts: evt.ts,
    company: 'demo',
    issue: evt.issue,
    event: evt.event,
    actor: 'daemon',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: evt.note,
  })
}

/** ClassifiedError 断言捕手（fail-fast 上抛面：category/subcause 如实——sandbox 测试同款） */
function expectConfigInvalid(fn: () => unknown, subcause: string): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const e = caught as Error & ClassifiedError
  expect(e.category).toBe('CONFIG_INVALID')
  expect(e.subcause).toBe(subcause)
}

/** 标题行提取（测试同款口径：/^#+\s/） */
function headings(markdown: string): string[] {
  return markdown.split('\n').filter((l) => /^#+\s/.test(l)).map((l) => l.trim())
}

// ————————————————————————— 模板形状 —————————————————————————

describe('renderPostmortemTemplate —— 模板形状与不追责结构保证', () => {
  it('七节骨架齐：节名逐一在场（POSTMORTEM_TEMPLATE_SECTIONS 基准）', () => {
    const md = renderPostmortemTemplate(sampleInput())
    for (const section of POSTMORTEM_TEMPLATE_SECTIONS) {
      expect(md).toContain(`## ${section}`)
    }
    expect(md).toContain('# 复盘单：STUDIO-201')
    expect(md).toContain('复盘不追责，追流程')
  })

  it('无责任人字段（不追责的结构保证）：标题行不含任何追责哨兵词', () => {
    const md = renderPostmortemTemplate(sampleInput())
    const hs = headings(md)
    expect(hs.length).toBeGreaterThan(0)
    for (const marker of POSTMORTEM_BLAME_MARKERS) {
      for (const h of hs) {
        expect(h.toLowerCase().includes(marker.toLowerCase())).toBe(false)
      }
    }
  })

  it('根因三分类固定小节（空类占位「（无）」，固定骨架优于动态骨架）', () => {
    const md = renderPostmortemTemplate(sampleInput())
    expect(md).toContain('### 流程缺口（process-gap）')
    expect(md).toContain('### 环境因素（environment）')
    expect(md).toContain('### 判据失误（criteria-miss）')
    expect(md).toContain('（无）') // criteria-miss 空类占位
    expect(md).toContain('调度未把外部配额约束纳入考量')
  })

  it('预防措施每条带三类出口标签；时间线条目带事件 id 与来源徽标', () => {
    const md = renderPostmortemTemplate(sampleInput())
    expect(md).toContain('[进判据] 燃烧率监控候批')
    expect(md).toContain('[进规程] 并行工位数与配额余量联动判据候批')
    expect(md).toContain('**QUOTA_EXHAUSTED** `manual-quota`（复盘手写）')
    expect(md).toContain('**MANUAL_RESTART** `manual-restart`')
  })

  it('时间线空：如实呈现占位行（不虚构事件引用）', () => {
    const input = sampleInput()
    input.timeline = []
    const md = renderPostmortemTemplate(input)
    expect(md).toContain('（无事件引用——事故未留台账痕迹，时间线空如实呈现）')
  })

  it('追责哨兵：输入文本注入「## 责任人」标题 → 渲染出口拒（CONFIG_INVALID）', () => {
    const input = sampleInput()
    input.summary = '现象描述\n\n## 责任人：张三\n'
    expectConfigInvalid(() => renderPostmortemTemplate(input), 'daemon/postmortem:blame-heading')
  })
})

// ————————————————————————— 追责哨兵直接面 —————————————————————————

describe('assertNoBlameHeading —— 追责哨兵（机制化双保险）', () => {
  it('含「责任人/责任方/blame」标题 → 拒（CONFIG_INVALID 分类面）', () => {
    for (const heading of ['## 责任人', '### 责任方：工兵A', '## Blame Assignment']) {
      expectConfigInvalid(() => assertNoBlameHeading(`# ok\n\n${heading}\n\n正文`), 'daemon/postmortem:blame-heading')
    }
  })

  it('正文提及「不追责」原则句不误伤（只扫标题行）', () => {
    expect(() => assertNoBlameHeading('# 复盘单：X\n\n> 复盘不追责，追流程——正文提及责任人概念不拦')).not.toThrow()
  })
})

// ————————————————————————— 输入解析 —————————————————————————

describe('parsePostmortemInput —— 形状闸（fail-fast）', () => {
  it('合法七件套 JSON 往返（含 origin 缺省 manual）', () => {
    const input = parsePostmortemInput(JSON.parse(JSON.stringify(sampleInput())) as unknown)
    expect(input.issue).toBe('STUDIO-201')
    expect(input.rootCauses).toHaveLength(2)
    expect(input.preventions).toHaveLength(2)
  })

  it('根因分类枚举外值 → 拒（追流程的分类学，不加「人为失误」类）', () => {
    const raw = { ...sampleInput(), rootCauses: [{ kind: '人为失误', summary: 'x' }] }
    expectConfigInvalid(() => parsePostmortemInput(raw), 'daemon/postmortem:input:rootCauses.0.kind')
  })

  it('预防出口枚举外值 / 空根因 / 空预防 / 坏 timeline 项 → 拒', () => {
    const badOutlet = { ...sampleInput(), preventions: [{ summary: 'x', outlet: '升级处罚' }] }
    expectConfigInvalid(() => parsePostmortemInput(badOutlet), 'daemon/postmortem:input:preventions.0.outlet')
    const noRootCause = { ...sampleInput(), rootCauses: [] }
    expectConfigInvalid(() => parsePostmortemInput(noRootCause), 'daemon/postmortem:input:rootCauses')
    const noPrevention = { ...sampleInput(), preventions: [] }
    expectConfigInvalid(() => parsePostmortemInput(noPrevention), 'daemon/postmortem:input:preventions')
    const badTimeline = { ...sampleInput(), timeline: [{ ts: 'yesterday', event: 'X', id: 'y', note: 'n' }] }
    expectConfigInvalid(() => parsePostmortemInput(badTimeline), 'daemon/postmortem:input:timeline.0.ts')
  })

  it('输入文本注入追责标题 → 解析道哨兵先拦（双保险第一道）', () => {
    const raw = { ...sampleInput(), conclusion: '结论\n## 责任人：李四' }
    expectConfigInvalid(() => parsePostmortemInput(raw), 'daemon/postmortem:blame-heading')
  })
})

// ————————————————————————— 案例条目映射 —————————————————————————

describe('renderCasebookEntry —— 现象→根因→解法→预防 字段映射（20-§十一）', () => {
  it('四节齐、字段映射正确（现象←summary、根因←分类、解法←止血+结论、预防←出口）', () => {
    const input = sampleInput()
    const md = renderCasebookEntry(input, '2026-10-17')
    for (const section of CASEBOOK_ENTRY_SECTIONS) {
      expect(md).toContain(`## ${section}`)
    }
    expect(md).toContain('# 2026-10-17 复盘案例（复盘单 STUDIO-201）')
    expect(md).toContain(input.summary) // 现象
    expect(md).toContain(`[${ROOT_CAUSE_LABELS['process-gap']}]`) // 根因
    expect(md).toContain(input.containment) // 解法
    expect(md).toContain(`（复盘结论：${input.conclusion}）`)
    expect(md).toContain('[进判据]') // 预防
    expect(md).toContain(CASEBOOK_DIR_NAME) // 条目路径约定头注
  })

  it('条目同样过追责哨兵（注入标题 → 拒）', () => {
    const input = sampleInput()
    input.containment = '止血\n## 责任方\n'
    expectConfigInvalid(() => renderCasebookEntry(input, '2026-10-17'), 'daemon/postmortem:blame-heading')
  })
})

// ————————————————————————— 目录约定 —————————————————————————

describe('案例库目录约定 —— 条目名形状闸（<date>-<slug>.md）', () => {
  it('合法条目名（中文 slug / 英文 slug）过闸并组装正确', () => {
    expect(casebookEntryFileName('2026-10-17', '配额耗尽双工兵中断')).toBe('2026-10-17-配额耗尽双工兵中断.md')
    expect(casebookEntryFileName('2026-10-17', 'quota-exhaustion')).toBe('2026-10-17-quota-exhaustion.md')
  })

  it('坏形状拒：坏日期 / slug 带路径分隔 / slug 空或首连字符', () => {
    expectConfigInvalid(() => casebookEntryFileName('2026-10-7', 'x'), 'daemon/postmortem:casebook:bad-date')
    expectConfigInvalid(() => casebookEntryFileName('2026-10-17', 'a/b'), 'daemon/postmortem:casebook:bad-slug')
    expectConfigInvalid(() => casebookEntryFileName('2026-10-17', ''), 'daemon/postmortem:casebook:bad-slug')
    expectConfigInvalid(() => casebookEntryFileName('2026-10-17', '-x'), 'daemon/postmortem:casebook:bad-slug')
  })

  it('约定相对路径=docs/casebook/<file>；条目名正则与组装一致；日期取 UTC', () => {
    const name = casebookEntryFileName('2026-10-17', '配额耗尽双工兵中断')
    expect(casebookEntryRelPath(name)).toBe('docs/casebook/2026-10-17-配额耗尽双工兵中断.md')
    expect(CASEBOOK_FILE_RE.test(name)).toBe(true)
    expect(CASEBOOK_FILE_RE.test('no-date-slug.md')).toBe(false)
    expect(casebookDate(Date.parse('2026-10-17T23:59:59.999Z'))).toBe('2026-10-17')
  })
})

// ————————————————————————— 断路器关联 —————————————————————————

describe('断路器关联 —— CIRCUIT_BREAK/ESCALATE 台账历史自动进时间线', () => {
  it('该单的断路历史回查（ts 升序、origin=ledger）；他单事件不进', () => {
    const dbPath = path.join(root, 'breaker.sqlite')
    const ledger = openLedger(dbPath)
    try {
      seedEvent(ledger, { issue: 'STUDIO-201', event: 'GATE_FAIL', ts: T0 + 1, note: '验收红（非断路面，不引入）' })
      seedEvent(ledger, { issue: 'STUDIO-201', event: 'ESCALATE', ts: T0 + 2, note: 'CIRCUIT_BREAK：同签名 3 连击达阈值 3 → 自动开 bug 单' })
      seedEvent(ledger, { issue: 'STUDIO-999', event: 'ESCALATE', ts: T0 + 3, note: '他单断路（不引入）' })
      seedEvent(ledger, { issue: 'STUDIO-201', event: 'CIRCUIT_BREAK', ts: T0 + 4, note: '升级电路' })
      const auto = collectBreakerTimeline(ledger, 'STUDIO-201')
      expect(auto).toHaveLength(2)
      expect(auto[0]?.event).toBe('ESCALATE')
      expect(auto[0]?.origin).toBe('ledger')
      expect(auto[1]?.event).toBe('CIRCUIT_BREAK')
    } finally {
      ledger.close()
    }
  })

  it('归并：台账+手写去重（同 id 台账优先）、ts 升序稳定', () => {
    const shared = 'shared-evt'
    const auto: PostmortemTimelineEntry[] = [
      { ts: T0 + 2, event: 'ESCALATE', id: shared, note: '台账面（优先）', origin: 'ledger' },
      { ts: T0 + 5, event: 'RESUME', id: 'auto-resume', note: '续作', origin: 'ledger' },
    ]
    const manual: PostmortemTimelineEntry[] = [
      { ts: T0 + 1, event: 'FOUND', id: 'm1', note: '人工发现' },
      { ts: T0 + 2, event: 'ESCALATE', id: shared, note: '手写同 id（应被台账面压掉）' },
    ]
    const merged = mergeTimeline(auto, manual)
    expect(merged.map((e) => e.id)).toEqual(['m1', shared, 'auto-resume'])
    expect(merged[1]?.note).toBe('台账面（优先）')
    expect(merged[1]?.origin).toBe('ledger')
  })
})

// ————————————————————————— CLI 链 —————————————————————————

describe('runPostmortemChain —— 渲染模板→写案例库文件→落 POSTMORTEM 事件', () => {
  it('全链：文件落盘（条目+完整复盘自包含）、事件落账回查（note/size/payload_hash）、断路历史并入模板时间线', () => {
    const dbPath = path.join(root, 'chain.sqlite')
    const ledger = openLedger(dbPath)
    try {
      seedEvent(ledger, { issue: 'STUDIO-201', event: 'ESCALATE', ts: T0 + 60_000, note: 'CIRCUIT_BREAK：双工兵同时中断 3 连击 → 开 bug 单' })
      const casebookRoot = path.join(root, 'casebook-run')
      const result = runPostmortemChain(ledger, {
        input: sampleInput(),
        casebookRoot,
        slug: '配额耗尽双工兵中断',
        date: '2026-10-17',
        company: 'demo',
        clock: () => T0 + 86_400_000,
        idFactory: deterministicUlid,
      })

      // 文件面：条目（检索面）在前 + 完整复盘（审计面）在后，自包含
      expect(result.filePath).toBe(path.join(casebookRoot, '2026-10-17-配额耗尽双工兵中断.md'))
      expect(existsSync(result.filePath)).toBe(true)
      const content = readFileSync(result.filePath, 'utf8')
      expect(content.startsWith('# 2026-10-17 复盘案例')).toBe(true)
      expect(content).toContain('## 现象')
      expect(content.indexOf('# 复盘单：STUDIO-201')).toBeGreaterThan(content.indexOf('## 预防'))
      // 断路历史自动并入模板时间线（台账徽标）
      expect(result.autoTimelineCount).toBe(1)
      expect(content).toContain('（台账自动引入）')
      expect(result.mergedInput.timeline).toHaveLength(3)

      // 事件面：POSTMORTEM 落账，note=约定相对路径、size、payload_hash=内容指纹
      expect(result.relPath).toBe('docs/casebook/2026-10-17-配额耗尽双工兵中断.md')
      const back = ledger.queryEvents({ issue: 'STUDIO-201' }).filter((e) => e.event === 'POSTMORTEM')
      expect(back).toHaveLength(1)
      expect(back[0]?.note).toBe(result.relPath)
      expect(back[0]?.size).toBe(Buffer.byteLength(content, 'utf8'))
      expect(back[0]?.payload_hash).toBe(`sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`)
      expect(back[0]?.id).toBe(result.event.id)
      expect(back[0]?.company).toBe('demo')
      // 打印面四行齐
      expect(renderPostmortemLines(result)).toHaveLength(4)
    } finally {
      ledger.close()
    }
  })

  it('同链幂等语义：同日重跑=覆盖条目文件+新落一条事件（append-only 不改旧账）', () => {
    const dbPath = path.join(root, 'rerun.sqlite')
    const ledger = openLedger(dbPath)
    try {
      const casebookRoot = path.join(root, 'casebook-rerun')
      const opts = {
        input: sampleInput(),
        casebookRoot,
        slug: 'same-day',
        date: '2026-10-17',
        company: 'demo',
        clock: () => T0,
        idFactory: deterministicUlid,
      }
      runPostmortemChain(ledger, opts)
      const second = runPostmortemChain(ledger, opts)
      const events = ledger.queryEvents({ issue: 'STUDIO-201' }).filter((e) => e.event === 'POSTMORTEM')
      expect(events).toHaveLength(2)
      expect(events[1]?.id).toBe(second.event.id)
      expect(existsSync(second.filePath)).toBe(true)
    } finally {
      ledger.close()
    }
  })

  it('链内形状闸：坏 slug / 坏 date → CONFIG_INVALID（fail-fast 不落半成品事件）', () => {
    const dbPath = path.join(root, 'bad-shape.sqlite')
    const ledger = openLedger(dbPath)
    try {
      expectConfigInvalid(
        () => runPostmortemChain(ledger, { input: sampleInput(), casebookRoot: path.join(root, 'cb-bad'), slug: 'a/b', company: 'demo' }),
        'daemon/postmortem:casebook:bad-slug',
      )
      const events = ledger.queryEvents({ issue: 'STUDIO-201' }).filter((e) => e.event === 'POSTMORTEM')
      expect(events).toHaveLength(0) // 失败在写文件之前——事件零落账
    } finally {
      ledger.close()
    }
  })
})

// ————————————————————————— 真 bin 端到端 —————————————————————————

describe('studio-next postmortem 子命令（真 bin 进程）', () => {
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

  it('一条命令归档：--db --company --issue --input → exit 0、文件与事件双回查', { timeout: 60_000 }, async () => {
    const dbPath = path.join(root, 'cli-postmortem.sqlite')
    const ledger = openLedger(dbPath)
    seedEvent(ledger, { issue: 'STUDIO-201', event: 'CIRCUIT_BREAK', ts: T0 + 30_000, note: '断路熔断：配额耗尽签名' })
    ledger.close()

    const casebookRoot = path.join(root, 'casebook-cli')
    const inputPath = path.join(root, 'postmortem-input.json')
    writeFileSync(inputPath, JSON.stringify(sampleInput()), 'utf8')

    const result = await runBin([
      'postmortem',
      '--db', dbPath,
      '--company', 'demo',
      '--issue', 'STUDIO-201',
      '--input', inputPath,
      '--casebook', casebookRoot,
      '--slug', '配额耗尽双工兵中断',
      '--date', '2026-10-17',
    ])
    expect(result.code).toBe(0)
    expect(result.out).toContain('[postmortem]')

    // 文件回查 + 台账回查（独立开库——进程间真隔离）
    const entryPath = path.join(casebookRoot, '2026-10-17-配额耗尽双工兵中断.md')
    expect(existsSync(entryPath)).toBe(true)
    const content = readFileSync(entryPath, 'utf8')
    expect(content).toContain('## 现象')
    expect(content).toContain('# 复盘单：STUDIO-201')
    const ledger2 = openLedger(dbPath)
    try {
      const events = ledger2.queryEvents({ issue: 'STUDIO-201' }).filter((e) => e.event === 'POSTMORTEM')
      expect(events).toHaveLength(1)
      expect(events[0]?.note).toBe('docs/casebook/2026-10-17-配额耗尽双工兵中断.md')
      expect(events[0]?.size).toBe(Buffer.byteLength(content, 'utf8'))
    } finally {
      ledger2.close()
    }
  })

  it('用法错误面：缺 --db / 缺 --company / 缺 --input（复盘不可虚构）/ --issue 分歧 / 库不存在 → exit 1', { timeout: 60_000 }, async () => {
    const inputPath = path.join(root, 'pm-usage.json')
    writeFileSync(inputPath, JSON.stringify(sampleInput()), 'utf8')
    const dbPath = path.join(root, 'usage.sqlite')
    const ledger = openLedger(dbPath)
    ledger.close()

    expect((await runBin(['postmortem', '--company', 'demo', '--input', inputPath])).code).toBe(1)
    expect((await runBin(['postmortem', '--db', dbPath, '--input', inputPath])).code).toBe(1)
    const noInput = await runBin(['postmortem', '--db', dbPath, '--company', 'demo', '--issue', 'STUDIO-201'])
    expect(noInput.code).toBe(1)
    expect(noInput.err).toContain('--input')
    const diverged = await runBin(['postmortem', '--db', dbPath, '--company', 'demo', '--issue', 'OTHER-1', '--input', inputPath])
    expect(diverged.code).toBe(1)
    expect(diverged.err).toContain('不一致')
    const noDb = await runBin(['postmortem', '--db', path.join(root, 'no-such.sqlite'), '--company', 'demo', '--input', inputPath])
    expect(noDb.code).toBe(1)
    expect(noDb.err).toContain('库不存在')
  })
})
