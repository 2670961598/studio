/**
 * work-stack —— IMPL-06-02「工作与判定域」V3 真栈夹具（记录面测试共用）
 *
 * 依据：docs/v2/17 §一 V3（fake 只替代外部端口：fake 平台＋fake 执行体；内部决策/记录/
 * 事务/状态机必须真跑）；docs/plan/04 §1.9.4（V2 新套件：real fake 栈、不 mock LLM、
 * 不重试、不 passWithNoTests）；docs/plan/05 IMPL-06-02（验收：`test:v2 --
 * apps/daemon/test/v2/records` 绿）。
 *
 * 组成（全部真件，零 mock）：
 *   - fake FlowPlatform（src/engine/fakes.ts，内存七能力＋活动流）＝平台端口替身；
 *   - fake executor adapter（同上；`mode` 可变＝运行期切换收割四要件形态）；
 *   - **真 SQLite 台账**（openLedger，tmp 目录）与**真引擎**（createEngine）；
 *   - 假时钟（epoch-ms 手推——core/引擎时钟纪律同款：时点入参不读墙钟）。
 *
 * 纪律：每用例独立库/目录（tmp 根 afterAll 整根删除）；夹具不替断言、不写业务语义；
 * 不 import 任何 LLM/网络件。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, FlowPlatform, IssueRecord, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickReport } from '../../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../../src/assembly/demo/demo-snapshot.ts'

/** 固定拍首时点（假时钟基线；断言不依赖墙钟） */
export const T0 = Date.parse('2026-11-01T00:00:00.000Z')

/** tmp 根清理台账（afterAll 统一回收；失败也不留盘） */
const roots: string[] = []

/** 真栈句柄 */
export interface WorkTestStack {
  readonly platform: FlowPlatform
  readonly ledger: Ledger
  readonly engine: Engine
  readonly root: string
  readonly clock: { now(): number; advance(ms: number): void }
  /** 执行体形态开关（函数形态模式：`() => mode.value` 现取——运行期切换） */
  readonly mode: { value: FakeAdapterMode }
}

/** 建真栈（一用例一库一目录） */
export async function createWorkStack(label: string): Promise<WorkTestStack> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-work-${label}-`))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const mode: { value: FakeAdapterMode } = { value: 'ok' }
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode: () => mode.value, name: 'fake-work' }), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      // 镜面对账重决策每拍开（DEV-42①：回退态单在零活动世界也能重进决策）
      mirrorRescanEveryTicks: 1,
      stallAfterMs: 60_000,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, root, clock, mode }
}

/** 整根删除全部 tmp 台账/工位目录（afterAll 调） */
export async function disposeWorkStacks(): Promise<void> {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.length = 0
}

/** 建单（平台端口真调用；L0 任务单） */
export async function createTicket(stack: WorkTestStack, title = 'V3 工作单'): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: 0 })
  return created.id
}

/** 推一拍（时钟 +1000ms；真 engine.tick） */
export async function tick(stack: WorkTestStack): Promise<TickReport> {
  stack.clock.advance(1000)
  return stack.engine.tick()
}

/** 连推 n 拍（返回逐拍报告） */
export async function runTicks(stack: WorkTestStack, n: number): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) reports.push(await tick(stack))
  return reports
}

/** 该单事件流（台账真查询，按写入序） */
export function eventsOf(ledger: Ledger, ticket: TicketId): EventRecord[] {
  return ledger.queryEvents({ issue: ticket })
}

/** 该单某事件名的全部事件 */
export function eventsNamed(ledger: Ledger, ticket: TicketId, name: EventRecord['event']): EventRecord[] {
  return eventsOf(ledger, ticket).filter((e) => e.event === name)
}

/** 平台当前镜像（真取） */
export async function issueOf(stack: WorkTestStack, ticket: TicketId): Promise<IssueRecord> {
  return stack.platform.issues.get(ticket)
}
