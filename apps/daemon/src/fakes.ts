/**
 * fakes —— demo 模式全家桶：fake FlowPlatform + fake executor adapter（docs/23-§四）
 *
 * 定位：
 *   - docs/23-§四「demo 模式（localfile）零外部依赖跑通 TTHW」的 daemon 侧预演件——
 *     serve --platform fake 与 e2e 测试共用本文件；真 localfile 平台归 platform 泳道
 *     （@studio-next/localplatform，v0 未挂 daemon 依赖——node_modules/@studio-next 无此包，
 *     接入点=serve.ts wirePlatform 与 engine deps 的 FlowPlatform 参数）。
 *   - fake platform：内存实现 FlowPlatform 七能力（issues/comments/fields/kb/activity/links/
 *     guards），活动流游标=数字 id 边界（对齐 docs/25-§3.2 YouTrack「最后活动 id」语义）。
 *   - fake adapter：launch 即产出**完成流**并落 REPORT.md + summary.json 到 workspace
 *     （模拟 worker 一命终态；流一次性消费——dsh 同款纪律），四要件中前两要件恒真、
 *     REPORT 由本适配器代写（要件 3/4 归 gateRunner——v0 占位闸门即检查这两个文件）。
 *
 * 诚实边界：fake adapter 的「工作产出」是固定文本——不跑真模型、不跑真验收命令；
 * 失败形态（mode）只覆盖收割四要件的缺失面，供断路器/回滚链路测试注入。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  ActivityPage,
  BudgetEstimate,
  Comment,
  CompanySlug,
  DetectResult,
  ExecutorAdapter,
  ExecutorCapabilities,
  FieldProvisionMap,
  FieldSchema,
  FlowPlatform,
  GuardRule,
  Handle,
  IssueCreate,
  IssueQuery,
  IssueRecord,
  KbHit,
  LinkType,
  PlatformActivity,
  ResultStats,
  SignedBody,
  StreamEvent,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'

// ————————————————————————— fake FlowPlatform —————————————————————————

/** fake 平台选项 */
export interface FakePlatformOptions {
  /** 时钟注入（IssueRecord.updated/活动 ts 一致性来源；缺省真时钟） */
  now?: () => string
  /** 活动流分页大小（缺省 100；测试注入小值可验翻页） */
  pageSize?: number
}

interface FakeIssue extends IssueRecord {
  created: string
}

/**
 * 内存 FlowPlatform：状态权威在本实例（Map）；一切变更推活动流。
 * 游标=活动 id（数字字符串，升序）；since(cursor) 返回 id > cursor 的活动，
 * nextCursor=本页末条 id（有货即给——空页才 null，允许调用方多拉一拍空页）。
 */
