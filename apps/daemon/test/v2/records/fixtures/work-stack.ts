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
import type { EventRecord, ExecutorAdapter, FlowPlatform, IssueRecord, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type EngineConfig, type EngineSignatureDraft, type TickReport } from '../../../../src/engine/engine.ts'
import type { RecordWirePort } from '../../../../src/engine/records/index.ts'
import type { HarvestRecordSink } from '../../../../src/engine/harvest/records.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../../src/engine/fakes.ts'
import { createDefaultGateRunner, type GateRunner } from '../../../../src/engine/gate.ts'
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
  /** fake 执行体本体（task-158 FIX-04 ① 追加面：测试可直呼 kill 放行驻留流——工人中途消亡注入） */
  readonly adapter: ExecutorAdapter
}

/**
 * 记录写面注入器（studio-dev-527 追加面）：给 ledger 与公司标识，返记录写面端口——
 * 缺省不注入＝记录面关（基线零行为），既有用例调用面/语义不变。
 */
export type RecordWireFactory = (args: { readonly ledger: Ledger; readonly company: string }) => RecordWirePort

/**
 * 建真栈（一用例一库一目录；overrides 仅测试面按需覆盖引擎配置——缺省=基线零行为）
 *
 * 引擎装配抽成 buildEngine：restartWorkStack（daemon 重启模拟）在同平台/同台账/同时钟上
 * 重建引擎——两处配置口径唯一。
 */
export async function createWorkStack(
  label: string,
  overrides: Partial<EngineConfig> = {},
  extra: {
    readonly recordsOf?: RecordWireFactory
    readonly signature?: EngineSignatureDraft
    /** 收割证据落库口注入器（studio-dev-536 追加面；缺省不注入＝面关零行为，既有用例不动） */
    readonly harvestRecordsOf?: (ledger: Ledger) => HarvestRecordSink
    /**
     * 闸门注入（task-158 FIX-04 ② 追加面）：gateRunner=收割闸；reverifyGate=补终态复验闸
     * （缺省不注入＝v0 占位闸、无补终态资格——既有用例口径不变）。
     */
    readonly gate?: { readonly gateRunner: GateRunner; readonly reverifyGate?: GateRunner }
    /** 执行体 launch 计数钩子（模型调用次数断言面；缺省不挂） */
    readonly onLaunch?: (task: TaskBrief) => void
  } = {},
): Promise<WorkTestStack> {
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
  const built = buildEngine({ root, ledger, clock, platform, mode, overrides, extra })
  return { platform, ledger, engine: built.engine, adapter: built.adapter, root, clock, mode }
}

/** 引擎装配入参的可注入面（闸门/launch 钩子——buildEngine 与 restartWorkStack 共用类型） */
export interface StackInjection {
  readonly gate?: { readonly gateRunner: GateRunner; readonly reverifyGate?: GateRunner }
  readonly onLaunch?: (task: TaskBrief) => void
}

interface StackParts {
  readonly root: string
  readonly ledger: Ledger
  readonly clock: { now(): number }
  readonly platform: FlowPlatform
  readonly mode: { value: FakeAdapterMode }
  readonly overrides: Partial<EngineConfig>
  readonly extra: {
    readonly recordsOf?: RecordWireFactory
    readonly signature?: EngineSignatureDraft
    readonly harvestRecordsOf?: (ledger: Ledger) => HarvestRecordSink
  } & StackInjection
}

/** 引擎装配（createWorkStack / restartWorkStack 共用——配置口径唯一） */
function buildEngine(parts: StackParts): { engine: Engine; adapter: ExecutorAdapter } {
  const { root, ledger, clock, platform, mode, overrides, extra } = parts
  const registry = createRegistry()
  const adapter = createFakeAdapter({ mode: () => mode.value, name: 'fake-work', ...(extra.onLaunch !== undefined ? { onLaunch: extra.onLaunch } : {}) })
  registry.register(adapter, { default: true })
  const records = extra.recordsOf?.({ ledger, company: DEMO_SNAPSHOT.slug })
  const harvestRecords = extra.harvestRecordsOf?.(ledger)
  const engine = createEngine({
    platform,
    ledger,
    ...(records !== undefined ? { records } : {}),
    ...(harvestRecords !== undefined ? { harvestRecords } : {}),
    registry,
    ...(extra.signature !== undefined ? { signature: extra.signature } : {}),
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: extra.gate?.gateRunner ?? createDefaultGateRunner(),
    ...(extra.gate?.reverifyGate !== undefined ? { reverifyGate: extra.gate.reverifyGate } : {}),
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
      ...overrides,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { engine, adapter }
}

/**
 * daemon 重启模拟（task-158 FIX-04 ① 追加面）：同平台/同台账/同假时钟上重建引擎——进程内存态
 * （inflight／泳道租约／收口认领表／断路器）全部归零＝真重启语义；调用方先 dispose 旧引擎。
 * 记录面注入器不随重启重建（本面用例不涉记录面）。
 */
export function restartWorkStack(stack: WorkTestStack, overrides: Partial<EngineConfig> = {}, injection: StackInjection = {}): WorkTestStack {
  const built = buildEngine({ root: stack.root, ledger: stack.ledger, clock: stack.clock, platform: stack.platform, mode: stack.mode, overrides, extra: injection })
  return { ...stack, engine: built.engine, adapter: built.adapter }
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