export function createFakePlatform(opts?: FakePlatformOptions): FlowPlatform {
  const now = opts?.now ?? (() => new Date().toISOString())
  const pageSize = opts?.pageSize ?? 100
  const issues = new Map<TicketId, FakeIssue>()
  const comments = new Map<TicketId, Comment[]>()
  const links = new Map<TicketId, Array<{ other: TicketId; type: LinkType }>>()
  const kb = new Map<string, string>()
  const activities: PlatformActivity[] = []
  let issueSeq = 0
  let actSeq = 0
  let commentSeq = 0

  const pushActivity = (issue: TicketId | undefined, kind: string, actor?: string): void => {
    actSeq += 1
    activities.push({ id: String(actSeq), ts: now(), ...(issue !== undefined ? { issue } : {}), kind, ...(actor !== undefined ? { actor } : {}) })
  }

  const mustIssue = (id: TicketId): FakeIssue => {
    const found = issues.get(id)
    if (found === undefined) throw new Error(`fake-platform：单据不存在 ${id}`)
    return found
  }

  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        let all = [...issues.values()]
        if (q.stateIn !== undefined) all = all.filter((i) => q.stateIn?.includes(i.state))
        if (q.assignee !== undefined) all = all.filter((i) => i.assignee === q.assignee)
        if (q.lane !== undefined) all = all.filter((i) => i.lane === q.lane)
        if (q.updatedSince !== undefined) all = all.filter((i) => i.updated > (q.updatedSince ?? ''))
        return all.map(({ ...i }) => ({ ...i }))
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return { ...mustIssue(id) }
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        issueSeq += 1
        const id = `T-${issueSeq}`
        const rec: FakeIssue = {
          id,
          title: input.title,
          state: '新单',
          updated: now(),
          created: now(),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.dept !== undefined ? { dept: input.dept } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
          ...(input.parent !== undefined ? { parent: input.parent } : {}),
        }
        issues.set(id, rec)
        pushActivity(id, 'issue-created', input.assignee)
        return { ...rec }
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        const rec = mustIssue(id)
        rec.state = toState
        rec.updated = now()
        pushActivity(id, 'state-transition')
        return { ...rec }
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        const rec = mustIssue(id)
        const key = field as keyof FakeIssue
        if (key === 'lane' || key === 'assignee' || key === 'dept' || key === 'level' || key === 'type' || key === 'title') {
          ;(rec as unknown as Record<string, unknown>)[key] = value
        }
        rec.updated = now()
        pushActivity(id, `field-set:${field}`)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        mustIssue(id)
        commentSeq += 1
        const list = comments.get(id) ?? []
        list.push({ id: `c-${commentSeq}`, issue: id, author: body.author, body: body.body, created: now() })
        comments.set(id, list)
        pushActivity(id, 'comment-added', body.author)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return [...(comments.get(id) ?? [])]
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return [
          { name: 'state', type: 'enum', values: ['新单', '已派发', '证据就绪', '复验通过', '已交付'] },
          { name: 'level', type: 'int' },
          { name: 'dept', type: 'string' },
        ]
      },
      async provision(_map: FieldProvisionMap): Promise<void> {
        // fake 平台无字段物化面（provision 记活动即视为受理）
        pushActivity(undefined, 'fields-provisioned')
      },
    },
    kb: {
      async upsert(p: string, md: string): Promise<void> {
        kb.set(p, md)
        pushActivity(undefined, 'kb-upsert')
      },
      async search(q: string): Promise<KbHit[]> {
        return [...kb.entries()]
          .filter(([, md]) => md.includes(q))
          .map(([p, md]) => ({ path: p, title: p, snippet: md.slice(0, 60) }))
      },
      async get(p: string): Promise<string> {
        const found = kb.get(p)
        if (found === undefined) throw new Error(`fake-platform：kb 条目不存在 ${p}`)
        return found
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        const threshold = cursor === null ? 0 : Number.parseInt(cursor, 10)
        const base = Number.isNaN(threshold) ? 0 : threshold
        const items = activities.filter((a) => Number(a.id) > base).slice(0, pageSize)
        const nextCursor = items.length > 0 ? items[items.length - 1]?.id ?? null : null
        return { items, nextCursor }
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        mustIssue(a)
        mustIssue(b)
        const listA = links.get(a) ?? []
        listA.push({ other: b, type })
        links.set(a, listA)
        pushActivity(a, 'link-added')
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return [...(issues.values())].filter((i) => i.parent === id).map((i) => i.id)
      },
    },
    guards: {
      async install(_company: CompanySlug, _rules: GuardRule[]): Promise<void> {
        // fake 平台不强制 guard（迁移合法性第一道闸在 core flows；第二道闸平台侧 v0 免）
      },
      async uninstall(_company: CompanySlug): Promise<void> {
        // 同上（无面可卸）
      },
    },
  }
}

// ————————————————————————— fake executor adapter —————————————————————————

/** fake 适配器工作形态（收割四要件缺失面注入——测试断路/回滚链路用） */
export type FakeAdapterMode =
  | 'ok' // 全要件真（流 completed+非空+落 REPORT/summary）
  | 'empty_output' // 要件 2 缺：completed 但无非空 log 文本
  | 'incomplete' // 要件 1 缺：turn_end.completed=false
  | 'no_report' // 要件 3 缺：不落 REPORT/summary（闸门侧报）

/** fake 适配器选项 */
export interface FakeAdapterOptions {
  mode?: FakeAdapterMode
  name?: string
}

interface FakeSession {
  events: StreamEvent[]
  consumed: boolean
}

const FAKE_CAPABILITIES: ExecutorCapabilities = {
  budget_cap: false,
  cancel_turn: false,
  session_resume: false,
  agents_md: 'native',
  cost_native: false,
}

/** fake REPORT 骨架（contract 必填节：结论/改动/验证——ReportSkeletonSchema 拟稿口径） */
export const FAKE_REPORT_MD = [
  '# REPORT · fake worker',
  '',
  '## 结论',
  'fake 适配器完成单据（demo 模式固定产出）。',
  '',
  '## 改动',
  '- 无真实改动（demo）',
  '',
  '## 验证',
  '- fake 流 turn_end.completed=true；闸门=REPORT 存在性模拟',
  '',
].join('\n')

/** fake summary.json sidecar（contract SummarySidecarSchema summary/v1） */
export const FAKE_SUMMARY_JSON = JSON.stringify(
  {
    schema: 'summary/v1',
    conclusion: 'fake 适配器完成单据（demo 模式固定产出）',
    changed_files: [],
  },
  null,
  2,
)

/**
 * 内存 fake adapter：launch 即「worker 已完成」——按 mode 落产物并备好一次性完成流。
 * stream 一会话只许消费一次（dsh 同款纪律）；resultStats 固定账目。
 */
export function createFakeAdapter(opts?: FakeAdapterOptions): ExecutorAdapter {
  const mode = opts?.mode ?? 'ok'
  const name = opts?.name ?? 'fake'
  const sessions = new Map<string, FakeSession>()
  let sessionSeq = 0

  return {
    name,
    capabilities: { ...FAKE_CAPABILITIES },
    async detect(): Promise<DetectResult> {
      return { name, version: '0.0.0-fake', ok: true, gaps: [] }
    },
    async estimate(_task: TaskBrief): Promise<BudgetEstimate> {
      return { estimated: { usd: 0 }, confidence: 0 }
    },
    async launch(task: TaskBrief): Promise<Handle> {
      sessionSeq += 1
      const sessionId = `${name}-${sessionSeq}`
      // worker 落产物（REPORT/summary 是 worker 侧产物，非闸门侧）；no_report 形态=worker 没交报告
      if (mode !== 'no_report') {
        mkdirSync(task.workspace, { recursive: true })
        writeFileSync(path.join(task.workspace, 'REPORT.md'), FAKE_REPORT_MD, 'utf8')
        writeFileSync(path.join(task.workspace, 'summary.json'), FAKE_SUMMARY_JSON, 'utf8')
      }
      const events: StreamEvent[] = []
      if (mode !== 'empty_output') events.push({ type: 'log', text: `[${name}] 工作产出文本（非空输出——四要件之一）` })
      events.push({ type: 'step_start', step: 'work' })
      events.push({ type: 'step_end', step: 'work', usage: { input: 100, output: 50 } })
      events.push({
        type: 'turn_end',
        completed: mode !== 'incomplete',
        usage: { input: 100, output: 50 },
      })
      sessions.set(sessionId, { events, consumed: false })
      return { executor: name, sessionId, pid: 0 }
    },
    async *stream(h: Handle): AsyncIterable<StreamEvent> {
      const session = sessions.get(h.sessionId)
      if (session === undefined) throw new Error(`fake-adapter：未知会话 ${h.sessionId}`)
      if (session.consumed) throw new Error(`fake-adapter：会话 ${h.sessionId} 流已消费（一单一命、一流一收）`)
      session.consumed = true
      for (const ev of session.events) yield ev
    },
    async resultStats(h: Handle): Promise<ResultStats> {
      const session = sessions.get(h.sessionId)
      if (session === undefined) throw new Error(`fake-adapter：未知会话 ${h.sessionId}`)
      const turnEnd = session.events.find((e): e is Extract<StreamEvent, { type: 'turn_end' }> => e.type === 'turn_end')
      return {
        cost: { usd: 0.01 },
        tokens: turnEnd?.usage ?? { input: 0, output: 0 },
        duration: 10,
        turns: 1,
      }
    },
    async kill(_h: Handle, _graceMs: number): Promise<void> {
      // fake 无进程可杀（pid=0）
    },
  }
}
